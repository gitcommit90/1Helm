// node --import ./test/stubs/register.mjs test/hs-bank-cap.test.mjs
// The optional environment cap on Hindsight banks (HS_BANK_CAP, 0 or unset = no cap) and the manual (test account) template path in src/hindsight.js.
import assert from "node:assert/strict";
import { ensureBank, assertBankCap, bankCap, importTemplate, testBankManifest, syncMentalModelTriggers } from "../src/hindsight.js";
import { isTestEmail, isTestTenant } from "../src/test-tenant.js";
import { fillTemplate } from "../src/hindsight-template.js";

const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
const ok = (n) => console.log("ok -", n);
function fake(ids) {
  const calls = [];
  const HINDSIGHT = { fetch: async (u, init = {}) => {
    const url = new URL(u), m = init.method || "GET", p = decodeURIComponent(url.pathname).replace("/v1/default/banks", ""); calls.push(`${m} ${p}`);
    if (m === "GET" && p === "") return J({ banks: ids.map((bank_id) => ({ bank_id })), total: ids.length });
    if (m === "POST" && p.endsWith("/import")) return J({ mental_models_created: ["a"], operation_ids: ["op1", "op2"] });
    return J({});
  } };
  return { calls, env: (extra = {}) => ({ HINDSIGHT, HINDSIGHT_API_KEY: "k", MEMORY_BACKEND: "hindsight", ENV_NAME: "dev", ...extra }) };
}

assert.equal(bankCap({}), 0); assert.equal(bankCap({ HS_BANK_CAP: "60" }), 60); assert.equal(bankCap({ HS_BANK_CAP: "x" }), 0);
{ const f = fake(["dev-a-main", "dev-b-main", "a2a-dev-c-abc", "live-d-main"]); const env = f.env();
  await ensureBank(env, "dev-new-main"); assert.ok(f.calls.includes("PUT /dev-new-main"), "no cap: the bank is created and nothing is listed"); assert.ok(!f.calls.includes("GET "));
  ok("no cap set: banks are created without a listing"); }
{ const f = fake(["dev-a-main", "dev-b-main", "a2a-dev-c-abc", "live-d-main"]); const env = f.env({ HS_BANK_CAP: "3" });
  await assert.rejects(() => ensureBank(env, "dev-x-main"), /bank limit reached/); assert.ok(!f.calls.some((c) => c.startsWith("PUT")), "a refused bank is never created");
  await assertBankCap(env, "dev-a-main"); await ensureBank(env, "dev-b-main"); assert.ok(f.calls.includes("PUT /dev-b-main"), "an existing bank never trips the cap");
  ok("cap 3 with 3 environment banks: a new bank is refused, an existing one is kept, other environments do not count"); }
{ const m = testBankManifest(fillTemplate("general", { first: "Sam", helper: "Skipper", channel: "main", purpose: "" }));
  assert.ok(m.mental_models.length > 0); for (const x of m.mental_models) assert.deepEqual(x.trigger, { mode: "full" });
  const f = fake(["dev-t-main"]); const r = await importTemplate(f.env(), "dev-t-main", m, { manual: true });
  assert.deepEqual(r.operation_ids, ["op1", "op2"]); assert.equal(f.calls.filter((c) => c.startsWith("DELETE") || c.includes("operations")).length >= 2, true, "the queued refreshes are cancelled");
  const g = fake(["dev-t-main"]); await importTemplate(g.env(), "dev-t-main", m); assert.ok(!g.calls.some((c) => c.includes("operations")), "not manual: nothing is cancelled");
  ok("manual banks: models keep no automatic trigger and the refreshes an import queues are cancelled"); }
assert.ok(isTestEmail("a@example.com") && !isTestEmail("a@example.org") && !isTestEmail("")); 
assert.equal(await isTestTenant({ DB: { prepare: () => ({ bind: () => ({ first: async () => ({ email: "t@example.com" }) }) }) } }, "x"), true);
assert.equal(await isTestTenant({ DB: { prepare: () => { throw new Error("x"); } } }, "x"), false);
ok("test account rule: an @example.com owner only, and a lookup error means not a test account");
