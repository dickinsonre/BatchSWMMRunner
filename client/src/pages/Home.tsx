import { useState, useEffect, useRef } from "react";
import { Activity, PlayCircle, StopCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import FileUploadZone from "@/components/FileUploadZone";
import FileListPanel, { type FileItem } from "@/components/FileListPanel";
import ProgressSection from "@/components/ProgressSection";
import ResultsDisplay, { type ProcessResult } from "@/components/ResultsDisplay";
import WorkflowSteps from "@/components/WorkflowSteps";
import InstructionsPanel from "@/components/InstructionsPanel";
import ExpectedOutputs from "@/components/ExpectedOutputs";
import SimulationSettings from "@/components/SimulationSettings";
import ProcessingLog, { type LogEntry } from "@/components/ProcessingLog";

type ProcessingState = 'idle' | 'processing' | 'completed';

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
  const [reportStep, setReportStep] = useState(15);
  const [routingMethod, setRoutingMethod] = useState("dynamic");
  const [parallelProcessing, setParallelProcessing] = useState(false);
  const [stopOnError, setStopOnError] = useState(false);
  const [outputFormat, setOutputFormat] = useState("all");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const { toast } = useToast();

  const totalSize = files.reduce((acc, f: any) => acc + (f.file?.size || 0), 0);

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const connectWebSocket = (jobId: string) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws?jobId=${jobId}`);

    ws.onopen = () => {
      console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      const getTimestamp = () => {
        const now = new Date();
        return now.toISOString().replace('T', ' ').substring(0, 19);
      };

      if (data.type === 'progress') {
        setCurrentFile(data.currentFile);
        setLogs(prev => [...prev, {
          timestamp: getTimestamp(),
          message: `Processing ${data.fileName}...`,
          type: 'info'
        }]);
      } else if (data.type === 'result') {
        setResults(prev => [...prev, data.result]);
        const result = data.result;
        setLogs(prev => [...prev, {
          timestamp: getTimestamp(),
          message: result.status === 'success' 
            ? `Processing ${result.fileName}... Success`
            : `Processing ${result.fileName}... Error: ${result.error || 'Unknown error'}`,
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
      file,
    })) as any;
    setFiles(prev => [...prev, ...newFiles]);
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
    startTimeRef.current = null;
  };

  const handleStartProcessing = async () => {
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
      setStartTime(Date.now());
      startTimeRef.current = Date.now();

      connectWebSocket(batchJob.id);

      const startResponse = await fetch(`/api/batch/${batchJob.id}/start`, {
        method: 'POST',
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
      <header className="border-b">
        <div className="container max-w-6xl mx-auto px-8 py-6">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary p-2">
              <Activity className="h-6 w-6 text-primary-foreground" data-testid="icon-app-logo" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold" data-testid="text-app-title">BatchSWMM</h1>
              <p className="text-sm text-muted-foreground" data-testid="text-app-subtitle">
                Batch EPA SWMM Processing Tool
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="container max-w-6xl mx-auto px-8 py-8 flex-1">
        <div className="space-y-8">
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
              onReportStepChange={setReportStep}
              onRoutingMethodChange={setRoutingMethod}
              onParallelProcessingChange={setParallelProcessing}
              onStopOnErrorChange={setStopOnError}
              onOutputFormatChange={setOutputFormat}
              disabled={processingState === 'processing'}
            />
          </section>

          <Separator />

          <section data-testid="section-upload">
            <FileUploadZone
              onFilesSelected={handleFilesSelected}
              selectedCount={files.length}
              totalSize={totalSize}
              invalidFiles={invalidFiles}
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
              <Button
                size="lg"
                variant="outline"
                onClick={handleClearAll}
                data-testid="button-reset"
              >
                Process New Batch
              </Button>
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
                />
              </section>
              <section data-testid="section-processing-log">
                <ProcessingLog logs={logs} />
              </section>
            </>
          )}

          {processingState === 'completed' && results.length > 0 && (
            <>
              <Separator />
              <section data-testid="section-processing-log">
                <ProcessingLog logs={logs} />
              </section>
              <section data-testid="section-results">
                <ResultsDisplay results={results} elapsedTime={elapsedTime} />
              </section>
            </>
          )}
        </div>
      </main>

      <footer className="border-t mt-auto">
        <div className="container max-w-6xl mx-auto px-8 py-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <p data-testid="text-footer-version">BatchSWMM v1.0.0</p>
            <p className="font-mono" data-testid="text-footer-executable">
              runswmm.exe
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
