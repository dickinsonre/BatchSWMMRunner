---
name: Hydra WASM build on Replit
description: Non-obvious Rust 1.95 linker constraints when rebuilding Hydra's browser bundle in this Replit environment
---

Use Rust 1.95 with `GLIBC_TUNABLES=glibc.rtld.optional_static_tls=32768`, and derive the linker’s zlib directory from `ldd` on that toolchain’s `rustc`.

**Why:** Rust 1.95 otherwise exhausts static TLS here, while selecting the first `libz.so.1` found in the Nix store can pick a 32-bit library and fail with `wrong ELF class`. Nix dependency changes can also rebuild the environment and interrupt an in-progress compiler.

**How to apply:** let any Nix environment rebuild finish first, then resolve `libz.so.1` from `ldd "$TOOLCHAIN/bin/rustc"` and put only its directory in `LD_LIBRARY_PATH`. Run the build synchronously; background shell processes are terminated.