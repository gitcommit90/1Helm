// node --import ./test/stubs/register.mjs test/text-decision.test.mjs
// Text decisions (src/text-decision.js): any chat model can run the jobs that ask questions and read a short structured answer; Clef and the
// decider models keep their own call. Also the save check (kindOk), the picker lists per kind, and the capability notes.
import assert from "node:assert/strict";
import { askAnswers, askDecider, answerSchema, methodOf, usesSystemone, askJob } from "../src/ee/text-decision.js";
import { validateModelSettings, kindOk, modelSettingsOptions } from "../src/ee/model-settings.js";
import { JOBS, JOB_KINDS, jobSetting } from "../src/ee/model-jobs.js";
import { jobView } from "../src/ee/model-dashboard.js";
import { jevAsk, JEV_QUESTIONS } from "../src/ee/route2.js";
import { SEED_FACTS } from "../src/ee/model-seed.js";
import { ID, SEED, withSettings } from "./helpers/seed-settings.mjs";

// The caller a job gets: ({ state, questions }) in, { answers, usage } out, through the dispatcher.
const decisionCaller = async (env, jobId, meta = {}) => ({ state, questions }) => askJob(env, jobId, { state, questions, meta });
const clone = (x) => JSON.parse(JSON.stringify(x));
const questions = { same: { type: "noul", instructions: "Same detail?" }, kind: { type: "choice", instructions: "Which?", criteria: { a: "first", b: "second" } } };
const settingsWith = (job, model) => { const s = clone(SEED); if (!s.catalog[model] && SEED_FACTS[model]) s.catalog[model] = { id: model, ...clone(SEED_FACTS[model]) }; s.jobs[job] = { model, effort: null, fallbacks: [] }; return validateModelSettings(s); };
const CLEF = Object.keys(SEED_FACTS).find((k) => SEED_FACTS[k].kinds?.includes("workers_decider"));
// The first-run facts of a model that no job uses yet (the picker still offers it).
const factsOf = (id) => SEED.catalog[id] || { id, ...SEED_FACTS[id] };
let sent = [], reply = null, aiCalls = [];
globalThis.fetch = async (url, init) => { const b = JSON.parse(init.body); sent.push({ url: String(url), body: b }); return reply(b); };
const ok = (content, extra = {}) => Response.json({ model: "x/y", choices: [{ message: { content }, finish_reason: "stop", ...extra }], usage: { cost: 0.000002, prompt_tokens: 120 } });
const envFor = (settings, extra = {}) => withSettings({ OPENROUTER_API_KEY: "k", PROMPT_CACHE: "off", AI: { run: async (model, body) => { aiCalls.push({ model, body }); return { answers: { same: { noul: 0.9 }, kind: { choice: "a" } }, usage: { input_tokens: 77 } }; } }, ...extra }, settings);
const reset = () => { sent = []; aiCalls = []; };

// ---- kindOk: every chat model for the text-decision jobs; capability jobs stay restricted ----
const chatMeta = SEED.catalog[ID.DEEPSEEK], clefMeta = factsOf(CLEF), sttMeta = SEED.catalog[ID.STT];
for (const k of ["workers_decider", "decider"]) { assert.ok(kindOk(chatMeta, JOB_KINDS[k]), `a chat model can run ${k}`); assert.ok(kindOk({ eligible: true, id: "a/b" }, JOB_KINDS[k]), `a validated catalog model can run ${k}`); assert.ok(!kindOk(sttMeta, JOB_KINDS[k]), `a speech model can't run ${k}`); }
assert.ok(kindOk(clefMeta, JOB_KINDS.workers_decider) && kindOk(clefMeta, JOB_KINDS.decider) && !kindOk(clefMeta, JOB_KINDS.chat), "Clef runs every text-decision job and still isn't a chat model");
assert.ok(kindOk(SEED.catalog[ID.PPLX], JOB_KINDS.workers_decider) && kindOk(SEED.catalog[ID.JEV], JOB_KINDS.workers_decider) && !kindOk(SEED.catalog[ID.PPLX], JOB_KINDS.chat), "Perplexity and Jev run every text-decision job");
for (const k of ["speech", "speech_live", "speech_cloudflare", "embedding_files", "vision", "workers_ai"]) {
  assert.ok(!kindOk(chatMeta, JOB_KINDS[k]), `a chat model can't run ${k}`); assert.ok(!kindOk({ eligible: true }, JOB_KINDS[k]), `a catalog model can't run ${k}`); assert.ok(JOB_KINDS[k].needs, `${k} has a plain note`); }
assert.ok(!JOB_KINDS.decider.needs && !JOB_KINDS.workers_decider.needs);

// ---- save validation ----
for (const job of ["decider"]) { assert.doesNotThrow(() => settingsWith(job, ID.DEEPSEEK), `${job} accepts a chat model`); assert.throws(() => settingsWith(job, ID.STT), /can't be used for/); }
assert.throws(() => settingsWith("decider", ID.MUSE_C), /zero-data-retention/, "a chat model with no zero-data-retention provider is refused");
assert.throws(() => settingsWith("stt", ID.DEEPSEEK), /Needs a speech-to-text model/, "the safety net message names what the job needs");
for (const job of ["decider"]) for (const m of [CLEF, ID.PPLX, ID.JEV]) assert.doesNotThrow(() => settingsWith(job, m), `${job} accepts ${m}`);

// ---- picker lists: only models the save check accepts ----
{ const opts = modelSettingsOptions(SEED), ids = (k) => opts.choices[k].map((m) => m.id);
  for (const def of JOBS) { const kind = JOB_KINDS[def.kind];
    for (const id of ids(kind.pick)) assert.ok(kindOk(factsOf(id), kind), `${id} is offered for ${def.id} and is accepted`);
    for (const [id, m] of Object.entries(SEED.catalog)) if (kindOk(m, kind) && !ids(kind.pick).includes(id)) assert.ok(JOB_KINDS[def.kind].zdr, `${id} left out of ${def.id} only for the zero-data-retention rule`); }
  assert.ok(ids("workers_decider").includes(CLEF) && ids("workers_decider").includes(ID.DEEPSEEK) && !ids("workers_decider").includes(ID.STT) && !ids("workers_decider").includes(ID.MUSE_C), "the picker for the decision models lists Clef and chat models and no speech model");
  assert.ok(ids("workers_decider").includes(ID.PPLX) && ids("workers_decider").includes(ID.JEV)); assert.ok(ids("decider").includes(ID.PPLX) && ids("decider").includes(ID.DEEPSEEK) && ids("decider").includes(CLEF));
  assert.ok(ids("speech").includes(ID.STT) && !ids("speech").includes(ID.DEEPSEEK)); assert.ok(ids("embedding_files").every((id) => !SEED.catalog[id].kinds?.includes("chat")));
  assert.ok(!ids("chore").includes(ID.MUSE_C), "the picker never offers a model the zero-data-retention rule refuses"); }
{ const v = (id) => jobView(SEED, JOBS.find((j) => j.id === id));
  assert.equal(v("stt").needs, "Needs a speech-to-text model."); assert.equal(v("vision_files").needs, "Needs a model that can read pictures."); assert.equal(v("decider").needs, null); assert.equal(v("decider").any, true); assert.equal(v("handoff").any, false); }

// ---- native path unchanged ----
const SC = settingsWith("decider", CLEF);
assert.equal(methodOf(SC, CLEF), "clef"); assert.equal(usesSystemone(SEED, "decider"), true); assert.equal(methodOf(SEED, ID.DEEPSEEK), "chat");
{ reset(); const env = envFor(SC), call = await decisionCaller(env, "decider", { kind: "decider" });
  const r = await call({ state: { s: 1 }, questions });
  assert.equal(sent.length, 0, "Clef: no chat request"); assert.equal(aiCalls.length, 1); assert.equal(aiCalls[0].model, CLEF); assert.equal(aiCalls[0].body.model, CLEF.split("/").pop());
  assert.deepEqual(aiCalls[0].body.state, { s: 1 }); assert.deepEqual(aiCalls[0].body.questions, questions); assert.equal(r.usage.input_tokens, 77); }
{ reset(); const env = envFor(SEED); reply = (b) => Response.json({ model: ID.PPLX, answers: { same: { noul: 0.4 }, kind: { choice: "b" } }, usage: { cost: 0.00001 } });
  const r = await askDecider(env, { x: 1 }, questions, {}); assert.equal(sent.length, 1); assert.match(sent[0].url, /systemone/); assert.equal(sent[0].body.model, ID.PPLX); assert.deepEqual(r.answers, { same: { noul: 0.4 }, kind: { choice: "b" } }); }

// ---- JSON path ----
const S2 = settingsWith("decider", ID.DEEPSEEK);
assert.equal(methodOf(S2, ID.DEEPSEEK), "chat");
{ reset(); reply = () => ok('{"same":{"noul":0.9},"kind":{"choice":"a"}}'); const env = envFor(S2), call = await decisionCaller(env, "decider", { tenant: "t", kind: "decider" });
  const r = await call({ state: { new_statement: "hi" }, questions });
  assert.equal(aiCalls.length, 0, "no Clef call"); assert.equal(sent.length, 1); assert.match(sent[0].url, /chat\/completions/); assert.equal(sent[0].body.model, ID.DEEPSEEK);
  assert.equal(sent[0].body.response_format.type, "json_schema"); assert.equal(sent[0].body.provider.zdr, true, "zero-data-retention endpoints like every background chat call");
  assert.deepEqual(r.answers, { same: { noul: 0.9 }, kind: { choice: "a" } }, "the native answer shape"); assert.equal(r.usage.input_tokens, 120); assert.ok(r.usage.cost > 0);
  assert.match(JSON.stringify(sent[0].body.messages), /untrusted/); }
{ reply = () => ok("sure, here you go"); await assert.rejects(askAnswers(envFor(S2), "decider", { state: {}, questions }), /malformed/, "text that is not JSON is an error"); }
{ reply = () => ok('{"same":{"noul":7},"kind":{"choice":"a"}}'); await assert.rejects(askAnswers(envFor(S2), "decider", { state: {}, questions }), /malformed/, "an out-of-range probability is an error"); }
{ reply = () => ok('{"same":{"noul":0.5},"kind":{"choice":"zzz"}}'); await assert.rejects(askAnswers(envFor(S2), "decider", { state: {}, questions }), /malformed/, "a choice that wasn't offered is an error"); }
{ reply = () => ok('{"same":{"noul":0.5}}'); await assert.rejects(askAnswers(envFor(S2), "decider", { state: {}, questions }), /malformed/, "a missing answer is an error"); }
{ reply = () => Response.json({ choices: [{ message: { content: null, refusal: "I can't help" }, finish_reason: "stop" }] }); await assert.rejects(askAnswers(envFor(S2), "decider", { state: {}, questions }), /malformed|refus/, "a refusal is an error"); }
{ reply = () => Response.json({ error: { message: "down" } }, { status: 503 }); await assert.rejects(askAnswers(envFor(S2), "decider", { state: {}, questions }), "a failed request is an error"); }
{ reply = () => new Promise(() => {}); const t0 = Date.now(); await assert.rejects(askAnswers(envFor(S2), "decider", { state: {}, questions, timeoutMs: 60 }), /timeout/); assert.ok(Date.now() - t0 < 2000, "a timeout ends the call"); }
{ let n = 0; reply = () => ok(n++ ? '{"same":{"noul":0.2},"kind":{"choice":"b"}}' : "not json"); const r = await askAnswers(envFor(S2), "decider", { state: {}, questions }); assert.equal(r.answers.kind.choice, "b", "one repair attempt, like other structured chores"); assert.equal(n, 2); }
assert.throws(() => answerSchema({ q: { type: "other" } }), /unsupported question type/);
assert.deepEqual(answerSchema({ s: { type: "score", criteria: ["a", "b", "c"] } }).properties.s.properties.score.maximum, 2);

// ---- request sorter and tool output check with a chat model ----
{ const S3 = settingsWith("decider", ID.DEEPSEEK); reset(); reply = () => ok('{"is_task":{"noul":0.9},"category":{"choice":"general"},"unmet":{"noul":0.1}}');
  const env = envFor(S3), r = await jevAsk(env, { latest_message: "book a flight" }, {});
  assert.equal(aiCalls.length, 0); assert.equal(sent.length, 1); assert.doesNotMatch(sent[0].url, /systemone/); assert.equal(r.p, 0.9); assert.equal(r.category, "general"); assert.equal(r.unmet, 0.1); assert.ok(!r.error);
  reply = () => ok("nope"); const bad = await jevAsk(env, { latest_message: "x" }, {}); assert.ok(bad.error && bad.p === null, "an unreadable answer fails like a failed decider call");
  reply = () => ok('{"is_task":{"noul":0.9},"category":{"choice":"general"},"unmet":{"noul":0.1}}'); const d = await askDecider(env, { a: 1 }, JEV_QUESTIONS, {}); assert.ok(d.answers && d.nano > 0 && d.src === "reported");
  reply = () => Response.json({ error: "x" }, { status: 500 }); const e = await askDecider(env, { a: 1 }, JEV_QUESTIONS, {}); assert.ok(e.error && !e.answers, "askDecider never throws"); }
{ const S4 = settingsWith("decider", ID.DEEPSEEK); reset(); reply = () => ok('{"same":{"noul":0.1},"kind":{"choice":"a"}}'); const r = await (await decisionCaller(envFor(S4), "decider", {}))({ state: {}, questions }); assert.equal(r.answers.same.noul, 0.1); assert.equal(aiCalls.length, 0); }
// ---- symmetric: Perplexity on Memory corrections (systemone), Clef on the Request sorter (Workers AI), mixed fallbacks ----
{ const S5 = settingsWith("decider", ID.PPLX); reset();
  reply = () => Response.json({ model: ID.PPLX, answers: { same: { noul: 0.95 }, kind: { choice: "a" } }, usage: { cost: 0.00001 } });
  const env = envFor(S5), call = await decisionCaller(env, "decider", { kind: "decider" }), r = await call({ state: { s: 1 }, questions });
  assert.equal(aiCalls.length, 0, "no Workers AI call"); assert.equal(sent.length, 1); assert.match(sent[0].url, /systemone/); assert.equal(sent[0].body.model, ID.PPLX); assert.deepEqual(sent[0].body.state, { s: 1 });
  assert.equal(r.answers.same.noul, 0.95); assert.ok(r.usage.input_tokens > 0 && r.usage.cost > 0, "cost comes back in the Clef usage shape");
  reply = () => Response.json({ error: "boom" }, { status: 500 }); await assert.rejects(call({ state: {}, questions }), /HTTP 500/, "a failed Perplexity call throws like a failed Clef call"); }
{ const S6 = settingsWith("decider", CLEF); reset(); const env = envFor(S6);
  const d = await askDecider(env, { latest_message: "hi" }, { same: { type: "noul", instructions: "x" }, kind: { type: "choice", instructions: "y", criteria: { a: "1", b: "2" } } }, {});
  assert.equal(sent.length, 0); assert.equal(aiCalls.length, 1); assert.equal(aiCalls[0].model, CLEF); assert.deepEqual(d.answers, { same: { noul: 0.9 }, kind: { choice: "a" } }); assert.ok(!d.error && d.nano > 0);
  aiCalls = []; const rr = await jevAsk(envFor(S6, {}), { latest_message: "x" }, {}); assert.equal(aiCalls.length, 1, "the router's decider call goes through Workers AI"); assert.equal(sent.length, 0); }
{ const S7 = clone(SEED); S7.catalog[CLEF] = { id: CLEF, ...clone(SEED_FACTS[CLEF]) }; S7.jobs.decider = { model: ID.PPLX, effort: null, fallbacks: [{ model: ID.DEEPSEEK, effort: null }, { model: CLEF, effort: null }] };
  reset(); reply = (b) => b.model === ID.PPLX ? Response.json({ error: "down" }, { status: 503 }) : ok('{"same":{"noul":0.3},"kind":{"choice":"b"}}');
  const r = await askJob(envFor(S7), "decider", { state: {}, questions }); assert.equal(r.answers.same.noul, 0.3, "the chat fallback answers after the native model fails");
  assert.deepEqual(sent.map((x) => x.body.model), [ID.PPLX, ID.DEEPSEEK]); assert.equal(aiCalls.length, 0);
  reset(); reply = () => Response.json({ error: "down" }, { status: 503 }); const r2 = await askJob(envFor(S7), "decider", { state: {}, questions }); assert.equal(r2.answers.same.noul, 0.9, "then Clef answers when both fail"); assert.equal(aiCalls.length, 1); }
console.log("PASS text decisions: native Clef unchanged, JSON path for any chat model, save check, picker lists, capability notes");

// ---- a decision model the Models page verified (eligible: true) still uses its own endpoint, also as a ~latest alias ----
{ const LATEST = "~perplexity/pplx-decider-latest";
  const rec = { id: LATEST, source: "OR", kinds: ["decider"], name: "Perplexity: Decider V1.2", eligible: true, reasons: [], efforts: ["default"], hosts: ["perplexity"], in_nano: 20 };
  const S3 = { ...SEED, catalog: { ...SEED.catalog, [LATEST]: rec }, jobs: { ...SEED.jobs, decider: { model: LATEST, effort: null, fallbacks: [] } } };
  assert.equal(methodOf(S3, LATEST), "systemone"); assert.equal(usesSystemone(S3, "decider"), true);
  assert.equal(methodOf({ catalog: { x: { ...rec, kinds: ["chat", "chore"] } } }, "x"), "chat");
  reset(); reply = () => Response.json({ model: "perplexity/pplx-decider-v1.2-20261016", answers: { same: { noul: 0.4 }, kind: { choice: "b" } }, usage: { cost: 0.00001 } });
  const r = await askDecider(envFor(S3), { x: 1 }, questions, {});
  assert.equal(sent.length, 1); assert.match(sent[0].url, /systemone/); assert.doesNotMatch(sent[0].url, /chat\/completions/); assert.equal(sent[0].body.model, LATEST);
  assert.equal(sent[0].body.provider.only, undefined); assert.equal(r.model, "perplexity/pplx-decider-v1.2-20261016"); assert.ok(!r.error, r.error); }

// ---- fallbacks on the request sorter and the other decision job (r39-job-fallbacks) ----
{ assert.equal(JOB_KINDS.decider.fallbacks, 3); assert.equal(JOB_KINDS.workers_decider.fallbacks, 3);
  for (const k of ["vision", "workers_ai", "speech_cloudflare"]) assert.equal(JOB_KINDS[k].fallbacks, 0, `${k} stays at no fallbacks`);
  // The file search index may have fallbacks, but only equivalent models (test/embedding-fallback.test.mjs); the job's own model twice is still refused.
  assert.equal(JOB_KINDS.embedding_files.fallbacks, 2); assert.equal(JOB_KINDS.embedding_files.equivalentOnly, true);
  for (const id of ["embed_files"]) { const c = clone(SEED); c.jobs[id].fallbacks = [{ model: c.jobs[id].model, effort: null }]; assert.throws(() => validateModelSettings(c), /each model can be listed once/, `${id} refuses its own model as a fallback`); }
  for (const id of ["decider"]) { const c = clone(SEED); c.catalog[CLEF] = { id: CLEF, ...clone(SEED_FACTS[CLEF]) }; c.jobs[id].fallbacks = [{ model: ID.DEEPSEEK, effort: null }, { model: ID.PPLX === c.jobs[id].model ? CLEF : ID.PPLX, effort: null }]; assert.doesNotThrow(() => validateModelSettings(c), `${id} saves fallbacks`); }
  { const c = clone(SEED); c.jobs.decider.fallbacks = [ID.DEEPSEEK, ID.HAIKU, ID.OSS120, ID.OSS20].map((model) => ({ model, effort: null })); assert.throws(() => validateModelSettings(c), /at most 3 fallback/); }
  { const c = clone(SEED); c.jobs.decider.fallbacks = [{ model: ID.MUSE_C, effort: null }]; assert.throws(() => validateModelSettings(c), /zero-data-retention/, "a fallback must pass the same privacy rule as the main model"); }
  { const c = clone(SEED); c.jobs.decider.fallbacks = [{ model: ID.STT, effort: null }]; assert.throws(() => validateModelSettings(c), /can't be used for/, "a fallback must be a model the job accepts"); }
  assert.equal(jobView(SEED, JOBS.find((j) => j.id === "decider")).max_fallbacks, 3, "the page offers Add fallback on the request sorter");
  // a 429 or 5xx from the main model moves to the next one, and cost and tags belong to the model that answered
  for (const status of [429, 503]) {
    const S = clone(SEED); S.jobs.decider = { model: ID.PPLX, effort: null, fallbacks: [{ model: ID.DEEPSEEK, effort: null }] };
    reset(); reply = (b) => b.model === ID.PPLX ? Response.json({ error: "busy" }, { status }) : ok('{"same":{"noul":0.2},"kind":{"choice":"b"}}');
    const r = await askDecider(envFor(S), { x: 1 }, questions, {});
    assert.ok(!r.error, r.error);
    assert.deepEqual(sent.map((x) => x.body.model), [ID.PPLX, ID.DEEPSEEK], `HTTP ${status} falls through to the fallback`);
    assert.equal(r.model, "x/y", "the answering model is the one reported"); assert.ok(r.nano > 0 && r.src === "reported", "cost is the fallback's own reported cost"); }
}
