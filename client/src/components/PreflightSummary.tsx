import { useMemo, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronRight, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PreflightResult } from "@shared/inpScanner";

export interface PreflightSummaryProps {
  /** fileId -> result; missing entries are still being scanned. */
  results: Record<string, PreflightResult>;
  files: { id: string; name: string }[];
  onRemoveInvalid?: () => void;
}

export default function PreflightSummary({ results, files, onRemoveInvalid }: PreflightSummaryProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { ready, warning, invalid, pending } = useMemo(() => {
    let ready = 0, warning = 0, invalid = 0, pending = 0;
    for (const f of files) {
      const r = results[f.id];
      if (!r) pending++;
      else if (r.status === 'ready') ready++;
      else if (r.status === 'warning') warning++;
      else invalid++;
    }
    return { ready, warning, invalid, pending };
  }, [results, files]);

  if (files.length === 0) return null;

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Show files with issues first
  const ordered = [...files].sort((a, b) => {
    const rank = (id: string) => {
      const r = results[id];
      if (!r) return 3;
      return r.status === 'invalid' ? 0 : r.status === 'warning' ? 1 : 2;
    };
    return rank(a.id) - rank(b.id);
  });

  return (
    <Card data-testid="card-preflight-summary">
      <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
        <CardTitle className="text-lg" data-testid="text-preflight-title">
          Preflight Check
        </CardTitle>
        <div className="flex items-center gap-2 flex-wrap" data-testid="text-preflight-counts">
          <Badge variant="outline" className="text-green-600 dark:text-green-400 border-green-600/40" data-testid="badge-preflight-ready">
            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />{ready} ready
          </Badge>
          <Badge variant="outline" className="text-yellow-600 dark:text-yellow-400 border-yellow-600/40" data-testid="badge-preflight-warning">
            <AlertTriangle className="h-3.5 w-3.5 mr-1" />{warning} warning{warning === 1 ? '' : 's'}
          </Badge>
          <Badge variant="outline" className="text-red-600 dark:text-red-400 border-red-600/40" data-testid="badge-preflight-invalid">
            <XCircle className="h-3.5 w-3.5 mr-1" />{invalid} invalid
          </Badge>
          {pending > 0 && (
            <Badge variant="outline" data-testid="badge-preflight-pending">
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />{pending} scanning…
            </Badge>
          )}
          {invalid > 0 && onRemoveInvalid && (
            <Button variant="outline" size="sm" onClick={onRemoveInvalid} data-testid="button-remove-invalid">
              <Trash2 className="h-4 w-4 mr-1" />Remove invalid
            </Button>
          )}
        </div>
      </CardHeader>
      {(invalid > 0 || warning > 0) && (
        <CardContent className="pt-0">
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {ordered.map(f => {
              const r = results[f.id];
              if (!r || r.status === 'ready') return null;
              const isOpen = expanded.has(f.id);
              const Icon = r.status === 'invalid' ? XCircle : AlertTriangle;
              const color = r.status === 'invalid'
                ? 'text-red-600 dark:text-red-400'
                : 'text-yellow-600 dark:text-yellow-400';
              return (
                <div key={f.id} data-testid={`preflight-file-${f.id}`}>
                  <button
                    type="button"
                    className="flex items-center gap-2 w-full text-left text-sm py-1 hover-elevate rounded-md px-1"
                    onClick={() => toggle(f.id)}
                    data-testid={`button-preflight-toggle-${f.id}`}
                  >
                    {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                    <Icon className={`h-4 w-4 shrink-0 ${color}`} />
                    <span className="truncate font-medium">{f.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {r.errorCount > 0 && `${r.errorCount} error${r.errorCount === 1 ? '' : 's'}`}
                      {r.errorCount > 0 && r.warningCount > 0 && ', '}
                      {r.warningCount > 0 && `${r.warningCount} warning${r.warningCount === 1 ? '' : 's'}`}
                    </span>
                  </button>
                  {isOpen && (
                    <ul className="ml-11 mb-2 space-y-0.5 text-xs text-muted-foreground list-disc">
                      {r.issues.map((issue, i) => (
                        <li key={i} className={issue.severity === 'error' ? 'text-red-600 dark:text-red-400' : ''}>
                          {issue.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
