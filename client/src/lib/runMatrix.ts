// Run matrix: 1 model × N solver configurations. Builds the variant list from
// a small config form and turns finished results into chart series
// (continuity error / runtime / peak flow vs routing step).
// Plain .ts (no JSX) so node tests can import.

import type { ProcessResult } from "@shared/schema";
import { MAX_MATRIX_VARIANTS, type InpOverrides, type MatrixVariant } from "@shared/inpOptions";
import { extractScatterValues } from "./summaryScatter";

export { MAX_MATRIX_VARIANTS };
export type { MatrixVariant };

export interface RunMatrixConfig {
  /** Comma/space separated routing steps in seconds, e.g. "1, 5, 15, 30". */
  routingStepsText: string;
  /** Variable time step dimension: keep model default, off, on (0.75), or compare both. */
  variableStep: 'default' | 'off' | 'on' | 'both';
  /** Inertial damping dimension: keep model default, a single value, or compare all three. */
  inertialDamping: 'default' | 'NONE' | 'PARTIAL' | 'FULL' | 'all';
  /** Conduit lengthening step in seconds (empty = keep model default). */
  lengtheningStepText: string;
}

export const DEFAULT_MATRIX_CONFIG: RunMatrixConfig = {
  routingStepsText: '1, 5, 15, 30',
  variableStep: 'default',
  inertialDamping: 'default',
  lengtheningStepText: '',
};

/** Parse "1, 5, 15" into sorted unique routing steps (seconds, 0.1–3600). */
export function parseRoutingSteps(text: string): number[] {
  const seen = new Set<number>();
  for (const token of text.split(/[,\s]+/)) {
    if (!token) continue;
    const v = Number(token);
    if (Number.isFinite(v) && v >= 0.1 && v <= 3600) seen.add(v);
  }
  return Array.from(seen).sort((a, b) => a - b);
}

export interface MatrixBuild {
  variants: MatrixVariant[];
  errors: string[];
}

/** Expand the config into the full variant list (cross product of dimensions). */
export function buildMatrixVariants(config: RunMatrixConfig): MatrixBuild {
  const errors: string[] = [];
  const steps = parseRoutingSteps(config.routingStepsText);
  if (steps.length === 0) {
    errors.push('Enter at least one routing step between 0.1 and 3600 seconds.');
  }

  const vsChoices: (number | undefined)[] =
    config.variableStep === 'both' ? [0, 0.75]
      : config.variableStep === 'on' ? [0.75]
      : config.variableStep === 'off' ? [0]
      : [undefined];

  const idChoices: (InpOverrides['inertialDamping'] | undefined)[] =
    config.inertialDamping === 'all' ? ['NONE', 'PARTIAL', 'FULL']
      : config.inertialDamping === 'default' ? [undefined]
      : [config.inertialDamping];

  let lengtheningStep: number | undefined;
  if (config.lengtheningStepText.trim() !== '') {
    const v = Number(config.lengtheningStepText);
    if (!Number.isFinite(v) || v < 0 || v > 3600) {
      errors.push('Conduit lengthening step must be between 0 and 3600 seconds.');
    } else {
      lengtheningStep = v;
    }
  }

  const variants: MatrixVariant[] = [];
  for (const rs of steps) {
    for (const vs of vsChoices) {
      for (const id of idChoices) {
        const parts = [`RS ${rs}s`];
        if (vs !== undefined) parts.push(vs > 0 ? `VS on` : 'VS off');
        if (id !== undefined) parts.push(`ID ${id.toLowerCase()}`);
        variants.push({
          label: parts.join(' · '),
          overrides: {
            routingStepSeconds: rs,
            ...(vs !== undefined ? { variableStep: vs } : {}),
            ...(id !== undefined ? { inertialDamping: id } : {}),
            ...(lengtheningStep !== undefined ? { lengtheningStep } : {}),
          },
        });
      }
    }
  }

  if (variants.length > MAX_MATRIX_VARIANTS) {
    errors.push(`This matrix has ${variants.length} variants — the maximum is ${MAX_MATRIX_VARIANTS}. Remove routing steps or dimensions.`);
  }
  if (variants.length < 2 && errors.length === 0) {
    errors.push('A run matrix needs at least 2 variants — add more routing steps or another dimension.');
  }

  return { variants, errors };
}

/** Find the variant a result belongs to by the "[label]" suffix in its file name. */
export function variantForResult(result: ProcessResult, variants: MatrixVariant[]): MatrixVariant | undefined {
  const m = result.fileName.match(/\[([^\]]+)\]\.inp$/);
  if (!m) return undefined;
  return variants.find(v => v.label === m[1]);
}

/** System peak flow = largest max |flow| across all links in the report. */
export function peakFlowFromReport(reportContent: string): number | undefined {
  const { flows } = extractScatterValues(reportContent);
  let peak: number | undefined;
  for (const v of flows.values()) {
    if (peak === undefined || v > peak) peak = v;
  }
  return peak;
}

export interface MatrixPoint {
  routingStep: number;
  /** Series key: everything in the label except the routing step. */
  series: string;
  label: string;
  status: ProcessResult['status'];
  routingCE?: number;
  runoffCE?: number;
  runtimeSeconds?: number;
  peakFlow?: number;
}

/** One point per successful variant run, ready for the accuracy-vs-speed charts. */
export function buildMatrixPoints(results: ProcessResult[], variants: MatrixVariant[]): MatrixPoint[] {
  const points: MatrixPoint[] = [];
  for (const r of results) {
    const variant = variantForResult(r, variants);
    if (!variant || variant.overrides.routingStepSeconds === undefined) continue;
    const series = variant.label
      .split(' · ')
      .filter(p => !/^RS /.test(p))
      .join(' · ') || 'All runs';
    points.push({
      routingStep: variant.overrides.routingStepSeconds,
      series,
      label: variant.label,
      status: r.status,
      routingCE: r.parsedMetrics?.routingContinuityError,
      runoffCE: r.parsedMetrics?.runoffContinuityError,
      runtimeSeconds: r.processingTime,
      peakFlow: r.reportContent ? peakFlowFromReport(r.reportContent) : undefined,
    });
  }
  return points.sort((a, b) => a.series.localeCompare(b.series) || a.routingStep - b.routingStep);
}
