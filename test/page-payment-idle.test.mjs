// node --import ./test/stubs/register.mjs test/page-payment-idle.test.mjs
// A web page's own payment-looking background request (X's script calling grok.com CreateCheckoutSession) must not become a
// permission card while nothing is being bought; it asks while a purchase is in progress; keys and commands keep asking.
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
import { egressRule, approvalLabel, pageSiteOf } from "../src/egress-policy.js";
import { buyControlTargeted } from "../src/ee/browser-tasks.js";
import { Resident } from "../src/resident.js";

const H = (o = {}) => new Headers(o);
const GROK = { host: "grok.com", method: "POST", path: "/commerce.prepurchase.v1.PrePurchaseService/CreateCheckoutSession" };
const XHR = { "sec-fetch-mode": "cors", "sec-fetch-dest": "empty", "sec-fetch-site": "cross-site", "content-type": "application/grpc-web+proto", origin: "https://x.com", referer: "https://x.com/settings/profile" };

// Policy: still "ask" at this layer (the Resident decides with state), and it carries the page the request came from.
const d = egressRule({ env: {}, headers: H(XHR), ...GROK });
assert.equal(d.verdict, "ask"); assert.equal(d.via, "page"); assert.equal(d.page, "x.com");
assert.equal(pageSiteOf(H({ referer: "https://www.x.com/a" })), "www.x.com"); assert.equal(pageSiteOf(H()), "");
assert.equal(approvalLabel({ host: "grok.com", page: "x.com" }), "Grok (grok.com), asked by the x.com page");
assert.equal(approvalLabel({ host: "api.example.com" }), "api.example.com");
assert.equal(approvalLabel({ host: "api.stripe.com", page: "shop.example.co.uk" }), "Stripe (stripe.com), asked by the example.co.uk page");

// A third-party widget's call with a key-looking word in its path is the page's own traffic: no card (Arkose-style bot check, keys words)
const AR = { ...XHR, origin: "https://x.com", referer: "https://x.com/i/flow/login" };
for (const [host, path] of [["client-api.arkoselabs.com", "/fc/gt2/public_key/2F0C5A5C-B4D1"], ["widgets.example.net", "/v1/api_keys/validate"], ["cdn.vendor.example", "/credentials/refresh"]]) {
  const w = egressRule({ env: {}, headers: H(AR), host, method: "POST", path }); assert.equal(w.verdict, "allow", `${host}${path}`); assert.equal(w.rule, "browser-page");
}
// …but not on the page's own site, from a command, with a saved key, or when it also looks like a payment
assert.equal(egressRule({ env: {}, headers: H(AR), host: "api.x.com", method: "POST", path: "/1.1/api_keys" }).verdict, "ask");
assert.equal(egressRule({ env: {}, headers: H(XHR), host: "widgets.example.net", method: "POST", path: "/v1/api_keys", keys: ["K"] }).verdict, "ask");
assert.equal(egressRule({ env: {}, headers: H(), host: "widgets.example.net", method: "POST", path: "/v1/api_keys" }).verdict, "ask");
assert.equal(egressRule({ env: {}, headers: H({ "sec-fetch-mode": "cors" }), host: "widgets.example.net", method: "POST", path: "/v1/api_keys" }).verdict, "ask");   // no page site named
assert.equal(egressRule({ env: {}, headers: H(AR), host: "widgets.example.net", method: "POST", path: "/payments/api_keys" }).verdict, "ask");

// Payment companies are never widgets: card tokenization from a page asks at the policy and, idle, is dropped quietly by the Resident
const SH = { ...XHR, origin: "https://shop.example", referer: "https://shop.example/pay" };
assert.equal(egressRule({ env: {}, headers: H(SH), host: "api.stripe.com", method: "POST", path: "/v1/tokens" }).verdict, "ask");
assert.equal(egressRule({ env: {}, headers: H(SH), host: "api.stripe.com", method: "POST", path: "/v1/api_keys" }).verdict, "ask");
assert.equal(egressRule({ env: {}, headers: H(SH), host: "api.stripe.com", method: "GET", path: "/v1/tokens" }).verdict, "allow");
assert.equal(egressRule({ env: {}, headers: H(AR), host: "widgets.example.net", method: "POST", path: "/v1/api_keys" }).rule, "browser-page");   // another domain, no saved key: allowed

// buy-control detection
const outline = "[e1] button \"Add to cart\"\n[e2] button \"Place your order\"\n[e3] link \"Home\"";
assert.equal(buyControlTargeted([{ kind: "click", ref: "e2" }], { snapshot: outline, url: "https://shop.example/cart" }), true);
assert.equal(buyControlTargeted([{ kind: "click", ref: "e1" }, { kind: "click", ref: "e3" }], { snapshot: outline, url: "https://shop.example/cart" }), false);
assert.equal(buyControlTargeted([{ kind: "click", ref: "e1" }], { snapshot: outline, url: "https://shop.example/checkout/pay" }), true);
assert.equal(buyControlTargeted([{ kind: "click_at", x: 1, y: 1 }, { kind: "scroll" }], { snapshot: outline, url: "https://x.com/home" }), false);

// The real Resident.egressDecision
const dodb = new DatabaseSync(":memory:");
const sql = { exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { dodb.exec(q); return { toArray: () => [], one: () => undefined }; }
  const st = dodb.prepare(q); const r = /^\s*(SELECT|WITH)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } };
const rsrc = readFileSync(new URL("../src/resident.js", import.meta.url), "utf8");
dodb.exec("CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT);" + rsrc.match(/CREATE TABLE IF NOT EXISTS approvals[\s\S]*?approval_id INTEGER\);/)[0]);
dodb.exec("ALTER TABLE approvals ADD COLUMN perm TEXT; ALTER TABLE approvals ADD COLUMN what TEXT; ALTER TABLE approvals ADD COLUMN ssh_data TEXT");
let purchases = [];   // link_purchases rows the fake D1 returns
const env = { DB: { prepare: (q) => ({ bind: (...b) => ({ all: async () => ({ results: [] }),
  first: async () => /FROM link_purchases/.test(q) ? (purchases.find((p) => p.tenant === b[0] && p.channel === b[1] && ["created", "pending_approval", "approved"].includes(p.status) && p.updated_at > b[2]) ? { 1: 1 } : null) : null }) }) } };
const R = Object.create(Resident.prototype);
Object.assign(R, { sql, env, active: new Map(), ctx: {} });
R.put("tenant", "t1"); R.put("channel", "main");
const seen = [];
const turn = (session) => { const t = { finished: false, inTool: 1, subs: new Set([(e) => seen.push(e)]), session, turn: "turn-1", workflow_id: null }; t.emit = (e) => { for (const s of t.subs) s(e); }; return t; };
R.active = new Map([["k", turn("task-A")]]);
const count = () => sql.exec("SELECT COUNT(*) n FROM approvals").one().n;
const ask = (o) => R.egressDecision({ ...GROK, bytes: 55, keys: [], via: "page", page: "x.com", ...o });

// 1. the exact grok request, nothing being bought: quiet deny, no card, no row
let r = await ask();
assert.equal(r.verdict, "deny"); assert.equal(r.quiet, true); assert.equal(r.rule, "page-payment-idle"); assert.match(r.why, /no purchase is in progress/);
assert.equal(count(), 0); assert.equal(seen.length, 0);

// 2. a buy click just happened: it asks (card, held)
R.noteBrowserActs([{ kind: "click", ref: "e2" }], { snapshot: outline, url: "https://shop.example/cart" });
let p = ask({ host: "shop.example", path: "/api/checkout" }); await new Promise((z) => setTimeout(z, 50));
assert.equal(seen[0]?.t, "approval"); assert.equal(seen[0].approval.label, "shop.example, asked by the x.com page");
await R.decideApproval(seen[0].approval.id, "deny"); assert.equal((await p).why, "the person denied it");
// …and the window ends
R._buyClickAt = Date.now() - 91e3; seen.length = 0; const n1 = count();
assert.equal((await ask({ host: "shop.example", path: "/api/checkout" })).rule, "page-payment-idle"); assert.equal(count(), n1);

// 3. a Link purchase in progress in this channel: asks. Finished, other channel, or stale: quiet deny
purchases = [{ tenant: "t1", channel: "main", status: "pending_approval", updated_at: Date.now() - 60e3 }];
p = ask(); await new Promise((z) => setTimeout(z, 50)); assert.equal(seen[0]?.t, "approval"); await R.decideApproval(seen[0].approval.id, "deny"); await p;
for (const row of [{ status: "denied", channel: "main" }, { status: "approved", channel: "other" }, { status: "approved", channel: "main", stale: true }]) {
  purchases = [{ tenant: "t1", status: row.status, channel: row.channel, updated_at: Date.now() - (row.stale ? 31 * 60e3 : 1000) }]; seen.length = 0;
  assert.equal((await ask()).rule, "page-payment-idle", JSON.stringify(row));
}
purchases = [];

// 3b. stripe tokenization from a page: idle drop; in progress asks
{ seen.length = 0; const x = await ask({ host: "api.stripe.com", path: "/v1/tokens", page: "shop.example" }); assert.equal(x.rule, "page-payment-idle");
  R._buyClickAt = Date.now(); const q = ask({ host: "api.stripe.com", path: "/v1/tokens", page: "shop.example" }); await new Promise((z) => setTimeout(z, 50));
  assert.equal(seen[0]?.t, "approval"); await R.decideApproval(seen[0].approval.id, "deny"); await q; R._buyClickAt = 0; }
// 4. a request carrying a saved key still asks (not covered), as does a key operation by a page
for (const o of [{ keys: ["GROK_KEY"] }, { host: "api.example.com", path: "/v1/api_keys", method: "GET" }]) {
  seen.length = 0; const q = ask(o); await new Promise((z) => setTimeout(z, 50)); assert.equal(seen[0]?.t, "approval", JSON.stringify(o)); await R.decideApproval(seen[0].approval.id, "deny"); await q;
}
// 5. a command's POST to a payment path is unchanged (asks); a browser form too
for (const via of ["command", "form"]) { seen.length = 0; const q = ask({ via, page: "" }); await new Promise((z) => setTimeout(z, 50)); assert.equal(seen[0]?.t, "approval", via); await R.decideApproval(seen[0].approval.id, "deny"); await q; }
// 6. ordinary page background POSTs still go out on the policy, never reaching the Resident
assert.equal(egressRule({ env: {}, headers: H(XHR), host: "api.x.com", method: "POST", path: "/1.1/onboarding/task.json" }).rule, "browser-page");

// 7. a pending plain request nobody answered for an hour stops showing as waiting (read-only: the row is not written)
sql.exec("INSERT INTO approvals (at,host,method,path,bytes,keys,status) VALUES (?,?,?,?,?,?,'pending')", Date.now() - 2 * 3600e3, "grok.com", "POST", "/x", 55, "[]");
sql.exec("INSERT INTO approvals (at,host,method,path,bytes,keys,status) VALUES (?,?,?,?,?,?,'pending')", Date.now() - 60e3, "fresh.example", "POST", "/x", 5, "[]");
const shown = R.approvals().map((a) => a.host); assert.deepEqual(shown, ["fresh.example"]);

console.log("page-payment-idle ok");
