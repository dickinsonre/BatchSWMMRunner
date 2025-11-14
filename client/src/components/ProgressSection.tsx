import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

interface ProgressSectionProps {
  current: number;
  total: number;
  currentFileName?: string;
}

export default function ProgressSection({ current, total, currentFileName }: ProgressSectionProps) {
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <Card data-testid="card-progress">
      <CardContent className="p-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" data-testid="icon-processing" />
              <h3 className="text-lg font-semibold" data-testid="text-progress-title">
                Processing Batch
              </h3>
            </div>
            <div className="text-2xl font-bold text-primary" data-testid="text-progress-percentage">
              {percentage}%
            </div>
          </div>
          
          <Progress value={percentage} className="h-2" data-testid="progress-bar" />
          
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground" data-testid="text-progress-status">
              Processing file {current} of {total}
            </p>
            {currentFileName && (
              <p className="text-sm font-medium font-mono" data-testid="text-current-file">
                {currentFileName}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
