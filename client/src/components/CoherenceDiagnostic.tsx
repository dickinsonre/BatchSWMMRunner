import { useEffect, useMemo, useState } from "react";
import { Download, Info, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CoherenceHelp, coherenceHelp } from "./CoherenceHelp";
import {
  calculateDiagnostic,
  compareDiagnostic,
  diagnosticCsv,
  indicatorLabel,
  type DiagnosticResult,
  type DiagnosticSettings,
  type EngineMetrics,
  type ScreeningCategory,
} from "@/lib/coherenceDiagnostic";

interface CoherenceDiagnosticProps {
  inpText: string;
  swmm5Report?: string;
  swmm6Report?: string;
  fileName?: string;
}

const DEFAULT_SETTINGS: DiagnosticSettings = {
  rStar: 1,
  crownOnset: 0.9,
  openCrownOnset: 0.95,
  dryFraction: 0.02,
};

function fmt(value: number | undefined, digits = 2): string {
  if (value === undefined || Number.isNaN(value)) return "—";
  if (value === Number.POSITIVE_INFINITY) return "∞";
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

function fmtField(field: { value: number; raw: string; status: string }): string {
  if (field.status === "valid") return fmt(field.value);
  if (field.status === "censored") return field.raw || fmt(field.value);
  return field.raw ? `${field.raw} (${field.status})` : "—";
}

function fmtIndicator(metric: EngineMetrics, key: "froude" | "courant" | "crown"): string {
  const item = metric[key];
  if (item.status === "unavailable" || item.status === "unknown") return "—";
  if (item.status === "no-flow") return "∞";
  const prefix = item.status === "bound-below" ? "≤" : item.status === "bound-watch" || item.status === "bound-clear" ? "≥" : "";
  return `${prefix}${fmt(item.R)}`;
}

function indicatorValue(metric: EngineMetrics, key: "froude" | "courant"): string {
  const item = metric[key];
  const value = item.detail[key === "froude" ? "Fr" : "Cr"];
  return typeof value === "number" ? fmt(value) : "—";
}

function categoryClass(category: ScreeningCategory): string {
  return category === "review"
    ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
    : category === "watch"
      ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
      : category === "clear"
        ? "border-green-300 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-200"
        : "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300";
}

function StatusPill({ category }: { category: ScreeningCategory }) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${categoryClass(category)}`}>
      {category}
    </span>
  );
}

function MetricCells({ metric }: { metric: EngineMetrics }) {
  return (
    <>
      <td className="whitespace-nowrap">{fmtField(metric.depthRatio)}</td>
      <td className="whitespace-nowrap">{fmtField(metric.velocity)}</td>
      <td className="whitespace-nowrap">{indicatorValue(metric, "froude")}</td>
      <td className="whitespace-nowrap">{indicatorValue(metric, "courant")}</td>
      <td className="whitespace-nowrap">{fmtIndicator(metric, "froude")}</td>
      <td className="whitespace-nowrap">{fmtIndicator(metric, "courant")}</td>
      <td className="whitespace-nowrap">{fmtIndicator(metric, "crown")}</td>
      <td className="whitespace-nowrap font-semibold">{fmt(metric.Rcoh)}</td>
      <td className="whitespace-nowrap">{indicatorLabel(metric.governing)}</td>
      <td><StatusPill category={metric.category} /></td>
    </>
  );
}

function SettingInput({
  label,
  help,
  value,
  step,
  min,
  max,
  onChange,
}: {
  label: string;
  help: string;
  value: number | string;
  step: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value === "" ? "" : String(value));
  useEffect(() => {
    setDraft(value === "" ? "" : String(value));
  }, [value]);
  const commit = () => {
    const next = Number(draft.trim());
    const valid = draft.trim() !== "" && Number.isFinite(next)
      && (min === undefined || next >= min)
      && (max === undefined || next <= max);
    if (valid) onChange(next);
    else setDraft(value === "" ? "" : String(value));
  };
  return (
    <label className="flex min-w-[105px] flex-col gap-1 text-xs font-medium">
      <span className="flex items-center gap-1.5">{label}<CoherenceHelp label={label} text={help} /></span>
      <input
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        onChange={event => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm font-normal"
      />
    </label>
  );
}

function NetworkMap({
  result,
  selected,
  onSelect,
}: {
  result: DiagnosticResult;
  selected?: string;
  onSelect: (name: string) => void;
}) {
  const supplied = Object.values(result.model.coordinates);
  const minX = supplied.length ? Math.min(...supplied.map(point => point.x)) : 0;
  const maxX = supplied.length ? Math.max(...supplied.map(point => point.x)) : 1;
  const minY = supplied.length ? Math.min(...supplied.map(point => point.y)) : 0;
  const maxY = supplied.length ? Math.max(...supplied.map(point => point.y)) : 1;
  const point = (name: string, fallback: number) => {
    const coordinate = result.model.coordinates[name];
    if (!coordinate) return { x: 32 + (fallback * 83) % 330, y: 32 + (fallback * 47) % 108 };
    return {
      x: 30 + ((coordinate.x - minX) / Math.max(maxX - minX, 1)) * 340,
      y: 140 - ((coordinate.y - minY) / Math.max(maxY - minY, 1)) * 110,
    };
  };
  const nodes = new Map<string, { x: number; y: number }>();
  result.rows.forEach((row, index) => {
    nodes.set(row.from, point(row.from, index * 2));
    nodes.set(row.to, point(row.to, index * 2 + 1));
  });
  const colour = (category: ScreeningCategory) => category === "review" ? "#dc2626"
    : category === "watch" ? "#d97706" : category === "clear" ? "#16a34a" : "#64748b";
  return (
    <svg viewBox="0 0 400 170" className="h-40 w-full rounded bg-muted/30" role="img" aria-label="Conduit network screening map">
      {result.rows.map((row, index) => {
        const from = point(row.from, index * 2);
        const to = point(row.to, index * 2 + 1);
        return (
          <g key={row.name} onClick={() => onSelect(row.name)} className="cursor-pointer">
            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={colour(row.category)} strokeWidth={selected === row.name ? 5 : 3} strokeDasharray={row.category === "unknown" ? "5 3" : undefined} />
            <title>{row.name}: {row.category}</title>
          </g>
        );
      })}
      {Array.from(nodes.entries()).map(([name, value]) => <g key={name}><circle cx={value.x} cy={value.y} r="3" fill="currentColor" /><text x={value.x + 5} y={value.y - 5} className="fill-muted-foreground text-[9px]">{name}</text></g>)}
    </svg>
  );
}

export default function CoherenceDiagnostic({
  inpText,
  swmm5Report,
  swmm6Report,
  fileName,
}: CoherenceDiagnosticProps) {
  const [settings, setSettings] = useState<DiagnosticSettings>(DEFAULT_SETTINGS);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | ScreeningCategory>("all");
  const [governing, setGoverning] = useState("all");
  const [engine, setEngine] = useState<"all" | "swmm5" | "swmm6">("all");
  const [overlap, setOverlap] = useState("all");
  const [selectedConduit, setSelectedConduit] = useState<string | undefined>();

  const result: DiagnosticResult | null = useMemo(() => {
    if (!inpText.trim()) return null;
    return calculateDiagnostic(inpText, swmm5Report, swmm6Report, settings);
  }, [inpText, settings, swmm5Report, swmm6Report]);

  const visibleRows = useMemo(() => {
    if (!result) return [];
    const q = query.trim().toLowerCase();
    return result.rows.filter(row => {
      if (q && !`${row.name} ${row.from} ${row.to}`.toLowerCase().includes(q)) return false;
      if (category !== "all" && row.category !== category) return false;
      if (governing !== "all" && row.governing !== governing) return false;
      if (engine === "swmm5" && row.swmm5.source !== "report") return false;
      if (engine === "swmm6" && row.swmm6.source !== "report") return false;
       if (overlap !== "all" && row.pairing !== overlap) return false;
      return true;
    }).sort((a, b) => {
      if (a.category === "unknown" && b.category !== "unknown") return 1;
      if (b.category === "unknown" && a.category !== "unknown") return -1;
      const left = Number.isFinite(a.weakestR) ? a.weakestR : Number.POSITIVE_INFINITY;
      const right = Number.isFinite(b.weakestR) ? b.weakestR : Number.POSITIVE_INFINITY;
      return left - right || a.name.localeCompare(b.name);
    });
  }, [result, query, category, governing, engine, overlap]);

  const downloadCsv = () => {
    if (!result) return;
    const blob = new Blob([diagnosticCsv(result.rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileName?.replace(/\.inp$/i, "") || "swmm"}-coherence-screen.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const update = (key: keyof DiagnosticSettings, value: number) =>
    setSettings(current => ({ ...current, [key]: value }));
  const comparison = useMemo(() => result ? compareDiagnostic(result) : null, [result]);
  const inspector = result?.rows.find(row => row.name === selectedConduit) || visibleRows[0];
  const velocityUnit = result && ["CFS", "GPM", "MGD"].includes(result.model.flowUnits) ? "ft/s" : "m/s";

  if (!result) {
    return (
      <Card data-testid="coherence-diagnostic">
        <CardContent className="py-8 text-sm text-muted-foreground">
          Load an INP file and select at least one completed engine result to inspect conduit coherence. A second engine result enables the paired comparison columns.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="coherence-diagnostic">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg">Coherence diagnostic</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Experimental screening index for paired SWMM 5 and SWMM 6 report maxima.
              It is a review-priority aid, not a stability verdict.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={downloadCsv} data-testid="button-coherence-csv" title={coherenceHelp.csv}>
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
          <CoherenceHelp label="Export CSV" text={coherenceHelp.csv} />
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3 rounded-md border bg-muted/30 p-3" data-testid="coherence-settings">
          <SettingInput
            label="Screening Δt (s)"
            help={coherenceHelp.dt}
            value={settings.dt ?? result.settings.dt ?? ""}
            step={0.1}
            min={0.001}
            onChange={value => update("dt", value)}
          />
          {settings.dt !== undefined && (
            <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-9"
              onClick={() => setSettings(current => ({ ...current, dt: undefined }))}
              data-testid="button-clear-coherence-dt"
              title={coherenceHelp.reset}
            >
              Clear Δt override
            </Button>
            <CoherenceHelp label="Clear Δt override" text={coherenceHelp.reset} />
            </div>
          )}
          <SettingInput label="R*" help={coherenceHelp.threshold} value={settings.rStar} step={0.05} min={0.001} onChange={value => update("rStar", value)} />
          <SettingInput label="Closed onset d/D" help={coherenceHelp.closed} value={settings.crownOnset} step={0.01} min={0} max={0.999} onChange={value => update("crownOnset", value)} />
          <SettingInput label="Open onset d/D" help={coherenceHelp.open} value={settings.openCrownOnset} step={0.01} min={0} max={0.999} onChange={value => update("openCrownOnset", value)} />
          <SettingInput label="Concurrent dry d/D" help={coherenceHelp.dry} value={settings.dryFraction ?? 0.02} step={0.01} min={0} max={0.999} onChange={value => update("dryFraction", value)} />
          <label className="flex min-w-[120px] flex-col gap-1 text-xs font-medium">
            <span className="flex items-center gap-1.5">Surcharge method<CoherenceHelp label="Surcharge method" text={coherenceHelp.surcharge} /></span>
            <select
              value={settings.surchargeMethod && ["EXTRAN", "SLOT"].includes(settings.surchargeMethod) ? settings.surchargeMethod : ""}
              onChange={event => setSettings(current => ({ ...current, surchargeMethod: event.target.value || undefined }))}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm font-normal"
            >
              <option value="">Follow each run</option>
              <option value="EXTRAN">EXTRAN crown cutoff</option>
              <option value="SLOT">SWMM slot</option>
            </select>
          </label>
          <label className="flex min-w-[170px] flex-col gap-1 text-xs font-medium">
            <span className="flex items-center gap-1.5">Screening evidence<CoherenceHelp label="Screening evidence" text={coherenceHelp.evidence} /></span>
            <select
              value={settings.basis || "auto"}
              onChange={event => setSettings(current => ({ ...current, basis: event.target.value as DiagnosticSettings["basis"] }))}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm font-normal"
              data-testid="select-coherence-basis"
            >
              <option value="auto">Auto (concurrent if present)</option>
              <option value="summary">Report maxima (non-concurrent)</option>
              <option value="concurrent">Concurrent link series only</option>
            </select>
          </label>
          <div className="basis-full text-xs text-muted-foreground">
            SWMM 5 Δt: <b>{result.sideRunSettings.swmm5.dt === undefined ? "unavailable" : `${result.sideRunSettings.swmm5.dt} s`}</b>
            {" "}({result.sideRunSettings.swmm5.dtSource}); SWMM 6 Δt: <b>{result.sideRunSettings.swmm6.dt === undefined ? "unavailable" : `${result.sideRunSettings.swmm6.dt} s`}</b>
            {" "}({result.sideRunSettings.swmm6.dtSource}). Methods: <b>{result.sideRunSettings.swmm5.surchargeMethod}</b> / <b>{result.sideRunSettings.swmm6.surchargeMethod}</b>.
            {settings.dt !== undefined && " Manual Δt override is active; clear it to restore report/INP fallback."}
            {" "}<CoherenceHelp label="Per-engine settings and sources" text={coherenceHelp.source} />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <section
          className="mb-4 space-y-2 rounded-md border bg-muted/30 p-4 text-sm"
          aria-label="Example interpretation of engine agreement"
          data-testid="coherence-interpretation-note"
        >
          <h3 className="font-semibold">What’s the difference between SWMM5 and SWMM6 here?</h3>
          <p className="text-xs font-medium text-muted-foreground">
            Model-specific interpretation supplied by the user — not an automatically calculated verdict for the selected results.
          </p>
          <blockquote className="border-l-2 border-primary/40 pl-3 leading-relaxed">
            The overall answer to “what’s the difference between SWMM5 and SWMM6 here”:
            none in the hydraulics — every maximum and every derived margin is identical
            to two decimals, and the time step never governs anywhere. The two engines
            differ only in what their ranked diagnostic lists include for 8100.
            To see whether the time series differ, load the .out from each engine as
            sets A and B; then the concurrent R-min and the max |Δdepth| / |ΔV|
            columns and the overlay charts answer it directly.
          </blockquote>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Agreement to two decimals does not establish identical time series or numerical
            stability. The A/B .out upload, maximum time-series difference columns, and overlay
            charts described above are a suggested comparison workflow, not controls currently
            available in this tab. This tab screens appended report time series in concurrent
            mode; its V Δ and d/D Δ columns compare report maxima, not maximum point-by-point
            time-series differences.
          </p>
        </section>
        <Tabs defaultValue="screen" className="w-full">
          <TabsList>
            <TabsTrigger value="screen">Screening table</TabsTrigger>
            <TabsTrigger value="method">Method & limitations</TabsTrigger>
          </TabsList>
          <TabsContent value="screen" className="space-y-4">
            {result.settingsError && (
              <div
                className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
                data-testid="coherence-settings-error"
              >
                Invalid screening settings: {result.settingsError} Rows are shown as unknown until valid settings are supplied.
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
              {[
                ["Conduits", result.coverage.conduits],
                ["Paired rows", result.coverage.pairedRows],
                ["Review", result.coverage.review],
                ["Watch", result.coverage.watch],
                ["Clear", result.coverage.clear],
                ["Unknown", result.coverage.unknown],
                ["Approx. geometry", result.coverage.approximateGeometry],
                ["Unsupported/missing", result.coverage.unsupportedGeometry],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border bg-card px-3 py-2">
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="text-lg font-semibold">{value}</div>
                </div>
              ))}
            </div>
            {(result.report5.warnings.length > 0 || result.report6.warnings.length > 0) && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                <div className="flex items-center gap-2 font-medium"><TriangleAlert className="h-4 w-4" /> Report coverage warning</div>
                <ul className="ml-6 mt-1 list-disc">
                  {[...result.report5.warnings.map(item => `SWMM 5: ${item}`), ...result.report6.warnings.map(item => `SWMM 6: ${item}`)].map(item => <li key={item}>{item}</li>)}
                </ul>
              </div>
            )}
            <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-950 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
              <b>Evidence basis: {result.basis === "concurrent" ? "concurrent link time series" : "report-summary maxima"}.</b>{" "}
              {result.basis === "concurrent"
                ? "Each retained period uses depth and velocity from that same period."
                : "Maximum depth and maximum velocity can occur at different times; this is a review-priority screen, not a stability verdict."}
              {result.rows.some(row => row.swmm5.concurrentEvidence === "missing" || row.swmm6.concurrentEvidence === "missing")
                && " Missing or truncated concurrent evidence is labelled rather than treated as zero."}
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-md border p-3">
                <div className="mb-2 text-sm font-medium">Network map</div>
                <NetworkMap result={result} selected={selectedConduit} onSelect={setSelectedConduit} />
                <p className="mt-1 text-xs text-muted-foreground">Line colour is the paired screening category; click a conduit to inspect it. Layout uses INP coordinates when available.</p>
              </div>
              <div className="rounded-md border p-3 text-sm">
                <div className="mb-2 font-medium">Conduit inspector</div>
                {inspector ? (
                  <>
                    <div className="font-medium">{inspector.name} <span className="font-normal text-muted-foreground">{inspector.from} → {inspector.to}</span></div>
                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <span>Geometry</span><span>{inspector.section.shape} ({inspector.section.support})</span>
                      <span>SWMM 5</span><span>{inspector.swmm5.basis} · {inspector.swmm5.concurrentEvidence} · <b>{inspector.swmm5.category}</b></span>
                      <span>SWMM 6</span><span>{inspector.swmm6.basis} · {inspector.swmm6.concurrentEvidence} · <b>{inspector.swmm6.category}</b></span>
                      <span>R-min</span><span>{fmt(inspector.swmm5.Rcoh)} → {fmt(inspector.swmm6.Rcoh)}</span>
                      <span>Adj./actual length</span><span>{fmtField(inspector.swmm5Diagnostics.adjustedLength)} / {fmtField(inspector.swmm6Diagnostics.adjustedLength)}</span>
                      <span>FII</span><span>{inspector.swmm5Diagnostics.flowInstability.status}{inspector.swmm5Diagnostics.flowInstability.value === undefined ? "" : ` ${inspector.swmm5Diagnostics.flowInstability.value}`} / {inspector.swmm6Diagnostics.flowInstability.status}{inspector.swmm6Diagnostics.flowInstability.value === undefined ? "" : ` ${inspector.swmm6Diagnostics.flowInstability.value}`}</span>
                      <span>Time-step critical</span><span>{inspector.swmm5Diagnostics.timeStepCritical.status}{inspector.swmm5Diagnostics.timeStepCritical.value === undefined ? "" : ` ${inspector.swmm5Diagnostics.timeStepCritical.value}%`} / {inspector.swmm6Diagnostics.timeStepCritical.status}{inspector.swmm6Diagnostics.timeStepCritical.value === undefined ? "" : ` ${inspector.swmm6Diagnostics.timeStepCritical.value}%`}</span>
                      <span>Screen/report diagnostic</span><span>{inspector.swmm5Overlap} / {inspector.swmm6Overlap}</span>
                    </div>
                    {(inspector.swmm5.note || inspector.swmm6.note) && <p className="mt-2 text-xs text-muted-foreground">{inspector.swmm5.note || inspector.swmm6.note}</p>}
                  </>
                ) : <p className="text-muted-foreground">No conduit is available.</p>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                type="search"
                placeholder="Search conduit, from, or to…"
                value={query}
                onChange={event => setQuery(event.target.value)}
                className="h-9 min-w-[210px] flex-1 rounded-md border border-input bg-background px-3 text-sm"
                data-testid="input-coherence-search"
              />
              <select value={category} onChange={event => setCategory(event.target.value as typeof category)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" data-testid="select-coherence-category">
                <option value="all">All statuses</option>
                <option value="review">Review</option>
                <option value="watch">Watch</option>
                <option value="clear">Clear</option>
                <option value="unknown">Unknown</option>
              </select>
              <select value={governing} onChange={event => setGoverning(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                <option value="all">All governing factors</option>
                <option value="froude">Froude</option>
                <option value="courant">Time step</option>
                <option value="crown">Crown</option>
                <option value="unknown">Unknown</option>
              </select>
              <select value={engine} onChange={event => setEngine(event.target.value as typeof engine)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                <option value="all">Both report sources</option>
                <option value="swmm5">SWMM 5 report rows</option>
                <option value="swmm6">SWMM 6 report rows</option>
              </select>
              <select value={overlap} onChange={event => setOverlap(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                <option value="all">All pairing states</option>
                <option value="review-overlap">Review in both</option>
                <option value="review-only">Review in one</option>
                <option value="unknown">Unknown pairing</option>
                <option value="none">No review</option>
              </select>
            </div>
            <div className="overflow-x-auto rounded-md border">
              <div className="border-b bg-muted/20 px-3 py-2 text-xs text-muted-foreground">Priority list — weakest finite R-min first; unknown evidence remains after screened rows.</div>
              <table className="min-w-[1500px] w-full text-xs" data-testid="table-coherence">
                <thead className="bg-muted/60">
                  <tr className="border-b">
                    <th rowSpan={2} className="px-2 py-2 text-left">Conduit</th>
                    <th rowSpan={2} className="px-2 py-2 text-left">Geometry</th>
                    <th colSpan={10} className="border-l px-2 py-2 text-center text-blue-700 dark:text-blue-300">SWMM 5</th>
                    <th colSpan={10} className="border-l px-2 py-2 text-center text-amber-700 dark:text-amber-300">SWMM 6</th>
                    <th rowSpan={2} className="border-l px-2 py-2 text-left">Pairing</th>
                     <th rowSpan={2} className="px-2 py-2 text-left">Adj./actual L<br />(5 / 6)</th>
                     <th rowSpan={2} className="px-2 py-2 text-left">FII<br />(5 / 6)</th>
                     <th rowSpan={2} className="px-2 py-2 text-left">TSC<br />(5 / 6)</th>
                      <th rowSpan={2} className="px-2 py-2 text-left">Screen/report diagnostic<br />(5 / 6)</th>
                  </tr>
                  <tr className="border-b text-muted-foreground">
                    {["d/D", `V (${velocityUnit})`, "Fr", "Cr", "R-Fr", "R-dt", "R-crown", "R-min", "Factor", "Status",
                      "d/D", `V (${velocityUnit})`, "Fr", "Cr", "R-Fr", "R-dt", "R-crown", "R-min", "Factor", "Status"].map((label, index) => (
                        <th key={`${label}-${index}`} className={`px-2 py-1 text-left ${index === 0 || index === 10 ? "border-l" : ""}`}>{label}</th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map(row => (
                    <tr key={row.name} onClick={() => setSelectedConduit(row.name)} className="cursor-pointer border-b last:border-0 hover:bg-muted/30">
                      <td className="px-2 py-2 align-top">
                        <div className="font-medium">{row.name}</div>
                        <div className="text-muted-foreground">{row.from} → {row.to}</div>
                      </td>
                      <td className="px-2 py-2 align-top">
                        <div>{row.section.shape}</div>
                        <div className="text-muted-foreground">{row.section.support}</div>
                      </td>
                      <MetricCells metric={row.swmm5} />
                      <MetricCells metric={row.swmm6} />
                       <td className="border-l px-2 py-2 align-top"><StatusPill category={row.category} /><div className="mt-1 text-muted-foreground">{row.pairing}</div><div className="mt-1 text-muted-foreground">diag: {row.swmm5Overlap} / {row.swmm6Overlap}</div></td>
                       <td className="px-2 py-2 align-top whitespace-nowrap">{fmtField(row.swmm5Diagnostics.adjustedLength)} / {fmtField(row.swmm6Diagnostics.adjustedLength)}</td>
                       <td className="px-2 py-2 align-top whitespace-nowrap">{row.swmm5Diagnostics.flowInstability.status}{row.swmm5Diagnostics.flowInstability.value === undefined ? "" : ` ${row.swmm5Diagnostics.flowInstability.value}`} / {row.swmm6Diagnostics.flowInstability.status}{row.swmm6Diagnostics.flowInstability.value === undefined ? "" : ` ${row.swmm6Diagnostics.flowInstability.value}`}</td>
                       <td className="px-2 py-2 align-top whitespace-nowrap">{row.swmm5Diagnostics.timeStepCritical.status}{row.swmm5Diagnostics.timeStepCritical.value === undefined ? "" : ` ${row.swmm5Diagnostics.timeStepCritical.value}%`} / {row.swmm6Diagnostics.timeStepCritical.status}{row.swmm6Diagnostics.timeStepCritical.value === undefined ? "" : ` ${row.swmm6Diagnostics.timeStepCritical.value}%`}</td>
                       <td className="px-2 py-2 align-top whitespace-nowrap">{row.swmm5Overlap} / {row.swmm6Overlap}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {visibleRows.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">No conduits match the current filters.</div>}
            </div>
            {comparison && (
              <div className="rounded-md border p-3">
                <div className="text-sm font-medium">SWMM 5 → SWMM 6 flag transitions</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Each side uses its own run Δt ({comparison.dt5 ?? "unavailable"} s → {comparison.dt6 ?? "unavailable"} s).
                  Censored or invalid maxima intentionally have no numeric delta.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Routing continuity: {fmt(comparison.continuity5, 3)}% → {fmt(comparison.continuity6, 3)}%; steps not converging: {fmt(comparison.pctNotConverging5, 2)}% → {fmt(comparison.pctNotConverging6, 2)}%.
                </p>
                <div className="mt-2 flex flex-wrap gap-3 text-xs">
                  {Object.entries(comparison.counts).map(([label, count]) => <span key={label}><b>{count}</b> {label}</span>)}
                </div>
                <div className="mt-2 max-h-48 overflow-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="border-b text-left"><th className="p-1">Conduit</th><th className="p-1">Transition</th><th className="p-1">R-min</th><th className="p-1">V Δ ({velocityUnit})</th><th className="p-1">d/D Δ</th><th className="p-1">FII (5 / 6)</th><th className="p-1">TSC (5 / 6)</th><th className="p-1">Screen/report (5 / 6)</th></tr></thead>
                    <tbody>{comparison.rows.map(row => <tr key={row.name} className="border-b last:border-0"><td className="p-1">{row.name}</td><td className="p-1">{row.transition}</td><td className="p-1">{fmt(row.swmm5.Rcoh)} → {fmt(row.swmm6.Rcoh)}</td><td className="p-1">{row.velocityDelta === undefined ? "unavailable" : fmt(row.velocityDelta)}</td><td className="p-1">{row.depthRatioDelta === undefined ? "unavailable" : fmt(row.depthRatioDelta)}</td><td className="p-1">{row.swmm5Diagnostics.flowInstability.status}{row.swmm5Diagnostics.flowInstability.value === undefined ? "" : ` ${row.swmm5Diagnostics.flowInstability.value}`} / {row.swmm6Diagnostics.flowInstability.status}{row.swmm6Diagnostics.flowInstability.value === undefined ? "" : ` ${row.swmm6Diagnostics.flowInstability.value}`}</td><td className="p-1">{row.swmm5Diagnostics.timeStepCritical.status}{row.swmm5Diagnostics.timeStepCritical.value === undefined ? "" : ` ${row.swmm5Diagnostics.timeStepCritical.value}%`} / {row.swmm6Diagnostics.timeStepCritical.status}{row.swmm6Diagnostics.timeStepCritical.value === undefined ? "" : ` ${row.swmm6Diagnostics.timeStepCritical.value}%`}</td><td className="p-1">{row.swmm5Overlap} / {row.swmm6Overlap}</td></tr>)}</tbody>
                  </table>
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">{visibleRows.length} of {result.rows.length} conduits shown. Censored report values retain their bound marker; dashes represent unavailable data, not zero.</p>
          </TabsContent>
          <TabsContent value="method" className="space-y-3 text-sm">
            <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-blue-950 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
              <div className="flex items-center gap-2 font-medium"><Info className="h-4 w-4" /> What this screen means</div>
              <p className="mt-1">
                Each report-summary row is screened with three margins: R-Fr = 1/Fr,
                R-Δt = L/((V+c)Δt), and R-crown = (1−d/D)/(1−onset). R-min is the
                weakest available margin. Review means a decisive margin is below R*;
                watch means it is within 25% above R*. Unknown is retained whenever
                required geometry or report data are unavailable.
              </p>
            </div>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Report maxima are non-concurrent: maximum velocity and maximum d/D can occur at different times. This summary mode must not be read as a concurrent peak or a stability verdict.</li>
              <li>When appended link time-series are available, concurrent mode evaluates depth and velocity at the same reported period. Truncated, malformed, or absent series remain missing evidence; they are never decoded as SWMM5 binary data or replaced with zero.</li>
              <li>This index is not a mathematical proof of SWMM 5/SWMM 6 coherence, and green/clear does not prove numerical stability. Use the full RPT convergence, continuity, and time-series results for that assessment.</li>
              <li>Circular and supported analytic sections use SWMM-style celerity width treatment. Elliptical/tabulated sections are marked approximate; irregular, street, custom, and missing [XSECTIONS] data remain unsupported/unknown.</li>
              <li>Velocity tokens such as &gt;50.00 or &lt;0.01 remain censored bounds. A bound can produce a decisive review only in the safe direction; otherwise the result remains unknown.</li>
              <li>SWMM6 DYNAMIC_SLOT and unknown/(null) surcharge echoes are not treated as EXTRAN or SLOT near crown. Their Fr and time-step margins remain unknown rather than becoming clear.</li>
            </ul>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
