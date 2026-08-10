// Builds the "worst disagreement" time-series overlays shown under the
// engine-vs-engine scatter plots. Plain .ts (no JSX) so node tests can import.

import { parseTimeSeries, type ParsedTimeSeries } from "./parseTimeSeries";
import { toHours } from "./qaqcReport";
import type { ScatterValues } from "./summaryScatter";

export interface OverlayRow { h: number; a?: number; b?: number }

export interface Overlay {
  id: string;
  title: string;
  yAxis: string;
  name: string;
  kind: "link" | "node";
  rows: OverlayRow[] | null;
  reason?: "none" | "missing-link";
}

function buildMaps(content: string) {
  const links = new Map<string, ParsedTimeSeries>();
  const nodes = new Map<string, ParsedTimeSeries>();
  for (const ts of parseTimeSeries(content)) {
    // Series headers name the element as e.g. "Link 23916015-23916007";
    // strip the type prefix so it matches the bare name in summary tables.
    if (/link/i.test(ts.title) || /^link\s+/i.test(ts.element)) {
      links.set(ts.element.replace(/^link\s+/i, "").trim(), ts);
    } else if (/node/i.test(ts.title) || /^node\s+/i.test(ts.element)) {
      nodes.set(ts.element.replace(/^node\s+/i, "").trim(), ts);
    }
  }
  return { links, nodes };
}

function rowsFor(ts: ParsedTimeSeries, colRegex: RegExp) {
  let ci = ts.columns.findIndex(c => colRegex.test(c));
  if (ci < 0) ci = 0;
  return ts.data
    .map(d => ({ time: d.time, v: d.values[ci] }))
    .filter(d => Number.isFinite(d.v));
}

function mergeRows(a: { time: string; v: number }[], b: { time: string; v: number }[]): OverlayRow[] {
  // Anchor each engine to its own first timestamp; join on whole seconds.
  const t0 = (rows: { time: string }[]) => {
    const m = rows[0].time.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    return m ? Date.UTC(+m[3], +m[1] - 1, +m[2], +m[4], +m[5], +(m[6] || 0)) : NaN;
  };
  const t0a = t0(a), t0b = t0(b);
  const merged = new Map<number, OverlayRow>();
  for (const d of a) {
    const h = toHours(d.time, t0a);
    if (!Number.isFinite(h)) continue;
    const key = Math.round(h * 3600);
    const row = merged.get(key) || { h };
    row.a = d.v;
    merged.set(key, row);
  }
  for (const d of b) {
    const h = toHours(d.time, t0b);
    if (!Number.isFinite(h)) continue;
    const key = Math.round(h * 3600);
    const row = merged.get(key) || { h };
    row.b = d.v;
    merged.set(key, row);
  }
  // Keep only timestamps where BOTH engines have a value.
  return Array.from(merged.values())
    .filter(r => r.a !== undefined && r.b !== undefined)
    .sort((r1, r2) => r1.h - r2.h);
}

function buildOverlay(
  id: string,
  title: (name: string) => string,
  yAxis: string,
  xMap: Map<string, number>,
  yMap: Map<string, number>,
  seriesA: Map<string, ParsedTimeSeries>,
  seriesB: Map<string, ParsedTimeSeries>,
  colRegex: RegExp,
  kind: "link" | "node",
): Overlay | null {
  const ranked: { name: string; diff: number }[] = [];
  xMap.forEach((x, name) => {
    const y = yMap.get(name);
    if (y !== undefined) ranked.push({ name, diff: Math.abs(x - y) });
  });
  if (ranked.length === 0) return null;
  ranked.sort((r1, r2) => r2.diff - r1.diff);
  const pick = ranked.find(r => seriesA.has(r.name) && seriesB.has(r.name));
  if (!pick) {
    const reason = seriesA.size === 0 && seriesB.size === 0
      ? ("none" as const) : ("missing-link" as const);
    return { id, title: title(ranked[0].name), yAxis, name: ranked[0].name, kind, rows: null, reason };
  }
  const a = rowsFor(seriesA.get(pick.name)!, colRegex);
  const b = rowsFor(seriesB.get(pick.name)!, colRegex);
  if (a.length === 0 || b.length === 0) {
    return { id, title: title(pick.name), yAxis, name: pick.name, kind, rows: null, reason: "missing-link" };
  }
  return { id, title: title(pick.name), yAxis, name: pick.name, kind, rows: mergeRows(a, b) };
}

/**
 * Builds the three worst-disagreement overlays (peak link flow, max node
 * depth, link max/full depth) for a pair of reports.
 */
export function buildWorstOverlays(
  contentA: string,
  contentB: string,
  valsX: ScatterValues,
  valsY: ScatterValues,
): Overlay[] {
  const mapsA = buildMaps(contentA);
  const mapsB = buildMaps(contentB);
  return [
    buildOverlay(
      "worst-flow",
      n => `Flow Time Series — Link ${n} (largest peak-flow difference between engines)`,
      "Flow",
      valsX.flows, valsY.flows, mapsA.links, mapsB.links, /flow/i, "link",
    ),
    buildOverlay(
      "worst-node-depth",
      n => `Depth Time Series — Node ${n} (largest max-depth difference between engines)`,
      "Depth",
      valsX.nodeDepths, valsY.nodeDepths, mapsA.nodes, mapsB.nodes, /depth/i, "node",
    ),
    buildOverlay(
      "worst-link-depth",
      n => `Depth Time Series — Link ${n} (largest max/full depth difference between engines)`,
      "Depth",
      valsX.linkDepths, valsY.linkDepths, mapsA.links, mapsB.links, /depth/i, "link",
    ),
  ].filter((o): o is Overlay => o !== null);
}
