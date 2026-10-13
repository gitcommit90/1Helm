// node --import ./test/stubs/register.mjs test/model-privacy-skip.test.mjs
// One ordered list per chat job. The account's AI data privacy setting decides which models of the list may be used: a model it forbids is
// skipped, never tried, and a list that leaves a setting with no allowed model fails with the privacy message and sends nothing.
import assert from "node:assert/strict";
import { openRouterChat } from "../src/model.js";
import { policyRoute, dispatchOrder } from "../src/ee/route2.js";
import { allowedEntries, privacyCoverage, entriesOf } from "../src/ee/model-jobs.js";
import { PRIVACY_LEVELS, PRIVACY_EXHAUSTED, ENDPOINTS, eligibleHosts } from "../src/privacy.js";
import { jobView } from "../src/ee/model-dashboard.js";
import { ID, SEED } from "./helpers/seed-settings.mjs";

const clone = (x) => JSON.parse(JSON.stringify(x));
const { MUSE_C: MC, MUSE_S: MS, DEEPSEEK: DS, LUNA: LU, SOL: SO, HAIKU: HA } = ID;
let level = "unrestricted";
const DB = { prepare: (q) => ({ bind: () => ({ first: async () => /ai_privacy/.test(q) ? { ai_privacy: level } : null }) }) };
const sent = []; let down = new Set();
globalThis.fetch = async (url, init) => { const b = JSON.parse(init.body); sent.push(b);
  return down.has(b.model) ? Response.json({ error: { message: "down" } }, { status: 503 }) : Response.json({ model: b.model, choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { cost: 0 } }); };
const withList = (models) => { const s = clone(SEED); const [m, ...rest] = models;
  s.jobs["chat.general"] = { model: m, effort: s.catalog[m].efforts.includes("high") ? "high" : s.catalog[m].efforts.at(-1), fallbacks: rest.map((x) => ({ model: x, effort: s.catalog[x].efforts.includes("high") ? "high" : s.catalog[x].efforts.at(-1) })) }; return s; };
const run = async (settings, lv, kinds = {}) => { level = lv; sent.length = 0; const env = { DB, OPENROUTER_API_KEY: "k", ONEHELM_EE: "1hc", ROUTER_MODE: "two", PROMPT_CACHE: "off", MODEL_SETTINGS: settings };
  return openRouterChat(env, { messages: [{ role: "user", content: "x" }], stream: false, max_tokens: 50 }, "s", policyRoute(settings, "general", lv, "t"), { tenant: "t" }); };

// ---- the rule: tried in list order, forbidden models skipped ----
{ const S = withList([MC, MS, DS, LU, HA]);
  const at = (lv) => allowedEntries(S, S.jobs["chat.general"], lv).map((e) => e.model);
  assert.deepEqual(at("unrestricted"), [MC, MS, DS, LU, HA]); assert.deepEqual(at("no_training"), [MS, DS, LU, HA]); assert.deepEqual(at("zdr"), [DS, LU, HA]);
  for (const lv of PRIVACY_LEVELS) { await run(S, lv); assert.equal(sent[0].model, at(lv)[0], `${lv}: the first allowed model answers`);
    // every model that is tried while walking the list, at every level, is one the level allows, on endpoints the level allows
    down = new Set(at(lv).slice(0, 2)); await run(S, lv); down = new Set();
    assert.deepEqual(sent.map((b) => b.model), at(lv).slice(0, 3), `${lv}: tried in order, never a forbidden model`);
    for (const b of sent) { assert.ok(b.provider.only.length); for (const h of b.provider.only) assert.ok(eligibleHosts(b.model, lv).includes(h), `${lv}: ${b.model} on ${h}`);
      for (const h of b.provider.only) { const ep = ENDPOINTS.chat[b.model][h]; if (lv === "zdr") assert.ok(ep.zdr && !ep.training); if (lv === "no_training") assert.ok(!ep.training); } } }
  console.log("  ok list order with forbidden models skipped, endpoints allowed by the level only"); }

// ---- a setting that leaves the list with no allowed model: privacy message, nothing sent ----
{ const S = withList([MC]);
  for (const lv of ["no_training", "zdr"]) { sent.length = 0; await assert.rejects(run(S, lv), (e) => e.privacy === true && e.message === PRIVACY_EXHAUSTED); assert.equal(sent.length, 0, `${lv}: nothing sent anywhere`); }
  await run(S, "unrestricted"); assert.equal(sent[0].model, MC);
  // the page reports it
  const view = jobView(S, { id: "chat.general", kind: "chat", group: "chat", label: "Everyday chat", description: "" });
  assert.equal(view.coverage.zdr.allowed, 0); assert.equal(view.coverage.no_training.allowed, 0); assert.equal(view.coverage.unrestricted.allowed, 1);
  assert.equal(view.warnings.length, 2); assert.ok(view.warnings.every((w) => /no allowed model/.test(w)));
  const ok = jobView(SEED, { id: "chat.technical", kind: "chat", group: "chat", label: "Hard technical work", description: "" }); assert.deepEqual(ok.warnings, []);
  assert.equal(privacyCoverage(S, "decider"), null, "jobs the setting doesn't filter have no coverage");
  console.log("  ok no allowed model: PRIVACY_EXHAUSTED, nothing sent, reported on the page"); }

// ---- tightening the setting between two calls moves the next call to the next allowed model ----
{ const S = withList([MC, DS, LU]); await run(S, "unrestricted"); assert.equal(sent[0].model, MC); await run(S, "zdr"); assert.equal(sent[0].model, DS); await run(S, "no_training"); assert.equal(sent[0].model, DS); }

// ---- an unknown level or an unreadable account setting is the strictest (zero data retention) ----
{ const S = withList([MC, DS]); level = "bogus"; sent.length = 0; const env = { DB, OPENROUTER_API_KEY: "k", ONEHELM_EE: "1hc", ROUTER_MODE: "two", PROMPT_CACHE: "off", MODEL_SETTINGS: S };
  await openRouterChat(env, { messages: [{ role: "user", content: "x" }], max_tokens: 5 }, "s", policyRoute(S, "general", "zdr", "t"), { tenant: "t" }); assert.equal(sent[0].model, DS); }

// ---- recovery models and the mid-task switch obey the same rule ----
{ const S = clone(SEED); S.jobs["recover.technical"] = { model: MC, effort: "xhigh", fallbacks: [] };
  const r = policyRoute(S, "technical", "zdr", "r", { recoveryJob: "recover.technical" });
  assert.ok(!dispatchOrder(r, "zdr", { settings: S }).models.includes(MC), "a recovery model the level forbids is skipped");
  assert.equal(dispatchOrder(policyRoute(S, "technical", "unrestricted", "r", { recoveryJob: "recover.technical" }), "unrestricted", { settings: S }).models[0], MC); }

// ---- background jobs run on zero-data-retention providers at every setting ----
{ for (const lv of PRIVACY_LEVELS) { level = lv; sent.length = 0; const env = { DB, OPENROUTER_API_KEY: "k", ONEHELM_EE: "1hc", ROUTER_MODE: "two", PROMPT_CACHE: "off", MODEL_SETTINGS: SEED };
    await openRouterChat(env, { messages: [{ role: "user", content: "x" }], max_tokens: 5 }, null, { chore: true }, { tenant: "t", kind: "card-label" }); assert.equal(sent[0].provider.zdr, true, lv); assert.equal(sent[0].provider.data_collection, "deny", lv); } }
globalThis.fetch = undefined;
console.log("PASS privacy skip rule");
