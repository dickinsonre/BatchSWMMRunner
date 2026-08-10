import { useEffect, useMemo, useRef, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip as ChartTooltip, Legend,
  ScatterChart, Scatter, CartesianGrid, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { Upload, FileText, Printer, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import AppHeader from "@/components/AppHeader";
import { runWasmBatch } from "@/lib/swmmWasmEngine";
import { parseTimeSeries, type ParsedTimeSeries } from "@/lib/parseTimeSeries";
import { ensureReportAll, toHours, rSquared, rankPeakDifferences, type PeakDiffRow } from "@/lib/qaqcReport";
import type { ProcessResult, ParsedMetrics } from "@shared/schema";

// ---------------------------------------------------------------------------
// SWMM5 vs SWMM6 QA/QC comparison report for a single .inp file, styled after
// Rossman, L.A. (2006) "SWMM 5 Quality Assurance Report: Dynamic Wave Flow
// Routing" (EPA/600/R-06/097), which compared SWMM 4 vs SWMM 5 the same way:
// narrative + settings table + system totals + time-series overlays + scatter
// plots of peak values with a 45-degree line of equality.
// ---------------------------------------------------------------------------

function firstStampMs(series: ParsedTimeSeries): number {
  const m = series.data[0]?.time.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return 0;
  return Date.UTC(+m[3], +m[1] - 1, +m[2], +m[4], +m[5], +(m[6] || 0));
}

interface SeriesOption {
  key: string;          // `${element}||${column}`
  element: string;
  column: string;
  unit: string;
}

interface EngineData {
  result: ProcessResult;
  series: ParsedTimeSeries[];
  byElement: Map<string, ParsedTimeSeries>;
}

function indexSeries(result: ProcessResult): EngineData {
  const series = parseTimeSeries(result.reportContent || "");
  const byElement = new Map<string, ParsedTimeSeries>();
  for (const s of series) byElement.set(s.element.trim(), s);
  return { result, series, byElement };
}

/** Peak (max abs-signed) value of one column of one element's series. */
function peakOf(s: ParsedTimeSeries | undefined, colIdx: number): number | undefined {
  if (!s || colIdx < 0) return undefined;
  let best: number | undefined;
  for (const d of s.data) {
    const v = d.values[colIdx];
    if (v === undefined || !Number.isFinite(v)) continue;
    if (best === undefined || Math.abs(v) > Math.abs(best)) best = v;
  }
  return best;
}

function colIndexFor(s: ParsedTimeSeries, name: RegExp): number {
  return s.columns.findIndex(c => name.test(c));
}

/** Extract selected [OPTIONS] entries from the .inp text. */
function extractOptions(inp: string): { name: string; value: string }[] {
  const wanted = [
    "FLOW_UNITS", "FLOW_ROUTING", "INFILTRATION", "START_DATE", "END_DATE",
    "REPORT_STEP", "WET_STEP", "DRY_STEP", "ROUTING_STEP", "MIN_SURFAREA",
    "INERTIAL_DAMPING", "NORMAL_FLOW_LIMITED", "FORCE_MAIN_EQUATION",
    "SURCHARGE_METHOD", "VARIABLE_STEP", "LENGTHENING_STEP",
  ];
  const rows: { name: string; value: string }[] = [];
  const m = inp.match(/\[OPTIONS\]([\s\S]*?)(\n\s*\[|$)/i);
  if (!m) return rows;
  for (const line of m[1].split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith(";")) continue;
    const parts = t.split(/\s+/);
    if (parts.length >= 2 && wanted.includes(parts[0].toUpperCase())) {
      rows.push({ name: parts[0].toUpperCase(), value: parts.slice(1).join(" ") });
    }
  }
  return rows;
}

function extractTitle(inp: string): string {
  const m = inp.match(/\[TITLE\]([\s\S]*?)(\n\s*\[|$)/i);
  if (!m) return "";
  return m[1].split("\n").map(l => l.trim()).filter(l => l && !l.startsWith(";;")).join(" ");
}

const METRIC_ROWS: { key: keyof ParsedMetrics; label: string }[] = [
  { key: "totalPrecipitation", label: "Total Precipitation" },
  { key: "surfaceRunoff", label: "Surface Runoff" },
  { key: "runoffContinuityError", label: "Runoff Continuity Error (%)" },
  { key: "totalInflow", label: "Total Inflow" },
  { key: "totalOutflow", label: "Total Outflow" },
  { key: "floodingLoss", label: "Flooding Loss" },
  { key: "nodesFlooded", label: "Nodes Flooded" },
  { key: "routingContinuityError", label: "Flow Routing Continuity Error (%)" },
];

const S5_COLOR = "#1d4ed8"; // blue — SWMM 5
const S6_COLOR = "#d97706"; // amber — SWMM 6

type Phase = "idle" | "running5" | "running6" | "done" | "error";

export default function QaqcReportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [inpText, setInpText] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [swmm5, setSwmm5] = useState<EngineData | null>(null);
  const [swmm6, setSwmm6] = useState<EngineData | null>(null);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  // Generation counter: bumping it invalidates callbacks from older runs so a
  // stale run can never overwrite a newer report.
  const runIdRef = useRef(0);

  // Terminate any in-flight WASM workers when leaving the page.
  useEffect(() => () => {
    runIdRef.current++;
    cancelRef.current?.();
    cancelRef.current = null;
  }, []);

  const cancelRun = () => {
    runIdRef.current++;
    cancelRef.current?.();
    cancelRef.current = null;
    setPhase("idle");
    setProgress("");
  };

  const handleFile = async (f: File) => {
    setFile(f);
    setInpText(await f.text());
    setSwmm5(null); setSwmm6(null);
    setSelectedKey("");
    setPhase("idle");
    setError("");
  };

  const runOne = (engine: "swmm5" | "swmm6", text: string, name: string, runId: number) =>
    new Promise<ProcessResult>((resolve, reject) => {
      const f = new File([text], name, { type: "text/plain" });
      const flag = { current: false };
      const stale = () => runIdRef.current !== runId;
      const cancel = runWasmBatch(
        [{ id: `qaqc-${engine}`, name, file: f }],
        {
          onFileStart: () => {},
          onProgress: (p) => {
            if (stale()) return;
            setProgress(`${engine === "swmm5" ? "SWMM 5" : "SWMM 6"}: ${p.message || `${p.percentage}%`}`);
          },
          onResult: (r) => {
            if (stale()) return reject(new Error("cancelled"));
            r.status === "success" ? resolve(r) : reject(new Error(r.error || `${engine} run failed`));
          },
          onLog: () => {},
          onComplete: () => {},
        },
        flag,
        engine,
      );
      cancelRef.current = () => { flag.current = true; cancel(); reject(new Error("cancelled")); };
    });

  const runComparison = async () => {
    if (!file || !inpText) return;
    const runId = ++runIdRef.current;
    setError("");
    setSwmm5(null); setSwmm6(null);
    try {
      const prepared = ensureReportAll(inpText);
      setPhase("running5");
      const r5 = await runOne("swmm5", prepared, file.name, runId);
      if (runIdRef.current !== runId) return;
      setSwmm5(indexSeries(r5));
      setPhase("running6");
      const r6 = await runOne("swmm6", prepared, file.name, runId);
      if (runIdRef.current !== runId) return;
      setSwmm6(indexSeries(r6));
      setPhase("done");
      cancelRef.current = null;
    } catch (e: any) {
      if (runIdRef.current !== runId || e?.message === "cancelled") return;
      setError(e?.message || String(e));
      setPhase("error");
    }
  };

  // Outputs present in BOTH engines' reports.
  const options: SeriesOption[] = useMemo(() => {
    if (!swmm5 || !swmm6) return [];
    const opts: SeriesOption[] = [];
    for (const s of swmm5.series) {
      const other = swmm6.byElement.get(s.element.trim());
      if (!other) continue;
      s.columns.forEach((col, i) => {
        if (other.columns.some(c => c.trim().toLowerCase() === col.trim().toLowerCase())) {
          opts.push({ key: `${s.element.trim()}||${col.trim()}`, element: s.element.trim(), column: col.trim(), unit: s.units[i] || "" });
        }
      });
    }
    return opts;
  }, [swmm5, swmm6]);

  // Every shared output ranked by peak disagreement, worst first.
  const ranked: PeakDiffRow[] = useMemo(
    () => (swmm5 && swmm6 ? rankPeakDifferences(swmm5.series, swmm6.series) : []),
    [swmm5, swmm6],
  );

  // Default the time-series figure to the output that disagrees the most —
  // that's the one worth looking at first. The user can still pick another.
  const worstKey = ranked.length > 0 ? `${ranked[0].element}||${ranked[0].column}` : "";
  const selected =
    options.find(o => o.key === selectedKey) ||
    options.find(o => o.key === worstKey) ||
    options[0];

  // Overlaid time-series data for the chosen output.
  const tsData = useMemo(() => {
    if (!swmm5 || !swmm6 || !selected) return [];
    const s5 = swmm5.byElement.get(selected.element);
    const s6 = swmm6.byElement.get(selected.element);
    if (!s5 || !s6) return [];
    const c5 = s5.columns.findIndex(c => c.trim().toLowerCase() === selected.column.toLowerCase());
    const c6 = s6.columns.findIndex(c => c.trim().toLowerCase() === selected.column.toLowerCase());
    // Anchor each engine to its OWN first report timestamp so a differing
    // report start doesn't shift one curve; join rows on whole seconds to
    // avoid floating-point misses.
    const t05 = firstStampMs(s5);
    const t06 = firstStampMs(s6);
    const map = new Map<number, { t: number; s5?: number; s6?: number }>();
    for (const d of s5.data) {
      const h = toHours(d.time, t05);
      if (!Number.isFinite(h)) continue;
      const key = Math.round(h * 3600);
      map.set(key, { t: h, s5: d.values[c5] });
    }
    for (const d of s6.data) {
      const h = toHours(d.time, t06);
      if (!Number.isFinite(h)) continue;
      const key = Math.round(h * 3600);
      const row = map.get(key) || { t: h };
      row.s6 = d.values[c6];
      map.set(key, row);
    }
    return Array.from(map.values()).sort((a, b) => a.t - b.t);
  }, [swmm5, swmm6, selected]);

  // Scatter data: peak "Flow" for links, peak "Depth" for nodes.
  const scatter = useMemo(() => {
    if (!swmm5 || !swmm6) return { flows: [] as { x: number; y: number; name: string }[], depths: [] as { x: number; y: number; name: string }[] };
    const flows: { x: number; y: number; name: string }[] = [];
    const depths: { x: number; y: number; name: string }[] = [];
    for (const s of swmm5.series) {
      const el = s.element.trim();
      const o = swmm6.byElement.get(el);
      if (!o) continue;
      // Classify by report section title ("Link Results Time Series" /
      // "Node Results Time Series"), not by element name.
      const isLink = /^link/i.test(s.title.trim());
      const isNode = /^node/i.test(s.title.trim());
      if (isLink) {
        const fc5 = colIndexFor(s, /Flow/i), fc6 = colIndexFor(o, /Flow/i);
        if (fc5 < 0 || fc6 < 0) continue;
        const x = peakOf(s, fc5), y = peakOf(o, fc6);
        if (x !== undefined && y !== undefined) flows.push({ x: Math.abs(x), y: Math.abs(y), name: el });
      } else if (isNode) {
        const dc5 = colIndexFor(s, /Depth/i), dc6 = colIndexFor(o, /Depth/i);
        if (dc5 < 0 || dc6 < 0) continue;
        const x = peakOf(s, dc5), y = peakOf(o, dc6);
        if (x !== undefined && y !== undefined) depths.push({ x, y, name: el });
      }
    }
    return { flows, depths };
  }, [swmm5, swmm6]);

  const flowR2 = rSquared(scatter.flows);
  const depthR2 = rSquared(scatter.depths);

  const peakDiffPct = useMemo(() => {
    const all = [...scatter.flows, ...scatter.depths].filter(p => Math.abs(p.x) > 1e-6);
    if (all.length === 0) return undefined;
    const diffs = all.map(p => Math.abs(p.y - p.x) / Math.abs(p.x) * 100);
    return {
      mean: diffs.reduce((a, b) => a + b, 0) / diffs.length,
      max: Math.max(...diffs),
    };
  }, [scatter]);

  const optionRows = useMemo(() => extractOptions(inpText), [inpText]);
  const modelTitle = useMemo(() => extractTitle(inpText), [inpText]);
  const running = phase === "running5" || phase === "running6";

  const fmt = (v: number | undefined, digits = 3) =>
    v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(digits);

  return (
    <div className="min-h-screen bg-background">
      <div className="print:hidden">
        <AppHeader />
      </div>

      {/* Controls (hidden when printing) */}
      <div className="container max-w-4xl mx-auto px-4 py-6 print:hidden">
        <h2 className="text-xl font-semibold mb-1" data-testid="text-qaqc-title">SWMM 5 vs SWMM 6 QA/QC Report</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Runs one model through both browser engines and builds a comparison report in the
          format of Rossman&apos;s SWMM 5 Quality Assurance Report (EPA/600/R-06/097).
        </p>
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={inputRef}
                type="file"
                accept=".inp"
                className="hidden"
                data-testid="input-qaqc-file"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
              />
              <Button variant="outline" onClick={() => inputRef.current?.click()} data-testid="button-choose-file">
                <Upload className="h-4 w-4 mr-2" /> Choose .inp file
              </Button>
              {file && (
                <span className="text-sm flex items-center gap-1" data-testid="text-chosen-file">
                  <FileText className="h-4 w-4" /> {file.name}
                </span>
              )}
              <Button onClick={runComparison} disabled={!file || running} data-testid="button-run-comparison">
                {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                {running ? progress || "Running…" : "Run Both Engines"}
              </Button>
              {running && (
                <Button variant="destructive" onClick={cancelRun} data-testid="button-cancel-run">
                  Cancel
                </Button>
              )}
              {phase === "done" && (
                <Button variant="outline" onClick={() => window.print()} data-testid="button-print-pdf">
                  <Printer className="h-4 w-4 mr-2" /> Save as PDF
                </Button>
              )}
            </div>
            {phase === "done" && options.length > 0 && (
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium">Report output:</span>
                <Select value={selected?.key || ""} onValueChange={setSelectedKey}>
                  <SelectTrigger className="w-72" data-testid="select-output">
                    <SelectValue placeholder="Pick an output" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map(o => (
                      <SelectItem key={o.key} value={o.key}>
                        {o.element} — {o.column}{o.unit ? ` (${o.unit})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {phase === "done" && options.length === 0 && (
              <p className="text-sm text-destructive" data-testid="text-no-series">
                No common time series were found in the two reports, so charts cannot be drawn.
              </p>
            )}
            {error && <p className="text-sm text-destructive" data-testid="text-qaqc-error">{error}</p>}
          </CardContent>
        </Card>
      </div>

      {/* The report itself */}
      {phase === "done" && swmm5 && swmm6 && (
        <div className="container max-w-4xl mx-auto px-4 pb-16 qaqc-report" data-testid="section-qaqc-report">
          <div className="border rounded-lg p-8 print:border-0 print:p-0 bg-card space-y-8">
            {/* Title block */}
            <div className="text-center space-y-2 border-b pb-6">
              <p className="text-xs tracking-widest uppercase text-muted-foreground">Quality Assurance Comparison Report</p>
              <h1 className="text-2xl font-bold">SWMM 5 vs SWMM 6 — Dynamic Comparison</h1>
              <p className="text-sm">{file?.name}{modelTitle ? ` — ${modelTitle}` : ""}</p>
              <p className="text-xs text-muted-foreground">
                Prepared {new Date().toLocaleDateString()} • Format after Rossman, L.A. (2006), EPA/600/R-06/097
              </p>
            </div>

            {/* 1. Introduction */}
            <section>
              <h2 className="font-semibold text-lg mb-2">1. Introduction</h2>
              <p className="text-sm leading-relaxed">
                This report compares simulation results for <b>{file?.name}</b> produced by the
                SWMM&nbsp;5 engine ({swmm5.result.provenance?.engineVersion || "WASM"}) and the SWMM&nbsp;6 engine
                ({swmm6.result.provenance?.engineVersion || "OpenSWMM 6 WASM"}), both run in the browser from the
                identical input file. Following the approach of the EPA SWMM&nbsp;5 quality assurance
                report, results are compared through system-wide continuity totals, a time series
                overlay at a selected location, and scatter plots of peak values for all conduits
                and nodes against a 45-degree line of equality.
                {swmm5.result.processingTime !== undefined && swmm6.result.processingTime !== undefined && (
                  <> Run times: SWMM&nbsp;5 completed in <b>{swmm5.result.processingTime.toFixed(1)}s</b>,
                  SWMM&nbsp;6 in <b>{swmm6.result.processingTime.toFixed(1)}s</b>.</>
                )}
              </p>
            </section>

            {/* 2. Computational settings */}
            <section>
              <h2 className="font-semibold text-lg mb-2">2. Computational Settings</h2>
              <table className="w-full text-sm border-collapse" data-testid="table-settings">
                <thead>
                  <tr className="border-b-2 border-foreground/60 text-left">
                    <th className="py-1 pr-4">Option</th>
                    <th className="py-1">Value (both engines)</th>
                  </tr>
                </thead>
                <tbody>
                  {optionRows.map(r => (
                    <tr key={r.name} className="border-b border-border/60">
                      <td className="py-1 pr-4 font-mono text-xs">{r.name}</td>
                      <td className="py-1">{r.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground mt-1">Table 2.1. Analysis options taken from the input file.</p>
            </section>

            {/* 3. System-wide results */}
            <section>
              <h2 className="font-semibold text-lg mb-2">3. System-Wide Results</h2>
              <table className="w-full text-sm border-collapse" data-testid="table-system">
                <thead>
                  <tr className="border-b-2 border-foreground/60 text-left">
                    <th className="py-1 pr-4">Quantity</th>
                    <th className="py-1 text-right">SWMM 5</th>
                    <th className="py-1 text-right">SWMM 6</th>
                    <th className="py-1 text-right">Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {METRIC_ROWS.map(({ key, label }) => {
                    const a = swmm5.result.parsedMetrics?.[key] as number | undefined;
                    const b = swmm6.result.parsedMetrics?.[key] as number | undefined;
                    if (a === undefined && b === undefined) return null;
                    const d = a !== undefined && b !== undefined ? b - a : undefined;
                    return (
                      <tr key={key} className="border-b border-border/60">
                        <td className="py-1 pr-4">{label}</td>
                        <td className="py-1 text-right font-mono text-xs">{fmt(a)}</td>
                        <td className="py-1 text-right font-mono text-xs">{fmt(b)}</td>
                        <td className="py-1 text-right font-mono text-xs">{fmt(d)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground mt-1">Table 3.1. System-wide mass balance comparison (after Table 6.1 of the EPA report).</p>
            </section>

            {/* 4. Largest differences */}
            {ranked.length > 0 && (
              <section>
                <h2 className="font-semibold text-lg mb-2">4. Largest Peak Differences</h2>
                <table className="w-full text-sm border-collapse" data-testid="table-largest-diffs">
                  <thead>
                    <tr className="border-b-2 border-foreground/60 text-left">
                      <th className="py-1 pr-4">Element</th>
                      <th className="py-1 pr-4">Output</th>
                      <th className="py-1 text-right">SWMM 5 Peak</th>
                      <th className="py-1 text-right">SWMM 6 Peak</th>
                      <th className="py-1 text-right">Diff (%)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranked.slice(0, 10).map(r => (
                      <tr key={`${r.element}-${r.column}`} className="border-b border-border/60">
                        <td className="py-1 pr-4">{r.element}</td>
                        <td className="py-1 pr-4">{r.column}{r.unit ? ` (${r.unit})` : ""}</td>
                        <td className="py-1 text-right font-mono text-xs">{fmt(r.peak5)}</td>
                        <td className="py-1 text-right font-mono text-xs">{fmt(r.peak6)}</td>
                        <td className="py-1 text-right font-mono text-xs">
                          {r.diffPct === undefined ? "—" : `${r.diffPct.toFixed(2)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-muted-foreground mt-1">
                  Table 4.1. The ten outputs with the largest peak-value disagreement between engines,
                  worst first. The time-series figure below defaults to the top entry.
                </p>
              </section>
            )}

            {/* 5. Time series comparison */}
            {selected && tsData.length > 0 && (
              <section>
                <h2 className="font-semibold text-lg mb-2">5. Time Series Comparison</h2>
                <div className="h-72" data-testid="chart-timeseries">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={tsData} margin={{ top: 8, right: 24, left: 8, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
                      <XAxis dataKey="t" type="number" domain={["auto", "auto"]}
                        label={{ value: "Elapsed Time (hours)", position: "insideBottom", offset: -10, fontSize: 12 }}
                        tickFormatter={(v: number) => v.toFixed(1)} fontSize={11} />
                      <YAxis label={{ value: `${selected.column}${selected.unit ? ` (${selected.unit})` : ""}`, angle: -90, position: "insideLeft", fontSize: 12 }} fontSize={11} />
                      <ChartTooltip formatter={(v: any) => (typeof v === "number" ? v.toFixed(3) : v)} labelFormatter={(v: any) => `${Number(v).toFixed(2)} h`} />
                      <Legend verticalAlign="top" height={24} />
                      <Line type="monotone" dataKey="s5" name="SWMM 5" stroke={S5_COLOR} dot={false} strokeWidth={2} isAnimationActive={false} connectNulls />
                      <Line type="monotone" dataKey="s6" name="SWMM 6" stroke={S6_COLOR} dot={false} strokeWidth={2} strokeDasharray="6 3" isAnimationActive={false} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Figure 5.1. Comparison of {selected.column} for {selected.element}
                  {selected.key === worstKey ? " (largest peak difference between engines)" : ""}.
                </p>
              </section>
            )}

            {/* 5. Scatter plots */}
            <section>
              <h2 className="font-semibold text-lg mb-2">6. Peak Value Comparisons</h2>
              <div className="grid md:grid-cols-2 gap-6 print:grid-cols-2">
                {[
                  { data: scatter.flows, label: "Peak Flows (all links)", r2: flowR2, fig: "5.1", testid: "chart-scatter-flows" },
                  { data: scatter.depths, label: "Maximum Depths (all nodes)", r2: depthR2, fig: "5.2", testid: "chart-scatter-depths" },
                ].map(({ data, label, r2, fig, testid }) => {
                  if (data.length === 0) return null;
                  const maxV = Math.max(...data.map(p => Math.max(p.x, p.y)), 1e-6) * 1.05;
                  return (
                    <div key={fig}>
                      <div className="h-64" data-testid={testid}>
                        <ResponsiveContainer width="100%" height="100%">
                          <ScatterChart margin={{ top: 8, right: 16, left: 8, bottom: 24 }}>
                            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
                            <XAxis type="number" dataKey="x" domain={[0, maxV]} name="SWMM 5"
                              label={{ value: "SWMM 5", position: "insideBottom", offset: -12, fontSize: 12 }} fontSize={11}
                              tickFormatter={(v: number) => v.toPrecision(3)} />
                            <YAxis type="number" dataKey="y" domain={[0, maxV]} name="SWMM 6"
                              label={{ value: "SWMM 6", angle: -90, position: "insideLeft", fontSize: 12 }} fontSize={11}
                              tickFormatter={(v: number) => v.toPrecision(3)} />
                            <ChartTooltip
                              formatter={(v: any) => (typeof v === "number" ? v.toFixed(3) : v)}
                              labelFormatter={() => ""}
                              content={({ payload }) => {
                                const p = payload?.[0]?.payload;
                                if (!p) return null;
                                return (
                                  <div className="bg-popover border rounded px-2 py-1 text-xs">
                                    <div className="font-medium">{p.name}</div>
                                    <div>SWMM 5: {p.x.toFixed(3)}</div>
                                    <div>SWMM 6: {p.y.toFixed(3)}</div>
                                  </div>
                                );
                              }}
                            />
                            <ReferenceLine segment={[{ x: 0, y: 0 }, { x: maxV, y: maxV }]} stroke="#888" strokeDasharray="4 4" />
                            <Scatter data={data} fill={S5_COLOR} isAnimationActive={false} />
                          </ScatterChart>
                        </ResponsiveContainer>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Figure {fig}. {label}: SWMM 6 vs SWMM 5{r2 !== undefined ? ` (R² = ${r2.toFixed(4)})` : ""}. Dashed line = equality.
                      </p>
                    </div>
                  );
                })}
              </div>
              {scatter.flows.length === 0 && scatter.depths.length === 0 && (
                <p className="text-sm text-muted-foreground">No comparable peak values were found in both reports.</p>
              )}
            </section>

            {/* 6. Summary */}
            <section>
              <h2 className="font-semibold text-lg mb-2">7. Summary and Conclusions</h2>
              <p className="text-sm leading-relaxed" data-testid="text-summary">
                {peakDiffPct ? (
                  <>
                    Across {scatter.flows.length + scatter.depths.length} compared elements, the mean
                    absolute difference in peak values between SWMM&nbsp;5 and SWMM&nbsp;6 was{" "}
                    <b>{peakDiffPct.mean.toFixed(2)}%</b> with a maximum of <b>{peakDiffPct.max.toFixed(2)}%</b>.
                    {peakDiffPct.mean < 2
                      ? " In the language of the EPA report, the two engines produce essentially identical results for this model."
                      : peakDiffPct.mean < 10
                        ? " The engines show generally good agreement, with some locations warranting closer review."
                        : " The engines show notable differences for this model; the locations with the largest deviations should be reviewed."}
                  </>
                ) : (
                  "Peak-value statistics could not be computed for this model."
                )}
              </p>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
