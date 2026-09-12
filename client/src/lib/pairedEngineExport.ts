import JSZip from "jszip";
import type { ProcessResult } from "@shared/schema";
import {
  getWasmNativeArtifactState,
  type WasmNativeArtifacts,
} from "./wasmArtifacts";

export interface PairedEngineResults {
  swmm5: ProcessResult;
  swmm6: ProcessResult;
}

export interface PairedExportProgress {
  phase: "validating" | "building" | "compressing";
  percentage: number;
  message: string;
}

export interface PairedExportOptions {
  onProgress?: (progress: PairedExportProgress) => void;
}

export const MAX_PAIRED_EXPORT_BYTES = 512 * 1024 * 1024;

export class PairedExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PairedExportError";
  }
}

/**
 * Convert a user/model filename into a safe single ZIP entry basename.
 * Paths, control characters, dot segments, and archive separators are never
 * allowed to reach JSZip.
 */
export function sanitizePairedModelName(fileName: string): string {
  const source = fileName
    .replace(/\\/g, "/")
    .split("/")
    .pop() || "model.inp";
  const withoutExtension = source.replace(/\.inp$/i, "");
  const safe = withoutExtension
    .replace(/[\u0000-\u001f\u007f]/g, "_")
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .replace(/\.{2,}/g, "_")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 120)
    .trim();
  return safe && safe !== "." && safe !== ".." ? safe : "model";
}

function uniqueBaseName(base: string, used: Set<string>): string {
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base}-${suffix++}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function engineFolder(engine: "swmm5" | "swmm6"): "SWMM5" | "SWMM6" {
  return engine === "swmm5" ? "SWMM5" : "SWMM6";
}

function nativeArtifactsFor(
  engine: "swmm5" | "swmm6",
  result: ProcessResult,
): WasmNativeArtifacts {
  if (result.status !== "success") {
    throw new PairedExportError(
      `${engineFolder(engine)} did not complete successfully; rerun the paired comparison before exporting native files.`,
    );
  }
  const state = getWasmNativeArtifactState(result);
  if (state?.error) {
    throw new PairedExportError(`${engineFolder(engine)} native artifacts are unavailable: ${state.error}`);
  }
  if (!state?.artifacts) {
    throw new PairedExportError(
      `Native ${engineFolder(engine)} report/output bytes are not available for this result. ` +
      "This result predates local paired export; rerun both engines in QA/QC or Coherence.",
    );
  }
  return state.artifacts;
}

function effectiveInputBytes(result: ProcessResult, engine: "swmm5" | "swmm6"): Uint8Array {
  if (!result.inpContent) {
    throw new PairedExportError(
      `Effective INP for ${engineFolder(engine)} is unavailable. Rerun the paired comparison before exporting.`,
    );
  }
  return new TextEncoder().encode(result.inpContent);
}

function manifestEntry(
  engine: "swmm5" | "swmm6",
  result: ProcessResult,
  paths: { inp: string; rpt: string; out: string },
  artifacts: WasmNativeArtifacts,
) {
  return {
    engine: engineFolder(engine),
    requestedEngine: result.provenance?.requestedEngine,
    actualEngine: result.provenance?.actualEngine,
    engineVersion: result.provenance?.engineVersion || null,
    sourceFileName: result.fileName,
    effectiveFileName: paths.inp,
    effectiveInputFile: paths.inp,
    nativeReportFile: paths.rpt,
    nativeOutputFile: paths.out,
    evidence: {
      input: "ProcessResult.inpContent after browser engine overrides/normalization",
      report: "Exact bytes read from the engine report file before UI time-series augmentation",
      output: "Exact bytes read from the engine binary output file before worker cleanup",
      reportIsUiAugmented: false,
      outputIsBinary: true,
    },
    byteLengths: {
      inp: result.inpContent ? new TextEncoder().encode(result.inpContent).byteLength : 0,
      rpt: artifacts.report.byteLength,
      out: artifacts.output.byteLength,
    },
    status: result.status,
    completedAt: result.provenance?.completedAt || null,
  };
}

/**
 * Build the session-only browser export for one completed SWMM5/SWMM6 pair.
 *
 * Native report and output files are intentionally taken from the WeakMap
 * artifact store rather than result.reportContent.  The latter is augmented
 * for charts and is not a faithful native report.
 */
export async function buildPairedEngineZip(
  paired: PairedEngineResults,
  options: PairedExportOptions = {},
): Promise<{ zip: JSZip; fileCount: number }> {
  const { swmm5, swmm6 } = paired;
  options.onProgress?.({
    phase: "validating",
    percentage: 0,
    message: "Checking native browser artifacts…",
  });

  const a5 = nativeArtifactsFor("swmm5", swmm5);
  const a6 = nativeArtifactsFor("swmm6", swmm6);
  const inp5 = effectiveInputBytes(swmm5, "swmm5");
  const inp6 = effectiveInputBytes(swmm6, "swmm6");
  const totalBytes = a5.report.byteLength + a5.output.byteLength +
    a6.report.byteLength + a6.output.byteLength +
    inp5.byteLength + inp6.byteLength;
  if (totalBytes > MAX_PAIRED_EXPORT_BYTES) {
    throw new PairedExportError(
      `The paired native export is ${(totalBytes / (1024 * 1024)).toFixed(1)} MiB, above the browser safety limit of ${MAX_PAIRED_EXPORT_BYTES / (1024 * 1024)} MiB.`,
    );
  }

  const zip = new JSZip();
  const base = sanitizePairedModelName(swmm5.fileName || swmm6.fileName);
  // A single pair normally has one basename. Keep this allocator so callers
  // cannot create a path collision if a future pairing source supplies names
  // that sanitize to the same value.
  const baseName = uniqueBaseName(base, new Set<string>());
  const paths = {
    swmm5: {
      inp: `SWMM5/${baseName}.inp`,
      rpt: `SWMM5/${baseName}.rpt`,
      out: `SWMM5/${baseName}.out`,
    },
    swmm6: {
      inp: `SWMM6/${baseName}.inp`,
      rpt: `SWMM6/${baseName}.rpt`,
      out: `SWMM6/${baseName}.out`,
    },
  };

  options.onProgress?.({
    phase: "building",
    percentage: 25,
    message: "Adding effective INP and native engine files…",
  });
  zip.file(paths.swmm5.inp, inp5);
  zip.file(paths.swmm5.rpt, a5.report);
  zip.file(paths.swmm5.out, a5.output);
  zip.file(paths.swmm6.inp, inp6);
  zip.file(paths.swmm6.rpt, a6.report);
  zip.file(paths.swmm6.out, a6.output);

  const manifest = {
    format: "batch-swmm-paired-browser-native-v1",
    generatedAt: new Date().toISOString(),
    model: {
      sourceFileName: swmm5.fileName,
      safeBaseName: baseName,
    },
    engines: [
      manifestEntry("swmm5", swmm5, paths.swmm5, a5),
      manifestEntry("swmm6", swmm6, paths.swmm6, a6),
    ],
  };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2) + "\n");

  options.onProgress?.({
    phase: "compressing",
    percentage: 50,
    message: "Compressing native files…",
  });
  return {
    zip,
    fileCount: 6,
  };
}

export function pairedExportAvailability(
  paired: PairedEngineResults | null | undefined,
): { ready: boolean; message?: string } {
  if (!paired) return { ready: false, message: "Run both browser engines before exporting native files." };
  for (const [engine, result] of [["swmm5", paired.swmm5], ["swmm6", paired.swmm6]] as const) {
    if (result.status !== "success") {
      return { ready: false, message: `${engineFolder(engine)} did not complete successfully; rerun the paired comparison.` };
    }
    const state = getWasmNativeArtifactState(result);
    if (state?.error) return { ready: false, message: state.error };
    if (!state?.artifacts) {
      return {
        ready: false,
        message: "Native browser artifacts are missing from this older batch result; rerun both engines in QA/QC or Coherence to enable export.",
      };
    }
  }
  return { ready: true };
}

export async function downloadPairedEngineZip(
  paired: PairedEngineResults,
  options: PairedExportOptions = {},
): Promise<void> {
  const { zip } = await buildPairedEngineZip(paired, options);
  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
  }, metadata => {
    options.onProgress?.({
      phase: "compressing",
      percentage: 50 + Math.round(metadata.percent / 2),
      message: `Compressing native files… ${Math.round(metadata.percent)}%`,
    });
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizePairedModelName(paired.swmm5.fileName)}-SWMM5-SWMM6-native.zip`;
  link.click();
  URL.revokeObjectURL(url);
}
