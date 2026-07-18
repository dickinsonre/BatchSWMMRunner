---
name: SWMM WASM build
description: How the in-browser SWMM engine was built with emscripten and how it is wired into the app
---

- EPA SWMM 5.2.4 solver sources (`swmm-source/src/solver/*.c`) compile cleanly with emscripten 3.1.51 (installed as system dependency `emscripten`).
- Emscripten cache in the Nix store is read-only: copy it to a writable dir and `export EM_CACHE=...` before first `emcc` run (first run builds libc, ~90s; SWMM compile ~19s).
- Output artifacts live in `client/public/wasm/` (swmm5.js glue with MODULARIZE=1, EXPORT_NAME=createSwmmModule + swmm5.wasm) so Vite serves them statically; a classic worker (`swmm-worker.js`, importScripts) runs simulations off the main thread.
- **Why:** rebuilding requires this recipe; background bash processes get killed in this environment, so run emcc synchronously.
- **How to apply:** if SWMM sources change or exports need extending, re-run emcc with the same flags (exported swmm_* functions plus FS/ccall/getValue/UTF8ToString runtime methods, ENVIRONMENT=web,worker).
