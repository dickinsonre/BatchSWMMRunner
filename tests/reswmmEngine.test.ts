import { describe, it, expect } from "vitest";
import {
  hydraulicDiameter,
  computeCflAnalysis,
  discretizeConduits,
  DEFAULT_RESWMM_CONFIG,
  type ReswmmConfig,
} from "../client/src/lib/reswmmEngine";
import type { ParsedInpFile, XSectionData } from "../client/src/lib/inpParser";

function xs(shape: string, geom1: string, geom2 = 0): XSectionData {
  return { link: "C1", shape, geom1, geom2, geom3: 0, geom4: 0, barrels: 1 };
}

function baseModel(overrides: Partial<ParsedInpFile> = {}): ParsedInpFile {
  return {
    title: "t",
    options: { flowUnits: "CFS", routingMethod: "DYNWAVE", infiltrationMethod: "HORTON" },
    counts: { junctions: 0, outfalls: 0, storage: 0, conduits: 0, pumps: 0, orifices: 0, weirs: 0, subcatchments: 0, raingages: 0 },
    junctions: [
      { name: "J1", elevation: 100, maxDepth: 6, initDepth: 0, surDepth: 0, aponded: 0 },
      { name: "J2", elevation: 90, maxDepth: 6, initDepth: 0, surDepth: 0, aponded: 0 },
    ],
    outfalls: [],
    storage: [],
    conduits: [
      { name: "C1", from: "J1", to: "J2", length: 1000, roughness: 0.013, inOffset: 0.5, outOffset: 0.25, initFlow: 0, maxFlow: 0 },
    ],
    pumps: [],
    orifices: [],
    weirs: [],
    subcatchments: [],
    raingages: [],
    xsections: [xs("CIRCULAR", "2.0")],
    coordinates: [
      { node: "J1", x: 0, y: 0 },
      { node: "J2", x: 1000, y: 0 },
    ],
    polygons: [],
    losses: [{ link: "C1", entry: 0.5, exit: 0.4, average: 0.3 }],
    ...overrides,
  };
}

describe("hydraulicDiameter", () => {
  it("returns geom1 for circular pipes", () => {
    expect(hydraulicDiameter(xs("CIRCULAR", "2.5"))).toBe(2.5);
    expect(hydraulicDiameter(xs("FORCE_MAIN", "3"))).toBe(3);
    expect(hydraulicDiameter(xs("FILLED_CIRCULAR", "1.25"))).toBe(1.25);
  });

  it("returns 1 for missing or zero-geometry sections", () => {
    expect(hydraulicDiameter(undefined)).toBe(1);
    expect(hydraulicDiameter(xs("CIRCULAR", "0"))).toBe(1);
    expect(hydraulicDiameter(xs("CIRCULAR", "not-a-number"))).toBe(1);
  });

  it("computes 2HW/(H+W) for closed rectangles", () => {
    // H=2, W=4 -> 2*2*4/(2+4) = 16/6
    expect(hydraulicDiameter(xs("RECT_CLOSED", "2", 4))).toBeCloseTo(16 / 6, 10);
  });

  it("computes 4HW/(W+2H) for open rectangles", () => {
    // H=2, W=4 -> 4*2*4/(4+4) = 4
    expect(hydraulicDiameter(xs("RECT_OPEN", "2", 4))).toBeCloseTo(4, 10);
  });

  it("uses SWMM full-flow hydraulic radius factors for standard closed shapes", () => {
    expect(hydraulicDiameter(xs("EGG", "3"))).toBeCloseTo(4 * 0.1931 * 3, 10);
    expect(hydraulicDiameter(xs("HORSESHOE", "3"))).toBeCloseTo(4 * 0.2538 * 3, 10);
    expect(hydraulicDiameter(xs("GOTHIC", "3"))).toBeCloseTo(4 * 0.2269 * 3, 10);
    expect(hydraulicDiameter(xs("CATENARY", "3"))).toBeCloseTo(4 * 0.2337 * 3, 10);
    expect(hydraulicDiameter(xs("BASKETHANDLE", "3"))).toBeCloseTo(4 * 0.2464 * 3, 10);
    expect(hydraulicDiameter(xs("SEMIELLIPTICAL", "3"))).toBeCloseTo(4 * 0.242 * 3, 10);
    expect(hydraulicDiameter(xs("SEMICIRCULAR", "3"))).toBeCloseTo(4 * 0.2944 * 3, 10);
  });

  it("approximates ARCH sections with 4*0.7879*H*W/(W+2H)", () => {
    expect(hydraulicDiameter(xs("ARCH", "2", 4))).toBeCloseTo((4 * 0.7879 * 2 * 4) / (4 + 4), 10);
  });

  it("uses Ramanujan perimeter approximation for ellipses", () => {
    const g1 = 2, g2 = 4;
    const a = g1 / 2, b = g2 / 2;
    const area = Math.PI * a * b;
    const h = ((a - b) ** 2) / ((a + b) ** 2);
    const perim = Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
    const expected = (4 * area) / perim;
    expect(hydraulicDiameter(xs("HORIZ_ELLIPSE", "2", 4))).toBeCloseTo(expected, 10);
    expect(hydraulicDiameter(xs("VERT_ELLIPSE", "2", 4))).toBeCloseTo(expected, 10);
    // Circle degenerate case: Dh equals the diameter
    expect(hydraulicDiameter(xs("HORIZ_ELLIPSE", "2", 2))).toBeCloseTo(2, 6);
  });

  it("falls back to geom1 for open/irregular shapes", () => {
    expect(hydraulicDiameter(xs("TRAPEZOIDAL", "3", 10))).toBe(3);
    expect(hydraulicDiameter(xs("IRREGULAR", "5"))).toBe(5);
  });
});

describe("computeCflAnalysis", () => {
  it("uses US gravity for CFS models and celerity sqrt(g*D)", () => {
    const parsed = baseModel();
    const [cfl] = computeCflAnalysis(parsed);
    const celerity = Math.sqrt(32.174 * 2);
    expect(cfl.diameter).toBe(2);
    expect(cfl.standardTimeStep).toBeCloseTo(1000 / celerity, 6);
    expect(cfl.conservativeTimeStep).toBeCloseTo((1000 / celerity) * 0.1, 6);
  });

  it("uses metric gravity for SI flow units", () => {
    const parsed = baseModel();
    parsed.options.flowUnits = "CMS";
    const [cfl] = computeCflAnalysis(parsed);
    expect(cfl.standardTimeStep).toBeCloseTo(1000 / Math.sqrt(9.81 * 2), 6);
  });
});

describe("discretizeConduits", () => {
  const fixedConfig: ReswmmConfig = { ...DEFAULT_RESWMM_CONFIG, method: "fixed_interval", fixedMinLength: 50, fixedMaxLength: 200 };

  it("splits a long conduit into equal segments with interpolated junctions", () => {
    const parsed = baseModel();
    const result = discretizeConduits(parsed, fixedConfig);
    // 1000 ft at max 200 ft -> 5 segments, 4 new junctions
    expect(result.stats.splitCount).toBe(1);
    expect(result.newConduits).toHaveLength(5);
    expect(result.newJunctions).toHaveLength(4);
    expect(result.stats.newJunctionCount).toBe(4);
    expect(result.newConduits.every(c => c.length === 200)).toBe(true);
    // Elevation interpolated between 100 and 90
    expect(result.newJunctions[0].elevation).toBeCloseTo(98, 5);
    expect(result.newJunctions[3].elevation).toBeCloseTo(92, 5);
    // Topology chain preserved
    expect(result.newConduits[0].from).toBe("J1");
    expect(result.newConduits[4].to).toBe("J2");
    // Offsets only on the outer segments
    expect(result.newConduits[0].inOffset).toBe(0.5);
    expect(result.newConduits[4].outOffset).toBe(0.25);
    expect(result.newConduits[1].inOffset).toBe(0);
    // Coordinates interpolated for new nodes
    expect(result.newCoordinates).toHaveLength(4);
    expect(result.newCoordinates[0].x).toBeCloseTo(200, 5);
  });

  it("distributes losses across segments", () => {
    const parsed = baseModel();
    const result = discretizeConduits(parsed, fixedConfig);
    expect(result.newLosses).toHaveLength(5);
    expect(result.newLosses[0].entry).toBe(0.5);
    expect(result.newLosses[4].exit).toBe(0.4);
    expect(result.newLosses[1].entry).toBe(0);
    const totalAvg = result.newLosses.reduce((a, l) => a + l.average, 0);
    expect(totalAvg).toBeCloseTo(0.3, 10);
  });

  it("does not split conduits shorter than the target length", () => {
    const parsed = baseModel();
    parsed.conduits[0].length = 150;
    const result = discretizeConduits(parsed, fixedConfig);
    expect(result.stats.splitCount).toBe(0);
    expect(result.newConduits).toHaveLength(1);
    expect(result.newJunctions).toHaveLength(0);
  });

  it("never splits DUMMY or IRREGULAR sections", () => {
    for (const shape of ["DUMMY", "IRREGULAR"]) {
      const parsed = baseModel({ xsections: [xs(shape, "2")] });
      const result = discretizeConduits(parsed, fixedConfig);
      expect(result.stats.splitCount).toBe(0);
      expect(result.newConduits).toHaveLength(1);
    }
  });

  it("uses dx/D ratio sizing with the hydraulic diameter", () => {
    const parsed = baseModel();
    const config: ReswmmConfig = { ...DEFAULT_RESWMM_CONFIG, method: "dx_d_ratio", dxDRatio: 50 };
    // target = D * ratio = 2 * 50 = 100 -> 10 segments
    const result = discretizeConduits(parsed, config);
    expect(result.newConduits).toHaveLength(10);
    expect(result.newConduits[0].length).toBeCloseTo(100, 5);
  });

  it("lengthens short conduits when lengthening is enabled", () => {
    const parsed = baseModel();
    parsed.conduits[0].length = 10;
    const config: ReswmmConfig = { ...fixedConfig, lengtheningEnabled: true, lengtheningStep: 5 };
    const result = discretizeConduits(parsed, config);
    const celerity = Math.sqrt(32.174 * 2);
    const minLength = +(celerity * 5).toFixed(2);
    expect(result.stats.lengtheningCount).toBe(1);
    expect(result.stats.lengtheningTotalAdded).toBeCloseTo(minLength - 10, 2);
  });

  it("keeps a conduit intact when its endpoint nodes are unknown", () => {
    const parsed = baseModel({ junctions: [] });
    const result = discretizeConduits(parsed, fixedConfig);
    expect(result.stats.splitCount).toBe(1);
    expect(result.newConduits).toHaveLength(1);
    expect(result.newJunctions).toHaveLength(0);
  });
});
