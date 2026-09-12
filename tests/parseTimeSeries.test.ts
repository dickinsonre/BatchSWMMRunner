import { describe, expect, it } from "vitest";
import { parseTimeSeries } from "../client/src/lib/parseTimeSeries";

describe("parseTimeSeries", () => {
  it("preserves metric positions when a report cell is non-numeric", () => {
    const report = `
  ****
  System Results Time Series
  ****
  <<< System >>>
  Date  Time  Runoff  Flooding  Outflow
  Day  Hour:Min  CFS  CFS  CFS
  ------------------------------------
  01/01/2020 00:00:00 1.0 ***** 3.0
  01/01/2020 01:00:00 2.0 4.0 6.0
  ****
`;

    const [system] = parseTimeSeries(report);
    expect(system.columns).toEqual(["Runoff", "Flooding", "Outflow"]);
    expect(system.data[0].values).toHaveLength(3);
    expect(system.data[0].values[0]).toBe(1);
    expect(system.data[0].values[1]).toBeNaN();
    expect(system.data[0].values[2]).toBe(3);
  });
});