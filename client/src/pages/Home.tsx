import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { PITCH_SEEN_KEY } from "@/pages/ElevatorPitch";
import { CheckCircle2, AlertTriangle, ExternalLink, PlayCircle, StopCircle, Cpu, Terminal, Globe, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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
import LiveApiDashboard, { type ApiSnapshotEntry, MAX_SNAPSHOTS_PER_FILE } from "@/components/LiveApiDashboard";
import { runWasmBatch } from "@/lib/swmmWasmEngine";
import type { SwmmStatus } from "@shared/schema";

type ProcessingState = 'idle' | 'processing' | 'completed';

const SETTINGS_KEY = 'batchswmm-settings';

interface PersistedSettings {
  reportStep?: number;
  routingMethod?: string;
  parallelProcessing?: boolean;
  stopOnError?: boolean;
  outputFormat?: string;
  timeoutMinutes?: number;
  engineMode?: 'executable' | 'api' | 'wasm' | 'wasm6';
  startDate?: string;
  endDate?: string;
  routingStepSeconds?: number | null;
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
  const [outputFormat, setOutputFormat] = useState(savedSettingsRef.current.outputFormat ?? "all");
  const [timeoutMinutes, setTimeoutMinutes] = useState(savedSettingsRef.current.timeoutMinutes ?? 10);
  const [startDate, setStartDate] = useState(savedSettingsRef.current.startDate ?? '');
  const [endDate, setEndDate] = useState(savedSettingsRef.current.endDate ?? '');
  const [routingStepSeconds, setRoutingStepSeconds] = useState<number | null>(savedSettingsRef.current.routingStepSeconds ?? null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [swmmStatus, setSwmmStatus] = useState<SwmmStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [engineMode, setEngineMode] = useState<'executable' | 'api' | 'wasm' | 'wasm6'>(savedSettingsRef.current.engineMode ?? 'executable');
  const wasmCancelRef = useRef<{ current: boolean }>({ current: false });
  const wasmTerminateRef = useRef<(() => void) | null>(null);
  const [fileProgressMap, setFileProgressMap] = useState<Map<string, FileProgressInfo>>(new Map());
  const [apiSnapshots, setApiSnapshots] = useState<ApiSnapshotEntry[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const totalSize = files.reduce((acc, f: any) => acc + (f.file?.size || 0), 0);

  useEffect(() => {
    const settings: PersistedSettings = {
      reportStep, routingMethod, parallelProcessing, stopOnError,
      outputFormat, timeoutMinutes, engineMode,
      startDate, endDate, routingStepSeconds,
    };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // localStorage unavailable (private mode, quota) — settings simply won't persist
    }
  }, [reportStep, routingMethod, parallelProcessing, stopOnError, outputFormat, timeoutMinutes, engineMode, startDate, endDate, routingStepSeconds]);

  const buildOverrides = () => ({
    reportStepMinutes: reportStep > 0 ? reportStep : undefined,
    flowRouting: routingMethod || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    routingStepSeconds: routingStepSeconds && routingStepSeconds > 0 ? routingStepSeconds : undefined,
  });

  useEffect(() => {
    fetch('/api/swmm-status')
      .then(res => res.json())
      .then((data: SwmmStatus) => {
        setSwmmStatus(data);
        setEngineMode(prev => {
          if (prev === 'executable' && !data.found) return 'wasm';
          if (prev === 'api' && !data.apiAvailable) return data.found ? 'executable' : 'wasm';
          return prev;
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
      if (wasmTerminateRef.current) {
        wasmTerminateRef.current();
        wasmTerminateRef.current = null;
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
    );
    wasmTerminateRef.current = terminate;

    toast({
      title: "Processing Started",
      description: `Running ${runnableFiles.length} file${runnableFiles.length !== 1 ? 's' : ''} in-browser (WASM)...`,
    });
  };

  const handleStartProcessing = async () => {
    if (engineMode === 'wasm' || engineMode === 'wasm6') {
      handleStartWasmProcessing();
      return;
    }
    try {
      const formData = new FormData();
      files.forEach((file: any) => {
        if (file.file) {
          formData.append('files', file.file);
        }
      });

      const uploadResponse = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload files');
      }

      const batchJob = await uploadResponse.json();
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
        body: JSON.stringify({ engineMode, timeoutMinutes, stopOnError, overrides: buildOverrides() }),
      });

      if (!startResponse.ok) {
        throw new Error('Failed to start processing');
      }

      toast({
        title: "Processing Started",
        description: `Processing ${files.length} file${files.length !== 1 ? 's' : ''}...`,
      });
    } catch (error) {
      console.error('Processing error:', error);
      toast({
        title: "Error",
        description: "Failed to start batch processing. Please try again.",
        variant: "destructive",
      });
      setProcessingState('idle');
    }
  };

  const handleCancelProcessing = async () => {
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
              stopOnError={stopOnError}
              outputFormat={outputFormat}
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
              onOutputFormatChange={setOutputFormat}
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
                      <p className="text-muted-foreground">
                        Found at: <span className="font-mono text-xs">{swmmStatus.path}</span>
                      </p>
                      <p className="text-muted-foreground text-xs">
                        Simulations will run using the real SWMM engine.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-medium" data-testid="text-swmm-not-found">SWMM Engine Unavailable</p>
                      <p className="text-muted-foreground">
                        No SWMM engine was found. The app searched these locations:
                      </p>
                      {swmmStatus?.searchedPaths && swmmStatus.searchedPaths.length > 0 && (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-muted-foreground">
                            Searched {swmmStatus.searchedPaths.length} locations
                          </summary>
                          <ul className="font-mono text-muted-foreground space-y-0.5 mt-1 pl-4">
                            {swmmStatus.searchedPaths.map((p, i) => (
                              <li key={i}>{p}</li>
                            ))}
                          </ul>
                        </details>
                      )}
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
                          <p><span className="font-semibold">SWMM6 (Browser)</span> — runs the OpenSWMM engine (swmm6_rel, legacy engine v5.3.0 with extra link-depth validation warnings) in your browser.</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Button
                          size="sm"
                          variant={engineMode === 'executable' ? 'default' : 'outline'}
                          onClick={() => setEngineMode('executable')}
                          disabled={processingState === 'processing' || !swmmStatus?.found}
                          data-testid="button-mode-executable"
                          className="toggle-elevate"
                        >
                          <Terminal className="h-3.5 w-3.5 mr-1.5" />
                          Executable
                        </Button>
                        <Button
                          size="sm"
                          variant={engineMode === 'api' ? 'default' : 'outline'}
                          onClick={() => setEngineMode('api')}
                          disabled={processingState === 'processing' || !swmmStatus?.apiAvailable}
                          data-testid="button-mode-api"
                          className="toggle-elevate"
                        >
                          <Cpu className="h-3.5 w-3.5 mr-1.5" />
                          SWMM5 API
                        </Button>
                        <Button
                          size="sm"
                          variant={engineMode === 'wasm' ? 'default' : 'outline'}
                          onClick={() => setEngineMode('wasm')}
                          disabled={processingState === 'processing'}
                          data-testid="button-mode-wasm"
                          className="toggle-elevate"
                        >
                          <Globe className="h-3.5 w-3.5 mr-1.5" />
                          WASM (Browser)
                        </Button>
                        <Button
                          size="sm"
                          variant={engineMode === 'wasm6' ? 'default' : 'outline'}
                          onClick={() => setEngineMode('wasm6')}
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
                      <p className="text-xs text-muted-foreground mt-1.5">
                        {engineMode === 'executable'
                          ? 'Spawns runswmm as a child process (standard mode).'
                          : engineMode === 'api'
                          ? 'Uses SWMM5 shared library for step-by-step control with live data streaming.'
                          : engineMode === 'wasm'
                          ? 'Runs EPA SWMM 5.2.4 compiled to WebAssembly entirely in your browser — no server round-trip, files never leave your device.'
                          : 'Runs the OpenSWMM SWMM6 engine (swmm6_rel release, legacy engine v5.3.0 with extra link-depth validation warnings) as WebAssembly in your browser.'}
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
                Start Batch Processing
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

          {processingState === 'processing' && (
            <>
              <Separator />
              <section data-testid="section-progress">
                <ProgressSection
                  current={currentFile}
                  total={files.length}
                  currentFileName={files[currentFile - 1]?.name}
                  startTime={startTime || undefined}
                  successCount={results.filter(r => r.status === 'success').length}
                  failedCount={results.filter(r => r.status === 'failed').length}
                  fileProgressMap={fileProgressMap}
                  fileNames={files.map(f => f.name)}
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
                <ResultsDisplay results={results} elapsedTime={elapsedTime} />
              </section>
            </>
          )}
        </div>
      </main>

      <footer className="border-t mt-auto">
        <div className="container max-w-6xl mx-auto px-3 sm:px-6 md:px-8 py-3 md:py-4">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground flex-wrap">
            <p data-testid="text-footer-version">BatchSWMM v1.0.0</p>
            <p className="font-mono truncate max-w-full" data-testid="text-footer-executable">
              {swmmStatus?.found ? swmmStatus.path : 'server engine unavailable'}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
