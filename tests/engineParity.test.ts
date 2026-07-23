import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { createRequire } from "module";
import { parseReportMetrics } from "../server/reportParser";
import { FIXTURES } from "./helpers";

const require = createRequire(import.meta.url);
const EXECUTABLE = path.join(process.cwd(), "swmm-engine", "runswmm");
const WASM_JS = path.join(process.cwd(), "client", "public", "wasm", "swmm5.js");

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

async function runWasm(): Promise<string> {
  // The emscripten bundle doesn't reliably expose its factory through
  // require() here, so evaluate the script and grab createSwmmModule directly.
  const src = fs.readFileSync(WASM_JS, "utf-8");
  const factory = new Function(
    "module", "exports", "require", "__dirname", "__filename",
    `${src}\nreturn createSwmmModule;`,
  );
  const mod = { exports: {} };
  const createSwmmModule = factory(mod, mod.exports, require, path.dirname(WASM_JS), WASM_JS);
  const Module = await createSwmmModule({
    wasmBinary: fs.readFileSync(path.join(path.dirname(WASM_JS), "swmm5.wasm")),
    locateFile: (file: string) => path.join(path.dirname(WASM_JS), file),
    print: () => {},
    printErr: () => {},
  });
  const FS = Module.FS;
  FS.writeFile("/input.inp", inpText);

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
    const a = parseReportMetrics(exeReport);
    const b = parseReportMetrics(wasmReport);

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
  });
});
