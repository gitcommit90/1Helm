// node --import ./test/stubs/register.mjs test/mobile-compatibility.test.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/index.js";

const sql = new DatabaseSync(":memory:");
sql.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT);
  CREATE TABLE sessions (token_hash TEXT, user_id TEXT, expires_at INTEGER);
  CREATE TABLE tenants (owner_user_id TEXT, slug TEXT, host_ready INTEGER, status TEXT, onboarding_completed INTEGER, onboard_step TEXT, slug_chosen INTEGER);`);
const env = { ONEHELM_EE: "1hc", APP_HOST: "app.example.com", PUBLIC_BASE_DOMAIN: "example.com", DB: { prepare(query) { let args = []; const statement = sql.prepare(query); const bound = {
  bind(...values) { args = values; return bound; }, first: async () => statement.get(...args) ?? null,
}; return bound; } } };
const ctx = { waitUntil() {} };
async function check(host = "app.example.com") {
  const response = await worker.fetch(new Request(`https://${host}/api/mobile/compatibility`), env, ctx);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("access-control-allow-origin"), "*", "the local mobile gateway must be able to read this public GET");
  const body = await response.json();
  assert.equal(body.product, "1Helm");
  assert.equal(body.mobile_api, 1);
  assert.equal(body.requires_https, true);
  assert.match(body.version, /^\d+$/);
  return body;
}

assert.deepEqual([ (await check()).has_users, (await check()).setup_complete ], [false, false]);
sql.exec("INSERT INTO users VALUES ('u1','owner@example.com'); INSERT INTO tenants VALUES ('u1','owner',1,'pending',0,'',0);");
assert.deepEqual([ (await check()).has_users, (await check()).setup_complete ], [true, false]);
sql.exec("UPDATE tenants SET status='active',onboarding_completed=1,onboard_step='reach',slug_chosen=1;");
assert.equal((await check()).setup_complete, false, "unfinished onboarding is not a ready server");
sql.exec("UPDATE tenants SET onboard_step='done';");
assert.equal((await check("owner.example.com")).setup_complete, true, "the compatibility route stays public on workspace hosts");
sql.exec("UPDATE tenants SET onboard_step=NULL;");
assert.equal((await check()).setup_complete, true, "pre-v1 accounts with no onboarding step remain ready");
sql.exec("UPDATE tenants SET onboard_step='done';");
sql.prepare("INSERT INTO sessions VALUES (?,?,?)").run(createHash("sha256").update("aabb1122").digest("hex"), "u1", Date.now() + 60_000);
async function entry(path, userAgent) {
  return worker.fetch(new Request(`https://app.example.com${path}`, {
    headers: { cookie: "hc_session=aabb1122", "user-agent": userAgent }, redirect: "manual",
  }), env, ctx);
}
assert.equal((await entry("/", "Mozilla/5.0 1HelmMobile")).headers.get("location"), "https://app.example.com/w/owner/app");
assert.equal((await entry("/auth/to", "Mozilla/5.0 1HelmMobile")).headers.get("location"), "https://app.example.com/w/owner/app");
assert.match((await entry("/", "Mozilla/5.0 desktop")).headers.get("location"), /\/auth\/to\?/,
  "browser sign-in keeps the workspace handoff");
console.log("  ok mobile compatibility contract and setup states");
