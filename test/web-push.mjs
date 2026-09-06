import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("browser push identity, registration, preferences, and durable fan-out stay user scoped", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "1helm-web-push-"));
  process.env.CTRL_DATA_DIR = dataDir;
  const db = await import("../src/server/db.ts");
  const push = await import("../src/server/mobile-push.ts");
  try {
    db.seed();
    const sender = db.run("INSERT INTO users (username,pass,display,is_admin,created) VALUES ('sender','x','Sender',1,?)", db.now()).lastInsertRowid;
    const recipient = db.run("INSERT INTO users (username,pass,display,is_admin,created) VALUES ('recipient','x','Recipient',0,?)", db.now()).lastInsertRowid;
    const muted = db.run("INSERT INTO users (username,pass,display,is_admin,created) VALUES ('muted','x','Muted',0,?)", db.now()).lastInsertRowid;
    const channel = db.q1("SELECT id,slug FROM channels WHERE kind='channel' LIMIT 1");
    for (const userId of [sender, recipient, muted]) db.run("INSERT OR IGNORE INTO members (channel_id,user_id) VALUES (?,?)", channel.id, userId);
    const subscription = (suffix) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${suffix}`, keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) } });
    assert.throws(() => push.registerWebPush(recipient, { ...subscription("unsafe"), endpoint: "https://127.0.0.1/internal" }), /invalid/, "subscriptions cannot turn notification delivery into SSRF");
    push.registerWebPush(recipient, subscription("recipient"));
    push.registerWebPush(muted, subscription("muted"));
    db.run("INSERT INTO user_ui_state (user_id,key,value,updated) VALUES (?,'notification_preferences',?,?)", muted, JSON.stringify({ channels: { [channel.id]: { muted: true } } }), db.now());
    const messageId = db.run("INSERT INTO messages (channel_id,user_id,body,created) VALUES (?,?,?,?)", channel.id, sender, "Browser delivery", db.now()).lastInsertRowid;
    const event = { type: "message", message: { id: messageId, channel_id: channel.id, parent_id: null, body: "Browser delivery", author: { kind: "user", id: sender, name: "Sender" }, attachments: [], progress: [] } };
    push.queueWebPush(channel.id, event);
    push.queueWebPush(channel.id, event);
    const rows = db.q("SELECT * FROM web_push_outbox");
    assert.equal(rows.length, 1, "sender, muted recipient, and duplicate event are excluded");
    const payload = JSON.parse(rows[0].payload);
    assert.equal(payload.channelSlug, channel.slug);
    assert.equal(payload.messageId, messageId);
    assert.equal(push.webPushStatus(recipient, subscription("recipient").endpoint).registered, true);
    const firstKey = push.webPushPublicKey();
    const secondKey = push.webPushPublicKey();
    assert.equal(firstKey, secondKey, "the installation retains one stable VAPID identity");
    assert.equal((await stat(join(dataDir, "web-push-vapid.json"))).mode & 0o777, 0o600);
    push.unregisterWebPush(recipient, subscription("recipient").endpoint);
    assert.equal(push.webPushStatus(recipient, subscription("recipient").endpoint).registered, false);
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});
