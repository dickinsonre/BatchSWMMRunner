import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { parseTimeSeries } from "../client/src/lib/parseTimeSeries";

const require = createRequire(import.meta.url);

// This harness mirrors client/public/wasm/swmm-worker.js exactly:
// load the SWMM5 WASM engine, run a real model, read /report.rpt and
// /output.out from the in-memory FS, and (when the rpt lacks time series)
// append rpt-style sections parsed from the binary .out via the shared
// UMD parser — the same append logic the worker uses.
const WASM_DIR = path.join(process.cwd(), "client", "public", "wasm");
const WASM_JS = path.join(WASM_DIR, "swmm5.js");
const PARSER_JS = path.join(WASM_DIR, "swmm-out-parser.js");
// Real-world model (same one used for server-side .out parser coverage).
const SAMPLE_INP = path.join(process.cwd(), "attached_assets", "extran2_1785798280496.inp");

const prerequisites = fs.existsSync(WASM_JS) && fs.existsSync(PARSER_JS) && fs.existsSync(SAMPLE_INP);

// The shared parser is a plain UMD module — same object the worker uses as
// self.SwmmOutParser after importScripts(). require() treats .js as ESM here
// ("type":"module"), so evaluate the script the way importScripts would.
const SwmmOutParser = (() => {
  const src = fs.readFileSync(PARSER_JS, "utf-8");
  const scope: any = {};
  new Function("self", src)(scope);
  return scope.SwmmOutParser;
})();

interface WorkerRunResult {
  rptText: string;
  rawRptHadTimeSeries: boolean;
  appended: boolean;
}

async function runWasmLikeWorker(inpText: string): Promise<WorkerRunResult> {
  // The emscripten bundle doesn't reliably expose its factory through
  // require() here, so evaluate the script and grab the factory directly.
  const src = fs.readFileSync(WASM_JS, "utf-8");
  const factory = new Function(
    "module", "exports", "require", "__dirname", "__filename",
    `${src}\nreturn createSwmmModule;`,
  );
  const mod = { exports: {} };
  const createModule = factory(mod, mod.exports, require, WASM_DIR, WASM_JS);
  const Module = await createModule({
    wasmBinary: fs.readFileSync(path.join(WASM_DIR, "swmm5.wasm")),
    locateFile: (file: string) => path.join(WASM_DIR, file),
    print: () => {},
    printErr: () => {},
  });
  const FS = Module.FS;

  const inpPath = "/input.inp";
  const rptPath = "/report.rpt";
  const outPath = "/output.out";
  FS.writeFile(inpPath, inpText);

  let err = Module.ccall("swmm_open", "number", ["string", "string", "string"], [inpPath, rptPath, outPath]);
  if (err === 0) {
    err = Module.ccall("swmm_start", "number", ["number"], [1]);
    if (err === 0) {
      const elapsedPtr = Module._malloc(8);
      while (true) {
        const code = Module.ccall("swmm_step", "number", ["number"], [elapsedPtr]);
        const elapsed = Module.getValue(elapsedPtr, "double");
        if (code !== 0) { err = code; break; }
        if (elapsed <= 0) break;
      }
      Module._free(elapsedPtr);
      const endErr = Module.ccall("swmm_end", "number", [], []);
      if (err === 0) err = endErr;
    }
    const rptErr = Module.ccall("swmm_report", "number", [], []);
    if (err === 0) err = rptErr;
  }
  Module.ccall("swmm_close", "number", [], []);
  if (err !== 0) throw new Error(`WASM SWMM run failed with code ${err}`);

  let rptText = FS.readFile(rptPath, { encoding: "utf8" }) as string;
  const rawRptHadTimeSeries = SwmmOutParser.reportHasTimeSeries(rptText);

  // Same append logic as the worker.
  let appended = false;
  if (rptText && !rawRptHadTimeSeries) {
    const outBytes = FS.readFile(outPath) as Uint8Array;
    const tsText = SwmmOutParser.parseSwmmOutBinary(outBytes);
    if (tsText) {
      rptText = rptText + "\n" + tsText;
      appended = true;
    }
  }
  return { rptText, rawRptHadTimeSeries, appended };
}

function expectChartableSeries(rptText: string, opts: { requireNodeLink?: boolean } = {}) {
  // parseTimeSeries is exactly what the RPT Graphs tab feeds into recharts.
  const series = parseTimeSeries(rptText);
  expect(series.length).toBeGreaterThan(0);

  if (opts.requireNodeLink !== false) {
    const nodeSeries = series.filter((s) => /Node/i.test(s.title));
    const linkSeries = series.filter((s) => /Link/i.test(s.title));
    expect(nodeSeries.length).toBeGreaterThan(0);
    expect(linkSeries.length).toBeGreaterThan(0);
  }

  for (const s of series) {
    expect(s.element).toBeTruthy();
    expect(s.columns.length).toBeGreaterThan(0);
    expect(s.units.length).toBe(s.columns.length);
    expect(s.data.length).toBeGreaterThan(1);
    for (const row of s.data.slice(0, 5)) {
      expect(row.values.length).toBe(s.columns.length);
      for (const v of row.values) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  }

  // Real hydraulics: at least one value should be non-zero.
  const anyNonZero = series.some((s) =>
    s.data.some((row) => row.values.some((v) => Math.abs(v) > 1e-6)),
  );
  expect(anyNonZero).toBe(true);
}

describe.runIf(prerequisites)("WASM worker time-series path (real model)", () => {
  const inpText = fs.readFileSync(SAMPLE_INP, "utf-8");

  describe("model with [REPORT] NODES/LINKS ALL (rpt has native time series)", () => {
    let result: WorkerRunResult;

    beforeAll(async () => {
      result = await runWasmLikeWorker(inpText);
    }, 120000);

    it("rpt already contains time series, so no append happens", () => {
      expect(result.rawRptHadTimeSeries).toBe(true);
      expect(result.appended).toBe(false);
    });

    it("RPT Graphs parser produces chartable series", () => {
      expect(result.rptText).toMatch(/EPA STORM WATER MANAGEMENT MODEL/);
      expectChartableSeries(result.rptText);
    });
  });

  describe("model without element reporting (worker must append from .out)", () => {
    let result: WorkerRunResult;

    beforeAll(async () => {
      // Strip SUBCATCHMENTS/NODES/LINKS lines from [REPORT] so the rpt has
      // no time series — the common case for models uploaded to the app.
      const stripped = inpText.replace(/^\s*(SUBCATCHMENTS|NODES|LINKS)\s+ALL\s*$/gim, "");
      result = await runWasmLikeWorker(stripped);
    }, 120000);

    it("raw rpt lacks time series and the .out append kicks in", () => {
      expect(result.rawRptHadTimeSeries).toBe(false);
      expect(result.appended).toBe(true);
    });

    it("final report contains Results Time Series sections with <<< markers", () => {
      // With element reporting disabled, SWMM also omits those elements from
      // the binary .out (report flags gate both), so the appended sections
      // contain the System series — still chartable in the RPT Graphs tab.
      expect(result.rptText).toContain("System Results Time Series");
      expect(result.rptText).toContain("<<<");
      expect(SwmmOutParser.reportHasTimeSeries(result.rptText)).toBe(true);
    });

    it("RPT Graphs parser produces chartable series from appended sections", () => {
      expectChartableSeries(result.rptText, { requireNodeLink: false });
    });
  });
});
