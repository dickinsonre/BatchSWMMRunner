# BatchSWMM56

Batch runner for EPA SWMM models. Upload one or many SWMM `.inp` files, run them through your choice of SWMM engine, and inspect per-file report summaries, time-series graphs, continuity errors, and warnings — all from the browser. Results can be exported as CSV, Excel, PDF, generated reports, or a ZIP archive of the raw `.rpt`/`.inp` outputs.

Built with a React/TypeScript frontend, an Express backend, and PostgreSQL for job storage.

## Engine modes

| Mode | Engine | Where it runs |
|---|---|---|
| Executable | EPA SWMM 5.2 (`runswmm`, bundled in `swmm-engine/`) | Server |
| API | SWMM 5.2 shared library, called via the SWMM5 C API (koffi FFI) | Server, with live node/link snapshots streamed during the run |
| WASM | EPA SWMM 5.2 compiled to WebAssembly | Entirely in your browser — files never leave your device |
| WASM6 | OpenSWMM `swmm6_rel` (SWMM 5.3) compiled to WebAssembly | Entirely in your browser |

The two WASM modes are always available. The server modes depend on the bundled engine being runnable on the host (see `GET /api/swmm-status`).

**Parallel processing** applies to the in-browser (WASM) modes only: files are distributed across up to 4 web workers (scaled to your device, large models run sequentially to conserve memory). Server modes run files one at a time.

## Getting started

Requirements: Node.js 20+, PostgreSQL.

```bash
npm install

# required environment variables
export DATABASE_URL=postgres://...   # job storage
export SESSION_SECRET=<random string> # signs the anonymous session cookie

# apply database migrations (plain SQL, in order)
for f in migrations/*.sql; do psql "$DATABASE_URL" -f "$f"; done

npm run dev        # development server on port 5000
```

For production: `npm run build` then `npm run start`.

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string for batch jobs and results |
| `SESSION_SECRET` | yes | Secret for the anonymous session cookie that ties jobs to the browser that created them |
| `RUNSWMM_PATH` | no | Path to a `runswmm`/`swmm5` executable, overriding the bundled engine |
| `AI_INTEGRATIONS_OPENAI_API_KEY` / `AI_INTEGRATIONS_OPENAI_BASE_URL` | no | Enables the AI report analysis features |
| `PORT` | no | Server port (default 5000) |

## Testing

```bash
npm test          # vitest (test files run serially — they share an uploads directory)
npm run check     # TypeScript typecheck
npm run verify    # typecheck + tests (what CI runs)
```

CI (GitHub Actions, `.github/workflows/ci.yml`) runs `npm run verify` against a PostgreSQL service on every push and pull request.

## What happens to uploaded files

- Server modes: `.inp` files are stored under `uploads/<jobId>/` while the batch runs; each job is owned by the anonymous browser session that uploaded it, and other sessions cannot see it.
- Jobs, results, and uploaded files are deleted automatically after 24 hours.
- WASM modes: files are processed entirely in your browser and are never uploaded.

## Automation

The app is scriptable — see [`client/public/llms.txt`](client/public/llms.txt) (served at `/llms.txt`) for:

- the HTTP API (`POST /api/upload` → `POST /api/batch/{id}/start` → poll `GET /api/batch/{id}` → fetch full report text per result from `GET /api/batch/{id}/results/{resultId}/content`),
- a WebSocket progress stream (`/api/ws?jobId=...`),
- stable `data-testid` attributes for browser automation, and
- deep links like `/?engine=wasm6&sample=Demo_extran2.inp`.

The in-app `/documentation` page mirrors this, plus a user guide and engine-mode reference.

## Repository layout

| Path | Purpose |
|---|---|
| `client/` | React frontend (Vite) |
| `server/` | Express backend: uploads, batch orchestration, SWMM execution, report parsing |
| `shared/` | Types and schema shared by client and server |
| `swmm-engine/` | Bundled EPA SWMM 5.2 executable and shared library |
| `swmm-source/` | SWMM C sources used to build the bundled engines |
| `migrations/` | Plain-SQL database migrations, applied in filename order |
| `public/samples/` | Bundled sample models |
| `tests/` | Vitest integration tests |
