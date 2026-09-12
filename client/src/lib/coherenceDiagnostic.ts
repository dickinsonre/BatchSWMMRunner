import { parseTimeSeries } from "./parseTimeSeries";

/**
 * Pure, report-summary coherence screening helpers.
 *
 * This is intentionally separate from the general INP and report parsers.  A
 * coherence screen must not turn a missing number into zero: an absent
 * section, malformed geometry, or censored report value is carried through to
 * the result and eventually becomes an unknown/bound rather than a reassuring
 * "clear".
 */

export type DataStatus = "valid" | "missing" | "invalid" | "censored";
export type GeometrySupport = "exact" | "approximate" | "unsupported" | "missing";
export type IndicatorStatus =
  | "ok"
  | "no-flow"
  | "unavailable"
  | "unknown"
  | "bound-below"
  | "bound-watch"
  | "bound-clear";
export type ScreeningCategory = "review" | "watch" | "clear" | "unknown";
export type GoverningFactor = "froude" | "courant" | "crown" | "unknown";
export type SettingSource = "manual" | "report" | "inp" | "unavailable";

export interface NumericField {
  value: number;
  raw: string;
  status: DataStatus;
  bound?: "lower" | "upper";
}

export interface XSection {
  shape: string;
  params: NumericField[];
  support: GeometrySupport;
  note?: string;
  yFull: number;
  wMax: number;
  closed: boolean;
  /** Effective full-flow area. */
  areaFull: number;
}

export interface ConduitGeometry {
  name: string;
  from: string;
  to: string;
  length: NumericField;
  roughness: NumericField;
  slope: NumericField;
  section: XSection;
}

export interface DiagnosticModel {
  flowUnits: string;
  us: boolean;
  minSlope: number;
  routingStep?: number;
  surchargeMethod: "EXTRAN" | "SLOT" | string;
  conduits: ConduitGeometry[];
  coordinates: Record<string, { x: number; y: number }>;
}

export interface LinkReport {
  type: string;
  maxFlow: NumericField;
  maxVelocity: NumericField;
  maxFullFlow: NumericField;
  depthRatio: NumericField;
  raw: string;
}

export interface DiagnosticReport {
  links: Record<string, LinkReport>;
  hasLinkFlowSummary: boolean;
  routingStep?: number;
  surchargeMethod?: string;
  flowUnits?: string;
  warnings: string[];
  timeSeries: Record<string, { depth: number[]; velocity: number[] }>;
  timeSeriesTruncated: boolean;
  timeSeriesUnitIssue?: string;
  flowClassification: Record<string, NumericField>;
  hasFlowClassification: boolean;
  flowInstability: Record<string, number>;
  hasFlowInstability: boolean;
  timeStepCritical: Record<string, number>;
  hasTimeStepCritical: boolean;
  routingContinuity?: number;
  pctNotConverging?: number;
  eventWindow?: string;
  routingMethod?: string;
}

export interface DiagnosticSettings {
  /** Explicit screening override. When omitted, report then INP settings are used. */
  dt?: number;
  rStar: number;
  crownOnset: number;
  openCrownOnset: number;
  /** Concurrent periods at or below this d/D are dry evidence, not a clear. */
  dryFraction?: number;
  surchargeMethod?: "EXTRAN" | "SLOT" | string;
  /**
   * Summary uses non-concurrent report maxima. Auto uses appended link
   * time-series when present and otherwise remains explicitly summary-based.
   */
  basis?: "auto" | "summary" | "concurrent";
}

export interface DiagnosticRunSettings {
  dt?: number;
  dtSource: SettingSource;
  surchargeMethod: string;
  surchargeMethodSource: SettingSource;
  flowUnits: string;
  flowUnitsSource: SettingSource;
}

export interface Indicator {
  R: number;
  status: IndicatorStatus;
  detail: Record<string, number | string | null | undefined>;
}

export interface EngineMetrics {
  source: "report" | "missing-report";
  velocityUnit: "ft/s" | "m/s";
  depthRatio: NumericField;
  velocity: NumericField;
  froude: Indicator;
  courant: Indicator;
  crown: Indicator;
  Rcoh: number;
  category: ScreeningCategory;
  governing: GoverningFactor;
  celerity: number;
  area: number;
  topWidth: number;
  widthTreatment: string;
  geometry: GeometrySupport;
  note?: string;
  basis: "summary" | "concurrent";
  concurrentEvidence: "available" | "partial" | "missing" | "not-requested";
  periods?: number;
}

export interface DiagnosticRow {
  name: string;
  from: string;
  to: string;
  length: NumericField;
  section: XSection;
  swmm5: EngineMetrics;
  swmm6: EngineMetrics;
  swmm5Diagnostics: LinkDiagnosticEvidence;
  swmm6Diagnostics: LinkDiagnosticEvidence;
  category: ScreeningCategory;
  governing: GoverningFactor;
  weakestR: number;
  /** Agreement of the two engine review flags, not an engine-diagnostic overlap. */
  pairing: "review-overlap" | "review-only" | "unknown" | "none";
  /** Each side's coherence screen versus that same engine's report diagnostics. */
  swmm5Overlap: DiagnosticOverlap;
  swmm6Overlap: DiagnosticOverlap;
}

export interface RankedStatus {
  status: "listed" | "not-listed" | "unavailable";
  value?: number;
}

export interface LinkDiagnosticEvidence {
  adjustedLength: NumericField;
  /** A flow-classification adjusted/actual length ratio above 1.05. */
  adjustedLengthStatus: RankedStatus;
  flowInstability: RankedStatus;
  timeStepCritical: RankedStatus;
}

export interface CoverageSummary {
  conduits: number;
  report5Rows: number;
  report6Rows: number;
  pairedRows: number;
  review: number;
  watch: number;
  clear: number;
  unknown: number;
  unsupportedGeometry: number;
  approximateGeometry: number;
}

export interface DiagnosticResult {
  model: DiagnosticModel;
  report5: DiagnosticReport;
  report6: DiagnosticReport;
  rows: DiagnosticRow[];
  coverage: CoverageSummary;
  settings: DiagnosticSettings;
  runSettings: DiagnosticRunSettings;
  /** Each engine is screened with its own reported routing step and method. */
  sideRunSettings: { swmm5: DiagnosticRunSettings; swmm6: DiagnosticRunSettings };
  basis: "summary" | "concurrent";
  settingsError?: string;
}

export interface PairingCheck {
  compatible: boolean;
  errors: string[];
  warnings: string[];
  sharedConduits: number;
}

export interface DiagnosticTransition {
  name: string;
  transition: "resolved" | "new" | "worsened" | "eased" | "unchanged" | "unknown";
  swmm5: EngineMetrics;
  swmm6: EngineMetrics;
  swmm5Diagnostics: LinkDiagnosticEvidence;
  swmm6Diagnostics: LinkDiagnosticEvidence;
  swmm5Overlap: DiagnosticOverlap;
  swmm6Overlap: DiagnosticOverlap;
  velocityDelta?: number;
  depthRatioDelta?: number;
}

export type DiagnosticOverlap = "overlap" | "screen-only" | "diagnostic-only" | "none" | "unavailable";

export interface DiagnosticComparison {
  rows: DiagnosticTransition[];
  counts: Record<DiagnosticTransition["transition"], number>;
  pairing: PairingCheck;
  dt5?: number;
  dt6?: number;
  continuity5?: number;
  continuity6?: number;
  pctNotConverging5?: number;
  pctNotConverging6?: number;
}

const US_UNITS = new Set(["CFS", "GPM", "MGD"]);
const OPEN_SHAPES = new Set([
  "RECT_OPEN",
  "TRAPEZOIDAL",
  "TRIANGULAR",
  "PARABOLIC",
  "POWER",
  "IRREGULAR",
  "STREET",
]);
const EXACT_SHAPES = new Set([
  "CIRCULAR",
  "FORCE_MAIN",
  "FILLED_CIRCULAR",
  "RECT_CLOSED",
  "RECT_OPEN",
  "RECT_TRIANGULAR",
  "RECT_ROUND",
  "TRAPEZOIDAL",
  "TRIANGULAR",
  "PARABOLIC",
  "POWER",
]);
const ELLIPTICAL_SHAPES = new Set([
  "EGG",
  "HORSESHOE",
  "GOTHIC",
  "CATENARY",
  "SEMIELLIPTICAL",
  "BASKETHANDLE",
  "SEMICIRCULAR",
  "MODBASKETHANDLE",
  "ARCH",
  "HORIZ_ELLIPSE",
  "VERT_ELLIPSE",
]);
const ELLIPTICAL_ASPECT: Record<string, number> = {
  EGG: 0.667,
  HORSESHOE: 1,
  GOTHIC: 0.84,
  CATENARY: 0.9,
  SEMIELLIPTICAL: 1,
  BASKETHANDLE: 0.944,
  SEMICIRCULAR: 1.64,
  MODBASKETHANDLE: 1,
  ARCH: 1.5,
  HORIZ_ELLIPSE: 1.5,
  VERT_ELLIPSE: 0.667,
};

function missingField(raw = ""): NumericField {
  return { value: Number.NaN, raw, status: "missing" };
}

export function numericField(raw: string | undefined): NumericField {
  const token = (raw ?? "").trim();
  if (!token) return missingField();
  const match = token.match(/^([<>]?)\s*(-?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?)$/);
  if (!match) return { value: Number.NaN, raw: token, status: "invalid" };
  const value = Number(match[2]);
  if (!Number.isFinite(value)) return { value: Number.NaN, raw: token, status: "invalid" };
  if (!match[1]) return { value, raw: token, status: "valid" };
  return {
    value,
    raw: token,
    status: "censored",
    bound: match[1] === ">" ? "lower" : "upper",
  };
}

function validValue(field: NumericField | undefined, positive = false): number | undefined {
  if (!field || field.status !== "valid" || !Number.isFinite(field.value)) return undefined;
  if (positive && field.value <= 0) return undefined;
  return field.value;
}

function seconds(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const token = value.trim();
  if (token.includes(":")) {
    const parts = token.split(":").map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
  }
  const parsed = Number(token);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function stripComments(line: string): string {
  return line.replace(/\s*;.*$/, "").trim();
}

function sections(text: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  let active = "";
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const heading = raw.match(/^\s*\[([A-Za-z0-9_]+)\]/);
    if (heading) {
      active = heading[1].toUpperCase();
      if (!result.has(active)) result.set(active, []);
      continue;
    }
    const line = stripComments(raw);
    if (active && line) result.get(active)!.push(line);
  }
  return result;
}

function finiteParams(params: NumericField[], count: number): number[] | undefined {
  const values = params.slice(0, count).map(item => validValue(item, true));
  return values.length === count && values.every(value => value !== undefined)
    ? values as number[]
    : undefined;
}

function circleSegment(radius: number, depth: number): { area: number; perimeter: number; width: number } {
  const y = Math.max(0, Math.min(depth, 2 * radius));
  if (!(y > 0) || !(radius > 0)) return { area: 0, perimeter: 0, width: 0 };
  const theta = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - y / radius)));
  return {
    area: 0.5 * radius * radius * (theta - Math.sin(theta)),
    perimeter: radius * theta,
    width: 2 * Math.sqrt(Math.max(y * (2 * radius - y), 0)),
  };
}

interface GeometryValues extends XSection {
  filledDepth?: number;
  bottomWidth?: number;
  side1?: number;
  side2?: number;
  bottomDepth?: number;
  bottomArea?: number;
  bottomRadius?: number;
  roundTheta?: number;
  powerExponent?: number;
  powerRadius?: number;
  parabolaRadius?: number;
}

export function xsection(shapeInput: string | undefined, rawParams: (string | undefined)[]): XSection {
  const shape = (shapeInput || "CIRCULAR").toUpperCase();
  const params = [0, 1, 2, 3].map(index => numericField(rawParams[index]));
  const p = params.map(item => validValue(item, true));
  const unsupported = (note: string): XSection => ({
    shape,
    params,
    support: "unsupported",
    note,
    yFull: Number.NaN,
    wMax: Number.NaN,
    closed: !OPEN_SHAPES.has(shape),
    areaFull: Number.NaN,
  });

  let yFull: number | undefined;
  let wMax: number | undefined;
  let areaFull: number | undefined;
  let note: string | undefined;
  let extras: Partial<GeometryValues> = {};

  if (shape === "CIRCULAR" || shape === "FORCE_MAIN") {
    yFull = p[0]; wMax = p[0];
    if (yFull) areaFull = Math.PI * (yFull / 2) ** 2;
  } else if (shape === "FILLED_CIRCULAR") {
    const diameter = p[0]; const fill = p[1];
    yFull = diameter !== undefined && fill !== undefined ? diameter - Math.min(Math.max(fill, 0), diameter * 0.99) : undefined;
    wMax = diameter;
    if (diameter !== undefined && yFull !== undefined) {
      const r = diameter / 2;
      areaFull = circleSegment(r, diameter).area - circleSegment(r, fill || 0).area;
      extras = { filledDepth: fill };
    }
  } else if (shape === "RECT_CLOSED" || shape === "RECT_OPEN") {
    yFull = p[0]; wMax = p[1];
    if (yFull !== undefined && wMax !== undefined) areaFull = yFull * wMax;
    if (shape === "RECT_OPEN" && p[2] !== undefined && p[2] > 2) note = "invalid sides-to-ignore value";
  } else if (shape === "RECT_TRIANGULAR") {
    yFull = p[0]; wMax = p[1]; const bottomDepth = p[2];
    if (yFull !== undefined && wMax !== undefined && bottomDepth !== undefined) {
      const slope = wMax / bottomDepth / 2;
      const bottomArea = bottomDepth * wMax / 2;
      areaFull = bottomArea + (yFull - bottomDepth) * wMax;
      extras = { bottomDepth, bottomArea, side1: slope };
    }
  } else if (shape === "RECT_ROUND") {
    yFull = p[0]; wMax = p[1]; const radius = p[2];
    if (yFull !== undefined && wMax !== undefined && radius !== undefined && radius >= wMax / 2) {
      const theta = 2 * Math.asin(Math.min(1, wMax / 2 / radius));
      const bottomDepth = radius * (1 - Math.cos(theta / 2));
      const bottomArea = 0.5 * radius * radius * (theta - Math.sin(theta));
      areaFull = bottomArea + Math.max(0, yFull - bottomDepth) * wMax;
      extras = { bottomRadius: radius, bottomDepth, bottomArea, roundTheta: theta };
    }
  } else if (shape === "TRAPEZOIDAL") {
    yFull = p[0]; const bottom = p[1]; const side1 = p[2]; const side2 = p[3];
    if (yFull !== undefined && bottom !== undefined && side1 !== undefined && side2 !== undefined) {
      wMax = bottom + yFull * (side1 + side2);
      areaFull = (bottom + ((side1 + side2) / 2) * yFull) * yFull;
      extras = { bottomWidth: bottom, side1, side2 };
    }
  } else if (shape === "TRIANGULAR") {
    yFull = p[0]; wMax = p[1];
    if (yFull !== undefined && wMax !== undefined) {
      const side = wMax / yFull / 2;
      areaFull = side * yFull * yFull;
      extras = { side1: side };
    }
  } else if (shape === "PARABOLIC") {
    yFull = p[0]; wMax = p[1];
    if (yFull !== undefined && wMax !== undefined) {
      const radius = wMax / 2 / Math.sqrt(yFull);
      areaFull = 4 / 3 * radius * yFull ** 1.5;
      extras = { parabolaRadius: radius };
    }
  } else if (shape === "POWER") {
    yFull = p[0]; wMax = p[1]; const exponent = p[2];
    if (yFull !== undefined && wMax !== undefined && exponent !== undefined && exponent > 0) {
      const side = 1 / exponent;
      const radius = wMax / (side + 1) / yFull ** side;
      areaFull = radius * yFull ** (side + 1);
      extras = { powerExponent: exponent, powerRadius: radius };
    }
  } else if (ELLIPTICAL_SHAPES.has(shape)) {
    yFull = p[0];
    wMax = p[1] || (yFull !== undefined ? ELLIPTICAL_ASPECT[shape] * yFull : undefined);
    if (yFull !== undefined && wMax !== undefined) {
      areaFull = Math.PI * yFull * wMax / 4;
      note = "elliptical section approximated; verify against the engine's tabulated section";
    }
  } else {
    return unsupported(shape === "IRREGULAR" || shape === "STREET"
      ? "section data are not present in the [XSECTIONS] row"
      : "section shape is not supported by this screen");
  }

  if (!(yFull && yFull > 0 && wMax && wMax > 0 && areaFull !== undefined && areaFull > 0)) {
    return {
      shape, params, support: "unsupported", note: "missing or invalid section dimensions",
      yFull: Number.NaN, wMax: Number.NaN, closed: !OPEN_SHAPES.has(shape), areaFull: Number.NaN,
    };
  }
  const support: GeometrySupport = EXACT_SHAPES.has(shape) ? "exact" : "approximate";
  return {
    shape, params, support, note, yFull, wMax, areaFull, closed: !OPEN_SHAPES.has(shape), ...extras,
  } as XSection;
}

function propertyAt(g: GeometryValues, depth: number): { area: number; width: number; perimeter: number } {
  const y = Math.max(0, Math.min(depth, g.yFull));
  const p = g.params.map(item => validValue(item, true));
  switch (g.shape) {
    case "CIRCULAR":
    case "FORCE_MAIN": {
      const c = circleSegment(g.yFull / 2, y);
      return { area: c.area, width: c.width, perimeter: c.perimeter };
    }
    case "FILLED_CIRCULAR": {
      const diameter = p[0]!;
      const fill = g.filledDepth || 0;
      const top = circleSegment(diameter / 2, fill + y);
      const bottom = circleSegment(diameter / 2, fill);
      return { area: top.area - bottom.area, width: top.width, perimeter: top.perimeter - bottom.perimeter + bottom.width };
    }
    case "RECT_CLOSED":
    case "RECT_OPEN": {
      const width = g.wMax;
      return { area: width * y, width, perimeter: g.shape === "RECT_OPEN" ? width + 2 * y : width + 2 * y };
    }
    case "RECT_TRIANGULAR": {
      const bottomDepth = g.bottomDepth || 0;
      const slope = g.side1 || 0;
      if (y <= bottomDepth) return { area: slope * y * y, width: 2 * slope * y, perimeter: 2 * y * Math.sqrt(1 + slope * slope) };
      return { area: (g.bottomArea || 0) + (y - bottomDepth) * g.wMax, width: g.wMax, perimeter: 2 * bottomDepth * Math.sqrt(1 + slope * slope) + 2 * (y - bottomDepth) };
    }
    case "RECT_ROUND": {
      const radius = g.bottomRadius || g.wMax / 2;
      const bottomDepth = g.bottomDepth || 0;
      const bottomArea = g.bottomArea || 0;
      if (y <= bottomDepth) {
        const c = circleSegment(radius, y);
        return { area: c.area, width: c.width, perimeter: c.perimeter };
      }
      return { area: bottomArea + (y - bottomDepth) * g.wMax, width: g.wMax, perimeter: radius * (g.roundTheta || 0) + 2 * (y - bottomDepth) };
    }
    case "TRAPEZOIDAL": {
      const bottom = g.bottomWidth || 0; const z1 = g.side1 || 0; const z2 = g.side2 || 0;
      return {
        area: (bottom + ((z1 + z2) / 2) * y) * y,
        width: bottom + y * (z1 + z2),
        perimeter: bottom + y * (Math.sqrt(1 + z1 * z1) + Math.sqrt(1 + z2 * z2)),
      };
    }
    case "TRIANGULAR": {
      const side = g.side1 || 0;
      return { area: side * y * y, width: 2 * side * y, perimeter: 2 * y * Math.sqrt(1 + side * side) };
    }
    case "PARABOLIC": {
      const radius = g.parabolaRadius || 0;
      const width = 2 * radius * Math.sqrt(y);
      const x = width / radius;
      const perimeter = y > 0 ? 0.5 * radius * radius * (x * Math.sqrt(1 + x * x) + Math.asinh(x)) : 0;
      return { area: 4 / 3 * radius * y ** 1.5, width, perimeter };
    }
    case "POWER": {
      const exponent = g.powerExponent || 1; const radius = g.powerRadius || 0; const m = 1 / exponent;
      const area = radius * y ** (m + 1);
      const width = (m + 1) * radius * y ** m;
      // A short numerical integration follows SWMM's power-section approach.
      const n = Math.max(1, Math.ceil(y / (0.02 * g.yFull)));
      let perimeter = 0; let lastX = 0; let lastY = 0;
      for (let i = 1; i <= n; i++) {
        const nextY = y * i / n; const nextX = (m + 1) * radius / 2 * nextY ** m;
        perimeter += Math.hypot(nextX - lastX, nextY - lastY); lastX = nextX; lastY = nextY;
      }
      return { area, width, perimeter: 2 * perimeter };
    }
    default: {
      const b = g.yFull / 2; const a = g.wMax / 2;
      const c = circleSegment(b, y);
      return { area: c.area * a / b, width: c.width * a / b, perimeter: c.perimeter * (a / b + 1) / 2 };
    }
  }
}

function celerity(area: number, width: number, us: boolean): number {
  const gravity = us ? 32.2 : 32.2 * 0.3048;
  return Math.sqrt(gravity * Math.max(area, 1e-12) / Math.max(width, 1e-12));
}

function swmmWidth(g: GeometryValues, depth: number, method: string): { width: number; treatment: string } {
  if (!g.closed) return { width: propertyAt(g, depth).width, treatment: "free-surface" };
  const ratio = depth / g.yFull;
  const cutoff = method === "SLOT" ? 0.985257 : 0.96;
  if (ratio >= cutoff) {
    if (method === "SLOT") {
      const width = ratio > 1.78
        ? 0.01 * g.wMax
        : g.wMax * 0.5423 * Math.exp(-(ratio ** 2.4));
      return { width, treatment: "slot" };
    }
    return { width: propertyAt(g, cutoff * g.yFull).width, treatment: "crown-cutoff" };
  }
  return { width: propertyAt(g, depth).width, treatment: "free-surface" };
}

function unavailableIndicator(kind: string, why: string): Indicator {
  return { R: Number.NaN, status: "unavailable", detail: { kind, why } };
}

export function validateDiagnosticSettings(settings: DiagnosticSettings): string[] {
  const errors: string[] = [];
  if (settings.dt !== undefined && (!Number.isFinite(settings.dt) || settings.dt <= 0)) {
    errors.push("screening Δt must be a finite value greater than zero");
  }
  if (!Number.isFinite(settings.rStar) || settings.rStar <= 0) {
    errors.push("R* must be a finite value greater than zero");
  }
  if (!Number.isFinite(settings.crownOnset) || settings.crownOnset < 0 || settings.crownOnset >= 1) {
    errors.push("closed crown onset must be finite and in [0, 1)");
  }
  if (!Number.isFinite(settings.openCrownOnset) || settings.openCrownOnset < 0 || settings.openCrownOnset >= 1) {
    errors.push("open crown onset must be finite and in [0, 1)");
  }
  if (settings.dryFraction !== undefined && (!Number.isFinite(settings.dryFraction) || settings.dryFraction < 0 || settings.dryFraction >= 1)) {
    errors.push("concurrent dry cutoff must be finite and in [0, 1)");
  }
  if (
    settings.surchargeMethod !== undefined
    && !["EXTRAN", "SLOT", "UNKNOWN", "DYNAMIC_SLOT", "(NULL)"].includes(settings.surchargeMethod.toUpperCase())
  ) {
    errors.push("surcharge method must be EXTRAN or SLOT");
  }
  return errors;
}

function normalizeSurchargeMethod(value: string | undefined): string | undefined {
  const method = value?.trim().toUpperCase();
  return method === "(NULL)" ? "UNKNOWN" : method;
}

function indicators(
  conduit: ConduitGeometry,
  report: LinkReport | undefined,
  settings: DiagnosticSettings,
  us: boolean,
  settingsError?: string,
): EngineMetrics {
  const section = conduit.section;
  const source = report ? "report" : "missing-report";
  const unknownDepth = report ? report.depthRatio : missingField();
  const unknownVelocity = report ? report.maxVelocity : missingField();
  const invalidGeometry = section.support === "unsupported" || !Number.isFinite(section.yFull);
  const length = validValue(conduit.length, true);
  const depthValid = unknownDepth.status === "valid" && Number.isFinite(unknownDepth.value);
  const velocityValid = unknownVelocity.status === "valid" || unknownVelocity.status === "censored";
  const base: EngineMetrics = {
    source,
    velocityUnit: us ? "ft/s" : "m/s",
    depthRatio: unknownDepth,
    velocity: unknownVelocity,
    froude: unavailableIndicator("froude", invalidGeometry ? "unsupported or missing section geometry" : "depth or velocity unavailable"),
    courant: unavailableIndicator("courant", invalidGeometry ? "unsupported or missing section geometry" : "depth or velocity unavailable"),
    crown: unavailableIndicator("crown", invalidGeometry ? "unsupported or missing section geometry" : "depth unavailable"),
    Rcoh: Number.NaN,
    category: "unknown",
    governing: "unknown",
    celerity: Number.NaN,
    area: Number.NaN,
    topWidth: Number.NaN,
    widthTreatment: "—",
    geometry: section.support,
    note: section.note,
    basis: "summary",
    concurrentEvidence: "not-requested",
  };
  if (settingsError) {
    base.froude = unavailableIndicator("froude", settingsError);
    base.courant = unavailableIndicator("courant", settingsError);
    base.crown = unavailableIndicator("crown", settingsError);
    return base;
  }
  if (invalidGeometry || !depthValid) return base;
  const g = section as GeometryValues;
  // Do not clamp the report's d/D before choosing the closed-section width.
  // SWMM's SLOT treatment has a distinct above-crown branch (including the
  // >1.78 d/D slot floor).  The hydraulic area itself is capped by
  // propertyAt, as it is at full depth.
  const depth = Math.max(0, unknownDepth.value * g.yFull);
  const props = propertyAt(g, depth);
  const method = (settings.surchargeMethod || "EXTRAN").toUpperCase();
  // DYNAMIC_SLOT and an alpha-engine "(null)" echo are not documented
  // equivalents of EXTRAN or SLOT. Below crown the width is
  // method-independent; at/above the conservative EXTRAN cutoff preserve the
  // observed crown margin, but never manufacture a reassuring Fr/Courant.
  const unknownNearCrown = g.closed && !["EXTRAN", "SLOT"].includes(method)
    && unknownDepth.value >= 0.96;
  const width = swmmWidth(g, depth, ["EXTRAN", "SLOT"].includes(method) ? method : "EXTRAN");
  const c = celerity(props.area, width.width, us);
  const velocity = velocityValid ? Math.abs(unknownVelocity.value || 0) : Number.NaN;
  base.celerity = c; base.area = props.area; base.topWidth = width.width; base.widthTreatment = width.treatment;
  const onset = g.closed ? settings.crownOnset : settings.openCrownOnset;
  const crownR = (1 - unknownDepth.value) / Math.max(1 - onset, 1e-6);
  base.crown = { R: crownR, status: "ok", detail: { dD: unknownDepth.value, onset } };
  const censorStatus = (r: number): IndicatorStatus => {
    if (unknownVelocity.bound === "lower") return r < settings.rStar ? "bound-below" : "unknown";
    return r >= settings.rStar * 1.25 ? "bound-clear" : r >= settings.rStar ? "bound-watch" : "unknown";
  };
  if (unknownNearCrown) {
    base.widthTreatment = "unknown surcharge treatment near crown";
    base.froude = unavailableIndicator("froude", `surcharge method ${method} is not modelled near crown`);
    base.courant = unavailableIndicator("courant", `surcharge method ${method} is not modelled near crown`);
  } else if (!velocityValid) {
    base.froude = unavailableIndicator("froude", `velocity ${unknownVelocity.status}`);
    base.courant = unavailableIndicator("courant", `velocity ${unknownVelocity.status}`);
  } else {
    const froude = c > 0 ? velocity / c : Number.POSITIVE_INFINITY;
    const courant = length && settings.dt && settings.dt > 0
      ? ((velocity + c) * settings.dt) / length : Number.NaN;
    const rFr = froude > 0 ? 1 / froude : Number.POSITIVE_INFINITY;
    const rCr = courant > 0 ? 1 / courant : Number.POSITIVE_INFINITY;
    base.froude = {
      R: rFr,
      status: unknownVelocity.status === "censored"
        ? censorStatus(rFr) : velocity > 0 ? "ok" : "no-flow",
      detail: { Fr: froude, velocity, velocityStatus: unknownVelocity.status, bound: unknownVelocity.bound },
    };
    base.courant = Number.isFinite(courant) || courant === Number.POSITIVE_INFINITY
      ? {
        R: rCr,
        status: unknownVelocity.status === "censored"
          ? censorStatus(rCr) : "ok",
        detail: { Cr: courant, velocity, celerity: c, dt: settings.dt, length: length ?? null },
      }
      : unavailableIndicator("courant", !length ? `length ${conduit.length.status}` : "screening Δt unavailable");
  }
  const indicatorsList: Array<[GoverningFactor, Indicator]> = [
    ["froude", base.froude], ["courant", base.courant], ["crown", base.crown],
  ];
  let decisive: [GoverningFactor, Indicator] | undefined;
  let minimum: [GoverningFactor, Indicator] | undefined;
  let anyUnknown = false;
  for (const [kind, indicator] of indicatorsList) {
    if (indicator.status === "bound-below") {
      if (!decisive || indicator.R < decisive[1].R) decisive = [kind, indicator];
    } else if (indicator.status === "unknown" || indicator.status === "unavailable") {
      anyUnknown = true;
    } else if (indicator.status === "bound-watch") {
      if (!minimum || indicator.R < minimum[1].R) minimum = [kind, indicator];
    } else if (indicator.status !== "no-flow" && indicator.status !== "bound-clear") {
      if (!minimum || indicator.R < minimum[1].R) minimum = [kind, indicator];
    }
  }
  if (decisive) {
    base.category = "review"; base.governing = decisive[0]; base.Rcoh = decisive[1].R;
  } else if (minimum && minimum[1].R < settings.rStar) {
    base.category = "review"; base.governing = minimum[0]; base.Rcoh = minimum[1].R;
  } else if (anyUnknown) {
    base.category = "unknown"; base.governing = minimum?.[0] || "unknown"; base.Rcoh = minimum?.[1].R ?? Number.NaN;
  } else if (minimum && minimum[1].R < settings.rStar * 1.25) {
    base.category = "watch"; base.governing = minimum[0]; base.Rcoh = minimum[1].R;
  } else {
    base.category = "clear"; base.governing = minimum?.[0] || "crown"; base.Rcoh = minimum?.[1].R ?? Number.POSITIVE_INFINITY;
  }
  return base;
}

function reportNumber(token: string | undefined): NumericField {
  return numericField(token);
}

function parseReportDiagnostics(text: string): Pick<DiagnosticReport,
  "flowClassification" | "hasFlowClassification" | "flowInstability" | "hasFlowInstability"
  | "timeStepCritical" | "hasTimeStepCritical" | "routingContinuity" | "pctNotConverging" | "eventWindow" | "routingMethod"> {
  const lines = text.split(/\r?\n/);
  const rowsFor = (heading: RegExp): { lines: string[]; found: boolean } => {
    const start = lines.findIndex(line => heading.test(line));
    if (start < 0) return { lines: [], found: false };
    const section: string[] = [];
    for (let index = start + 1; index < lines.length; index++) {
      if (/^\s*\*{8,}\s*$/.test(lines[index]) && section.length > 0) break;
      section.push(lines[index]);
    }
    return { lines: section, found: true };
  };
  const flowClassification: Record<string, NumericField> = {};
  const classification = rowsFor(/^\s*Flow Classification Summary\s*$/i);
  for (const line of classification.lines) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length >= 2 && /^[^\s]+$/.test(tokens[0]) && numericField(tokens[1]).status !== "invalid") {
      // Header words cannot pass this numeric second-column guard.
      flowClassification[tokens[0]] = numericField(tokens[1]);
    }
  }
  const ranked = (heading: RegExp) => {
    const section = rowsFor(heading);
    const values: Record<string, number> = {};
    for (const line of section.lines) {
      const match = line.match(/^\s*(?:Link\s+)?(\S+)\s*\(\s*([-\d.]+)\s*%?\s*\)\s*$/i);
      if (match && Number.isFinite(Number(match[2]))) values[match[1]] = Number(match[2]);
    }
    return { values, found: section.found };
  };
  const fii = ranked(/^\s*Highest Flow Instability Indexes\s*$/i);
  const critical = ranked(/^\s*Time-Step Critical Elements\s*$/i);
  const continuity = text.match(/Flow Routing Continuity[\s\S]{0,2500}?Continuity Error \(%\)\s*\.+\s*([-\d.]+)/i);
  const nonconverging = text.match(/%\s*of Steps Not Converging\s*:\s*([-\d.]+)/i);
  const start = text.match(/Starting Date\s*\.+\s*(.+)$/im)?.[1]?.trim();
  const end = text.match(/Ending Date\s*\.+\s*(.+)$/im)?.[1]?.trim();
  const routingMethod = text.match(/Flow Routing Method\s*\.+\s*(\S+)/i)?.[1]?.toUpperCase();
  return {
    flowClassification,
    hasFlowClassification: classification.found,
    flowInstability: fii.values,
    hasFlowInstability: fii.found,
    timeStepCritical: critical.values,
    hasTimeStepCritical: critical.found,
    routingContinuity: continuity ? Number(continuity[1]) : undefined,
    pctNotConverging: nonconverging ? Number(nonconverging[1]) : undefined,
    eventWindow: start || end ? `${start || "?"} → ${end || "?"}` : undefined,
    routingMethod,
  };
}

export function parseDiagnosticReport(text: string | undefined): DiagnosticReport {
  const links: Record<string, LinkReport> = {};
  const warnings: string[] = [];
  if (!text) return {
    links, hasLinkFlowSummary: false, warnings: ["report text is unavailable"], timeSeries: {}, timeSeriesTruncated: false,
    flowClassification: {}, hasFlowClassification: false, flowInstability: {}, hasFlowInstability: false,
    timeStepCritical: {}, hasTimeStepCritical: false,
  };
  const routingStepMatch = text.match(/Routing Time Step\s*\.+\s*([\d:.]+)\s*sec/i);
  const surchargeMatch = text.match(/Surcharge Method\s*\.+\s*([A-Za-z0-9_()-]+)/i);
  const flowUnitsMatch = text.match(/Flow Units\s*\.+\s*([A-Za-z0-9_-]+)/i);
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const start = lines.findIndex(line => /^\s*Link Flow Summary\s*$/i.test(line));
  if (start < 0) return {
    links,
    hasLinkFlowSummary: false,
    routingStep: seconds(routingStepMatch?.[1]),
    surchargeMethod: normalizeSurchargeMethod(surchargeMatch?.[1]),
    flowUnits: flowUnitsMatch?.[1]?.toUpperCase(),
    warnings: ["Link Flow Summary is absent"],
    timeSeries: parseConcurrentLinkSeries(text),
    timeSeriesTruncated: /BATCHSWMM56_TIME_SERIES_TRUNCATED/i.test(text),
    timeSeriesUnitIssue: concurrentSeriesUnitIssue(text, flowUnitsMatch?.[1]),
    ...parseReportDiagnostics(text),
  };
  let sawTable = false;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*[A-Z][A-Za-z -]+ Summary\s*$/i.test(line) && !/Link Flow Summary/i.test(line)) break;
    if (/^-{12,}/.test(line.trim())) { sawTable = true; continue; }
    if (!sawTable) continue;
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 6) {
      if (line.trim() && links && /^\S+\s+CONDUIT\b/i.test(line)) warnings.push(`unreadable Link Flow Summary row: ${line.trim()}`);
      continue;
    }
    const typeIndex = tokens.findIndex(token => /^(CONDUIT|PUMP|ORIFICE|WEIR|OUTLET|DUMMY)$/i.test(token));
    if (typeIndex < 1 || !/^CONDUIT$/i.test(tokens[typeIndex])) continue;
    const id = tokens[0];
    links[id] = {
      type: tokens[typeIndex].toUpperCase(),
      maxFlow: reportNumber(tokens[typeIndex + 1]),
      maxVelocity: reportNumber(tokens[typeIndex + 4]),
      maxFullFlow: reportNumber(tokens[typeIndex + 5]),
      depthRatio: reportNumber(tokens[typeIndex + 6]),
      raw: line,
    };
  }
  return {
    links,
    hasLinkFlowSummary: true,
    routingStep: seconds(routingStepMatch?.[1]),
    surchargeMethod: normalizeSurchargeMethod(surchargeMatch?.[1]),
    flowUnits: flowUnitsMatch?.[1]?.toUpperCase(),
    warnings,
    timeSeries: parseConcurrentLinkSeries(text),
    timeSeriesTruncated: /BATCHSWMM56_TIME_SERIES_TRUNCATED/i.test(text),
    timeSeriesUnitIssue: concurrentSeriesUnitIssue(text, flowUnitsMatch?.[1]),
    ...parseReportDiagnostics(text),
  };
}

/**
 * Read only explicitly appended/report link series. This deliberately does
 * not try to decode a SWMM6 binary .out as SWMM5: absent or unparseable
 * evidence remains absent and is surfaced by the caller.
 */
function parseConcurrentLinkSeries(text: string): Record<string, { depth: number[]; velocity: number[] }> {
  const result: Record<string, { depth: number[]; velocity: number[] }> = {};
  for (const series of parseTimeSeries(text)) {
    if (!/^link/i.test(series.title) && !/^link\s+/i.test(series.element)) continue;
    const depthIndex = series.columns.findIndex(column => /^depth$/i.test(column.trim()));
    const velocityIndex = series.columns.findIndex(column => /^vel(?:ocity)?$/i.test(column.trim()));
    if (depthIndex < 0 || velocityIndex < 0) continue;
    const name = series.element.replace(/^link\s+/i, "").trim();
    if (!name) continue;
    result[name] = {
      depth: series.data.map(point => point.values[depthIndex]),
      velocity: series.data.map(point => point.values[velocityIndex]),
    };
  }
  return result;
}

function concurrentSeriesUnitIssue(text: string, flowUnits: string | undefined): string | undefined {
  const us = flowUnits ? US_UNITS.has(flowUnits.toUpperCase()) : undefined;
  for (const series of parseTimeSeries(text)) {
    if (!/^link/i.test(series.title) && !/^link\s+/i.test(series.element)) continue;
    const flowIndex = series.columns.findIndex(column => /^flow$/i.test(column.trim()));
    const depthIndex = series.columns.findIndex(column => /^depth$/i.test(column.trim()));
    const velocityIndex = series.columns.findIndex(column => /^vel(?:ocity)?$/i.test(column.trim()));
    if (depthIndex < 0 || velocityIndex < 0) continue;
    if (flowIndex < 0) return "link time-series Flow header is missing";
    const flowUnit = (series.units[flowIndex] || "").toLowerCase();
    const depthUnit = (series.units[depthIndex] || "").toLowerCase();
    const velocityUnit = (series.units[velocityIndex] || "").toLowerCase();
    if (!flowUnit || !depthUnit || !velocityUnit) return "link time-series Flow/Depth/Velocity unit headers are missing";
    if (us !== undefined) {
      const expectedLength = us ? /^(ft|feet)$/ : /^(m|meter|meters)$/;
      const expectedVelocity = us ? /^(ft|feet)\/sec$/ : /^(m|meter|meters)\/sec$/;
      if (!expectedLength.test(depthUnit) || !expectedVelocity.test(velocityUnit)) {
        return `link time-series units (${depthUnit}, ${velocityUnit}) do not match the report flow-unit system`;
      }
      if (flowUnits && flowUnit !== flowUnits.toLowerCase()) {
        return `link time-series Flow unit (${flowUnit}) does not match report flow units (${flowUnits.toLowerCase()})`;
      }
    }
  }
  return undefined;
}

export function parseDiagnosticInp(text: string): DiagnosticModel {
  const s = sections(text);
  const optionRows = s.get("OPTIONS") || [];
  const options = new Map<string, string>();
  for (const line of optionRows) {
    const tokens = line.split(/\s+/);
    if (tokens.length >= 2) options.set(tokens[0].toUpperCase(), tokens.slice(1).join(" "));
  }
  const flowUnits = (options.get("FLOW_UNITS") || "CFS").toUpperCase();
  const minSlopeField = numericField(options.get("MIN_SLOPE"));
  const minSlope = validValue(minSlopeField, true) ?? 1e-4;
  const routingStep = seconds(options.get("ROUTING_STEP"));
  const surcharge = (options.get("SURCHARGE_METHOD") || "EXTRAN").toUpperCase();
  const xs = new Map<string, XSection>();
  for (const line of s.get("XSECTIONS") || []) {
    const tokens = line.split(/\s+/);
    if (!tokens[0]) continue;
    xs.set(tokens[0], xsection(tokens[1], tokens.slice(2, 6)));
  }
  const conduits: ConduitGeometry[] = [];
  const coordinates: DiagnosticModel["coordinates"] = {};
  for (const line of s.get("COORDINATES") || []) {
    const tokens = line.split(/\s+/);
    const x = numericField(tokens[1]);
    const y = numericField(tokens[2]);
    if (tokens[0] && x.status === "valid" && y.status === "valid") {
      coordinates[tokens[0]] = { x: x.value, y: y.value };
    }
  }
  for (const line of s.get("CONDUITS") || []) {
    const tokens = line.split(/\s+/);
    const name = tokens[0];
    if (!name || !tokens[1] || !tokens[2]) continue;
    const length = numericField(tokens[3]);
    const n = numericField(tokens[4]);
    const slope = numericField(tokens[5]);
    const section = xs.get(name) || {
      shape: "MISSING", params: [missingField(), missingField(), missingField(), missingField()],
      support: "missing", note: "no [XSECTIONS] entry", yFull: Number.NaN, wMax: Number.NaN,
      closed: true, areaFull: Number.NaN,
    };
    const slopeValue = validValue(slope, true) ?? minSlope;
    conduits.push({
      name, from: tokens[1], to: tokens[2], length,
      roughness: n.status === "valid" && n.value > 0 ? n : { ...n, value: Number.NaN },
      slope: { ...slope, value: slopeValue, status: slope.status === "valid" ? "valid" : slope.status },
      section,
    });
  }
  return {
    flowUnits, us: US_UNITS.has(flowUnits), minSlope, routingStep,
    surchargeMethod: surcharge, conduits, coordinates,
  };
}

function metricForBasis(
  conduit: ConduitGeometry,
  report: DiagnosticReport,
  settings: DiagnosticSettings,
  us: boolean,
  settingsError?: string,
): EngineMetrics {
  const summary = indicators(conduit, report.links[conduit.name], settings, us, settingsError);
  const requested = settings.basis || "auto";
  if (requested === "summary") return summary;

  const series = report.timeSeries[conduit.name];
  if (report.timeSeriesTruncated || report.timeSeriesUnitIssue || !series || series.depth.length === 0 || series.depth.length !== series.velocity.length) {
    if (requested === "auto") {
      return {
        ...summary,
        concurrentEvidence: "missing",
        note: [summary.note, report.timeSeriesTruncated ? "Concurrent link time-series evidence is truncated; summary maxima are non-concurrent." : report.timeSeriesUnitIssue || "Concurrent link time-series evidence is unavailable; summary maxima are non-concurrent."].filter(Boolean).join(" "),
      };
    }
    return {
      ...summary,
      basis: "concurrent",
      concurrentEvidence: "missing",
      category: "unknown",
      governing: "unknown",
      Rcoh: Number.NaN,
      note: [summary.note, report.timeSeriesTruncated ? "Concurrent link time-series evidence is truncated." : report.timeSeriesUnitIssue || "Concurrent link time-series evidence is unavailable."].filter(Boolean).join(" "),
    };
  }

  const candidates: EngineMetrics[] = [];
  let missingPeriod = false;
  let wetPeriods = 0;
  const dryFraction = settings.dryFraction ?? 0.02;
  for (let index = 0; index < series.depth.length; index++) {
    const depth = series.depth[index];
    const velocity = series.velocity[index];
    if (!Number.isFinite(depth) || !Number.isFinite(velocity) || !Number.isFinite(conduit.section.yFull) || conduit.section.yFull <= 0) {
      missingPeriod = true;
      continue;
    }
    if (depth / conduit.section.yFull <= dryFraction) continue;
    wetPeriods++;
    candidates.push(indicators(conduit, {
      type: "CONDUIT",
      maxFlow: missingField(),
      maxVelocity: { value: velocity, raw: String(velocity), status: "valid" },
      maxFullFlow: missingField(),
      depthRatio: { value: depth / conduit.section.yFull, raw: String(depth / conduit.section.yFull), status: "valid" },
      raw: "concurrent time-series period",
    }, settings, us, settingsError));
  }
  const priority: Record<ScreeningCategory, number> = { review: 0, watch: 1, unknown: 2, clear: 3 };
  candidates.sort((a, b) => priority[a.category] - priority[b.category]
    || (Number.isFinite(a.Rcoh) ? a.Rcoh : Number.POSITIVE_INFINITY) - (Number.isFinite(b.Rcoh) ? b.Rcoh : Number.POSITIVE_INFINITY));
  const selected = candidates[0];
  if (wetPeriods === 0) {
    return {
      ...summary,
      basis: "concurrent",
      concurrentEvidence: missingPeriod ? "partial" : "available",
      periods: series.depth.length,
      category: "unknown",
      governing: "unknown",
      Rcoh: Number.NaN,
      note: [summary.note, `No wet concurrent periods above the ${(dryFraction * 100).toFixed(0)}% d/D dry cutoff.`].filter(Boolean).join(" "),
    };
  }
  if (!selected || (missingPeriod && selected.category !== "review")) {
    return {
      ...(selected || summary),
      basis: "concurrent",
      concurrentEvidence: "partial",
      periods: series.depth.length,
      category: "unknown",
      governing: selected?.governing || "unknown",
      Rcoh: selected?.Rcoh ?? Number.NaN,
      note: [selected?.note || summary.note, "One or more concurrent periods are missing or malformed."].filter(Boolean).join(" "),
    };
  }
  return {
    ...selected,
    basis: "concurrent",
    concurrentEvidence: missingPeriod ? "partial" : "available",
    periods: series.depth.length,
    note: [selected.note, `${wetPeriods} wet concurrent link time-series periods screened.`, missingPeriod ? "One or more periods are missing or malformed." : ""].filter(Boolean).join(" "),
  };
}

function reportEvidence(report: DiagnosticReport, name: string): LinkDiagnosticEvidence {
  const adjustedLength = report.hasFlowClassification ? report.flowClassification[name] || missingField() : missingField();
  return {
    adjustedLength,
    adjustedLengthStatus: !report.hasFlowClassification || adjustedLength.status !== "valid"
      ? { status: "unavailable" }
      : adjustedLength.value > 1.05
        ? { status: "listed", value: adjustedLength.value }
        : { status: "not-listed", value: adjustedLength.value },
    flowInstability: report.hasFlowInstability
      ? (report.flowInstability[name] === undefined ? { status: "not-listed" } : { status: "listed", value: report.flowInstability[name] })
      : { status: "unavailable" },
    timeStepCritical: report.hasTimeStepCritical
      ? (report.timeStepCritical[name] === undefined ? { status: "not-listed" } : { status: "listed", value: report.timeStepCritical[name] })
      : { status: "unavailable" },
  };
}

function diagnosticOverlap(category: ScreeningCategory, evidence: LinkDiagnosticEvidence): DiagnosticOverlap {
  const statuses = [evidence.adjustedLengthStatus, evidence.flowInstability, evidence.timeStepCritical];
  if (statuses.every(item => item.status === "unavailable")) return "unavailable";
  const listed = statuses.some(item => item.status === "listed");
  if (category === "review") return listed ? "overlap" : "screen-only";
  return listed ? "diagnostic-only" : "none";
}

export function buildDiagnosticRows(
  model: DiagnosticModel,
  report5: DiagnosticReport,
  report6: DiagnosticReport,
  settings5: DiagnosticSettings,
  settings6: DiagnosticSettings,
  settingsError5?: string,
  settingsError6?: string,
): DiagnosticRow[] {
  return model.conduits.map(conduit => {
    const swmm5 = metricForBasis(conduit, report5, settings5, model.us, settingsError5);
    const swmm6 = metricForBasis(conduit, report6, settings6, model.us, settingsError6);
    const categories = [swmm5.category, swmm6.category];
    const category: ScreeningCategory = categories.includes("review")
      ? "review" : categories.includes("watch") ? "watch"
        : categories.every(item => item === "clear") ? "clear" : "unknown";
    const weakest = [swmm5.Rcoh, swmm6.Rcoh].filter(Number.isFinite);
    const weakestR = weakest.length ? Math.min(...weakest) : Number.NaN;
    const governing = swmm5.Rcoh <= swmm6.Rcoh ? swmm5.governing : swmm6.governing;
    const review5 = swmm5.category === "review";
    const review6 = swmm6.category === "review";
    const pairing: DiagnosticRow["pairing"] = review5 && review6
      ? "review-overlap" : review5 || review6 ? "review-only"
        : category === "unknown" ? "unknown" : "none";
    const swmm5Diagnostics = reportEvidence(report5, conduit.name);
    const swmm6Diagnostics = reportEvidence(report6, conduit.name);
    const swmm5Overlap = diagnosticOverlap(swmm5.category, swmm5Diagnostics);
    const swmm6Overlap = diagnosticOverlap(swmm6.category, swmm6Diagnostics);
    return { name: conduit.name, from: conduit.from, to: conduit.to, length: conduit.length,
      section: conduit.section, swmm5, swmm6, category, governing, weakestR, pairing, swmm5Overlap, swmm6Overlap,
      swmm5Diagnostics, swmm6Diagnostics };
  });
}

export function summarizeCoverage(rows: DiagnosticRow[], report5: DiagnosticReport, report6: DiagnosticReport): CoverageSummary {
  return {
    conduits: rows.length,
    report5Rows: Object.keys(report5.links).length,
    report6Rows: Object.keys(report6.links).length,
    pairedRows: rows.filter(row => row.swmm5.source === "report" && row.swmm6.source === "report").length,
    review: rows.filter(row => row.category === "review").length,
    watch: rows.filter(row => row.category === "watch").length,
    clear: rows.filter(row => row.category === "clear").length,
    unknown: rows.filter(row => row.category === "unknown").length,
    unsupportedGeometry: rows.filter(row => row.section.support === "unsupported" || row.section.support === "missing").length,
    approximateGeometry: rows.filter(row => row.section.support === "approximate").length,
  };
}

export function calculateDiagnostic(
  inpText: string,
  swmm5Text: string | undefined,
  swmm6Text: string | undefined,
  settings: DiagnosticSettings,
): DiagnosticResult {
  const model = parseDiagnosticInp(inpText);
  const report5 = parseDiagnosticReport(swmm5Text);
  const report6 = parseDiagnosticReport(swmm6Text);
  const sideSettings = (report: DiagnosticReport): [DiagnosticSettings, DiagnosticRunSettings, string | undefined] => {
    const dt = settings.dt ?? report.routingStep ?? model.routingStep;
    const surchargeMethod = settings.surchargeMethod ?? report.surchargeMethod ?? model.surchargeMethod;
    const flowUnits = report.flowUnits ?? model.flowUnits;
    const effective: DiagnosticSettings = { ...settings, dt, surchargeMethod };
    const errors = validateDiagnosticSettings(effective);
    return [effective, {
      dt,
      dtSource: settings.dt !== undefined ? "manual" : report.routingStep !== undefined ? "report" : model.routingStep !== undefined ? "inp" : "unavailable",
      surchargeMethod,
      surchargeMethodSource: settings.surchargeMethod !== undefined ? "manual" : report.surchargeMethod !== undefined ? "report" : "inp",
      flowUnits,
      flowUnitsSource: report.flowUnits !== undefined ? "report" : "inp",
    }, errors.length ? errors.join("; ") : undefined];
  };
  const [settings5, runSettings5, error5] = sideSettings(report5);
  const [settings6, runSettings6, error6] = sideSettings(report6);
  const effectiveSettings = settings5;
  const settingsError = [error5, error6].filter(Boolean).join("; ") || undefined;
  const matched5 = model.conduits.filter(conduit => report5.links[conduit.name]).length;
  const matched6 = model.conduits.filter(conduit => report6.links[conduit.name]).length;
  if (report5.hasLinkFlowSummary && model.conduits.length > 0 && matched5 === 0) {
    report5.warnings.push("no Link Flow Summary conduit IDs matched the INP [CONDUITS] IDs");
  }
  if (report6.hasLinkFlowSummary && model.conduits.length > 0 && matched6 === 0) {
    report6.warnings.push("no Link Flow Summary conduit IDs matched the INP [CONDUITS] IDs");
  }
  const rows = buildDiagnosticRows(model, report5, report6, settings5, settings6, error5, error6);
  return {
    model, report5, report6, rows, coverage: summarizeCoverage(rows, report5, report6),
    settings: effectiveSettings,
    runSettings: runSettings5,
    sideRunSettings: { swmm5: runSettings5, swmm6: runSettings6 },
    basis: rows.some(row => row.swmm5.basis === "concurrent" || row.swmm6.basis === "concurrent") ? "concurrent" : "summary",
    settingsError,
  };
}

export function checkDiagnosticPairing(
  baselineInp: string,
  rerunInp: string,
  baselineReport?: string,
  rerunReport?: string,
): PairingCheck {
  const baseline = parseDiagnosticInp(baselineInp);
  const rerun = parseDiagnosticInp(rerunInp);
  const errors: string[] = [];
  const warnings: string[] = [];
  if (normalizePairingInp(baselineInp) !== normalizePairingInp(rerunInp)) {
    errors.push("the INP files differ after removing comments, formatting, and [REPORT] directives");
  }
  const baselineNames = new Set(baseline.conduits.map(conduit => conduit.name));
  const sharedConduits = rerun.conduits.filter(conduit => baselineNames.has(conduit.name)).length;
  if (baseline.flowUnits !== rerun.flowUnits) errors.push(`flow units differ (${baseline.flowUnits} vs ${rerun.flowUnits})`);
  if (baseline.conduits.length && rerun.conduits.length && sharedConduits === 0) {
    errors.push("the INP files have no conduit IDs in common");
  }
  const a = parseDiagnosticReport(baselineReport);
  const b = parseDiagnosticReport(rerunReport);
  if (a.flowUnits && a.flowUnits !== baseline.flowUnits) errors.push(`baseline report flow units (${a.flowUnits}) do not match its INP (${baseline.flowUnits})`);
  if (b.flowUnits && b.flowUnits !== rerun.flowUnits) errors.push(`rerun report flow units (${b.flowUnits}) do not match its INP (${rerun.flowUnits})`);
  if (!a.hasLinkFlowSummary || !b.hasLinkFlowSummary) warnings.push("one or both reports lack a Link Flow Summary");
  if (a.flowUnits && b.flowUnits && a.flowUnits !== b.flowUnits) errors.push(`report flow units differ (${a.flowUnits} vs ${b.flowUnits})`);
  // A report header can be absent in partial exports; its own INP is still
  // authoritative for checking appended length/velocity/flow unit headers.
  const baselineSeriesIssue = a.timeSeriesUnitIssue ?? concurrentSeriesUnitIssue(baselineReport || "", baseline.flowUnits);
  const rerunSeriesIssue = b.timeSeriesUnitIssue ?? concurrentSeriesUnitIssue(rerunReport || "", rerun.flowUnits);
  if (baselineSeriesIssue) errors.push(`baseline ${baselineSeriesIssue}`);
  if (rerunSeriesIssue) errors.push(`rerun ${rerunSeriesIssue}`);
  if (a.routingStep !== undefined && b.routingStep !== undefined && a.routingStep !== b.routingStep) {
    warnings.push(`different run routing steps (${a.routingStep} s vs ${b.routingStep} s); each side is screened at its own step`);
  }
  if (a.surchargeMethod && b.surchargeMethod && a.surchargeMethod !== b.surchargeMethod) {
    warnings.push(`different surcharge methods (${a.surchargeMethod} vs ${b.surchargeMethod})`);
  }
  if (a.routingMethod && b.routingMethod && a.routingMethod !== b.routingMethod) {
    warnings.push(`different routing methods (${a.routingMethod} vs ${b.routingMethod})`);
  }
  if (a.eventWindow && b.eventWindow && a.eventWindow !== b.eventWindow) {
    warnings.push(`different reported event windows (${a.eventWindow} vs ${b.eventWindow})`);
  }
  return { compatible: errors.length === 0, errors, warnings, sharedConduits };
}

function normalizePairingInp(text: string): string {
  let inReport = false;
  const rows: string[] = [];
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const heading = raw.match(/^\s*\[([^\]]+)\]/);
    if (heading) {
      inReport = heading[1].trim().toUpperCase() === "REPORT";
      if (!inReport) rows.push(`[${heading[1].trim().toUpperCase()}]`);
      continue;
    }
    if (inReport) continue;
    const line = stripComments(raw).replace(/\s+/g, " ").trim();
    if (line) rows.push(line.toUpperCase());
  }
  return rows.join("\n");
}

export function transitionLabel(
  baseline: ScreeningCategory,
  rerun: ScreeningCategory,
  baselineR: number,
  rerunR: number,
): DiagnosticTransition["transition"] {
  if (baseline === "unknown" || rerun === "unknown") return "unknown";
  if (baseline === "review" && rerun !== "review") return "resolved";
  if (baseline !== "review" && rerun === "review") return "new";
  if (baseline === "review" && rerun === "review") {
    if (Number.isFinite(baselineR) && Number.isFinite(rerunR)) {
      if (rerunR < baselineR * 0.95) return "worsened";
      if (rerunR > baselineR * 1.05) return "eased";
    }
  }
  return "unchanged";
}

export function compareDiagnostic(result: DiagnosticResult): DiagnosticComparison {
  const counts: DiagnosticComparison["counts"] = {
    resolved: 0, new: 0, worsened: 0, eased: 0, unchanged: 0, unknown: 0,
  };
  const rows = result.rows.map(row => {
    const transition = transitionLabel(row.swmm5.category, row.swmm6.category, row.swmm5.Rcoh, row.swmm6.Rcoh);
    counts[transition]++;
    const validDelta = (a: NumericField, b: NumericField): number | undefined =>
      a.status === "valid" && b.status === "valid" ? b.value - a.value : undefined;
    return {
      name: row.name,
      transition,
      swmm5: row.swmm5,
      swmm6: row.swmm6,
      swmm5Diagnostics: row.swmm5Diagnostics,
      swmm6Diagnostics: row.swmm6Diagnostics,
      swmm5Overlap: row.swmm5Overlap,
      swmm6Overlap: row.swmm6Overlap,
      velocityDelta: validDelta(row.swmm5.velocity, row.swmm6.velocity),
      depthRatioDelta: validDelta(row.swmm5.depthRatio, row.swmm6.depthRatio),
    };
  });
  return {
    rows,
    counts,
    pairing: {
      compatible: true,
      errors: [],
      warnings: result.report5.flowUnits && result.report6.flowUnits && result.report5.flowUnits !== result.report6.flowUnits
        ? [`report flow units differ (${result.report5.flowUnits} vs ${result.report6.flowUnits})`] : [],
      sharedConduits: result.model.conduits.length,
    },
    dt5: result.sideRunSettings.swmm5.dt,
    dt6: result.sideRunSettings.swmm6.dt,
    continuity5: result.report5.routingContinuity,
    continuity6: result.report6.routingContinuity,
    pctNotConverging5: result.report5.pctNotConverging,
    pctNotConverging6: result.report6.pctNotConverging,
  };
}

function csvValue(value: unknown): string {
  const text = value === undefined || value === null || (typeof value === "number" && !Number.isFinite(value))
    ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function metricCsv(engine: EngineMetrics): (string | number)[] {
  const fieldValue = (field: NumericField): string | number =>
    field.status === "valid" ? field.value : field.raw;
  return [
    engine.source, engine.basis, engine.concurrentEvidence, engine.periods ?? "",
    fieldValue(engine.depthRatio), engine.depthRatio.status,
    fieldValue(engine.velocity), engine.velocityUnit, engine.velocity.status,
    engine.froude.detail.Fr ?? "", engine.froude.R, engine.courant.detail.Cr ?? "", engine.courant.R,
    engine.crown.R, engine.Rcoh, engine.governing, engine.category, engine.geometry,
  ];
}

export function diagnosticCsv(rows: DiagnosticRow[]): string {
  const header = [
    "Conduit", "From", "To", "Length", "Shape", "Geometry support",
    "SWMM5 source", "SWMM5 basis", "SWMM5 concurrent evidence", "SWMM5 periods", "SWMM5 d/D", "SWMM5 d/D status", "SWMM5 velocity (ft/s or m/s; see unit)", "SWMM5 velocity unit", "SWMM5 velocity status", "SWMM5 Fr", "SWMM5 R-Fr", "SWMM5 Cr", "SWMM5 R-dt", "SWMM5 R-crown", "SWMM5 R-min", "SWMM5 governing", "SWMM5 status", "SWMM5 geometry",
    "SWMM6 source", "SWMM6 basis", "SWMM6 concurrent evidence", "SWMM6 periods", "SWMM6 d/D", "SWMM6 d/D status", "SWMM6 velocity (ft/s or m/s; see unit)", "SWMM6 velocity unit", "SWMM6 velocity status", "SWMM6 Fr", "SWMM6 R-Fr", "SWMM6 Cr", "SWMM6 R-dt", "SWMM6 R-crown", "SWMM6 R-min", "SWMM6 governing", "SWMM6 status", "SWMM6 geometry",
    "Paired status", "SWMM5→SWMM6 screen transition", "SWMM5 screen/diagnostic overlap", "SWMM6 screen/diagnostic overlap", "SWMM5 adjusted/actual length", "SWMM6 adjusted/actual length",
    "SWMM5 adjusted/actual status", "SWMM6 adjusted/actual status",
    "SWMM5 FII status", "SWMM5 FII", "SWMM6 FII status", "SWMM6 FII",
    "SWMM5 time-step-critical status", "SWMM5 time-step-critical %", "SWMM6 time-step-critical status", "SWMM6 time-step-critical %",
  ];
  const lines = [header, ...rows.map(row => [
    row.name, row.from, row.to, row.length.status === "valid" ? row.length.value : row.length.raw,
     row.section.shape, row.section.support, ...metricCsv(row.swmm5), ...metricCsv(row.swmm6), row.pairing,
     transitionLabel(row.swmm5.category, row.swmm6.category, row.swmm5.Rcoh, row.swmm6.Rcoh), row.swmm5Overlap, row.swmm6Overlap,
     row.swmm5Diagnostics.adjustedLength.status === "valid" ? row.swmm5Diagnostics.adjustedLength.value : row.swmm5Diagnostics.adjustedLength.raw,
     row.swmm6Diagnostics.adjustedLength.status === "valid" ? row.swmm6Diagnostics.adjustedLength.value : row.swmm6Diagnostics.adjustedLength.raw,
     row.swmm5Diagnostics.adjustedLengthStatus.status, row.swmm6Diagnostics.adjustedLengthStatus.status,
     row.swmm5Diagnostics.flowInstability.status, row.swmm5Diagnostics.flowInstability.value ?? "",
     row.swmm6Diagnostics.flowInstability.status, row.swmm6Diagnostics.flowInstability.value ?? "",
     row.swmm5Diagnostics.timeStepCritical.status, row.swmm5Diagnostics.timeStepCritical.value ?? "",
     row.swmm6Diagnostics.timeStepCritical.status, row.swmm6Diagnostics.timeStepCritical.value ?? "",
  ])];
  return lines.map(line => line.map(csvValue).join(",")).join("\r\n") + "\r\n";
}

export function indicatorLabel(kind: GoverningFactor): string {
  return kind === "froude" ? "Froude" : kind === "courant" ? "time step" : kind === "crown" ? "crown" : "unknown";
}