import { parseReportTimestamp } from "./engineComparison";
import { entitySeriesKind } from "./entityComparison";
import type { ParsedTimeSeries, TimeSeriesTruncation } from "./parseTimeSeries";

export type ModelScoreCategoryKey = "system" | "subcatchment" | "node" | "link";

export interface BillJamesModelScoreConfig {
  maxScore: number;
  absoluteFloors: {
    flow: number;
    depth: number;
    velocity: number;
    /** Defaults to flow × model duration when omitted. */
    volume?: number;
  };
  categories: Record<ModelScoreCategoryKey, {
    label: string;
    weight: number;
  }>;
  shape: {
    minimumWetSteps: number;
  };
  deductions: {
    system: {
      volumePercentPerPoint: number;
      volumeCap: number;
      continuityPointsPerPoint: number;
      continuityCap: number;
    };
    subcatchment: {
      runoffVolumePercentPerPoint: number;
      runoffVolumeCap: number;
      peakRunoffPercentPerPoint: number;
      peakRunoffCap: number;
      peakTimeStepsPerPoint: number;
      peakTimeCap: number;
      runoffKgeDeficitPerPoint: number;
      runoffKgeCap: number;
    };
    node: {
      peakDepthPercentPerPoint: number;
      peakDepthCap: number;
      floodVolumePercentPerPoint: number;
      floodVolumeCap: number;
      peakTimeStepsPerPoint: number;
      peakTimeCap: number;
      depthKgeDeficitPerPoint: number;
      depthKgeCap: number;
      depthNseDeficitPerPoint: number;
      depthNseCap: number;
    };
    link: {
      peakFlowPercentPerPoint: number;
      peakFlowCap: number;
      flowVolumePercentPerPoint: number;
      flowVolumeCap: number;
      peakVelocityPercentPerPoint: number;
      peakVelocityCap: number;
      peakTimeStepsPerPoint: number;
      peakTimeCap: number;
      flowKgeDeficitPerPoint: number;
      flowKgeCap: number;
      flowNseDeficitPerPoint: number;
      flowNseCap: number;
    };
  };
}

/**
 * Published application schedule. Values are centralized here so the math and
 * engineer-facing explanation cannot silently drift apart.
 */
export const BILL_JAMES_MODEL_SCORE_CONFIG: BillJamesModelScoreConfig = {
  maxScore: 1000,
  absoluteFloors: {
    // Native report units are required to match before these floors are used.
    flow: 0.001,
    depth: 0.01,
    velocity: 0.01,
  },
  categories: {
    system: { label: "System", weight: 200 },
    subcatchment: { label: "Subcatchments", weight: 200 },
    node: { label: "Nodes", weight: 300 },
    link: { label: "Links", weight: 300 },
  },
  shape: {
    minimumWetSteps: 10,
  },
  deductions: {
    system: {
      volumePercentPerPoint: 0.5,
      volumeCap: 20,
      continuityPointsPerPoint: 0.1,
      continuityCap: 20,
    },
    subcatchment: {
      runoffVolumePercentPerPoint: 0.5,
      runoffVolumeCap: 35,
      peakRunoffPercentPerPoint: 0.5,
      peakRunoffCap: 35,
      peakTimeStepsPerPoint: 1,
      peakTimeCap: 20,
      runoffKgeDeficitPerPoint: 0.02,
      runoffKgeCap: 20,
    },
    node: {
      peakDepthPercentPerPoint: 0.5,
      peakDepthCap: 30,
      floodVolumePercentPerPoint: 1,
      floodVolumeCap: 30,
      peakTimeStepsPerPoint: 1,
      peakTimeCap: 15,
      depthKgeDeficitPerPoint: 0.02,
      depthKgeCap: 15,
      depthNseDeficitPerPoint: 0.02,
      depthNseCap: 10,
    },
    link: {
      peakFlowPercentPerPoint: 0.5,
      peakFlowCap: 25,
      flowVolumePercentPerPoint: 0.5,
      flowVolumeCap: 25,
      peakVelocityPercentPerPoint: 1,
      peakVelocityCap: 15,
      peakTimeStepsPerPoint: 1,
      peakTimeCap: 10,
      flowKgeDeficitPerPoint: 0.02,
      flowKgeCap: 15,
      flowNseDeficitPerPoint: 0.02,
      flowNseCap: 10,
    },
  },
};

export interface ModelScoreRun {
  status: string;
  series: ParsedTimeSeries[];
  routingContinuityError?: number;
  seriesTruncation?: TimeSeriesTruncation;
}

export interface ModelScoreDeduction {
  category: ModelScoreCategoryKey;
  element: string;
  metric: string;
  delta: number;
  deltaUnit: "%" | "pp" | "steps" | "index" | "missing";
  /** Points removed from this element's 100-point score. */
  elementPoints: number;
  /** Weighted points removed from the 1,000-point network score. */
  points: number;
  detail: string;
}

export interface ModelScoreSkippedMetric {
  category: ModelScoreCategoryKey;
  element: string;
  metric: string;
  reason: string;
}

export interface ModelScoreShapeDiagnostic {
  category: Exclude<ModelScoreCategoryKey, "system">;
  element: string;
  metric: "Runoff" | "Depth" | "Flow";
  unit: string;
  wetSamples: number;
  variant: "KGE-2009";
  kge: number;
  nse: number;
  mse: number;
  correlation: number;
  variabilityRatio: number;
  biasRatio: number;
}

export interface ModelScoreElement {
  category: ModelScoreCategoryKey;
  element: string;
  score: number;
  deductions: ModelScoreDeduction[];
  missingInCandidate: boolean;
}

export interface ModelScoreCategory {
  key: ModelScoreCategoryKey;
  label: string;
  weight: number;
  score: number;
  points: number;
  elementCount: number;
  elements: ModelScoreElement[];
}

export interface BillJamesModelScoreResult {
  score: number | undefined;
  maxScore: number;
  band: string;
  categories: ModelScoreCategory[];
  elements: ModelScoreElement[];
  deductions: ModelScoreDeduction[];
  gateReasons: string[];
  /** Metrics intentionally left out because a usable pair was not available. */
  skippedMetrics: ModelScoreSkippedMetric[];
  /** Wet-window hydrograph diagnostics. MSE and KGE components are diagnostic-only. */
  shapeDiagnostics: ModelScoreShapeDiagnostic[];
  /** Candidate-only records are visible but do not alter a reference-defined score. */
  extraCandidateElements: Record<Exclude<ModelScoreCategoryKey, "system">, string[]>;
}

interface PreparedRun {
  input: ModelScoreRun;
  system: ParsedTimeSeries | undefined;
  grid: number[];
  durationSeconds: number;
  entities: Record<Exclude<ModelScoreCategoryKey, "system">, Map<string, {
    id: string;
    series: ParsedTimeSeries;
  }>>;
}

interface DeductionDraft {
  metric: string;
  delta: number;
  deltaUnit: ModelScoreDeduction["deltaUnit"];
  rawPoints: number;
  detail: string;
}

class ScoreGateError extends Error {}

const CATEGORY_ORDER: ModelScoreCategoryKey[] = ["system", "subcatchment", "node", "link"];
const EPSILON = 1e-9;

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Normalize alternate spellings of the same native unit. This deliberately
 * does not convert values: only labels that represent the same measurement
 * are treated as compatible.
 */
function canonicalUnit(value: string): string {
  const unit = normalized(value)
    .replace(/³/g, "3")
    .replace(/\^/g, "")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ");
  const aliases: Record<string, string> = {
    ft: "ft",
    foot: "ft",
    feet: "ft",
    m: "m",
    meter: "m",
    meters: "m",
    metre: "m",
    metres: "m",
    "ft/sec": "ft/sec",
    "ft/s": "ft/sec",
    "foot/sec": "ft/sec",
    "foot/s": "ft/sec",
    "feet/sec": "ft/sec",
    "feet/s": "ft/sec",
    "m/sec": "m/sec",
    "m/s": "m/sec",
    "meter/sec": "m/sec",
    "meter/s": "m/sec",
    "meters/sec": "m/sec",
    "meters/s": "m/sec",
    "metre/sec": "m/sec",
    "metre/s": "m/sec",
    "metres/sec": "m/sec",
    "metres/s": "m/sec",
    ft3: "ft3",
    "cubic foot": "ft3",
    "cubic feet": "ft3",
    m3: "m3",
    "cubic meter": "m3",
    "cubic meters": "m3",
    "cubic metre": "m3",
    "cubic metres": "m3",
  };
  return aliases[unit] ?? unit;
}

function elapsedGrid(series: ParsedTimeSeries): number[] {
  const timestamps = series.data.map(point => parseReportTimestamp(point.time));
  const start = timestamps.find(Number.isFinite);
  if (start === undefined) return [];
  return timestamps.map(timestamp =>
    Number.isFinite(timestamp) ? Math.round((timestamp - start) / 1000) : Number.NaN
  );
}

function gridsEqual(reference: number[], candidate: number[]): boolean {
  return reference.length === candidate.length &&
    reference.every((value, index) =>
      Number.isFinite(value) && value === candidate[index]
    );
}

function prepareRun(input: ModelScoreRun, role: "Reference" | "Candidate"): PreparedRun {
  if (input.status !== "success") {
    throw new ScoreGateError(`${role} run is ${input.status || "incomplete"}`);
  }
  if (input.seriesTruncation) {
    throw new ScoreGateError(
      `${role} time series is truncated to ${input.seriesTruncation.displayedPeriods} of ${input.seriesTruncation.totalPeriods} report periods; whole-model scoring requires every period`,
    );
  }
  if (input.series.length === 0) {
    throw new ScoreGateError(`${role} report time-series data is unavailable`);
  }
  const system = input.series.find(series =>
    /^system/i.test(series.title.trim()) || normalized(series.element) === "system"
  );
  const gridSource = system ?? input.series[0]!;
  const grid = elapsedGrid(gridSource);
  if (grid.length < 2 || grid.some(value => !Number.isFinite(value))) {
    throw new ScoreGateError(`${role} report time grid is incomplete`);
  }
  for (const series of input.series) {
    const itemGrid = elapsedGrid(series);
    if (!gridsEqual(grid, itemGrid)) {
      throw new ScoreGateError(`${role} report contains inconsistent time grids`);
    }
  }
  const entities: PreparedRun["entities"] = {
    subcatchment: new Map(),
    node: new Map(),
    link: new Map(),
  };
  for (const series of input.series) {
    const kind = entitySeriesKind(series);
    if (!kind) continue;
    const id = series.element.replace(/^(?:subcatchment|node|link)\s+/i, "").trim();
    const key = normalized(id);
    if (key && !entities[kind].has(key)) entities[kind].set(key, { id, series });
  }
  return {
    input,
    system,
    grid,
    durationSeconds: grid[grid.length - 1] - grid[0],
    entities,
  };
}

function metricValues(series: ParsedTimeSeries, metric: string): { values: number[]; unit: string } | undefined {
  const index = series.columns.findIndex(column => normalized(column) === normalized(metric));
  if (index < 0) return undefined;
  const unit = series.units[index]?.trim() ?? "";
  if (!unit || unit === "-") return undefined;
  const values = series.data.map(point => point.values[index]);
  if (values.length < 2 || values.some(value => !Number.isFinite(value))) return undefined;
  return { values, unit };
}

function pairedMetric(
  reference: ParsedTimeSeries,
  candidate: ParsedTimeSeries,
  category: ModelScoreCategoryKey,
  element: string,
  metric: string,
  skippedMetrics: ModelScoreSkippedMetric[],
): { reference: number[]; candidate: number[]; unit: string } | undefined {
  const a = metricValues(reference, metric);
  const b = metricValues(candidate, metric);
  if (!a || !b) {
    skippedMetrics.push({
      category,
      element,
      metric,
      reason: "A usable paired series or unit is unavailable",
    });
    return undefined;
  }
  if (canonicalUnit(a.unit) !== canonicalUnit(b.unit)) {
    throw new ScoreGateError(
      `${reference.element}: units for ${metric} differ (${a.unit} vs ${b.unit})`,
    );
  }
  return { reference: a.values, candidate: b.values, unit: a.unit };
}

function integrate(values: number[], grid: number[], absolute = false): number {
  let total = 0;
  for (let index = 1; index < values.length; index++) {
    const a = absolute ? Math.abs(values[index - 1]) : values[index - 1];
    const b = absolute ? Math.abs(values[index]) : values[index];
    total += (a + b) / 2 * (grid[index] - grid[index - 1]);
  }
  return total;
}

function peak(values: number[], absolute = false): { value: number; index: number } {
  let bestIndex = 0;
  let best = absolute ? Math.abs(values[0]) : values[0];
  for (let index = 1; index < values.length; index++) {
    const value = absolute ? Math.abs(values[index]) : values[index];
    if (value > best) {
      best = value;
      bestIndex = index;
    }
  }
  return { value: best, index: bestIndex };
}

function percentDifference(reference: number, candidate: number, floor: number): number {
  return Math.abs(reference - candidate) / Math.max(Math.abs(reference), floor) * 100;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function hasUsableVariance(values: number[], centeredSquared: number): boolean {
  const scale = Math.max(...values.map(Math.abs));
  const numericResolution = Number.EPSILON * scale;
  return centeredSquared > numericResolution ** 2 * values.length;
}

function shapeDiagnostic(
  pair: { reference: number[]; candidate: number[]; unit: string },
  category: Exclude<ModelScoreCategoryKey, "system">,
  element: string,
  metric: ModelScoreShapeDiagnostic["metric"],
  floor: number,
  minimumWetSteps: number,
  skippedMetrics: ModelScoreSkippedMetric[],
): ModelScoreShapeDiagnostic | undefined {
  const wetIndices = pair.reference
    .map((value, index) => ({ value, index }))
    .filter(item => Math.abs(item.value) > floor)
    .map(item => item.index);
  const skip = (reason: string) => {
    skippedMetrics.push({
      category,
      element,
      metric: `${metric} shape metrics`,
      reason,
    });
    return undefined;
  };
  if (wetIndices.length < minimumWetSteps) {
    return skip(
      `${metric} shape metrics require at least ${minimumWetSteps} reference-wet report steps; found ${wetIndices.length}`,
    );
  }

  const reference = wetIndices.map(index => pair.reference[index]);
  const candidate = wetIndices.map(index => pair.candidate[index]);
  const referenceMean = mean(reference);
  const candidateMean = mean(candidate);
  if (Math.abs(referenceMean) <= floor) {
    return skip(
      `KGE-2009 requires the reference wet-window mean to exceed the ${floor} absolute floor`,
    );
  }

  const referenceCentered = reference.map(value => value - referenceMean);
  const candidateCentered = candidate.map(value => value - candidateMean);
  const referenceSquared = referenceCentered.reduce((sum, value) => sum + value ** 2, 0);
  const candidateSquared = candidateCentered.reduce((sum, value) => sum + value ** 2, 0);
  if (
    !hasUsableVariance(reference, referenceSquared) ||
    !hasUsableVariance(candidate, candidateSquared)
  ) {
    return skip(
      "KGE-2009 and NSE require non-constant reference and candidate wet-window series",
    );
  }

  const covariance = referenceCentered.reduce(
    (sum, value, index) => sum + value * candidateCentered[index],
    0,
  );
  const correlation = Math.max(
    -1,
    Math.min(1, covariance / Math.sqrt(referenceSquared * candidateSquared)),
  );
  const variabilityRatio = Math.sqrt(candidateSquared / referenceSquared);
  const biasRatio = candidateMean / referenceMean;
  const kge = 1 - Math.sqrt(
    (correlation - 1) ** 2 +
    (variabilityRatio - 1) ** 2 +
    (biasRatio - 1) ** 2,
  );
  const squaredError = reference.reduce(
    (sum, value, index) => sum + (value - candidate[index]) ** 2,
    0,
  );
  const nse = 1 - squaredError / referenceSquared;
  const mse = squaredError / reference.length;

  return {
    category,
    element,
    metric,
    unit: pair.unit,
    wetSamples: wetIndices.length,
    variant: "KGE-2009",
    kge,
    nse,
    mse,
    correlation,
    variabilityRatio,
    biasRatio,
  };
}

function cappedPoints(delta: number, perPoint: number, cap?: number): number {
  const points = delta / perPoint;
  return cap === undefined ? points : Math.min(cap, points);
}

function percentDraft(
  metric: string,
  delta: number,
  perPoint: number,
  cap: number | undefined,
): DeductionDraft {
  return {
    metric,
    delta,
    deltaUnit: "%",
    rawPoints: cappedPoints(delta, perPoint, cap),
    detail: `${metric}: ${delta.toFixed(3)}% difference`,
  };
}

function efficiencyDraft(
  metric: string,
  value: number,
  deficitPerPoint: number,
  cap: number,
  detail: string,
): DeductionDraft {
  return {
    metric,
    delta: value,
    deltaUnit: "index",
    rawPoints: cappedPoints(Math.max(0, 1 - value), deficitPerPoint, cap),
    detail,
  };
}

function scoreElement(
  category: ModelScoreCategoryKey,
  element: string,
  drafts: DeductionDraft[],
): ModelScoreElement {
  const deductions: ModelScoreDeduction[] = [];
  const eligible = drafts.filter(
    draft => Number.isFinite(draft.rawPoints) && draft.rawPoints > EPSILON,
  );
  const total = eligible.reduce((sum, draft) => sum + draft.rawPoints, 0);
  const scale = total > 100 ? 100 / total : 1;
  for (const draft of eligible) {
    const elementPoints = draft.rawPoints * scale;
    deductions.push({
      category,
      element,
      metric: draft.metric,
      delta: draft.delta,
      deltaUnit: draft.deltaUnit,
      elementPoints,
      points: 0,
      detail: draft.detail,
    });
  }
  return {
    category,
    element,
    score: Math.max(0, 100 - Math.min(100, total)),
    deductions,
    missingInCandidate: false,
  };
}

function missingElement(category: ModelScoreCategoryKey, element: string): ModelScoreElement {
  return {
    category,
    element,
    score: 0,
    missingInCandidate: true,
    deductions: [{
      category,
      element,
      metric: "Missing element",
      delta: 1,
      deltaUnit: "missing",
      elementPoints: 100,
      points: 0,
      detail: `${element} is absent from the candidate record set`,
    }],
  };
}

function candidateOnlyElements(
  reference: PreparedRun,
  candidate: PreparedRun,
): BillJamesModelScoreResult["extraCandidateElements"] {
  return {
    subcatchment: [...candidate.entities.subcatchment]
      .filter(([key]) => !reference.entities.subcatchment.has(key))
      .map(([, entry]) => entry.id),
    node: [...candidate.entities.node]
      .filter(([key]) => !reference.entities.node.has(key))
      .map(([, entry]) => entry.id),
    link: [...candidate.entities.link]
      .filter(([key]) => !reference.entities.link.has(key))
      .map(([, entry]) => entry.id),
  };
}

function systemDrafts(
  reference: PreparedRun,
  candidate: PreparedRun,
  config: BillJamesModelScoreConfig,
  skippedMetrics: ModelScoreSkippedMetric[],
): DeductionDraft[] {
  const drafts: DeductionDraft[] = [];
  if (!reference.system) return drafts;
  const duration = Math.max(reference.durationSeconds, 1);
  const flowVolumeFloor =
    config.absoluteFloors.volume ?? config.absoluteFloors.flow * duration;
  for (const [metric, label] of [
    ["Runoff", "Runoff volume"],
    ["Outflow", "Outfall volume"],
    ["Flooding", "Flooding volume"],
  ] as const) {
    if (!candidate.system) {
      skippedMetrics.push({
        category: "system",
        element: "System",
        metric,
        reason: "The candidate System time series is unavailable",
      });
      continue;
    }
    const pair = pairedMetric(
      reference.system,
      candidate.system,
      "system",
      "System",
      metric,
      skippedMetrics,
    );
    if (!pair) continue;
    const refVolume = integrate(pair.reference, reference.grid);
    const candidateVolume = integrate(pair.candidate, candidate.grid);
    const delta = percentDifference(refVolume, candidateVolume, flowVolumeFloor);
    drafts.push(percentDraft(
      label,
      delta,
      config.deductions.system.volumePercentPerPoint,
      config.deductions.system.volumeCap,
    ));
  }
  const storage = candidate.system
    ? pairedMetric(
        reference.system,
        candidate.system,
        "system",
        "System",
        "Storage Volume",
        skippedMetrics,
      )
    : undefined;
  if (!candidate.system) {
    skippedMetrics.push({
      category: "system",
      element: "System",
      metric: "Storage Volume",
      reason: "The candidate System time series is unavailable",
    });
  }
  if (storage) {
    const storageDelta = percentDifference(
      storage.reference[storage.reference.length - 1],
      storage.candidate[storage.candidate.length - 1],
      flowVolumeFloor,
    );
    drafts.push(percentDraft(
      "Final storage",
      storageDelta,
      config.deductions.system.volumePercentPerPoint,
      config.deductions.system.volumeCap,
    ));
  }
  if (
    Number.isFinite(reference.input.routingContinuityError) &&
    Number.isFinite(candidate.input.routingContinuityError)
  ) {
    const continuityDelta = Math.abs(
      reference.input.routingContinuityError! - candidate.input.routingContinuityError!,
    );
    drafts.push({
      metric: "Routing continuity",
      delta: continuityDelta,
      deltaUnit: "pp",
      rawPoints: cappedPoints(
        continuityDelta,
        config.deductions.system.continuityPointsPerPoint,
        config.deductions.system.continuityCap,
      ),
      detail: `Routing continuity: ${continuityDelta.toFixed(3)} percentage-point difference`,
    });
  } else {
    skippedMetrics.push({
      category: "system",
      element: "System",
      metric: "Routing continuity",
      reason: "Continuity evidence is unavailable on one or both runs",
    });
  }
  return drafts;
}

function subcatchmentDrafts(
  reference: PreparedRun,
  candidate: PreparedRun,
  element: string,
  referenceSeries: ParsedTimeSeries,
  candidateSeries: ParsedTimeSeries,
  config: BillJamesModelScoreConfig,
  skippedMetrics: ModelScoreSkippedMetric[],
  shapeDiagnostics: ModelScoreShapeDiagnostic[],
): DeductionDraft[] {
  const runoff = pairedMetric(
    referenceSeries,
    candidateSeries,
    "subcatchment",
    element,
    "Runoff",
    skippedMetrics,
  );
  if (!runoff) return [];
  const duration = Math.max(reference.durationSeconds, 1);
  const flowVolumeFloor =
    config.absoluteFloors.volume ?? config.absoluteFloors.flow * duration;
  const refPeak = peak(runoff.reference);
  const candidatePeak = peak(runoff.candidate);
  const drafts: DeductionDraft[] = [
    percentDraft(
      "Runoff volume",
      percentDifference(
        integrate(runoff.reference, reference.grid),
        integrate(runoff.candidate, candidate.grid),
        flowVolumeFloor,
      ),
      config.deductions.subcatchment.runoffVolumePercentPerPoint,
      config.deductions.subcatchment.runoffVolumeCap,
    ),
    percentDraft(
      "Peak runoff",
      percentDifference(refPeak.value, candidatePeak.value, config.absoluteFloors.flow),
      config.deductions.subcatchment.peakRunoffPercentPerPoint,
      config.deductions.subcatchment.peakRunoffCap,
    ),
  ];
  if (
    refPeak.value > config.absoluteFloors.flow &&
    candidatePeak.value > config.absoluteFloors.flow
  ) {
    drafts.push({
      metric: "Runoff time to peak",
      delta: Math.abs(refPeak.index - candidatePeak.index),
      deltaUnit: "steps",
      rawPoints: cappedPoints(
        Math.abs(refPeak.index - candidatePeak.index),
        config.deductions.subcatchment.peakTimeStepsPerPoint,
        config.deductions.subcatchment.peakTimeCap,
      ),
      detail: `Runoff time to peak differs by ${Math.abs(refPeak.index - candidatePeak.index)} report steps`,
    });
  } else {
    skippedMetrics.push({
      category: "subcatchment",
      element,
      metric: "Runoff time to peak",
      reason: "One or both runoff peaks do not exceed the absolute flow floor",
    });
  }
  const diagnostic = shapeDiagnostic(
    runoff,
    "subcatchment",
    element,
    "Runoff",
    config.absoluteFloors.flow,
    config.shape.minimumWetSteps,
    skippedMetrics,
  );
  if (diagnostic) {
    shapeDiagnostics.push(diagnostic);
    drafts.push(efficiencyDraft(
      "Runoff KGE",
      diagnostic.kge,
      config.deductions.subcatchment.runoffKgeDeficitPerPoint,
      config.deductions.subcatchment.runoffKgeCap,
      `KGE-2009 ${diagnostic.kge.toFixed(3)} · r ${diagnostic.correlation.toFixed(3)} · α ${diagnostic.variabilityRatio.toFixed(3)} · β ${diagnostic.biasRatio.toFixed(3)}`,
    ));
  }
  return drafts;
}

function nodeDrafts(
  reference: PreparedRun,
  candidate: PreparedRun,
  element: string,
  referenceSeries: ParsedTimeSeries,
  candidateSeries: ParsedTimeSeries,
  config: BillJamesModelScoreConfig,
  skippedMetrics: ModelScoreSkippedMetric[],
  shapeDiagnostics: ModelScoreShapeDiagnostic[],
): DeductionDraft[] {
  const depth = pairedMetric(
    referenceSeries,
    candidateSeries,
    "node",
    element,
    "Depth",
    skippedMetrics,
  );
  const flooding = pairedMetric(
    referenceSeries,
    candidateSeries,
    "node",
    element,
    "Flooding",
    skippedMetrics,
  );
  const duration = Math.max(reference.durationSeconds, 1);
  const flowVolumeFloor =
    config.absoluteFloors.volume ?? config.absoluteFloors.flow * duration;
  const drafts: DeductionDraft[] = [];
  if (depth) {
    const refPeak = peak(depth.reference);
    const candidatePeak = peak(depth.candidate);
    drafts.push(percentDraft(
      "Peak depth",
      percentDifference(refPeak.value, candidatePeak.value, config.absoluteFloors.depth),
      config.deductions.node.peakDepthPercentPerPoint,
      config.deductions.node.peakDepthCap,
    ));
    if (
      refPeak.value > config.absoluteFloors.depth &&
      candidatePeak.value > config.absoluteFloors.depth
    ) {
      drafts.push({
        metric: "Depth time to peak",
        delta: Math.abs(refPeak.index - candidatePeak.index),
        deltaUnit: "steps",
        rawPoints: cappedPoints(
          Math.abs(refPeak.index - candidatePeak.index),
          config.deductions.node.peakTimeStepsPerPoint,
          config.deductions.node.peakTimeCap,
        ),
        detail: `Depth time to peak differs by ${Math.abs(refPeak.index - candidatePeak.index)} report steps`,
      });
    } else {
      skippedMetrics.push({
        category: "node",
        element,
        metric: "Depth time to peak",
        reason: "One or both depth peaks do not exceed the absolute depth floor",
      });
    }
    const diagnostic = shapeDiagnostic(
      depth,
      "node",
      element,
      "Depth",
      config.absoluteFloors.depth,
      config.shape.minimumWetSteps,
      skippedMetrics,
    );
    if (diagnostic) {
      shapeDiagnostics.push(diagnostic);
      drafts.push(
        efficiencyDraft(
          "Depth KGE",
          diagnostic.kge,
          config.deductions.node.depthKgeDeficitPerPoint,
          config.deductions.node.depthKgeCap,
          `KGE-2009 ${diagnostic.kge.toFixed(3)} · r ${diagnostic.correlation.toFixed(3)} · α ${diagnostic.variabilityRatio.toFixed(3)} · β ${diagnostic.biasRatio.toFixed(3)}`,
        ),
        efficiencyDraft(
          "Depth NSE",
          diagnostic.nse,
          config.deductions.node.depthNseDeficitPerPoint,
          config.deductions.node.depthNseCap,
          `NSE ${diagnostic.nse.toFixed(3)} over ${diagnostic.wetSamples} reference-wet report steps`,
        ),
      );
    }
  }
  if (flooding) {
    drafts.push(percentDraft(
      "Flood volume",
      percentDifference(
        integrate(flooding.reference, reference.grid),
        integrate(flooding.candidate, candidate.grid),
        flowVolumeFloor,
      ),
      config.deductions.node.floodVolumePercentPerPoint,
      config.deductions.node.floodVolumeCap,
    ));
  }
  return drafts;
}

function linkDrafts(
  reference: PreparedRun,
  candidate: PreparedRun,
  element: string,
  referenceSeries: ParsedTimeSeries,
  candidateSeries: ParsedTimeSeries,
  config: BillJamesModelScoreConfig,
  skippedMetrics: ModelScoreSkippedMetric[],
  shapeDiagnostics: ModelScoreShapeDiagnostic[],
): DeductionDraft[] {
  const flow = pairedMetric(
    referenceSeries,
    candidateSeries,
    "link",
    element,
    "Flow",
    skippedMetrics,
  );
  const velocity = pairedMetric(
    referenceSeries,
    candidateSeries,
    "link",
    element,
    "Velocity",
    skippedMetrics,
  );
  const duration = Math.max(reference.durationSeconds, 1);
  const flowVolumeFloor =
    config.absoluteFloors.volume ?? config.absoluteFloors.flow * duration;
  const drafts: DeductionDraft[] = [];
  if (flow) {
    const refFlowPeak = peak(flow.reference, true);
    const candidateFlowPeak = peak(flow.candidate, true);
    drafts.push(percentDraft(
      "Peak flow",
      percentDifference(refFlowPeak.value, candidateFlowPeak.value, config.absoluteFloors.flow),
      config.deductions.link.peakFlowPercentPerPoint,
      config.deductions.link.peakFlowCap,
    ));
    drafts.push(percentDraft(
      "Flow volume",
      percentDifference(
        integrate(flow.reference, reference.grid, true),
        integrate(flow.candidate, candidate.grid, true),
        flowVolumeFloor,
      ),
      config.deductions.link.flowVolumePercentPerPoint,
      config.deductions.link.flowVolumeCap,
    ));
    if (
      refFlowPeak.value > config.absoluteFloors.flow &&
      candidateFlowPeak.value > config.absoluteFloors.flow
    ) {
      drafts.push({
        metric: "Flow time to peak",
        delta: Math.abs(refFlowPeak.index - candidateFlowPeak.index),
        deltaUnit: "steps",
        rawPoints: cappedPoints(
          Math.abs(refFlowPeak.index - candidateFlowPeak.index),
          config.deductions.link.peakTimeStepsPerPoint,
          config.deductions.link.peakTimeCap,
        ),
        detail: `Flow time to peak differs by ${Math.abs(refFlowPeak.index - candidateFlowPeak.index)} report steps`,
      });
    } else {
      skippedMetrics.push({
        category: "link",
        element,
        metric: "Flow time to peak",
        reason: "One or both flow peaks do not exceed the absolute flow floor",
      });
    }
    const diagnostic = shapeDiagnostic(
      flow,
      "link",
      element,
      "Flow",
      config.absoluteFloors.flow,
      config.shape.minimumWetSteps,
      skippedMetrics,
    );
    if (diagnostic) {
      shapeDiagnostics.push(diagnostic);
      drafts.push(
        efficiencyDraft(
          "Flow KGE",
          diagnostic.kge,
          config.deductions.link.flowKgeDeficitPerPoint,
          config.deductions.link.flowKgeCap,
          `KGE-2009 ${diagnostic.kge.toFixed(3)} · r ${diagnostic.correlation.toFixed(3)} · α ${diagnostic.variabilityRatio.toFixed(3)} · β ${diagnostic.biasRatio.toFixed(3)}`,
        ),
        efficiencyDraft(
          "Flow NSE",
          diagnostic.nse,
          config.deductions.link.flowNseDeficitPerPoint,
          config.deductions.link.flowNseCap,
          `NSE ${diagnostic.nse.toFixed(3)} over ${diagnostic.wetSamples} reference-wet report steps`,
        ),
      );
    }
  }
  if (velocity) {
    const refVelocityPeak = peak(velocity.reference, true);
    const candidateVelocityPeak = peak(velocity.candidate, true);
    drafts.push(percentDraft(
      "Peak velocity",
      percentDifference(
        refVelocityPeak.value,
        candidateVelocityPeak.value,
        config.absoluteFloors.velocity,
      ),
      config.deductions.link.peakVelocityPercentPerPoint,
      config.deductions.link.peakVelocityCap,
    ));
  }
  return drafts;
}

export function modelScoreBand(score: number | undefined): string {
  if (score === undefined) return "No score";
  if (score >= 950) return "Virtually identical";
  if (score >= 900) return "Truly similar";
  if (score >= 850) return "Essentially similar";
  if (score >= 700) return "Same family — differences matter";
  return "Not comparable at these settings";
}

function noScore(maxScore: number, reason: string): BillJamesModelScoreResult {
  return {
    score: undefined,
    maxScore,
    band: modelScoreBand(undefined),
    categories: [],
    elements: [],
    deductions: [],
    gateReasons: [reason],
    skippedMetrics: [],
    shapeDiagnostics: [],
    extraCandidateElements: { subcatchment: [], node: [], link: [] },
  };
}

export function calculateBillJamesModelScore(
  referenceInput: ModelScoreRun,
  candidateInput: ModelScoreRun,
  config: BillJamesModelScoreConfig = BILL_JAMES_MODEL_SCORE_CONFIG,
): BillJamesModelScoreResult {
  let reference: PreparedRun;
  let candidate: PreparedRun;
  try {
    reference = prepareRun(referenceInput, "Reference");
    candidate = prepareRun(candidateInput, "Candidate");
    if (!gridsEqual(reference.grid, candidate.grid)) {
      throw new ScoreGateError("Reference and candidate report time grids differ");
    }
  } catch (error) {
    return noScore(
      config.maxScore,
      error instanceof Error ? error.message : "Comparison prerequisites are unavailable",
    );
  }

  try {
    const skippedMetrics: ModelScoreSkippedMetric[] = [];
    const shapeDiagnostics: ModelScoreShapeDiagnostic[] = [];
    const extraCandidateElements = candidateOnlyElements(reference, candidate);
    const elementsByCategory: Record<ModelScoreCategoryKey, ModelScoreElement[]> = {
      system: reference.system
        ? [scoreElement(
            "system",
            "System",
            systemDrafts(reference, candidate, config, skippedMetrics),
          )]
        : [],
      subcatchment: [],
      node: [],
      link: [],
    };

    for (const category of ["subcatchment", "node", "link"] as const) {
      for (const [key, referenceEntry] of reference.entities[category]) {
        const candidateEntry = candidate.entities[category].get(key);
        if (!candidateEntry) {
          elementsByCategory[category].push(missingElement(category, referenceEntry.id));
          continue;
        }
        const drafts = category === "subcatchment"
          ? subcatchmentDrafts(
              reference,
              candidate,
              referenceEntry.id,
              referenceEntry.series,
              candidateEntry.series,
              config,
              skippedMetrics,
              shapeDiagnostics,
            )
          : category === "node"
            ? nodeDrafts(
                reference,
                candidate,
                referenceEntry.id,
                referenceEntry.series,
                candidateEntry.series,
                config,
                skippedMetrics,
                shapeDiagnostics,
              )
            : linkDrafts(
                reference,
                candidate,
                referenceEntry.id,
                referenceEntry.series,
                candidateEntry.series,
                config,
                skippedMetrics,
                shapeDiagnostics,
              );
        elementsByCategory[category].push(scoreElement(category, referenceEntry.id, drafts));
      }
    }

    const populatedWeight = CATEGORY_ORDER.reduce(
      (sum, key) => sum + (
        elementsByCategory[key].length > 0 ? config.categories[key].weight : 0
      ),
      0,
    );
    if (populatedWeight <= 0) {
      throw new ScoreGateError("Reference report contains no scoreable categories");
    }

    const categories = CATEGORY_ORDER.map(key => {
      const spec = config.categories[key];
      const elements = elementsByCategory[key];
      const score = elements.length === 0
        ? 100
        : elements.reduce((sum, element) => sum + element.score, 0) / elements.length;
      const weight = elements.length === 0
        ? 0
        : spec.weight / populatedWeight * config.maxScore;
      const points = weight * score / 100;
      const scale = elements.length === 0 ? 0 : weight / 100 / elements.length;
      for (const element of elements) {
        for (const deduction of element.deductions) {
          deduction.points = deduction.elementPoints * scale;
        }
      }
      return {
        key,
        label: spec.label,
        weight,
        score,
        points,
        elementCount: elements.length,
        elements,
      };
    });
    const elements = categories.flatMap(category => category.elements);
    const deductions = elements
      .flatMap(element => element.deductions)
      .sort((a, b) => b.points - a.points);
    const score = categories.reduce((sum, category) => sum + category.points, 0);
    return {
      score,
      maxScore: config.maxScore,
      band: modelScoreBand(score),
      categories,
      elements,
      deductions,
      gateReasons: [],
      skippedMetrics,
      shapeDiagnostics,
      extraCandidateElements,
    };
  } catch (error) {
    return noScore(
      config.maxScore,
      error instanceof Error ? error.message : "Required comparison data is unavailable",
    );
  }
}

export interface RankedModelScore {
  index: number;
  label: string;
  result: BillJamesModelScoreResult;
}

export function rankBillJamesCandidates(
  reference: ModelScoreRun,
  candidates: Array<{ label: string; run: ModelScoreRun }>,
  config: BillJamesModelScoreConfig = BILL_JAMES_MODEL_SCORE_CONFIG,
): RankedModelScore[] {
  return candidates
    .map((candidate, index) => ({
      index,
      label: candidate.label,
      result: calculateBillJamesModelScore(reference, candidate.run, config),
    }))
    .sort((a, b) => {
      if (a.result.score === undefined && b.result.score === undefined) return a.index - b.index;
      if (a.result.score === undefined) return 1;
      if (b.result.score === undefined) return -1;
      return b.result.score - a.result.score || a.index - b.index;
    });
}