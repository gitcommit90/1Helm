/* **************************************************
 * This file is auto-generated during the build process.
 * Any edits to this file will be overwritten.
 ****************************************************/

export default function EmscriptenWASM(WASMAudioDecoderCommon) {
// include: shell_minimal.js
var Module = Module;

// Override this function in a --pre-js file to get a signal for when
// compilation is ready. In that callback, call the function run() to start
// the program.
function ready() {}

// --pre-jses are emitted after the Module integration code, so that they can
// refer to Module (if they choose; they can also define Module)
// include: src/opus-decoder/src/emscripten-pre.js
Module = {};

// end include: src/opus-decoder/src/emscripten-pre.js
// end include: shell_minimal.js
// include: preamble_minimal.js
/** @param {string|number=} what */ function abort(what) {
  throw what;
}

var HEAP8, HEAP16, HEAP32, HEAPU8, HEAPU16, HEAPU32, HEAPF32, HEAPF64, HEAP64, HEAPU64, wasmMemory;

// include: runtime_shared.js
// include: runtime_stack_check.js
// end include: runtime_stack_check.js
// include: runtime_exceptions.js
// end include: runtime_exceptions.js
// include: runtime_debug.js
// end include: runtime_debug.js
// include: memoryprofiler.js
// end include: memoryprofiler.js
function updateMemoryViews() {
  var b = wasmMemory.buffer;
  HEAP8 = new Int8Array(b);
  HEAP16 = new Int16Array(b);
  HEAPU8 = new Uint8Array(b);
  HEAPU16 = new Uint16Array(b);
  HEAP32 = new Int32Array(b);
  HEAPU32 = new Uint32Array(b);
  HEAPF32 = new Float32Array(b);
  HEAPF64 = new Float64Array(b);
  HEAP64 = new BigInt64Array(b);
  HEAPU64 = new BigUint64Array(b);
}

// end include: runtime_shared.js
// end include: preamble_minimal.js
// Begin JS library code
/** @noinline */ var base64Decode = b64 => {
  var b1, b2, i = 0, j = 0, bLength = b64.length;
  var output = new Uint8Array((bLength * 3 >> 2) - (b64[bLength - 2] == "=") - (b64[bLength - 1] == "="));
  for (;i < bLength; i += 4, j += 3) {
    b1 = base64ReverseLookup[b64.charCodeAt(i + 1)];
    b2 = base64ReverseLookup[b64.charCodeAt(i + 2)];
    output[j] = base64ReverseLookup[b64.charCodeAt(i)] << 2 | b1 >> 4;
    output[j + 1] = b1 << 4 | b2 >> 2;
    output[j + 2] = b2 << 6 | base64ReverseLookup[b64.charCodeAt(i + 3)];
  }
  return output;
};

var __abort_js = () => abort("");

var __emscripten_runtime_keepalive_clear = () => {};

var timers = {};

var callUserCallback = func => func();

var _emscripten_get_now = () => performance.now();

var __setitimer_js = (which, timeout_ms) => {
  // First, clear any existing timer.
  if (timers[which]) {
    clearTimeout(timers[which].id);
    delete timers[which];
  }
  // A timeout of zero simply cancels the current timeout so we have nothing
  // more to do.
  if (!timeout_ms) return 0;
  var id = setTimeout(() => {
    delete timers[which];
    callUserCallback(() => __emscripten_timeout(which, _emscripten_get_now()));
  }, timeout_ms);
  timers[which] = {
    id,
    timeout_ms
  };
  return 0;
};

var _emscripten_math_cos = Math.cos;

var _emscripten_resize_heap = requestedSize => {
  var oldSize = HEAPU8.length;
  // With CAN_ADDRESS_2GB or MEMORY64, pointers are already unsigned.
  requestedSize >>>= 0;
  return false;
};

var _proc_exit = code => {
  throw `exit(${code})`;
};

// Precreate a reverse lookup table from chars
// "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/" back to
// bytes to make decoding fast.
for (var base64ReverseLookup = new Uint8Array(123), i = 25; i >= 0; --i) {
  base64ReverseLookup[48 + i] = 52 + i;
  // '0-9'
  base64ReverseLookup[65 + i] = i;
  // 'A-Z'
  base64ReverseLookup[97 + i] = 26 + i;
}

base64ReverseLookup[43] = 62;

// '+'
base64ReverseLookup[47] = 63;

var wasmImports = {
  /** @export */ "d": __abort_js,
  /** @export */ "c": __emscripten_runtime_keepalive_clear,
  /** @export */ "e": __setitimer_js,
  /** @export */ "a": _emscripten_math_cos,
  /** @export */ "f": _emscripten_resize_heap,
  /** @export */ "b": _proc_exit
};

function assignWasmExports(wasmExports) {
  _opus_frame_decoder_create = wasmExports["i"];
  _malloc = wasmExports["j"];
  _opus_frame_decode_float_deinterleaved = wasmExports["k"];
  _opus_frame_decoder_destroy = wasmExports["l"];
  _free = wasmExports["m"];
  __emscripten_timeout = wasmExports["o"];
}

var _opus_frame_decoder_create, _malloc, _opus_frame_decode_float_deinterleaved, _opus_frame_decoder_destroy, _free, __emscripten_timeout;

// include: postamble_minimal.js
// === Auto-generated postamble setup entry stuff ===
function initRuntime(wasmExports) {
  // No ATINITS hooks
  wasmExports["h"]();
}

// Initialize wasm (asynchronous)
if (!EmscriptenWASM.wasm) Object.defineProperty(EmscriptenWASM, "wasm", {get: () => String.raw`-`});

var imports = {
  "a": wasmImports
};

// No ATMODULES hooks
// Begin runtime exports
// End runtime exports
// Begin JS library exports
// End JS library exports

this.setModule = (data) => {
  WASMAudioDecoderCommon.setModule(EmscriptenWASM, data);
};

this.getModule = () =>
  WASMAudioDecoderCommon.getModule(EmscriptenWASM);

this.instantiate = () => {
  this.getModule().then((wasm) => WebAssembly.instantiate(wasm, imports)).then(instance => {
    const wasmExports = instance.exports;
  assignWasmExports(wasmExports);
  wasmMemory = wasmExports["g"];
  updateMemoryViews();
  // No ATPRERUNS hooks
  initRuntime(wasmExports);
  ready();
});

// end include: postamble_minimal.js
// include: src/opus-decoder/src/emscripten-post.js
this.ready = new Promise(resolve => {
  ready = resolve;
}).then(() => {
  this.HEAP = wasmMemory.buffer;
  this.malloc = _malloc;
  this.free = _free;
  this.opus_frame_decoder_create = _opus_frame_decoder_create;
  this.opus_frame_decode_float_deinterleaved = _opus_frame_decode_float_deinterleaved;
  this.opus_frame_decoder_destroy = _opus_frame_decoder_destroy;
});
return this;
}}