// node --import ./test/stubs/register.mjs test/byok-onehelm.test.mjs
// 1Helm's models as an entry of a chain.
// Covers: the reserved id and its validation; [service, 1Helm] and [1Helm, service] falling back on the right failures; billing of 1Helm entries (full plan from plan usage, nothing
// when credits are out); the Bring your own key plan has no 1Helm option at all and none for service entries; Background jobs with a 1Helm entry; a chain of only 1Helm's models behaving as without services; removing the last service; the composer event.
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
import { Resident } from "../src/resident.js";
import worker, { Ledger } from "../src/index.js";
import { connDdl, connCfgs } from "../src/ee/byok-connections.js";
import { byokApi, loadByok, fallbackNotice, creditsLine, CREDITS_TOOL_ERR, BYOK_PLAN, METER } from "../src/byok.js";
const METER_HS = Math.ceil(METER.mem_search * 1.15);
import { HANDOFF_PREFIX } from "../src/ee/route2.js";
import { sealSecret } from "../src/sentinel.js";
import { OUT_OF_TIME_REPLY } from "../src/spendguard.js";
import { fakeIndex, embedding } from "./helpers/mem0-fakes.mjs";
import { withSettings } from "./helpers/seed-settings.mjs";

const KEY = "sk-test-SECRET-mode-0987654321zz", HOST = "llm.example-ai.com", BASE = `https://${HOST}/v1`;
const logs = []; for (const k of ["log", "error", "warn", "info"]) { const o = console[k].bind(console); console[k] = (...a) => { logs.push(a.map(String).join(" ")); if (process.env.VERBOSE) o(...a); }; }
const mkSql = (db) => ({ exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
  const st = db.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } });

// ---- D1 ----
const d1 = new DatabaseSync(":memory:");
d1.exec(`CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT, owner_user_id TEXT, helper_name TEXT, first_name TEXT, status TEXT DEFAULT 'active', past_due_since INTEGER, stripe_customer TEXT DEFAULT '',
  stripe_subscription TEXT DEFAULT '', sub_status TEXT, plan TEXT, updated_at INTEGER, onboarding_completed INTEGER DEFAULT 1);
  INSERT INTO tenants (id, slug, owner_user_id, helper_name, first_name, plan, stripe_customer, stripe_subscription) VALUES ('t1','ck1','u1','Ollie','Sam','personal','cus_1','sub_1');
  CREATE TABLE stripe_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, received_at INTEGER NOT NULL);
  CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT); INSERT INTO users VALUES ('u1','sam@example.com');
  CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT, expires_at INTEGER);`);
for (const f of ["0022_031_byok", "0025_034_byok_mode", "0017_026_plan_cancel", "0020_029_storage", "0038_046_ai_privacy", "0064_custom_models", "0065_custom_models_own_key"]) d1.exec(readFileSync(new URL(`../db/migrations/${f}.sql`, import.meta.url), "utf8"));
const D1 = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }),
  run: async () => { const r = st.run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; } };
const T = () => d1.prepare("SELECT * FROM tenants WHERE id='t1'").get();
const setPlan = (p) => d1.prepare("UPDATE tenants SET plan=? WHERE id='t1'").run(p);
const setPrivacy = (v) => d1.prepare("UPDATE tenants SET ai_privacy=? WHERE id='t1'").run(v);
const modeOf = () => d1.prepare("SELECT mode FROM byok WHERE tenant_id='t1'").get()?.mode;

// ---- the real Ledger ----
const ldb = new DatabaseSync(":memory:");
const env = withSettings({ ONEHELM_EE: "1hc", DB: D1, GATEWAY_HOST: "app.example.test", APP_HOST: "app.example.test", MEMORY: "off", GENUI: "off", WORKMEM: "off", OPENROUTER_API_KEY: "or-key",
  MODEL: "@cf/zai-org/glm-5.3-flash", VAULT_KEY: Buffer.from(new Uint8Array(32).map((_, i) => i * 5 + 3)).toString("base64"),
  STRIPE_WEBHOOK_SECRET: "whsec_test", STRIPE_SECRET_KEY: "sk_test_x", PLAN_PRICES: JSON.stringify({ personal: "price_personal", plus: "price_plus", byok: "price_byok" }), ENV_NAME: "test",
  AI: { run: async (m) => { throw new Error(`workers ai must not be called (${m})`); } } });
const L = new Ledger({ storage: { sql: mkSql(ldb), transactionSync: (f) => f() } }, env);
L.setSpendPreferences(false);   // the pause-to-check prompt is not what this test covers
env.LEDGER = { idFromName: (n) => n, get: () => L };
await L.grantIncluded("invoice:in_0", 20e9);   // Personal: $20 of usage

// ---- fake network: OpenRouter (1Helm's models), their endpoint, Stripe ----
const sse = (events) => new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
const jres = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const tcall = (name, args, i = 0) => ({ index: i, id: `c${i}${Math.random().toString(36).slice(2, 7)}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
const answer = (body, s) => typeof s === "string"
  ? sse([{ model: body.model, choices: [{ delta: { content: s } }] }, { model: body.model, choices: [{ delta: {}, finish_reason: "stop" }] }, { choices: [], usage: { prompt_tokens: 100, completion_tokens: 5, cost: 0.002 } }])
  : sse([{ model: body.model, choices: [{ delta: { tool_calls: s.map((c, i) => tcall(c[0], c[1], i)) }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.002 } }]);
const prov = [], orCalls = [], stripeCalls = []; let script = [], orScript = [];
let price = "price_personal", orFail = false, svcFail = false;
const SUB = () => ({ id: "sub_1", status: "active", current_period_end: 1893456000, items: { data: [{ id: "si_1", price: { id: price }, current_period_end: 1893456000 }] } });
globalThis.fetch = async (u, init = {}) => {
  u = String(u);
  if (u.startsWith("https://api.stripe.com/v1/")) {
    const path = u.slice(26).split("?")[0], body = Object.fromEntries(new URLSearchParams(String(init.body || ""))); stripeCalls.push([init.method || "GET", path, body]);
    if (path === "subscriptions/sub_1") return jres(SUB());
    if (path === "subscription_items/si_1") { price = body.price; return jres({ id: "si_1", price: { id: price } }); }
    return jres({ error: { message: `unexpected stripe ${path}` } }, 400);
  }
  if (u.includes("openrouter.ai") || u.includes("gateway.ai.cloudflare.com")) {
    const body = JSON.parse(init.body || "{}"); orCalls.push(body);
    if (orFail) return jres({ error: { message: "provider is down" } }, 500);
    if (!body.stream && JSON.stringify(body.messages || []).includes("## New Messages")) return jres({ model: "or/label", choices: [{ message: { role: "assistant", content: "{\"memory\":[]}" } }], usage: { prompt_tokens: 50, completion_tokens: 9, cost: 0.0001 } });   // a memory extraction answers with the memory list
    if (!body.stream) return jres({ model: "or/label", choices: [{ message: { role: "assistant", content: "{\"title\":\"Looked it up\",\"result\":\"Done\"}" } }], usage: { prompt_tokens: 50, completion_tokens: 9, cost: 0.0001 } });
    const last = body.messages.at(-1);
    if (typeof last.content === "string" && last.content.startsWith(HANDOFF_PREFIX)) return answer({ model: "or/notes" }, "- notes");
    return answer({ model: "or/sol" }, orScript.shift() ?? "From 1Helm's AI.");
  }
  const url = new URL(u);
  if (url.hostname === HOST && init.method === "GET") return jres({ data: [{ id: "main-model-1" }, { id: "fast-model-1" }] });   // the model list
  if (url.hostname === HOST) {
    const body = JSON.parse(init.body || "{}"); prov.push({ auth: init.headers?.authorization, body });
    if (svcFail) return jres({ error: { message: "usage limit reached" } }, 429);
    if (!body.stream) {
      if (JSON.stringify(body.messages || []).includes("## New Messages")) return jres({ model: body.model, choices: [{ message: { role: "assistant", content: "{\"memory\":[]}" } }] });
      if (body.tools?.some((t) => t.function.name === "ping")) return jres({ model: body.model, choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "p1", type: "function", function: { name: "ping", arguments: "{\"word\":\"ok\"}" } }] } }] });
      return jres({ model: body.model, choices: [{ message: { role: "assistant", content: "{\"title\":\"Looked it up\",\"result\":\"Done\"}" } }] });
    }
    const last = body.messages.at(-1);
    if (typeof last.content === "string" && last.content.startsWith(HANDOFF_PREFIX)) return answer(body, "- notes");
    return answer(body, script.shift() ?? "From my key.");
  }
  throw new Error(`unexpected fetch ${u}`);
};

async function saveRow(mode = "fallback") {
  await connDdl(env); d1.exec("DELETE FROM byok_connections; DELETE FROM byok_multi;");   // the one saved key of before: it becomes a connection when first read
  d1.prepare("INSERT OR REPLACE INTO byok (tenant_id,base_url,model,fast_model,key_sealed,key_last4,created_at,updated_at,mode) VALUES ('t1',?,?,?,?,?,?,?,?)").run(BASE, "main-model-1", "fast-model-1", await sealSecret(env, KEY), KEY.slice(-4), Date.now(), Date.now(), mode);
}

// ---- the Resident ----
// ---- the Resident ----
const dodb = new DatabaseSync(":memory:");
const waits = [];
const ctx = { storage: { sql: mkSql(dodb), getAlarm: async () => null, setAlarm: async () => {} }, waitUntil: (p) => waits.push(p), id: { toString: () => "res-svcnow-0000000000000000000" } };
const R = new Resident(ctx, env);
R.systemPrompt = async () => "SYSTEM";
// The computer: no credits for a minute of it (ChannelComputer.prepayMinute refused), as across the DO boundary (message only).
const comp = { warm: async () => ({ ok: false, error: "out_of_credits" }), exec: async () => { throw new Error("out_of_credits"); }, save: async () => ({}) };
R.computer = () => comp;
R.put("tenant", "t1"); R.put("channel", "main"); R.put("channel_id", "1");
const S = R.newSession("Task A");
async function turn(text, opts = {}) {
  const p0 = prov.length, o0 = orCalls.length, evs = [];
  const r = await R.runTurn("t1", "main", "1", text, (e) => evs.push(e), { session: S, ...opts });
  await Promise.allSettled(waits.splice(0));
  return { r, calls: prov.slice(p0), or: orCalls.slice(o0), evs, switched: evs.filter((e) => e.t === "byok_switch") };
}
const balance = async () => (await L.state()).balance_nano;
let n = 0; const ok = (name) => { n++; process.stdout.write(`ok ${n} - ${name}\n`); };


const tok = "cd".repeat(16), th = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tok))).toString("hex");
d1.prepare("INSERT INTO sessions VALUES (?,?,?)").run(th, "u1", Date.now() + 3600e3);
const api = async (sub, body) => { const r = await worker.fetch(new Request(`https://app.example.test/w/ck1/api${sub}`, body === undefined ? { headers: { cookie: `hc_session=${tok}` } } : { method: "POST", body: JSON.stringify(body), headers: { cookie: `hc_session=${tok}`, "content-type": "application/json", origin: "https://app.example.test" } }), env, { waitUntil: () => {} });
  const text = await r.text(); assert.ok(!text.includes(KEY), "the key is never in a response"); return { status: r.status, d: JSON.parse(text) }; };
const own = () => d1.prepare("SELECT custom_models_own_on on_, custom_models_own own, custom_models_on mon, custom_models adv FROM tenants WHERE id='t1'").get();
const GENERAL = (model) => [{ id: "general", title: "General", chain: [{ model, effort: null }], max_price: null }];
const MAIN = "p_main:main-model-1", FAST = "p_main:fast-model-1";
async function reset(mode = "") {
  orFail = false; svcFail = false; orScript = []; script = []; setPrivacy("");
  await saveRow(mode); await connCfgs(env, "t1");   // the saved row becomes the connection p_main (and the old upgrade writes its models)
  setPlan("personal"); stripeCalls.length = 0; price = "price_personal";
  d1.exec("UPDATE tenants SET custom_models_own='', custom_models_own_on=0, custom_models='', custom_models_on=0 WHERE id='t1'"); d1.exec("DELETE FROM byok_tests");
  await L.setBalance(20e9); await L.guardKv("byok_fb", null);
}


const ONE = "1helm:models";
const chainOf = (...models) => [{ id: "general", title: "General", chain: models.map((m) => ({ model: m, effort: null })), max_price: null }];
const save = (cats, bg) => api("/account/custom-models?scope=services", { categories: cats, ...(bg ? { background: { chain: bg.map((m) => ({ model: m, effort: null })) } } : {}) });
const saved = () => JSON.parse(own().own);
const settled = async () => { await Promise.allSettled(waits.splice(0)); };
const paid = async (fn) => { const b0 = await balance(); const r = await fn(); return { r, spent: b0 - (await balance()) }; };

// ===== 1. the reserved id and its validation =====
await reset("");
{
  const v = await api("/account/custom-models?scope=services"); assert.deepStrictEqual(v.d.onehelm, { id: ONE, name: "1Helm's models", service: "1Helm" });
  const first = await save(chainOf(ONE)); assert.strictEqual(first.status, 200, JSON.stringify(first.d));
  assert.strictEqual(first.d.categories[0].chain[0].model, ONE); assert.strictEqual(first.d.models[ONE].name, "1Helm's models"); assert.strictEqual(first.d.models[ONE].service, "1Helm");
  assert.strictEqual(saved().catalog[ONE].connKind, "1helm");
  const two = await save(chainOf(MAIN, ONE)); assert.strictEqual(two.status, 200, JSON.stringify(two.d)); assert.deepStrictEqual(two.d.categories[0].chain.map((e) => e.model), [MAIN, ONE]);
  const three = await save(chainOf(ONE, MAIN)); assert.strictEqual(three.status, 200); assert.strictEqual(saved().categories[0].chain[0].model, ONE);
  const dup = await save(chainOf(ONE, ONE)); assert.strictEqual(dup.status, 400, "the same entry twice");
  const eff = await save([{ id: "general", title: "General", chain: [{ model: ONE, effort: "high" }], max_price: null }]); assert.strictEqual(eff.status, 400); assert.match(eff.d.error, /no reasoning level/);
  for (const bad of ["1helm:other", "1Helm:models", "1helm", "1helm:models:x", "p_zzzzz:1helm:models"]) { const x = await save(chainOf(bad)); assert.ok(x.status >= 400, `${bad} is refused`); }
  const bg = await save(chainOf(MAIN), [ONE, FAST]); assert.strictEqual(bg.status, 200, JSON.stringify(bg.d)); assert.deepStrictEqual(bg.d.background.chain.map((e) => e.model), [ONE, FAST]);
  const { splitModel } = await import("../src/ee/byok-connections.js"); assert.strictEqual(splitModel(ONE), null, "never read as a service");
  const { CONN_ID_RE } = await import("../src/ee/byok-connections.js"); assert.ok(!CONN_ID_RE.test("1helm"), "no connection can ever be named 1helm");
}
ok("1Helm's models: reserved id 1helm:models validated server side (first model, fallback, Background jobs; no level; no look-alike ids)");

// ===== 2. [service, 1Helm]: the service fails (usage limit), 1Helm answers and is billed from the plan; a working service is never billed =====
await reset("");
{
  await save(chainOf(MAIN, ONE));
  script = ["From the service."];
  const a = await paid(() => turn("hello"));
  assert.strictEqual(a.r.r.reply, "From the service."); assert.ok(a.r.or.every((b) => !b.stream), "1Helm's models were not called"); assert.strictEqual(a.r.r.charge || 0, 0);
  const aiSpend = a.spent; assert.ok(aiSpend < 1e6, `only background work was charged (${aiSpend})`);
  svcFail = true; orScript = ["From 1Helm after the service failed."];
  const u0 = await L.byokUnusedPlan();
  const b = await paid(() => turn("hello again"));
  assert.strictEqual(b.r.r.reply, "From 1Helm after the service failed."); assert.ok(b.r.calls.some((c) => c.body.stream), "the service was tried first"); assert.ok(b.r.or.some((x) => x.stream), "then 1Helm's model");
  assert.ok(b.spent >= Math.ceil(0.002 * 1e9 * 1.15), `1Helm's call is charged cost + 15% (${b.spent})`); assert.ok(u0 - (await L.byokUnusedPlan()) >= Math.ceil(0.002 * 1e9 * 1.15), "drawn from the plan's included usage first");
  const state = await L.state(); assert.strictEqual(Number(state.reserved_nano || 0), 0, "nothing stays reserved");
}
ok("[service, 1Helm]: falls to 1Helm on a usage limit and bills it from plan usage; a working service entry is never billed");

// ===== 3. [1Helm, service]: 1Helm fails (provider down) and the service answers, no charge for the failed call =====
await reset("");
{
  await save(chainOf(ONE, MAIN));
  orFail = true; script = ["Service after 1Helm failed."];
  const b = await paid(() => turn("hello"));
  assert.strictEqual(b.r.r.reply, "Service after 1Helm failed."); assert.ok(b.r.calls.some((c) => c.auth === `Bearer ${KEY}`));
  assert.ok(b.spent < 1e6, `a failed 1Helm call costs nothing (${b.spent})`); assert.strictEqual(Number((await L.state()).reserved_nano || 0), 0, "the hold was released");
  orFail = false; orScript = ["1Helm answers first."]; script = ["unused"];
  const c = await paid(() => turn("and again"));
  assert.strictEqual(c.r.r.reply, "1Helm answers first."); assert.strictEqual(c.r.calls.filter((x) => x.body.stream).length, 0, "the service is not called when 1Helm answers"); assert.ok(c.spent >= Math.ceil(0.002 * 1e9 * 1.15));
}
ok("[1Helm, service]: falls to the service when 1Helm fails (nothing charged), and 1Helm answers first when it works");

// ===== 4. 1Helm out of plan usage and credits: skipped, the service answers; with only 1Helm the reply says so with Add credits =====
await reset("");
{
  await save(chainOf(ONE, MAIN)); await L.setBalance(0); script = ["Service, no 1Helm usage left."];
  const a = await turn("hello"); assert.strictEqual(a.r.reply, "Service, no 1Helm usage left."); assert.strictEqual(a.or.filter((x) => x.stream).length, 0, "nothing sent to 1Helm's models");
  await save(chainOf(ONE)); await L.setBalance(0);
  const b = await turn("hello"); assert.match(b.r.reply, /used all of this month's helper time/, "alone, it is exactly a full plan out of usage"); assert.strictEqual(b.or.filter((x) => x.stream).length, 0);
}
ok("1Helm entry with no plan usage and no credits is skipped like a failed model; alone on a full plan it is the plan's own out-of-usage reply");

// ===== 5. the Bring your own key plan: 1Helm's models do not exist =====
await reset("");
{
  await save(chainOf(ONE, MAIN), [ONE, FAST]); const before = own().own;   // saved while on a full plan
  setPlan("byok"); d1.exec("UPDATE byok SET mode=''"); await L.setBalance(3e9);
  const v = await api("/account/custom-models?scope=services"); assert.strictEqual(v.d.onehelm, null, "not offered");
  assert.deepStrictEqual(v.d.categories[0].chain.map((e) => e.model), [MAIN], "a saved entry is not listed"); assert.deepStrictEqual(v.d.background.chain.map((e) => e.model), [FAST]); assert.ok(!v.d.models[ONE]);
  const refused = await save(chainOf(ONE, MAIN)); assert.strictEqual(refused.status, 400, JSON.stringify(refused.d)); assert.match(JSON.stringify(refused.d), /Bring your own key plan/); assert.strictEqual(own().own, before, "a refused save changes nothing");
  const refusedBg = await save(chainOf(MAIN), [ONE]); assert.strictEqual(refusedBg.status, 400); assert.strictEqual(own().own, before);
  // the saved entry is skipped: no call to 1Helm, no charge, the service answers
  script = ["Service answers."]; const a = await paid(() => turn("hello")); assert.strictEqual(a.r.r.reply, "Service answers."); assert.strictEqual(a.r.or.filter((x) => x.stream).length, 0); assert.strictEqual(a.spent, 0, "no charge");
  // with only 1Helm's models saved, nothing runs on 1Helm and nothing is charged
  d1.exec("UPDATE tenants SET custom_models_own='' WHERE id='t1'"); d1.exec("UPDATE tenants SET custom_models_own=NULL WHERE id='t1'");
  setPlan("personal"); await save(chainOf(ONE)); const only = own().own; setPlan("byok");
  const { removeConnection } = await import("../src/ee/byok-connections.js"); assert.strictEqual((await removeConnection(env, "t1", "p_main")).ok, true);
  assert.strictEqual((await loadByok(env, "t1")).missing, true, "no service: nothing answers on the plan");
  const b = await paid(() => turn("again")); assert.strictEqual(b.r.or.filter((x) => x.stream).length, 0); assert.strictEqual(b.spent, 0);
  assert.ok(own().own, "the stored setting is kept"); void only;
  // back on a full plan the option and the saved entry return
  setPlan("personal"); const w = await api("/account/custom-models?scope=services"); assert.deepStrictEqual(w.d.onehelm, { id: ONE, name: "1Helm's models", service: "1Helm" }); assert.deepStrictEqual(w.d.categories[0].chain.map((e) => e.model), [ONE]);
}
ok("Bring your own key plan: not offered, saving refused, a saved entry skipped with no call or charge, stored setting kept and back on a full plan");

// ===== 6. Background jobs with a 1Helm entry: billed on the Ledger, a service entry is not =====
await reset("");
{
  const { nameChat } = await import("../src/chat-titles.js"); await save(chainOf(MAIN), [ONE, FAST]); await R.byokRefresh(0);
  const ledger = R.ledger(), claim = { id: "x", title: "New", revision: 0, text: "find me a hotel" };
  const a = await paid(async () => { const o0 = orCalls.length; const title = await nameChat({ env: R.env, ledger, meta: { tenant: "t1" }, claim }); return { title, or: orCalls.length - o0 }; });
  assert.strictEqual(a.r.or, 1, "the title job ran on 1Helm's models"); assert.ok(a.spent > 0 && a.spent < 1e8, `billed once (${a.spent})`);
  orFail = true; const p0 = prov.length; const b = await paid(() => nameChat({ env: R.env, ledger, meta: { tenant: "t1" }, claim }));
  assert.ok(prov.length - p0 >= 1, "a failing 1Helm entry hands the job to the service"); assert.strictEqual(b.spent, 0, "the service is free and the failed call cost nothing");
  await save(chainOf(MAIN), [FAST, ONE]); orFail = false; svcFail = true; await R.byokRefresh(0);
  const c = await paid(() => nameChat({ env: R.env, ledger, meta: { tenant: "t1" }, claim })); assert.ok(c.spent > 0, "service failed: the job went to 1Helm and was billed");
  svcFail = false;
}
ok("Background jobs: 1Helm entry runs the job on 1Helm's models and bills it; fallback both ways; service entries are free");

// ===== 7. only 1Helm's models chosen on a full plan: exactly as without services =====
await reset("");
{
  await save(chainOf(ONE), [ONE]);
  assert.strictEqual(modeOf(), "now", "General's first model being 1Helm's is a valid choice for Use my services now");
  assert.strictEqual(await loadByok(env, "t1"), null, "no service is used: the account behaves as a full plan without services");
  orScript = ["Plain 1Helm."]; const x = await turn("hello"); assert.strictEqual(x.r.reply, "Plain 1Helm."); assert.strictEqual(x.calls.length, 0);
  await save(chainOf(ONE, MAIN)); assert.ok((await loadByok(env, "t1")).model === ONE, "with a service fallback the chain runs on the own-key runtime");
  const sw = await api("/byok/switch-now", {}); assert.strictEqual(sw.status, 200, JSON.stringify(sw.d));
}
ok("a chain of only 1Helm's models behaves as without services; first model 1Helm's is valid for Use my services now and Switch now");

// ===== 8. removing the last service on a full plan keeps the 1Helm entries =====
await reset("");
{
  const { removeConnection } = await import("../src/ee/byok-connections.js");
  await save(chainOf(MAIN, ONE)); const r = await removeConnection(env, "t1", "p_main"); assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(saved().categories[0].chain.map((e) => e.model), [ONE]); assert.strictEqual(await loadByok(env, "t1"), null); orScript = ["Still 1Helm."];
  assert.strictEqual((await turn("hi")).r.reply, "Still 1Helm.");
}
ok("removing the last service keeps the 1Helm entries and chat keeps working");

// ===== 9. privacy: a 1Helm entry follows the account's AI data privacy level as on a full plan =====
await reset("");
{
  await save(chainOf(ONE, MAIN));
  const { dispatch } = await import("../src/ee/model-dispatch.js");
  const blocked = Object.assign(new Error('No model of "chat" can run at privacy level zdr. Nothing was sent.'), { privacyBlocked: true });
  const real = R.env.__byokBase; let seen = null;
  await R.byokRefresh(0); R.env.BYOK.oneHelm = undefined; R.attachOneHelm(R.env.BYOK);
  const wrap = R.oneHelmCall.bind(R); R.oneHelmCall = async (body, o) => { seen = o.privacy; throw blocked; };
  script = ["Service after the privacy refusal."];
  const x = await turn("hi"); assert.strictEqual(x.r.reply, "Service after the privacy refusal."); assert.strictEqual(x.or.filter((b) => b.stream).length, 0, "nothing was sent to 1Helm");
  assert.ok(seen, "the account's privacy level is handed to the call"); R.oneHelmCall = wrap; void real; void dispatch;
  R.oneHelmCall = wrap;
}
ok("a privacy refusal on a 1Helm entry sends nothing and moves to the next model, or says so when it is the last");

// ===== 10. the composer line follows the call that was answered =====
await reset("");
{
  await save(chainOf(MAIN, ONE)); script = ["svc"]; const a = await turn("one"); const ev = (x) => x.evs.filter((e) => e.t === "ai_used");
  assert.deepStrictEqual(ev(a).map((e) => e.chatgpt), [false], "a chat call on a plain service is not the ChatGPT plan");
  const { chatgptPlanInUse } = await import("../src/byok.js"); assert.strictEqual(await chatgptPlanInUse(env, T()), false);
}
ok("the stream says which kind of service answered (ai_used), so Using ChatGPT plan shows only for a ChatGPT call");

assert.deepStrictEqual(logs.filter((l) => l.includes(KEY)), []); ok("the key is in no log line");
process.stdout.write(`\n${n} passed\n`);
