import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Cpu, ShieldCheck, AlertTriangle } from "lucide-react";
import type { ProcessResult } from "./ResultsDisplay";
import {
  classifyRun, healthScore, findOutliers, normalizeThresholds,
  DEFAULT_QA_THRESHOLDS, type QaClass, type QaInput,
} from "@/lib/rptQa";
import { ENGINE_LABELS, type EngineId } from "@/lib/engineComparison";

const CLASS_STYLES: Record<QaClass, string> = {
  'PASS': 'bg-green-600/15 text-green-700 dark:text-green-400 border-green-600/30',
  'PASS WITH WARNINGS': 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30',
  'REVIEW': 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30',
  'FAIL': 'bg-red-600/15 text-red-700 dark:text-red-400 border-red-600/30',
  'INCOMPLETE': 'bg-muted text-muted-foreground border-muted-foreground/30',
};

function qaInputFor(r: ProcessResult): QaInput {
  return {
    status: r.status,
    runoffCE: r.parsedMetrics?.runoffContinuityError,
    routingCE: r.parsedMetrics?.routingContinuityError,
    nodesFlooded: r.parsedMetrics?.nodesFlooded,
    warningCount: r.parsedMetrics?.reportWarnings?.length ?? 0,
    errorCount: r.parsedMetrics?.reportErrors?.length ?? 0,
  };
}

function ceColor(v: number | undefined, warn: number, review: number): string {
  if (v === undefined) return 'text-muted-foreground';
  const a = Math.abs(v);
  if (a > review) return 'text-red-600 dark:text-red-400 font-semibold';
  if (a > warn) return 'text-yellow-700 dark:text-yellow-400 font-medium';
  return 'text-green-700 dark:text-green-400';
}

export default function BatchQaDashboard({ results }: { results: ProcessResult[] }) {
  const [ceWarn, setCeWarn] = useState(DEFAULT_QA_THRESHOLDS.ceWarn);
  const [ceReview, setCeReview] = useState(DEFAULT_QA_THRESHOLDS.ceReview);
  const thresholds = useMemo(
    () => normalizeThresholds({ ceWarn, ceReview }),
    [ceWarn, ceReview],
  );

  const rows = useMemo(() => results.map(r => {
    const input = qaInputFor(r);
    return {
      r,
      input,
      qaClass: classifyRun(input, thresholds),
      health: healthScore(input, thresholds),
    };
  }), [results, thresholds]);

  const outliers = useMemo(() => {
    const flags = new Map<string, string[]>();
    const mark = (ids: Set<string>, label: string) => {
      for (const id of Array.from(ids)) {
        flags.set(id, [...(flags.get(id) || []), label]);
      }
    };
    const ok = rows.filter(x => x.r.status === 'success');
    mark(findOutliers(ok.filter(x => x.input.routingCE !== undefined)
      .map(x => ({ id: x.r.id, value: Math.abs(x.input.routingCE!) }))), 'routing continuity');
    mark(findOutliers(ok.filter(x => x.input.runoffCE !== undefined)
      .map(x => ({ id: x.r.id, value: Math.abs(x.input.runoffCE!) }))), 'runoff continuity');
    mark(findOutliers(ok.filter(x => x.r.processingTime !== undefined)
      .map(x => ({ id: x.r.id, value: x.r.processingTime! }))), 'runtime');
    mark(findOutliers(ok.filter(x => x.input.nodesFlooded !== undefined)
      .map(x => ({ id: x.r.id, value: x.input.nodesFlooded! }))), 'flooding');
    return flags;
  }, [rows]);

  // Engine identity: only claim an engine actually ran when a successful
  // result reports one; note when the batch mixes engines.
  const identity = useMemo(() => {
    const withProv = results.filter(r => r.provenance);
    if (withProv.length === 0) return undefined;
    const successProv = withProv.find(r => r.status === 'success' && r.provenance?.actualEngine)?.provenance;
    const engines = new Set(withProv.map(r => r.provenance!.actualEngine || `${r.provenance!.requestedEngine} (requested)`));
    if (!successProv) {
      const requested = withProv[0].provenance!.requestedEngine;
      return {
        engineLabel: `${ENGINE_LABELS[requested as EngineId] ?? requested} (requested — no successful run confirmed it)`,
        version: undefined as string | undefined,
        execution: 'Unknown — engine execution not confirmed',
        verified: false,
        mixed: engines.size > 1,
      };
    }
    const engine = successProv.actualEngine!;
    return {
      engineLabel: ENGINE_LABELS[engine as EngineId] ?? engine,
      version: successProv.engineVersion,
      execution: engine === 'wasm' || engine === 'wasm6' ? 'WASM (in browser)' : 'Native (on server)',
      verified: !!successProv.engineVersion,
      mixed: engines.size > 1,
    };
  }, [results]);

  const counts = useMemo(() => {
    const c: Record<QaClass, number> = { 'PASS': 0, 'PASS WITH WARNINGS': 0, 'REVIEW': 0, 'FAIL': 0, 'INCOMPLETE': 0 };
    for (const x of rows) c[x.qaClass]++;
    return c;
  }, [rows]);

  if (results.length === 0) return null;

  return (
    <Card data-testid="card-qa-dashboard">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          Batch QA Dashboard
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {identity && (
          <div className="rounded-md border p-3 flex items-start gap-3 flex-wrap" data-testid="card-engine-identity">
            <Cpu className="h-4 w-4 mt-0.5 text-muted-foreground" />
            <div className="text-xs space-y-0.5">
              <p className="font-semibold text-sm">SWMM Engine</p>
              <p>Engine: <b>{identity.engineLabel}</b></p>
              {identity.version && <p>Version: <b data-testid="text-engine-version">{identity.version}</b></p>}
              <p>Execution: {identity.execution}</p>
              <p>
                Engine status:{" "}
                {identity.verified
                  ? <span className="text-green-700 dark:text-green-400 font-medium">Verified ✓ (version read from the report the engine wrote)</span>
                  : <span className="text-yellow-700 dark:text-yellow-400 font-medium">Unverified — no engine version found in the reports</span>}
              </p>
              {identity.mixed && (
                <p className="text-yellow-700 dark:text-yellow-400">This batch mixes more than one engine — check each run's provenance in the manifest.</p>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          {(Object.keys(counts) as QaClass[]).map(k => counts[k] > 0 && (
            <Badge key={k} variant="outline" className={CLASS_STYLES[k]} data-testid={`badge-qa-count-${k.replace(/ /g, '-')}`}>
              {k}: {counts[k]}
            </Badge>
          ))}
          <div className="flex items-center gap-2 ml-auto text-xs">
            <Label htmlFor="qa-ce-warn" className="text-xs text-muted-foreground">CE warn %</Label>
            <Input id="qa-ce-warn" type="number" step="0.5" min="0" className="h-7 w-16 text-xs"
              value={ceWarn} onChange={e => setCeWarn(parseFloat(e.target.value))} data-testid="input-ce-warn" />
            <Label htmlFor="qa-ce-review" className="text-xs text-muted-foreground">CE review %</Label>
            <Input id="qa-ce-review" type="number" step="0.5" min="0" className="h-7 w-16 text-xs"
              value={ceReview} onChange={e => setCeReview(parseFloat(e.target.value))} data-testid="input-ce-review" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs" data-testid="table-qa-dashboard">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="text-left py-1.5 px-2">Model</th>
                <th className="text-left py-1.5 px-2">QA</th>
                <th className="text-right py-1.5 px-2">Routing CE</th>
                <th className="text-right py-1.5 px-2">Runoff CE</th>
                <th className="text-right py-1.5 px-2">Flooded</th>
                <th className="text-right py-1.5 px-2">Warnings</th>
                <th className="text-right py-1.5 px-2">Runtime</th>
                <th className="text-right py-1.5 px-2">Health</th>
                <th className="text-left py-1.5 px-2">Outlier</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ r, input, qaClass, health }) => (
                <tr key={r.id} className="border-b last:border-0" data-testid={`row-qa-${r.id}`}>
                  <td className="py-1.5 px-2 font-mono">{r.fileName}</td>
                  <td className="py-1.5 px-2">
                    <Badge variant="outline" className={`${CLASS_STYLES[qaClass]} text-[10px]`}>{qaClass}</Badge>
                  </td>
                  <td className={`py-1.5 px-2 text-right tabular-nums ${ceColor(input.routingCE, thresholds.ceWarn, thresholds.ceReview)}`}>
                    {input.routingCE !== undefined ? `${input.routingCE.toFixed(2)}%` : '—'}
                  </td>
                  <td className={`py-1.5 px-2 text-right tabular-nums ${ceColor(input.runoffCE, thresholds.ceWarn, thresholds.ceReview)}`}>
                    {input.runoffCE !== undefined ? `${input.runoffCE.toFixed(2)}%` : '—'}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{input.nodesFlooded ?? '—'}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{input.warningCount}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{r.processingTime !== undefined ? `${r.processingTime.toFixed(1)} s` : '—'}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums font-medium">{health.score ?? '—'}</td>
                  <td className="py-1.5 px-2">
                    {outliers.has(r.id) && (
                      <span className="text-red-600 dark:text-red-400 flex items-center gap-1" data-testid={`text-outlier-${r.id}`}>
                        <AlertTriangle className="h-3 w-3" />
                        {outliers.get(r.id)!.join(', ')}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground">
          QA class and health score are configurable diagnostic heuristics (continuity, flooding, warnings, completion — 25 points each), not EPA criteria.
          Outliers are runs that sit far from the rest of the batch for that metric.
        </p>
      </CardContent>
    </Card>
  );
}
