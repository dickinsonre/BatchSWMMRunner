import { useEffect, useMemo, useState } from "react";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip as ChartTooltip, ResponsiveContainer, ReferenceLine,
  LineChart, Line, Legend,
} from "recharts";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { extractScatterValues } from "@/lib/summaryScatter";
import { rSquared, toHours } from "@/lib/qaqcReport";
import { parseTimeSeries } from "@/lib/parseTimeSeries";
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

  // Parse each report's summary tables once and reuse everywhere below.
  const vals = useMemo(() => {
    if (!pair) return null;
    return [extractScatterValues(pair[0].content!), extractScatterValues(pair[1].content!)] as const;
  }, [pair]);

  const charts = useMemo(() => {
    if (!pair || !vals) return [];
    const [valsX, valsY] = vals;
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
  }, [pair, vals]);

  // Time-series overlay for the link whose peak flow disagrees the most
  // between the two engines (the "worst" peak-flow point on the scatter).
  const worstSeries = useMemo(() => {
    if (!pair || !vals) return null;
    const [valsX, valsY] = vals;
    let worst: { name: string; diff: number } | null = null;
    valsX.flows.forEach((x, name) => {
      const y = valsY.flows.get(name);
      if (y === undefined) return;
      const diff = Math.abs(x - y);
      if (!worst || diff > worst.diff) worst = { name, diff };
    });
    if (!worst) return null;
    const linkName = (worst as { name: string }).name;
    const seriesFor = (content: string) => {
      const all = parseTimeSeries(content);
      const anyLinks = all.some(ts => /link/i.test(ts.title));
      const s = all.find(ts => /link/i.test(ts.title) && ts.element === linkName);
      if (!s) return { anyLinks, rows: null };
      let flowIdx = s.columns.findIndex(c => /flow/i.test(c));
      if (flowIdx < 0) flowIdx = 0;
      const rows = s.data
        .map(d => ({ time: d.time, v: d.values[flowIdx] }))
        .filter(d => Number.isFinite(d.v));
      return { anyLinks, rows: rows.length > 0 ? rows : null };
    };
    const resA = seriesFor(pair[0].content!);
    const resB = seriesFor(pair[1].content!);
    if (!resA.rows || !resB.rows) {
      // Distinguish "no link time series at all" from "this link missing in one report".
      const reason = !resA.anyLinks && !resB.anyLinks
        ? ("none" as const)
        : ("missing-link" as const);
      return { linkName, rows: null, reason };
    }
    const a = resA.rows;
    const b = resB.rows;
    // Anchor each engine to its own first timestamp; join on whole seconds.
    const t0 = (rows: { time: string }[]) => {
      const m = rows[0].time.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
      return m ? Date.UTC(+m[3], +m[1] - 1, +m[2], +m[4], +m[5], +(m[6] || 0)) : NaN;
    };
    const t0a = t0(a), t0b = t0(b);
    const merged = new Map<number, { h: number; a?: number; b?: number }>();
    for (const d of a) {
      const h = toHours(d.time, t0a);
      if (!Number.isFinite(h)) continue;
      const key = Math.round(h * 3600);
      const row = merged.get(key) || { h };
      row.a = d.v;
      merged.set(key, row);
    }
    for (const d of b) {
      const h = toHours(d.time, t0b);
      if (!Number.isFinite(h)) continue;
      const key = Math.round(h * 3600);
      const row = merged.get(key) || { h };
      row.b = d.v;
      merged.set(key, row);
    }
    // Keep only timestamps where BOTH engines have a value, so the overlay
    // never draws a line through intervals only one engine reported.
    const rows = Array.from(merged.values())
      .filter(r => r.a !== undefined && r.b !== undefined)
      .sort((r1, r2) => r1.h - r2.h);
    return { linkName, rows, reason: undefined };
  }, [pair, vals]);

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
        {worstSeries && (
          <div className="mt-6" data-testid="chart-worst-peak-flow">
            <p className="text-xs font-medium mb-1">
              Flow Time Series — Link {worstSeries.linkName} (largest peak-flow difference between engines)
            </p>
            {worstSeries.rows && worstSeries.rows.length > 0 ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={worstSeries.rows} margin={{ top: 8, right: 12, left: 4, bottom: 22 }}>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
                    <XAxis dataKey="h" type="number" domain={["dataMin", "dataMax"]}
                      label={{ value: "Elapsed Time (hours)", position: "insideBottom", offset: -12, fontSize: 11 }}
                      fontSize={10} tickFormatter={(v: number) => v.toFixed(1)} />
                    <YAxis fontSize={10}
                      label={{ value: "Flow", angle: -90, position: "insideLeft", fontSize: 11 }}
                      tickFormatter={(v: number) => v.toPrecision(3)} />
                    <ChartTooltip
                      formatter={(value: number) => value.toFixed(3)}
                      labelFormatter={(h: number) => `${h.toFixed(2)} h`}
                    />
                    <Legend verticalAlign="top" height={24} wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="a" name={xLabel} stroke="#1d4ed8"
                      dot={false} strokeWidth={2} isAnimationActive={false} />
                    <Line type="monotone" dataKey="b" name={yLabel} stroke="#d97706"
                      dot={false} strokeWidth={2} strokeDasharray="6 4" isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground" data-testid="text-worst-no-series">
                {worstSeries.reason === "missing-link"
                  ? <>The reports include link time series, but not for Link {worstSeries.linkName} in
                    both engines — check that the [REPORT] section lists the same links for each run.</>
                  : <>These reports don&apos;t include link time series, so the time-series comparison for
                    Link {worstSeries.linkName} can&apos;t be drawn. (Reports only contain time series when
                    the model&apos;s [REPORT] section lists the links.)</>}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
