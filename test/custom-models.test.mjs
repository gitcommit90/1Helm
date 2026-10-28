// node --import ./test/stubs/register.mjs test/custom-models.test.mjs
// Custom Model Selection (src/custom-models.js): a per-account setting, off by default, that replaces the chat categories for that account only.
// D1 is node:sqlite with the real tenants columns (migrations 046 and 079). OpenRouter is faked at fetch. Checks:
// - the default: an existing account has it off, its routing is ours, and nothing is read from custom models;
// - turning it on starts from our General at the account's level (primary and two fallbacks), and the account's categories are kept when it is turned off;
// - the picker lists only chat models with a provider allowed at the account's level, for each of the three levels;
// - a save is validated on the server: models not allowed at the level, reasoning levels the model doesn't have, duplicate models, General's name,
//   duplicate names, half a max price;
// - a privacy change marks the account as needing new choices (every writer of the level goes through the same stored value), and the status names the models;
// - dispatch refuses before anything is sent while a model is not allowed, and nothing falls back to our models;
// - routing uses the account's chain, effort, max price and our General's max output when on, and our chain when off;
// - the request sorter is skipped with General alone, and is asked (with the account's titles) with more categories.
import assert from "node:assert/strict"; import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
import { test } from "node:test";
import { readCustom, saveCustom, statusOf, statusOfRow, customRouting, customView, pickerModels, problemsOf, validateCategories, CustomModelsRequired, allowedAt, defaultConfig } from "../src/ee/custom-models.js";
import { setPrivacy } from "../src/privacy.js";
import { dispatch } from "../src/ee/model-dispatch.js";
import { chooseTwo, routingQuestions, routeFromAnswers, policyRoute } from "../src/ee/route2.js";
import { accountRoute } from "../src/account.js";
import { withSettings, SEED, ID } from "./helpers/seed-settings.mjs";

const rec = (id, levels, efforts = ["none", "low", "high"]) => ({ id, source: "OR", kinds: ["chat", "chore"], name: `Name ${id.split("/")[1]}`, eligible: true, reasons: [], efforts, default_effort: efforts[1] || efforts[0], levels, hosts: ["acme"],
  terms: { zdr: levels.includes("zdr"), no_training: levels.includes("no_training") }, context_length: 100000, max_output: 8000, input_modalities: ["text"], pricing: { prompt: 1, completion: 2 }, json: true, tool_choice: ["auto", "none"] });
const ALL = ["unrestricted", "no_training", "zdr"];
const FAKE = { "acme/zdr-a": rec("acme/zdr-a", ALL), "acme/zdr-b": rec("acme/zdr-b", ALL), "acme/zdr-c": rec("acme/zdr-c", ALL), "acme/nt-only": rec("acme/nt-only", ["unrestricted", "no_training"]),
  "acme/open-only": rec("acme/open-only", ["unrestricted"]), "acme/open-two": rec("acme/open-two", ["unrestricted"]), "acme/open-three": rec("acme/open-three", ["unrestricted"]), "acme/plain": rec("acme/plain", ALL, ["default"]) };
const lookup = async (id) => FAKE[id] || null;

const d1 = new DatabaseSync(":memory:");
d1.exec("CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT, owner_user_id TEXT, updated_at INTEGER); INSERT INTO tenants VALUES ('t1','ck1','u1',0), ('t2','ck2','u2',0);");
d1.exec(readFileSync(new URL("../db/migrations/0038_046_ai_privacy.sql", import.meta.url), "utf8"));
d1.exec("CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER, ua TEXT, place TEXT)");
d1.exec(/CREATE TABLE IF NOT EXISTS email_changes[^;]*;/.exec(readFileSync(new URL("../db/migrations/0021_030_account.sql", import.meta.url), "utf8"))[0]); d1.exec(readFileSync(new URL("../db/migrations/0013_023_tenant_flags.sql", import.meta.url), "utf8"));
const migration = readFileSync(new URL("../db/migrations/0064_custom_models.sql", import.meta.url), "utf8");
d1.exec(migration); d1.exec(readFileSync(new URL("../db/migrations/0065_custom_models_own_key.sql", import.meta.url), "utf8"));
const DB = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }),
  run: async () => { const r = st.run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; } };
const level = (t, l) => setPrivacy({ DB }, t, l);
const ENV = withSettings({ ONEHELM_EE: "1hc", DB, OPENROUTER_API_KEY: "k", DYNAMIC_ROUTING: "on" });
const SETTINGS = ENV.MODEL_SETTINGS;
const entry = (model, effort = "low") => ({ model, effort });
const cats = (...rows) => rows.map(([id, title, chain, max_price = null]) => ({ id, title, chain, max_price }));
const GENERAL = (a = "acme/zdr-a", b = "acme/zdr-b", c = "acme/zdr-c") => ["general", "General", [entry(a), entry(b), entry("acme/zdr-c" === c ? c : c, "high")]];
const refuses = (p, re) => assert.rejects(p, (e) => { assert.equal(e.status, 400); assert.match(e.message, re); return true; });

test("the default: off for an existing account, nothing read, our routing", async () => {
  await level("t1", "zdr");
  const st = await readCustom(ENV, "t1");
  assert.deepEqual([st.on, st.config, st.level], [false, null, "zdr"]);
  assert.equal(await customRouting(ENV, "t1"), null);
  assert.deepEqual(statusOfRow({ ai_privacy: "zdr" }), { on: false, level: "zdr", needs_choice: false, problems: [] });
  assert.equal(await customRouting(ENV, undefined), null, "no tenant: ours");
  assert.equal(await customRouting({ ...ENV, DB: undefined }, "t1"), null, "no database: ours");
  // An older database without the columns reads as off.
  const old = new DatabaseSync(":memory:"); old.exec("CREATE TABLE tenants (id TEXT PRIMARY KEY, ai_privacy TEXT); INSERT INTO tenants VALUES ('t1','zdr')");
  const oldEnv = { DB: { prepare: (q) => ({ bind: () => ({ first: async () => old.prepare(q).get() }) }) } };
  assert.equal((await readCustom(oldEnv, "t1")).on, false);
});

test("turning it on starts from our General at the account's level, and the choices are kept when it is turned off", async () => {
  for (const lv of ALL) {
    await level("t1", lv); d1.exec("UPDATE tenants SET custom_models_on=0, custom_models=NULL WHERE id='t1'");
    const v = await saveCustom(ENV, "t1", { on: true }, { settings: SETTINGS });
    const general = SETTINGS.routing.categories.find((c) => c.id === "general");
    assert.equal(v.on, true); assert.equal(v.needs_choice, false);
    assert.equal(v.categories.length, 1, "exactly one category, General");
    assert.deepEqual(v.categories[0].chain, general.chains[lv].map((e) => ({ model: e.model, effort: e.effort })), `prefilled from our General at ${lv}`);
    assert.equal(v.categories[0].chain.length, 3);
  }
  await level("t1", "zdr"); d1.exec("UPDATE tenants SET custom_models_on=0, custom_models=NULL WHERE id='t1'");
  await saveCustom(ENV, "t1", { on: true }, { settings: SETTINGS });
  const saved = await saveCustom(ENV, "t1", { categories: cats(GENERAL(), ["c_research1", "Research", [entry("acme/zdr-b", "high"), entry("acme/zdr-a"), entry("acme/zdr-c")], { prompt: 2, completion: 8 }]) }, { settings: SETTINGS, lookup });
  assert.equal(saved.categories.length, 2);
  const off = await saveCustom(ENV, "t1", { on: false }, { settings: SETTINGS });
  assert.equal(off.on, false); assert.equal(off.categories.length, 2, "kept while off");
  assert.equal(await customRouting(ENV, "t1"), null, "off: ours again");
  const on = await saveCustom(ENV, "t1", { on: true }, { settings: SETTINGS });
  assert.equal(on.categories.length, 2, "back on: the same categories");
  assert.equal(on.needs_choice, false);
  await assert.rejects(saveCustom(ENV, "t2", { categories: cats(GENERAL()) }, { settings: SETTINGS, lookup }), /Turn on Custom Model Selection first/);
});

test("the picker lists only models with a provider allowed at the level", async () => {
  const settings = { catalog: { ...FAKE } };
  const ids = async (lv, q = "") => (await pickerModels(ENV, lv, { q, settings, search: async () => [] })).map((m) => m.id).sort();
  assert.deepEqual(await ids("zdr"), ["acme/plain", "acme/zdr-a", "acme/zdr-b", "acme/zdr-c"]);
  assert.deepEqual(await ids("no_training"), ["acme/nt-only", "acme/plain", "acme/zdr-a", "acme/zdr-b", "acme/zdr-c"]);
  assert.deepEqual(await ids("unrestricted"), Object.keys(FAKE).sort());
  assert.deepEqual(await ids("zdr", "plain"), ["acme/plain"], "typed words filter");
  const live = [rec("live/found-model", ["unrestricted", "no_training"]), { ...rec("live/unverified", ["unrestricted"]), unverified: true, hosts: [] }, { ...rec("live/blocked", ["zdr"]), eligible: false, reasons: ["x"] }];
  const searched = (await pickerModels(ENV, "no_training", { q: "live", settings, search: async () => live })).map((m) => m.id);
  assert.deepEqual(searched, ["live/found-model"], "a live search result needs to be verified, eligible and allowed at the level");
  assert.deepEqual((await pickerModels(ENV, "zdr", { q: "live", settings, search: async () => live })).map((m) => m.id), [], "not allowed at zdr");
  assert.deepEqual((await pickerModels(ENV, "zdr", { q: "", settings, search: async () => { throw new Error("no search for an empty box"); } })).length, 4);
  const card = (await pickerModels(ENV, "zdr", { q: "plain", settings, search: async () => [] }))[0]; assert.deepEqual(card.efforts, ["default"]); assert.equal(card.allowed, true);
  assert.equal(allowedAt(FAKE["acme/open-only"], "zdr"), false); assert.equal(allowedAt(FAKE["acme/open-only"], "unrestricted"), true);
});

test("a save is validated on the server", async () => {
  await level("t1", "zdr"); d1.exec("UPDATE tenants SET custom_models_on=0, custom_models=NULL WHERE id='t1'");
  await saveCustom(ENV, "t1", { on: true }, { settings: SETTINGS });
  const save = (rows, lk = lookup) => saveCustom(ENV, "t1", { categories: rows }, { settings: SETTINGS, lookup: lk });
  await refuses(save(cats(GENERAL("acme/open-only"))), /no Zero Data Retention provider/);
  await refuses(save(cats(["general", "General", [entry("acme/zdr-a", "xhigh"), entry("acme/zdr-b"), entry("acme/zdr-c")]])), /reasoning level "xhigh"/);
  await refuses(save(cats(["general", "General", [entry("acme/zdr-a"), entry("acme/zdr-a"), entry("acme/zdr-c")]])), /three different models/);
  await refuses(save(cats(["general", "General", [entry("acme/zdr-a"), entry("acme/zdr-b")]])), /first model and two fallbacks/);
  await refuses(save(cats(["general", "Everything", [entry("acme/zdr-a"), entry("acme/zdr-b"), entry("acme/zdr-c")]])), /General's name/);
  await refuses(save(cats(["c_abcdef1", "General", [entry("acme/zdr-a"), entry("acme/zdr-b"), entry("acme/zdr-c")]])), /General's name/);
  await refuses(save(cats(GENERAL(), ["c_research1", "research", [entry("acme/zdr-a"), entry("acme/zdr-b"), entry("acme/zdr-c")]], ["c_other111", "Research", [entry("acme/zdr-a"), entry("acme/zdr-b"), entry("acme/zdr-c")]])), /different name/);
  await refuses(save(cats(["c_research1", "Research", [entry("acme/zdr-a"), entry("acme/zdr-b"), entry("acme/zdr-c")]])), /General must be the first/);
  await refuses(save(cats(GENERAL(), ["bad id", "Research", [entry("acme/zdr-a"), entry("acme/zdr-b"), entry("acme/zdr-c")]])), /Invalid category ID/);
  await refuses(save(cats(GENERAL(), ["c_research1", "Research", [entry("acme/zdr-a"), entry("acme/zdr-b"), entry("acme/zdr-c")], { prompt: 1 }])), /max price needs both prices/);
  await refuses(save(cats(GENERAL(), ["c_research1", "Research", [entry("acme/zdr-a"), entry("acme/zdr-b"), entry("acme/zdr-c")], { prompt: -1, completion: 1 }])), /max price needs both prices/);
  await refuses(save(cats(GENERAL(), ["c_research1", " Research", [entry("acme/zdr-a"), entry("acme/zdr-b"), entry("acme/zdr-c")]])), /no spaces/);
  await refuses(save(cats(["general", "General", [entry("acme/zdr-a"), entry("acme/zdr-b"), { model: "acme/zdr-c", effort: "low", hosts: ["x"] }]])), /choose a model/);
  await refuses(save(cats(["general", "General", [entry("nope"), entry("acme/zdr-b"), entry("acme/zdr-c")]])), /choose a model/);
  await refuses(save(cats(["general", "General", [entry("acme/missing"), entry("acme/zdr-b"), entry("acme/zdr-c")]])), /no longer offered/);
  await refuses(save(cats(["general", "General", [entry("acme/zdr-a"), entry("acme/zdr-b"), entry("acme/zdr-c")]], ...Array.from({ length: 12 }, (_, i) => [`c_more${i}abc`, `More ${i}`, [entry("acme/zdr-a"), entry("acme/zdr-b"), entry("acme/zdr-c")]]))), /Save between 1 and 12/);
  await refuses(save(cats(["general", "General", [entry("acme/zdr-a"), entry("acme/zdr-b"), entry("acme/zdr-c")]]), async (id) => ({ ...FAKE[id], eligible: false, reasons: ["No working endpoint"] })), /can't be used: No working endpoint/);
  await assert.rejects(saveCustom(ENV, "t1", { on: "yes" }, { settings: SETTINGS }), /Choose on or off/);
  await assert.rejects(saveCustom(ENV, "t1", { on: true, extra: 1 }, { settings: SETTINGS }), /Nothing to change/);
  // Nothing refused was stored.
  assert.notEqual((await readCustom(ENV, "t1")).config.categories[0].chain[0].model, "acme/open-only");
  // A valid save keeps the facts of each model and the max price.
  const ok = await save(cats(GENERAL(), ["c_research1", "Research", [entry("acme/plain", "default"), entry("acme/zdr-a"), entry("acme/zdr-b")], { prompt: 0.5, completion: 3 }]));
  assert.deepEqual(ok.categories[1].max_price, { prompt: 0.5, completion: 3 }); assert.equal(ok.models["acme/plain"].allowed, true);
  const stored = (await readCustom(ENV, "t1")).config; assert.ok(stored.catalog["acme/plain"].hosts, "facts are stored with the account");
  // A tightened level is enforced by the same save path for the other levels.
  await level("t1", "no_training");
  await save(cats(["general", "General", [entry("acme/nt-only"), entry("acme/zdr-b"), entry("acme/zdr-c")]]));
  await refuses(save(cats(["general", "General", [entry("acme/open-only"), entry("acme/zdr-b"), entry("acme/zdr-c")]])), /no No Training provider/);
  await level("t1", "unrestricted");
  await save(cats(["general", "General", [entry("acme/open-only"), entry("acme/open-two"), entry("acme/open-three")]]));
});

test("a privacy change marks the account as needing new choices, and dispatch refuses before sending anything", async () => {
  await level("t1", "unrestricted"); d1.exec("UPDATE tenants SET custom_models_on=0, custom_models=NULL WHERE id='t1'");
  await saveCustom(ENV, "t1", { on: true }, { settings: SETTINGS });
  await saveCustom(ENV, "t1", { categories: cats(["general", "General", [entry("acme/open-only"), entry("acme/zdr-b"), entry("acme/zdr-c")]], ["c_research1", "Research", [entry("acme/zdr-a"), entry("acme/nt-only"), entry("acme/zdr-c")]]) }, { settings: SETTINGS, lookup });
  assert.equal((await customRouting(ENV, "t1")).level, "unrestricted");
  const calls = []; const realFetch = globalThis.fetch; globalThis.fetch = async (u, init) => { calls.push([String(u), init?.body ? JSON.parse(init.body) : null]); return new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }], model: "x", usage: {} }), { status: 200, headers: { "content-type": "application/json" } }); };
  try {
    const route = policyRoute((await customRouting(ENV, "t1")).env.MODEL_SETTINGS, "general", "unrestricted", "t", { dynamic: true });
    // No Training: only the Open-only model is a problem in General; Research's no-training model is fine.
    const r = await setPrivacy({ DB }, "t1", "no_training"); assert.equal(r.level, "no_training");
    let st = statusOf(await readCustom(ENV, "t1"));
    assert.equal(st.needs_choice, true);
    assert.deepEqual(st.problems.map((p) => [p.category, p.slot, p.model]), [["General", 0, "acme/open-only"]]);
    assert.match(st.problems[0].why, /No No Training provider/);
    // Zero Data Retention: Research's no-training model is a problem too.
    await setPrivacy({ DB }, "t1", "zdr");
    st = statusOf(await readCustom(ENV, "t1")); assert.deepEqual(st.problems.map((p) => p.model), ["acme/open-only", "acme/nt-only"]);
    assert.equal(customView(await readCustom(ENV, "t1")).needs_choice, true);
    await assert.rejects(customRouting(ENV, "t1"), (e) => { assert.ok(e instanceof CustomModelsRequired); assert.equal(e.code, "custom_models_required"); assert.equal(e.privacy, true);
      assert.match(e.message, /Zero Data Retention/); assert.match(e.message, /Name open-only \(General, first choice\)/); assert.match(e.message, /Name nt-only \(Research, second choice\)/); assert.match(e.message, /Settings, Advanced, Custom Model Selection/); return true; });
    // The main chat dispatch refuses, with a route built before the change (a running task), and nothing is sent anywhere.
    const before = calls.length;
    await assert.rejects(dispatch(ENV, "chat", { messages: [{ role: "user", content: "hi" }] }, { meta: { tenant: "t1" }, route, session: "s" }), (e) => e.code === "custom_models_required" && e.privacy === true);
    assert.equal(calls.length, before, "no request left the Worker, and our models were not tried");
    // Another account is not affected.
    await level("t2", "zdr");
    assert.equal(await customRouting(ENV, "t2"), null);
    // Choosing eligible models again lets work continue.
    const fixed = await saveCustom(ENV, "t1", { categories: cats(GENERAL(), ["c_research1", "Research", [entry("acme/zdr-a"), entry("acme/zdr-b"), entry("acme/zdr-c")]]) }, { settings: SETTINGS, lookup });
    assert.equal(fixed.needs_choice, false); assert.ok(await customRouting(ENV, "t1"));
    // Turning the setting off lifts the block whatever the saved models are.
    await saveCustom(ENV, "t1", { categories: cats(["general", "General", [entry("acme/zdr-a"), entry("acme/zdr-b"), entry("acme/zdr-c")]]) }, { settings: SETTINGS, lookup });
  } finally { globalThis.fetch = realFetch; }
});

test("routing: the account's chain, effort and max price when on, ours when off", async () => {
  await level("t1", "zdr"); d1.exec("UPDATE tenants SET custom_models_on=0, custom_models=NULL WHERE id='t1'");
  await saveCustom(ENV, "t1", { on: true }, { settings: SETTINGS });
  await saveCustom(ENV, "t1", { categories: cats(["general", "General", [entry("acme/zdr-a", "high"), entry("acme/zdr-b", "none"), entry("acme/zdr-c", "low")], { prompt: 0.25, completion: 1.5 }], ["c_research1", "Research", [entry("acme/zdr-b"), entry("acme/zdr-c"), entry("acme/zdr-a")]]) }, { settings: SETTINGS, lookup });
  const custom = await customRouting(ENV, "t1"), s = custom.env.MODEL_SETTINGS, general = SETTINGS.routing.categories[0];
  assert.deepEqual(s.routing.categories.map((c) => c.title), ["General", "Research"], "our categories are replaced, not added to");
  assert.deepEqual(s.routing.categories[0].chains.zdr, [{ model: "acme/zdr-a", effort: "high" }, { model: "acme/zdr-b", effort: "none" }, { model: "acme/zdr-c", effort: "low" }]);
  for (const k of ["max_output", "sort", "timeout_ms"]) assert.deepEqual(s.routing.categories[0][k], general[k] ?? null, `${k} comes from our General`);
  assert.equal(s.catalog["acme/zdr-a"].name, "Name zdr-a"); assert.ok(s.catalog[ID.LUNA], "our catalog stays for everything else");
  assert.equal(ENV.MODEL_SETTINGS.routing.categories.length, SETTINGS.routing.categories.length, "our saved settings are not changed");
  assert.equal(ENV.MODEL_SETTINGS.routing.custom, undefined);
  // The route
  const route = policyRoute(s, "general", "zdr", "t", { dynamic: true });
  assert.deepEqual(route.chain.map((e) => e.model), ["acme/zdr-a", "acme/zdr-b", "acme/zdr-c"]);
  const work = routeFromAnswers(custom.env, "x", { category: "c_research1" }, { level: "zdr" }).route;
  assert.equal(work.categoryTitle, "Research"); assert.deepEqual(work.workerChain.map((e) => e.model), ["acme/zdr-b", "acme/zdr-c", "acme/zdr-a"]);
  // On the wire: first model, its effort, the account's max price, our General's max output, sort and nothing from our chain.
  const calls = []; const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => { const b = JSON.parse(init.body); calls.push(b); return new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }], model: b.model, usage: {} }), { status: 200, headers: { "content-type": "application/json" } }); };
  try {
    await dispatch(ENV, "chat", { messages: [{ role: "user", content: "hi" }] }, { meta: { tenant: "t1" }, route, session: "s1" });
    const w = calls.at(-1);
    assert.equal(w.model, "acme/zdr-a"); assert.deepEqual(w.reasoning, { effort: "high" }); assert.deepEqual(w.provider.max_price, { prompt: 0.25, completion: 1.5 });
    assert.equal(w.provider.zdr, true); assert.equal(w.provider.data_collection, "deny");
    if (general.max_output) assert.equal(w.max_tokens, general.max_output);
    // Off: our General's chain answers the same kind of request.
    await saveCustom(ENV, "t1", { on: false }, { settings: SETTINGS });
    const ours = policyRoute(SETTINGS, "general", "zdr", "t", { dynamic: true });
    await dispatch(ENV, "chat", { messages: [{ role: "user", content: "hi" }] }, { meta: { tenant: "t1" }, route: ours, session: "s2" });
    assert.equal(calls.at(-1).model, general.chains.zdr[0].model);
    assert.notEqual(calls.at(-1).model, "acme/zdr-a");
  } finally { globalThis.fetch = realFetch; }
});

test("the request sorter is skipped with General alone, and asked with the account's titles when there are more categories", async () => {
  await level("t1", "zdr"); d1.exec("UPDATE tenants SET custom_models_on=0, custom_models=NULL WHERE id='t1'");
  await saveCustom(ENV, "t1", { on: true }, { settings: SETTINGS });
  const calls = []; const realFetch = globalThis.fetch; globalThis.fetch = async (u) => { calls.push(String(u)); return new Response(JSON.stringify({ error: "down" }), { status: 500 }); };
  try {
    const one = (await customRouting(ENV, "t1")).env;
    const a = await chooseTwo(one, { kind: "chat", text: "hello there", hist: [], level: "zdr" });
    assert.equal(calls.length, 0, "no request sorter call"); assert.equal(a.jev, null); assert.equal(a.route.category, "general");
    assert.deepEqual(a.route.chain.map((e) => e.model), SETTINGS.routing.categories[0].chains.zdr.map((e) => e.model));
    // A helper that is open may still need the sorter to say whom the message is for.
    await chooseTwo(one, { kind: "chat", text: "hello", hist: [], level: "zdr", openAgents: [{ id: 3, name: "n", task: "t" }] });
    assert.ok(calls.length > 0, "asked while a helper is open");
    calls.length = 0;
    await saveCustom(ENV, "t1", { categories: cats(GENERAL(), ["c_research1", "Research notes", [entry("acme/zdr-b"), entry("acme/zdr-c"), entry("acme/zdr-a")]]) }, { settings: SETTINGS, lookup });
    const two = (await customRouting(ENV, "t1")).env;
    assert.deepEqual(Object.keys(routingQuestions(two).category.criteria), ["General", "Research notes"], "the account's titles, not ours");
    const b = await chooseTwo(two, { kind: "chat", text: "look into this", hist: [], level: "zdr" });
    assert.ok(calls.length > 0, "the request sorter was asked"); assert.ok(b.jev);
    // Ours, when off: our titles are what it is asked.
    assert.ok(!Object.keys(routingQuestions(ENV).category.criteria).includes("Research notes"));
  } finally { globalThis.fetch = realFetch; }
});

test("the account routes: state, search, save, and the privacy answer", async () => {
  await level("t1", "zdr"); d1.exec("UPDATE tenants SET custom_models_on=0, custom_models=NULL WHERE id='t1'");
  const origin = "https://app.example.test", user = { id: "u1", email: "a@example.com" }, deps = { modelSettings: async () => ({ ...SETTINGS, catalog: { ...SETTINGS.catalog, ...FAKE } }), search: async () => [], lookup };
  const call = async (method, sub, body) => { const url = new URL(origin + "/w/ck1" + sub); sub = sub.split("?")[0]; const req = new Request(url, { method, headers: { origin, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const res = await accountRoute(req, ENV, d1.prepare("SELECT * FROM tenants WHERE id=?").get("t1"), user, url, sub, deps); return { status: res.status, body: await res.json() }; };
  let r = await call("GET", "/api/account/custom-models"); assert.equal(r.status, 200); assert.deepEqual([r.body.on, r.body.needs_choice, r.body.categories], [false, false, []]);
  assert.equal((await call("GET", "/api/account")).body.custom_models.on, false);
  r = await call("POST", "/api/account/custom-models", { on: true }); assert.equal(r.status, 200); assert.equal(r.body.categories.length, 1);
  r = await call("GET", "/api/account/custom-models/catalog?q=zdr"); assert.equal(r.status, 200); assert.deepEqual(r.body.models.map((m) => m.id).sort(), ["acme/zdr-a", "acme/zdr-b", "acme/zdr-c"]); assert.equal(r.body.level, "zdr");
  r = await call("POST", "/api/account/custom-models", { categories: cats(["general", "General", [entry("acme/open-only"), entry("acme/zdr-b"), entry("acme/zdr-c")]]) });
  assert.equal(r.status, 400); assert.match(r.body.error, /Zero Data Retention/);
  const wrong = await accountRoute(new Request(origin + "/w/ck1/api/account/custom-models", { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify({ on: false }) }), ENV, d1.prepare("SELECT * FROM tenants WHERE id=?").get("t1"), user, new URL(origin + "/w/ck1/api/account/custom-models"), "/api/account/custom-models", deps);
  assert.equal(wrong.status, 403, "same origin only"); assert.equal((await readCustom(ENV, "t1")).on, true);
  // The privacy answer says whether new choices are needed. Put a model that only unrestricted allows in General first.
  await level("t1", "unrestricted");
  await saveCustom(ENV, "t1", { categories: cats(["general", "General", [entry("acme/open-only"), entry("acme/open-two"), entry("acme/open-three")]]) }, { settings: deps.modelSettings ? await deps.modelSettings() : SETTINGS, lookup });
  r = await call("POST", "/api/account/privacy", { level: "zdr" }); assert.equal(r.status, 200);
  assert.deepEqual([r.body.custom_models.on, r.body.custom_models.needs_choice, r.body.custom_models.problems.length], [true, true, 3]);
  assert.equal((await call("GET", "/api/account")).body.custom_models.needs_choice, true);
});

test("the migration is additive and defaults to off", () => {
  assert.match(migration, /ADD COLUMN custom_models_on INTEGER NOT NULL DEFAULT 0/); assert.match(migration, /ADD COLUMN custom_models TEXT/);
  assert.ok(!/DROP|DELETE|UPDATE|RENAME/i.test(migration.replace(/--.*$/gm, "")), "no destructive statement");
});

test("a task starts from the account's own models, with no model catalog lookup, and a blocked account starts nothing", async () => {
  const { ensureTaskRuntime, bindBackgroundRuntime } = await import("../src/ee/task-profile.js");
  await level("t1", "zdr"); d1.exec("UPDATE tenants SET custom_models_on=0, custom_models=NULL WHERE id='t1'");
  await saveCustom(ENV, "t1", { on: true }, { settings: SETTINGS });
  await saveCustom(ENV, "t1", { categories: cats(["general", "General", [entry("acme/zdr-a", "high"), entry("acme/zdr-b"), entry("acme/zdr-c")]], ["c_research1", "Research", [entry("acme/zdr-c"), entry("acme/zdr-b", "high"), entry("acme/zdr-a")]]) }, { settings: SETTINGS, lookup });
  const kv = new Map([["tenant", "t1"], ["channel", "main"]]), fetches = [];
  const R = { env: ENV, sql: { exec: () => ({ toArray: () => [], one: () => undefined }) }, get: (k) => kv.get(k), put: (k, v) => kv.set(k, v), todoRow: () => ({ items: [] }), helperNote: () => "", compactHistory: () => [] };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => { fetches.push(String(u)); if (/systemone/.test(String(u))) return Response.json({ answers: { is_task: { noul: 1 }, category: { choice: "Research" }, unmet: { noul: 0 }, steer: { choice: "none" } }, usage: { cost: 0 } });
    throw new Error(`unexpected request ${u}`); };
  try {
    const p = await ensureTaskRuntime(R, { session: "task1" }, { kind: "chat", text: "look into it", hist: [], stats: { charge: 0 } });
    assert.equal(p.requestedModel, "acme/zdr-a"); assert.equal(p.effort, "high"); assert.deepEqual(p.poolChain.map((x) => x.requestedModel), ["acme/zdr-a", "acme/zdr-b", "acme/zdr-c"]);
    assert.equal(p.dispatch.category, "c_research1"); assert.equal(p.dispatch.workerProfile.requestedModel, "acme/zdr-c"); assert.equal(p.dispatch.workerProfile.category, "c_research1");
    assert.deepEqual(fetches.filter((u) => !/systemone/.test(u)), [], "model facts came from the account's saved facts, not from OpenRouter");
    // General alone: no sorter call at all.
    await saveCustom(ENV, "t1", { categories: cats(["general", "General", [entry("acme/zdr-b"), entry("acme/zdr-a"), entry("acme/zdr-c")]]) }, { settings: SETTINGS, lookup });
    fetches.length = 0;
    const q = await ensureTaskRuntime(R, { session: "task2" }, { kind: "chat", text: "hello", hist: [], stats: { charge: 0 } });
    assert.equal(fetches.length, 0); assert.equal(q.requestedModel, "acme/zdr-b"); assert.equal(q.dispatch.category, "general");
    // A scheduled run or follow-up starts from the account's General.
    const bg = { kind: "workflow", turn: 5 };
    assert.equal(await bindBackgroundRuntime(R, bg, { workflowId: "w1" }), true);
    assert.equal(bg.taskProfile.requestedModel, "acme/zdr-b"); assert.equal(bg.taskProfile.backgroundGeneral, true);
    // The level tightens past one of the models: every way into a chat call stops with the plain message.
    await level("t1", "unrestricted"); await saveCustom(ENV, "t1", { categories: cats(["general", "General", [entry("acme/open-only"), entry("acme/zdr-a"), entry("acme/zdr-c")]]) }, { settings: SETTINGS, lookup });
    await level("t1", "zdr");
    const blocked = (e) => e.code === "custom_models_required" && /Name open-only \(General, first choice\)/.test(e.message);
    await assert.rejects(ensureTaskRuntime(R, { session: "task3" }, { kind: "chat", text: "hello", hist: [], stats: { charge: 0 } }), blocked);
    await assert.rejects(bindBackgroundRuntime(R, { kind: "followup", turn: 6 }, { workflowId: "w2" }), blocked);
    // Off: our models answer again, and nothing was lost.
    await saveCustom(ENV, "t1", { on: false }, { settings: SETTINGS });
    assert.equal(await customRouting(ENV, "t1"), null);
  } finally { globalThis.fetch = realFetch; }
});

test("an account answered by its own AI key: own_key, no pause, on every route and for dispatch; a full plan still needs new choices", async () => {
  const { byokEnv, answersOnOwnKey } = await import("../src/byok.js");
  d1.exec("CREATE TABLE IF NOT EXISTS byok (tenant_id TEXT PRIMARY KEY, mode TEXT, base_url TEXT)"); d1.exec("INSERT OR REPLACE INTO byok VALUES ('t1', NULL, 'https://llm.example/v1')");
  await level("t1", "unrestricted"); d1.exec("UPDATE tenants SET custom_models_on=0, custom_models=NULL WHERE id='t1'");
  await saveCustom(ENV, "t1", { on: true }, { settings: SETTINGS });
  await saveCustom(ENV, "t1", { categories: cats(["general", "General", [entry("acme/open-only"), entry("acme/open-two"), entry("acme/open-three")]]) }, { settings: SETTINGS, lookup });
  await level("t1", "zdr");   // every model is now ruled out
  const origin = "https://app.example.test", user = { id: "u1", email: "a@example.com" }, deps = { modelSettings: async () => ({ ...SETTINGS, catalog: { ...SETTINGS.catalog, ...FAKE } }), search: async () => [], lookup };
  const row = (plan) => ({ ...d1.prepare("SELECT * FROM tenants WHERE id=?").get("t1"), plan });
  const call = async (plan, env, method, sub, body) => { const url = new URL(origin + "/w/ck1" + sub); sub = sub.split("?")[0];
    const res = await accountRoute(new Request(url, { method, headers: { origin, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }), env, row(plan), user, url, sub, deps); return res.json(); };
  // The byok plan: every route says own_key and nothing is paused. An own key has its own setting (byok-custom.js, migration 080), apart from the one for our models.
  const own = { own_key: true, needs_choice: false, problems: [] };
  const pick = (c) => ({ own_key: c.own_key, needs_choice: c.needs_choice, problems: c.problems });
  assert.equal(await answersOnOwnKey(ENV, { id: "t1", plan: "byok" }), true);
  assert.deepEqual(pick(statusOfRow(row("byok"), "plain")), own);
  assert.deepEqual(pick((await call("byok", ENV, "GET", "/api/account")).custom_models), own);
  assert.deepEqual(pick(await call("byok", ENV, "GET", "/api/account/custom-models")), own);
  assert.deepEqual(pick((await call("byok", ENV, "POST", "/api/account/privacy", { level: "zdr" })).custom_models), own);
  assert.equal((await call("byok", ENV, "GET", "/api/account/custom-models")).on, false, "the setting for our models is not the one for the own key");
  // Chat goes to the key: no CustomModelsRequired, and no call to our models.
  const cfg = Object.defineProperty({ base: "https://llm.example/v1", host: "llm.example", model: "own-main", fast: "own-main", last4: "1234" }, "key", { value: "sk-test", enumerable: false });
  const calls = []; const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => { calls.push(String(u)); return Response.json({ choices: [{ message: { content: "hi" } }], model: "own-main", usage: {} }); };
  try {
    const keyEnv = byokEnv(ENV, cfg);
    assert.equal(await customRouting(keyEnv, "t1"), null);
    const res = await dispatch(keyEnv, "chat", { messages: [{ role: "user", content: "hi" }] }, { meta: { tenant: "t1" }, session: "s" });
    assert.equal(res.status, 200); assert.deepEqual(calls, ["https://llm.example/v1/chat/completions"]);
  } finally { globalThis.fetch = realFetch; }
  // The same account on a full plan with no backup key is paused, as before.
  assert.equal(await answersOnOwnKey(ENV, { id: "t1", plan: "plus" }), false);
  assert.equal((await call("plus", ENV, "GET", "/api/account")).custom_models.needs_choice, true);
  const full = await call("plus", ENV, "GET", "/api/account/custom-models"); assert.equal(full.needs_choice, true); assert.equal(full.own_key, undefined);
  assert.equal((await call("plus", ENV, "POST", "/api/account/privacy", { level: "zdr" })).custom_models.needs_choice, true);
  await assert.rejects(customRouting(ENV, "t1"), (e) => e instanceof CustomModelsRequired);
  // A full plan with a backup key: own_key only while the Ledger's episode is active.
  d1.exec("INSERT OR REPLACE INTO byok VALUES ('t1','fallback','https://llm.example/v1')");
  let active = false; const fbEnv = { ...ENV, LEDGER: { idFromName: (n) => n, get: () => ({ byokFbState: async () => ({ active }) }) } };
  assert.equal((await call("plus", fbEnv, "GET", "/api/account/custom-models")).needs_choice, true, "credits left: our models answer, so the pause is real");
  active = true;
  assert.deepEqual(pick(await call("plus", fbEnv, "GET", "/api/account/custom-models")), own);
  assert.deepEqual(pick((await call("plus", fbEnv, "GET", "/api/account")).custom_models), own);
  assert.deepEqual(pick((await call("plus", fbEnv, "POST", "/api/account/privacy", { level: "zdr" })).custom_models), own);
  d1.exec("UPDATE byok SET mode='switch' WHERE tenant_id='t1'");
  assert.equal(await answersOnOwnKey(fbEnv, { id: "t1", plan: "plus" }), false, "a scheduled switch is not the key yet");
  d1.exec("DROP TABLE byok");
  assert.equal(await answersOnOwnKey(fbEnv, { id: "t1", plan: "plus" }), false, "no byok table: ours");
});
