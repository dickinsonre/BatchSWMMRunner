# Why Conduit Discretization Matters — and How ReSWMM Automates It for Your SWMM5 Models

*A practical look at a common modeling problem most stormwater engineers know but few talk about.*

---

Long conduits in EPA SWMM models are one of those things that quietly degrade your results. You set up your network, run a simulation, and everything looks fine — until you notice the continuity errors creeping up, or the routing timestep getting hammered down to maintain stability. The culprit? A handful of pipes that are too long relative to their diameter for the dynamic wave solver to handle gracefully.

This is where **ReSWMM** comes in — a conduit discretization engine built specifically for EPA SWMM5 `.inp` files. It automates the tedious process of splitting long conduits into shorter segments, creating intermediate junctions, and preserving all hydraulic properties so your model stays intact.

Let me walk through what it does and why it matters.

---

## The Problem: Numerical Stability and the Courant-Friedrichs-Lewy Condition

EPA SWMM's dynamic wave routing solver uses the Saint-Venant equations to simulate unsteady flow through pipe networks. The stability of this numerical solution depends on the **Courant-Friedrichs-Lewy (CFL) condition**, which relates the simulation timestep to conduit length and wave celerity:

**Δt ≤ Δx / c**

Where:
- **Δt** is the routing timestep (seconds)
- **Δx** is the conduit length (feet or meters)
- **c** is the gravity wave celerity: √(g × D), where D is the pipe diameter

When a conduit is very long relative to its diameter, the CFL-stable timestep becomes large — not a problem. But when conduits are *short* relative to their celerity, or when the model has a mix of very long and very short pipes, the solver is forced to reduce the global timestep to accommodate the most restrictive element. This leads to longer runtimes and, in some cases, outright instability (Rossman, 2015).

Conversely, conduits that are *too long* can produce inaccurate flow attenuation and timing because the solver cannot resolve the spatial variation of flow within that single computational element. SWMM's link-node approach does not perform intra-conduit spatial discretization, which Vasconcelos et al. (2018) demonstrated causes significant accuracy problems during rapid filling conditions and mixed free-surface/pressurized flows. Their experimental work showed that inserting intermediate "dummy" junctions — a technique they call **Artificial Spatial Discretization (ASD)** — dramatically improves SWMM's ability to reproduce observed transient behavior.

Pachaly et al. (2020) extended this work by comparing SWMM 5.1's calculation alternatives (EXTRAN vs. Preissmann slot) with and without spatial discretization. Their findings confirmed that adequate temporal *and* spatial discretization together reduce continuity errors and numerical instabilities, particularly in systems prone to pressurization and surcharging. A follow-up field evaluation (Pachaly et al., 2019) validated the discretization approach against real stormwater collection system data, recommending spatial resolutions as fine as 0.2 m for pipe filling events. The same team later applied these techniques to predict surges in Chicago's TARP tunnel system (Pachaly et al., 2021), demonstrating that SWMM with proper discretization can match purpose-built surge models.

The practical fix? **Split long pipes into shorter segments.** Engineers have been doing this manually for decades. The original **ReSWMM** tool (https://github.com/ecotecnologias/ReSWMM) was developed to automate this process, implementing the time step recommendations from Vasconcelos et al. (2018) and the EXTRAN guidelines. BatchSWMM's ReSWMM engine builds on the same principles.

---

## What ReSWMM Actually Does

ReSWMM takes your existing SWMM5 `.inp` file and applies one of two discretization methods:

### 1. Fixed Interval Method
You specify a minimum and maximum segment length. Any conduit longer than the maximum gets split into equal segments that fall within your specified range. A 600-foot pipe with a max length of 200 feet becomes three 200-foot segments.

### 2. Δx/D Ratio Method
The target segment length is calculated as a multiple of the pipe diameter:

**Target Length = D × (Δx/D ratio)**

This approach is grounded in computational hydraulics best practice. A Δx/D ratio of 5 means each segment will be approximately 5 diameters long. The advantage here is that smaller pipes get shorter segments and larger pipes get longer ones — proportional discretization that respects the physics (Akan, 2006).

---

## The Details That Make It Work

Splitting a conduit isn't just about cutting a line into pieces. You need to handle:

- **Intermediate junctions**: ReSWMM creates new junction nodes at each split point. Invert elevations are linearly interpolated between the upstream and downstream nodes — maintaining the pipe slope exactly.

- **Coordinates**: New nodes get interpolated X-Y coordinates so your model's network map still looks correct in EPA SWMM's GUI or any GIS viewer.

- **Cross-sections**: Every new segment inherits the same shape, dimensions, Manning's roughness, and barrel count as the original conduit.

- **Entry/exit losses**: Entrance losses are applied only to the first segment. Exit losses go on the last segment. Average losses are divided proportionally across all segments. This prevents artificial head loss multiplication (Rossman, 2017).

- **Offsets**: Inlet offset on the first segment only, outlet offset on the last only. Middle segments get zero offsets.

- **Minimum Node Surface Area (MNSA)**: Intermediate junctions receive a configurable ponded area (default: 12.566 ft², equivalent to a 4-foot-diameter manhole). This is critical — SWMM5's dynamic wave solver can become unstable at nodes with zero surface area (Rossman, 2015).

---

## Conduit Lengthening: The Other Side of the Coin

Short conduits cause the opposite problem. A 2-foot-long pipe with a 1-foot diameter has a CFL-stable timestep of about 0.35 seconds. If your model has even one of these, the solver may be forced to use tiny timesteps globally, dramatically increasing runtime.

ReSWMM includes a **conduit lengthening** option that calculates the minimum length required for a given timestep:

**Minimum Length = √(g × D) × Δt**

Any conduit shorter than this threshold gets lengthened to meet it. This runs *before* discretization, so the lengthened conduits can then be split if they exceed the maximum target length.

This is the same concept as SWMM's built-in `LENGTHENING_STEP` option, but ReSWMM gives you visibility into exactly which conduits were modified and by how much (Rossman, 2015).

---

## CFL Analysis: Know Before You Discretize

Before you change anything, ReSWMM computes a CFL analysis for every conduit in your model:

- **Standard CFL timestep**: Δx / √(g × D)
- **Conservative CFL timestep**: 10% of the standard value (safety factor)

This gives you a clear picture of which conduits are constraining your model's timestep and which ones might benefit from discretization. You can see at a glance whether your 1-second routing timestep is appropriate for your network.

---

## Side-by-Side Simulation Comparison

ReSWMM doesn't just modify your model — it lets you run both the original and discretized versions through EPA SWMM 5.2.4 and compare results side by side:

- Continuity errors (runoff and routing)
- Number of flooded nodes
- Total precipitation, runoff, inflow, and outflow volumes
- Flooding loss volumes
- Processing time

This is where the value becomes tangible. A well-discretized model typically shows reduced routing continuity errors — sometimes by 50% or more — without meaningfully changing the hydrology results (James et al., 2010).

---

## When Should You Use It?

Discretization isn't always necessary. For simple models using kinematic wave routing, conduit length matters far less. But if you're using **dynamic wave routing** — and most urban drainage models do — here are the scenarios where ReSWMM adds clear value:

1. **Models with long trunk sewers** (500+ feet between manholes) that may under-resolve flow attenuation
2. **Models with mixed pipe lengths** where a few short conduits force unnecessarily small timesteps
3. **Models showing routing continuity errors above 1%** that resist timestep adjustments
4. **Calibration studies** where you need confidence that numerical artifacts aren't masking real hydraulic behavior
5. **Design scenarios** comparing pre- and post-development conditions, where numerical accuracy directly affects sizing decisions

---

## What It Doesn't Do

ReSWMM is deliberately focused. It does not:

- Modify subcatchment parameters, rain data, or boundary conditions
- Change the routing method or solver settings (other than optional LENGTHENING_STEP)
- Alter pipe diameters, roughness values, or cross-section shapes
- Add or remove any hydraulic structures (weirs, orifices, pumps)

Your model stays your model. ReSWMM just refines the spatial resolution of the conduit network.

---

## The Bigger Picture

Computational hydraulics has always involved trade-offs between spatial resolution, temporal resolution, and computational cost. The CFL condition isn't a suggestion — it's a mathematical requirement for stable numerical solutions to hyperbolic partial differential equations (Courant et al., 1928).

EPA SWMM handles this internally with automatic timestep reduction, but there are limits to how much the solver can compensate for poor spatial discretization. As Rossman (2015) notes in the SWMM Reference Manual, "the accuracy of the dynamic wave solution can be improved by subdividing long conduits into shorter segments."

ReSWMM takes that guidance and makes it practical — one click instead of hours of manual editing.

---

## Try It

ReSWMM is integrated into BatchSWMM, a free web-based tool for batch processing SWMM models. Upload your `.inp` file, configure your discretization parameters, preview the network changes on an interactive map, and download the modified file — or run both versions through SWMM and compare results on the spot.

If you've ever spent an afternoon manually splitting conduits and interpolating junction elevations, you'll appreciate having a tool that does it in seconds.

---

### References

Akan, A. O. (2006). *Open Channel Hydraulics*. Butterworth-Heinemann. ISBN: 978-0-7506-6857-6.

Courant, R., Friedrichs, K., & Lewy, H. (1928). Über die partiellen Differenzengleichungen der mathematischen Physik. *Mathematische Annalen*, 100(1), 32-74. https://doi.org/10.1007/BF01448839

ecotecnologias. (2019). *ReSWMM* [Computer software]. GitHub. https://github.com/ecotecnologias/ReSWMM

James, W., Rossman, L. A., & James, W. R. C. (2010). *User's Guide to SWMM 5*. CHI Press, Guelph, Ontario. ISBN: 978-0-9808853-5-4.

Pachaly, R. L., Vasconcelos, J. G., Allasia, D. G., & Tassi, R. (2019). Field Evaluation of Discretized Model Setups for the Storm Water Management Model. *Journal of Water Management Modeling*, C463. https://www.chijournal.org/C463

Pachaly, R. L., Vasconcelos, J. G., Allasia, D. G., Tassi, R., & Bocchi, J. P. P. (2020). Comparing SWMM 5.1 Calculation Alternatives to Represent Unsteady Stormwater Sewer Flows. *Journal of Hydraulic Engineering*, 146(7). https://doi.org/10.1061/(ASCE)HY.1943-7900.0001762

Pachaly, R. L., Vasconcelos, J. G., & Allasia, D. G. (2021). Surge predictions in a large stormwater tunnel system using SWMM. *Urban Water Journal*, 18(8), 577-586. https://doi.org/10.1080/1573062X.2021.1916828

Rossman, L. A. (2015). *Storm Water Management Model Reference Manual Volume I — Hydrology (Revised)*. EPA/600/R-15/162A. U.S. Environmental Protection Agency, Cincinnati, OH.

Rossman, L. A. (2017). *Storm Water Management Model Reference Manual Volume II — Hydraulics*. EPA/600/R-17/111. U.S. Environmental Protection Agency, Cincinnati, OH.

U.S. EPA. (2024). *Storm Water Management Model (SWMM) Version 5.2.4*. U.S. Environmental Protection Agency, Office of Research and Development. https://www.epa.gov/water-research/storm-water-management-model-swmm

Vasconcelos, J. G., Wright, S. J., & Roe, P. L. (2018). Evaluating Storm Water Management Model Accuracy in Conditions of Mixed Flows. *Journal of Water Management Modeling*, C451. https://www.chijournal.org/C451

---

*What's your experience with conduit discretization in SWMM models? Have you seen continuity errors improve after refining the spatial resolution? I'd love to hear from other practitioners.*

#StormwaterEngineering #SWMM #HydraulicModeling #WaterResources #UrbanDrainage #CivilEngineering #ComputationalHydraulics #EPA
