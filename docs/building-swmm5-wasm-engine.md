# Building a SWMM5 WebAssembly Engine

How to compile the stock EPA SWMM 5.x solver to WebAssembly so it runs entirely in the browser, and how this project wires it up. This is the exact recipe used to produce `client/public/wasm/swmm5.js` + `swmm5.wasm`.

## 1. What you're building

EPA SWMM 5 is plain C (the solver lives in `src/solver/*.c` of the official EPA repo). It has no threads, no networking, and does all I/O through the C standard library — which makes it an almost ideal candidate for Emscripten. The output is:

- `swmm5.wasm` — the compiled solver.
- `swmm5.js` — the Emscripten "glue" script that loads the wasm, provides a virtual in-memory filesystem (MEMFS), and exposes the exported C functions to JavaScript.

The browser never touches the real disk: you write the `.inp` file into the virtual filesystem, run the simulation, then read the `.rpt` and `.out` files back out of memory.

## 2. Prerequisites

- **Emscripten** (this project uses emcc **3.1.51**). On Replit it is installed as the `emscripten` system dependency.
- The **EPA SWMM source** (this project vendors 5.2.4 under `swmm-source/src/solver/`). Any 5.1/5.2 release works; the API below has been stable for years.

### Emscripten cache gotcha (Nix/read-only installs)

Emscripten compiles its own libc on first use and caches it. If emcc is installed in a read-only location (like the Nix store), the default cache path is unwritable and every build fails. Fix:

```bash
mkdir -p /tmp/emcache
export EM_CACHE=/tmp/emcache
```

First run pays ~90 s to build libc; after that the SWMM compile itself is ~20 s.

## 3. The compile command

```bash
export EM_CACHE=/tmp/emcache

emcc swmm-source/src/solver/*.c \
  -I swmm-source/src/solver \
  -O2 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=createSwmmModule \
  -s ENVIRONMENT=web,worker \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s EXPORTED_FUNCTIONS='["_swmm_run","_swmm_open","_swmm_start","_swmm_step","_swmm_end","_swmm_report","_swmm_close","_swmm_getError","_swmm_getWarnings","_swmm_getVersion","_swmm_getMassBalErr","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["FS","ccall","cwrap","getValue","UTF8ToString","stringToUTF8"]' \
  -o client/public/wasm/swmm5.js
```

(The exported function list above is illustrative — export every `swmm_*` entry point you intend to call, always with a leading underscore, plus `_malloc`/`_free` for passing strings. Forgetting `EXPORTED_FUNCTIONS` produces a wasm that loads fine but has no callable API — this bit us once.)

Key flags explained:

| Flag | Why |
|---|---|
| `MODULARIZE=1` + `EXPORT_NAME=createSwmmModule` | The glue exports a factory function instead of a global, so you can instantiate a **fresh module per run** (SWMM has global state; reusing one instance across runs risks leftover state). |
| `ENVIRONMENT=web,worker` | Strips Node-only loader code; the engine runs inside a Web Worker. |
| `ALLOW_MEMORY_GROWTH=1` | Large models need more than the default 16 MB heap. |
| `EXPORTED_RUNTIME_METHODS` with `FS` | You need the MEMFS API to write the `.inp` in and read the `.rpt`/`.out` back. |

## 4. Driving it from JavaScript

The simplest API is the one-shot `swmm_run(inpFile, rptFile, outFile)`:

```js
importScripts('/wasm/swmm5.js');           // classic worker
const mod = await createSwmmModule();       // fresh instance per run
mod.FS.writeFile('/model.inp', inpText);
const err = mod.ccall('swmm_run', 'number',
  ['string', 'string', 'string'],
  ['/model.inp', '/model.rpt', '/model.out']);
const rpt = mod.FS.readFile('/model.rpt', { encoding: 'utf8' });
const out = mod.FS.readFile('/model.out'); // binary Uint8Array
```

For **live progress**, use the step API instead: `swmm_open` → `swmm_start(1)` → loop `swmm_step(&elapsed)` until elapsed is 0 → `swmm_end` → `swmm_report` → `swmm_close`. Between steps you can post progress messages to the main thread and honor cancellation.

Run it in a **Web Worker** (this project uses a classic worker, `client/public/wasm/swmm-worker.js`, loaded with `importScripts`) so a long simulation never freezes the UI, and so terminating the worker is a reliable cancel.

## 5. Serving the artifacts

Put `swmm5.js` and `swmm5.wasm` somewhere your bundler serves as-is (`client/public/wasm/` for Vite). Do **not** import the glue through the bundler — the glue locates the `.wasm` relative to its own URL, and bundling breaks that. If needed, set `Module.locateFile` to point at the right directory.

## 6. Gotchas checklist

- [ ] Writable `EM_CACHE` before the first build.
- [ ] New module instance per simulation (global state).
- [ ] All `swmm_*` functions in `EXPORTED_FUNCTIONS` with leading underscores, plus `_malloc,_free`.
- [ ] `[REPORT]` flags in the `.inp` gate what ends up in the `.out` file, not just the `.rpt` — if graphs come back empty, check `NODES ALL` / `LINKS ALL`.
- [ ] Run emcc synchronously in CI-like environments; long background processes can be killed.
- [ ] Testing in Node: load the glue with `new Function` and pass `wasmBinary` explicitly instead of `require()` — the `ENVIRONMENT=web,worker` glue refuses to run under Node's module loader otherwise.
