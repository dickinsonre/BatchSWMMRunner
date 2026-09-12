import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import {
  calculateDiagnostic,
  checkDiagnosticPairing,
  compareDiagnostic,
  diagnosticCsv,
  parseDiagnosticInp,
  parseDiagnosticReport,
  validateDiagnosticSettings,
  xsection,
} from "../client/src/lib/coherenceDiagnostic";

const INP = `
[OPTIONS]
FLOW_UNITS CFS
MIN_SLOPE 0.0001
ROUTING_STEP 7
SURCHARGE_METHOD EXTRAN

[CONDUITS]
C1 N1 N2 100 0.013 0.01 0 0
C2 N2 N3 90 0.013 0.01 0 0
C3 N3 N4 90 0.013 0.01 0 0

[XSECTIONS]
C1 CIRCULAR 4 0 0 0 1
C2 RECT_OPEN 3 5 0 0 1
; C3 deliberately has no geometry
`;

const REPORT = `
  Link Flow Summary
  -----------------------------------------------------------------------------
                                  Maximum  Time of Max   Maximum    Max/    Max/
                                   |Flow|   Occurrence   |Veloc|    Full    Full
  Link                 Type          CFS  days hr:min    ft/sec    Flow   Depth
  -----------------------------------------------------------------------------
  C1                   CONDUIT      4.65     0  04:01      7.60    0.30    0.90
  C2                   CONDUIT      0.78     0  04:02      >50.00   0.11    0.22
`;

// These rows are copied from actual SWMM report output.  SWMM 5 and SWMM 6
// use the same Link Flow Summary layout, including the unit-dependent header.
const REPORT_WITH_RUN_SETTINGS = `
  Analysis Options
  ----------------
  Flow Units .............. CFS
  Routing Time Step ....... 12.00 sec
  Surcharge Method ........ SLOT
${REPORT}
`;

describe("coherence diagnostic geometry and report parsing", () => {
  it("preserves missing and unsupported geometry instead of inventing dimensions", () => {
    const model = parseDiagnosticInp(INP);
    expect(model.conduits.find(c => c.name === "C3")?.section.support).toBe("missing");
    expect(xsection("IRREGULAR", ["1", "2", "0", "0"]).support).toBe("unsupported");
    expect(xsection("CIRCULAR", ["4", "", "", ""]).support).toBe("exact");
  });

  it("reads the SWMM link summary and keeps censored values", () => {
    const report = parseDiagnosticReport(REPORT);
    expect(report.hasLinkFlowSummary).toBe(true);
    expect(report.links.C1.depthRatio.value).toBeCloseTo(0.9);
    expect(report.links.C2.maxVelocity).toMatchObject({
      value: 50,
      status: "censored",
      bound: "lower",
    });
  });

  it("uses report routing settings first, then INP fallback, with provenance", () => {
    const fromReport = calculateDiagnostic(INP, REPORT_WITH_RUN_SETTINGS, REPORT_WITH_RUN_SETTINGS, {
      rStar: 1,
      crownOnset: 0.9,
      openCrownOnset: 0.95,
    });
    expect(fromReport.runSettings).toMatchObject({
      dt: 12,
      dtSource: "report",
      surchargeMethod: "SLOT",
      surchargeMethodSource: "report",
    });
    const fromInp = calculateDiagnostic(INP, REPORT, REPORT, {
      rStar: 1,
      crownOnset: 0.9,
      openCrownOnset: 0.95,
    });
    expect(fromInp.runSettings).toMatchObject({ dt: 7, dtSource: "inp", surchargeMethod: "EXTRAN" });
    const manual = calculateDiagnostic(INP, REPORT_WITH_RUN_SETTINGS, REPORT_WITH_RUN_SETTINGS, {
      dt: 3,
      rStar: 1,
      crownOnset: 0.9,
      openCrownOnset: 0.95,
    });
    expect(manual.runSettings.dtSource).toBe("manual");
  });

  it("keeps a single SWMM6 report on the SWMM6 side when no SWMM5 report exists", () => {
    const single = calculateDiagnostic(INP, undefined, REPORT_WITH_RUN_SETTINGS, {
      rStar: 1,
      crownOnset: 0.9,
      openCrownOnset: 0.95,
    });
    expect(single.report5.hasLinkFlowSummary).toBe(false);
    expect(single.report6.hasLinkFlowSummary).toBe(true);
    expect(single.rows.find(row => row.name === "C1")?.swmm5.source).toBe("missing-report");
    expect(single.rows.find(row => row.name === "C1")?.swmm6.source).toBe("report");
  });

  it("computes screen/report overlap per engine, including adjusted-length diagnostics", () => {
    const fiiHeading = `
****************
Highest Flow Instability Indexes
****************
All links are stable
`;
    const rerunFii = fiiHeading.replace("All links are stable", "Link C1 (75.0)");
    const clearReport = REPORT.replace("7.60", "0.10").replace("0.90", "0.10");
    const split = calculateDiagnostic(INP, `${REPORT}${fiiHeading}`, `${clearReport}${rerunFii}`, {
      rStar: 1, crownOnset: 0.9, openCrownOnset: 0.95,
    });
    const splitRow = split.rows.find(row => row.name === "C1")!;
    expect(splitRow.swmm5.category).toBe("review");
    expect(splitRow.swmm5Overlap).toBe("screen-only");
    expect(splitRow.swmm6Overlap).toBe("diagnostic-only");
    // A diagnostic listed only by SWMM6 must not create a SWMM5 overlap.
    expect(splitRow.swmm5Overlap).not.toBe("overlap");

    const lengthDiagnostic = `${REPORT}
****************
Flow Classification Summary
****************
Link                Adjusted/Actual
C1                  1.10
`;
    const adjusted = calculateDiagnostic(INP, lengthDiagnostic, lengthDiagnostic, {
      rStar: 1, crownOnset: 0.9, openCrownOnset: 0.95,
    });
    const adjustedRow = adjusted.rows.find(row => row.name === "C1")!;
    expect(adjustedRow.swmm5Diagnostics.adjustedLengthStatus).toMatchObject({ status: "listed", value: 1.1 });
    expect(adjustedRow.swmm5Overlap).toBe("overlap");
    expect(diagnosticCsv(adjusted.rows)).toMatch(/SWMM5 velocity \(ft\/s or m\/s; see unit\).*SWMM5 velocity unit/);
  });

  it("uses the unclamped SLOT branch above full depth and keeps invalid lengths unavailable", () => {
    const slotReport = REPORT.replace("0.90", "2.00");
    const slot = calculateDiagnostic(INP, slotReport, slotReport, {
      dt: 5,
      rStar: 1,
      crownOnset: 0.9,
      openCrownOnset: 0.95,
      surchargeMethod: "SLOT",
    });
    expect(slot.rows.find(row => row.name === "C1")?.swmm5.widthTreatment).toBe("slot");
    expect(slot.rows.find(row => row.name === "C1")?.swmm5.topWidth).toBeCloseTo(0.04, 5);

    const invalidLengthInp = INP.replace(
      "C3 N3 N4 90 0.013 0.01 0 0",
      "C3 N3 N4 bad 0.013 0.01 0 0",
    ).replace("C1 CIRCULAR 4 0 0 0 1", "C1 CIRCULAR 4 0 0 0 1\nC3 CIRCULAR 4 0 0 0 1");
    const invalidLengthReport = `${REPORT}\n  C3                   CONDUIT      1.00     0  00:01      1.00    0.10    0.50`;
    const invalid = calculateDiagnostic(invalidLengthInp, invalidLengthReport, invalidLengthReport, {
      dt: 5,
      rStar: 1,
      crownOnset: 0.9,
      openCrownOnset: 0.95,
    });
    const invalidRow = invalid.rows.find(row => row.name === "C3")!;
    expect(invalidRow.swmm5.courant.status).toBe("unavailable");
    expect(invalidRow.swmm5.category).toBe("unknown");
  });

  it("uses each report's own routing step and preserves unknown SWMM6 crown treatment", () => {
    const swmm5 = REPORT_WITH_RUN_SETTINGS.replace("12.00 sec", "5.00 sec").replace("SLOT", "EXTRAN");
    const swmm6 = REPORT_WITH_RUN_SETTINGS
      .replace("12.00 sec", "30.00 sec")
      .replace("SLOT", "DYNAMIC_SLOT")
      .replace("0.90", "0.99");
    const result = calculateDiagnostic(INP, swmm5, swmm6, {
      rStar: 1, crownOnset: 0.9, openCrownOnset: 0.95,
    });
    expect(result.sideRunSettings.swmm5.dt).toBe(5);
    expect(result.sideRunSettings.swmm6.dt).toBe(30);
    const row = result.rows.find(item => item.name === "C1")!;
    expect(row.swmm6.froude.status).toBe("unavailable");
    expect(row.swmm6.category).not.toBe("clear");
    const comparison = compareDiagnostic(result);
    expect(comparison.dt5).toBe(5);
    expect(comparison.dt6).toBe(30);
  });

  it("screens appended link series concurrently only when explicitly present", () => {
    const appended = `${REPORT}

****************
Link Results Time Series
****************
<<< C1 >>>
Date  Time  Flow  Depth  Velocity
Day  Hour:Min  CFS  Feet  ft/sec
---------------------------------
01/01/2026  00:00  1.0  0.10  25.0
01/01/2026  00:05  1.0  0.10  1.0
`;
    const result = calculateDiagnostic(INP, appended, appended, {
      dt: 5, rStar: 1, crownOnset: 0.9, openCrownOnset: 0.95, basis: "concurrent",
    });
    const row = result.rows.find(item => item.name === "C1")!;
    expect(row.swmm5.basis).toBe("concurrent");
    expect(row.swmm5.concurrentEvidence).toBe("available");
    expect(row.swmm5.periods).toBe(2);
    expect(row.swmm5.category).toBe("review");

    const absent = calculateDiagnostic(INP, REPORT, REPORT, {
      dt: 5, rStar: 1, crownOnset: 0.9, openCrownOnset: 0.95, basis: "concurrent",
    });
    expect(absent.rows.find(item => item.name === "C1")?.swmm5.category).toBe("unknown");
  });

  it("does not call dry, malformed, or truncated concurrent evidence clear", () => {
    const series = `${REPORT}
****************
Link Results Time Series
****************
<<< C1 >>>
Date  Time  Flow  Depth  Velocity
Day  Hour:Min  CFS  ft  ft/sec
---------------------------------
01/01/2026  00:00  0.0  0.00  0.0
01/01/2026  00:05  0.0  bad  0.0
`;
    const settings = { dt: 5, rStar: 1, crownOnset: 0.9, openCrownOnset: 0.95, basis: "concurrent" as const };
    const partial = calculateDiagnostic(INP, series, series, settings);
    const row = partial.rows.find(item => item.name === "C1")!;
    expect(row.swmm5.category).toBe("unknown");
    expect(row.swmm5.concurrentEvidence).toBe("partial");

    const truncated = calculateDiagnostic(INP, `${series}\n; BATCHSWMM56_TIME_SERIES_TRUNCATED 1 2`, `${series}\n; BATCHSWMM56_TIME_SERIES_TRUNCATED 1 2`, settings);
    expect(truncated.rows.find(item => item.name === "C1")?.swmm5.category).toBe("unknown");

    const auto = calculateDiagnostic(INP, `${series}\n; BATCHSWMM56_TIME_SERIES_TRUNCATED 1 2`, `${series}\n; BATCHSWMM56_TIME_SERIES_TRUNCATED 1 2`, { ...settings, basis: "auto" });
    expect(auto.rows.find(item => item.name === "C1")?.swmm5.basis).toBe("summary");

    const complete = series.replace("bad", "0.10");
    const mixed = calculateDiagnostic(INP, complete, REPORT, { ...settings, basis: "auto" });
    expect(mixed.rows.find(item => item.name === "C1")?.swmm5.basis).toBe("concurrent");
    expect(mixed.rows.find(item => item.name === "C1")?.swmm6.basis).toBe("summary");
  });

  it("does not claim a clear paired result when one engine has no report row", () => {
    const result = calculateDiagnostic(INP, REPORT, REPORT.replace("C2                   CONDUIT", "C9                   CONDUIT"), {
      dt: 5,
      rStar: 1,
      crownOnset: 0.9,
      openCrownOnset: 0.95,
    });
    const c3 = result.rows.find(row => row.name === "C3")!;
    const c2 = result.rows.find(row => row.name === "C2")!;
    expect(c3.category).toBe("unknown");
    expect(c2.swmm6.source).toBe("missing-report");
    expect(c2.category).toBe("review");
    expect(result.coverage.pairedRows).toBe(1);
  });

  it("exports explicit statuses and escaped conduit names", () => {
    const result = calculateDiagnostic(INP, REPORT, REPORT, {
      dt: 5,
      rStar: 1,
      crownOnset: 0.9,
      openCrownOnset: 0.95,
    });
    const csv = diagnosticCsv(result.rows);
    expect(csv.split("\r\n")[0]).toContain("SWMM5 d/D");
    expect(csv).toContain("C1");
    expect(csv).toContain("missing");
    expect(csv).toContain(">50.00");
    expect(csv).toContain("censored");
  });

  it("warns when a report has no conduit IDs matching the INP", () => {
    const noMatch = REPORT.replace(/\bC1\b/g, "Z1").replace(/\bC2\b/g, "Z2");
    const result = calculateDiagnostic(INP, noMatch, noMatch, {
      dt: 5,
      rStar: 1,
      crownOnset: 0.9,
      openCrownOnset: 0.95,
    });
    expect(result.report5.warnings.join(" ")).toMatch(/no .*conduit IDs matched/i);
    expect(result.report6.warnings.join(" ")).toMatch(/no .*conduit IDs matched/i);
    expect(result.coverage.pairedRows).toBe(0);
  });

  it("refuses zero-overlap or unit-mismatched baseline/rerun pairs", () => {
    const noOverlap = checkDiagnosticPairing(INP, INP.replace(/\bC[123]\b/g, "Z9"), REPORT, REPORT);
    expect(noOverlap.compatible).toBe(false);
    expect(noOverlap.errors.join(" ")).toMatch(/no conduit IDs/i);
    const units = checkDiagnosticPairing(INP, INP.replace("FLOW_UNITS CFS", "FLOW_UNITS CMS"), REPORT, REPORT);
    expect(units.compatible).toBe(false);
    expect(units.errors.join(" ")).toMatch(/flow units differ/i);
    const changedGeometry = checkDiagnosticPairing(INP, INP.replace("C1 N1 N2 100", "C1 N1 N2 101"), REPORT, REPORT);
    expect(changedGeometry.compatible).toBe(false);
    expect(changedGeometry.errors.join(" ")).toMatch(/INP files differ/i);

    const siReportWithUsSeries = `${REPORT.replace("CFS", "CMS")}
****************
Link Results Time Series
****************
<<< C1 >>>
Date  Time  Flow  Depth  Velocity
Day  Hour:Min  CFS  ft  ft/sec
---------------------------------
01/01/2026  00:00  1.0  0.10  1.0`;
    const siInp = INP.replace("FLOW_UNITS CFS", "FLOW_UNITS CMS");
    const seriesUnits = checkDiagnosticPairing(siInp, siInp, siReportWithUsSeries, siReportWithUsSeries);
    expect(seriesUnits.compatible).toBe(false);
    expect(seriesUnits.errors.join(" ")).toMatch(/time-series units/i);
  });

  it("rejects invalid screening settings instead of allowing a false clear", () => {
    const valid = { rStar: 1, crownOnset: 0.9, openCrownOnset: 0.95 };
    expect(validateDiagnosticSettings({ ...valid, dt: undefined })).toEqual([]);
    const noFallback = calculateDiagnostic(INP.replace("ROUTING_STEP 7\n", ""), REPORT.replace("Analysis Options", "Other"), REPORT.replace("Analysis Options", "Other"), valid);
    expect(noFallback.rows[0].category).toBe("unknown");

    const invalidSettings = [
      { ...valid, dt: 0 },
      { ...valid, dt: -1 },
      { ...valid, dt: Number.NaN },
      { ...valid, rStar: 0 },
      { ...valid, rStar: -1 },
      { ...valid, rStar: Number.NaN },
      { ...valid, crownOnset: -0.01 },
      { ...valid, crownOnset: 1 },
      { ...valid, crownOnset: 1.01 },
      { ...valid, openCrownOnset: -0.01 },
      { ...valid, openCrownOnset: 1 },
      { ...valid, openCrownOnset: Number.NaN },
    ];
    for (const settings of invalidSettings) {
      const result = calculateDiagnostic(INP, REPORT, REPORT, settings);
      expect(result.settingsError).toBeTruthy();
      expect(result.rows.every(row => row.category === "unknown")).toBe(true);
      expect(result.rows.some(row => row.category === "clear")).toBe(false);
    }
  });

  it("accepts actual stable/dev engine report outputs when the checked-in engine cache is present", () => {
    const root = process.cwd();
    const inpPath = path.join(root, ".cache/oswmm-stable/python/tests/data/solver/site_drainage_example.inp");
    const stablePath = path.join(root, ".cache/oswmm-stable/python/tests/data/solver/site_drainage_example.rpt");
    const devPath = path.join(root, ".cache/oswmm-dev/python/tests/data/solver/site_drainage_example.rpt");
    if (!fs.existsSync(inpPath) || !fs.existsSync(stablePath) || !fs.existsSync(devPath)) return;
    const result = calculateDiagnostic(
      fs.readFileSync(inpPath, "utf8"),
      fs.readFileSync(stablePath, "utf8"),
      fs.readFileSync(devPath, "utf8"),
      { rStar: 1, crownOnset: 0.9, openCrownOnset: 0.95 },
    );
    expect(result.report5.hasLinkFlowSummary).toBe(true);
    expect(result.report6.hasLinkFlowSummary).toBe(true);
    expect(result.coverage.pairedRows).toBeGreaterThan(0);
  });

  it("parses the supplied real coherence fixture when the attached archive is available", () => {
    const archive = path.join(process.cwd(), "attached_assets", "batchswmm-coherence_1789022044557.zip");
    if (!fs.existsSync(archive)) return;
    const readFixture = (name: string) => execFileSync("unzip", ["-p", archive, `batchswmm-coherence/tests/fixtures/coherence/${name}`], { encoding: "utf8" });
    const result = calculateDiagnostic(readFixture("demo.inp"), readFixture("demo.rpt"), readFixture("demo.rpt"), {
      rStar: 1, crownOnset: 0.9, openCrownOnset: 0.95,
    });
    expect(result.report5.hasLinkFlowSummary).toBe(true);
    expect(result.coverage.pairedRows).toBeGreaterThan(0);
    expect(result.rows.some(row => row.name === "C3")).toBe(true);
  });

  it("screens real appended output through the app's SWMM output parser when supplied assets exist", () => {
    const archive = path.join(process.cwd(), "attached_assets", "batchswmm-coherence_1789022044557.zip");
    const parserPath = path.join(process.cwd(), "client", "public", "wasm", "swmm-out-parser.js");
    if (!fs.existsSync(archive) || !fs.existsSync(parserPath)) return;
    const readText = (name: string) => execFileSync("unzip", ["-p", archive, `batchswmm-coherence/tests/fixtures/coherence/${name}`], { encoding: "utf8" });
    const output = execFileSync("unzip", ["-p", archive, "batchswmm-coherence/tests/fixtures/coherence/demo_ts.out"]);
    const scope: Record<string, any> = {};
    new Function("self", fs.readFileSync(parserPath, "utf8"))(scope);
    const report = `${readText("demo.rpt")}\n${scope.SwmmOutParser.parseSwmmOutBinary(new Uint8Array(output.buffer, output.byteOffset, output.byteLength))}`;
    const result = calculateDiagnostic(readText("demo.inp"), report, report, {
      rStar: 1, crownOnset: 0.9, openCrownOnset: 0.95, basis: "concurrent",
    });
    expect(result.basis).toBe("concurrent");
    expect(result.rows.find(row => row.name === "C1")?.swmm5.concurrentEvidence).toBe("available");
    expect(result.rows.find(row => row.name === "C3")?.swmm5Diagnostics.timeStepCritical).toMatchObject({ status: "listed", value: 99.91 });
    expect(result.rows.find(row => row.name === "C1")?.swmm5Diagnostics.flowInstability.status).toBe("not-listed");
    expect(result.rows.find(row => row.name === "C1")?.swmm5Diagnostics.adjustedLength.value).toBeCloseTo(1);
  });
});