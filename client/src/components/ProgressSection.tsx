import { Loader2, Clock, CheckCircle, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

interface ProgressSectionProps {
  current: number;
  total: number;
  currentFileName?: string;
  startTime?: number;
  successCount?: number;
  failedCount?: number;
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
  failedCount = 0
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
        </div>
      </CardContent>
    </Card>
  );
}
