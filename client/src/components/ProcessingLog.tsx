import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Terminal, ChevronDown, ChevronUp } from "lucide-react";

export interface LogEntry {
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'complete' | 'stdout' | 'stderr';
  fileName?: string;
}

interface ProcessingLogProps {
  logs: LogEntry[];
  defaultCollapsed?: boolean;
}

export default function ProcessingLog({ logs, defaultCollapsed = false }: ProcessingLogProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current && !collapsed) {
      const viewport = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    }
  }, [logs, collapsed]);

  if (logs.length === 0) return null;

  return (
    <Card data-testid="card-processing-log">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Terminal className="h-4 w-4" />
            Processing Log
            <span className="text-xs font-normal text-muted-foreground">({logs.length} entries)</span>
          </CardTitle>
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => setCollapsed(!collapsed)}
            data-testid="button-toggle-log"
          >
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>
      {!collapsed && (
        <CardContent>
          <ScrollArea className="h-56" ref={scrollRef}>
            <div className="font-mono text-xs space-y-0.5" data-testid="log-entries">
              {logs.map((log, index) => (
                <div 
                  key={index} 
                  className={`flex gap-2 py-0.5 ${
                    log.type === 'success' ? 'text-green-600' : 
                    log.type === 'error' || log.type === 'stderr' ? 'text-destructive' : 
                    log.type === 'complete' ? 'text-primary font-medium' : 
                    log.type === 'stdout' ? 'text-muted-foreground/80' :
                    'text-muted-foreground'
                  }`}
                  data-testid={`log-entry-${index}`}
                >
                  <span className="text-muted-foreground shrink-0">[{log.timestamp}]</span>
                  {log.fileName && log.type === 'stdout' && (
                    <span className="text-muted-foreground/60 shrink-0">[{log.fileName}]</span>
                  )}
                  {log.fileName && log.type === 'stderr' && (
                    <span className="text-destructive/60 shrink-0">[{log.fileName}]</span>
                  )}
                  <span className="break-all">{log.message}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      )}
    </Card>
  );
}
