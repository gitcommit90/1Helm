Audio decoders for the in-Worker audio converter (src/audio-convert.js). Source files are copied from npm packages with the edits listed here.
The .wasm files are imported as compiled modules (wrangler's default CompiledWasm rule); the Worker cannot compile WebAssembly from bytes at run time.

- opus.wasm, opus-decoder.js, opus-emscripten.js: opus-decoder 0.7.12 (MIT, libopus, BSD-3-Clause). The embedded base64 copy of the wasm is removed.
- sym.wasm: Symphonia 0.6.1 (MPL-2.0) codecs for AAC-LC, mp3, FLAC, Vorbis and ALAC, built from tools/symphonia-wasm (run tools/symphonia-wasm/build.sh). It has no imports. sym-decoder.js is this project's JavaScript wrapper for it.
- wasm-common.js: @wasm-audio-decoders/common 9.0.7 (MIT) without its dynEncode/puff inflater (the compiled module is always passed in).
The opus wasm file was extracted from the package's own embedded copy, unchanged. See THIRD-PARTY-NOTICES.md.
