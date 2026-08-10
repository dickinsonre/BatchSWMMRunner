// Helpers for the SWMM5-vs-SWMM6 QA/QC comparison report.
// Kept as a plain .ts module (no JSX) so node-side tests can import it.

/** Rewrite the [REPORT] section so every node & link gets time series output. */
export function ensureReportAll(inp: string): string {
  const lines = inp.split(/\r?\n/);
  const out: string[] = [];
  let inReport = false;
  let found = false;
  for (const line of lines) {
    const sec = line.match(/^\s*\[([^\]]+)\]/);
    if (sec) {
      if (inReport) {
        out.push("NODES ALL", "LINKS ALL", "");
      }
      inReport = /^report$/i.test(sec[1].trim());
      if (inReport) found = true;
      out.push(line);
      continue;
    }
    if (inReport && /^\s*(NODES|LINKS)\b/i.test(line)) continue; // replaced with ALL
    out.push(line);
  }
  if (inReport) out.push("NODES ALL", "LINKS ALL");
  if (!found) out.push("", "[REPORT]", "NODES ALL", "LINKS ALL");
  return out.join("\n");
}

/** Convert a "MM/DD/YYYY HH:MM[:SS]" stamp into hours elapsed from t0 (ms epoch). */
export function toHours(stamp: string, t0: number): number {
  const m = stamp.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return NaN;
  const t = Date.UTC(+m[3], +m[1] - 1, +m[2], +m[4], +m[5], +(m[6] || 0));
  return (t - t0) / 3600000;
}

/** Pearson r-squared of paired values. */
export function rSquared(pairs: { x: number; y: number }[]): number | undefined {
  const n = pairs.length;
  if (n < 2) return undefined;
  const mx = pairs.reduce((a, p) => a + p.x, 0) / n;
  const my = pairs.reduce((a, p) => a + p.y, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const p of pairs) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return undefined;
  return (sxy * sxy) / (sxx * syy);
}

export interface PeakDiffRow {
  element: string;
  column: string;
  unit: string;
  kind: 'link' | 'node' | 'other';
  peak5: number;
  peak6: number;
  /** Percent difference relative to SWMM5 (undefined when SWMM5 peak ~ 0). */
  diffPct: number | undefined;
  /** Absolute difference — used for ranking when % is unavailable. */
  absDiff: number;
}

interface SeriesLike {
  title: string;
  element: string;
  columns: string[];
  units: string[];
  data: { time: string; values: number[] }[];
}

function peakAbs(s: SeriesLike, ci: number): number | undefined {
  let best: number | undefined;
  for (const d of s.data) {
    const v = d.values[ci];
    if (v === undefined || !Number.isFinite(v)) continue;
    if (best === undefined || Math.abs(v) > Math.abs(best)) best = v;
  }
  return best;
}

/**
 * Rank every output present in both engines' time series by how much its
 * peak value disagrees. Sorted worst-first so ranked[0] is the output an
 * engineer should look at first.
 */
export function rankPeakDifferences(series5: SeriesLike[], series6: SeriesLike[]): PeakDiffRow[] {
  const by6 = new Map<string, SeriesLike>();
  for (const s of series6) by6.set(bareElementName(s.element), s);
  const rows: PeakDiffRow[] = [];
  for (const s5 of series5) {
    const el = bareElementName(s5.element);
    const s6 = by6.get(el);
    if (!s6) continue;
    const k = seriesKind(s5.title, s5.element);
    const kind: PeakDiffRow['kind'] = k === 'link' || k === 'node' ? k : 'other';
    s5.columns.forEach((col, c5) => {
      const c6 = s6.columns.findIndex(c => c.trim().toLowerCase() === col.trim().toLowerCase());
      if (c6 < 0) return;
      const p5 = peakAbs(s5, c5);
      const p6 = peakAbs(s6, c6);
      if (p5 === undefined || p6 === undefined) return;
      const absDiff = Math.abs(Math.abs(p6) - Math.abs(p5));
      const diffPct = Math.abs(p5) > 1e-6 ? (absDiff / Math.abs(p5)) * 100 : undefined;
      rows.push({ element: el, column: col.trim(), unit: s5.units[c5] || '', kind, peak5: p5, peak6: p6, diffPct, absDiff });
    });
  }
  rows.sort((a, b) => (b.diffPct ?? -1) - (a.diffPct ?? -1) || b.absDiff - a.absDiff);
  return rows;
}

/** Strip a "Node " / "Link " / "Subcatch " type prefix from a series element name. */
export function bareElementName(el: string): string {
  return el.trim().replace(/^(node|link|subcatch\w*)\s+/i, '').trim();
}

/** Classify a series as link/node/system/other using its section title or element prefix. */
export function seriesKind(title: string, element: string): 'link' | 'node' | 'system' | 'other' {
  if (/^link/i.test(title.trim()) || /^link\s+/i.test(element.trim())) return 'link';
  if (/^node/i.test(title.trim()) || /^node\s+/i.test(element.trim())) return 'node';
  if (/system/i.test(title) || /^system$/i.test(element.trim())) return 'system';
  return 'other';
}
