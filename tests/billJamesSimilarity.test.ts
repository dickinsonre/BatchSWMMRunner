import { describe, expect, it } from "vitest";
import {
  BILL_JAMES_COMPONENTS,
  calculateBillJamesSimilarity,
  compareSystemSeries,
  compareSystemVariable,
} from "../client/src/lib/billJamesSimilarity";
import type { ParsedTimeSeries } from "../client/src/lib/parseTimeSeries";

function systemSeries(
  columns: string[],
  units: string[],
  times: string[],
  rows: number[][],
): ParsedTimeSeries {
  return {
    title: "System Results Time Series",
    element: "System",
    columns,
    units,
    data: times.map((time, index) => ({ time, values: rows[index] })),
  };
}

describe("calculateBillJamesSimilarity", () => {
  it("returns a perfect score and all 12 component scores for identical data", () => {
    const result = calculateBillJamesSimilarity([0, 1, 2, 3], [0, 1, 2, 3]);
    expect(result.score).toBe(100);
    expect(result.components).toHaveLength(12);
    expect(result.components).toHaveLength(BILL_JAMES_COMPONENTS.length);
    expect(result.components.every(component => component.score === 100)).toBe(true);
    expect(result.availableWeight).toBe(result.totalWeight);
  });

  it("preserves the published directional reference semantics", () => {
    const forward = calculateBillJamesSimilarity([1, 2, 4, 8], [2, 3, 5, 9]);
    const reverse = calculateBillJamesSimilarity([2, 3, 5, 9], [1, 2, 4, 8]);
    expect(forward.score).toBeDefined();
    expect(reverse.score).toBeDefined();
    expect(forward.score).not.toBeCloseTo(reverse.score!);
    expect(forward.components.find(component => component.key === "mape")?.score)
      .not.toBeCloseTo(reverse.components.find(component => component.key === "mape")?.score!);
  });

  it("matches the published Ruby template for a fixed golden vector", () => {
    const result = calculateBillJamesSimilarity(
      [8, 10, 12, 15, 9],
      [7.5, 11, 11, 14, 10],
    );
    const expectedScores = {
      mean: 98.99999999999999,
      rmse: 90.78045554270712,
      mape: 83.05555555555556,
      stdDev: 92.12253145167877,
      skewness: 44.16344012448343,
      kurtosis: 67.88567252964164,
      logNse: 81.90189236996997,
      indexOfAgreement: 95.8206313305143,
      integralSquareError: 91.5,
      correlation: 93.39244835757763,
      nse: 86.2012987012987,
      klingGupta: 82.7848414830964,
    };
    expect(result.score).toBeCloseTo(86.47172858751995, 10);
    for (const [key, expected] of Object.entries(expectedScores)) {
      expect(result.components.find(component => component.key === key)?.score)
        .toBeCloseTo(expected, 10);
    }
  });

  it("scores identical all-zero and constant series without NaN", () => {
    for (const values of [[0, 0, 0], [5, 5, 5]]) {
      const result = calculateBillJamesSimilarity(values, values);
      expect(result.score).toBe(100);
      expect(result.components.every(component => Number.isFinite(component.score))).toBe(true);
    }
  });

  it("renormalizes available weights for unequal constant series", () => {
    const result = calculateBillJamesSimilarity([5, 5, 5], [7, 7, 7]);
    expect(result.score).toBeDefined();
    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.availableWeight).toBeLessThan(result.totalWeight);
    expect(result.components.some(component => component.score === undefined)).toBe(true);
  });

  it("requires at least two finite paired samples", () => {
    const result = calculateBillJamesSimilarity([1], [1]);
    expect(result.score).toBeUndefined();
    expect(result.reason).toMatch(/two paired/i);
    expect(result.components.every(component => component.score === undefined)).toBe(true);
  });
});

describe("system-variable Bill James comparison", () => {
  it("aligns each engine to its own start date but excludes partial report-step coverage", () => {
    const reference = systemSeries(
      ["Outflow"],
      ["CFS"],
      ["01/01/2020 00:00", "01/01/2020 01:00"],
      [[1], [2]],
    );
    const candidate = systemSeries(
      ["Outflow"],
      ["CFS"],
      ["06/10/2025 12:00", "06/10/2025 12:30", "06/10/2025 13:00"],
      [[1], [99], [2]],
    );
    const result = compareSystemVariable(reference, candidate, "outflow");
    expect(result.score).toBeUndefined();
    expect(result.partialScore).toBe(100);
    expect(result.pairedSamples).toBe(2);
    expect(result.coverage).toBeCloseTo(2 / 3);
    expect(result.reason).toMatch(/partial elapsed-time coverage/i);
  });

  it("anchors elapsed time to the report start rather than the first finite metric value", () => {
    const reference = systemSeries(
      ["Outflow"],
      ["CFS"],
      [
        "01/01/2020 00:00",
        "01/01/2020 01:00",
        "01/01/2020 02:00",
      ],
      [[Number.NaN], [1], [2]],
    );
    const candidate = systemSeries(
      ["Outflow"],
      ["CFS"],
      [
        "05/01/2025 00:00",
        "05/01/2025 01:00",
      ],
      [[1], [2]],
    );

    const result = compareSystemVariable(reference, candidate, "Outflow");
    expect(result.score).toBeUndefined();
    expect(result.partialScore).toBeUndefined();
    expect(result.pairedSamples).toBe(1);
    expect(result.coverage).toBe(0.5);
    expect(result.reason).toMatch(/at least two paired/i);
  });

  it("excludes incompatible units explicitly", () => {
    const times = ["01/01/2020 00:00", "01/01/2020 01:00"];
    const reference = systemSeries(["Outflow"], ["CFS"], times, [[1], [2]]);
    const candidate = systemSeries(["Outflow"], ["CMS"], times, [[1], [2]]);
    const result = compareSystemVariable(reference, candidate, "Outflow");
    expect(result.score).toBeUndefined();
    expect(result.reason).toMatch(/units differ/i);
  });

  it("excludes variables when either unit is unknown", () => {
    const times = ["01/01/2020 00:00", "01/01/2020 01:00"];
    const reference = systemSeries(["Outflow"], ["CFS"], times, [[1], [2]]);
    const candidate = systemSeries(["Outflow"], [""], times, [[1], [2]]);
    const result = compareSystemVariable(reference, candidate, "Outflow");
    expect(result.score).toBeUndefined();
    expect(result.reason).toMatch(/units are missing/i);
  });

  it("averages comparable variables and reports excluded variables", () => {
    const times = ["01/01/2020 00:00", "01/01/2020 01:00", "01/01/2020 02:00"];
    const reference = systemSeries(
      ["Outflow", "Flooding"],
      ["CFS", "CFS"],
      times,
      [[1, 0], [2, 0], [3, 0]],
    );
    const candidate = systemSeries(
      ["Outflow", "Rainfall"],
      ["CFS", "in/hr"],
      times,
      [[1, 0], [2, 0], [3, 0]],
    );
    const result = compareSystemSeries(reference, candidate);
    expect(result.score).toBe(100);
    expect(result.comparableVariables).toBe(1);
    expect(result.totalVariables).toBe(3);
    expect(result.variables.find(variable => variable.name === "Flooding")?.reason)
      .toMatch(/candidate/i);
    expect(result.variables.find(variable => variable.name === "Rainfall")?.reason)
      .toMatch(/reference/i);
  });
});