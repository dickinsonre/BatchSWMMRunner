import { useEffect, useMemo, useState } from "react";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip as ChartTooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { extractScatterValues } from "@/lib/summaryScatter";
import { rSquared } from "@/lib/qaqcReport";
import type { EngineRun } from "@/lib/engineComparison";

// Rossman QA-report style scatter plots (EPA/600/R-06/097): peak link flows,
// maximum node heads/depths, and subcatchment runoff depth from one engine
// plotted against another, with a 45-degree line of equality.

function contentFor(run: EngineRun, fileName: string): string | undefined {
  const result = run.results.find(r => r.fileName === fileName && r.status === "success");
  return (result as any)?.reportContent as string | undefined;
}

interface EngineScatterCompareProps {
  runs: EngineRun[];
  /** Ask the parent to fetch report content for this file across all runs. */
  onLoadFile: (fileName: string) => Promise<void>;
}

export default function EngineScatterCompare({ runs, onLoadFile }: EngineScatterCompareProps) {
  const fileNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const run of runs) {
      for (const r of run.results) {
        if (r.status === "success") counts.set(r.fileName, (counts.get(r.fileName) || 0) + 1);
      }
    }
    return Array.from(counts.entries()).filter(([, n]) => n >= 2).map(([name]) => name);
  }, [runs]);

  const [fileName, setFileName] = useState<string>(fileNames[0] || "");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!fileName && fileNames.length > 0) setFileName(fileNames[0]);
  }, [fileNames, fileName]);

  useEffect(() => {
    if (!fileName) return;
    let stale = false;
    setLoading(true);
    onLoadFile(fileName).finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileName]);

  // First two runs that actually have report content for this file.
  const pair = useMemo(() => {
    const withContent = runs
      .map(run => ({ run, content: contentFor(run, fileName) }))
      .filter(e => e.content);
    return withContent.length >= 2 ? [withContent[0], withContent[1]] : null;
  }, [runs, fileName]);

  const charts = useMemo(() => {
    if (!pair) return [];
    const valsX = extractScatterValues(pair[0].content!);
    const valsY = extractScatterValues(pair[1].content!);
    const specs: { id: string; title: string; x: Map<string, number>; y: Map<string, number> }[] = [
      { id: "flows", title: "Peak Link Flows", x: valsX.flows, y: valsY.flows },
      // When both reports have an HGL column, show HGL and depths separately;
      // otherwise "heads" already equals max depths, so skip the duplicate.
      ...(valsX.headsLabel === "Maximum HGL" && valsY.headsLabel === "Maximum HGL"
        ? [
            { id: "heads", title: "Maximum Node HGL (Heads)", x: valsX.heads, y: valsY.heads },
            { id: "node-depths", title: "Maximum Node Depths", x: valsX.nodeDepths, y: valsY.nodeDepths },
          ]
        : [{ id: "node-depths", title: "Maximum Node Depths", x: valsX.nodeDepths, y: valsY.nodeDepths }]),
      { id: "link-depths", title: "Max Link Depth (fraction of full)", x: valsX.linkDepths, y: valsY.linkDepths },
      { id: "runoff", title: "Total Subcatchment Runoff (depth)", x: valsX.runoff, y: valsY.runoff },
    ];
    return specs.map(spec => {
      const points: { x: number; y: number; name: string }[] = [];
      spec.x.forEach((x, name) => {
        const y = spec.y.get(name);
        if (y !== undefined) points.push({ x, y, name });
      });
      return { spec, points, r2: rSquared(points) };
    }).filter(c => c.points.length > 0);
  }, [pair]);

  if (runs.length < 2 || fileNames.length === 0) return null;

  const xLabel = pair?.[0].run.label || "Engine A";
  const yLabel = pair?.[1].run.label || "Engine B";

  return (
    <Card data-testid="card-scatter-compare">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">
            Peak Value Comparison ({yLabel} vs {xLabel})
          </CardTitle>
          <div className="flex items-center gap-2">
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            <Select value={fileName} onValueChange={setFileName}>
              <SelectTrigger className="w-56 h-8 text-xs" data-testid="select-scatter-file">
                <SelectValue placeholder="Pick a file" />
              </SelectTrigger>
              <SelectContent>
                {fileNames.map(n => (
                  <SelectItem key={n} value={n}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Scatter plots in the style of the EPA SWMM 5 QA report — each point is one element;
          the dashed line marks perfect agreement.
        </p>
      </CardHeader>
      <CardContent>
        {!pair && !loading && (
          <p className="text-sm text-muted-foreground" data-testid="text-scatter-no-content">
            Report content for this file isn&apos;t loaded for two engines yet.
          </p>
        )}
        {pair && charts.length === 0 && !loading && (
          <p className="text-sm text-muted-foreground" data-testid="text-scatter-no-tables">
            No comparable summary tables (link flows, node depths, runoff) were found in both reports.
          </p>
        )}
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {charts.map(({ spec, points, r2 }) => {
            const maxV = Math.max(...points.map(p => Math.max(p.x, p.y)), 1e-6) * 1.05;
            return (
              <div key={spec.id} data-testid={`chart-scatter-${spec.id}`}>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 8, right: 12, left: 4, bottom: 22 }}>
                      <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
                      <XAxis type="number" dataKey="x" domain={[0, maxV]}
                        label={{ value: xLabel, position: "insideBottom", offset: -12, fontSize: 11 }}
                        fontSize={10} tickFormatter={(v: number) => v.toPrecision(3)} />
                      <YAxis type="number" dataKey="y" domain={[0, maxV]}
                        label={{ value: yLabel, angle: -90, position: "insideLeft", fontSize: 11 }}
                        fontSize={10} tickFormatter={(v: number) => v.toPrecision(3)} />
                      <ChartTooltip
                        content={({ payload }) => {
                          const p = payload?.[0]?.payload;
                          if (!p) return null;
                          return (
                            <div className="bg-popover border rounded px-2 py-1 text-xs">
                              <div className="font-medium">{p.name}</div>
                              <div>{xLabel}: {p.x.toFixed(3)}</div>
                              <div>{yLabel}: {p.y.toFixed(3)}</div>
                            </div>
                          );
                        }}
                      />
                      <ReferenceLine segment={[{ x: 0, y: 0 }, { x: maxV, y: maxV }]} stroke="#888" strokeDasharray="4 4" />
                      <Scatter data={points} fill="#1d4ed8" isAnimationActive={false} />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-xs text-muted-foreground mt-1 text-center">
                  {spec.title} — {points.length} elements{r2 !== undefined ? `, R² = ${r2.toFixed(4)}` : ""}
                </p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
