import { parseReportTimestamp } from "./engineComparison";
import type { ParsedTimeSeries } from "./parseTimeSeries";

export type PhaseSpaceMode = "rating" | "derivative";

export interface PhasePoint {
  x: number;
  y: number;
  elapsedSeconds: number;
  segment: number;
}

function metricIndex(series: ParsedTimeSeries, metric: string): number {
  const target = metric.trim().toLowerCase();
  return series.columns.findIndex(column => column.trim().toLowerCase() === target);
}

/** Cross-plot a selected response metric against a selected state metric. */
export function buildRatingPhasePoints(
  series: ParsedTimeSeries,
  xMetric: string,
  yMetric: string,
): PhasePoint[] {
  const xIndex = metricIndex(series, xMetric);
  const yIndex = metricIndex(series, yMetric);
  if (xIndex < 0 || yIndex < 0) return [];

  const points: PhasePoint[] = [];
  let start: number | null = null;
  let segment = 0;
  let previousWasValid = false;
  for (const row of series.data) {
    const x = row.values[xIndex];
    const y = row.values[yIndex];
    const timestamp = parseReportTimestamp(row.time);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(timestamp)) {
      previousWasValid = false;
      continue;
    }
    if (start === null) start = timestamp;
    if (!previousWasValid && points.length > 0) segment += 1;
    points.push({
      x,
      y,
      elapsedSeconds: Math.round((timestamp - start) / 1000),
      segment,
    });
    previousWasValid = true;
  }
  return points;
}

/**
 * Plot a state against its finite-difference derivative. A centered
 * difference is used in the interior; one-sided differences retain both
 * endpoints. Derivatives are reported per hour.
 */
export function buildDerivativePhasePoints(
  series: ParsedTimeSeries,
  stateMetric: string,
): PhasePoint[] {
  const index = metricIndex(series, stateMetric);
  if (index < 0) return [];

  const segments: Array<Array<{ value: number; timestamp: number }>> = [];
  let current: Array<{ value: number; timestamp: number }> = [];
  for (const row of series.data) {
    const value = row.values[index];
    const timestamp = parseReportTimestamp(row.time);
    if (Number.isFinite(value) && Number.isFinite(timestamp)) {
      current.push({ value, timestamp });
    } else if (current.length > 0) {
      segments.push(current);
      current = [];
    }
  }
  if (current.length > 0) segments.push(current);
  const start = segments.flat()[0]?.timestamp;
  if (start === undefined) return [];

  return segments.flatMap((rows, segment) => {
    if (rows.length < 2) return [];
    return rows.flatMap((row, index) => {
      let derivative: number;
      if (index === 0) {
        const hours = (rows[1].timestamp - row.timestamp) / 3_600_000;
        if (hours <= 0) return [];
        derivative = (rows[1].value - row.value) / hours;
      } else if (index === rows.length - 1) {
        const before = rows[index - 1];
        const hours = (row.timestamp - before.timestamp) / 3_600_000;
        if (hours <= 0) return [];
        derivative = (row.value - before.value) / hours;
      } else {
        const before = rows[index - 1];
        const after = rows[index + 1];
        const h0 = (row.timestamp - before.timestamp) / 3_600_000;
        const h1 = (after.timestamp - row.timestamp) / 3_600_000;
        if (h0 <= 0 || h1 <= 0) return [];
        derivative =
          (-h1 / (h0 * (h0 + h1))) * before.value +
          ((h1 - h0) / (h0 * h1)) * row.value +
          (h0 / (h1 * (h0 + h1))) * after.value;
      }
      return Number.isFinite(derivative) ? [{
        x: row.value,
        y: derivative,
        elapsedSeconds: Math.round((row.timestamp - start) / 1000),
        segment,
      }] : [];
    });
  });
}

export function phaseMetricDefaults(
  metrics: string[],
  kind: "node" | "link" | "subcatchment",
  mode: PhaseSpaceMode = "rating",
): { xMetric: string; yMetric: string } {
  const pick = (patterns: RegExp[], fallback: string) => {
    for (const pattern of patterns) {
      const match = metrics.find(metric => pattern.test(metric));
      if (match) return match;
    }
    return fallback;
  };
  const xPatterns = mode === "derivative"
    ? kind === "link"
      ? [/^flow$/i, /flow/i, /velocity/i]
      : kind === "node"
        ? [/depth/i, /head/i]
        : [/runoff/i, /depth/i]
    : kind === "subcatchment"
      ? [/rainfall/i, /depth/i]
      : [/depth/i, /head/i];
  const xMetric = pick(xPatterns, metrics[0] ?? "");
  const responsePatterns = kind === "link"
    ? [/flow/i, /velocity/i]
    : kind === "node"
      ? [/inflow/i, /flood/i]
      : [/runoff/i, /infiltration/i];
  const yMetric = pick(responsePatterns, metrics.find(metric => metric !== xMetric) ?? xMetric);
  return { xMetric, yMetric };
}

export function phaseRange(points: PhasePoint[], axis: "x" | "y"): string {
  if (points.length === 0) return "—";
  const values = points.map(point => point[axis]);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const format = (value: number) => Math.abs(value) >= 100 || Number.isInteger(value)
    ? value.toFixed(0)
    : value.toFixed(2);
  return `${format(low)} – ${format(high)}`;
}

export function phaseExclusionReason(
  hasSeries: boolean,
  pointCount: number,
  mode: PhaseSpaceMode,
): string | null {
  if (!hasSeries) return "selected element series is missing from the report";
  if (pointCount === 0) {
    return mode === "derivative"
      ? "fewer than two contiguous valid state samples are available"
      : "no valid paired metric samples are available";
  }
  return null;
}