---
name: SWMM report flags & time series
description: How [REPORT] SUBCATCHMENTS/NODES/LINKS flags gate both rpt and binary .out time series, and WASM vs CLI differences
---
- SWMM's `[REPORT]` NODES/LINKS/SUBCATCHMENTS flags gate which elements are written to the binary `.out` too — not just the rpt. A model without them yields only System series in the .out.
- The WASM library build's `swmm_report()` writes element time series directly into the rpt when report flags are set; the CLI executable with a .out file does not (rpt lacks `<<<` sections). **How to apply:** don't assume rpt content parity between engine modes; the worker's append-from-.out path only fires when the rpt lacks `<<<`.
