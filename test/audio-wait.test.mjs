// node --import ./test/stubs/register.mjs test/audio-wait.test.mjs
// The wait for an attached recording's transcript (sidecar.js sidecarAudioReady): no timer gives up while the transcript is queued or being made, a real failure
// ends it with its message, a job that makes no progress for AUDIO_STUCK_MS ends it, the prep job is asked to start again, a resumed turn counts again from the resume,
// and the person sees a status line from the moment the wait starts. The Resident methods run on a small stand-in object; the clock is a counter that each read of
// the file's row moves forward, so a quarter of an hour passes in milliseconds.
import assert from "node:assert";
import { Resident } from "../src/resident.js";
import { AUDIO_STUCK_MS, AUDIO_REKICK_MS, AUDIO_WAIT_TIMING } from "../src/sidecar.js";

AUDIO_WAIT_TIMING.pollMs = 1;
const realNow = Date.now; let T = 1_800_000_000_000; Date.now = () => T;
let n = 0; const scenario = async (name, fn) => { await fn(); console.log(`  ok ${++n} - ${name}`); };

const FILE = { id: "f1", name: "Voice memo 1.wav", mime: "audio/wav", r2key: "t/t1/files/main/f1" };
function mk({ row, step = 30e3, saved = null, prepState = () => ({ status: "queued", tries: 0 }) }) {
  const o = { starts: 0, kicks: 0, emitted: [], saved, updates: [], doc: { md: "# Transcript" } };
  Object.assign(o, {
    env: { FILE_PREP: { idFromName: (x) => x, get: () => ({ prepState: async () => prepState() }) } },
    scOn: () => true, session: () => ({ id: 1 }), get: () => null,
    sql: { exec: (q, ...a) => {
      if (/^UPDATE turn_runs/.test(q)) { o.updates.push(JSON.parse(a[0])); o.saved = JSON.parse(a[0]); }
      return { toArray: () => /FROM turn_runs/.test(q) ? [{ extra: o.saved ? JSON.stringify({ audioWait: o.saved }) : null }] : /FROM files/.test(q) ? [{ r2key: FILE.r2key }] : [] }; } },
    scRow: () => { T += step; return row(T); },
    sidecarKick: () => { o.kicks++; }, scStart: () => { o.starts++; },
    sidecarDoc: async () => o.doc,
  });
  for (const k of ["sidecarAudioReady", "sidecarAudioCurrent", "sidecarAudioRead"]) o[k] = Resident.prototype[k];
  return o;
}
const tcOf = () => ({ turn: "c1", session: 1, emitted: [], emit(ev) { this.emitted.push(ev); } });
const queued = (at = 1) => ({ src_key: FILE.r2key, status: "queued", at, queued_at: at });
const ready = () => ({ src_key: FILE.r2key, status: "ready", at: T, queued_at: 1 });

await scenario("a transcript still queued after the old 60 s limit is waited for, then used; no failure is set", async () => {
  const t0 = T; let polls = 0;
  const o = mk({ row: () => (++polls > 6 ? ready() : { ...queued(), at: polls }) });   // the row changes each time: the job is progressing
  const tc = tcOf(); await o.sidecarAudioReady([FILE], tc);
  assert.ok(T - t0 > 60e3, "more than 60 s passed in the wait"); assert.equal(tc.audioFailure, undefined);
});

await scenario("a real failure ends the wait with its own message", async () => {
  for (const [r, re, code] of [[{ status: "failed", error: "no speech in it" }, /No speech was detected/, "audio_preparation_failed"], [{ status: "failed", error: "couldn't transcribe it (all models failed)" }, /Transcription failed/, "audio_preparation_failed"],
    [{ status: "skipped", error: "out of credits" }, /could not be transcribed: out of credits/, "audio_preparation_failed"]]) {
    const o = mk({ row: () => ({ src_key: FILE.r2key, at: 1, queued_at: 1, ...r }) }), tc = tcOf();
    await assert.rejects(o.sidecarAudioReady([FILE], tc), (e) => re.test(e.audioReason) && e.code === code); assert.equal(tc.audioFailure.code, code);
  }
  const gone = mk({ row: () => queued() }); gone.sql.exec = (q) => ({ toArray: () => (/FROM turn_runs/.test(q) ? [{ extra: null }] : /FROM files/.test(q) ? [] : []) });
  await assert.rejects(gone.sidecarAudioReady([FILE], tcOf()), (e) => e.code === "audio_source_removed");
});

await scenario("a job with no progress at all fails only after AUDIO_STUCK_MS, with a clear message", async () => {
  const t0 = T, o = mk({ row: () => queued() }), tc = tcOf();
  await assert.rejects(o.sidecarAudioReady([FILE], tc), (e) => /stopped making progress/.test(e.audioReason) && e.code === "audio_preparation_failed");
  assert.ok(T - t0 >= AUDIO_STUCK_MS && T - t0 < AUDIO_STUCK_MS + 200e3, `ended after ${(T - t0) / 1000} s`);
});

await scenario("progress (the job's try count changes) keeps the wait alive past AUDIO_STUCK_MS", async () => {
  const t0 = T; let tries = 0, polls = 0;
  const o = mk({ row: () => (T - t0 > 2.2 * AUDIO_STUCK_MS ? ready() : queued()), prepState: () => ({ status: "queued", tries: Math.floor((T - t0) / 600e3) }) });
  await o.sidecarAudioReady([FILE], tcOf()); assert.ok(T - t0 > 2 * AUDIO_STUCK_MS);
});

await scenario("the prep job is asked to start again about every AUDIO_REKICK_MS while the transcript is pending", async () => {
  const t0 = T; const o = mk({ row: () => (T - t0 > 5 * 60e3 ? ready() : queued(Math.floor((T - t0) / 100e3))) });
  await o.sidecarAudioReady([FILE], tcOf());
  assert.ok(o.kicks >= 1, "it is started when the wait begins"); assert.ok(o.starts >= Math.floor((5 * 60e3) / (AUDIO_REKICK_MS + 30e3)) - 1 && o.starts <= Math.ceil((5 * 60e3) / AUDIO_REKICK_MS), `restarts: ${o.starts}`);
});

await scenario("a resumed turn counts again from the resume, and the mark is saved in the turn's row", async () => {
  const oldMark = { identity: JSON.stringify([[FILE.id, FILE.r2key]]), progressAt: T - 3 * 3600e3, sig: "queued:1:1#" };
  const t0 = T, o = mk({ saved: oldMark, row: () => (T - t0 > 120e3 ? ready() : queued()) }), tc = tcOf();
  await o.sidecarAudioReady([FILE], tc);   // would fail at once if the three-hour-old mark were used
  assert.equal(tc.audioFailure, undefined); assert.ok(o.updates.length >= 1 && o.updates.every((u) => u.identity === oldMark.identity && u.progressAt >= t0));
  assert.deepEqual(tc.audioSources, [{ id: FILE.id, r2key: FILE.r2key }]);
});

await scenario("the status line is sent when the wait starts, names voice memos or recordings, and is cleared when the transcript is ready", async () => {
  let tc = tcOf(); await mk({ row: ready }).sidecarAudioReady([FILE], tc);
  assert.deepEqual(tc.emitted, [{ t: "status", line: "transcribing your voice memo" }]); assert.equal(tc.line, undefined);
  tc = tcOf(); await mk({ row: ready }).sidecarAudioReady([{ ...FILE, name: "Voice memo 1.wav" }, { ...FILE, id: "f2", name: "Voice memo 2.wav" }], tc);
  assert.equal(tc.emitted[0].line, "transcribing your voice memos");
  tc = tcOf(); await mk({ row: ready }).sidecarAudioReady([{ ...FILE, name: "call.mp3", mime: "audio/mpeg" }], tc); assert.equal(tc.emitted[0].line, "transcribing your recording");
  let seenLine = null; const o = mk({ row: () => (seenLine ? ready() : queued()) }); tc = tcOf(); o.scRow = () => { T += 1000; if (tc.line) seenLine = tc.line; return seenLine ? ready() : queued(); };
  await o.sidecarAudioReady([FILE], tc); assert.equal(seenLine, "transcribing your voice memo", "the line is set while the transcript is pending");
});

Date.now = realNow;
console.log("audio wait ok");
