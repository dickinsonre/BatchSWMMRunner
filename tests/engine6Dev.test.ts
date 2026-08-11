import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { FIXTURES } from "./helpers";

const require = createRequire(import.meta.url);
const DEV_JS = path.join(process.cwd(), "client", "public", "wasm6dev", "openswmm6dev.js");
const DEV_DIR = path.dirname(DEV_JS);
const inpText = fs.readFileSync(path.join(FIXTURES, "valid-model.inp"), "utf-8");

const present = fs.existsSync(DEV_JS);

describe.skipIf(!present)("SWMM6 develop-branch WASM engine", () => {
  it("worker config includes the swmm6dev engine entry", () => {
    const worker = fs.readFileSync(
      path.join(process.cwd(), "client", "public", "wasm", "swmm-worker.js"), "utf-8");
    expect(worker).toContain("swmm6dev");
    expect(worker).toContain("/wasm6dev/openswmm6dev.js");
    expect(worker).toContain("createOswmm6DevModule");
  });

  it("loads, runs a model, and writes a report", async () => {
    const src = fs.readFileSync(DEV_JS, "utf-8");
    const factory = new Function(
      "module", "exports", "require", "__dirname", "__filename",
      `${src}\nreturn createOswmm6DevModule;`,
    );
    const mod = { exports: {} };
    const createModule = factory(mod, mod.exports, require, DEV_DIR, DEV_JS);
    const Module = await createModule({
      wasmBinary: fs.readFileSync(path.join(DEV_DIR, "openswmm6dev.wasm")),
      print: () => {},
      printErr: () => {},
    });
    Module.FS.writeFile("/input.inp", inpText);
    const eng = Module.ccall("swmm_engine_create", "number", [], []);
    expect(eng).not.toBe(0);
    let err = Module.ccall("swmm_engine_open", "number",
      ["number", "string", "string", "string", "number"],
      [eng, "/input.inp", "/report.rpt", "/output.out", 0]);
    expect(err).toBe(0);
    err = Module.ccall("swmm_engine_initialize", "number", ["number"], [eng]);
    expect(err).toBe(0);
    err = Module.ccall("swmm_engine_start", "number", ["number", "number"], [eng, 1]);
    expect(err).toBe(0);
    const elapsedPtr = Module._malloc(8);
    while (true) {
      const code = Module.ccall("swmm_engine_step", "number", ["number", "number"], [eng, elapsedPtr]);
      const elapsed = Module.getValue(elapsedPtr, "double");
      expect(code).toBe(0);
      if (elapsed <= 0) break;
    }
    Module._free(elapsedPtr);
    Module.ccall("swmm_engine_end", "number", ["number"], [eng]);
    Module.ccall("swmm_engine_report", "number", ["number"], [eng]);
    Module.ccall("swmm_engine_close", "number", ["number"], [eng]);
    Module.ccall("swmm_engine_destroy", null, ["number"], [eng]);
    const rpt = Module.FS.readFile("/report.rpt", { encoding: "utf8" }) as string;
    expect(rpt).toContain("OPENSWMM ENGINE");
    expect(rpt).toMatch(/Continuity Error/);
  }, 120000);
});
