import type { ProcessResult, ParsedMetrics } from "@shared/schema";
import type { ParsedTimeSeries } from "./parseTimeSeries";

/** Engine ids the UI can select. */
export type EngineId = 'executable' | 'api' | 'wasm' | 'wasm6' | 'wasm6dev';

/** WASM engine variant to load for a UI engine mode (browser paths only). */
export function wasmEngineForMode(mode: EngineId): 'swmm5' | 'swmm6' | 'swmm6dev' {
  return mode === 'wasm6' ? 'swmm6' : mode === 'wasm6dev' ? 'swmm6dev' : 'swmm5';
}

export const ENGINE_LABELS: Record<EngineId, string> = {
  executable: 'Executable',
  api: 'SWMM5 API',
  wasm: 'SWMM5 WASM',
  wasm6: 'SWMM6 WASM',
  wasm6dev: 'SWMM6 WASM (develop)',
};

/** One engine's completed batch. */
export interface EngineRun {
  engine: EngineId;
  label: string;
  /** Server batch job id (null for browser engines). */
  jobId: string | null;
  results: ProcessResult[];
}

export interface MetricComparison {
  key: keyof ParsedMetrics | 'processingTime' | 'warningCount' | 'errorCount';
  label: string;
  /** Value per engine, aligned with the runs array order. undefined = missing. */
  values: (number | undefined)[];
  /** True when at least two present values disagree beyond tolerance. */
  differs: boolean;
  /** Max absolute difference between present values. */
  maxDelta: number | undefined;
}

export interface FileComparison {
  fileName: string;
  /** Result per engine, aligned with runs order; undefined if engine has no result for this file. */
  results: (ProcessResult | undefined)[];
  statuses: (ProcessResult['status'] | 'missing')[];
  statusMismatch: boolean;
  metrics: MetricComparison[];
  /**
   * Overall verdict for the file. 'inconclusive' means statuses agree but no
   * numeric metric could be compared across at least two engines — agreement
   * cannot be claimed.
   */
  verdict: 'match' | 'differs' | 'status-mismatch' | 'inconclusive';
}

export interface ComparisonSummary {
  engines: { engine: EngineId; label: string }[];
  /** Per engine (aligned with engines order): how many files succeeded, failed, or had no result. */
  engineStatusCounts: { success: number; failed: number; missing: number }[];
  files: FileComparison[];
  matchCount: number;
  differCount: number;
  statusMismatchCount: number;
  inconclusiveCount: number;
}

const NUMERIC_METRICS: { key: keyof ParsedMetrics; label: string; tolerance: number; relative?: boolean }[] = [
  { key: 'runoffContinuityError', label: 'Runoff continuity error (%)', tolerance: 0.05 },
  { key: 'routingContinuityError', label: 'Flow routing continuity error (%)', tolerance: 0.05 },
  { key: 'totalPrecipitation', label: 'Total precipitation', tolerance: 0.001, relative: true },
  { key: 'surfaceRunoff', label: 'Surface runoff', tolerance: 0.005, relative: true },
  { key: 'totalInflow', label: 'Total inflow', tolerance: 0.005, relative: true },
  { key: 'totalOutflow', label: 'Total outflow', tolerance: 0.005, relative: true },
  { key: 'floodingLoss', label: 'Flooding loss', tolerance: 0.005, relative: true },
  { key: 'nodesFlooded', label: 'Nodes flooded', tolerance: 0 },
];

function valuesDiffer(values: (number | undefined)[], tolerance: number, relative: boolean): { differs: boolean; maxDelta: number | undefined } {
  const present = values.filter((v): v is number => v !== undefined && Number.isFinite(v));
  if (present.length < 2) return { differs: false, maxDelta: undefined };
  const min = Math.min(...present);
  const max = Math.max(...present);
  const delta = max - min;
  if (relative) {
    const scale = Math.max(Math.abs(min), Math.abs(max), 1e-9);
    return { differs: delta / scale > tolerance, maxDelta: delta };
  }
  return { differs: delta > tolerance, maxDelta: delta };
}

/**
 * Align results by file name across engine runs and flag differences.
 * Warning/error *counts* are compared loosely (engines word messages
 * differently) and never flip the verdict on their own.
 */
export function buildComparison(runs: EngineRun[]): ComparisonSummary {
  const engines = runs.map(r => ({ engine: r.engine, label: r.label }));

  // Duplicate base names are possible (e.g. same-named models from different
  // folders), so align by (fileName, occurrence index within the run) instead
  // of collapsing duplicates onto the first match.
  const keyed = runs.map(run => {
    const counts = new Map<string, number>();
    const byKey = new Map<string, ProcessResult>();
    for (const res of run.results) {
      const n = counts.get(res.fileName) ?? 0;
      counts.set(res.fileName, n + 1);
      byKey.set(`${res.fileName}\u0000${n}`, res);
    }
    return byKey;
  });

  // Preserve first-seen key order across all runs.
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const byKey of keyed) {
    for (const key of byKey.keys()) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }

  const files: FileComparison[] = keys.map(key => {
    const [baseName, occStr] = key.split('\u0000');
    const occurrence = Number(occStr);
    const fileName = occurrence > 0 ? `${baseName} (${occurrence + 1})` : baseName;
    const results = keyed.map(byKey => byKey.get(key));
    const statuses = results.map(r => (r ? r.status : 'missing' as const));
    const presentStatuses = statuses.filter(s => s !== 'missing');
    const statusMismatch = new Set(presentStatuses).size > 1 || statuses.includes('missing');

    const metrics: MetricComparison[] = [];
    for (const spec of NUMERIC_METRICS) {
      const values = results.map(r => {
        const v = r?.parsedMetrics?.[spec.key];
        return typeof v === 'number' ? v : undefined;
      });
      const { differs, maxDelta } = valuesDiffer(values, spec.tolerance, !!spec.relative);
      metrics.push({ key: spec.key, label: spec.label, values, differs, maxDelta });
    }
    // Informational rows (never affect the verdict).
    const warnValues = results.map(r => r?.parsedMetrics?.reportWarnings?.length);
    metrics.push({
      key: 'warningCount', label: 'Warnings (count)', values: warnValues,
      differs: false, maxDelta: undefined,
    });
    const errValues = results.map(r => r?.parsedMetrics?.reportErrors?.length);
    metrics.push({
      key: 'errorCount', label: 'Report errors (count)', values: errValues,
      differs: false, maxDelta: undefined,
    });
    metrics.push({
      key: 'processingTime', label: 'Run time (s)',
      values: results.map(r => r?.processingTime),
      differs: false, maxDelta: undefined,
    });

    const anyMetricDiffers = metrics.some(m => m.differs);
    // A "match" requires actual comparable evidence: at least one numeric
    // metric present from two or more engines. Otherwise the comparison is
    // inconclusive, not an agreement.
    const numericMetricKeys = new Set(NUMERIC_METRICS.map(s => s.key as string));
    const anyComparable = metrics.some(m =>
      numericMetricKeys.has(m.key as string) &&
      m.values.filter(v => v !== undefined && Number.isFinite(v)).length >= 2
    );
    const verdict: FileComparison['verdict'] = statusMismatch
      ? 'status-mismatch'
      : anyMetricDiffers ? 'differs'
      : anyComparable ? 'match'
      : 'inconclusive';

    return { fileName, results, statuses, statusMismatch, metrics, verdict };
  });

  const engineStatusCounts = engines.map((_, i) => {
    const counts = { success: 0, failed: 0, missing: 0 };
    for (const f of files) {
      const s = f.statuses[i];
      if (s === 'success') counts.success++;
      else if (s === 'missing') counts.missing++;
      else counts.failed++;
    }
    return counts;
  });

  return {
    engines,
    engineStatusCounts,
    files,
    matchCount: files.filter(f => f.verdict === 'match').length,
    differCount: files.filter(f => f.verdict === 'differs').length,
    statusMismatchCount: files.filter(f => f.verdict === 'status-mismatch').length,
    inconclusiveCount: files.filter(f => f.verdict === 'inconclusive').length,
  };
}

/** Parse a "MM/DD/YYYY HH:MM[:SS]" report timestamp into epoch millis (NaN if malformed). */
export function parseReportTimestamp(time: string): number {
  const m = time.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return NaN;
  return Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), Number(m[4]), Number(m[5]), Number(m[6] || 0));
}

/**
 * Merge one metric from several engines' system time series onto a single,
 * chronologically sorted time axis. Engines with different report steps keep
 * their own sample points; rows where an engine has no sample simply omit
 * that engine's key (rendered as a gap, not interpolated).
 */
export function mergeSystemSeries(
  entries: Array<{ label: string; series: ParsedTimeSeries | null }>,
  metric: string,
): Array<Record<string, number | string>> {
  const byTime = new Map<string, Record<string, number | string>>();
  for (const e of entries) {
    if (!e.series) continue;
    const ci = e.series.columns.indexOf(metric);
    if (ci === -1) continue;
    for (const d of e.series.data) {
      if (!byTime.has(d.time)) byTime.set(d.time, { time: d.time });
      byTime.get(d.time)![e.label] = d.values[ci];
    }
  }
  return Array.from(byTime.values()).sort(
    (a, b) => parseReportTimestamp(a.time as string) - parseReportTimestamp(b.time as string),
  );
}
