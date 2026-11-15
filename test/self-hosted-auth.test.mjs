// Real Worker auth routes with a fresh self-hosted D1. No Stripe, plan setup, or EE bindings.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { ageCookie } from "../src/age-gate.js";
import { readFileSync, readdirSync } from "node:fs";
const worker = (await import("../src/index.js")).default;
const sql = new DatabaseSync(":memory:");
const migrations = new URL("../db/migrations/", import.meta.url);
for (const name of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL(name, migrations), 'utf8'));
const prepare = (query) => {
  const stmt = sql.prepare(query); let args = [];
  const bound = { bind(...next) { args = next; return bound; }, first: async () => stmt.get(...args) || null,
    all: async () => ({ results: stmt.all(...args) }), run: async () => ({ meta: { changes: Number(stmt.run(...args).changes) } }), _run: () => stmt.run(...args) };
  return bound;
};
const DB = { prepare, batch: async (statements) => {
  sql.exec("BEGIN"); try { for (const statement of statements) statement._run(); sql.exec("COMMIT"); }
  catch (error) { sql.exec("ROLLBACK"); throw error; }
} };
let provisions = 0;
const env = { DB, APP_HOST: "owner.example.com", ARCHIVE: { idFromName: (name) => name, get: () => ({ provisionFresh: async () => { provisions++; } }) },
  LEDGER: { idFromName: (name) => name, get: () => ({}) } };
const sha = (value) => createHash("sha256").update(value).digest("hex");
const call = (path, cookie = "") => worker.fetch(new Request(`https://owner.example.com${path}`, { headers: cookie ? { cookie } : {} }), env, { waitUntil() {} });
assert.equal((await worker.fetch(new Request("https://owner.example.com/admin/reconcile", { method: "POST" }), { ...env, TEST_MODE: "1" }, { waitUntil() {} })).status, 404,
  "test mode must not expose an unauthenticated reconcile route on a public install");
const magic = (token, email) => sql.prepare("INSERT INTO magic_links (token_hash,email,expires_at) VALUES (?,?,?)").run(sha(token), email, Date.now() + 60_000);

let response = await call("/onboard");
assert.equal(response.status, 200);
let html = await response.text();
assert.match(html, /first address to complete sign-in/i);
assert.doesNotMatch(html, /\$30|Stripe|Plans from/i);
magic("first", "owner@example.com");
response = await worker.fetch(new Request("https://owner.example.com/auth/verify?token=first", { method: "HEAD" }), env, { waitUntil() {} });
assert.equal(response.status, 405);
assert.equal(sql.prepare("SELECT used FROM magic_links WHERE token_hash=?").get(sha("first")).used, 0, "HEAD must not consume the sign-in link");
response = await call("/auth/verify?token=first");
assert.equal(response.status, 302);
const cookie = response.headers.get("set-cookie").split(";")[0];
const owner = sql.prepare("SELECT * FROM users").get();
const tenant = sql.prepare("SELECT * FROM tenants").get();
assert.equal(owner.email, "owner@example.com");
assert.equal(tenant.owner_user_id, owner.id);
assert.deepEqual([tenant.status, tenant.plan, tenant.onboarding_completed, tenant.onboard_step], ["active", "byok", 1, "done"]);
assert.equal(provisions, 1);
response = await call("/onboard");
assert.equal(response.status, 200);
html = await response.text();
assert.match(html, /only this server's owner can sign in/i, "claimed server gives the returning owner accurate sign-in instructions");
assert.doesNotMatch(html, /first address to complete sign-in/i);
const sent = [], testEnv = { ...env, TEST_MODE: "1", EMAIL_FROM: "sender@example.com", EMAIL: { send: async (message) => { sent.push(message); } } };
for (const badOrigin of ["null", "https://other.example.com"]) {
  for (const path of ["/auth/start", "/auth/code", "/onboard", "/onboard/profile", "/onboard/api/email", "/onboard/api/profile"]) {
    response = await worker.fetch(new Request(`https://owner.example.com${path}`, { method: "POST", headers: { cookie, origin: badOrigin } }), testEnv, { waitUntil() {} });
    assert.equal(response.status, 403, `${path} must reject Origin: ${badOrigin}`);
  }
}
response = await worker.fetch(new Request("https://owner.example.com/onboard/api/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@example.com" }) }), testEnv, { waitUntil() {} });
const testStart = await response.json();
assert.equal(testStart.ok, true);
assert.equal(testStart.test_link, undefined, "public onboarding must never return a sign-in link in test mode");
response = await worker.fetch(new Request("https://owner.example.com/onboard/api/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "a".repeat(33_000) }) }), testEnv, { waitUntil() {} });
assert.equal(response.status, 413, "pre-sign-in onboarding JSON must have a streaming body limit");
response = await worker.fetch(new Request("https://owner.example.com/auth/start", { method: "POST", body: new URLSearchParams({ email: "owner@example.com" }) }), testEnv, { waitUntil() {} });
assert.doesNotMatch(await response.text(), /auth\/verify\?token=/, "public sign-in must never print a sign-in link in test mode");
assert.equal(sent.length, 2, "both public sign-in paths deliver email even when test mode is set");
for (const path of ["/auth/start", "/auth/code", "/auth/email-change"]) {
  response = await worker.fetch(new Request(`https://owner.example.com${path}`, { method: "POST", body: new URLSearchParams({ email: "a".repeat(9000) }) }), testEnv, { waitUntil() {} });
  assert.equal(response.status, 413, `${path} must reject an oversized form before parsing it`);
}
response = await worker.fetch(new Request("https://owner.example.com/auth/start", { method: "POST", body: new FormData() }), testEnv, { waitUntil() {} });
assert.equal(response.status, 415, "sign-in accepts only its URL-encoded browser form");
response = await call("/", cookie);
assert.equal(response.status, 302);
assert.match(response.headers.get("location"), new RegExp(`/w/${tenant.slug}/app$`));
response = await call(`/w/${tenant.slug}/app`, cookie);
assert.equal(response.status, 200);
for (const badOrigin of ["null", "https://other.example.com"]) {
  response = await worker.fetch(new Request("https://owner.example.com/auth/logout", { method: "POST", headers: { cookie, origin: badOrigin } }), env, { waitUntil() {} });
  assert.equal(response.status, 403, `sign-out must reject Origin: ${badOrigin}`);
}
assert.equal((await call(`/w/${tenant.slug}/app`, cookie)).status, 200, "cross-origin sign-out must keep the owner's session");
response = await worker.fetch(new Request(`https://owner.example.com/w/${tenant.slug}/api/soon`, {
  method: "POST", headers: { cookie, origin: "https://owner.example.com", "content-type": "application/json", "content-length": "1" }, body: "x".repeat(8_000_001),
}), env, { waitUntil() {} });
assert.equal(response.status, 413, "ordinary workspace JSON rejects an oversized stream despite a forged short length");
assert.equal((await response.json()).error, "too_large");
for (const path of ["/api/ch/main/exec", "/api/computer/exec"]) {
  let reachedComputer = false;
  const computer = { idFromName: (name) => name, get: () => new Proxy({}, { get() { reachedComputer = true; throw new Error("oversized body reached computer"); } }) };
  response = await worker.fetch(new Request(`https://owner.example.com/w/${tenant.slug}${path}`, {
    method: "POST", headers: { cookie, origin: "https://owner.example.com", "content-type": "application/json", "content-length": "1" }, body: "x".repeat(65_537),
  }), { ...env, CHANNEL_COMPUTER: computer, COMPUTER: computer }, { waitUntil() {} });
  assert.equal(response.status, 413, `${path} rejects an oversized stream despite a forged short length`);
  assert.equal((await response.json()).error, "too_large");
  assert.equal(reachedComputer, false, `${path} stops before computer work`);
}
for (const badOrigin of ["null", "https://other.example.com"]) {
  response = await worker.fetch(new Request(`https://owner.example.com/w/${tenant.slug}/api/stop-all`, { method: "POST", headers: { cookie, origin: badOrigin } }), env, { waitUntil() {} });
  assert.equal(response.status, 403, `workspace API must reject Origin: ${badOrigin}`);
}
const fileEnv = { ...env,
  ARCHIVE: { idFromName: (name) => name, get: () => ({ channels: async () => [{ id: 1, slug: "main" }] }) },
  RESIDENT: { idFromName: (name) => name, get: () => new Proxy({}, { get: () => { throw new Error("invalid upload reached Resident"); } }) },
  WS: { put: () => { throw new Error("invalid upload reached R2"); } },
};
const filePost = (path, length) => worker.fetch(new Request(`https://owner.example.com/w/${tenant.slug}/api/res/main/files${path}`, {
  method: "POST", headers: { cookie, origin: "https://owner.example.com", ...(length === null ? {} : { "content-length": length }) }, body: "x",
}), fileEnv, { waitUntil() {} });
assert.equal((await filePost("", null)).status, 411, "upload requires Content-Length");
for (const path of ["", "/00000000-0000-4000-8000-000000000000/view"]) {
  for (const length of ["NaN", "Infinity", "1e2", "1.5", "-1", "9007199254740993"]) {
    response = await filePost(path, length);
    assert.equal(response.status, 400, `${path || "upload"} rejects malformed Content-Length ${length}`);
  }
  response = await filePost(path, String(path ? 3 * 1024 * 1024 + 1 : 50 * 1024 * 1024 + 1));
  assert.equal(response.status, 413, `${path || "upload"} rejects a declared oversized body before R2`);
}
response = await worker.fetch(new Request(`https://owner.example.com/w/${tenant.slug}/api/contacts/import`, {
  method: "POST", headers: { cookie, origin: "https://owner.example.com", "content-type": "application/json", "content-length": "1" }, body: "x".repeat(8_000_001),
}), env, { waitUntil() {} });
assert.equal(response.status, 413, "contacts import rejects an oversized stream despite a forged short length");
for (const op of ["stream", "chat"]) {
  response = await worker.fetch(new Request(`https://owner.example.com/w/${tenant.slug}/api/res/main/${op}`, {
    method: "POST", headers: { cookie, origin: "https://owner.example.com", "content-type": "application/json", "content-length": "1" }, body: "x".repeat(65_537),
  }), fileEnv, { waitUntil() {} });
  assert.equal(response.status, 413, `${op} rejects an oversized stream before reaching Resident`);
  assert.equal((await response.json()).error, "too_large", `${op} returns a JSON API error`);
}
for (const path of ["/api/apps", "/api/bee", "/api/texting", "/api/plan/change", "/api/portal", "/api/meetings/test", "/api/res/main/event-log", "/api/res/main/event-workflow"]) {
  response = await call(`/w/${tenant.slug}${path}`, cookie);
  assert.equal(response.status, 404, `${path} must remain unavailable to a self-hosted owner`);
}
const cardEnv = { ...env, DB: { prepare: () => { throw new Error("hosted card reached D1"); } } };
response = await worker.fetch(new Request("https://owner.example.com/c/abcdefghijklmnopqrstuvwxyz012345"), cardEnv, { waitUntil() {} });
assert.equal(response.status, 404, "hosted text cards must stop at the EE gate before D1");
response = await call("/stripe/webhook");
assert.equal(response.status, 404, "billing webhook must remain unavailable without EE");

magic("second", "other@example.com");
response = await call("/auth/verify?token=second");
assert.equal(response.status, 200);
assert.match(await response.text(), /already has an owner/);
assert.equal(sql.prepare("SELECT COUNT(*) n FROM users").get().n, 1);
assert.equal(sql.prepare("SELECT COUNT(*) n FROM sessions").get().n, 1);
magic("return", "owner@example.com");
response = await call("/auth/verify?token=return");
assert.equal(response.status, 302);
assert.equal(provisions, 1);
sql.prepare("UPDATE tenants SET host_ready=1 WHERE id=?").run(tenant.id);
const hostedEnv = { ...env, ONEHELM_EE: "1hc", VAULT_KEY: "synthetic-test-age-key", APP_HOST: "app.example.com", PUBLIC_BASE_DOMAIN: "example.com" };
const ageAck = (await ageCookie(hostedEnv)).split(';')[0];
for (const path of ["/auth/start", "/auth/code"]) {
  response = await worker.fetch(new Request(`https://owner.example.com${path}`, { method: "POST", headers: { cookie: ageAck }, body: new URLSearchParams({ email: "a".repeat(9000) }) }), hostedEnv, { waitUntil() {} });
  assert.equal(response.status, 413, `hosted ${path} must reject an oversized form`);
}
const handoffStart = await worker.fetch(new Request("https://app.example.com/auth/to", { headers: { cookie } }), hostedEnv, { waitUntil() {} });
assert.equal(handoffStart.status, 302);
const handoff = handoffStart.headers.get("location"), handoffToken = new URL(handoff).searchParams.get("token");
assert.match(handoff, /^https:\/\/owner\.example\.com\/auth\/handoff\?/);
response = await worker.fetch(new Request(handoff, { method: "HEAD" }), hostedEnv, { waitUntil() {} });
assert.equal(response.status, 405);
assert.equal(sql.prepare("SELECT used FROM magic_links WHERE token_hash=?").get(sha(handoffToken)).used, 0, "HEAD must not consume the handoff");
response = await worker.fetch(new Request(handoff), hostedEnv, { waitUntil() {} });
assert.equal(response.status, 302);
assert.equal(response.headers.get("location"), `/w/${tenant.slug}/app`);
console.log("ok - self-hosted first sign-in provisions one owner and workspace; checkout is absent; later addresses are refused");
