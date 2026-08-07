import { describe, it, expect } from "vitest";
import { buildComparison, type EngineRun } from "../client/src/lib/engineComparison";
import type { ProcessResult } from "../shared/schema";

function res(overrides: Partial<ProcessResult> & { fileName: string }): ProcessResult {
  return {
    id: `${overrides.fileName}-${Math.random().toString(36).slice(2, 8)}`,
    filePath: overrides.fileName,
    status: 'success',
    ...overrides,
  } as ProcessResult;
}

function run(engine: EngineRun['engine'], results: ProcessResult[]): EngineRun {
  return { engine, label: engine, jobId: null, results };
}

describe("buildComparison", () => {
  it("marks files as matching when metrics agree within tolerance", () => {
    const a = res({ fileName: "m1.inp", parsedMetrics: { runoffContinuityError: 0.01, totalInflow: 100.0 } });
    const b = res({ fileName: "m1.inp", parsedMetrics: { runoffContinuityError: 0.02, totalInflow: 100.2 } });
    const summary = buildComparison([run('executable', [a]), run('wasm', [b])]);
    expect(summary.files).toHaveLength(1);
    expect(summary.files[0].verdict).toBe('match');
    expect(summary.matchCount).toBe(1);
  });

  it("flags metric differences beyond tolerance", () => {
    const a = res({ fileName: "m1.inp", parsedMetrics: { routingContinuityError: 0.1, totalOutflow: 50 } });
    const b = res({ fileName: "m1.inp", parsedMetrics: { routingContinuityError: 4.8, totalOutflow: 62 } });
    const summary = buildComparison([run('executable', [a]), run('wasm6', [b])]);
    const file = summary.files[0];
    expect(file.verdict).toBe('differs');
    const routing = file.metrics.find(m => m.key === 'routingContinuityError')!;
    expect(routing.differs).toBe(true);
    expect(routing.maxDelta).toBeCloseTo(4.7);
    const outflow = file.metrics.find(m => m.key === 'totalOutflow')!;
    expect(outflow.differs).toBe(true);
  });

  it("flags status mismatches (one engine fails, another succeeds)", () => {
    const ok = res({ fileName: "m1.inp" });
    const bad = res({ fileName: "m1.inp", status: 'failed', error: 'ERROR 200' });
    const summary = buildComparison([run('executable', [ok]), run('wasm', [bad])]);
    expect(summary.files[0].verdict).toBe('status-mismatch');
    expect(summary.statusMismatchCount).toBe(1);
  });

  it("treats a file missing from one engine as a status mismatch", () => {
    const a = res({ fileName: "m1.inp" });
    const b = res({ fileName: "m2.inp" });
    const summary = buildComparison([run('executable', [a]), run('wasm', [a, b])]);
    const m2 = summary.files.find(f => f.fileName === "m2.inp")!;
    expect(m2.verdict).toBe('status-mismatch');
    expect(m2.statuses).toContain('missing');
  });

  it("does not let warning counts or run time affect the verdict", () => {
    const a = res({ fileName: "m1.inp", processingTime: 1.2, parsedMetrics: { reportWarnings: ["W1", "W2"], totalInflow: 10 } });
    const b = res({ fileName: "m1.inp", processingTime: 9.5, parsedMetrics: { reportWarnings: [], totalInflow: 10 } });
    const summary = buildComparison([run('api', [a]), run('wasm', [b])]);
    expect(summary.files[0].verdict).toBe('match');
    const warnings = summary.files[0].metrics.find(m => m.key === 'warningCount')!;
    expect(warnings.values).toEqual([2, 0]);
  });

  it("compares nodesFlooded exactly", () => {
    const a = res({ fileName: "m1.inp", parsedMetrics: { nodesFlooded: 3 } });
    const b = res({ fileName: "m1.inp", parsedMetrics: { nodesFlooded: 4 } });
    const summary = buildComparison([run('executable', [a]), run('wasm', [b])]);
    expect(summary.files[0].verdict).toBe('differs');
  });

  it("marks successful runs with no comparable metrics as inconclusive, not matching", () => {
    const a = res({ fileName: "m1.inp" });
    const b = res({ fileName: "m1.inp" });
    const summary = buildComparison([run('executable', [a]), run('wasm', [b])]);
    expect(summary.files[0].verdict).toBe('inconclusive');
    expect(summary.inconclusiveCount).toBe(1);
    expect(summary.matchCount).toBe(0);
  });

  it("aligns duplicate file names by occurrence instead of collapsing them", () => {
    const mk = (inflow: number) => res({ fileName: "dup.inp", parsedMetrics: { totalInflow: inflow } });
    const summary = buildComparison([
      run('executable', [mk(10), mk(99)]),
      run('wasm', [mk(10), mk(50)]),
    ]);
    expect(summary.files).toHaveLength(2);
    expect(summary.files[0].verdict).toBe('match');
    expect(summary.files[1].verdict).toBe('differs');
    expect(summary.files[1].fileName).toBe('dup.inp (2)');
  });

  it("preserves file order across runs and handles 3+ engines", () => {
    const mk = (name: string, inflow: number) => res({ fileName: name, parsedMetrics: { totalInflow: inflow } });
    const summary = buildComparison([
      run('executable', [mk("a.inp", 1), mk("b.inp", 2)]),
      run('wasm', [mk("a.inp", 1), mk("b.inp", 2)]),
      run('wasm6', [mk("a.inp", 1), mk("b.inp", 2.5)]),
    ]);
    expect(summary.files.map(f => f.fileName)).toEqual(["a.inp", "b.inp"]);
    expect(summary.files[0].verdict).toBe('match');
    expect(summary.files[1].verdict).toBe('differs');
    expect(summary.engines).toHaveLength(3);
  });
});
