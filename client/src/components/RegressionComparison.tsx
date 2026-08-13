import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle, XCircle, Flag, Trash2, HelpCircle } from "lucide-react";
import type { ProcessResult } from "@shared/schema";
import {
  buildBaselineFromResult,
  selectComparisons,
  loadBaselines,
  saveBaseline,
  removeBaseline,
  type RegressionBaseline,
} from "@/lib/regressionBaseline";

interface RegressionComparisonProps {
  results: ProcessResult[];
  /**
   * Fetch full report text for one result (server-run batches store it
   * separately). May return the fetched content directly; it may also update
   * parent state as a side effect, but callers here never depend on that.
   */
  onLoadContent?: (resultId: string) => Promise<{ reportContent?: string } | null | undefined | void>;
}

const TOLERANCE_KEY = 'swmm-regression-tolerance';

function loadTolerance(): number {
  try {
    const v = parseFloat(localStorage.getItem(TOLERANCE_KEY) ?? '');
    return Number.isFinite(v) && v >= 0 ? v : 5;
  } catch {
    return 5;
  }
}

function fmt(v: number | undefined, digits = 3): string {
  if (v === undefined) return '—';
  return v.toFixed(digits);
}

/**
 * Regression testing against a saved baseline: mark one completed result as
 * BASELINE, then any later run of the same model shows Baseline vs Current vs
 * Δ vs Δ% per metric and a PASS/FAIL verdict under a configurable tolerance.
 */
export default function RegressionComparison({ results, onLoadContent }: RegressionComparisonProps) {
  const [baselines, setBaselines] = useState<Record<string, RegressionBaseline>>(() => loadBaselines());
  const [tolerance, setTolerance] = useState<number>(() => loadTolerance());
  const [toleranceText, setToleranceText] = useState<string>(() => String(loadTolerance()));
  const [settingId, setSettingId] = useState<string | null>(null);

  const successResults = useMemo(() => results.filter(r => r.status === 'success'), [results]);

  // Auto-load report text for successful results that have a saved baseline,
  // so report-derived metrics (peak outfall flow, max node depth) can be
  // compared for server batches that return light summaries.
  useEffect(() => {
    if (!onLoadContent) return;
    for (const r of successResults) {
      if (baselines[r.fileName] && r.hasReport && !r.reportContent) {
        onLoadContent(r.id).catch(() => {});
      }
    }
  }, [successResults, baselines, onLoadContent]);

  const handleSetBaseline = async (result: ProcessResult) => {
    setSettingId(result.id);
    try {
      // The report is fetched and merged directly inside the builder — parent
      // state updates from onLoadContent are asynchronous and never relied on.
      const baseline = await buildBaselineFromResult(result, onLoadContent);
      saveBaseline(baseline);
      setBaselines(loadBaselines());
    } finally {
      setSettingId(null);
    }
  };

  const handleRemoveBaseline = (fileName: string) => {
    removeBaseline(fileName);
    setBaselines(loadBaselines());
  };

  const handleToleranceChange = (text: string) => {
    setToleranceText(text);
    const v = parseFloat(text);
    if (Number.isFinite(v) && v >= 0) {
      setTolerance(v);
      try { localStorage.setItem(TOLERANCE_KEY, String(v)); } catch { /* ignore */ }
    }
  };

  const comparisons = useMemo(
    () => selectComparisons(successResults, baselines, tolerance),
    [successResults, baselines, tolerance],
  );

  if (successResults.length === 0) return null;

  return (
    <Card data-testid="card-regression-comparison">
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 flex-wrap">
        <CardTitle className="text-lg" data-testid="text-regression-title">
          Regression Testing (Baseline Comparison)
        </CardTitle>
        <div className="flex items-center gap-2">
          <label htmlFor="regression-tolerance" className="text-xs text-muted-foreground whitespace-nowrap">
            Tolerance (±%)
          </label>
          <Input
            id="regression-tolerance"
            type="number"
            min={0}
            step={0.5}
            value={toleranceText}
            onChange={(e) => handleToleranceChange(e.target.value)}
            className="w-24 h-8"
            data-testid="input-regression-tolerance"
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-xs text-muted-foreground">
          Mark a completed run as the baseline, then rerun the same model (different engine,
          settings, or code) — each rerun is compared metric-by-metric against the saved baseline.
          Baselines are stored in this browser.
        </p>

        {/* Set-as-baseline actions */}
        <div className="space-y-1">
          {successResults.map(result => {
            const baseline = baselines[result.fileName];
            const isBaselineSelf = baseline !== undefined;
            return (
              <div
                key={result.id}
                className="flex items-center justify-between gap-2 flex-wrap py-1.5 px-2 rounded-md border"
                data-testid={`row-baseline-${result.id}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-xs truncate">{result.fileName}</span>
                  {isBaselineSelf && (
                    <Badge variant="outline" className="text-xs border-blue-500/50 text-blue-600 dark:text-blue-400" data-testid={`badge-baseline-${result.id}`}>
                      <Flag className="h-3 w-3 mr-1" />
                      Baseline saved {new Date(baseline.savedAt).toLocaleDateString()}
                      {baseline.engine ? ` · ${baseline.engine}` : ''}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleSetBaseline(result)}
                    disabled={settingId === result.id}
                    data-testid={`button-set-baseline-${result.id}`}
                  >
                    <Flag className="h-3.5 w-3.5 mr-1" />
                    {settingId === result.id ? 'Saving…' : isBaselineSelf ? 'Update baseline' : 'Set as baseline'}
                  </Button>
                  {isBaselineSelf && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveBaseline(result.fileName)}
                      data-testid={`button-remove-baseline-${result.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Comparison tables */}
        {comparisons.length === 0 ? (
          <p className="text-xs text-muted-foreground" data-testid="text-no-baselines">
            No comparison to show yet. A run is never compared against a baseline captured from
            itself — set a baseline above, then rerun the same model to get a verdict.
          </p>
        ) : (
          comparisons.map(({ result, baseline, rows, verdict }) => (
            <div key={result.id} className="space-y-2" data-testid={`regression-table-${result.id}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs font-medium">{result.fileName}</span>
                <span className="text-xs text-muted-foreground">
                  baseline {new Date(baseline.savedAt).toLocaleString()}
                  {baseline.engine ? ` (${baseline.engine}${baseline.engineVersion ? ` v${baseline.engineVersion}` : ''})` : ''}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-1.5 px-2 font-medium">Metric</th>
                      <th className="text-right py-1.5 px-2 font-medium">Baseline</th>
                      <th className="text-right py-1.5 px-2 font-medium">Current</th>
                      <th className="text-right py-1.5 px-2 font-medium">Δ</th>
                      <th className="text-right py-1.5 px-2 font-medium">Δ%</th>
                      <th className="text-center py-1.5 px-2 font-medium">Check</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row => (
                      <tr key={row.key} className="border-b last:border-0" data-testid={`row-regression-${result.id}-${row.key}`}>
                        <td className="py-1.5 px-2 text-xs">{row.label}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-xs">{fmt(row.baseline)}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-xs">{fmt(row.current)}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-xs">
                          {row.delta !== undefined ? `${row.delta >= 0 ? '+' : ''}${row.delta.toFixed(3)}` : '—'}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono text-xs">
                          {row.deltaPct !== undefined ? `${row.deltaPct >= 0 ? '+' : ''}${row.deltaPct.toFixed(2)}%` : '—'}
                        </td>
                        <td className="py-1.5 px-2 text-center">
                          {row.pass === undefined ? (
                            <HelpCircle className="h-3.5 w-3.5 inline text-muted-foreground" aria-label="Not comparable" />
                          ) : row.pass ? (
                            <CheckCircle className="h-3.5 w-3.5 inline text-green-600" aria-label="Within tolerance" />
                          ) : (
                            <XCircle className="h-3.5 w-3.5 inline text-destructive" aria-label="Outside tolerance" />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div data-testid={`verdict-regression-${result.id}`}>
                {verdict === 'pass' ? (
                  <Badge className="bg-green-600 text-white hover:bg-green-600">
                    <CheckCircle className="h-3.5 w-3.5 mr-1" />
                    REGRESSION TEST: PASS (±{tolerance}%)
                  </Badge>
                ) : verdict === 'fail' ? (
                  <Badge variant="destructive">
                    <XCircle className="h-3.5 w-3.5 mr-1" />
                    REGRESSION TEST: FAIL (±{tolerance}%)
                  </Badge>
                ) : (
                  <Badge variant="secondary">
                    <HelpCircle className="h-3.5 w-3.5 mr-1" />
                    REGRESSION TEST: INCONCLUSIVE — no comparable metrics
                  </Badge>
                )}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
