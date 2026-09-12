---
name: Coherence screening scope
description: Interpretation boundary for the user-provided hydraulic coherence diagnostic.
---
Keep report-summary coherence screening distinct from concurrent time-series evidence and engine-similarity scores.

**Why:** The supplied diagnostic combines maximum velocity and maximum depth that may occur at different times. Its review/clear colors prioritize investigation, not prove solver stability or agreement. Its original binary reader only understands the SWMM5 output layout.

**How to apply:** Preserve this limitation when extending the diagnostic. Do not label a report-maxima calculation concurrent or pass SWMM6 binary data through a SWMM5 reader without validating the format. Invalid thresholds and missing hydraulic evidence must never become a reassuring clear result.

Maintain one shared diagnostic experience across entry points rather than parallel implementations.

**Why:** The user explicitly approved merging the supplied ZIP's richer capabilities while preserving the native implementation's validation safeguards, not retaining competing calculators.

**How to apply:** Future extensions should share calculations and evidence semantics. In particular, screen/report overlap belongs to each individual run; a flag in one engine and an instability listing in the other must never be combined into apparent corroboration.

Native engine exports must remain distinct from the report text used for UI analysis.

**Why:** The app appends parsed binary time series to reports for display, so exporting that augmented string as an original RPT would misrepresent the engine's output. Reconstructing OUT from chart data would also lose native information.

**How to apply:** Capture native RPT/OUT before augmentation and cleanup. Retain binary artifacts only for opted-in comparison runs to avoid adding their memory cost to ordinary batches; explain when a rerun is required.

Default retained-run inspection to the newest single result; do not automatically pair independent historical engine runs.

**Why:** Matching model geometry alone does not establish that two retained runs were intended as a comparison. Automatically choosing one run per engine can silently compare stale results.

**How to apply:** Require explicit comparison selection unless a shared comparison session and model occurrence establish the intended pair.