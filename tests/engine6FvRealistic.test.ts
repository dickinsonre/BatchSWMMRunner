import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

// A realistic bundled sample model (EXTRAN manual Example 1: 8-hour dynamic
// wave simulation of a real sewer network) rather than the tiny test fixture.
const SAMPLE = path.join(process.cwd(), "public", "samples", "Demo_extran1.inp");
const baseInp = fs.readFileSync(SAMPLE, "utf-8");

const fvInp = baseInp.replace(
  /FLOW_ROUTING\s+DYNWAVE/,
  [
    "FLOW_ROUTING        FV",
    "FV_ORDER            2",
    "FV_LIMITER          MINMOD",
    "FV_TIME_INTEGRATION EULER",
    "FV_RIEMANN          HLLC",
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

async function runModel(
  engine: (typeof ENGINES)[number],
  inp: string,
): Promise<string> {
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
  Module.FS.writeFile("/input.inp", inp);
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

/** Flow-routing continuity error (%) from the report. */
function routingContinuityError(rpt: string): number {
  const section = rpt.split(/Flow Routing Continuity/)[1];
  expect(section, "report has a Flow Routing Continuity section").toBeTruthy();
  const m = section!.match(/Continuity Error \(%\)\s*\.+\s*(-?[\d.]+)/);
  expect(m, "continuity error line present").toBeTruthy();
  return parseFloat(m![1]);
}

/** Max |Flow| per link from the Link Flow Summary table. */
function linkPeakFlows(rpt: string): Map<string, number> {
  const peaks = new Map<string, number>();
  const section = rpt.split(/Link Flow Summary/)[1];
  expect(section, "report has a Link Flow Summary section").toBeTruthy();
  const lines = section!.split("\n");
  let inTable = false;
  for (const line of lines) {
    if (/^\s*-{20,}/.test(line)) {
      if (inTable) continue;
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    const m = line.match(/^\s*(\S+)\s+(CONDUIT|PUMP|ORIFICE|WEIR|OUTLET)\s+(-?[\d.]+)/);
    if (m) peaks.set(m[1], Math.abs(parseFloat(m[3])));
    else if (line.trim() === "" && peaks.size > 0) break;
  }
  return peaks;
}

describe("SWMM6 FV routing on a realistic sample model", () => {
  for (const engine of ENGINES) {
    const present = fs.existsSync(path.join(engine.dir, engine.js));
    describe.skipIf(!present)(engine.label, () => {
      let dwRpt = "";
      let fvRpt = "";

      beforeAll(async () => {
        dwRpt = await runModel(engine, baseInp);
        fvRpt = await runModel(engine, fvInp);
      }, 300000);

      it("actually routes with FV", () => {
        expect(fvRpt).toMatch(/Flow Routing Method\s*\.+\s*FV\b/);
        expect(dwRpt).toMatch(/Flow Routing Method\s*\.+\s*DYNWAVE\b/);
      });

      it("keeps FV continuity error bounded", () => {
        const fvErr = routingContinuityError(fvRpt);
        expect(Number.isFinite(fvErr)).toBe(true);
        // A broken FV configuration typically blows up to tens or hundreds
        // of percent; a physically reasonable run stays within a few percent.
        expect(Math.abs(fvErr)).toBeLessThan(10);
      });

      it("produces link peak flows comparable to DYNWAVE", () => {
        const dwPeaks = linkPeakFlows(dwRpt);
        const fvPeaks = linkPeakFlows(fvRpt);
        expect(dwPeaks.size).toBeGreaterThanOrEqual(5);
        expect(fvPeaks.size).toBe(dwPeaks.size);

        // Compare every hydraulically significant link (peak >= 5% of the
        // largest DYNWAVE peak) against DYNWAVE within a relative tolerance.
        const maxDw = Math.max(...dwPeaks.values());
        expect(maxDw).toBeGreaterThan(0);
        const significant = [...dwPeaks.entries()].filter(([, q]) => q >= 0.05 * maxDw);
        expect(significant.length).toBeGreaterThanOrEqual(5);

        const failures: string[] = [];
        for (const [link, dwQ] of significant) {
          const fvQ = fvPeaks.get(link);
          if (fvQ === undefined) {
            failures.push(`${link}: missing from FV report`);
            continue;
          }
          const relDiff = Math.abs(fvQ - dwQ) / dwQ;
          if (relDiff > 0.35) {
            failures.push(`${link}: DYNWAVE peak ${dwQ}, FV peak ${fvQ} (${(relDiff * 100).toFixed(1)}% off)`);
          }
        }
        expect(failures, failures.join("; ")).toEqual([]);
      });
    });
  }
});
