import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, GitCompareArrows } from "lucide-react";
import { buildComparison, type EngineRun, type FileComparison } from "@/lib/engineComparison";

function fmt(v: number | undefined): string {
  if (v === undefined) return "—";
  if (Number.isInteger(v)) return String(v);
  return Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(3);
}

function verdictBadge(verdict: FileComparison['verdict']) {
  if (verdict === 'match') return <Badge variant="outline" className="text-green-600 border-green-500/40" data-testid="badge-verdict-match">Engines agree</Badge>;
  if (verdict === 'differs') return <Badge variant="outline" className="text-yellow-600 border-yellow-500/40" data-testid="badge-verdict-differs">Results differ</Badge>;
  if (verdict === 'inconclusive') return <Badge variant="outline" className="text-muted-foreground" data-testid="badge-verdict-inconclusive">Not comparable</Badge>;
  return <Badge variant="destructive" data-testid="badge-verdict-status">Status mismatch</Badge>;
}

function statusBadge(status: FileComparison['statuses'][number]) {
  if (status === 'success') return <Badge variant="outline" className="text-green-600 border-green-500/40">success</Badge>;
  if (status === 'missing') return <Badge variant="outline" className="text-muted-foreground">no result</Badge>;
  return <Badge variant="destructive">{status}</Badge>;
}

export default function EngineComparisonView({ runs }: { runs: EngineRun[] }) {
  const [openFiles, setOpenFiles] = useState<Set<string>>(new Set());
  if (runs.length < 2) return null;
  const summary = buildComparison(runs);

  const toggle = (fileName: string) => {
    setOpenFiles(prev => {
      const next = new Set(prev);
      next.has(fileName) ? next.delete(fileName) : next.add(fileName);
      return next;
    });
  };

  return (
    <Card data-testid="card-engine-comparison">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <GitCompareArrows className="h-5 w-5" />
          Engine Comparison
          <span className="text-sm font-normal text-muted-foreground ml-2">
            {summary.engines.map(e => e.label).join(' vs ')}
          </span>
        </CardTitle>
        <div className="flex gap-2 flex-wrap text-xs" data-testid="text-comparison-summary">
          <Badge variant="outline" className="text-green-600 border-green-500/40">{summary.matchCount} agree</Badge>
          {summary.differCount > 0 && <Badge variant="outline" className="text-yellow-600 border-yellow-500/40">{summary.differCount} differ</Badge>}
          {summary.statusMismatchCount > 0 && <Badge variant="destructive">{summary.statusMismatchCount} status mismatch</Badge>}
          {summary.inconclusiveCount > 0 && <Badge variant="outline" className="text-muted-foreground">{summary.inconclusiveCount} not comparable</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">
          Values are compared with small tolerances (continuity errors within 0.05 points, volumes within 0.5%).
          Warning counts and run times are shown for reference but don't count as differences.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {summary.files.map(file => {
          const open = openFiles.has(file.fileName) || file.verdict !== 'match';
          const differingMetrics = file.metrics.filter(m => m.differs);
          return (
            <div key={file.fileName} className="border rounded-md" data-testid={`row-comparison-${file.fileName}`}>
              <button
                type="button"
                onClick={() => toggle(file.fileName)}
                className="w-full flex items-center gap-2 p-3 text-left hover-elevate"
                data-testid={`button-toggle-comparison-${file.fileName}`}
              >
                {open ? <ChevronDown className="h-4 w-4 flex-shrink-0" /> : <ChevronRight className="h-4 w-4 flex-shrink-0" />}
                <span className="font-mono text-sm truncate flex-1">{file.fileName}</span>
                {file.verdict === 'differs' && differingMetrics.length > 0 && (
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    {differingMetrics.map(m => m.label.replace(/ \(.*\)$/, '')).slice(0, 3).join(', ')}
                  </span>
                )}
                {verdictBadge(file.verdict)}
              </button>
              {open && (
                <div className="px-3 pb-3 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-muted-foreground">
                        <th className="text-left py-1 pr-3 font-medium">Metric</th>
                        {summary.engines.map((e, i) => (
                          <th key={e.engine} className="text-right py-1 px-2 font-medium whitespace-nowrap">{e.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t">
                        <td className="py-1.5 pr-3">Status</td>
                        {file.statuses.map((s, i) => (
                          <td key={i} className="text-right py-1.5 px-2">{statusBadge(s)}</td>
                        ))}
                      </tr>
                      {file.metrics.map(m => {
                        const hasAny = m.values.some(v => v !== undefined);
                        if (!hasAny) return null;
                        return (
                          <tr key={m.key} className={`border-t ${m.differs ? 'bg-yellow-500/10' : ''}`}>
                            <td className="py-1.5 pr-3">
                              {m.label}
                              {m.differs && <Badge variant="outline" className="ml-2 text-yellow-600 border-yellow-500/40">Δ {fmt(m.maxDelta)}</Badge>}
                            </td>
                            {m.values.map((v, i) => (
                              <td key={i} className={`text-right py-1.5 px-2 font-mono ${m.differs ? 'font-semibold' : ''}`}>{fmt(v)}</td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {file.results.some(r => r?.error) && (
                    <div className="mt-2 space-y-1">
                      {file.results.map((r, i) => r?.error ? (
                        <p key={i} className="text-xs text-destructive">
                          <span className="font-medium">{summary.engines[i].label}:</span> {r.error}
                        </p>
                      ) : null)}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
