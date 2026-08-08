// Pure GIF frame drawing + encoding, usable from both the main thread and a
// web worker (OffscreenCanvas). No DOM or React dependencies beyond canvas 2D.

// @ts-ignore - gifenc ships without types
import { GIFEncoder, quantize, applyPalette } from "gifenc";
import type { ParsedTimeSeries } from "./parseTimeSeries";
import { parseReportTimestamp } from "./engineComparison";

export const GIF_WIDTH = 640;
export const GIF_HEIGHT = 480;
export const MAX_FRAMES = 60;
export const FRAME_DELAY_MS = 150;

export const ENGINE_GIF_COLORS = ["#2176d9", "#d92176", "#2ba84a", "#e08a00"];

// Works with both CanvasRenderingContext2D and OffscreenCanvasRenderingContext2D.
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

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

export interface MapGeometry {
  nodes: Array<{ name: string; x: number; y: number }>;
  links: Array<{ from: string; to: string }>;
}

export interface EnginePanel {
  label: string;
  lookup: Map<string, Map<string, number>>; // node -> time -> value
}

function drawMapPanel(
  ctx: Ctx2D,
  geo: MapGeometry,
  panel: EnginePanel,
  time: string,
  maxValue: number,
  px: number, py: number, pw: number, ph: number,
) {
  const pad = 22;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of geo.nodes) {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  }
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

function frameChrome(ctx: Ctx2D, title: string, time: string, metric: string, unit: string) {
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

export interface MapGifData {
  fileName: string;
  geometry: MapGeometry;
  metric: string;
  unit: string;
  engines: EnginePanel[]; // 1 or more; drawn side by side
}

export interface ChartGifData {
  fileName: string;
  metric: string;
  unit: string;
  engines: Array<{ label: string; series: ParsedTimeSeries | null }>;
}

export interface RenderOptions {
  /** Called after each frame is encoded. */
  onProgress?: (done: number, total: number) => void;
  /**
   * Called between frames; on the main thread this should yield to the event
   * loop so the UI can update. In a worker it can be omitted.
   */
  yieldBetweenFrames?: () => Promise<void>;
}

function makeCanvas(): { canvas: { width: number; height: number }; ctx: Ctx2D } {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(GIF_WIDTH, GIF_HEIGHT);
    const ctx = canvas.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
    if (ctx) return { canvas, ctx };
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = GIF_WIDTH;
    canvas.height = GIF_HEIGHT;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (ctx) return { canvas, ctx };
  }
  throw new Error("Canvas 2D not available in this browser");
}

async function encodeFrames(
  drawFrame: (ctx: Ctx2D, frameIndex: number) => void,
  frameCount: number,
  opts: RenderOptions,
): Promise<Uint8Array> {
  const { canvas, ctx } = makeCanvas();
  const gif = GIFEncoder();
  for (let i = 0; i < frameCount; i++) {
    drawFrame(ctx, i);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    gif.writeFrame(index, canvas.width, canvas.height, { palette, delay: FRAME_DELAY_MS });
    opts.onProgress?.(i + 1, frameCount);
    await opts.yieldBetweenFrames?.();
  }
  gif.finish();
  return gif.bytes() as Uint8Array;
}

export async function renderMapGif(input: MapGifData, opts: RenderOptions = {}): Promise<Uint8Array> {
  const { geometry, engines, metric, unit, fileName } = input;
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
  }, times.length, opts);
}

export async function renderChartGif(input: ChartGifData, opts: RenderOptions = {}): Promise<Uint8Array> {
  const { engines, metric, unit, fileName } = input;
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
  }, cutoffs.length, opts);
}
