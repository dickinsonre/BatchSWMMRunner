# Bill James Similarity Index

BatchSWMM56 uses two related comparison tools in the **Similarity** tab:

1. **Bill James model score (0–1,000)** — the headline whole-model comparison used to rank engine results.
2. **Bill James system-series analysis (0–100)** — a separate 12-statistic diagnostic for the selected reference/candidate pair.

The 1,000-point score is the decision-making score. The 0–100 analysis is supporting evidence; it does not add to or multiply the 1,000-point result.

## How to use it

1. Run the same model with at least two engines.
2. Open the comparison **Similarity** tab and select the model. Duplicate file names remain separate by occurrence.
3. Choose a completed engine as the **reference**.
4. Review the ranked candidate list. A higher score means the candidate is more similar to the reference under this schedule.
5. Select a candidate to inspect its category scores, deduction ledger, per-entity hydrograph-shape diagnostics, worst elements, and the advisory system-series statistics.

The comparison is **directional**: `Reference → Candidate` is not necessarily the same as `Candidate → Reference`. The reference supplies the expected entities, baseline values, and denominators used by several metrics.

## Interpreting the 1,000-point score

| Score | Interpretation |
| ---: | --- |
| 950–1,000 | Virtually identical |
| 900–949.999 | Truly similar |
| 850–899.999 | Essentially similar |
| 700–849.999 | Same family — differences matter |
| Below 700 | Not comparable at these settings |

An identical valid result scores exactly **1,000**.

## Whole-model score structure

The score begins at 1,000 points and is rolled up from four categories with these base weights:

| Category | Weight | What is compared |
| --- | ---: | --- |
| System | 200 | Runoff volume, outfall volume, flooding volume, final storage, and routing continuity |
| Subcatchments | 200 | Runoff volume, peak runoff, time to peak, and runoff KGE for every reference subcatchment |
| Nodes | 300 | Peak depth, flooding volume, depth time to peak, depth KGE, and depth NSE for every reference node |
| Links | 300 | Peak flow, absolute flow volume, peak velocity, flow time to peak, flow KGE, and flow NSE for every reference link |

Each reference entity starts with an internal **100-point** score. Metric deductions are individually capped. If a custom schedule would remove more than 100 points, its deductions are scaled proportionally so the element reaches zero without favoring whichever metric happened to run first. The category score is the average of its reference-entity scores, then scaled by that category's effective weight.

If the reference has no records in a category, that category's base weight is redistributed proportionally across the populated categories. The effective weights always total 1,000. For example, a model with no subcatchments uses System 250, Nodes 375, and Links 375.

For example, an 80/100 Node category receives:

```text
300 × (80 / 100) = 240 network points
```

The **deduction ledger** converts every local deduction into weighted network points. Its entries add up to:

```text
1,000 − model score
```

This gives an engineer a direct explanation of why a candidate lost points.

## How measurements are derived

All time-series comparisons use each report's elapsed time from its own first timestamp. Calendar dates do not have to match. The candidate and reference must still have the same elapsed report grid.

- **Volumes** use trapezoidal integration over the report time steps.
- **Peaks** are the largest reported value; link flow and velocity use magnitude so reversed flow is included.
- **Time to peak** is measured in report steps and is used only when both peaks exceed the applicable absolute floor.
- **Shape diagnostics** use only report steps where the reference magnitude exceeds the applicable flow or depth floor. At least 10 such reference-wet steps are required.
- **KGE-2009** is `1 − √((r−1)² + (α−1)² + (β−1)²)`, where `r` is correlation, `α = σcandidate / σreference`, and `β = μcandidate / μreference`.
- **NSE** is `1 − Σ(reference−candidate)² / Σ(reference−μreference)²`. Negative values are valid and remain visible.
- **MSE** is the mean squared error over the same reference-wet window. It is reported in squared native units but never deducts points.
- **Routing continuity**, when both reports provide it, uses the absolute difference in reported routing-continuity error, measured in percentage points.

Small values use conservative native-unit floors so near-zero values do not create a misleadingly large percentage difference:

| Measurement | Floor |
| --- | ---: |
| Flow | 0.001 |
| Depth | 0.01 |
| Velocity | 0.01 |
| Integrated volume and final storage | `flow floor × model duration` |

No unit conversion is performed.

KGE-2009, NSE, MSE, `r`, `α`, and `β` are reported together for every eligible subcatchment runoff, node depth, and link flow series. Shape evidence is skipped rather than penalized when the reference has fewer than 10 wet steps, its wet-window mean does not exceed the floor, or either wet-window series is constant. NSE and MSE remain diagnostic-only for subcatchments; KGE is the only subcatchment shape deduction.

## Deduction schedule

Percent-based deductions use the percent difference from the reference. “Cap” is the maximum that one metric can deduct from an entity's 100-point local score.

### System

| Metric | Deduction | Cap |
| --- | ---: | ---: |
| Runoff, outfall, flooding volume, or final storage | 1 point per 0.5% difference | 20 each |
| Routing continuity | 1 point per 0.1 percentage-point difference | 20 |

The five System metrics can therefore remove at most 100 local points in total.

### Subcatchments

| Metric | Deduction | Cap |
| --- | ---: | ---: |
| Runoff volume | 1 point per 0.5% | 35 |
| Peak runoff | 1 point per 0.5% | 35 |
| Runoff time to peak | 1 point per report step | 20 |
| Runoff KGE-2009 | 1 point per 0.02 below 1.00 | 20 |

### Nodes

| Metric | Deduction | Cap |
| --- | ---: | ---: |
| Peak depth | 1 point per 0.5% | 30 |
| Flood volume | 1 point per 1% | 30 |
| Depth time to peak | 1 point per report step | 15 |
| Depth KGE-2009 | 1 point per 0.02 below 1.00 | 15 |
| Depth NSE | 1 point per 0.02 below 1.00 | 10 |

### Links

| Metric | Deduction | Cap |
| --- | ---: | ---: |
| Peak flow | 1 point per 0.5% | 25 |
| Absolute flow volume | 1 point per 0.5% | 25 |
| Peak velocity | 1 point per 1% | 15 |
| Flow time to peak | 1 point per report step | 10 |
| Flow KGE-2009 | 1 point per 0.02 below 1.00 | 15 |
| Flow NSE | 1 point per 0.02 below 1.00 | 10 |

## Structural differences

The reference defines the entity set that is scored.

- A reference subcatchment, node, or link that is **missing from the candidate** receives an element score of zero. It appears in the ledger as a missing element.
- A candidate subcatchment, node, or link **not present in the reference** is reported as a candidate-only record but does not change the score.
- If the reference has no entities in a category, that category receives zero effective weight and its base weight is redistributed across the populated categories.

This behavior is directional by design. Reversing the reference can change both the entity set and the score.

## Missing evidence and skipped metrics

An unavailable individual metric does not manufacture a zero, a deduction, or an automatic no-score result. The scorer skips that metric and records the reason in the **Evidence coverage** panel. This includes:

- a missing metric column or native-unit label;
- an entire candidate System time series (its System metrics are listed separately);
- missing or non-finite samples;
- routing continuity unavailable on either report; and
- time to peak when either peak is at or below the applicable absolute floor;
- shape metrics with fewer than 10 reference-wet steps;
- shape metrics whose reference wet-window mean does not exceed the floor; and
- shape metrics when the reference or candidate wet-window series is constant.

The remaining available metrics still produce a score. Review the skipped-evidence count alongside the score: two candidates with different evidence coverage should not be treated as equally substantiated merely because their numeric scores match.

## Why a candidate may show “No score”

“No score” is an intentional result, not a zero. It means the comparison prerequisites fail before optional metric evidence can be assessed. The UI reports the specific gate reason, including:

- the reference or candidate did not finish successfully;
- no usable report time-series data is available;
- binary time-series output was truncated to the graphing safety limit rather than covering every report period;
- the report grid is incomplete, internally inconsistent, or different between engines;
- a paired metric has incompatible native units; or
- the reference contains no scoreable category.

Failed, timed-out, and missing candidate runs remain in the ranking list and sort after scored candidates with their gate reason shown.

### Native-unit policy

The binary-output adapters propagate each engine's native flow, depth, velocity, volume, and pollutant units into the parsed series. The score never silently converts values. Equivalent spelling labels such as `ft`/`feet` and `m`/`meters` are accepted as the same native unit; genuinely different native units still produce a no-score gate. Missing unit metadata causes that metric to be skipped.

## The advisory 0–100 system-series analysis

Below the 1,000-point evidence is the original published-style Bill James system-series diagnostic. It compares matching system variables for the selected `Reference → Candidate` pair and scores each variable from 0 to 100 using these weighted components:

| Component | Weight |
| --- | ---: |
| Mean difference | 10 |
| RMSE | 20 |
| MAPE | 15 |
| Standard deviation difference | 10 |
| Skewness difference | 5 |
| Kurtosis difference | 5 |
| Log NSE error | 10 |
| Index of agreement error | 10 |
| Integral square error per sample | 5 |
| Correlation error | 5 |
| NSE error | 5 |
| Kling–Gupta error | 5 |

The weights total 105, matching the published template. The panel shows coverage, sample counts, exclusions, and the 12-component drill-down for the selected system variable.

Only exact elapsed-time overlap contributes to this advisory headline. A value marked with `*` is a partial-overlap diagnostic and is deliberately excluded from the advisory aggregate.

## What the index does not claim

The index does not prove two engines are physically equivalent, validate model calibration, or replace review of warnings, errors, mass balance, plots, and engineering judgment. It is an auditable comparison schedule for prioritizing where those reviews should focus.