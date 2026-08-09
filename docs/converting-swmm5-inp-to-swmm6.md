# Converting a SWMM5 .inp File for SWMM6

The good news: a SWMM 5.x `.inp` file is valid SWMM6 input as-is — SWMM6 (OpenSWMM 6.0.0-alpha) parses the classic format unchanged. "Converting" a file really means **adding the SWMM6-only options that make the new engine worth using**, and knowing the rules that make those additions valid.

The flip side is equally important: **none of these additions can go back to SWMM 5.x.** Stock EPA SWMM 5 rejects every unknown `[OPTIONS]` keyword with **ERROR 205** and has no `[VIRTUAL_JUNCTIONS]` section. Keep a SWMM5 copy of the model, or add the SWMM6 lines only to the copy you run on SWMM6.

## 1. New [OPTIONS] keywords

All of these go in the existing `[OPTIONS]` section, one per line, `KEYWORD value` like every other option.

### Dynamic Preissmann Slot surcharge method

```
SURCHARGE_METHOD     DYNAMIC_SLOT
DPS_CELERITY         25
DPS_ALPHA            3
DPS_DECAY_TIME       0.5
```

- `SURCHARGE_METHOD DYNAMIC_SLOT` replaces the classic EXTRAN surcharge algorithm with a dynamic Preissmann slot — generally more stable for pressurized systems.
- The three `DPS_*` values are the tuning knobs (defaults shown): target pressure celerity in m/s (`DPS_CELERITY`, 0–1000), shock parameter (`DPS_ALPHA`, ≥ 2), and Preissmann Number decay time in seconds (`DPS_DECAY_TIME`).
- **Only honored under `FLOW_ROUTING DYNWAVE`.** With steady or kinematic routing the keyword is accepted but silently unused — it won't even be echoed in the `.rpt` summary. If you're testing whether the engine respects the option, make sure the model is dynamic wave first.

### Node continuity and solver acceleration

```
NODE_CONTINUITY      SEMI_IMPLICIT
ANDERSON_ACCEL       YES
```

- `NODE_CONTINUITY SEMI_IMPLICIT` switches node depth updates to a Crank–Nicolson (semi-implicit) scheme.
- `ANDERSON_ACCEL YES` turns on Anderson acceleration for faster Picard iteration convergence.

### Virtual junction momentum

```
VIRTUAL_JUNCTION_MOMENTUM FULL
```

Only meaningful if the file has a `[VIRTUAL_JUNCTIONS]` section (next section). `FULL` (recommended) or `BASIC`.

## 2. The [VIRTUAL_JUNCTIONS] section

SWMM6 can treat simple pass-through junctions as *virtual* — solved inside the momentum equations of the adjacent conduits instead of as full continuity nodes. This is the headline upgrade for discretized models with many small pass-through nodes.

### Which junctions are eligible

A junction may be virtual only if it is a clean pass-through:

- exactly **2 conduits** connected (one in, one out; conduits only — no pumps, weirs, orifices, outlets),
- **no external inflows** ([INFLOWS]) and **no dry-weather flow** ([DWF]),
- an ordinary junction (not storage, not an outfall, not a divider).

### How to convert one

1. **Remove** its line from `[JUNCTIONS]`.
2. **Add** it to `[VIRTUAL_JUNCTIONS]` with **name and invert elevation ONLY**:

```
[VIRTUAL_JUNCTIONS]
;;Name           InvertElev
J_split_01       101.25
J_split_02       100.87
```

Two strict format rules, both discovered the hard way:

- **Name + invert only.** A virtual junction row takes exactly two tokens. Copying the full `[JUNCTIONS]` row (max depth, initial depth, surcharge depth, ponded area) is a **parse error** — delete the extra columns.
- **`[VIRTUAL_JUNCTIONS]` must appear BEFORE `[CONDUITS]`** in the file. The conduit parser needs to know the virtual nodes when it links them. Put the section wrong-side of `[CONDUITS]` and the engine fails with **ERROR 609**. The safe layout is: `[JUNCTIONS]`, then `[VIRTUAL_JUNCTIONS]`, then the other node sections, then `[CONDUITS]`. (If the model has no `[JUNCTIONS]` section at all because every junction went virtual, just make sure the block still precedes `[CONDUITS]`.)

3. Optionally set the momentum treatment in `[OPTIONS]`:

```
VIRTUAL_JUNCTION_MOMENTUM FULL
```

Everything else — `[COORDINATES]`, `[CONDUITS]` references, vertices — keeps using the junction's name unchanged; only its `[JUNCTIONS]` row moves.

### Version warning

Virtual junctions require **6.0.0-alpha.3 or newer**. The alpha.2 engine crashed on VJ models; check the version line in the `.rpt` header before blaming the file.

## 3. Minimal worked example

Before (SWMM5):

```
[OPTIONS]
FLOW_ROUTING         DYNWAVE
...

[JUNCTIONS]
;;Name  Invert  MaxDepth  InitDepth  SurDepth  Aponded
J1      100.0   10        0          0         0
J2      99.5    10        0          0         0     ; pass-through, 2 conduits, no inflows

[CONDUITS]
C1      J1  J2  400  0.015  0  0
C2      J2  OUT 400  0.015  0  0
```

After (SWMM6, J2 made virtual):

```
[OPTIONS]
FLOW_ROUTING         DYNWAVE
SURCHARGE_METHOD     DYNAMIC_SLOT
NODE_CONTINUITY      SEMI_IMPLICIT
ANDERSON_ACCEL       YES
VIRTUAL_JUNCTION_MOMENTUM FULL
...

[JUNCTIONS]
J1      100.0   10        0          0         0

[VIRTUAL_JUNCTIONS]
J2      99.5

[CONDUITS]
C1      J1  J2  400  0.015  0  0
C2      J2  OUT 400  0.015  0  0
```

## 4. Checklist

- [ ] Keep an untouched SWMM5 copy — SWMM6 keywords cause ERROR 205 on SWMM 5.x.
- [ ] `FLOW_ROUTING DYNWAVE` if you expect `SURCHARGE_METHOD` to do anything.
- [ ] Virtual junction rows: name + invert only.
- [ ] `[VIRTUAL_JUNCTIONS]` before `[CONDUITS]` (ERROR 609 otherwise).
- [ ] Only convert clean pass-through junctions (2 conduits, no inflows/DWF).
- [ ] Engine is 6.0.0-alpha.3+ (check the `.rpt` header).

## 5. How this app does it

This project automates all of the above: the Simulation Settings panel's "SWMM6 Options" writes the `[OPTIONS]` keywords (`shared/inpOptions.ts`), and the ReSWMM tool's Virtual Junctions toggle emits the `[VIRTUAL_JUNCTIONS]` section with correct placement and format (`client/src/lib/reswmmEngine.ts`). Both only apply the SWMM6-only lines when the run targets the in-browser SWMM6 engine, so SWMM5 runs stay clean.
