// node --import ./test/stubs/register.mjs test/speech-api-first.test.mjs
// APIs answer speech first and the models in the speech container come last: which attempts may wait for a cold container
// (chain position and the job's time limit, decided in model-dispatch.js).
import test from "node:test";
import assert from "node:assert/strict";
import { dispatch } from "../src/ee/model-dispatch.js";
import { setSpeech } from "../src/speech-impl.js";
import { SEED_FACTS, SELF_STT, SELF_LIVE, SELF_DIARIZE } from "../src/ee/model-seed.js";
import { validateModelSettings } from "../src/ee/model-settings.js";
import { SEED, withSettings, ID } from "./helpers/seed-settings.mjs";

const clone = (x) => JSON.parse(JSON.stringify(x));
const gw = { CF_ACCOUNT_ID: "acct", AIG_ID: "gw", AIG_TOKEN: "tok", OPENROUTER_API_KEY: "k" };
const withSelf = (c) => { for (const m of [SELF_STT, SELF_LIVE, SELF_DIARIZE]) c.catalog[m] = { id: m, ...clone(SEED_FACTS[m]) }; return c; };
const envOf = (mut) => { const c = withSelf(clone(SEED)); mut(c); validateModelSettings(c); return withSettings(gw, c); };
const entry = (model) => ({ model, effort: null });

// A fake container that records what the dispatcher asked of it (the wait) and answers.
function fakeSpeech(log) {
  const ok = { model: "m", segs: [{ s: 0, e: 1, t: "hi" }], words: [], usage: { cost: 0, audio_s: 1, container_ms: 1 } };
  setSpeech({ selfTranscribe: async (_e, model, _i, _m, wait) => { log.push({ fn: "transcribe", model, wait }); return ok; },
    selfDiarize: async (_e, model, _q, _m, wait) => { log.push({ fn: "diarize", model, wait }); return { turns: [], usage: ok.usage }; } });
}
const down = () => new Response(JSON.stringify({ error: { message: "down" } }), { status: 500 });
const withFetch = async (handler, fn) => { const real = globalThis.fetch; globalThis.fetch = async (u, i) => handler(String(u), i); try { return await fn(); } finally { globalThis.fetch = real; setSpeech(null); } };
const req = { self: async () => ({ audio: new Uint8Array(4), format: "wav" }), openrouter: ({ model }) => () => JSON.stringify({ model }) };

test("the last self-hosted model of stt asks to wait when the limit leaves room, and a model that is not last never does", async () => {
  const log = [];
  const env = envOf((c) => { c.jobs.stt = { model: ID.STT, effort: null, fallbacks: [entry(SELF_STT)], timeout_ms: 180000 }; });
  fakeSpeech(log);
  await withFetch(() => down(), async () => { await dispatch(env, "stt", req, { meta: { tenant: "t1" } }); });
  assert.equal(log.length, 1); assert.equal(log[0].model, SELF_STT); assert.equal(log[0].wait.waitMs, 90000, "last entry, 180 s limit: the longest wait");
  // the same model first in the chain: it has a next model, so no wait
  const log2 = []; fakeSpeech(log2);
  const env2 = envOf((c) => { c.jobs.stt = { model: SELF_STT, effort: null, fallbacks: [entry(ID.STT)], timeout_ms: 180000 }; });
  await withFetch(() => down(), async () => { await dispatch(env2, "stt", req, { meta: { tenant: "t1" } }); });
  assert.equal(log2[0].model, SELF_STT); assert.equal(log2[0].wait.waitMs, 0);
});

test("a last self-hosted model gets no wait when the job's limit is too short for a cold start (the stt limit of 30 s, live dictation's 6 s, or the caller's tryMs)", async () => {
  for (const [limit, tryMs] of [[30000, 0], [6000, 0], [180000, 20000], [null, 0]]) {
    const log = []; fakeSpeech(log);
    const env = envOf((c) => { c.jobs.stt = { model: ID.STT, effort: null, fallbacks: [entry(SELF_STT)], timeout_ms: limit }; });
    await withFetch(() => down(), async () => { await dispatch(env, "stt", { ...req, tryMs }, { meta: { tenant: "t1" } }); });
    assert.equal(log[0].wait.waitMs, limit === null ? 90000 : 0, `limit ${limit}, tryMs ${tryMs}`);
  }
});

test("the only entry of speaker_labels waits when the limit allows (180 s) and a single-model run of a chain is judged by the whole chain", async () => {
  const log = []; fakeSpeech(log);
  const env = envOf(() => {});
  await withFetch(() => down(), async () => { await dispatch(env, "speaker_labels", { audio: new Uint8Array(4), format: "wav" }, { meta: { tenant: "t1" } }); });
  assert.deepEqual([log[0].fn, log[0].wait.waitMs], ["diarize", 90000]);
  // dispatch of one entry (model:) of a chain with a later entry: not last in the chain, so no wait
  const log2 = []; fakeSpeech(log2);
  const env2 = envOf((c) => { c.jobs.stt = { model: SELF_STT, effort: null, fallbacks: [entry(ID.STT)], timeout_ms: 180000 }; });
  await withFetch(() => down(), async () => { await dispatch(env2, "stt", req, { meta: { tenant: "t1" }, model: SELF_STT }); });
  assert.equal(log2[0].wait.waitMs, 0);
});
