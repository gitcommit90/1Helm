// Live dictation through a speech model that takes whole recordings (AssemblyAI Universal-3.6 Pro, WAV only, request and response)
// instead of a streaming WebSocket. The composer's PCM (16 kHz mono 16-bit, 100 ms frames) is cut at pauses in speech into short
// chunks, the way Live notes sends pause-cut chunks (device side: design-sandbox src/livemic.ts), each chunk is wrapped as a WAV file
// and sent through transcribe.js stt() (the same OpenRouter call, ZDR filter, billing and gateway as every other transcription), and
// the text comes back in order as one final result per chunk.
//
// ChunkProvider has the same surface as the Deepgram WebSocket that transcribe-live.js bridgeDictation() talks to (send, close,
// addEventListener, bufferedAmount) and answers in Deepgram's message shape ({type:"Results", start, is_final, channel}), so the bridge
// (limits, lease, ledger windows, stop and error handling) is the one code path for both providers. Differences it adds:
//  - No words appear while a phrase is being spoken: a chunk's text arrives after the pause that ends it (the delay is measured in
//    docs of the change: pause 0.5 s + about 0.6 to 1.0 s for the request).
//  - If a chunk fails (an error, or no answer in 6 s; one immediate retry for an error that isn't a timeout) the rest of the session
//    moves to the fallback provider (Deepgram Nova 3 on a WebSocket), which first gets the audio of the failed chunk and every later
//    one, so no audio is lost. Without a fallback the session ends with the bridge's plain error message and the text so far stays.
//  - Billing: each answer's cost (OpenRouter usage.cost, plus what a timed-out attempt may have cost) x 1.15, taken by the bridge
//    with takeCharge() whenever it settles a window; audio sent to the fallback is charged by Deepgram's per-minute rate.
//  - Audio and transcripts stay in memory only; the gateway is asked not to log the request or its payload.
import { MARKUP, stt } from "./transcribe.js";

export const SAMPLE_RATE = 16000, BYTES_PER_SEC = SAMPLE_RATE * 2;
export const BLOCK_SAMPLES = 320;                  // 20 ms
export const PAUSE_MS = 500, MAX_CHUNK_MS = 8000, LEAD_MS = 400, MIN_VOICED_BLOCKS = 3, CUT_LOOKBACK_MS = 3000;
// voiced = RMS above 2x the quietest block of the last 5 s, where that floor counts for at most 250 (about -42 dBFS) and the threshold
// is at least 150: speech that starts the session, or runs on for 5 s, can never raise the threshold above 500 and be mistaken for silence.
export const MIN_THRESHOLD = 150, THRESHOLD_FACTOR = 2, FLOOR_BLOCKS = 250, MAX_FLOOR = 250;
export const CHUNK_TRY_MS = 6000, MAX_IN_FLIGHT = 3;

// A 16 kHz mono 16-bit WAV file around raw PCM.
export function wavOf(pcm) {
  const out = new Uint8Array(44 + pcm.length), v = new DataView(out.buffer), tag = (o, s) => { for (let i = 0; i < 4; i++) out[o + i] = s.charCodeAt(i); };
  tag(0, "RIFF"); v.setUint32(4, 36 + pcm.length, true); tag(8, "WAVE"); tag(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, SAMPLE_RATE, true); v.setUint32(28, BYTES_PER_SEC, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); tag(36, "data"); v.setUint32(40, pcm.length, true);
  out.set(pcm, 44); return out;
}

const rmsOf = (u8, from, samples) => { const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); let sum = 0; for (let i = 0; i < samples; i++) { const x = dv.getInt16(from + i * 2, true); sum += x * x; } return Math.sqrt(sum / samples); };

// Cuts PCM into chunks at pauses. feed(u8) calls onChunk({ pcm, start }) (start: seconds from the first sample) for each chunk; flush() emits
// the rest if it holds speech; take() returns the audio not yet emitted (for a hand-over to another provider). Every sample of a
// chunk that holds speech is kept; only a long stretch with no speech at all is dropped, down to its last 400 ms.
export class PauseCutter {
  constructor(onChunk) {
    this.onChunk = onChunk; this.parts = []; this.rest = new Uint8Array(0); this.blocks = []; this.voiced = []; this.quiet = 0; this.nVoiced = 0;
    this.ring = []; this.startBlock = 0; this.totalBlocks = 0; this.partial = new Uint8Array(0);
  }
  get buffered() { return this.blocks.length * BLOCK_SAMPLES * 2 + this.partial.length; }
  floor() { return this.ring.length ? Math.min(MAX_FLOOR, ...this.ring) : 0; }
  feed(u8) {
    let data = u8;
    if (this.partial.length) { data = new Uint8Array(this.partial.length + u8.length); data.set(this.partial); data.set(u8, this.partial.length); this.partial = new Uint8Array(0); }
    const size = BLOCK_SAMPLES * 2; let at = 0;
    for (; at + size <= data.length; at += size) this.block(data.slice(at, at + size));
    this.partial = data.slice(at);
  }
  block(b) {
    const r = rmsOf(b, 0, BLOCK_SAMPLES); this.ring.push(r); if (this.ring.length > FLOOR_BLOCKS) this.ring.shift();
    const voiced = r > Math.max(MIN_THRESHOLD, THRESHOLD_FACTOR * this.floor());
    this.blocks.push(b); this.voiced.push(voiced); this.totalBlocks++;
    if (voiced) { this.nVoiced++; this.quiet = 0; } else this.quiet++;
    const lead = LEAD_MS / 20;
    if (!this.nVoiced && this.blocks.length > lead) { this.blocks.shift(); this.voiced.shift(); this.startBlock++; }   // nothing said yet: keep only the last 400 ms
    else if (this.nVoiced >= MIN_VOICED_BLOCKS && this.quiet * 20 >= PAUSE_MS) this.emit(this.blocks.length);
    else if (this.blocks.length * 20 >= MAX_CHUNK_MS) this.emit(this.cutPoint());
  }
  // The end of a chunk that has run too long: the quietest 100 ms in its last 3 s (the cut falls between words, not inside one).
  cutPoint() {
    const n = this.blocks.length, from = Math.max(MIN_VOICED_BLOCKS + 1, n - CUT_LOOKBACK_MS / 20); let best = n, bestE = Infinity;
    for (let i = from; i + 5 <= n; i++) { let e = 0; for (let k = i; k < i + 5; k++) e += rmsOf(this.blocks[k], 0, BLOCK_SAMPLES); if (e < bestE) { bestE = e; best = i + 5; } }
    return best;
  }
  emit(count) {
    const take = this.blocks.splice(0, count), flags = this.voiced.splice(0, count), pcm = new Uint8Array(take.length * BLOCK_SAMPLES * 2);
    take.forEach((b, i) => pcm.set(b, i * BLOCK_SAMPLES * 2));
    const start = this.startBlock * BLOCK_SAMPLES / SAMPLE_RATE; this.startBlock += take.length;
    this.nVoiced = this.voiced.reduce((n, v) => n + (v ? 1 : 0), 0); this.quiet = 0; for (let i = this.voiced.length - 1; i >= 0 && !this.voiced[i]; i--) this.quiet++;
    if (flags.filter(Boolean).length >= MIN_VOICED_BLOCKS) this.onChunk({ pcm, start });
  }
  flush() {
    if (this.partial.length >= 2) { const pad = new Uint8Array(BLOCK_SAMPLES * 2); pad.set(this.partial.subarray(0, this.partial.length - this.partial.length % 2)); this.partial = new Uint8Array(0); this.block(pad); }
    if (this.blocks.length && this.nVoiced >= MIN_VOICED_BLOCKS) this.emit(this.blocks.length);
    else { this.blocks = []; this.voiced = []; this.nVoiced = 0; this.quiet = 0; }
  }
  // Everything not emitted yet, as one PCM buffer with its start (seconds), and the cutter is empty.
  take() {
    const pcm = new Uint8Array(this.blocks.length * BLOCK_SAMPLES * 2 + this.partial.length), start = this.startBlock * BLOCK_SAMPLES / SAMPLE_RATE;
    this.blocks.forEach((b, i) => pcm.set(b, i * BLOCK_SAMPLES * 2)); pcm.set(this.partial, this.blocks.length * BLOCK_SAMPLES * 2);
    this.startBlock += this.blocks.length; this.blocks = []; this.voiced = []; this.nVoiced = 0; this.quiet = 0; this.partial = new Uint8Array(0);
    return { pcm, start };
  }
}

const message = (obj) => new MessageEvent("message", { data: JSON.stringify(obj) });

// deps: { model, env (the Worker env, with payload logging off), meta, rate (nano-dollars per audio second, for a timed-out attempt),
//   liveCharge (bytes → nano, for audio sent to the fallback), openFallback() → an accepted WebSocket to the fallback provider, or null,
//   stt (tests), tryMs, now }
export class ChunkProvider extends EventTarget {
  constructor(deps) {
    super(); this.d = deps; this.jobs = []; this.nextSeq = 0; this.finishing = false; this.ended = false; this.fallback = null; this.opening = null; this.held = []; this.heldBytes = 0;
    this.nano = 0; this.dgBytes = 0; this.stats = { chunks: 0, failed: 0, fellBack: false };
    this.cutter = new PauseCutter((c) => this.queue(c));
    this.ctl = new AbortController();
  }
  get bufferedAmount() {
    if (this.fallback) return Number(this.fallback.bufferedAmount || 0);
    return this.cutter.buffered + this.heldBytes + this.jobs.filter((j) => !j.started).reduce((n, j) => n + j.pcm.length, 0);
  }
  send(data) {
    if (this.ended) return;
    if (typeof data === "string") { this.finishing = true; if (this.fallback) this.fallback.send(data); else if (!this.opening) { this.cutter.flush(); this.pump(); this.check(); } return; }
    const n = data.byteLength;
    if (this.fallback) { this.dgBytes += n; this.fallback.send(data); return; }
    if (this.opening) { this.held.push(new Uint8Array(data)); this.heldBytes += n; return; }
    this.cutter.feed(new Uint8Array(data));
  }
  queue({ pcm, start }) { this.jobs.push({ seq: this.nextSeq++, pcm, start, started: false, done: false, text: "", err: null }); this.pump(); }
  pump() {
    if (this.fallback || this.opening) return;
    let flying = this.jobs.filter((j) => j.started && !j.done).length;
    for (const j of this.jobs) { if (flying >= MAX_IN_FLIGHT) break; if (!j.started) { j.started = true; flying++; this.run(j); } }
  }
  async run(j) {
    const secs = j.pcm.length / BYTES_PER_SEC, tryMs = this.d.tryMs || CHUNK_TRY_MS;
    for (let attempt = 0; attempt < 2; attempt++) {
      j.sent = Date.now();
      try {
        const out = await (this.d.stt || stt)(this.d.env, { bytes: wavOf(j.pcm) }, { format: "wav", models: [this.d.model], meta: this.d.meta, tryMs, estSec: secs, signal: this.ctl.signal, headers: { "cf-aig-collect-log": "false" } });
        this.nano += out.nano; j.text = String(out.text || "").replace(/\s+/g, " ").trim(); j.done = true; j.err = null; j.ms = Date.now() - j.sent; break;
      } catch (e) {
        this.nano += Number(e?.nano) || 0; j.err = e; j.ms = Date.now() - j.sent;
        if (this.ended || e?.timeout || e?.privacy) break;   // an answer that never came or a refusal: no retry, hand over
      }
    }
    if (!j.done) { j.done = true; j.failed = true; this.stats.failed++; }
    this.check();
  }
  // In order: emit finished chunks; at the first failed one, hand the session to the fallback; when everything is done after a stop, end.
  check() {
    if (this.ended || this.opening || this.fallback) return;
    while (this.jobs.length && this.jobs[0].done) {
      const j = this.jobs[0];
      if (j.failed) { this.handOver(); return; }
      this.jobs.shift(); this.stats.chunks++;
      if (j.text) this.dispatchEvent(message({ type: "Results", start: j.start, is_final: true, channel: { alternatives: [{ transcript: j.text }] } }));
    }
    this.pump();
    if (this.finishing && !this.jobs.length) { this.ended = true; this.dispatchEvent(message({ type: "Metadata" })); }
  }
  async handOver() {
    this.stats.fellBack = true;
    this.opening = true;
    const now = this.cutter.take(), jobs = this.jobs.splice(0);
    this.ctl.abort();   // later chunks still in flight: the fallback hears that audio again, so they're dropped (their possible cost is counted by stt)
    const parts = [...jobs.map((j) => j.pcm), now.pcm, ...this.held]; this.held = []; this.heldBytes = 0;
    const offset = jobs.length ? jobs[0].start : now.start;
    let sock = null; try { sock = await this.d.openFallback?.(); } catch {}
    if (!sock || this.ended) { this.opening = false; if (!this.ended) { this.ended = true; this.dispatchEvent(message({ type: "Error" })); } try { sock?.close(); } catch {} return; }
    this.fallback = sock; this.opening = false;
    sock.addEventListener("message", (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { this.dispatchEvent(new MessageEvent("message", { data: ev.data })); return; }
      if (m && m.type === "Results" && Number.isFinite(m.start)) m.start += offset;
      this.dispatchEvent(message(m));
    });
    sock.addEventListener("close", () => this.dispatchEvent(new Event("close")));
    sock.addEventListener("error", () => this.dispatchEvent(new Event("error")));
    for (const p of parts) { if (!p.length) continue; const buf = p.buffer.slice(p.byteOffset, p.byteOffset + p.byteLength); this.dgBytes += p.length; for (let o = 0; o < buf.byteLength; o += 16384) sock.send(buf.slice(o, o + 16384)); }
    if (this.finishing) sock.send(JSON.stringify({ type: "CloseStream" }));
  }
  // The nano-dollars to settle for the audio since the last call (the bridge's hold is LIVE_MINUTE_NANO, which this never exceeds).
  takeCharge(cap = Infinity) {
    const n = Math.ceil(this.nano * MARKUP) + (this.d.liveCharge ? this.d.liveCharge(this.dgBytes) : 0);
    this.nano = 0; this.dgBytes = 0; return Math.min(cap, n);
  }
  close() {
    if (this.closed) return; this.closed = true;
    // Chunks still waiting for an answer may have been billed: count them at the price per audio second (as stt() does for a timeout).
    for (const j of this.jobs) if (j.started && !j.done) this.nano += Math.ceil(j.pcm.length / BYTES_PER_SEC * (this.d.rate || 0));
    this.ended = true; this.ctl.abort(); try { this.fallback?.close(); } catch {}
  }
}
