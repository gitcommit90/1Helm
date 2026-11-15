// node test/dictation-startup.test.mjs: nothing said right after the mic tap is lost (src/dictation-audio.ts, src/voicememo.ts takeTap).
import assert from "node:assert"; import { build } from "esbuild"; import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "ds-")), load = async n => { const o = join(dir, n + ".mjs"); await build({ entryPoints: [new URL(`../src/${n}.ts`, import.meta.url).pathname], bundle: true, format: "esm", platform: "neutral", outfile: o, logLevel: "warning" }); return import(o); };
const ok = n => console.log("  ok", n);

// 1. Frames captured before the server says ready (here 6 s, the 8 s cap is 256000 bytes) all reach the socket, in order, byte for byte.
const { DictationAudio } = await load("dictation-audio");
const a = new DictationAudio(), frames = Array.from({ length: 60 }, (_, i) => new Int16Array(1600).fill(i + 1).buffer);
for (const f of frames) a.push(f);
assert.throws(() => { for (let i = 0; i < 40; i++) a.push(new ArrayBuffer(3200)); }, /took too long/);   // the cap is explicit, never a silent drop
a.clear(); for (const f of frames) a.push(f);
a.connected(0, 64000);
const sent = []; for (let t = 0; t < 10000 && (a.bytes || !sent.length); t += 20) sent.push(...a.take(t));
assert.equal(a.bytes, 0); assert.equal(sent.length, 60);
sent.forEach((f, i) => assert.deepEqual(new Int16Array(f), new Int16Array(frames[i])));
ok("audio buffered before ready is sent whole and in order");

const M = await load("voicememo");
// 2. A tap: pointer down opens the microphone, pointer up must keep it open for dictation instead of closing it.
const ev = {}, win = { addEventListener: (t, f) => (ev[t] ??= []).push(f), setTimeout, clearTimeout };
const fire = (t, e) => (ev[t] || []).forEach(f => f(e));
let opened = 0, stopped = 0, closed = 0;
const track = { stop: () => stopped++, addEventListener() {} }, stream = { getTracks: () => [track], getAudioTracks: () => [track] };
class Ctx { audioWorklet = { addModule: async () => {} }; state = "running"; async resume() {} close() { closed++; return Promise.resolve(); } createMediaStreamSource() { return { connect() {}, disconnect() {} }; } createGain() { return { gain: {}, connect() {} }; } }
Object.assign(globalThis, { window: Object.assign(win, { AudioContext: Ctx, AudioWorkletNode: class {} }), document: { addEventListener() {}, querySelectorAll: () => [], hidden: false }, URL: Object.assign(function () {}, { createObjectURL: () => "u", revokeObjectURL() {} }) });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: { getUserMedia: async () => { opened++; await new Promise(r => setTimeout(r, 30)); return stream; } }, permissions: { query: async () => ({ state: "granted" }) } } });
Object.assign(globalThis, { AudioContext: Ctx });
M.memoInit({ note() {}, onMemo() {}, blocked: () => false });
const btn = { dataset: { dict: "box" }, closest() { return this; }, setPointerCapture() {}, releasePointerCapture() {}, classList: { toggle() {}, contains: () => false }, style: { setProperty() {} }, getBoundingClientRect: () => ({ left: 0, right: 40, top: 0, bottom: 40 }) };
const press = async () => { fire("pointerdown", { target: btn, pointerId: 1, pointerType: "mouse", button: 0 }); fire("pointerup", { target: btn, pointerId: 1 }); };
await press();
const tap = M.takeTap();
assert.ok(tap && tap.ctx instanceof Ctx); assert.equal(opened, 1);
assert.equal(await tap.stream, stream); assert.equal(stopped, 0); assert.equal(closed, 0); assert.equal(M.takeTap(), null);
await new Promise(r => setTimeout(r, 50)); assert.equal(stopped, 0, "the open microphone stays open for dictation");
ok("a tap hands its already-open microphone to dictation (one getUserMedia, nothing closed)");

// 3. A tap nobody claims closes the microphone after 2 s.
await press(); await new Promise(r => setTimeout(r, 2100));
assert.equal(M.takeTap(), null); assert.equal(stopped, 1); assert.equal(closed, 1);
ok("an unclaimed tap microphone is closed");
