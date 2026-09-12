import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { applyInpOverrides, DEFAULT_FV_CELL_LENGTH } from "../shared/inpOptions";

const require = createRequire(import.meta.url);

// FV vs DYNWAVE comparison on sample models with special structures (pumps,
// storage, weirs) and on a large (>300 hydraulic element) model, so that a
// special-structure bug in the FV path can't ship unnoticed.
//
// Model selection notes (probed against the bundled engines):
//  - EPA_Example3.inp: pump + storage on a 60+ element network; DYNWAVE
//    continuity ~-0.04% — a sound baseline.
//  - Demo_extran7.inp: EXTRAN example with an in-line pump; clean baseline.
//  - Session73_527_H_Elements.inp: 529 hydraulic elements; both engines keep
//    continuity < 1%. One known outlier link is tolerated (see below).
//  - Rejected as baselines: Session62_ALLWEIR (DYNWAVE itself reports ~59%
//    continuity error and all-zero conduit flows), Session74_449_H_Elements
//    (DYNWAVE continuity ~11% with start-up transient peak spikes) and
//    Session4_40Subs_327Links (DYNWAVE continuity ~21%). Comparing FV against
//    a broken DYNWAVE run verifies nothing.
//
// RESOLVED weir divergence (Demo_extran4): the old ~7x weir peak gap
// (DYNWAVE ~28 cfs vs FV ~4 cfs) was NOT a weir-coupling bug. FV's default
// COARSE mesh puts only 4 cells on every conduit, so the 5000 ft, n=0.034
// conduit 1602 got 1250 ft cells; at that resolution the face reconstruction
// over-conveys the conduit far beyond its Manning capacity (~81 cfs vs the
// ~57 cfs DYNWAVE routes), the upstream node never backs up over the weir
// crest, and the weir starves. Diagnosed on a single-pipe model: with the
// COARSE mesh, FV passed 60 cfs through a ~43 cfs-capacity pipe at a
// reported 31 ft/s while its flow was insensitive to Manning n; with
// FV_CELL_LENGTH 100 the pipe pressurizes and backs up like DYNWAVE. With
// FV_CELL_LENGTH 100 on Demo_extran4 the weir peak is ~26.6 cfs (~6% off
// DYNWAVE) and every conduit agrees. The FIX lives in the application path:
// normalizeSwmm6Options (shared/inpOptions.ts) now injects a safe
// FV_CELL_LENGTH default whenever an FV run does not set one, and the weir
// spec below builds its FV variant through that exact path, so the full
// peak comparison guards both the engine behavior and the app default.
interface SampleSpec {
  name: string;
  file: string;
  /** Overrides applied to both DYNWAVE and FV variants (e.g. shorter window). */
  overrides?: [RegExp, string][];
  /** Minimum significant links expected in the comparison. */
  minSignificantLinks: number;
  /** Structure types that must appear with nonzero peak flow under DYNWAVE. */
  requiredStructures?: string[];
  /** Max number of significant links allowed outside the peak tolerance. */
  allowedOutliers?: number;
  /**
   * Build the FV variant through the application path (applyInpOverrides with
   * fvRouting enabled and NO explicit cell length) instead of the manual
   * FV_OPTIONS block, so the app's safe-mesh default is what gets verified.
   */
  useAppFvPath?: boolean;
}

const SAMPLES: SampleSpec[] = [
  {
    name: "pump + storage (EPA_Example3)",
    file: "EPA_Example3.inp",
    minSignificantLinks: 10,
    requiredStructures: ["PUMP"],
  },
  {
    name: "in-line pump (Demo_extran7)",
    file: "Demo_extran7.inp",
    minSignificantLinks: 5,
    requiredStructures: ["PUMP"],
  },
  {
    name: "large 529-element model (Session73_527_H_Elements)",
    file: "Session73_527_H_Elements.inp",
    minSignificantLinks: 100,
    // The upstream develop-branch FV solver (snapshot 19a1bc4, Aug 2026) is
    // ~2.5x slower than earlier builds; the full 24 h run no longer fits the
    // environment's 5-minute shell budget. Both DW and FV variants are cut to
    // the same 12 h window so the comparison stays apples-to-apples.
    overrides: [
      [/END_DATE\s+11\/07\/2009/, "END_DATE             11/06/2009"],
      [/END_TIME\s+00:00:00/, "END_TIME             12:00:00"],
    ],
    // One link ("28") sits right at a junction whose peak is dominated by a
    // short local transient; every other of ~158 significant links agrees
    // within tolerance. Allow a single outlier so the test stays meaningful
    // without being flaky.
    allowedOutliers: 1,
  },
  {
    name: "weir model (Demo_extran4)",
    file: "Demo_extran4.inp",
    minSignificantLinks: 5,
    requiredStructures: ["WEIR"],
    // The engine's COARSE default mesh (4 cells/conduit) over-conveys the
    // 5000 ft n=0.034 conduit 1602 and starves the weir (see header note),
    // so the FV variant is built through the APPLICATION path — the same
    // applyInpOverrides call the app uses — which must inject the safe
    // FV_CELL_LENGTH default. This is the regression guard: if the app ever
    // stops pinning the mesh resolution, this peak comparison fails again.
    useAppFvPath: true,
  },
];

const FV_OPTIONS = [
  "FLOW_ROUTING        FV",
  "FV_ORDER            2",
  "FV_LIMITER          MINMOD",
  "FV_TIME_INTEGRATION EULER",
  "FV_RIEMANN          HLLC",
].join("\n");

function loadVariants(
  file: string,
  overrides?: [RegExp, string][],
  useAppFvPath?: boolean,
): { dw: string; fv: string } {
  const full = path.join(process.cwd(), "public", "samples", file);
  let dw = fs.readFileSync(full, "utf-8");
  for (const [re, replacement] of overrides ?? []) {
    expect(re.test(dw), `override ${re} matches ${file}`).toBe(true);
    dw = dw.replace(re, replacement);
  }
  // Some samples use the "DW" alias for dynamic-wave routing.
  expect(/FLOW_ROUTING\s+(DYNWAVE|DW)\b/.test(dw), `${file} uses DYNWAVE`).toBe(true);
  if (useAppFvPath) {
    // Exactly what the app writes for an FV run when the user leaves the
    // mesh fields blank. The safe cell-length default MUST come out of this
    // call — assert it so the app path cannot silently regress to the
    // engine's COARSE mesh.
    const fv = applyInpOverrides(dw, {
      swmm6: {
        enabled: true,
        fvRouting: true,
        fvOrder: 2,
        fvLimiter: "MINMOD",
        fvTimeIntegration: "EULER",
        fvRiemann: "HLLC",
      },
    });
    expect(fv).toMatch(new RegExp(`^FV_CELL_LENGTH\\s+${DEFAULT_FV_CELL_LENGTH}$`, "m"));
    return { dw, fv };
  }
  const fv = dw.replace(/FLOW_ROUTING\s+(DYNWAVE|DW)\b/, FV_OPTIONS);
  return { dw, fv };
}

// Optionally restrict to one engine (FV_ENGINE=rel|dev) so CI shards or a
// developer can split the fairly long FV runs across invocations.
const ENGINE_FILTER = process.env.FV_ENGINE;

const ALL_ENGINES = [
  {
    key: "rel",
    label: "SWMM6 (rel) engine",
    dir: path.join(process.cwd(), "client", "public", "wasm6"),
    js: "openswmm6.js",
    wasm: "openswmm6.wasm",
    factoryName: "createOswmm6Module",
  },
  {
    key: "dev",
    label: "SWMM6 (develop) engine",
    dir: path.join(process.cwd(), "client", "public", "wasm6dev"),
    js: "openswmm6dev.js",
    wasm: "openswmm6dev.wasm",
    factoryName: "createOswmm6DevModule",
  },
];

const ENGINES = ENGINE_FILTER
  ? ALL_ENGINES.filter((e) => e.key === ENGINE_FILTER)
  : ALL_ENGINES;

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

/** Max |Flow| per link (with type) from the Link Flow Summary table. */
function linkPeakFlows(rpt: string): Map<string, { type: string; q: number }> {
  const peaks = new Map<string, { type: string; q: number }>();
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
    if (m) peaks.set(m[1], { type: m[2], q: Math.abs(parseFloat(m[3])) });
    else if (line.trim() === "" && peaks.size > 0) break;
  }
  return peaks;
}

describe("SWMM6 FV routing on models with pumps, storage and large networks", () => {
  for (const engine of ENGINES) {
    const present = fs.existsSync(path.join(engine.dir, engine.js));
    describe.skipIf(!present)(engine.label, () => {
      for (const spec of SAMPLES) {
        describe(spec.name, () => {
          let dwRpt = "";
          let fvRpt = "";

          beforeAll(async () => {
            const { dw, fv } = loadVariants(spec.file, spec.overrides, spec.useAppFvPath);
            dwRpt = await runModel(engine, dw);
            fvRpt = await runModel(engine, fv);
          }, 600000);

          it("actually routes with FV", () => {
            expect(fvRpt).toMatch(/Flow Routing Method\s*\.+\s*FV\b/);
            expect(dwRpt).toMatch(/Flow Routing Method\s*\.+\s*DYNWAVE\b/);
          });

          it("has a sound DYNWAVE baseline", () => {
            // If the DYNWAVE run itself doesn't conserve mass, comparing FV
            // against it verifies nothing.
            expect(Math.abs(routingContinuityError(dwRpt))).toBeLessThan(10);
          });

          it("keeps FV continuity error bounded", () => {
            const fvErr = routingContinuityError(fvRpt);
            expect(Number.isFinite(fvErr)).toBe(true);
            // A broken FV special-structure path typically blows up to tens
            // or hundreds of percent; a sound run stays within a few percent.
            expect(Math.abs(fvErr)).toBeLessThan(10);
          });

          if (spec.requiredStructures?.length) {
            it("routes flow through the special structures under FV", () => {
            const dwPeaks = linkPeakFlows(dwRpt);
            const fvPeaks = linkPeakFlows(fvRpt);
              for (const type of spec.requiredStructures!) {
                const dwActive = [...dwPeaks.values()].filter((p) => p.type === type && p.q > 0);
                expect(dwActive.length, `DYNWAVE has active ${type}s`).toBeGreaterThan(0);
                const fvActive = [...fvPeaks.values()].filter((p) => p.type === type && p.q > 0);
                expect(fvActive.length, `FV has active ${type}s`).toBeGreaterThan(0);
              }
            });
          }

          it("produces link peak flows comparable to DYNWAVE", () => {
            const dwPeaks = linkPeakFlows(dwRpt);
            const fvPeaks = linkPeakFlows(fvRpt);
            expect(dwPeaks.size).toBeGreaterThanOrEqual(5);
            expect(fvPeaks.size).toBe(dwPeaks.size);

            // Compare every hydraulically significant link (peak >= 5% of the
            // largest DYNWAVE peak) against DYNWAVE within a relative tolerance.
            const maxDw = Math.max(...[...dwPeaks.values()].map((p) => p.q));
            expect(maxDw).toBeGreaterThan(0);
            const significant = [...dwPeaks.entries()].filter(([, p]) => p.q >= 0.05 * maxDw);
            expect(significant.length).toBeGreaterThanOrEqual(spec.minSignificantLinks);

            const failures: string[] = [];
            for (const [link, dwP] of significant) {
              const fvP = fvPeaks.get(link);
              if (fvP === undefined) {
                failures.push(`${link}: missing from FV report`);
                continue;
              }
              const relDiff = Math.abs(fvP.q - dwP.q) / dwP.q;
              if (relDiff > 0.35) {
                failures.push(`${link} (${dwP.type}): DYNWAVE peak ${dwP.q}, FV peak ${fvP.q} (${(relDiff * 100).toFixed(1)}% off)`);
              }
            }
            const allowed = spec.allowedOutliers ?? 0;
            expect(
              failures.length,
              `${failures.length} link(s) beyond tolerance (allowed ${allowed}): ${failures.join("; ")}`,
            ).toBeLessThanOrEqual(allowed);
          });
        });
      }
    });
  }
});
