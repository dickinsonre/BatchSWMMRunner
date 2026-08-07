import JSZip from "jszip";
import type { ProcessResult } from "@/components/ResultsDisplay";

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
  for (const r of full) {
    const base = r.fileName.replace(/\.inp$/i, '');
    if (r.reportContent) {
      zip.file(uniqueName(`${base}.rpt`), r.reportContent);
      fileCount++;
    }
    if (r.inpContent) {
      zip.file(uniqueName(`${base}.inp`), r.inpContent);
      fileCount++;
    }
  }
  return { zip, fileCount };
}
