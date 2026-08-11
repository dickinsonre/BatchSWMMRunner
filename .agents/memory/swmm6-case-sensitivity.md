---
name: SWMM6 name case sensitivity
description: SWMM5 matches object names case-insensitively; SWMM6 (OpenSWMM 6) is case-strict — mismatches fail with ERROR 209
---
- Classic SWMM5 hash-table lookups upper-case names, so `BOUNDARY@1020` finds a series defined as `Boundary@1020`. The OpenSWMM 6 engine is case-strict and fails with `ERROR 209: undefined object`.
- **Why:** a user model ran fine on executable/API/SWMM5-WASM but failed only on SWMM6 WASM; the `@` symbol was a red herring — the real cause was the capitalization mismatch.
- **How to apply:** `normalizeInpNameCase` (shared/inpCaseNormalize.ts) rewrites case-variant references to time series/curves/patterns before SWMM6 WASM runs. Keep it section- and type-aware: names are scoped per object type (node `Foo` + curve `foo` can coexist), so never do global token replacement — only rewrite documented reference columns, never FILE paths, expressions, or definitions of other types.
