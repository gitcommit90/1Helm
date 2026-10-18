// node --import ./test/stubs/register.mjs test/hs-mm-triggers.test.mjs
// Mental models refresh twice a day on a cron (Captain 2026-10-18), not after every consolidation. Checks: both templates give every model
// refresh_cron "0 10,22 * * *" and nothing else that refreshes (no refresh_after_consolidation, no minimum interval, no bank setting), and the
// template version changed; syncMentalModelTriggers changes an existing model's trigger with PATCH only (no import, no refresh call), skips models
// that already match, skips models the bank lacks, counts before and after, does nothing on a dry run, and throws when a PATCH fails; the Resident
// patches an existing bank's triggers before it imports the template (an import of a changed trigger queues a full refresh); the admin action
// "triggers" patches bank by bank and also reaches empty banks.
import assert from "node:assert/strict";
import { fillTemplate, TEMPLATE_VERSION, templateKey } from "../src/hindsight-template.js";
import { syncMentalModelTriggers } from "../src/hindsight.js";
import { hsAdmin } from "../src/hindsight-health.js";
import { Resident } from "../src/resident.js";
const ok = (n) => console.log("  ok", n);
const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
const CRON = "0 10,22 * * *", V = { first: "Sam", helper: "Skipper", channel: "trip", purpose: "x" };

// ---- the templates ----
for (const kind of ["general", "channel"]) {
  const t = fillTemplate(kind, V);
  assert.ok(t.mental_models.length >= 3);
  for (const m of t.mental_models) assert.deepEqual(m.trigger, { refresh_cron: CRON, mode: "full" }, `${kind}/${m.id}`);
  assert.ok(!("mental_model_min_refresh_interval_seconds" in t.bank), `${kind}: no bank minimum interval`);
  assert.doesNotMatch(JSON.stringify(t), /refresh_after_consolidation|min_refresh_interval/, `${kind}: nothing refreshes after consolidation`);
}
assert.notEqual(TEMPLATE_VERSION, "p10-3"); assert.equal(TEMPLATE_VERSION, "p10-4"); assert.ok(templateKey("general", V).startsWith("p10-4|"));
ok("templates: every model of both kinds refreshes on the 10:00 and 22:00 UTC cron, nothing else; version p10-4");

// ---- a fake Hindsight with stored triggers ----
const OLD = { refresh_after_consolidation: true, mode: "full", min_refresh_interval_seconds: 1800 };
function fake(banks) {
  const calls = [], bodies = [];
  const HINDSIGHT = { fetch: async (u, init = {}) => {
    const url = new URL(u), m = init.method || "GET", p = decodeURIComponent(url.pathname).replace("/v1/default/banks", ""), body = init.body ? JSON.parse(init.body) : null;
    calls.push(`${m} ${p}${url.search}`); bodies.push(body); let x;
    if (m === "GET" && p === "") return J({ banks: Object.keys(banks).map((bank_id) => ({ bank_id })), total: Object.keys(banks).length });
    if (!(x = p.match(/^\/([^/]+)(\/.*)?$/))) return J({}, 404);
    const b = banks[x[1]], rest = x[2] || ""; if (!b) return J({ detail: "no bank" }, 404);
    if (rest === "/mental-models" && m === "GET") return J({ items: b.models.map((mm) => ({ id: mm.id, ...(url.searchParams.get("detail") ? { trigger: mm.trigger } : {}) })) });
    let y; if ((y = rest.match(/^\/mental-models\/([^/]+)$/)) && m === "PATCH") {
      const mm = b.models.find((q) => q.id === y[1]); if (!mm) return J({ detail: "none" }, 404); if (b.failPatch) return J({ detail: "boom" }, 500);
      mm.trigger = Object.fromEntries(Object.entries({ ...mm.trigger, ...body.trigger }).filter(([, v]) => v !== false && v !== null)); return J({ id: mm.id }); }
    if (rest === "/stats") return J({ total_nodes: b.empty ? 0 : 5, total_documents: b.empty ? 0 : 1, failed_consolidation: 0 });
    if (rest === "/import" && m === "POST") { b.imports = (b.imports || 0) + 1; return J({ mental_models_created: [], mental_models_updated: [], operation_ids: [] }); }
    return J({});
  } };
  return { calls, bodies, env: (extra = {}) => ({ HINDSIGHT, HINDSIGHT_API_KEY: "k", MEMORY_BACKEND: "hindsight", ENV_NAME: "dev", ...extra }) };
}
const model = (id, trigger) => ({ id, trigger: { ...trigger } });
const kinds = (banks) => { const o = { cron: 0, after_consolidation: 0, other: 0 }; for (const b of Object.values(banks)) for (const m of b.models) o[m.trigger.refresh_cron ? "cron" : m.trigger.refresh_after_consolidation ? "after_consolidation" : "other"]++; return o; };

// ---- syncMentalModelTriggers ----
{
  const man = fillTemplate("general", V), ids = man.mental_models.map((m) => m.id);
  const banks = { b1: { models: [...ids.slice(0, 4).map((id) => model(id, OLD)), model("someone-elses", OLD)] } }, f = fake(banks), env = f.env();
  const dry = await syncMentalModelTriggers(env, "b1", man, { dryRun: true });
  assert.deepEqual(f.calls, ["GET /b1/mental-models?detail=content&limit=100"], "a dry run only reads");
  assert.deepEqual([dry.checked, dry.patched, dry.before, dry.after], [4, 4, { cron: 0, after_consolidation: 4, other: 0 }, { cron: 0, after_consolidation: 4, other: 0 }], "dry: counts, nothing changed");
  f.calls.length = 0; f.bodies.length = 0; const r = await syncMentalModelTriggers(env, "b1", man);
  assert.deepEqual(f.calls, ["GET /b1/mental-models?detail=content&limit=100", ...ids.slice(0, 4).map((id) => `PATCH /b1/mental-models/${id}`)], "one list, then one PATCH per model, no import and no refresh call");
  assert.deepEqual(f.bodies[1], { trigger: { refresh_cron: CRON, refresh_after_consolidation: false, min_refresh_interval_seconds: null } }, "the PATCH carries only the trigger fields");
  assert.deepEqual([r.checked, r.patched, r.before, r.after], [4, 4, { cron: 0, after_consolidation: 4, other: 0 }, { cron: 4, after_consolidation: 0, other: 0 }]);
  assert.deepEqual(banks.b1.models[0].trigger, { refresh_cron: CRON, mode: "full" }, "the stored trigger now equals the template's, so the import will leave it alone");
  assert.deepEqual(banks.b1.models[4].trigger, OLD, "a model the template does not name is untouched");
  f.calls.length = 0; const again = await syncMentalModelTriggers(env, "b1", man); assert.equal(again.patched, 0); assert.deepEqual(f.calls, ["GET /b1/mental-models?detail=content&limit=100"], "already on the cron: no PATCH");
  assert.deepEqual((await syncMentalModelTriggers(env, "nobank", man)).checked, 0, "a missing bank has nothing to change");
  assert.deepEqual(await syncMentalModelTriggers(env, "b1", { version: "1", bank: {} }), { checked: 0, patched: 0, before: { cron: 0, after_consolidation: 0, other: 0 }, after: { cron: 0, after_consolidation: 0, other: 0 }, ids: [] });
  banks.b2 = { models: [model(ids[0], OLD)], failPatch: true }; await assert.rejects(() => syncMentalModelTriggers(env, "b2", man), /500/);
  ok("sync: PATCH of the trigger only, no import and no refresh, counts, dry run, skips what matches or is missing, throws on a failed PATCH");
}

// ---- the Resident: triggers first, then the import; a failure means no import ----
{
  const man = fillTemplate("general", { first: "Sam", helper: "Ollie", channel: "main", purpose: "x" }), ids = man.mental_models.map((m) => m.id);
  const mk = (banks, f) => { const R = Object.create(Resident.prototype), s = new Map([["hs_bank", "b1"], ["hs_tpl", "p10-3|old"], ["channel", "main"]]);
    R.get = (k) => s.has(k) ? s.get(k) : null; R.put = (k, v) => { s.set(k, v); }; R.hsBankId = () => "b1"; R.hsNames = async () => ({ first: "Sam", helper: "Ollie", channel: "main", purpose: "x" });
    R.env = f.env({ HS_FOUNDATIONS: "on" }); return R; };
  const banks = { b1: { models: ids.map((id) => model(id, OLD)) } }, f = fake(banks), R = mk(banks, f);
  await R.hsBank();
  const order = f.calls.map((c) => c.split(" ")[0] + (c.includes("/import") ? " import" : c.includes("PATCH") ? " patch" : " list"));
  assert.deepEqual(order, ["GET list", ...ids.map(() => "PATCH patch"), "POST import"], "list, every PATCH, and only then the import");
  assert.deepEqual(kinds(banks), { cron: ids.length, after_consolidation: 0, other: 0 }); assert.ok(R.get("hs_tpl").startsWith("p10-4|"), "the new key is recorded");
  const fb = { b1: { models: ids.map((id) => model(id, OLD)), failPatch: true } }, f2 = fake(fb), R2 = mk(fb, f2); await R2.hsBank();
  assert.equal(fb.b1.imports || 0, 0, "a failed PATCH means no import (it would queue a refresh of every model)"); assert.equal(R2.get("hs_tpl"), "p10-3|old", "no key recorded, so it is tried again");
  ok("Resident: an existing bank's triggers are patched before the template import, and a failed patch blocks the import and is retried");
}

// ---- the admin action ----
{
  const t1 = "22222222-2222-4222-8222-222222222222", t2 = "33333333-3333-4333-8333-333333333333";
  const gen = fillTemplate("general", V).mental_models.map((m) => m.id), chn = fillTemplate("channel", V).mental_models.map((m) => m.id);
  const banks = { [`dev-${t1}-main`]: { models: gen.map((i) => model(i, OLD)) }, [`dev-${t1}-trip`]: { models: chn.map((i) => model(i, OLD)), empty: true }, [`dev-${t2}-main`]: { models: gen.map((i) => model(i, { refresh_cron: CRON, mode: "full" })) } };
  const f = fake(banks), DB = { prepare: (q) => ({ bind: (...a) => ({ first: async () => ({ first_name: "Sam", helper_name: "Ollie", id: a[0] }), all: async () => ({ results: [] }), run: async () => ({}) }) }) };
  const env = { ...f.env({ HS_FOUNDATIONS: "on" }), DB }, archive = () => ({ channels: async () => [{ slug: "main", purpose: "a" }, { slug: "trip", purpose: "b" }] }), opt = { archive, pauseMs: 0 };
  const dry = await hsAdmin(env, "triggers", opt);
  assert.equal(dry.dry, true); assert.deepEqual(dry.trigger_totals.before, { cron: 5, after_consolidation: 8, other: 0 }); assert.deepEqual(dry.trigger_totals.after, dry.trigger_totals.before, "dry run: nothing changed"); assert.ok(!f.calls.some((c) => /PATCH|import/.test(c)));
  const real = await hsAdmin(env, "triggers", { ...opt, dry: false });
  assert.deepEqual(real.counts, { patched: 3 }); assert.deepEqual([real.trigger_totals.checked, real.trigger_totals.patched], [13, 8]); assert.deepEqual(real.trigger_totals.before, { cron: 5, after_consolidation: 8, other: 0 }); assert.deepEqual(real.trigger_totals.after, { cron: 13, after_consolidation: 0, other: 0 });
  assert.ok(!f.calls.some((c) => /\/import|mental-models\/[^/]+\/refresh/.test(c)), "no import and no refresh");
  assert.deepEqual(kinds(banks), { cron: 13, after_consolidation: 0, other: 0 }, "the empty bank was patched too");
  const after = await hsAdmin(env, "triggers", opt); assert.deepEqual(after.trigger_totals.before, { cron: 13, after_consolidation: 0, other: 0 }); assert.equal(after.trigger_totals.patched, 0);
  // the templates action runs the same step first, so its import never meets an old trigger
  for (const m of banks[`dev-${t1}-main`].models) m.trigger = { ...OLD }; f.calls.length = 0;
  const tpl = await hsAdmin(env, "templates", { ...opt, dry: false }); assert.equal(tpl.trigger_totals.patched, 5); assert.ok(f.calls.findIndex((c) => c.includes("PATCH")) < f.calls.findIndex((c) => c.includes("/import")));
  ok("admin: the triggers action counts before and after, patches empty banks too, dry run changes nothing; templates patches first");
}
