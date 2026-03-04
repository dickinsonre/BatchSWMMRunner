import { Loader2, Clock, CheckCircle, XCircle, FileText, CircleDot } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

export interface FileProgressInfo {
  fileId: string;
  fileName: string;
  percentage: number;
  message: string;
  status: 'pending' | 'running' | 'success' | 'failed';
}

interface ProgressSectionProps {
  current: number;
  total: number;
  currentFileName?: string;
  startTime?: number;
  successCount?: number;
  failedCount?: number;
  fileProgressMap?: Map<string, FileProgressInfo>;
  fileNames?: string[];
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}

export default function ProgressSection({ 
  current, 
  total, 
  currentFileName, 
  startTime,
  successCount = 0,
  failedCount = 0,
  fileProgressMap,
  fileNames = [],
}: ProgressSectionProps) {
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
  const completedCount = successCount + failedCount;
  
  let eta = '';
  let elapsed = '';
  if (startTime && completedCount > 0) {
    const elapsedMs = Date.now() - startTime;
    const elapsedSec = elapsedMs / 1000;
    elapsed = formatTime(elapsedSec);
    
    const avgTimePerFile = elapsedSec / completedCount;
    const remainingFiles = total - completedCount;
    const etaSeconds = avgTimePerFile * remainingFiles;
    if (remainingFiles > 0) {
      eta = formatTime(etaSeconds);
    }
  }

  const fileEntries = fileNames.map((name, index) => {
    let matchedProgress: FileProgressInfo | undefined;
    if (fileProgressMap) {
      for (const entry of fileProgressMap.values()) {
        if (entry.fileName === name) {
          matchedProgress = entry;
          break;
        }
      }
    }

    let status: 'pending' | 'running' | 'success' | 'failed' = 'pending';
    let pct = 0;
    let message = 'Waiting...';

    if (matchedProgress) {
      status = matchedProgress.status;
      pct = matchedProgress.percentage;
      message = matchedProgress.message;
    } else if (index < current - 1) {
      status = 'success';
      pct = 100;
      message = 'Complete';
    } else if (index === current - 1) {
      status = 'running';
    }

    return { name, status, pct, message };
  });

  return (
    <Card data-testid="card-progress">
      <CardContent className="p-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" data-testid="icon-processing" />
              <h3 className="text-lg font-semibold" data-testid="text-progress-title">
                Processing Batch
              </h3>
            </div>
            <div className="flex items-center gap-4">
              {elapsed && (
                <div className="flex items-center gap-1 text-sm text-muted-foreground" data-testid="text-elapsed">
                  <Clock className="h-4 w-4" />
                  {elapsed}
                </div>
              )}
              <div className="text-2xl font-bold text-primary" data-testid="text-progress-percentage">
                {percentage}%
              </div>
            </div>
          </div>
          
          <Progress value={percentage} className="h-2" data-testid="progress-bar" />
          
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground" data-testid="text-progress-status">
                Processing file {current} of {total}
              </p>
              {currentFileName && (
                <p className="text-sm font-medium font-mono truncate max-w-md" data-testid="text-current-file">
                  {currentFileName}
                </p>
              )}
            </div>
            
            <div className="flex items-center gap-4">
              {completedCount > 0 && (
                <div className="flex items-center gap-3" data-testid="progress-stats">
                  <div className="flex items-center gap-1">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <span className="text-sm font-medium text-green-600" data-testid="text-progress-success">{successCount}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <XCircle className="h-4 w-4 text-destructive" />
                    <span className="text-sm font-medium text-destructive" data-testid="text-progress-failed">{failedCount}</span>
                  </div>
                </div>
              )}
              {eta && (
                <Badge variant="secondary" data-testid="badge-eta">
                  ~{eta} remaining
                </Badge>
              )}
            </div>
          </div>

          {fileEntries.length > 0 && (
            <div className="border-t pt-4 mt-4" data-testid="file-progress-list">
              <p className="text-xs font-medium text-muted-foreground mb-3">Per-File Progress</p>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {fileEntries.map((entry, idx) => (
                  <div 
                    key={idx}
                    className="flex items-center gap-3 text-xs"
                    data-testid={`file-progress-${idx}`}
                  >
                    <div className="flex-shrink-0 w-4">
                      {entry.status === 'running' && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                      )}
                      {entry.status === 'success' && (
                        <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                      )}
                      {entry.status === 'failed' && (
                        <XCircle className="h-3.5 w-3.5 text-destructive" />
                      )}
                      {entry.status === 'pending' && (
                        <CircleDot className="h-3.5 w-3.5 text-muted-foreground/40" />
                      )}
                    </div>
                    <span className="font-mono truncate min-w-0 flex-shrink" style={{ maxWidth: '180px' }}>
                      {entry.name}
                    </span>
                    <div className="flex-1 min-w-0">
                      <Progress 
                        value={entry.pct} 
                        className="h-1.5"
                        data-testid={`file-progress-bar-${idx}`}
                      />
                    </div>
                    <span className={`flex-shrink-0 w-10 text-right tabular-nums ${
                      entry.status === 'success' ? 'text-green-600' :
                      entry.status === 'failed' ? 'text-destructive' :
                      entry.status === 'running' ? 'text-primary' :
                      'text-muted-foreground'
                    }`}>
                      {entry.pct}%
                    </span>
                    <span className="flex-shrink-0 text-muted-foreground truncate" style={{ maxWidth: '140px' }}>
                      {entry.message}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
