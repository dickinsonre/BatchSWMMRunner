# Building a SWMM6 (OpenSWMM 6.0.0-alpha) WebAssembly Engine

How to compile the new C++ OpenSWMM 6 engine to WebAssembly. This is a much rougher ride than SWMM5 (see `building-swmm5-wasm-engine.md`): the codebase is C++ with exceptions, threads, plugins, and OpenMP — all of which need patches or flags to survive in a browser. This is the exact recipe used to produce `client/public/wasm6/openswmm6.js` + `openswmm6.wasm` (engine reports `6.0.0-alpha.3`).

## 1. Source

Clone the OpenSWMM repository, `swmm6_rel` branch. Two engines live in that tree:

- **`src/` (the real SWMM6)** — new C++ engine with the handle-based `swmm_engine_*` API. This is what you want.
- **`src/legacy/engine`** — the old 5.3.0-era C engine carried along for comparison. It *ignores* all SWMM6-only keywords (`SURCHARGE_METHOD DYNAMIC_SLOT`, `[VIRTUAL_JUNCTIONS]`, …), so building it and thinking you have SWMM6 is a trap. Check your `.rpt` header: the new engine prints a 6.0.0-alpha version, the legacy one prints "OPENSWMM ENGINE" with 5.3.x.

## 2. Prerequisites

- Emscripten (tested with **3.1.51**) with a writable cache: `export EM_CACHE=/tmp/emcache`.
- CMake (the project is CMake-based; use `emcmake`).

## 3. Required source patches

Three things in the tree do not work under WASM and must be patched before compiling:

1. **`PluginFactory.cpp` platform check** — the dlfcn-based plugin loader has an `#if` platform whitelist that errors out on unknown platforms. Add `__EMSCRIPTEN__` to the allowed list (Emscripten ships dlfcn stubs; plugins simply won't load, which is fine).
2. **`IOThread.cpp`** — the engine writes output on a background `std::thread`. Spawning threads in single-threaded WASM aborts at runtime. Under `#ifdef __EMSCRIPTEN__`, make the IO "thread" run synchronously (execute the queued work inline instead of launching a thread).
3. **Duplicate `omp_get_max_threads` fallback** — both `project.c` and `swmm5.c` (legacy sources pulled into the build) define a no-OpenMP fallback for `omp_get_max_threads`, which collides at link time. Remove one of the duplicates.

## 4. Configure and build

```bash
export EM_CACHE=/tmp/emcache
cd oswmm
emcmake cmake -B build-wasm \
  -DCMAKE_BUILD_TYPE=Release \
  -DOPENSWMM_WITH_GEOPACKAGE=OFF \
  -DOPENSWMM_BUILD_2D=OFF \
  -DOPENSWMM_BUILD_GPU_PLUGIN=OFF \
  -DCMAKE_C_FLAGS=-fexceptions \
  -DCMAKE_CXX_FLAGS=-fexceptions
cmake --build build-wasm --target openswmm.engine -j
```

**`-fexceptions` is not optional.** Emscripten disables C++ exceptions by default; the engine throws/catches during normal operation, and without the flag the run aborts right after parsing the input file. It must be on for *every* translation unit (hence the global CMake flags), not just the link step.

The GeoPackage, 2D, and GPU options pull in heavy native dependencies that don't compile for WASM — turn them all off.

## 5. Link step

Link the CLI entry point plus the static engine library with em++:

```bash
em++ -O2 -fexceptions \
  src/cli/main.cpp build-wasm/libopenswmm.engine.a \
  -I src -I build-wasm/include \
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
- [ ] The three source patches (PluginFactory, IOThread, omp fallback dedup).
- [ ] GeoPackage/2D/GPU options OFF.
- [ ] Full `EXPORTED_FUNCTIONS` list including `_malloc,_free`.
- [ ] Fresh module instance per run; run inside a Web Worker.
