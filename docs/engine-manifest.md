# Browser engine manifest

`client/public/engines.json` is the one canonical, machine-readable identity
record for every WebAssembly engine shipped to the browser. Vite copies it to
`dist/public/engines.json`, so a deployed app serves it at `/engines.json`.
There is intentionally no independently maintained root `engines.json`.

## Manifest contract

The current contract is `schemaVersion: 1`. The `engines` object contains these
IDs:

- `swmm5` — the EPA SWMM 5.2.4 browser build.
- `swmm5-owa` — the OWA SWMM 5.1-lineage browser build.
- `wasm6` — the stable OpenSWMM 6.0.0-alpha.4 snapshot.
- `wasm6dev` — the OpenSWMM 6.0.0-alpha.3 develop snapshot.
- `hydra` — the independent Hydra 12.1.0 urban-drainage browser build.

Each engine records:

- source repository, branch, and commit when retained by the build evidence;
- compiler version and flags when a recipe records them;
- URL-relative paths, measured byte sizes, and SHA-256 digests for every
  shipped JavaScript/WASM/worker artifact;
- the source `BUILD_INFO.txt` or provenance README when one exists;
- URL-relative paths, measured byte sizes, and SHA-256 digests for legal files
  that are actually present in `client/public`;
- a binary version marker plus positive and negative feature fingerprints.

The stable OpenSWMM alpha.4 source commit and attribution are preserved from
the existing build record:
`swmm6_rel` commit
`137e65e4e25e9425a489b99d5b7365c8355f8f6b`. The development record remains
commit `19a1bc42074eac8cdf46e2edafe6fc5849adf6da` on `develop`. The supplied
alpha.3 manifest was not copied over the current stable artifact: its claims
would have described the wrong bytes and would have regressed stable
provenance.

Unknown information is represented deliberately. SWMM5 has no retained source
repository identity or bundled license text. OWA's repository is identifiable,
and its exact upstream MIT license text is shipped at
`client/public/licenses/MIT-OWA-SWMM.txt`, but its branch, commit, compiler
invocation, and modification status were not retained. Its runtime build number
is a format argument (`Build %s`) and cannot identify the binary. OWA therefore
has a verified legal file but remains `source.status: "unknown"`; the manifest
does not infer source provenance from that license.
`wasm6`, `wasm6dev`, and Hydra have the source and legal files recorded by their
retained build evidence. Missing historical facts must not be filled from
binary strings.

## Validation and CLI

The reusable schema validator checks the required engine IDs, strict schema,
safe URL-relative paths, measured bytes, SHA-256 digests, file existence,
version/fingerprint strings, and recursive coverage of all `.wasm` files under
`client/public`:

```bash
npm run validate:engines
```

The independent dependency-free CLI is useful before the rest of CI:

```bash
npm run engines:check       # verify; exits non-zero on any drift
npm run engines:update      # measure files, then atomically update metadata
node scripts/engine-manifest.mjs --list
```

`--update` changes only measured `bytes` and `sha256` descriptor fields. It
does not edit source commits, branches, compiler fields, fingerprints, version
markers, or legal attribution. It first measures every declared file and
validates a complete candidate, including fingerprint and undeclared-WASM
checks, before replacing the manifest. A missing file, malformed candidate,
fingerprint mismatch, or undeclared browser WASM leaves the manifest unchanged.
After an intentional rebuild, update fingerprints and provenance from retained
evidence by hand in the same change; do not use `--update` to hide a
provenance change.

`npm test` runs the existing schema validator and this CLI before Vitest.
GitHub Actions runs `engines:check` immediately after dependency installation,
before database setup and tests. Production builds run
`scripts/validate-dist.mjs` after Vite and the server bundle; that gate
validates the copied manifest, the root/public NOTICE equality, and required
OWA/OpenSWMM/Hydra notices in `dist/public`. These gates are additive and do
not replace the existing attribution checks.

## Updating an engine

Do not rebuild or replace a binary merely to refresh metadata. When an engine
is intentionally rebuilt:

1. Follow the relevant recipe in
   [`building-swmm5-wasm-engine.md`](./building-swmm5-wasm-engine.md),
   [`building-swmm6-wasm-engine.md`](./building-swmm6-wasm-engine.md), or the
   Hydra recipe retained in `client/public/wasmhydra/README.md`.
2. Preserve the exact source commit, compiler flags, linker evidence, local
   modifications, and applicable legal files. Update build/provenance records
   from evidence, not assumptions.
3. Refresh measured bytes and SHA-256 values with `npm run engines:update`.
   Review and update the version and positive/negative fingerprints only from
   the new artifact, and record any changed source provenance manually.
4. Run `npm run validate:engines`, the attribution tests, and
   `npm run build`. The build must finish with the production
   `dist/public` manifest and notice gate.

The companion repository should consume the deployed `/engines.json` rather
than copying this repository's prose or binary files. It can compare the
source-relative `path`, `bytes`, and `sha256` entries against a downloaded
deployment and reject an artifact whose bytes, schema, or feature fingerprint
no longer matches.