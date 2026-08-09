import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { createRequire } from "module";
import { parseReportMetrics } from "../server/reportParser";
import { applyInpOverrides, stripVirtualJunctions } from "../shared/inpOptions";
import { FIXTURES } from "./helpers";

const require = createRequire(import.meta.url);
const EXECUTABLE = path.join(process.cwd(), "swmm-engine", "runswmm");
const WASM_JS = path.join(process.cwd(), "client", "public", "wasm", "swmm5.js");
const OSWMM6_JS = path.join(process.cwd(), "client", "public", "wasm6", "openswmm6.js");

const inpText = fs.readFileSync(path.join(FIXTURES, "valid-model.inp"), "utf-8");

function runExecutable(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swmm-parity-"));
  const inp = path.join(dir, "model.inp");
  const rpt = path.join(dir, "model.rpt");
  const out = path.join(dir, "model.out");
  fs.writeFileSync(inp, inpText);
  const res = spawnSync(EXECUTABLE, [inp, rpt, out], { timeout: 60000 });
  if (res.status !== 0) {
    throw new Error(`runswmm exited with ${res.status}: ${res.stderr?.toString()}`);
  }
  const report = fs.readFileSync(rpt, "utf-8");
  fs.rmSync(dir, { recursive: true, force: true });
  return report;
}

async function runWasm(jsPath = WASM_JS, wasmFile = "swmm5.wasm", inputText = inpText): Promise<string> {
  // The emscripten bundle doesn't reliably expose its factory through
  // require() here, so evaluate the script and grab the factory directly.
  const src = fs.readFileSync(jsPath, "utf-8");
  const factory = new Function(
    "module", "exports", "require", "__dirname", "__filename",
    `${src}\nreturn createSwmmModule;`,
  );
  const mod = { exports: {} };
  const createModule = factory(mod, mod.exports, require, path.dirname(jsPath), jsPath);
  const Module = await createModule({
    wasmBinary: fs.readFileSync(path.join(path.dirname(jsPath), wasmFile)),
    locateFile: (file: string) => path.join(path.dirname(jsPath), file),
    print: () => {},
    printErr: () => {},
  });
  const FS = Module.FS;
  FS.writeFile("/input.inp", inputText);

  let err = Module.ccall("swmm_open", "number", ["string", "string", "string"], ["/input.inp", "/report.rpt", "/output.out"]);
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
  return FS.readFile("/report.rpt", { encoding: "utf8" }) as string;
}

const bothEnginesPresent = fs.existsSync(EXECUTABLE) && fs.existsSync(WASM_JS);
const oswmm6Present = fs.existsSync(EXECUTABLE) && fs.existsSync(OSWMM6_JS);

/** Drive the new OpenSWMM 6.x handle-based C API (what the worker now uses for swmm6). */
async function runEngine6(inputText = inpText): Promise<string> {
  const src = fs.readFileSync(OSWMM6_JS, "utf-8");
  const factory = new Function(
    "module", "exports", "require", "__dirname", "__filename",
    `${src}\nreturn createOswmm6Module;`,
  );
  const mod = { exports: {} };
  const createModule = factory(mod, mod.exports, require, path.dirname(OSWMM6_JS), OSWMM6_JS);
  const Module = await createModule({
    wasmBinary: fs.readFileSync(path.join(path.dirname(OSWMM6_JS), "openswmm6.wasm")),
    print: () => {},
    printErr: () => {},
  });
  const FS = Module.FS;
  FS.writeFile("/input.inp", inputText);
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
  const msg = Module.ccall("swmm_get_last_error_msg", "string", ["number"], [eng]);
  Module.ccall("swmm_engine_close", "number", ["number"], [eng]);
  Module.ccall("swmm_engine_destroy", null, ["number"], [eng]);
  if (err !== 0) throw new Error(`SWMM6 run failed with code ${err}: ${msg}`);
  return FS.readFile("/report.rpt", { encoding: "utf8" }) as string;
}

function expectMetricsAgree(refReport: string, otherReport: string) {
  const a = parseReportMetrics(refReport);
  const b = parseReportMetrics(otherReport);

  const close = (x?: number, y?: number, absTol = 0.05, relTol = 0.05) => {
    expect(x).toBeTypeOf("number");
    expect(y).toBeTypeOf("number");
    const diff = Math.abs(x! - y!);
    const scale = Math.max(Math.abs(x!), Math.abs(y!));
    expect(diff <= absTol || diff / scale <= relTol).toBe(true);
  };

  close(a.totalPrecipitation, b.totalPrecipitation);
  close(a.surfaceRunoff, b.surfaceRunoff);
  close(a.totalInflow, b.totalInflow);
  close(a.totalOutflow, b.totalOutflow);
  // Continuity errors are small percentages — compare on absolute tolerance only
  expect(Math.abs(a.runoffContinuityError! - b.runoffContinuityError!)).toBeLessThan(0.5);
  expect(Math.abs(a.routingContinuityError! - b.routingContinuityError!)).toBeLessThan(0.5);
  expect(a.flowRoutingMethod).toBe(b.flowRoutingMethod);
}

describe.runIf(bothEnginesPresent)("engine parity: executable vs WASM", () => {
  let exeReport: string;
  let wasmReport: string;

  beforeAll(async () => {
    exeReport = runExecutable();
    wasmReport = await runWasm();
  }, 120000);

  it("both engines produce valid SWMM reports", () => {
    expect(exeReport).toMatch(/EPA STORM WATER MANAGEMENT MODEL/);
    expect(wasmReport).toMatch(/EPA STORM WATER MANAGEMENT MODEL/);
  });

  it("key metrics agree within tolerance", () => {
    expectMetricsAgree(exeReport, wasmReport);
  });
});

describe.runIf(oswmm6Present)("engine parity: executable vs OpenSWMM 6.x WASM (new engine)", () => {
  let exeReport: string;
  let eng6Report: string;

  beforeAll(async () => {
    exeReport = runExecutable();
    eng6Report = await runEngine6();
  }, 120000);

  it("new engine produces a valid SWMM report", () => {
    expect(eng6Report).toMatch(/OPENSWMM ENGINE - VERSION 6/);
  });

  it("key metrics agree within tolerance", () => {
    expectMetricsAgree(exeReport, eng6Report);
  });

  it("accepts and echoes the SWMM6-only solver keywords", async () => {
    // Surcharge method is only used (and echoed) under dynamic-wave routing.
    const upgraded = inpText.replace(/^(\s*FLOW_ROUTING\s+)\S+/im, "$1DYNWAVE").replace(
      /^\[OPTIONS\][^\n]*\n/im,
      (h) => h +
        "SURCHARGE_METHOD     DYNAMIC_SLOT\n" +
        "DPS_CELERITY         20\n" +
        "DPS_ALPHA            3\n" +
        "DPS_DECAY_TIME       0.5\n" +
        "NODE_CONTINUITY      SEMI_IMPLICIT\n" +
        "ANDERSON_ACCEL       YES\n",
    );
    const report = await runEngine6(upgraded);
    expect(report).toMatch(/Surcharge Method\s*\.+\s*DYNAMIC_SLOT/);
    expect(report).toMatch(/Anderson Acceleration\s*\.+\s*YES/);
    expect(report).not.toMatch(/ERROR 205/);
    expect(report).not.toMatch(/Unknown option keyword/i);
  }, 120000);

  it("runs a virtual-junction model (the alpha.2 build crashed on these)", async () => {
    // Pipe-break model: J2 sits between two conduits with no inflows/DWF, so
    // the upgrader moves it to [VIRTUAL_JUNCTIONS] and writes the momentum key.
    const vjBase = inpText
      .replace(/^(\s*FLOW_ROUTING\s+)\S+/im, "$1DYNWAVE")
      .replace(
        /^J1 .*$/m,
        (j1) => `${j1}\nJ2               97.5       4          0          0          0`,
      )
      .replace(/^C1\s+J1\s+O1.*$/m,
        "C1               J1               J2               200        0.013      0          0          0          0\n" +
        "C2               J2               O1               200        0.013      0          0          0          0",
      )
      .replace(/^C1\s+CIRCULAR.*$/m,
        "C1               CIRCULAR     1.5              0          0          0          1\n" +
        "C2               CIRCULAR     1.5              0          0          0          1",
      );
    const upgraded = applyInpOverrides(vjBase, {
      swmm6: { enabled: true, virtualJunctions: true, vjMomentum: "FULL" },
    });
    expect(upgraded).toMatch(/\[VIRTUAL_JUNCTIONS\]/);
    const report = await runEngine6(upgraded);
    expect(report).toMatch(/Virtual Junction Summary/i);
    expect(report).not.toMatch(/ERROR/);

    // Round-trip: the stripped model must run on the SWMM 5.x executable.
    const stripped = stripVirtualJunctions(upgraded).content;
    expect(stripped).not.toMatch(/VIRTUAL_JUNCTION/);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swmm-vj-"));
    fs.writeFileSync(path.join(dir, "m.inp"), stripped);
    const res = spawnSync(EXECUTABLE, [path.join(dir, "m.inp"), path.join(dir, "m.rpt"), path.join(dir, "m.out")], { timeout: 60000 });
    const rpt5 = fs.readFileSync(path.join(dir, "m.rpt"), "utf-8");
    fs.rmSync(dir, { recursive: true, force: true });
    expect(res.status).toBe(0);
    expect(rpt5).not.toMatch(/ERROR/);
  }, 120000);
});
