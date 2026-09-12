import {
  buildComparison,
  parseReportTimestamp,
  type EngineRun,
  type FileComparison,
} from "./engineComparison";
import type { ParsedTimeSeries } from "./parseTimeSeries";
import { bareElementName } from "./qaqcReport";

export type EntitySeriesKind = "node" | "link" | "subcatchment";

export interface EntitySeriesIndex {
  node: Map<string, ParsedTimeSeries>;
  link: Map<string, ParsedTimeSeries>;
  subcatchment: Map<string, ParsedTimeSeries>;
}

export interface ComparisonModelOption {
  key: string;
  label: string;
  fileName: string;
  occurrence: number;
  results: FileComparison["results"];
}

/**
 * Build occurrence-aware model choices using the comparison table's alignment.
 * Callers that can still provide value with a single successful reference (such
 * as a no-score candidate ranking) can lower the successful-run threshold.
 */
export function buildComparisonModelOptions(
  runs: EngineRun[],
  minimumSuccessfulRuns = 2,
): ComparisonModelOption[] {
  const occurrenceCounts = new Map<string, number>();
  return buildComparison(runs).files.flatMap((file, index) => {
    const sample = file.results.find(result => result !== undefined);
    if (!sample) return [];
    const fileName = sample.fileName;
    const occurrence = occurrenceCounts.get(fileName) ?? 0;
    occurrenceCounts.set(fileName, occurrence + 1);
    const successCount = file.results.filter(result => result?.status === "success").length;
    if (successCount < minimumSuccessfulRuns) return [];
    return [{
      key: `${index}`,
      label: file.fileName,
      fileName,
      occurrence,
      results: file.results,
    }];
  });
}

export function entitySeriesKind(series: ParsedTimeSeries): EntitySeriesKind | null {
  const title = series.title.trim();
  const element = series.element.trim();
  if (/^subcatch/i.test(title) || /^subcatch\w*\s+/i.test(element)) return "subcatchment";
  if (/^node/i.test(title) || /^node\s+/i.test(element)) return "node";
  if (/^link/i.test(title) || /^link\s+/i.test(element)) return "link";
  return null;
}

export function indexEntitySeries(series: ParsedTimeSeries[]): EntitySeriesIndex {
  const index: EntitySeriesIndex = {
    node: new Map(),
    link: new Map(),
    subcatchment: new Map(),
  };
  for (const item of series) {
    const kind = entitySeriesKind(item);
    if (!kind) continue;
    const name = bareElementName(item.element);
    if (name && !index[kind].has(name)) index[kind].set(name, item);
  }
  return index;
}

export function formatElapsedTime(seconds: number): string {
  if (seconds < 3600) {
    const minutes = seconds / 60;
    return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)} min`;
  }
  const hours = seconds / 3600;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(2)} hr`;
}

/**
 * Merge one element metric from several engines on elapsed simulation time.
 * Each engine is anchored to its own first report timestamp so engines that
 * report different calendar dates still compare at the same simulation time.
 */
export function mergeEntityMetric(
  entries: Array<{ label: string; series: ParsedTimeSeries | null }>,
  metric: string,
): Array<Record<string, number | string>> {
  const rows = new Map<number, Record<string, number | string>>();
  const normalizedMetric = metric.trim().toLowerCase();

  for (const entry of entries) {
    if (!entry.series) continue;
    const columnIndex = entry.series.columns.findIndex(
      column => column.trim().toLowerCase() === normalizedMetric,
    );
    if (columnIndex < 0) continue;

    const timestamps = entry.series.data
      .map(point => parseReportTimestamp(point.time))
      .filter(Number.isFinite);
    if (timestamps.length === 0) continue;
    const start = timestamps[0];

    for (const point of entry.series.data) {
      const timestamp = parseReportTimestamp(point.time);
      const value = point.values[columnIndex];
      if (!Number.isFinite(timestamp) || !Number.isFinite(value)) continue;
      const elapsedSeconds = Math.round((timestamp - start) / 1000);
      const row = rows.get(elapsedSeconds) ?? {
        elapsedSeconds,
      };
      row[entry.label] = value;
      rows.set(elapsedSeconds, row);
    }
  }

  return Array.from(rows.entries())
    .sort(([a], [b]) => a - b)
    .map(([, row]) => row);
}

/** Metrics that exist in every supplied engine series, matched case-insensitively. */
export function commonEntityMetrics(
  series: ParsedTimeSeries[],
): Array<{ name: string; unit: string }> {
  if (series.length < 2) return [];
  const first = series[0];
  return first.columns.flatMap((column, index) => {
    const normalized = column.trim().toLowerCase();
    if (!normalized) return [];
    const shared = series.slice(1).every(item =>
      item.columns.some(candidate => candidate.trim().toLowerCase() === normalized)
    );
    return shared ? [{ name: column.trim(), unit: first.units[index] ?? "" }] : [];
  });
}