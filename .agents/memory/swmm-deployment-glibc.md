---
name: SWMM binary in deployments
description: Why runswmm fails with spawn ENOENT in published deployments and how the bundled glibc loader fixes it
---

The native `runswmm` ELF binary (and `libswmm5.so`) are dynamically linked against a dev-time `/nix/store/...glibc-2.40.../ld-linux-x86-64.so.2` interpreter path. In published deployments that store path does not exist, so `spawn()` fails with ENOENT (exit code -2) even though the binary file exists — the "SWMM5 Ready" detection based on `fs.existsSync` passes while execution fails.

**Fix in place:** the exact glibc loader + libc/libm/libpthread from the dev nix store are copied into `swmm-engine/libs/` (committed to the repo). At runtime the server probes whether the binary executes directly; if not, it spawns via `swmm-engine/libs/ld-linux-x86-64.so.2 --library-path swmm-engine/libs <binary> <args>`.

**Why:** no static libc is available in the Nix dev environment (`gcc -static` fails with "cannot find -lc"), so static relinking wasn't an option.

**How to apply:** if the SWMM engine is ever recompiled, re-copy the matching loader/libs (from `ldd runswmm` output) into `swmm-engine/libs/`, keeping the loader ABI-compatible with the binary. Detection of "engine available" should always verify actual executability, not just file existence.
