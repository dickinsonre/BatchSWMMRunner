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
