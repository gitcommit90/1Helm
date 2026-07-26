import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("mobile push registration, preferences, durable fan-out, and idempotency stay recipient-scoped", async () => {
  const calls = [];
  const relay = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    calls.push({ path: req.url, method: req.method, authorization: req.headers.authorization || "", body: raw ? JSON.parse(raw) : {} });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, delivered: 1 }));
  });
  await new Promise((resolve) => relay.listen(0, "127.0.0.1", resolve));
  const address = relay.address();
  const dataDir = await mkdtemp(join(tmpdir(), "1helm-mobile-push-"));
  process.env.CTRL_DATA_DIR = dataDir;
  process.env.HELM_PUSH_RELAY_URL = `http://127.0.0.1:${address.port}/v1/push`;
  const db = await import("../src/server/db.ts");
  const push = await import("../src/server/mobile-push.ts");
  try {
    db.seed();
    const userA = db.run("INSERT INTO users (username,pass,display,is_admin,created) VALUES ('captain','x','Captain',1,?)", db.now()).lastInsertRowid;
    const userB = db.run("INSERT INTO users (username,pass,display,is_admin,created) VALUES ('crew','x','Crew',0,?)", db.now()).lastInsertRowid;
    const userMuted = db.run("INSERT INTO users (username,pass,display,is_admin,created) VALUES ('quiet','x','Quiet',0,?)", db.now()).lastInsertRowid;
    const channelId = Number(db.q1("SELECT id FROM channels WHERE kind='channel' LIMIT 1").id);
    for (const userId of [userA, userB, userMuted]) db.run("INSERT OR IGNORE INTO members (channel_id,user_id) VALUES (?,?)", channelId, userId);
    await push.registerMobilePush(userB, "ios", "a".repeat(64));
    await push.registerMobilePush(userB, "ios", "c".repeat(64));
    await push.registerMobilePush(userMuted, "ios", "b".repeat(64));
    db.run("INSERT INTO user_ui_state (user_id,key,value,updated) VALUES (?,'notification_preferences',?,?)", userMuted, JSON.stringify({ channels: { [channelId]: { muted: true } } }), db.now());
    const messageId = db.run("INSERT INTO messages (channel_id,user_id,body,created) VALUES (?,?,?,?)", channelId, userA, "Ready for review", db.now()).lastInsertRowid;
    const event = { type: "message", message: { id: messageId, channel_id: channelId, parent_id: null, body: "Ready for review", author: { kind: "user", id: userA, name: "Captain" }, attachments: [], progress: [] } };
    push.queueMobilePush(channelId, event);
    push.queueMobilePush(channelId, event);
    await push.drainMobilePush();
    const outbox = db.q("SELECT * FROM mobile_push_outbox ORDER BY id");
    assert.equal(outbox.length, 1, "the sender and muted member receive no push and duplicate events collapse");
    assert.equal(Number(outbox[0].user_id), userB);
    assert.equal(outbox[0].state, "delivered");
    const delivery = calls.find((call) => call.path === "/v1/push/deliveries");
    assert.match(delivery.body.recipient_id, /^[a-f0-9]{32}$/, "the relay receives only an opaque recipient identifier");
    assert.equal(delivery.body.channelId, channelId);
    assert.equal(delivery.body.messageId, messageId);
    assert.match(delivery.body.idempotency_key, new RegExp(`:${userB}:${messageId}$`));
    assert.ok(calls.filter((call) => call.path === "/v1/push/installations").length >= 1);
    assert.ok(calls.every((call) => !JSON.stringify(call).includes("Captain')") && !Object.hasOwn(call.body, "user_id")), "SQL, local user IDs, and server internals are never relayed");
    assert.equal(push.mobilePushStatus(userB, "ios", "a".repeat(64)).registered, true, "status is scoped to this physical device token");
    await push.unregisterMobilePush(userB, "ios", "a".repeat(64));
    assert.equal(push.mobilePushStatus(userB, "ios", "a".repeat(64)).registered, false);
    assert.equal(push.mobilePushStatus(userB, "ios", "c".repeat(64)).registered, true, "turning off one iPhone leaves the account's other iPhone registered");
  } finally {
    relay.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
