import { describe, expect, it } from "vitest";
import {
  buildDerivativePhasePoints,
  buildRatingPhasePoints,
  phaseExclusionReason,
  phaseMetricDefaults,
} from "../client/src/lib/phaseSpaceComparison";
import type { ParsedTimeSeries } from "../client/src/lib/parseTimeSeries";

const SERIES: ParsedTimeSeries = {
  title: "Link Results Time Series",
  element: "Link C1",
  columns: ["Flow", "Depth", "Velocity"],
  units: ["CFS", "ft", "ft/s"],
  data: [
    { time: "01/01/2020 00:00:00", values: [0, 0, 0] },
    { time: "01/01/2020 00:30:00", values: [10, 1, 2] },
    { time: "01/01/2020 02:00:00", values: [30, 4, 3] },
  ],
};

describe("phase-space comparison helpers", () => {
  it("builds a time-ordered depth-flow rating trajectory", () => {
    expect(buildRatingPhasePoints(SERIES, "Depth", "Flow")).toEqual([
      { x: 0, y: 0, elapsedSeconds: 0, segment: 0 },
      { x: 1, y: 10, elapsedSeconds: 1800, segment: 0 },
      { x: 4, y: 30, elapsedSeconds: 7200, segment: 0 },
    ]);
  });

  it("uses non-uniform three-point weights for the state derivative", () => {
    expect(buildDerivativePhasePoints(SERIES, "Flow")).toEqual([
      { x: 0, y: 20, elapsedSeconds: 0, segment: 0 },
      { x: 10, y: (55 / 3), elapsedSeconds: 1800, segment: 0 },
      { x: 30, y: (20 / 1.5), elapsedSeconds: 7200, segment: 0 },
    ]);
  });

  it("chooses hydraulically useful defaults by element type", () => {
    const metrics = ["Rainfall", "Depth", "Flow", "Inflow", "Runoff"];
    expect(phaseMetricDefaults(metrics, "link")).toEqual({ xMetric: "Depth", yMetric: "Flow" });
    expect(phaseMetricDefaults(metrics, "node")).toEqual({ xMetric: "Depth", yMetric: "Inflow" });
    expect(phaseMetricDefaults(metrics, "subcatchment")).toEqual({ xMetric: "Rainfall", yMetric: "Runoff" });
    expect(phaseMetricDefaults(metrics, "link", "derivative").xMetric).toBe("Flow");
    expect(phaseMetricDefaults(metrics, "node", "derivative").xMetric).toBe("Depth");
    expect(phaseMetricDefaults(metrics, "subcatchment", "derivative").xMetric).toBe("Runoff");
  });

  it("breaks rating and derivative trajectories across missing samples", () => {
    const gapped: ParsedTimeSeries = {
      ...SERIES,
      data: [
        { time: "01/01/2020 00:00:00", values: [0, 0, 0] },
        { time: "01/01/2020 01:00:00", values: [1, 1, 1] },
        { time: "bad timestamp", values: [2, 2, 2] },
        { time: "01/01/2020 03:00:00", values: [10, 3, 3] },
        { time: "01/01/2020 04:00:00", values: [11, 4, 4] },
      ],
    };

    expect(buildRatingPhasePoints(gapped, "Depth", "Flow").map(point => point.segment))
      .toEqual([0, 0, 1, 1]);
    expect(buildDerivativePhasePoints(gapped, "Flow")).toEqual([
      { x: 0, y: 1, elapsedSeconds: 0, segment: 0 },
      { x: 1, y: 1, elapsedSeconds: 3600, segment: 0 },
      { x: 10, y: 1, elapsedSeconds: 10800, segment: 1 },
      { x: 11, y: 1, elapsedSeconds: 14400, segment: 1 },
    ]);
  });

  it("discloses missing and unusable engine phase data", () => {
    expect(phaseExclusionReason(false, 0, "rating"))
      .toBe("selected element series is missing from the report");
    expect(phaseExclusionReason(true, 0, "rating"))
      .toBe("no valid paired metric samples are available");
    expect(phaseExclusionReason(true, 0, "derivative"))
      .toBe("fewer than two contiguous valid state samples are available");
    expect(phaseExclusionReason(true, 2, "derivative")).toBeNull();
  });
});