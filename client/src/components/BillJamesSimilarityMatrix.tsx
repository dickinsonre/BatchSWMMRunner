import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Droplets,
  FileCheck2,
  Loader2,
  Scale,
  ShieldAlert,
  Target,
  Waves,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { buildComparisonModelOptions } from "@/lib/entityComparison";
import {
  BILL_JAMES_MODEL_SCORE_CONFIG,
  calculateBillJamesModelScore,
  rankBillJamesCandidates,
  type BillJamesModelScoreResult,
  type ModelScoreCategory,
  type ModelScoreDeduction,
  type ModelScoreRun,
} from "@/lib/billJamesModelScore";
import { compareSystemSeries, type BillJamesSystemComparison } from "@/lib/billJamesSimilarity";
import type { EngineRun } from "@/lib/engineComparison";
import {
  parseTimeSeries,
  parseTimeSeriesTruncation,
  type ParsedTimeSeries,
} from "@/lib/parseTimeSeries";

interface BillJamesSimilarityMatrixProps {
  runs: EngineRun[];
  onLoadFile: (fileName: string, occurrence?: number) => Promise<void>;
}

const fmt = (value: number | undefined, digits = 1) => value === undefined ? "—" : value.toFixed(digits);
const fmtDelta = (item: ModelScoreDeduction) => `${fmt(item.delta, item.deltaUnit === "steps" ? 0 : 2)} ${item.deltaUnit}`;
const fmtDiagnostic = (value: number) => {
  const magnitude = Math.abs(value);
  return magnitude >= 10000 || (magnitude > 0 && magnitude < 0.001)
    ? value.toExponential(3)
    : value.toFixed(3);
};

function asRun(result: EngineRun["results"][number] | undefined): ModelScoreRun {
  const reportContent = result?.reportContent ?? "";
  return {
    status: result?.status ?? "missing",
    series: reportContent ? parseTimeSeries(reportContent) : [],
    routingContinuityError: result?.parsedMetrics?.routingContinuityError,
    seriesTruncation: reportContent
      ? parseTimeSeriesTruncation(reportContent)
      : undefined,
  };
}

function systemSeries(report: string | undefined): ParsedTimeSeries | null {
  if (!report) return null;
  const parsed = parseTimeSeries(report);
  return parsed.find(item => /^system/i.test(item.title.trim()) || /^system$/i.test(item.element.trim())) ?? null;
}

function scoreTone(score: number | undefined) {
  if (score === undefined) return "text-slate-500";
  if (score >= 900) return "text-teal-700 dark:text-teal-300";
  if (score >= 700) return "text-amber-700 dark:text-amber-300";
  return "text-rose-700 dark:text-rose-300";
}

function scoreBar(score: number | undefined) {
  return score === undefined ? 0 : Math.max(0, Math.min(100, score / 10));
}

function bandTone(score: number | undefined) {
  if (score === undefined) return "border-slate-300 bg-slate-100/70 text-slate-700 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300";
  if (score >= 900) return "border-teal-400/50 bg-teal-500/10 text-teal-800 dark:text-teal-200";
  if (score >= 700) return "border-amber-400/50 bg-amber-500/10 text-amber-800 dark:text-amber-200";
  return "border-rose-400/50 bg-rose-500/10 text-rose-800 dark:text-rose-200";
}

function CategoryCard({ category }: { category: ModelScoreCategory }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-slate-200/80 bg-slate-50/60 transition-colors hover:border-cyan-400/70 dark:border-slate-700/80 dark:bg-slate-950/30">
      <button type="button" onClick={() => setOpen(value => !value)} className="flex w-full items-center gap-3 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500">
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold">{category.label}</span>
            <span className="font-mono text-sm font-bold text-cyan-700 dark:text-cyan-300">{fmt(category.points, 1)} <span className="text-[10px] font-normal text-muted-foreground">/ {category.weight}</span></span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"><div className="h-full rounded-full bg-cyan-600 transition-[width] duration-500" style={{ width: `${category.score}%` }} /></div>
          <div className="mt-1 text-[10px] text-muted-foreground">{fmt(category.score, 1)} / 100 element quality · {category.elementCount} elements</div>
        </div>
        {open ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </button>
      {open && <div className="divide-y border-t border-slate-200/80 dark:border-slate-700/80">
        {category.elements.length === 0 ? <p className="p-3 text-xs text-muted-foreground">No elements were reported in this category.</p> : category.elements.map(element => (
          <div key={element.element} className="flex items-center gap-3 px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-[11px]" title={element.element}>{element.element}{element.missingInCandidate && <span className="ml-2 text-rose-600">missing</span>}</span>
            <span className={`font-mono text-xs font-semibold ${scoreTone(element.score * 10)}`}>{fmt(element.score, 1)}</span>
          </div>
        ))}
      </div>}
    </div>
  );
}

function AdvisoryEvidence({ comparison, reference, candidate }: { comparison: BillJamesSystemComparison; reference: string; candidate: string }) {
  const [selected, setSelected] = useState("");
  const variable = comparison.variables.find(item => item.name === selected) ?? comparison.variables[0];
  useEffect(() => setSelected(comparison.variables[0]?.name ?? ""), [comparison]);
  return (
    <section className="border-t border-dashed border-slate-300 pt-5 dark:border-slate-700" aria-labelledby="advisory-evidence">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 id="advisory-evidence" className="flex items-center gap-2 text-sm font-semibold"><Waves className="h-4 w-4 text-cyan-700" /> Advisory evidence · published 12-statistic compare</h3><p className="mt-1 max-w-2xl text-[11px] leading-5 text-muted-foreground">This diagnostic view preserves the existing system-series comparison. It does not contribute to the 1,000-point whole-model score.</p></div>
        <Badge variant="outline" className="font-mono">{reference} → {candidate}</Badge>
      </div>
      <div className="mt-3 overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[620px] text-xs"><caption className="sr-only">Advisory system-series statistics</caption><thead className="bg-muted/45"><tr className="border-b"><th className="px-3 py-2 text-left">System variable</th><th className="px-2 py-2 text-left">Evidence</th><th className="px-2 py-2 text-right">Reference n</th><th className="px-2 py-2 text-right">Candidate n</th><th className="px-3 py-2 text-right">Score / 100</th></tr></thead>
          <tbody>{comparison.variables.length === 0 ? <tr><td colSpan={5} className="p-5 text-center text-muted-foreground">System series is unavailable for this pair.</td></tr> : comparison.variables.map(item => <tr key={item.name} tabIndex={0} role="button" aria-selected={selected === item.name} onClick={() => setSelected(item.name)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(item.name); } }} className={`border-b last:border-0 transition-colors hover:bg-cyan-500/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-600 ${selected === item.name ? "bg-cyan-500/10" : ""}`}><td className="px-3 py-2 font-medium">{item.name}{item.unit && <span className="ml-1 font-normal text-muted-foreground">({item.unit})</span>}</td><td className="px-2 py-2 text-muted-foreground">{item.reason ?? `${item.pairedSamples} paired samples · ${(item.coverage * 100).toFixed(0)}% coverage`}</td><td className="px-2 py-2 text-right font-mono">{item.referenceSamples}</td><td className="px-2 py-2 text-right font-mono">{item.candidateSamples}</td><td className={`px-3 py-2 text-right font-mono font-semibold ${scoreTone(item.score)}`}>{fmt(item.score ?? item.partialScore)}{item.partialScore !== undefined ? "*" : ""}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] leading-5 text-muted-foreground">* Partial-overlap scores are diagnostics only. They are excluded from the advisory headline when exact coverage is incomplete.</p>
      {variable && <div className="mt-3 rounded-lg border bg-slate-50/50 dark:bg-slate-950/30"><div className="border-b px-3 py-2 text-xs font-semibold">Statistic components · {variable.name}</div><div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-4">{variable.components.map(component => <div key={component.key} className="rounded border bg-background px-2.5 py-2"><div className="truncate text-[10px] text-muted-foreground">{component.label}</div><div className={`mt-1 font-mono text-sm font-semibold ${scoreTone(component.score)}`}>{fmt(component.score)}</div><div className="text-[10px] text-muted-foreground">{component.unavailableReason ?? `raw ${fmt(component.rawValue, 4)}`}</div></div>)}</div></div>}
    </section>
  );
}

export default function BillJamesSimilarityMatrix({ runs, onLoadFile }: BillJamesSimilarityMatrixProps) {
  const models = useMemo(() => buildComparisonModelOptions(runs, 1), [runs]);
  const [modelKey, setModelKey] = useState(models[0]?.key ?? "");
  const [referenceIndex, setReferenceIndex] = useState(0);
  const [candidateIndex, setCandidateIndex] = useState(1);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!models.length || models.some(model => model.key === modelKey)) return;
    const next = models[0];
    const ready = next.results
      .map((result, index) => result?.status === "success" ? index : -1)
      .filter(index => index >= 0);
    setModelKey(next.key);
    setReferenceIndex(ready[0] ?? 0);
    setCandidateIndex(ready[1] ?? -1);
  }, [models, modelKey]);
  const model = models.find(item => item.key === modelKey);
  useEffect(() => {
    if (!model) return;
    let active = true;
    setLoading(true);
    onLoadFile(model.fileName, model.occurrence).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // The selected occurrence is the hydration trigger owned by the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelKey]);

  const readyIndices = useMemo(() => (model?.results ?? []).map((result, index) => result?.status === "success" ? index : -1).filter(index => index >= 0), [model]);
  useEffect(() => {
    const nextReference = readyIndices.includes(referenceIndex) ? referenceIndex : readyIndices[0] ?? 0;
    setReferenceIndex(nextReference);
    const nextCandidate = readyIndices.find(index => index !== nextReference) ?? (runs.length > 1 ? (nextReference === 0 ? 1 : 0) : -1);
    setCandidateIndex(candidateIndex === nextReference ? nextCandidate : candidateIndex);
  }, [readyIndices, referenceIndex, candidateIndex, runs.length]);

  const runInputs = useMemo(() => (model?.results ?? []).map(asRun), [model]);
  const referenceRun = runInputs[referenceIndex];
  const candidates = useMemo(() => runs.map((run, index) => ({ label: run.label, run: runInputs[index], index })).filter(item => item.index !== referenceIndex && item.run), [runs, runInputs, referenceIndex]);
  const ranked = useMemo(() => rankBillJamesCandidates(referenceRun ?? { status: "missing", series: [] }, candidates.map(item => ({ label: item.label, run: item.run })), BILL_JAMES_MODEL_SCORE_CONFIG).map((item, rank) => ({ ...item, originalIndex: candidates[item.index]?.index ?? -1, rank })), [referenceRun, candidates]);
  const selectedRank = ranked.find(item => item.originalIndex === candidateIndex) ?? ranked[0];
  const selectedCandidateIndex = selectedRank?.originalIndex ?? -1;
  const headline: BillJamesModelScoreResult = selectedRank?.result ?? calculateBillJamesModelScore(referenceRun ?? { status: "missing", series: [] }, { status: "missing", series: [] });
  const extraCandidateCount = Object.values(headline.extraCandidateElements).reduce((sum, ids) => sum + ids.length, 0);
  const weightsRenormalized = headline.categories.some(category =>
    Math.abs(category.weight - BILL_JAMES_MODEL_SCORE_CONFIG.categories[category.key].weight) > 1e-6
  );
  const advisory = useMemo(() => compareSystemSeries(systemSeries(model?.results[referenceIndex]?.reportContent), systemSeries(model?.results[selectedCandidateIndex]?.reportContent)), [model, referenceIndex, selectedCandidateIndex]);
  if (models.length === 0) return null;

  return (
    <Card className="overflow-hidden border-slate-300/80 bg-[linear-gradient(135deg,hsl(var(--card)),hsl(190_30%_97%))] dark:border-slate-700/80 dark:bg-[linear-gradient(135deg,hsl(var(--card)),hsl(205_30%_9%))]" data-testid="card-bill-james-matrix">
      <CardHeader className="border-b border-cyan-900/10 bg-slate-950/[0.03] pb-4 dark:bg-cyan-100/[0.03]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300"><Droplets className="h-3.5 w-3.5" /> Whole-model evidence index</div><CardTitle className="flex items-center gap-2 text-xl tracking-tight"><Scale className="h-5 w-5 text-cyan-700 dark:text-cyan-300" /> Bill James model score</CardTitle><p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">One reference engine. Every other completed or attempted engine is ranked against it using the approved 1,000-point schedule.</p></div>
          <Select value={modelKey} onValueChange={value => {
            const next = models.find(item => item.key === value);
            const ready = (next?.results ?? [])
              .map((result, index) => result?.status === "success" ? index : -1)
              .filter(index => index >= 0);
            setModelKey(value);
            setReferenceIndex(ready[0] ?? 0);
            setCandidateIndex(ready[1] ?? -1);
          }}><SelectTrigger className="w-full sm:w-[280px]" data-testid="select-bill-james-model"><SelectValue placeholder="Choose model" /></SelectTrigger><SelectContent>{models.map(item => <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>)}</SelectContent></Select>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="min-w-[210px] flex-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Reference engine<select value={referenceIndex} onChange={event => { const index = Number(event.target.value); setReferenceIndex(index); if (index === candidateIndex) setCandidateIndex(readyIndices.find(item => item !== index) ?? -1); }} className="mt-1 block h-9 w-full rounded-md border bg-background px-2 text-sm font-normal normal-case tracking-normal focus:outline-none focus:ring-2 focus:ring-cyan-500">{readyIndices.map(index => <option key={index} value={index}>{runs[index]?.label}</option>)}</select></label>
          <div className="hidden pb-2 text-cyan-700 sm:block"><ArrowDown className="h-4 w-4 rotate-[-90deg]" /></div>
          <div className="flex min-w-[175px] items-center gap-2 rounded-md border border-dashed border-cyan-500/40 bg-cyan-500/5 px-3 py-2 text-xs text-cyan-800 dark:text-cyan-200"><Target className="h-4 w-4" /><span>Candidate ranking below</span></div>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-cyan-700" aria-label="Loading report" />}
        </div>
      </CardHeader>
      <CardContent className="space-y-5 p-3 sm:p-5">
        <section aria-labelledby="candidate-ranking">
          <div className="mb-3 flex items-end justify-between gap-3"><div><h3 id="candidate-ranking" className="text-sm font-semibold">Candidate ranking</h3><p className="mt-1 text-[11px] text-muted-foreground">Select a row to reveal its evidence. Scores are directional: {runs[referenceIndex]?.label ?? "Reference"} is the background.</p></div><Badge variant="outline" className="font-mono">{BILL_JAMES_MODEL_SCORE_CONFIG.maxScore} pts max</Badge></div>
          <div className="grid gap-2">{ranked.length === 0 ? <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">No other engine result is available for ranking.</div> : ranked.map(item => { const active = item.originalIndex === selectedCandidateIndex; return <button key={`${item.label}-${item.originalIndex}`} type="button" onClick={() => setCandidateIndex(item.originalIndex)} aria-pressed={active} className={`group grid w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-3 py-3 text-left transition-all hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600 ${active ? "border-cyan-500 bg-cyan-500/10 shadow-sm" : "border-slate-200/80 bg-background hover:border-cyan-400/60 dark:border-slate-700/80"}`}>
              <span className={`font-mono text-sm font-bold ${active ? "text-cyan-700 dark:text-cyan-300" : "text-muted-foreground"}`}>{String(item.rank + 1).padStart(2, "0")}</span><span className="min-w-0"><span className="flex items-center gap-2 truncate text-xs font-semibold">{active && <span className="h-2 w-2 rounded-full bg-cyan-500" />}{item.label}</span><span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-cyan-600 transition-[width] duration-500" style={{ width: `${scoreBar(item.result.score)}%` }} /></span><span className="mt-1 block truncate text-[10px] text-muted-foreground">{item.result.band}{item.result.gateReasons.length > 0 ? ` · ${item.result.gateReasons[0]}` : ""}</span></span><span className={`text-right font-mono text-lg font-bold ${scoreTone(item.result.score)}`}>{fmt(item.result.score, 1)}<span className="block text-[9px] font-normal text-muted-foreground">/ 1,000</span></span>
            </button>; })}</div>
        </section>
        <section className={`rounded-xl border p-4 ${bandTone(headline.score)}`} aria-labelledby="selected-score">
          <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em]"><FileCheck2 className="h-4 w-4" /> Selected comparison</div><h3 id="selected-score" className="mt-1 text-lg font-semibold">{runs[referenceIndex]?.label ?? "Reference"} <span className="mx-1 text-muted-foreground">→</span> {runs[selectedCandidateIndex]?.label ?? "Candidate"}</h3><p className="mt-1 text-xs">{headline.band}</p></div><div className="text-right"><div className={`font-mono text-4xl font-bold tracking-tight ${scoreTone(headline.score)}`}>{fmt(headline.score, 1)}</div><div className="font-mono text-[10px] uppercase tracking-wider opacity-70">approved score / 1,000</div></div></div>
          {headline.gateReasons.length > 0 && <div className="mt-4 flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs"><ShieldAlert className="h-4 w-4 shrink-0" /><div><strong>No-score gate</strong><ul className="mt-1 list-inside list-disc">{headline.gateReasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div></div>}
          {headline.score !== undefined && (headline.skippedMetrics.length > 0 || extraCandidateCount > 0) && <div className="mt-4 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs"><div className="flex items-start gap-2"><CircleHelp className="mt-0.5 h-4 w-4 shrink-0" /><div><strong>Evidence coverage</strong><div className="mt-1 space-y-1 text-[11px]">{headline.skippedMetrics.length > 0 && <p>{headline.skippedMetrics.length} metric{headline.skippedMetrics.length === 1 ? " was" : "s were"} skipped because paired evidence was unavailable, a peak stayed below its floor, or a shape window failed its wet-series guards.</p>}{extraCandidateCount > 0 && <p>{extraCandidateCount} candidate-only record{extraCandidateCount === 1 ? " is" : "s are"} reported but not scored; the reference defines the expected record set.</p>}</div></div></div><details className="mt-2 border-t border-cyan-500/20 pt-2"><summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wider">Show coverage details</summary><ul className="mt-2 space-y-1 text-[10px] text-muted-foreground">{headline.skippedMetrics.map((item, index) => <li key={`${item.category}-${item.element}-${item.metric}-${index}`}><span className="font-medium text-foreground">{item.element} · {item.metric}</span> — {item.reason}</li>)}{Object.entries(headline.extraCandidateElements).flatMap(([category, ids]) => ids.map(id => <li key={`extra-${category}-${id}`}><span className="font-medium text-foreground">{id}</span> — candidate-only {category}</li>))}</ul></details></div>}
        </section>
        {headline.score !== undefined && <section aria-labelledby="category-breakdown"><div className="mb-3 flex items-center justify-between gap-3"><h3 id="category-breakdown" className="text-sm font-semibold">Weighted categories</h3><span className="text-right text-[10px] text-muted-foreground">{headline.categories.filter(category => category.weight > 0).map(category => `${category.label} ${fmt(category.weight, 0)}`).join(" · ")}{weightsRenormalized ? " · renormalized" : ""}</span></div><div className="grid gap-2 md:grid-cols-2">{headline.categories.map(category => <CategoryCard key={category.key} category={category} />)}</div></section>}
        <section aria-labelledby="deduction-ledger"><div className="mb-3 flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-600" /><div><h3 id="deduction-ledger" className="text-sm font-semibold">Deduction ledger</h3><p className="text-[11px] text-muted-foreground">Sorted by weighted points removed from the 1,000-point score.</p></div></div><div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[680px] text-xs"><thead className="bg-muted/45"><tr className="border-b"><th className="px-3 py-2 text-left">Category / element</th><th className="px-2 py-2 text-left">Metric</th><th className="px-2 py-2 text-left">Delta</th><th className="px-3 py-2 text-right">Points removed</th></tr></thead><tbody>{headline.deductions.length === 0 ? <tr><td colSpan={4} className="p-5 text-center text-muted-foreground">{headline.score === undefined ? "No deductions are emitted when a gate prevents scoring." : "No deductions: records are identical under the schedule."}</td></tr> : headline.deductions.slice(0, 40).map((item, index) => <tr key={`${item.element}-${item.metric}-${index}`} className="border-b last:border-0 hover:bg-amber-500/5"><td className="px-3 py-2"><span className="font-medium">{item.element}</span><span className="ml-2 text-[10px] text-muted-foreground">{item.category}</span></td><td className="px-2 py-2">{item.metric}<span className="block text-[10px] text-muted-foreground">{item.detail}</span></td><td className="px-2 py-2 font-mono">{fmtDelta(item)}</td><td className="px-3 py-2 text-right font-mono font-semibold text-amber-700 dark:text-amber-300">−{fmt(item.points, 2)}</td></tr>)}</tbody></table></div></section>
        {headline.score !== undefined && <section aria-labelledby="shape-diagnostics">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 id="shape-diagnostics" className="flex items-center gap-2 text-sm font-semibold"><Waves className="h-4 w-4 text-cyan-700" /> Hydrograph shape diagnostics</h3>
              <p className="mt-1 text-[11px] text-muted-foreground">KGE-2009 and NSE use reference-wet windows. MSE and KGE components are diagnostic-only.</p>
            </div>
            <Badge variant="outline" className="font-mono">minimum {BILL_JAMES_MODEL_SCORE_CONFIG.shape.minimumWetSteps} wet steps</Badge>
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[900px] text-xs">
              <caption className="sr-only">Per-entity hydrograph shape diagnostics using KGE-2009</caption>
              <thead className="bg-muted/45"><tr className="border-b"><th className="px-3 py-2 text-left">Element</th><th className="px-2 py-2 text-left">Series</th><th className="px-2 py-2 text-right">Wet n</th><th className="px-2 py-2 text-right">KGE-2009</th><th className="px-2 py-2 text-right">NSE</th><th className="px-2 py-2 text-right">MSE</th><th className="px-2 py-2 text-right">r</th><th className="px-2 py-2 text-right">α</th><th className="px-3 py-2 text-right">β</th></tr></thead>
              <tbody>{headline.shapeDiagnostics.length === 0
                ? <tr><td colSpan={9} className="p-5 text-center text-muted-foreground">No entity had an eligible reference-wet shape window. Review Evidence coverage for skipped reasons.</td></tr>
                : headline.shapeDiagnostics.map(item => <tr key={`${item.category}-${item.element}-${item.metric}`} className="border-b last:border-0 hover:bg-cyan-500/5"><td className="px-3 py-2"><span className="font-medium">{item.element}</span><span className="ml-2 text-[10px] text-muted-foreground">{item.category}</span></td><td className="px-2 py-2">{item.metric}<span className="ml-1 text-[10px] text-muted-foreground">({item.unit})</span></td><td className="px-2 py-2 text-right font-mono">{item.wetSamples}</td><td className="px-2 py-2 text-right font-mono font-semibold">{fmtDiagnostic(item.kge)}</td><td className="px-2 py-2 text-right font-mono font-semibold">{fmtDiagnostic(item.nse)}</td><td className="px-2 py-2 text-right font-mono">{fmtDiagnostic(item.mse)} <span className="text-[9px] text-muted-foreground">{item.unit}²</span></td><td className="px-2 py-2 text-right font-mono">{fmtDiagnostic(item.correlation)}</td><td className="px-2 py-2 text-right font-mono">{fmtDiagnostic(item.variabilityRatio)}</td><td className="px-3 py-2 text-right font-mono">{fmtDiagnostic(item.biasRatio)}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="mt-2 text-[10px] leading-5 text-muted-foreground"><strong>r</strong> diagnoses shape and phase, <strong>α</strong> is the candidate/reference variability ratio, and <strong>β</strong> is the candidate/reference mean ratio. NSE can be negative when the candidate is worse than using the reference mean.</p>
        </section>}
        <section aria-labelledby="worst-elements"><div className="mb-3 flex items-center gap-2"><CircleHelp className="h-4 w-4 text-cyan-700" /><div><h3 id="worst-elements" className="text-sm font-semibold">Worst elements</h3><p className="text-[11px] text-muted-foreground">Lowest element scores, including missing candidate records.</p></div></div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{headline.elements.slice().sort((a, b) => a.score - b.score).slice(0, 8).map(element => <div key={`${element.category}-${element.element}`} className="rounded-lg border bg-background p-3"><div className="flex justify-between gap-2"><span className="truncate text-xs font-medium" title={element.element}>{element.element}</span><span className={`font-mono text-xs font-bold ${scoreTone(element.score * 10)}`}>{fmt(element.score, 1)}</span></div><div className="mt-2 h-1 overflow-hidden rounded bg-muted"><div className="h-full bg-rose-500 transition-[width] duration-500" style={{ width: `${element.score}%` }} /></div><div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{element.category}{element.missingInCandidate ? " · missing" : ""}</div></div>)}</div></section>
        <AdvisoryEvidence comparison={advisory} reference={runs[referenceIndex]?.label ?? "Reference"} candidate={runs[selectedCandidateIndex]?.label ?? "Candidate"} />
        <p className="flex items-start gap-2 text-[10px] leading-5 text-muted-foreground"><ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />No score is reserved for failed or incomplete runs, truncated time-series windows, incompatible report grids, and incompatible paired units. Individual missing metrics and continuity values are listed as skipped evidence; candidate-only records are reported but do not change the reference-defined score.</p>
      </CardContent>
    </Card>
  );
}