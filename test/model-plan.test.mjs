// node --import ./test/stubs/register.mjs test/model-plan.test.mjs
// The model plan (src/model-plan.js) is pure and the same on every environment, never produces a provider list, and picks the transport from the model ID.
import test from "node:test";
import assert from "node:assert/strict";
import { plan } from "../src/ee/model-dispatch.js";
import { JOB_IDS } from "../src/ee/model-jobs.js";
import { PRIVACY_LEVELS } from "../src/privacy.js";
import { taskPayload } from "../src/model.js";
import { isCloudflareModel } from "../src/cloudflare-models.js";
import { isSelfHostedModel } from "../src/selfhost-models.js";
import { SEED, withSettings } from "./helpers/seed-settings.mjs";

const clone = (x) => JSON.parse(JSON.stringify(x));
const ALLOWED = ["zdr", "data_collection", "sort", "max_price", "require_parameters", "allow_fallbacks"];

test("plan is the same whether the env says dev or live or nothing", () => {
  const dev = withSettings({ ENV_NAME: "dev", TEST_MODE: "1", DYNAMIC_ROUTING: "on" }).MODEL_SETTINGS;
  const live = withSettings({ ENV_NAME: "live" }).MODEL_SETTINGS;
  for (const id of JOB_IDS) for (const level of PRIVACY_LEVELS) {
    const a = plan(dev, id, { level }), b = plan(live, id, { level }), c = plan(clone(SEED), id, { level });
    assert.deepEqual(a, b, `${id} ${level}`); assert.deepEqual(a, c, `${id} ${level}`);
  }
});

test("no provider list key is ever produced, even when the saved entries carry hosts and pin", () => {
  const s = clone(SEED);
  for (const id of JOB_IDS) { s.jobs[id].hosts = ["deepinfra", "groq"]; s.jobs[id].pin = true; for (const f of s.jobs[id].fallbacks || []) { f.hosts = ["azure"]; f.pin = true; } }
  let steps = 0;
  for (const id of JOB_IDS) for (const level of PRIVACY_LEVELS) for (const st of plan(s, id, { level }).steps) {
    steps++;
    for (const k of Object.keys(st.provider || {})) assert.ok(ALLOWED.includes(k), `${id}: unexpected provider key ${k}`);
    for (const k of ["order", "only", "ignore"]) assert.ok(!(k in (st.provider || {})) && !(k in st), `${id}: ${k}`);
  }
  assert.ok(steps > 40);
});

test("@cf/ IDs go to CF and every other ID goes to OR", () => {
  for (const id of JOB_IDS) for (const st of plan(SEED, id, { level: "zdr" }).steps) {
    if (st.adapter === "search") { assert.equal(st.source, "CF", "a search provider is a gateway call, not an OpenRouter model"); assert.equal(st.provider, null); continue; }
    assert.equal(st.source, isCloudflareModel(st.model) ? "CF" : isSelfHostedModel(st.model) ? "SELF" : "OR", `${id} ${st.model}`);
    assert.equal(st.source === "CF", st.model.startsWith("@cf/"), st.model);
    assert.equal(st.provider === null, st.source !== "OR", st.model);
  }
  assert.ok(Object.values(SEED.jobs).some((j) => j.model.startsWith("@cf/")) );
});

test("saved max_output, sort and max_price are used, and an empty max output stays empty", () => {
  const s = clone(SEED);
  const base = plan(s, "label", { level: "zdr" }).steps[0];
  assert.equal(base.maxOutput, null, "empty stays empty: no limit is sent");
  assert.equal(base.provider.sort, undefined);
  s.jobs.label.max_output = 777; s.jobs.label.sort = "latency"; s.jobs.label.max_price = { prompt: 0.5, completion: 1 };
  const st = plan(s, "label", { level: "zdr" }).steps[0];
  assert.equal(st.maxOutput, 777); assert.equal(st.provider.sort, "latency"); assert.deepEqual(st.provider.max_price, { prompt: 0.5, completion: 1 });
  s.jobs.label.sort = null; s.jobs.label.max_price = null;
  assert.equal(plan(s, "label", { level: "zdr" }).steps[0].provider.sort, undefined);
  assert.equal(plan(s, "vision_files", { level: "zdr" }).steps[0].provider?.sort ?? "throughput", "throughput");
});

test("privacy level sets only OpenRouter's own fields", () => {
  // the main chat is not a job: its request is made from the frozen task profile and the limits of its routing category
  const s = clone(SEED), model = s.routing.categories[0].chains.zdr[0].model;
  const profile = { requestedModel: model, effort: null, category: "general", catalog: { ...s.catalog[model], context_length: 200000, max_output: 32000 }, cacheSession: "s" };
  const p = (level) => taskPayload(profile, { messages: [] }, { level, settings: s }).provider;
  assert.equal(p("zdr").zdr, true); assert.equal(p("zdr").data_collection, "deny");
  const nt = p("no_training"); assert.equal(nt.zdr, undefined); assert.equal(nt.data_collection, "deny");
  const un = p("unrestricted"); assert.equal(un.zdr, undefined); assert.equal(un.data_collection, "allow");
  for (const level of PRIVACY_LEVELS) for (const k of Object.keys(p(level))) assert.ok(ALLOWED.includes(k), `${level}: ${k}`);
});

test("plan is pure: it does not change the settings", () => {
  const s = clone(SEED), before = JSON.stringify(s);
  for (const id of JOB_IDS) plan(s, id, { level: "no_training" });
  assert.equal(JSON.stringify(s), before);
});
