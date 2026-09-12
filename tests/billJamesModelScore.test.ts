import { describe, expect, it } from "vitest";
import {
  BILL_JAMES_MODEL_SCORE_CONFIG,
  calculateBillJamesModelScore,
  modelScoreBand,
  rankBillJamesCandidates,
  type ModelScoreRun,
} from "../client/src/lib/billJamesModelScore";
import type { ParsedTimeSeries } from "../client/src/lib/parseTimeSeries";

const HOURLY = [
  "01/01/2020 00:00",
  "01/01/2020 01:00",
  "01/01/2020 02:00",
];

function series(
  title: string,
  element: string,
  columns: string[],
  units: string[],
  rows: number[][],
  times = HOURLY,
): ParsedTimeSeries {
  return {
    title,
    element,
    columns,
    units,
    data: times.map((time, index) => ({ time, values: rows[index] })),
  };
}

function scaledRows(rows: number[][], scale: number): number[][] {
  return rows.map(row => row.map(value => value * scale));
}

function model(scale = 1, times = HOURLY): ModelScoreRun {
  const make = (
    title: string,
    element: string,
    columns: string[],
    units: string[],
    rows: number[][],
  ) => series(title, element, columns, units, scaledRows(rows, scale), times);

  return {
    status: "success",
    routingContinuityError: 0.2,
    series: [
      make(
        "System Results Time Series",
        "System",
        ["Runoff", "Outflow", "Flooding", "Storage Volume"],
        ["CFS", "CFS", "CFS", "ft3"],
        [[1, 0.5, 0, 10], [3, 2, 1, 12], [1, 0.5, 0, 11]],
      ),
      make(
        "Subcatchment Results Time Series",
        "S1",
        ["Runoff"],
        ["CFS"],
        [[0], [2], [0]],
      ),
      make(
        "Node Results Time Series",
        "N1",
        ["Depth", "Flooding"],
        ["ft", "CFS"],
        [[1, 0], [2, 0.2], [1, 0]],
      ),
      make(
        "Node Results Time Series",
        "N2",
        ["Depth", "Flooding"],
        ["ft", "CFS"],
        [[0.5, 0], [1, 0.1], [0.5, 0]],
      ),
      make(
        "Link Results Time Series",
        "L1",
        ["Flow", "Velocity"],
        ["CFS", "ft/sec"],
        [[0, 0], [3, 2], [1, 0.5]],
      ),
    ],
  };
}

function shapeTimes(count: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const totalMinutes = index * 5;
    const hour = Math.floor(totalMinutes / 60);
    const minute = totalMinutes % 60;
    return `01/01/2020 ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  });
}

function shapeRun(
  category: "subcatchment" | "node" | "link",
  values: number[],
): ModelScoreRun {
  const spec = category === "subcatchment"
    ? { title: "Subcatchment Results Time Series", element: "S1", metric: "Runoff", unit: "CFS" }
    : category === "node"
      ? { title: "Node Results Time Series", element: "N1", metric: "Depth", unit: "ft" }
      : { title: "Link Results Time Series", element: "L1", metric: "Flow", unit: "CFS" };
  return {
    status: "success",
    series: [
      series(
        spec.title,
        spec.element,
        [spec.metric],
        [spec.unit],
        values.map(value => [value]),
        shapeTimes(values.length),
      ),
    ],
  };
}

function changeAllFlowUnits(run: ModelScoreRun, unit: string): ModelScoreRun {
  return {
    ...run,
    series: run.series.map(item => ({
      ...item,
      units: item.units.map((existing, index) => {
        const metric = item.columns[index];
        return ["Runoff", "Outflow", "Flooding", "Flow"].includes(metric) ? unit : existing;
      }),
    })),
  };
}

function changeMetricUnit(run: ModelScoreRun, metric: string, unit: string): ModelScoreRun {
  return {
    ...run,
    series: run.series.map(item => ({
      ...item,
      units: item.units.map((existing, index) =>
        item.columns[index] === metric ? unit : existing
      ),
    })),
  };
}

describe("calculateBillJamesModelScore", () => {
  it("exposes the approved category weights and interpretation thresholds", () => {
    expect(Object.fromEntries(
      Object.entries(BILL_JAMES_MODEL_SCORE_CONFIG.categories)
        .map(([key, category]) => [key, category.weight]),
    )).toEqual({
      system: 200,
      subcatchment: 200,
      node: 300,
      link: 300,
    });
    expect(modelScoreBand(950)).toBe("Virtually identical");
    expect(modelScoreBand(949.999)).toBe("Truly similar");
    expect(modelScoreBand(900)).toBe("Truly similar");
    expect(modelScoreBand(899.999)).toBe("Essentially similar");
    expect(modelScoreBand(850)).toBe("Essentially similar");
    expect(modelScoreBand(849.999)).toBe("Same family — differences matter");
    expect(modelScoreBand(700)).toBe("Same family — differences matter");
    expect(modelScoreBand(699.999)).toBe("Not comparable at these settings");
  });

  it("exposes the approved Design A shape schedule", () => {
    expect(BILL_JAMES_MODEL_SCORE_CONFIG.shape.minimumWetSteps).toBe(10);
    expect(BILL_JAMES_MODEL_SCORE_CONFIG.deductions.subcatchment).toMatchObject({
      runoffVolumeCap: 35,
      peakRunoffCap: 35,
      runoffKgeDeficitPerPoint: 0.02,
      runoffKgeCap: 20,
    });
    expect(BILL_JAMES_MODEL_SCORE_CONFIG.deductions.node).toMatchObject({
      peakDepthCap: 30,
      floodVolumeCap: 30,
      depthKgeDeficitPerPoint: 0.02,
      depthKgeCap: 15,
      depthNseDeficitPerPoint: 0.02,
      depthNseCap: 10,
    });
    expect(BILL_JAMES_MODEL_SCORE_CONFIG.deductions.link).toMatchObject({
      peakFlowCap: 25,
      flowVolumeCap: 25,
      peakVelocityCap: 15,
      flowKgeDeficitPerPoint: 0.02,
      flowKgeCap: 15,
      flowNseDeficitPerPoint: 0.02,
      flowNseCap: 10,
    });
  });

  it("scores an identical whole-model result at exactly 1000", () => {
    const reference = model();
    const result = calculateBillJamesModelScore(reference, model());

    expect(result.score).toBe(1000);
    expect(result.band).toBe("Virtually identical");
    expect(result.categories.map(category => category.points)).toEqual([200, 200, 300, 300]);
    expect(result.deductions).toEqual([]);
  });

  it("pins controlled 3% and 8% whole-model mutations", () => {
    const reference = model();
    const threePercent = calculateBillJamesModelScore(reference, model(1.03));
    const eightPercent = calculateBillJamesModelScore(reference, model(1.08));

    expect(threePercent.score).toBeCloseTo(856, 8);
    expect(threePercent.band).toBe("Essentially similar");
    expect(eightPercent.score).toBeCloseTo(616, 8);
    expect(eightPercent.band).toBe("Not comparable at these settings");
    expect(threePercent.score).toBeGreaterThan(eightPercent.score!);
  });

  it("penalizes a missing reference node without gating the candidate", () => {
    const candidate = model();
    candidate.series = candidate.series.filter(item => item.element !== "N2");
    const result = calculateBillJamesModelScore(model(), candidate);

    expect(result.score).toBe(850);
    expect(result.gateReasons).toEqual([]);
    expect(result.categories.find(category => category.key === "node")?.score).toBe(50);
    expect(result.elements.find(element => element.element === "N2")).toMatchObject({
      score: 0,
      missingInCandidate: true,
    });
  });

  it("reports candidate-only entities without changing the reference-defined score", () => {
    const candidate = structuredClone(model());
    candidate.series.push(
      { ...candidate.series.find(item => item.element === "S1")!, element: "S-extra" },
      { ...candidate.series.find(item => item.element === "N1")!, element: "N-extra" },
      { ...candidate.series.find(item => item.element === "L1")!, element: "L-extra" },
    );
    const result = calculateBillJamesModelScore(model(), candidate);

    expect(result.score).toBe(1000);
    expect(result.gateReasons).toEqual([]);
    expect(result.extraCandidateElements).toEqual({
      subcatchment: ["S-extra"],
      node: ["N-extra"],
      link: ["L-extra"],
    });
  });

  it("renormalizes weights over categories populated by the reference", () => {
    const reference = model();
    reference.series = reference.series.filter(item =>
      !/^Subcatchment Results/i.test(item.title),
    );
    const candidate = structuredClone(reference);
    const result = calculateBillJamesModelScore(reference, candidate);

    expect(result.score).toBe(1000);
    expect(result.categories.map(category => ({
      key: category.key,
      points: category.points,
      elements: category.elementCount,
    }))).toEqual([
      { key: "system", points: 250, elements: 1 },
      { key: "subcatchment", points: 0, elements: 0 },
      { key: "node", points: 375, elements: 2 },
      { key: "link", points: 375, elements: 1 },
    ]);
    expect(result.categories.reduce((sum, category) => sum + category.weight, 0)).toBe(1000);
  });

  it("hard-gates incompatible flow units", () => {
    const result = calculateBillJamesModelScore(
      model(),
      changeAllFlowUnits(model(), "GPM"),
    );
    expect(result.score).toBeUndefined();
    expect(result.gateReasons[0]).toMatch(/units.*differ/i);
  });

  it("scores equivalent SI/native labels without conversion", () => {
    const reference = changeAllFlowUnits(
      changeMetricUnit(changeMetricUnit(changeMetricUnit(model(), "Depth", "m"), "Velocity", "m/sec"), "Storage Volume", "m3"),
      "CMS",
    );
    expect(calculateBillJamesModelScore(reference, structuredClone(reference)).score).toBe(1000);
  });

  it("accepts equivalent unit labels regardless of case or surrounding whitespace", () => {
    const candidate = structuredClone(model());
    for (const item of candidate.series) {
      item.units = item.units.map(unit => ` ${unit.toLowerCase()} `);
    }
    expect(calculateBillJamesModelScore(model(), candidate).score).toBe(1000);
  });

  it.each([
    ["ft", "feet"],
    ["m", "meters"],
  ])("treats %s and %s as the same native length unit", (abbreviation, spelling) => {
    const reference = changeMetricUnit(model(), "Depth", abbreviation);
    const candidate = changeMetricUnit(model(), "Depth", spelling);
    expect(calculateBillJamesModelScore(reference, candidate).score).toBe(1000);
  });

  it.each([
    ["Depth", "m"],
    ["Velocity", "m/sec"],
    ["Storage Volume", "m3"],
  ])("hard-gates incompatible native %s units", (metric, unit) => {
    const result = calculateBillJamesModelScore(model(), changeMetricUnit(model(), metric, unit));
    expect(result.score).toBeUndefined();
    expect(result.gateReasons[0]).toMatch(new RegExp(`units for ${metric} differ`, "i"));
  });

  it("hard-gates incompatible report time grids", () => {
    const halfHourly = [
      "05/01/2025 00:00",
      "05/01/2025 00:30",
      "05/01/2025 01:00",
    ];
    const result = calculateBillJamesModelScore(model(), model(1, halfHourly));
    expect(result.score).toBeUndefined();
    expect(result.gateReasons[0]).toMatch(/time grids differ/i);
  });

  it("hard-gates incomplete runs but skips unavailable continuity evidence", () => {
    const failed = { ...model(), status: "failed" };
    expect(calculateBillJamesModelScore(model(), failed).gateReasons[0]).toMatch(/failed/i);

    const noContinuity = { ...model(), routingContinuityError: undefined };
    const result = calculateBillJamesModelScore(model(), noContinuity);
    expect(result.score).toBe(1000);
    expect(result.gateReasons).toEqual([]);
    expect(result.skippedMetrics).toContainEqual(expect.objectContaining({
      category: "system",
      metric: "Routing continuity",
    }));
  });

  it("skips an unavailable metric instead of guessing or gating", () => {
    const candidate = structuredClone(model());
    const node = candidate.series.find(item => item.element === "N1")!;
    const floodingIndex = node.columns.indexOf("Flooding");
    node.columns.splice(floodingIndex, 1);
    node.units.splice(floodingIndex, 1);
    node.data.forEach(point => point.values.splice(floodingIndex, 1));

    const result = calculateBillJamesModelScore(model(), candidate);
    expect(result.score).toBe(1000);
    expect(result.gateReasons).toEqual([]);
    expect(result.skippedMetrics).toContainEqual(expect.objectContaining({
      category: "node",
      element: "N1",
      metric: "Flooding",
    }));
  });

  it("skips unavailable System series metrics instead of assigning a structural zero", () => {
    const candidate = model();
    candidate.series = candidate.series.filter(item =>
      !/^System Results/i.test(item.title),
    );

    const result = calculateBillJamesModelScore(model(), candidate);
    expect(result.score).toBe(1000);
    expect(result.gateReasons).toEqual([]);
    expect(result.categories.find(category => category.key === "system")?.score).toBe(100);
    expect(result.deductions.filter(deduction => deduction.category === "system")).toEqual([]);
    expect(result.skippedMetrics.filter(item => item.category === "system"))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ metric: "Runoff" }),
        expect.objectContaining({ metric: "Outflow" }),
        expect.objectContaining({ metric: "Flooding" }),
        expect.objectContaining({ metric: "Storage Volume" }),
      ]));
  });

  it("caps every System metric at 20 local points", () => {
    const candidate = model(5);
    candidate.routingContinuityError = 10.2;
    const result = calculateBillJamesModelScore(model(), candidate);
    const system = result.categories.find(category => category.key === "system")!;

    expect(system.score).toBe(0);
    expect(system.elements[0].deductions).toHaveLength(5);
    for (const deduction of system.elements[0].deductions) {
      expect(deduction.elementPoints).toBe(20);
    }
  });

  it("reconciles every ledger point to 1000 minus the network score", () => {
    const result = calculateBillJamesModelScore(model(), model(1.08));
    const deducted = result.deductions.reduce((sum, deduction) => sum + deduction.points, 0);
    expect(deducted).toBeCloseTo(BILL_JAMES_MODEL_SCORE_CONFIG.maxScore - result.score!, 10);
    expect(result.deductions).toEqual(
      [...result.deductions].sort((a, b) => b.points - a.points),
    );
  });

  it("uses absolute floors so tiny flows do not dominate", () => {
    const tinyRun = (scale: number): ModelScoreRun => ({
      status: "success",
      series: [
        series(
          "Link Results Time Series",
          "L1",
          ["Flow"],
          ["CFS"],
          [[1e-6 * scale], [1e-6 * scale], [1e-6 * scale]],
        ),
      ],
    });
    const reference = tinyRun(1);
    const candidate = tinyRun(3);
    const result = calculateBillJamesModelScore(reference, candidate);
    expect(result.score).toBeGreaterThan(990);
  });

  it("reports perfect KGE-2009, NSE, MSE, and decomposition for an identical wet series", () => {
    const values = [1, 2, 3, 4, 5, 10, 8, 6, 5, 4, 3, 2];
    const result = calculateBillJamesModelScore(shapeRun("link", values), shapeRun("link", values));

    expect(result.score).toBe(1000);
    expect(result.shapeDiagnostics).toEqual([expect.objectContaining({
      category: "link",
      element: "L1",
      metric: "Flow",
      variant: "KGE-2009",
      wetSamples: 12,
      kge: 1,
      nse: 1,
      mse: 0,
      correlation: 1,
      variabilityRatio: 1,
      biasRatio: 1,
    })]);
    expect(result.deductions).toEqual([]);
  });

  it("matches independent KGE-2009, NSE, MSE, and decomposition oracles on exactly 10 wet steps", () => {
    const referenceValues = [0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const candidateValues = [100, 100, 2, 2, 4, 4, 6, 6, 8, 8, 10, 10];
    const result = calculateBillJamesModelScore(
      shapeRun("link", referenceValues),
      shapeRun("link", candidateValues),
    );
    const diagnostic = result.shapeDiagnostics[0];

    expect(diagnostic.wetSamples).toBe(10);
    expect(diagnostic.correlation).toBeCloseTo(0.9847319278346618, 12);
    expect(diagnostic.variabilityRatio).toBeCloseTo(0.9847319278346619, 12);
    expect(diagnostic.biasRatio).toBeCloseTo(1.0909090909090908, 12);
    expect(diagnostic.kge).toBeCloseTo(0.9065618340012536, 12);
    expect(diagnostic.nse).toBeCloseTo(0.9393939393939394, 12);
    expect(diagnostic.mse).toBeCloseTo(0.5, 12);
  });

  it("keeps low-amplitude but nonconstant wet depth series eligible", () => {
    const values = Array.from({ length: 12 }, (_, index) => 0.010001 + index * 0.000001);
    const result = calculateBillJamesModelScore(shapeRun("node", values), shapeRun("node", values));

    expect(result.shapeDiagnostics).toHaveLength(1);
    expect(result.shapeDiagnostics[0]).toMatchObject({
      metric: "Depth",
      wetSamples: 12,
      kge: 1,
      nse: 1,
    });
  });

  it("deducts for a changed link shape even when peak, volume, and peak timing match", () => {
    const referenceValues = [1, 2, 3, 4, 5, 10, 8, 6, 5, 4, 3, 2];
    const candidateValues = [1, 3, 2, 5, 4, 10, 6, 8, 4, 5, 3, 2];
    const result = calculateBillJamesModelScore(
      shapeRun("link", referenceValues),
      shapeRun("link", candidateValues),
    );
    const diagnostic = result.shapeDiagnostics[0];

    expect(diagnostic.mse).toBeGreaterThan(0);
    expect(diagnostic.correlation).toBeLessThan(1);
    expect(diagnostic.variabilityRatio).toBeCloseTo(1, 12);
    expect(diagnostic.biasRatio).toBeCloseTo(1, 12);
    expect(result.deductions.map(item => item.metric).sort()).toEqual([
      "Flow KGE",
      "Flow NSE",
    ]);
    expect(result.deductions).not.toContainEqual(expect.objectContaining({ metric: "MSE" }));
    expect(result.score).toBeLessThan(1000);
  });

  it("adds runoff KGE without making runoff NSE or MSE deductions", () => {
    const referenceValues = [1, 2, 3, 4, 5, 10, 8, 6, 5, 4, 3, 2];
    const candidateValues = [1, 3, 2, 5, 4, 10, 6, 8, 4, 5, 3, 2];
    const result = calculateBillJamesModelScore(
      shapeRun("subcatchment", referenceValues),
      shapeRun("subcatchment", candidateValues),
    );

    expect(result.shapeDiagnostics[0]).toMatchObject({ metric: "Runoff", wetSamples: 12 });
    expect(result.deductions.map(item => item.metric)).toEqual(["Runoff KGE"]);
  });

  it("adds both depth KGE and NSE deductions", () => {
    const referenceValues = [1, 2, 3, 4, 5, 10, 8, 6, 5, 4, 3, 2];
    const candidateValues = [1, 3, 2, 5, 4, 10, 6, 8, 4, 5, 3, 2];
    const result = calculateBillJamesModelScore(
      shapeRun("node", referenceValues),
      shapeRun("node", candidateValues),
    );

    expect(result.shapeDiagnostics[0]).toMatchObject({ metric: "Depth", wetSamples: 12 });
    expect(result.deductions.map(item => item.metric).sort()).toEqual([
      "Depth KGE",
      "Depth NSE",
    ]);
  });

  it.each([
    {
      label: "short wet window",
      reference: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      candidate: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      reason: /at least 10 reference-wet report steps/i,
    },
    {
      label: "dry reference",
      reference: Array(12).fill(0.0005),
      candidate: Array(12).fill(0.0005),
      reason: /found 0/i,
    },
    {
      label: "constant candidate",
      reference: [1, 2, 3, 4, 5, 10, 8, 6, 5, 4, 3, 2],
      candidate: Array(12).fill(4),
      reason: /non-constant reference and candidate/i,
    },
    {
      label: "constant reference",
      reference: Array(12).fill(4),
      candidate: [1, 2, 3, 4, 5, 10, 8, 6, 5, 4, 3, 2],
      reason: /non-constant reference and candidate/i,
    },
    {
      label: "near-zero signed reference mean",
      reference: [1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6],
      candidate: [1, -0.5, 2, -1, 3, -1.5, 4, -2, 5, -2.5, 6, -3],
      reason: /reference wet-window mean to exceed/i,
    },
  ])("skips shape evidence for a $label instead of penalizing it", ({ reference, candidate, reason }) => {
    const result = calculateBillJamesModelScore(
      shapeRun("link", reference),
      shapeRun("link", candidate),
    );

    expect(result.shapeDiagnostics).toEqual([]);
    expect(result.skippedMetrics).toContainEqual(expect.objectContaining({
      category: "link",
      metric: "Flow shape metrics",
      reason: expect.stringMatching(reason),
    }));
    expect(result.deductions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: "Flow KGE" }),
      expect.objectContaining({ metric: "Flow NSE" }),
    ]));
  });

  it("preserves negative NSE diagnostics and caps shape deductions", () => {
    const referenceValues = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const candidateValues = [...referenceValues].reverse();
    const result = calculateBillJamesModelScore(
      shapeRun("link", referenceValues),
      shapeRun("link", candidateValues),
    );
    const diagnostic = result.shapeDiagnostics[0];
    const kge = result.elements[0].deductions.find(item => item.metric === "Flow KGE")!;
    const nse = result.elements[0].deductions.find(item => item.metric === "Flow NSE")!;

    expect(diagnostic.nse).toBeLessThan(0);
    expect(nse.delta).toBe(diagnostic.nse);
    expect(kge.elementPoints).toBe(15);
    expect(nse.elementPoints).toBe(10);
  });

  it("scales subcatchment deductions proportionally when raw Design A caps total 110", () => {
    const referenceValues = Array.from({ length: 21 }, (_, index) => index + 1);
    const candidateValues = [...referenceValues].reverse().map(value => value * 10);
    const result = calculateBillJamesModelScore(
      shapeRun("subcatchment", referenceValues),
      shapeRun("subcatchment", candidateValues),
    );
    const element = result.elements[0];
    const byMetric = Object.fromEntries(
      element.deductions.map(item => [item.metric, item.elementPoints]),
    );

    expect(element.score).toBe(0);
    expect(byMetric["Runoff volume"]).toBeCloseTo(35 * 100 / 110, 10);
    expect(byMetric["Peak runoff"]).toBeCloseTo(35 * 100 / 110, 10);
    expect(byMetric["Runoff time to peak"]).toBeCloseTo(20 * 100 / 110, 10);
    expect(byMetric["Runoff KGE"]).toBeCloseTo(20 * 100 / 110, 10);
    expect(element.deductions.reduce((sum, item) => sum + item.elementPoints, 0))
      .toBeCloseTo(100, 10);
  });
});

describe("rankBillJamesCandidates", () => {
  it("ranks scored candidates highest-to-lowest and leaves gated runs last", () => {
    const ranked = rankBillJamesCandidates(model(), [
      { label: "8 percent", run: model(1.08) },
      { label: "identity", run: model() },
      { label: "3 percent", run: model(1.03) },
      { label: "wrong units", run: changeAllFlowUnits(model(), "GPM") },
    ]);

    expect(ranked.map(item => item.label)).toEqual([
      "identity",
      "3 percent",
      "8 percent",
      "wrong units",
    ]);
    expect(ranked.map(item => item.index)).toEqual([1, 2, 0, 3]);
    expect(ranked[3].result.score).toBeUndefined();
  });
});