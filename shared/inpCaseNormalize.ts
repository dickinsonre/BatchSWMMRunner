// Classic SWMM5 looks up object names case-insensitively (its hash table
// upper-cases keys), but the SWMM6 (OpenSWMM 6) engine is case-strict: an
// outfall referencing "BOUNDARY@1020" fails with ERROR 209 when the time
// series is defined as "Boundary@1020". To keep SWMM5-authored models running
// under SWMM6, rewrite case-variant *references* to time series, curves, and
// patterns so they match the spelling used at the definition.
//
// Deliberately narrow by design:
// - Names are kept in per-type namespaces (a node `Foo` and a curve `foo` can
//   coexist; we never mix them).
// - Only documented reference columns of specific sections are rewritten —
//   never definitions, file paths, expressions, or arbitrary tokens.
// - Case-only rewrites keep token length identical, preserving alignment.

export interface CaseNormalizeResult {
  content: string;
  /** Human-readable descriptions of the rewrites performed (empty = untouched). */
  fixes: string[];
}

type NameKind = 'timeseries' | 'curve' | 'pattern';

function sectionName(line: string): string | null {
  const m = line.match(/^\s*\[([^\]]+)\]/);
  return m ? m[1].trim().toUpperCase() : null;
}

/** Split the code part of a line into tokens with their start offsets. */
function tokenize(code: string): { tok: string; start: number }[] {
  const out: { tok: string; start: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) out.push({ tok: m[0], start: m.index });
  return out;
}

/**
 * Given a data line's tokens, return the indices of tokens that reference a
 * time series / curve / pattern in this section, per the SWMM5 input format.
 * Returns [] when the line references none (or uses FILE input, etc.).
 */
function referenceColumns(section: string, toks: string[]): { idx: number; kind: NameKind }[] {
  const up = (i: number) => (toks[i] ?? '').toUpperCase();
  switch (section) {
    case 'RAINGAGES':
      // Name Form Intrvl SCF TIMESERIES Tseries | FILE Fname ...
      return up(4) === 'TIMESERIES' && toks.length > 5 ? [{ idx: 5, kind: 'timeseries' }] : [];
    case 'OUTFALLS':
      // Name Elev TIMESERIES Tseries Gated... | Name Elev TIDAL Tcurve Gated...
      if (up(2) === 'TIMESERIES' && toks.length > 3) return [{ idx: 3, kind: 'timeseries' }];
      if (up(2) === 'TIDAL' && toks.length > 3) return [{ idx: 3, kind: 'curve' }];
      return [];
    case 'INFLOWS': {
      // Node Constituent Tseries (Type Mfactor Sfactor Baseline Pattern)
      const refs: { idx: number; kind: NameKind }[] = [];
      if (toks.length > 2 && toks[2] !== '""') refs.push({ idx: 2, kind: 'timeseries' });
      if (toks.length > 7 && toks[7] !== '""') refs.push({ idx: 7, kind: 'pattern' });
      return refs;
    }
    case 'DWF': {
      // Node Type Base (Pat1 Pat2 Pat3 Pat4)
      const refs: { idx: number; kind: NameKind }[] = [];
      for (let i = 3; i <= 6 && i < toks.length; i++) {
        if (toks[i] !== '""') refs.push({ idx: i, kind: 'pattern' });
      }
      return refs;
    }
    case 'STORAGE':
      // Name Elev Ymax Y0 TABULAR Acurve ...
      return up(4) === 'TABULAR' && toks.length > 5 ? [{ idx: 5, kind: 'curve' }] : [];
    case 'PUMPS':
      // Name Node1 Node2 Pcurve ...  (* = ideal pump, not a reference)
      return toks.length > 3 && toks[3] !== '*' ? [{ idx: 3, kind: 'curve' }] : [];
    case 'OUTLETS': {
      // Name Node1 Node2 Offset TABULAR/DEPTH|TABULAR/HEAD Qcurve ...
      const type = up(4);
      return type.startsWith('TABULAR') && toks.length > 5 ? [{ idx: 5, kind: 'curve' }] : [];
    }
    case 'XSECTIONS':
      // Link CUSTOM Geom1 Curve ...  (IRREGULAR references a transect, not handled)
      return up(1) === 'CUSTOM' && toks.length > 3 ? [{ idx: 3, kind: 'curve' }] : [];
    case 'EVAPORATION':
      // TIMESERIES Tseries
      return up(0) === 'TIMESERIES' && toks.length > 1 ? [{ idx: 1, kind: 'timeseries' }] : [];
    default:
      return [];
  }
}

const DEFINING: Record<string, NameKind> = {
  TIMESERIES: 'timeseries',
  CURVES: 'curve',
  PATTERNS: 'pattern',
};

/**
 * Rewrite case-variant time-series / curve / pattern references to the
 * defining spelling. Returns the (possibly unchanged) content plus fixes.
 */
export function normalizeInpNameCase(content: string): CaseNormalizeResult {
  const lines = content.split(/\r?\n/);

  // Pass 1: canonical spelling per type (first definition line wins).
  const canonical: Record<NameKind, Map<string, string>> = {
    timeseries: new Map(),
    curve: new Map(),
    pattern: new Map(),
  };
  let section: string | null = null;
  for (const raw of lines) {
    const sec = sectionName(raw);
    if (sec) { section = sec; continue; }
    const kind = section ? DEFINING[section] : undefined;
    if (!kind) continue;
    const code = raw.split(';')[0];
    const name = code.trim().split(/\s+/)[0];
    if (!name) continue;
    const key = name.toUpperCase();
    if (!canonical[kind].has(key)) canonical[kind].set(key, name);
  }
  if (canonical.timeseries.size === 0 && canonical.curve.size === 0 && canonical.pattern.size === 0) {
    return { content, fixes: [] };
  }

  // Pass 2: rewrite only known reference columns (and re-unify definition IDs
  // within their own defining section, which is same-type and safe).
  const fixCounts = new Map<string, number>();
  section = null;
  const rewriteTok = (tok: string, kind: NameKind): string => {
    const canon = canonical[kind].get(tok.toUpperCase());
    if (canon === undefined || canon === tok) return tok;
    const key = `${tok} -> ${canon}`;
    fixCounts.set(key, (fixCounts.get(key) ?? 0) + 1);
    return canon;
  };
  const outLines = lines.map((raw) => {
    const sec = sectionName(raw);
    if (sec) { section = sec; return raw; }
    if (!section) return raw;
    const commentIdx = raw.indexOf(';');
    const code = commentIdx >= 0 ? raw.slice(0, commentIdx) : raw;
    if (!code.trim()) return raw;
    const toks = tokenize(code);
    const edits: { start: number; from: string; to: string }[] = [];
    const definingKind = DEFINING[section];
    if (definingKind) {
      // Normalize the defining ID column so multi-line definitions with mixed
      // case collapse onto one spelling (same namespace — cannot collide).
      const t = toks[0];
      if (t) {
        const to = rewriteTok(t.tok, definingKind);
        if (to !== t.tok) edits.push({ start: t.start, from: t.tok, to });
      }
    } else {
      for (const ref of referenceColumns(section, toks.map((t) => t.tok))) {
        const t = toks[ref.idx];
        const to = rewriteTok(t.tok, ref.kind);
        if (to !== t.tok) edits.push({ start: t.start, from: t.tok, to });
      }
    }
    if (edits.length === 0) return raw;
    let newCode = code;
    for (const e of edits) {
      // Case-only change: identical length, safe positional splice.
      newCode = newCode.slice(0, e.start) + e.to + newCode.slice(e.start + e.from.length);
    }
    return commentIdx >= 0 ? newCode + raw.slice(commentIdx) : newCode;
  });

  if (fixCounts.size === 0) return { content, fixes: [] };
  const fixes = Array.from(fixCounts.entries()).map(
    ([pair, n]) => `${pair}${n > 1 ? ` (${n} places)` : ''}`,
  );
  return { content: outLines.join('\n'), fixes };
}
