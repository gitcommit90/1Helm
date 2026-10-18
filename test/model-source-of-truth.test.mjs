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
import { SEED, ID, setGeneral } from "./helpers/seed-settings.mjs";
import { policyRoute, dispatchOrder, jevAsk, choreRouteFor, HANDOFF_PREFIX } from "../src/ee/route2.js";
import { deciderModel } from "../src/ee/decider.js";
import { askDecider } from "../src/ee/text-decision.js";
import { openRouterChat } from "./helpers/or-chat.mjs";
import { browserPlan } from "./helpers/browser-plan.mjs";
import { stt, sttModels } from "../src/transcribe.js";
import { embedTexts, vision, lookMoondream } from "../src/sidecar.js";
import { transcribeLive } from "../src/transcribe-live.js";
import { ENDPOINTS } from "../src/privacy.js";

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
    "src/ee/hindsight-models.js": "the memory server's own models, set on its host and not on the Models page; shown there read only",
  };
  const files = walk("src").map((f) => f.replace(/\\/g, "/")), found = {};
  for (const f of files) { const hits = [...strip(readFileSync(f, "utf8")).matchAll(ID_RE)].map((m) => m[2]); if (hits.length) found[f] = [...new Set(hits)]; }
  // The template string form builds an ID from parts, which the literal scan can't see: `@cf/${name}` or 
  const TEMPLATE_ID = /`(?:@cf\/|@hf\/)[^`]*\$\{/;
  for (const f of files) assert.ok(!TEMPLATE_ID.test(strip(readFileSync(f, "utf8"))), `${f} builds a model ID from parts in a template string`);
  for (const [f, ids] of Object.entries(found)) assert.ok(ALLOWED[f], `${f} names a model (${ids.join(", ")}); models belong in the saved settings, set on the Models page`);
  for (const f of Object.keys(ALLOWED)) assert.ok(found[f], `${f} is on the allowed list but names no model: remove it from the list`);
  // No environment variable chooses a model, a limit, a provider or a route (Captain 2026-10-17): the Models page is the only place. The match is on the
  // name as code (an env read, a property or a quoted string), so a comment that explains history is not flagged. The seed (src/model-seed.js) is included.
  const NAMES = ["SIDECAR_LOOK_MODEL", "MODEL_PROVIDER", "STEP_MAX_TOKENS", "DYNAMIC_ROUTING_ZDR_THIRD_MODEL", "DYNAMIC_ROUTING_SHARED_OR", "TEST_MODEL", "TEST_MODEL_HOSTS", "TEST_MODEL_EFFORT", "TEST_MODEL_SCOPE",
    "TASK_REVOKED_MODELS", "TASK_REVOKED_HOSTS", "RATE_LIMIT_WAITS", "ROUTER_FORCE", "CLEF_DOORS", "MODEL", "STT_MODEL", "DECIDER_MODEL", "SIDECAR_EMBED_MODEL", "SIDECAR_VISION_MODEL", "OWN_ROUTER", "OWN_ROUTER_CLEF",
    "ROUTER_MODE", "ROUTER_LAB", "DECISION_SHADOW", "LUNA_429_WAITS", "TASK_MODEL"];
  const ENV_RE = new RegExp(`\\benv\\??\\.(?:${NAMES.join("|")}|CHORE_MODEL(?:_[A-Z]+)?)\\b|["'](?:${NAMES.join("|")}|CHORE_MODEL(?:_[A-Z]+)?)["']`);
  for (const f of files) { const t = strip(readFileSync(f, "utf8")); assert.ok(!ENV_RE.test(t), `${f} reads an environment variable that chooses a model, limit, provider or route`); }
  assert.ok(!/dynamicProvidersOn/.test(files.map((f) => readFileSync(f, "utf8")).join("\n")), "dynamicProvidersOn is gone: DYNAMIC_ROUTING only switches category routing");
  // no module keeps default model lists any more
  const pool = readFileSync("src/ee/pool.js", "utf8"); for (const name of ["POOL", "CHAINS", "chainModels", "fixedEffort"]) assert.ok(!new RegExp(`\\b${name}\\b`).test(strip(pool)), `pool.js still has ${name}`);
  for (const f of ["src/ee/route2.js", "src/model.js", "src/ee/model-settings.js", "src/ee/model-jobs.js", "src/ee/background-policy.js"]) assert.ok(!/\b(CHORE_MODELS|CHORE_DEFAULTS|BACKGROUND_POLICIES|OR_FALLBACKS|SUMMARY_ROUTE\s*=\s*\{)/.test(strip(readFileSync(f, "utf8"))), `${f} still holds a built-in model table`);
  console.log("  ok guard: only", Object.keys(ALLOWED).join(", "), "name models"); }

// ---- 2) every job reads its own saved model ----
const sentinelOf = (id) => ["look", "stt_cloudflare", "live_dictation"].includes(id) ? `@cf/sentinel/${id.replace(/_/g, "-")}` : `sentinel/${id.replace(/[^a-z0-9]+/g, "-")}`;
const record = (id) => ({ id, name: id, eligible: true, reasons: [], efforts: ["default", "none", "low", "medium", "high"], default_effort: "low", levels: ["unrestricted", "no_training", "zdr"], hosts: ["sentinel-host"],
  context_length: 100000, max_output: 8000, input_modalities: ["text", "image"], pricing: { prompt: 1, completion: 1 }, json: true, tool_choice: ["auto", "none", "required", "function"] });
function settingsFor(jobId) {
  const def = JOBS.find((j) => j.id === jobId), kind = JOB_KINDS[def.kind], model = sentinelOf(jobId), s = clone(SEED);
  s.catalog[model] = ["chat", "chore", "classic"].includes(kind.pick) ? record(model) : { id: model, name: model, kinds: [kind.pick], efforts: kind.effort ? ["high"] : [] };
  s.jobs[jobId] = { model, effort: kind.effort ? "high" : null, fallbacks: [] };
  return { settings: validateModelSettings(s), model };
}
const decoys = { CHORE_MODEL: "oss20", CHORE_MODEL_HANDOFF: "oss20", CHORE_MODEL_BROWSER: "oss20", CHORE_MODEL_UPKEEP: "haiku", CHORE_MODEL_MJVERIFY: "haiku", DECIDER_MODEL: "decoy/decider", STT_MODEL: "decoy/stt",
  SIDECAR_EMBED_MODEL: "decoy/embed", SIDECAR_VISION_MODEL: "@cf/decoy/vision", MODEL: "@cf/decoy/chat", OWN_ROUTER_CLEF: "decoy-clef", TASK_MODEL: "sol" };
const envFor = (settings, extra = {}) => ({ ...decoys, OPENROUTER_API_KEY: "k", ONEHELM_EE: "1hc", PROMPT_CACHE: "off", MODEL_SETTINGS: settings, MODEL_SETTINGS_REVISION: 1, ...extra });
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
probes.decider = async (S) => { const env = envFor(S); wire = []; await jevAsk(env, { latest_message: "hi" }, {}); return [deciderModel(env), lastWire("/systemone").model]; };
for (const id of ["handoff", "label", "browser", "notes", "notes_refine", "notes_final", "sidecar_card", "ambient_extract", "ambient_review"])
  probes[id] = async (S) => {
    const route = choreRouteOf(S, id), out = [route.model];
    if (id === "browser") out.push((await browserPlan(envFor(S)))[0].model);
    else if (id === "handoff") out.push((await chat(envFor(S), { two: true, category: "general" }, "chat", { messages: [{ role: "user", content: `${HANDOFF_PREFIX} notes)` }], max_tokens: 50 })).model);
    else out.push((await chat(envFor(S), jobRoute(id), "chore-probe")).model);
    return out; };
probes.stt = async (S) => { const env = envFor(S); wire = []; await stt(env, { size: 3, open: async () => new Response(new Uint8Array([1, 2, 3])).body }, { format: "mp3" }); return [(await sttModels(env))[0], lastWire("/audio/transcriptions").model]; };
probes.stt_cloudflare = async (S, model) => { const calls = [], env = envFor(S, { AI: { run: async (m) => { calls.push(m); return { text: "ok", transcription_info: { duration: 1 }, segments: [] }; } } });
  ENDPOINTS.transcription[model] = { "cloudflare-workers-ai": { zdr: true, training: false } };
  const orig = globalThis.fetch; globalThis.fetch = async () => Response.json({ error: "down" }, { status: 500 });
  try { await stt(env, { size: 3, bytes: new Uint8Array([1, 2, 3]) }, { format: "mp3" }); } finally { globalThis.fetch = orig; delete ENDPOINTS.transcription[model]; } return [calls[0]]; };
probes.live_dictation = async (S, model) => {
  const seen = []; ENDPOINTS.transcription[model] = { "cloudflare-workers-ai": { zdr: true, training: false } };
  try { const ledger = { dictationLease: async () => ({ ok: true }), reserve: async () => ({ ok: true }), settle: async () => ({}) };
    await transcribeLive(new Request("https://x.test/live", { headers: { Upgrade: "websocket", Origin: "https://x.test" } }), envFor(S, { AIG_TOKEN: "t", AIG_ID: "g", CF_ACCOUNT_ID: "a" }), ledger, { tenant: "t" }, { fetch: async (u) => { seen.push(new URL(u).searchParams.get("model")); throw new Error("stop"); } }).catch(() => {});
  } finally { delete ENDPOINTS.transcription[model]; } return [seen[0]]; };
probes.embed_files = async (S) => { wire = []; await embedTexts(envFor(S), ["hello"], { tenant: "t" }); return [lastWire("/embeddings").model]; };
probes.browser_decider = async (S) => { const env = envFor(S); wire = []; await askDecider(env, { task: "t" }, { done: { type: "noul", instructions: "Is it done?" } }, { job: "browser_decider" }); return [await jobModel(env, "browser_decider"), lastWire("/systemone").model]; };
probes.vision_files = async (S) => { wire = [];   // the picture goes to the saved model's own transport; the stub's reply isn't a description, so the parse error is expected
  await vision(envFor(S), { tenant: "t" }, { data: new Uint8Array([1, 2, 3]), mime: "image/png" }, "chat").catch(() => {}); return [lastWire("/chat/completions")?.model]; };
probes.workers_ai_chat = async (S) => [await jobModel(envFor(S), "workers_ai_chat")];
probes.web_search = async (S) => [await jobModel(envFor(S), "web_search")];   // dispatch search reads the saved provider
probes.look = async (S, model) => { const calls = [], env = envFor(S, { AI: { run: async (m) => { calls.push(m); return { caption: "a page", metrics: {} }; } } });
  await lookMoondream(env, { tenant: "t" }, { data: new Uint8Array([1, 2, 3]), mime: "image/png" }, {}); return [calls[0]]; };

for (const def of JOBS) {
  assert.ok(probes[def.id], `job ${def.id} has no probe: add one so its model is proven to come from the saved settings`);
  const { settings, model } = settingsFor(def.id), seen = await probes[def.id](settings, model);
  for (const m of seen) assert.equal(m, model, `${def.id}: the runtime used ${m}, not the saved ${model}`);
  // every other job still reads its own setting: changing this one moved nothing else
  for (const other of JOB_IDS) if (other !== def.id) assert.deepEqual(settings.jobs[other], SEED.jobs[other], `${def.id} changed ${other}`);
}
assert.deepEqual(Object.keys(probes).sort(), [...JOB_IDS].sort(), "a probe for every job and nothing else");
// main chat replies read the General category (the chat job no longer exists): its first model, its saved reasoning level and nothing from the environment
{ const model = "sentinel/general", s = clone(SEED); s.catalog[model] = record(model); setGeneral(s, [{ model, effort: "high" }]);
  const S = validateModelSettings(s), route = policyRoute(S, "general", "zdr", "x"), r = dispatchOrder(route, "zdr", { settings: S });
  assert.equal(r.attempts[0].effort, "high", "the saved effort"); const w = await chat(envFor(S), route, "chat"); assert.equal(w.reasoning.effort, "high");
  for (const m of [r.attempts[0].model, w.model]) assert.equal(m, model, `general: the runtime used ${m}, not the saved ${model}`); }
console.log(`  ok every one of ${JOBS.length} jobs uses only its own saved model, with decoy environment variables set`);

// a hand-off request is recognized and read from the saved handoff job
assert.equal(choreRouteFor({ two: true }, { messages: [{ role: "user", content: `${HANDOFF_PREFIX} x` }] }, { MODEL_SETTINGS: SEED }).model, SEED.jobs.handoff.model);

// ---- 3) settings that can't be read: a clear error and nothing is sent ----
wire = [];
await assert.rejects(openRouterChat({ OPENROUTER_API_KEY: "k", ONEHELM_EE: "1hc", DB: { prepare() { throw new Error("db down"); } }, ENV_NAME: "isolated" }, { messages: [] }, null, jobRoute("label"), { kind: "card-label" }),
  (e) => e instanceof ModelSettingsError && /Nothing was sent/.test(e.message));
assert.equal(wire.length, 0, "no request went out");
await assert.rejects(openRouterChat({ OPENROUTER_API_KEY: "k", ONEHELM_EE: "1hc" }, { messages: [] }, null, jobRoute("label"), { kind: "card-label" }), (e) => e instanceof ModelSettingsError);
assert.equal(wire.length, 0);
// Public deployment (the EE switch is off): the shared settings table is never read. Every job gets the first-run data, held in memory.
{
  const open = await modelSettingsEnv({ DB: { prepare() { throw new Error("the shared settings table must not be read without the EE switch"); } } });
  assert.equal(open.MODEL_SETTINGS.jobs.label.model, SEED.jobs.label.model);
  assert.equal(open.MODEL_SETTINGS_REVISION, 0);
  assert.equal((await readModelSettings({ DB: { prepare() { throw new Error("the shared settings table must not be read without the EE switch"); } } })).revision, 0);
  assert.equal(await jobModel({ DB: null }, "label"), SEED.jobs.label.model);
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
  assert.deepEqual([seeded.jobs.browser.model, seeded.jobs.browser.fallbacks[0].model, seeded.jobs.browser.fallbacks[0].effort], ["openai/gpt-oss-120b", "deepseek/deepseek-v4.1-flash", "low"]);
  for (const j of Object.values(seeded.jobs)) for (const e of [j, ...j.fallbacks]) assert.ok(!("hosts" in e) && !("pin" in e), "the first-run data has no provider lists");
  assert.deepEqual([seeded.jobs.handoff.model, seeded.jobs.handoff.effort], ["deepseek/deepseek-v4.1-flash", "low"]);
  console.log("  ok every background job in the seed has a fallback");
}
