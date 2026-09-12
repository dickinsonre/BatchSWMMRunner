# Building a SWMM6 (OpenSWMM 6.0.0-alpha) WebAssembly Engine

How to compile the new C++ OpenSWMM 6 engine to WebAssembly. This is a much rougher ride than SWMM5 (see `building-swmm5-wasm-engine.md`): the codebase is C++ with exceptions, threads, plugins, and OpenMP — all of which need browser-specific provisions. The source-pinned stable-only recipe is `scripts/build-swmm6-wasm.sh`; it requires Emscripten 3.1.51, produces `client/public/wasm6/openswmm6.js` + `openswmm6.wasm`, and records the expanded link command and linker map alongside them.

The retained hashes identify this specific build, not a guarantee of byte-identical rebuilds. Link evidence includes original absolute workspace and temporary paths; CMake and the host environment are not fully pinned. Retaining those paths preserves the actual build evidence rather than rewriting it.

## 1. Source

Clone the OpenSWMM repository at the exact `swmm6_rel` commit recorded in
`client/public/wasm6/BUILD_INFO.txt`. Two engines live in that tree:

- **`src/` (the real SWMM6)** — new C++ engine with the handle-based `swmm_engine_*` API. This is what you want.
- **`src/legacy/engine`** — the old 5.3.0-era C engine carried along for comparison. It *ignores* all SWMM6-only keywords (`SURCHARGE_METHOD DYNAMIC_SLOT`, `[VIRTUAL_JUNCTIONS]`, …), so building it and thinking you have SWMM6 is a trap. Check your `.rpt` header: the new engine prints a 6.0.0-alpha version, the legacy one prints "OPENSWMM ENGINE" with 5.3.x.

## 2. Prerequisites

- Emscripten (tested with **3.1.51**) with a writable cache: `export EM_CACHE=/tmp/emcache`.
- CMake (the project is CMake-based; use `emcmake`).

## 3. Required WebAssembly compatibility provisions

The browser build retains three compatibility provisions:

1. **`PluginFactory.cpp` platform check** — the pinned upstream snapshot includes its `__EMSCRIPTEN__` dynamic-loading stubs (upstream commit `0e3155a`). Built-in plugins remain available; dynamic plugins do not load in this single-file module.
2. **`IOThread.cpp`** — the pinned upstream snapshot includes its `__EMSCRIPTEN__` synchronous output path (upstream commit `d204ea7`). It avoids spawning a `std::thread` in the single-threaded browser build.
3. **Duplicate `omp_get_max_threads` fallback** — `project.c` and `swmm5.c` both define the no-OpenMP fallback. The build script changes `project.c` to an `extern` declaration, leaving the `swmm5.c` definition as the one symbol in the combined link.

The script checks that provisions 1 and 2 remain upstream and applies provision
3 after resetting the pinned source tree, so the build is repeatable without
carrying a mutable source checkout in this repository.

At this upstream tip the script also carries a narrow build-only guard around a
2-D options dereference in `SWMMEngine.cpp`: `OPENSWMM_BUILD_2D=OFF` leaves
`SolverOptions2D` incomplete, otherwise preventing the intended 1-D browser
configuration from compiling. The guard leaves `as_flooding` false when 2-D is
not built; a no-2-D model cannot have 1-D-to-2-D coupling. This is separate
from the three established compatibility provisions above.

## 4. Configure and build

```bash
bash scripts/build-swmm6-wasm.sh
```

**`-fexceptions` is not optional.** Emscripten disables C++ exceptions by default; the engine throws/catches during normal operation, and without the flag the run aborts right after parsing the input file. It must be on for *every* translation unit (hence the global CMake flags), not just the link step.

The GeoPackage, 2D, and GPU options pull in heavy native dependencies that don't compile for WASM — turn them all off.

## 5. Link step

The script configures a Release, dependency-free browser build, builds
`openswmm_engine`, and links the CLI entry point plus
`build-wasm/src/engine/libopenswmm.engine.a`.

The expanded command is retained as
`client/public/wasm6/openswmm6.link-command.txt` and its full linker map as
`client/public/wasm6/openswmm6.link.map`. Its essential flags are:

```bash
em++ -O2 -fexceptions \
  src/cli/main.cpp build-wasm/src/engine/libopenswmm.engine.a \
  -I include/openswmm/engine -I build-wasm/include \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=createOswmm6Module \
  -s ENVIRONMENT=web,worker \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s EXPORTED_FUNCTIONS='["_main","_malloc","_free","_swmm_engine_create","_swmm_engine_open","_swmm_engine_initialize","_swmm_engine_start","_swmm_engine_step","_swmm_engine_end","_swmm_engine_report","_swmm_engine_close","_swmm_engine_destroy","_swmm_get_last_error_msg"]' \
  -s EXPORTED_RUNTIME_METHODS='["FS","ccall","cwrap","getValue","UTF8ToString","stringToUTF8"]' \
  -o client/public/wasm6/openswmm6.js
```

Again: **forgetting `EXPORTED_FUNCTIONS` (including `_malloc,_free`) produces a wasm that loads but exposes no API.** Verify after every rebuild that the functions are actually there (`typeof mod._swmm_engine_create === 'function'`).

## 6. The handle-based API

Unlike SWMM5's global-state API, SWMM6 uses an opaque engine handle:

```js
const mod = await createOswmm6Module();
mod.FS.writeFile('/model.inp', inpText);

const h = mod.ccall('swmm_engine_create', 'number', [], []);
let err = mod.ccall('swmm_engine_open', 'number',
  ['number','string','string','string'],
  [h, '/model.inp', '/model.rpt', '/model.out']);
err ||= mod.ccall('swmm_engine_initialize', 'number', ['number'], [h]);
err ||= mod.ccall('swmm_engine_start', 'number', ['number'], [h]);

// step loop — elapsed time is written through a double* out-param
const p = mod._malloc(8);
do {
  err = mod.ccall('swmm_engine_step', 'number', ['number','number'], [h, p]);
} while (!err && mod.getValue(p, 'double') > 0);
mod._free(p);

mod.ccall('swmm_engine_end', 'number', ['number'], [h]);
mod.ccall('swmm_engine_report', 'number', ['number'], [h]);
mod.ccall('swmm_engine_close', 'number', ['number'], [h]);
mod.ccall('swmm_engine_destroy', 'number', ['number'], [h]);
```

On any nonzero return, get the message with `swmm_get_last_error_msg`. Warning counts are easiest to obtain by scanning the `.rpt` text for `WARNING` lines.

## 7. Behavior notes (things that cost us time)

- **`SURCHARGE_METHOD` is only honored under `FLOW_ROUTING DYNWAVE`.** With steady/kinematic routing the keyword parses but is neither echoed nor used — don't conclude the engine is broken.
- **`[VIRTUAL_JUNCTIONS]` must appear before `[CONDUITS]`** in the `.inp`, or the engine fails with ERROR 609 (see the SWMM5→SWMM6 conversion doc).
- The upstream engine dropped the fork's custom WARNING 13 (link below storage-node bottom) check — if you advertise that warning, you must re-port it as a local patch on every sync.
- Node-based testing: load the glue with `new Function` + explicit `wasmBinary`, same as the SWMM5 engine.

## 8. Gotchas checklist

- [ ] Building `src/`, not `src/legacy/engine` (check the `.rpt` version header).
- [ ] `-fexceptions` on compile **and** link.
- [ ] The three compatibility provisions (upstream PluginFactory and IOThread
  paths, plus the scripted omp fallback dedup).
- [ ] GeoPackage/2D/GPU options OFF.
- [ ] Full `EXPORTED_FUNCTIONS` list including `_malloc,_free`.
- [ ] Fresh module instance per run; run inside a Web Worker.
