import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { FIXTURES } from "./helpers";

const require = createRequire(import.meta.url);

const baseInp = fs.readFileSync(path.join(FIXTURES, "valid-model.inp"), "utf-8");
const fvInp = baseInp.replace(
  /FLOW_ROUTING\s+KINWAVE/,
  [
    "FLOW_ROUTING         FV",
    "FV_ORDER             2",
    "FV_LIMITER           MINMOD",
    "FV_TIME_INTEGRATION  EULER",
    "FV_RIEMANN           HLLC",
  ].join("\n"),
);

const ENGINES = [
  {
    label: "SWMM6 (rel) engine",
    dir: path.join(process.cwd(), "client", "public", "wasm6"),
    js: "openswmm6.js",
    wasm: "openswmm6.wasm",
    factoryName: "createOswmm6Module",
  },
  {
    label: "SWMM6 (develop) engine",
    dir: path.join(process.cwd(), "client", "public", "wasm6dev"),
    js: "openswmm6dev.js",
    wasm: "openswmm6dev.wasm",
    factoryName: "createOswmm6DevModule",
  },
];

async function runFvModel(engine: (typeof ENGINES)[number]): Promise<string> {
  const jsPath = path.join(engine.dir, engine.js);
  const src = fs.readFileSync(jsPath, "utf-8");
  const factory = new Function(
    "module", "exports", "require", "__dirname", "__filename",
    `${src}\nreturn ${engine.factoryName};`,
  );
  const mod = { exports: {} };
  const createModule = factory(mod, mod.exports, require, engine.dir, jsPath);
  const Module = await createModule({
    wasmBinary: fs.readFileSync(path.join(engine.dir, engine.wasm)),
    print: () => {},
    printErr: () => {},
  });
  Module.FS.writeFile("/input.inp", fvInp);
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
  return Module.FS.readFile("/report.rpt", { encoding: "utf8" }) as string;
}

describe("SWMM6 finite-volume (FV) routing", () => {
  for (const engine of ENGINES) {
    const present = fs.existsSync(path.join(engine.dir, engine.js));
    describe.skipIf(!present)(engine.label, () => {
      it("runs a model with FLOW_ROUTING FV and reports FV routing", async () => {
        const rpt = await runFvModel(engine);
        expect(rpt).toContain("OPENSWMM ENGINE");
        expect(rpt).toMatch(/Flow Routing Method\s*\.+\s*FV\b/);
        expect(rpt).toMatch(/Continuity Error/);
      }, 120000);
    });
  }
});
