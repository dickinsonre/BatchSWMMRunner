import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  sampleFrameTimes,
  buildValueLookup,
  unionTimes,
  makeMapGif,
  makeChartGif,
  GIF_WIDTH,
  GIF_HEIGHT,
} from "../client/src/lib/gifMaker";

const mkSeries = (element: string, times: string[], vals: number[]) => ({
  title: "Node Results Time Series",
  element,
  columns: ["Depth", "Head"],
  units: ["ft", "ft"],
  data: times.map((t, i) => ({ time: t, values: [vals[i], vals[i] + 100] })),
});

describe("gifMaker helpers", () => {
  it("samples evenly and keeps first/last", () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const out = sampleFrameTimes(items, 10);
    expect(out).toHaveLength(10);
    expect(out[0]).toBe(0);
    expect(out[9]).toBe(99);
    expect(sampleFrameTimes([1, 2, 3], 10)).toEqual([1, 2, 3]);
  });

  it("builds per-element lookups with the global max", () => {
    const { lookup, maxValue } = buildValueLookup(
      [mkSeries("N1", ["01/01/2020 00:00", "01/01/2020 01:00"], [1, 5]),
       mkSeries("N2", ["01/01/2020 00:00"], [3])],
      "Depth",
    );
    expect(lookup.get("N1")?.get("01/01/2020 01:00")).toBe(5);
    expect(lookup.get("N2")?.get("01/01/2020 00:00")).toBe(3);
    expect(maxValue).toBe(5);
  });

  it("unions times chronologically across engines", () => {
    const a = buildValueLookup([mkSeries("N1", ["01/01/2020 02:00", "01/01/2020 00:00"], [1, 2])], "Depth").lookup;
    const b = buildValueLookup([mkSeries("N1", ["01/01/2020 01:00"], [9])], "Depth").lookup;
    expect(unionTimes([a, b])).toEqual(["01/01/2020 00:00", "01/01/2020 01:00", "01/01/2020 02:00"]);
  });
});

// ---------------------------------------------------------------------------
// End-to-end encoder tests: run makeMapGif/makeChartGif against a node-side
// canvas stub that rasterizes fills, strokes, and arcs into a real pixel
// buffer, then fully decode the produced GIF (including LZW image data) with
// omggif and assert the frames play back with the expected count and content.
// ---------------------------------------------------------------------------

// @ts-ignore - omggif ships without types
import { GifReader } from "omggif";

/** Software-rasterizing 2D-context stub: fillRect paints rectangles, path
 *  stroke() draws Bresenham lines, arc()+fill() paints filled discs — enough
 *  to reproduce what the GIF renderers actually draw. Text is a no-op. */
function makeStubCanvas() {
  let width = 0;
  let height = 0;
  let buf = new Uint8ClampedArray(0);

  const parseColor = (c: string): [number, number, number] => {
    if (c.startsWith("#")) {
      const hex = c.slice(1);
      return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
    }
    const m = c.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
  };

  const setPx = (x: number, y: number, [r, g, b]: [number, number, number]) => {
    const xx = Math.round(x), yy = Math.round(y);
    if (xx < 0 || yy < 0 || xx >= width || yy >= height) return;
    const o = (yy * width + xx) * 4;
    buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = 255;
  };

  const drawLine = (x0: number, y0: number, x1: number, y1: number, color: [number, number, number]) => {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    for (let s = 0; s <= steps; s++) {
      setPx(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps, color);
    }
  };

  type PathOp =
    | { kind: "move" | "line"; x: number; y: number }
    | { kind: "arc"; x: number; y: number; r: number };
  let path: PathOp[] = [];

  const ctx: Record<string, unknown> = {
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    font: "",
    textAlign: "left",
    fillRect(x: number, y: number, w: number, h: number) {
      const color = parseColor(String(this.fillStyle));
      const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
      const x1 = Math.min(width, Math.ceil(x + w)), y1 = Math.min(height, Math.ceil(y + h));
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const o = (yy * width + xx) * 4;
          buf[o] = color[0]; buf[o + 1] = color[1]; buf[o + 2] = color[2]; buf[o + 3] = 255;
        }
      }
    },
    beginPath() { path = []; },
    moveTo(x: number, y: number) { path.push({ kind: "move", x, y }); },
    lineTo(x: number, y: number) { path.push({ kind: "line", x, y }); },
    arc(x: number, y: number, r: number) { path.push({ kind: "arc", x, y, r }); },
    stroke() {
      const color = parseColor(String(this.strokeStyle));
      let cur: { x: number; y: number } | null = null;
      for (const op of path) {
        if (op.kind === "move") cur = op;
        else if (op.kind === "line") {
          if (cur) drawLine(cur.x, cur.y, op.x, op.y, color);
          cur = op;
        } else {
          for (let a = 0; a < 32; a++) {
            setPx(op.x + op.r * Math.cos((a * Math.PI) / 16), op.y + op.r * Math.sin((a * Math.PI) / 16), color);
          }
        }
      }
    },
    fill() {
      const color = parseColor(String(this.fillStyle));
      for (const op of path) {
        if (op.kind !== "arc") continue;
        for (let dy = -op.r; dy <= op.r; dy++) {
          for (let dx = -op.r; dx <= op.r; dx++) {
            if (dx * dx + dy * dy <= op.r * op.r) setPx(op.x + dx, op.y + dy, color);
          }
        }
      }
    },
    strokeRect(x: number, y: number, w: number, h: number) {
      const color = parseColor(String(this.strokeStyle));
      drawLine(x, y, x + w, y, color);
      drawLine(x + w, y, x + w, y + h, color);
      drawLine(x + w, y + h, x, y + h, color);
      drawLine(x, y + h, x, y, color);
    },
    fillText() {},
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      width: w, height: h, data: buf,
    }),
  };

  const canvas = {
    get width() { return width; },
    set width(w: number) { width = w; buf = new Uint8ClampedArray(width * height * 4); },
    get height() { return height; },
    set height(h: number) { height = h; buf = new Uint8ClampedArray(width * height * 4); },
    getContext: () => ctx,
  };
  return canvas;
}

/** Fully decode a GIF (header, palettes, and LZW image data) into RGBA frames. */
function decodeGif(bytes: Uint8Array): { width: number; height: number; frames: Uint8Array[] } {
  const reader = new GifReader(bytes);
  const frames: Uint8Array[] = [];
  for (let i = 0; i < reader.numFrames(); i++) {
    const rgba = new Uint8Array(reader.width * reader.height * 4);
    reader.decodeAndBlitFrameRGBA(i, rgba);
    frames.push(rgba);
  }
  return { width: reader.width, height: reader.height, frames };
}

const countNonWhite = (rgba: Uint8Array) => {
  let n = 0;
  for (let o = 0; o < rgba.length; o += 4) {
    if (rgba[o] !== 255 || rgba[o + 1] !== 255 || rgba[o + 2] !== 255) n++;
  }
  return n;
};

const framesDiffer = (a: Uint8Array, b: Uint8Array) => {
  for (let o = 0; o < a.length; o++) if (a[o] !== b[o]) return true;
  return false;
};

const times = ["01/01/2020 00:00", "01/01/2020 01:00", "01/01/2020 02:00", "01/01/2020 03:00"];

describe("gif encoding end-to-end", () => {
  const origDocument = (globalThis as any).document;

  beforeAll(() => {
    (globalThis as any).document = { createElement: () => makeStubCanvas() };
  });
  afterAll(() => {
    (globalThis as any).document = origDocument;
  });

  it("makeMapGif produces a decodable GIF with one frame per time step", async () => {
    const lookup = new Map([
      ["N1", new Map(times.map((t, i) => [t, i + 1]))],
      ["N2", new Map(times.map((t, i) => [t, (i + 1) * 2]))],
    ]);
    const progress: Array<[number, number]> = [];
    const blob = await makeMapGif({
      fileName: "test.inp",
      geometry: {
        nodes: [
          { name: "N1", x: 0, y: 0 },
          { name: "N2", x: 100, y: 50 },
        ],
        links: [{ from: "N1", to: "N2" }],
      },
      metric: "Depth",
      unit: "ft",
      engines: [{ label: "Engine A", lookup }],
      onProgress: (d, t) => progress.push([d, t]),
    });

    expect(blob.type).toBe("image/gif");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(0, 6))).toBe("GIF89a");
    const gif = decodeGif(bytes);
    expect(gif.width).toBe(GIF_WIDTH);
    expect(gif.height).toBe(GIF_HEIGHT);
    expect(gif.frames).toHaveLength(times.length);
    // Frames actually contain drawn content and animate over time.
    for (const f of gif.frames) expect(countNonWhite(f)).toBeGreaterThan(100);
    expect(framesDiffer(gif.frames[0], gif.frames[gif.frames.length - 1])).toBe(true);
    expect(progress[progress.length - 1]).toEqual([times.length, times.length]);
  });

  it("makeChartGif produces a decodable GIF with one frame per cutoff", async () => {
    const blob = await makeChartGif({
      fileName: "test.inp",
      metric: "Depth",
      unit: "ft",
      engines: [
        { label: "Engine A", series: mkSeries("N1", times, [1, 4, 2, 3]) },
        { label: "Engine B", series: mkSeries("N1", times, [2, 3, 5, 1]) },
      ],
    });

    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(0, 6))).toBe("GIF89a");
    const gif = decodeGif(bytes);
    expect(gif.width).toBe(GIF_WIDTH);
    expect(gif.height).toBe(GIF_HEIGHT);
    expect(gif.frames).toHaveLength(times.length);
    // The chart reveals more of the line each frame, so content grows.
    for (const f of gif.frames) expect(countNonWhite(f)).toBeGreaterThan(100);
    expect(framesDiffer(gif.frames[0], gif.frames[gif.frames.length - 1])).toBe(true);
  });

  it("multi-engine map GIFs still decode with the full frame count", async () => {
    const mkLookup = (scale: number) =>
      new Map([["N1", new Map(times.map((t, i) => [t, (i + 1) * scale]))]]);
    const blob = await makeMapGif({
      fileName: "multi.inp",
      geometry: { nodes: [{ name: "N1", x: 0, y: 0 }], links: [] },
      metric: "Head",
      unit: "ft",
      engines: [
        { label: "A", lookup: mkLookup(1) },
        { label: "B", lookup: mkLookup(2) },
      ],
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(0, 6))).toBe("GIF89a");
    const gif = decodeGif(bytes);
    expect(gif.frames).toHaveLength(times.length);
    for (const f of gif.frames) expect(countNonWhite(f)).toBeGreaterThan(100);
  });
});
