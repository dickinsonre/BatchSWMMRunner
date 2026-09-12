import { describe, expect, it } from "vitest";
import { swmm6OptionsForEngine } from "../client/src/lib/swmm6EngineOptions";
import { applyInpOverrides } from "../shared/inpOptions";

const ALL_OPTIONS = {
  enabled: true,
  dynamicSlot: true,
  dpsCelerity: 20,
  dpsAlpha: 3,
  dpsDecayTime: 0.5,
  semiImplicit: true,
  andersonAccel: true,
  virtualJunctions: true,
  vjMomentum: "FULL" as const,
  fvRouting: true,
  fvOrder: 2,
  fvLimiter: "MINMOD",
  fvTimeIntegration: "EULER",
  fvRiemann: "HLLC",
  fvCellLength: 100,
  fvMinCells: 4,
  fvCfl: 0.8,
};

const BASE_INP = `[OPTIONS]
FLOW_UNITS           CFS
FLOW_ROUTING         DYNWAVE

[JUNCTIONS]
J1 100 10
`;

describe("swmm6OptionsForEngine", () => {
  it("sends only individually selected advanced options to SWMM6 stable", () => {
    expect(swmm6OptionsForEngine("wasm6", ALL_OPTIONS)).toEqual({
      enabled: true,
      dynamicSlot: true,
      dpsCelerity: 20,
      dpsAlpha: 3,
      dpsDecayTime: 0.5,
      semiImplicit: true,
      andersonAccel: true,
      virtualJunctions: true,
      vjMomentum: "FULL",
    });
  });

  it("never sends FV options to SWMM6 stable", () => {
    const result = swmm6OptionsForEngine("wasm6", {
      enabled: true,
      fvRouting: true,
      fvOrder: 2,
    });
    expect(result).toEqual({
      enabled: true,
      dynamicSlot: undefined,
      dpsCelerity: undefined,
      dpsAlpha: undefined,
      dpsDecayTime: undefined,
      semiImplicit: undefined,
      andersonAccel: undefined,
      virtualJunctions: undefined,
      vjMomentum: undefined,
    });
    expect(result).not.toHaveProperty("fvRouting");
  });

  it("sends only FV routing options to SWMM6 Dev", () => {
    expect(swmm6OptionsForEngine("wasm6dev", ALL_OPTIONS)).toEqual({
      enabled: true,
      fvRouting: true,
      fvOrder: 2,
      fvLimiter: "MINMOD",
      fvTimeIntegration: "EULER",
      fvRiemann: "HLLC",
      fvCellLength: 100,
      fvMinCells: 4,
      fvCfl: 0.8,
    });
  });

  it("uses normal routing in Dev when FV is off", () => {
    expect(swmm6OptionsForEngine("wasm6dev", {
      enabled: true,
      dynamicSlot: true,
      fvRouting: false,
    })).toBeUndefined();
  });

  it("drops every SWMM6 option for non-SWMM6 engines", () => {
    expect(swmm6OptionsForEngine("wasm", ALL_OPTIONS)).toBeUndefined();
    expect(swmm6OptionsForEngine("api", ALL_OPTIONS)).toBeUndefined();
    expect(swmm6OptionsForEngine("executable", ALL_OPTIONS)).toBeUndefined();
  });

  it("generates engine-specific INPs with no cross-engine keyword leakage", () => {
    const stableInp = applyInpOverrides(BASE_INP, {
      swmm6: swmm6OptionsForEngine("wasm6", ALL_OPTIONS),
    });
    expect(stableInp).toMatch(/^SURCHARGE_METHOD\s+DYNAMIC_SLOT$/m);
    expect(stableInp).toMatch(/^NODE_CONTINUITY\s+SEMI_IMPLICIT$/m);
    expect(stableInp).toMatch(/^ANDERSON_ACCEL\s+YES$/m);
    expect(stableInp).not.toMatch(/^FLOW_ROUTING\s+FV$/m);
    expect(stableInp).not.toMatch(/^FV_/m);

    const devInp = applyInpOverrides(BASE_INP, {
      flowRouting: "dynamic",
      swmm6: swmm6OptionsForEngine("wasm6dev", ALL_OPTIONS),
    });
    expect(devInp).toMatch(/^FLOW_ROUTING\s+FV$/m);
    expect(devInp).toMatch(/^FV_ORDER\s+2$/m);
    expect(devInp).not.toMatch(/^SURCHARGE_METHOD\s+DYNAMIC_SLOT$/m);
    expect(devInp).not.toMatch(/^NODE_CONTINUITY\s+SEMI_IMPLICIT$/m);
    expect(devInp).not.toMatch(/^ANDERSON_ACCEL\s+YES$/m);

    const devWithoutFv = applyInpOverrides(BASE_INP, {
      flowRouting: "kinematic",
      swmm6: swmm6OptionsForEngine("wasm6dev", {
        ...ALL_OPTIONS,
        fvRouting: false,
      }),
    });
    expect(devWithoutFv).toMatch(/^FLOW_ROUTING\s+KINWAVE$/m);
    expect(devWithoutFv).not.toMatch(/^FV_/m);
    expect(devWithoutFv).not.toMatch(/^SURCHARGE_METHOD\s+DYNAMIC_SLOT$/m);
  });
});