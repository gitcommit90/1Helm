// node --import ./test/stubs/register.mjs test/model-source-of-truth.test.mjs
// The saved settings are the only source of every model the platform uses.
//  1. Guard: no model id and no model-choosing environment variable is read by any source file except the first-run data
//     (src/model-seed.js), the provider data-handling facts (src/privacy.js) and the dev-only decider comparison tools.
//  2. For EVERY job: save a unique model for it, with decoy environment variables set, and prove the real runtime code reads that model.
//     A job added to the code without a probe here fails the coverage check at the end.
//  3. Settings that can't be read: a clear error and nothing sent, never a built-in model.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { JOBS, JOB_IDS, JOB_KINDS, choreRouteOf, jobRoute } from "../src/ee/model-jobs.js";
import { validateModelSettings, jobModel, jobCost, modelSettingsEnv, readModelSettings, ModelSettingsError } from "../src/ee/model-settings.js";
import { SEED, ID } from "./helpers/seed-settings.mjs";
import { policyRoute, dispatchOrder, jevAsk, escalateTurn, newEsc, choreRouteFor, HANDOFF_PREFIX } from "../src/ee/route2.js";
import { deciderModel } from "../src/ee/decider.js";
import { openRouterChat } from "../src/model.js";
import { browserPlan } from "../src/ee/browser-agent.js";
import { stt, sttModels } from "../src/transcribe.js";
import { embedTexts, vision } from "../src/sidecar.js";
import { Memory } from "../src/memory.js";
import { clefVia } from "../src/ee/router.js";
import { transcribeLive } from "../src/transcribe-live.js";
import { ENDPOINTS } from "../src/privacy.js";
import { CATEGORIES } from "../src/ee/pool.js";

const clone = (x) => JSON.parse(JSON.stringify(x));

// ---- 1) guard: no hardcoded models in the source ----
{ const SKIP = new Set(["prompt", "vendor", "skills", "docs"]);
  const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return SKIP.has(f) ? [] : statSync(p).isDirectory() ? walk(p) : /\.(js|ts)$/.test(f) ? [p] : []; });
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).split("\n").map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1")).join("\n");
  const ID_RE = /(["'`])(~?(?:openai|anthropic|meta|deepseek|perplexity|typesafe|qwen|z-ai|x-ai|mistralai|moonshotai|minimax|xiaomi|google|baai)\/[A-Za-z0-9._:-]+|@cf\/[A-Za-z0-9._\/-]+)\1/g;
  // Where a model id may still be written, and why.
  const ALLOWED = {
    "src/ee/model-seed.js": "the first-run data and the one-time carry-over: copied into the saved settings, never read at run time",
    "src/privacy.js": "what each provider does with data, per model and host (privacy facts, not a choice of model)",
    "src/ee/decision-shadow.js": "dev-only comparison of two deciders (off unless DECISION_SHADOW=on); never answers a request",
  };
  const files = walk("src").map((f) => f.replace(/\\/g, "/")), found = {};
  for (const f of files) { const hits = [...strip(readFileSync(f, "utf8")).matchAll(ID_RE)].map((m) => m[2]); if (hits.length) found[f] = [...new Set(hits)]; }
  for (const [f, ids] of Object.entries(found)) assert.ok(ALLOWED[f], `${f} names a model (${ids.join(", ")}); models belong in the saved settings, set on the Models page`);
  for (const f of Object.keys(ALLOWED)) assert.ok(found[f], `${f} is on the allowed list but names no model: remove it from the list`);
  // environment variables that used to choose models are read only by the one-time carry-over
  const ENV_RE = /\b(?:CHORE_MODEL(?:_[A-Z]+)?|DECIDER_MODEL|STT_MODEL|SIDECAR_EMBED_MODEL|SIDECAR_VISION_MODEL|OWN_ROUTER_CLEF|LUNA_429_WAITS)\b|\benv\??\.MODEL\b(?!_)/;
  for (const f of files) { if (f === "src/ee/model-seed.js") continue; const t = strip(readFileSync(f, "utf8")); assert.ok(!ENV_RE.test(t), `${f} reads an environment variable that chooses a model`); }
  // no module keeps default model lists any more
  const pool = readFileSync("src/ee/pool.js", "utf8"); for (const name of ["POOL", "CHAINS", "chainModels", "fixedEffort"]) assert.ok(!new RegExp(`\\b${name}\\b`).test(strip(pool)), `pool.js still has ${name}`);
  for (const f of ["src/ee/route2.js", "src/model.js", "src/ee/model-settings.js", "src/ee/model-jobs.js", "src/ee/background-policy.js"]) assert.ok(!/\b(CHORE_MODELS|CHORE_DEFAULTS|BACKGROUND_POLICIES|OR_FALLBACKS|SUMMARY_ROUTE\s*=\s*\{)/.test(strip(readFileSync(f, "utf8"))), `${f} still holds a built-in model table`);
  console.log("  ok guard: only", Object.keys(ALLOWED).join(", "), "name models"); }

// ---- 2) every job reads its own saved model ----
const sentinelOf = (id) => `sentinel/${id.replace(/[^a-z0-9]+/g, "-")}`;
const record = (id) => ({ id, name: id, eligible: true, reasons: [], efforts: ["default", "none", "low", "medium", "high"], default_effort: "low", levels: ["unrestricted", "no_training", "zdr"], hosts: ["sentinel-host"],
  context_length: 100000, max_output: 8000, input_modalities: ["text", "image"], pricing: { prompt: 1, completion: 1 }, json: true, tool_choice: ["auto", "none", "required", "function"] });
function settingsFor(jobId) {
  const def = JOBS.find((j) => j.id === jobId), kind = JOB_KINDS[def.kind], model = sentinelOf(jobId), s = clone(SEED);
  s.catalog[model] = ["chat", "chore", "classic"].includes(kind.pick) ? record(model) : { id: model, name: model, kinds: [kind.pick], efforts: [] };
  s.jobs[jobId] = { model, effort: kind.effort ? "high" : null, fallbacks: [] };
  return { settings: validateModelSettings(s), model };
}
const decoys = { CHORE_MODEL: "oss20", CHORE_MODEL_HANDOFF: "oss20", CHORE_MODEL_BROWSER: "oss20", CHORE_MODEL_UPKEEP: "haiku", CHORE_MODEL_MJVERIFY: "haiku", DECIDER_MODEL: "decoy/decider", STT_MODEL: "decoy/stt",
  SIDECAR_EMBED_MODEL: "decoy/embed", SIDECAR_VISION_MODEL: "@cf/decoy/vision", MODEL: "@cf/decoy/chat", OWN_ROUTER_CLEF: "decoy-clef", TASK_MODEL: "sol" };
const envFor = (settings, extra = {}) => ({ ...decoys, OPENROUTER_API_KEY: "k", ONEHELM_EE: "1hc", ROUTER_MODE: "two", PROMPT_CACHE: "off", MODEL_SETTINGS: settings, MODEL_SETTINGS_REVISION: 1, ...extra });
const originalFetch = globalThis.fetch; let wire = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url); let raw = init.body; if (raw && typeof raw !== "string") raw = await new Response(raw).text();
  let b = null; try { b = raw ? JSON.parse(raw) : null; } catch {} wire.push({ url: u, body: b });
  if (u.endsWith("/embeddings")) return Response.json({ data: [{ index: 0, embedding: [0.1, 0.2] }], usage: { cost: 0, total_tokens: 3 } });
  if (u.endsWith("/audio/transcriptions")) return Response.json({ text: "hello there", duration: 1, segments: [{ start: 0, text: "hello there" }], usage: { cost: 0 } });
  if (u.endsWith("/systemone")) return Response.json({ model: b.model, answers: { is_task: { noul: 0.9 }, category: { choice: "general" }, unmet: { noul: 0 } }, usage: { cost: 0 } });
  return Response.json({ model: b?.model, choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }], usage: { cost: 0 } });
};
const lastWire = (suffix) => wire.filter((w) => w.url.endsWith(suffix)).at(-1)?.body;
const chat = async (env, route, kind, body = { messages: [{ role: "user", content: "hi" }], max_tokens: 50 }) => { wire = []; await openRouterChat(env, body, "sess", route, { tenant: "t", kind }); return lastWire("/chat/completions"); };
// A probe returns the model the real code used for that job, given the saved settings.
const probes = {};
for (const c of CATEGORIES) probes[`chat.${c}`] = async (S, model) => {
  const r = dispatchOrder(policyRoute(S, c, "zdr", "x"), "zdr", { settings: S }); assert.equal(r.attempts[0].effort, "high", "the saved effort");
  const w = await chat(envFor(S), policyRoute(S, c, "zdr", "x"), "chat"); assert.equal(w.reasoning.effort, "high"); return [r.attempts[0].model, w.model]; };
for (const c of ["apps_economical", "apps_complete", "technical", "spreadsheet"]) probes[`recover.${c}`] = async (S, model) => {
  const route = policyRoute(S, c, "zdr", "recover", { recoveryJob: `recover.${c}` }), r = dispatchOrder(route, "zdr", { settings: S });
  const w = await chat(envFor(S), route, "chat"); assert.equal(w.reasoning.effort, "high"); return [r.attempts[0].model, w.model]; };
probes.escalate = async (S, model) => {
  const route = policyRoute(S, "general", "zdr", "x"), tc = { two: true, route, esc: newEsc(), session: "s" }, R = { _route: null };
  assert.equal(escalateTurn(R, tc, "stuck"), true); const r = dispatchOrder(tc.route, "zdr", { settings: S });
  const w = await chat(envFor(S), tc.route, "chat"); return [r.attempts[0].model, w.model, tc.route.escalate.model]; };
probes.decider = async (S) => { const env = envFor(S); wire = []; await jevAsk(env, { latest_message: "hi" }, {}); return [deciderModel(env), lastWire("/systemone").model]; };
for (const id of ["handoff", "label", "browser", "notes", "notes_refine", "notes_final", "memory_summary", "sidecar_card", "ambient_extract", "ambient_review", "upkeep_write", "upkeep_verify", "people_write", "people_verify", "reflect_write", "reflect_verify"])
  probes[id] = async (S) => {
    const route = choreRouteOf(S, id), out = [route.model];
    if (id === "browser") out.push((await browserPlan(envFor(S)))[0].model);
    else if (id === "handoff") out.push((await chat(envFor(S), { two: true, category: "general" }, "chat", { messages: [{ role: "user", content: `${HANDOFF_PREFIX} notes)` }], max_tokens: 50 })).model);
    else out.push((await chat(envFor(S), jobRoute(id), "chore-probe")).model);
    return out; };
probes.stt = async (S) => { const env = envFor(S); wire = []; await stt(env, { size: 3, open: async () => new Response(new Uint8Array([1, 2, 3])).body }, { format: "mp3" }); return [(await sttModels(env))[0], lastWire("/audio/transcriptions").model]; };
probes.stt_cloudflare = async (S, model) => { const calls = [], env = envFor(S, { AI: { run: async (m) => { calls.push(m); return { text: "ok", transcription_info: { duration: 1 }, segments: [] }; } } });
  const orig = globalThis.fetch; globalThis.fetch = async () => Response.json({ error: "down" }, { status: 500 });
  try { await stt(env, { size: 3, bytes: new Uint8Array([1, 2, 3]) }, { format: "mp3" }); } finally { globalThis.fetch = orig; } return [calls[0]]; };
probes.live_dictation = async (S, model) => {
  const seen = []; ENDPOINTS.transcription[model] = { "cloudflare-workers-ai": { zdr: true, training: false } };
  try { const ledger = { dictationLease: async () => ({ ok: true }), reserve: async () => ({ ok: true }), settle: async () => ({}) };
    await transcribeLive(new Request("https://x.test/live", { headers: { Upgrade: "websocket", Origin: "https://x.test" } }), envFor(S, { AIG_TOKEN: "t", AIG_ID: "g", CF_ACCOUNT_ID: "a" }), ledger, { tenant: "t" }, { fetch: async (u) => { seen.push(new URL(u).searchParams.get("model")); throw new Error("stop"); } }).catch(() => {});
  } finally { delete ENDPOINTS.transcription[model]; } return [seen[0]]; };
probes.embed_files = async (S) => { wire = []; await embedTexts(envFor(S), ["hello"], { tenant: "t" }); return [lastWire("/embeddings").model]; };
probes.embed_memory = async (S) => { const calls = []; const m = { env: envFor(S, { AI: { run: async (name) => { calls.push(name); return { data: [[0.1, 0.2]] }; } } }), hold: null, meta: () => ({}) }; await Memory.prototype.embed.call(m, ["x"]); return [calls[0]]; };
probes.vision_files = async (S) => { const calls = [];
  const env = envFor(S, { AI: { run: async (name) => { calls.push(name); return { choices: [{ message: { content: '{"description":"d","text":""}' }, finish_reason: "stop" }], usage: {} }; } } });
  await vision(env, { tenant: null }, { data: new Uint8Array([1, 2, 3]), mime: "image/png" }, "chat").catch(() => {}); return [calls[0]]; };
probes.workers_ai_chat = async (S) => [await jobModel(envFor(S), "workers_ai_chat")];
for (const id of ["memory_supersede", "doors_shadow", "classic_decider"]) probes[id] = async (S) => {
  const calls = [], env = envFor(S, { AI: { run: async (name) => { calls.push(name); return { answers: {} }; } } }), info = await jobCost(env, id);
  await clefVia(env, info.model)({ state: {}, questions: {} }); return [info.model, calls[0]]; };
probes.classic_router = async (S, model) => { const w = await chat(envFor(S, { ROUTER_MODE: "classic" }), null, "chat"); return [w.model]; };

for (const def of JOBS) {
  assert.ok(probes[def.id], `job ${def.id} has no probe: add one so its model is proven to come from the saved settings`);
  const { settings, model } = settingsFor(def.id), seen = await probes[def.id](settings, model);
  for (const m of seen) assert.equal(m, model, `${def.id}: the runtime used ${m}, not the saved ${model}`);
  // every other job still reads its own setting: changing this one moved nothing else
  for (const other of JOB_IDS) if (other !== def.id) assert.deepEqual(settings.jobs[other], SEED.jobs[other], `${def.id} changed ${other}`);
}
assert.deepEqual(Object.keys(probes).sort(), [...JOB_IDS].sort(), "a probe for every job and nothing else");
console.log(`  ok every one of ${JOBS.length} jobs uses only its own saved model, with decoy environment variables set`);

// a hand-off request is recognized and read from the saved handoff job
assert.equal(choreRouteFor({ two: true }, { messages: [{ role: "user", content: `${HANDOFF_PREFIX} x` }] }, { MODEL_SETTINGS: SEED }).model, SEED.jobs.handoff.model);

// ---- 3) settings that can't be read: a clear error and nothing is sent ----
wire = [];
await assert.rejects(openRouterChat({ OPENROUTER_API_KEY: "k", ONEHELM_EE: "1hc", ROUTER_MODE: "two", DB: { prepare() { throw new Error("db down"); } }, ENV_NAME: "isolated" }, { messages: [] }, null, jobRoute("label"), { kind: "card-label" }),
  (e) => e instanceof ModelSettingsError && /Nothing was sent/.test(e.message));
assert.equal(wire.length, 0, "no request went out");
await assert.rejects(openRouterChat({ OPENROUTER_API_KEY: "k", ONEHELM_EE: "1hc", ROUTER_MODE: "two" }, { messages: [] }, null, jobRoute("label"), { kind: "card-label" }), (e) => e instanceof ModelSettingsError);
assert.equal(wire.length, 0);
// Public deployment (the EE switch is off): the shared settings table is never read. Every job gets the first-run data, held in memory.
{
  const open = await modelSettingsEnv({ DB: { prepare() { throw new Error("the shared settings table must not be read without the EE switch"); } } });
  assert.equal(open.MODEL_SETTINGS.jobs.label.model, SEED.jobs.label.model);
  assert.equal(open.MODEL_SETTINGS_REVISION, 0);
  assert.equal((await readModelSettings({ DB: { prepare() { throw new Error("the shared settings table must not be read without the EE switch"); } } })).revision, 0);
  assert.equal(await jobModel({ DB: null }, "embed_memory"), SEED.jobs.embed_memory.model);
  assert.equal(await modelSettingsEnv({ BYOK: { model: "own" } }).then((e) => e.MODEL_SETTINGS), undefined, "own-key accounts keep their own endpoint and model");
}
globalThis.fetch = originalFetch;
console.log("PASS model source of truth: guard, every job from its saved setting, clear failure without settings");

// every background job in the first-run settings has at least one fallback
{
  const { JOBS } = await import("../src/ee/model-jobs.js");
  const seeded = (await import("../src/ee/model-seed.js")).seedFresh({});
  for (const d of JOBS.filter((j) => j.group === "background")) {
    const j = seeded.jobs[d.id];
    assert.ok(j.fallbacks.length >= 1, `background job ${d.id} has a fallback`);
    assert.ok(!j.fallbacks.some((f) => f.model === j.model), `${d.id} fallback differs from its main model`);
  }
  assert.deepEqual([seeded.jobs.browser.model, seeded.jobs.browser.fallbacks[0].model, seeded.jobs.browser.fallbacks[0].effort, seeded.jobs.browser.fallbacks[0].pin], ["openai/gpt-oss-120b", "deepseek/deepseek-v4.1-flash", "low", true]);
  assert.deepEqual([seeded.jobs.handoff.model, seeded.jobs.handoff.effort, seeded.jobs.memory_summary.model, seeded.jobs.memory_summary.effort], ["deepseek/deepseek-v4.1-flash", "low", "deepseek/deepseek-v4.1-flash", "low"]);
  console.log("  ok every background job in the seed has a fallback");
}
