---
name: Test suite quirks
description: Non-obvious constraints for running/extending the vitest suite (uploads dir races, WASM loading in Node, fake engine via RUNSWMM_PATH)
---
- Vitest must keep `fileParallelism: false`: integration test files each boot the server, whose startup sweep deletes `uploads/tmp` shared across processes. **Why:** parallel files raced and produced ENOENT during multer writes. **How to apply:** don't re-enable parallel files without isolating upload dirs per test file.
- The emscripten SWMM bundle returns an empty object via `require()` in this environment; load it with `new Function(src + 'return createSwmmModule;')` and pass `wasmBinary: fs.readFileSync(...wasm)` or instantiation tries `fetch()` and fails.
- To simulate a broken/empty-report engine in integration tests, point `RUNSWMM_PATH` at a fake shell script before creating the app (detection reads env at call time).
- Fractional `timeoutMinutes` (e.g. 0.02 ≈ 1.2s) is accepted by the batch start API — handy for fast timeout tests.
- Under `"type":"module"`, `require()` of a plain UMD .js (e.g. the shared .out parser) returns an empty namespace; load it with `new Function("self", src)(scope)` like importScripts would.
