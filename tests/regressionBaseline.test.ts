import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  parsePeakOutfallFlow,
  parseMaxNodeDepth,
  extractRegressionMetrics,
  compareToBaseline,
  buildBaselineFromResult,
  selectComparisons,
  type RegressionBaseline,
} from "../client/src/lib/regressionBaseline";
import type { ProcessResult } from "../shared/schema";

const rpt = readFileSync(join(__dirname, "fixtures", "example1-summary.rpt"), "utf-8");

describe("report parsing for regression metrics", () => {
  it("parses the System max flow from the Outfall Loading Summary", () => {
    expect(parsePeakOutfallFlow(rpt)).toBeCloseTo(19.58, 2);
  });

  it("parses the largest Maximum Depth from the Node Depth Summary", () => {
    expect(parseMaxNodeDepth(rpt)).toBeCloseTo(3.0, 2);
  });

  it("falls back to per-outfall max flow when no System row exists", () => {
    const single = [
      "  ***********************",
      "  Outfall Loading Summary",
      "  ***********************",
      "",
      "  -----------------------------------------------",
      "                         Flow       Avg       Max",
      "  Outfall Node           Pcnt       CFS       CFS",
      "  -----------------------------------------------",
      "  OUT1                  50.00      1.20      7.75",
      "",
      "  ********************",
    ].join("\n");
    expect(parsePeakOutfallFlow(single)).toBeCloseTo(7.75, 2);
  });

  it("returns undefined when sections are absent", () => {
    expect(parsePeakOutfallFlow("no such section")).toBeUndefined();
    expect(parseMaxNodeDepth("no such section")).toBeUndefined();
  });
});

describe("extractRegressionMetrics", () => {
  const base: ProcessResult = {
    id: "1",
    fileName: "example1.inp",
    filePath: "/tmp/example1.inp",
    status: "success",
    reportContent: rpt,
    parsedMetrics: { surfaceRunoff: 6.295, routingContinuityError: 0.13 },
    results: { peakFlow: 18.28 },
  };

  it("pulls all four metrics when the report is present", () => {
    const m = extractRegressionMetrics(base);
    expect(m.runoffVolume).toBeCloseTo(6.295, 3);
    expect(m.routingContinuityError).toBeCloseTo(0.13, 2);
    expect(m.peakOutfallFlow).toBeCloseTo(19.58, 2);
    expect(m.maxNodeDepth).toBeCloseTo(3.0, 2);
  });

  it("falls back to results.peakFlow when there is no report text", () => {
    const m = extractRegressionMetrics({ ...base, reportContent: undefined });
    expect(m.peakOutfallFlow).toBeCloseTo(18.28, 2);
    expect(m.maxNodeDepth).toBeUndefined();
  });
});

describe("compareToBaseline", () => {
  const baseline = {
    runoffVolume: 6.295,
    peakOutfallFlow: 19.58,
    maxNodeDepth: 3.0,
    routingContinuityError: 0.13,
  };

  it("passes when everything is within tolerance", () => {
    const current = {
      runoffVolume: 6.30,
      peakOutfallFlow: 19.60,
      maxNodeDepth: 3.01,
      routingContinuityError: 0.15,
    };
    const v = compareToBaseline(baseline, current, 5);
    expect(v.verdict).toBe("pass");
    expect(v.rows).toHaveLength(4);
    for (const row of v.rows) expect(row.pass).toBe(true);
    const runoff = v.rows.find(r => r.key === "runoffVolume")!;
    expect(runoff.delta).toBeCloseTo(0.005, 4);
    expect(runoff.deltaPct).toBeCloseTo(0.0794, 3);
  });

  it("fails when a relative metric drifts past tolerance", () => {
    const current = { ...baseline, peakOutfallFlow: 22.0 }; // ~12.4% drift
    const v = compareToBaseline(baseline, current, 5);
    expect(v.verdict).toBe("fail");
    expect(v.rows.find(r => r.key === "peakOutfallFlow")!.pass).toBe(false);
  });

  it("compares continuity error by absolute delta, not relative", () => {
    // 0.13 -> 0.20 is +54% relative but only 0.07 percentage points.
    const current = { ...baseline, routingContinuityError: 0.20 };
    const v = compareToBaseline(baseline, current, 5);
    expect(v.verdict).toBe("pass");
    // But a jump past the tolerance in absolute points fails.
    const bad = compareToBaseline(baseline, { ...baseline, routingContinuityError: 6.0 }, 5);
    expect(bad.verdict).toBe("fail");
  });

  it("skips missing metrics and stays comparable on the rest", () => {
    const current = { runoffVolume: 6.295, routingContinuityError: 0.13 };
    const v = compareToBaseline(baseline, current, 5);
    expect(v.verdict).toBe("pass");
    expect(v.rows.find(r => r.key === "maxNodeDepth")!.pass).toBeUndefined();
  });

  it("is inconclusive when nothing is comparable", () => {
    const v = compareToBaseline({}, baseline, 5);
    expect(v.verdict).toBe("inconclusive");
  });

  it("handles a zero baseline without dividing by zero", () => {
    const v = compareToBaseline({ runoffVolume: 0 }, { runoffVolume: 0.5 }, 5);
    const row = v.rows.find(r => r.key === "runoffVolume")!;
    expect(row.deltaPct).toBeUndefined();
    expect(row.pass).toBe(false);
    const same = compareToBaseline({ runoffVolume: 0 }, { runoffVolume: 0 }, 5);
    expect(same.rows.find(r => r.key === "runoffVolume")!.pass).toBe(true);
  });

  it("falls back to a sane tolerance on garbage input", () => {
    const v = compareToBaseline(baseline, baseline, NaN);
    expect(v.tolerancePct).toBe(5);
    expect(v.verdict).toBe("pass");
  });
});

describe("buildBaselineFromResult", () => {
  const lightSummary: ProcessResult = {
    id: "srv-1",
    fileName: "example1.inp",
    filePath: "/tmp/example1.inp",
    status: "success",
    hasReport: true, // server light summary: report text stored separately
    parsedMetrics: { surfaceRunoff: 6.295, routingContinuityError: 0.13 },
    results: { peakFlow: 18.28 },
    provenance: { requestedEngine: "executable", actualEngine: "executable", engineVersion: "5.2.4" },
  };

  it("fetches the report and captures all four metrics for a server light summary", async () => {
    // Simulate the real flow: fetch resolves after a delay and parent state
    // would update even later — the builder must use the returned content.
    const fetchContent = async (resultId: string) => {
      expect(resultId).toBe("srv-1");
      await new Promise(r => setTimeout(r, 10));
      return { reportContent: rpt };
    };
    const b = await buildBaselineFromResult(lightSummary, fetchContent);
    expect(b.fileName).toBe("example1.inp");
    expect(b.sourceResultId).toBe("srv-1");
    expect(b.engine).toBe("executable");
    expect(b.metrics.runoffVolume).toBeCloseTo(6.295, 3);
    expect(b.metrics.peakOutfallFlow).toBeCloseTo(19.58, 2); // report-derived, not the 18.28 fallback
    expect(b.metrics.maxNodeDepth).toBeCloseTo(3.0, 2);
    expect(b.metrics.routingContinuityError).toBeCloseTo(0.13, 2);
  });

  it("falls back to summary metrics when the fetch fails", async () => {
    const b = await buildBaselineFromResult(lightSummary, async () => { throw new Error("network"); });
    expect(b.metrics.runoffVolume).toBeCloseTo(6.295, 3);
    expect(b.metrics.peakOutfallFlow).toBeCloseTo(18.28, 2); // results.peakFlow fallback
    expect(b.metrics.maxNodeDepth).toBeUndefined();
  });

  it("does not fetch when the report text is already present", async () => {
    let called = false;
    const withReport = { ...lightSummary, reportContent: rpt };
    const b = await buildBaselineFromResult(withReport, async () => { called = true; return null; });
    expect(called).toBe(false);
    expect(b.metrics.maxNodeDepth).toBeCloseTo(3.0, 2);
  });
});

describe("selectComparisons", () => {
  const result = (id: string, fileName = "example1.inp"): ProcessResult => ({
    id,
    fileName,
    filePath: `/tmp/${fileName}`,
    status: "success",
    reportContent: rpt,
    parsedMetrics: { surfaceRunoff: 6.295, routingContinuityError: 0.13 },
  });
  const baselineFor = (sourceResultId: string): RegressionBaseline => ({
    fileName: "example1.inp",
    savedAt: "2026-08-11T00:00:00Z",
    sourceResultId,
    metrics: { runoffVolume: 6.295, peakOutfallFlow: 19.58, maxNodeDepth: 3.0, routingContinuityError: 0.13 },
  });

  it("excludes the run the baseline was captured from (no self-PASS)", () => {
    const comps = selectComparisons([result("srv-1")], { "example1.inp": baselineFor("srv-1") }, 5);
    expect(comps).toHaveLength(0);
  });

  it("compares a distinct rerun of the same model", () => {
    const comps = selectComparisons([result("srv-2")], { "example1.inp": baselineFor("srv-1") }, 5);
    expect(comps).toHaveLength(1);
    expect(comps[0].verdict).toBe("pass");
  });

  it("skips failed runs and files without a baseline", () => {
    const failed = { ...result("srv-3"), status: "failed" as const };
    const other = result("srv-4", "other.inp");
    const comps = selectComparisons([failed, other], { "example1.inp": baselineFor("srv-1") }, 5);
    expect(comps).toHaveLength(0);
  });
});
