---
name: Engine time alignment
description: How to compare SWMM5 vs SWMM6 time series without blank/mismatched data
---
SWMM5 and SWMM6 write report timestamps in different string formats and can anchor to different clock starts, so exact time-string joins silently fail (one engine's data appears missing/blank/gray).

**Why:** GIF map animation showed one engine's network entirely gray; QA/QC overlay had the same class of bug earlier.

**How to apply:** whenever joining two engines' time series (charts, GIFs, tables), parse each timestamp, anchor each engine to its OWN first timestamp, and join on whole elapsed seconds (`Math.round((t - t0)/1000)`), never on raw time strings.
