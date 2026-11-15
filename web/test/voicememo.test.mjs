// node test/voicememo.test.mjs: hold-to-record voice memos (src/voicememo.ts, src/pcm.ts wavOf).
// Checks: tap vs hold timing (300 ms), cancel by slide-off and Esc, the press state machine, the WAV header and bytes, memo numbering, limits.
import assert from "node:assert"; import { build } from "esbuild"; import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "vm-")), out = join(dir, "vm.mjs");
await build({ entryPoints: [new URL("../src/voicememo.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "warning" });
const M = await import(out);
const ok = (n) => console.log("  ok", n);

assert.equal(M.TAP_MS, 300);
assert.equal(M.decide(0), "tap"); assert.equal(M.decide(299), "tap"); assert.equal(M.decide(300), "hold"); assert.equal(M.decide(5000), "hold");
ok("tap under 300 ms, hold from 300 ms");

let g = new M.Gesture(); g.down(); assert.equal(g.up(), "tap"); assert.equal(g.state, "idle");
g = new M.Gesture(); g.down(); assert.equal(g.promote(), true); assert.equal(g.state, "hold"); assert.equal(g.up(), "release");
g = new M.Gesture(); g.down(); g.promote(); assert.equal(g.cancel(), true); assert.equal(g.up(), "none");
g = new M.Gesture(); g.down(); assert.equal(g.cancel(), true); assert.equal(g.promote(), false, "a cancelled press never becomes a hold");
g = new M.Gesture(); assert.equal(g.up(), "none"); assert.equal(g.cancel(), false); assert.equal(g.promote(), false);
ok("press state machine: tap, release, cancel, nothing pressed");

const r = { left: 100, right: 140, top: 200, bottom: 240 };
assert.equal(M.outside(r, 120, 220), false); assert.equal(M.outside(r, 100, 200), false); assert.equal(M.outside(r, 143, 220), false, "a few px of slop");
assert.equal(M.outside(r, 150, 220), true); assert.equal(M.outside(r, 120, 190), true); assert.equal(M.outside(r, 90, 220), true); assert.equal(M.outside(r, 120, 260), true);
ok("sliding off the button cancels (position check with a small slop)");

assert.equal(M.memoName([]), "Voice memo 1.wav");
assert.equal(M.memoName(["notes.pdf", "Voice memo 1.wav"]), "Voice memo 2.wav");
assert.equal(M.memoName(["Voice memo 1.wav", "Voice memo 2.wav"]), "Voice memo 3.wav");
assert.equal(M.memoName(["Voice memo 2.wav"]), "Voice memo 3.wav", "one more than the highest in the draft");
assert.equal(M.memoName(["My Voice memo 7.wav", "voice memo 9.mp3"]), "Voice memo 1.wav");
ok("memo naming within the unsent draft");

// WAV: 44-byte header, mono 16-bit PCM at 16 kHz, samples untouched
const { wavOf, PCM_RATE } = await (async () => { const o = join(dir, "pcm.mjs"); await build({ entryPoints: [new URL("../src/pcm.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "neutral", outfile: o, logLevel: "warning" }); return import(o); })();
const a = new Int16Array([1, -2, 3, 32767]).buffer, b = new Int16Array([-32768, 5]).buffer;
const wav = wavOf([a, b]), buf = Buffer.from(await wav.arrayBuffer());
assert.equal(wav.type, "audio/wav"); assert.equal(buf.length, 44 + 12);
assert.equal(buf.toString("ascii", 0, 4), "RIFF"); assert.equal(buf.readUInt32LE(4), 36 + 12); assert.equal(buf.toString("ascii", 8, 16), "WAVEfmt ");
assert.equal(buf.readUInt32LE(16), 16); assert.equal(buf.readUInt16LE(20), 1); assert.equal(buf.readUInt16LE(22), 1);
assert.equal(buf.readUInt32LE(24), 16000); assert.equal(buf.readUInt32LE(28), 32000); assert.equal(buf.readUInt16LE(32), 2); assert.equal(buf.readUInt16LE(34), 16);
assert.equal(buf.toString("ascii", 36, 40), "data"); assert.equal(buf.readUInt32LE(40), 12);
assert.deepEqual([...new Int16Array(buf.buffer.slice(buf.byteOffset + 44, buf.byteOffset + 56))], [1, -2, 3, 32767, -32768, 5]);
assert.equal(PCM_RATE, 16000);
ok("WAV header and PCM samples");

assert.equal(M.MIN_BYTES, 16000, "half a second of 16 kHz 16-bit audio"); assert.equal(M.MAX_MS, 600000); assert.equal(M.MAX_BYTES, 19200000);
assert.ok(M.MAX_BYTES < 25e6, "a 10 minute memo fits the 25 MB transcription limit");
ok("limits: under 0.5 s dropped, 10 minutes at most");

// the browser part, against a fake window, microphone and worklet
const L = {}, timers = []; let now = 1000, nodes = [], stops = 0, tracksStopped = 0;
const btn = { dataset: { dict: "box" }, classList: { toggle() {}, contains: () => false }, style: { setProperty() {} }, setPointerCapture() {}, releasePointerCapture() {}, getBoundingClientRect: () => r, closest(s) { return s === "[data-dict]" ? this : null; } };
class Node_ { constructor() { this.port = { postMessage: (m) => { if (m === "stop") { stops++; queueMicrotask(() => this.port.onmessage({ data: { type: "flushed" } })); } } }; nodes.push(this); } connect() {} disconnect() {} }
class Ctx { constructor() { this.state = "running"; this.audioWorklet = { addModule: async () => {} }; this.destination = {}; } resume() { return Promise.resolve(); } createMediaStreamSource() { return { connect() {}, disconnect() {} }; } createGain() { return { gain: {}, connect() {} }; } close() { return Promise.resolve(); } }
const track = { stop() { tracksStopped++; }, addEventListener() {} };
globalThis.window = { addEventListener: (t, f) => { (L[t] ||= []).push(f); }, setTimeout: (f, ms) => { timers.push({ f, ms, live: true }); return timers.length; }, AudioWorkletNode: Node_, AudioContext: Ctx };
globalThis.AudioWorkletNode = Node_;
globalThis.document = { querySelectorAll: () => [btn], addEventListener() {}, hidden: false };
Object.defineProperty(globalThis, "navigator", { value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) }, permissions: { query: async () => ({ state: "granted" }) } }, configurable: true });
Object.defineProperty(globalThis, "performance", { value: { now: () => now }, configurable: true });
globalThis.clearTimeout = (id) => { if (timers[id - 1]) timers[id - 1].live = false; }; globalThis.setTimeout = window.setTimeout;
const out2 = join(dir, "vm2.mjs"); await build({ entryPoints: [new URL("../src/voicememo.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "neutral", outfile: out2, logLevel: "warning" });
const V = await import(out2); const memos = [], notes = [];
const P = [], pill = { show: (b, line) => P.push(["show", line]), set: (o) => P.push(["set", o.leaving, o.line]), level: (v) => P.push(["level", v]), end: (k) => P.push(["end", k]) };
let choice = null; globalThis.navigator.vibrate = (n) => { P.push(["vibrate", n]); return true; };
V.memoInit({ note: (t) => notes.push(t), onMemo: (k, w) => memos.push([k, w]), blocked: () => false, choice: () => choice, pill });
const pl = (kind) => P.filter(e => e[0] === kind); const clearP = () => { P.length = 0; };
const fire = (t, e) => (L[t] || []).forEach(f => f({ preventDefault() { this.p = 1; }, stopImmediatePropagation() { this.s = 1; }, ...e }));
const tick = () => new Promise(r => setImmediate(r));
const fireTap = () => { for (const t of timers.splice(0)) if (t.live && t.ms === 300) t.f(); };
const audio = (sec) => nodes.at(-1).port.onmessage({ data: { type: "audio", pcm: new Int16Array(16000 * sec).buffer } });
const press = async () => { fire("pointerdown", { target: btn, pointerId: 1, pointerType: "touch", button: 0 }); await tick(); };
const clickEv = () => { const c = { target: btn, preventDefault() { this.p = 1; }, stopImmediatePropagation() { this.s = 1; } }; (L.click || []).forEach(f => f(c)); return c; };

// a hold of about 2 s of speech becomes a memo and its click is swallowed
await press(); fireTap(); assert.equal(V.memoActive(), true, "recording once held past 300 ms"); audio(2);
fire("pointerup", { target: btn, pointerId: 1 }); await tick(); await tick();
assert.equal(memos.length, 1); assert.equal(memos[0][0], "box"); assert.equal(memos[0][1].size, 44 + 64000); assert.equal(V.memoActive(), false);
assert.equal(clickEv().s, 1, "the click after a hold does not start dictation");
ok("a hold records 16 kHz PCM, builds a WAV on release and swallows the click");

// the pill: not before 300 ms, then the line for the account choice, a short buzz, and a final "done" after release
clearP(); await press(); assert.deepEqual(P, [], "no pill and no buzz before the 300 ms hold is confirmed");
fireTap(); assert.deepEqual(pl("show"), [["show", "Release to finish"]], "no choice yet"); assert.deepEqual(pl("vibrate"), [["vibrate", 10]]);
audio(2); fire("pointerup", { target: btn, pointerId: 1 }); await tick(); await tick();
assert.deepEqual(pl("end"), [["end", "done"]]); assert.equal(memos.length, 2);
for (const [c, line] of [["release", "Release to send"], ["manually", "Release to add"], [null, "Release to finish"]]) {
  choice = c; clearP(); await press(); fireTap(); assert.deepEqual(pl("show"), [["show", line]]); audio(1); fire("pointerup", { target: btn, pointerId: 1 }); await tick(); await tick();
}
assert.equal(V.releaseLine("release"), "Release to send"); assert.equal(V.releaseLine("manually"), "Release to add"); assert.equal(V.releaseLine(null), "Release to finish");
ok("pill appears after 300 ms with the right release line for each choice, buzz once");
memos.length = 0;

// sliding off shows the cancel state and sliding back restores it; the memo is canceled only at release
choice = "release"; clearP(); await press(); fireTap(); audio(2);
fire("pointermove", { pointerId: 1, clientX: 500, clientY: 500 });
assert.deepEqual(pl("set"), [["set", true, "Release to cancel"]]); assert.equal(V.memoActive(), true, "still recording while the cancel line shows"); assert.deepEqual(pl("end"), []);
fire("pointermove", { pointerId: 1, clientX: 500, clientY: 501 }); assert.equal(pl("set").length, 1, "no repeat update while still off the button");
fire("pointermove", { pointerId: 1, clientX: 120, clientY: 220 });
assert.deepEqual(pl("set").at(-1), ["set", false, "Release to send"]); assert.equal(V.memoActive(), true);
fire("pointermove", { pointerId: 1, clientX: 500, clientY: 500 }); fire("pointerup", { target: btn, pointerId: 1 }); await tick(); await tick();
assert.deepEqual(pl("end"), [["end", "cancel"]]); assert.equal(memos.length, 0, "released off the button: canceled"); assert.equal(clickEv().s, 1, "no dictation after the cancel");
ok("slide-off shows Release to cancel, sliding back restores, release off the button cancels");

// back on the button at release: the memo is kept
clearP(); await press(); fireTap(); audio(2); fire("pointermove", { pointerId: 1, clientX: 500, clientY: 500 }); fire("pointermove", { pointerId: 1, clientX: 120, clientY: 220 });
fire("pointerup", { target: btn, pointerId: 1 }); await tick(); await tick(); assert.deepEqual(pl("end"), [["end", "done"]]); assert.equal(memos.length, 1);
memos.length = 0; ok("returning to the button before release keeps the memo");

// Esc cancels at once, with the canceled announcement
clearP(); await press(); fireTap(); audio(2); fire("keydown", { key: "Escape" });
assert.deepEqual(pl("end"), [["end", "cancel"]]); fire("pointerup", { target: btn, pointerId: 1 }); await tick(); await tick(); assert.equal(memos.length, 0);
ok("Esc cancels at once");

// a tap never shows a pill, and a hold under half a second ends it quietly
clearP(); await press(); fire("pointerup", { target: btn, pointerId: 1 }); await tick(); assert.deepEqual(P, [], "a tap touches no pill");
clearP(); await press(); fireTap(); nodes.at(-1).port.onmessage({ data: { type: "audio", pcm: new Int16Array(4000).buffer } }); fire("pointerup", { target: btn, pointerId: 1 }); await tick(); await tick();
assert.deepEqual(pl("end"), [["end", "quiet"]]); clickEv();
ok("a tap shows no pill; a too-short hold ends it without an announcement");

// the mic level reaches the pill
clearP(); await press(); fireTap(); nodes.at(-1).port.onmessage({ data: { type: "level", value: 0.1 } }); assert.equal(pl("level")[0][1], 0.4); fire("keydown", { key: "Escape" }); fire("pointerup", { target: btn, pointerId: 1 }); await tick(); clickEv();
ok("mic level is passed to the pill");
memos.length = 0; memos.push(["box"]);   // back to the one memo the checks below count from

// a tap leaves the click to dictation and records nothing
await press(); fire("pointerup", { target: btn, pointerId: 1 }); await tick();
assert.equal(memos.length, 1); assert.equal(V.memoActive(), false); assert.equal(clickEv().s, undefined, "the click after a tap is left alone");
ok("a tap hands the click to dictation and opens no memo");

// under half a second: dropped without a word
await press(); fireTap(); nodes.at(-1).port.onmessage({ data: { type: "audio", pcm: new Int16Array(4000).buffer } });
fire("pointerup", { target: btn, pointerId: 1 }); await tick(); await tick();
assert.equal(memos.length, 1); assert.deepEqual(notes, []);
ok("a hold under 0.5 s of audio is discarded silently");

// Esc cancels and keeps the audio out
await press(); fireTap(); audio(2); const k = { key: "Escape" }; fire("keydown", k);
assert.equal(V.memoActive(), false); fire("pointerup", { target: btn, pointerId: 1 }); await tick(); await tick();
assert.equal(memos.length, 1); assert.equal(clickEv().s, 1, "no dictation after a cancel");
ok("Esc cancels the memo");

// sliding off the button cancels
await press(); fireTap(); audio(2); fire("pointermove", { pointerId: 1, clientX: 500, clientY: 500 });
fire("pointerup", { target: btn, pointerId: 1 }); await tick(); await tick(); assert.equal(V.memoActive(), false);
assert.equal(memos.length, 1);
ok("sliding off the button cancels the memo (at release)");

// still on the button: no cancel
await press(); fireTap(); audio(1); fire("pointermove", { pointerId: 1, clientX: 120, clientY: 220 });
assert.equal(V.memoActive(), true); fire("pointerup", { target: btn, pointerId: 1 }); await tick(); await tick();
assert.equal(memos.length, 2);
ok("moving within the button keeps recording");

// released before the microphone opened (permission prompt): nothing recorded, a note once it is allowed
let release; navigator.mediaDevices.getUserMedia = () => new Promise(res => { release = () => res({ getTracks: () => [track], getAudioTracks: () => [track] }); });
navigator.permissions.query = async () => ({ state: "prompt" });
await press(); fireTap(); fire("pointerup", { target: btn, pointerId: 1 }); await tick(); release(); await tick(); await tick();
assert.equal(memos.length, 2); assert.deepEqual(notes, ["Hold again to record"]);
ok("a hold that ends at the permission prompt records nothing and says to hold again");
console.log("PASS voicememo");
