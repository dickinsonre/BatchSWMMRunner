---
name: SWMM WASM build
description: How the in-browser SWMM engine was built with emscripten and how it is wired into the app
---

- EPA SWMM 5.2.4 solver sources (`swmm-source/src/solver/*.c`) compile cleanly with emscripten 3.1.51 (installed as system dependency `emscripten`).
- Emscripten cache in the Nix store is read-only: copy it to a writable dir and `export EM_CACHE=...` before first `emcc` run (first run builds libc, ~90s; SWMM compile ~19s).
- Output artifacts live in `client/public/wasm/` (swmm5.js glue with MODULARIZE=1, EXPORT_NAME=createSwmmModule + swmm5.wasm) so Vite serves them statically; a classic worker (`swmm-worker.js`, importScripts) runs simulations off the main thread.
- **Why:** rebuilding requires this recipe; background bash processes get killed in this environment, so run emcc synchronously.
- **How to apply:** if SWMM sources change or exports need extending, re-run emcc with the same flags (exported swmm_* functions plus FS/ccall/getValue/UTF8ToString runtime methods, ENVIRONMENT=web,worker).
- A second engine ("SWMM6", OpenSWMM fork, identical swmm_* API) is built the same way to `client/public/wasm6/` with EXPORT_NAME=createSwmm6Module; the shared worker lazily importScripts the right glue per run message.
- SWMM6 now builds from the fork's `swmm6_rel` branch **legacy engine** (`src/legacy/engine`, v5.3.0, reports header "OPENSWMM ENGINE"). Gotchas: hand-write `legacy_version.h` (CMake template), copy `xsect.dat` + `openswmm_solver.h` + export header, remove duplicate `omp_get_max_threads` fallback in project.c. Upstream dropped the custom WARN13 link-depth check — it is re-applied as a marked local patch in link.c/text.h (WARN13L) because the app advertises it; re-port it on every upstream sync.
