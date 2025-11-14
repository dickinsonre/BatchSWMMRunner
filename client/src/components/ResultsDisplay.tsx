import { CheckCircle, XCircle, ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useState } from "react";

export interface ProcessResult {
  id: string;
  fileName: string;
  filePath: string;
  status: 'success' | 'failed';
  error?: string;
}

interface ResultsDisplayProps {
  results: ProcessResult[];
}

export default function ResultsDisplay({ results }: ResultsDisplayProps) {
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());
  
  const successCount = results.filter(r => r.status === 'success').length;
  const failedCount = results.filter(r => r.status === 'failed').length;

  const toggleError = (id: string) => {
    const newExpanded = new Set(expandedErrors);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedErrors(newExpanded);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card data-testid="card-summary-total">
          <CardContent className="p-6">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Total Processed</p>
              <p className="text-3xl font-bold mt-2" data-testid="text-total-processed">{results.length}</p>
            </div>
          </CardContent>
        </Card>
        
        <Card data-testid="card-summary-success">
          <CardContent className="p-6">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Successful</p>
              <p className="text-3xl font-bold mt-2 text-green-600" data-testid="text-total-success">{successCount}</p>
            </div>
          </CardContent>
        </Card>
        
        <Card data-testid="card-summary-failed">
          <CardContent className="p-6">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Failed</p>
              <p className="text-3xl font-bold mt-2 text-destructive" data-testid="text-total-failed">{failedCount}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-results-list">
        <CardHeader>
          <CardTitle className="text-lg" data-testid="text-results-title">Processing Results</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="max-h-96">
            <div className="space-y-2">
              {results.map((result) => (
                <div
                  key={result.id}
                  className="rounded-md border p-4"
                  data-testid={`card-result-${result.id}`}
                >
                  <div className="flex items-start gap-3">
                    {result.status === 'success' ? (
                      <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" data-testid={`icon-success-${result.id}`} />
                    ) : (
                      <XCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" data-testid={`icon-failed-${result.id}`} />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium" data-testid={`text-result-filename-${result.id}`}>
                          {result.fileName}
                        </p>
                        <Badge
                          variant={result.status === 'success' ? 'default' : 'destructive'}
                          data-testid={`badge-status-${result.id}`}
                        >
                          {result.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground font-mono mt-1" data-testid={`text-result-filepath-${result.id}`}>
                        {result.filePath}
                      </p>
                      {result.error && (
                        <div className="mt-2">
                          <button
                            onClick={() => toggleError(result.id)}
                            className="flex items-center gap-1 text-xs text-destructive hover-elevate rounded px-2 py-1"
                            data-testid={`button-toggle-error-${result.id}`}
                          >
                            {expandedErrors.has(result.id) ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronRight className="h-3 w-3" />
                            )}
                            Error Details
                          </button>
                          {expandedErrors.has(result.id) && (
                            <pre className="mt-2 text-xs bg-muted p-3 rounded font-mono overflow-x-auto" data-testid={`text-error-details-${result.id}`}>
                              {result.error}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
