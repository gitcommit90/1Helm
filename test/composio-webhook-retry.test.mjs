import assert from "node:assert/strict";
import { composioWebhook, signBody } from "../src/ee/composio-triggers.js";

const secret = "synthetic-webhook-secret";
const id = "synthetic-event-1";
const seen = new Set();
let attempts = 0;
const mapping = { trigger_id: "synthetic-trigger", tenant_id: "synthetic-tenant", channel: "main", workflow_id: 7, slug: "MAIL_NEW_MESSAGE", status: "active" };
const db = { prepare(query) {
  return { bind(...args) {
    return {
      async first() {
        if (query.startsWith("SELECT * FROM composio_triggers")) return mapping;
        throw new Error(`unexpected read: ${query}`);
      },
      async run() {
        if (query.startsWith("INSERT OR IGNORE INTO composio_webhook_seen")) {
          if (seen.has(args[0])) return { meta: { changes: 0 } };
          seen.add(args[0]); return { meta: { changes: 1 } };
        }
        if (query.startsWith("DELETE FROM composio_webhook_seen WHERE id=")) {
          seen.delete(args[0]); return { meta: { changes: 1 } };
        }
        if (query.startsWith("DELETE FROM composio_webhook_seen WHERE at<")) return { meta: { changes: 0 } };
        if (query.startsWith("UPDATE composio_triggers SET status=")) return { meta: { changes: 1 } };
        throw new Error(`unexpected write: ${query}`);
      },
    };
  } };
} };
const env = { DB: db, COMPOSIO_WEBHOOK_SECRET: secret, RESIDENT: {
  idFromName: (name) => name,
  get: () => ({ async appEvent(event) {
    attempts++;
    assert.equal(event.event_id, id);
    if (attempts === 1) throw new Error("synthetic delivery failure");
    return { queued: true };
  } }),
} };
const body = JSON.stringify({ type: "composio.trigger.message", metadata: { trigger_id: mapping.trigger_id, user_id: "1hc:synthetic-tenant" }, data: { subject: "hello" } });
const timestamp = String(Math.floor(Date.now() / 1000));
const send = async (eventId = id, payload = body) => {
  const signature = await signBody(secret, eventId, timestamp, payload);
  return composioWebhook(new Request("https://example.org/composio/webhook", { method: "POST", headers: {
    "content-type": "application/json", "webhook-id": eventId, "webhook-timestamp": timestamp, "webhook-signature": `v1,${signature}`,
  }, body: payload }), env);
};

let response = await send();
assert.equal(response.status, 500, "failed delivery asks the provider to retry");
assert.equal(seen.has(id), false, "failed delivery releases its replay reservation");
response = await send();
assert.equal(response.status, 200); assert.equal((await response.json()).queued, true);
assert.equal(attempts, 2);
response = await send();
assert.equal(response.status, 409, "delivered event stays replay protected");
assert.equal(attempts, 2);

let disabledAttempts = 0;
env.RESIDENT.get = () => ({ async triggerDisabled() {
  disabledAttempts++;
  if (disabledAttempts === 1) throw new Error("synthetic disable failure");
  return { paused: true };
} });
const disabledId = "synthetic-disabled-1";
const disabledBody = JSON.stringify({ type: "composio.trigger.disabled", metadata: { trigger_id: mapping.trigger_id, user_id: "1hc:synthetic-tenant" }, data: { reason: "account expired" } });
response = await send(disabledId, disabledBody);
assert.equal(response.status, 500);
assert.equal(seen.has(disabledId), false, "failed disable notice remains retryable");
response = await send(disabledId, disabledBody);
assert.equal(response.status, 200); assert.equal((await response.json()).paused, true);
assert.equal(disabledAttempts, 2);
console.log("composio webhook retry: ok");
