# BatchSWMM56

> **Full-stack web application for uploading, discretizing, and batch-running EPA SWMM models through the browser — with multi-engine support, real-time progress, AI-powered report analysis, and ZIP export.**

[![CI](https://github.com/dickinsonre/BatchSWMMRunner/actions/workflows/ci.yml/badge.svg)](https://github.com/dickinsonre/BatchSWMMRunner/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)

---

## Overview

BatchSWMM56 replaces the repetitive open-file → run → inspect loop with a single browser tab. Drop one or hundreds of `.inp` files onto the upload zone, choose an engine, configure optional solver overrides (routing step, flow-routing method, date range, inertial damping, …), and the application:

1. **Runs** every file through the selected SWMM engine.
2. **Parses** each `.rpt` output for continuity errors, warnings, time-series data, and key performance indicators.
3. **Displays** per-file summaries in a sortable, filterable results table with inline charts.
4. **Exports** results as CSV, Excel (`.xlsx`), PDF, AI-generated narrative report, or a ZIP archive of raw `.rpt`/`.inp` pairs.

The in-browser **WebAssembly modes** run simulations entirely on the client — files never leave your device. The **server modes** stream real-time progress over WebSocket and support live node/link data dashboards during API-mode runs.

---

## Engine Modes

| Mode | Engine binary | Execution context | Live snapshots |
|------|--------------|-------------------|----------------|
| **Executable** | EPA SWMM 5.2 `runswmm` (bundled in `swmm-engine/`) | Server process | No |
| **API** | EPA SWMM 5.2 shared library via koffi FFI (`libswmm5.so`) | Server in-process | Yes — node depths, link flows, link velocities streamed over WebSocket |
| **WASM** | EPA SWMM 5.2.4 compiled to WebAssembly with Emscripten | Browser web worker | No |
| **WASM6** | OpenSWMM 6.0.0-alpha.4 (`swmm6_rel`) compiled to WASM | Browser web worker | No |
| **WASM6 Dev** | OpenSWMM 6.0.0-alpha (`develop` branch) compiled to WASM | Browser web worker | No |
| **Hydra** | Hydra UDS compiled to WebAssembly | Browser web worker | No |

**Parallel processing** applies to in-browser WASM modes only: up to 4 web workers run concurrently (scaled to device hardware; large models run sequentially to conserve memory). Server modes process files one at a time.

The WASM modes are always available. Server modes require the bundled engine to be executable on the host — check `GET /api/swmm-status` to verify availability.

---

## Feature Highlights

### Batch Execution & Discretization
- Upload up to **500 `.inp` files** per batch (25 MB per file, 250 MB total).
- **Discretization sweeps** — vary routing step, report step, start/end date, flow-routing method, inertial damping, variable-step ratio, and lengthening step across a matrix of combinations.
- **Design storm sweeps** — run a single model across multiple design-storm configurations.
- Batch jobs are tied to the anonymous browser session and automatically deleted after **24 hours**.

### Real-Time Progress
- WebSocket connection (`/api/ws?jobId=…`) streams per-file status: `queued → running → complete/error`.
- API mode additionally streams `api_snapshot` messages at each report step, populating the **Live API Dashboard** (real-time line charts for node depths, link flows, and link velocities).

### Report Parsing
- Extracts continuity errors (surface runoff, flow routing), warnings, engine version, simulation period, and timestep from every `.rpt` file.
- Validates report structure and flags truncated or failed runs.
- Optionally parses the binary `.out` file for time-series data when present.

### AI-Powered Report Generation
- Sends parsed metrics to an OpenAI-compatible endpoint and generates a natural-language narrative report covering errors, warnings, and model health.
- Requires `AI_INTEGRATIONS_OPENAI_API_KEY` (and optionally `AI_INTEGRATIONS_OPENAI_BASE_URL` for alternative providers).

### GitHub Model Browser
- Browse and load `.inp` sample models directly from a configured GitHub repository without manual download.

### In-App Documentation
- `/docs` page with user guide, full engine-mode reference, and the HTTP/WebSocket API specification (also available as `/llms.txt` for LLM and script consumers).
- Searchable **SWMM5 API Guide** (5,400-line markdown document) rendered inline.

---

## Repository Layout

```
BatchSWMMRunner/
├── client/                  # React + Vite frontend (TypeScript)
│   ├── src/
│   │   ├── pages/           # Home, Results, Docs, API Dashboard pages
│   │   ├── components/      # Upload zone, results table, charts, modals
│   │   ├── hooks/           # useWebSocket, useBatch, useSwmmWasm, …
│   │   └── lib/
│   │       ├── swmmWasmEngine.ts   # WASM5 orchestration (web worker bridge)
│   │       └── swmm6WasmEngine.ts  # WASM6 orchestration
│   └── public/
│       ├── wasm/            # swmm5.js + swmm5.wasm (EPA SWMM 5.2.4)
│       ├── wasm6/           # openswmm6.js + .wasm (OpenSWMM stable)
│       ├── wasm6dev/        # openswmm6.js + .wasm (OpenSWMM dev)
│       ├── samples/         # Bundled sample .inp files
│       ├── engines.json     # Machine-readable engine identity manifest
│       ├── llms.txt         # HTTP + WS API reference for LLMs/scripts
│       └── NOTICE.txt       # Bundled engine attribution notices
├── server/                  # Express backend (TypeScript)
│   ├── index.ts             # App bootstrap, middleware, error handler
│   ├── routes.ts            # All HTTP routes and WebSocket server
│   ├── storage.ts           # PostgreSQL via Drizzle ORM (jobs, results)
│   ├── reportParser.ts      # .rpt text parser (metrics, warnings, version)
│   ├── swmmOutParser.ts     # Binary .out file time-series parser
│   ├── swmm5api.ts          # koffi FFI bridge to libswmm5.so (API mode)
│   ├── swmmInvocation.ts    # Engine path resolution (bundled vs override)
│   ├── session.ts           # Anonymous session middleware
│   └── githubModels.ts      # GitHub model browser integration
├── shared/                  # Types used by both client and server
│   ├── schema.ts            # Zod schemas + Drizzle table definitions
│   ├── inpOptions.ts        # INP override helpers, SWMM6 normalization
│   ├── inpScanner.ts        # Lightweight .inp section scanner
│   └── inpCaseNormalize.ts  # Case normalization for INP keywords
├── swmm-engine/             # Bundled EPA SWMM 5.2 executable + shared lib
├── swmm-source/             # C sources for the bundled SWMM 5 engines
├── swmm6-source/            # Source reference for SWMM 6 WASM builds
├── migrations/              # Plain-SQL migrations (applied in filename order)
├── tests/                   # Vitest integration tests
├── docs/                    # Engine manifest schema, contributing notes
├── scripts/                 # Build and maintenance helper scripts
├── .github/workflows/       # CI (ci.yml): typecheck + tests on push/PR
├── package.json
├── vite.config.ts
├── tailwind.config.ts
├── drizzle.config.ts
├── tsconfig.json
└── vitest.config.ts
```

---

## Getting Started

### Prerequisites

- **Node.js 20+**
- **PostgreSQL** (any recent version)

### Installation

```bash
git clone https://github.com/dickinsonre/BatchSWMMRunner.git
cd BatchSWMMRunner
npm install
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | **Yes** | PostgreSQL connection string, e.g. `postgres://user:pass@localhost:5432/batchswmm` |
| `SESSION_SECRET` | **Yes** | Random string for signing anonymous session cookies |
| `RUNSWMM_PATH` | No | Override the bundled `runswmm` path with a custom SWMM executable |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | No | Enables AI narrative report generation |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | No | Alternative OpenAI-compatible base URL (e.g. Azure, local Ollama) |
| `PORT` | No | HTTP port (default `5000`) |

### Database Setup

Apply the plain-SQL migrations in order before first run:

```bash
for f in migrations/*.sql; do psql "$DATABASE_URL" -f "$f"; done
```

### Development Server

```bash
npm run dev       # Vite + Express on http://localhost:5000
```

### Production Build

```bash
npm run build     # Compiles client (Vite) and server (esbuild)
npm run start     # Serves the built app
```

The build step also validates the `engines.json` manifest and verifies that all required notice files are present in `dist/public`.

---

## HTTP & WebSocket API

The full API reference is available at `/llms.txt` (served at runtime) and mirrored in the in-app `/docs` page. The core workflow:

```
POST /api/upload               # Upload .inp files → returns jobId
POST /api/batch/{jobId}/start  # Set engine, overrides, launch batch
GET  /api/batch/{jobId}        # Poll job status and per-file results
GET  /api/batch/{jobId}/results/{resultId}/content  # Fetch raw .rpt text

WS   /api/ws?jobId={jobId}     # WebSocket stream (progress + API snapshots)
```

### Key Limits

| Limit | Value |
|-------|-------|
| Max files per batch | 500 |
| Max file size | 25 MB |
| Max total upload size | 250 MB |
| Job timeout (configurable) | 10–60 minutes |
| Job retention | 24 hours |
| Max concurrent server jobs | 4 |
| WASM parallel workers | Up to 4 (browser) |

### Solver Overrides (passed to `POST /api/batch/{id}/start`)

All fields are optional and validated server-side before any file is run.

| Override | Type | Valid range / values |
|----------|------|----------------------|
| `reportStepMinutes` | number | `> 0`, `≤ 1440` |
| `routingStepSeconds` | number | `> 0`, `≤ 3600` |
| `flowRouting` | string | `steady`, `kinematic`, `dynamic` |
| `startDate` | string | ISO 8601 `YYYY-MM-DD` |
| `endDate` | string | ISO 8601 `YYYY-MM-DD`, must be ≥ `startDate` |
| `variableStep` | number | `0–2` |
| `lengtheningStep` | number | `0–3600` seconds |
| `inertialDamping` | string | `NONE`, `PARTIAL`, `FULL` |

> **Note:** SWMM6-specific solver keywords are rejected for server (SWMM 5.x) modes to prevent ERROR 205 failures across the entire batch.

### Deep Links & Browser Automation

Pre-select an engine and load a sample model on page open:

```
/?engine=wasm6&sample=Demo_extran2.inp
```

Stable `data-testid` attributes on all interactive elements support Playwright / Puppeteer automation. See `/llms.txt` for the full list.

---

## Testing

```bash
npm test          # Vitest integration tests (run serially — shared uploads dir)
npm run check     # TypeScript typecheck only
npm run verify    # typecheck + tests (what CI runs)
```

CI runs `npm run verify` on every push and pull request via GitHub Actions (`.github/workflows/ci.yml`), using a PostgreSQL service container. The test suite also validates `engines.json` manifest integrity before running Vitest.

---

## INP Override Internals

Overrides are applied by `shared/inpOptions.ts` before the engine sees the file. The module handles:

- **Section patching** — rewrites `[OPTIONS]` keys in-place, preserving all other content.
- **Virtual junction stripping** — removes virtual junction nodes that are incompatible with certain engine modes (`hasVirtualJunctions`, `stripVirtualJunctions`).
- **EXTRAN8 hotstart rewriting** — adjusts hotstart file paths when the working directory changes (`needsExtran8Hotstart`, `rewriteHotstartPath`).
- **SWMM6 normalization** — detects and routes SWMM6-only keywords to the correct engine.
- **Matrix variant cap** — `MAX_MATRIX_VARIANTS` limits combinatorial sweep size to prevent runaway job counts.

---

## Engine Identity Manifest (`engines.json`)

`client/public/engines.json` (served at `/engines.json`) is a machine-readable record for all five browser engines. It includes:

- JavaScript and WASM SHA hashes and byte sizes
- Binary fingerprints
- Source commit references and build metadata
- Legal-file hashes

The schema is documented in [`docs/engine-manifest.md`](docs/engine-manifest.md). `npm test` validates the manifest before running Vitest; `npm run build` re-validates before deploying. Missing historical provenance is represented as `"unknown"` rather than inferred.

---

## Bundled OpenSWMM 6 Engines

The two WASM6 builds are object-code distributions of [HydroCouple's OpenSWMM Engine](https://github.com/HydroCouple/openswmm.engine):

| Artifact | Source commit | Date | License |
|----------|--------------|------|---------|
| `wasm6/` (stable) | `137e65e4…` | 2026-09-10 | Apache-2.0 |
| `wasm6dev/` (dev) | `19a1bc42…` | 2026-08-11 | MIT |

Full attribution notices, dependency audits, Emscripten runtime notices, and musl libc copyright are bundled under `client/public/licenses/openswmm/`.

---

## Security & Privacy

- **WASM modes**: `.inp` files are processed entirely in the browser. No data is sent to the server.
- **Server modes**: files are stored under `uploads/<jobId>/` for the duration of the batch, scoped to the anonymous session that uploaded them. Other sessions cannot access them. All files and database records are deleted automatically after 24 hours.
- **Rate limiting**: upload and batch-start endpoints are rate-limited with `express-rate-limit` (respects `X-Forwarded-For` when behind a proxy).
- **Session isolation**: each browser session receives a signed anonymous session cookie; job ownership is enforced server-side.
- **Upload validation**: only `.inp` files are accepted; size and count limits are enforced by multer before any processing begins.

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend framework | React 18 + TypeScript |
| Build tool | Vite |
| Styling | Tailwind CSS + shadcn/ui components |
| State / data fetching | TanStack Query (React Query) |
| Charts | Recharts |
| Backend framework | Express (Node.js) |
| Database ORM | Drizzle ORM |
| Database | PostgreSQL |
| WebSocket | `ws` library |
| FFI (API mode) | koffi |
| File upload | multer |
| Validation | Zod |
| Testing | Vitest |
| CI | GitHub Actions |
| WASM compilation | Emscripten (EPA SWMM 5.2.4) |

---

## License & Attribution

The BatchSWMM56 application is **MIT licensed**; see [`LICENSE`](LICENSE).

The bundled EPA SWMM 5.2 engine is public-domain U.S. government software. The bundled OpenSWMM 6 engines are Apache-2.0 / MIT licensed (see above). Third-party components remain under their own terms; see [`NOTICE`](NOTICE) and [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

Neither the U.S. Environmental Protection Agency, HydroCouple, nor the OpenSWMM authors endorse BatchSWMM56; their names identify origin and attribution only.

---

## Contributing

Pull requests and issues are welcome. Run `npm run verify` before submitting a PR — CI will reject any build that fails typecheck or tests. See [`HANDOVER.md`](HANDOVER.md) for a detailed technical handover, architecture notes, and known limitations.
