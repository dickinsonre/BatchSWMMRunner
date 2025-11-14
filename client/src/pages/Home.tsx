import { useState } from "react";
import { Activity, PlayCircle, StopCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import FileUploadZone from "@/components/FileUploadZone";
import FileListPanel, { type FileItem } from "@/components/FileListPanel";
import ProgressSection from "@/components/ProgressSection";
import ResultsDisplay, { type ProcessResult } from "@/components/ResultsDisplay";

type ProcessingState = 'idle' | 'processing' | 'completed';

export default function Home() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [processingState, setProcessingState] = useState<ProcessingState>('idle');
  const [currentFile, setCurrentFile] = useState(0);
  const [results, setResults] = useState<ProcessResult[]>([]);

  const handleFilesSelected = (fileList: FileList) => {
    const newFiles: FileItem[] = Array.from(fileList).map((file, index) => ({
      id: `${Date.now()}-${index}`,
      name: file.name,
      path: file.webkitRelativePath || file.name,
    }));
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
  };

  const handleStartProcessing = () => {
    console.log('Starting batch processing...');
    setProcessingState('processing');
    setCurrentFile(0);
    setResults([]);
    
    // Simulate processing
    let current = 0;
    const interval = setInterval(() => {
      current++;
      setCurrentFile(current);
      
      // Simulate random success/failure
      const newResult: ProcessResult = {
        id: files[current - 1].id,
        fileName: files[current - 1].name,
        filePath: files[current - 1].path,
        status: Math.random() > 0.2 ? 'success' : 'failed',
        error: Math.random() > 0.2 ? undefined : 'Error 110: cannot open rainfall data file',
      };
      
      setResults(prev => [...prev, newResult]);
      
      if (current >= files.length) {
        clearInterval(interval);
        setProcessingState('completed');
      }
    }, 1500);
  };

  const handleCancelProcessing = () => {
    console.log('Cancelling processing...');
    setProcessingState('idle');
    setCurrentFile(0);
    setResults([]);
  };

  return (
    <div className="min-h-screen bg-background">
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

      <main className="container max-w-6xl mx-auto px-8 py-8">
        <div className="space-y-8">
          <section data-testid="section-upload">
            <FileUploadZone
              onFilesSelected={handleFilesSelected}
              selectedCount={files.length}
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

              <div className="flex gap-3">
                {processingState === 'idle' && (
                  <Button
                    size="lg"
                    onClick={handleStartProcessing}
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
              </div>
            </>
          )}

          {processingState === 'processing' && (
            <>
              <Separator />
              <section data-testid="section-progress">
                <ProgressSection
                  current={currentFile}
                  total={files.length}
                  currentFileName={files[currentFile]?.name}
                />
              </section>
            </>
          )}

          {processingState === 'completed' && results.length > 0 && (
            <>
              <Separator />
              <section data-testid="section-results">
                <ResultsDisplay results={results} />
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
