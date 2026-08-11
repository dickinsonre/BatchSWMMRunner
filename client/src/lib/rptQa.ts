/**
 * Batch QA helpers: classify each run PASS / PASS WITH WARNINGS / REVIEW /
 * FAIL, compute a 0-100 "health score", and flag statistical outliers across
 * a batch. Thresholds are user-configurable heuristics, not EPA criteria.
 */

export interface QaThresholds {
  /** Continuity error (%) above which a run gets a warning. */
  ceWarn: number;
  /** Continuity error (%) above which a run needs review. */
  ceReview: number;
}

export const DEFAULT_QA_THRESHOLDS: QaThresholds = { ceWarn: 1, ceReview: 3 };

export interface QaInput {
  status: 'success' | 'failed' | 'cancelled' | 'timeout';
  runoffCE?: number;
  routingCE?: number;
  nodesFlooded?: number;
  warningCount: number;
  errorCount: number;
}

export type QaClass = 'PASS' | 'PASS WITH WARNINGS' | 'REVIEW' | 'FAIL' | 'INCOMPLETE';

/** Clamp thresholds to sane values: finite, non-negative, warn <= review. */
export function normalizeThresholds(t: QaThresholds): QaThresholds {
  const warn = Number.isFinite(t.ceWarn) && t.ceWarn >= 0 ? t.ceWarn : DEFAULT_QA_THRESHOLDS.ceWarn;
  const reviewRaw = Number.isFinite(t.ceReview) && t.ceReview >= 0 ? t.ceReview : DEFAULT_QA_THRESHOLDS.ceReview;
  return { ceWarn: warn, ceReview: Math.max(reviewRaw, warn) };
}

export function classifyRun(input: QaInput, thresholds: QaThresholds = DEFAULT_QA_THRESHOLDS): QaClass {
  const t = normalizeThresholds(thresholds);
  if (input.status !== 'success' || input.errorCount > 0) return 'FAIL';
  // A "success" with no parsed continuity data means the report was missing
  // or unparseable — never call that a PASS.
  if (input.runoffCE === undefined && input.routingCE === undefined) return 'INCOMPLETE';
  const worstCE = Math.max(
    Math.abs(input.runoffCE ?? 0),
    Math.abs(input.routingCE ?? 0),
  );
  if (worstCE > t.ceReview) return 'REVIEW';
  if (worstCE > t.ceWarn || input.warningCount > 0 || (input.nodesFlooded ?? 0) > 0) {
    return 'PASS WITH WARNINGS';
  }
  return 'PASS';
}

export interface HealthScore {
  /** undefined when the run has no parsed QA data to score. */
  score: number | undefined; // 0-100
  label: 'Excellent' | 'Good' | 'Review' | 'Poor' | 'No data';
  parts: { continuity: number; flooding: number; warnings: number; completion: number };
}

/** Configurable diagnostic heuristic (25 pts each), not an EPA criterion. */
export function healthScore(input: QaInput, thresholds: QaThresholds = DEFAULT_QA_THRESHOLDS): HealthScore {
  const t = normalizeThresholds(thresholds);
  if (input.status === 'success' && input.errorCount === 0
      && input.runoffCE === undefined && input.routingCE === undefined) {
    return { score: undefined, label: 'No data', parts: { continuity: 0, flooding: 0, warnings: 0, completion: 0 } };
  }
  const completion = input.status === 'success' && input.errorCount === 0 ? 25 : 0;

  const worstCE = Math.max(Math.abs(input.runoffCE ?? 0), Math.abs(input.routingCE ?? 0));
  let continuity: number;
  if (input.status !== 'success') continuity = 0;
  else if (worstCE <= t.ceWarn) continuity = 25;
  else if (worstCE >= t.ceReview * 2) continuity = 0;
  else continuity = Math.round(25 * (1 - (worstCE - t.ceWarn) / (t.ceReview * 2 - t.ceWarn)));

  const flooded = input.nodesFlooded ?? 0;
  const flooding = input.status !== 'success' ? 0 : Math.max(0, 25 - Math.min(25, flooded * 3));

  const warnings = input.status !== 'success' ? 0 : Math.max(0, 25 - Math.min(25, input.warningCount * 2));

  const score = completion + continuity + flooding + warnings;
  const label = score >= 90 ? 'Excellent' : score >= 75 ? 'Good' : score >= 50 ? 'Review' : 'Poor';
  return { score, label, parts: { continuity, flooding, warnings, completion } };
}

/**
 * Robust outlier detection using median absolute deviation. Returns the ids
 * whose value sits more than `k` scaled MADs from the batch median. Needs at
 * least 4 values to say anything.
 */
export function findOutliers(rows: { id: string; value: number }[], k = 4): Set<string> {
  const out = new Set<string>();
  const vals = rows.filter(r => Number.isFinite(r.value));
  if (vals.length < 4) return out;
  const sorted = vals.map(r => r.value).sort((a, b) => a - b);
  const med = median(sorted);
  const mad = median(vals.map(r => Math.abs(r.value - med)).sort((a, b) => a - b));
  const scale = 1.4826 * mad;
  if (scale > 0) {
    for (const r of vals) {
      if (Math.abs(r.value - med) / scale > k) out.add(r.id);
    }
    return out;
  }
  // Zero MAD (most values identical): only flag genuinely huge absolute
  // deviations — more than max(|median|, 1) away from the median.
  const tol = Math.max(Math.abs(med), 1);
  for (const r of vals) {
    if (Math.abs(r.value - med) > tol) out.add(r.id);
  }
  return out;
}

function median(sortedAsc: number[]): number {
  const n = sortedAsc.length;
  if (n === 0) return NaN;
  const mid = n >> 1;
  return n % 2 ? sortedAsc[mid] : (sortedAsc[mid - 1] + sortedAsc[mid]) / 2;
}

/**
 * CSV-safe cell: quote, escape, and neutralize spreadsheet formula injection
 * (leading =, +, -, @ get a ' prefix so Excel/Sheets treat them as text).
 */
const csvCell = (v: string | number | undefined | null) => {
  let s = v === undefined || v === null ? '' : String(v);
  if (typeof v === 'string' && /^[=+\-@]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

export interface ManifestRow {
  fileName: string;
  status: string;
  engine?: string;
  engineVersion?: string;
  startedAt?: string;
  completedAt?: string;
  processingTime?: number;
  runoffCE?: number;
  routingCE?: number;
  nodesFlooded?: number;
  warningCount: number;
  errorCount: number;
  qaClass: QaClass;
  health: number | undefined;
  outputs: string[];
}

/** Build batch_manifest.csv so a run is reproducible months later. */
export function buildManifestCsv(rows: ManifestRow[], generatedAt: string): string {
  const header = [
    'Model File', 'Status', 'QA Class', 'Health Score', 'Engine', 'Engine Version',
    'Started', 'Completed', 'Runtime (s)', 'Runoff CE (%)', 'Routing CE (%)',
    'Nodes Flooded', 'Warnings', 'Errors', 'Output Files',
  ].map(csvCell).join(',');
  const lines = rows.map(r => [
    r.fileName, r.status, r.qaClass, r.health ?? '', r.engine ?? '', r.engineVersion ?? '',
    r.startedAt ?? '', r.completedAt ?? '',
    r.processingTime !== undefined ? r.processingTime.toFixed(2) : '',
    r.runoffCE !== undefined ? r.runoffCE.toFixed(3) : '',
    r.routingCE !== undefined ? r.routingCE.toFixed(3) : '',
    r.nodesFlooded ?? '', r.warningCount, r.errorCount, r.outputs.join('; '),
  ].map(csvCell).join(','));
  return [
    `"BatchSWMM run manifest","generated","${generatedAt}"`,
    header,
    ...lines,
  ].join('\n');
}
