/**
 * Regression baseline: mark one completed run as BASELINE (persisted in
 * localStorage), then compare a later rerun of the same model against it —
 * Baseline vs Current vs Δ vs Δ% per metric with a PASS/FAIL verdict under a
 * configurable tolerance.
 *
 * Works for both server and browser (WASM) engines because all engines
 * normalize to the same ProcessResult shape; report-derived metrics (peak
 * outfall flow, max node depth) are parsed from the .rpt text when present.
 */
import type { ProcessResult } from "@shared/schema";

export interface RegressionMetrics {
  /** Surface runoff volume (report units, e.g. acre-feet or 10^6 ltr). */
  runoffVolume?: number;
  /** System max flow from the Outfall Loading Summary (falls back to results.peakFlow). */
  peakOutfallFlow?: number;
  /** Largest "Maximum Depth" across the Node Depth Summary. */
  maxNodeDepth?: number;
  /** Flow routing continuity error (%). */
  routingContinuityError?: number;
}

export const REGRESSION_METRIC_SPECS: {
  key: keyof RegressionMetrics;
  label: string;
  /**
   * How the tolerance applies: 'relative' compares |Δ%| against the tolerance;
   * 'absolute' compares |Δ| against it (used for continuity error, where a
   * relative % of a near-zero % is meaningless).
   */
  mode: 'relative' | 'absolute';
}[] = [
  { key: 'runoffVolume', label: 'Runoff volume', mode: 'relative' },
  { key: 'peakOutfallFlow', label: 'Peak outfall flow', mode: 'relative' },
  { key: 'maxNodeDepth', label: 'Max node depth', mode: 'relative' },
  { key: 'routingContinuityError', label: 'Routing continuity error (%)', mode: 'absolute' },
];

/** Parse the "System" (or single outfall) Max Flow from the Outfall Loading Summary. */
export function parsePeakOutfallFlow(report: string): number | undefined {
  const section = report.match(/Outfall Loading Summary\s*\*+([\s\S]*?)(?:\n\s*\*{3,}|$)/i);
  if (!section) return undefined;
  const body = section[1];
  // Prefer the System row: "System   72.87   2.71   19.58   1.914 ..."
  const system = body.match(/^\s*System\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/im);
  if (system) {
    const v = parseFloat(system[3]);
    return Number.isFinite(v) ? v : undefined;
  }
  // No System row (single outfall reports): take the max of per-outfall Max Flow.
  let max: number | undefined;
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*[^-\s]\S*\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/);
    if (!m) continue;
    const v = parseFloat(m[3]);
    if (Number.isFinite(v) && (max === undefined || v > max)) max = v;
  }
  return max;
}

/** Parse the largest Maximum Depth from the Node Depth Summary. */
export function parseMaxNodeDepth(report: string): number | undefined {
  const section = report.match(/Node Depth Summary\s*\*+([\s\S]*?)(?:\n\s*\*{3,}|$)/i);
  if (!section) return undefined;
  let max: number | undefined;
  for (const line of section[1].split('\n')) {
    // "9   JUNCTION   0.09   0.57   1000.57   0  04:01   0.57"
    const m = line.match(/^\s*\S+\s+(JUNCTION|OUTFALL|STORAGE|DIVIDER)\s+(-?[\d.]+)\s+(-?[\d.]+)/i);
    if (!m) continue;
    const v = parseFloat(m[3]);
    if (Number.isFinite(v) && (max === undefined || v > max)) max = v;
  }
  return max;
}

/** Extract the regression metric set from a completed result. */
export function extractRegressionMetrics(result: ProcessResult): RegressionMetrics {
  const m: RegressionMetrics = {};
  const pm = result.parsedMetrics;
  if (typeof pm?.surfaceRunoff === 'number') m.runoffVolume = pm.surfaceRunoff;
  if (typeof pm?.routingContinuityError === 'number') m.routingContinuityError = pm.routingContinuityError;
  const report = result.reportContent;
  if (report) {
    const peak = parsePeakOutfallFlow(report);
    if (peak !== undefined) m.peakOutfallFlow = peak;
    const depth = parseMaxNodeDepth(report);
    if (depth !== undefined) m.maxNodeDepth = depth;
  }
  if (m.peakOutfallFlow === undefined && typeof result.results?.peakFlow === 'number') {
    m.peakOutfallFlow = result.results.peakFlow;
  }
  return m;
}

export interface RegressionBaseline {
  fileName: string;
  savedAt: string;
  /** Id of the run this baseline was captured from — a rerun of the same
   * model gets a new id, so self-comparisons can be suppressed. */
  sourceResultId?: string;
  engine?: string;
  engineVersion?: string;
  metrics: RegressionMetrics;
}

/**
 * Build a baseline from a completed result. For server light summaries
 * (hasReport set, text stored separately) the report is fetched via
 * `fetchContent` and merged *directly into the result used for extraction* —
 * never rely on parent state having updated in the same tick.
 */
export async function buildBaselineFromResult(
  result: ProcessResult,
  fetchContent?: (resultId: string) => Promise<{ reportContent?: string } | null | undefined | void>,
): Promise<RegressionBaseline> {
  let source = result;
  if (!source.reportContent && source.hasReport && fetchContent) {
    try {
      const content = await fetchContent(result.id);
      if (content && typeof content === 'object' && content.reportContent) {
        source = { ...result, reportContent: content.reportContent };
      }
    } catch {
      // fall back to summary metrics only
    }
  }
  return {
    fileName: result.fileName,
    savedAt: new Date().toISOString(),
    sourceResultId: result.id,
    engine: result.provenance?.actualEngine ?? result.provenance?.requestedEngine,
    engineVersion: result.provenance?.engineVersion,
    metrics: extractRegressionMetrics(source),
  };
}

export interface BaselineComparison extends RegressionVerdict {
  result: ProcessResult;
  baseline: RegressionBaseline;
}

/**
 * Pick the results that should show a regression table: successful runs with
 * a saved baseline for the same model, excluding the exact run the baseline
 * was captured from (a baseline trivially "passing" against itself proves
 * nothing about drift).
 */
export function selectComparisons(
  results: ProcessResult[],
  baselines: Record<string, RegressionBaseline>,
  tolerancePct: number,
): BaselineComparison[] {
  const out: BaselineComparison[] = [];
  for (const result of results) {
    if (result.status !== 'success') continue;
    const baseline = baselines[result.fileName];
    if (!baseline) continue;
    if (baseline.sourceResultId !== undefined && baseline.sourceResultId === result.id) continue;
    const current = extractRegressionMetrics(result);
    out.push({ result, baseline, ...compareToBaseline(baseline.metrics, current, tolerancePct) });
  }
  return out;
}

const STORAGE_KEY = 'swmm-regression-baselines';

export function loadBaselines(): Record<string, RegressionBaseline> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveBaseline(baseline: RegressionBaseline): void {
  const all = loadBaselines();
  all[baseline.fileName] = baseline;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // storage full/unavailable — surfacing is the caller's concern
  }
}

export function removeBaseline(fileName: string): void {
  const all = loadBaselines();
  delete all[fileName];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
}

export function getBaseline(fileName: string): RegressionBaseline | undefined {
  return loadBaselines()[fileName];
}

export interface RegressionRow {
  key: keyof RegressionMetrics;
  label: string;
  baseline?: number;
  current?: number;
  /** current - baseline (undefined when either side is missing). */
  delta?: number;
  /** Δ as a percent of baseline (undefined for absolute-mode metrics or zero baseline). */
  deltaPct?: number;
  /** undefined = not comparable (a side is missing). */
  pass?: boolean;
}

export interface RegressionVerdict {
  rows: RegressionRow[];
  /** 'pass' | 'fail' | 'inconclusive' (nothing comparable). */
  verdict: 'pass' | 'fail' | 'inconclusive';
  tolerancePct: number;
}

/**
 * Compare current metrics to a baseline under one tolerance (percent).
 * Relative metrics fail when |Δ%| > tolerance; the continuity-error metric
 * fails when |Δ| (percentage points) > tolerance.
 */
export function compareToBaseline(
  baseline: RegressionMetrics,
  current: RegressionMetrics,
  tolerancePct: number,
): RegressionVerdict {
  const tol = Number.isFinite(tolerancePct) && tolerancePct >= 0 ? tolerancePct : 5;
  const rows: RegressionRow[] = REGRESSION_METRIC_SPECS.map(spec => {
    const b = baseline[spec.key];
    const c = current[spec.key];
    const row: RegressionRow = { key: spec.key, label: spec.label, baseline: b, current: c };
    if (typeof b !== 'number' || typeof c !== 'number') return row;
    row.delta = c - b;
    if (spec.mode === 'relative') {
      if (Math.abs(b) > 1e-12) {
        row.deltaPct = (row.delta / Math.abs(b)) * 100;
        row.pass = Math.abs(row.deltaPct) <= tol;
      } else {
        // Zero baseline: any nonzero current value is a change we can't scale.
        row.pass = Math.abs(row.delta) <= 1e-12;
      }
    } else {
      row.pass = Math.abs(row.delta) <= tol;
    }
    return row;
  });

  const comparable = rows.filter(r => r.pass !== undefined);
  const verdict: RegressionVerdict['verdict'] =
    comparable.length === 0 ? 'inconclusive'
    : comparable.every(r => r.pass) ? 'pass'
    : 'fail';
  return { rows, verdict, tolerancePct: tol };
}
