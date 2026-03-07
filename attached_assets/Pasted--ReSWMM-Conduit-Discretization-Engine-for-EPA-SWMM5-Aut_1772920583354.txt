# ReSWMM — Conduit Discretization Engine for EPA SWMM5

**Author:** Robson Leo Pachaly (robsonleopachaly@yahoo.com.br)a
**Original Platform:** Windows Desktop (VB.NET, started April 2018)
**Ported By:** Robert Dickinson — [SWMM5.org](https://swmm5.org) — TypeScript/React implementation
**SWMM Version:** Compatible with EPA SWMM 5.2.x

---

## 1. Overview

ReSWMM is a conduit discretization tool that improves EPA SWMM hydraulic simulations by splitting long conduits into shorter, more uniform segments with intermediate junction nodes. This is a well-known technique for improving numerical stability in SWMM's dynamic wave solver when conduit lengths vary widely across a network.

The tool can operate as:
- A **standalone post-processor** that reads an existing `.inp` file and outputs a discretized `_Disc.inp` file
- An **integrated feature** within a SWMM model generator (as implemented in SWMM5 INP MAKER)

---

## 2. Why Discretize?

### The CFL Problem

SWMM's dynamic wave routing uses the **Courant–Friedrichs–Lewy (CFL)** condition for numerical stability:

```
Δt ≤ Δx / c
```

Where:
- `Δt` = simulation time step (seconds)
- `Δx` = conduit length (ft or m)
- `c` = wave celerity = √(g·D) where g = gravitational acceleration, D = pipe full depth

When a network mixes very long and very short conduits, the **shortest conduit dictates the maximum stable time step** for the entire model. This creates problems:

1. **Impractically small time steps** — a 10 ft conduit next to a 5,000 ft conduit forces the entire model to use the tiny time step required by the short pipe
2. **Numerical instability** — if the time step is too large for any conduit, the solver produces oscillations, mass balance errors, or crashes
3. **Excessive run times** — small global time steps mean many more iterations to simulate the same duration

ReSWMM flags when the longest conduit exceeds **4× the shortest** as a warning that discretization may be beneficial.

### The Solution

Discretizing long conduits into segments whose lengths are proportional to their diameters creates a more uniform CFL distribution across the network, enabling:
- Larger stable time steps
- More reliable convergence
- Reduced simulation time
- Better mass balance

---

## 3. Recommended Time Step Computation

When analyzing an `.inp` file, ReSWMM computes **two recommended time steps** per conduit:

### Standard CFL-Based

```
Δt_standard = L / √(g·D)
```

Where:
- `L` = conduit length
- `g` = 32.174 ft/s² (US) or 9.81 m/s² (SI)
- `D` = full conduit depth (Geom1 from [XSECTIONS])

### Conservative (Vasconcelos et al., 2018)

```
Δt_conservative = 0.10 × Δt_standard
```

This 10% value comes from Vasconcelos et al. (2018) recommendation for pressurized flow conditions where wave celerity can be significantly higher than the gravity wave speed.

### Reference

> Vasconcelos, J.G., Wright, S.J., and Roe, P.L. (2018). "Numerical oscillations in pipe-filling bore predictions by shock-capturing models." *Journal of Hydraulic Engineering*, 144(6).

---

## 4. Discretization Methods

### 4.1 Fixed Interval

Divides each conduit into equal-length segments within a user-specified length range.

**Parameters:**
| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| `fixedMinLength` | 50 | 10–500 | Minimum segment length (ft or m) |
| `fixedMaxLength` | 200 | 50–1000 | Maximum segment length (ft or m) |

**Algorithm:**
1. For each conduit with length `L`:
   - Target length = `clamp(L, minLength, maxLength)`
   - Number of segments = `ceil(L / targetLength)`
   - Actual segment length = `L / nSegments` (equal division)
2. If `nSegments = 1`, conduit is left unchanged
3. Otherwise, conduit is replaced with `nSegments` shorter conduits

**Best for:** Networks with uniform pipe sizes where a consistent segment length is desired.

### 4.2 Δx/D Ratio

Sets each segment length as a multiple of the pipe diameter, automatically producing finer discretization for smaller pipes.

**Parameters:**
| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| `dxDRatio` | 5 | 1–20 | Ratio of segment length to pipe diameter |

**Algorithm:**
1. For each conduit with diameter `D` and length `L`:
   - Target length = `max(1, D × dxDRatio)`
   - Number of segments = `ceil(L / targetLength)`
   - Actual segment length = `L / nSegments`
2. Smaller pipes get shorter segments automatically
3. Larger pipes get proportionally longer segments

**Best for:** Networks with mixed pipe sizes; adapts discretization granularity to pipe geometry.

---

## 5. What Gets Modified

For each conduit that is split, ReSWMM performs the following modifications:

### 5.1 New Junction Nodes

For a conduit split into `N` segments, `N-1` new intermediate junction nodes are created:

```
Original:  J1 ——————————————————— J2
                 Conduit C1 (1000 ft)

After (N=4): J1 ——— C1_N1 ——— C1_N2 ——— C1_N3 ——— J2
               C1_1    C1_2      C1_3      C1_4
              (250ft)  (250ft)   (250ft)   (250ft)
```

Each new junction gets:
- **Name:** `{OriginalConduitName}_N{index}` (e.g., `C1_N1`, `C1_N2`)
- **Invert Elevation:** Linearly interpolated between upstream and downstream nodes
  ```
  elev_new = elev_from + (elev_to - elev_from) × (fraction)
  ```
- **Maximum Depth:** Inherited from the upstream node
- **Ponded Area:** Set to the MNSA value (Minimum Nodal Surface Area)
- **X/Y Coordinates:** Linearly interpolated between upstream and downstream node coordinates

### 5.2 New Conduit Segments

Each segment inherits properties from the original conduit:

| Property | First Segment | Intermediate Segments | Last Segment |
|----------|--------------|----------------------|--------------|
| Length | `L / N` | `L / N` | `L / N` |
| Roughness | Same as original | Same as original | Same as original |
| Inlet Offset | Same as original | 0 | 0 |
| Outlet Offset | 0 | 0 | Same as original |
| Diameter | Same as original | Same as original | Same as original |
| Shape | Same as original | Same as original | Same as original |

**Naming convention:** `{OriginalName}_{segmentIndex}` (e.g., `C1_1`, `C1_2`, `C1_3`, `C1_4`)

### 5.3 Cross-Section Replication

Each new conduit segment receives an identical cross-section entry in `[XSECTIONS]` with the same shape, dimensions, and barrel count as the original.

### 5.4 Loss Distribution

Entry and exit losses from the `[LOSSES]` section are distributed:
- **Entry loss** → applied only to the first segment
- **Exit loss** → applied only to the last segment
- **Average loss** → distributed equally across all segments

### 5.5 Coordinate Interpolation

New junction coordinates for `[COORDINATES]` are linearly interpolated:
```
x_new = x_from + (x_to - x_from) × fraction
y_new = y_from + (y_to - y_from) × fraction
```

This ensures the discretized network displays correctly in SWMM's map view.

---

## 6. MNSA — Minimum Nodal Surface Area

The **Minimum Nodal Surface Area** (MNSA) controls the ponded area at new intermediate junctions. This parameter affects surcharge behavior:

| Parameter | Default | Range | Unit |
|-----------|---------|-------|------|
| `mnsa` | 12.566 | 0.1–100 | ft² (US) or m² (SI) |

The default value of 12.566 ft² corresponds to the area of a circle with diameter 4 ft (a standard manhole):
```
A = π × r² = π × 2² = 12.566 ft²
```

**Effect on simulation:**
- **Larger MNSA** → more water can pond at a junction before pressurizing, reducing surcharge oscillations
- **Smaller MNSA** → junction pressurizes quickly, more sensitive to flow transients
- **Too small** → can cause numerical instability at intermediate nodes

---

## 7. Configuration Interface

### TypeScript Interface

```typescript
export type DiscretizationMethod = 'none' | 'fixed_interval' | 'dx_d_ratio';

export interface ReswmmConfig {
  enabled: boolean;
  method: DiscretizationMethod;
  fixedMinLength: number;   // ft or m (10–500, step 5)
  fixedMaxLength: number;   // ft or m (50–1000, step 10)
  dxDRatio: number;         // dimensionless (1–20, step 0.5)
  mnsa: number;             // ft² or m² (0.1–100, step 0.1)
}

export const DEFAULT_RESWMM: ReswmmConfig = {
  enabled: false,
  method: 'fixed_interval',
  fixedMinLength: 50,
  fixedMaxLength: 200,
  dxDRatio: 5,
  mnsa: 12.566,
};
```

### Output Statistics

After discretization, the following statistics are computed and available:

```typescript
{
  reswmmEnabled: boolean;       // Whether discretization was applied
  reswmmMethod: string;         // "fixed_interval" or "dx_d_ratio"
  reswmmOrigConduits: number;   // Conduit count before discretization
  reswmmNewConduits: number;    // Conduit count after discretization
  reswmmNewJunctions: number;   // Number of new intermediate junctions added
  reswmmSplitLinks: number;     // Number of original conduits that were split
  reswmmMNSA: number;           // MNSA value used (ft² or m²)
}
```

---

## 8. Algorithm Implementation (Complete)

```typescript
function discretizeReSWMM(
  conduits: ConduitData[],
  junctions: JunctionData[],
  nodeLookup: Record<string, NodeInfo>,
  config: ReswmmConfig
): { conduits: ConduitData[]; newJunctions: number; splitLinks: number } {

  let newJunctions = 0;
  let splitLinks = 0;
  const discretized: ConduitData[] = [];

  for (const c of conduits) {
    // Compute target segment length based on method
    let targetLen: number;
    if (config.method === 'fixed_interval') {
      targetLen = Math.min(
        config.fixedMaxLength,
        Math.max(config.fixedMinLength, c.len)
      );
    } else { // dx_d_ratio
      targetLen = Math.max(1, c.diam * config.dxDRatio);
    }

    // Determine number of segments
    const nSeg = Math.max(1, Math.ceil(c.len / targetLen));

    // If conduit doesn't need splitting, keep as-is
    if (nSeg <= 1) {
      discretized.push(c);
      continue;
    }

    splitLinks++;
    const segLen = +(c.len / nSeg).toFixed(2);
    const fromNode = nodeLookup[c.from];
    const toNode = nodeLookup[c.to];

    if (!fromNode || !toNode) {
      discretized.push(c);
      continue;
    }

    const fromElev = fromNode.elev || 0;
    const toElev = toNode.elev || 0;
    let prevNodeName = c.from;

    for (let s = 0; s < nSeg; s++) {
      const isLast = s === nSeg - 1;
      let nextNodeName: string;

      if (isLast) {
        nextNodeName = c.to;
      } else {
        // Create intermediate junction
        const frac = (s + 1) / nSeg;
        nextNodeName = `${c.name}_N${s + 1}`;

        const interpElev = +(fromElev + (toElev - fromElev) * frac).toFixed(3);
        const interpX = fromNode.x + (toNode.x - fromNode.x) * frac;
        const interpY = fromNode.y + (toNode.y - fromNode.y) * frac;
        const maxD = fromNode.maxD || 6;
        const mnsaPonded = Math.round(config.mnsa);

        junctions.push({
          name: nextNodeName,
          elev: interpElev,
          maxD: +maxD.toFixed(2),
          ponded: mnsaPonded,
          x: interpX,
          y: interpY,
        });

        nodeLookup[nextNodeName] = {
          elev: interpElev,
          maxD,
          x: interpX,
          y: interpY,
        };

        newJunctions++;
      }

      // Create segment conduit
      discretized.push({
        name: `${c.name}_${s + 1}`,
        from: prevNodeName,
        to: nextNodeName,
        len: segLen,
        rough: c.rough,
        inOff: s === 0 ? c.inOff : 0,     // Entry offset only on first
        outOff: isLast ? c.outOff : 0,      // Exit offset only on last
        diam: c.diam,
        shape: c.shape,
      });

      prevNodeName = nextNodeName;
    }
  }

  return { conduits: discretized, newJunctions, splitLinks };
}
```

---

## 9. INP File Sections Affected

When discretization is applied, the following `[SECTIONS]` in the `.inp` file are modified:

| Section | Modification |
|---------|-------------|
| `[TITLE]` | Comment line added: `;;ReSWMM Discretization: {method}, {params}` |
| `[JUNCTIONS]` | New intermediate junction rows added with interpolated elevations |
| `[CONDUITS]` | Original conduits replaced with chains of shorter segments |
| `[XSECTIONS]` | Cross-section entries replicated for each new segment |
| `[LOSSES]` | Entry/exit losses distributed to first/last segments only |
| `[COORDINATES]` | New junction coordinates added (interpolated X/Y positions) |

Sections **not** modified: `[OPTIONS]`, `[OUTFALLS]`, `[STORAGE]`, `[PUMPS]`, `[ORIFICES]`, `[WEIRS]`, `[SUBCATCHMENTS]`, etc.

---

## 10. UI Controls

The ReSWMM feature is controlled via a toggle panel in the configuration sidebar:

### Toggle

| Control | data-testid | Type | Description |
|---------|------------|------|-------------|
| Enable/Disable | `toggle-reswmm` | Button (toggle) | Enables ReSWMM discretization |
| Description toggle | `button-reswmm-desc-toggle` | Button | Show/hide "What is ReSWMM?" description |

### Method Selection

| Control | data-testid | Type | Options |
|---------|------------|------|---------|
| Method | `reswmm-method` | ToggleGroup | "Fixed Interval" / "Δx/D Ratio" |

### Fixed Interval Parameters

| Control | data-testid | Type | Range |
|---------|------------|------|-------|
| Min Length display | `text-reswmm-min-len` | Text | Shows current value + unit |
| Min Length slider | `slider-reswmm-min-len` | Slider | 10–500, step 5 |
| Max Length display | `text-reswmm-max-len` | Text | Shows current value + unit |
| Max Length slider | `slider-reswmm-max-len` | Slider | 50–1000, step 10 |

### Δx/D Ratio Parameters

| Control | data-testid | Type | Range |
|---------|------------|------|-------|
| Ratio display | `text-reswmm-dxd` | Text | Shows current ratio value |
| Ratio slider | `slider-reswmm-dxd` | Slider | 1–20, step 0.5 |

### Common Parameters

| Control | data-testid | Type | Range |
|---------|------------|------|-------|
| MNSA display | `text-reswmm-mnsa` | Text | Shows value + unit (ft² or m²) |
| MNSA slider | `slider-reswmm-mnsa` | Slider | 0.1–100, step 0.1 |

---

## 11. Example Presets

Three ReSWMM-specific presets are included:

### ReSWMM Fixed Interval (Sanitary)
```
N: 500, type: sanitary, terrain: moderate
method: fixed_interval, minLength: 50, maxLength: 200
mnsa: 12.566
```
Sanitary sewer with fixed-interval discretization — 50–200 ft segments.

### ReSWMM Δx/D Ratio (Stormwater)
```
N: 400, type: stormwater, terrain: hilly
method: dx_d_ratio, dxDRatio: 5
mnsa: 12.566
```
Stormwater with Δx/D ratio discretization — ratio = 5, hilly terrain.

### ReSWMM Fine Mesh (Combined)
```
N: 300, type: combined, terrain: moderate, detail: detailed
method: fixed_interval, minLength: 20, maxLength: 80
mnsa: 20.0
```
Combined sewer with fine discretization — 20–80 ft segments, higher MNSA.

---

## 12. Data Types

### ConduitData (input/output)

```typescript
interface ConduitData {
  name: string;      // Conduit identifier (e.g., "C1" or "C1_3")
  from: string;      // Upstream node name
  to: string;        // Downstream node name
  len: number;       // Length in ft or m
  rough: number;     // Manning's roughness coefficient
  inOff: number;     // Inlet offset (depth units)
  outOff: number;    // Outlet offset (depth units)
  diam: number;      // Pipe diameter/height (depth units)
  shape: string;     // Cross-section shape (CIRCULAR, RECT_CLOSED, etc.)
}
```

### JunctionData (for new intermediate nodes)

```typescript
interface JunctionData {
  name: string;      // Junction identifier (e.g., "C1_N1")
  elev: number;      // Invert elevation (interpolated)
  maxD: number;      // Maximum depth (inherited from upstream)
  ponded: number;    // Ponded area = MNSA value
  x: number;         // X coordinate (interpolated)
  y: number;         // Y coordinate (interpolated)
}
```

---

## 13. Standalone Usage (Desktop Application)

The original ReSWMM desktop application by Robson Leo Pachaly operates as follows:

### Input
- Load any standard EPA SWMM `.inp` file

### Analysis Phase
1. Parse `[CONDUITS]` and `[XSECTIONS]` sections
2. For each conduit, compute:
   - Standard CFL time step: `L / √(g·D)`
   - Conservative time step: `0.10 × standard`
3. Display time step distribution and flag conduits with length ratios > 4:1
4. Show network statistics: total conduits, length range, diameter range

### Discretization Phase
1. User selects method (Fixed Interval or Δx/D Ratio) and parameters
2. Tool splits qualifying conduits into segments
3. New junction nodes are created with interpolated properties
4. Output saved as `{filename}_Disc.inp`

### Output
- New `.inp` file with discretized conduits
- Summary report: conduits split, new junctions added, new total element count
- Comparison of time step distributions before/after

---

## 14. Integration with SWMM5 INP MAKER

In the SWMM5 INP MAKER web application, ReSWMM is integrated as a generation-time feature:

1. User enables the ReSWMM toggle and configures parameters
2. During model generation, after the network topology and conduit properties are assigned:
   - The discretization algorithm runs over all conduits
   - New intermediate junctions are inserted into the junction array
   - Original conduits are replaced with segmented chains
3. The resulting `.inp` file already contains the discretized network — no post-processing needed
4. Generation statistics include ReSWMM metrics (original count, split count, new junction count)

The INP MAKER's terrain-based elevation assignment and pipe sizing produce realistic conduit length variation — exactly the scenario where discretization provides the most benefit.

---

## 15. Glossary

| Term | Definition |
|------|-----------|
| **CFL** | Courant–Friedrichs–Lewy condition — numerical stability criterion requiring the time step be small enough that a wave cannot travel more than one computational cell per step |
| **MNSA** | Minimum Nodal Surface Area — the plan-view area assigned to intermediate junctions, controlling surcharge volume storage at discretized nodes |
| **Δx/D Ratio** | The ratio of conduit segment length to pipe diameter; controls discretization granularity relative to pipe size |
| **Wave Celerity** | Speed at which a pressure/gravity wave propagates through a pipe: `c = √(g·D)` |
| **Discretization** | The process of subdividing a long conduit into multiple shorter segments with intermediate junction nodes |
| **Surcharge** | Condition when water level at a junction exceeds the crown of connecting pipes, causing pressurized flow |
| **DYNWAVE** | SWMM's dynamic wave routing method that solves the full Saint-Venant equations; most sensitive to CFL conditions |

---

## 16. References

1. Pachaly, R.L. (2018). ReSWMM — SWMM Conduit Discretization Tool. VB.NET Desktop Application.
2. Vasconcelos, J.G., Wright, S.J., and Roe, P.L. (2018). "Numerical oscillations in pipe-filling bore predictions by shock-capturing models." *Journal of Hydraulic Engineering*, 144(6).
3. Rossman, L.A. (2015). *Storm Water Management Model User's Manual Version 5.1*. EPA/600/R-14/413b. U.S. EPA, Cincinnati, OH.
4. Courant, R., Friedrichs, K., and Lewy, H. (1928). "Über die partiellen Differenzengleichungen der mathematischen Physik." *Mathematische Annalen*, 100(1), 32–74.
