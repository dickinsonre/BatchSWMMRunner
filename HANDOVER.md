# BatchSWMM Handover Document

**Last Updated:** March 8, 2026
**Version:** 2.x (Active Development)
**Platform:** Replit (NixOS Linux container)

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Summary](#2-architecture-summary)
3. [Directory Structure](#3-directory-structure)
4. [Data Models and Type System](#4-data-models-and-type-system)
5. [Backend (Express Server)](#5-backend-express-server)
6. [Frontend (React / Vite)](#6-frontend-react--vite)
7. [SWMM Engine Integration](#7-swmm-engine-integration)
8. [WebSocket Real-Time System](#8-websocket-real-time-system)
9. [ReSWMM Discretization Engine](#9-reswmm-discretization-engine)
10. [INP File Parser](#10-inp-file-parser)
11. [Results, Charting, and Reports](#11-results-charting-and-reports)
12. [Theming and Color System](#12-theming-and-color-system)
13. [Pages and Navigation](#13-pages-and-navigation)
14. [API Reference](#14-api-reference)
15. [File Size Reference](#15-file-size-reference)
16. [Known Quirks and Gotchas](#16-known-quirks-and-gotchas)
17. [Planned Features (Not Yet Implemented)](#17-planned-features-not-yet-implemented)
18. [Build and Deployment](#18-build-and-deployment)
19. [Dependencies](#19-dependencies)

---

## 1. Project Overview

BatchSWMM is a full-stack TypeScript desktop application for batch processing EPA SWMM (Storm Water Management Model) `.inp` files. It runs real SWMM 5.2.4 simulations using a compiled Linux binary, provides real-time progress via WebSocket, and includes advanced engineering tools for conduit discretization (ReSWMM).

**Core capabilities:**
- Upload and batch-process multiple `.inp` files through EPA SWMM 5.2.4
- Real-time simulation progress via WebSocket with per-file tracking
- Interactive results dashboard with charts, tables, and report export
- Folder View for browsing/inspecting individual `.inp` files with SVG network maps
- ReSWMM tool for conduit discretization (splitting long pipes, lengthening short ones) with CFL analysis
- Side-by-side comparison of original vs. discretized model simulation results
- Multiple university-branded color themes (Auburn, Autodesk, UF, OSU) with dark mode
- Downloadable reports in HTML, Markdown, and CSV formats

---

## 2. Architecture Summary

```
+-------------------------------------------------------------+
|  Browser (React + Vite)                                     |
|  +----------+ +----------+ +----------+ +---------------+  |
|  |  Home    | | Folder   | | ReSWMM   | |  Dashboard    |  |
|  | (Batch)  | |  View    | |  Page    | |  + Docs       |  |
|  +----+-----+ +----+-----+ +----+-----+ +---------------+  |
|       |             |            |                           |
|  +----v-------------v------------v----------------------+   |
|  |  WebSocket Client  |  HTTP (fetch/TanStack Query)    |   |
|  +----+---------------+------------------------+-------+   |
+-------|-----------------------------------------|----------+
        | ws://host/api/ws?jobId=X                | REST /api/*
+-------|-----------------------------------------|----------+
|  Express Server (Node.js)                       |           |
|  +----v-----------------------------------------v-------+   |
|  |  routes.ts                                           |   |
|  |  +-------------+  +--------------+  +------------+  |   |
|  |  | WebSocket   |  | Multer       |  | REST       |  |   |
|  |  | Server      |  | Upload       |  | Endpoints  |  |   |
|  |  +------+------+  +------+-------+  +------------+  |   |
|  |         |                |                           |   |
|  |  +------v----------------v-----------------------+   |   |
|  |  |  processSingleFile()                          |   |   |
|  |  |  +-----------------+  +--------------------+  |   |   |
|  |  |  | child_process   |  | parseReportMetrics |  |   |   |
|  |  |  | spawn(runswmm)  |  | (.rpt parser)      |  |   |   |
|  |  |  +--------+--------+  +--------------------+  |   |   |
|  |  +-----------+---------- ------------------------+   |   |
|  +--------------+-----------------------------------+   |   |
|                 |                                       |   |
|  +--------------v------------------------------------+  |   |
|  |  swmm-engine/runswmm  (EPA SWMM 5.2.4 ELF binary)|  |   |
|  +---------------------------------------------------+  |   |
|                                                          |   |
|  +---------------------------------------------------+  |   |
|  |  storage.ts  (In-memory MemStorage)               |  |   |
|  |  Map<string, BatchJob>                            |  |   |
|  +---------------------------------------------------+  |   |
+----------------------------------------------------------+
```

**Tech Stack:**
- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, Shadcn/ui, Recharts, Wouter
- **Backend:** Express.js, TypeScript, Multer, ws (WebSocket)
- **Engine:** EPA SWMM 5.2.4 compiled from C source into `swmm-engine/runswmm` (511KB ELF binary)
- **Validation:** Zod for shared type contracts between frontend and backend
- **State:** TanStack Query v5 for server state, React hooks for local state, in-memory module store (`resultsStore.ts`) for cross-page data passing

---

## 3. Directory Structure

```
/
├── client/
│   ├── index.html                          # Vite entry HTML
│   ├── public/
│   │   └── favicon.png
│   └── src/
│       ├── main.tsx                        # React entry point
│       ├── App.tsx                         # Router + providers
│       ├── index.css                       # Theme variables + Tailwind
│       ├── pages/
│       │   ├── Home.tsx                    # Batch processing (533 lines)
│       │   ├── FolderView.tsx              # File browser + network map (930 lines)
│       │   ├── ReswmmPage.tsx              # Discretization tool (1323 lines)
│       │   ├── Dashboard.tsx               # Results dashboard (394 lines)
│       │   ├── Documentation.tsx           # Technical docs (684 lines)
│       │   └── not-found.tsx               # 404 page (21 lines)
│       ├── components/
│       │   ├── AppHeader.tsx               # Shared navigation header (109 lines)
│       │   ├── ResultsDisplay.tsx          # SWMM results viewer (659 lines)
│       │   ├── InteractiveCharts.tsx       # Time series charts (492 lines)
│       │   ├── ThemeToggle.tsx             # Theme + dark mode selector
│       │   ├── SimulationSettings.tsx      # Batch settings panel
│       │   ├── ProcessingLog.tsx           # Real-time log viewer
│       │   ├── InstructionsPanel.tsx       # How-to guide
│       │   ├── NetworkMap.tsx              # SVG network visualization
│       │   └── ui/                         # Shadcn primitives (40+ components)
│       ├── lib/
│       │   ├── inpParser.ts               # .inp file parser (427 lines)
│       │   ├── reswmmEngine.ts            # Discretization engine (444 lines)
│       │   ├── reportGenerator.ts         # HTML/MD/CSV report export (360 lines)
│       │   ├── resultsStore.ts            # Cross-page results store (17 lines)
│       │   ├── queryClient.ts             # TanStack Query setup (57 lines)
│       │   └── utils.ts                   # Tailwind merge helper (6 lines)
│       └── hooks/
│           ├── use-toast.ts
│           └── use-mobile.tsx
├── server/
│   ├── index.ts                           # Express entry point
│   ├── routes.ts                          # All API + WebSocket logic (853 lines)
│   ├── storage.ts                         # In-memory storage (44 lines)
│   └── vite.ts                            # Vite dev middleware
├── shared/
│   └── schema.ts                          # Zod schemas + TS types (95 lines)
├── swmm-engine/
│   └── runswmm                            # Compiled EPA SWMM 5.2.4 binary (511KB)
├── public/samples/
│   ├── user1.inp ... user5.inp            # 5 bundled sample models
├── uploads/                               # Runtime upload directory (gitignored)
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.ts
├── drizzle.config.ts
├── design_guidelines.md
├── replit.md
└── HANDOVER.md                            # This file
```

---

## 4. Data Models and Type System

All types are defined in `shared/schema.ts` using Zod schemas with inferred TypeScript types, ensuring runtime validation and compile-time safety across the full stack.

### ParsedMetrics
Extracted from a SWMM `.rpt` report file via regex parsing on the server.

| Field | Type | Description |
|-------|------|-------------|
| `runoffContinuityError` | `number?` | Runoff quantity continuity error (%) |
| `routingContinuityError` | `number?` | Flow routing continuity error (%) |
| `totalPrecipitation` | `number?` | Total precipitation (ac-ft) |
| `surfaceRunoff` | `number?` | Surface runoff volume (ac-ft) |
| `nodesFlooded` | `number?` | Count of flooded nodes |
| `floodingSummary` | `string?` | Human-readable flooding description |
| `flowRoutingMethod` | `string?` | e.g., DYNWAVE, KINWAVE, STEADY |
| `infiltrationMethod` | `string?` | e.g., HORTON, GREEN_AMPT, CURVE_NUMBER |
| `totalInflow` | `number?` | Wet weather inflow volume |
| `totalOutflow` | `number?` | External outflow volume |
| `floodingLoss` | `number?` | Volume lost to flooding |

### ProcessResult
Represents the outcome of running SWMM on a single `.inp` file.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | UUID |
| `fileName` | `string` | Original filename |
| `filePath` | `string` | Server-side file path |
| `status` | `'success' \| 'failed'` | Run outcome |
| `error` | `string?` | Error message if failed |
| `processingTime` | `number?` | Seconds to complete |
| `reportContent` | `string?` | Full raw `.rpt` file text |
| `inpContent` | `string?` | Full raw `.inp` file text |
| `results.peakFlow` | `number?` | Peak flow (CFS) |
| `results.totalVolume` | `number?` | Total volume (MG) |
| `parsedMetrics` | `ParsedMetrics?` | Structured report data |

### BatchJob
Tracks a batch processing session.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | UUID |
| `files` | `{id, name, path}[]` | List of uploaded files |
| `status` | `'idle' \| 'processing' \| 'completed' \| 'cancelled'` | Job state |
| `currentFile` | `number` | Index of file being processed |
| `results` | `ProcessResult[]` | Accumulated results |

### SwmmStatus
SWMM engine detection result.

| Field | Type | Description |
|-------|------|-------------|
| `found` | `boolean` | Whether the binary was found |
| `path` | `string?` | Absolute path to binary |
| `mode` | `'live' \| 'simulation'` | Execution mode |
| `searchedPaths` | `string[]?` | All paths checked |

### Additional Types
- **SweepConfig**: `{ parameterName, values[] }` for parameter sweep mode (schema defined, not yet implemented)
- **DesignStormEntry / DesignStormConfig**: Storm event definitions with SCS rainfall distributions (schema defined, not yet implemented)
- **SweepResult**: Extends `ProcessResult` with `parameterValue` and `stormLabel` (schema defined, not yet implemented)

---

## 5. Backend (Express Server)

### Entry Point: `server/index.ts`
Bootstraps Express, registers routes, attaches Vite dev middleware (development) or static file serving (production), and starts listening on port 5000.

### Routes: `server/routes.ts` (853 lines)
This is the single largest backend file, containing all HTTP endpoints, WebSocket server, SWMM engine detection, file processing logic, and report parsing.

**Key functions:**

| Function | Lines | Purpose |
|----------|-------|---------|
| `detectSwmmPath()` | 35-69 | Scans known paths, env vars, and PATH for SWMM binary |
| `parseReportMetrics()` | 71-129 | Regex extraction of 11 metrics from raw `.rpt` text |
| `registerRoutes()` | 133-853 | Main function: sets up WebSocket server, all HTTP routes, and processing pipeline |
| `sendProgressUpdate()` | 165-183 | Dispatches WebSocket messages to connected clients or buffers them |
| `processFilesSequentially()` | 312-355 | Iterates through batch files, calls `processSingleFile()` for each |
| `generateSimulatedReport()` | 401-615 | Generates realistic mock `.rpt` content when no SWMM binary is available |
| `injectReportOptions()` | 617-651 | Modifies `.inp` to force `INPUT YES`, `SUBCATCHMENTS ALL`, `NODES ALL`, `LINKS ALL` |
| `processSingleFile()` | 653-850 | Core: uploads file, spawns SWMM binary, captures stdout for progress, reads `.rpt`, parses metrics |

### Storage: `server/storage.ts` (44 lines)
In-memory storage using a `Map<string, BatchJob>`. Implements the `IStorage` interface:

```typescript
interface IStorage {
  getBatchJob(id: string): Promise<BatchJob | undefined>;
  createBatchJob(files: { id: string; name: string; path: string }[]): Promise<BatchJob>;
  updateBatchJob(id: string, updates: Partial<BatchJob>): Promise<BatchJob | undefined>;
}
```

Data is lost on server restart. The interface allows future migration to PostgreSQL (Drizzle ORM is configured but not active).

---

## 6. Frontend (React / Vite)

### Entry: `client/src/App.tsx`
- Wraps everything in `QueryClientProvider` (TanStack Query) and `TooltipProvider`
- Uses Wouter `Switch`/`Route` for client-side routing
- No sidebar layout -- uses horizontal header navigation via `AppHeader`

### Query Client: `client/src/lib/queryClient.ts`
- Configures default query behavior with `credentials: 'include'`
- Sets up a default `queryFn` that auto-fetches from the backend using the query key as the URL
- Error handling throws on non-OK responses with parsed error messages
- `apiRequest()` helper for mutations (POST/PATCH/DELETE)

### Component Library
Uses Shadcn/ui (New York variant) with 40+ pre-built components in `client/src/components/ui/`. Key ones used extensively:
- `Card`, `Button`, `Badge`, `Tabs`, `Select`, `ScrollArea`, `Separator`, `Tooltip`
- `DropdownMenu` (theme toggle, report format picker)
- `Progress` (simulation progress bars)
- `Slider`, `Input`, `Label` (ReSWMM configuration)

---

## 7. SWMM Engine Integration

### Binary
- **Location:** `swmm-engine/runswmm`
- **Size:** 511 KB ELF executable
- **Source:** Compiled from EPA SWMM 5.2.4 C source code (from EPA GitHub)
- **Platform:** Linux x86_64 (runs natively in Replit's NixOS container)

### Detection
`detectSwmmPath()` searches for the binary in this order:
1. `RUNSWMM_PATH` environment variable
2. `./swmm-engine/runswmm` (project-local)
3. Common Windows install paths (for portability)
4. Common Linux paths (`/usr/local/bin`, `/usr/bin`)
5. `which runswmm` / `which swmm5` via shell

If not found, the app falls back to **Simulation Mode** which generates realistic mock reports.

### Execution
```
spawn(swmmPath, [inputPath, reportPath, outputPath])
```
- `inputPath`: The uploaded `.inp` file (hashed name, no extension -- see Gotchas)
- `reportPath`: `inputPath + '.rpt'` (NOT `.replace('.inp', '.rpt')`)
- `outputPath`: `inputPath + '.out'`

**Progress capture:** The SWMM binary writes progress percentages to stdout (e.g., `" ... 10%"`). The server parses these with a regex `/(\d+)%/` and streams them to the client as `file_progress` WebSocket messages.

### Report Injection
Before running, `injectReportOptions()` modifies the `.inp` file to ensure the report contains all data:
```
[REPORT]
INPUT       YES
SUBCATCHMENTS ALL
NODES       ALL
LINKS       ALL
```
This ensures time series data is available for charting.

---

## 8. WebSocket Real-Time System

### Connection
- Server: `new WebSocketServer({ server: httpServer, path: '/api/ws' })`
- Client: `new WebSocket('ws[s]://host/api/ws?jobId=${jobId}')`
- One WebSocket connection per job ID
- Connections tracked in `Map<string, WebSocket>`

### Message Types (Server to Client)

| Type | Fields | Purpose |
|------|--------|---------|
| `progress` | `current`, `total`, `fileName`, `status` | Overall batch progress |
| `file_progress` | `fileName`, `percent` | Per-file SWMM progress (0-100%) |
| `log` | `message`, `fileName`, `stream` | stdout/stderr from SWMM process |
| `result` | Full `ProcessResult` object | Completed file result |
| `completed` | `results[]` | Batch finished, all results |
| `error` | `message` | Fatal error |
| `cancelled` | (none) | Job was cancelled |

### Message Buffering
If `sendProgressUpdate()` is called before a client is connected (race condition during job start), messages are buffered in `Map<string, object[]>`. When the client connects, buffered messages are flushed immediately with a 500ms startup delay before processing begins.

### Client-Side Lifecycle
- WebSocket is opened in a `useEffect` with the `jobId` as dependency
- `useEffect` cleanup function closes the WebSocket on unmount or `jobId` change
- A `completed` message without a preceding `result` triggers a fallback "failed" result to prevent UI deadlock
- Error states reset `runState` back to `'idle'`

---

## 9. ReSWMM Discretization Engine

**File:** `client/src/lib/reswmmEngine.ts` (444 lines)

The ReSWMM engine modifies SWMM conduit networks to improve numerical stability by:
1. **Lengthening** short conduits that would require excessively small time steps
2. **Discretizing** long conduits into multiple shorter segments

### Configuration Interface

```typescript
interface ReswmmConfig {
  method: 'fixed_interval' | 'dx_d_ratio';
  fixedMinLength: number;        // Min segment length (ft)
  fixedMaxLength: number;        // Max segment length (ft)
  dxDRatio: number;              // dx/D ratio (unitless)
  lengtheningEnabled: boolean;
  lengtheningStep: number;       // Time step for lengthening (seconds)
  mnsa: number;                  // Minimum Node Surface Area (ft^2)
  gravity: number;               // 32.174 ft/s^2 or 9.81 m/s^2
}
```

### Discretization Methods

**Fixed Interval:**
- Target length = `clamp(conduitLength, fixedMinLength, fixedMaxLength)`
- Number of segments = `ceil(conduitLength / targetLength)`
- Actual segment length = `conduitLength / nSegments` (ensures exact total)

**dx/D Ratio:**
- Target length = `diameter * dxDRatio`
- Same segment calculation as fixed interval

### Lengthening Logic
Prevents CFL-violating short pipes:
```
celerity = sqrt(gravity * diameter)
minLength = celerity * lengtheningStep
if (conduit.length < minLength) then conduit.length = minLength
```

### Node Interpolation
When splitting a conduit into N segments, N-1 intermediate junctions are created:
- **Name:** `{conduitName}_n{index}` (e.g., `C1_n1`, `C1_n2`)
- **Elevation:** Linear interpolation between upstream and downstream nodes
- **Coordinates:** Linear interpolation of X, Y for map display
- **Max Depth:** Inherited from upstream node
- **Aponded:** Set to `config.mnsa` (Minimum Node Surface Area)

### Property Distribution
- **Offsets:** `inOffset` on first segment only, `outOffset` on last segment only
- **Entry Loss:** Applied to first segment only
- **Exit Loss:** Applied to last segment only
- **Average Loss:** Divided by N (`loss.average / nSegments`)
- **Roughness:** Identical across all segments
- **Cross-section:** Identical across all segments

### CFL Analysis
`computeCflAnalysis()` calculates stable time steps for every conduit:
```
celerity = sqrt(g * diameter)
standardDt = length / celerity
conservativeDt = standardDt * 0.10
```
Returns per-conduit analysis with flags for conduits below threshold.

### INP File Rebuild
`rebuildInpFile()` creates new `.inp` content:
1. Identifies line ranges of all sections in the original file
2. Replaces `[JUNCTIONS]`, `[CONDUITS]`, `[XSECTIONS]`, `[LOSSES]`, `[COORDINATES]` with new data
3. Injects discretization parameters comment into `[TITLE]`
4. Updates/inserts `LENGTHENING_STEP` in `[OPTIONS]`
5. Preserves all other sections verbatim (e.g., `[SUBCATCHMENTS]`, `[RAINGAGES]`, `[TIMESERIES]`)
6. Uses `.padEnd()` formatting for SWMM-compatible column alignment

---

## 10. INP File Parser

**File:** `client/src/lib/inpParser.ts` (427 lines)

Client-side parser that converts raw SWMM `.inp` text into a structured TypeScript object. Runs entirely in the browser -- no server round-trip needed.

### Parsed Sections

| Section | Interface | Key Fields |
|---------|-----------|------------|
| `[JUNCTIONS]` | `JunctionData` | name, elevation, maxDepth, initDepth, surDepth, aponded |
| `[OUTFALLS]` | `OutfallData` | name, elevation, type, gated |
| `[STORAGE]` | `StorageData` | name, elevation, maxDepth, initDepth, shape, params |
| `[CONDUITS]` | `ConduitData` | name, fromNode, toNode, length, roughness, inOffset, outOffset |
| `[PUMPS]` | `PumpData` | name, fromNode, toNode, pumpCurve, status, startup, shutoff |
| `[ORIFICES]` | `OrificeData` | name, fromNode, toNode, type, offset, cd, flapGate |
| `[WEIRS]` | `WeirData` | name, fromNode, toNode, type, crestHeight, cd |
| `[XSECTIONS]` | `XSectionData` | link, shape, geom1-4, barrels |
| `[LOSSES]` | `LossData` | link, entry, exit, average, flapGate |
| `[COORDINATES]` | `CoordinateData` | name, x, y |
| `[SUBCATCHMENTS]` | `SubcatchmentData` | name, rainGage, outlet, area, imperv, width, slope |
| `[SUBAREAS]` | `SubareaData` | name, nImperv, nPerv, sImperv, sPerv, pctZero, routeTo |
| `[INFILTRATION]` | `InfiltrationData` | name, params (3 values) |
| `[Polygons]` | `PolygonData` | name, vertices[] |
| `[RAINGAGES]` | `RainGageData` | name, format, interval, scf, source, sourceParams |
| `[OPTIONS]` | `Record<string, string>` | Key-value pairs (FLOW_UNITS, ROUTING_METHOD, etc.) |

### Core Functions
- `parseInpFile(content: string)`: Main entry point, returns `ParsedInpFile`
- `splitIntoSections(content: string)`: Splits text by `[SECTION]` headers into a `Map<string, string[]>`
- `parseDataLines(lines: string[])`: Filters comments (`;` prefix), splits into token arrays
- Individual parsers: `parseJunctions()`, `parseConduits()`, `parseXSections()`, etc.

---

## 11. Results, Charting, and Reports

### ResultsDisplay Component (659 lines)
The primary results viewer used by Home, FolderView, and ReswmmPage.

**Features:**
- Summary statistics cards (total, success, failed, with continuity error badges)
- Per-file expandable details with tabbed views:
  - **INP tab:** Raw input file content
  - **RPT Text tab:** Raw report file with `LargeTextViewer` (truncation at 2000 lines, "Show All" toggle)
  - **RPT Graphs tab:** Interactive time series charts via `InteractiveCharts`
  - **RPT HTML tab:** Styled HTML rendering via `reportToHtml()` with color-coded metrics
- Download buttons: `.rpt` text file, HTML/Markdown/CSV batch reports
- "Open in Results Dashboard" button (stores results in `resultsStore`, navigates to `/dashboard`)

### InteractiveCharts Component (492 lines)
Parses time series data from SWMM `.rpt` files and renders interactive Recharts charts.

**Parsing:** Scans for `***` section delimiters followed by "Time Series" titles, extracts:
- Section title and element name (e.g., "Node J1 Results Time Series")
- Column headers and units
- Time-stamped data rows

**Visualization:**
- `LineChart` and `AreaChart` with configurable element/column selection
- `Brush` component for time range zoom
- Toggle checkboxes for individual data series
- Color palette: 8 HSL colors cycling through series

### Report Generator (360 lines)
Generates downloadable summary reports across all results in a batch.

| Function | Output | Content |
|----------|--------|---------|
| `generateHTMLReport()` | Standalone `.html` file | Summary cards, CE table with color-coded cells, flooding table, hydrology comparison, recommendations |
| `generateMarkdownReport()` | `.md` file | Same content in Markdown tables |
| `generateCSVReport()` | `.csv` file | One row per file with all metrics |
| `downloadReport()` | Browser download | Creates `Blob` + temporary download link |
| `analyzeResults()` | Internal | Computes best/worst/average CE, identifies flooded models, generates recommendations |

**Continuity error thresholds (used throughout the app):**
- Green: |CE| <= 1%
- Yellow: 1% < |CE| <= 5%
- Red: |CE| > 5%

### Results Store (17 lines)
Simple module-level store for passing results between pages without a global state manager:
```typescript
let dashboardResults: ProcessResult[] | null = null;
let dashboardElapsed: string | null = null;
export function setDashboardResults(results, elapsed) { ... }
export function getDashboardResults() { ... }
```

### SimulationComparison (ReswmmPage)
When both original and discretized models have been run through SWMM, a comparison section appears:
- **Table:** Side-by-side metrics (Status, Processing Time, Runoff CE, Routing CE, Nodes Flooded, Flooding Loss, Precipitation, Runoff, Inflow, Outflow, Routing Method, Infiltration Method) with a "Change" column showing deltas
- **Continuity Errors and Flooding chart:** Grouped bar chart (Original vs. Discretized)
- **Volume Comparison chart:** Grouped bar chart for hydrological volumes

---

## 12. Theming and Color System

### Theme Architecture
CSS custom properties defined in `client/src/index.css` are consumed by `tailwind.config.ts` and applied via Tailwind utility classes.

### Available Themes

| Theme | Primary | Accent | CSS Class |
|-------|---------|--------|-----------|
| Default | Blue (`210 95% 45%`) | Violet-blue | (none) |
| Auburn | Orange (`15 85% 48%`) | Navy | `theme-auburn` |
| Autodesk | Dark (`220 20% 15%`) | Teal | `theme-autodesk` |
| UF | Orange (`24 95% 53%`) | Blue | `theme-uf` |
| OSU | Scarlet (`0 80% 45%`) | Black | `theme-osu` |

Each theme defines variables for: `--background`, `--foreground`, `--card`, `--primary`, `--secondary`, `--accent`, `--destructive`, `--sidebar`, `--sidebar-primary`, `--sidebar-accent`, and their `-foreground` counterparts.

### Dark Mode
- Controlled by `.dark` class on `<html>` element
- Each theme has its own dark variant (e.g., `.dark.theme-auburn`)
- Toggle persisted in `localStorage` keys: `batchswmm-theme` and `batchswmm-dark-mode`

### ThemeToggle Component
Dropdown menu with:
- Theme selection (Default, Auburn, Autodesk, UF, OSU)
- Dark/Light mode toggle with Sun/Moon icons
- Updates `document.documentElement.className` dynamically

---

## 13. Pages and Navigation

### AppHeader (`client/src/components/AppHeader.tsx`)
Shared across all pages. Contains:
- **Logo/Title:** "BatchSWMM" with Droplets icon
- **Navigation Tabs:** Batch Processing (`/`), Folder View (`/folder`), ReSWMM (`/reswmm`), Docs (`/docs`)
- **SWMM Status Badge:** Fetches `/api/swmm-status`, shows "SWMM 5.2.4 Live" (green) or "Simulation Mode" (yellow) with tooltip showing binary path
- **ThemeToggle:** Theme and dark mode selector
- Active tab highlighted based on current URL via Wouter's `useLocation`

### Page Details

#### Home (`/`) -- 533 lines
Batch processing workflow:
1. Upload `.inp` files (drag-and-drop, file picker, or directory picker)
2. Optionally load bundled sample models (`/api/samples`)
3. Configure settings (Routing Method, Report Step, Parallel Processing, Stop on Error)
4. Click "Start Processing" -- files uploaded to `/api/upload` -- WebSocket connects -- `/api/batch/:jobId/start`
5. Real-time progress: overall progress bar, per-file status icons, processing log
6. Results displayed via `ResultsDisplay` component

#### Folder View (`/folder`) -- 930 lines
Individual file inspection:
1. Load files via drag-and-drop, file picker, or directory picker
2. Files parsed client-side via `parseInpFile()` -- no server upload needed for inspection
3. File list sidebar with element count badges
4. Detail panel shows:
   - Element count grid (Junctions, Conduits, Subcatchments, etc.)
   - Network options (Flow Units, Routing Method, Infiltration)
   - SVG Network Map (nodes as circles, conduits as lines, subcatchments as polygons)
   - Conduit length statistics (histogram + min/max/mean/std)
5. "Run SWMM" button: uploads to server, runs via WebSocket, shows `ResultsDisplay`
6. Compare mode: multi-select files for side-by-side metrics comparison table

#### ReSWMM (`/reswmm`) -- 1323 lines
Conduit discretization tool:
1. Upload a single `.inp` file
2. Configure: Method (Fixed Interval / dx/D Ratio), parameters, lengthening, MNSA
3. Click "Discretize" -- engine runs client-side -- shows before/after comparison:
   - Summary cards (conduits split, junctions added, total conduits, total junctions)
   - Before/After conduit length histogram (overlaid bins)
   - Detailed table of every conduit modification (original length, new segments, segment length)
   - CFL time step analysis table
4. Download modified `.inp` file
5. Run Simulations section:
   - "Run Original" -- uploads original `.inp`, runs SWMM
   - "Run Discretized" -- rebuilds modified `.inp`, uploads, runs SWMM
   - When both complete -- `SimulationComparison` component with side-by-side table and charts

#### Dashboard (`/dashboard`) -- 394 lines
Visualizes batch results (data passed via `resultsStore`):
- Status pie chart (success/failed/warning)
- Continuity errors bar chart
- Flooding bar chart
- Precipitation/Runoff bar chart
- Detailed metrics table with sortable columns

#### Documentation (`/docs`) -- 684 lines
Tabbed technical documentation:
- **SWMM Integration:** How the binary is detected, executed, and reports are parsed
- **WebSocket Protocol:** Message types and lifecycle
- **ReSWMM Engine:** Configuration parameters and discretization logic
- **ReSWMM Lengthening:** CFL math, worked example, SWMM5 C source reference (`link.c`)

---

## 14. API Reference

### HTTP Endpoints

| Method | Path | Purpose | Request | Response |
|--------|------|---------|---------|----------|
| `GET` | `/api/swmm-status` | Check SWMM engine availability | -- | `SwmmStatus` |
| `POST` | `/api/swmm-status/refresh` | Force re-detect SWMM binary | -- | `SwmmStatus` |
| `GET` | `/api/samples` | List bundled sample models | -- | `string[]` |
| `GET` | `/api/samples/:filename` | Download a sample `.inp` file | -- | File stream |
| `POST` | `/api/upload` | Upload `.inp` files | `multipart/form-data` (field: `files`) | `{ jobId, files[] }` |
| `POST` | `/api/batch/:jobId/start` | Start processing a batch job | -- | `{ message }` |
| `POST` | `/api/batch/:jobId/cancel` | Cancel a running job | -- | `{ message }` |
| `GET` | `/api/batch/:jobId` | Get current job status | -- | `BatchJob` |

### WebSocket

| Direction | Path | Auth |
|-----------|------|------|
| Client to Server | `ws[s]://host/api/ws?jobId=X` | Job ID as implicit auth |
| Server to Client | See Message Types in Section 8 | -- |

---

## 15. File Size Reference

| File | Lines | Purpose |
|------|-------|---------|
| `ReswmmPage.tsx` | 1,323 | Largest frontend file -- discretization + simulation comparison |
| `FolderView.tsx` | 930 | File browser with network map |
| `routes.ts` | 853 | All backend logic |
| `Documentation.tsx` | 684 | Technical docs |
| `ResultsDisplay.tsx` | 659 | Results viewer |
| `Home.tsx` | 533 | Batch processing page |
| `InteractiveCharts.tsx` | 492 | Time series charts |
| `reswmmEngine.ts` | 444 | Discretization engine |
| `inpParser.ts` | 427 | INP file parser |
| `Dashboard.tsx` | 394 | Results dashboard |
| `reportGenerator.ts` | 360 | Report export |
| **Total (key files)** | **7,404** | |

---

## 16. Known Quirks and Gotchas

### Critical: Multer Hashed Filenames
Multer stores uploads with hashed filenames and **no extension**. The original filename is in `file.originalname` but the disk path has no `.inp` suffix.

**Correct:** `reportPath = inputPath + '.rpt'`
**Wrong:** `reportPath = inputPath.replace('.inp', '.rpt')` -- this does nothing because there is no `.inp` to replace.

### Icon Import Conflict
Never import `Map` from `lucide-react` in a file that uses JavaScript's `new Map()`. Use the alias `MapIcon` instead:
```typescript
import { Map as MapIcon } from "lucide-react";
```

### WebSocket Race Condition
If the client connects to the WebSocket after the server has already started sending progress messages, messages could be lost. The `messageBuffers` Map and 500ms processing delay prevent this, but be aware of this pattern.

### `completed` Without `result`
In edge cases, the server may send a `completed` message without a preceding `result` message for a file. Both FolderView and ReswmmPage handle this by generating a fallback "failed" `ProcessResult` when `completed` fires with no results.

### Continuity Error Threshold Inconsistency
The `reportToHtml()` function in `ResultsDisplay.tsx` uses a 0.1% threshold for coloring (red for >0.1%). The rest of the app uses green <= 1%, yellow 1-5%, red > 5%. These are intentionally different -- the HTML report view applies a stricter visual standard.

### TanStack Query v5
Only the object form is supported: `useQuery({ queryKey: ['key'] })` not `useQuery(['key'])`. The default `queryFn` is pre-configured, so queries don't need to define their own fetch function -- just provide the query key as the API path.

### Vite Configuration
`server/vite.ts` and `vite.config.ts` must **never** be modified. They handle dev HMR middleware, path aliases (`@/`, `@shared/`, `@assets/`), and production static file serving. Do not add proxies.

### Package.json
Must **never** be edited directly. Use the Replit package installer tool for adding dependencies.

---

## 17. Planned Features (Not Yet Implemented)

These have schema types defined in `shared/schema.ts` but no frontend or backend implementation:

1. **Parameter Sweep Mode** (`SweepConfig`): Run a single model multiple times with varying parameter values (e.g., roughness, slope) and compare results.

2. **Design Storm Sweep** (`DesignStormConfig`, `DesignStormEntry`): Run a model against multiple design storms (different return periods and SCS rainfall distributions) and compile comparative results.

3. **Model Comparison Report Generator**: Generate comprehensive side-by-side reports comparing multiple models' performance.

4. **Standalone HTML Report for Single Files**: An enhanced HTML version of the `.rpt` file with proper tables, colored metrics, and embedded charts (as opposed to the current basic `reportToHtml()` line-by-line styling).

---

## 18. Build and Deployment

### Development
```bash
npm run dev
# Runs: NODE_ENV=development tsx server/index.ts
# Vite dev server with HMR on the same port (5000)
# Backend and frontend served together via Vite middleware
```

### Production Build
```bash
npm run build
# Step 1: vite build -> dist/public/ (frontend assets)
# Step 2: esbuild server/index.ts -> dist/index.js (ESM bundle)
```

### Production Start
```bash
npm start
# Runs: NODE_ENV=production node dist/index.js
# Serves static files from dist/public/
# SWMM binary must be at swmm-engine/runswmm
```

### Environment Variables
| Variable | Purpose | Default |
|----------|---------|---------|
| `NODE_ENV` | development/production mode | -- |
| `PORT` | Server port | 5000 |
| `RUNSWMM_PATH` | Custom path to SWMM binary | Auto-detected |
| `DATABASE_URL` | PostgreSQL connection (unused) | -- |

### Replit Workflow
The `Start application` workflow runs `npm run dev`. It auto-restarts on file changes.

---

## 19. Dependencies

### Runtime Dependencies (Key)
| Package | Version | Purpose |
|---------|---------|---------|
| `react` | 18.3.1 | UI framework |
| `express` | 4.21.2 | HTTP server |
| `ws` | 8.18.0 | WebSocket server |
| `multer` | 2.1.0 | File upload middleware |
| `recharts` | 2.15.4 | Charts and graphs |
| `wouter` | 3.3.5 | Client-side routing |
| `@tanstack/react-query` | 5.60.5 | Server state management |
| `zod` | 3.24.2 | Schema validation |
| `tailwind-merge` | 2.6.0 | CSS class merging |
| `lucide-react` | 0.453.0 | Icon library |
| `framer-motion` | 11.13.1 | Animations |
| `drizzle-orm` | 0.39.1 | Database ORM (configured, not active) |

### Dev Dependencies (Key)
| Package | Version | Purpose |
|---------|---------|---------|
| `vite` | (via config) | Build tool |
| `esbuild` | (via config) | Backend bundler |
| `tsx` | (via config) | TypeScript execution |
| `tailwindcss` | (via config) | CSS framework |
| `@replit/vite-plugin-*` | Various | Dev tooling plugins |

---

*End of Handover Document*
