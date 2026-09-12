import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

const ENGINES = [
  {
    label: "SWMM6 Stable",
    dir: path.join(process.cwd(), "client", "public", "wasm6"),
    js: "openswmm6.js",
    wasm: "openswmm6.wasm",
    factoryName: "createOswmm6Module",
  },
  {
    label: "SWMM6 Dev",
    dir: path.join(process.cwd(), "client", "public", "wasm6dev"),
    js: "openswmm6dev.js",
    wasm: "openswmm6dev.wasm",
    factoryName: "createOswmm6DevModule",
  },
];

describe("SWMM6 browser artifact exports", () => {
  for (const engine of ENGINES) {
    it(`${engine.label} exposes the complete worker error API`, async () => {
      const jsPath = path.join(engine.dir, engine.js);
      const src = fs.readFileSync(jsPath, "utf8");
      const factory = new Function(
        "module",
        "exports",
        "require",
        "__dirname",
        "__filename",
        `${src}\nreturn ${engine.factoryName};`,
      );
      const commonJsModule = { exports: {} };
      const createModule = factory(
        commonJsModule,
        commonJsModule.exports,
        require,
        engine.dir,
        jsPath,
      );
      const Module = await createModule({
        wasmBinary: fs.readFileSync(path.join(engine.dir, engine.wasm)),
        print: () => {},
        printErr: () => {},
      });

      const handle = Module.ccall("swmm_engine_create", "number", [], []);
      expect(handle).not.toBe(0);
      expect(() => Module.ccall(
        "swmm_get_last_error_msg",
        "string",
        ["number"],
        [handle],
      )).not.toThrow();
      Module.ccall("swmm_engine_destroy", null, ["number"], [handle]);
    });
  }

  it("SWMM6 Stable exports the actual validation failure message", async () => {
    const engine = ENGINES[0];
    const jsPath = path.join(engine.dir, engine.js);
    const src = fs.readFileSync(jsPath, "utf8");
    const factory = new Function(
      "module",
      "exports",
      "require",
      "__dirname",
      "__filename",
      `${src}\nreturn ${engine.factoryName};`,
    );
    const commonJsModule = { exports: {} };
    const createModule = factory(
      commonJsModule,
      commonJsModule.exports,
      require,
      engine.dir,
      jsPath,
    );
    const Module = await createModule({
      wasmBinary: fs.readFileSync(path.join(engine.dir, engine.wasm)),
      print: () => {},
      printErr: () => {},
    });
    const handle = Module.ccall("swmm_engine_create", "number", [], []);
    Module.FS.writeFile(
      "/invalid.inp",
      fs.readFileSync(path.join(process.cwd(), "tests", "fixtures", "invalid-section.inp"), "utf8"),
    );
    const openCode = Module.ccall(
      "swmm_engine_open",
      "number",
      ["number", "string", "string", "string", "number"],
      [handle, "/invalid.inp", "/invalid.rpt", "/invalid.out", 0],
    );
    expect(openCode).not.toBe(0);
    const message = Module.ccall(
      "swmm_get_last_error_msg",
      "string",
      ["number"],
      [handle],
    );
    expect(message).toMatch(/error|node|conduit|input/i);
    Module.ccall("swmm_engine_close", "number", ["number"], [handle]);
    Module.ccall("swmm_engine_destroy", null, ["number"], [handle]);
  });
});