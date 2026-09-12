import { describe, expect, it } from "vitest";
import type { ProcessResult } from "../shared/schema";
import {
  buildPairedEngineZip,
  pairedExportAvailability,
  sanitizePairedModelName,
} from "../client/src/lib/pairedEngineExport";
import { setWasmNativeArtifacts } from "../client/src/lib/wasmArtifacts";

function result(engine: string, fileName = "model.inp"): ProcessResult {
  return {
    id: engine,
    fileName,
    filePath: fileName,
    status: "success",
    inpContent: `[TITLE]\n${engine} effective input\n`,
    reportContent: `${engine} augmented report\n`,
    provenance: {
      requestedEngine: engine,
      actualEngine: engine,
      engineVersion: "test-version",
    },
  };
}

describe("paired browser native export", () => {
  it("writes byte-for-byte native report/output files in engine folders", async () => {
    const swmm5 = result("wasm");
    const swmm6 = result("wasm6");
    const report5 = new Uint8Array([0x52, 0x50, 0x54, 0x00, 0xff]).buffer;
    const output5 = new Uint8Array([0, 1, 2, 255]).buffer;
    const report6 = new Uint8Array([0x36, 0x00, 0xfe]).buffer;
    const output6 = new Uint8Array([9, 8, 7, 6]).buffer;
    setWasmNativeArtifacts(swmm5, { artifacts: { report: report5, output: output5 } });
    setWasmNativeArtifacts(swmm6, { artifacts: { report: report6, output: output6 } });

    const { zip, fileCount } = await buildPairedEngineZip({ swmm5, swmm6 });
    expect(fileCount).toBe(6);
    expect(Object.keys(zip.files).sort()).toEqual([
      "SWMM5/",
      "SWMM5/model.inp",
      "SWMM5/model.out",
      "SWMM5/model.rpt",
      "SWMM6/",
      "SWMM6/model.inp",
      "SWMM6/model.out",
      "SWMM6/model.rpt",
      "manifest.json",
    ]);
    expect(Array.from(await zip.file("SWMM5/model.rpt")!.async("uint8array"))).toEqual([0x52, 0x50, 0x54, 0, 0xff]);
    expect(Array.from(await zip.file("SWMM5/model.out")!.async("uint8array"))).toEqual([0, 1, 2, 255]);
    expect(await zip.file("SWMM5/model.inp")!.async("string")).toContain("wasm effective input");
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(manifest.engines.map((entry: { engine: string }) => entry.engine)).toEqual(["SWMM5", "SWMM6"]);
    expect(manifest.engines[0].evidence.report).toContain("Exact bytes");
  });

  it("fails clearly when an older result has no retained native bytes", async () => {
    const swmm5 = result("wasm");
    const swmm6 = result("wasm6");
    setWasmNativeArtifacts(swmm6, { artifacts: { report: new ArrayBuffer(1), output: new ArrayBuffer(1) } });
    expect(pairedExportAvailability({ swmm5, swmm6 }).ready).toBe(false);
    await expect(buildPairedEngineZip({ swmm5, swmm6 })).rejects.toThrow(/rerun both engines/i);
  });

  it("sanitizes paths and unsafe archive names", () => {
    const name = sanitizePairedModelName("../../<unsafe>\\model:?.inp");
    expect(name).not.toContain("/");
    expect(name).not.toContain("\\");
    expect(name).not.toContain("..");
    expect(name).toBeTruthy();
  });
});
