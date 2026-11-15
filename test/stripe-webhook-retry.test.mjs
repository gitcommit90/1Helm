import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/index.js";

const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE stripe_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, received_at INTEGER NOT NULL); CREATE TABLE tenants (id TEXT PRIMARY KEY, stripe_customer TEXT, stripe_subscription TEXT, updated_at INTEGER)");
db.prepare("INSERT INTO tenants (id) VALUES (?)").run("tenant-1");
let pause = null;
const DB = { prepare(sql) {
  const stmt = db.prepare(sql);
  let args = [];
  const bound = { bind(...values) { args = values; return bound; }, first: async () => stmt.get(...args) ?? null,
    run: async () => {
      if (pause && sql.startsWith("UPDATE tenants SET stripe_customer=")) {
        const p = pause; pause = null; p.enter(); await p.wait; throw new Error("D1 stopped mid-delivery");
      }
      const r = stmt.run(...args); return { meta: { changes: Number(r.changes) } };
    } };
  return bound;
} };
const env = { ONEHELM_EE: "1hc", STRIPE_WEBHOOK_SECRET: "test-webhook-secret", DB };
const event = (id) => JSON.stringify({ id, type: "checkout.session.completed", data: { object: { mode: "subscription", customer: "cus_1", subscription: "sub_1", metadata: { app: "1hc-proto", tenant_id: "tenant-1" } } } });
async function deliver(id) {
  const raw = event(id), t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", env.STRIPE_WEBHOOK_SECRET).update(`${t}.${raw}`).digest("hex");
  const r = await worker.route(new Request("https://example.com/stripe/webhook", { method: "POST", headers: { "stripe-signature": `t=${t},v1=${sig}` }, body: raw }), env, {});
  return { status: r.status, body: await r.json() };
}

let enter;
const entered = new Promise((resolve) => { enter = resolve; });
let release;
const wait = new Promise((resolve) => { release = resolve; });
pause = { enter, wait };
const first = deliver("evt_concurrent");
await entered;
assert.equal((await deliver("evt_concurrent")).status, 503, "an in-flight duplicate must ask Stripe to retry");
release();
assert.equal((await first).status, 500);
assert.equal(db.prepare("SELECT COUNT(*) n FROM stripe_events WHERE id=?").get("evt_concurrent").n, 0);
assert.deepEqual(await deliver("evt_concurrent"), { status: 200, body: { ok: true } });
assert.ok(db.prepare("SELECT received_at FROM stripe_events WHERE id=?").get("evt_concurrent").received_at > 0);
assert.deepEqual(await deliver("evt_concurrent"), { status: 200, body: { duplicate: true } });

db.prepare("INSERT INTO stripe_events VALUES (?,?,?)").run("evt_abandoned", "checkout.session.completed", -(Date.now() - 3 * 60_000));
assert.deepEqual(await deliver("evt_abandoned"), { status: 200, body: { ok: true } });
assert.ok(db.prepare("SELECT received_at FROM stripe_events WHERE id=?").get("evt_abandoned").received_at > 0);
console.log("ok - Stripe webhook duplicates wait for completion and abandoned reservations can be retried");
