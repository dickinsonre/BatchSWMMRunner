import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation } from "wouter";
import { PITCH_SEEN_KEY } from "@/pages/ElevatorPitch";
import { CheckCircle2, AlertTriangle, ExternalLink, PlayCircle, StopCircle, Cpu, Terminal, Globe, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import AppHeader from "@/components/AppHeader";
import FileUploadZone from "@/components/FileUploadZone";
import FileListPanel, { type FileItem } from "@/components/FileListPanel";
import ProgressSection, { type FileProgressInfo } from "@/components/ProgressSection";
import ResultsDisplay, { type ProcessResult } from "@/components/ResultsDisplay";
import WorkflowSteps from "@/components/WorkflowSteps";
import InstructionsPanel from "@/components/InstructionsPanel";
import ExpectedOutputs from "@/components/ExpectedOutputs";
import SimulationSettings from "@/components/SimulationSettings";
import ProcessingLog, { type LogEntry } from "@/components/ProcessingLog";
import SampleModels from "@/components/SampleModels";
import GitHubModels from "@/components/GitHubModels";
import LiveApiDashboard, { type ApiSnapshotEntry, MAX_SNAPSHOTS_PER_FILE } from "@/components/LiveApiDashboard";
import { runWasmBatch } from "@/lib/swmmWasmEngine";
import EngineComparisonView from "@/components/EngineComparisonView";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import SystemComparisonChart from "@/components/SystemComparisonChart";
import EngineScatterCompare from "@/components/EngineScatterCompare";
import GifMakerTool from "@/components/GifMakerTool";
import { ENGINE_LABELS, type EngineId, type EngineRun } from "@/lib/engineComparison";
import type { SwmmStatus } from "@shared/schema";
import type { Swmm6Options } from "@shared/inpOptions";

type ProcessingState = 'idle' | 'processing' | 'completed';

const SETTINGS_KEY = 'batchswmm-settings';

interface PersistedSettings {
  reportStep?: number;
  routingMethod?: string;
  parallelProcessing?: boolean;
  stopOnError?: boolean;
  timeoutMinutes?: number;
  engineMode?: 'executable' | 'api' | 'wasm' | 'wasm6';
  selectedEngines?: EngineId[];
  startDate?: string;
  endDate?: string;
  routingStepSeconds?: number | null;
  swmm6Options?: Swmm6Options;
}

function loadSettings(): PersistedSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/** Pull the server's JSON error message out of a failed response, if any. */
async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body.error === 'string' && body.error.trim()) return body.error;
  } catch { /* not JSON */ }
  return fallback;
}

// Hosting infrastructure caps a single HTTP request at ~32 MB, so large
// batches are uploaded in several smaller chunks: the first chunk creates the
// job, the rest are appended to it before the batch starts.
const UPLOAD_CHUNK_BYTES = 20 * 1024 * 1024;

export interface UploadProgress {
  /** 1-based index of the chunk currently uploading. */
  current: number;
  total: number;
  sentBytes: number;
  totalBytes: number;
}

/**
 * POST a FormData body via XMLHttpRequest so byte-level upload progress can be
 * reported (fetch() cannot observe request-body upload progress). Polls
 * `isCancelled` so an in-flight chunk aborts promptly on cancellation.
 */
function postFormDataWithProgress(
  url: string,
  formData: FormData,
  onUploadedBytes?: (loaded: number, total: number) => void,
  isCancelled?: () => boolean,
): Promise<{ ok: boolean; status: number; json: () => Promise<any> }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.responseType = 'text';

    let cancelPoll: ReturnType<typeof setInterval> | null = null;
    const clearPoll = () => {
      if (cancelPoll !== null) {
        clearInterval(cancelPoll);
        cancelPoll = null;
      }
    };
    if (isCancelled) {
      cancelPoll = setInterval(() => {
        if (isCancelled()) {
          clearPoll();
          xhr.abort();
        }
      }, 250);
    }

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onUploadedBytes?.(e.loaded, e.total);
    };
    xhr.onload = () => {
      clearPoll();
      const status = xhr.status;
      const text = xhr.responseText;
      resolve({
        ok: status >= 200 && status < 300,
        status,
        json: async () => JSON.parse(text),
      });
    };
    xhr.onerror = () => {
      clearPoll();
      reject(new Error('Network error during upload'));
    };
    xhr.onabort = () => {
      clearPoll();
      reject(new Error('Comparison cancelled'));
    };
    xhr.send(formData);
  });
}

async function uploadFilesChunked(
  fileItems: any[],
  isCancelled?: () => boolean,
  onProgress?: (progress: UploadProgress) => void,
): Promise<any> {
  const toSend: File[] = fileItems.map(f => f.file).filter((f: any): f is File => !!f);
  const chunks: File[][] = [];
  let current: File[] = [];
  let currentBytes = 0;
  for (const file of toSend) {
    if (current.length > 0 && currentBytes + file.size > UPLOAD_CHUNK_BYTES) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(file);
    currentBytes += file.size;
  }
  if (current.length > 0) chunks.push(current);

  const totalBytes = toSend.reduce((acc, f) => acc + f.size, 0);
  let sentBytes = 0;
  let batchJob: any = null;
  for (let i = 0; i < chunks.length; i++) {
    if (isCancelled?.()) {
      if (batchJob) fetch(`/api/batch/${batchJob.id}`, { method: 'DELETE' }).catch(() => { /* best effort */ });
      throw new Error('Comparison cancelled');
    }
    onProgress?.({ current: i + 1, total: chunks.length, sentBytes, totalBytes });
    const formData = new FormData();
    chunks[i].forEach(file => formData.append('files', file));
    const url = i === 0 ? '/api/upload' : `/api/batch/${batchJob.id}/files`;
    const chunkBytes = chunks[i].reduce((acc, f) => acc + f.size, 0);
    let res;
    try {
      res = await postFormDataWithProgress(
        url,
        formData,
        (loaded, total) => {
          // Scale by the chunk's file bytes: the XHR total includes multipart
          // boundary overhead, so map proportionally onto the real byte count.
          const inChunk = total > 0 ? Math.min(chunkBytes, (loaded / total) * chunkBytes) : 0;
          onProgress?.({ current: i + 1, total: chunks.length, sentBytes: sentBytes + inChunk, totalBytes });
        },
        isCancelled,
      );
    } catch (err) {
      if (batchJob) fetch(`/api/batch/${batchJob.id}`, { method: 'DELETE' }).catch(() => { /* best effort */ });
      throw err;
    }
    if (!res.ok) {
      if (batchJob) fetch(`/api/batch/${batchJob.id}`, { method: 'DELETE' }).catch(() => { /* best effort */ });
      let message = 'Failed to upload files';
      try {
        const body = await res.json();
        if (body && typeof body.error === 'string' && body.error.trim()) message = body.error;
      } catch { /* not JSON */ }
      throw new Error(message);
    }
    sentBytes += chunkBytes;
    onProgress?.({ current: i + 1, total: chunks.length, sentBytes, totalBytes });
    batchJob = await res.json();
  }
  return batchJob;
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}

export default function Home() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [processingState, setProcessingState] = useState<ProcessingState>('idle');
  const [currentFile, setCurrentFile] = useState(0);
  const [results, setResults] = useState<ProcessResult[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState<string>('');
  const [invalidFiles, setInvalidFiles] = useState<string[]>([]);
  const savedSettingsRef = useRef<PersistedSettings>(loadSettings());
  const [reportStep, setReportStep] = useState(savedSettingsRef.current.reportStep ?? 15);
  const [routingMethod, setRoutingMethod] = useState(savedSettingsRef.current.routingMethod ?? "dynamic");
  const [parallelProcessing, setParallelProcessing] = useState(savedSettingsRef.current.parallelProcessing ?? false);
  const [stopOnError, setStopOnError] = useState(savedSettingsRef.current.stopOnError ?? false);
  const [timeoutMinutes, setTimeoutMinutes] = useState(savedSettingsRef.current.timeoutMinutes ?? 10);
  const [startDate, setStartDate] = useState(savedSettingsRef.current.startDate ?? '');
  const [endDate, setEndDate] = useState(savedSettingsRef.current.endDate ?? '');
  const [routingStepSeconds, setRoutingStepSeconds] = useState<number | null>(savedSettingsRef.current.routingStepSeconds ?? null);
  const [swmm6Options, setSwmm6Options] = useState<Swmm6Options>(savedSettingsRef.current.swmm6Options ?? {});
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [swmmStatus, setSwmmStatus] = useState<SwmmStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [selectedEngines, setSelectedEngines] = useState<EngineId[]>(() => {
    const saved = savedSettingsRef.current.selectedEngines;
    if (Array.isArray(saved) && saved.length > 0) {
      const valid = saved.filter((e): e is EngineId => ['executable', 'api', 'wasm', 'wasm6'].includes(e));
      if (valid.length > 0) return valid;
    }
    return [savedSettingsRef.current.engineMode ?? 'executable'];
  });
  const engineMode = selectedEngines[0];
  const setEngineMode = (mode: EngineId | ((prev: EngineId) => EngineId)) => {
    setSelectedEngines(prev => {
      const next = typeof mode === 'function' ? mode(prev[0]) : mode;
      return [next];
    });
  };
  const toggleEngine = (engine: EngineId) => {
    setSelectedEngines(prev => {
      if (prev.includes(engine)) {
        const next = prev.filter(e => e !== engine);
        return next.length > 0 ? next : prev; // always keep at least one
      }
      return [...prev, engine];
    });
  };
  const compareMode = selectedEngines.length > 1;
  const [comparisonRuns, setComparisonRuns] = useState<EngineRun[] | null>(null);
  const [activeComparisonEngine, setActiveComparisonEngine] = useState<string | null>(null);
  const comparisonCancelRef = useRef<{ cancelled: boolean; jobId: string | null }>({ cancelled: false, jobId: null });
  const wasmCancelRef = useRef<{ current: boolean }>({ current: false });
  const wasmTerminateRef = useRef<((() => void) & { skip: (fileId: string) => void }) | null>(null);
  const [fileProgressMap, setFileProgressMap] = useState<Map<string, FileProgressInfo>>(new Map());
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [apiSnapshots, setApiSnapshots] = useState<ApiSnapshotEntry[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const totalSize = files.reduce((acc, f: any) => acc + (f.file?.size || 0), 0);

  useEffect(() => {
    const settings: PersistedSettings = {
      reportStep, routingMethod, parallelProcessing, stopOnError,
      timeoutMinutes, engineMode, selectedEngines,
      startDate, endDate, routingStepSeconds, swmm6Options,
    };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // localStorage unavailable (private mode, quota) — settings simply won't persist
    }
  }, [reportStep, routingMethod, parallelProcessing, stopOnError, timeoutMinutes, engineMode, selectedEngines, startDate, endDate, routingStepSeconds, swmm6Options]);

  // Warn before tab close while an in-browser WASM batch is running,
  // since Web Worker simulations die with the tab.
  useEffect(() => {
    const isWasmRunning = processingState === 'processing' && selectedEngines.some(e => e === 'wasm' || e === 'wasm6');
    if (!isWasmRunning) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [processingState, selectedEngines]);

  // SWMM6-only keywords are dropped for every engine except the in-browser
  // SWMM6 engine — SWMM 5.x rejects each of them with ERROR 205.
  const buildOverrides = (engine: EngineId = engineMode) => ({
    reportStepMinutes: reportStep > 0 ? reportStep : undefined,
    flowRouting: routingMethod || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    routingStepSeconds: routingStepSeconds && routingStepSeconds > 0 ? routingStepSeconds : undefined,
    swmm6: engine === 'wasm6' && swmm6Options.enabled ? swmm6Options : undefined,
  });

  useEffect(() => {
    fetch('/api/swmm-status')
      .then(res => res.json())
      .then((data: SwmmStatus) => {
        setSwmmStatus(data);
        // Drop engines the server can't actually run; fall back to WASM.
        setSelectedEngines(prev => {
          const mapped = prev.map((e): EngineId => {
            if (e === 'executable' && !data.found) return 'wasm';
            if (e === 'api' && !data.apiAvailable) return data.found ? 'executable' : 'wasm';
            return e;
          });
          const deduped = Array.from(new Set(mapped));
          return deduped.length > 0 ? deduped : ['wasm'];
        });
      })
      .catch(err => {
        console.error('Failed to fetch SWMM status:', err);
        setStatusError(true);
      });

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      wasmCancelRef.current.current = true;
      comparisonCancelRef.current.cancelled = true;
      if (wasmTerminateRef.current) {
        wasmTerminateRef.current();
        wasmTerminateRef.current = null;
      }
      if (browserRunFinishRef.current) {
        browserRunFinishRef.current();
        browserRunFinishRef.current = null;
      }
    };
  }, []);

  const getTimestamp = () => {
    const now = new Date();
    return now.toISOString().replace('T', ' ').substring(0, 19);
  };

  const connectWebSocket = (jobId: string) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws?jobId=${jobId}`);

    ws.onopen = () => {
      console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'progress') {
        setCurrentFile(data.currentFile);
        setLogs(prev => [...prev, {
          timestamp: getTimestamp(),
          message: `Processing ${data.fileName}...`,
          type: 'info'
        }]);
        setFileProgressMap(prev => {
          const next = new Map(prev);
          const key = data.fileId || data.fileName;
          next.set(key, {
            fileId: key,
            fileName: data.fileName,
            percentage: 0,
            message: 'Starting...',
            status: 'running',
          });
          return next;
        });
      } else if (data.type === 'file_progress') {
        setFileProgressMap(prev => {
          const next = new Map(prev);
          next.set(data.fileId, {
            fileId: data.fileId,
            fileName: data.fileName,
            percentage: data.percentage,
            message: data.message,
            status: 'running',
          });
          return next;
        });
      } else if (data.type === 'log') {
        setLogs(prev => [...prev, {
          timestamp: getTimestamp(),
          message: data.text,
          type: data.stream === 'stderr' ? 'stderr' : 'stdout',
          fileName: data.fileName,
        }]);
      } else if (data.type === 'result') {
        setResults(prev => [...prev, data.result]);
        const result = data.result;
        setFileProgressMap(prev => {
          const next = new Map(prev);
          next.set(result.id, {
            fileId: result.id,
            fileName: result.fileName,
            percentage: 100,
            message: result.status === 'success' ? 'Complete'
              : result.status === 'timeout' ? 'Timed out'
              : result.status === 'cancelled' ? 'Cancelled'
              : 'Failed',
            status: result.status === 'success' ? 'success' : 'failed',
          });
          return next;
        });
        setLogs(prev => [...prev, {
          timestamp: getTimestamp(),
          message: result.status === 'success' 
            ? `${result.fileName} -- Success (${result.processingTime?.toFixed(1)}s)`
            : result.status === 'timeout'
            ? `${result.fileName} -- Timed out: ${result.error || 'Simulation exceeded timeout'}`
            : result.status === 'cancelled'
            ? `${result.fileName} -- Cancelled`
            : `${result.fileName} -- Error: ${result.error || 'Unknown error'}`,
          type: result.status === 'success' ? 'success' : 'error'
        }]);
      } else if (data.type === 'completed') {
        setProcessingState('completed');
        if (startTimeRef.current) {
          const elapsed = (Date.now() - startTimeRef.current) / 1000;
          setElapsedTime(formatTime(elapsed));
        }
        setLogs(prev => {
          const successCount = prev.filter(l => l.type === 'success').length;
          const totalCount = prev.filter(l => l.type === 'success' || l.type === 'error').length;
          return [...prev, {
            timestamp: getTimestamp(),
            message: `Batch completed: ${successCount}/${totalCount} files successful`,
            type: 'complete'
          }];
        });
        if (wsRef.current) {
          wsRef.current.close();
          wsRef.current = null;
        }
        toast({
          title: "Batch Processing Complete",
          description: "All files have been processed.",
        });
      } else if (data.type === 'api_snapshot') {
        setApiSnapshots(prev => {
          const entry: ApiSnapshotEntry = {
            stepCount: data.stepCount,
            elapsedTime: data.elapsedTime,
            fileId: data.fileId,
            fileName: data.fileName,
            nodeSnapshots: data.nodeSnapshots || [],
            linkSnapshots: data.linkSnapshots || [],
          };
          const next = [...prev, entry];
          const fileCount = next.filter(s => s.fileId === data.fileId).length;
          if (fileCount > MAX_SNAPSHOTS_PER_FILE) {
            let dropped = 0;
            return next.filter(s => {
              if (s.fileId !== data.fileId) return true;
              dropped++;
              return dropped % 2 === 0;
            });
          }
          return next;
        });
      } else if (data.type === 'cancelled') {
        setProcessingState('idle');
        setStartTime(null);
        startTimeRef.current = null;
        if (wsRef.current) {
          wsRef.current.close();
          wsRef.current = null;
        }
        toast({
          title: "Processing Cancelled",
          description: "Batch processing was stopped.",
        });
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
    };

    wsRef.current = ws;
  };

  const handleFilesSelected = (fileList: FileList) => {
    const allFiles = Array.from(fileList);
    const validFiles = allFiles.filter(f => f.name.toLowerCase().endsWith('.inp'));
    const invalidFileNames = allFiles
      .filter(f => !f.name.toLowerCase().endsWith('.inp'))
      .map(f => f.name);
    
    if (invalidFileNames.length > 0) {
      setInvalidFiles(invalidFileNames);
      setTimeout(() => setInvalidFiles([]), 5000);
    }
    
    const newFiles: FileItem[] = validFiles.map((file, index) => ({
      id: `${Date.now()}-${index}`,
      name: file.name,
      path: file.webkitRelativePath || file.name,
      size: file.size,
      file,
    })) as any;
    setFiles(prev => [...prev, ...newFiles]);
  };

  const handleSamplesLoaded = (sampleFiles: File[]) => {
    setFiles(prev => {
      const existingNames = new Set(prev.map(f => f.name));
      const deduped = sampleFiles.filter(f => !existingNames.has(f.name));
      const newFiles: FileItem[] = deduped.map((file, index) => ({
        id: `sample-${Date.now()}-${index}`,
        name: file.name,
        path: file.name,
        size: file.size,
        file,
      })) as any;
      return [...prev, ...newFiles];
    });
  };

  // Agent/deep-link support: ?engine=executable|api|wasm|wasm6 preselects the
  // engine mode; ?sample=Name.inp (comma-separated for multiple) auto-loads
  // sample models. Example: /?engine=wasm6&sample=Demo_extran2.inp
  const deepLinkHandledRef = useRef(false);
  useEffect(() => {
    if (deepLinkHandledRef.current) return;
    deepLinkHandledRef.current = true;
    const params = new URLSearchParams(window.location.search);
    // First visit: show the Elevator Pitch opening screen (skipped when a
    // deep link brings agents/users straight into the workflow).
    if (Array.from(params.keys()).length === 0) {
      let seen = true;
      try { seen = !!localStorage.getItem(PITCH_SEEN_KEY); } catch { /* ignore */ }
      if (!seen) {
        navigate('/pitch');
        return;
      }
    }
    const engine = params.get('engine');
    if (engine === 'executable' || engine === 'api' || engine === 'wasm' || engine === 'wasm6') {
      setEngineMode(engine);
    }
    const sample = params.get('sample');
    if (sample) {
      const names = sample.split(',').map(s => s.trim()).filter(Boolean)
        .map(n => n.toLowerCase().endsWith('.inp') ? n : `${n}.inp`);
      Promise.allSettled(names.map(async name => {
        const res = await fetch(`/api/samples/${encodeURIComponent(name)}`);
        if (!res.ok) throw new Error(name);
        const text = await res.text();
        return new File([text], name, { type: 'text/plain' });
      })).then(settled => {
        const loaded = settled.filter((s): s is PromiseFulfilledResult<File> => s.status === 'fulfilled').map(s => s.value);
        const failed = settled.filter(s => s.status === 'rejected').map(s => String((s as PromiseRejectedResult).reason?.message ?? 'unknown'));
        if (loaded.length > 0) handleSamplesLoaded(loaded);
        if (failed.length > 0) {
          toast({ title: 'Sample not found', description: failed.join(', '), variant: 'destructive' });
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Server batches stream light result summaries; full report/input text is
  // fetched here on demand and merged into state.
  const mergeContent = (resultId: string, content: { reportContent?: string; inpContent?: string }) => {
    setResults(prev => prev.map(r => r.id === resultId
      ? { ...r, reportContent: content.reportContent, inpContent: content.inpContent }
      : r));
  };

  const fetchResultContent = async (resultId: string): Promise<{ reportContent?: string; inpContent?: string } | null> => {
    if (!jobId) return null;
    const res = await fetch(`/api/batch/${jobId}/results/${resultId}/content`);
    if (!res.ok) {
      toast({
        title: "Could not load report",
        description: "The full report text is no longer available on the server.",
        variant: "destructive",
      });
      return null;
    }
    return res.json();
  };

  const handleLoadContent = async (resultId: string) => {
    const content = await fetchResultContent(resultId);
    if (content) mergeContent(resultId, content);
  };

  const handleLoadAllContent = async (): Promise<ProcessResult[]> => {
    const missing = results.filter(r => !r.reportContent && !r.inpContent && (r.hasReport || r.hasInp));
    if (missing.length === 0 || !jobId) return results;
    const loaded = new Map<string, { reportContent?: string; inpContent?: string }>();
    for (const r of missing) {
      const content = await fetchResultContent(r.id);
      if (content) loaded.set(r.id, content);
    }
    const full = results.map(r => loaded.has(r.id) ? { ...r, ...loaded.get(r.id)! } : r);
    setResults(full);
    return full;
  };

  // A single-engine batch presented as one EngineRun so the GIF tool can be
  // reused outside of comparison mode.
  const singleEngineRuns: EngineRun[] = useMemo(() => [{
    engine: engineMode,
    label: ENGINE_LABELS[engineMode],
    jobId: (engineMode === 'wasm' || engineMode === 'wasm6') ? null : jobId,
    results,
  }], [engineMode, jobId, results]);

  const loadSingleRunFileContent = async (fileName: string) => {
    const r = results.find(res => res.fileName === fileName);
    if (!r || r.reportContent || r.inpContent) return;
    // Browser engines already carry their content; server results load lazily.
    if (!jobId || !(r.hasReport || r.hasInp)) return;
    const content = await fetchResultContent(r.id);
    if (content) mergeContent(r.id, content);
  };

  const handleRemoveFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const handleClearAll = () => {
    setFiles([]);
    setResults([]);
    setProcessingState('idle');
    setCurrentFile(0);
    setJobId(null);
    setStartTime(null);
    setElapsedTime('');
    setLogs([]);
    setFileProgressMap(new Map());
    setApiSnapshots([]);
    setComparisonRuns(null);
    startTimeRef.current = null;
  };

  const handleDeleteBatch = async () => {
    if (!jobId) return;
    try {
      const res = await fetch(`/api/batch/${jobId}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) {
        throw new Error('Failed to delete batch');
      }
      handleClearAll();
      toast({
        title: "Batch Deleted",
        description: "The batch job and its files were removed.",
      });
    } catch (err) {
      toast({
        title: "Delete Failed",
        description: err instanceof Error ? err.message : 'Could not delete the batch.',
        variant: "destructive",
      });
    }
  };

  const handleStartWasmProcessing = () => {
    const wasmEngine = engineMode === 'wasm6' ? 'swmm6' : 'swmm5';
    const runnableFiles = (files as any[])
      .filter(f => f.file)
      .map(f => ({ id: f.id, name: f.name, file: f.file as File }));

    if (runnableFiles.length === 0) {
      toast({
        title: "No Files",
        description: "No runnable files found for WASM processing.",
        variant: "destructive",
      });
      return;
    }

    setProcessingState('processing');
    setCurrentFile(0);
    setResults([]);
    setLogs([{
      timestamp: getTimestamp(),
      message: `Starting in-browser ${wasmEngine === 'swmm6' ? 'SWMM6' : 'SWMM5'} WASM batch: ${runnableFiles.length} file(s)`,
      type: 'info',
    }]);
    setFileProgressMap(new Map());
    setApiSnapshots([]);
    setStartTime(Date.now());
    startTimeRef.current = Date.now();
    wasmCancelRef.current = { current: false };

    let completedCount = 0;

    const terminate = runWasmBatch(
      runnableFiles,
      {
        onFileStart: (fileIndex) => {
          setCurrentFile(fileIndex);
        },
        onProgress: (p) => {
          setFileProgressMap(prev => {
            const next = new Map(prev);
            next.set(p.fileId, {
              fileId: p.fileId,
              fileName: p.fileName,
              percentage: p.percentage,
              message: p.message,
              status: 'running',
            });
            return next;
          });
        },
        onResult: (result) => {
          completedCount++;
          setResults(prev => [...prev, result]);
          setFileProgressMap(prev => {
            const next = new Map(prev);
            next.set(result.id, {
              fileId: result.id,
              fileName: result.fileName,
              percentage: 100,
              message: result.status === 'success' ? 'Complete' : 'Failed',
              status: result.status === 'success' ? 'success' : 'failed',
            });
            return next;
          });
        },
        onLog: (message, type) => {
          setLogs(prev => [...prev, { timestamp: getTimestamp(), message, type }]);
        },
        onComplete: () => {
          setProcessingState('completed');
          if (startTimeRef.current) {
            const elapsed = (Date.now() - startTimeRef.current) / 1000;
            setElapsedTime(formatTime(elapsed));
          }
          wasmTerminateRef.current = null;
          toast({
            title: "Batch Processing Complete",
            description: "All files processed in your browser via WebAssembly.",
          });
        },
      },
      wasmCancelRef.current,
      wasmEngine,
      buildOverrides(),
      parallelProcessing,
    );
    wasmTerminateRef.current = terminate;

    toast({
      title: "Processing Started",
      description: `Running ${runnableFiles.length} file${runnableFiles.length !== 1 ? 's' : ''} in-browser (WASM)...`,
    });
  };

  // --- Multi-engine comparison mode -------------------------------------
  // Runs the same file set once per selected engine (sequentially), collects
  // each engine's results, then shows an engine-vs-engine comparison.

  const browserRunFinishRef = useRef<(() => void) | null>(null);

  const runBrowserEngineOnce = (
    engine: 'wasm' | 'wasm6',
    runnableFiles: { id: string; name: string; file: File }[],
  ): Promise<ProcessResult[]> => {
    return new Promise((resolve) => {
      const collected: ProcessResult[] = [];
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        browserRunFinishRef.current = null;
        wasmTerminateRef.current = null;
        resolve([...collected]);
      };
      browserRunFinishRef.current = finish;
      wasmCancelRef.current = { current: false };
      const terminate = runWasmBatch(
        runnableFiles,
        {
          onFileStart: (fileIndex) => setCurrentFile(fileIndex),
          onProgress: (p) => {
            setFileProgressMap(prev => {
              const next = new Map(prev);
              next.set(p.fileId, { fileId: p.fileId, fileName: p.fileName, percentage: p.percentage, message: p.message, status: 'running' });
              return next;
            });
          },
          onResult: (result) => {
            collected.push(result);
            setFileProgressMap(prev => {
              const next = new Map(prev);
              next.set(result.id, {
                fileId: result.id, fileName: result.fileName, percentage: 100,
                message: result.status === 'success' ? 'Complete' : 'Failed',
                status: result.status === 'success' ? 'success' : 'failed',
              });
              return next;
            });
          },
          onLog: (message, type) => setLogs(prev => [...prev, { timestamp: getTimestamp(), message, type }]),
          onComplete: finish,
        },
        wasmCancelRef.current,
        engine === 'wasm6' ? 'swmm6' : 'swmm5',
        buildOverrides(engine),
        parallelProcessing,
      );
      wasmTerminateRef.current = terminate;
    });
  };

  const runServerEngineOnce = async (
    engine: 'executable' | 'api',
  ): Promise<{ jobId: string; results: ProcessResult[] }> => {
    if (comparisonCancelRef.current.cancelled) throw new Error('Comparison cancelled');
    let batchJob: any;
    try {
      batchJob = await uploadFilesChunked(files, () => comparisonCancelRef.current.cancelled, setUploadProgress);
    } finally {
      setUploadProgress(null);
    }
    comparisonCancelRef.current.jobId = batchJob.id;
    if (comparisonCancelRef.current.cancelled) {
      // Cancelled while the upload was in flight — don't start the job.
      fetch(`/api/batch/${batchJob.id}`, { method: 'DELETE' }).catch(() => { /* best effort */ });
      return { jobId: batchJob.id, results: [] };
    }

    return new Promise((resolve, reject) => {
      const collected: ProcessResult[] = [];
      let settled = false;
      let sawTerminal = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (wsRef.current === ws) wsRef.current = null;
        try { ws.close(); } catch { /* already closed */ }
        resolve({ jobId: batchJob.id, results: [...collected] });
      };
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        if (wsRef.current === ws) wsRef.current = null;
        try { ws.close(); } catch { /* already closed */ }
        reject(err);
      };
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws?jobId=${batchJob.id}`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'progress') {
          setCurrentFile(data.currentFile);
          setLogs(prev => [...prev, { timestamp: getTimestamp(), message: `Processing ${data.fileName}...`, type: 'info' }]);
          const key = data.fileId || data.fileName;
          setFileProgressMap(prev => {
            const next = new Map(prev);
            next.set(key, { fileId: key, fileName: data.fileName, percentage: 0, message: 'Starting...', status: 'running' });
            return next;
          });
        } else if (data.type === 'file_progress') {
          setFileProgressMap(prev => {
            const next = new Map(prev);
            next.set(data.fileId, { fileId: data.fileId, fileName: data.fileName, percentage: data.percentage, message: data.message, status: 'running' });
            return next;
          });
        } else if (data.type === 'log') {
          setLogs(prev => [...prev, { timestamp: getTimestamp(), message: data.text, type: data.stream === 'stderr' ? 'stderr' : 'stdout', fileName: data.fileName }]);
        } else if (data.type === 'result') {
          const result = data.result as ProcessResult;
          collected.push(result);
          setFileProgressMap(prev => {
            const next = new Map(prev);
            next.set(result.id, {
              fileId: result.id, fileName: result.fileName, percentage: 100,
              message: result.status === 'success' ? 'Complete' : result.status === 'timeout' ? 'Timed out' : result.status === 'cancelled' ? 'Cancelled' : 'Failed',
              status: result.status === 'success' ? 'success' : 'failed',
            });
            return next;
          });
          setLogs(prev => [...prev, {
            timestamp: getTimestamp(),
            message: result.status === 'success'
              ? `${result.fileName} -- Success (${result.processingTime?.toFixed(1)}s)`
              : `${result.fileName} -- ${result.status === 'timeout' ? 'Timed out' : result.status === 'cancelled' ? 'Cancelled' : `Error: ${result.error || 'Unknown error'}`}`,
            type: result.status === 'success' ? 'success' : 'error',
          }]);
        } else if (data.type === 'api_snapshot') {
          setApiSnapshots(prev => [...prev, {
            stepCount: data.stepCount, elapsedTime: data.elapsedTime, fileId: data.fileId,
            fileName: data.fileName, nodeSnapshots: data.nodeSnapshots || [], linkSnapshots: data.linkSnapshots || [],
          }]);
        } else if (data.type === 'completed' || data.type === 'cancelled') {
          sawTerminal = true;
          finish();
        }
      };
      ws.onclose = () => {
        // Only a terminal protocol event (completed/cancelled) counts as a
        // finished run; an abnormal disconnect must not masquerade as one.
        if (sawTerminal || comparisonCancelRef.current.cancelled) finish();
        else fail(new Error('Lost connection to the server mid-run'));
      };
      ws.onerror = (err) => console.error('WebSocket error:', err);

      ws.onopen = () => {
        if (comparisonCancelRef.current.cancelled) {
          // Cancelled before the job started — never start it.
          fetch(`/api/batch/${batchJob.id}`, { method: 'DELETE' }).catch(() => { /* best effort */ });
          sawTerminal = true;
          finish();
          return;
        }
        fetch(`/api/batch/${batchJob.id}/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ engineMode: engine, timeoutMinutes, stopOnError, overrides: buildOverrides(engine) }),
        }).then(async res => {
          if (!res.ok) fail(new Error(await readErrorMessage(res, 'Failed to start processing')));
        }).catch(err => fail(err instanceof Error ? err : new Error('Failed to start processing')));
      };
    });
  };

  const handleStartComparison = async () => {
    const runnableFiles = (files as any[])
      .filter(f => f.file)
      .map(f => ({ id: f.id, name: f.name, file: f.file as File }));
    if (runnableFiles.length === 0) {
      toast({ title: "No Files", description: "No runnable files found.", variant: "destructive" });
      return;
    }

    comparisonCancelRef.current = { cancelled: false, jobId: null };
    setComparisonRuns(null);
    setProcessingState('processing');
    setCurrentFile(0);
    setResults([]);
    setJobId(null);
    setApiSnapshots([]);
    setFileProgressMap(new Map());
    setStartTime(Date.now());
    startTimeRef.current = Date.now();
    setLogs([{
      timestamp: getTimestamp(),
      message: `Engine comparison: running ${runnableFiles.length} file(s) on ${selectedEngines.map(e => ENGINE_LABELS[e]).join(', ')}`,
      type: 'info',
    }]);
    toast({
      title: "Comparison Started",
      description: `Running ${runnableFiles.length} file${runnableFiles.length !== 1 ? 's' : ''} on ${selectedEngines.length} engines...`,
    });

    const runs: EngineRun[] = [];
    const failedEngines: Array<{ label: string; message: string }> = [];
    try {
      // One engine failing (upload hiccup, dropped connection, server blip)
      // must not throw away the results of the engines that already finished —
      // record the failure and move on to the next engine.
      for (let i = 0; i < selectedEngines.length; i++) {
        const engine = selectedEngines[i];
        if (comparisonCancelRef.current.cancelled) break;
        setActiveComparisonEngine(ENGINE_LABELS[engine]);
        setCurrentFile(0);
        setFileProgressMap(new Map());
        setLogs(prev => [...prev, { timestamp: getTimestamp(), message: `--- Engine ${i + 1}/${selectedEngines.length}: ${ENGINE_LABELS[engine]} ---`, type: 'info' }]);
        try {
          if (engine === 'wasm' || engine === 'wasm6') {
            const engineResults = await runBrowserEngineOnce(engine, runnableFiles);
            runs.push({ engine, label: ENGINE_LABELS[engine], jobId: null, results: engineResults });
          } else {
            const { jobId: runJobId, results: engineResults } = await runServerEngineOnce(engine);
            runs.push({ engine, label: ENGINE_LABELS[engine], jobId: runJobId, results: engineResults });
            comparisonCancelRef.current.jobId = null;
          }
        } catch (engineError) {
          if (comparisonCancelRef.current.cancelled) break;
          console.error(`Engine ${engine} failed:`, engineError);
          const message = engineError instanceof Error ? engineError.message : 'Engine run failed';
          failedEngines.push({ label: ENGINE_LABELS[engine], message });
          setLogs(prev => [...prev, { timestamp: getTimestamp(), message: `${ENGINE_LABELS[engine]} failed: ${message} — continuing with remaining engines`, type: 'error' }]);
          comparisonCancelRef.current.jobId = null;
        }
      }
      setComparisonRuns(runs.length > 0 ? runs : null);
      setProcessingState(runs.length > 0 ? 'completed' : 'idle');
      if (startTimeRef.current) {
        setElapsedTime(formatTime((Date.now() - startTimeRef.current) / 1000));
      }
      if (!comparisonCancelRef.current.cancelled) {
        if (failedEngines.length === 0) {
          toast({ title: "Comparison Complete", description: `All ${runs.length} engine runs finished.` });
        } else if (runs.length > 0) {
          toast({
            title: "Comparison Finished with Errors",
            description: `${runs.length} engine${runs.length !== 1 ? 's' : ''} finished; ${failedEngines.map(f => f.label).join(', ')} failed (${failedEngines[0].message}). Showing the results that completed.`,
            variant: "destructive",
          });
        } else {
          toast({
            title: "Comparison Error",
            description: `${failedEngines.map(f => f.label).join(', ')} failed: ${failedEngines[0].message}`,
            variant: "destructive",
          });
        }
      }
    } finally {
      setActiveComparisonEngine(null);
      comparisonCancelRef.current.jobId = null;
    }
  };

  const fetchContentFor = async (runJobId: string, resultId: string) => {
    const res = await fetch(`/api/batch/${runJobId}/results/${resultId}/content`);
    if (!res.ok) {
      toast({ title: "Could not load report", description: "The full report text is no longer available on the server.", variant: "destructive" });
      return null;
    }
    return res.json() as Promise<{ reportContent?: string; inpContent?: string }>;
  };

  const loadComparisonContent = async (runIndex: number, resultId: string) => {
    const run = comparisonRuns?.[runIndex];
    if (!run?.jobId) return;
    const content = await fetchContentFor(run.jobId, resultId);
    if (!content) return;
    setComparisonRuns(prev => prev?.map((r, i) => i === runIndex
      ? { ...r, results: r.results.map(res => res.id === resultId ? { ...res, ...content } : res) }
      : r) ?? null);
  };

  const loadAllComparisonContent = async (runIndex: number): Promise<ProcessResult[]> => {
    const run = comparisonRuns?.[runIndex];
    if (!run) return [];
    if (!run.jobId) return run.results as ProcessResult[];
    const missing = run.results.filter(r => !r.reportContent && !r.inpContent && (r.hasReport || r.hasInp));
    if (missing.length === 0) return run.results as ProcessResult[];
    const loaded = new Map<string, { reportContent?: string; inpContent?: string }>();
    for (const r of missing) {
      const content = await fetchContentFor(run.jobId, r.id);
      if (content) loaded.set(r.id, content);
    }
    const full = run.results.map(r => loaded.has(r.id) ? { ...r, ...loaded.get(r.id)! } : r);
    setComparisonRuns(prev => prev?.map((r, i) => i === runIndex ? { ...r, results: full } : r) ?? null);
    return full as ProcessResult[];
  };

  // Load report content for one file across every comparison run (browser
  // runs already carry their reports; server runs fetch lazily).
  const loadComparisonFileContent = async (fileName: string) => {
    if (!comparisonRuns) return;
    for (let i = 0; i < comparisonRuns.length; i++) {
      const run = comparisonRuns[i];
      if (!run.jobId) continue;
      const res = run.results.find(r => r.fileName === fileName) as any;
      if (res && ((!res.reportContent && res.hasReport) || (!res.inpContent && res.hasInp))) {
        await loadComparisonContent(i, res.id);
      }
    }
  };

  const handleStartProcessing = async () => {
    if (compareMode) {
      handleStartComparison();
      return;
    }
    if (engineMode === 'wasm' || engineMode === 'wasm6') {
      handleStartWasmProcessing();
      return;
    }
    try {
      let batchJob: any;
      try {
        batchJob = await uploadFilesChunked(files, undefined, setUploadProgress);
      } finally {
        setUploadProgress(null);
      }
      setJobId(batchJob.id);
      setProcessingState('processing');
      setCurrentFile(0);
      setResults([]);
      setLogs([]);
      setFileProgressMap(new Map());
      setApiSnapshots([]);
      setStartTime(Date.now());
      startTimeRef.current = Date.now();

      connectWebSocket(batchJob.id);

      const startResponse = await fetch(`/api/batch/${batchJob.id}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engineMode, timeoutMinutes, stopOnError, overrides: buildOverrides(engineMode) }),
      });

      if (!startResponse.ok) {
        throw new Error(await readErrorMessage(startResponse, 'Failed to start processing'));
      }

      toast({
        title: "Processing Started",
        description: `Processing ${files.length} file${files.length !== 1 ? 's' : ''}...`,
      });
    } catch (error) {
      console.error('Processing error:', error);
      toast({
        title: "Error",
        description: error instanceof Error && error.message
          ? error.message
          : "Failed to start batch processing. Please try again.",
        variant: "destructive",
      });
      setProcessingState('idle');
    }
  };

  const handleCancelProcessing = async () => {
    if (activeComparisonEngine !== null) {
      comparisonCancelRef.current.cancelled = true;
      // Stop whichever engine is mid-run.
      wasmCancelRef.current.current = true;
      if (wasmTerminateRef.current) {
        wasmTerminateRef.current();
        wasmTerminateRef.current = null;
      }
      if (browserRunFinishRef.current) {
        browserRunFinishRef.current();
      }
      const runJobId = comparisonCancelRef.current.jobId;
      if (runJobId) {
        try {
          await fetch(`/api/batch/${runJobId}/cancel`, { method: 'POST' });
        } catch (error) {
          console.error('Cancel error:', error);
        }
      }
      toast({
        title: "Comparison Cancelled",
        description: "Engine comparison was stopped.",
      });
      return;
    }
    if (engineMode === 'wasm' || engineMode === 'wasm6') {
      wasmCancelRef.current.current = true;
      if (wasmTerminateRef.current) {
        wasmTerminateRef.current();
        wasmTerminateRef.current = null;
      }
      setProcessingState('idle');
      setStartTime(null);
      startTimeRef.current = null;
      toast({
        title: "Processing Cancelled",
        description: "In-browser WASM processing was stopped.",
      });
      return;
    }
    if (!jobId) return;

    try {
      await fetch(`/api/batch/${jobId}/cancel`, {
        method: 'POST',
      });
    } catch (error) {
      console.error('Cancel error:', error);
      toast({
        title: "Error",
        description: "Failed to cancel processing.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader swmmStatus={swmmStatus} />

      <main className="container max-w-6xl mx-auto px-3 sm:px-6 md:px-8 py-4 md:py-8 flex-1">
        <div className="space-y-6 md:space-y-8">
          <section data-testid="section-workflow-steps">
            <WorkflowSteps 
              currentStep={processingState === 'completed' ? 'results' : processingState === 'processing' ? 'process' : 'upload'} 
            />
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section data-testid="section-instructions">
              <InstructionsPanel />
            </section>

            <section data-testid="section-expected-outputs">
              <ExpectedOutputs />
            </section>
          </div>

          <section data-testid="section-simulation-settings">
            <SimulationSettings
              reportStep={reportStep}
              routingMethod={routingMethod}
              parallelProcessing={parallelProcessing}
              parallelSupported={engineMode === 'wasm' || engineMode === 'wasm6'}
              stopOnError={stopOnError}
              timeoutMinutes={timeoutMinutes}
              startDate={startDate}
              endDate={endDate}
              routingStepSeconds={routingStepSeconds}
              onStartDateChange={setStartDate}
              onEndDateChange={setEndDate}
              onRoutingStepSecondsChange={setRoutingStepSeconds}
              onTimeoutMinutesChange={setTimeoutMinutes}
              onReportStepChange={setReportStep}
              onRoutingMethodChange={setRoutingMethod}
              onParallelProcessingChange={setParallelProcessing}
              onStopOnErrorChange={setStopOnError}
              swmm6Options={swmm6Options}
              onSwmm6OptionsChange={setSwmm6Options}
              disabled={processingState === 'processing'}
            />
          </section>

          <Card
            className={`${swmmStatus?.found ? 'border-green-500/30 bg-green-500/5' : 'border-primary/20 bg-primary/5'}`}
            data-testid="card-runswmm-info"
          >
            <CardContent className="p-4">
              <div className="flex gap-3">
                {swmmStatus?.found ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                )}
                <div className="space-y-2 text-sm flex-1">
                  {!swmmStatus && !statusError ? (
                    <>
                      <p className="font-medium" data-testid="text-swmm-checking">Checking for a server-side SWMM engine…</p>
                      <p className="text-muted-foreground text-xs">
                        Browser (WASM) engine modes are always available and run entirely on your device.
                      </p>
                    </>
                  ) : !swmmStatus && statusError ? (
                    <>
                      <p className="font-medium" data-testid="text-swmm-status-error">Could not check server engine status</p>
                      <p className="text-muted-foreground text-xs">
                        The server didn't respond to the engine status check. You can still use the WASM (Browser) engine modes below — they run entirely in your browser.
                      </p>
                    </>
                  ) : swmmStatus?.found ? (
                    <>
                      <p className="font-medium text-green-700 dark:text-green-400" data-testid="text-swmm-found">SWMM5 Engine Detected</p>
                      <p className="text-muted-foreground text-xs">
                        Simulations will run using the real SWMM engine.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-medium" data-testid="text-swmm-not-found">SWMM Engine Unavailable</p>
                      <p className="text-muted-foreground">
                        No SWMM engine was found on the server.
                      </p>
                      <p className="text-muted-foreground">
                        To use real SWMM processing, install EPA SWMM and set the path:
                      </p>
                      <pre className="text-xs font-mono bg-muted p-2 rounded overflow-x-auto" data-testid="text-swmm-path-hint">
                        set RUNSWMM_PATH=C:\Program Files (x86)\EPA SWMM 5.2\runswmm.exe
                      </pre>
                      <p className="text-muted-foreground text-xs">
                        Without an engine, server-side runs will fail — <span className="font-medium text-foreground">no results are fabricated</span>. You can still use the WASM (Browser) engine modes below.
                        <a
                          href="https://www.epa.gov/water-research/storm-water-management-model-swmm"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-primary ml-1"
                          data-testid="link-download-swmm"
                        >
                          Download EPA SWMM
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </p>
                    </>
                  )}

                  <div className="pt-2 border-t border-border/50">
                    <div className="flex items-center gap-1.5 mb-2">
                      <p className="text-xs font-medium text-muted-foreground">Engine Mode</p>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button type="button" aria-label="Engine mode explanations" data-testid="button-engine-mode-info" className="text-muted-foreground hover:text-foreground">
                            <Info className="h-3.5 w-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-sm space-y-1.5" data-testid="tooltip-engine-modes">
                          <p><span className="font-semibold">Executable</span> — runs the native EPA SWMM 5.2 program on the server. Fastest; the standard choice.</p>
                          <p><span className="font-semibold">SWMM5 API</span> — runs on the server via the SWMM5 shared library, with live step-by-step data (see the API dashboard).</p>
                          <p><span className="font-semibold">WASM (Browser)</span> — runs EPA SWMM 5.2 entirely in your browser via WebAssembly. Works even if the server engine is unavailable.</p>
                          <p><span className="font-semibold">SWMM6 (Browser)</span> — runs the OpenSWMM 6.0.0-alpha engine in your browser, with SWMM6-only solver options like dynamic-slot surcharge.</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Button
                          size="sm"
                          variant={selectedEngines.includes('executable') ? 'default' : 'outline'}
                          onClick={() => toggleEngine('executable')}
                          disabled={processingState === 'processing' || !swmmStatus?.found}
                          data-testid="button-mode-executable"
                          className="toggle-elevate"
                        >
                          <Terminal className="h-3.5 w-3.5 mr-1.5" />
                          Executable
                        </Button>
                        <Button
                          size="sm"
                          variant={selectedEngines.includes('api') ? 'default' : 'outline'}
                          onClick={() => toggleEngine('api')}
                          disabled={processingState === 'processing' || !swmmStatus?.apiAvailable}
                          data-testid="button-mode-api"
                          className="toggle-elevate"
                        >
                          <Cpu className="h-3.5 w-3.5 mr-1.5" />
                          SWMM5 API
                        </Button>
                        <Button
                          size="sm"
                          variant={selectedEngines.includes('wasm') ? 'default' : 'outline'}
                          onClick={() => toggleEngine('wasm')}
                          disabled={processingState === 'processing'}
                          data-testid="button-mode-wasm"
                          className="toggle-elevate"
                        >
                          <Globe className="h-3.5 w-3.5 mr-1.5" />
                          WASM (Browser)
                        </Button>
                        <Button
                          size="sm"
                          variant={selectedEngines.includes('wasm6') ? 'default' : 'outline'}
                          onClick={() => toggleEngine('wasm6')}
                          disabled={processingState === 'processing'}
                          data-testid="button-mode-wasm6"
                          className="toggle-elevate"
                        >
                          <Globe className="h-3.5 w-3.5 mr-1.5" />
                          SWMM6 (Browser)
                        </Button>
                        {swmmStatus?.apiAvailable ? (
                          <Badge variant="outline" className="text-green-600 border-green-500/30" data-testid="badge-api-available">
                            API v{swmmStatus.apiVersion ? (swmmStatus.apiVersion / 10000).toFixed(1) : '?'}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground" data-testid="badge-api-unavailable">
                            API unavailable
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1.5" data-testid="text-engine-mode-description">
                        {compareMode
                          ? `Comparison mode: each model runs once per engine (${selectedEngines.map(e => ENGINE_LABELS[e]).join(', ')}), then results are compared side by side. Click a selected engine to deselect it.`
                          : engineMode === 'executable'
                          ? 'Spawns runswmm as a child process (standard mode). Click another engine to add it and compare outputs.'
                          : engineMode === 'api'
                          ? 'Uses SWMM5 shared library for step-by-step control with live data streaming. Click another engine to add it and compare outputs.'
                          : engineMode === 'wasm'
                          ? 'Runs EPA SWMM 5.2.4 compiled to WebAssembly entirely in your browser — no server round-trip, files never leave your device. Click another engine to add it and compare outputs.'
                          : 'Runs the OpenSWMM 6.0.0-alpha engine as WebAssembly in your browser, including SWMM6-only solver options. Click another engine to add it and compare outputs.'}
                      </p>
                    </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Separator />

          <section data-testid="section-upload">
            <FileUploadZone
              onFilesSelected={handleFilesSelected}
              selectedCount={files.length}
              totalSize={totalSize}
              invalidFiles={invalidFiles}
            />
          </section>

          <section data-testid="section-sample-models">
            <SampleModels
              onSamplesLoaded={handleSamplesLoaded}
              disabled={processingState === 'processing'}
            />
          </section>

          <section data-testid="section-github-models">
            <GitHubModels
              onModelsLoaded={handleSamplesLoaded}
              disabled={processingState === 'processing'}
            />
          </section>

          {files.length > 0 && (
            <>
              <Separator />
              
              <section data-testid="section-file-list">
                <FileListPanel
                  files={files}
                  onRemoveFile={handleRemoveFile}
                  onClearAll={handleClearAll}
                />
              </section>
            </>
          )}

          <div className="flex items-center gap-4 flex-wrap">
            {processingState === 'idle' && (
              <Button
                size="lg"
                onClick={handleStartProcessing}
                disabled={files.length === 0}
                data-testid="button-start-processing"
              >
                <PlayCircle className="h-5 w-5 mr-2" />
                {compareMode ? `Run & Compare ${selectedEngines.length} Engines` : 'Start Batch Processing'}
              </Button>
            )}
            
            {processingState === 'processing' && (
              <Button
                size="lg"
                variant="destructive"
                onClick={handleCancelProcessing}
                data-testid="button-cancel-processing"
              >
                <StopCircle className="h-5 w-5 mr-2" />
                Cancel Processing
              </Button>
            )}
            
            {processingState === 'completed' && (
              <>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={handleClearAll}
                  data-testid="button-reset"
                >
                  Process New Batch
                </Button>
                {jobId && (
                  <Button
                    size="lg"
                    variant="destructive"
                    onClick={handleDeleteBatch}
                    data-testid="button-delete-batch"
                  >
                    Delete Batch
                  </Button>
                )}
              </>
            )}

            {processingState === 'idle' && files.length === 0 && (
              <p className="text-sm text-muted-foreground" data-testid="text-upload-hint">
                Upload .inp files to enable processing
              </p>
            )}
          </div>

          {uploadProgress && (
            <section data-testid="section-upload-progress" className="space-y-2">
              <p className="text-sm font-medium" data-testid="text-upload-progress">
                Uploading chunk {uploadProgress.current}/{uploadProgress.total}
                {' '}({(uploadProgress.sentBytes / (1024 * 1024)).toFixed(1)} of {(uploadProgress.totalBytes / (1024 * 1024)).toFixed(1)} MB sent)…
              </p>
              <Progress
                value={uploadProgress.totalBytes > 0 ? (uploadProgress.sentBytes / uploadProgress.totalBytes) * 100 : 0}
                data-testid="progress-upload"
              />
            </section>
          )}

          {processingState === 'processing' && (
            <>
              <Separator />
              {activeComparisonEngine && (
                <p className="text-sm font-medium" data-testid="text-active-comparison-engine">
                  Engine comparison — currently running: <span className="text-primary">{activeComparisonEngine}</span>
                </p>
              )}
              <section data-testid="section-progress">
                <ProgressSection
                  current={currentFile}
                  total={files.length}
                  currentFileName={files[currentFile - 1]?.name}
                  startTime={startTime || undefined}
                  successCount={results.filter(r => r.status === 'success').length}
                  failedCount={results.filter(r => r.status === 'failed').length}
                  fileProgressMap={fileProgressMap}
                  fileItems={files.map(f => ({ id: f.id, name: f.name }))}
                  onSkipFile={wasmTerminateRef.current ? (fileId) => wasmTerminateRef.current?.skip(fileId) : undefined}
                />
              </section>
              {engineMode === 'api' && (
                <section data-testid="section-live-dashboard">
                  <LiveApiDashboard
                    snapshots={apiSnapshots}
                    currentFileId={apiSnapshots.length > 0 ? apiSnapshots[apiSnapshots.length - 1].fileId : ''}
                  />
                </section>
              )}
              <section data-testid="section-processing-log">
                <ProcessingLog logs={logs} />
              </section>
            </>
          )}

          {processingState === 'completed' && results.length > 0 && (
            <>
              <Separator />
              {apiSnapshots.length > 0 && (
                <section data-testid="section-live-dashboard-completed">
                  <LiveApiDashboard
                    snapshots={apiSnapshots}
                    currentFileId={apiSnapshots[apiSnapshots.length - 1]?.fileId || ''}
                  />
                </section>
              )}
              <section data-testid="section-processing-log">
                <ProcessingLog logs={logs} defaultCollapsed={true} />
              </section>
              <section data-testid="section-results">
                <ResultsDisplay
                  results={results}
                  elapsedTime={elapsedTime}
                  onLoadContent={handleLoadContent}
                  onLoadAllContent={handleLoadAllContent}
                />
              </section>
              <section data-testid="section-gif-maker-single">
                <GifMakerTool runs={singleEngineRuns} onLoadFile={loadSingleRunFileContent} />
              </section>
            </>
          )}

          {processingState === 'completed' && comparisonRuns && comparisonRuns.length > 0 && (
            <>
              <Separator />
              <section data-testid="section-processing-log-comparison">
                <ProcessingLog logs={logs} defaultCollapsed={true} />
              </section>
              <Tabs defaultValue="comparison" data-testid="tabs-comparison-sections">
                <TabsList className="flex-wrap h-auto">
                  <TabsTrigger value="comparison" data-testid="tab-comparison">Comparison</TabsTrigger>
                  {comparisonRuns.length >= 2 && <TabsTrigger value="charts" data-testid="tab-charts">Charts</TabsTrigger>}
                  {comparisonRuns.length >= 2 && <TabsTrigger value="scatter" data-testid="tab-scatter">Scatter Plots</TabsTrigger>}
                  <TabsTrigger value="map" data-testid="tab-map">Map Animation</TabsTrigger>
                  {comparisonRuns.map(run => (
                    <TabsTrigger key={run.engine} value={`results-${run.engine}`} data-testid={`tab-results-${run.engine}`}>
                      {run.label} results
                    </TabsTrigger>
                  ))}
                </TabsList>
                <TabsContent value="comparison" className="mt-4">
                  <section data-testid="section-engine-comparison">
                    <EngineComparisonView runs={comparisonRuns} />
                  </section>
                </TabsContent>
                {comparisonRuns.length >= 2 && (
                  <TabsContent value="charts" className="mt-4">
                    <section data-testid="section-system-comparison">
                      <SystemComparisonChart runs={comparisonRuns} onLoadFile={loadComparisonFileContent} />
                    </section>
                  </TabsContent>
                )}
                {comparisonRuns.length >= 2 && (
                  <TabsContent value="scatter" className="mt-4">
                    <section data-testid="section-scatter-comparison">
                      <EngineScatterCompare runs={comparisonRuns} onLoadFile={loadComparisonFileContent} />
                    </section>
                  </TabsContent>
                )}
                <TabsContent value="map" className="mt-4">
                  <section data-testid="section-gif-maker">
                    <GifMakerTool runs={comparisonRuns} onLoadFile={loadComparisonFileContent} />
                  </section>
                </TabsContent>
                {comparisonRuns.map((run, i) => (
                  <TabsContent key={run.engine} value={`results-${run.engine}`} className="mt-4">
                    <section data-testid={`section-results-${run.engine}`}>
                      <ResultsDisplay
                        results={run.results as ProcessResult[]}
                        elapsedTime={i === 0 ? elapsedTime : undefined}
                        onLoadContent={(resultId) => loadComparisonContent(i, resultId)}
                        onLoadAllContent={() => loadAllComparisonContent(i)}
                      />
                    </section>
                  </TabsContent>
                ))}
              </Tabs>
            </>
          )}
        </div>
      </main>

      <footer className="border-t mt-auto">
        <div className="container max-w-6xl mx-auto px-3 sm:px-6 md:px-8 py-3 md:py-4">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground flex-wrap">
            <p data-testid="text-footer-version">BatchSWMM56 v1.0.0</p>
            <p className="font-mono truncate max-w-full" data-testid="text-footer-executable">
              {swmmStatus?.found ? 'server engine ready' : 'server engine unavailable'}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
