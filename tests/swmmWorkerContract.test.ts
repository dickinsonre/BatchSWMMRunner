import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

interface CcallRecord {
  name: string;
  argTypes: unknown;
  args: unknown;
}

function createModule(calls: CcallRecord[]) {
  return {
    FS: {
      unlink: () => {
        throw new Error("missing");
      },
      writeFile: () => {},
      readFile: (filePath: string, options?: { encoding?: string }) => {
        if (options?.encoding && filePath === "/report.rpt") return "report";
        if (filePath === "/report.rpt") return new Uint8Array([0x52, 0x50, 0x54]);
        if (filePath === "/output.out") return new Uint8Array([0, 1, 255]);
        return new Uint8Array();
      },
    },
    ccall: (name: string, _returnType: unknown, argTypes: unknown, args: unknown) => {
      calls.push({ name, argTypes, args });
      if (name === "swmm_engine_create") return 1;
      if (name === "swmm_get_last_error_msg") return "";
      return 0;
    },
    _malloc: () => 8,
    _free: () => {},
    getValue: () => 0,
    UTF8ToString: () => "",
  };
}

function loadWorker() {
  const source = fs.readFileSync(
    path.join(process.cwd(), "client", "public", "wasm", "swmm-worker.js"),
    "utf8",
  );
  const messages: unknown[] = [];
  const transfers: unknown[][] = [];
  const swmm5Calls: CcallRecord[] = [];
  const swmm6Calls: CcallRecord[] = [];
  const scope: Record<string, any> = {
    SwmmOutParser: {
      reportHasTimeSeries: () => true,
      reportHasSystemTimeSeries: () => true,
    },
    createSwmmModule: async () => createModule(swmm5Calls),
    createOswmm6Module: async () => createModule(swmm6Calls),
    postMessage: (message: unknown, transfer?: unknown[]) => {
      messages.push(message);
      if (transfer) transfers.push(transfer);
    },
  };

  expect(() => {
    new Function("self", "importScripts", source)(scope, () => {});
  }).not.toThrow();

  return { scope, messages, transfers, swmm5Calls, swmm6Calls };
}

describe("browser SWMM worker API contract", () => {
  it("loads without reading a message event and dispatches the legacy SWMM5 API", async () => {
    const { scope, messages, swmm5Calls } = loadWorker();

    await scope.onmessage({
      data: {
        type: "run",
        id: "swmm5-run",
        fileName: "model.inp",
        inpText: "[OPTIONS]\nFLOW_UNITS CFS",
        engine: "swmm5",
      },
    });

    expect(swmm5Calls.map(call => call.name)).toEqual(expect.arrayContaining([
      "swmm_open",
      "swmm_start",
      "swmm_step",
      "swmm_end",
      "swmm_report",
      "swmm_close",
    ]));
    expect(messages).toContainEqual(expect.objectContaining({
      type: "done",
      id: "swmm5-run",
      ok: true,
    }));
  });

  it("dispatches handle-based step and report calls for SWMM6", async () => {
    const { scope, messages, swmm6Calls } = loadWorker();

    await scope.onmessage({
      data: {
        type: "run",
        id: "swmm6-run",
        fileName: "model.inp",
        inpText: "[OPTIONS]\nFLOW_UNITS CFS",
        engine: "swmm6",
      },
    });

    const names = swmm6Calls.map(call => call.name);
    expect(names).toEqual(expect.arrayContaining([
      "swmm_engine_create",
      "swmm_engine_open",
      "swmm_engine_initialize",
      "swmm_engine_start",
      "swmm_engine_step",
      "swmm_engine_end",
      "swmm_engine_report",
      "swmm_engine_close",
      "swmm_engine_destroy",
    ]));
    expect(names).not.toContain("swmm_step");
    expect(names).not.toContain("swmm_report");
    expect(swmm6Calls.find(call => call.name === "swmm_engine_step")).toMatchObject({
      argTypes: ["number", "number"],
      args: [1, 8],
    });
    expect(swmm6Calls.find(call => call.name === "swmm_engine_report")).toMatchObject({
      argTypes: ["number"],
      args: [1],
    });
    expect(messages).toContainEqual(expect.objectContaining({
      type: "done",
      id: "swmm6-run",
      ok: true,
    }));
  });

  it("transfers exact native files only when retention is requested", async () => {
    const { scope, messages, transfers } = loadWorker();

    await scope.onmessage({
      data: {
        type: "run",
        id: "retained-run",
        fileName: "model.inp",
        inpText: "[OPTIONS]\nFLOW_UNITS CFS",
        engine: "swmm5",
        retainNativeArtifacts: true,
      },
    });

    const done = messages.find((message: any) => message?.type === "done") as any;
    expect(done.nativeRptBytes).toBeInstanceOf(ArrayBuffer);
    expect(done.nativeOutBytes).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(done.nativeRptBytes))).toEqual([0x52, 0x50, 0x54]);
    expect(Array.from(new Uint8Array(done.nativeOutBytes))).toEqual([0, 1, 255]);
    expect(transfers).toEqual([[done.nativeRptBytes, done.nativeOutBytes]]);
  });
});