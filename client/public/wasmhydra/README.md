# Hydra WASM bundle

This directory contains the browser bundle used by the Hydra engine mode.

## Provenance

- Upstream: <https://github.com/neeraip/hydra>
- Release: `v12.1.0`
- Commit: `2a75372531b981c3a8f6668cbb846a0366cf062d`
- Crate: `crates/demo`
- Engine selected by the adapter: `uds`
- License: AGPL-3.0 (`LICENSE-AGPL-3.0.txt`)

The upstream source was not modified. `hydra.js` and `hydra_bg.wasm` are
generated from the tagged source. `hydra-worker.js` is this application's
adapter source and remains alongside the generated bundle.

## Rebuild

Hydra v12.1.0 requires Rust 1.95 and the `wasm32-unknown-unknown` target.
From an exact checkout of the commit above:

```sh
rustup toolchain install 1.95.0 --profile minimal
rustup target add wasm32-unknown-unknown --toolchain 1.95.0
wasm-pack build crates/demo \
  --target no-modules \
  --out-dir /tmp/hydra-wasm \
  --out-name hydra \
  --release
```

The bundled artifact was built with wasm-pack 0.12.1 and these Cargo profile
overrides to avoid release LTO exhausting the Replit build window:

```sh
CARGO_PROFILE_RELEASE_LTO=false
CARGO_PROFILE_RELEASE_CODEGEN_UNITS=8
```

Copy `hydra.js` and `hydra_bg.wasm` from the output directory here. The
`no-modules` target is intentional: the dedicated classic Web Worker loads the
wasm-bindgen glue with `importScripts`, while cancellation and timeout are
implemented by terminating that worker.

On this Replit/NixOS environment, Rust 1.95 also required:

```sh
GLIBC_TUNABLES=glibc.rtld.optional_static_tls=32768
```

and the 64-bit Nix zlib directory in `LD_LIBRARY_PATH` while linking.

## Artifact checksums

```text
hydra.js       5d87a6674843f6f5de9a92b2ae0ed3741e41559da15fdce355a7d8d10408ca84
hydra_bg.wasm  aca71c11ae71faf138702365db3a8cc09a4b34a1d65b114158a044d4c86acf65
```

## Runtime behavior

The worker:

1. creates `RunOptions` from the SWMM INP bytes,
2. explicitly selects `uds`,
3. advances cooperatively in bounded chunks and reports progress,
4. captures the SWMM-compatible binary results,
5. returns Hydra's text report plus parsed time-series sections.

Hydra is an independent engine. SWMM input/output compatibility does not imply
numerical equivalence with EPA SWMM or OpenSWMM.