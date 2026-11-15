// node --import ./test/stubs/register.mjs test/topup-confirm.test.mjs
// Add credits needs a confirmation. POST /api/topup/confirm names the saved card (brand and last 4 only) and issues a short-lived token for
// one amount; POST /api/topup refuses to charge without it. Driven through the real Worker with a FAKE Stripe (global fetch), no real charge.
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs"; import { createHash } from "node:crypto";
import { issueConfirm, checkConfirm, CONFIRM_TTL_MS } from "../src/topup.js";
import worker from "../src/index.js";

let NOW = Date.UTC(2026, 9, 18, 17, 0, 0); Date.now = () => NOW;
const log0 = console.log; console.log = (...a) => { if (/^ {2}ok /.test(a.join(" ")) || /^topup-confirm: all ok/.test(a.join(" "))) log0(...a); }; console.error = () => {};
const d1 = new DatabaseSync(":memory:");
for (const f of ["0001_012_full_schema_dev", "0017_026_plan_cancel", "0024_033_pastdue"]) d1.exec(readFileSync(new URL(`../db/migrations/${f}.sql`, import.meta.url), "utf8"));
const D1 = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }),
  run: async () => { const r = st.run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; } };

// ---- fake Stripe: customer cus_1 has a saved Visa 4242, cus_2 has none ----
let CALLS = [];
const CUST = { cus_1: { invoice_settings: { default_payment_method: "pm_1" } }, cus_2: { invoice_settings: {} } };
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(typeof url === "string" ? url : url.url); if (u.hostname !== "api.stripe.com") throw new Error("unexpected fetch " + u);
  const method = init.method || "GET", path = u.pathname.replace("/v1/", ""); CALLS.push({ method, path, body: init.body ? Object.fromEntries(new URLSearchParams(init.body)) : null });
  const ok = (o) => new Response(JSON.stringify(o), { status: 200 });
  let m;
  if ((m = path.match(/^customers\/(\w+)$/))) return ok(CUST[m[1]]);
  if (/^customers\/\w+\/payment_methods$/.test(path)) return ok({ data: [] });
  if (path === "payment_methods/pm_1") return ok({ id: "pm_1", card: { brand: "visa", last4: "4242", exp_month: 1, exp_year: 2030, fingerprint: "SECRET" }, billing_details: { name: "Jo", email: "jo@x.test" } });
  if (path === "payment_intents") return ok({ id: "pi_1", status: "succeeded" });
  if (path === "checkout/sessions") return ok({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" });
  return new Response(JSON.stringify({ error: { message: "unexpected " + path } }), { status: 404 });
};
const rec = { idFromName: (n) => n, get: () => new Proxy({}, { get: (_, k) => k === "then" ? undefined : async () => k === "state" ? { balance_nano: 0 } : {} }) };
const env = { DB: D1, LEDGER: rec, ARCHIVE: rec, RESIDENT: rec, COMPUTER: rec, ONEHELM_EE: "1hc", STRIPE_SECRET_KEY: "sk_test_fake", STRIPE_WEBHOOK_SECRET: "whsec_test", TEST_MODE: "1", ENV_NAME: "dev", GATEWAY_HOST: "app.example.com", APP_HOST: "app.example.com", PLAN_PRICES: "{}" };
const waits = []; const ctx = { waitUntil: (p) => waits.push(p), passThroughOnException() {} };
let n = 0;
function account() {
  const i = ++n, tok = `abcd${i}0`; d1.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run(`u${i}`, `u${i}@realmail.test`, NOW);
  d1.prepare("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)").run(createHash("sha256").update(tok).digest("hex"), `u${i}`, NOW + 3e9);
  d1.prepare("INSERT INTO tenants (id,slug,owner_user_id,status,stripe_customer,created_at,updated_at,onboarding_completed,sub_status,plan) VALUES (?,?,?,?,?,?,?,1,'active','plus')").run(`t${i}`, `acct${i}`, `u${i}`, "active", `cus_${i}`, NOW, NOW);
  return { slug: `acct${i}`, tok, tid: `t${i}` };
}
async function call(a, path, body) {
  const r = await worker.fetch(new Request(`https://app.example.com/w/${a.slug}/api${path}`, { method: "POST", headers: { cookie: `hc_session=${a.tok}`, "content-type": "application/json" }, body: JSON.stringify(body) }), env, ctx);
  while (waits.length) await Promise.all(waits.splice(0)); return { status: r.status, body: await r.json() };
}
const charges = () => CALLS.filter((c) => c.method === "POST" && (c.path === "payment_intents" || c.path === "checkout/sessions"));
async function scenario(name, fn) { CALLS = []; await fn(); console.log("  ok", name); }

const A = account(), B = account();
let tokA25;

await scenario("confirm names the saved card with brand and last 4 only, and charges nothing", async () => {
  const r = await call(A, "/topup/confirm", { pack: 25 });
  assert.strictEqual(r.status, 200); assert.deepStrictEqual(Object.keys(r.body).sort(), ["card", "confirm", "pack"]);
  assert.deepStrictEqual(r.body.card, { brand: "visa", last4: "4242" }); assert.strictEqual(r.body.pack, 25);
  const text = JSON.stringify(r.body); for (const bad of ["pm_1", "SECRET", "jo@x.test", "exp_", "cus_1"]) assert.ok(!text.includes(bad), bad);
  assert.strictEqual(charges().length, 0); tokA25 = r.body.confirm;
});
await scenario("confirm with no saved card says card is null; a bad amount is refused", async () => {
  assert.strictEqual((await call(B, "/topup/confirm", { pack: 25 })).body.card, null);
  assert.strictEqual((await call(A, "/topup/confirm", { pack: 7 })).status, 400); assert.strictEqual(charges().length, 0);
});
await scenario("topup without confirmation, with a wrong amount, a forged token or another account's token is refused with no charge", async () => {
  const tokB = (await call(B, "/topup/confirm", { pack: 25 })).body.confirm; CALLS = [];
  for (const body of [{ pack: 25 }, { pack: 25, confirm: true }, { pack: 25, confirm: "" }, { pack: 50, confirm: tokA25 }, { pack: 25, confirm: tokB }, { pack: 25, confirm: tokA25.slice(0, -1) + "0" }]) {
    const r = await call(A, "/topup", body); assert.strictEqual(r.status, 409, JSON.stringify(body)); assert.match(r.body.error, /Nothing was charged/);
  }
  assert.strictEqual(charges().length, 0); assert.strictEqual(CALLS.length, 0, "no Stripe call at all");
});
await scenario("an expired token is refused with no charge", async () => {
  NOW += CONFIRM_TTL_MS + 1; const r = await call(A, "/topup", { pack: 25, confirm: tokA25 }); NOW -= CONFIRM_TTL_MS + 1;
  assert.strictEqual(r.status, 409); assert.strictEqual(charges().length, 0);
});
await scenario("with the token, the saved card is charged off session as before", async () => {
  const r = await call(A, "/topup", { pack: 25, confirm: tokA25 });
  assert.deepStrictEqual(r.body, { status: "succeeded" }); const c = charges(); assert.strictEqual(c.length, 1);
  assert.strictEqual(c[0].path, "payment_intents"); assert.strictEqual(c[0].body.amount, "2500"); assert.strictEqual(c[0].body.off_session, "true"); assert.strictEqual(c[0].body.payment_method, "pm_1");
  assert.ok(!CALLS.some((x) => x.path.startsWith("payment_methods")), "the charge needs no card details lookup");
});
await scenario("with the token and no saved card, Checkout opens as before", async () => {
  const tok = (await call(B, "/topup/confirm", { pack: 10 })).body.confirm; CALLS = [];
  const r = await call(B, "/topup", { pack: 10, confirm: tok }); assert.strictEqual(r.body.status, "needs_checkout"); assert.match(r.body.url, /checkout\.stripe\.test/);
  assert.deepStrictEqual(charges().map((c) => c.path), ["checkout/sessions"]);
});
await scenario("token helpers: bound to tenant and amount, and not valid before issue or too far ahead", async () => {
  const t = await issueConfirm(env, "t1", 10, NOW);
  assert.ok(await checkConfirm(env, "t1", 10, t, NOW)); assert.ok(!(await checkConfirm(env, "t2", 10, t, NOW))); assert.ok(!(await checkConfirm(env, "t1", 25, t, NOW)));
  assert.ok(!(await checkConfirm(env, "t1", 10, t, NOW + CONFIRM_TTL_MS + 1))); assert.ok(!(await checkConfirm(env, "t1", 10, undefined, NOW)));
  assert.ok(!(await checkConfirm({ ...env, STRIPE_SECRET_KEY: "sk_test_other" }, "t1", 10, t, NOW)));
});
await scenario("a read-only account gets pay-required from both routes, no confirmation and no Stripe call", async () => {
  const C = account(); d1.prepare("UPDATE tenants SET status='canceled', sub_status='canceled' WHERE id=?").run(C.tid);
  const r1 = await call(C, "/topup/confirm", { pack: 25 }), r2 = await call(C, "/topup", { pack: 25, confirm: "x" });
  for (const r of [r1, r2]) { assert.strictEqual(r.status, 402); assert.strictEqual(r.body.error, "payment_required"); assert.strictEqual(r.body.access.mode, "read_only"); }
  assert.strictEqual(r1.body.confirm, undefined); assert.strictEqual(CALLS.length, 0);
});
await scenario("public edition: without the Cloud switch both routes answer 404 and reach no Stripe call", async () => {
  const off = { ...env }; delete off.ONEHELM_EE;
  const D = account();
  for (const [path, body] of [["/topup/confirm", { pack: 25 }], ["/topup", { pack: 25, confirm: "x" }]]) {
    const r = await worker.fetch(new Request(`https://app.example.com/w/${D.slug}/api${path}`, { method: "POST", headers: { cookie: `hc_session=${D.tok}`, "content-type": "application/json" }, body: JSON.stringify(body) }), off, ctx);
    while (waits.length) await Promise.all(waits.splice(0));
    assert.strictEqual(r.status, 404, path);
  }
  assert.strictEqual(CALLS.length, 0);
});
log0("topup-confirm: all ok");
