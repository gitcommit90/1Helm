// node --import ./test/stubs/register.mjs test/model-plan-parity.test.mjs
// plan() is the one place a job's models, transport and limits are decided. Dev, Live and a bare environment must give the same plan for the same saved
// settings, a plan never carries a provider list, and a model's transport follows its ID (Captain 2026-10-17). No order, only or ignore key is ever produced.
import test from "node:test";
import assert from "node:assert/strict";
import { plan } from "../src/ee/model-plan.js";
import { modelSettingsEnv } from "../src/ee/model-settings.js";
import { JOB_IDS } from "../src/ee/model-jobs.js";
import { PRIVACY_LEVELS } from "../src/privacy.js";
import { isCloudflareModel } from "../src/cloudflare-models.js";
import { isSelfHostedModel } from "../src/selfhost-models.js";
import { SEED, seedSettings, withSettings } from "./helpers/seed-settings.mjs";

const clone = (x) => JSON.parse(JSON.stringify(x));
const DECOYS = { MODEL: "@cf/decoy/chat", ROUTER_MODE: "classic", DYNAMIC_ROUTING: "", TEST_MODE: "1", CHORE_MODEL_LABEL: "oss20", DECIDER_MODEL: "decoy/decider", STEP_MAX_TOKENS: "7", MODEL_PROVIDER: "workers-ai" };
const envs = { dev: withSettings({ ENV_NAME: "dev", ...DECOYS }), live: withSettings({ ENV_NAME: "live" }), bare: { MODEL_SETTINGS: clone(SEED) } };
const BANNED = ["order", "only", "ignore"];
const walk = (o, hit) => { if (Array.isArray(o)) o.forEach((x) => walk(x, hit)); else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { hit(k, v); walk(v, hit); } };

test("for every job and privacy level, the plan is the same on dev, Live and a bare environment", async () => {
  for (const level of PRIVACY_LEVELS) for (const id of JOB_IDS) {
    const plans = await Promise.all(Object.values(envs).map(async (e) => plan((await modelSettingsEnv(e)).MODEL_SETTINGS, id, { level })));
    assert.deepEqual(plans[1], plans[0], `${id} at ${level}: live differs from dev`);
    assert.deepEqual(plans[2], plans[0], `${id} at ${level}: a bare environment differs from dev`);
  }
});

test("no plan carries order, only or ignore, even when saved entries still hold them", () => {
  const s = clone(SEED);
  for (const id of JOB_IDS) { const j = s.jobs[id]; j.hosts = ["azure"]; j.pin = true; j.fallbacks = (j.fallbacks || []).map((f) => ({ ...f, hosts: ["x"], pin: true })); }
  for (const level of PRIVACY_LEVELS) for (const id of JOB_IDS) walk(plan(s, id, { level }), (k) => assert.ok(!BANNED.includes(k), `${id} at ${level}: the plan has "${k}"`));
});

test("a model's transport follows its ID: an @cf/ ID is a Cloudflare step and every other ID goes to OpenRouter", () => {
  const CF_ADAPTERS = new Set(["decide_clef", "look", "search", "transcribe_live", "chat", "embeddings", "rerank", "transcribe"]);
  for (const level of PRIVACY_LEVELS) for (const id of JOB_IDS) for (const st of plan(SEED, id, { level }).steps) {
    const cf = isCloudflareModel(st.model) || id === "web_search", own = isSelfHostedModel(st.model);
    assert.equal(st.source, cf ? "CF" : own ? "SELF" : "OR", `${id}: ${st.model}`);
    if (own) { assert.equal(st.provider, null, `${id}: a step in 1Helm's own container has no OpenRouter provider object`); assert.ok(["embeddings", "transcribe", "diarize"].includes(st.adapter), `${id}: only embeddings and speech run in the container`); continue; }
    if (st.source === "OR") { assert.ok(st.provider && typeof st.provider === "object", `${id}: an OpenRouter step has its provider fields`); assert.ok(!["decide_clef", "look", "search", "transcribe_live"].includes(st.adapter), `${id}: ${st.model} is on OpenRouter with the ${st.adapter} adapter`); }
    else { assert.equal(st.provider, null, `${id}: a Cloudflare step has no OpenRouter provider object`); assert.ok(CF_ADAPTERS.has(st.adapter), `${id}: ${st.adapter}`); assert.ok(!["decide_systemone", "decide_json"].includes(st.adapter), `${id}: ${st.model} is on Cloudflare with the ${st.adapter} adapter`); }
  }
});

test("a saved limit appears in the plan exactly as saved, an empty one stays empty, and results belong to web search only", () => {
  const s = seedSettings(); s.jobs.notes.max_output = 1234; s.jobs.web_search.results = 7;
  assert.equal(plan(s, "notes", { level: "zdr" }).steps[0].maxOutput, 1234);
  for (const id of JOB_IDS) if (!["notes", "notes_final", "notes_refine"].includes(id) && !id.startsWith("hs_")) for (const st of plan(s, id, { level: "zdr" }).steps) assert.equal(st.maxOutput, null, `${id}: empty stays empty`);
  assert.equal(plan(s, "web_search", { level: "zdr" }).steps[0].results, 7);
  for (const id of JOB_IDS) if (id !== "web_search") for (const st of plan(s, id, { level: "zdr" }).steps) assert.equal("results" in st, false, id);
});
