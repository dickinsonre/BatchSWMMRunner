import { describe, it, expect } from "vitest";
import { sampleFrameTimes, buildValueLookup, unionTimes } from "../client/src/lib/gifMaker";

const mkSeries = (element: string, times: string[], vals: number[]) => ({
  title: "Node Results Time Series",
  element,
  columns: ["Depth", "Head"],
  units: ["ft", "ft"],
  data: times.map((t, i) => ({ time: t, values: [vals[i], vals[i] + 100] })),
});

describe("gifMaker helpers", () => {
  it("samples evenly and keeps first/last", () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const out = sampleFrameTimes(items, 10);
    expect(out).toHaveLength(10);
    expect(out[0]).toBe(0);
    expect(out[9]).toBe(99);
    expect(sampleFrameTimes([1, 2, 3], 10)).toEqual([1, 2, 3]);
  });

  it("builds per-element lookups with the global max", () => {
    const { lookup, maxValue } = buildValueLookup(
      [mkSeries("N1", ["01/01/2020 00:00", "01/01/2020 01:00"], [1, 5]),
       mkSeries("N2", ["01/01/2020 00:00"], [3])],
      "Depth",
    );
    expect(lookup.get("N1")?.get("01/01/2020 01:00")).toBe(5);
    expect(lookup.get("N2")?.get("01/01/2020 00:00")).toBe(3);
    expect(maxValue).toBe(5);
  });

  it("unions times chronologically across engines", () => {
    const a = buildValueLookup([mkSeries("N1", ["01/01/2020 02:00", "01/01/2020 00:00"], [1, 2])], "Depth").lookup;
    const b = buildValueLookup([mkSeries("N1", ["01/01/2020 01:00"], [9])], "Depth").lookup;
    expect(unionTimes([a, b])).toEqual(["01/01/2020 00:00", "01/01/2020 01:00", "01/01/2020 02:00"]);
  });
});
