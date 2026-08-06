# Batch Processing EPA SWMM Models: How BatchSWMM Turns Hours of Manual Work Into Minutes

*If you've ever run the same SWMM model 20 times with different parameters, you know the pain. There's a better way.*

---

Stormwater modeling with EPA SWMM is powerful. It's also repetitive. You build a model, run it, check the report, tweak something, run it again. Multiply that by a dozen design storms or a portfolio of project sites, and suddenly you're spending more time babysitting simulations than doing engineering.

**BatchSWMM** was built to solve that problem. It's a web-based tool that lets you upload multiple SWMM5 `.inp` files, run them all through EPA SWMM 5.2.4 simultaneously, and get back a unified dashboard of results — complete with interactive charts, downloadable reports, and side-by-side comparisons.

Here's what it does and why it matters for practicing stormwater engineers.

---

## The Core Problem: One Model at a Time

EPA SWMM's desktop interface is designed for working with one model at a time. You open a file, run it, review the status report, maybe export some results, then close it and open the next one. For a single model, that's fine.

But real engineering workflows often involve:

- **Multiple design storm events** (2-year, 10-year, 25-year, 100-year) applied to the same network
- **Sensitivity analyses** varying Manning's n, imperviousness, or subcatchment width across multiple runs
- **Portfolio assessments** where dozens of separate project sites need to be modeled and compared
- **Pre/post development comparisons** requiring paired simulations for every scenario
- **QA/QC reviews** where you need to re-run an entire project's worth of models to verify results

The EPA SWMM GUI doesn't support batch processing. You can script it with command-line calls, but then you lose visualization, comparison tools, and structured reporting (Rossman, 2015). BatchSWMM fills that gap.

---

## How It Works

The workflow is straightforward:

### 1. Upload Your Models
Drag and drop one or more `.inp` files — or select an entire directory. BatchSWMM accepts any valid EPA SWMM 5.2 input file. There's no reformatting, no conversion, no proprietary format. Your `.inp` files go in, and your `.inp` files come back out.

### 2. Run All Simulations
BatchSWMM runs every uploaded file through the EPA SWMM 5.2.4 computational engine. This is the same engine the EPA distributes — not a reimplementation or approximation. The solver, the equations, the numerical methods are identical to what you'd get running `swmm5.exe` on your desktop (U.S. EPA, 2024).

### 3. Real-Time Progress
Each simulation reports progress back to your browser via WebSocket as it runs. You see which file is currently processing, the completion percentage, and elapsed time — no staring at a frozen progress bar wondering if something crashed.

### 4. Unified Results Dashboard
When simulations complete, all results appear in a single interactive dashboard. Every `.rpt` status report is parsed automatically, and key metrics are extracted into structured tables and charts.

---

## What You Get Back: The Results Dashboard

This is where BatchSWMM earns its keep. Instead of opening 20 separate `.rpt` files in a text editor and manually comparing numbers, you get:

### Parsed Metrics at a Glance
For every simulation, BatchSWMM extracts and displays:

- **Continuity errors** (runoff and routing) — color-coded green/yellow/red based on severity thresholds
- **Total precipitation, infiltration, and runoff volumes**
- **Surface runoff and total inflow/outflow**
- **Number of flooded nodes and total flooding volume**
- **Flow routing method and infiltration method used**
- **Simulation elapsed time**

These metrics come directly from the EPA SWMM status report, following the output format documented in the SWMM 5.2 User's Manual (Rossman & Simon, 2022).

### Interactive Charts
BatchSWMM generates interactive visualizations using the Recharts library, including:

- **Continuity error comparisons** across all runs — immediately spot which models have stability issues
- **Flooding summary charts** showing which models produced the most flooding and where
- **Volume balance charts** comparing precipitation, runoff, inflow, and outflow across scenarios
- **RPT histograms** with statistical overlays (n, min, max, mean, median, standard deviation) for any numeric column extracted from the status reports

### Time Series from Binary Output Files
EPA SWMM writes detailed time series results to a binary `.out` file. BatchSWMM includes a binary parser that reads this file directly, extracting:

- **Subcatchment results**: rainfall, snow depth, evaporation/infiltration losses, runoff, groundwater flow, groundwater elevation, soil moisture, and pollutant washoff
- **Node results**: depth, head, volume, lateral inflow, total inflow, and flooding
- **Link results**: flow, depth, velocity, volume, and capacity utilization
- **System results**: air temperature, rainfall, snow depth, infiltration/inflow losses, runoff, direct inflow, total inflow, flooding, outflow, storage volume, and evaporation

The binary format is documented in the SWMM 5.2 Interfacing Guide (Rossman, 2015), and BatchSWMM parses it byte-by-byte to produce interactive time series charts for any variable at any element in the network. You can overlay multiple variables, zoom into specific time windows, and export the data.

---

## The Folder View: Inspecting Models Before You Run Them

Before running a batch, it helps to understand what you're working with. BatchSWMM's Folder View lets you browse `.inp` files and see:

- **Network topology maps** rendered as SVG — nodes, conduits, subcatchment boundaries, all drawn from the `[COORDINATES]` and `[POLYGONS]` sections of the `.inp` file
- **Section-by-section breakdowns** of the input file: subcatchments, junctions, conduits, cross-sections, rain gages, options, and more
- **Conduit statistics**: length distribution, diameter ranges, slope analysis
- **Quick metrics**: total number of subcatchments, nodes, conduits, outfalls, and storage units

This is the kind of pre-processing review that catches problems before you burn compute time on a flawed model.

---

## ReSWMM: Built-In Conduit Discretization

BatchSWMM includes **ReSWMM**, a conduit discretization engine that addresses one of the most common sources of numerical error in dynamic wave models: insufficient spatial resolution in the conduit network.

The physics are well-established. The Courant-Friedrichs-Lewy (CFL) condition requires that the simulation timestep be small enough relative to conduit length and wave celerity to maintain numerical stability (Courant et al., 1928). Vasconcelos et al. (2018) demonstrated that SWMM's lack of intra-conduit spatial discretization causes significant accuracy problems during rapid filling and mixed-flow conditions. Pachaly et al. (2020) further confirmed that combining Artificial Spatial Discretization with appropriate timesteps reduces continuity errors and numerical instabilities, with field validation against real stormwater systems (Pachaly et al., 2019).

The concept builds on the original **ReSWMM** tool (https://github.com/ecotecnologias/ReSWMM), which implemented these discretization methods as a standalone application. BatchSWMM's engine extends the same principles with an integrated workflow:

- Splitting long conduits into shorter segments with interpolated intermediate junctions
- Lengthening short conduits that would violate CFL stability for a given timestep
- Computing CFL-stable timesteps for every conduit in the network
- Running side-by-side simulations of the original and discretized models to quantify improvement

The SWMM Reference Manual explicitly recommends this approach: "the accuracy of the dynamic wave solution can be improved by subdividing long conduits into shorter segments" (Rossman, 2017).

---

## AI Report Builder

For engineers who need to produce deliverable reports — not just look at dashboards — BatchSWMM includes an AI-powered report generator. It takes your full simulation data (both the `.rpt` status report and the `.inp` input file) and generates custom HTML reports based on natural language prompts.

Over 50 pre-built report templates cover:

- **System performance**: mass balance, model health checks, rainfall-runoff summaries
- **Node analysis**: flooding reports, depth exceedance, surcharging duration, freeboard analysis
- **Conduit analysis**: capacity utilization, velocity checks, d/D ratios, flow reversal detection
- **Subcatchment reports**: runoff summaries, imperviousness audits, LID performance
- **Hydraulic design**: HGL profiles, pump station performance, storage unit analysis
- **QA/QC**: input data audits, connectivity checks, Manning's n summaries
- **Regulatory compliance**: design storm assessment, CSO activation reports

You can also write your own prompts for custom analyses. The reports are downloadable as standalone HTML files.

---

## Report Export Formats

Beyond the AI builder, BatchSWMM generates structured reports in three formats:

- **HTML**: Styled, self-contained reports with tables, charts, and color-coded metrics. Ready to attach to a project deliverable or email to a client.
- **Markdown**: Plain-text reports with ASCII bar charts for continuity errors, flooding, peak flow, and precipitation vs. runoff. Includes all RPT summary tables. Useful for version control or documentation systems.
- **CSV**: Raw tabular data for every parsed metric across all runs. Import directly into Excel, R, Python, or any data analysis tool.

---

## What BatchSWMM Doesn't Do

It's worth being clear about scope:

- **It does not replace EPA SWMM's model-building GUI.** You still build and edit your models in SWMM's interface (or any compatible editor). BatchSWMM processes finished `.inp` files.
- **It does not modify your models** (unless you explicitly use ReSWMM for discretization). Your input files are passed to the SWMM engine exactly as uploaded.
- **It is not a calibration tool.** It doesn't auto-tune parameters or compare to observed data (though the AI report builder can generate calibration comparison reports if you provide the context).
- **It runs the real EPA SWMM engine.** Results are identical to what you'd get running `swmm5` from the command line. There's no proprietary solver, no approximations.

---

## Why This Matters for Practice

The stormwater industry has a throughput problem. Municipal stormwater master plans can involve hundreds of models. Development review requires running the same network under multiple storm events. Climate adaptation studies need to evaluate rainfall uplift scenarios across entire portfolios.

EPA SWMM is the industry standard for good reason — it's free, well-documented, peer-reviewed, and trusted by regulators worldwide (James et al., 2010). But its single-model workflow creates a bottleneck that pushes engineers toward either expensive commercial wrappers or fragile custom scripts.

BatchSWMM aims to bridge that gap: keep the EPA SWMM engine, add batch processing and modern visualization, and make the results accessible without specialized scripting knowledge.

---

## The Technical Stack (For the Curious)

For those interested in the implementation:

- **Frontend**: React with TypeScript, Vite build system, Recharts for visualization, Tailwind CSS for styling
- **Backend**: Express.js (Node.js), WebSocket for real-time progress, Multer for file handling
- **SWMM Engine**: Compiled EPA SWMM 5.2.4 binary (Linux), spawned as a child process per simulation
- **Binary Parser**: Custom TypeScript implementation reading the SWMM `.out` format byte-by-byte per the Interfacing Guide specification
- **INP Parser**: Full parser for EPA SWMM's `.inp` text format covering all major sections (subcatchments, junctions, conduits, cross-sections, rain gages, options, coordinates, polygons, losses, storage, outfalls, and more)

Everything runs in the browser and on the server — no desktop installation, no plugins, no Java runtime.

---

## Getting Started

Upload a `.inp` file and run it. That's it. No account creation, no configuration, no dependencies to install. If you have a working SWMM model, BatchSWMM can process it.

For engineers managing multiple models or running comparative analyses, the time savings compound quickly. What used to be an afternoon of manual work — running models, opening reports, copying numbers into spreadsheets — becomes a few minutes of uploading files and reviewing a dashboard.

Your models. Your engine. Just faster.

---

### References

Courant, R., Friedrichs, K., & Lewy, H. (1928). Über die partiellen Differenzengleichungen der mathematischen Physik. *Mathematische Annalen*, 100(1), 32-74. https://doi.org/10.1007/BF01448839

ecotecnologias. (2019). *ReSWMM* [Computer software]. GitHub. https://github.com/ecotecnologias/ReSWMM

James, W., Rossman, L. A., & James, W. R. C. (2010). *User's Guide to SWMM 5*. CHI Press, Guelph, Ontario. ISBN: 978-0-9808853-5-4.

Pachaly, R. L., Vasconcelos, J. G., Allasia, D. G., & Tassi, R. (2019). Field Evaluation of Discretized Model Setups for the Storm Water Management Model. *Journal of Water Management Modeling*, C463. https://www.chijournal.org/C463

Pachaly, R. L., Vasconcelos, J. G., Allasia, D. G., Tassi, R., & Bocchi, J. P. P. (2020). Comparing SWMM 5.1 Calculation Alternatives to Represent Unsteady Stormwater Sewer Flows. *Journal of Hydraulic Engineering*, 146(7). https://doi.org/10.1061/(ASCE)HY.1943-7900.0001762

Rossman, L. A. (2015). *Storm Water Management Model Reference Manual Volume I — Hydrology (Revised)*. EPA/600/R-15/162A. U.S. Environmental Protection Agency, Cincinnati, OH.

Rossman, L. A. (2017). *Storm Water Management Model Reference Manual Volume II — Hydraulics*. EPA/600/R-17/111. U.S. Environmental Protection Agency, Cincinnati, OH.

Rossman, L. A., & Simon, M. A. (2022). *Storm Water Management Model User's Manual Version 5.2*. EPA/600/R-22/030. U.S. Environmental Protection Agency, Cincinnati, OH.

U.S. EPA. (2024). *Storm Water Management Model (SWMM) Version 5.2.4*. U.S. Environmental Protection Agency, Office of Research and Development. https://www.epa.gov/water-research/storm-water-management-model-swmm

Vasconcelos, J. G., Wright, S. J., & Roe, P. L. (2018). Evaluating Storm Water Management Model Accuracy in Conditions of Mixed Flows. *Journal of Water Management Modeling*, C451. https://www.chijournal.org/C451

---

*How are you handling batch SWMM runs in your practice? Command-line scripts, commercial tools, or one-at-a-time? I'd be interested to hear what's working (and what isn't) for other stormwater teams.*

#StormwaterEngineering #SWMM #EPA #HydraulicModeling #WaterResources #UrbanDrainage #CivilEngineering #BatchProcessing #StormwaterManagement
