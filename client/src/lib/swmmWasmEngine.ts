import type { ParsedMetrics, ProcessResult } from "@shared/schema";
import { applyInpOverrides, hasVirtualJunctions, stripVirtualJunctions, needsExtran8Hotstart, rewriteHotstartPath, type InpOverrides } from "@shared/inpOptions";
import { normalizeInpNameCase } from "@shared/inpCaseNormalize";

export interface WasmProgress {
  fileId: string;
  fileName: string;
  percentage: number;
  message: string;
}

export function parseReportMetricsClient(reportContent: string): ParsedMetrics {
  const metrics: ParsedMetrics = {};

  const runoffCE = reportContent.match(/Runoff Quantity Continuity[\s\S]*?Continuity Error \(%\)\s*\.+\s*([-\d.]+)/i);
  if (runoffCE) metrics.runoffContinuityError = parseFloat(runoffCE[1]);

  const routingCE = reportContent.match(/Flow Routing Continuity[\s\S]*?Continuity Error \(%\)\s*\.+\s*([-\d.]+)/i);
  if (routingCE) metrics.routingContinuityError = parseFloat(routingCE[1]);

  const precip = reportContent.match(/Total Precipitation\s*\.+\s*([\d.]+)/i);
  if (precip) metrics.totalPrecipitation = parseFloat(precip[1]);

  const runoff = reportContent.match(/Surface Runoff\s*\.+\s*([\d.]+)/i);
  if (runoff) metrics.surfaceRunoff = parseFloat(runoff[1]);

  const floodingMatch = reportContent.match(/Flooding was detected at (\d+) node/i);
  if (floodingMatch) {
    metrics.nodesFlooded = parseInt(floodingMatch[1], 10);
    metrics.floodingSummary = `${floodingMatch[1]} node(s) flooded`;
  } else if (/No nodes were flooded/i.test(reportContent)) {
    metrics.nodesFlooded = 0;
    metrics.floodingSummary = 'No flooding';
  }

  const routingMethod = reportContent.match(/Flow Routing Method\s*\.+\s*(\S+)/i);
  if (routingMethod) metrics.flowRoutingMethod = routingMethod[1];

  const infiltration = reportContent.match(/Infiltration Method\s*\.+\s*(\S+)/i);
  if (infiltration) metrics.infiltrationMethod = infiltration[1];

  const wetInflow = reportContent.match(/Wet Weather Inflow\s*\.+\s*([\d.]+)/i);
  if (wetInflow) metrics.totalInflow = parseFloat(wetInflow[1]);

  const extOutflow = reportContent.match(/External Outflow\s*\.+\s*([\d.]+)/i);
  if (extOutflow) metrics.totalOutflow = parseFloat(extOutflow[1]);

  const floodLoss = reportContent.match(/Flooding Loss\s*\.+\s*([\d.]+)/i);
  if (floodLoss) metrics.floodingLoss = parseFloat(floodLoss[1]);

  const issues = extractReportIssuesClient(reportContent);
  if (issues.warnings.length > 0) metrics.reportWarnings = issues.warnings;
  if (issues.errors.length > 0) metrics.reportErrors = issues.errors;

  return metrics;
}

const MAX_REPORT_ISSUES = 100;

export function extractReportIssuesClient(reportContent: string): { warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];
  for (const rawLine of reportContent.split('\n')) {
    const line = rawLine.trim();
    if (/^WARNING\b/i.test(line)) {
      if (warnings.length < MAX_REPORT_ISSUES) warnings.push(line);
    } else if (/^ERROR\b/i.test(line)) {
      if (errors.length < MAX_REPORT_ISSUES) errors.push(line);
    }
  }
  return { warnings, errors };
}

function validateSwmmReportClient(reportContent: string | undefined): { valid: boolean; reason?: string } {
  if (!reportContent || reportContent.trim().length === 0) {
    return { valid: false, reason: 'Report is empty — the engine did not produce output' };
  }
  if (!/EPA STORM WATER MANAGEMENT MODEL|OPENSWMM ENGINE/i.test(reportContent)) {
    return { valid: false, reason: 'Report is missing the SWMM engine header — output is not a valid SWMM report' };
  }
  const { errors } = extractReportIssuesClient(reportContent);
  if (errors.length > 0) {
    return { valid: false, reason: `SWMM reported error(s): ${errors.slice(0, 5).join('; ')}` };
  }
  return { valid: true };
}

function extractEngineVersionClient(reportContent: string): string | undefined {
  const m = reportContent.match(/(?:EPA STORM WATER MANAGEMENT MODEL|OPENSWMM ENGINE) - VERSION\s+([\d.]+(?:-[\w.]+)?)(?:\s*\(Build\s+([\d.]+)\))?/i);
  if (m) return m[2] || m[1];
  return undefined;
}

interface WorkerDoneMsg {
  type: 'done';
  id: string;
  fileName: string;
  ok: boolean;
  errMsg: string;
  warnings: number;
  rptText: string;
  elapsedMs: number;
}

// Files larger than this (bytes) force sequential processing to keep
// per-worker WASM heap usage in check.
const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10 MB
const MAX_WORKERS = 4;

export function computeWasmConcurrency(
  fileCount: number,
  maxFileSize: number,
  hardwareConcurrency: number = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2,
): number {
  if (maxFileSize > LARGE_FILE_THRESHOLD) return 1;
  return Math.max(1, Math.min(hardwareConcurrency - 1, fileCount, MAX_WORKERS));
}

export function runWasmBatch(
  files: { id: string; name: string; file: File }[],
  callbacks: {
    onFileStart: (fileIndex: number, fileName: string) => void;
    onProgress: (p: WasmProgress) => void;
    onResult: (r: ProcessResult) => void;
    onLog: (message: string, type: 'info' | 'success' | 'error') => void;
    onComplete: () => void;
  },
  cancelRef: { current: boolean },
  engine: 'swmm5' | 'swmm6' | 'swmm6dev' = 'swmm5',
  overrides?: InpOverrides,
  parallel: boolean = true,
): (() => void) & { skip: (fileId: string) => void } {
  const maxFileSize = files.reduce((m, f) => Math.max(m, f.file.size || 0), 0);
  const poolSize = parallel ? computeWasmConcurrency(files.length, maxFileSize) : 1;
  if (!parallel && files.length > 1) {
    callbacks.onLog('Parallel processing is off — running files one at a time.', 'info');
  } else if (maxFileSize > LARGE_FILE_THRESHOLD && files.length > 1) {
    callbacks.onLog(
      `Large model detected (${(maxFileSize / (1024 * 1024)).toFixed(1)} MB) — running files sequentially to conserve memory.`,
      'info',
    );
  } else if (poolSize > 1) {
    callbacks.onLog(`Running up to ${poolSize} simulations in parallel.`, 'info');
  }

  const workers: Worker[] = [];
  let index = 0;
  let startedCount = 0;
  let doneCount = 0;
  let terminated = false;
  let completed = false;

  // Terminates all workers and closes the batch WITHOUT signaling normal
  // completion. Used for cancellation and fatal worker errors.
  const cancel = () => {
    if (!terminated) {
      terminated = true;
      for (const w of workers) w.terminate();
      workers.length = 0;
    }
  };

  // Normal completion: only called after every file has produced a result
  // (or the batch was empty). Exactly-once.
  const finish = () => {
    if (completed || terminated) return;
    completed = true;
    cancel();
    callbacks.onComplete();
  };

  const inpTextById = new Map<string, string>();
  // Bundled hot start file bytes, fetched at most once per batch. The
  // in-flight promise is cached so parallel workers share one request.
  let hotstartPromise: Promise<ArrayBuffer | null> | undefined;
  const fetchHotstartBytes = (): Promise<ArrayBuffer | null> => {
    if (!hotstartPromise) {
      hotstartPromise = fetch('/api/samples/extran8.hsf')
        .then(res => (res.ok ? res.arrayBuffer() : null))
        .catch(() => null);
    }
    return hotstartPromise;
  };
  // Which file each worker is currently simulating, so a single stuck run can
  // be skipped (its worker terminated and replaced) without killing the batch.
  const currentByWorker = new Map<Worker, { id: string; name: string; startedAt: number }>();

  const runNext = async (worker: Worker) => {
    if (cancelRef.current || terminated) {
      cancel();
      return;
    }
    if (index >= files.length) {
      // No more work for this worker; finish once all in-flight files are done.
      if (doneCount >= files.length) finish();
      return;
    }
    const f = files[index];
    index++;
    startedCount++;
    currentByWorker.set(worker, { id: f.id, name: f.name, startedAt: Date.now() });
    callbacks.onFileStart(startedCount, f.name);
    callbacks.onLog(`Processing ${f.name} (${engine === 'swmm6' ? 'SWMM6' : engine === 'swmm6dev' ? 'SWMM6-dev' : 'SWMM5'} WASM in-browser engine)...`, 'info');
    callbacks.onProgress({ fileId: f.id, fileName: f.name, percentage: 0, message: 'Loading model...' });
    let inpText = await f.file.text();
    if (cancelRef.current || terminated) {
      cancel();
      return;
    }
    // The file may have been skipped (worker terminated and replaced) while we
    // were reading it — in that case this worker no longer owns the file.
    if (currentByWorker.get(worker)?.id !== f.id) return;
    if (overrides) {
      inpText = applyInpOverrides(inpText, overrides);
    }
    // Classic SWMM5 matches object names ignoring capitalization; the SWMM6
    // engine is case-strict (ERROR 209 on e.g. BOUNDARY@1020 vs Boundary@1020).
    // Normalize case-variant references to the defined spelling for SWMM6 runs.
    if (engine === 'swmm6' || engine === 'swmm6dev') {
      const normalized = normalizeInpNameCase(inpText);
      if (normalized.fixes.length > 0) {
        inpText = normalized.content;
        callbacks.onLog(
          `${f.name}: fixed name capitalization for the SWMM6 engine (SWMM5 ignores case, SWMM6 does not): ${normalized.fixes.join(', ')}`,
          'info',
        );
      }
    }
    // SWMM 5.x rejects the SWMM6 [VIRTUAL_JUNCTIONS] section outright. Round-
    // trip such models back to plain [JUNCTIONS] so they still run, and say so.
    if (engine === 'swmm5' && hasVirtualJunctions(inpText)) {
      const stripped = stripVirtualJunctions(inpText);
      inpText = stripped.content;
      callbacks.onLog(
        `${f.name}: [VIRTUAL_JUNCTIONS] is SWMM6-only — converted back to [JUNCTIONS] for this SWMM5 run. ${stripped.warnings.join(' ')}`,
        'info',
      );
    }
    // extran8* models reference a hot start file; fetch the bundled one and
    // hand it to the worker so the in-browser engine can find it.
    let auxFiles: { name: string; data: ArrayBuffer }[] | undefined;
    if (needsExtran8Hotstart(f.name, inpText)) {
      const hsf = await fetchHotstartBytes();
      if (hsf) {
        inpText = rewriteHotstartPath(inpText, '/extran8.hsf');
        auxFiles = [{ name: '/extran8.hsf', data: hsf }];
      } else {
        callbacks.onLog(`${f.name}: could not load bundled hot start file — run may fail.`, 'error');
      }
    }
    // Keep the input text so the result can show an INP tab like server runs.
    inpTextById.set(f.id, inpText);
    worker.postMessage({ type: 'run', id: f.id, fileName: f.name, inpText, engine, auxFiles });
  };

  const handleDone = (worker: Worker, d: WorkerDoneMsg) => {
    // Ignore stale done messages: only accept a result from the worker that is
    // still assigned to that exact file (protects against a done event queued
    // just before the file was skipped or the batch cancelled).
    if (terminated || completed || currentByWorker.get(worker)?.id !== d.id) return;
    currentByWorker.delete(worker);
    const metrics = d.rptText ? parseReportMetricsClient(d.rptText) : undefined;
    const engineName = engine === 'swmm6' ? 'wasm6' : engine === 'swmm6dev' ? 'wasm6dev' : 'wasm';

    let ok = d.ok;
    let error = ok ? undefined : (d.errMsg || 'Simulation failed');
    if (ok) {
      const validation = validateSwmmReportClient(d.rptText);
      if (!validation.valid) {
        ok = false;
        error = validation.reason;
      }
    }

    const result: ProcessResult = {
      id: d.id,
      fileName: d.fileName,
      filePath: d.fileName,
      status: ok ? 'success' : 'failed',
      error,
      processingTime: d.elapsedMs / 1000,
      reportContent: d.rptText || undefined,
      inpContent: inpTextById.get(d.id),
      parsedMetrics: metrics,
      provenance: {
        requestedEngine: engineName,
        actualEngine: engineName,
        engineVersion: d.rptText ? extractEngineVersionClient(d.rptText) : undefined,
        startedAt: new Date(Date.now() - d.elapsedMs).toISOString(),
        completedAt: new Date().toISOString(),
      },
    };
    callbacks.onResult(result);
    callbacks.onLog(
      ok
        ? `${d.fileName} -- Success (${(d.elapsedMs / 1000).toFixed(1)}s, WASM)${d.warnings ? `, ${d.warnings} warning(s)` : ''}`
        : `${d.fileName} -- Error: ${error || 'Unknown error'}`,
      ok ? 'success' : 'error',
    );
    doneCount++;
    if (doneCount >= files.length) {
      finish();
    } else {
      runNext(worker);
    }
  };

  // Fatal worker error: stop everything, but still signal completion so the
  // UI does not hang (mirrors the previous single-worker behavior).
  const failBatch = () => {
    if (completed) return;
    completed = true;
    cancel();
    callbacks.onComplete();
  };

  const spawnWorker = (): Worker => {
    const worker = new Worker('/wasm/swmm-worker.js');
    workers.push(worker);

    worker.onmessage = (e: MessageEvent) => {
      const data = e.data;
      if (data.type === 'progress') {
        callbacks.onProgress({
          fileId: data.id,
          fileName: data.fileName,
          percentage: data.percentage,
          message: data.message,
        });
      } else if (data.type === 'done') {
        handleDone(worker, data as WorkerDoneMsg);
      }
    };

    worker.onerror = (err) => {
      callbacks.onLog(`WASM worker error: ${err.message}`, 'error');
      failBatch();
    };
    return worker;
  };

  // Skip a single stuck run: terminate just that file's worker, record the
  // file as failed, and continue the rest of the batch on a fresh worker.
  const skip = (fileId: string) => {
    if (terminated || completed) return;
    let target: Worker | undefined;
    let info: { id: string; name: string; startedAt: number } | undefined;
    for (const [w, cur] of currentByWorker) {
      if (cur.id === fileId) {
        target = w;
        info = cur;
        break;
      }
    }
    if (!target || !info) return;

    currentByWorker.delete(target);
    target.terminate();
    const idx = workers.indexOf(target);
    if (idx !== -1) workers.splice(idx, 1);

    const elapsedMs = Date.now() - info.startedAt;
    const engineName = engine === 'swmm6' ? 'wasm6' : engine === 'swmm6dev' ? 'wasm6dev' : 'wasm';
    callbacks.onResult({
      id: info.id,
      fileName: info.name,
      filePath: info.name,
      status: 'failed',
      error: `Terminated by user after ${(elapsedMs / 1000).toFixed(1)}s`,
      processingTime: elapsedMs / 1000,
      inpContent: inpTextById.get(info.id),
      provenance: {
        requestedEngine: engineName,
        actualEngine: engineName,
        startedAt: new Date(info.startedAt).toISOString(),
        completedAt: new Date().toISOString(),
      },
    });
    callbacks.onLog(`${info.name} -- Terminated by user (skipped after ${(elapsedMs / 1000).toFixed(1)}s)`, 'error');
    doneCount++;
    if (doneCount >= files.length) {
      finish();
    } else if (index < files.length) {
      runNext(spawnWorker());
    }
  };

  for (let i = 0; i < poolSize; i++) spawnWorker();

  if (files.length === 0) {
    finish();
  } else {
    for (const w of [...workers]) runNext(w);
  }
  return Object.assign(cancel, { skip });
}
