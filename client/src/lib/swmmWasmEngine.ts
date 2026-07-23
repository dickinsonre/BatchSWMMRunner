import type { ParsedMetrics, ProcessResult } from "@shared/schema";

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
  if (!/EPA STORM WATER MANAGEMENT MODEL/i.test(reportContent)) {
    return { valid: false, reason: 'Report is missing the EPA SWMM header — output is not a valid SWMM report' };
  }
  const { errors } = extractReportIssuesClient(reportContent);
  if (errors.length > 0) {
    return { valid: false, reason: `SWMM reported error(s): ${errors.slice(0, 5).join('; ')}` };
  }
  return { valid: true };
}

function extractEngineVersionClient(reportContent: string): string | undefined {
  const m = reportContent.match(/EPA STORM WATER MANAGEMENT MODEL - VERSION\s+([\d.]+)(?:\s*\(Build\s+([\d.]+)\))?/i);
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
  engine: 'swmm5' | 'swmm6' = 'swmm5',
): () => void {
  const worker = new Worker('/wasm/swmm-worker.js');
  let index = 0;
  let terminated = false;

  const terminate = () => {
    if (!terminated) {
      terminated = true;
      worker.terminate();
    }
  };

  const runNext = async () => {
    if (cancelRef.current || index >= files.length) {
      terminate();
      callbacks.onComplete();
      return;
    }
    const f = files[index];
    index++;
    callbacks.onFileStart(index, f.name);
    callbacks.onLog(`Processing ${f.name} (${engine === 'swmm6' ? 'SWMM6' : 'SWMM5'} WASM in-browser engine)...`, 'info');
    callbacks.onProgress({ fileId: f.id, fileName: f.name, percentage: 0, message: 'Loading model...' });
    const inpText = await f.file.text();
    worker.postMessage({ type: 'run', id: f.id, fileName: f.name, inpText, engine });
  };

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
      const d = data as WorkerDoneMsg;
      const metrics = d.rptText ? parseReportMetricsClient(d.rptText) : undefined;
      const engineName = engine === 'swmm6' ? 'wasm6' : 'wasm';

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
      runNext();
    }
  };

  worker.onerror = (err) => {
    callbacks.onLog(`WASM worker error: ${err.message}`, 'error');
    terminate();
    callbacks.onComplete();
  };

  runNext();
  return terminate;
}
