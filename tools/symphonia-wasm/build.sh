#!/usr/bin/env bash
# Builds src/vendor/audio/sym.wasm from this crate (Symphonia codecs, see src/lib.rs). Needs rustup with the wasm32-unknown-unknown target:
#   curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --target wasm32-unknown-unknown
# The crate versions are pinned by Cargo.lock; SIMD is switched on in .cargo/config.toml.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.cargo/bin:$PATH"
cargo build --release --locked --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/sym_audio.wasm ../../src/vendor/audio/sym.wasm
ls -l ../../src/vendor/audio/sym.wasm
