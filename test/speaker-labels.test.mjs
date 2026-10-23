// node --import ./test/stubs/register.mjs test/speaker-labels.test.mjs
// Speaker labels (src/speaker-labels.js, live-mic.js, live-notes.js, sidecar.js), with the 1Helm speech container faked through setSpeech:
//  - first-run data: the self-hosted speech models first with the hosted ones behind them, the new job "speaker_labels" (kind diarize), 
//  - labels by overlap: words, a span, the nearest turn, ids that stay the same across passes
//  - Live notes from the microphone: a WAV chunk goes to R2 and the speech session, a pass labels the lines, the final pass relabels, the audio is deleted
//  - naming a speaker: the transcript file and the lines the note-taker reads carry the name; the view lists the speakers
//  - billing: each pass is reserved and settled on the Ledger, a refusal skips the pass
//  - audio and video files: transcript lines get speakers, and the file transcript view
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { seedFresh, SELF_STT, SELF_LIVE, SELF_DIARIZE } from "../src/ee/model-seed.js";
import { validateModelSettings } from "../src/ee/model-settings.js";
import { JOBS, JOB_KINDS, jobDef } from "../src/ee/model-jobs.js";
import { plan } from "../src/ee/model-plan.js";
import { setSpeech } from "../src/speech-impl.js";
import * as SP from "../src/ee/speaker-labels.js";
import { LiveNotes, tline, transcriptBody, noteMessages, NOTE_SYSTEM_MIC_SPK } from "../src/ee/live-notes.js";
import { lnAudio } from "../src/ee/live-mic.js";
import { transcriptMd } from "../src/sidecar.js";
import { ID } from "./helpers/seed-settings.mjs";
import { readModelSettings } from "../src/ee/model-settings.js";

let checks = 0; const test = async (name, fn) => { await fn(); console.log(`  ok ${++checks} - ${name}`); };
const clone = (x) => JSON.parse(JSON.stringify(x));
const FRESH = validateModelSettings(seedFresh({}));

await test("first-run data: self-hosted models first, the hosted ones behind them (cheapest first), and the job Speaker labels", () => {
  const J = FRESH.jobs, ids = (j) => [j.model, ...j.fallbacks.map((f) => f.model)];
  assert.deepEqual(ids(J.stt), [SELF_STT, ID.STT, ID.STT_FALLBACK, ID.STT_BEST]);
  assert.deepEqual(ids(J.live_dictation), [SELF_LIVE, ID.LIVE, ID.STT_BEST]);
  assert.deepEqual(ids(J.speaker_labels), [SELF_DIARIZE]);
  assert.equal(SELF_STT, "@1hc/Qwen/Qwen3-ASR-1.7B"); assert.equal(SELF_LIVE, "@1hc/nvidia/nemotron-3.5-asr-streaming-0.6b"); assert.equal(SELF_DIARIZE, "@1hc/nvidia/Nemotron-3-Diarization");
  const def = jobDef("speaker_labels"); assert.deepEqual([def.kind, def.group, def.label], ["diarize", "speech", "Speaker labels"]); assert.ok(def.description.length > 40);
  assert.equal(JOB_KINDS.diarize.fallbacks, 0); assert.deepEqual(JOB_KINDS.diarize.inputs, ["audio"]);
  for (const m of [SELF_STT, SELF_LIVE, SELF_DIARIZE]) assert.ok(FRESH.catalog[m], m);
  const steps = (id) => plan(FRESH, id, { level: "zdr" }).steps;
  assert.deepEqual(steps("speaker_labels").map((s) => [s.model, s.source, s.adapter, s.provider]), [[SELF_DIARIZE, "SELF", "diarize", null]]);
  assert.deepEqual(steps("stt").slice(0, 2).map((s) => [s.source, s.adapter]), [["SELF", "transcribe"], ["OR", "transcribe"]]);
  assert.deepEqual(steps("live_dictation").map((s) => [s.source, s.adapter]), [["SELF", "transcribe"], ["CF", "transcribe_live"], ["OR", "transcribe"]]);
  for (const level of ["unrestricted", "no_training", "zdr"]) assert.equal(steps("speaker_labels").length, plan(FRESH, "speaker_labels", { level }).steps.length);
  assert.ok(JOBS.some((j) => j.id === "speaker_labels"));
});

await test("an older saved version without the job reads it as its first-run value", async () => {
  const old = clone(FRESH); delete old.jobs.speaker_labels;
  const { withOptional } = await import("../src/ee/model-settings.js").then((m) => ({ withOptional: m.validateModelSettings }));
  const v = withOptional(old); assert.equal(v.jobs.speaker_labels.model, SELF_DIARIZE);
});

await test("label by overlap: words first, then the span, then the nearest turn within 1.5 s; speaker ids stay the same across passes", () => {
  const turns = SP.normalizeTurns([{ start_ms: 0, end_ms: 5000, speaker: "A" }, { start_ms: 5000, end_ms: 9000, speaker: "B" }]);
  const m1 = SP.mapSpeakerIds(turns);
  assert.deepEqual(m1.turns.map((t) => t.speaker), ["S1", "S2"]);
  const rows = [{ rid: 1, tm: { s: 1000, e: 3000 } }, { rid: 2, tm: { s: 4000, e: 8000, w: [[4000, 4500], [5200, 6000], [6100, 7000], [7000, 8000]] } }, { rid: 3, tm: { s: 9500, e: 10000 } }, { rid: 4, tm: { s: 20000, e: 21000 } }];
  assert.deepEqual(SP.assignSpeakers(rows, m1.turns), [{ rid: 1, sid: "S1" }, { rid: 2, sid: "S2" }, { rid: 3, sid: "S2" }], "a line with most of its words in B's turn is B's; one 500 ms past the last turn takes it; one far away has none");
  // a later pass lists B first: the same raw ids keep their S numbers
  const m2 = SP.mapSpeakerIds(SP.normalizeTurns([{ start_ms: 0, end_ms: 1000, speaker: "B" }, { start_ms: 1000, end_ms: 2000, speaker: "A" }, { start_ms: 2000, end_ms: 3000, speaker: "C" }]), m1.map);
  assert.deepEqual(m2.turns.map((t) => t.speaker), ["S2", "S1", "S3"]);
  assert.deepEqual(SP.normalizeTurns([{ s: 1.5, e: 2, speaker: "x" }, { s: 3, e: 2, speaker: "y" }, { s: 1, e: 2 }]), [{ s: 1500, e: 2000, speaker: "x" }], "seconds become milliseconds; a turn that ends before it starts or has no speaker is dropped");
});

await test("labels shown: a name wins, then You, then Speaker N, then what the device said", () => {
  const names = { S1: { name: "Maria", contact_id: "p1" } };
  assert.deepEqual([SP.labelOf({ sid: "S1" }, names), SP.labelOf({ sid: "S2" }, names), SP.labelOf({ speaker: "You" }, names), SP.labelOf({ speaker: "Others" }, names), SP.labelOf({}, names)], ["Maria", "Speaker 2", "You", "Others", null]);
  const sp = SP.speakersOf([{ sid: "S2", tm: '{"s":0,"e":1000}' }, { sid: "S1", tm: '{"s":1000,"e":3000}' }, { sid: null }, { sid: "S1", tm: null }], names);
  assert.deepEqual(sp, [{ id: "S1", label: "Speaker 1", name: "Maria", contact_id: "p1", lines: 2, ms: 2000 }, { id: "S2", label: "Speaker 2", name: null, contact_id: null, lines: 1, ms: 1000 }]);
  assert.equal(tline({ at: 5000, speaker: "Maria", text: "hi" }, 0, true), "[+0:05] Maria: hi"); assert.equal(tline({ at: 5000, speaker: null, text: "hi" }, 0, true), "[+0:05] hi");
});

// ---------------------------------------------------------------- the Live notes object with a faked container ----------------------------------------------------------------
const RESET = "reset";
const mkSql = (db) => ({ exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
  const st = db.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) || /\bRETURNING\b/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } });
const R2 = new Map(), META = new Map(); let failPut = false;
const WS = { put: async (k, b, o) => { if (failPut) throw new Error("r2 down"); META.set(k, o?.customMetadata); R2.set(k, new Uint8Array(b instanceof Uint8Array ? b : Buffer.from(String(b)))); return { size: R2.get(k).byteLength }; }, get: async (k) => R2.has(k) ? { json: async () => JSON.parse(Buffer.from(R2.get(k)).toString()), body: null } : null,
  head: async (k) => R2.has(k) ? { size: R2.get(k).byteLength } : null, delete: async (ks) => { for (const k of [].concat(ks)) R2.delete(k); },
  list: async ({ prefix }) => ({ objects: [...R2.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, size: R2.get(key).byteLength })), truncated: false }) };
const LED = []; let refuse = false;
const LEDGER = { idFromName: (x) => x, get: () => ({ reserve: async (id, n) => { LED.push(["reserve", id, n]); return refuse ? { ok: false, reason: "out_of_credits" } : { ok: true }; }, settle: async (id, n) => { LED.push(["settle", id, n]); } }) };
const env = { WS, LEDGER, MODEL_SETTINGS: FRESH, MODEL_SETTINGS_REVISION: 1, ENV_NAME: "dev" };
const mk = () => new LiveNotes({ storage: { sql: mkSql(new DatabaseSync(":memory:")), getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {}, deleteAll: async () => {} }, waitUntil() {} }, env);
const T0 = Date.UTC(2026, 9, 22, 17, 0, 0);
const WAV = (n = 4000) => { const b = new Uint8Array(n + 44); b.set([82, 73, 70, 70]); return b; };

// the faked container: what each function was asked, and what it answers
const calls = { transcribe: [], append: [], diarize: [], end: [] }; let turnsNow = [], failAppend = false, failDiarize = false;
setSpeech({
  selfTranscribe: async (e, model, req, meta) => { calls.transcribe.push({ model, format: req.format, bytes: req.audio.byteLength }); return { model, segs: [{ s: 0, e: 2, t: "hello there" }, { s: 2.5, e: 4, t: "hi back to you" }], words: [{ w: "hello", s: 0, e: 1 }, { w: "there", s: 1, e: 2 }, { w: "hi", s: 2.5, e: 3 }, { w: "back", s: 3, e: 3.5 }, { w: "to", s: 3.5, e: 3.8 }, { w: "you", s: 3.8, e: 4 }], usage: { cost: 0.0001, audio_s: 4.5, container_ms: 900 } }; },
  selfSessionAppend: async (e, key, o) => { if (failAppend) throw new Error("container down"); calls.append.push({ key, seq: o.seq, at_ms: o.at_ms, format: o.format }); return {}; },
  selfSessionDiarize: async (e, key, model) => { if (failDiarize) throw new Error("container down"); calls.diarize.push({ key, model }); return { model, turns: turnsNow, usage: { cost: 0.0002, audio_s: 8, container_ms: 1200 } }; },
  selfSessionEnd: async (e, key) => { calls.end.push(key); },
});
const ln = mk();
const key = "t1:main:task1:s1";
ln.put("tenant", "t1"); ln.put("channel", "main"); ln.put("task", "task1"); ln.put("n", "1"); ln.put("status", "live"); ln.put("title", "Standup");
ln.setS(1, { n: 1, source: "mic", mic_id: "mic-device-1", started_at: T0, via: "mic" });
const send = (seq, atMs, extra = "") => lnAudio(new Request("https://x/livenotes/audio", { method: "POST", body: WAV(), headers: { "content-type": "audio/wav" } }), env,
  { LN: ln, L: LEDGER.get(), meta: { tenant: "t1" }, q: new URLSearchParams(`mic=mic-device-1&seq=${seq}&at=${T0 + atMs}&ms=4500&voiced=3000${extra}`) });

await test("a WAV chunk: transcribed in the container, written to R2, appended to the speech session at its place in the meeting; lines keep their span and words", async () => {
  const r = await (await send(0, 1000)).json(); assert.equal(r.ok, true); assert.equal(r.added, 2);
  assert.deepEqual(calls.transcribe[0], { model: SELF_STT, format: "wav", bytes: 4044 });
  assert.deepEqual(calls.append, [{ key, seq: 0, at_ms: 1000, format: "wav" }]);
  assert.ok(R2.has("t/t1/live-audio/main/task1/s1/0.wav"), "the chunk's WAV is in R2 where the container looks"); assert.deepEqual(META.get("t/t1/live-audio/main/task1/s1/0.wav"), { at_ms: "1000" }, "with its place in the meeting");
  const rows = ln.sql.exec("SELECT uid, tm, sid FROM utts WHERE n=1 ORDER BY rid").toArray();
  assert.deepEqual(rows.map((x) => [x.uid, x.sid]), [["m0:0", null], ["m0:1", null]]);
  assert.deepEqual(JSON.parse(rows[1].tm), { s: 3500, e: 5000, w: [[3500, 4000], [4000, 4500], [4500, 4800], [4800, 5000]] });
  await send(1, 6000); assert.deepEqual(calls.append.map((x) => x.seq), [0, 1]); assert.equal(ln.s(1).audio_chunks, 2);
  assert.equal((await (await send(1, 6000)).json()).dup, true, "a chunk sent twice is neither transcribed nor appended again"); assert.equal(calls.append.length, 2);
});

await test("a pass labels every line by overlap, reserves and settles on the Ledger, and the view lists the speakers", async () => {
  turnsNow = [{ start_ms: 1000, end_ms: 3500, speaker: "spk_a" }, { start_ms: 3500, end_ms: 5200, speaker: "spk_b" }, { start_ms: 6000, end_ms: 8000, speaker: "spk_a" }, { start_ms: 8000, end_ms: 11000, speaker: "spk_b" }];
  LED.length = 0; const out = await ln.labelPass(1);
  assert.deepEqual(calls.diarize.at(-1), { key, model: SELF_DIARIZE }); assert.equal(out.changed, 4);
  const rows = ln.sql.exec("SELECT uid, sid FROM utts WHERE n=1 ORDER BY rid").toArray();
  assert.deepEqual(rows.map((x) => x.sid), ["S1", "S2", "S1", "S2"]);
  assert.deepEqual(LED.map((x) => x[0]), ["reserve", "settle"]); assert.ok(LED[0][2] > 0 && LED[1][2] > 0 && LED[1][2] <= LED[0][2], "settled at the container's time, never above the hold");
  assert.equal(LED[1][2], Math.ceil(0.0002 * 1e9 * 1.15)); assert.equal(ln.s(1).label_nano, LED[1][2]); assert.ok(ln.s(1).cost_nano >= LED[1][2], "the session's cost includes it");
  const v = ln.view(); assert.deepEqual(v.speakers.map((x) => [x.id, x.label, x.name, x.contact_id, x.lines]), [["S1", "Speaker 1", null, null, 2], ["S2", "Speaker 2", null, null, 2]]); assert.equal(v.labels.state, "ready");
});

await test("the note-taker and the final pass read the labels, and the prompt says lines carry labels", () => {
  const rows = ln.transcriptOf(1), lines = rows.map((u) => tline(u, T0, true));
  assert.match(lines[0], /^\[\+0:01\] Speaker 1: hello there$/); assert.match(lines[1], /Speaker 2: hi back to you/);
  const msgs = noteMessages({ s: { ...ln.s(1) }, n: 1, win: { lines: [], omitted: 0 }, lines, depth: { minutes: 1 }, sec: "", caps: { sentences: 3, lines: { notes: 5, decisions: 3, questions: 3 }, chars: 220 } });
  assert.equal(msgs[0].content, NOTE_SYSTEM_MIC_SPK); assert.match(msgs[0].content, /Speaker 1/); assert.match(msgs[1].content, /Speaker 1: hello there/);
});

await test("a later pass can change an earlier line, and the line is relabelled", async () => {
  turnsNow = [{ start_ms: 1000, end_ms: 3500, speaker: "spk_a" }, { start_ms: 3500, end_ms: 5200, speaker: "spk_a" }, { start_ms: 6000, end_ms: 11000, speaker: "spk_b" }];
  const out = await ln.labelPass(1); assert.equal(out.changed, 2);
  assert.deepEqual(ln.sql.exec("SELECT sid FROM utts WHERE n=1 ORDER BY rid").toArray().map((x) => x.sid), ["S1", "S1", "S2", "S2"], "the container's ids kept their numbers");
});

await test("a refused hold skips the pass and changes nothing; a container failure leaves the labels as they were", async () => {
  refuse = true; LED.length = 0; assert.deepEqual(await ln.labelPass(1), { skipped: "not paid" }); assert.deepEqual(LED.map((x) => x[0]), ["reserve"]); refuse = false;
  failDiarize = true; LED.length = 0; assert.deepEqual(await ln.labelPass(1), { skipped: "failed" }); assert.deepEqual(LED.at(-1), ["settle", LED[0][1], 0], "nothing is charged for a failed call"); failDiarize = false;
  assert.deepEqual(ln.sql.exec("SELECT sid FROM utts WHERE n=1 ORDER BY rid").toArray().map((x) => x.sid), ["S1", "S1", "S2", "S2"]);
});

await test("naming a speaker: the view, the transcript JSON and the lines the model reads carry the name; clearing it goes back to Speaker N", async () => {
  const out = await ln.speakerName(1, "S1", "Maria", "person-7"); assert.deepEqual(out.speakers.map((x) => [x.id, x.name, x.contact_id]), [["S1", "Maria", "person-7"], ["S2", null, null]]);
  assert.match((await ln.speakerName(1, "S9", "Nobody")).error, /No such speaker/); assert.match((await ln.speakerName(1, "x", "Nobody")).error, /No such speaker/);
  const rows = ln.transcriptOf(1), s = ln.s(1);
  assert.deepEqual(rows.map((u) => [u.speaker, u.speaker_id]), [["Maria", "S1"], ["Maria", "S1"], ["Speaker 2", "S2"], ["Speaker 2", "S2"]]);
  const body = JSON.parse(transcriptBody({ s: { ...s, ended_at: T0 + 20000 }, task: "task1", n: 1, tz: "UTC", utts: rows, title: "Standup" }));
  assert.deepEqual(body.speakers, [{ id: "S1", name: "Maria", contact_id: "person-7" }, { id: "S2", name: null, contact_id: null }]);
  assert.deepEqual(body.utterances.map((u) => [u.speaker, u.label]), [["S1", "Maria"], ["S1", "Maria"], ["S2", "Speaker 2"], ["S2", "Speaker 2"]]);
  assert.match(tline(rows[0], T0, true), /Maria: hello there/);
  assert.equal(ln.view().speakers[0].name, "Maria");
  await ln.speakerName(1, "S1", "", null); assert.equal(ln.transcriptOf(1)[0].speaker, "Speaker 1"); await ln.speakerName(1, "S1", "Maria", "person-7");
});

await test("the final pass: one last pass over everything, then the chunk audio is deleted and the container's session ends; nothing stays in R2", async () => {
  assert.ok([...R2.keys()].filter((k) => k.includes("/live-audio/")).length === 2);
  turnsNow = [{ start_ms: 1000, end_ms: 3500, speaker: "spk_a" }, { start_ms: 3500, end_ms: 5200, speaker: "spk_b" }, { start_ms: 6000, end_ms: 8000, speaker: "spk_a" }, { start_ms: 8000, end_ms: 11000, speaker: "spk_b" }];
  ln.put("status", "finalizing"); ln.setS(1, { ended_at: T0 + 12000 }); calls.diarize.length = 0;
  await ln.labelFinal(1);
  assert.equal(calls.diarize.length, 1); assert.deepEqual(ln.sql.exec("SELECT sid FROM utts WHERE n=1 ORDER BY rid").toArray().map((x) => x.sid), ["S1", "S2", "S1", "S2"], "the final pass changed an earlier line");
  assert.deepEqual([...R2.keys()].filter((k) => k.includes("/live-audio/")), [], "the audio is gone"); assert.deepEqual(calls.end, [key]);
  const s = ln.s(1); assert.equal(s.labels_final, true); assert.equal(s.audio_deleted, 2); assert.ok(s.audio_deleted_at);
  await ln.labelFinal(1); assert.equal(calls.diarize.length, 1, "run again: nothing more is asked");
  assert.equal(ln.view().speakers[0].name, "Maria", "the name belongs to the speaker id, so it survives the relabel");
});

await test("three chunks in a row that R2 refuses turn labels off for the session, and the notes go on", async () => {
  const l2 = mk(); l2.put("tenant", "t1"); l2.put("channel", "main"); l2.put("task", "task2"); l2.put("n", "1"); l2.put("status", "live");
  l2.setS(1, { n: 1, source: "mic", mic_id: "mic-device-1", started_at: T0 }); failPut = true;
  const go = (seq) => lnAudio(new Request("https://x/a", { method: "POST", body: WAV(), headers: { "content-type": "audio/wav" } }), env, { LN: l2, L: LEDGER.get(), meta: { tenant: "t1" }, q: new URLSearchParams(`mic=mic-device-1&seq=${seq}&at=${T0 + seq * 5000 + 500}&ms=4500&voiced=3000`) });
  for (const seq of [0, 1, 2]) assert.equal((await go(seq)).status, 200);
  const s = l2.s(1); assert.equal(s.labels_off, true); assert.equal(s.labels_state, "unavailable"); assert.equal(l2.sql.exec("SELECT COUNT(*) c FROM utts WHERE n=1").toArray()[0].c, 6, "every line was still kept");
  assert.equal((await l2.micCheck("mic-device-1", 3)).labels, false); failPut = false;
  await l2.labelFinal(1); assert.equal(l2.s(1).labels_final, true, "the audio step still runs (nothing to delete)");
});

await test("deleting the meeting notes (purge) deletes the chunk audio and ends the container session", async () => {
  const l3 = mk(); l3.put("tenant", "t1"); l3.put("channel", "main"); l3.put("task", "task3"); l3.put("n", "1"); l3.put("status", "live");
  l3.setS(1, { n: 1, source: "mic", mic_id: "mic-device-1", started_at: T0 });
  await send.call(null, 0, 0); // chunk for task1's object (ignored by l3)
  const r = await lnAudio(new Request("https://x/a", { method: "POST", body: WAV(), headers: { "content-type": "audio/wav" } }), env, { LN: l3, L: LEDGER.get(), meta: { tenant: "t1" }, q: new URLSearchParams(`mic=mic-device-1&seq=0&at=${T0 + 500}&ms=4500&voiced=3000`) });
  assert.equal(r.status, 200); assert.ok(R2.has("t/t1/live-audio/main/task3/s1/0.wav")); calls.end.length = 0;
  await l3.purge({}); assert.deepEqual([...R2.keys()].filter((k) => k.includes("/task3/")), []); assert.deepEqual(calls.end, ["t1:main:task3:s1"]);
});

await test("audio and video files: each transcript line takes the speaker of the turn it overlaps, and the markdown starts a paragraph when the speaker changes", () => {
  const { turns } = SP.mapSpeakerIds(SP.normalizeTurns([{ s: 0, e: 10, speaker: "a" }, { s: 10, e: 30, speaker: "b" }]));
  const lines = [{ at: 1, t: "Good morning." }, { at: 6, t: "Thanks for coming." }, { at: 12, t: "Happy to be here." }, { at: 25, t: "Let's begin." }];
  lines.forEach((l, i) => { const a = l.at * 1000, b = (lines[i + 1]?.at ?? 30) * 1000, sid = SP.speakerForSpan([[a, b]], turns); l.sp = SP.defaultLabel(sid); l.sid = sid; });
  assert.deepEqual(lines.map((l) => l.sid), ["S1", "S1", "S2", "S2"]);
  const md = transcriptMd("call.mp3", lines, 30);
  assert.match(md, /\[0:01\] Speaker 1: Good morning\. Thanks for coming\./); assert.match(md, /\[0:12\] Speaker 2: Happy to be here\. Let's begin\./);
  assert.equal(transcriptMd("a.mp3", [{ at: 1, t: "No labels." }], 5).includes("Speaker"), false, "a file with no labels reads as before");
});

await test("the speech container is still starting: the final pass waits and tries again (saved, so a restart resumes it), then labels from the chunks and deletes the audio; the reason shows in the view", async () => {
  const db = new DatabaseSync(":memory:"), ctx = { storage: { sql: mkSql(db), getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {}, deleteAll: async () => {} }, waitUntil() {} };
  const a = new LiveNotes(ctx, env); a.put("tenant", "t1"); a.put("channel", "main"); a.put("task", "task4"); a.put("n", "1"); a.put("status", "finalizing");
  a.setS(1, { n: 1, source: "mic", mic_id: "mic-device-1", started_at: T0, ended_at: T0 + 12000, labels_ready: true });
  const go = (seq, at) => lnAudio(new Request("https://x/a", { method: "POST", body: WAV(), headers: { "content-type": "audio/wav" } }), env, { LN: a, L: LEDGER.get(), meta: { tenant: "t1" }, q: new URLSearchParams(`mic=mic-device-1&seq=${seq}&at=${T0 + at}&ms=4500&voiced=3000`) });
  a.put("status", "live"); await go(0, 1000); await go(1, 6000); a.put("status", "finalizing");
  let warming = true; const warm = Object.assign(new Error("speech container is starting"), { warming: true });
  const impl = { selfTranscribe: async () => ({}), selfSessionAppend: async () => { throw warm; }, selfSessionDiarize: async () => { if (warming) throw warm; return { model: SELF_DIARIZE, turns: [{ start_ms: 1000, end_ms: 5200, speaker: 0 }, { start_ms: 5200, end_ms: 11000, speaker: 1 }], usage: { cost: 0.0001, audio_s: 9 } }; }, selfSessionEnd: async () => { calls.end.push("t1:main:task4:s1"); } };
  setSpeech({ ...impl, selfTranscribe: async () => ({ model: "m", segs: [{ s: 0, e: 2, t: "one" }, { s: 2.5, e: 4, t: "two" }], words: [], usage: { cost: 0, audio_s: 4.5 } }) });
  assert.equal(a.s(1).audio_chunks, 2, "an append that hits a starting container still counts: the chunk is in R2");
  const keys = () => [...R2.keys()].filter((k) => k.includes("/task4/"));
  assert.equal(keys().length, 2);
  assert.deepEqual(await a.labelFinal(1), { wait: true }); assert.equal(keys().length, 2, "the audio stays while the pass is waiting");
  let v = a.view(); assert.equal(v.labels.state, "waiting"); assert.match(v.labels.reason, /starting/); assert.equal(v.labels.final, false);
  assert.ok(a.s(1).label_retry_at > Date.now() && a.s(1).label_final_since);
  // a restart: a new object over the same storage keeps waiting, and does not call the container before the retry time
  const b = new LiveNotes(ctx, env); const n0 = calls.diarize.length; assert.deepEqual(await b.labelFinal(1), { wait: true });
  b.setS(1, { label_retry_at: Date.now() - 1 }); assert.deepEqual(await b.labelFinal(1), { wait: true }, "still starting: waits again, with a longer pause");
  assert.ok(b.s(1).label_final_tries >= 2 && b.s(1).label_retry_at > Date.now());
  warming = false; b.setS(1, { label_retry_at: Date.now() - 1 });
  assert.equal(await b.labelFinal(1), undefined); assert.deepEqual(b.sql.exec("SELECT sid FROM utts WHERE n=1 ORDER BY rid").toArray().map((x) => x.sid), ["S1", "S1", "S2", "S2"], "labelled from the whole session once the container answered");
  assert.equal(keys().length, 0, "then the audio is deleted"); v = b.view(); assert.equal(v.labels.final, true); assert.equal(v.labels.state, "ready");
});

await test("the final pass gives up after 10 minutes of a container that never answers: the lines keep their labels, the audio is deleted, the notes go on", async () => {
  const l = mk(); l.put("tenant", "t1"); l.put("channel", "main"); l.put("task", "task5"); l.put("n", "1"); l.put("status", "finalizing");
  l.setS(1, { n: 1, source: "mic", mic_id: "m", started_at: T0, labels_ready: true, audio_chunks: 1, label_final_since: Date.now() - 11 * 60e3 });
  await WS.put("t/t1/live-audio/main/task5/s1/0.wav", WAV());
  setSpeech({ selfSessionDiarize: async () => { throw Object.assign(new Error("down"), { warming: true }); }, selfSessionEnd: async () => {} });
  assert.equal(await l.labelFinal(1), undefined); assert.deepEqual([...R2.keys()].filter((k) => k.includes("/task5/")), []); assert.match(l.s(1).labels_reason, /gave up/);
});

await test("a periodic pass that meets a starting container tries again in 30 seconds, with the reason in the view", async () => {
  const l = mk(); l.put("tenant", "t1"); l.put("channel", "main"); l.put("task", "task6"); l.put("n", "1"); l.put("status", "live");
  l.setS(1, { n: 1, source: "mic", mic_id: "m", started_at: Date.now() - 600e3, labels_ready: true, audio_chunks: 2, audio_new: 2, audio_ms: 60000 });
  setSpeech({ selfSessionDiarize: async () => { throw Object.assign(new Error("starting"), { warming: true }); } });
  assert.deepEqual(await l.labelPass(1), { skipped: "failed" }); assert.match(l.view().labels.reason, /starting/);
  assert.equal(l.labelDue(1, l.s(1), Date.now()), false); assert.equal(l.labelDue(1, l.s(1), Date.now() + 31e3), true, "due again 30 s later, not after 3 minutes");
});

setSpeech(null);
console.log(`ok - ${checks} checks`);
