// node --import ./test/stubs/register.mjs test/model-privacy-skip.test.mjs
// One ordered list per chat job. The account's AI data privacy setting decides which models of the list may be used: a model it forbids is
// skipped, never tried, and a list that leaves a setting with no allowed model fails with the privacy message and sends nothing.
import assert from "node:assert/strict";
import { openRouterChat } from "./helpers/or-chat.mjs";
import { policyRoute, dispatchOrder } from "../src/ee/route2.js";
import { allowedEntries, privacyCoverage, entriesOf } from "../src/ee/model-jobs.js";
import { PRIVACY_LEVELS, PRIVACY_EXHAUSTED, ENDPOINTS, eligibleHosts } from "../src/privacy.js";
import { ID, SEED } from "./helpers/seed-settings.mjs";

const clone = (x) => JSON.parse(JSON.stringify(x));
const { MUSE_C: MC, MUSE_S: MS, DEEPSEEK: DS, LUNA: LU, SOL: SO, HAIKU: HA } = ID;
let level = "unrestricted";
const DB = { prepare: (q) => ({ bind: () => ({ first: async () => /ai_privacy/.test(q) ? { ai_privacy: level } : null }) }) };
const sent = []; let down = new Set();
globalThis.fetch = async (url, init) => { const b = JSON.parse(init.body); sent.push(b);
  return down.has(b.model) ? Response.json({ error: { message: "down" } }, { status: 503 }) : Response.json({ model: b.model, choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { cost: 0 } }); };
// General's saved list, set to any list (not validated here: this test is about how a list is walked at each privacy level).
const withList = (models) => { const s = clone(SEED), effort = (x) => s.catalog[x].efforts.includes("high") ? "high" : s.catalog[x].efforts.at(-1), list = models.map((x) => ({ model: x, effort: effort(x) }));
  for (const lv of PRIVACY_LEVELS) s.routing.categories[0].chains[lv] = clone(list); return s; }
const jobOf = (S) => { const [a, ...rest] = S.routing.categories[0].chains.zdr; return { model: a.model, effort: a.effort, fallbacks: rest }; };
const run = async (settings, lv, kinds = {}) => { level = lv; sent.length = 0; const env = { DB, OPENROUTER_API_KEY: "k", ONEHELM_EE: "1hc", ROUTER_MODE: "two", PROMPT_CACHE: "off", MODEL_SETTINGS: settings };
  return openRouterChat(env, { messages: [{ role: "user", content: "x" }], stream: false, max_tokens: 50 }, "s", policyRoute(settings, "general", lv, "t"), { tenant: "t" }); };

// ---- the rule: tried in list order, forbidden models skipped ----
{ const S = withList([MC, MS, DS, LU, HA]);
  const at = (lv) => allowedEntries(S, jobOf(S), lv).map((e) => e.model);
  assert.deepEqual(at("unrestricted"), [MC, MS, DS, LU, HA]); assert.deepEqual(at("no_training"), [MS, DS, LU, HA]); assert.deepEqual(at("zdr"), [DS, LU, HA]);
  for (const lv of PRIVACY_LEVELS) { await run(S, lv); assert.equal(sent[0].model, at(lv)[0], `${lv}: the first allowed model answers`);
    // every model that is tried while walking the list, at every level, is one the level allows, on endpoints the level allows
    down = new Set(at(lv).slice(0, 2)); await run(S, lv); down = new Set();
    assert.deepEqual(sent.map((b) => b.model), at(lv).slice(0, 3), `${lv}: tried in order, never a forbidden model`);
    for (const b of sent) { assert.equal(b.provider.only, undefined); assert.equal(b.provider.order, undefined); if (lv === "zdr") assert.equal(b.provider.zdr, true); if (lv !== "unrestricted") assert.equal(b.provider.data_collection, "deny"); } }
  console.log("  ok list order with forbidden models skipped, endpoints allowed by the level only"); }

// ---- a setting that leaves the list with no allowed model: privacy message, nothing sent ----
{ const S = withList([MC]);
  for (const lv of ["no_training", "zdr"]) { sent.length = 0; await assert.rejects(run(S, lv), (e) => e.privacy === true && e.message === PRIVACY_EXHAUSTED); assert.equal(sent.length, 0, `${lv}: nothing sent anywhere`); }
  await run(S, "unrestricted"); assert.equal(sent[0].model, MC);
  assert.equal(privacyCoverage(S, "decider"), null, "jobs the setting doesn't filter have no coverage");
  console.log("  ok no allowed model: PRIVACY_EXHAUSTED, nothing sent"); }

// ---- tightening the setting between two calls moves the next call to the next allowed model ----
{ const S = withList([MC, DS, LU]); await run(S, "unrestricted"); assert.equal(sent[0].model, MC); await run(S, "zdr"); assert.equal(sent[0].model, DS); await run(S, "no_training"); assert.equal(sent[0].model, DS); }

// ---- an unknown level or an unreadable account setting is the strictest (zero data retention) ----
{ const S = withList([MC, DS]); level = "bogus"; sent.length = 0; const env = { DB, OPENROUTER_API_KEY: "k", ONEHELM_EE: "1hc", ROUTER_MODE: "two", PROMPT_CACHE: "off", MODEL_SETTINGS: S };
  await openRouterChat(env, { messages: [{ role: "user", content: "x" }], max_tokens: 5 }, "s", policyRoute(S, "general", "zdr", "t"), { tenant: "t" }); assert.equal(sent[0].model, DS); }

// ---- a model named directly on a route (a legacy route saved before the settings existed) obeys the same rule ----
{ const S = clone(SEED);
  const r = policyRoute(S, "technical", "zdr", "r", { recovery: MC });
  assert.ok(!dispatchOrder(r, "zdr", { settings: S }).models.includes(MC), "a named model the level forbids is skipped");
  assert.equal(dispatchOrder(policyRoute(S, "technical", "unrestricted", "r", { recovery: MC }), "unrestricted", { settings: S }).models[0], MC); }

// ---- background jobs run on zero-data-retention providers at every setting ----
{ for (const lv of PRIVACY_LEVELS) { level = lv; sent.length = 0; const env = { DB, OPENROUTER_API_KEY: "k", ONEHELM_EE: "1hc", ROUTER_MODE: "two", PROMPT_CACHE: "off", MODEL_SETTINGS: SEED };
    await openRouterChat(env, { messages: [{ role: "user", content: "x" }], max_tokens: 5 }, null, { chore: true }, { tenant: "t", kind: "card-label" }); assert.equal(sent[0].provider.zdr, true, lv); assert.equal(sent[0].provider.data_collection, "deny", lv); } }
globalThis.fetch = undefined;
console.log("PASS privacy skip rule");
