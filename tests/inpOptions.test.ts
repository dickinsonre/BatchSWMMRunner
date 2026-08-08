import { describe, it, expect } from 'vitest';
import { applyInpOverrides, normalizeSwmm6Options } from '../shared/inpOptions';

const BASE_INP = `[TITLE]
Demo

[OPTIONS]
FLOW_UNITS           CFS
FLOW_ROUTING         DYNWAVE
REPORT_STEP          00:15:00

[JUNCTIONS]
J1  100  10
`;

describe('applyInpOverrides — SWMM6 options', () => {
  it('does nothing when swmm6 flag is off', () => {
    expect(applyInpOverrides(BASE_INP, { swmm6: { enabled: false, dynamicSlot: true } })).toBe(BASE_INP);
    expect(applyInpOverrides(BASE_INP, {})).toBe(BASE_INP);
  });

  it('writes DYNAMIC_SLOT with tuning values into [OPTIONS]', () => {
    const out = applyInpOverrides(BASE_INP, {
      swmm6: { enabled: true, dynamicSlot: true, dpsCelerity: 20, dpsAlpha: 3, dpsDecayTime: 0.5 },
    });
    const options = out.slice(out.indexOf('[OPTIONS]'), out.indexOf('[JUNCTIONS]'));
    expect(options).toMatch(/^SURCHARGE_METHOD\s+DYNAMIC_SLOT$/m);
    expect(options).toMatch(/^DPS_CELERITY\s+20$/m);
    expect(options).toMatch(/^DPS_ALPHA\s+3$/m);
    expect(options).toMatch(/^DPS_DECAY_TIME\s+0.5$/m);
  });

  it('omits DPS tuning lines when values are not provided (engine defaults apply)', () => {
    const out = applyInpOverrides(BASE_INP, { swmm6: { enabled: true, dynamicSlot: true } });
    expect(out).toMatch(/^SURCHARGE_METHOD\s+DYNAMIC_SLOT$/m);
    expect(out).not.toMatch(/DPS_CELERITY|DPS_ALPHA|DPS_DECAY_TIME/);
  });

  it('writes NODE_CONTINUITY and ANDERSON_ACCEL independently of dynamic slot', () => {
    const out = applyInpOverrides(BASE_INP, {
      swmm6: { enabled: true, semiImplicit: true, andersonAccel: true },
    });
    expect(out).toMatch(/^NODE_CONTINUITY\s+SEMI_IMPLICIT$/m);
    expect(out).toMatch(/^ANDERSON_ACCEL\s+YES$/m);
    expect(out).not.toMatch(/SURCHARGE_METHOD\s+DYNAMIC_SLOT/);
  });

  it('replaces an existing SURCHARGE_METHOD line instead of duplicating it', () => {
    const withExisting = BASE_INP.replace(
      'REPORT_STEP          00:15:00',
      'REPORT_STEP          00:15:00\nSURCHARGE_METHOD     EXTRAN',
    );
    const out = applyInpOverrides(withExisting, { swmm6: { enabled: true, dynamicSlot: true } });
    expect(out.match(/SURCHARGE_METHOD/g)?.length).toBe(1);
    expect(out).toMatch(/SURCHARGE_METHOD\s+DYNAMIC_SLOT/);
  });

  it('replaces a lower-case, indented existing key (SWMM keywords are case-insensitive)', () => {
    const withExisting = BASE_INP.replace(
      'REPORT_STEP          00:15:00',
      'REPORT_STEP          00:15:00\n  surcharge_method   slot',
    );
    const out = applyInpOverrides(withExisting, { swmm6: { enabled: true, dynamicSlot: true } });
    expect(out.match(/surcharge_method/gi)?.length).toBe(1);
    expect(out).toMatch(/SURCHARGE_METHOD\s+DYNAMIC_SLOT/);
  });

  it('normalizeSwmm6Options rejects non-finite and out-of-range tuning values', () => {
    const norm = normalizeSwmm6Options({
      enabled: true, dynamicSlot: true,
      dpsCelerity: Infinity, dpsAlpha: 1, dpsDecayTime: NaN,
    });
    expect(norm).toEqual({ enabled: true, dynamicSlot: true });
    expect(normalizeSwmm6Options({ enabled: true })).toBeUndefined();
    expect(normalizeSwmm6Options({ enabled: false, andersonAccel: true })).toBeUndefined();
    expect(normalizeSwmm6Options(null)).toBeUndefined();
  });

  it('composes with regular overrides', () => {
    const out = applyInpOverrides(BASE_INP, {
      reportStepMinutes: 5,
      swmm6: { enabled: true, andersonAccel: true },
    });
    expect(out).toMatch(/REPORT_STEP\s+00:05:00/);
    expect(out).toMatch(/ANDERSON_ACCEL\s+YES/);
  });
});
