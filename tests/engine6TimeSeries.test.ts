import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { parseTimeSeries } from "../client/src/lib/parseTimeSeries";
import { mergeSystemSeries } from "../client/src/lib/engineComparison";
import { parseReportMetrics } from "../server/reportParser";
import { FIXTURES } from "./helpers";

const require = createRequire(import.meta.url);

// Verifies that the new OpenSWMM 6.0.0-alpha.3 engine (plugin I/O) writes a
// binary .out that client/public/wasm/swmm-out-parser.js — written for the
// EPA SWMM 5 binary format — parses correctly, so RPT Graphs and engine
// comparison charts keep working. Mirrors the swmm6 branch of
// client/public/wasm/swmm-worker.js exactly, including its graceful
// fallback (parser returns '' → nothing appended, report still usable).
const WASM_DIR = path.join(process.cwd(), "client", "public", "wasm");
const WASM6_DIR = path.join(process.cwd(), "client", "public", "wasm6");
const OSWMM6_JS = path.join(WASM6_DIR, "openswmm6.js");
const PARSER_JS = path.join(WASM_DIR, "swmm-out-parser.js");

const prerequisites = fs.existsSync(OSWMM6_JS) && fs.existsSync(PARSER_JS);

const inpText = fs.readFileSync(path.join(FIXTURES, "valid-model.inp"), "utf-8");

// The shared parser is a plain UMD module — same object the worker uses as
// self.SwmmOutParser after importScripts().
const SwmmOutParser = (() => {
  const src = fs.readFileSync(PARSER_JS, "utf-8");
  const scope: any = {};
  new Function("self", src)(scope);
  return scope.SwmmOutParser;
})();

interface Engine6RunResult {
  err: number;
  rptText: string;
  outBytes: Uint8Array | null;
  rawRptHadTimeSeries: boolean;
  appended: boolean;
}

/** Run the new handle-based OpenSWMM 6.x engine and apply the worker's
 *  .out-append logic verbatim. */
async function runEngine6LikeWorker(input = inpText): Promise<Engine6RunResult> {
  const src = fs.readFileSync(OSWMM6_JS, "utf-8");
  const factory = new Function(
    "module", "exports", "require", "__dirname", "__filename",
    `${src}\nreturn createOswmm6Module;`,
  );
  const mod = { exports: {} };
  const createModule = factory(mod, mod.exports, require, WASM6_DIR, OSWMM6_JS);
  const Module = await createModule({
    wasmBinary: fs.readFileSync(path.join(WASM6_DIR, "openswmm6.wasm")),
    print: () => {},
    printErr: () => {},
  });
  const FS = Module.FS;
  FS.writeFile("/input.inp", input);

  const eng = Module.ccall("swmm_engine_create", "number", [], []);
  if (!eng) throw new Error("failed to create engine");
  let err = Module.ccall("swmm_engine_open", "number",
    ["number", "string", "string", "string", "number"],
    [eng, "/input.inp", "/report.rpt", "/output.out", 0]);
  if (err === 0) err = Module.ccall("swmm_engine_initialize", "number", ["number"], [eng]);
  if (err === 0) err = Module.ccall("swmm_engine_start", "number", ["number", "number"], [eng, 1]);
  if (err === 0) {
    const elapsedPtr = Module._malloc(8);
    while (true) {
      const code = Module.ccall("swmm_engine_step", "number", ["number", "number"], [eng, elapsedPtr]);
      const elapsed = Module.getValue(elapsedPtr, "double");
      if (code !== 0) { err = code; break; }
      if (elapsed <= 0) break;
    }
    Module._free(elapsedPtr);
    Module.ccall("swmm_engine_end", "number", ["number"], [eng]);
    Module.ccall("swmm_engine_report", "number", ["number"], [eng]);
  }
  Module.ccall("swmm_engine_close", "number", ["number"], [eng]);
  Module.ccall("swmm_engine_destroy", null, ["number"], [eng]);

  let rptText = "";
  try { rptText = FS.readFile("/report.rpt", { encoding: "utf8" }) as string; } catch (_) {}
  let outBytes: Uint8Array | null = null;
  try { outBytes = FS.readFile("/output.out") as Uint8Array; } catch (_) {}

  // Same append logic as client/public/wasm/swmm-worker.js.
  const rawRptHadTimeSeries = SwmmOutParser.reportHasTimeSeries(rptText);
  let appended = false;
  if (err === 0 && rptText && !rawRptHadTimeSeries) {
    if (outBytes) {
      const tsText = SwmmOutParser.parseSwmmOutBinary(outBytes);
      if (tsText) { rptText = rptText + "\n" + tsText; appended = true; }
    }
  } else if (err === 0 && rptText && !SwmmOutParser.reportHasSystemTimeSeries(rptText)) {
    if (outBytes) {
      const sysText = SwmmOutParser.parseSwmmOutBinary(outBytes, { systemOnly: true });
      if (sysText) { rptText = rptText + "\n" + sysText; appended = true; }
    }
  }
  return { err, rptText, outBytes, rawRptHadTimeSeries, appended };
}

// Same model but with [REPORT] NODES/LINKS ALL so the engine writes element
// time series straight into the .rpt — the systemOnly append branch.
const inpTextWithReporting =
  inpText + "\n[REPORT]\nSUBCATCHMENTS ALL\nNODES ALL\nLINKS ALL\n";

describe.runIf(prerequisites)("OpenSWMM 6.x plugin I/O output → RPT Graphs & comparisons", () => {
  let result: Engine6RunResult;

  beforeAll(async () => {
    result = await runEngine6LikeWorker();
  }, 120000);

  it("runs cleanly and produces a SWMM6-branded report", () => {
    expect(result.err).toBe(0);
    expect(result.rptText).toMatch(/OPENSWMM ENGINE - VERSION 6/);
  });

  it("writes an EPA-SWMM-5-compatible binary .out (magic number + clean close)", () => {
    const bytes = result.outBytes!;
    expect(bytes).toBeTruthy();
    expect(bytes.length).toBeGreaterThan(40);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const MAGIC = 516114522;
    expect(view.getInt32(0, true)).toBe(MAGIC);                    // opening magic
    expect(view.getInt32(bytes.length - 4, true)).toBe(MAGIC);     // closing magic
    expect(view.getInt32(bytes.length - 2 * 4, true)).toBe(0);     // error code
    expect(view.getInt32(bytes.length - 3 * 4, true)).toBeGreaterThan(0); // periods
  });

  it("worker append logic kicks in and adds time-series sections", () => {
    // The fixture's [REPORT] has no element reporting, so the raw rpt has no
    // time series and the .out append path is exercised.
    expect(result.rawRptHadTimeSeries).toBe(false);
    expect(result.appended).toBe(true);
    expect(result.rptText).toContain("System Results Time Series");
    expect(result.rptText).toContain("<<<");
  });

  it("RPT Graphs parser (parseTimeSeries) yields chartable, finite series", () => {
    const series = parseTimeSeries(result.rptText);
    expect(series.length).toBeGreaterThan(0);
    for (const s of series) {
      expect(s.element).toBeTruthy();
      expect(s.columns.length).toBeGreaterThan(0);
      expect(s.units.length).toBe(s.columns.length);
      expect(s.data.length).toBeGreaterThan(1);
      for (const row of s.data) {
        expect(row.values.length).toBe(s.columns.length);
        for (const v of row.values) expect(Number.isFinite(v)).toBe(true);
      }
    }
    // Real hydraulics: at least one non-zero value somewhere.
    const anyNonZero = series.some((s) =>
      s.data.some((row) => row.values.some((v) => Math.abs(v) > 1e-6)),
    );
    expect(anyNonZero).toBe(true);
  });

  it("System series feeds engine-comparison charts with sane merged rows", () => {
    const series = parseTimeSeries(result.rptText);
    const sys = series.find((s) => /System Results Time Series/i.test(s.title));
    expect(sys).toBeTruthy();
    const outflowIdx = sys!.columns.findIndex((c) => /^Outflow$/i.test(c));
    expect(outflowIdx).toBeGreaterThanOrEqual(0);

    // Merge the SWMM6 system series against itself under two engine labels —
    // exactly what the comparison chart does with multiple engine runs.
    const rows = mergeSystemSeries(
      [
        { label: "SWMM6", series: sys! },
        { label: "Executable", series: sys! },
      ],
      "Outflow",
    );
    expect(rows.length).toBe(sys!.data.length);
    for (const row of rows) {
      expect(typeof row.time).toBe("string");
      expect(Number.isFinite(row["SWMM6"] as number)).toBe(true);
      expect(row["SWMM6"]).toBe(row["Executable"]);
    }
    const anyFlow = rows.some((r) => Math.abs(r["SWMM6"] as number) > 1e-6);
    expect(anyFlow).toBe(true);
  });

  it("report metrics parse for comparison summary tables", () => {
    const m = parseReportMetrics(result.rptText);
    expect(m.totalInflow).toBeTypeOf("number");
    expect(m.totalOutflow).toBeTypeOf("number");
    expect(m.runoffContinuityError).toBeTypeOf("number");
    expect(m.routingContinuityError).toBeTypeOf("number");
  });

  describe("[REPORT] NODES/LINKS ALL model", () => {
    let result: Engine6RunResult;

    beforeAll(async () => {
      result = await runEngine6LikeWorker(inpTextWithReporting);
    }, 120000);

    it("runs cleanly; engine6 rpt has no native element series (unlike SWMM5), so the full .out append runs", () => {
      // The OpenSWMM 6.x plugin-I/O report writer never emits element time
      // series into the .rpt, even with NODES/LINKS ALL. The worker's
      // reportHasTimeSeries check is therefore false and the full-append
      // branch (not systemOnly) fills in the sections from the binary .out.
      expect(result.err).toBe(0);
      expect(result.rawRptHadTimeSeries).toBe(false);
      expect(result.appended).toBe(true);
      expect(result.rptText).toContain("<<<");
      expect(result.rptText).toContain("System Results Time Series");
    });

    it("systemOnly parse (worker's other branch) still works on the engine6 .out", () => {
      // If a future engine6 build starts writing element series into the rpt,
      // the worker would take the systemOnly branch — verify it yields a
      // chartable System section from this .out.
      const sysText = SwmmOutParser.parseSwmmOutBinary(result.outBytes!, { systemOnly: true });
      expect(sysText).toContain("System Results Time Series");
      expect(sysText).not.toMatch(/<<< (Node|Link|Subcatchment) /);
      const sysSeries = parseTimeSeries(result.rptText.split("System Results")[0] + "\n" + sysText);
      const sys = sysSeries.find((s) => /System Results Time Series/i.test(s.title));
      expect(sys).toBeTruthy();
      expect(sys!.data.length).toBeGreaterThan(1);
    });

    it("parseTimeSeries charts node/link sections plus the System section", () => {
      const series = parseTimeSeries(result.rptText);
      const nodeSeries = series.filter((s) => /Node/i.test(s.title));
      const linkSeries = series.filter((s) => /Link/i.test(s.title));
      const sysSeries = series.filter((s) => /System Results Time Series/i.test(s.title));
      expect(nodeSeries.length).toBeGreaterThan(0);
      expect(linkSeries.length).toBeGreaterThan(0);
      expect(sysSeries.length).toBeGreaterThan(0);
      for (const s of series) {
        expect(s.element).toBeTruthy();
        expect(s.columns.length).toBeGreaterThan(0);
        expect(s.units.length).toBe(s.columns.length);
        expect(s.data.length).toBeGreaterThan(1);
        for (const row of s.data) {
          expect(row.values.length).toBe(s.columns.length);
          for (const v of row.values) expect(Number.isFinite(v)).toBe(true);
        }
      }
      const anyNonZero = series.some((s) =>
        s.data.some((row) => row.values.some((v) => Math.abs(v) > 1e-6)),
      );
      expect(anyNonZero).toBe(true);
    });
  });

  it("falls back gracefully when the .out format differs (parser returns '')", () => {
    // Simulate a future format change: corrupt the magic number. The shared
    // parser must return '' (never throw), so the worker appends nothing and
    // the report remains usable without time series.
    const bad = new Uint8Array(result.outBytes!);
    bad[0] ^= 0xff;
    expect(SwmmOutParser.parseSwmmOutBinary(bad)).toBe("");
    expect(SwmmOutParser.parseSwmmOutBinary(bad, { systemOnly: true })).toBe("");
    // Truncated / garbage inputs are equally safe.
    expect(SwmmOutParser.parseSwmmOutBinary(new Uint8Array(10))).toBe("");
    expect(SwmmOutParser.parseSwmmOutBinary(result.outBytes!.subarray(0, 60))).toBe("");
  });
});
