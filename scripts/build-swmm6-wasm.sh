#!/usr/bin/env bash
#
# Rebuild the stable browser OpenSWMM artifact only. This intentionally does
# not read, write, or rebuild wasm6dev.
set -euo pipefail

readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly UPSTREAM="https://github.com/HydroCouple/openswmm.engine.git"
readonly BRANCH="swmm6_rel"
readonly COMMIT="137e65e4e25e9425a489b99d5b7365c8355f8f6b"
readonly BUILD_ROOT="${BUILD_ROOT:-/tmp/openswmm6-wasm-build}"
readonly SOURCE_DIR="${SOURCE_DIR:-${BUILD_ROOT}/openswmm.engine}"
readonly BUILD_DIR="${BUILD_ROOT}/build-wasm"
readonly OUT_DIR="${ROOT}/client/public/wasm6"

# Refuse a different compiler before creating or resetting any build files.
if ! em++ --version | head -n 1 | grep -Eq ' 3\.1\.51(-git)?( |$)'; then
  echo "This recipe requires Emscripten 3.1.51; no build files were changed." >&2
  exit 1
fi

mkdir -p "${BUILD_ROOT}" "${OUT_DIR}"
export EM_CACHE="${EM_CACHE:-${BUILD_ROOT}/emcache}"
mkdir -p "${EM_CACHE}"

if [[ ! -d "${SOURCE_DIR}/.git" ]]; then
  git clone --filter=blob:none "${UPSTREAM}" "${SOURCE_DIR}"
fi
git -C "${SOURCE_DIR}" fetch --depth=1 origin "${COMMIT}"
git -C "${SOURCE_DIR}" checkout --detach "${COMMIT}"
git -C "${SOURCE_DIR}" reset --hard "${COMMIT}"
git -C "${SOURCE_DIR}" clean -ffd
test "$(git -C "${SOURCE_DIR}" rev-parse HEAD)" = "${COMMIT}"

# Compatibility provision 1 (PluginFactory) and provision 2 (synchronous
# IOThread) are native to this pinned upstream snapshot (0e3155a and
# d204ea7). Confirm that they did not disappear before building.
grep -Fq '#elif defined(__EMSCRIPTEN__)' \
  "${SOURCE_DIR}/src/engine/plugins/PluginFactory.cpp"
grep -Fq '#ifdef __EMSCRIPTEN__' \
  "${SOURCE_DIR}/src/engine/output/IOThread.cpp"

# Compatibility provision 3: legacy project.c and swmm5.c both supply the
# no-OpenMP fallback. Keep exactly one definition when the static archives are
# linked into a single-threaded wasm module.
git -C "${SOURCE_DIR}" apply --check - <<'PATCH'
diff --git a/src/legacy/engine/project.c b/src/legacy/engine/project.c
--- a/src/legacy/engine/project.c
+++ b/src/legacy/engine/project.c
@@ -71,5 +71,6 @@
 #if defined(_OPENMP)
   #include <omp.h>     
 #else
-  int omp_get_max_threads(void) { return 1;}
+  // swmm5.c owns the single-threaded fallback in the combined WASM link.
+  extern int omp_get_max_threads(void);
 #endif
PATCH
git -C "${SOURCE_DIR}" apply - <<'PATCH'
diff --git a/src/legacy/engine/project.c b/src/legacy/engine/project.c
--- a/src/legacy/engine/project.c
+++ b/src/legacy/engine/project.c
@@ -71,5 +71,6 @@
 #if defined(_OPENMP)
   #include <omp.h>     
 #else
-  int omp_get_max_threads(void) { return 1;}
+  // swmm5.c owns the single-threaded fallback in the combined WASM link.
+  extern int omp_get_max_threads(void);
 #endif
PATCH

# The current upstream tip dereferences SolverOptions2D in this 1D code path
# even when OPENSWMM_BUILD_2D=OFF, where the type is intentionally only
# forward-declared. Keep no-2D builds compilable; no 1D behavior changes
# because a no-2D model cannot have a 1D-to-2D coupling.
git -C "${SOURCE_DIR}" apply --check - <<'PATCH'
diff --git a/src/engine/core/SWMMEngine.cpp b/src/engine/core/SWMMEngine.cpp
--- a/src/engine/core/SWMMEngine.cpp
+++ b/src/engine/core/SWMMEngine.cpp
@@ -4565,5 +4565,8 @@
         // whatever row the continuity table puts it in.
         if (coupling_out_q > 0.0) {
-            const bool as_flooding =
-                ctx_.twod_io.options && ctx_.twod_io.options->coupling_in_flooding;
+            bool as_flooding = false;
+#ifdef OPENSWMM_HAS_2D
+            as_flooding =
+                ctx_.twod_io.options && ctx_.twod_io.options->coupling_in_flooding;
+#endif
             if (as_flooding)
                 ctx_.mass_balance.routing_flooding     += coupling_out_q * dt_routing;
             else
PATCH
git -C "${SOURCE_DIR}" apply - <<'PATCH'
diff --git a/src/engine/core/SWMMEngine.cpp b/src/engine/core/SWMMEngine.cpp
--- a/src/engine/core/SWMMEngine.cpp
+++ b/src/engine/core/SWMMEngine.cpp
@@ -4565,5 +4565,8 @@
         // whatever row the continuity table puts it in.
         if (coupling_out_q > 0.0) {
-            const bool as_flooding =
-                ctx_.twod_io.options && ctx_.twod_io.options->coupling_in_flooding;
+            bool as_flooding = false;
+#ifdef OPENSWMM_HAS_2D
+            as_flooding =
+                ctx_.twod_io.options && ctx_.twod_io.options->coupling_in_flooding;
+#endif
             if (as_flooding)
                 ctx_.mass_balance.routing_flooding     += coupling_out_q * dt_routing;
             else
PATCH

rm -rf "${BUILD_DIR}"
emcmake cmake -S "${SOURCE_DIR}" -B "${BUILD_DIR}" \
  -DCMAKE_BUILD_TYPE=Release \
  -DOPENSWMM_INSTALL=OFF \
  -DOPENSWMM_BUILD_TESTS=OFF \
  -DOPENSWMM_BUILD_BENCHMARKS=OFF \
  -DOPENSWMM_WITH_GEOPACKAGE=OFF \
  -DOPENSWMM_BUILD_2D=OFF \
  -DOPENSWMM_BUILD_GPU_PLUGIN=OFF \
  -DCMAKE_C_FLAGS=-fexceptions \
  -DCMAKE_CXX_FLAGS=-fexceptions
cmake --build "${BUILD_DIR}" --target openswmm_engine -j"${JOBS:-2}"

# Keep this exact expanded link command beside the shipped artifact. Its map is
# also retained so the selected archive/runtime inputs can be inspected later.
link_command=(
  em++
  -O2
  -fexceptions
  "${SOURCE_DIR}/src/cli/main.cpp"
  "${BUILD_DIR}/src/engine/libopenswmm.engine.a"
  -I"${SOURCE_DIR}/include/openswmm/engine"
  -I"${BUILD_DIR}/include"
  -s MODULARIZE=1
  -s EXPORT_NAME=createOswmm6Module
  -s ENVIRONMENT=web,worker
  -s ALLOW_MEMORY_GROWTH=1
  -s EXPORTED_FUNCTIONS='["_main","_malloc","_free","_swmm_engine_create","_swmm_engine_open","_swmm_engine_initialize","_swmm_engine_start","_swmm_engine_step","_swmm_engine_end","_swmm_engine_report","_swmm_engine_close","_swmm_engine_destroy","_swmm_get_last_error_msg"]'
  -s EXPORTED_RUNTIME_METHODS='["FS","ccall","cwrap","getValue","UTF8ToString","stringToUTF8"]'
  -Wl,-Map,"${OUT_DIR}/openswmm6.link.map"
  -o "${OUT_DIR}/openswmm6.js"
)
printf '%q ' "${link_command[@]}" > "${OUT_DIR}/openswmm6.link-command.txt"
printf '\n' >> "${OUT_DIR}/openswmm6.link-command.txt"
"${link_command[@]}"

sha256sum "${OUT_DIR}/openswmm6.js" "${OUT_DIR}/openswmm6.wasm"