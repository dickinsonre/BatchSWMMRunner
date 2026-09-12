import { parseReportTimestamp } from "./engineComparison";
import type { ParsedTimeSeries } from "./parseTimeSeries";

export const BILL_JAMES_COMPONENTS = [
  { key: "mean", label: "Mean difference", weight: 10, tolerance: 10 },
  { key: "rmse", label: "RMSE", weight: 20, tolerance: 10 },
  { key: "mape", label: "MAPE", weight: 15, tolerance: 50 },
  { key: "stdDev", label: "Standard deviation difference", weight: 10, tolerance: 5 },
  { key: "skewness", label: "Skewness difference", weight: 5, tolerance: 1 },
  { key: "kurtosis", label: "Kurtosis difference", weight: 5, tolerance: 1 },
  { key: "logNse", label: "Log NSE error", weight: 10, tolerance: 1 },
  { key: "indexOfAgreement", label: "Index of agreement error", weight: 10, tolerance: 1 },
  { key: "integralSquareError", label: "Integral square error / sample", weight: 5, tolerance: 10 },
  { key: "correlation", label: "Correlation error", weight: 5, tolerance: 1 },
  { key: "nse", label: "NSE error", weight: 5, tolerance: 1 },
  { key: "klingGupta", label: "Kling–Gupta error", weight: 5, tolerance: 1 },
] as const;

export type BillJamesComponentKey = typeof BILL_JAMES_COMPONENTS[number]["key"];

export interface BillJamesComponentScore {
  key: BillJamesComponentKey;
  label: string;
  weight: number;
  tolerance: number;
  /** Error supplied to the 0–100 scoring function; zero is ideal. */
  rawValue: number | undefined;
  score: number | undefined;
  unavailableReason?: string;
}

export interface BillJamesSimilarityResult {
  score: number | undefined;
  components: BillJamesComponentScore[];
  pairedSamples: number;
  availableWeight: number;
  totalWeight: number;
  reason?: string;
}

export interface BillJamesVariableResult extends BillJamesSimilarityResult {
  name: string;
  unit: string;
  referenceSamples: number;
  candidateSamples: number;
  coverage: number;
  /** Calculated from exact shared timestamps, but excluded from the headline because coverage is incomplete. */
  partialScore?: number;
}

export interface BillJamesSystemComparison {
  score: number | undefined;
  variables: BillJamesVariableResult[];
  comparableVariables: number;
  partialVariables: number;
  totalVariables: number;
  reason?: string;
}

const EPSILON = 1e-12;
const LOG_EPSILON = 1e-6;

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
}

function skewness(values: number[]): number {
  const average = mean(values);
  const deviation = standardDeviation(values);
  if (deviation <= EPSILON) return 0;
  return values.reduce((sum, value) => sum + ((value - average) / deviation) ** 3, 0) / values.length;
}

function kurtosis(values: number[]): number {
  const average = mean(values);
  const deviation = standardDeviation(values);
  if (deviation <= EPSILON) return 0;
  return values.reduce((sum, value) => sum + ((value - average) / deviation) ** 4, 0) / values.length - 3;
}

function rmse(reference: number[], candidate: number[]): number {
  return Math.sqrt(
    reference.reduce((sum, value, index) => sum + (value - candidate[index]) ** 2, 0) /
    reference.length,
  );
}

function mape(reference: number[], candidate: number[]): number {
  return reference.reduce((sum, value, index) => {
    const adjustedReference = Math.abs(value) < LOG_EPSILON ? LOG_EPSILON : value;
    return sum +
      Math.abs(adjustedReference - candidate[index]) / Math.abs(adjustedReference) * 100;
  }, 0) / reference.length;
}

function nashSutcliffe(candidate: number[], reference: number[]): number | undefined {
  const referenceMean = mean(reference);
  const numerator = reference.reduce(
    (sum, value, index) => sum + (value - candidate[index]) ** 2,
    0,
  );
  const denominator = reference.reduce((sum, value) => sum + (value - referenceMean) ** 2, 0);
  if (denominator <= EPSILON) return undefined;
  return 1 - numerator / denominator;
}

function indexOfAgreement(candidate: number[], reference: number[]): number | undefined {
  const referenceMean = mean(reference);
  const numerator = reference.reduce(
    (sum, value, index) => sum + (value - candidate[index]) ** 2,
    0,
  );
  const denominator = reference.reduce(
    (sum, value, index) =>
      sum + (Math.abs(candidate[index] - referenceMean) + Math.abs(value - referenceMean)) ** 2,
    0,
  );
  if (denominator <= EPSILON) return undefined;
  return 1 - numerator / denominator;
}

function correlation(reference: number[], candidate: number[]): number | undefined {
  const referenceMean = mean(reference);
  const candidateMean = mean(candidate);
  let covariance = 0;
  let referenceSquares = 0;
  let candidateSquares = 0;
  for (let index = 0; index < reference.length; index++) {
    const referenceDelta = reference[index] - referenceMean;
    const candidateDelta = candidate[index] - candidateMean;
    covariance += referenceDelta * candidateDelta;
    referenceSquares += referenceDelta ** 2;
    candidateSquares += candidateDelta ** 2;
  }
  const denominator = Math.sqrt(referenceSquares * candidateSquares);
  if (denominator <= EPSILON) return undefined;
  return covariance / denominator;
}

function klingGupta(candidate: number[], reference: number[]): number | undefined {
  const coefficient = correlation(reference, candidate);
  const referenceDeviation = standardDeviation(reference);
  const referenceMean = mean(reference);
  if (coefficient === undefined || referenceDeviation <= EPSILON || Math.abs(referenceMean) <= EPSILON) {
    return undefined;
  }
  const alpha = standardDeviation(candidate) / referenceDeviation;
  const beta = mean(candidate) / referenceMean;
  return 1 - Math.sqrt((coefficient - 1) ** 2 + (alpha - 1) ** 2 + (beta - 1) ** 2);
}

function scoreForError(value: number, tolerance: number): number {
  return Math.max(0, Math.min(100, 100 * (1 - value / tolerance)));
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
}

function emptyComponents(reason: string): BillJamesComponentScore[] {
  return BILL_JAMES_COMPONENTS.map(component => ({
    ...component,
    rawValue: undefined,
    score: undefined,
    unavailableReason: reason,
  }));
}

/**
 * Apply the published demonstration Bill James scoring template to paired data.
 * The reference/background array is intentionally first because MAPE, NSE, and
 * KGE make this a directional comparison.
 */
export function calculateBillJamesSimilarity(
  referenceValues: number[],
  candidateValues: number[],
): BillJamesSimilarityResult {
  const count = Math.min(referenceValues.length, candidateValues.length);
  const pairs = Array.from({ length: count }, (_, index) => ({
    reference: referenceValues[index],
    candidate: candidateValues[index],
  })).filter(pair => Number.isFinite(pair.reference) && Number.isFinite(pair.candidate));
  const totalWeight = BILL_JAMES_COMPONENTS.reduce((sum, component) => sum + component.weight, 0);

  if (pairs.length < 2) {
    const reason = "At least two paired finite samples are required";
    return {
      score: undefined,
      components: emptyComponents(reason),
      pairedSamples: pairs.length,
      availableWeight: 0,
      totalWeight,
      reason,
    };
  }

  const reference = pairs.map(pair => pair.reference);
  const candidate = pairs.map(pair => pair.candidate);
  const identical = reference.every((value, index) => nearlyEqual(value, candidate[index]));
  if (identical) {
    return {
      score: 100,
      components: BILL_JAMES_COMPONENTS.map(component => ({
        ...component,
        rawValue: 0,
        score: 100,
      })),
      pairedSamples: pairs.length,
      availableWeight: totalWeight,
      totalWeight,
    };
  }

  const referenceMean = mean(reference);
  const candidateMean = mean(candidate);
  const logReference = reference.map(value => Math.log(Math.abs(value) + LOG_EPSILON));
  const logCandidate = candidate.map(value => Math.log(Math.abs(value) + LOG_EPSILON));
  // Match the published Ruby template exactly: unlike ordinary NSE below,
  // log NSE treats the current/candidate log series as the observed series.
  const logNse = nashSutcliffe(logReference, logCandidate);
  const agreement = indexOfAgreement(candidate, reference);
  const coefficient = correlation(reference, candidate);
  const nse = nashSutcliffe(candidate, reference);
  const kge = klingGupta(candidate, reference);

  const rawValues: Record<BillJamesComponentKey, number | undefined> = {
    mean: Math.abs(referenceMean - candidateMean),
    rmse: rmse(reference, candidate),
    mape: mape(reference, candidate),
    stdDev: Math.abs(standardDeviation(reference) - standardDeviation(candidate)),
    skewness: Math.abs(skewness(reference) - skewness(candidate)),
    kurtosis: Math.abs(kurtosis(reference) - kurtosis(candidate)),
    logNse: logNse === undefined ? undefined : Math.abs(1 - logNse),
    indexOfAgreement: agreement === undefined ? undefined : Math.abs(1 - agreement),
    integralSquareError: reference.reduce(
      (sum, value, index) => sum + (value - candidate[index]) ** 2,
      0,
    ) / reference.length,
    correlation: coefficient === undefined ? undefined : Math.abs(1 - coefficient),
    nse: nse === undefined ? undefined : Math.abs(1 - nse),
    klingGupta: kge === undefined ? undefined : Math.abs(1 - kge),
  };

  const components = BILL_JAMES_COMPONENTS.map(component => {
    const rawValue = rawValues[component.key];
    return {
      ...component,
      rawValue,
      score: rawValue === undefined ? undefined : scoreForError(rawValue, component.tolerance),
      unavailableReason: rawValue === undefined
        ? "Undefined for a constant or zero reference series"
        : undefined,
    };
  });
  const available = components
    .filter(component => component.score !== undefined && Number.isFinite(component.score))
    .map(component => ({ ...component, score: component.score! }));
  const availableWeight = available.reduce((sum, component) => sum + component.weight, 0);
  const score = availableWeight > 0
    ? available.reduce((sum, component) => sum + component.score * component.weight, 0) /
      availableWeight
    : undefined;

  return {
    score,
    components,
    pairedSamples: pairs.length,
    availableWeight,
    totalWeight,
    reason: score === undefined ? "No Bill James components could be evaluated" : undefined,
  };
}

function metricIndex(series: ParsedTimeSeries, metric: string): number {
  const normalized = metric.trim().toLowerCase();
  return series.columns.findIndex(column => column.trim().toLowerCase() === normalized);
}

function elapsedValues(series: ParsedTimeSeries, columnIndex: number): Map<number, number> {
  const points = series.data.map(point => ({
    timestamp: parseReportTimestamp(point.time),
    value: point.values[columnIndex],
  }));
  const start = points.find(point => Number.isFinite(point.timestamp))?.timestamp;
  if (start === undefined) return new Map();
  const values = new Map<number, number>();
  for (const point of points) {
    if (!Number.isFinite(point.timestamp) || !Number.isFinite(point.value)) continue;
    values.set(Math.round((point.timestamp - start) / 1000), point.value);
  }
  return values;
}

export function compareSystemVariable(
  reference: ParsedTimeSeries,
  candidate: ParsedTimeSeries,
  metric: string,
): BillJamesVariableResult {
  const referenceIndex = metricIndex(reference, metric);
  const candidateIndex = metricIndex(candidate, metric);
  const unit = referenceIndex >= 0 ? reference.units[referenceIndex] ?? "" : "";
  const base = { name: metric, unit, referenceSamples: 0, candidateSamples: 0, coverage: 0 };
  if (referenceIndex < 0 || candidateIndex < 0) {
    const reason = referenceIndex < 0
      ? "Variable is not reported by the reference engine"
      : "Variable is not reported by the candidate engine";
    return {
      ...base,
      score: undefined,
      components: emptyComponents(reason),
      pairedSamples: 0,
      availableWeight: 0,
      totalWeight: BILL_JAMES_COMPONENTS.reduce((sum, component) => sum + component.weight, 0),
      reason,
    };
  }

  const candidateUnit = candidate.units[candidateIndex] ?? "";
  const referenceByTime = elapsedValues(reference, referenceIndex);
  const candidateByTime = elapsedValues(candidate, candidateIndex);
  const sampleCounts = {
    referenceSamples: referenceByTime.size,
    candidateSamples: candidateByTime.size,
  };
  if (!unit.trim() || !candidateUnit.trim()) {
    const reason = "Units are missing for one or both engines";
    return {
      ...base,
      ...sampleCounts,
      score: undefined,
      components: emptyComponents(reason),
      pairedSamples: 0,
      availableWeight: 0,
      totalWeight: BILL_JAMES_COMPONENTS.reduce((sum, component) => sum + component.weight, 0),
      reason,
    };
  }
  if (unit.trim().toLowerCase() !== candidateUnit.trim().toLowerCase()) {
    const reason = `Units differ (${unit} vs ${candidateUnit})`;
    return {
      ...base,
      ...sampleCounts,
      score: undefined,
      components: emptyComponents(reason),
      pairedSamples: 0,
      availableWeight: 0,
      totalWeight: BILL_JAMES_COMPONENTS.reduce((sum, component) => sum + component.weight, 0),
      reason,
    };
  }

  const referenceValues: number[] = [];
  const candidateValues: number[] = [];
  for (const [elapsedSeconds, value] of referenceByTime) {
    const candidateValue = candidateByTime.get(elapsedSeconds);
    if (candidateValue === undefined) continue;
    referenceValues.push(value);
    candidateValues.push(candidateValue);
  }
  const result = calculateBillJamesSimilarity(referenceValues, candidateValues);
  const coverage = Math.max(referenceByTime.size, candidateByTime.size) > 0
    ? result.pairedSamples / Math.max(referenceByTime.size, candidateByTime.size)
    : 0;
  if (result.score !== undefined && coverage < 1 - EPSILON) {
    return {
      ...base,
      ...result,
      ...sampleCounts,
      score: undefined,
      partialScore: result.score,
      coverage,
      reason: `Partial elapsed-time coverage (${result.pairedSamples} of ${Math.max(referenceByTime.size, candidateByTime.size)} unique samples); diagnostic score excluded from the overall index`,
    };
  }
  return {
    ...base,
    ...result,
    ...sampleCounts,
    coverage,
  };
}

/** Compare every system variable reported by either engine. */
export function compareSystemSeries(
  reference: ParsedTimeSeries | null,
  candidate: ParsedTimeSeries | null,
): BillJamesSystemComparison {
  if (!reference || !candidate) {
    return {
      score: undefined,
      variables: [],
      comparableVariables: 0,
      partialVariables: 0,
      totalVariables: 0,
      reason: "System time-series data is unavailable for one or both engines",
    };
  }

  const names = new Map<string, string>();
  for (const name of [...reference.columns, ...candidate.columns]) {
    const normalized = name.trim().toLowerCase();
    if (normalized && !names.has(normalized)) names.set(normalized, name.trim());
  }
  const variables = Array.from(names.values()).map(name =>
    compareSystemVariable(reference, candidate, name)
  );
  const comparable = variables.filter(
    (variable): variable is BillJamesVariableResult & { score: number } =>
      variable.score !== undefined && Number.isFinite(variable.score),
  );
  const partialVariables = variables.filter(
    variable => variable.partialScore !== undefined && Number.isFinite(variable.partialScore),
  ).length;
  return {
    score: comparable.length > 0
      ? comparable.reduce((sum, variable) => sum + variable.score, 0) / comparable.length
      : undefined,
    variables,
    comparableVariables: comparable.length,
    partialVariables,
    totalVariables: variables.length,
    reason: comparable.length === 0
      ? partialVariables > 0
        ? "Only partial-coverage variable scores are available; they are excluded from the overall index"
        : "No system variables have enough compatible paired samples"
      : undefined,
  };
}