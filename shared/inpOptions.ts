export interface Swmm6Options {
  /** Master flag: write the SWMM6-only [OPTIONS] keywords into the .inp. */
  enabled?: boolean;
  /** SURCHARGE_METHOD DYNAMIC_SLOT (Dynamic Preissmann Slot). */
  dynamicSlot?: boolean;
  /** DPS_CELERITY — target pressure celerity, m/s (engine default 25). */
  dpsCelerity?: number;
  /** DPS_ALPHA — shock parameter, dimensionless >= 2 (engine default 3). */
  dpsAlpha?: number;
  /** DPS_DECAY_TIME — Preissmann Number decay, seconds (engine default 0.5). */
  dpsDecayTime?: number;
  /** NODE_CONTINUITY SEMI_IMPLICIT (Crank–Nicolson depth update). */
  semiImplicit?: boolean;
  /** ANDERSON_ACCEL YES (faster Picard convergence). */
  andersonAccel?: boolean;
  /**
   * Move eligible pipe-break junctions (exactly 2 attached conduits, no
   * inflows/DWF/RDII/treatment) into a [VIRTUAL_JUNCTIONS] section and write
   * VIRTUAL_JUNCTION_MOMENTUM into [OPTIONS]. Structural SWMM6-only edit.
   */
  virtualJunctions?: boolean;
  /** VIRTUAL_JUNCTION_MOMENTUM — BASIC (engine default) or FULL (adds cross-junction convective flux). */
  vjMomentum?: 'BASIC' | 'FULL';
  /** FLOW_ROUTING FV — the OpenSWMM 6 explicit finite-volume routing model. */
  fvRouting?: boolean;
  /** FV_ORDER — spatial reconstruction order, 1 or 2 (engine default 1). */
  fvOrder?: number;
  /** FV_LIMITER — slope limiter keyword (engine default MINMOD). */
  fvLimiter?: string;
  /** FV_TIME_INTEGRATION — time-integration keyword (engine default EULER). */
  fvTimeIntegration?: string;
  /** FV_RIEMANN — Riemann solver keyword, transport only (engine default HLLC). */
  fvRiemann?: string;
  /** FV_CELL_LENGTH — target cell length for the FV mesh, m > 0 (engine default applies when unset). */
  fvCellLength?: number;
  /** FV_MIN_CELLS — minimum cells per conduit, integer >= 1 (engine default applies when unset). */
  fvMinCells?: number;
  /** FV_CFL — CFL number, 0 < CFL <= 1 (engine default applies when unset). */
  fvCfl?: number;
}

export interface InpOverrides {
  reportStepMinutes?: number;
  flowRouting?: string;
  startDate?: string;
  endDate?: string;
  routingStepSeconds?: number;
  /** VARIABLE_STEP — CFL safety factor 0..2; 0 disables variable stepping. */
  variableStep?: number;
  /** LENGTHENING_STEP — conduit lengthening time step in seconds; 0 disables. */
  lengtheningStep?: number;
  /** INERTIAL_DAMPING — handling of the inertial terms in dynamic wave routing. */
  inertialDamping?: 'NONE' | 'PARTIAL' | 'FULL';
  swmm6?: Swmm6Options;
}

/** One solver configuration in a 1-model × N-configurations run matrix. */
export interface MatrixVariant {
  /** Short unique name shown in results and charts, e.g. "RS 5s · VS on". */
  label: string;
  /** Solver overrides applied on top of the batch-wide overrides. */
  overrides: InpOverrides;
}
const ROUTING_MAP: Record<string, string> = {
  steady: 'STEADY',
  kinematic: 'KINWAVE',
  dynamic: 'DYNWAVE',
};

function minutesToHms(minutes: number): string {
  const total = Math.max(0, Math.round(minutes * 60));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function secondsToHms(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function isoToSwmmDate(iso: string): string | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

/**
 * Normalize and bounds-check SWMM6 options. Shared by the browser WASM path
 * and the server /start endpoint so both enforce the same rules.
 * Returns undefined when nothing valid is enabled.
 */
export function normalizeSwmm6Options(raw: unknown): Swmm6Options | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const s6 = raw as Record<string, unknown>;
  if (s6.enabled !== true) return undefined;
  const out: Swmm6Options = { enabled: true };
  if (s6.dynamicSlot === true) {
    out.dynamicSlot = true;
    const cel = Number(s6.dpsCelerity);
    if (Number.isFinite(cel) && cel > 0 && cel <= 1000) out.dpsCelerity = cel;
    const alpha = Number(s6.dpsAlpha);
    if (Number.isFinite(alpha) && alpha >= 2 && alpha <= 100) out.dpsAlpha = alpha;
    const decay = Number(s6.dpsDecayTime);
    if (Number.isFinite(decay) && decay > 0 && decay <= 3600) out.dpsDecayTime = decay;
  }
  if (s6.fvRouting === true) {
    out.fvRouting = true;
    const order = Number(s6.fvOrder);
    if (order === 1 || order === 2) out.fvOrder = order;
    // Keyword-valued sub-options: accept a plain uppercase token so newer
    // engine keywords keep working without a client update.
    const token = (v: unknown): string | undefined => {
      const t = String(v ?? '').trim().toUpperCase();
      return /^[A-Z][A-Z0-9_]{0,30}$/.test(t) ? t : undefined;
    };
    const lim = token(s6.fvLimiter);
    if (lim) out.fvLimiter = lim;
    const ti = token(s6.fvTimeIntegration);
    if (ti) out.fvTimeIntegration = ti;
    const rs = token(s6.fvRiemann);
    if (rs) out.fvRiemann = rs;
    const cell = Number(s6.fvCellLength);
    if (Number.isFinite(cell) && cell > 0 && cell <= 10000) out.fvCellLength = cell;
    const minCells = Number(s6.fvMinCells);
    if (Number.isInteger(minCells) && minCells >= 1 && minCells <= 1000) out.fvMinCells = minCells;
    const cfl = Number(s6.fvCfl);
    if (Number.isFinite(cfl) && cfl > 0 && cfl <= 1) out.fvCfl = cfl;
  }
  if (s6.semiImplicit === true) out.semiImplicit = true;
  if (s6.andersonAccel === true) out.andersonAccel = true;
  if (s6.virtualJunctions === true) {
    out.virtualJunctions = true;
    const mom = String(s6.vjMomentum ?? '').toUpperCase();
    if (mom === 'BASIC' || mom === 'FULL') out.vjMomentum = mom;
  }
  return out.dynamicSlot || out.semiImplicit || out.andersonAccel || out.virtualJunctions || out.fvRouting ? out : undefined;
}

// --- Virtual Junctions (SWMM6 structural edit) ------------------------------

interface InpSection {
  name: string;       // upper-cased section name; '' for preamble
  header: string | null;
  lines: string[];
}

function parseInpSections(text: string): InpSection[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const secs: InpSection[] = [];
  let cur: InpSection = { name: '', header: null, lines: [] };
  for (const l of lines) {
    const m = l.match(/^\s*\[([^\]\s]+)\]/);
    if (m) {
      secs.push(cur);
      cur = { name: m[1].toUpperCase(), header: l, lines: [] };
    } else {
      cur.lines.push(l);
    }
  }
  secs.push(cur);
  return secs;
}

function buildInpSections(secs: InpSection[]): string {
  const out: string[] = [];
  for (const s of secs) {
    if (s.header !== null) out.push(s.header);
    out.push(...s.lines);
  }
  return out.join('\n');
}

function findSection(secs: InpSection[], name: string): InpSection | null {
  return secs.find((s) => s.name === name.toUpperCase()) ?? null;
}

function tokenizeInpLine(l: string): string[] {
  const c = l.split(';')[0];
  return c.trim().length ? c.trim().split(/\s+/) : [];
}

export interface VirtualJunctionUpgradeResult {
  content: string;
  /** Junction names moved into [VIRTUAL_JUNCTIONS]. */
  moved: string[];
  /** Human-readable notes about the transform (nothing eligible, etc). */
  warnings: string[];
}

/**
 * Move every eligible junction into a [VIRTUAL_JUNCTIONS] section.
 * Eligible = exactly 2 attached conduits and no entry in [INFLOWS], [DWF],
 * [RDII] or [TREATMENT]. A virtual junction row stores name + invert ONLY —
 * extra tokens are a parse error in the SWMM6 engine.
 * Does NOT write VIRTUAL_JUNCTION_MOMENTUM; applyInpOverrides handles that.
 */
export function upgradeVirtualJunctions(content: string): VirtualJunctionUpgradeResult {
  const secs = parseInpSections(content);
  const warnings: string[] = [];
  const moved: string[] = [];

  const jsec = findSection(secs, 'JUNCTIONS');
  if (!jsec) {
    return { content, moved, warnings: ['No [JUNCTIONS] section — nothing to convert to virtual junctions.'] };
  }

  // Count conduit attachments per node.
  const attach: Record<string, number> = {};
  const csec = findSection(secs, 'CONDUITS');
  if (csec) {
    for (const l of csec.lines) {
      const t = tokenizeInpLine(l);
      if (t.length >= 3) {
        attach[t[1]] = (attach[t[1]] || 0) + 1;
        attach[t[2]] = (attach[t[2]] || 0) + 1;
      }
    }
  }

  // Nodes that carry local loads are not eligible.
  const loaded = new Set<string>();
  for (const sn of ['INFLOWS', 'DWF', 'RDII', 'TREATMENT']) {
    const s = findSection(secs, sn);
    if (s) for (const l of s.lines) {
      const t = tokenizeInpLine(l);
      if (t.length) loaded.add(t[0]);
    }
  }

  // Collect eligible junction rows (in order), remove them from [JUNCTIONS].
  const vjRows: string[] = [];
  const keep: string[] = [];
  for (const l of jsec.lines) {
    const t = tokenizeInpLine(l);
    if (t.length >= 2) {
      const name = t[0];
      if ((attach[name] || 0) === 2 && !loaded.has(name)) {
        moved.push(name);
        // name + invert ONLY — a third token is a parse error.
        vjRows.push(`${name.padEnd(16)} ${t[1]}`);
        continue;
      }
    }
    keep.push(l);
  }

  if (moved.length === 0) {
    return { content, moved, warnings: ['No junctions are eligible for virtual-junction conversion (need exactly 2 attached conduits and no inflows/DWF).'] };
  }
  jsec.lines = keep;

  let vjSec = findSection(secs, 'VIRTUAL_JUNCTIONS');
  if (!vjSec) {
    vjSec = { name: 'VIRTUAL_JUNCTIONS', header: '[VIRTUAL_JUNCTIONS]', lines: [';;Name           InvertElev', ''] };
    secs.splice(secs.indexOf(jsec) + 1, 0, vjSec);
  }
  let ins = vjSec.lines.length;
  while (ins > 0 && vjSec.lines[ins - 1].trim() === '') ins--;
  vjSec.lines.splice(ins, 0, ...vjRows);

  return { content: buildInpSections(secs), moved, warnings };
}

export interface VirtualJunctionStripResult {
  content: string;
  /** Junction names restored to [JUNCTIONS]. */
  restored: string[];
  warnings: string[];
}

/**
 * Round-trip a virtual-junction model back to plain SWMM5: restore every
 * [VIRTUAL_JUNCTIONS] row to [JUNCTIONS] (MaxDepth 0 — the original MaxDepth
 * is not recoverable; SWMM5 raises 0 to the highest connecting conduit crown),
 * drop the [VIRTUAL_JUNCTIONS] section, and remove VIRTUAL_JUNCTION_MOMENTUM
 * from [OPTIONS].
 */
export function stripVirtualJunctions(content: string): VirtualJunctionStripResult {
  const secs = parseInpSections(content);
  const restored: string[] = [];
  const warnings: string[] = [];

  // Remove the SWMM6-only [OPTIONS] key.
  const osec = findSection(secs, 'OPTIONS');
  if (osec) {
    osec.lines = osec.lines.filter((l) => {
      const t = tokenizeInpLine(l);
      return !(t.length && t[0].toUpperCase() === 'VIRTUAL_JUNCTION_MOMENTUM');
    });
  }

  const vjSec = findSection(secs, 'VIRTUAL_JUNCTIONS');
  if (!vjSec) return { content: osec ? buildInpSections(secs) : content, restored, warnings };

  let jsec = findSection(secs, 'JUNCTIONS');
  if (!jsec) {
    jsec = { name: 'JUNCTIONS', header: '[JUNCTIONS]', lines: [''] };
    secs.splice(secs.indexOf(vjSec), 0, jsec);
  }

  const rows: string[] = [];
  for (const l of vjSec.lines) {
    const t = tokenizeInpLine(l);
    if (t.length >= 2) {
      restored.push(t[0]);
      rows.push(`${t[0].padEnd(16)} ${t[1].padEnd(10)} 0          0          0          0`);
    }
  }
  if (restored.length) {
    let ins = jsec.lines.length;
    while (ins > 0 && jsec.lines[ins - 1].trim() === '') ins--;
    jsec.lines.splice(ins, 0, ...rows);
    warnings.push(
      `Restored ${restored.length} virtual junction(s) to [JUNCTIONS] with MaxDepth 0 — the original MaxDepth is not recoverable from [VIRTUAL_JUNCTIONS] (it stores name + invert only). SWMM5 raises 0 to the highest connecting conduit crown.`,
    );
  }
  secs.splice(secs.indexOf(vjSec), 1);

  return { content: buildInpSections(secs), restored, warnings };
}

/** True when the .inp already contains a [VIRTUAL_JUNCTIONS] section. */
export function hasVirtualJunctions(content: string): boolean {
  return /^\s*\[VIRTUAL_JUNCTIONS\]/im.test(content);
}

function setOption(optionsSection: string, key: string, value: string): string {
  // SWMM keywords are case-insensitive and may be indented — match both.
  const lineRe = new RegExp(`^[ \\t]*(${key})[ \\t]+\\S.*$`, 'im');
  if (lineRe.test(optionsSection)) {
    return optionsSection.replace(lineRe, `${key.padEnd(20)} ${value}`);
  }
  return optionsSection.replace(/^\[OPTIONS\][^\n]*/im, (header) => `${header}\n${key.padEnd(20)} ${value}`);
}

export function applyInpOverrides(content: string, overrides: InpOverrides): string {
  const entries: [string, string][] = [];

  if (overrides.reportStepMinutes !== undefined && overrides.reportStepMinutes > 0) {
    entries.push(['REPORT_STEP', minutesToHms(overrides.reportStepMinutes)]);
  }
  if (overrides.flowRouting && ROUTING_MAP[overrides.flowRouting.toLowerCase()]) {
    entries.push(['FLOW_ROUTING', ROUTING_MAP[overrides.flowRouting.toLowerCase()]]);
  }
  if (overrides.startDate) {
    const d = isoToSwmmDate(overrides.startDate) ?? (/^\d{2}\/\d{2}\/\d{4}$/.test(overrides.startDate) ? overrides.startDate : null);
    if (d) {
      entries.push(['START_DATE', d]);
      entries.push(['REPORT_START_DATE', d]);
    }
  }
  if (overrides.endDate) {
    const d = isoToSwmmDate(overrides.endDate) ?? (/^\d{2}\/\d{2}\/\d{4}$/.test(overrides.endDate) ? overrides.endDate : null);
    if (d) entries.push(['END_DATE', d]);
  }
  if (overrides.routingStepSeconds !== undefined && overrides.routingStepSeconds > 0) {
    entries.push(['ROUTING_STEP', secondsToHms(overrides.routingStepSeconds)]);
  }
  if (overrides.variableStep !== undefined && Number.isFinite(overrides.variableStep) && overrides.variableStep >= 0) {
    // 0 disables variable stepping; SWMM caps the factor at 2.0.
    entries.push(['VARIABLE_STEP', String(Math.min(overrides.variableStep, 2))]);
  }
  if (overrides.lengtheningStep !== undefined && Number.isFinite(overrides.lengtheningStep) && overrides.lengtheningStep >= 0) {
    entries.push(['LENGTHENING_STEP', String(overrides.lengtheningStep)]);
  }
  if (overrides.inertialDamping && ['NONE', 'PARTIAL', 'FULL'].includes(overrides.inertialDamping)) {
    entries.push(['INERTIAL_DAMPING', overrides.inertialDamping]);
  }

  // SWMM6-only keywords. NOTE: stock EPA SWMM 5.x rejects every one of these
  // with ERROR 205, so they are only written when the master flag is on.
  // normalizeSwmm6Options enforces finite values and sane bounds for every
  // caller (browser WASM path and server alike).
  const s6 = normalizeSwmm6Options(overrides.swmm6);
  if (s6?.virtualJunctions) {
    // Structural edit first: move eligible junctions into [VIRTUAL_JUNCTIONS].
    // The momentum keyword is written whenever the file ends up with a
    // [VIRTUAL_JUNCTIONS] section (either just created or pre-existing).
    const vj = upgradeVirtualJunctions(content);
    content = vj.content;
    if (vj.moved.length > 0 || hasVirtualJunctions(content)) {
      entries.push(['VIRTUAL_JUNCTION_MOMENTUM', s6.vjMomentum ?? 'FULL']);
    }
  }
  if (s6) {
    if (s6.dynamicSlot) {
      entries.push(['SURCHARGE_METHOD', 'DYNAMIC_SLOT']);
      if (s6.dpsCelerity !== undefined) entries.push(['DPS_CELERITY', String(s6.dpsCelerity)]);
      if (s6.dpsAlpha !== undefined) entries.push(['DPS_ALPHA', String(s6.dpsAlpha)]);
      if (s6.dpsDecayTime !== undefined) entries.push(['DPS_DECAY_TIME', String(s6.dpsDecayTime)]);
    }
    if (s6.semiImplicit) entries.push(['NODE_CONTINUITY', 'SEMI_IMPLICIT']);
    if (s6.andersonAccel) entries.push(['ANDERSON_ACCEL', 'YES']);
    if (s6.fvRouting) {
      // Written last so it wins over any FLOW_ROUTING value from the standard
      // routing-method dropdown.
      entries.push(['FLOW_ROUTING', 'FV']);
      if (s6.fvOrder !== undefined) entries.push(['FV_ORDER', String(s6.fvOrder)]);
      if (s6.fvLimiter) entries.push(['FV_LIMITER', s6.fvLimiter]);
      if (s6.fvTimeIntegration) entries.push(['FV_TIME_INTEGRATION', s6.fvTimeIntegration]);
      if (s6.fvRiemann) entries.push(['FV_RIEMANN', s6.fvRiemann]);
      if (s6.fvCellLength !== undefined) entries.push(['FV_CELL_LENGTH', String(s6.fvCellLength)]);
      if (s6.fvMinCells !== undefined) entries.push(['FV_MIN_CELLS', String(s6.fvMinCells)]);
      if (s6.fvCfl !== undefined) entries.push(['FV_CFL', String(s6.fvCfl)]);
    }
  }

  if (entries.length === 0) return content;

  const sectionRe = /(\[OPTIONS\])([\s\S]*?)(?=\n\s*\[|$)/i;
  const match = content.match(sectionRe);

  if (match) {
    const start = content.indexOf(match[0]);
    const end = start + match[0].length;
    let section = match[0];
    for (const [key, value] of entries) {
      section = setOption(section, key, value);
    }
    return content.substring(0, start) + section + content.substring(end);
  }

  const block = entries.map(([k, v]) => `${k.padEnd(20)} ${v}`).join('\n');
  return `[OPTIONS]\n${block}\n\n${content}`;
}

/**
 * Models named extran8* reference a hot start file ("USE HOTSTART") that the
 * app ships at public/samples/extran8.hsf. These helpers detect such models
 * and rewrite the directive to point at wherever the run provides the file.
 */
export function needsExtran8Hotstart(fileName: string, inpText: string): boolean {
  const base = fileName
    .replace(/^.*[\\/]/, '')      // strip any directory
    .replace(/^\d+-/, '')          // strip upload index prefix ("0-name.inp")
    .replace(/^demo_/i, '')        // strip sample prefix
    .toLowerCase();
  return base.startsWith('extran8') && /^\s*USE\s+HOTSTART\b/im.test(inpText);
}

export function rewriteHotstartPath(inpText: string, newPath: string): string {
  return inpText.replace(/^([ \t]*USE[ \t]+HOTSTART[ \t]+).*$/im, `$1"${newPath}"`);
}

/** Hard cap on variants in one run matrix. */
export const MAX_MATRIX_VARIANTS = 24;
