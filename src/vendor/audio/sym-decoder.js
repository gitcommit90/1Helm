// A JavaScript wrapper for sym.wasm (tools/symphonia-wasm: Symphonia codecs for AAC-LC, MP3, FLAC, Vorbis and ALAC). The module is passed in
// already compiled (a CompiledWasm import), because the Worker can't compile WebAssembly from bytes at run time. This file is this project's
// own code; the wasm is built from tools/symphonia-wasm/src/lib.rs and Symphonia (MPL-2.0).
export const KIND = { aac: 1, mp3: 2, flac: 3, vorbis: 4, alac: 5 };

// → { packets(list), push(bytes, flush), free() }. packets: whole codec packets in, [{ channels: Float32Array[], rate }] out (one entry).
// push: raw stream bytes (mp3, flac) in, [{ channels, rate }] out (a new entry when the sample rate changes). Throws Error with .unsupported
// when the codec's setup bytes are refused (for example 5.1 AAC).
export async function symDecoder(module, kind, extra = new Uint8Array(0)) {
  const { exports: w } = await WebAssembly.instantiate(module, {});
  const mem = () => w.memory.buffer;
  const put = (bytes) => { const p = w.sym_alloc(bytes.length); new Uint8Array(mem(), p, bytes.length).set(bytes); return p; };
  const e = put(extra), h = w.sym_new(KIND[kind], e, extra.length); w.sym_dealloc(e, extra.length);
  if (!h) { const m = new TextDecoder().decode(new Uint8Array(mem(), w.sym_err_ptr(), w.sym_err_len())); const err = new Error(m || "decoder refused the stream"); err.unsupported = true; throw err; }
  const copy = (n) => {
    const nch = w.sym_channels(h); if (!nch || !n) { w.sym_clear(h); return null; }
    const channels = []; for (let c = 0; c < nch; c++) channels.push(new Float32Array(mem(), w.sym_plane(h, c), n).slice());
    const out = { channels, rate: w.sym_rate(h) }; w.sym_clear(h); return out;
  };
  let freed = false;
  return {
    packets(list) {
      let total = 0; for (const p of list) total += p.length;
      const data = w.sym_alloc(total), lens = w.sym_alloc(list.length * 4); let at = 0;
      const lv = new Uint32Array(mem(), lens, list.length); for (let i = 0; i < list.length; i++) lv[i] = list[i].length;
      const dv = new Uint8Array(mem(), data, total); for (const p of list) { dv.set(p, at); at += p.length; }
      const n = w.sym_packets(h, data, lens, list.length); w.sym_dealloc(data, total); w.sym_dealloc(lens, list.length * 4);
      const o = copy(n); return o ? [o] : [];
    },
    push(bytes, flush = false) {
      const out = []; const p = bytes.length ? put(bytes) : 0; let n = w.sym_push(h, p, bytes.length, flush ? 1 : 0); if (p) w.sym_dealloc(p, bytes.length);
      for (;;) { const o = copy(n); if (o) out.push(o); if (!w.sym_more(h)) break; n = w.sym_push(h, 0, 0, flush ? 1 : 0); }
      return out;
    },
    skipped: () => w.sym_skipped(h),
    free() { if (!freed) { freed = true; w.sym_free(h); } },
  };
}
