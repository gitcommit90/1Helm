// node test/pcm.test.mjs: 16 kHz mono 16-bit PCM audio (src/pcm.ts) and Live notes' PCM chunk recorder (livemic.ts pcmRec).
// Checks: the WAV header (RIFF, PCM, mono, 16 kHz, 16-bit, exact lengths) with the samples unchanged; the worklet turns 48 kHz and
// 44.1 kHz input into 16 kHz samples (right count, a 440 Hz tone keeps its frequency and level) and sends them 100 ms at a time;
// the chunk recorder collects the worklet's audio, asks it for the last samples on stop(), and calls onstop once; a worklet that
// never answers still ends the chunk; sizes: 32 KB a second, so a 5-minute recording and a 10-second chunk fit the server limits.
import assert from "node:assert"; import { build } from "esbuild"; import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "pcm-")), ok = (n) => console.log("  ok", n);
const bundle = async (src, name) => { const out = join(dir, name); await build({ entryPoints: [new URL(src, import.meta.url).pathname], bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "warning" }); return import(out); };
const { pcmProcessor, wavOf, PCM_RATE, WAV_TYPE } = await bundle("../src/pcm.ts", "pcm.mjs");
const { pcmRec } = await bundle("../src/ee/livemic.ts", "livemic.mjs");

// ---- the WAV file ----
const frames = [new Int16Array([1, -2, 3, 32767]).buffer, new Int16Array([-32768, 5]).buffer];
const wav = wavOf(frames), b = new Uint8Array(await wav.arrayBuffer()), dv = new DataView(b.buffer), tag = (at) => String.fromCharCode(...b.subarray(at, at + 4));
assert.equal(wav.type, "audio/wav"); assert.equal(WAV_TYPE, "audio/wav"); assert.equal(PCM_RATE, 16000);
assert.equal(b.length, 44 + 12); assert.equal(tag(0), "RIFF"); assert.equal(dv.getUint32(4, true), 36 + 12); assert.equal(tag(8), "WAVE"); assert.equal(tag(12), "fmt ");
assert.equal(dv.getUint32(16, true), 16); assert.equal(dv.getUint16(20, true), 1, "PCM"); assert.equal(dv.getUint16(22, true), 1, "mono");
assert.equal(dv.getUint32(24, true), 16000); assert.equal(dv.getUint32(28, true), 32000, "byte rate"); assert.equal(dv.getUint16(32, true), 2); assert.equal(dv.getUint16(34, true), 16);
assert.equal(tag(36), "data"); assert.equal(dv.getUint32(40, true), 12);
assert.deepEqual([...new Int16Array(b.buffer.slice(44))], [1, -2, 3, 32767, -32768, 5], "samples unchanged");
assert.equal(wavOf([], 8000).size, 44, "empty: header only"); assert.equal(new DataView(await wavOf([], 8000).arrayBuffer()).getUint32(24, true), 8000);
ok("WAV: RIFF header for mono 16-bit PCM at 16 kHz, exact lengths, samples unchanged");

// ---- the worklet, run in Node with a stand-in for the audio worklet scope ----
function worklet(rate, levels = false) {
  let Cls; const posted = [];
  const g = { AudioWorkletProcessor: class { constructor() { this.port = { postMessage: (m) => posted.push(m), onmessage: null }; } }, registerProcessor: (n, c) => { Cls = c; g.name = n; }, sampleRate: rate };
  new Function(...Object.keys(g), pcmProcessor("test-pcm", levels))(...Object.values(g));
  assert.equal(g.name, "test-pcm"); return { node: new Cls(), posted };
}
for (const rate of [48000, 44100]) {
  const { node, posted } = worklet(rate), seconds = 2, total = rate * seconds, f = 440;
  for (let i = 0; i < total; i += 128) node.process([[Float32Array.from({ length: 128 }, (_, k) => 0.5 * Math.sin(2 * Math.PI * f * (i + k) / rate))]]);
  node.port.onmessage({ data: "stop" });
  const audio = posted.filter((m) => m.type === "audio"), n = audio.reduce((s, m) => s + m.pcm.byteLength / 2, 0);
  assert.ok(Math.abs(n - 32000) <= 130, `${rate} Hz: 2 s becomes ~32000 samples at 16 kHz (${n})`);
  assert.ok(audio.slice(0, -1).every((m) => m.pcm.byteLength === 3200), "100 ms blocks");
  assert.equal(posted.at(-1).type, "flushed", "flushed comes after the last audio");
  const s = new Int16Array(Buffer.concat(audio.map((m) => Buffer.from(m.pcm))).buffer.slice(0)); let peak = 0, cross = 0;
  for (let i = 1000; i < s.length - 1000; i++) { peak = Math.max(peak, Math.abs(s[i])); if (s[i - 1] < 0 && s[i] >= 0) cross++; }
  assert.ok(peak > 0.45 * 32768 && peak < 0.52 * 32768, `${rate} Hz: level kept (peak ${peak})`);
  assert.ok(Math.abs(cross / ((s.length - 2000) / 16000) - f) < 8, `${rate} Hz: a 440 Hz tone is still 440 Hz`);
  assert.equal(node.process([[new Float32Array(128)]]), false, "stopped: the node ends");
  assert.ok(!posted.some((m) => m.type === "level"), "no level messages for Live notes");
}
assert.ok(worklet(48000, true).posted.length === 0); { const w = worklet(48000, true); w.node.process([[new Float32Array(128).fill(0.25)]]); assert.equal(w.posted.at(-1).value, 0.25); }
ok("worklet: 48 kHz and 44.1 kHz in, 16 kHz mono out in 100 ms blocks, tone and level kept; levels only when asked");

// ---- the chunk recorder ----
function fake(answer = true) {
  const nodes = [], connected = [];
  globalThis.AudioWorkletNode = class { constructor() { this.sent = []; this.port = { onmessage: null, postMessage: (m) => { this.sent.push(m); if (answer && m === "stop") queueMicrotask(() => this.port.onmessage({ data: { type: "audio", pcm: new Int16Array([9, 9]).buffer } }) || this.port.onmessage({ data: { type: "flushed" } })); } }; this.connect = (x) => connected.push(x); this.disconnect = () => {}; nodes.push(this); } };
  const gain = () => ({ gain: { value: 1 }, connect() {}, disconnect() {} });
  return { nodes, ctx: { destination: {}, createGain: gain, createMediaStreamSource: () => ({ connect() {}, disconnect() {} }) } };
}
{
  const { nodes, ctx } = fake(), parts = [], rec = pcmRec(ctx, {}, parts); let stops = 0;
  rec.onstop = () => stops++;
  assert.equal(rec.state, "recording"); assert.equal(rec.mimeType, "audio/wav");
  nodes[0].port.onmessage({ data: { type: "audio", pcm: new Int16Array([1, 2, 3]).buffer } });
  nodes[0].port.onmessage({ data: { type: "audio", pcm: new Int16Array([4]).buffer } });
  rec.stop(); rec.stop(); assert.equal(rec.state, "inactive"); assert.deepEqual(nodes[0].sent, ["stop"], "stop is sent once");
  await new Promise((z) => setTimeout(z, 20));
  assert.equal(stops, 1, "onstop once"); assert.equal(parts.length, 3, "the last samples (flushed after stop) are in the chunk");
  assert.equal(parts.reduce((s, p) => s + p.byteLength, 0), 12);
  ok("recorder: collects the worklet's audio, stop() gets the last samples, onstop once");
}
{
  const { ctx } = fake(false), rec = pcmRec(ctx, {}, []); let stops = 0; rec.onstop = () => stops++;
  rec.stop(); await new Promise((z) => setTimeout(z, 650)); assert.equal(stops, 1, "a silent worklet still ends the chunk after 0.5 s");
  ok("recorder: a worklet that never answers still ends the chunk");
}
{ globalThis.AudioWorkletNode = class { constructor() { throw new Error("no"); } }; assert.equal(pcmRec({ createGain() {}, createMediaStreamSource() {} }, {}, []), null); ok("recorder: null when the worklet node can't be made (the caller uses MediaRecorder)"); }

// ---- sizes against the server's limits ----
const perSec = 16000 * 2; assert.equal(perSec, 32000);
assert.ok(5 * 60 * perSec + 44 < 25 * 1024 * 1024, "5 minutes < STT_MAX_BYTES (25 MiB)"); assert.ok(10 * perSec + 44 < 3 * 1024 * 1024 && 90 * perSec < 3 * 1024 * 1024, "a 10 s chunk (and up to 90 s) < MIC_MAX_BYTES (3 MiB)");
assert.ok(5 * 60 * 48000 * 2 > 25 * 1024 * 1024, "the same 5 minutes at 48 kHz would not fit: why 16 kHz");
ok("sizes: 32000 B/s; 5 min = 9.6 MB (limit 25 MiB); 10 s chunk = 320 KB (limit 3 MiB)");
