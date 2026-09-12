# OpenSWMM Engine attribution and provenance

BatchSWMM56 bundles object-code WebAssembly builds of the OpenSWMM Engine from
<https://github.com/HydroCouple/openswmm.engine>.

## Bundled snapshots

| App engine | Upstream branch | Upstream commit | Commit date | License at that commit |
|---|---|---|---|---|
| SWMM6 WASM | `swmm6_rel` | `137e65e4e25e9425a489b99d5b7365c8355f8f6b` | 2026-09-10 | Apache-2.0 plus upstream NOTICE |
| SWMM6 Dev | `develop` | `19a1bc42074eac8cdf46e2edafe6fc5849adf6da` | 2026-08-11 | MIT; no upstream NOTICE |

The full artifact hashes and build-tool details are in
`/wasm6/BUILD_INFO.txt` and `/wasm6dev/BUILD_INFO.txt`.

## Modification notices

The stable browser build retains three WebAssembly compatibility provisions:

1. Pinned upstream includes PluginFactory `__EMSCRIPTEN__` dynamic-loading
   stubs (upstream commit `0e3155a`).
2. Pinned upstream includes synchronous IOThread output under
   `__EMSCRIPTEN__` (upstream commit `d204ea7`).
3. The reproducible stable build locally changes legacy `project.c`'s duplicate
   non-OpenMP `omp_get_max_threads` definition to an `extern` declaration;
   `swmm5.c` retains the sole fallback definition.

The reproducible stable build also carries a narrow no-2-D compile guard in
`SWMMEngine.cpp`. At the pinned tip, the 1-D (`OPENSWMM_BUILD_2D=OFF`) build
dereferences a forward-declared 2-D options type. The guard makes the
no-2-D value false; no 1-D-to-2-D coupling can exist without 2-D support.

These local changes are limited to browser/WebAssembly compatibility. The
patched upstream source files are not included in this distribution; their
prominent modification record and the complete reproducible script are included
with the redistributed object code in this provenance document, the stable
build manifest, and `scripts/build-swmm6-wasm.sh`.

The browser-build dependency review is recorded in `DEPENDENCY_AUDIT.md`.

## License scope and non-endorsement

The bundled stable OpenSWMM snapshot is licensed under the Apache License,
Version 2.0 and includes an upstream NOTICE. The bundled development snapshot
is licensed under the MIT License and has no NOTICE at its recorded commit.
Portions derived from EPA SWMM are United States Government public-domain
material as described in the upstream legal files.

These terms apply to the bundled OpenSWMM Engine, not automatically to the
BatchSWMM56 application as a whole. No endorsement by the United States
Environmental Protection Agency, HydroCouple, or the OpenSWMM authors is
stated or implied.