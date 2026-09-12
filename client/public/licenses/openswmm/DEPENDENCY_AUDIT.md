# OpenSWMM browser-build dependency license audit

Audit date: 2026-09-10

This audit applies only to the two bundled browser artifacts:

- `/wasm6/openswmm6.js` and `/wasm6/openswmm6.wasm`
- `/wasm6dev/openswmm6dev.js` and `/wasm6dev/openswmm6dev.wasm`

## Result

No separately licensed optional OpenSWMM dependency is linked into or
redistributed with either browser build. The distributions contain only each
OpenSWMM engine compiled into a monolithic WebAssembly module and its
Emscripten-generated JavaScript loader.

The engine licenses that must accompany these artifacts are:

| Browser artifact | Recorded source | Applicable upstream license | Upstream NOTICE |
|---|---|---|---|
| SWMM6 WASM | `swmm6_rel` at `137e65e4e25e9425a489b99d5b7365c8355f8f6b` | Apache-2.0 (`LICENSE.txt`) | Yes (`NOTICE.txt`) |
| SWMM6 Dev | `develop` at `19a1bc42074eac8cdf46e2edafe6fc5849adf6da` | MIT (`LICENSE-DEVELOP-MIT.txt`) | None at this commit |

The EPA-derived source incorporated into OpenSWMM is United States Government
public-domain material, as stated in each upstream license and, for the stable
branch, its NOTICE.

## Declared but not shipped

OpenSWMM's `vcpkg.json` declares dependencies used by optional features and
development tooling. The WebAssembly CMake caches and final binaries show that
these components are not part of either redistributed browser artifact:

| Component | OpenSWMM use | Browser-build evidence |
|---|---|---|
| SQLite | Optional GeoPackage input/output | `OPENSWMM_WITH_GEOPACKAGE=OFF`; no SQLite symbols or strings |
| HDF5 | Optional 2D output | `OPENSWMM_BUILD_2D=OFF`; no HDF5 symbols or strings |
| Kokkos / OpenMP | Optional separately loaded GPU plugin | `OPENSWMM_BUILD_GPU_PLUGIN=OFF`; no Kokkos or OpenMP symbols or strings |
| GoogleTest | Test harness | `OPENSWMM_BUILD_TESTS=OFF`; no test library symbols or strings |
| Google Benchmark | Benchmark harness | `OPENSWMM_BUILD_BENCHMARKS=OFF`; no benchmark library symbols or strings |

Because these libraries are neither linked nor redistributed, their license
texts do not accompany these two artifacts. This conclusion must be revisited
if any of the listed build options is enabled or another plugin/library is
added to a future browser distribution.

## Toolchain runtime and conservative notice coverage

The generated JavaScript loaders visibly contain Emscripten runtime code and
Node.js-derived `library_path.js` code. `EMSCRIPTEN-LICENSE.txt` preserves
Emscripten's permissive MIT/NCSA terms and the Node.js MIT notice included by
the Emscripten 3.1.51 distribution used for these builds.

The modules import only Emscripten/WASI host interfaces; no separately shipped
shared runtime library appears in either browser distribution. The stable
artifact retains its final linker map (`/wasm6/openswmm6.link.map`) and expanded
link command (`/wasm6/openswmm6.link-command.txt`). Together with
`scripts/build-swmm6-wasm.sh`, they make the selected inputs reproducible.
This audit still does not claim a positive file-by-file inventory of every
compiler-runtime object selected into either `.wasm` module.

Emscripten 3.1.51's toolchain contains musl-derived libc implementation code.
`MUSL-COPYRIGHT.txt` is bundled conservatively to preserve the full musl
copyright, MIT terms, and its notices for compatible third-party portions,
whether or not every listed musl source file survived dead-code elimination in
these particular modules.

Emscripten's libc++, libc++abi, compiler-rt, and libunwind sources use Apache
2.0 with the LLVM Exceptions. The exception states that portions embedded into
object form as a result of compiling source may be redistributed without
complying with Apache sections 4(a), 4(b), and 4(d). Therefore no additional
license copy is required for any such portions embedded in these object-code
artifacts.

The retained artifacts do not prove whether Emscripten selected dlmalloc or
emmalloc, so this audit makes no allocator-specific licensing claim. No Closure
compiler output or separately distributed Emscripten `third_party` component
was identified.

## Reproduction checks

The conclusion was established from:

1. The exact upstream `LICENSE`, `NOTICE`, and `vcpkg.json` files at both
   commits.
2. The stable build script, retained expanded link command, and linker map;
   the existing develop artifact is unchanged by this update.
3. String/symbol inspection of both final `.wasm` files for the declared
   optional dependencies and their runtime identifiers.
4. The final module import surface, which contains only Emscripten/WASI host
   interfaces rather than imports from third-party shared libraries.
5. Emscripten 3.1.51's own `LICENSE`, musl `COPYRIGHT`, LLVM runtime license
   files, and allocator source headers.

## Confidence boundary

The absence of the optional OpenSWMM libraries is supported by disabled build
options and negative binary inspection. Toolchain-runtime notices are
intentionally overinclusive. The stable artifact now retains its complete link
command and map so its runtime inventory can be reproduced; a future develop
rebuild should retain the same evidence.