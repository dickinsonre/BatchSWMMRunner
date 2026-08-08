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
}

export interface InpOverrides {
  reportStepMinutes?: number;
  flowRouting?: string;
  startDate?: string;
  endDate?: string;
  routingStepSeconds?: number;
  swmm6?: Swmm6Options;
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
  if (s6.semiImplicit === true) out.semiImplicit = true;
  if (s6.andersonAccel === true) out.andersonAccel = true;
  return out.dynamicSlot || out.semiImplicit || out.andersonAccel ? out : undefined;
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

  // SWMM6-only keywords. NOTE: stock EPA SWMM 5.x rejects every one of these
  // with ERROR 205, so they are only written when the master flag is on.
  // normalizeSwmm6Options enforces finite values and sane bounds for every
  // caller (browser WASM path and server alike).
  const s6 = normalizeSwmm6Options(overrides.swmm6);
  if (s6) {
    if (s6.dynamicSlot) {
      entries.push(['SURCHARGE_METHOD', 'DYNAMIC_SLOT']);
      if (s6.dpsCelerity !== undefined) entries.push(['DPS_CELERITY', String(s6.dpsCelerity)]);
      if (s6.dpsAlpha !== undefined) entries.push(['DPS_ALPHA', String(s6.dpsAlpha)]);
      if (s6.dpsDecayTime !== undefined) entries.push(['DPS_DECAY_TIME', String(s6.dpsDecayTime)]);
    }
    if (s6.semiImplicit) entries.push(['NODE_CONTINUITY', 'SEMI_IMPLICIT']);
    if (s6.andersonAccel) entries.push(['ANDERSON_ACCEL', 'YES']);
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
