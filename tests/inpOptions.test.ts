import { describe, it, expect } from 'vitest';
import {
  applyInpOverrides,
  normalizeSwmm6Options,
  upgradeVirtualJunctions,
  stripVirtualJunctions,
  hasVirtualJunctions,
} from '../shared/inpOptions';

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

  it('writes FLOW_ROUTING FV and scheme keywords, overriding the routing dropdown', () => {
    const out = applyInpOverrides(BASE_INP, {
      flowRouting: 'dynamic',
      swmm6: {
        enabled: true, fvRouting: true, fvOrder: 2,
        fvLimiter: 'minmod', fvTimeIntegration: 'EULER', fvRiemann: 'HLLC',
      },
    });
    expect(out.match(/FLOW_ROUTING/g)?.length).toBe(1);
    expect(out).toMatch(/^FLOW_ROUTING\s+FV$/m);
    expect(out).toMatch(/^FV_ORDER\s+2$/m);
    expect(out).toMatch(/^FV_LIMITER\s+MINMOD$/m);
    expect(out).toMatch(/^FV_TIME_INTEGRATION\s+EULER$/m);
    expect(out).toMatch(/^FV_RIEMANN\s+HLLC$/m);
  });

  it('omits FV scheme lines when values are not provided (engine defaults apply)', () => {
    const out = applyInpOverrides(BASE_INP, { swmm6: { enabled: true, fvRouting: true } });
    expect(out).toMatch(/^FLOW_ROUTING\s+FV$/m);
    expect(out).not.toMatch(/FV_ORDER|FV_LIMITER|FV_TIME_INTEGRATION|FV_RIEMANN/);
  });

  it('normalizeSwmm6Options rejects bad FV values but keeps the routing flag', () => {
    const norm = normalizeSwmm6Options({
      enabled: true, fvRouting: true,
      fvOrder: 3, fvLimiter: 'not a token!', fvTimeIntegration: '', fvRiemann: 42,
    });
    expect(norm).toEqual({ enabled: true, fvRouting: true });
    expect(normalizeSwmm6Options({ enabled: true, fvRouting: false, fvOrder: 2 })).toBeUndefined();
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

const VJ_INP = `[TITLE]
VJ demo

[OPTIONS]
FLOW_UNITS           CFS
FLOW_ROUTING         DYNWAVE

[JUNCTIONS]
J1               100        4          0          0          0
J2               97.5       4          0          0          0
J3               96         4          0          0          0

[OUTFALLS]
O1               95         FREE                        NO

[CONDUITS]
C1               J1               J2               200        0.013      0          0          0          0
C2               J2               J3               200        0.013      0          0          0          0
C3               J3               O1               200        0.013      0          0          0          0

[DWF]
J3               FLOW       0.5

[XSECTIONS]
C1               CIRCULAR     1.5              0          0          0          1
`;

describe('virtual junctions — upgrade and strip', () => {
  it('moves only eligible junctions (exactly 2 conduits, no inflows/DWF)', () => {
    const { content, moved, warnings } = upgradeVirtualJunctions(VJ_INP);
    // J1 has 1 conduit, J3 has DWF — only J2 is eligible.
    expect(moved).toEqual(['J2']);
    expect(warnings).toEqual([]);
    expect(hasVirtualJunctions(content)).toBe(true);
    const vjSection = content.slice(content.indexOf('[VIRTUAL_JUNCTIONS]'), content.indexOf('[OUTFALLS]'));
    // Name + invert only — a third token is a parse error in the engine.
    expect(vjSection).toMatch(/^J2\s+97\.5\s*$/m);
    // Removed from [JUNCTIONS]; J1 and J3 stay.
    const jSection = content.slice(content.indexOf('[JUNCTIONS]'), content.indexOf('[VIRTUAL_JUNCTIONS]'));
    expect(jSection).not.toMatch(/^J2\b/m);
    expect(jSection).toMatch(/^J1\b/m);
    expect(jSection).toMatch(/^J3\b/m);
  });

  it('is a no-op with a warning when nothing is eligible', () => {
    const noConduits = VJ_INP.replace(/\[CONDUITS\][\s\S]*?\n\n/, '');
    const { content, moved, warnings } = upgradeVirtualJunctions(noConduits);
    expect(moved).toEqual([]);
    expect(warnings.length).toBe(1);
    expect(content).toBe(noConduits);
  });

  it('applyInpOverrides applies the structural edit and writes VIRTUAL_JUNCTION_MOMENTUM', () => {
    const out = applyInpOverrides(VJ_INP, {
      swmm6: { enabled: true, virtualJunctions: true, vjMomentum: 'BASIC' },
    });
    expect(out).toMatch(/^VIRTUAL_JUNCTION_MOMENTUM\s+BASIC$/m);
    expect(hasVirtualJunctions(out)).toBe(true);
  });

  it('applyInpOverrides defaults momentum to FULL and skips the keyword when nothing moved', () => {
    const out = applyInpOverrides(VJ_INP, { swmm6: { enabled: true, virtualJunctions: true } });
    expect(out).toMatch(/^VIRTUAL_JUNCTION_MOMENTUM\s+FULL$/m);

    const noConduits = VJ_INP.replace(/\[CONDUITS\][\s\S]*?\n\n/, '');
    const untouched = applyInpOverrides(noConduits, { swmm6: { enabled: true, virtualJunctions: true } });
    expect(untouched).not.toMatch(/VIRTUAL_JUNCTION_MOMENTUM/);
  });

  it('does not touch the network when the master flag or feature flag is off', () => {
    expect(applyInpOverrides(VJ_INP, { swmm6: { enabled: false, virtualJunctions: true } })).toBe(VJ_INP);
    expect(applyInpOverrides(VJ_INP, { swmm6: { enabled: true, semiImplicit: true } })).not.toMatch(/VIRTUAL_JUNCTIONS/);
  });

  it('normalizeSwmm6Options accepts virtualJunctions and validates momentum', () => {
    expect(normalizeSwmm6Options({ enabled: true, virtualJunctions: true, vjMomentum: 'full' }))
      .toEqual({ enabled: true, virtualJunctions: true, vjMomentum: 'FULL' });
    expect(normalizeSwmm6Options({ enabled: true, virtualJunctions: true, vjMomentum: 'BOGUS' }))
      .toEqual({ enabled: true, virtualJunctions: true });
    expect(normalizeSwmm6Options({ enabled: false, virtualJunctions: true })).toBeUndefined();
  });

  it('strip round-trips virtual junctions back to [JUNCTIONS] with MaxDepth 0', () => {
    const upgraded = applyInpOverrides(VJ_INP, {
      swmm6: { enabled: true, virtualJunctions: true, vjMomentum: 'FULL' },
    });
    const { content, restored, warnings } = stripVirtualJunctions(upgraded);
    expect(restored).toEqual(['J2']);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/MaxDepth 0/);
    expect(content).not.toMatch(/VIRTUAL_JUNCTIONS/);
    expect(content).not.toMatch(/VIRTUAL_JUNCTION_MOMENTUM/);
    const jSection = content.slice(content.indexOf('[JUNCTIONS]'), content.indexOf('[OUTFALLS]'));
    expect(jSection).toMatch(/^J2\s+97\.5\s+0\b/m);
    // The stripped model must parse for SWMM5: J2 row has the standard column count.
    const j2 = jSection.split('\n').find((l) => l.startsWith('J2'))!;
    expect(j2.trim().split(/\s+/).length).toBe(6);
  });

  it('strip is a no-op on models without virtual junctions', () => {
    const { content, restored, warnings } = stripVirtualJunctions(BASE_INP);
    expect(restored).toEqual([]);
    expect(warnings).toEqual([]);
    expect(content).toBe(BASE_INP);
  });
});
