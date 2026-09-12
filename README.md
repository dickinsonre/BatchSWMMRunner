# BatchSWMM56

Batch runner for EPA SWMM models. Upload one or many SWMM `.inp` files, run them through your choice of SWMM engine, and inspect per-file report summaries, time-series graphs, continuity errors, and warnings — all from the browser. Results can be exported as CSV, Excel, PDF, generated reports, or a ZIP archive of the raw `.rpt`/`.inp` outputs.

Built with a React/TypeScript frontend, an Express backend, and PostgreSQL for job storage.

## Engine modes

| Mode | Engine | Where it runs |
|---|---|---|
| Executable | EPA SWMM 5.2 (`runswmm`, bundled in `swmm-engine/`) | Server |
| API | SWMM 5.2 shared library, called via the SWMM5 C API (koffi FFI) | Server, with live node/link snapshots streamed during the run |
| WASM | EPA SWMM 5.2 compiled to WebAssembly | Entirely in your browser — files never leave your device |
| WASM6 | OpenSWMM 6.0.0-alpha.4 (`swmm6_rel`) compiled to WebAssembly | Entirely in your browser |
| WASM6 Dev | OpenSWMM 6.0.0-alpha (`develop`) compiled to WebAssembly | Entirely in your browser |
| Hydra | Hydra UDS compiled to WebAssembly | Entirely in your browser |

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

The in-app `/docs` page mirrors this, plus a user guide and engine-mode reference.

## Third-party licenses and attribution

The BatchSWMM56 application is MIT licensed; see the root
[`LICENSE`](LICENSE). The root [`NOTICE`](NOTICE), which is also served as
[`client/public/NOTICE.txt`](client/public/NOTICE.txt), records the boundaries
between the application and bundled engines. Third-party components remain
under their own terms; the license of a bundled engine does not license the
rest of this application.

The bundled OpenSWMM 6 WebAssembly engines are object-code builds of
[HydroCouple's OpenSWMM Engine](https://github.com/HydroCouple/openswmm.engine):

- SWMM6 WASM: `swmm6_rel` commit
  `137e65e4e25e9425a489b99d5b7365c8355f8f6b` (2026-09-10).
- SWMM6 Dev: `develop` commit
  `19a1bc42074eac8cdf46e2edafe6fc5849adf6da` (2026-08-11).

The stable snapshot is Apache-2.0 licensed; see its bundled
[full license](client/public/licenses/openswmm/LICENSE.txt) and verbatim
upstream [NOTICE](client/public/licenses/openswmm/NOTICE.txt). The development
snapshot is MIT licensed and had no upstream NOTICE at its recorded commit; see
its bundled [MIT license](client/public/licenses/openswmm/LICENSE-DEVELOP-MIT.txt).
The OWA SWMM browser artifact is a 5.1-lineage build with unknown source ref
and build recipe; its exact upstream MIT license is bundled at
[`client/public/licenses/MIT-OWA-SWMM.txt`](client/public/licenses/MIT-OWA-SWMM.txt).
The [provenance/modification record](client/public/licenses/openswmm/PROVENANCE.md)
and [browser-build dependency audit](client/public/licenses/openswmm/DEPENDENCY_AUDIT.md)
explain the per-artifact treatment and confirm that declared optional
dependencies are not linked into these builds. The redistributed compiler
runtime notices are also bundled for
[Emscripten](client/public/licenses/openswmm/EMSCRIPTEN-LICENSE.txt) and
[musl libc](client/public/licenses/openswmm/MUSL-COPYRIGHT.txt).
The build manifests in `client/public/wasm6/` and
`client/public/wasm6dev/` contain artifact hashes.

The shared machine-readable identity record for all five browser engines is
[`client/public/engines.json`](client/public/engines.json), served at
`/engines.json` after deployment. It includes JavaScript and WASM hashes,
measured byte sizes, binary fingerprints, source/build metadata, and legal-file
hashes; missing historical provenance is represented as unknown rather than
inferred. It covers the EPA SWMM, OWA SWMM, stable/development OpenSWMM, and
Hydra WASM files shipped from `client/public`. See
[`docs/engine-manifest.md`](docs/engine-manifest.md) for the schema, companion
repository sharing contract, and update process. `npm test` validates the
manifest before running Vitest, and `npm run build` validates the deployed
manifest and required notices in `dist/public`.

Portions of OpenSWMM are derived from United States Government public-domain
EPA SWMM material, as detailed in the NOTICE. Neither the United States
Environmental Protection Agency, HydroCouple, nor the OpenSWMM authors endorse
BatchSWMM56; their names identify origin and attribution only.

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
