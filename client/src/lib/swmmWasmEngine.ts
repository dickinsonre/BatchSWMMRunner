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

  return metrics;
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
      const result: ProcessResult = {
        id: d.id,
        fileName: d.fileName,
        filePath: d.fileName,
        status: d.ok ? 'success' : 'failed',
        error: d.ok ? undefined : (d.errMsg || 'Simulation failed'),
        processingTime: d.elapsedMs / 1000,
        reportContent: d.rptText || undefined,
        parsedMetrics: metrics,
      };
      callbacks.onResult(result);
      callbacks.onLog(
        d.ok
          ? `${d.fileName} -- Success (${(d.elapsedMs / 1000).toFixed(1)}s, WASM)${d.warnings ? `, ${d.warnings} warning(s)` : ''}`
          : `${d.fileName} -- Error: ${d.errMsg || 'Unknown error'}`,
        d.ok ? 'success' : 'error',
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
