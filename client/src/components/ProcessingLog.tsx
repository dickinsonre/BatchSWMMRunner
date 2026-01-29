import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Terminal } from "lucide-react";

export interface LogEntry {
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'complete';
}

interface ProcessingLogProps {
  logs: LogEntry[];
}

export default function ProcessingLog({ logs }: ProcessingLogProps) {
  if (logs.length === 0) return null;

  return (
    <Card data-testid="card-processing-log">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Terminal className="h-4 w-4" />
          Processing Log
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-48">
          <div className="font-mono text-xs space-y-1" data-testid="log-entries">
            {logs.map((log, index) => (
              <div 
                key={index} 
                className={`flex gap-2 ${
                  log.type === 'success' ? 'text-green-600' : 
                  log.type === 'error' ? 'text-destructive' : 
                  log.type === 'complete' ? 'text-primary font-medium' : 
                  'text-muted-foreground'
                }`}
                data-testid={`log-entry-${index}`}
              >
                <span className="text-muted-foreground shrink-0">[{log.timestamp}]</span>
                <span>{log.message}</span>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
