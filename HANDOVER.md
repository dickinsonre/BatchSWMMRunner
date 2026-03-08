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
8. [SWMM Binary Output Parser](#8-swmm-binary-output-parser)
9. [WebSocket Real-Time System](#9-websocket-real-time-system)
10. [ReSWMM Discretization Engine](#10-reswmm-discretization-engine)
11. [INP File Parser](#11-inp-file-parser)
12. [Results, Charting, and Reports](#12-results-charting-and-reports)
13. [Theming and Color System](#13-theming-and-color-system)
14. [Pages and Navigation](#14-pages-and-navigation)
15. [API Reference](#15-api-reference)
16. [File Size Reference](#16-file-size-reference)
17. [Known Quirks and Gotchas](#17-known-quirks-and-gotchas)
18. [Planned Features (Not Yet Implemented)](#18-planned-features-not-yet-implemented)
19. [Build and Deployment](#19-build-and-deployment)
20. [Dependencies](#20-dependencies)
21. [Improvement Roadmap](#21-improvement-roadmap)

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
- Binary `.out` file parser extracting time series data for interactive graphing
- Multiple university-branded color themes (Auburn, Autodesk, UF, OSU) with dark mode
- Downloadable reports in HTML, Markdown, and CSV formats

**Target Users:** Stormwater engineers who need to run, compare, and analyze SWMM models in bulk.

**How it works at a high level:**
1. User uploads `.inp` files (drag-and-drop, file picker, or directory picker)
2. Server spawns the SWMM 5.2.4 binary for each file, capturing stdout for real-time progress
3. After each run, the `.rpt` text report is parsed for metrics and the `.out` binary is parsed for time series data
4. Results stream to the browser via WebSocket — charts, tables, and reports render in real time
5. Users can export results, open them in the Dashboard, or use the ReSWMM tool for conduit discretization

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
|  |  routes.ts (1,018 lines)                             |   |
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
|  |  |           |                                    |   |   |
|  |  |  +--------v--------+                          |   |   |
|  |  |  | parseSwmmOutput |                          |   |   |
|  |  |  | Binary (.out)   |                          |   |   |
|  |  |  +-----------------+                          |   |   |
|  |  +-----------------------------------------------+   |   |
|  +-------------------------------------------------------+   |
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
- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, Shadcn/ui (New York variant, 47 components), Recharts, Wouter
- **Backend:** Express.js, TypeScript, Multer, ws (WebSocket)
- **Engine:** EPA SWMM 5.2.4 compiled from C source into `swmm-engine/runswmm` (511KB ELF binary, Linux x86_64)
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
│       ├── App.tsx                         # Router + providers (37 lines)
│       ├── index.css                       # Theme variables + Tailwind (736 lines)
│       ├── pages/
│       │   ├── Home.tsx                    # Batch processing (533 lines)
│       │   ├── FolderView.tsx              # File browser + network map (930 lines)
│       │   ├── ReswmmPage.tsx              # Discretization tool (1,323 lines)
│       │   ├── Dashboard.tsx               # Results dashboard (394 lines)
│       │   ├── Documentation.tsx           # Technical docs (684 lines)
│       │   └── not-found.tsx               # 404 page
│       ├── components/
│       │   ├── AppHeader.tsx               # Shared navigation header (109 lines)
│       │   ├── ResultsDisplay.tsx          # SWMM results viewer (659 lines)
│       │   ├── InteractiveCharts.tsx       # Time series charts from .out binary (492 lines)
│       │   ├── ThemeToggle.tsx             # Theme + dark mode selector (125 lines)
│       │   ├── SimulationSettings.tsx      # Batch settings panel
│       │   ├── ProcessingLog.tsx           # Real-time log viewer
│       │   ├── InstructionsPanel.tsx       # How-to guide
│       │   ├── NetworkMap.tsx              # SVG network visualization
│       │   └── ui/                         # 47 Shadcn/ui primitives:
│       │       ├── accordion.tsx           #   accordion, alert, alert-dialog,
│       │       ├── badge.tsx               #   aspect-ratio, avatar, badge,
│       │       ├── button.tsx              #   breadcrumb, button, calendar,
│       │       ├── card.tsx                #   card, carousel, chart, checkbox,
│       │       ├── dialog.tsx              #   collapsible, command, context-menu,
│       │       ├── dropdown-menu.tsx       #   dialog, drawer, dropdown-menu,
│       │       ├── form.tsx                #   form, hover-card, input, input-otp,
│       │       ├── progress.tsx            #   label, menubar, navigation-menu,
│       │       ├── scroll-area.tsx         #   pagination, popover, progress,
│       │       ├── select.tsx              #   radio-group, resizable, scroll-area,
│       │       ├── separator.tsx           #   select, separator, sheet, sidebar,
│       │       ├── sidebar.tsx             #   skeleton, slider, switch, table,
│       │       ├── slider.tsx              #   tabs, textarea, toast, toaster,
│       │       ├── tabs.tsx                #   toggle, toggle-group, tooltip
│       │       ├── tooltip.tsx
│       │       └── ... (47 files total)
│       ├── lib/
│       │   ├── inpParser.ts               # .inp file parser (427 lines)
│       │   ├── reswmmEngine.ts            # Discretization engine (444 lines)
│       │   ├── reportGenerator.ts         # HTML/MD/CSV report export (360 lines)
│       │   ├── resultsStore.ts            # Cross-page results store (17 lines)
│       │   ├── queryClient.ts             # TanStack Query setup (57 lines)
│       │   └── utils.ts                   # Tailwind merge helper (6 lines)
│       └── hooks/
│           ├── use-toast.ts               # Toast notification hook
│           └── use-mobile.tsx             # Mobile viewport detection
├── server/
│   ├── index.ts                           # Express entry point
│   ├── routes.ts                          # All API + WebSocket + parsers (1,018 lines)
│   ├── storage.ts                         # In-memory storage (44 lines)
│   └── vite.ts                            # Vite dev middleware (DO NOT MODIFY)
├── shared/
│   └── schema.ts                          # Zod schemas + TS types (95 lines)
├── swmm-engine/
│   └── runswmm                            # Compiled EPA SWMM 5.2.4 binary (511KB ELF)
├── public/samples/
│   ├── user1.inp                          # 545 lines, small test model
│   ├── user2.inp                          # 1,244 lines
│   ├── user3.inp                          # 2,831 lines
│   ├── user4.inp                          # 5,062 lines, largest sample
│   └── user5.inp                          # 2,749 lines
├── uploads/                               # Runtime upload directory (gitignored)
│   └── {hash}                             # Multer hashed filenames (NO .inp extension!)
│   └── {hash}.rpt                         # SWMM report output
│   └── {hash}.out                         # SWMM binary output
├── attached_assets/                       # User-provided images and extra .inp files
├── dist/                                  # Production build output
│   ├── index.js                           # Bundled Express server
│   └── public/                            # Compiled frontend assets
├── package.json                           # DO NOT EDIT DIRECTLY
├── tsconfig.json
├── vite.config.ts                         # DO NOT MODIFY
├── tailwind.config.ts
├── drizzle.config.ts                      # Configured but unused
├── components.json                        # shadcn/ui config
├── design_guidelines.md                   # UI/UX guidelines
├── replit.md                              # Agent memory file
└── HANDOVER.md                            # This file
```

---

## 4. Data Models and Type System

All types are defined in `shared/schema.ts` using Zod schemas with inferred TypeScript types, ensuring runtime validation and compile-time safety across the full stack.

### ParsedMetrics
Extracted from a SWMM `.rpt` report file by `parseReportMetrics()` on the server using regex pattern matching.

| Field | Type | Description | Extraction Pattern |
|-------|------|-------------|-------------------|
| `runoffContinuityError` | `number?` | Runoff quantity continuity error (%) | `Runoff Quantity Continuity Error\s*[.]*\s*([-\d.]+)\s*%` |
| `routingContinuityError` | `number?` | Flow routing continuity error (%) | `Flow Routing Continuity Error\s*[.]*\s*([-\d.]+)\s*%` |
| `totalPrecipitation` | `number?` | Total precipitation depth (inches or mm) | `Total Precipitation\s*[.]*\s*([\d.]+)` |
| `surfaceRunoff` | `number?` | Surface runoff volume (inches or mm) | `Surface Runoff\s*[.]*\s*([\d.]+)` |
| `nodesFlooded` | `number?` | Count of flooded nodes | `Number of Nodes Flooding\s*[.]*\s*(\d+)` |
| `floodingSummary` | `string?` | Human-readable flooding description | Generated from nodesFlooded count |
| `flowRoutingMethod` | `string?` | e.g., DYNWAVE, KINWAVE, STEADY | `Flow Routing Method\s*[.]*\s*(\w+)` |
| `infiltrationMethod` | `string?` | e.g., HORTON, GREEN_AMPT, CURVE_NUMBER | `Infiltration Method\s*[.]*\s*(\w+)` |
| `totalInflow` | `number?` | Wet weather inflow volume | `Wet Weather Inflow\s*[.]*\s*([\d.]+)` |
| `totalOutflow` | `number?` | External outflow volume | `External Outflow\s*[.]*\s*([\d.]+)` |
| `floodingLoss` | `number?` | Volume lost to flooding | `Flooding Loss\s*[.]*\s*([\d.]+)` |

### ProcessResult
Represents the outcome of running SWMM on a single `.inp` file. This is the primary data structure flowing through WebSocket messages and the ResultsDisplay component.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | UUID (generated by `crypto.randomUUID()`) |
| `fileName` | `string` | Original filename (e.g., `user1.inp`) |
| `filePath` | `string` | Server-side hashed path (e.g., `uploads/03dbc7e9ec857efb`) |
| `status` | `'success' \| 'failed'` | Run outcome |
| `error` | `string?` | Error message if failed (stderr or process exit info) |
| `processingTime` | `number?` | Seconds to complete simulation |
| `reportContent` | `string?` | Full raw `.rpt` file text PLUS appended time series from `.out` binary |
| `inpContent` | `string?` | Full raw `.inp` file text (original content before modification) |
| `results.peakFlow` | `number?` | Peak flow (CFS) -- currently always `undefined`, reserved for future |
| `results.totalVolume` | `number?` | Total volume (MG) -- currently always `undefined`, reserved for future |
| `parsedMetrics` | `ParsedMetrics?` | Structured report data extracted by `parseReportMetrics()` |

**Important:** The `reportContent` field contains the raw `.rpt` text file content concatenated with formatted time series data extracted from the `.out` binary file. The time series section uses `<<< ElementName >>>` markers that the `InteractiveCharts` component parses for rendering graphs.

### BatchJob
Tracks a batch processing session. Stored in-memory in `Map<string, BatchJob>`.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | UUID |
| `files` | `{id, name, path}[]` | List of uploaded files with server paths |
| `status` | `'idle' \| 'processing' \| 'completed' \| 'cancelled'` | Job lifecycle state |
| `currentFile` | `number` | Index of file currently being processed (0-based) |
| `results` | `ProcessResult[]` | Accumulated results as each file completes |

### SwmmStatus
SWMM engine detection result. Cached in `cachedSwmmStatus` variable on the server, refreshed on demand.

| Field | Type | Description |
|-------|------|-------------|
| `found` | `boolean` | Whether the binary was found |
| `path` | `string?` | Absolute path to binary (e.g., `/home/runner/workspace/swmm-engine/runswmm`) |
| `mode` | `'live' \| 'simulation'` | `live` = real binary found, `simulation` = mock mode |
| `searchedPaths` | `string[]?` | All paths checked during detection |

### Additional Types (Schema Defined, Not Yet Implemented)
These Zod schemas exist in `shared/schema.ts` but have no backend or frontend implementation yet:

| Schema | Type | Purpose |
|--------|------|---------|
| `sweepConfigSchema` | `SweepConfig` | `{ parameterName: string, values: number[] }` -- for parameter sweep mode |
| `designStormEntrySchema` | `DesignStormEntry` | `{ returnPeriod: string, depth: number, selected: boolean }` -- storm event definition |
| `designStormConfigSchema` | `DesignStormConfig` | `{ storms[], rainfallDistribution, duration }` -- storm sweep configuration |
| `sweepResultSchema` | `SweepResult` | Extends `ProcessResult` with `parameterValue` and `stormLabel` |

---

## 5. Backend (Express Server)

### Entry Point: `server/index.ts`
Bootstraps Express, registers routes, attaches Vite dev middleware (development) or static file serving (production), and starts listening on port 5000.

### Routes: `server/routes.ts` (1,018 lines)
This is the single largest backend file, containing all HTTP endpoints, WebSocket server, SWMM engine detection, file processing logic, report parsing, and binary output parsing.

**Key functions (with accurate line references):**

| Function | Purpose | Details |
|----------|---------|---------|
| `detectSwmmPath()` | Scans known paths, env vars, and PATH for SWMM binary | Checks `RUNSWMM_PATH` env var, `./swmm-engine/runswmm`, common Linux/Windows paths, and `which`/`where` shell commands. Returns `SwmmStatus` object. |
| `parseSwmmOutputBinary()` | Parses EPA SWMM `.out` binary file format | Extracts node/link time series data and formats as text for `InteractiveCharts`. See dedicated Section 8. |
| `parseReportMetrics()` | Regex extraction of 11 metrics from raw `.rpt` text | Uses pattern matching to find continuity errors, flooding, volumes, routing method, etc. Returns `ParsedMetrics`. |
| `registerRoutes()` | Main function: sets up WebSocket server, all HTTP routes, and processing pipeline | Creates `WebSocketServer`, defines all `app.get/post` routes, contains `processSingleFile()` and `processFilesSequentially()`. |
| `sendProgressUpdate()` | Dispatches WebSocket messages to connected clients or buffers them | If client is connected and socket is OPEN, sends immediately. Otherwise buffers in `messageBuffers` Map for later flush. |
| `processFilesSequentially()` | Iterates through batch files sequentially | Calls `processSingleFile()` for each, sends progress updates, handles cancellation, aggregates results. |
| `generateSimulatedReport()` | Generates realistic mock `.rpt` content | Used in simulation mode when no SWMM binary is available. Creates reports with randomized but realistic metrics. |
| `injectReportOptions()` | Modifies `.inp` to force full report output | Adds/replaces `INPUT YES`, `SUBCATCHMENTS ALL`, `NODES ALL`, `LINKS ALL` in `[REPORT]` section. |
| `processSingleFile()` | Core: spawns SWMM binary, captures progress, reads results | Spawns child process, parses stdout for `% complete`, reads `.rpt`, parses `.out` binary, returns `ProcessResult`. |

### Storage: `server/storage.ts` (44 lines)
In-memory storage using a `Map<string, BatchJob>`. Implements the `IStorage` interface:

```typescript
interface IStorage {
  getBatchJob(id: string): Promise<BatchJob | undefined>;
  createBatchJob(files: { id: string; name: string; path: string }[]): Promise<BatchJob>;
  updateBatchJob(id: string, updates: Partial<BatchJob>): Promise<BatchJob | undefined>;
}
```

Data is lost on server restart. The interface allows future migration to PostgreSQL (Drizzle ORM is configured in `drizzle.config.ts` but not active).

### File Upload Flow
1. Client sends `POST /api/upload` with `multipart/form-data` containing one or more `.inp` files
2. Multer saves files to `uploads/` directory with **hashed filenames** (NO `.inp` extension -- critical gotcha)
3. Server creates a `BatchJob` with the file metadata and returns the job ID
4. Client connects WebSocket with `?jobId=<id>` and sends `POST /api/batch/:jobId/start`
5. Server calls `processFilesSequentially()` after a 500ms delay (to let WebSocket connect)
6. For each file:
   a. `injectReportOptions()` modifies the `.inp` content to enable full reporting
   b. `spawn(runswmm, [inputPath, reportPath, outputPath])` executes SWMM
   c. stdout is parsed for progress percentages (regex: `/(\d+)%/`)
   d. On exit: `.rpt` is read and parsed by `parseReportMetrics()`, `.out` is parsed by `parseSwmmOutputBinary()`
   e. Time series text from `.out` is appended to `reportContent`
   f. `ProcessResult` is sent via WebSocket as a `result` message
7. After all files: `completed` message is sent

---

## 6. Frontend (React / Vite)

### Entry: `client/src/App.tsx` (37 lines)
- Wraps everything in `QueryClientProvider` (TanStack Query) and `TooltipProvider`
- Uses Wouter `Switch`/`Route` for client-side routing
- No sidebar layout -- uses horizontal header navigation via `AppHeader`

```typescript
// Route definitions
<Switch>
  <Route path="/" component={Home} />
  <Route path="/folder" component={FolderView} />
  <Route path="/dashboard" component={Dashboard} />
  <Route path="/docs" component={Documentation} />
  <Route path="/reswmm" component={ReswmmPage} />
  <Route component={NotFound} />
</Switch>
```

### Query Client: `client/src/lib/queryClient.ts` (57 lines)
- Configures default query behavior with `credentials: 'include'`
- Sets up a default `queryFn` that auto-fetches from the backend using the query key as the URL
- Error handling throws on non-OK responses with parsed error messages
- `apiRequest()` helper for mutations (POST/PATCH/DELETE)
- Queries do NOT need to define their own `queryFn` -- just provide the query key as the API path

```typescript
// Example usage in components:
const { data } = useQuery({ queryKey: ['/api/samples'] });
// queryFn auto-generated: fetches GET /api/samples
```

### Component Library
Uses Shadcn/ui (New York variant) with **47 pre-built components** in `client/src/components/ui/`. Key ones used extensively:
- `Card`, `Button`, `Badge`, `Tabs`, `Select`, `ScrollArea`, `Separator`, `Tooltip`
- `DropdownMenu` (theme toggle, report format picker)
- `Progress` (simulation progress bars)
- `Slider`, `Input`, `Label` (ReSWMM configuration)
- `Table` (results tables, comparison tables)
- `Toggle`, `ToggleGroup` (method selection in ReSWMM)

### Results Store: `client/src/lib/resultsStore.ts` (17 lines)
Simple module-level store for passing results between Home and Dashboard pages without a global state manager:
```typescript
let dashboardResults: ProcessResult[] | null = null;
let dashboardElapsed: string | null = null;
export function setDashboardResults(results: ProcessResult[], elapsed: string) { ... }
export function getDashboardResults(): { results, elapsed } | null { ... }
```
The Home page calls `setDashboardResults()` and navigates to `/dashboard`. Dashboard reads via `getDashboardResults()` on mount. If null, redirects back to `/`.

---

## 7. SWMM Engine Integration

### Binary
- **Location:** `swmm-engine/runswmm`
- **Size:** 510,944 bytes (511 KB) ELF executable
- **Source:** Compiled from EPA SWMM 5.2.4 C source code (from EPA GitHub repository)
- **Platform:** Linux x86_64 (runs natively in Replit's NixOS container)
- **Version:** SWMM 5.2.4 (version code 52004 in binary output)

### Detection
`detectSwmmPath()` searches for the binary in this priority order:
1. `RUNSWMM_PATH` environment variable
2. `./swmm-engine/runswmm` (project-local, relative to CWD)
3. Common Windows install paths (e.g., `C:/Program Files/EPA SWMM 5.2/runswmm.exe`) for portability
4. Common Linux paths (`/usr/local/bin/runswmm`, `/usr/bin/runswmm`)
5. `which runswmm` / `which swmm5` via shell execution

If not found, the app falls back to **Simulation Mode** which generates realistic mock reports with randomized but plausible metrics.

### Execution
```bash
spawn(swmmPath, [inputPath, reportPath, outputPath])
```
- `inputPath`: The uploaded `.inp` file (Multer hashed name, NO extension -- see Gotchas)
- `reportPath`: `inputPath + '.rpt'` (appended, NOT `.replace('.inp', '.rpt')`)
- `outputPath`: `inputPath + '.out'` (binary output file)

### Progress Capture
The SWMM binary writes progress percentages to stdout (e.g., `" ... 10%"`). The server parses these with regex `/(\d+)%/` and streams them to the client as `file_progress` WebSocket messages. This provides real-time per-file progress bars in the UI.

### Report Injection
Before running, `injectReportOptions()` modifies the `.inp` file to ensure the report contains all data:
```
[REPORT]
INPUT       YES
SUBCATCHMENTS ALL
NODES       ALL
LINKS       ALL
```
This is critical because without these options, SWMM generates a minimal report that lacks the detailed per-element data needed for the InteractiveCharts component.

### Output Files
After a successful run, SWMM produces:
1. **`.rpt` file** -- Text report with summary statistics, continuity errors, element tables
2. **`.out` file** -- Binary output with time series data for all nodes, links, and subcatchments

Both are parsed server-side and combined into the `reportContent` field of `ProcessResult`.

---

## 8. SWMM Binary Output Parser

**Function:** `parseSwmmOutputBinary(outPath: string): string` in `server/routes.ts`

This parser reads the EPA SWMM 5.2 binary output file (`.out`) and extracts node/link time series data, formatting it as text that the `InteractiveCharts` component can parse. This is the key feature that enables the "RPT Graphs" tab to display actual simulation results.

### Why This Exists
Real SWMM `.rpt` files contain NO time series data -- they only have summary tables and statistics. All time-varying data (depth, flow, velocity over time for each element) lives exclusively in the `.out` binary file. Without this parser, the RPT Graphs tab would show "No time series data available."

### Binary File Format (EPA SWMM 5.2)

#### Header (28 bytes at file start)
| Offset | Type | Field | Example Value |
|--------|------|-------|---------------|
| 0 | Int32LE | Magic number | 516114522 |
| 4 | Int32LE | SWMM version | 52004 |
| 8 | Int32LE | Flow units | 0 (CFS) |
| 12 | Int32LE | Num subcatchments | 0 |
| 16 | Int32LE | Num nodes | 10 |
| 20 | Int32LE | Num links | 10 |
| 24 | Int32LE | Num pollutants | 0 |

#### Footer (6 Int32s at end of file)
| Position | Type | Field |
|----------|------|-------|
| EOF - 24 | Int32LE | ID section start offset |
| EOF - 20 | Int32LE | Property section start offset |
| EOF - 16 | Int32LE | Results section start offset |
| EOF - 12 | Int32LE | Number of reporting periods |
| EOF - 8 | Int32LE | Error code (0 = success) |
| EOF - 4 | Int32LE | Magic number (again, for validation) |

#### ID Section
Starting at `idStart`, length-prefixed strings for each object:
```
[Int32: nameLength] [UTF-8 bytes: name]
```
Read in order: subcatchment names, then node names, then link names.

#### Property Section
Starting at `propStart`:
```
[Int32: nSubProps] [Int32[]: propCodes] [Float32[nSub * nSubProps]: values]
[Int32: nNodeProps] [Int32[]: propCodes] [Float32[nNode * nNodeProps]: values]
[Int32: nLinkProps] [Int32[]: propCodes] [Float32[nLink * nLinkProps]: values]
```

#### Variable Codes Section (between properties and results)
```
[Int32: nSubVars] [Int32[nSubVars]: varCodes]
[Int32: nNodeVars] [Int32[nNodeVars]: varCodes]
[Int32: nLinkVars] [Int32[nLinkVars]: varCodes]
[Int32: nSysVars] [Int32[nSysVars]: varCodes]
[Float64: startDate (OLE)] [Int32: reportStep (seconds)]
```

#### Results Section
Each reporting period is a contiguous block:
```
[Float64: OLE date] 
[Float32[nSub * nSubVars]: subcatchment values]
[Float32[nNode * nNodeVars]: node values]
[Float32[nLink * nLinkVars]: link values]
[Float32[nSysVars]: system values]
```

**Bytes per period:** `8 + 4 * (nSub * nSubVars + nNode * nNodeVars + nLink * nLinkVars + nSysVars)`

### Variable Definitions

**Node variables (base 6, plus pollutants):**
| Index | Name | Unit |
|-------|------|------|
| 0 | Depth | ft |
| 1 | Head | ft |
| 2 | Volume | ft3 |
| 3 | Lat.Inflow | CFS |
| 4 | Total Inflow | CFS |
| 5 | Flooding | CFS |
| 6+ | Pollutant_N | mg/L |

**Link variables (base 5, plus pollutants):**
| Index | Name | Unit |
|-------|------|------|
| 0 | Flow | CFS |
| 1 | Depth | ft |
| 2 | Velocity | ft/sec |
| 3 | Volume | ft3 |
| 4 | Capacity | (fraction) |
| 5+ | Pollutant_N | mg/L |

### OLE Date Conversion
SWMM stores dates as OLE Automation dates (Float64 = days since December 30, 1899):
```typescript
const oleEpochMs = new Date(1899, 11, 30).getTime();
const msPerDay = 86400000;
const jsDate = new Date(oleEpochMs + oleDate * msPerDay);
```

### Output Format
The parser produces text matching the format expected by `InteractiveCharts.tsx`:

```
  **************
  Node Results Time Series
  **************

  <<< NodeName >>>

  Date            Time            Depth           Head            Volume          ...
  Day             Hour:Min        ft              ft              ft3             ...
  ------------------------------------------------...
  01/01/2002      00:05                  0.865           125.465             0.000  ...
  01/01/2002      00:10                  1.721           126.321             0.000  ...

  <<< NextNode >>>
  ...

  **************
  Link Results Time Series
  **************

  <<< LinkName >>>
  ...
```

### Safety Features
- Magic number validation (must be 516114522)
- Error code check (must be 0)
- File size bounds checking
- `pos === resultStart` verification after parsing metadata (ensures correct parsing)
- `expectedEnd <= fileSize` check before reading results
- Maximum 2,000 periods to prevent enormous output
- Try/catch wrapper returns empty string on any error (silent fallback)

### Integration Point
In `processSingleFile()`, after reading the `.rpt` file:
```typescript
const timeSeriesData = parseSwmmOutputBinary(outputPath);
if (timeSeriesData) {
  reportContent = (reportContent || '') + '\n' + timeSeriesData;
}
```
This means `reportContent` in every `ProcessResult` contains both the original `.rpt` text AND the formatted time series data from the `.out` binary.

---

## 9. WebSocket Real-Time System

### Connection Setup
- **Server:** `new WebSocketServer({ server: httpServer, path: '/api/ws' })`
- **Client:** `new WebSocket('ws[s]://host/api/ws?jobId=${jobId}')`
- One WebSocket connection per job ID
- Connections tracked in `Map<string, WebSocket>` (keyed by jobId)

### Full Flow: Upload to Result Delivery
1. **Upload:** Client sends `POST /api/upload` with `.inp` files via `multipart/form-data`
2. **Job creation:** Server saves files, creates `BatchJob`, returns `{ id, files }` 
3. **WebSocket connect:** Client opens `ws://host/api/ws?jobId=<id>`
4. **Start processing:** Client sends `POST /api/batch/<id>/start`
5. **500ms delay:** Server waits before processing to ensure WebSocket is connected
6. **Sequential execution:** For each file:
   - `progress` message sent (file starting)
   - SWMM binary spawned, stdout parsed for `% complete` percentages
   - `file_progress` messages streamed for per-file progress bars
   - `log` messages sent for raw stdout/stderr output
   - On completion: `.rpt` parsed, `.out` parsed, `result` message sent
7. **All done:** `completed` message sent with full results array

### Message Types (Server to Client)

| Type | Fields | Purpose | Example |
|------|--------|---------|---------|
| `progress` | `current`, `total`, `fileName`, `fileId`, `status` | Overall batch progress | `{ type: "progress", current: 2, total: 5, fileName: "model.inp" }` |
| `file_progress` | `fileId`, `percentage`, `message` | Per-file SWMM progress (0-100%) | `{ type: "file_progress", fileId: "abc", percentage: 45, message: "45%" }` |
| `log` | `text`, `stream`, `fileName` | stdout/stderr from SWMM process | `{ type: "log", text: "... Running ...", stream: "stdout" }` |
| `result` | `result` (full `ProcessResult`) | Completed file result | `{ type: "result", result: { id, fileName, status, reportContent, ... } }` |
| `completed` | `results[]` | Batch finished, all results | `{ type: "completed", results: [...] }` |
| `error` | `message` | Fatal error | `{ type: "error", message: "SWMM binary not found" }` |
| `cancelled` | (none) | Job was cancelled | `{ type: "cancelled" }` |

### Message Buffering System
Race condition mitigation: if `sendProgressUpdate()` is called before a client WebSocket connects (or while reconnecting), messages are buffered:

```typescript
const messageBuffers = new Map<string, any[]>();

function sendProgressUpdate(jobId: string, data: any) {
  const client = clients.get(jobId);
  if (client && client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(data));
  } else {
    if (!messageBuffers.has(jobId)) {
      messageBuffers.set(jobId, []);
    }
    messageBuffers.get(jobId)!.push(data);
  }
}
```

When a new WebSocket connects, buffered messages are flushed immediately:
```typescript
wss.on('connection', (ws, req) => {
  const jobId = url.searchParams.get('jobId');
  clients.set(jobId, ws);
  const buffered = messageBuffers.get(jobId);
  if (buffered && buffered.length > 0) {
    for (const msg of buffered) ws.send(JSON.stringify(msg));
    messageBuffers.delete(jobId);
  }
});
```

The 500ms delay before `processFilesSequentially()` starts gives the WebSocket time to connect.

### Client-Side Handling
- **Home.tsx:** Full WebSocket lifecycle in `connectWebSocket()` function with `useEffect` cleanup
- **ReswmmPage.tsx:** Uses `runInpContent()` helper that manages upload + WS + result collection for both before/after runs
- **FolderView.tsx:** Similar pattern for single-file "Run SWMM" feature
- All pages handle the edge case where `completed` arrives without a preceding `result` by creating a fallback "failed" `ProcessResult`
- Error states reset `runState` back to `'idle'` and show toast notifications

---

## 10. ReSWMM Discretization Engine

**File:** `client/src/lib/reswmmEngine.ts` (444 lines)

The ReSWMM engine modifies SWMM conduit networks to improve numerical stability by:
1. **Lengthening** short conduits that would require excessively small time steps
2. **Discretizing** long conduits into multiple shorter segments

### Configuration Interface

```typescript
interface ReswmmConfig {
  method: 'fixed_interval' | 'dx_d_ratio';
  fixedMinLength: number;        // Min segment length (ft), default 100
  fixedMaxLength: number;        // Max segment length (ft), default 500
  dxDRatio: number;              // dx/D ratio (unitless), default 20
  lengtheningEnabled: boolean;   // Whether to apply lengthening
  lengtheningStep: number;       // Time step for lengthening calculation (seconds), default 1
  mnsa: number;                  // Minimum Node Surface Area (ft^2), default 12.566
  gravity: number;               // 32.174 ft/s^2 (US) or 9.81 m/s^2 (SI)
}
```

### Discretization Methods

**Fixed Interval Method:**
- User specifies min and max segment lengths
- Target length = `clamp(conduitLength, fixedMinLength, fixedMaxLength)`
- Number of segments = `ceil(conduitLength / targetLength)`
- Actual segment length = `conduitLength / nSegments` (ensures lengths sum to original)
- Conduits shorter than `fixedMinLength` are NOT split (1 segment)

**dx/D Ratio Method:**
- Target length = `diameter * dxDRatio`
- Same segment calculation as fixed interval
- Useful for maintaining consistent spatial resolution relative to pipe size
- Models with widely varying pipe diameters get proportional discretization

### Conduit Lengthening Logic
Prevents CFL-violating short pipes that would force excessively small time steps:
```
celerity = sqrt(gravity * diameter)
minLength = celerity * lengtheningStep
if (conduit.length < minLength) then conduit.length = minLength
```
Runs BEFORE discretization. Example: A 1.5 ft diameter pipe at g=32.174 ft/s^2 with a 1-second step:
```
celerity = sqrt(32.174 * 1.5) = 6.95 ft/s
minLength = 6.95 * 1 = 6.95 ft
```
Any conduit shorter than 6.95 ft would be lengthened to 6.95 ft.

### Node Interpolation
When splitting a conduit into N segments, N-1 intermediate junctions are created:
- **Name:** `{conduitName}_n{index}` (e.g., `C1_n1`, `C1_n2`)
- **Elevation:** Linear interpolation between upstream and downstream node elevations
  ```
  fraction = segmentIndex / totalSegments
  elevation = upstreamElev + fraction * (downstreamElev - upstreamElev)
  ```
- **Coordinates:** Linear interpolation of X, Y for map display
- **Max Depth:** Inherited from upstream node
- **Aponded:** Set to `config.mnsa` (Minimum Node Surface Area)
- **Init Depth:** Set to 0
- **Sur Depth:** Set to 0

### Property Distribution Across Segments
- **Offsets:** `inOffset` on first segment only, `outOffset` on last segment only. Middle segments get 0 for both.
- **Entry Loss:** Applied to first segment only
- **Exit Loss:** Applied to last segment only
- **Average Loss:** Divided by N (`loss.average / nSegments`)
- **Roughness (Manning's n):** Identical across all segments
- **Cross-section:** Identical across all segments (same shape, dimensions)
- **Flapgate:** Applied to first segment only

### CFL Analysis
`computeCflAnalysis()` calculates stable time steps for every conduit:
```
celerity = sqrt(g * diameter)
standardDt = length / celerity           // CFL-stable time step
conservativeDt = standardDt * 0.10       // 10% safety factor
```
Returns per-conduit analysis with flags for conduits below the configured `lengtheningStep` threshold. Used by the UI to highlight conduits that may cause numerical instability.

### INP File Rebuild
`rebuildInpFile()` creates new `.inp` content:
1. Identifies line ranges of all sections in the original file using `[SECTION]` header detection
2. Replaces five sections with discretized data: `[JUNCTIONS]`, `[CONDUITS]`, `[XSECTIONS]`, `[LOSSES]`, `[COORDINATES]`
3. Injects discretization parameters comment into `[TITLE]` section
4. Updates/inserts `LENGTHENING_STEP` in `[OPTIONS]`
5. Preserves all other sections verbatim (e.g., `[SUBCATCHMENTS]`, `[RAINGAGES]`, `[TIMESERIES]`)
6. Uses `.padEnd()` formatting for SWMM-compatible column alignment (important: SWMM is column-sensitive)

### Simulation Comparison (ReswmmPage)
When both original and discretized models have been run through SWMM:
- **`SimulationComparison` component** appears automatically
- **Table:** 12-row side-by-side metrics comparison:
  - Status, Processing Time, Runoff CE, Routing CE, Nodes Flooded, Flooding Loss
  - Total Precipitation, Surface Runoff, Total Inflow, Total Outflow
  - Flow Routing Method, Infiltration Method
  - Delta column shows change (with color coding: green = improvement, red = regression)
- **Continuity Errors & Flooding chart:** Grouped bar chart (Original vs. Discretized) using Recharts
- **Volume Comparison chart:** Grouped bar chart for hydrological volumes

---

## 11. INP File Parser

**File:** `client/src/lib/inpParser.ts` (427 lines)

Client-side parser that converts raw SWMM `.inp` text into a structured TypeScript object. Runs entirely in the browser -- no server round-trip needed.

### How It Works
1. **Section splitting** (`splitIntoSections()`): Reads line-by-line, identifies sections by `[SECTION]` headers, stores in `Map<string, string[]>`
2. **Line cleaning** (`parseDataLines()`): Filters comment lines (`;` prefix and `;;` prefix), splits remaining lines by whitespace into token arrays
3. **Specific section parsing**: Dedicated parsers for each section convert string tokens to typed objects
4. **Assembly** (`parseInpFile()`): Calls all individual parsers, returns unified `ParsedInpFile` with `counts` summary

### Parsed Sections (15 total)

| Section | Interface | Key Fields | Token Positions |
|---------|-----------|------------|-----------------|
| `[TITLE]` | `string` | Project description | Full text content |
| `[OPTIONS]` | `InpOptions` | flowUnits, routingMethod, infiltrationMethod | Key-value pairs |
| `[JUNCTIONS]` | `JunctionData[]` | name, elevation, maxDepth, initDepth, surDepth, aponded | 0=name, 1=elev, 2=maxD, 3=initD, 4=surD, 5=aponded |
| `[OUTFALLS]` | `OutfallData[]` | name, elevation, type, gated | 0=name, 1=elev, 2=type, 3+=params |
| `[STORAGE]` | `StorageData[]` | name, elevation, maxDepth, initDepth, shape, params | 0=name, 1=elev, 2=maxD, 3=initD, 4=shape |
| `[CONDUITS]` | `ConduitData[]` | name, from, to, length, roughness, inOffset, outOffset | 0=name, 1=from, 2=to, 3=len, 4=n, 5=inOff, 6=outOff |
| `[PUMPS]` | `PumpData[]` | name, from, to, pumpCurve, status, startup, shutoff | 0=name, 1=from, 2=to, 3=curve |
| `[ORIFICES]` | `OrificeData[]` | name, from, to, type, offset, cd, flapGate | 0=name, 1=from, 2=to, 3=type |
| `[WEIRS]` | `WeirData[]` | name, from, to, type, crestHeight, cd | 0=name, 1=from, 2=to, 3=type |
| `[XSECTIONS]` | `XSectionData[]` | link, shape, geom1-4, barrels | 0=link, 1=shape, 2=g1, 3=g2, 4=g3, 5=g4, 6=barrels |
| `[LOSSES]` | `LossData[]` | link, entry, exit, average, flapGate | 0=link, 1=entry, 2=exit, 3=avg, 4=flap |
| `[COORDINATES]` | `CoordinateData[]` | name, x, y | 0=name, 1=x, 2=y |
| `[SUBCATCHMENTS]` | `SubcatchmentData[]` | name, rainGage, outlet, area, imperv, width, slope | 0=name, 1=gage, 2=outlet, 3=area, 4=%imperv |
| `[SUBAREAS]` | `SubareaData[]` | name, nImperv, nPerv, sImperv, sPerv, pctZero, routeTo | 0=name, 1=nI, 2=nP, 3=sI, 4=sP |
| `[INFILTRATION]` | `InfiltrationData[]` | name, params (array of 3 floats) | 0=name, 1-3=params |
| `[Polygons]` | `PolygonData[]` | name, vertices: {x,y}[] | Multiple lines per polygon |
| `[RAINGAGES]` | `RainGageData[]` | name, format, interval, scf, source, sourceParams | 0=name, 1=format, 2=interval |

### Output Structure
```typescript
interface ParsedInpFile {
  title: string;
  options: InpOptions;            // { flowUnits, routingMethod, infiltrationMethod }
  counts: SectionCounts;          // { junctions, conduits, subcatchments, outfalls, ... }
  junctions: JunctionData[];
  outfalls: OutfallData[];
  storageUnits: StorageData[];
  conduits: ConduitData[];
  pumps: PumpData[];
  orifices: OrificeData[];
  weirs: WeirData[];
  xsections: XSectionData[];
  losses: LossData[];
  coordinates: CoordinateData[];
  subcatchments: SubcatchmentData[];
  subareas: SubareaData[];
  infiltration: InfiltrationData[];
  polygons: PolygonData[];
  raingages: RainGageData[];
  rawSections: Map<string, string[]>;  // Original section text for pass-through
}
```

### Usage
- **Folder View:** Parses files client-side for inspection (no server upload needed)
- **ReSWMM:** Parses the uploaded file to extract conduits, junctions, xsections for discretization
- **NetworkMap:** Uses coordinates, conduits, junctions, subcatchments, polygons for SVG rendering

---

## 12. Results, Charting, and Reports

### ResultsDisplay Component (`client/src/components/ResultsDisplay.tsx`, 659 lines)
The primary results viewer used by Home, FolderView, and ReswmmPage. Receives `ProcessResult[]` as props.

**Layout:**
1. **Summary Cards Row:** Total models, Successes (green), Failures (red), Warnings (yellow, CE > 1%)
2. **Alert Bar:** Conditional warnings for flooding or high continuity errors across all files
3. **Results Summary Table:** Per-file row with Status, Processing Time, Runoff CE, Routing CE, Flooding, and action buttons
4. **Detailed Results List:** Expandable per-file detail with 4 tabs:

| Tab | Content | Component |
|-----|---------|-----------|
| **INP** | Raw input file content | `LargeTextViewer` (truncates at 2,000 lines with "Show All" toggle) |
| **RPT Text** | Raw report text + time series | `LargeTextViewer` |
| **RPT Graphs** | Interactive time series charts | `InteractiveCharts` component |
| **RPT HTML** | Color-coded formatted report | `reportToHtml()` inline rendering |

5. **Download Buttons:** `.rpt` text file, HTML/Markdown/CSV batch reports
6. **"Open in Results Dashboard"** button: stores results in `resultsStore`, navigates to `/dashboard`

### LargeTextViewer (embedded in ResultsDisplay)
Handles rendering of very large text content (SWMM reports can be 76,000+ lines):
- `MAX_PREVIEW_LINES = 2000`: Initial view shows first 2,000 lines
- "Show All" button loads full content on demand
- Monospace font, horizontal scroll for wide lines
- Line numbers not shown (to maintain performance)

### InteractiveCharts Component (`client/src/components/InteractiveCharts.tsx`, 492 lines)
Parses the time series data from `reportContent` and renders interactive Recharts charts.

**Parsing Logic (`parseTimeSeries()`):**
1. Scans for `**************` section delimiters
2. Looks for title lines ending with "Time Series" (e.g., "Node Results Time Series")
3. For each `<<< ElementName >>>` marker:
   - Reads column headers (filters out "Date" and "Time")
   - Reads unit headers (filters out "Day" and "Hour:Min")
   - Reads data rows matching `MM/DD/YYYY HH:MM value1 value2 ...` pattern
4. Produces `ParsedTimeSeries[]` array:
```typescript
interface ParsedTimeSeries {
  title: string;     // "Node Results Time Series" or "Link Results Time Series"
  element: string;   // "J1", "C1", etc.
  columns: string[]; // ["Depth", "Head", "Volume", ...]
  units: string[];   // ["ft", "ft", "ft3", ...]
  data: { time: string; values: number[] }[];  // Time-stamped data rows
}
```

**Visualization:**
- `LineChart` and `AreaChart` toggle (user selects chart type)
- Dropdown selectors: Section (Node/Link), Element (specific node/link name), Variables (checkboxes)
- `Brush` component for time range zoom/pan
- Toggle checkboxes for individual data series visibility
- Color palette: 8 HSL colors cycling through series
- "Data Table" sub-tab: Raw tabular view of the time series data
- Responsive width/height with `ResponsiveContainer`

### Report Generator (`client/src/lib/reportGenerator.ts`, 360 lines)
Generates downloadable summary reports across all results in a batch.

| Function | Output | Content |
|----------|--------|---------|
| `generateHTMLReport()` | Standalone `.html` file | Summary cards, CE table with color-coded cells, flooding table, hydrology comparison, automated recommendations |
| `generateMarkdownReport()` | `.md` file | Same content in Markdown tables |
| `generateCSVReport()` | `.csv` file | One row per file with all 11+ metrics |
| `downloadReport()` | Browser download | Creates `Blob` + temporary `<a>` download link |
| `analyzeResults()` | Internal | Computes best/worst/average CE, identifies flooded models, generates text recommendations |

**Continuity error thresholds (used throughout the app):**
| Range | Color | Meaning |
|-------|-------|---------|
| |CE| <= 1% | Green | Acceptable |
| 1% < |CE| <= 5% | Yellow | Warning |
| |CE| > 5% | Red | Critical |

**Note:** The inline `reportToHtml()` function in `ResultsDisplay.tsx` uses a stricter 0.1% threshold for color-coding in the HTML tab view. This is intentionally different from the summary threshold.

### SimulationComparison (embedded in ReswmmPage.tsx)
Appears automatically when both original and discretized models have completed SWMM runs:
- **Side-by-side table:** 12 metrics with delta values and color-coded changes
- **Continuity Errors & Flooding bar chart:** Grouped Recharts BarChart (Original vs. Discretized bars)
- **Volume Comparison bar chart:** Grouped BarChart for precipitation, runoff, inflow, outflow volumes

---

## 13. Theming and Color System

### Theme Architecture
CSS custom properties defined in `client/src/index.css` (736 lines) are consumed by `tailwind.config.ts` and applied via Tailwind utility classes. The file uses the HSL color format: `H S% L%` (space-separated, percentages for S and L, no `hsl()` wrapper).

### Available Themes

| Theme | Primary Color | Accent Color | CSS Class | Branding |
|-------|--------------|-------------|-----------|----------|
| Default | Blue (`210 95% 45%`) | Violet-blue | (none / `:root`) | Professional neutral |
| Auburn | Orange (`15 85% 48%`) | Navy | `.theme-auburn` | Auburn University |
| Autodesk | Dark (`220 20% 15%`) | Teal/Cyan | `.theme-autodesk` | Autodesk software |
| UF | Orange (`24 95% 53%`) | Blue | `.theme-uf` | University of Florida |
| OSU | Scarlet (`0 80% 45%`) | Dark gray | `.theme-osu` | Ohio State University |

### CSS Variable Groups
Each theme defines these variable families (both light and dark variants):

| Variable Family | Purpose | Example |
|----------------|---------|---------|
| `--background` / `--foreground` | Page background and default text | `0 0% 100%` / `222.2 84% 4.9%` |
| `--card` / `--card-foreground` | Card surfaces | `0 0% 100%` / `222.2 84% 4.9%` |
| `--primary` / `--primary-foreground` | Primary action color | `210 95% 45%` / `0 0% 100%` |
| `--secondary` / `--secondary-foreground` | Secondary surfaces | `210 40% 96.1%` / `222.2 47.4% 11.2%` |
| `--muted` / `--muted-foreground` | Muted backgrounds and text | `210 40% 96.1%` / `215.4 16.3% 46.9%` |
| `--accent` / `--accent-foreground` | Accent highlights | `210 40% 96.1%` / `222.2 47.4% 11.2%` |
| `--destructive` / `--destructive-foreground` | Error/danger states | `0 84.2% 60.2%` / `0 0% 98%` |
| `--border` / `--input` / `--ring` | Borders, inputs, focus rings | Various gray tones |
| `--sidebar-*` | Sidebar-specific colors (5 variants) | Background, foreground, primary, accent, border |
| `--chart-1` through `--chart-5` | Recharts data visualization colors | 5 distinct HSL values per theme |
| `--elevate-1` / `--elevate-2` | Custom hover/active elevation effects | Semi-transparent overlays |

### Dark Mode
- Controlled by `.dark` class on `<html>` element
- Each theme has its own dark variant block (e.g., `.dark.theme-auburn` in `index.css`)
- Toggle persisted in `localStorage` keys: `batchswmm-theme` (or `color-theme`) and `batchswmm-dark-mode` (or `theme`)
- System preference detection via `window.matchMedia("(prefers-color-scheme: dark)")` on first load
- Tailwind configured with `darkMode: ["class"]` -- dark styles triggered by `.dark` class presence

### ThemeToggle Component (`client/src/components/ThemeToggle.tsx`, 125 lines)
Dropdown menu with:
- **Theme selection:** Default, Auburn, Autodesk, UF, OSU (radio-style selection)
- **Dark/Light mode toggle:** Button with Sun/Moon icons from lucide-react
- Updates `document.documentElement.className` dynamically via `useEffect`
- Removes all previous theme classes before applying new one
- Saves selections to `localStorage` for persistence across sessions

---

## 14. Pages and Navigation

### AppHeader (`client/src/components/AppHeader.tsx`, 109 lines)
Shared across all pages. Contains:
- **Logo/Title:** "BatchSWMM" with Droplets icon from lucide-react
- **Navigation Tabs:** Batch Processing (`/`), Folder View (`/folder`), ReSWMM (`/reswmm`), Docs (`/docs`)
- **SWMM Status Badge:** Fetches `/api/swmm-status` via TanStack Query, shows "SWMM 5.2.4 Live" (green) or "Simulation Mode" (yellow) with tooltip showing binary path
- **ThemeToggle:** Theme and dark mode selector
- Active tab highlighted based on current URL via Wouter's `useLocation` hook

### Page Details

#### Home (`/`) -- `client/src/pages/Home.tsx` (533 lines)
Batch processing workflow:
1. **Upload `.inp` files:** drag-and-drop, file picker, or directory picker (`webkitdirectory` attribute)
2. **Optionally load bundled sample models** from `/api/samples`
3. **Configure settings:** Routing Method (DYNWAVE/KINWAVE/STEADY), Report Step (seconds), Parallel Processing (toggle), Stop on Error (toggle)
4. **Click "Start Processing":** Files uploaded to `/api/upload`, WebSocket connects, `/api/batch/:jobId/start` called
5. **Real-time progress:** Overall progress bar, per-file status icons (pending/running/success/failed), processing log
6. **Results displayed** via `ResultsDisplay` component
7. **"Open in Results Dashboard"** button to navigate to `/dashboard`

**Key state variables:**
- `processingState`: `'idle' | 'uploading' | 'processing' | 'completed'`
- `results`: `ProcessResult[]`
- `fileProgressMap`: `Map<string, { percent, status }>`
- `logs`: `LogEntry[]` for ProcessingLog component

#### Folder View (`/folder`) -- `client/src/pages/FolderView.tsx` (930 lines)
Individual file inspection:
1. **Load files** via drag-and-drop, file picker, or directory picker
2. **Files parsed client-side** via `parseInpFile()` -- no server upload needed for inspection
3. **File list sidebar** with element count badges (junctions, conduits, subcatchments)
4. **Detail panel** shows:
   - Element count grid (Junctions, Conduits, Subcatchments, Outfalls, Pumps, etc.)
   - Network options (Flow Units, Routing Method, Infiltration Method)
   - SVG Network Map via `NetworkMap` component (nodes as circles, conduits as lines, subcatchments as polygons)
   - Conduit length statistics (histogram via Recharts BarChart + min/max/mean/std dev)
5. **"Run SWMM" button:** Uploads selected file to server, runs simulation via WebSocket, shows `ResultsDisplay` with full results
6. **Compare mode:** Multi-select files for side-by-side metrics comparison table

#### ReSWMM (`/reswmm`) -- `client/src/pages/ReswmmPage.tsx` (1,323 lines)
Conduit discretization tool -- the largest and most complex page:
1. **Upload a single `.inp` file** via drag-and-drop or file picker
2. **Configure discretization:**
   - Method toggle: Fixed Interval / dx/D Ratio
   - Fixed Interval: Min Length (ft), Max Length (ft) via Slider
   - dx/D Ratio: Ratio value via Slider
   - Lengthening: Enable/disable toggle, Lengthening Step (seconds)
   - MNSA: Minimum Node Surface Area (ft^2)
3. **Click "Discretize"** -- engine runs client-side in browser -- shows:
   - Summary cards (conduits split, junctions added, total conduits, total junctions)
   - Before/After conduit length histogram (overlaid bins, two colors)
   - Detailed modification table (conduit name, original length, new segments, segment length)
   - CFL time step analysis table (per conduit: celerity, standard dt, conservative dt, flag)
   - Mini network maps (before and after, side by side)
4. **Download modified `.inp` file** as `ReSWMM_{originalName}.inp`
5. **Run Simulations section:**
   - "Run Original" -- uploads original `.inp`, runs through SWMM via WebSocket
   - "Run Discretized" -- rebuilds modified `.inp` via `rebuildInpFile()`, uploads, runs SWMM
   - Each shows individual `ResultsDisplay` with full tabs
   - When both complete -- `SimulationComparison` component with side-by-side table and two grouped bar charts

**Key state variables:**
- `config`: `ReswmmConfig` -- discretization parameters
- `discretizationResult`: `DiscretizationResult` -- output from engine
- `beforeRunState` / `afterRunState`: `'idle' | 'uploading' | 'processing' | 'completed'`
- `beforeRunResults` / `afterRunResults`: `ProcessResult[]`
- `showingResults`: `'before' | 'after' | null` -- which results panel to display

#### Dashboard (`/dashboard`) -- `client/src/pages/Dashboard.tsx` (394 lines)
Visualizes batch results (data passed via `resultsStore`):
- **Status pie chart:** Success / Failed / Warning distribution (Recharts PieChart)
- **Continuity errors bar chart:** Runoff CE and Routing CE per model (Recharts BarChart)
- **Flooding bar chart:** Nodes flooded per model
- **Precipitation/Runoff bar chart:** Hydrology comparison across models
- **Detailed metrics table:** All 11 metrics per file in sortable table
- **"Back to BatchSWMM"** button to return to `/`
- Redirects to `/` if no data is available (resultsStore returns null)

#### Documentation (`/docs`) -- `client/src/pages/Documentation.tsx` (684 lines)
Tabbed technical documentation with 4 tabs:
1. **SWMM Integration:** How the binary is detected, executed, and reports are parsed
2. **WebSocket Protocol:** Message types, lifecycle, buffering system
3. **ReSWMM Engine:** Configuration parameters, discretization logic, algorithms
4. **ReSWMM Lengthening:** CFL mathematical derivation, worked numerical example, SWMM5 C source reference (from `link.c`)

Each tab uses Shadcn Card components with code blocks, tables, and explanatory text.

---

## 15. API Reference

### HTTP Endpoints

| Method | Path | Purpose | Request Body | Response Body |
|--------|------|---------|-------------|---------------|
| `GET` | `/api/swmm-status` | Check SWMM engine availability | -- | `SwmmStatus` object |
| `POST` | `/api/swmm-status/refresh` | Force re-detect SWMM binary | -- | `SwmmStatus` object |
| `GET` | `/api/samples` | List bundled sample models | -- | `Array<{ name, size, title }>` |
| `GET` | `/api/samples/:filename` | Download a sample `.inp` file | -- | Raw file stream |
| `POST` | `/api/upload` | Upload `.inp` files, create batch job | `multipart/form-data` (field: `files`) | `BatchJob` object |
| `POST` | `/api/batch/:jobId/start` | Start processing a batch job | -- | `{ message: "Processing started" }` |
| `POST` | `/api/batch/:jobId/cancel` | Cancel a running job | -- | `{ message: "Processing cancelled" }` |
| `GET` | `/api/batch/:jobId` | Get current job status and results | -- | `BatchJob` object |

### WebSocket

| Direction | Path | Query Params | Auth |
|-----------|------|-------------|------|
| Client to Server | `ws[s]://host/api/ws` | `jobId` (required) | Job ID as implicit auth |
| Server to Client | -- | -- | See Message Types in Section 9 |

### Sample Files Endpoint Detail
`GET /api/samples` returns:
```json
[
  {
    "name": "user1.inp",
    "size": 41030,
    "title": "TEST MODEL - Example Drainage Network"
  },
  ...
]
```
The `title` field is extracted from the `[TITLE]` section of each `.inp` file.

---

## 16. File Size Reference

| File | Lines | Purpose |
|------|-------|---------|
| `ReswmmPage.tsx` | 1,323 | Largest frontend file -- discretization UI + simulation comparison |
| `routes.ts` | 1,018 | All backend logic: API + WebSocket + parsers |
| `FolderView.tsx` | 930 | File browser with network map |
| `index.css` | 736 | All theme definitions + Tailwind utilities |
| `Documentation.tsx` | 684 | Technical docs tabs |
| `ResultsDisplay.tsx` | 659 | Results viewer with 4 tabs |
| `Home.tsx` | 533 | Batch processing page |
| `InteractiveCharts.tsx` | 492 | Time series chart parser + renderer |
| `reswmmEngine.ts` | 444 | Discretization engine (client-side) |
| `inpParser.ts` | 427 | INP file parser (client-side) |
| `Dashboard.tsx` | 394 | Results dashboard with 4 chart types |
| `reportGenerator.ts` | 360 | HTML/MD/CSV report export |
| `ThemeToggle.tsx` | 125 | Theme + dark mode selector |
| `AppHeader.tsx` | 109 | Shared navigation header |
| `schema.ts` | 95 | Zod schemas + TypeScript types |
| `queryClient.ts` | 57 | TanStack Query configuration |
| `storage.ts` | 44 | In-memory BatchJob storage |
| `App.tsx` | 37 | Router + providers |
| `resultsStore.ts` | 17 | Cross-page results passing |
| **Total (key files)** | **8,484** | |

---

## 17. Known Quirks and Gotchas

### Critical: Multer Hashed Filenames
Multer stores uploads with hashed filenames and **no extension**. The original filename is in `file.originalname` but the disk path has no `.inp` suffix.

**Correct:** `reportPath = inputPath + '.rpt'`
**Wrong:** `reportPath = inputPath.replace('.inp', '.rpt')` -- this does nothing because there is no `.inp` to replace. The string is unchanged and the report would overwrite the input file.

### Icon Import Conflict
Never import `Map` from `lucide-react` in a file that uses JavaScript's `new Map()`. Use the alias `MapIcon` instead:
```typescript
import { Map as MapIcon } from "lucide-react";
```
Without this alias, TypeScript silently replaces the built-in `Map` constructor with the lucide-react icon component, causing cryptic runtime errors.

### WebSocket Race Condition
If the client connects to the WebSocket after the server has already started sending progress messages, messages could be lost. The `messageBuffers` Map and 500ms processing delay prevent this, but be aware:
- The 500ms delay is in `setTimeout(() => processFilesSequentially(...), 500)` in the `/api/batch/:jobId/start` handler
- If a client connects after processing is done, buffered messages are flushed but timing is not guaranteed

### `completed` Without `result`
In edge cases, the server may send a `completed` message without a preceding `result` message for a file. Both FolderView and ReswmmPage handle this by generating a fallback "failed" `ProcessResult`:
```typescript
const finalResult = collectedResult || {
  id: 'unknown', fileName: runFileName, filePath: '',
  status: 'failed' as const,
  error: 'No result received from server',
};
```

### Continuity Error Threshold Inconsistency
The `reportToHtml()` function in `ResultsDisplay.tsx` uses a 0.1% threshold for coloring (red for >0.1%). The rest of the app uses green <= 1%, yellow 1-5%, red > 5%. These are intentionally different -- the HTML report view applies a stricter visual standard for engineers reviewing individual reports.

### TanStack Query v5
Only the object form is supported: `useQuery({ queryKey: ['key'] })` not `useQuery(['key'])`. The default `queryFn` is pre-configured, so queries don't need to define their own fetch function -- just provide the query key as the API path:
```typescript
const { data } = useQuery({ queryKey: ['/api/samples'] }); // queryFn auto-provided
```

### Vite Configuration (DO NOT MODIFY)
`server/vite.ts` and `vite.config.ts` must **never** be modified. They handle dev HMR middleware, path aliases (`@/`, `@shared/`, `@assets/`), and production static file serving. Do not add proxies or modify aliases.

### Package.json (DO NOT EDIT DIRECTLY)
Must **never** be edited directly. Use the Replit package installer tool for adding dependencies.

### drizzle.config.ts
Drizzle ORM is configured but not active. The `DATABASE_URL` environment variable can be set for PostgreSQL but the app currently uses in-memory storage only.

### ReportContent Size
For large models, `reportContent` can be very large (6+ MB) because it includes both the `.rpt` text and time series data from the `.out` binary. This flows through WebSocket as a single JSON message. The `LargeTextViewer` component handles rendering performance by truncating to 2,000 lines initially.

### SWMM Binary Output Truncation
The `.out` parser limits extraction to 2,000 reporting periods to prevent enormous text output. For a typical 5-minute report step, this covers ~7 days of simulation. Longer simulations will have their later periods silently omitted from the graphs.

### Sample Files
The 5 bundled sample files in `public/samples/` range from 545 to 5,062 lines. They are real SWMM models that produce valid results with the bundled binary.

---

## 18. Planned Features (Not Yet Implemented)

These have schema types defined in `shared/schema.ts` but no frontend or backend implementation:

1. **Parameter Sweep Mode** (`SweepConfig`): Run a single model multiple times with varying parameter values (e.g., roughness, slope) and compare results.

2. **Design Storm Sweep** (`DesignStormConfig`, `DesignStormEntry`): Run a model against multiple design storms (different return periods and SCS rainfall distributions) and compile comparative results.

3. **Model Comparison Report Generator**: Generate comprehensive side-by-side reports comparing multiple models' performance.

4. **Standalone HTML Report for Single Files**: An enhanced HTML version of the `.rpt` file with proper tables, colored metrics, and embedded charts (as opposed to the current basic `reportToHtml()` line-by-line styling).

---

## 19. Build and Deployment

### Development
```bash
npm run dev
# Runs: NODE_ENV=development tsx server/index.ts
# Vite dev server with HMR on the same port (5000)
# Backend and frontend served together via Vite middleware
# Auto-restarts on file changes via Replit workflow
```

### Production Build
```bash
npm run build
# Step 1: vite build -> dist/public/ (frontend assets: JS, CSS, HTML)
# Step 2: esbuild server/index.ts -> dist/index.js (ESM bundle)
```

### Production Start
```bash
npm start
# Runs: NODE_ENV=production node dist/index.js
# Serves static files from dist/public/
# SWMM binary must be at swmm-engine/runswmm relative to CWD
```

### Environment Variables
| Variable | Purpose | Default | Required |
|----------|---------|---------|----------|
| `NODE_ENV` | development/production mode | -- | No (auto-set by scripts) |
| `PORT` | Server port | 5000 | No |
| `RUNSWMM_PATH` | Custom absolute path to SWMM binary | Auto-detected | No |
| `DATABASE_URL` | PostgreSQL connection string (unused) | -- | No |

### Replit Workflow
The `Start application` workflow runs `npm run dev`. It auto-restarts on file changes. This is the only configured workflow.

### Production Deployment Notes
- The `swmm-engine/runswmm` binary must be included in the deployment
- The `uploads/` directory must be writable
- The `public/samples/` directory should be present for sample models
- In-memory storage means all batch jobs are lost on restart

---

## 20. Dependencies

### Runtime Dependencies (Key)
| Package | Version | Purpose |
|---------|---------|---------|
| `react` | 18.3.1 | UI framework |
| `react-dom` | 18.3.1 | DOM rendering |
| `express` | 4.21.2 | HTTP server |
| `ws` | 8.18.0 | WebSocket server |
| `multer` | 2.1.0 | File upload middleware (multipart/form-data) |
| `recharts` | 2.15.4 | Charts and graphs (BarChart, PieChart, LineChart, AreaChart) |
| `wouter` | 3.3.5 | Client-side routing (lightweight React Router alternative) |
| `@tanstack/react-query` | 5.60.5 | Server state management, caching, auto-refetch |
| `zod` | 3.24.2 | Schema validation (shared between frontend and backend) |
| `tailwind-merge` | 2.6.0 | CSS class merging for conditional Tailwind classes |
| `lucide-react` | 0.453.0 | Icon library (400+ icons) |
| `framer-motion` | 11.13.1 | Animations and transitions |
| `drizzle-orm` | 0.39.1 | Database ORM (configured but not active) |
| `drizzle-zod` | 0.7.0 | Drizzle-Zod integration for insert schemas |
| `clsx` | 2.1.1 | Conditional className utility |
| `class-variance-authority` | 0.7.1 | Shadcn component variant definitions |
| `@radix-ui/*` | Various | Headless UI primitives (used by Shadcn components) |
| `@hookform/resolvers` | 3.9.1 | Zod resolver for react-hook-form |
| `react-hook-form` | 7.54.2 | Form state management |

### Dev Dependencies (Key)
| Package | Version | Purpose |
|---------|---------|---------|
| `vite` | (via config) | Build tool + dev server + HMR |
| `esbuild` | (via config) | Backend TypeScript bundler |
| `tsx` | (via config) | TypeScript execution (replaces ts-node) |
| `tailwindcss` | (via config) | CSS framework |
| `postcss` | (via config) | CSS processing pipeline |
| `autoprefixer` | (via config) | CSS vendor prefixing |
| `@types/express` | (via config) | Express TypeScript definitions |
| `@types/ws` | (via config) | WebSocket TypeScript definitions |
| `@replit/vite-plugin-*` | Various | Replit dev tooling plugins |

---

## 21. Improvement Roadmap

### Current Assessment: A- / 88 out of 100

```
CATEGORY                          MAX    SCORE
------------------------------------------------------
Core Batch Processing              15      14
  Real SWMM 5.2.4 binary bundled
  WebSocket real-time per-file progress
  Parallel/sequential + stop-on-error
  Binary .out parser for time series
  -1: no parameter sweep yet

File Inspection (Folder View)      10       9
  Client-side INP parser (15 sections)
  SVG network map (nodes, conduits, subcatchments)
  Conduit length statistics + histogram
  Element count grid
  -1: no hover/click on map elements

ReSWMM Discretization              12      11
  Fixed Interval + dx/D Ratio methods
  CFL analysis per conduit
  Conduit lengthening with physics-based minLength
  Before/after simulation comparison (table + charts)
  INP rebuild with proper formatting
  -1: no batch discretization (one file at a time)

Results & Visualization            12      10
  Interactive time-series charts (Recharts)
  Real .out binary data (not mock)
  Continuity error traffic lights
  Flooding summary
  Dashboard with 4 chart types
  Per-file expandable RPT viewer
  -2: no cross-model comparison charts in batch

Report Generation                   8       8
  HTML with color-coded tables + recommendations
  Markdown export
  CSV export
  Analysis + recommendations engine

Real-Time Communication             8       8
  WebSocket with 7 message types
  Per-file progress (0-100%)
  Message buffering for race conditions
  Graceful fallback for edge cases

Setup & Onboarding                  8       8
  SWMM engine auto-detected and bundled
  5 sample models (545-5062 lines each)
  Zero configuration needed
  Simulation mode fallback

UI / UX                            10       9
  5 university themes + dark mode
  Shared navigation header
  Drag-and-drop + file picker + directory picker
  47 Shadcn/ui components
  Consistent visual language
  -1: some large page files (ReswmmPage 1,323 lines)

Documentation                       7       7
  Full technical docs tab (4 sections)
  WebSocket protocol docs
  ReSWMM engine docs with worked examples
  SWMM5 C source references
  Comprehensive HANDOVER.md

Ecosystem Integration              10       4
  -6: No links to INP MAKER, Engine,
  Rain Canvas, Rosetta Stone, Miner
  "Open in Results Dashboard" is internal only
------------------------------------------------------
TOTAL                             100      88
```

---

### Tier 1: Quick Wins (< 1 week each)

#### Improvement 1: Parameter Sweep Mode

**Status:** Schema types already exist in `shared/schema.ts` (`SweepConfig`, `SweepResult`)
**Effort:** 3-5 days
**Impact:** +4 points

The most-requested feature for stormwater engineers. Run a single model multiple times with varying parameter values and compare results.

**What to build:**
- New mode toggle on the Home page: "Batch Files" vs "Parameter Sweep"
- Upload one base `.inp` file
- Select sweep parameter (Manning's n, Imperviousness, Conduit Slope, etc.)
- Enter array of values to test
- Click "Start Sweep" -- generates modified `.inp` variants client-side, uploads all, runs through existing batch pipeline

**Implementation approach:**
- `modifyParameter(inpContent, paramName, value)` function modifies specific sections of the INP file
  - `manning_n`: Replace roughness values in `[CONDUITS]` section
  - `imperviousness`: Replace `%Imperv` in `[SUBCATCHMENTS]`
  - `conduit_slope`: Modify invert elevations to achieve target slope
- Each variant becomes a virtual `.inp` file uploaded to the existing `/api/upload` endpoint
- Existing WebSocket + batch pipeline handles the rest
- Results display: table of parameter value vs. peak flow, CE, flooding + line charts

**Key files to modify:**
- `client/src/pages/Home.tsx` -- add sweep mode UI
- `client/src/lib/inpParser.ts` -- may need parameter modification helpers
- `client/src/components/ResultsDisplay.tsx` -- add sweep-specific visualization

---

#### Improvement 2: Design Storm Sweep

**Status:** Schema types already exist in `shared/schema.ts` (`DesignStormEntry`, `DesignStormConfig`)
**Effort:** 3-5 days
**Impact:** +3 points

Automates the most common SWMM workflow: run a model against multiple design storms to determine system capacity.

**What to build:**
- Standalone section or new page
- Upload one base `.inp` file
- Select storms to run (checkboxes):
  - 2-year, 6-hour (1.5 inches) SCS Type II
  - 10-year, 6-hour (2.8 inches) SCS Type II
  - 25-year, 6-hour (3.5 inches) SCS Type II
  - 100-year, 6-hour (5.0 inches) SCS Type II
- Select rainfall distribution (SCS Type I, IA, II, III)
- Select storm duration (1hr, 2hr, 6hr, 12hr, 24hr)

**Implementation approach:**
- `generateStormTimeseries(totalDepth, durationHours, distribution)` creates incremental rainfall data
- SCS Type II normalized cumulative distribution (18 time-fraction/precipitation-fraction pairs)
- For each storm, replace the `[TIMESERIES]` and `[RAINGAGES]` sections in the `.inp` file
- Upload all variants to existing batch pipeline
- Results table: Storm vs. Peak Flow vs. Flooding vs. Surcharged vs. CE
- Key output: "System handles up to X-year storm without flooding"

**SCS Type II distribution data (normalized cumulative):**
```
Time Fraction:  0.0   0.1   0.2   0.3   0.35  0.4   0.42  0.44  0.46  0.48  0.50  0.52  0.55  0.6   0.7   0.8   0.9   1.0
Precip Fraction: 0.000 0.022 0.048 0.080 0.120 0.181 0.235 0.332 0.500 0.668 0.765 0.819 0.880 0.920 0.952 0.973 0.989 1.000
```

---

#### Improvement 3: Ecosystem Integration Buttons

**Effort:** 1 day
**Impact:** +3 points

BatchSWMM currently has no links to any other app in the SWMM suite.

**Ecosystem apps to link:**

| App | URL | Where to Link |
|-----|-----|---------------|
| INP MAKER | `https://swmm-inp-maker.replit.app` | Home page ("Need models?"), Folder View |
| Simulation Engine | `https://swmm-engine--robertdickinson.replit.app` | Results (per-file "Analyze"), ReSWMM |
| Rain Canvas Studio | `https://rain-canvas-studio.lovable.app` | Home page, Design Storm Sweep |
| Rosetta Stone | `https://code-rosetta-stone.replit.app` | ReSWMM (theory), Documentation |
| Model Miner | `https://swmm-filebase--robertdickinson.replit.app` | Results (per-file "Inspect"), Folder View |

**Implementation:** Reusable `EcosystemButton` component that opens external apps, optionally passing model data via `postMessage`.

---

#### Improvement 4: RPT Summary Dashboard (Cross-Model Comparison)

**Effort:** 2-3 days
**Impact:** +2 points

**Current state:** Results show pass/fail + raw metrics per file. `parseReportMetrics()` already extracts 11 metrics.

**What to add:**
- Sortable comparison table across all batch files (Model / Status / Runoff CE / Routing CE / Peak Flow / Flooding)
- Warning callouts for models exceeding thresholds
- Cross-model comparison bar charts (Peak Flow, CE, Flooding across all models)
- "Compare All" button for side-by-side visualization

---

### Tier 2: Medium Effort (1-2 weeks each)

#### Improvement 5: Clickable SVG Network Map

**Effort:** 2-3 days
**Impact:** +2 points

**Current state:** SVG network map in Folder View shows nodes and conduits but they are not interactive.

**What to add:**
- Hover tooltips on conduits: name, diameter, length, roughness
- Hover tooltips on nodes: name, elevation, max depth
- Click to select and show full properties panel
- Color scheme selector: Default / By Diameter / By Slope / By Length / By Manning's n
- Legend showing color scale
- Highlight connected elements on selection

**Key file:** `client/src/components/NetworkMap.tsx` -- add event handlers to SVG `<line>` and `<circle>` elements

---

#### Improvement 6: WASM Engine Option (Browser-Side Simulation)

**Effort:** 2-3 weeks
**Impact:** +3 points

For small models (< 500 nodes), running SWMM in the browser via WebAssembly eliminates server round-trips and works offline.

**What to add:**
- Toggle: "Server (SWMM 5.2.4 binary)" vs "Browser (WASM)"
- Compile SWMM 5.2.4 C source with Emscripten to `.wasm`
- Run via Web Workers for non-blocking execution
- Parallel runs possible (one worker per file)
- Automatic fallback when server engine is unavailable

---

#### Improvement 7: Persistent Job History (PostgreSQL)

**Effort:** 1-2 days
**Impact:** +1 point

**Current state:** In-memory `Map<string, BatchJob>` -- data lost on restart. Drizzle ORM and `DATABASE_URL` are already configured but unused.

**What to add:**
- `batch_jobs` table: id, status, created_at, completed_at, file_count, success_count, failed_count, total_time_seconds, results_json (JSONB)
- Swap `MemStorage` for `DatabaseStorage` implementing the same `IStorage` interface
- "Recent Jobs" list on Home page
- Re-download results from past jobs
- Analytics: "You've processed N models this month"

---

### Tier 3: Advanced Features (2-4 weeks each)

#### Improvement 8: Rain Canvas Integration for Design Storms

**Effort:** 1-2 weeks
**Impact:** +2 points

Instead of hardcoded SCS Type II, connect to Rain Canvas Studio's 66 rainfall distributions:
- SCS Type I, IA, II, III
- Euler Type I, Type II
- Chicago Design Storm
- Huff 1st-4th Quartile
- Australian ARR
- Japan JMA
- And 55+ more

Either embed distributions as a local JSON file or call Rain Canvas API.

---

#### Improvement 9: Batch ReSWMM (Discretize All Files)

**Effort:** 1 week
**Impact:** +2 points

**Current state:** ReSWMM works on one file at a time.

**What to add:**
- Load multiple `.inp` files
- Apply same discretization config to all
- Run all original + all discretized through SWMM
- Results table: File / Original CE / Discretized CE / Delta CE / Improvement %
- Summary: "Average CE improvement: -52%"

The `reswmmEngine.ts` already handles single-file discretization. Batch is a loop around it.

---

#### Improvement 10: Model Comparison Report Generator

**Effort:** 1 week
**Impact:** +1 point

Already listed in Planned Features (Section 18). The `reportGenerator.ts` (360 lines) already does most of the analysis. Additions needed:
- Cross-model comparison table with sortable columns
- Best/worst model identification per metric
- Side-by-side hydrograph overlay charts
- Automated recommendations based on comparative performance
- Export as standalone HTML with embedded charts

---

### Projected Grade Trajectory

```
CURRENT STATE:                                   A- (88)

After Tier 1 (1-2 weeks total):
  + Parameter Sweep .................. +4 -> 92
  + Design Storm Sweep .............. +1 -> 93
  + Ecosystem Integration ........... +3 -> 96
  + RPT Summary Dashboard ........... +2 -> 98

After Tier 2 (3-5 additional weeks):
  + Clickable Network Map ........... +1 -> 99
  + WASM Engine Option .............. to be evaluated
  + Persistent Job History ........... to be evaluated

After Tier 3 (additional 4-7 weeks):
  + Rain Canvas Integration ......... to be evaluated
  + Batch ReSWMM .................... to be evaluated
  + Model Comparison Reports ........ to be evaluated
```

**Bottom line:** Tier 1 alone (roughly 2 weeks of work) would bring the score from 88 to approximately 98, primarily because the Zod schemas and batch pipeline already exist -- the work is mostly frontend UI and INP file manipulation, both of which are well-established patterns in this codebase.

---

*End of Handover Document*
