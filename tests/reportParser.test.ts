import { describe, it, expect } from "vitest";
import {
  parseReportMetrics,
  extractReportIssues,
  extractEngineVersion,
  validateSwmmReport,
  MAX_REPORT_ISSUES,
} from "../server/reportParser";

const SAMPLE_REPORT = `
  EPA STORM WATER MANAGEMENT MODEL - VERSION 5.2 (Build 5.2.4)
  --------------------------------------------------------------

  WARNING 03: negative offset ignored for Link C2
  WARNING 08: elevation drop exceeds length for Conduit C7

  Flow Routing Method ...... KINWAVE
  Infiltration Method ...... HORTON

  **************************        Volume         Depth
  Runoff Quantity Continuity     acre-feet        inches
  **************************     ---------       -------
  Total Precipitation ......         2.917         7.000
  Surface Runoff ...........         1.310         3.144
  Continuity Error (%) .....        -0.297

  **************************        Volume        Volume
  Flow Routing Continuity        acre-feet      10^6 gal
  **************************     ---------     ---------
  Wet Weather Inflow .......         1.310         0.427
  External Outflow .........         1.303         0.425
  Flooding Loss ............         0.012         0.004
  Continuity Error (%) .....         0.406

  No nodes were flooded.
`;

describe("parseReportMetrics", () => {
  it("extracts continuity errors including negative values", () => {
    const m = parseReportMetrics(SAMPLE_REPORT);
    expect(m.runoffContinuityError).toBeCloseTo(-0.297, 5);
    expect(m.routingContinuityError).toBeCloseTo(0.406, 5);
  });

  it("extracts volumes and methods", () => {
    const m = parseReportMetrics(SAMPLE_REPORT);
    expect(m.totalPrecipitation).toBeCloseTo(2.917, 5);
    expect(m.surfaceRunoff).toBeCloseTo(1.31, 5);
    expect(m.totalInflow).toBeCloseTo(1.31, 5);
    expect(m.totalOutflow).toBeCloseTo(1.303, 5);
    expect(m.floodingLoss).toBeCloseTo(0.012, 5);
    expect(m.flowRoutingMethod).toBe("KINWAVE");
    expect(m.infiltrationMethod).toBe("HORTON");
  });

  it("detects no flooding", () => {
    const m = parseReportMetrics(SAMPLE_REPORT);
    expect(m.nodesFlooded).toBe(0);
    expect(m.floodingSummary).toBe("No flooding");
  });

  it("detects flooded nodes count", () => {
    const m = parseReportMetrics("Flooding was detected at 3 nodes.");
    expect(m.nodesFlooded).toBe(3);
    expect(m.floodingSummary).toBe("3 node(s) flooded");
  });

  it("omits runoff continuity error for routing-only reports", () => {
    const routingOnly = SAMPLE_REPORT.replace(/Runoff Quantity Continuity[\s\S]*?Continuity Error \(%\) \.+\s*-0\.297/, "");
    const m = parseReportMetrics(routingOnly);
    expect(m.runoffContinuityError).toBeUndefined();
    expect(m.routingContinuityError).toBeCloseTo(0.406, 5);
  });

  it("includes warnings in metrics", () => {
    const m = parseReportMetrics(SAMPLE_REPORT);
    expect(m.reportWarnings).toHaveLength(2);
    expect(m.reportWarnings![0]).toMatch(/^WARNING 03/);
    expect(m.reportErrors).toBeUndefined();
  });
});

describe("extractReportIssues", () => {
  it("separates warnings and errors, ignoring mid-line matches", () => {
    const report = [
      "WARNING 01: something",
      "  ERROR 200: bad input",
      "This line mentions WARNING but not at start... no wait it must start the line",
      "note: an ERROR in the middle is not counted",
    ].join("\n");
    const { warnings, errors } = extractReportIssues(report);
    expect(warnings).toEqual(["WARNING 01: something"]);
    expect(errors).toEqual(["ERROR 200: bad input"]);
  });

  it("does not match words merely starting with WARNING/ERROR prefix boundaries", () => {
    const { warnings, errors } = extractReportIssues("WARNINGS summary\nERRORS overview");
    expect(warnings).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("caps each list at MAX_REPORT_ISSUES", () => {
    const lines: string[] = [];
    for (let i = 0; i < MAX_REPORT_ISSUES + 50; i++) {
      lines.push(`WARNING ${i}: w`);
      lines.push(`ERROR ${i}: e`);
    }
    const { warnings, errors } = extractReportIssues(lines.join("\n"));
    expect(warnings).toHaveLength(MAX_REPORT_ISSUES);
    expect(errors).toHaveLength(MAX_REPORT_ISSUES);
  });
});

describe("extractEngineVersion", () => {
  it("prefers the build number when present", () => {
    expect(extractEngineVersion(SAMPLE_REPORT)).toBe("5.2.4");
  });
  it("falls back to the version when no build", () => {
    expect(extractEngineVersion("EPA STORM WATER MANAGEMENT MODEL - VERSION 5.1.15")).toBe("5.1.15");
  });
  it("returns undefined when no header", () => {
    expect(extractEngineVersion("nothing here")).toBeUndefined();
  });
});

describe("validateSwmmReport", () => {
  it("rejects empty or missing report", () => {
    expect(validateSwmmReport(undefined).valid).toBe(false);
    expect(validateSwmmReport("").valid).toBe(false);
    expect(validateSwmmReport("   \n  ").valid).toBe(false);
  });

  it("rejects a report without the EPA SWMM header", () => {
    const r = validateSwmmReport("some random text output");
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/missing the SWMM engine header/);
  });

  it("rejects a report containing ERROR lines", () => {
    const r = validateSwmmReport("EPA STORM WATER MANAGEMENT MODEL - VERSION 5.2\nERROR 233: bad node");
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/ERROR 233/);
  });

  it("accepts a valid report with warnings only", () => {
    expect(validateSwmmReport(SAMPLE_REPORT).valid).toBe(true);
  });
});
