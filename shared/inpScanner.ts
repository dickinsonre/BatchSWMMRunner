/**
 * Static preflight scanner for SWMM .inp files.
 *
 * Runs before a batch is started so broken models are caught up-front instead
 * of wasting a run. Plain TypeScript with no browser/node dependencies so it
 * can be unit-tested and used from either client or server.
 *
 * Checks performed:
 *  - duplicate object IDs (within each object class: nodes, links, subcatchments, ...)
 *  - links/subcatchments referencing nodes that don't exist
 *  - zero or negative conduit lengths
 *  - adverse (negative) conduit slopes, using node inverts + offsets
 *  - references to time series / patterns / rain gages / curves that are not defined
 *  - rain gages or [FILES] entries that depend on external files (can't be bundled)
 *  - disconnected nodes (not attached to any link, no inflow role)
 */

export type PreflightSeverity = 'error' | 'warning';

export interface PreflightIssue {
  severity: PreflightSeverity;
  /** Stable machine-readable code, e.g. DUPLICATE_ID, MISSING_NODE. */
  code: string;
  /** Human-readable message including the offending object ID(s). */
  message: string;
}

export type PreflightStatus = 'ready' | 'warning' | 'invalid';

export interface PreflightResult {
  status: PreflightStatus;
  issues: PreflightIssue[];
  /** Counts for quick display. */
  errorCount: number;
  warningCount: number;
}

interface Row {
  tokens: string[];
}

/** Parse the .inp into sections -> rows of whitespace-separated tokens. */
function parseSections(content: string): Map<string, Row[]> {
  const sections = new Map<string, Row[]>();
  let current: Row[] | null = null;
  for (const rawLine of content.split(/\r?\n/)) {
    // Strip comments (';' starts a comment)
    const line = rawLine.replace(/;.*$/, '').trim();
    if (!line) continue;
    const header = line.match(/^\[([^\]]+)\]/);
    if (header) {
      const name = header[1].trim().toUpperCase();
      current = sections.get(name) ?? [];
      sections.set(name, current);
      continue;
    }
    if (current) current.push({ tokens: line.split(/\s+/) });
  }
  return sections;
}

const NODE_SECTIONS = ['JUNCTIONS', 'OUTFALLS', 'STORAGE', 'DIVIDERS'];
const LINK_SECTIONS = ['CONDUITS', 'PUMPS', 'ORIFICES', 'WEIRS', 'OUTLETS'];

function num(s: string | undefined): number | null {
  if (s === undefined) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

export function scanInpContent(content: string): PreflightResult {
  const issues: PreflightIssue[] = [];
  const sections = parseSections(content);

  const err = (code: string, message: string) =>
    issues.push({ severity: 'error', code, message });
  const warn = (code: string, message: string) =>
    issues.push({ severity: 'warning', code, message });

  if (sections.size === 0) {
    err('NOT_INP', 'File does not contain any [SECTION] headers — not a SWMM input file.');
    return finalize(issues);
  }

  // ---- Collect IDs per class, flag duplicates -------------------------------
  const collectIds = (sectionNames: string[], className: string): Map<string, Row[]> => {
    const ids = new Map<string, Row[]>();
    const seen = new Map<string, number>();
    for (const sec of sectionNames) {
      for (const row of sections.get(sec) ?? []) {
        const id = row.tokens[0];
        if (!id) continue;
        seen.set(id, (seen.get(id) ?? 0) + 1);
        const list = ids.get(id) ?? [];
        list.push(row);
        ids.set(id, list);
      }
    }
    for (const [id, count] of Array.from(seen.entries())) {
      if (count > 1) {
        err('DUPLICATE_ID', `Duplicate ${className} ID "${id}" (defined ${count} times).`);
      }
    }
    return ids;
  };

  const nodes = collectIds(NODE_SECTIONS, 'node');
  const links = collectIds(LINK_SECTIONS, 'link');
  collectIds(['SUBCATCHMENTS'], 'subcatchment');

  // Node invert elevations (junctions/outfalls/storage/dividers: token[1])
  const nodeInvert = new Map<string, number>();
  for (const sec of NODE_SECTIONS) {
    for (const row of sections.get(sec) ?? []) {
      const el = num(row.tokens[1]);
      if (row.tokens[0] && el !== null) nodeInvert.set(row.tokens[0], el);
    }
  }

  // ---- Link node references, conduit lengths and slopes ---------------------
  const linkedNodes = new Set<string>();
  for (const sec of LINK_SECTIONS) {
    for (const row of sections.get(sec) ?? []) {
      const [id, from, to] = row.tokens;
      if (!id) continue;
      for (const n of [from, to]) {
        if (!n) continue;
        linkedNodes.add(n);
        if (!nodes.has(n)) {
          err('MISSING_NODE', `Link "${id}" references node "${n}" which is not defined.`);
        }
      }
      if (sec === 'CONDUITS') {
        // CONDUITS: Name FromNode ToNode Length Roughness InOffset OutOffset ...
        const length = num(row.tokens[3]);
        if (length !== null && length <= 0) {
          err('BAD_LENGTH', `Conduit "${id}" has zero or negative length (${length}).`);
        }
        const inOff = num(row.tokens[5]) ?? 0;
        const outOff = num(row.tokens[6]) ?? 0;
        const upEl = from ? nodeInvert.get(from) : undefined;
        const dnEl = to ? nodeInvert.get(to) : undefined;
        if (
          length !== null && length > 0 &&
          upEl !== undefined && dnEl !== undefined
        ) {
          const drop = (upEl + inOff) - (dnEl + outOff);
          if (drop < 0) {
            warn('ADVERSE_SLOPE', `Conduit "${id}" has an adverse slope (upstream invert below downstream by ${Math.abs(drop).toFixed(3)}).`);
          }
        }
      }
    }
  }

  // ---- Subcatchment references ----------------------------------------------
  const gages = new Set((sections.get('RAINGAGES') ?? []).map(r => r.tokens[0]));
  const subcatchIds = new Set((sections.get('SUBCATCHMENTS') ?? []).map(r => r.tokens[0]));
  for (const row of sections.get('SUBCATCHMENTS') ?? []) {
    // SUBCATCHMENTS: Name RainGage Outlet Area ...
    const [id, gage, outlet] = row.tokens;
    if (!id) continue;
    if (gage && !gages.has(gage)) {
      err('MISSING_GAGE', `Subcatchment "${id}" references rain gage "${gage}" which is not defined.`);
    }
    if (outlet && outlet !== '*' && !nodes.has(outlet) && !subcatchIds.has(outlet)) {
      err('MISSING_OUTLET', `Subcatchment "${id}" outlet "${outlet}" is not a defined node or subcatchment.`);
    }
  }

  // ---- Named resource references (time series, curves, patterns) ------------
  const timeseries = new Set((sections.get('TIMESERIES') ?? []).map(r => r.tokens[0]));
  const curves = new Set((sections.get('CURVES') ?? []).map(r => r.tokens[0]));
  const patterns = new Set((sections.get('PATTERNS') ?? []).map(r => r.tokens[0]));

  // Rain gages: Name Format Interval SCF (TIMESERIES TseriesName | FILE "fname" ...)
  for (const row of sections.get('RAINGAGES') ?? []) {
    const id = row.tokens[0];
    const srcIdx = row.tokens.findIndex(t => /^(TIMESERIES|FILE)$/i.test(t));
    if (srcIdx === -1) continue;
    const kind = row.tokens[srcIdx].toUpperCase();
    const ref = row.tokens[srcIdx + 1]?.replace(/^"|"$/g, '');
    if (kind === 'TIMESERIES') {
      if (ref && !timeseries.has(ref)) {
        err('MISSING_TIMESERIES', `Rain gage "${id}" references time series "${ref}" which is not defined.`);
      }
    } else if (kind === 'FILE') {
      warn('EXTERNAL_FILE', `Rain gage "${id}" reads external rainfall file "${ref ?? '?'}" — external files are not uploaded with the model.`);
    }
  }

  // TIMESERIES rows that use FILE
  for (const row of sections.get('TIMESERIES') ?? []) {
    if (row.tokens[1] && /^FILE$/i.test(row.tokens[1])) {
      const fname = row.tokens[2]?.replace(/^"|"$/g, '');
      warn('EXTERNAL_FILE', `Time series "${row.tokens[0]}" reads external file "${fname ?? '?'}" — external files are not uploaded with the model.`);
    }
  }

  // [FILES] section: USE/SAVE <type> "fname" — USE entries need external inputs
  for (const row of sections.get('FILES') ?? []) {
    if (/^USE$/i.test(row.tokens[0] ?? '')) {
      const fname = row.tokens.slice(2).join(' ').replace(/^"|"$/g, '');
      warn('EXTERNAL_FILE', `[FILES] uses external ${row.tokens[1] ?? 'interface'} file "${fname}" — external files are not uploaded with the model.`);
    }
  }

  // [INFLOWS]: Node Constituent TimeSeries ...
  for (const row of sections.get('INFLOWS') ?? []) {
    const [node, , tseries] = row.tokens;
    if (node && !nodes.has(node)) {
      err('MISSING_NODE', `Inflow references node "${node}" which is not defined.`);
    }
    if (tseries && tseries !== '""' && tseries !== '*' && !timeseries.has(tseries)) {
      err('MISSING_TIMESERIES', `Inflow at node "${node}" references time series "${tseries}" which is not defined.`);
    }
  }

  // [DWF]: Node Constituent Baseline Patterns...
  for (const row of sections.get('DWF') ?? []) {
    const node = row.tokens[0];
    if (node && !nodes.has(node)) {
      err('MISSING_NODE', `Dry-weather flow references node "${node}" which is not defined.`);
    }
    for (const p of row.tokens.slice(3)) {
      const name = p.replace(/^"|"$/g, '');
      if (name && !patterns.has(name)) {
        err('MISSING_PATTERN', `DWF at node "${node}" references pattern "${name}" which is not defined.`);
      }
    }
  }

  // [XSECTIONS] with IRREGULAR shape reference transect curves; PUMPS reference pump curves
  for (const row of sections.get('PUMPS') ?? []) {
    // PUMPS: Name FromNode ToNode PumpCurve ...
    const curve = row.tokens[3];
    if (curve && curve !== '*' && !curves.has(curve)) {
      err('MISSING_CURVE', `Pump "${row.tokens[0]}" references curve "${curve}" which is not defined.`);
    }
  }
  for (const row of sections.get('STORAGE') ?? []) {
    // STORAGE: Name Elev MaxDepth InitDepth Shape [CurveName ...]
    if (/^TABULAR$/i.test(row.tokens[4] ?? '')) {
      const curve = row.tokens[5];
      if (curve && !curves.has(curve)) {
        err('MISSING_CURVE', `Storage node "${row.tokens[0]}" references curve "${curve}" which is not defined.`);
      }
    }
  }

  // ---- Disconnected nodes -----------------------------------------------------
  const outletNodes = new Set(
    (sections.get('SUBCATCHMENTS') ?? []).map(r => r.tokens[2]).filter(Boolean),
  );
  for (const id of Array.from(nodes.keys())) {
    if (!linkedNodes.has(id) && !outletNodes.has(id)) {
      warn('DISCONNECTED_NODE', `Node "${id}" is not connected to any link or subcatchment outlet.`);
    }
  }

  // A model with no nodes and no subcatchments can't do anything useful
  if (nodes.size === 0 && subcatchIds.size === 0) {
    err('EMPTY_MODEL', 'Model defines no nodes and no subcatchments.');
  }

  return finalize(issues);
}

function finalize(issues: PreflightIssue[]): PreflightResult {
  const errorCount = issues.filter(i => i.severity === 'error').length;
  const warningCount = issues.length - errorCount;
  const status: PreflightStatus =
    errorCount > 0 ? 'invalid' : warningCount > 0 ? 'warning' : 'ready';
  return { status, issues, errorCount, warningCount };
}
