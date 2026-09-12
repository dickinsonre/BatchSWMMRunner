import { describe, expect, it } from "vitest";
import {
  buildComparisonModelOptions,
  commonEntityMetrics,
  entitySeriesKind,
  indexEntitySeries,
  mergeEntityMetric,
} from "../client/src/lib/entityComparison";
import type { ParsedTimeSeries } from "../client/src/lib/parseTimeSeries";
import type { EngineRun } from "../client/src/lib/engineComparison";

function series(
  title: string,
  element: string,
  times: string[] = ["01/01/2020 00:00", "01/01/2020 01:00"],
  values: number[] = [1, 2],
): ParsedTimeSeries {
  return {
    title,
    element,
    columns: ["Depth"],
    units: ["ft"],
    data: times.map((time, index) => ({ time, values: [values[index]] })),
  };
}

describe("entity comparison indexing", () => {
  it("classifies and indexes node, link, and subcatchment series with bare IDs", () => {
    const node = series("Node Results Time Series", "Node N1");
    const link = series("Link Results Time Series", "Link C10");
    const subcatchment = series("Subcatchment Results Time Series", "Subcatchment S2");

    expect(entitySeriesKind(node)).toBe("node");
    expect(entitySeriesKind(link)).toBe("link");
    expect(entitySeriesKind(subcatchment)).toBe("subcatchment");

    const index = indexEntitySeries([node, link, subcatchment]);
    expect(index.node.get("N1")).toBe(node);
    expect(index.link.get("C10")).toBe(link);
    expect(index.subcatchment.get("S2")).toBe(subcatchment);
  });

  it("uses the section title when SWMM6 reports a bare element ID", () => {
    const subcatchment = series("Subcatchment Results Time Series", "S100");
    expect(indexEntitySeries([subcatchment]).subcatchment.get("S100")).toBe(subcatchment);
  });
});

describe("buildComparisonModelOptions", () => {
  it("keeps duplicate basenames independently selectable and aligned by occurrence", () => {
    const result = (id: string, reportContent: string) => ({
      id,
      fileName: "network.inp",
      status: "success" as const,
      reportContent,
    });
    const runs: EngineRun[] = [
      {
        engine: "wasm",
        label: "A",
        jobId: null,
        results: [result("a1", "A first"), result("a2", "A second")] as any,
      },
      {
        engine: "wasm6",
        label: "B",
        jobId: null,
        results: [result("b1", "B first"), result("b2", "B second")] as any,
      },
    ];

    const options = buildComparisonModelOptions(runs);
    expect(options.map(option => option.label)).toEqual(["network.inp", "network.inp (2)"]);
    expect(options.map(option => option.occurrence)).toEqual([0, 1]);
    expect(options[0].results.map(item => item?.reportContent)).toEqual(["A first", "B first"]);
    expect(options[1].results.map(item => item?.reportContent)).toEqual(["A second", "B second"]);
  });

  it("keeps attempted candidates visible when a score view has one successful reference", () => {
    const success = {
      id: "a1",
      fileName: "network.inp",
      status: "success" as const,
      reportContent: "reference report",
    };
    const failed = {
      id: "b1",
      fileName: "network.inp",
      status: "failed" as const,
      reportContent: undefined,
    };
    const runs: EngineRun[] = [
      { engine: "wasm", label: "Reference", jobId: null, results: [success] as any },
      { engine: "wasm6", label: "Attempted", jobId: null, results: [failed] as any },
    ];

    expect(buildComparisonModelOptions(runs)).toEqual([]);
    expect(buildComparisonModelOptions(runs, 1)).toMatchObject([{
      fileName: "network.inp",
      results: [success, failed],
    }]);
  });
});

describe("mergeEntityMetric", () => {
  it("aligns each engine to elapsed time instead of raw calendar timestamps", () => {
    const stable = series(
      "Node Results Time Series",
      "Node N1",
      ["01/01/2020 00:00", "01/01/2020 01:00"],
      [1, 2],
    );
    const dev = series(
      "Node Results Time Series",
      "Node N1",
      ["06/10/2025 12:00", "06/10/2025 13:00"],
      [10, 20],
    );

    expect(mergeEntityMetric([
      { label: "Stable", series: stable },
      { label: "Dev", series: dev },
    ], "depth")).toEqual([
      { elapsedSeconds: 0, Stable: 1, Dev: 10 },
      { elapsedSeconds: 3600, Stable: 2, Dev: 20 },
    ]);
  });

  it("keeps gaps when engines use different report steps", () => {
    const hourly = series(
      "Link Results Time Series",
      "Link C1",
      ["01/01/2020 00:00", "01/01/2020 01:00"],
      [1, 2],
    );
    const halfHourly = series(
      "Link Results Time Series",
      "Link C1",
      ["01/01/2020 00:00", "01/01/2020 00:30", "01/01/2020 01:00"],
      [5, 6, 7],
    );
    const rows = mergeEntityMetric([
      { label: "A", series: hourly },
      { label: "B", series: halfHourly },
    ], "Depth");
    expect(rows[1]).toMatchObject({ elapsedSeconds: 1800, B: 6 });
    expect(rows[1].A).toBeUndefined();
  });

  it("keeps the true numeric spacing for irregular report intervals", () => {
    const irregular = series(
      "Node Results Time Series",
      "Node N1",
      ["01/01/2020 00:00:00", "01/01/2020 00:01:00", "01/01/2020 01:00:00"],
      [1, 2, 3],
    );
    expect(mergeEntityMetric([
      { label: "A", series: irregular },
      { label: "B", series: irregular },
    ], "Depth").map(row => row.elapsedSeconds)).toEqual([0, 60, 3600]);
  });
});

describe("commonEntityMetrics", () => {
  it("offers only metrics available in every visible engine series", () => {
    const first = series("Node Results Time Series", "Node N1");
    first.columns = ["Depth", "Head"];
    first.units = ["ft", "ft"];
    first.data.forEach(point => { point.values = [1, 2]; });

    const second = series("Node Results Time Series", "Node N1");
    second.columns = ["depth", "Flooding"];
    second.units = ["m", "CMS"];
    second.data.forEach(point => { point.values = [3, 4]; });

    expect(commonEntityMetrics([first, second])).toEqual([{ name: "Depth", unit: "ft" }]);
    expect(commonEntityMetrics([first])).toEqual([]);
  });
});