import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileText, Loader2, Play, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import AppHeader from "@/components/AppHeader";
import CoherenceDiagnostic from "@/components/CoherenceDiagnostic";
import { checkDiagnosticPairing } from "@/lib/coherenceDiagnostic";
import { ensureReportAll } from "@/lib/qaqcReport";
import {
  getRetainedRuns,
  mergeRetainedResultContent,
  publishRetainedRun,
  subscribeRetainedRuns,
  type RetainedRun,
} from "@/lib/resultsStore";
import { runWasmBatch } from "@/lib/swmmWasmEngine";
import { downloadPairedEngineZip, pairedExportAvailability } from "@/lib/pairedEngineExport";
import type { ProcessResult } from "@shared/schema";

type RunPhase = "idle" | "swmm5" | "swmm6" | "done" | "error";

type EngineFamily = "swmm5" | "swmm6" | "unknown";

interface StoredOption {
  identity: string;
  run: RetainedRun;
  result: ProcessResult;
  family: EngineFamily;
  order: number;
}

function label(result: ProcessResult, run?: RetainedRun): string {
  const provenance = result.provenance;
  return `${result.fileName} — ${run?.label || provenance?.actualEngine || provenance?.requestedEngine || "engine unknown"}`;
}

function engineText(result: ProcessResult): string {
  const provenance = result.provenance;
  // Native results can be labelled only "executable"; their report header is
  // the authoritative engine role in that case.
  return `${provenance?.actualEngine || ""} ${provenance?.requestedEngine || ""} ${provenance?.engineVersion || ""} ${result.reportContent?.slice(0, 500) || ""}`.toLowerCase();
}

function engineFamily(result: ProcessResult, run?: RetainedRun): EngineFamily {
  const text = `${run?.engine || ""} ${run?.label || ""} ${engineText(result)}`.toLowerCase();
  if (/\bswmm6\b|\bwasm6(?:dev)?\b|openswmm/.test(text)) return "swmm6";
  if (
    /\bswmm5\b|\bwasm\b|epa storm water|executable|swmm5 api|(^|[\s_-])api([\s_-]|$)/.test(text)
    && !/\bswmm6\b|\bwasm6\b|openswmm/.test(text)
  ) return "swmm5";
  return "unknown";
}

function engineFamilyLabel(family: EngineFamily): string {
  return family === "swmm5" ? "SWMM5" : family === "swmm6" ? "SWMM6" : "Unknown engine";
}

function engineDisplayLabel(engine: string): string {
  const labels: Record<string, string> = {
    executable: "Executable",
    api: "SWMM5 API",
    wasm: "SWMM5 WASM",
    wasm6: "SWMM6 WASM",
    wasm6dev: "SWMM6 WASM (develop)",
    hydra: "Hydra WASM",
  };
  return labels[engine] || engine || "Unknown server engine";
}

/**
 * A small orchestration shell only. The screening table, map, inspector,
 * settings, CSV, and comparison are the exact CoherenceDiagnostic view used
 * by QA/QC; this route deliberately contains no competing calculations.
 */
export default function CoherencePage() {
  const [retainedRuns, setRetainedRuns] = useState<RetainedRun[]>(() => getRetainedRuns());
  const [fallbackLoading, setFallbackLoading] = useState(true);
  const [fallbackError, setFallbackError] = useState("");
  const [contentLoading, setContentLoading] = useState<Set<string>>(new Set());
  const [contentErrors, setContentErrors] = useState<Record<string, string>>({});
  const [baselineId, setBaselineId] = useState("");
  const [rerunId, setRerunId] = useState("");
  const [uploaded, setUploaded] = useState<{ name: string; text: string } | null>(null);
  const [generated, setGenerated] = useState<{ baseline: ProcessResult; rerun: ProcessResult } | null>(null);
  const [phase, setPhase] = useState<RunPhase>("idle");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState("");
  const [exportError, setExportError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const runIdRef = useRef(0);

  useEffect(() => subscribeRetainedRuns(() => setRetainedRuns(getRetainedRuns())), []);

  // A browser reload has no in-memory run store. The endpoint returns only
  // light summaries, so artifacts remain lazy and ownership-checked.
  useEffect(() => {
    let cancelled = false;
    // A retained browser/comparison run is the user's current in-tab result.
    // Do not replace it with an older server job merely because the latest
    // fallback endpoint is available.
    if (getRetainedRuns().length > 0) {
      setFallbackLoading(false);
      return () => { cancelled = true; };
    }
    setFallbackLoading(true);
    setFallbackError("");
    fetch("/api/jobs/latest")
      .then(async response => {
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`Latest completed batch unavailable (${response.status})`);
        return response.json();
      })
      .then(job => {
        if (cancelled || !job) return;
        const jobId = typeof job.id === "string" ? job.id : "";
        if (!jobId || !Array.isArray(job.results)) return;
        publishRetainedRun({
          key: `server:${jobId}`,
          engine: typeof job.engineMode === "string" ? job.engineMode : "unknown",
          label: engineDisplayLabel(typeof job.engineMode === "string" ? job.engineMode : "unknown"),
          jobId,
          results: job.results as ProcessResult[],
          completedAt: typeof job.createdAt === "string" ? job.createdAt : undefined,
        });
      })
      .catch(reason => {
        if (!cancelled) setFallbackError(reason instanceof Error ? reason.message : "Could not load the latest completed batch.");
      })
      .finally(() => {
        if (!cancelled) setFallbackLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => {
    runIdRef.current++;
    cancelRef.current?.();
    cancelRef.current = null;
  }, []);

  const cancel = () => {
    runIdRef.current++;
    cancelRef.current?.();
    cancelRef.current = null;
    setPhase("idle");
    setProgress("");
    setExportProgress("");
  };

  const storedOptions = useMemo<StoredOption[]>(() => {
    const occurrences = new Map<string, number>();
    let order = 0;
    const options = retainedRuns.flatMap(run => run.results
      .filter(result => result.status === "success" && (
        !!result.reportContent || !!result.inpContent || !!result.hasReport || !!result.hasInp
      ))
      .map(result => {
        const base = `${run.key}:${result.id}`;
        const occurrence = occurrences.get(base) || 0;
        occurrences.set(base, occurrence + 1);
        const identity = occurrence === 0 ? base : `${base}:${occurrence}`;
        return { identity, run, result, family: engineFamily(result, run), order: order++ };
      }));
    const completedTime = (option: StoredOption) => {
      const value = option.result.provenance?.completedAt || option.run.completedAt;
      const time = value ? Date.parse(value) : NaN;
      return Number.isFinite(time) ? time : 0;
    };
    return options.sort((left, right) => completedTime(right) - completedTime(left) || right.order - left.order);
  }, [retainedRuns]);
  const unknownStored = useMemo(() => storedOptions.filter(option => option.family === "unknown"), [storedOptions]);
  // Either engine may be inspected on its own. The second picker is
  // deliberately manual: it must never silently pair the newest SWMM5 file
  // with an unrelated SWMM6 file from an older batch.
  const baselineOptions = storedOptions;
  const rerunOptions = storedOptions;
  const baselineOption = storedOptions.find(option => option.identity === baselineId);
  const rerunOption = storedOptions.find(option => option.identity === rerunId);
  const selectedBaseline = generated?.baseline || baselineOption?.result;
  const selectedRerun = generated?.rerun || rerunOption?.result;
  const selected = selectedBaseline
    ? { baseline: selectedBaseline, rerun: selectedRerun }
    : null;
  const baselineFamily: EngineFamily = generated ? "swmm5" : baselineOption?.family || "unknown";
  const rerunFamily: EngineFamily = generated ? "swmm6" : rerunOption?.family || "unknown";
  const isEnginePair = !!selected?.rerun && (
    (baselineFamily === "swmm5" && rerunFamily === "swmm6") ||
    (baselineFamily === "swmm6" && rerunFamily === "swmm5")
  );

  // Select the newest completed result once, regardless of engine. This is a
  // single-run default only; no unrelated SWMM5/SWMM6 pair is inferred.
  useEffect(() => {
    if (!generated && !baselineId && storedOptions.length > 0) setBaselineId(storedOptions[0].identity);
  }, [baselineId, generated, storedOptions]);

  useEffect(() => {
    if (baselineId && !baselineOption) setBaselineId("");
    if (rerunId && !rerunOption) setRerunId("");
  }, [baselineId, baselineOption, rerunId, rerunOption]);

  const pairing = useMemo(() => {
    if (!isEnginePair || !selected?.rerun || !selected.baseline.inpContent || !selected.rerun.inpContent) return null;
    return checkDiagnosticPairing(
      selected.baseline.inpContent || "",
      selected.rerun.inpContent || "",
      selected.baseline.reportContent,
      selected.rerun.reportContent,
    );
  }, [isEnginePair, selected]);

  const loadStoredContent = async (option: StoredOption | undefined) => {
    if (!option || !option.run.jobId) return;
    const result = option.result;
    if ((!result.hasReport || result.reportContent) && (!result.hasInp || result.inpContent)) return;
    if (contentLoading.has(option.identity)) return;
    setContentLoading(previous => new Set(previous).add(option.identity));
    setContentErrors(previous => {
      const next = { ...previous };
      delete next[option.identity];
      return next;
    });
    try {
      const response = await fetch(`/api/batch/${encodeURIComponent(option.run.jobId)}/results/${encodeURIComponent(result.id)}/content`);
      if (response.status === 404) {
        throw new Error("This retained result has expired or is no longer available. Rerun the model or upload its .inp file.");
      }
      if (!response.ok) throw new Error(`Could not load the retained result (${response.status}).`);
      const content = await response.json() as { reportContent?: string; inpContent?: string };
      mergeRetainedResultContent(option.run.key, result.id, content);
    } catch (reason) {
      setContentErrors(previous => ({
        ...previous,
        [option.identity]: reason instanceof Error ? reason.message : "Could not load the retained result.",
      }));
    } finally {
      setContentLoading(previous => {
        const next = new Set(previous);
        next.delete(option.identity);
        return next;
      });
    }
  };

  useEffect(() => {
    if (generated) return;
    void loadStoredContent(baselineOption);
    void loadStoredContent(rerunOption);
    // Selection identity is sufficient; content updates notify the store and
    // must not start another request for the same loaded object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baselineId, rerunId, generated]);

  const chooseFile = async (file: File) => {
    cancel();
    const selectionId = runIdRef.current;
    const text = await file.text();
    // A newer selection or an unmounted page must not resurrect this file.
    if (runIdRef.current !== selectionId) return;
    if (!file.name.toLowerCase().endsWith(".inp")) {
      setError("Choose a SWMM .inp file.");
      return;
    }
    setUploaded({ name: file.name, text });
    setGenerated(null);
    setError("");
  };

  const runOne = (engine: "swmm5" | "swmm6", input: string, name: string, runId: number) =>
    new Promise<ProcessResult>((resolve, reject) => {
      const cancelled = { current: false };
      const terminate = runWasmBatch(
        [{ id: `coherence-${engine}-${runId}`, name, file: new File([input], name, { type: "text/plain" }) }],
        {
          onFileStart: () => {},
          onProgress: update => {
            if (runIdRef.current === runId) setProgress(`${engine === "swmm5" ? "SWMM 5" : "SWMM 6"}: ${update.message || `${update.percentage}%`}`);
          },
          onResult: result => {
            if (runIdRef.current !== runId) reject(new Error("cancelled"));
            else if (result.status === "success") resolve(result);
            else reject(new Error(result.error || `${engine} run failed`));
          },
          onLog: () => {},
          onComplete: () => {},
        },
        cancelled,
        engine,
        undefined,
        false,
        undefined,
        undefined,
        { retainArtifacts: true },
      );
      cancelRef.current = () => {
        cancelled.current = true;
        terminate();
        reject(new Error("cancelled"));
      };
    });

  const runBoth = async () => {
    if (!uploaded) return;
    const runId = ++runIdRef.current;
    const input = ensureReportAll(uploaded.text);
    setGenerated(null);
    setError("");
    setExportError("");
    setExportProgress("");
    try {
      setPhase("swmm5");
      const baseline = await runOne("swmm5", input, uploaded.name, runId);
      if (runIdRef.current !== runId) return;
      setPhase("swmm6");
      const rerun = await runOne("swmm6", input, uploaded.name, runId);
      if (runIdRef.current !== runId) return;
      setGenerated({ baseline, rerun });
      setPhase("done");
      cancelRef.current = null;
    } catch (reason) {
      if (runIdRef.current !== runId || (reason as Error).message === "cancelled") return;
      setPhase("error");
      setError((reason as Error).message || "Unable to complete the paired run.");
    }
  };

  const running = phase === "swmm5" || phase === "swmm6";
  const baselineSource = baselineFamily === "swmm6" ? "swmm6" : "swmm5";
  const rerunSource = rerunFamily === "swmm5" ? "swmm5" : "swmm6";
  const swmm5Selection = selected && (
    baselineSource === "swmm5"
      ? selected.baseline
      : isEnginePair && rerunSource === "swmm5" ? selected.rerun : undefined
  );
  const swmm6Selection = selected && (
    baselineSource === "swmm6"
      ? selected.baseline
      : isEnginePair && rerunSource === "swmm6" ? selected.rerun : undefined
  );
  const canShow = !!selected?.baseline?.inpContent && (
    !isEnginePair || (
      !!selected.rerun?.inpContent && (!pairing || pairing.compatible)
    )
  );
  const paired = isEnginePair && selected?.rerun
    ? baselineFamily === "swmm5"
      ? { swmm5: selected.baseline, swmm6: selected.rerun }
      : { swmm5: selected.rerun, swmm6: selected.baseline }
    : null;
  const exportStatus = pairedExportAvailability(paired);

  const exportNativePair = async () => {
    if (!paired || exporting || !exportStatus.ready) return;
    setExporting(true);
    setExportError("");
    setExportProgress("Preparing native files…");
    try {
      await downloadPairedEngineZip(paired, {
        onProgress: update => setExportProgress(update.message),
      });
      setExportProgress("Native ZIP downloaded.");
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : String(reason));
      setExportProgress("");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="container mx-auto max-w-7xl space-y-5 px-4 py-6">
        <div>
          <h2 className="text-xl font-semibold">Coherence diagnostic</h2>
          <p className="text-sm text-muted-foreground">Compare a retained batch baseline/rerun or run one uploaded INP through SWMM 5 and SWMM 6. This is a review-priority screen, not a stability verdict.</p>
        </div>
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm font-medium">Baseline or single-engine result
                <select className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={baselineId} onChange={event => { setGenerated(null); setBaselineId(event.target.value); }}>
                  <option value="">Select a retained result</option>
                  {baselineOptions.map(option => (
                    <option key={`baseline-${option.identity}`} value={option.identity}>
                      {engineFamilyLabel(option.family)} · {label(option.result, option.run)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium">Comparison result (optional)
                <select className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={rerunId} onChange={event => { setGenerated(null); setRerunId(event.target.value); }}>
                  <option value="">Select a retained result</option>
                  {rerunOptions.map(option => (
                    <option key={`rerun-${option.identity}`} value={option.identity}>
                      {engineFamilyLabel(option.family)} · {label(option.result, option.run)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t pt-4">
              <input ref={inputRef} type="file" accept=".inp" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) void chooseFile(file); event.target.value = ""; }} />
              <Button variant="outline" onClick={() => inputRef.current?.click()} data-testid="button-coherence-choose-file"><Upload className="mr-2 h-4 w-4" />Choose .inp</Button>
              {uploaded && <span className="flex items-center gap-1 text-sm"><FileText className="h-4 w-4" />{uploaded.name}</span>}
              <Button disabled={!uploaded || running} onClick={() => void runBoth()} data-testid="button-coherence-run-both">
                {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}{running ? progress || "Running…" : "Run SWMM5 + SWMM6"}
              </Button>
              {running && <Button variant="destructive" onClick={cancel}>Cancel</Button>}
              {paired && !running && (
                <Button
                  variant="outline"
                  onClick={exportNativePair}
                  disabled={exporting || !exportStatus.ready}
                  data-testid="button-download-coherence-native-zip"
                >
                  {exporting
                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    : <Download className="mr-2 h-4 w-4" />}
                  {exporting ? exportProgress || "Preparing ZIP…" : "Download native ZIP"}
                </Button>
              )}
            </div>
            {fallbackLoading && storedOptions.length === 0 && <p className="text-xs text-muted-foreground">Loading retained batch summaries…</p>}
            {fallbackError && <p className="text-sm text-destructive" data-testid="text-coherence-fallback-error">{fallbackError}</p>}
            {!fallbackLoading && storedOptions.length === 0 && !generated && (
              <p className="text-xs text-muted-foreground">
                No completed batch is available in this browser session. Choose a .inp file below to inspect it, or run a batch first.
              </p>
            )}
            {unknownStored.length > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Some retained results have unknown engine provenance and are labelled “Unknown engine”; they remain available instead of being hidden.
              </p>
            )}
            {selected?.baseline && (!selected.rerun || !isEnginePair) && !running && (
              <p className="text-xs text-muted-foreground" data-testid="text-coherence-single-baseline">
                {baselineFamily === "swmm6"
                  ? "Showing the selected SWMM6 result by itself; no SWMM5 report is selected. Select a SWMM5 result above to compare, or choose a .inp file and run both engines."
                  : baselineFamily === "swmm5"
                    ? "Showing the selected SWMM5 result by itself; no SWMM6 report is selected. Select a SWMM6 result above to compare, or choose a .inp file and run both engines."
                    : "Showing the selected result by itself; its engine is unknown, so no SWMM5/SWMM6 counterpart is assumed. Select a counterpart manually or choose a .inp file and run both engines."}
              </p>
            )}
            {[baselineOption, rerunOption].map(option => option && contentLoading.has(option.identity) && (
              <p key={`loading-${option.identity}`} className="text-xs text-muted-foreground" data-testid={`text-coherence-loading-${option.identity}`}>
                Loading retained report/input for {option.result.fileName}…
              </p>
            ))}
            {[baselineOption, rerunOption].map(option => option && contentErrors[option.identity] && (
              <p key={`error-${option.identity}`} className="text-sm text-destructive" data-testid={`text-coherence-content-error-${option.identity}`}>
                {contentErrors[option.identity]}
              </p>
            ))}
            {error && <p className="text-sm text-destructive">{error}</p>}
            {paired && !running && !exportStatus.ready && (
              <p className="text-sm text-muted-foreground" data-testid="text-coherence-native-export-unavailable">
                Native ZIP export unavailable: {exportStatus.message}
              </p>
            )}
            {exportError && <p className="text-sm text-destructive" data-testid="text-coherence-native-export-error">{exportError}</p>}
            {pairing && !pairing.compatible && <p className="text-sm text-destructive">Cannot compare this pair: {pairing.errors.join("; ")}</p>}
            {pairing?.warnings.map(warning => <p key={warning} className="text-xs text-amber-700 dark:text-amber-300">Pairing check: {warning}</p>)}
          </CardContent>
        </Card>
        {canShow && selected && (
          <CoherenceDiagnostic
            inpText={selected.baseline.inpContent || ""}
            swmm5Report={swmm5Selection?.reportContent}
            swmm6Report={swmm6Selection?.reportContent}
            fileName={selected.baseline.fileName}
          />
        )}
      </main>
    </div>
  );
}