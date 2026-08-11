import JSZip from "jszip";
import type { ProcessResult } from "@/components/ResultsDisplay";
import { buildManifestCsv, classifyRun, healthScore, type ManifestRow } from "@/lib/rptQa";

/** True when a result's full text lives server-side and must be fetched. */
export const needsContentFetch = (r: ProcessResult) =>
  !r.reportContent && !r.inpContent && !!(r.hasReport || r.hasInp);

/**
 * Build the "Download ZIP" archive: one .rpt and/or .inp entry per result,
 * with duplicate file names de-duplicated (`name-2.rpt`, `name-3.rpt`, ...).
 * When any result's content is deferred server-side, `loadAll` is invoked
 * first to fetch the full text for every result.
 */
export async function buildResultsZip(
  results: ProcessResult[],
  loadAll?: () => Promise<ProcessResult[]>,
): Promise<{ zip: JSZip; fileCount: number }> {
  const full =
    loadAll && results.some(needsContentFetch) ? await loadAll() : results;

  const zip = new JSZip();
  const usedNames = new Set<string>();
  const uniqueName = (name: string) => {
    let candidate = name;
    let n = 2;
    while (usedNames.has(candidate)) {
      const dot = name.lastIndexOf('.');
      candidate = dot > 0 ? `${name.slice(0, dot)}-${n}${name.slice(dot)}` : `${name}-${n}`;
      n++;
    }
    usedNames.add(candidate);
    return candidate;
  };

  let fileCount = 0;
  const manifestRows: ManifestRow[] = [];
  for (const r of full) {
    const base = r.fileName.replace(/\.inp$/i, '');
    const outputs: string[] = [];
    if (r.reportContent) {
      const name = uniqueName(`${base}.rpt`);
      zip.file(name, r.reportContent);
      outputs.push(name);
      fileCount++;
    }
    if (r.inpContent) {
      const name = uniqueName(`${base}.inp`);
      zip.file(name, r.inpContent);
      outputs.push(name);
      fileCount++;
    }
    const input = {
      status: r.status,
      runoffCE: r.parsedMetrics?.runoffContinuityError,
      routingCE: r.parsedMetrics?.routingContinuityError,
      nodesFlooded: r.parsedMetrics?.nodesFlooded,
      warningCount: r.parsedMetrics?.reportWarnings?.length ?? 0,
      errorCount: r.parsedMetrics?.reportErrors?.length ?? 0,
    };
    manifestRows.push({
      fileName: r.fileName,
      status: r.status,
      engine: r.provenance?.actualEngine || r.provenance?.requestedEngine,
      engineVersion: r.provenance?.engineVersion,
      startedAt: r.provenance?.startedAt,
      completedAt: r.provenance?.completedAt,
      processingTime: r.processingTime,
      runoffCE: input.runoffCE,
      routingCE: input.routingCE,
      nodesFlooded: input.nodesFlooded,
      warningCount: input.warningCount,
      errorCount: input.errorCount,
      qaClass: classifyRun(input),
      health: healthScore(input).score,
      outputs,
    });
  }
  // Reproducibility manifest: which engine ran what, when, with what outcome.
  // Not counted in fileCount, which tracks result documents only.
  if (full.length > 0) {
    zip.file('batch_manifest.csv', buildManifestCsv(manifestRows, new Date().toISOString()));
  }
  return { zip, fileCount };
}
