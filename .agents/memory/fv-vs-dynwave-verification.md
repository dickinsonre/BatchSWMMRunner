---
name: FV vs DYNWAVE verification pitfalls
description: What to watch for when comparing FV routing against DYNWAVE on the bundled sample models.
---

# FV vs DYNWAVE verification pitfalls

- Some sample .inp files use the `DW` alias instead of `DYNWAVE` (e.g. EPA_Example3). A `FLOW_ROUTING\s+DYNWAVE` replace silently no-ops and you end up comparing DYNWAVE against itself — always match `(DYNWAVE|DW)\b` and assert the report's "Flow Routing Method" line says FV.
- Broken DYNWAVE baselines (Aug 2026 status): Session62_ALLWEIR fails only in SWMM6 engines (~59% continuity, all-zero link flows; SWMM5 CLI is fine — engine deficiency on all-weir networks, flagged in the sample picker via a server-side known-issues map). Session4_40Subs_327Links was fixed by dropping ROUTING_STEP 30s→1s (21.5%→2.6% SWMM6, 0.15% SWMM5). Session74_449_H_Elements measures ~1.9% on both SWMM6 rel/dev — earlier ~11% did not reproduce. Comparing FV to a non-mass-conserving DYNWAVE run verifies nothing — assert the DW baseline continuity first.
- RESOLVED: the huge FV weir divergence (Demo_extran4: DW ~28 vs FV ~4 cfs) was a MESH-RESOLUTION artifact, not weir coupling. FV's default COARSE mesh (4 cells/conduit) over-conveys long/rough conduits — a 5000 ft n=0.034 pipe got 1250 ft cells and passed ~2x its Manning capacity (flow insensitive to n!), so the upstream node never rose over the weir crest. `FV_CELL_LENGTH 100` fixes it (weir within ~6% of DW, runs in seconds). Rule: any FV-vs-DW comparison on models with long conduits (>~500 ft) must set FV_CELL_LENGTH; a coarse-mesh FV run that conserves mass can still be hydraulically wrong. Quick smoke test: single long pipe fed above capacity — coarse FV passes it all at absurd velocity, fine FV backs up like DW. Fix shipped app-side: normalizeSwmm6Options injects a safe FV_CELL_LENGTH default (see DEFAULT_FV_CELL_LENGTH) whenever an FV run leaves it unset, so all app FV runs avoid the COARSE mesh.
- Good clean comparison models: EPA_Example3 (pump+storage), Demo_extran7 (pump), Session73_527_H_Elements (529 elements, 1 outlier link "28").
- FV runtime is load-sensitive in WASM (Session73 24h: 60–125s per run); FV on very large storage-heavy models (Session29_292Storage, Session58_Interceptor) takes many minutes — impractical for tests.
- Detached background processes (setsid/nohup) get reaped between shell invocations in this environment; long test runs must fit one shell call — shard via an env filter (FV_ENGINE=rel|dev).

- develop snapshot 19a1bc4 FV solver is ~2.5x slower than earlier builds (Session73 24h FV: ~325s, no longer fits one 300s shell call); the Session73 test now trims both DW and FV variants to a 12h window via overrides. Shard FV suites per model with `-t <plain substring>` (vitest -t is a regex — names with parens/+ never match literally).

**Why:** a silent regex no-op produced a false "FV passes" result once; broken baselines produced false failures.
**How to apply:** any test or probe comparing routing engines on bundled samples.
