import { beforeEach, describe, expect, it } from "vitest";
import {
  clearRetainedRuns,
  getRetainedRuns,
  mergeRetainedResultContent,
  publishRetainedRun,
  subscribeRetainedRuns,
} from "../client/src/lib/resultsStore";
import type { ProcessResult } from "@shared/schema";

function result(id: string, engine: string): ProcessResult {
  return {
    id,
    fileName: `${engine}.inp`,
    filePath: `${engine}.inp`,
    status: "success",
    provenance: { requestedEngine: engine, actualEngine: engine },
    hasReport: true,
    hasInp: true,
  };
}

describe("retained run store", () => {
  beforeEach(() => clearRetainedRuns());

  it("publishes browser and server batches without colliding result IDs", () => {
    const browserResult = result("same-file-id", "wasm");
    const serverResult = result("same-file-id", "executable");
    publishRetainedRun({
      key: "comparison:one:wasm",
      engine: "wasm",
      label: "SWMM5 WASM",
      jobId: null,
      results: [browserResult],
    });
    publishRetainedRun({
      key: "server:job-two",
      engine: "executable",
      label: "Executable",
      jobId: "job-two",
      results: [serverResult],
    });

    const runs = getRetainedRuns();
    expect(runs).toHaveLength(2);
    expect(runs.map(run => `${run.key}:${run.results[0].id}`)).toEqual([
      "comparison:one:wasm:same-file-id",
      "server:job-two:same-file-id",
    ]);
  });

  it("merges lazy content while preserving the ProcessResult identity", () => {
    const item = result("lazy", "executable");
    const run = publishRetainedRun({
      engine: "executable",
      label: "Executable",
      jobId: "job-lazy",
      results: [item],
    });
    const notifications: number[] = [];
    const unsubscribe = subscribeRetainedRuns(() => notifications.push(1));

    expect(mergeRetainedResultContent(run.key, item.id, {
      reportContent: "full report",
      inpContent: "full inp",
    })).toBe(item);
    expect(getRetainedRuns()[0].results[0]).toBe(item);
    expect(item.reportContent).toBe("full report");
    expect(item.inpContent).toBe("full inp");
    expect(notifications).toHaveLength(1);
    unsubscribe();
  });

  it("keeps a one-sided completed baseline available", () => {
    const item = result("baseline", "wasm");
    publishRetainedRun({
      key: "browser:wasm:one-sided",
      engine: "wasm",
      label: "SWMM5 WASM",
      jobId: null,
      results: [item],
    });
    const [run] = getRetainedRuns();
    expect(run.results).toHaveLength(1);
    expect(run.results[0]).toBe(item);
    expect(run.engine).toBe("wasm");
  });
});