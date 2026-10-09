import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { textingWebhook } from "../src/ee/texting.js";
import { sealSecret } from "../src/sentinel.js";

const sql = new DatabaseSync(":memory:");
sql.exec(readFileSync(new URL("../db/migrations/0001_012_full_schema_dev.sql", import.meta.url), "utf8"));
const DB = { prepare(query) { const stmt = sql.prepare(query); let args = [];
  const bound = { bind(...next) { args = next; return bound; }, first: async () => stmt.get(...args) || null,
    run: async () => ({ meta: { changes: Number(stmt.run(...args).changes) } }) };
  return bound;
} };
const tenant = "owner-a", phone = "+14155550123", hookId = "0123456789abcdef0123456789abcdef", secret = "local-webhook-secret";
const env = { DB, VAULT_KEY: Buffer.alloc(32, 9).toString("base64"), APP_HOST: "example.com" };
sql.prepare("INSERT INTO tenants (id,slug,owner_user_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?)").run(tenant, "owner", "u1", "active", Date.now(), Date.now());
sql.prepare("INSERT INTO texting (tenant_id,hook_id,phone,status,webhook_secret_sealed,updated_at) VALUES (?,?,?,?,?,?)")
  .run(tenant, hookId, phone, "connected", await sealSecret(env, secret), Date.now());
let attempts = 0;
env.RESIDENT = { idFromName: (name) => name, get(name) {
  assert.equal(name, `res:${tenant}:main`);
  return { textInbound: async () => { attempts++; if (attempts === 1) throw new Error("temporary Resident failure"); return { ok: true }; } };
} };
const messageId = "spc-msg-webhook-retry";
const request = (id = messageId) => {
  const body = JSON.stringify({ event: "messages", message: {
    id, sender: { id: phone }, content: { type: "text", text: "hello" },
  } });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = "v0=" + createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex");
  return new Request(`https://example.com/hooks/photon/${hookId}`, { method: "POST", body,
    headers: { "x-spectrum-timestamp": ts, "x-spectrum-signature": sig } });
};
const ctx = { waitUntil() {} };

assert.equal((await textingWebhook(request(), env, ctx, hookId)).status, 503, "failed Resident admission must ask for retry");
assert.equal(sql.prepare("SELECT COUNT(*) n FROM texting_seen").get().n, 0, "failed admission releases the replay reservation");
assert.equal((await textingWebhook(request(), env, ctx, hookId)).status, 200);
assert.equal(sql.prepare("SELECT COUNT(*) n FROM texting_seen").get().n, 1);
assert.equal((await textingWebhook(request(), env, ctx, hookId)).status, 200, "delivered duplicate is acknowledged");
assert.equal(attempts, 2, "delivered duplicate does not enter Resident again");
let release;
env.RESIDENT.get = () => ({ textInbound: () => new Promise((resolve) => { release = resolve; }) });
const pendingId = "spc-msg-inflight";
const pending = textingWebhook(request(pendingId), env, ctx, hookId);
while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal((await textingWebhook(request(pendingId), env, ctx, hookId)).status, 503, "an in-flight delivery is not falsely acknowledged");
release({ ok: true });
assert.equal((await pending).status, 200);
assert.equal((await textingWebhook(request(pendingId), env, ctx, hookId)).status, 200, "admitted duplicate is acknowledged");
console.log("ok - failed and in-flight signed text delivery is retryable; admitted replay is deduplicated");
