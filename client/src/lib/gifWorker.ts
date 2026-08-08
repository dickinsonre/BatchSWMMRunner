// Web worker that draws and encodes GIF frames off the main thread.
// Receives a job via postMessage (Maps survive structured clone), reports
// per-frame progress, and transfers the finished GIF bytes back.

import { renderMapGif, renderChartGif, type MapGifData, type ChartGifData } from "./gifRender";

export type GifWorkerRequest =
  | { kind: "map"; input: MapGifData }
  | { kind: "chart"; input: ChartGifData };

export type GifWorkerResponse =
  | { type: "progress"; done: number; total: number }
  | { type: "done"; bytes: Uint8Array }
  | { type: "error"; message: string };

self.onmessage = async (e: MessageEvent<GifWorkerRequest>) => {
  const post = (msg: GifWorkerResponse, transfer?: Transferable[]) =>
    (self as unknown as Worker).postMessage(msg, transfer ?? []);
  try {
    const opts = {
      onProgress: (done: number, total: number) => post({ type: "progress", done, total }),
    };
    const bytes = e.data.kind === "map"
      ? await renderMapGif(e.data.input, opts)
      : await renderChartGif(e.data.input, opts);
    post({ type: "done", bytes }, [bytes.buffer]);
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : "GIF rendering failed." });
  }
};
