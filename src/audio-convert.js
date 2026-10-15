// Audio inside an uploaded file → 16 kHz mono 16-bit PCM WAV pieces, in the Worker, for AssemblyAI Universal-3.6 Pro (it takes WAV only).
// Opus in ogg and webm (libopus, BSD), and AAC-LC, mp3, FLAC, Vorbis and ALAC (Symphonia, MPL-2.0) in ogg, webm, m4a, mp4, mov, mp3 and flac files.
// All WebAssembly, compiled at build time (CompiledWasm imports; the Worker can't compile wasm from bytes at run time). Everything streams:
// the file is read by range (R2), packets go to the decoder in small batches, samples are resampled and cut into WAV pieces of PIECE_BYTES,
// so memory is a few windows plus one piece whatever the length. The original file and its audio are never changed; the WAV exists only as
// the request body for transcription. The containers are read by src/audio-demux.js (Symphonia's own demuxers read from a synchronous
// source, and here the file arrives by asynchronous range reads), the codecs are tools/symphonia-wasm.
// Why not the container with ffmpeg: 0.25 vCPU is 4 to 10 times slower and it would change the shared Computer image (FINDINGS.md).
import opusWasm from "./vendor/audio/opus.wasm";
import symWasm from "./vendor/audio/sym.wasm";
import OpusDecoder from "./vendor/audio/opus-decoder.js";
import { symDecoder } from "./vendor/audio/sym-decoder.js";
import { Source, oggAudio, webmAudio, openMp4, openFlac, Unsupported, Corrupt } from "./audio-demux.js";
export { Source, Unsupported, Corrupt };

OpusDecoder.module = opusWasm;

export const RATE = 16000;
export const PIECE_BYTES = 16 * 1024 * 1024;     // = splitWav's piece size in sidecar.js: a piece reaches AssemblyAI whole
export const KAISER_ZEROS = 20, KAISER_CUT = 0.47, KAISER_BETA = 8;   // resampler: sinc zeros on each side per output sample, cutoff as a share of the lower Nyquist rate, window shape
export const MIN_PIECE_SEC = 1;                  // a last piece shorter than this is padded with silence
export const READ_WINDOW = 1 << 20;
export const CONVERTIBLE = ["mp3", "ogg", "webm", "mp4", "flac"];   // what sniff() can name ("mp4" is m4a, mp4 and mov)

// The container from the file's first bytes (not its name). → "mp3" | "ogg" | "webm" | "mp4" | "flac" | "wav" | null
export function sniff(h) {
  if (h.length < 4) return null;
  const t = String.fromCharCode(h[0], h[1], h[2], h[3]);
  if (t === "OggS") return "ogg";
  if (t === "fLaC") return "flac";
  if (t === "RIFF" && h.length >= 12 && String.fromCharCode(h[8], h[9], h[10], h[11]) === "WAVE") return "wav";
  if (h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3) return "webm";
  if (h.length >= 8 && ["ftyp", "moov", "mdat", "free", "wide", "styp"].includes(String.fromCharCode(h[4], h[5], h[6], h[7]))) return "mp4";
  if (t.slice(0, 3) === "ID3" || mp3Sync(h, 0)) return "mp3";
  return null;
}
const mp3Sync = (b, i) => b[i] === 0xff && (b[i + 1] & 0xe0) === 0xe0 && ((b[i + 1] >> 3) & 3) !== 1 && ((b[i + 1] >> 1) & 3) !== 0 && (b[i + 2] >> 4) !== 15 && ((b[i + 2] >> 2) & 3) !== 3;

// An mp3 is only converted when frames follow each other as their headers say (MPEG 1, 2 and 2.5 Layer III): the decoder finds "frames" in
// any binary data and would turn it into noise. Past an ID3v2 tag, the first frame within 4 KB must be followed by two more where its
// length points (or end the file).
const BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SRATE = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
function mp3FrameLen(b, i) {
  if (i + 4 > b.length || !mp3Sync(b, i) || ((b[i + 1] >> 1) & 3) !== 1) return 0;
  const v = (b[i + 1] >> 3) & 3, br = (v === 3 ? BR1 : BR2)[b[i + 2] >> 4], sr = SRATE[v]?.[(b[i + 2] >> 2) & 3]; if (!br || !sr) return 0;
  return Math.floor((v === 3 ? 144 : 72) * br * 1000 / sr) + ((b[i + 2] >> 1) & 1);
}
export async function checkMp3(src) {
  let at = 0; const h = await src.get(0, 10);
  if (h.length >= 10 && String.fromCharCode(h[0], h[1], h[2]) === "ID3") at = 10 + ((h[6] & 127) << 21 | (h[7] & 127) << 14 | (h[8] & 127) << 7 | (h[9] & 127)) + ((h[5] & 16) ? 10 : 0);
  const b = await src.get(at, 4096 + 3 * 1441);
  for (let i = 0; i < Math.min(4096, b.length); i++) {
    const l1 = mp3FrameLen(b, i); if (!l1) continue;
    if (i + l1 === b.length && at + b.length === src.size) return at;
    const l2 = mp3FrameLen(b, i + l1); if (!l2) continue;
    if (i + l1 + l2 === b.length && at + b.length === src.size) return at;
    if (mp3FrameLen(b, i + l1 + l2)) return at;
  }
  throw new Unsupported("no mp3 frames where the file says they are");
}

const clip16 = (x) => { const v = Math.round(x * 32767); return v > 32767 ? 32767 : v < -32768 ? -32768 : v; };
// Channel weights for a mono mix: front pair and centre carry speech, the low-frequency channel is dropped (AAC order L R C LFE Ls Rs).
const MIX = { 3: [0.3, 0.3, 0.4], 4: [0.3, 0.3, 0.4, 0], 5: [0.28, 0.28, 0.34, 0.05, 0.05], 6: [0.28, 0.28, 0.34, 0, 0.05, 0.05] };
function downmix(ch) {
  if (ch.length === 1) return ch[0];
  const n = ch[0].length, o = new Float32Array(n);
  if (ch.length === 2) { const a = ch[0], b = ch[1]; for (let i = 0; i < n; i++) o[i] = (a[i] + b[i]) * 0.5; return o; }
  const w = MIX[ch.length]; if (!w) throw new Unsupported(`${ch.length} audio channels`);
  for (let k = 0; k < ch.length; k++) { const c = ch[k], g = w[k]; if (g) for (let i = 0; i < n; i++) o[i] += c[i] * g; }
  return o;
}
// A streaming polyphase windowed-sinc resampler to RATE, float in, Int16 out. The filter is a Kaiser-windowed sinc, flat to about 6.9 kHz
// and down by 60 dB or more from 8.1 kHz (for 44.1 kHz input), so nothing above the 8 kHz Nyquist folds back into the speech band.
const bessel0 = (x) => { let s = 1, t = 1; for (let k = 1; k < 40; k++) { t *= (x / (2 * k)) ** 2; s += t; } return s; };
export function resampler(inRate, outRate = RATE, zeros = KAISER_ZEROS, cut = KAISER_CUT, beta = KAISER_BETA) {
  const g = (a, b) => (b ? g(b, a % b) : a), d = g(inRate, outRate), L = outRate / d, M = inRate / d;
  if (!(inRate >= 4000 && inRate <= 192000) || L > 2000) throw new Unsupported(`sample rate ${inRate} Hz`);
  const fc = cut * Math.min(1, outRate / inRate), T = Math.ceil(zeros * Math.max(1, inRate / outRate)), phases = [], b0 = bessel0(beta);
  for (let ph = 0; ph < L; ph++) {
    const frac = ((ph * M) % L) / L, w = new Float32Array(2 * T); let s = 0;
    for (let k = -T + 1; k <= T; k++) { const x = k - frac, a = 2 * Math.PI * fc * x, sinc = x === 0 ? 2 * fc : Math.sin(a) / (Math.PI * x), r = x / T, win = Math.abs(r) >= 1 ? 0 : bessel0(beta * Math.sqrt(1 - r * r)) / b0, v = sinc * win; w[k + T - 1] = v; s += v; }
    for (let i = 0; i < w.length; i++) w[i] /= s;
    phases.push(w);
  }
  let hist = new Float32Array(T), outCount = 0, inBase = -T, buf = new Float32Array(0);   // T zeros stand for the inputs before the first one
  return {
    push(x) {
      const need = hist.length + x.length; if (buf.length < need) buf = new Float32Array(need * 2);
      buf.set(hist); buf.set(x, hist.length);
      const total = hist.length + x.length, out = new Int16Array(Math.ceil(x.length * L / M) + 2); let o = 0, n = outCount;
      for (;;) {
        const pos = Math.floor(n * M / L), ph = (n * M) % L, lo = pos - T + 1 - inBase;
        if (lo + 2 * T > total) break;
        const w = phases[ph]; let acc = 0; for (let i = 0, j = lo; i < 2 * T; i++, j++) acc += w[i] * buf[j];
        out[o++] = clip16(acc); n++;
      }
      outCount = n; const keep = Math.max(0, Math.floor(n * M / L) - T + 1 - inBase); hist = buf.slice(keep, total); inBase += keep;
      return out.subarray(0, o);
    },
  };
}
// Decoded channels at any rate → Int16 mono at RATE. The rate may change mid-stream (a concatenated file), so the resampler follows it.
function mono16k() {
  let rs = null, rate = 0;
  return (channels, inRate) => {
    if (!channels.length || !channels[0].length) return null;
    const m = downmix(channels);
    if (inRate === RATE) { const o = new Int16Array(m.length); for (let i = 0; i < m.length; i++) o[i] = clip16(m[i]); return o; }
    if (!rs || rate !== inRate) { rs = resampler(inRate); rate = inRate; }
    return rs.push(m);
  };
}

// ---- the decoders: each is an async generator of Int16Array chunks (mono, RATE) ----
const refuse = (e) => { if (e?.unsupported) throw new Unsupported(String(e.message).slice(0, 100)); throw e; };
async function* streamPcm(src, kind, extra, start = 0) {   // raw mp3 or FLAC bytes: the decoder module cuts them into frames
  const dec = await symDecoder(symWasm, kind, extra).catch(refuse), mix = mono16k();
  try {
    for (let off = start; off < src.size;) {
      const big = await src.get(off, off < src.win ? src.win - off : src.win); if (!big.length) break; off += big.length;   // the first read ends where the window the sniff read ends
      for (let o = 0; o < big.length; o += 65536) {   // 64 KB of mp3 is about 4 s: its float output stays small
        for (const seg of dec.push(big.subarray(o, Math.min(big.length, o + 65536)), false)) { const pcm = mix(seg.channels, seg.rate); if (pcm?.length) yield pcm; }   // a joined stream can change the rate inside one call
      }
    }
    for (const seg of dec.push(new Uint8Array(0), true)) { const pcm = mix(seg.channels, seg.rate); if (pcm?.length) yield pcm; }
  } finally { dec.free(); }
}
// Codec packets from a demuxer: { head } starts a stream (a chained Ogg file has several), { packet } is one packet.
async function* packetPcm(events) {
  let dec = null, opus = false, aac = false, skip = 0, startSec = null; const mix = mono16k(); let batch = [], bytes = 0;
  const run = function* () {
    if (!batch.length) return; const list = batch; batch = []; bytes = 0;
    if (opus) { const r = dec.decodeFrames(list); const pcm = mix(r.channelData, RATE); if (pcm?.length) yield pcm; }
    else for (const seg of dec.packets(list)) {
      let ch = seg.channels;
      if (skip === null) skip = startSec > 0 ? Math.round(startSec * seg.rate) : startSec === null && aac ? 1024 : 0;   // the encoder delay: what the edit list says is not played, else AAC's 1024 samples of priming
      if (skip > 0) { const k = Math.min(ch[0].length, skip); skip -= k; ch = ch.map((c) => c.subarray(k)); }
      const pcm = mix(ch, seg.rate); if (pcm?.length) yield pcm;
    }
  };
  const close = () => { try { dec?.free(); } catch {} dec = null; };
  try {
    for await (const ev of events) {
      if (ev.head) {
        if (dec) { yield* run(); close(); }
        const h = ev.head; opus = h.codec === "opus"; aac = h.codec === "aac"; skip = null; startSec = h.skipSec ?? null;
        if (opus) { dec = new OpusDecoder({ sampleRate: RATE, channels: h.channels, preSkip: Math.round(h.preSkip * RATE / 48000) })   /* the header counts 48 kHz samples; the decoder skips samples at its own output rate */; await dec.ready; }
        else dec = await symDecoder(symWasm, h.codec, h.extra).catch(refuse);
        continue;
      }
      if (!dec) continue;
      if (opus && ev.packet.length > 3840 * 2) continue;   // beyond what the decoder's input holds (256 kbps per channel)
      batch.push(ev.packet.slice()); bytes += ev.packet.length;
      if (batch.length >= (opus ? 50 : 64) || bytes > 262144) yield* run();
    }
    if (dec) yield* run();
  } finally { close(); }
}
function decoderFor(kind, src, start = 0) {
  if (kind === "mp3") return streamPcm(src, "mp3", undefined, start);
  if (kind === "flac") return (async function* () { const f = await openFlac(src); yield* streamPcm(src, "flac", f.extra, f.start); })();
  if (kind === "ogg") return packetPcm(oggAudio(src));
  if (kind === "webm") return packetPcm(webmAudio(src));
  if (kind === "mp4") return packetPcm((async function* () { const m = await openMp4(src); yield { head: { codec: m.codec, extra: m.extra, skipSec: m.skipSec } }; for await (const p of m.packets) yield { packet: p }; })());
  throw new Unsupported(`audio container ${kind}`);
}

export function wavHeader(w, len) {   // the 44-byte header of 16-bit mono PCM at RATE, like splitWav in sidecar.js
  const d = new DataView(w.buffer, w.byteOffset, 44);
  w.set([82, 73, 70, 70], 0); d.setUint32(4, 36 + len, true); w.set([87, 65, 86, 69, 102, 109, 116, 32], 8); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
  d.setUint32(24, RATE, true); d.setUint32(28, RATE * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); w.set([100, 97, 116, 97], 36); d.setUint32(40, len, true);
}

// read(offset, length) → Uint8Array; size: the file's bytes. → { kind, pieces: AsyncGenerator<{ data: Uint8Array (a WAV file), sec }>, source, stats() }
// Throws (Unsupported, Corrupt or another error) before returning when the file can't be converted: the first piece is made here, so a
// caller that gets no converter has sent nothing anywhere yet. After that a failure comes out of the generator and only loses the rest.
// maxSec: stop after this much audio (stats().truncated says there was more).
export async function convertAudio(read, size, { maxSec = 3 * 3600, pieceBytes = PIECE_BYTES, window = READ_WINDOW } = {}) {
  const src = new Source(read, size, { window });
  const kind = sniff(await src.get(0, 16));
  if (!kind) throw new Unsupported("not a format the converter reads");
  if (kind === "wav") throw new Unsupported("already WAV");
  let start = 0; if (kind === "mp3") start = await checkMp3(src);
  const per = Math.floor((pieceBytes - 44) / 2) * 2, perSamples = per / 2, minSamples = MIN_PIECE_SEC * RATE, maxSamples = Math.floor(maxSec * RATE);
  const st = { samples: 0, pieces: 0, truncated: false };
  const pcm = decoderFor(kind, src, start);
  async function* gen() {
    let buf = null, fill = 0, i16 = null, over = 0, stop = false;
    const start = () => { buf = new Uint8Array(44 + per); i16 = new Int16Array(buf.buffer, 44, perSamples); fill = 0; };
    const finish = () => {
      let n = fill; if (n < minSamples) { i16.fill(0, n, minSamples); n = minSamples; }   // padded with silence, so the last piece isn't too short for the model
      wavHeader(buf, n * 2); const out = { data: n === perSamples ? buf : buf.subarray(0, 44 + n * 2), sec: fill / RATE }; buf = null; i16 = null; fill = 0; st.pieces++; return out;
    };
    try {
      for await (const chunk of pcm) {
        let c = chunk;
        // Past maxSec: the rest is dropped, and it counts as cut only when more than 2 s follow (a file that ends a few ms over isn't).
        if (st.samples + c.length > maxSamples) { over += st.samples + c.length - Math.max(maxSamples, st.samples); c = c.subarray(0, Math.max(0, maxSamples - st.samples)); if (over > 2 * RATE) { st.truncated = true; stop = true; } }
        for (let o = 0; o < c.length;) {
          if (!buf) start();
          const k = Math.min(c.length - o, perSamples - fill); i16.set(c.subarray(o, o + k), fill); fill += k; o += k; st.samples += k;
          if (fill === perSamples) yield finish();
        }
        if (stop) break;   // after the part of this chunk that is within the limit
      }
      if (buf && fill > 0) yield finish();
    } finally { await pcm.return?.(); }
  }
  const it = gen(), first = await it.next();
  if (first.done) { await it.return?.(); throw new Corrupt("no audio could be decoded"); }
  // No variable here may keep a piece after it was handed out (a piece is up to 16 MB): the caller drops it before it asks for the next.
  async function* pieces() { yield (() => { const v = first.value; first.value = null; return v; })(); yield* it; }
  return { kind, pieces: pieces(), source: src, stats: () => ({ ...st, reads: src.reads, bytesRead: src.bytes }) };
}
