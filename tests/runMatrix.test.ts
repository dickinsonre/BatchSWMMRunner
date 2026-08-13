import { describe, it, expect } from 'vitest';
import { applyInpOverrides, MAX_MATRIX_VARIANTS } from '../shared/inpOptions';
import {
  buildMatrixVariants,
  parseRoutingSteps,
  variantForResult,
  peakFlowFromReport,
  buildMatrixPoints,
  DEFAULT_MATRIX_CONFIG,
} from '../client/src/lib/runMatrix';
import type { ProcessResult } from '../shared/schema';

const BASE_INP = `[TITLE]
Demo

[OPTIONS]
FLOW_UNITS           CFS
FLOW_ROUTING         DYNWAVE
ROUTING_STEP         00:00:30

[JUNCTIONS]
J1  100  10
`;

describe('applyInpOverrides — solver matrix keywords', () => {
  it('writes VARIABLE_STEP, LENGTHENING_STEP and INERTIAL_DAMPING', () => {
    const out = applyInpOverrides(BASE_INP, {
      routingStepSeconds: 5,
      variableStep: 0.75,
      lengtheningStep: 10,
      inertialDamping: 'PARTIAL',
    });
    expect(out).toMatch(/ROUTING_STEP\s+00:00:05/);
    expect(out).toMatch(/VARIABLE_STEP\s+0\.75/);
    expect(out).toMatch(/LENGTHENING_STEP\s+10/);
    expect(out).toMatch(/INERTIAL_DAMPING\s+PARTIAL/);
  });

  it('writes VARIABLE_STEP 0 to disable variable stepping and caps at 2', () => {
    const off = applyInpOverrides(BASE_INP, { variableStep: 0 });
    expect(off).toMatch(/VARIABLE_STEP\s+0\b/);
    const capped = applyInpOverrides(BASE_INP, { variableStep: 5 });
    expect(capped).toMatch(/VARIABLE_STEP\s+2\b/);
  });

  it('leaves the file unchanged when no solver overrides are set', () => {
    expect(applyInpOverrides(BASE_INP, {})).toBe(BASE_INP);
  });
});

describe('parseRoutingSteps', () => {
  it('parses, dedupes, sorts, and bounds-checks', () => {
    expect(parseRoutingSteps('30, 5 15,5, 9999, -1, abc')).toEqual([5, 15, 30]);
    expect(parseRoutingSteps('')).toEqual([]);
  });
});

describe('buildMatrixVariants', () => {
  it('builds one variant per routing step by default', () => {
    const { variants, errors } = buildMatrixVariants(DEFAULT_MATRIX_CONFIG);
    expect(errors).toEqual([]);
    expect(variants.map(v => v.overrides.routingStepSeconds)).toEqual([1, 5, 15, 30]);
    expect(variants[0].label).toBe('RS 1s');
  });

  it('crosses routing steps with variable-step both', () => {
    const { variants, errors } = buildMatrixVariants({
      ...DEFAULT_MATRIX_CONFIG,
      routingStepsText: '5, 15',
      variableStep: 'both',
    });
    expect(errors).toEqual([]);
    expect(variants).toHaveLength(4);
    expect(variants.map(v => v.label)).toContain('RS 5s · VS on');
    expect(variants.find(v => v.label === 'RS 5s · VS off')?.overrides.variableStep).toBe(0);
  });

  it('rejects oversized matrices and empty step lists', () => {
    const big = buildMatrixVariants({
      routingStepsText: Array.from({ length: 10 }, (_, i) => i + 1).join(','),
      variableStep: 'both',
      inertialDamping: 'all',
      lengtheningStepText: '',
    });
    expect(big.variants.length).toBeGreaterThan(MAX_MATRIX_VARIANTS);
    expect(big.errors.join(' ')).toMatch(/maximum/);

    const empty = buildMatrixVariants({ ...DEFAULT_MATRIX_CONFIG, routingStepsText: 'x' });
    expect(empty.errors.length).toBeGreaterThan(0);
  });

  it('requires at least two variants', () => {
    const one = buildMatrixVariants({ ...DEFAULT_MATRIX_CONFIG, routingStepsText: '5' });
    expect(one.errors.join(' ')).toMatch(/at least 2/);
  });

  it('applies a lengthening step to every variant', () => {
    const { variants } = buildMatrixVariants({ ...DEFAULT_MATRIX_CONFIG, lengtheningStepText: '10' });
    expect(variants.every(v => v.overrides.lengtheningStep === 10)).toBe(true);
  });
});

const REPORT = `
  Link Flow Summary
  *****************

  ------------------------------------------------------------------------------
                                 Maximum  Time of Max   Maximum    Max/    Max/
                                  |Flow|   Occurrence   |Veloc|    Full    Full
  Link                 Type          CFS  days hr:min    ft/sec    Flow   Depth
  ------------------------------------------------------------------------------
  C1                   CONDUIT     12.50     0  01:15      4.32    0.85    0.72
  C2                   CONDUIT      7.10     0  01:20      3.10    0.60    0.55
`;

function fakeResult(fileName: string, over: Partial<ProcessResult> = {}): ProcessResult {
  return {
    id: fileName,
    fileName,
    filePath: fileName,
    status: 'success',
    processingTime: 1.5,
    parsedMetrics: { routingContinuityError: -0.2, runoffContinuityError: 0.1 },
    reportContent: REPORT,
    ...over,
  } as ProcessResult;
}

describe('run matrix result mapping', () => {
  const { variants } = buildMatrixVariants({ ...DEFAULT_MATRIX_CONFIG, routingStepsText: '5, 15' });

  it('maps results back to variants by the [label] suffix', () => {
    const r = fakeResult('model [RS 5s].inp');
    expect(variantForResult(r, variants)?.overrides.routingStepSeconds).toBe(5);
    expect(variantForResult(fakeResult('model.inp'), variants)).toBeUndefined();
  });

  it('extracts the system peak flow from the report', () => {
    expect(peakFlowFromReport(REPORT)).toBe(12.5);
  });

  it('builds sorted chart points with CE, runtime, and peak flow', () => {
    const points = buildMatrixPoints(
      [fakeResult('model [RS 15s].inp'), fakeResult('model [RS 5s].inp')],
      variants,
    );
    expect(points.map(p => p.routingStep)).toEqual([5, 15]);
    expect(points[0].routingCE).toBe(-0.2);
    expect(points[0].runtimeSeconds).toBe(1.5);
    expect(points[0].peakFlow).toBe(12.5);
    expect(points[0].series).toBe('All runs');
  });
});
