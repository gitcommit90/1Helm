// node --import ./test/stubs/register.mjs test/speech-selfhost.test.mjs
// The self-hosted speech models (src/selfhost-speech.js, src/speech-container.js, src/speech-setup.js, src/speech-server-py.js): the pinned setup, the pool and its
// warming error, the dispatcher branches, the cost, the speaker numbers of a live session and its rebuild from R2, the container object's start, idle stop and
// template, the first-run data and the plan. Tests judge app facts only (what was sent where, what was charged, which step answered), never a model's wording.
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { SEED, withSettings } from "./helpers/seed-settings.mjs";
import { seedFresh, SEED_FACTS } from "../src/ee/model-seed.js";
import { validateModelSettings, modelSettingsOptions } from "../src/ee/model-settings.js";
import { plan } from "../src/ee/model-plan.js";
import { dispatch } from "../src/ee/model-dispatch.js";
import { JOB_KINDS, JOB_IDS, jobDef } from "../src/ee/model-jobs.js";
import { dollarsPerSecond } from "../src/selfhost-models.js";
import { speechWaitMs, SPEECH_WAIT_TIMING, SPEECH_WAIT_MAX_MS, SPEECH_MODELS, SPEECH_PLAN_RTF, speechSecNano, selfTranscribe, selfDiarize, selfSessionAppend, selfSessionDiarize, selfSessionEnd, isSpeechWarming, SpeechWarmingError, stabilizeSpeakers, sessionPrefix, sessionParts, usageOf, speechSlots, SPEECH_MAX_BYTES } from "../src/selfhost-speech.js";
import { speechSetup, SPEECH_WEIGHTS, SPEECH_REQS, SPEECH_VERIFY, SPEECH_INSTANCE, LLAMA_SHA } from "../src/speech-setup.js";
import { SPEECH_PY } from "../src/speech-server-py.js";
import { SPEAKER_EVERY_MS } from "../src/ee/speaker-labels-core.js";
import { SpeechContainer, SPEECH_TIMING, SPEECH_ENTRYPOINT, SPEECH_IDLE_MS } from "../src/speech-container.js";
import { stt } from "../src/transcribe.js";
import { speakerLabels } from "../src/ee/speaker-labels.js";

const clone = (x) => JSON.parse(JSON.stringify(x));
const QWEN = SPEECH_MODELS.qwen, NEMO = SPEECH_MODELS.nemotron, DIAR = SPEECH_MODELS.diar;
const WAV = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);

// ---- fakes ----
// A pool of slots. state: "ready" | "warming" | "cold". handler(slotIndex, request) answers a request to a ready slot.
function fakePool({ slots = 3, ready = [], handler = null, r2 = null } = {}) {
  const st = Array.from({ length: slots }, (_, i) => ({ state: ready.includes(i) ? "ready" : "cold", inflight: 0 }));
  const calls = [], warmed = [], sess = new Map(), dropped = [];
  const answer = handler || ((i, r) => {
    if (r.path.startsWith("/transcribe")) return { state: "ok", status: 200, body: JSON.stringify({ text: "hello there", segs: [{ s: 0, e: 3, t: "hello there" }], words: r.path.includes("nemotron") ? [{ w: "hello", s: 0.1, e: 0.4 }, { w: "there", s: 0.5, e: 0.9 }] : [], audio_s: 3, process_ms: 1500 }) };
    if (r.path.startsWith("/diarize")) return { state: "ok", status: 200, body: JSON.stringify({ turns: [{ s: 0, e: 2, speaker: 0 }, { s: 2.5, e: 4, speaker: 1 }], audio_s: 4, process_ms: 200 }) };
    return { state: "ok", status: 200, body: JSON.stringify({ ok: true, chunks: 1 }) };
  });
  const stub = (i) => ({
    speechState: async () => ({ state: st[i].state, inflight: st[i].inflight, booting: st[i].booting }),
    warm: async () => { warmed.push(i); if (st[i].state === "cold") st[i].state = "warming"; return { state: "warming" }; },
    speechRequest: async (r) => { calls.push({ i, ...r }); return answer(i, r); },
  });
  const co = { sessionGet: async (k) => sess.get(k) || null, sessionPut: async (k, v) => { sess.set(k, v); return true; }, sessionDrop: async (k) => { sess.delete(k); dropped.push(k); return true; } };
  const env = { SPEECH_CONTAINER: { idFromName: (n) => n, get: (n) => (n === "speech:coordinator" ? co : stub(Number(n.split(":")[1]))) }, SPEECH_MAX_INSTANCES: String(slots), ...(r2 ? { WS: r2 } : {}) };
  return { env, st, calls, warmed, sess, dropped };
}
const fakeR2 = (objects) => ({
  async list({ prefix, cursor }) { const keys = Object.keys(objects).filter((k) => k.startsWith(prefix)).sort(); return { objects: keys.map((key) => ({ key })), truncated: false, cursor }; },
  async get(key) { const o = objects[key]; return o ? { customMetadata: o.meta, arrayBuffer: async () => o.bytes.buffer } : null; },
});

// ---- the pinned setup ----
test("the setup pins every wheel, the llama.cpp release and every weight file by SHA-256, and is valid shell", () => {
  const lines = SPEECH_REQS.split("\n");
  assert.ok(lines.length > 40);
  for (const l of lines) assert.match(l, /^[A-Za-z0-9_.-]+==[A-Za-z0-9_.+!-]+( --hash=sha256:[0-9a-f]{64})+$/, l);
  assert.ok(lines.some((l) => l.startsWith("torch==2.8.0+cpu ")) && lines.some((l) => l.startsWith("transformers==5.20.2 ")) && lines.some((l) => l.startsWith("imageio-ffmpeg==")));
  const script = speechSetup();
  for (const w of Object.values(SPEECH_WEIGHTS)) { assert.match(w.rev, /^[0-9a-f]{40}$/); for (const sha of Object.values(w.files)) { assert.match(sha, /^[0-9a-f]{64}$/); assert.ok(script.includes(sha)); } }
  assert.match(LLAMA_SHA, /^[0-9a-f]{64}$/); assert.ok(script.includes(LLAMA_SHA)); assert.match(script, /b11826/);
  assert.match(script, /--require-hashes --only-binary :all: --no-deps/); assert.match(script, /sha256sum -c/);
  assert.equal(spawnSync("bash", ["-n"], { input: script }).status, 0, "bash -n");
  assert.match(SPEECH_VERIFY, /llama-server/); assert.equal(SPEECH_INSTANCE, "standard-4");
  // the embedded Python is valid and uses none of the characters that would break the shell heredoc or the JS template
  assert.ok(!SPEECH_PY.includes("`") && !SPEECH_PY.includes("${") && !SPEECH_PY.split("\n").includes("1HC_PY"));
  const py = spawnSync("python3", ["-I", "-c", "import sys, ast; ast.parse(sys.stdin.read())"], { input: SPEECH_PY });
  assert.equal(py.status, 0, String(py.stderr));
});

test("the server's pure parts: one request at a time with short audio first, speaker numbers by first appearance, num_speakers, and times mapped back to the session timeline", () => {
  const script = `
import threading, time, json, sys
src = sys.stdin.read()
def cut(a, b): return src[src.index(a):src.index(b)]
ns = {"threading": threading, "time": time}
exec(cut("class Gate:", "GATE = Gate()"), ns)
exec(cut("def relabel(", "def run_diar("), ns)
exec(cut("def to_timeline(", "class H("), ns)
G = ns["Gate"](); order = []
def job(name, aud):
    with G(aud):
        order.append(name); time.sleep(0.25 if name == "long1" else 0.02)
ts = [threading.Thread(target=job, args=("long1", 100))]; ts[0].start(); time.sleep(0.1)
for n, a in (("long2", 90), ("short1", 3), ("short2", 2), ("mid", 30)):
    t = threading.Thread(target=job, args=(n, a)); ts.append(t); t.start(); time.sleep(0.02)
for t in ts: t.join()
turns = [{"s": 5.0, "e": 6.0, "speaker": 7}, {"s": 0.0, "e": 2.0, "speaker": 3}, {"s": 2.5, "e": 4.0, "speaker": 7}, {"s": 8.0, "e": 8.5, "speaker": 9}]
r = ns["relabel"](json.loads(json.dumps(turns)))
one = ns["relabel"](json.loads(json.dumps(turns)), 2)
marks = [(0, 0), (4000, 5200), (9000, 10400)]
print(json.dumps({"order": order, "speakers": [t["speaker"] for t in r], "capped": sorted({t["speaker"] for t in one}), "first": r[0]["s"],
  "timeline": [ns["to_timeline"](x, marks) for x in (0, 3999, 4000, 4500, 9500)]}))
`;
  const out = spawnSync("python3", ["-I", "-c", script], { input: SPEECH_PY });
  assert.equal(out.status, 0, String(out.stderr));
  const j = JSON.parse(String(out.stdout));
  assert.deepEqual(j.order, ["long1", "short2", "short1", "mid", "long2"]);
  assert.deepEqual(j.speakers, [0, 1, 1, 2], "numbered by first appearance in time"); assert.equal(j.first, 0);
  assert.deepEqual(j.capped, [0, 1], "num_speakers 2 keeps the two who talk most");
  assert.deepEqual(j.timeline, [0, 3999, 5200, 5700, 10900], "a time in the assembled audio maps to the session time of the chunk it is in");
});

// ---- the speaker numbers ----
test("stabilizeSpeakers keeps an earlier number for the voice that overlaps it most, and gives a new voice a new number", () => {
  const prev = [{ start_ms: 0, end_ms: 2000, speaker: 0 }, { start_ms: 2500, end_ms: 4000, speaker: 1 }];
  // the diarizer numbers by first appearance, so a session that now starts with the other voice swaps the numbers
  const next = [{ start_ms: 0, end_ms: 2100, speaker: 1 }, { start_ms: 2500, end_ms: 4100, speaker: 0 }, { start_ms: 5000, end_ms: 6000, speaker: 2 }, { start_ms: 6500, end_ms: 7000, speaker: 1 }];
  assert.deepEqual(stabilizeSpeakers(prev, next).map((t) => t.speaker), [0, 1, 2, 0]);
  assert.deepEqual(stabilizeSpeakers(null, next).map((t) => t.speaker), [1, 0, 2, 1], "the first result is kept as it came");
  assert.deepEqual(stabilizeSpeakers(prev, []), []);
  // no overlap at all: both are new voices
  assert.deepEqual(stabilizeSpeakers([{ start_ms: 0, end_ms: 100, speaker: 0 }], [{ start_ms: 500, end_ms: 900, speaker: 0 }, { start_ms: 1000, end_ms: 1200, speaker: 1 }]).map((t) => t.speaker), [1, 2]);
});

// ---- the cost ----
test("cost is the container's measured compute seconds at the standard-4 rate, and reservations cover the planned real time factor", () => {
  const rate = 4 * 0.00002 + 12 * 0.0000025 + 20 * 0.00000007;
  assert.equal(dollarsPerSecond("standard-4"), rate);
  const u = usageOf({ process_ms: 2500, audio_s: 6 });
  assert.equal(u.cost, 2.5 * rate); assert.equal(u.container_ms, 2500); assert.equal(u.audio_s, 6); assert.equal(u.instance, "standard-4");
  assert.equal(usageOf({}).cost, 0);
  for (const [kind, id] of [["qwen", QWEN], ["nemotron", NEMO], ["diar", DIAR]]) {
    assert.equal(SEED_FACTS[id].sec_nano, speechSecNano(kind), `${id}: the first-run price equals the plan`);
    assert.ok(speechSecNano(kind) >= Math.ceil(SPEECH_PLAN_RTF[kind] * rate * 1e9));
  }
  // the worst measured real time factors (0.48, 0.23, 0.04) cost less than the reservation for the same audio
  assert.ok(0.48 * rate * 1e9 < speechSecNano("qwen") && 0.3 * rate * 1e9 < speechSecNano("nemotron") && 0.13 * rate * 1e9 < speechSecNano("diar"));
});

// ---- the client and the pool ----
test("selfTranscribe sends the audio to a ready slot and returns segments, words and the measured cost; an unknown model never reaches a container", async () => {
  const p = fakePool({ ready: [1] });
  const r = await selfTranscribe(p.env, NEMO, { audio: WAV, format: "webm", language: "en-US" }, { tenant: "t1" });
  assert.equal(r.model, NEMO); assert.deepEqual(r.segs, [{ s: 0, e: 3, t: "hello there" }]); assert.equal(r.words.length, 2);
  assert.equal(p.calls.length, 1); assert.equal(p.calls[0].i, 1); assert.equal(p.calls[0].method, "POST");
  assert.equal(p.calls[0].path, "/transcribe?model=nemotron&format=webm&lang=en-US"); assert.equal(p.calls[0].body.byteLength, WAV.byteLength);
  assert.equal(r.usage.container_ms, 1500); assert.equal(r.usage.cost, 1.5 * dollarsPerSecond("standard-4"));
  const q = await selfTranscribe(p.env, QWEN, { audio: WAV, format: "wav" }); assert.equal(q.words.length, 0); assert.equal(p.calls[1].path, "/transcribe?model=qwen&format=wav");
  const n = fakePool({ ready: [0] });
  await assert.rejects(() => selfTranscribe(n.env, DIAR, { audio: WAV }), /cannot transcribe/); await assert.rejects(() => selfTranscribe(n.env, "@1hc/nobody/nothing", { audio: WAV }), /cannot transcribe/);
  await assert.rejects(() => selfTranscribe(n.env, QWEN, { audio: WAV, format: "exe" }), /does not read exe audio/);
  await assert.rejects(() => selfTranscribe(n.env, QWEN, { audio: new Uint8Array(0) }), /no audio/);
  await assert.rejects(() => selfTranscribe(n.env, QWEN, { audio: new Uint8Array(SPEECH_MAX_BYTES + 1) }), /too large/);
  assert.equal(n.calls.length, 0);
  await assert.rejects(() => selfTranscribe({}, QWEN, { audio: WAV }), /No speech container is available/);
});
// ---- the wait of a last model ----
test("speechWaitMs: only the last model of a chain waits, never past the job's limit, and a limit too short for a cold start gets no wait", () => {
  assert.equal(speechWaitMs({ last: false, limitMs: 180000 }), 0, "a model with a next model never waits");
  assert.equal(speechWaitMs({ last: true, limitMs: 180000 }), SPEECH_WAIT_MAX_MS, "a long limit gets the longest wait (90 s)");
  assert.equal(speechWaitMs({ last: true, limitMs: 0 }), SPEECH_WAIT_MAX_MS, "no limit set: the longest wait");
  assert.equal(speechWaitMs({ last: true, limitMs: 80000 }), 70000, "the wait ends 10 s before the limit");
  assert.equal(speechWaitMs({ last: true, limitMs: 70000 }), 60000);
  assert.equal(speechWaitMs({ last: true, limitMs: 30000 }), 0, "the 30 s limit of stt cannot fit a cold start of about a minute");
  assert.equal(speechWaitMs({ last: true, limitMs: 6000 }), 0, "the 6 s limit of live dictation cannot either");
  assert.equal(speechWaitMs({}), 0);
});
test("a call with a wait polls the cold pool until a slot is ready, then answers; without a wait, or after the wait, it throws the warming error", async () => {
  const keep = SPEECH_WAIT_TIMING.pollMs; SPEECH_WAIT_TIMING.pollMs = 5;
  try {
    const p = fakePool({ ready: [] }); let polls = 0;
    const orig = p.env.SPEECH_CONTAINER.get; p.env.SPEECH_CONTAINER.get = (n) => { const o = orig(n); if (n === "speech:0") { const st = o.speechState; o.speechState = async () => { if (++polls === 4) p.st[0].state = "ready"; return st(); }; } return o; };
    const r = await selfTranscribe(p.env, QWEN, { audio: WAV }, {}, { waitMs: 2000 });
    assert.equal(r.segs[0].t, "hello there"); assert.ok(polls >= 4, "it waited for the slot"); assert.deepEqual(p.warmed, [0], "one start, not one per poll"); assert.equal(p.calls.length, 1);
    const q = fakePool({ ready: [] }); const t0 = Date.now();
    await assert.rejects(() => selfTranscribe(q.env, QWEN, { audio: WAV }, {}, { waitMs: 60 }), isSpeechWarming); assert.ok(Date.now() - t0 >= 40, "it waited up to the bound");
    const n = fakePool({ ready: [] }); const t1 = Date.now();
    await assert.rejects(() => selfTranscribe(n.env, QWEN, { audio: WAV }, {}, { waitMs: 0 }), isSpeechWarming); await assert.rejects(() => selfDiarize(n.env, DIAR, { audio: WAV }), isSpeechWarming);
    assert.ok(Date.now() - t1 < 40, "no wait asked, none taken");
    const a = fakePool({ ready: [] }), ctl = new AbortController(); ctl.abort();
    await assert.rejects(() => selfTranscribe(a.env, QWEN, { audio: WAV }, {}, { waitMs: 2000, signal: ctl.signal }), isSpeechWarming);
    const f = fakePool({ ready: [0], handler: () => ({ state: "ok", status: 500, body: JSON.stringify({ error: "boom" }) }) });
    await assert.rejects(() => selfTranscribe(f.env, QWEN, { audio: WAV }, {}, { waitMs: 2000 }), /failed \(500/); assert.equal(f.calls.length, 1, "only the warming error is waited out");
  } finally { SPEECH_WAIT_TIMING.pollMs = keep; }
});
test("a cold pool throws the warming error at once and starts exactly one slot in the background", async () => {
  const p = fakePool({ ready: [] });
  await assert.rejects(() => selfTranscribe(p.env, QWEN, { audio: WAV }), (e) => e instanceof SpeechWarmingError && e.warming === true && isSpeechWarming(e));
  assert.deepEqual(p.warmed, [0]); assert.equal(p.calls.length, 0, "no request waits for the start");
  // a second call while slot 0 is starting starts nothing more
  await assert.rejects(() => selfDiarize(p.env, DIAR, { audio: WAV }), isSpeechWarming); assert.deepEqual(p.warmed, [0]);
  // the slot the call hit may stop between the check and the request: the same answer
  const q = fakePool({ ready: [0], handler: () => ({ state: "cold" }) });
  await assert.rejects(() => selfTranscribe(q.env, QWEN, { audio: WAV }), isSpeechWarming);
  // a container that is up but still loading its models answers 503 loading
  const l = fakePool({ ready: [0], handler: () => ({ state: "ok", status: 503, body: JSON.stringify({ error: "loading" }) }) });
  await assert.rejects(() => selfTranscribe(l.env, QWEN, { audio: WAV }), isSpeechWarming);
  // any other failure is a plain error
  const f = fakePool({ ready: [0], handler: () => ({ state: "ok", status: 500, body: JSON.stringify({ error: "boom" }) }) });
  await assert.rejects(() => selfTranscribe(f.env, QWEN, { audio: WAV }), (e) => !e.warming && /failed \(500: boom\)/.test(e.message));
});
test("a warming answer always means a start is running: a slot that is warming with no start gets one, and a request that finds a cold slot starts it", async () => {
  const p = fakePool({ slots: 2, ready: [] });
  p.st[0] = { state: "warming", inflight: 0, booting: false };   // a running container whose object lost track of it
  const warm0 = p.env.SPEECH_CONTAINER.get("speech:0").warm;
  await assert.rejects(() => selfSessionAppend(p.env, KEY, { seq: 0, at_ms: 0, audio: WAV }), isSpeechWarming);
  assert.ok(p.warmed.includes(0), "the slot that said warming without booting is started"); assert.equal(typeof warm0, "function");
  // a slot that was ready at the check but answers cold at the request is started again, for a session call too
  const q = fakePool({ slots: 2, ready: [0], handler: () => ({ state: "warming" }) });
  await assert.rejects(() => selfSessionDiarize(q.env, KEY, DIAR, {}), isSpeechWarming); assert.ok(q.warmed.length >= 1, "a start is kicked");
});
test("a running container the object does not know is checked, and when it does not answer ready a start runs until it is ready or stopped", async () => {
  const x = objects(), co = x.add("speech:coordinator"); await co.o.buildTemplate();
  const s = x.add("speech:0", { healthAfter: 4 });
  s.setRunning(true);   // the container runs, this object (after an eviction or a deploy) thinks nothing
  const st = await s.o.speechState();
  assert.equal(st.state, "warming"); assert.equal(st.booting, true, "a start is in progress, not just a word");
  await s.o._boot;
  assert.equal((await s.o.speechState()).state, "ready"); assert.equal(s.starts.length, 0, "the running container was not started again");
  const r = await s.o.speechRequest({ path: "/x" }); assert.equal(r.state, "ok");
});
test("the pool uses the lowest ready slot, then the least busy one, wakes another slot only when every ready slot is full, and honours the cap", async () => {
  const p = fakePool({ slots: 4, ready: [1, 2] });
  await selfTranscribe(p.env, QWEN, { audio: WAV }); assert.equal(p.calls.at(-1).i, 1); assert.deepEqual(p.warmed, []);
  p.st[1].inflight = 2; await selfTranscribe(p.env, QWEN, { audio: WAV }); assert.equal(p.calls.at(-1).i, 2, "the least busy ready slot");
  p.st[1].inflight = 3; p.st[2].inflight = 3; await selfTranscribe(p.env, QWEN, { audio: WAV });
  assert.deepEqual(p.warmed, [0], "all ready slots are full, so one more starts and the call still goes to a ready slot"); assert.equal(p.calls.length, 3);
  assert.equal(speechSlots({ SPEECH_MAX_INSTANCES: "4" }), 4); assert.equal(speechSlots({}), 1); assert.equal(speechSlots({ SPEECH_MAX_INSTANCES: "x" }), 1); assert.equal(speechSlots({ SPEECH_MAX_INSTANCES: "500" }), 64);
  const one = fakePool({ slots: 1, ready: [0] }); one.st[0].inflight = 9; await selfTranscribe(one.env, QWEN, { audio: WAV }); assert.deepEqual(one.warmed, [], "never beyond the cap");
});
test("selfDiarize returns turns by first appearance and caps num_speakers", async () => {
  const p = fakePool({ ready: [0] });
  const r = await selfDiarize(p.env, DIAR, { audio: WAV, format: "wav", num_speakers: 2 }, {});
  assert.deepEqual(r.turns, [{ s: 0, e: 2, speaker: 0 }, { s: 2.5, e: 4, speaker: 1 }]); assert.equal(p.calls[0].path, "/diarize?format=wav&num_speakers=2"); assert.equal(r.usage.container_ms, 200);
  await selfDiarize(p.env, DIAR, { audio: WAV, num_speakers: 99 }); assert.equal(p.calls[1].path, "/diarize?format=wav&num_speakers=16");
  await assert.rejects(() => selfDiarize(p.env, QWEN, { audio: WAV }), /cannot label speakers/);
});

// ---- live sessions ----
const KEY = "t1:main:task7:s2";
test("session keys map to the R2 prefix the live notes code writes, and bad keys are refused", () => {
  assert.equal(sessionPrefix(KEY), "t/t1/live-audio/main/task7/s2/"); assert.deepEqual(sessionParts(KEY), { tenant: "t1", channel: "main", task: "task7", run: "s2" });
  for (const bad of ["", "a:b:c", "a:b:c:2", "a:b/..:c:s1", "a:b:c:s1:x", "../x:b:c:s1", "a:b:c:s"]) assert.throws(() => sessionParts(bad), /bad session key/, bad);
});
test("a session: chunks go to its own slot, diarize rebuilds what the container lacks from R2, and speaker numbers stay stable across calls", async () => {
  const wav = (n) => new Uint8Array([n, n, n]), P = "t/t1/live-audio/main/task7/s2/";
  const r2 = fakeR2({ [`${P}0.wav`]: { bytes: wav(0), meta: { at_ms: "0" } }, [`${P}1.wav`]: { bytes: wav(1), meta: { at_ms: "4000" } }, [`${P}2.wav`]: { bytes: wav(2), meta: { at_ms: "9000" } }, [`${P}3.wav`]: { bytes: wav(3) }, "t/t1/live-audio/main/other/s1/0.wav": { bytes: wav(9) } });
  let held = [0, 1], round = 0;
  const handler = (i, r) => {
    if (r.method === "GET") return { state: "ok", status: 200, body: JSON.stringify({ seqs: held }) };
    if (r.path.includes("/chunk")) { const q = Number(/seq=(\d+)/.exec(r.path)[1]); if (!held.includes(q)) held.push(q); return { state: "ok", status: 200, body: JSON.stringify({ ok: true, chunks: held.length }) }; }
    if (r.path.endsWith("/diarize")) { round++; return { state: "ok", status: 200, body: JSON.stringify(round === 1 ? { turns: [{ start_ms: 0, end_ms: 3000, speaker: 0 }, { start_ms: 4000, end_ms: 8000, speaker: 1 }], audio_s: 8, process_ms: 400 } : { turns: [{ start_ms: 0, end_ms: 3000, speaker: 1 }, { start_ms: 4000, end_ms: 8000, speaker: 0 }, { start_ms: 9000, end_ms: 12000, speaker: 2 }], audio_s: 12, process_ms: 600 }) }; }
    return { state: "ok", status: 200, body: "{}" };
  };
  const p = fakePool({ slots: 2, ready: [0, 1], handler, r2 });
  const a = await selfSessionAppend(p.env, KEY, { seq: 1, at_ms: 4000, audio: wav(1), format: "wav" });
  assert.deepEqual(a, { ok: true, chunks: 2 }); assert.match(p.calls[0].path, new RegExp(`^/session/${encodeURIComponent(KEY)}/chunk\\?seq=1&at_ms=4000&format=wav$`));
  const slot = p.calls[0].i; p.calls.length = 0;
  const d1 = await selfSessionDiarize(p.env, KEY, DIAR, {});
  assert.deepEqual(p.calls.map((c) => c.path.replace(/^\/session\/[^/]+/, "").replace(/\?.*/, "")), ["", "/chunk", "/chunk", "/diarize"], "the container held 0 and 1, so 2 and 3 come from R2, in order");
  assert.ok(p.calls.every((c) => c.i === slot), "one slot serves the whole call");
  assert.deepEqual(p.calls.slice(1, 3).map((c) => /seq=(\d+)&at_ms=(-?\d+)/.exec(c.path).slice(1).join(":")), ["2:9000", "3:-1"], "at_ms comes from the R2 metadata, -1 when it is missing");
  assert.deepEqual(d1.turns.map((t) => t.speaker), [0, 1]); assert.equal(d1.usage.container_ms, 400);
  assert.deepEqual(p.sess.get(KEY).map((t) => t.speaker), [0, 1], "the numbers are kept");
  const d2 = await selfSessionDiarize(p.env, KEY, DIAR, {});
  assert.deepEqual(d2.turns.map((t) => t.speaker), [0, 1, 2], "the new run numbered the same voices 1, 0, 2, and they are renamed to the earlier numbers");
  assert.equal(p.calls.filter((c) => c.path.includes("/chunk")).length, 2, "nothing is uploaded twice");
  const e = await selfSessionEnd(p.env, KEY); assert.deepEqual(e, { ok: true }); assert.deepEqual(p.dropped, [KEY]); assert.equal(p.sess.has(KEY), false);
  assert.ok(p.calls.some((c) => c.method === "DELETE" && c.path === `/session/${encodeURIComponent(KEY)}`), "the ready slots drop their copy");
  await assert.rejects(() => selfSessionDiarize(p.env, KEY, QWEN), /cannot label speakers/);
  await assert.rejects(() => selfSessionAppend(p.env, "bad", { seq: 0, audio: wav(0) }), /bad session key/);
});
test("a restarted container is rebuilt from R2 whole, and a cold pool makes an append and a session diarize throw warming", async () => {
  const P = "t/t1/live-audio/main/task7/s2/", r2 = fakeR2({ [`${P}0.wav`]: { bytes: new Uint8Array([1]), meta: { at_ms: "0" } }, [`${P}1.wav`]: { bytes: new Uint8Array([2]), meta: { at_ms: "2000" } } });
  const p = fakePool({ ready: [0], r2, handler: (i, r) => (r.method === "GET" ? { state: "ok", status: 200, body: JSON.stringify({ seqs: [] }) } : { state: "ok", status: 200, body: JSON.stringify(r.path.endsWith("/diarize") ? { turns: [{ start_ms: 0, end_ms: 1000, speaker: 0 }], audio_s: 3, process_ms: 90 } : { ok: true, chunks: 1 }) }) });
  p.sess.set(KEY, [{ start_ms: 0, end_ms: 1000, speaker: 3 }]);
  const d = await selfSessionDiarize(p.env, KEY, DIAR, {});
  assert.equal(p.calls.filter((c) => c.path.includes("/chunk")).length, 2); assert.deepEqual(d.turns.map((t) => t.speaker), [3], "the numbers survive the restart because the coordinator kept them");
  const c = fakePool({ ready: [] });
  await assert.rejects(() => selfSessionAppend(c.env, KEY, { seq: 0, at_ms: 0, audio: WAV }), isSpeechWarming);
  await assert.rejects(() => selfSessionDiarize(c.env, KEY, DIAR, {}), isSpeechWarming); assert.equal(c.warmed.length, 1, "one slot starts, the session's own");
});

// ---- the dispatcher ----
const jobWith = (id, main, fallbacks = []) => { const c = clone(SEED); for (const m of [main, ...fallbacks]) if (!c.catalog[m]) c.catalog[m] = { id: m, ...clone(SEED_FACTS[m]) }; c.jobs[id] = { model: main, effort: null, fallbacks: fallbacks.map((model) => ({ model, effort: null })) }; return validateModelSettings(c); };
test("dispatch: a SELF step of the stt job reads like any other transcription answer, and a SELF step of speaker_labels diarizes audio or a session", async () => {
  const p = fakePool({ ready: [0] });
  const e = withSettings({ ...p.env }, jobWith("stt", NEMO));
  const request = { self: async () => ({ audio: WAV, format: "webm" }), skip: () => null };
  const r = await dispatch(e, "stt", request, { meta: { tenant: "t1" } }), j = await r.json();
  assert.equal(r.requested, NEMO); assert.equal(j.model, NEMO); assert.equal(j.text, "hello there"); assert.deepEqual(j.segments, [{ start: 0, end: 3, text: "hello there" }]); assert.equal(j.words.length, 2);
  assert.equal(j.duration, 3); assert.equal(j.usage.seconds, 3); assert.equal(j.usage.cost, 1.5 * dollarsPerSecond("standard-4"));
  await assert.rejects(() => dispatch(e, "stt", {}, {}), /no audio for the 1Helm container/);
  const d = withSettings({ ...p.env }, jobWith("speaker_labels", DIAR));
  const a = await (await dispatch(d, "speaker_labels", { audio: WAV, format: "wav", num_speakers: 2 }, { meta: { tenant: "t1" } })).json();
  assert.equal(a.model, DIAR); assert.deepEqual(a.turns.map((t) => t.speaker), [0, 1]); assert.equal(a.usage.container_ms, 200);
  const sp = fakePool({ ready: [0], r2: fakeR2({}), handler: (i, r) => ({ state: "ok", status: 200, body: JSON.stringify(r.method === "GET" ? { seqs: [] } : { turns: [{ start_ms: 0, end_ms: 500, speaker: 0 }], audio_s: 1, process_ms: 50 }) }) });
  const s = await (await dispatch(withSettings({ ...sp.env }, jobWith("speaker_labels", DIAR)), "speaker_labels", { session: KEY }, { meta: { tenant: "t1" } })).json();
  assert.deepEqual(s.turns, [{ start_ms: 0, end_ms: 500, speaker: 0 }]); assert.equal(s.model, DIAR);
});
test("speakerLabels is the call site of the job: it answers with the parsed turns and passes warming on", async () => {
  const p = fakePool({ ready: [0] }), e = withSettings({ ...p.env }, jobWith("speaker_labels", DIAR));
  const r = await speakerLabels(e, { audio: WAV, format: "wav" }, { meta: { tenant: "t1" } });
  assert.equal(r.model, DIAR); assert.equal(r.turns.length, 2); assert.equal(r.usage.cost, 0.2 * dollarsPerSecond("standard-4"));
  const cold = withSettings({ ...fakePool({ ready: [] }).env }, jobWith("speaker_labels", DIAR));
  await assert.rejects(() => speakerLabels(cold, { audio: WAV, format: "wav" }, {}), (err) => isSpeechWarming(err) && /warming|starting/i.test(err.message));
});
test("warming: the SELF step throws, the next model of the job answers, and nothing is charged for the failed step", async () => {
  const p = fakePool({ ready: [] });
  const fallback = "openai/whisper-large-v3-turbo", orSeen = [];
  const e = withSettings({ OPENROUTER_API_KEY: "k", ...p.env }, jobWith("stt", QWEN, [fallback]));
  const fetchImpl = async (u, init) => { orSeen.push(String(u)); return Response.json({ text: "from the fallback", duration: 2, usage: { seconds: 2, cost: 0.00001 }, segments: [{ start: 0, end: 2, text: "from the fallback", avg_logprob: -0.1 }] }); };
  const out = await stt(e, { bytes: WAV }, { format: "webm", meta: { tenant: "t1" }, fetchImpl });
  assert.equal(out.model, fallback); assert.equal(out.text, "from the fallback"); assert.equal(out.nano, 10000);
  assert.deepEqual(p.warmed, [0], "the slot started in the background"); assert.equal(p.calls.length, 0);
  assert.equal(orSeen.length, 1);
  // once the container is ready the first model answers, with word times kept and the measured cost
  p.st[0].state = "ready";
  const again = await stt(e, { bytes: WAV }, { format: "webm", meta: { tenant: "t1" }, fetchImpl });
  assert.equal(again.model, QWEN); assert.equal(again.text, "hello there"); assert.equal(again.dur, 3); assert.equal(again.nano, Math.ceil(1.5 * dollarsPerSecond("standard-4") * 1e9)); assert.equal(orSeen.length, 1, "no outside call");
  assert.equal(again.words, undefined, "the stub's qwen path gives no word times");
  const nemo = await stt(withSettings({ ...p.env }, jobWith("stt", NEMO)), { bytes: WAV }, { format: "wav", meta: { tenant: "t1" }, fetchImpl });
  assert.equal(nemo.words.length, 2);
});
test("a live dictation step of a SELF model is planned as a chunked transcription, never a socket", async () => {
  const c = jobWith("live_dictation", NEMO, ["@cf/deepgram/nova-3"]);
  const steps = plan(c, "live_dictation", { level: "zdr" }).steps;
  assert.deepEqual(steps.map((s) => [s.model, s.source, s.adapter]), [[NEMO, "SELF", "transcribe"], ["@cf/deepgram/nova-3", "CF", "transcribe_live"]]);
  const p = fakePool({ ready: [0] });
  const r = await dispatch(withSettings({ ...p.env }, c), "live_dictation", { self: async () => ({ audio: WAV, format: "wav" }) }, { model: NEMO, meta: { tenant: "t1" } });
  assert.equal((await r.json()).model, NEMO);
  await assert.rejects(() => dispatch(withSettings({ ...p.env }, c), "live_dictation", {}, { model: NEMO, meta: {} }), /no audio/);
});

// ---- first-run data, jobs and the plan ----
test("first-run data: the three models are in the facts, speaker_labels is a job of the new diarize kind, and the plan routes it to the container", () => {
  assert.deepEqual(SEED_FACTS[QWEN].kinds, ["speech"]); assert.deepEqual(SEED_FACTS[NEMO].kinds, ["speech", "speech_live"]); assert.deepEqual(SEED_FACTS[DIAR].kinds, ["diarize"]);
  const s = validateModelSettings(seedFresh({}));
  assert.equal(s.jobs.speaker_labels.model, DIAR); assert.deepEqual(s.jobs.speaker_labels.fallbacks, []); assert.ok(s.catalog[DIAR]);
  assert.ok(JOB_IDS.includes("speaker_labels")); assert.equal(jobDef("speaker_labels").kind, "diarize"); assert.equal(JOB_KINDS.diarize.fallbacks, 0); assert.equal(JOB_KINDS.diarize.pick, "diarize");
  assert.deepEqual(plan(s, "speaker_labels", { level: "zdr" }).steps.map((x) => [x.model, x.source, x.adapter, x.provider]), [[DIAR, "SELF", "diarize", null]]);
  // the Models page offers each speech model for its kind only
  const choices = modelSettingsOptions(s).choices;
  assert.ok(choices.diarize.some((m) => m.id === DIAR && m.source === "SELF")); assert.ok(!choices.diarize.some((m) => m.id === QWEN));
  assert.ok(choices.speech.some((m) => m.id === QWEN) && choices.speech.some((m) => m.id === NEMO) && !choices.speech.some((m) => m.id === DIAR));
  assert.ok(choices.speech_live.some((m) => m.id === NEMO) && !choices.speech_live.some((m) => m.id === QWEN));
  // a saved version from before the job existed reads as the starting value, and a diarize model cannot be saved on a speech job
  const old = clone(s); delete old.jobs.speaker_labels; assert.equal(validateModelSettings(old).jobs.speaker_labels.model, DIAR);
  const bad = clone(s); bad.jobs.stt = { model: DIAR, effort: null, fallbacks: [] }; assert.throws(() => validateModelSettings(bad));
});

// ---- the container object ----
function makeObject(env, { name = "obj", healthAfter = 1, templateReady = true } = {}) {
  const db = new DatabaseSync(":memory:");
  const sql = { exec(query, ...args) { const stmt = db.prepare(query); let rows; try { rows = stmt.all(...args); } catch { stmt.run(...args); rows = []; } return { toArray: () => rows }; } };
  let running = false, healthCalls = 0, snapshots = 0, alarmAt = null, destroys = [];
  const starts = [], fetches = [], execs = [];
  const container = {
    images: { base: "registry/base@sha256:abc" },
    get running() { return running; },
    start(o) { starts.push(o); running = true; },
    async destroy(why) { destroys.push(why); running = false; },
    monitor: () => new Promise(() => {}),
    async exec(command, options) { execs.push({ command, options }); return { output: async () => ({ exitCode: 0, stdout: new Uint8Array() }), kill() {} }; },
    async snapshotContainer(o) { snapshots++; return { id: `snap-${snapshots}`, size: 5e9, name: o?.name }; },
    getTcpPort: () => ({ fetch: async (url, init = {}) => {
      fetches.push({ url: String(url), init });
      if (String(url).endsWith("/health")) { healthCalls++; return Response.json(healthCalls >= healthAfter ? { ready: true, load_ms: { qwen: 1, nemotron: 2, diar: 3 } } : { ready: false, load_ms: {}, errors: {} }); }
      return new Response(JSON.stringify({ ok: true, echo: String(url) }), { status: 200 });
    } }),
  };
  const ctx = { id: { toString: () => name }, container, storage: { sql, async setAlarm(t) { alarmAt = t; }, async getAlarm() { return alarmAt; } }, waitUntil() {} };
  const o = new SpeechContainer(ctx, env);
  return { o, ctx, container, starts, fetches, execs, destroys, alarm: () => alarmAt, snapshots: () => snapshots, healthCalls: () => healthCalls, setRunning: (v) => { running = v; } };
}
function objects() {
  const env = { SPEECH_MAX_INSTANCES: "2" }, map = new Map(), made = {};
  env.SPEECH_CONTAINER = { idFromName: (n) => n, get: (n) => map.get(n) };
  const add = (n, opts) => { const m = makeObject(env, { name: n, ...opts }); map.set(n, m.o); made[n] = m; return m; };
  return { env, add, made };
}
SPEECH_TIMING.templatePollMs = 5; SPEECH_TIMING.healthPollMs = 5;
test("the template is built once from the pinned setup, with long setup and snapshot limits, and a changed image invalidates it", async () => {
  const x = objects(), co = x.add("speech:coordinator");
  const [a, b] = await Promise.all([co.o.buildTemplate(), co.o.buildTemplate()]);
  assert.equal(a.handle.id, b.handle.id); assert.equal(co.snapshots(), 1); assert.equal(co.ctx.container.running, false, "the builder container is destroyed");
  assert.deepEqual(co.starts[0].entrypoint !== SPEECH_ENTRYPOINT, true); assert.equal(co.starts[0].instance, "standard-4"); assert.equal(co.starts[0].enableInternet, true);
  assert.ok(co.execs.some((e) => e.command[2]?.includes("sha256sum -c") && e.command[2].includes(LLAMA_SHA)), "the pinned setup ran"); assert.ok(co.execs.some((e) => e.command[2] === SPEECH_VERIFY), "and was verified before the snapshot");
  assert.ok(co.execs.every((e) => !e.options?.stdin), "no files or tenant data reach the builder");
  assert.equal((await co.o.peekTemplate()).handle.id, a.handle.id);
  await co.o.invalidateTemplate("other"); assert.ok(await co.o.peekTemplate()); await co.o.invalidateTemplate(a.handle.id); assert.equal(await co.o.peekTemplate(), null);
  const c = await co.o.buildTemplate(); assert.equal(co.snapshots(), 2);
  co.ctx.container.images.base = "registry/base@sha256:changed"; assert.equal(await co.o.peekTemplate(), null); assert.notEqual((await co.o.buildTemplate()).version, c.version);
  await assert.rejects(co.o.speechRequest({ path: "/x" }), /template object cannot run speech/); await assert.rejects(co.o.warm(), /template object cannot run speech/);
});
test("a slot restores from the template without internet, becomes ready when the models are loaded, serves requests and stops after the idle time", async () => {
  const x = objects(), co = x.add("speech:coordinator"), tpl = await co.o.buildTemplate(), s = x.add("speech:0", { healthAfter: 3 });
  assert.deepEqual(await s.o.speechState(), { state: "cold", inflight: 0, booting: false });
  assert.deepEqual(await s.o.speechRequest({ path: "/transcribe?model=qwen" }), { state: "warming" }, "a request to a cold slot answers at once, and the answer means a start is now running");
  assert.deepEqual(await s.o.warm(), { state: "warming" }); assert.deepEqual(await s.o.warm(), { state: "warming" }, "a second warm joins the first");
  assert.equal((await s.o.speechState()).state, "warming"); assert.deepEqual(await s.o.speechRequest({ path: "/x" }), { state: "warming" });
  await s.o._boot;
  assert.equal(s.starts.length, 1); assert.deepEqual(s.starts[0].containerSnapshot, tpl.handle); assert.equal(s.starts[0].image, undefined); assert.equal(s.starts[0].enableInternet, false); assert.equal(s.starts[0].instance, "standard-4"); assert.deepEqual(s.starts[0].entrypoint, SPEECH_ENTRYPOINT);
  assert.equal((await s.o.speechState()).state, "ready"); assert.ok(s.healthCalls() >= 3); assert.ok(Number((await s.o.status()).boot_ms) >= 0);
  const r = await s.o.speechRequest({ method: "POST", path: "/transcribe?model=nemotron&format=wav", body: new ArrayBuffer(4) });
  assert.equal(r.state, "ok"); assert.equal(r.status, 200); assert.match(JSON.parse(r.body).echo, /transcribe\?model=nemotron/); assert.equal(s.fetches.at(-1).init.method, "POST");
  await assert.rejects(s.o.speechRequest({ path: "x" }), /bad path/);
  // not idle yet: the alarm keeps the container; after the idle time it stops it
  await s.o.alarm(); assert.equal(s.ctx.container.running, true);
  s.o.put("last", String(Date.now() - SPEECH_IDLE_MS - 1)); await s.o.alarm();
  assert.equal(s.ctx.container.running, false); assert.deepEqual(s.destroys, ["speech idle"]); assert.equal((await s.o.speechState()).state, "cold");
  assert.equal(SPEECH_IDLE_MS, SPEAKER_EVERY_MS + 60e3, "idle = one live speaker pass interval plus a minute, so a live session never restarts the container between two passes");
  assert.ok(SPEECH_IDLE_MS > SPEAKER_EVERY_MS && SPEECH_IDLE_MS < 10 * 60e3);
  // an object that was evicted while its container ran asks the server instead of assuming
  s.setRunning(true); const fresh = new SpeechContainer(s.ctx, x.env); assert.equal((await fresh.speechState()).state, "ready");
});
test("a slot with no template waits for the coordinator to build it, and a model that fails to load is reported, not served", async () => {
  const x = objects(), co = x.add("speech:coordinator"), s = x.add("speech:1");
  await s.o.warm(); await s.o._boot;
  assert.equal(co.snapshots(), 1, "the coordinator built the template"); assert.equal(s.starts[0].containerSnapshot.id, "snap-1"); assert.equal((await s.o.speechState()).state, "ready");
  const y = objects(); y.add("speech:coordinator"); const bad = y.add("speech:0");
  bad.container.getTcpPort = () => ({ fetch: async () => Response.json({ ready: false, load_ms: { qwen: 5 }, errors: { diar: "RuntimeError('x')" } }) });
  const tpl = await y.made["speech:coordinator"].o.buildTemplate();
  await bad.o.warm(); await bad.o._boot;
  assert.equal((await bad.o.status()).state === "ready", false); assert.match((await bad.o.status()).boot_error, /did not load/);
  assert.equal(bad.ctx.container.running, false, "a container whose model did not load is destroyed"); assert.ok(await y.made["speech:coordinator"].o.peekTemplate(), "one failure keeps the template");
  await bad.o.warm(); await bad.o._boot;
  assert.equal(await y.made["speech:coordinator"].o.peekTemplate(), null, "the same template failing twice in a row is thrown away"); assert.ok(tpl.handle.id);
});

// ---- wrangler ----
test("the Worker exports the SpeechContainer class (the public example config has no binding for it, like PrepContainer)", () => {
  assert.match(readFileSync(new URL("../src/index.js", import.meta.url), "utf8"), /export \{ SpeechContainer \} from "\.\/speech-container\.js"/);
});
