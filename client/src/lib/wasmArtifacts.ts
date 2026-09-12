import type { ProcessResult } from "@shared/schema";

/**
 * Native files produced by one browser run.
 *
 * These bytes deliberately live outside ProcessResult.  Results are copied into
 * batch summaries and can be serialized for the dashboard/server; putting an
 * ArrayBuffer on that object would either lose the bytes or accidentally turn
 * a large browser-only artifact into JSON/base64.  A WeakMap keeps the files
 * available for this tab while allowing a result and its artifacts to be
 * collected together.
 */
export interface WasmNativeArtifacts {
  /** The report as written by the engine, before graph time-series sections. */
  report: ArrayBuffer;
  /** The binary output as written by the engine. */
  output: ArrayBuffer;
}

export interface WasmNativeArtifactState {
  artifacts?: WasmNativeArtifacts;
  /** Set when opt-in retention was requested but a memory guard rejected it. */
  error?: string;
}

const nativeArtifacts = new WeakMap<object, WasmNativeArtifactState>();

export function setWasmNativeArtifacts(
  result: ProcessResult,
  state: WasmNativeArtifactState,
): void {
  nativeArtifacts.set(result, state);
}

export function getWasmNativeArtifactState(
  result: ProcessResult,
): WasmNativeArtifactState | undefined {
  return nativeArtifacts.get(result);
}

export function getWasmNativeArtifacts(
  result: ProcessResult,
): WasmNativeArtifacts | undefined {
  return nativeArtifacts.get(result)?.artifacts;
}
