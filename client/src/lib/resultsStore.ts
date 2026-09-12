import type { ProcessResult } from "@/components/ResultsDisplay";

/**
 * A completed run retained for the lifetime of this browser tab.
 *
 * This intentionally keeps the original ProcessResult objects.  Browser
 * results can have native SWMM artifacts attached in a WeakMap, so copying
 * or serializing a result here would make the paired native export
 * unavailable after navigating to another page.
 */
export interface RetainedRun {
  /** Stable identity for this run, unique even when engines reuse result IDs. */
  key: string;
  engine: string;
  label: string;
  /** Server batch id, or null for an in-browser run. */
  jobId: string | null;
  results: ProcessResult[];
  elapsedTime?: string;
  completedAt?: string;
}

export interface RetainedRunInput {
  key?: string;
  engine: string;
  label?: string;
  jobId?: string | null;
  results: ProcessResult[];
  elapsedTime?: string;
  completedAt?: string;
}

type StoreListener = () => void;

let retainedRuns: RetainedRun[] = [];
let runSequence = 0;
let dashboardResults: ProcessResult[] = [];
let dashboardElapsedTime: string | undefined;
let dashboardWasSet = false;
const listeners = new Set<StoreListener>();

function notify() {
  listeners.forEach(listener => listener());
}

function generatedRunKey(run: RetainedRunInput): string {
  runSequence += 1;
  const engine = run.engine || "unknown";
  // Server IDs are globally unique and make reload/fallback hydration
  // idempotent. Browser runs need a per-tab sequence because file result IDs
  // are deliberately reused when the same files are sent to two engines.
  return run.jobId ? `server:${run.jobId}` : `browser:${engine}:${runSequence}`;
}

function mergeResultReferences(
  previous: ProcessResult[],
  incoming: ProcessResult[],
): ProcessResult[] {
  const byId = new Map<string, ProcessResult>();
  for (const result of previous) byId.set(result.id, result);

  return incoming.map(next => {
    const existing = byId.get(next.id);
    if (!existing) return next;

    // Preserve the object identity and any already loaded large content.
    // Object.assign is intentionally limited to defined artifact fields so a
    // light server summary cannot erase a lazily fetched report.
    const reportContent = existing.reportContent ?? next.reportContent;
    const inpContent = existing.inpContent ?? next.inpContent;
    const previousHasReport = existing.hasReport;
    const previousHasInp = existing.hasInp;
    for (const [key, value] of Object.entries(next)) {
      if (value !== undefined) (existing as any)[key] = value;
    }
    if (reportContent !== undefined) existing.reportContent = reportContent;
    if (inpContent !== undefined) existing.inpContent = inpContent;
    if (existing.hasReport === undefined && previousHasReport !== undefined) existing.hasReport = previousHasReport;
    if (existing.hasInp === undefined && previousHasInp !== undefined) existing.hasInp = previousHasInp;
    return existing;
  });
}

/**
 * Publish a completed browser or server run. Re-publishing the same server
 * job merges its summaries instead of replacing loaded artifact references.
 */
export function publishRetainedRun(input: RetainedRunInput): RetainedRun {
  const key = input.key || generatedRunKey(input);
  const index = retainedRuns.findIndex(run => run.key === key);
  const existing = index >= 0 ? retainedRuns[index] : undefined;
  const run: RetainedRun = existing
    ? {
        ...existing,
        key,
        engine: input.engine || existing.engine,
        label: input.label || existing.label || input.engine,
        jobId: input.jobId ?? existing.jobId ?? null,
        results: mergeResultReferences(existing.results, input.results),
        elapsedTime: input.elapsedTime ?? existing.elapsedTime,
        completedAt: input.completedAt ?? existing.completedAt,
      }
    : {
        key,
        engine: input.engine,
        label: input.label || input.engine,
        jobId: input.jobId ?? null,
        results: input.results,
        elapsedTime: input.elapsedTime,
        completedAt: input.completedAt,
      };

  if (index >= 0) {
    retainedRuns = retainedRuns.map((current, i) => i === index ? run : current);
  } else {
    retainedRuns = [...retainedRuns, run];
  }
  notify();
  return run;
}

/**
 * Merge content loaded through the ownership-checked result endpoint while
 * retaining the original ProcessResult object (and therefore its WeakMap
 * native artifacts).
 */
export function mergeRetainedResultContent(
  runKey: string,
  resultId: string,
  content: { reportContent?: string; inpContent?: string },
): ProcessResult | undefined {
  const run = retainedRuns.find(item => item.key === runKey);
  const result = run?.results.find(item => item.id === resultId);
  if (!result) return undefined;
  if (content.reportContent !== undefined) result.reportContent = content.reportContent;
  if (content.inpContent !== undefined) result.inpContent = content.inpContent;
  // Replace only the run array, not the result object. This gives React
  // subscribers a change notification without breaking WeakMap identity.
  if (run) retainedRuns = retainedRuns.map(item => item.key === runKey ? { ...item } : item);
  notify();
  return result;
}

export function removeRetainedRun(key: string): void {
  const next = retainedRuns.filter(run => run.key !== key);
  if (next.length === retainedRuns.length) return;
  retainedRuns = next;
  notify();
}

export function getRetainedRuns(): RetainedRun[] {
  return [...retainedRuns];
}

export function subscribeRetainedRuns(listener: StoreListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Useful for tests and for explicitly starting a fresh browser session. */
export function clearRetainedRuns(): void {
  retainedRuns = [];
  dashboardResults = [];
  dashboardElapsedTime = undefined;
  dashboardWasSet = false;
  runSequence = 0;
  notify();
}

export function setDashboardResults(results: ProcessResult[], elapsedTime?: string) {
  dashboardResults = results;
  dashboardElapsedTime = elapsedTime;
  dashboardWasSet = true;
}

export function getDashboardResults(): { results: ProcessResult[]; elapsedTime?: string } {
  if (dashboardWasSet) {
    return { results: dashboardResults, elapsedTime: dashboardElapsedTime };
  }
  // Keep the dashboard useful when Home publishes a completed run but the
  // user never clicked its explicit dashboard button.
  const latest = retainedRuns[retainedRuns.length - 1];
  return latest
    ? { results: latest.results, elapsedTime: latest.elapsedTime }
    : { results: [], elapsedTime: undefined };
}

export function hasDashboardResults(): boolean {
  return dashboardWasSet ? dashboardResults.length > 0 : retainedRuns.length > 0;
}
