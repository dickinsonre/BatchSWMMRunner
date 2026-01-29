import { CheckCircle, XCircle, ChevronDown, ChevronRight, Download, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useState } from "react";

export interface ProcessResult {
  id: string;
  fileName: string;
  filePath: string;
  status: 'success' | 'failed';
  error?: string;
  processingTime?: number;
  results?: {
    peakFlow?: number;
    totalVolume?: number;
  };
}

interface ResultsDisplayProps {
  results: ProcessResult[];
  elapsedTime?: string;
}

export default function ResultsDisplay({ results, elapsedTime }: ResultsDisplayProps) {
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

  const exportToCSV = () => {
    const headers = ['File Name', 'File Path', 'Status', 'Peak Flow (CFS)', 'Total Volume (MG)', 'Processing Time (s)', 'Error'];
    const rows = results.map(r => [
      r.fileName,
      r.filePath,
      r.status,
      r.results?.peakFlow?.toFixed(2) || 'N/A',
      r.results?.totalVolume?.toFixed(2) || 'N/A',
      r.processingTime?.toFixed(1) || 'N/A',
      r.error || ''
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `batch-swmm-results-${new Date().toISOString().slice(0,10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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

      {elapsedTime && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="text-total-time">
          <Clock className="h-4 w-4" />
          Total processing time: {elapsedTime}
        </div>
      )}

      <Card data-testid="card-summary-table">
        <CardHeader>
          <CardTitle className="text-lg" data-testid="text-summary-title">Summary Table</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-summary">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3 font-medium">File Name</th>
                  <th className="text-left py-2 px-3 font-medium">Status</th>
                  <th className="text-right py-2 px-3 font-medium">Peak Flow</th>
                  <th className="text-right py-2 px-3 font-medium">Total Volume</th>
                  <th className="text-right py-2 px-3 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result) => (
                  <tr key={result.id} className="border-b last:border-0" data-testid={`row-summary-${result.id}`}>
                    <td className="py-2 px-3 font-mono text-xs">{result.fileName}</td>
                    <td className="py-2 px-3">
                      {result.status === 'success' ? (
                        <span className="text-green-600 flex items-center gap-1">
                          <CheckCircle className="h-3 w-3" /> Success
                        </span>
                      ) : (
                        <span className="text-destructive flex items-center gap-1">
                          <XCircle className="h-3 w-3" /> Failed
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right font-mono">
                      {result.results?.peakFlow != null ? `${result.results.peakFlow.toFixed(2)} CFS` : 'N/A'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono">
                      {result.results?.totalVolume != null ? `${result.results.totalVolume.toFixed(2)} MG` : 'N/A'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono">
                      {result.processingTime != null ? `${result.processingTime.toFixed(1)}s` : 'N/A'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-results-list">
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
          <CardTitle className="text-lg" data-testid="text-results-title">Processing Results</CardTitle>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={exportToCSV}
            data-testid="button-export-csv"
          >
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
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
