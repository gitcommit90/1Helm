// node --import ./test/stubs/register.mjs test/byok-switch-now.test.mjs
// Switch now (src/byok.js switchNow, Captain 10-28): a full plan moves to the Bring your own key plan at once, and the unused plan usage
// becomes prepaid credits. The real Ledger (node:sqlite) holds the credits, the real Worker handles the routes and the Stripe webhook, and
// fetch is faked: the person's endpoint and Stripe (every call recorded). Covers: the amount and its idempotency, credits that don't
// expire, the plan flipping at once, the Stripe calls (price swap, no proration, nothing else), a late invoice for the old plan, an
// account with a switch already scheduled, refusing without a working key, a Stripe failure changing nothing, and fallback unchanged.
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
import worker, { Ledger } from "../src/index.js";
import { byokApi, loadByok, fallbackNotice, creditsLine, CREDITS_TOOL_ERR, BYOK_PLAN, METER } from "../src/byok.js";
const METER_HS = Math.ceil(METER.mem_search * 1.15);
import { HANDOFF_PREFIX } from "../src/ee/route2.js";
import { sealSecret } from "../src/sentinel.js";
import { OUT_OF_TIME_REPLY } from "../src/spendguard.js";
import { fakeIndex, embedding } from "./helpers/mem0-fakes.mjs";

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
for (const f of ["0022_031_byok", "0025_034_byok_mode", "0017_026_plan_cancel", "0020_029_storage"]) d1.exec(readFileSync(new URL(`../db/migrations/${f}.sql`, import.meta.url), "utf8"));
const D1 = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }),
  run: async () => { const r = st.run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; } };
const T = () => d1.prepare("SELECT * FROM tenants WHERE id='t1'").get();
const setPlan = (p) => d1.prepare("UPDATE tenants SET plan=? WHERE id='t1'").run(p);
const modeOf = () => d1.prepare("SELECT mode FROM byok WHERE tenant_id='t1'").get()?.mode;

// ---- the real Ledger ----
const ldb = new DatabaseSync(":memory:");
const env = { ONEHELM_EE: "1hc", DB: D1, GATEWAY_HOST: "app.example.test", APP_HOST: "app.example.test", MEMORY: "off", GENUI: "off", WORKMEM: "off", OPENROUTER_API_KEY: "or-key",
  MODEL: "@cf/zai-org/glm-5.3-flash", VAULT_KEY: Buffer.from(new Uint8Array(32).map((_, i) => i * 5 + 3)).toString("base64"),
  STRIPE_WEBHOOK_SECRET: "whsec_test", STRIPE_SECRET_KEY: "sk_test_x", PLAN_PRICES: JSON.stringify({ personal: "price_personal", plus: "price_plus", byok: "price_byok" }), ENV_NAME: "test",
  AI: { run: async (m) => { throw new Error(`workers ai must not be called (${m})`); } } };
const L = new Ledger({ storage: { sql: mkSql(ldb), transactionSync: (f) => f() } }, env);
L.setSpendPreferences(true);   // "Pause to check spending" is off by default; these scenarios cover the pause
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
let price = "price_personal", stripeFail = false, keyBad = false;
const SUB = () => ({ id: "sub_1", status: "active", current_period_end: 1893456000, items: { data: [{ id: "si_1", price: { id: price }, current_period_end: 1893456000 }] } });
globalThis.fetch = async (u, init = {}) => {
  u = String(u);
  if (u.startsWith("https://api.stripe.com/v1/")) {
    const path = u.slice(26).split("?")[0], body = Object.fromEntries(new URLSearchParams(String(init.body || ""))); stripeCalls.push([init.method || "GET", path, body]);
    if (path === "subscriptions/sub_1") return jres(SUB());
    if (path === "subscription_items/si_1" && stripeFail) return jres({ error: { message: "stripe is down" } }, 500);
    if (path === "subscription_items/si_1") { price = body.price; return jres({ id: "si_1", price: { id: price } }); }
    return jres({ error: { message: `unexpected stripe ${path}` } }, 400);
  }
  if (u.includes("openrouter.ai") || u.includes("gateway.ai.cloudflare.com")) {
    const body = JSON.parse(init.body || "{}"); orCalls.push(body);
    if (!body.stream && JSON.stringify(body.messages || []).includes("## New Messages")) return jres({ model: "or/label", choices: [{ message: { role: "assistant", content: "{\"memory\":[]}" } }], usage: { prompt_tokens: 50, completion_tokens: 9, cost: 0.0001 } });   // a memory extraction answers with the memory list
    if (!body.stream) return jres({ model: "or/label", choices: [{ message: { role: "assistant", content: "{\"title\":\"Looked it up\",\"result\":\"Done\"}" } }], usage: { prompt_tokens: 50, completion_tokens: 9, cost: 0.0001 } });
    const last = body.messages.at(-1);
    if (typeof last.content === "string" && last.content.startsWith(HANDOFF_PREFIX)) return answer({ model: "or/notes" }, "- notes");
    return answer({ model: "or/sol" }, orScript.shift() ?? "From 1Helm's AI.");
  }
  const url = new URL(u);
  if (url.hostname === HOST && keyBad) return jres({ error: "bad key" }, 401);
  if (url.hostname === HOST) {
    const body = JSON.parse(init.body || "{}"); prov.push({ auth: init.headers?.authorization, body });
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
  d1.prepare("INSERT OR REPLACE INTO byok (tenant_id,base_url,model,fast_model,key_sealed,key_last4,created_at,updated_at,mode) VALUES ('t1',?,?,?,?,?,?,?,?)").run(BASE, "main-model-1", "fast-model-1", await sealSecret(env, KEY), KEY.slice(-4), Date.now(), Date.now(), mode);
}

const tok = "cd".repeat(16), th = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tok))).toString("hex");
d1.prepare("INSERT INTO sessions VALUES (?,?,?)").run(th, "u1", Date.now() + 3600e3);
const api = async (sub, body) => { const r = await worker.fetch(new Request(`https://app.example.test/w/ck1/api${sub}`, body === undefined ? { headers: { cookie: `hc_session=${tok}` } } : { method: "POST", body: JSON.stringify(body), headers: { cookie: `hc_session=${tok}`, "content-type": "application/json" } }), env, { waitUntil: () => {} });
  const text = await r.text(); assert.ok(!text.includes(KEY), "the key is never in a response"); return { status: r.status, d: JSON.parse(text) }; };
async function hook(type, obj) {
  const raw = JSON.stringify({ id: `evt_${Math.random().toString(36).slice(2)}`, type, data: { object: obj } }), t = Math.floor(Date.now() / 1000);
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = Buffer.from(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${t}.${raw}`))).toString("hex");
  const r = await worker.fetch(new Request("https://app.example.test/stripe/webhook", { method: "POST", body: raw, headers: { "stripe-signature": `t=${t},v1=${sig}` } }), env, { waitUntil: () => {} });
  assert.strictEqual(r.status, 200, await r.clone().text());
}
let invAt = () => Math.floor(Date.now() / 1000) - 60;   // a Stripe invoice's creation time (seconds): by default a minute ago, i.e. before the switch just made
const inv = (id, reason, lines, paid = 3000) => ({ object: "invoice", id, created: invAt(), customer: "cus_1", billing_reason: reason, amount_paid: paid, parent: { subscription_details: { subscription: "sub_1", metadata: { tenant_id: "t1" } } }, lines: { data: lines } });
const line = (p, amount) => ({ amount, pricing: { price_details: { price: p } } });
const posts = () => stripeCalls.filter(([m]) => m === "POST");
const balance = async () => (await L.state()).balance_nano;
const rows = () => ldb.prepare("SELECT key,kind,nano FROM grants WHERE key LIKE 'unused-plan-balance-to-credits:%' ORDER BY key").all();
const spend = async (id, nano) => { await L.reserve(id, nano); await L.settle(id, nano); };
// A fresh Personal account: $20 of plan usage this period, plus $3 of credits bought, $5 spent. Unused plan usage: $15. Balance: $18.
async function fresh(mode = "") {
  ldb.exec("DELETE FROM grants; DELETE FROM spend; DELETE FROM res;"); try { ldb.exec("DELETE FROM kv"); } catch {}
  stripeCalls.length = 0; stripeFail = false; keyBad = false; price = "price_personal"; setPlan("personal"); d1.exec("DELETE FROM byok; DELETE FROM stripe_events; DELETE FROM byok_tests");
  await L.grantIncluded("invoice:in_p1", 20e9); await L.grant("pi:topup1", 3e9, "topup"); await spend("s1", 5e9);
  if (mode !== "none") await saveRow(mode);
}
let n = 0; const ok = (name) => { n++; process.stdout.write(`ok ${n} - ${name}\n`); };

// ===== 1. the amount, the Stripe calls, the plan, the credits =====
await fresh("");
{
  assert.strictEqual(await L.byokUnusedPlan(), 15e9); assert.strictEqual(await balance(), 18e9);
  const pv = await api("/byok/switch-preview"); assert.strictEqual(pv.status, 200); assert.strictEqual(pv.d.unused, "$15.00"); assert.strictEqual(pv.d.next_bill_at, 1893456000000); assert.strictEqual(pv.d.price, 10);
  assert.deepStrictEqual(posts(), [], "the preview changes nothing");
  const x = await api("/byok/switch-now", {});
  assert.strictEqual(x.status, 200, JSON.stringify(x.d)); assert.strictEqual(x.d.plan, "byok"); assert.strictEqual(x.d.moved_nano, 15e9); assert.strictEqual(x.d.moved, "$15.00"); assert.strictEqual(x.d.next_bill_at, 1893456000000);
  assert.strictEqual(T().plan, "byok", "the plan changed at once");
  // Stripe: one price swap on the plan's item, no proration, nothing else (no invoice, no anchor change, no upgrade charge)
  assert.deepStrictEqual(posts(), [["POST", "subscription_items/si_1", { price: "price_byok", proration_behavior: "none" }]]);
  assert.ok(!posts().some(([, , b]) => "billing_cycle_anchor" in b || b.proration_behavior === "always_invoice" || "payment_behavior" in b));
  // the Ledger: the balance didn't change (no money created), $15 left the plan usage and became credits, in two labelled rows
  assert.strictEqual(await balance(), 18e9, "$15 + $3 before and after"); assert.strictEqual(await L.byokUnusedPlan(), 0, "no plan usage left");
  assert.deepStrictEqual(rows().map((r) => [r.key.replace(/^.*in_p1/, "in_p1"), r.kind, r.nano]), [["in_p1", "topup", 15e9], ["in_p1:expire", "included_expire", -15e9]]);
  assert.match(rows()[0].key, /^unused-plan-balance-to-credits:/);
  assert.strictEqual(modeOf(), "");
  // AI goes to their endpoint from the next call: the byok plan with their key
  const cfg = await loadByok(env, "t1"); assert.ok(cfg && !cfg.missing && !cfg.fallback && cfg.base === BASE && cfg.model === "main-model-1");
}
ok("switch now: plan byok at once, Stripe price swap with no proration, the $15 unused plan usage becomes credits, balance unchanged");

// ===== 2. idempotent: a retry, a double click, a concurrent pair =====
{
  const bal = await balance(), r0 = rows().length;
  const again = await api("/byok/switch-now", {}); assert.strictEqual(again.status, 200); assert.strictEqual(again.d.already, true); assert.strictEqual(again.d.moved_nano, 0);
  assert.strictEqual(posts().length, 1, "no second Stripe call"); assert.strictEqual(await balance(), bal); assert.strictEqual(rows().length, r0);
  const d = await L.byokPlanToCredits(); assert.strictEqual(d.duplicate, true); assert.strictEqual(d.moved_nano, 15e9); assert.strictEqual(await balance(), bal, "the Ledger moves it once");
  // two at the same time on a fresh account
  await fresh("");
  const [a, b] = await Promise.all([api("/byok/switch-now", {}), api("/byok/switch-now", {})]);
  assert.strictEqual(a.status, 200); assert.strictEqual(b.status, 200);
  assert.strictEqual(await balance(), 18e9, "never more than $18"); assert.strictEqual(rows().length, 2, "one conversion");
  assert.strictEqual(ldb.prepare("SELECT COALESCE(SUM(nano),0) n FROM grants WHERE kind='topup'").get().n, 18e9, "$3 bought + $15 moved, once");
  // a retry after a step failed: Stripe swapped but the plan didn't flip → finishing it neither swaps nor converts twice
  await fresh(""); price = "price_byok"; const y = await api("/byok/switch-now", {}); assert.strictEqual(y.status, 200); assert.deepStrictEqual(posts(), [], "the price was already the byok price"); assert.strictEqual(y.d.moved_nano, 15e9); assert.strictEqual(T().plan, "byok");
}
ok("idempotent: second click, concurrent clicks and a retry after a partial failure move the money and call Stripe once");

// ===== 3. credits never expire; a later renewal does nothing to them =====
{
  await fresh(""); await api("/byok/switch-now", {});
  const bal = await balance();
  const gi = await L.guardInfo(); assert.strictEqual(gi.allowance_nano, 15e9, "right after the switch the meter measures the moved credits, not the old plan's $20"); assert.strictEqual(gi.period_spent_nano, 0);
  await hook("invoice.paid", inv("in_byok_renew", "subscription_cycle", [line("price_byok", 1000)], 1000));
  assert.strictEqual(T().plan, "byok"); assert.strictEqual(await balance(), bal, "the byok renewal grants no usage and expires no credits");
  await L.grantIncluded("invoice:in_next_period", 0); assert.strictEqual(await balance(), bal, "a new period's expiry takes none of the moved credits");
  const topups = ldb.prepare("SELECT COALESCE(SUM(nano),0) n FROM grants WHERE kind='topup'").get().n; assert.strictEqual(topups, 18e9);
  await spend("s2", 1e9); assert.strictEqual(await balance(), bal - 1e9, "spent like any credit");
}
ok("moved credits don't expire at the next period or a byok renewal, are spent like a top-up, and the usage meter starts over on them");

// ===== 4. a late invoice for the old plan can't undo it =====
{
  await fresh(""); await api("/byok/switch-now", {});
  const bal = await balance();
  // the renewal invoice of the old plan (its webhook was late), created before the switch
  await hook("invoice.paid", inv("in_late_renewal", "subscription_cycle", [line("price_personal", 3000)]));
  assert.strictEqual(T().plan, "byok", "the plan stays byok");
  assert.strictEqual(ldb.prepare("SELECT COUNT(*) n FROM grants WHERE kind='included' AND key='invoice:in_late_renewal'").get().n, 0, "no plan usage is granted");
  assert.strictEqual(await balance(), bal + 20e9, "what was paid for is kept once, as credits");
  const g = ldb.prepare("SELECT kind FROM grants WHERE key='invoice:in_late_renewal'").get(); assert.strictEqual(g.kind, "topup");
  // the same invoice again (another event): nothing more
  await hook("invoice.paid", inv("in_late_renewal", "subscription_cycle", [line("price_personal", 3000)])); assert.strictEqual(await balance(), bal + 20e9);
  // an upgrade paid just before the switch
  await hook("invoice.paid", inv("in_late_upgrade", "subscription_update", [line("price_plus", 1000)], 1000)); assert.strictEqual(T().plan, "byok");
  assert.strictEqual(await balance(), bal + 20e9 + 10e9);
  // and a real upgrade from the byok plan afterwards still works: Stripe is on the new price, the plan is set, usage granted
  price = "price_plus"; invAt = () => Math.floor(Date.now() / 1000) + 5; await hook("invoice.paid", inv("in_up_real", "subscription_update", [line("price_plus", 1000)], 1000));
  assert.strictEqual(T().plan, "plus"); assert.strictEqual(ldb.prepare("SELECT kind FROM grants WHERE key='invoice:in_up_real'").get().kind, "included"); invAt = () => Math.floor(Date.now() / 1000) - 60;
}
ok("an invoice for the old plan, created before the switch and delivered after it, doesn't put the plan back or grant plan usage (kept as credits, once); a real upgrade from byok still works");

// ===== 5. a scheduled switch (mode switch) gets Switch now =====
{
  await fresh("fallback");
  let x = await api("/byok/mode", { mode: "switch" }); assert.strictEqual(x.d.mode, "switch"); assert.strictEqual(T().plan, "personal"); assert.strictEqual(posts().length, 1); assert.strictEqual(price, "price_byok");
  stripeCalls.length = 0;
  x = await api("/byok/switch-now", {}); assert.strictEqual(x.status, 200, JSON.stringify(x.d)); assert.strictEqual(x.d.moved_nano, 15e9); assert.strictEqual(T().plan, "byok");
  assert.deepStrictEqual(posts(), [], "the byok price was already scheduled: no second swap"); assert.strictEqual(x.d.next_bill_at, 1893456000000); assert.strictEqual(await balance(), 18e9); assert.strictEqual(modeOf(), "");
  // the renewal invoice of the scheduled switch arrives later: a no-op
  await hook("invoice.paid", inv("in_sched", "subscription_cycle", [line("price_byok", 1000)], 1000)); assert.strictEqual(T().plan, "byok"); assert.strictEqual(await balance(), 18e9);
}
ok("a scheduled switch: Switch now converts and flips at once without a second price swap; the scheduled renewal invoice later does nothing");

// ===== 6. refused without a working key; nothing changes =====
{
  await fresh("none");
  let x = await api("/byok/switch-now", {}); assert.strictEqual(x.status, 409); assert.match(x.d.error, /Save your AI key first/);
  assert.deepStrictEqual(posts(), []); assert.strictEqual(T().plan, "personal"); assert.strictEqual(await balance(), 18e9); assert.strictEqual(rows().length, 0);
  await saveRow(""); keyBad = true;
  x = await api("/byok/switch-now", {}); assert.strictEqual(x.status, 409); assert.match(x.d.error, /connection test/); assert.ok(x.d.test && x.d.test.ok === false);
  assert.deepStrictEqual(posts(), []); assert.strictEqual(T().plan, "personal"); assert.strictEqual(await balance(), 18e9); assert.strictEqual(rows().length, 0);
  // Change plan → Bring your own key goes the same way
  x = await api("/plan/change", { plan: "byok" }); assert.strictEqual(x.status, 409); assert.deepStrictEqual(posts(), []);
}
ok("without a saved key, or when the key fails its connection test: refused, no Stripe call, plan and credits unchanged (also through Change plan)");

// ===== 7. Stripe failing changes nothing =====
{
  await fresh(""); stripeFail = true;
  const x = await api("/byok/switch-now", {}); assert.ok(x.status >= 400, JSON.stringify(x));
  assert.strictEqual(T().plan, "personal"); assert.strictEqual(await balance(), 18e9); assert.strictEqual(rows().length, 0, "no credits before the price swap worked");
  stripeFail = false; const y = await api("/byok/switch-now", {}); assert.strictEqual(y.status, 200); assert.strictEqual(T().plan, "byok"); assert.strictEqual(await balance(), 18e9);
}
ok("a Stripe error before the swap: plan, credits and Ledger untouched; trying again works");

// ===== 8. Change plan → Bring your own key is a switch now =====
{
  await fresh("");
  const x = await api("/plan/change", { plan: "byok" }); assert.strictEqual(x.status, 200, JSON.stringify(x.d)); assert.strictEqual(x.d.plan, "byok"); assert.strictEqual(x.d.moved_nano, 15e9);
  assert.strictEqual(T().plan, "byok"); assert.deepStrictEqual(posts(), [["POST", "subscription_items/si_1", { price: "price_byok", proration_behavior: "none" }]]);
}
ok("Change plan to Bring your own key does the same switch now");

// ===== 9. fallback unchanged =====
{
  await fresh("");
  const x = await api("/byok/mode", { mode: "fallback" }); assert.strictEqual(x.status, 200); assert.strictEqual(x.d.mode, "fallback");
  assert.strictEqual(T().plan, "personal"); assert.deepStrictEqual(posts(), []); assert.strictEqual(await balance(), 18e9); assert.strictEqual(rows().length, 0); assert.strictEqual(modeOf(), "fallback");
  assert.strictEqual((await loadByok(env, "t1")).fallback, true);
  // on a plan with nothing unused (all spent), Switch now moves $0 and still switches
  await fresh(""); await spend("s3", 15e9); assert.strictEqual(await L.byokUnusedPlan(), 0);
  const y = await api("/byok/switch-now", {}); assert.strictEqual(y.status, 200); assert.strictEqual(y.d.moved_nano, 0); assert.strictEqual(T().plan, "byok"); assert.strictEqual(await balance(), 3e9, "only the bought credits are left");
  // $22 spent of $20 plan usage + $3 bought: the plan usage is gone, the $1 left is bought credit and is never counted as plan usage
  await fresh(""); await spend("s4", 17e9); assert.strictEqual(await balance(), 1e9); assert.strictEqual(await L.byokUnusedPlan(), 0);
  const z = await api("/byok/switch-now", {}); assert.strictEqual(z.d.moved_nano, 0); assert.strictEqual(await balance(), 1e9);
}
ok("fallback is unchanged (plan, Stripe, credits); nothing unused moves $0 and still switches");

assert.deepStrictEqual(logs.filter((l) => l.includes(KEY)), []); ok("the key is in no log line");
process.stdout.write(`\n${n} passed\n`);
