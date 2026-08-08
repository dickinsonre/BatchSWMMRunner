// Turns simulation results into animated GIFs, entirely in the browser.
// Two animation styles:
//  - "map": the network map with nodes colored by a result value as time advances
//  - "chart": a time-series chart drawing itself over time
//
// Frame drawing + encoding runs in a web worker (OffscreenCanvas) so large
// models don't freeze the page; a main-thread fallback covers old browsers.
// The pure rendering code lives in gifRender.ts, shared with the worker.

import type { ParsedInpFile } from "./inpParser";
import {
  renderMapGif, renderChartGif,
  type MapGifData, type ChartGifData, type MapGeometry, type RenderOptions,
} from "./gifRender";
import type { GifWorkerRequest, GifWorkerResponse } from "./gifWorker";

export {
  GIF_WIDTH, GIF_HEIGHT, MAX_FRAMES, FRAME_DELAY_MS, ENGINE_GIF_COLORS,
  sampleFrameTimes, buildValueLookup, unionTimes,
} from "./gifRender";

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

type Progress = (done: number, total: number) => void;

export interface MapGifInput extends MapGifData { onProgress?: Progress }
export interface ChartGifInput extends ChartGifData { onProgress?: Progress }

function workerSupported(): boolean {
  return typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined";
}

/** Run a GIF job in a dedicated worker; resolves with the encoded bytes. */
function runInWorker(request: GifWorkerRequest, onProgress?: Progress): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./gifWorker.ts", import.meta.url), { type: "module" });
    const done = (fn: () => void) => { worker.terminate(); fn(); };
    worker.onmessage = (e: MessageEvent<GifWorkerResponse>) => {
      const msg = e.data;
      if (msg.type === "progress") onProgress?.(msg.done, msg.total);
      else if (msg.type === "done") done(() => resolve(msg.bytes));
      else done(() => reject(new Error(msg.message)));
    };
    worker.onerror = (e) => done(() => reject(new Error(e.message || "GIF worker failed to start.")));
    worker.postMessage(request);
  });
}

/** Main-thread fallback: yields between frames so the UI can still update. */
function mainThreadOptions(onProgress?: Progress): RenderOptions {
  return {
    onProgress,
    yieldBetweenFrames: () => new Promise(r => setTimeout(r, 0)),
  };
}

async function makeGif(request: GifWorkerRequest, onProgress?: Progress): Promise<Blob> {
  let bytes: Uint8Array;
  if (workerSupported()) {
    try {
      bytes = await runInWorker(request, onProgress);
    } catch (err) {
      // Worker-infrastructure failures (e.g. CSP blocking workers) fall back to
      // the main thread; real rendering errors are re-thrown for the user.
      if (err instanceof Error && /worker/i.test(err.message)) {
        bytes = request.kind === "map"
          ? await renderMapGif(request.input, mainThreadOptions(onProgress))
          : await renderChartGif(request.input, mainThreadOptions(onProgress));
      } else {
        throw err;
      }
    }
  } else {
    bytes = request.kind === "map"
      ? await renderMapGif(request.input, mainThreadOptions(onProgress))
      : await renderChartGif(request.input, mainThreadOptions(onProgress));
  }
  return new Blob([bytes as BlobPart], { type: "image/gif" });
}

export async function makeMapGif(input: MapGifInput): Promise<Blob> {
  const { onProgress, ...data } = input;
  return makeGif({ kind: "map", input: data }, onProgress);
}

export async function makeChartGif(input: ChartGifInput): Promise<Blob> {
  const { onProgress, ...data } = input;
  return makeGif({ kind: "chart", input: data }, onProgress);
}
