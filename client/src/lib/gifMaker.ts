// Turns simulation results into animated GIFs, entirely in the browser.
// Two animation styles:
//  - "map": the network map with nodes colored by a result value as time advances
//  - "chart": a time-series chart drawing itself over time
// Rendering happens on a hidden <canvas>; frames are encoded with gifenc.

// @ts-ignore - gifenc ships without types
import { GIFEncoder, quantize, applyPalette } from "gifenc";
import type { ParsedInpFile } from "./inpParser";
import type { ParsedTimeSeries } from "./parseTimeSeries";
import { parseReportTimestamp } from "./engineComparison";

export const GIF_WIDTH = 640;
export const GIF_HEIGHT = 480;
export const MAX_FRAMES = 60;
export const FRAME_DELAY_MS = 150;

export const ENGINE_GIF_COLORS = ["#2176d9", "#d92176", "#2ba84a", "#e08a00"];

/** Evenly sample up to maxFrames entries from a sorted list (always keeps first and last). */
export function sampleFrameTimes<T>(items: T[], maxFrames: number = MAX_FRAMES): T[] {
  if (items.length <= maxFrames) return items;
  const out: T[] = [];
  for (let i = 0; i < maxFrames; i++) {
    out.push(items[Math.round((i * (items.length - 1)) / (maxFrames - 1))]);
  }
  return out;
}

/** element -> (time -> value) lookup for one metric of a parsed section. */
export function buildValueLookup(
  seriesList: ParsedTimeSeries[],
  metric: string,
): { lookup: Map<string, Map<string, number>>; maxValue: number } {
  const lookup = new Map<string, Map<string, number>>();
  let maxValue = 0;
  for (const s of seriesList) {
    const ci = s.columns.indexOf(metric);
    if (ci === -1) continue;
    const m = new Map<string, number>();
    for (const d of s.data) {
      const v = d.values[ci];
      if (v !== undefined && !isNaN(v)) {
        m.set(d.time, v);
        if (v > maxValue) maxValue = v;
      }
    }
    lookup.set(s.element, m);
  }
  return { lookup, maxValue };
}

/** Union of all timestamps across engines, chronologically sorted. */
export function unionTimes(perEngine: Array<Map<string, Map<string, number>>>): string[] {
  const seen = new Set<string>();
  for (const eng of perEngine) {
    for (const m of Array.from(eng.values())) {
      for (const t of Array.from(m.keys())) seen.add(t);
    }
  }
  return Array.from(seen).sort((a, b) => parseReportTimestamp(a) - parseReportTimestamp(b));
}

/** Blue -> yellow -> red ramp for 0..1. */
function heatColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped < 0.5) {
    const k = clamped / 0.5;
    return `rgb(${Math.round(40 + k * 200)},${Math.round(90 + k * 120)},${Math.round(200 - k * 160)})`;
  }
  const k = (clamped - 0.5) / 0.5;
  return `rgb(${Math.round(240 - k * 20)},${Math.round(210 - k * 170)},${Math.round(40)})`;
}

interface MapGeometry {
  nodes: Array<{ name: string; x: number; y: number }>;
  links: Array<{ from: string; to: string }>;
}

export function extractMapGeometry(parsed: ParsedInpFile): MapGeometry {
  const nodes = parsed.coordinates.map(c => ({ name: c.node, x: c.x, y: c.y }));
  const links = [
    ...parsed.conduits.map(c => ({ from: c.from, to: c.to })),
    ...parsed.pumps.map(p => ({ from: p.from, to: p.to })),
    ...parsed.weirs.map(w => ({ from: w.from, to: w.to })),
    ...parsed.orifices.map(o => ({ from: o.from, to: o.to })),
  ];
  return { nodes, links };
}

interface EnginePanel {
  label: string;
  lookup: Map<string, Map<string, number>>; // node -> time -> value
}

function drawMapPanel(
  ctx: CanvasRenderingContext2D,
  geo: MapGeometry,
  panel: EnginePanel,
  time: string,
  maxValue: number,
  px: number, py: number, pw: number, ph: number,
) {
  const pad = 22;
  const xs = geo.nodes.map(n => n.x);
  const ys = geo.nodes.map(n => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min((pw - 2 * pad) / ((maxX - minX) || 1), (ph - 2 * pad) / ((maxY - minY) || 1));
  const toPx = (x: number, y: number) => ({
    cx: px + pad + (x - minX) * scale,
    cy: py + ph - pad - (y - minY) * scale,
  });
  const coord = new Map(geo.nodes.map(n => [n.name, n]));

  ctx.strokeStyle = "#9aa4af";
  ctx.lineWidth = 1;
  for (const l of geo.links) {
    const a = coord.get(l.from), b = coord.get(l.to);
    if (!a || !b) continue;
    const pa = toPx(a.x, a.y), pb = toPx(b.x, b.y);
    ctx.beginPath();
    ctx.moveTo(pa.cx, pa.cy);
    ctx.lineTo(pb.cx, pb.cy);
    ctx.stroke();
  }

  const r = geo.nodes.length > 200 ? 2.5 : geo.nodes.length > 60 ? 4 : 5.5;
  for (const n of geo.nodes) {
    const v = panel.lookup.get(n.name)?.get(time);
    const p = toPx(n.x, n.y);
    ctx.beginPath();
    ctx.arc(p.cx, p.cy, r, 0, Math.PI * 2);
    ctx.fillStyle = v === undefined ? "#c9cdd2" : heatColor(maxValue > 0 ? v / maxValue : 0);
    ctx.fill();
    ctx.strokeStyle = "#5f6a75";
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }

  ctx.fillStyle = "#1f2937";
  ctx.font = "bold 13px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(panel.label, px + 8, py + 16);
}

function newCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = GIF_WIDTH;
  canvas.height = GIF_HEIGHT;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D not available in this browser");
  return { canvas, ctx };
}

function frameChrome(ctx: CanvasRenderingContext2D, title: string, time: string, metric: string, unit: string) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, GIF_WIDTH, GIF_HEIGHT);
  ctx.fillStyle = "#111827";
  ctx.font = "bold 15px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(title, 12, 22);
  ctx.font = "13px sans-serif";
  ctx.fillStyle = "#374151";
  ctx.textAlign = "right";
  ctx.fillText(`${metric}${unit ? ` (${unit})` : ""} — ${time}`, GIF_WIDTH - 12, 22);
}

export interface MapGifInput {
  fileName: string;
  geometry: MapGeometry;
  metric: string;
  unit: string;
  engines: EnginePanel[]; // 1 or more; drawn side by side
  onProgress?: (done: number, total: number) => void;
}

export interface ChartGifInput {
  fileName: string;
  metric: string;
  unit: string;
  engines: Array<{ label: string; series: ParsedTimeSeries | null }>;
  onProgress?: (done: number, total: number) => void;
}

async function encodeFrames(
  drawFrame: (ctx: CanvasRenderingContext2D, frameIndex: number) => void,
  frameCount: number,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const { canvas, ctx } = newCanvas();
  const gif = GIFEncoder();
  for (let i = 0; i < frameCount; i++) {
    drawFrame(ctx, i);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    gif.writeFrame(index, canvas.width, canvas.height, { palette, delay: FRAME_DELAY_MS });
    onProgress?.(i + 1, frameCount);
    // Yield so the UI can update the progress indicator.
    await new Promise(r => setTimeout(r, 0));
  }
  gif.finish();
  return new Blob([gif.bytes()], { type: "image/gif" });
}

export async function makeMapGif(input: MapGifInput): Promise<Blob> {
  const { geometry, engines, metric, unit, fileName, onProgress } = input;
  if (geometry.nodes.length === 0) throw new Error("This model has no coordinate data to draw a map from.");
  const times = sampleFrameTimes(unionTimes(engines.map(e => e.lookup)));
  if (times.length === 0) throw new Error("No node time-series data found for this model.");
  let maxValue = 0;
  for (const e of engines) {
    for (const m of Array.from(e.lookup.values())) {
      for (const v of Array.from(m.values())) if (v > maxValue) maxValue = v;
    }
  }
  const n = engines.length;
  const panelW = Math.floor((GIF_WIDTH - 8 * (n - 1)) / n);

  return encodeFrames((ctx, i) => {
    frameChrome(ctx, fileName, times[i], metric, unit);
    engines.forEach((eng, k) => {
      drawMapPanel(ctx, geometry, eng, times[i], maxValue, k * (panelW + 8), 30, panelW, GIF_HEIGHT - 60);
    });
    // Color legend
    for (let x = 0; x < 120; x++) {
      ctx.fillStyle = heatColor(x / 119);
      ctx.fillRect(GIF_WIDTH - 140 + x, GIF_HEIGHT - 20, 1, 10);
    }
    ctx.fillStyle = "#374151";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText("0", GIF_WIDTH - 144, GIF_HEIGHT - 11);
    ctx.textAlign = "left";
    ctx.fillText(maxValue.toPrecision(3), GIF_WIDTH - 16, GIF_HEIGHT - 11);
  }, times.length, onProgress);
}

export async function makeChartGif(input: ChartGifInput): Promise<Blob> {
  const { engines, metric, unit, fileName, onProgress } = input;
  const withData = engines
    .map(e => {
      if (!e.series) return null;
      const ci = e.series.columns.indexOf(metric);
      if (ci === -1) return null;
      return {
        label: e.label,
        points: e.series.data
          .map(d => ({ t: parseReportTimestamp(d.time), time: d.time, v: d.values[ci] }))
          .filter(p => !isNaN(p.t) && p.v !== undefined && !isNaN(p.v)),
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null && e.points.length > 0);
  if (withData.length === 0) throw new Error("No time-series data found for this metric.");

  const allTs = withData.flatMap(e => e.points.map(p => p.t));
  const minT = Math.min(...allTs), maxT = Math.max(...allTs);
  const maxV = Math.max(...withData.flatMap(e => e.points.map(p => p.v)), 0);
  const minV = Math.min(...withData.flatMap(e => e.points.map(p => p.v)), 0);
  const left = 60, right = 16, top = 34, bottom = 36;
  const plotW = GIF_WIDTH - left - right, plotH = GIF_HEIGHT - top - bottom;
  const xFor = (t: number) => left + ((t - minT) / ((maxT - minT) || 1)) * plotW;
  const yFor = (v: number) => top + plotH - ((v - minV) / ((maxV - minV) || 1)) * plotH;

  // Frame i reveals data up to cutoff time.
  const cutoffs = sampleFrameTimes(
    unionTimes(withData.map(e => new Map([["_", new Map(e.points.map(p => [p.time, p.v]))]]))),
  );

  return encodeFrames((ctx, i) => {
    const cutoffT = parseReportTimestamp(cutoffs[i]);
    frameChrome(ctx, fileName, cutoffs[i], metric, unit);
    // Axes
    ctx.strokeStyle = "#9aa4af";
    ctx.lineWidth = 1;
    ctx.strokeRect(left, top, plotW, plotH);
    ctx.fillStyle = "#374151";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "right";
    for (let g = 0; g <= 4; g++) {
      const v = minV + ((maxV - minV) * g) / 4;
      const y = yFor(v);
      ctx.strokeStyle = "#e5e7eb";
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + plotW, y); ctx.stroke();
      ctx.fillText(v.toPrecision(3), left - 6, y + 4);
    }
    // Lines up to the cutoff
    withData.forEach((e, k) => {
      ctx.strokeStyle = ENGINE_GIF_COLORS[k % ENGINE_GIF_COLORS.length];
      ctx.lineWidth = 2;
      ctx.beginPath();
      let started = false;
      for (const p of e.points) {
        if (p.t > cutoffT) break;
        if (!started) { ctx.moveTo(xFor(p.t), yFor(p.v)); started = true; }
        else ctx.lineTo(xFor(p.t), yFor(p.v));
      }
      ctx.stroke();
    });
    // Legend
    withData.forEach((e, k) => {
      const lx = left + 10, ly = top + 16 + k * 16;
      ctx.strokeStyle = ENGINE_GIF_COLORS[k % ENGINE_GIF_COLORS.length];
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(lx, ly - 4); ctx.lineTo(lx + 22, ly - 4); ctx.stroke();
      ctx.fillStyle = "#111827";
      ctx.textAlign = "left";
      ctx.font = "12px sans-serif";
      ctx.fillText(e.label, lx + 28, ly);
    });
  }, cutoffs.length, onProgress);
}
