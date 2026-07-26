import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "1helm-photon-"));
process.env.CTRL_DATA_DIR = dataDir;
let spectrumRequests = 0;
const server = createServer((req, res) => {
  spectrumRequests++;
  if (req.headers.authorization !== `Basic ${Buffer.from("project:valid-project-secret").toString("base64")}`) {
    res.writeHead(401, { "content-type": "application/json" }); res.end('{"error":"unauthorized"}'); return;
  }
  res.writeHead(200, { "content-type": "application/json" }); res.end('{"data":{"users":[]}}');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
process.env.PHOTON_SPECTRUM_HOST = `http://127.0.0.1:${port}`;
process.env.PHOTON_SIDECAR_PATH = join(dataDir, "mock-sidecar.mjs");
writeFileSync(process.env.PHOTON_SIDECAR_PATH, `
import { createServer } from "node:http";
const token = process.env.PHOTON_SIDECAR_TOKEN;
let sent = 0;
const server = createServer(async (req,res) => {
  if (req.headers["x-1helm-photon-token"] !== token) { res.writeHead(401); res.end("{}"); return; }
  const reply = (value) => { const body=JSON.stringify(value); res.writeHead(200,{"content-type":"application/json"}); res.end(body); };
  if (req.url === "/health") return reply({ok:true});
  if (req.url === "/next") return setTimeout(() => reply({ok:true,event:null}), 25);
  if (req.url === "/send") return reply({ok:true,message_id:"sent-"+(++sent)});
  if (req.url === "/shutdown") { reply({ok:true}); return setTimeout(() => process.exit(0), 10); }
  res.writeHead(404); res.end("{}");
});
server.listen(Number(process.env.PHOTON_SIDECAR_PORT),"127.0.0.1");
process.stdin.resume(); process.stdin.on("end",()=>process.exit(0));
`);

const { db, migrate, now, q, q1, run, seed } = await import("../src/server/db.ts");
const photon = await import("../src/server/photon.ts");
const photonAuth = await import("../src/server/photon-auth.ts");
const { createPhotonInboundQueue } = await import("../src/server/photon-queue.mjs");

function skipperFixture() {
  seed();
  let owner = q1("SELECT * FROM users WHERE username='captain'");
  if (!owner) {
    const ownerId = run("INSERT INTO users (username,display,pass,is_admin,created) VALUES ('captain','Captain','x',1,?)", now()).lastInsertRowid;
    owner = q1("SELECT * FROM users WHERE id=?", ownerId);
  }
  const channel = q1("SELECT * FROM channels WHERE name='main'");
  run("UPDATE channels SET personal_main_owner_id=?,created_by=? WHERE id=?", owner.id, owner.id, channel.id);
  run("INSERT OR IGNORE INTO members (channel_id,user_id) VALUES (?,?)", channel.id, owner.id);
  let agent = q1("SELECT * FROM agents WHERE kind='skipper'");
  if (!agent) {
    const botId = run("INSERT INTO bots (name,model,created) VALUES ('skipper','mock',?)", now()).lastInsertRowid;
    const agentId = run("INSERT INTO agents (bot_id,kind,name,display_name,status,created) VALUES (?,'skipper','skipper','Skipper','ready',?)", botId, now()).lastInsertRowid;
    agent = q1("SELECT * FROM agents WHERE id=?", agentId);
  }
  photon.photonStatus();
  return { channelId: Number(channel.id), agentId: Number(agent.id), ownerId: Number(owner.id) };
}

test("Photon setup validates before saving and redacts credentials from status", async () => {
  await assert.rejects(() => photon.configurePhoton({ project_id: "project", project_secret: "invalid-secret-x", operator_phone: "+15551234567" }), /rejected.*Nothing was saved/i);
  assert.equal(photon.photonStatus().configured, false);
  const status = await photon.configurePhoton({ project_id: "project", project_secret: "valid-project-secret", operator_phone: "+15551234567", assigned_phone: "+15557654321" });
  assert.equal(status.configured, true);
  assert.equal(status.connected, true);
  assert.equal(status.secret, "stored");
  assert.equal(JSON.stringify(status).includes("valid-project-secret"), false);
  assert.equal(spectrumRequests >= 2, true);
});

test("Photon is bound only to private #main Skipper and exposes no channel mappings", () => {
  const { channelId } = skipperFixture();
  const coworkerId = run("INSERT INTO users (username,display,pass,is_admin,created) VALUES ('photon-coworker','Coworker','x',0,?)", now()).lastInsertRowid;
  const coworkerMain = run("INSERT INTO channels (name,slug,kind,status,personal_main_owner_id,created_by,created) VALUES ('main','coworker-main','channel','active',?,?,?)", coworkerId, coworkerId, now()).lastInsertRowid;
  migrate();
  assert.equal(q1("SELECT COUNT(*) n FROM photon_channel_mappings WHERE channel_id=?", channelId).n, 0);
  assert.equal(q1("SELECT COUNT(*) n FROM photon_channel_mappings WHERE channel_id=?", coworkerMain).n, 0, "a coworker's private #main can never become the Captain's Texts inbox");
  assert.equal(photon.photonStatus().mappings, undefined);
});

test("Photon inbound delivery accepts only the Captain and invokes Skipper", async () => {
  skipperFixture();
  const channel = q1("SELECT id FROM channels WHERE name='main'");
  const dispatched = [];
  photon.registerPhotonDispatcher((bot, channelId, triggerId, rootId) => dispatched.push({ bot: bot.name, channelId, triggerId, rootId }));
  assert.equal(await photon.deliverPhotonEvent({ id: "blocked-1", space_id: "space-blocked", space_type: "dm", sender: "+15550000000", text: "not allowed", timestamp: new Date().toISOString() }), false);
  assert.equal(q1("SELECT COUNT(*) n FROM photon_messages WHERE external_id='blocked-1'").n, 0);
  const event = { id: "allowed-1", space_id: "space-allowed", space_type: "dm", sender: "+15551234567", text: "please handle this", timestamp: new Date().toISOString() };
  assert.equal(await photon.deliverPhotonEvent(event), true);
  assert.equal(await photon.deliverPhotonEvent(event), false);
  assert.equal(q1("SELECT COUNT(*) n FROM photon_messages WHERE external_id='allowed-1'").n, 1);
  assert.equal(q("SELECT * FROM messages WHERE channel_id=? AND system_message=1", channel.id).length, 1);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].channelId, channel.id);
});

test("Photon keeps one durable Skipper text thread until exact /new", async () => {
  skipperFixture();
  const channel = q1("SELECT id FROM channels WHERE name='main'");
  const dispatched = [];
  photon.registerPhotonDispatcher((_bot, channelId, triggerId, rootId) => dispatched.push({ channelId, triggerId, rootId }));
  const sender = "+15551234567";
  await photon.deliverPhotonEvent({ id: "same-thread-reset", space_id: "space-persist-reset", space_type: "dm", sender, text: "/new", timestamp: new Date().toISOString() });
  assert.equal(await photon.deliverPhotonEvent({ id: "same-thread-1", space_id: "space-persist-a", space_type: "dm", sender, text: "first", timestamp: new Date().toISOString() }), true);
  assert.equal(await photon.deliverPhotonEvent({ id: "same-thread-2", space_id: "space-persist-b", space_type: "dm", sender, text: "second", timestamp: new Date().toISOString() }), true);
  const first = q1("SELECT message_id FROM photon_messages WHERE external_id='same-thread-1'");
  const second = q1("SELECT message_id FROM photon_messages WHERE external_id='same-thread-2'");
  assert.equal(q1("SELECT parent_id FROM messages WHERE id=?", second.message_id).parent_id, first.message_id, "later texts append beneath the first root even if Photon changes space ids");
  assert.equal(dispatched.at(-1).rootId, first.message_id);
  const activeBefore = q1("SELECT * FROM photon_conversations WHERE channel_id=? AND sender=? AND active=1", channel.id, sender);
  assert.equal(activeBefore.root_message_id, first.message_id);

  await photon.restartPhotonConnector();
  assert.equal(await photon.deliverPhotonEvent({ id: "same-thread-after-restart", space_id: "space-persist-restart", space_type: "dm", sender, text: "after restart", timestamp: new Date().toISOString() }), true);
  const afterRestart = q1("SELECT message_id FROM photon_messages WHERE external_id='same-thread-after-restart'");
  assert.equal(q1("SELECT parent_id FROM messages WHERE id=?", afterRestart.message_id).parent_id, first.message_id, "connector restarts retain the same active thread");

  const dispatchCount = dispatched.length;
  assert.equal(await photon.deliverPhotonEvent({ id: "same-thread-new", space_id: "space-persist-b", space_type: "dm", sender, text: " /new ", timestamp: new Date().toISOString() }), true);
  assert.equal(dispatched.length, dispatchCount, "/new is a connector control and never invokes the resident");
  assert.equal(q1("SELECT COUNT(*) n FROM photon_conversations WHERE channel_id=? AND sender=? AND active=1", channel.id, sender).n, 0);

  assert.equal(await photon.deliverPhotonEvent({ id: "same-thread-3", space_id: "space-persist-c", space_type: "dm", sender, text: "fresh", timestamp: new Date().toISOString() }), true);
  const third = q1("SELECT message_id FROM photon_messages WHERE external_id='same-thread-3'");
  assert.equal(q1("SELECT parent_id FROM messages WHERE id=?", third.message_id).parent_id, null);
  assert.notEqual(third.message_id, first.message_id);
  assert.equal(q1("SELECT COUNT(*) n FROM photon_conversations WHERE channel_id=? AND sender=?", channel.id, sender).n >= 2, true, "conversation history survives the reset");
});

test("Photon accepts /new when no conversation has ever been opened", async () => {
  skipperFixture();
  const sender = "+15551234567";
  const channel = q1("SELECT id FROM channels WHERE name='main'");
  await photon.deliverPhotonEvent({ id: "close-before-first-ever", space_id: "space-close", space_type: "dm", sender, text: "/new", timestamp: new Date().toISOString() });
  let dispatched = false;
  photon.registerPhotonDispatcher(() => { dispatched = true; });
  assert.equal(await photon.deliverPhotonEvent({ id: "first-ever-new", space_id: "space-first-new", space_type: "dm", sender, text: "/NEW", timestamp: new Date().toISOString() }), true);
  assert.equal(dispatched, false);
  assert.equal(q1("SELECT COUNT(*) n FROM photon_conversations WHERE channel_id=? AND sender=? AND active=1", channel.id, sender).n, 0);
  assert.equal(q1("SELECT source_message_id FROM connector_deliveries WHERE idempotency_key='photon:event:first-ever-new:new'").source_message_id, null);
});

test("Photon migrates an existing mapped-channel thread into Captain #main without splitting it", () => {
  const sender = "+15551112222";
  const main = q1(`SELECT c.id FROM channels c JOIN users u ON u.id=c.personal_main_owner_id
    WHERE c.name='main' AND u.is_admin=1`);
  const channelId = run("INSERT INTO channels (name,slug,kind,status,created) VALUES ('legacy-photon','legacy-photon','channel','active',?)", now()).lastInsertRowid;
  const stamp = now();
  const rootId = run("INSERT INTO messages (channel_id,parent_id,body,system_message,created) VALUES (?,NULL,?,1,?)", channelId, `[Photon iMessage from ${sender}]\nexisting conversation`, stamp).lastInsertRowid;
  const replyId = run("INSERT INTO messages (channel_id,parent_id,body,system_message,created) VALUES (?,?,?,1,?)", channelId, rootId, "existing reply", stamp + 1).lastInsertRowid;
  const threadId = run("INSERT INTO threads (root_message_id,channel_id,status,title,summary,opened_at,updated_at) VALUES (?,?,'open','Existing Photon conversation','',?,?)", rootId, channelId, stamp, stamp).lastInsertRowid;
  run("INSERT INTO photon_messages (channel_id,external_id,space_id,sender,direction,body,received_at,message_id) VALUES (?,?,?,?, 'inbound',?,?,?)", channelId, "pre-upgrade", "space-pre-upgrade", sender, "existing conversation", stamp, rootId);
  run("INSERT INTO photon_messages (channel_id,external_id,space_id,sender,direction,body,received_at,message_id) VALUES (?,?,?,?, 'outbound',?,?,?)", channelId, "pre-upgrade-reply", "space-pre-upgrade", "1Helm", "existing reply", stamp + 1, replyId);
  run("INSERT INTO photon_channel_mappings (channel_id,allowed_users,created,updated) VALUES (?,?,?,?)", channelId, JSON.stringify([sender]), stamp, stamp);

  migrate();

  const conversation = q1("SELECT * FROM photon_conversations WHERE channel_id=? AND sender=? AND active=1", main.id, sender);
  assert.equal(conversation.root_message_id, rootId);
  assert.equal(conversation.thread_id, threadId);
  assert.equal(q1("SELECT channel_id,photon_conversation_id FROM messages WHERE id=?", rootId).channel_id, main.id);
  assert.equal(q1("SELECT channel_id,photon_conversation_id FROM messages WHERE id=?", replyId).photon_conversation_id, conversation.id);
  assert.equal(q1("SELECT channel_id FROM threads WHERE id=?", threadId).channel_id, main.id);
  assert.equal(q1("SELECT COUNT(*) n FROM photon_messages WHERE message_id IN (?,?) AND channel_id=?", rootId, replyId, main.id).n, 2);
  assert.equal(q1("SELECT COUNT(*) n FROM photon_channel_mappings").n, 0, "legacy mapping rows are deleted after migration");
});

test("Photon returns the completed 1Helm reply exactly once to the inbound conversation", async () => {
  const channel = q1("SELECT id FROM channels WHERE name='main'");
  const bot = q1("SELECT b.id FROM bots b JOIN agents a ON a.bot_id=b.id WHERE a.kind='skipper'");
  photon.registerPhotonDispatcher(async (_bot, channelId, _triggerId, rootId) => {
    run("INSERT INTO messages (channel_id,parent_id,bot_id,body,created) VALUES (?,?,?,?,?)", channelId, rootId, bot.id, "Automatic Photon answer", now());
  });
  await photon.deliverPhotonEvent({ id: "reply-new-1", space_id: "space-reply", space_type: "dm", sender: "+15551234567", text: "/new", timestamp: new Date().toISOString() });
  const event = { id: "reply-1", space_id: "space-reply", space_type: "dm", sender: "+15551234567", text: "please reply", timestamp: new Date().toISOString() };
  assert.equal(await photon.deliverPhotonEvent(event), true);
  assert.equal(q1("SELECT COUNT(*) n FROM messages WHERE channel_id=? AND parent_id=(SELECT root_message_id FROM photon_conversations WHERE channel_id=? AND sender=? AND active=1) AND bot_id=?", channel.id, channel.id, "+15551234567", bot.id).n, 1, "the agent answer is retained in its 1Helm thread");
  assert.equal(q1("SELECT COUNT(*) n FROM photon_messages WHERE channel_id=? AND space_id='space-reply' AND direction='outbound' AND body='Automatic Photon answer'", channel.id).n, 1, "the completed answer is sent back once");

  const active = q1("SELECT id FROM photon_conversations WHERE channel_id=? AND sender=? AND active=1", channel.id, "+15551234567");
  const before = q1("SELECT COUNT(*) n FROM photon_messages WHERE channel_id=? AND direction='outbound'", channel.id).n;
  photon.registerPhotonDispatcher(async (_bot, channelId, _triggerId, rootId) => {
    const id = run("INSERT INTO messages (channel_id,parent_id,bot_id,body,created) VALUES (?,?,?,?,?)", channelId, rootId, bot.id, "Desktop-only answer", now()).lastInsertRowid;
    run("UPDATE messages SET photon_conversation_id=? WHERE id=?", active.id, id);
  });
  await photon.continuePhotonConversation(skipperFixture().ownerId, Number(active.id), "continue on desktop");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(q1("SELECT COUNT(*) n FROM photon_messages WHERE channel_id=? AND direction='outbound'", channel.id).n, before, "desktop continuation does not mirror messages to the phone");
  assert.match(JSON.stringify(photon.photonConversation(skipperFixture().ownerId, Number(active.id))), /continue on desktop.*Desktop-only answer/);

  await photon.deliverPhotonEvent({ id: "resume-new-reset", space_id: "space-resume", space_type: "dm", sender: "+15551234567", text: "/new", timestamp: new Date().toISOString() });
  await photon.deliverPhotonEvent({ id: "resume-new-thread", space_id: "space-resume", space_type: "dm", sender: "+15551234567", text: "newer context", timestamp: new Date().toISOString() });
  await photon.continuePhotonConversation(skipperFixture().ownerId, Number(active.id), "resume the earlier context");
  const resumed = q("SELECT id,sender,active,closed FROM photon_conversations WHERE sender=? ORDER BY id", "+15551234567");
  assert.equal(resumed.find((conversation) => conversation.active)?.id, active.id, `continuing a saved desktop thread makes it the phone's current context: ${JSON.stringify(resumed)}`);
  await photon.deliverPhotonEvent({ id: "phone-after-desktop-resume", space_id: "space-resume", space_type: "dm", sender: "+15551234567", text: "back on phone", timestamp: new Date().toISOString() });
  assert.equal(q1("SELECT parent_id FROM messages WHERE id=(SELECT message_id FROM photon_messages WHERE external_id='phone-after-desktop-resume')").parent_id,
    q1("SELECT root_message_id FROM photon_conversations WHERE id=?", active.id).root_message_id, "returning to the phone continues the desktop-resumed thread");
});

test("Photon drains persisted replies and never blindly replays a crash-interrupted attempt", async () => {
  const channel = q1("SELECT id FROM channels WHERE name='main'");
  const queued = run(`INSERT INTO connector_deliveries
    (connector,idempotency_key,channel_id,destination,body,state,created,updated)
    VALUES ('photon','test-pending',?,'space-durable','Durable reply','pending',?,?)`, channel.id, now(), now()).lastInsertRowid;
  await photon.drainPhotonDeliveries();
  assert.equal(q1("SELECT state FROM connector_deliveries WHERE id=?", queued).state, "delivered");
  assert.equal(q1("SELECT COUNT(*) n FROM photon_messages WHERE space_id='space-durable' AND direction='outbound'").n, 1);

  const uncertain = run(`INSERT INTO connector_deliveries
    (connector,idempotency_key,channel_id,destination,body,state,attempt_count,created,updated)
    VALUES ('photon','test-interrupted',?,'space-uncertain','Maybe delivered','attempting',1,?,?)`, channel.id, now(), now()).lastInsertRowid;
  await photon.startPhotonConnector();
  assert.equal(q1("SELECT state FROM connector_deliveries WHERE id=?", uncertain).state, "uncertain");
  assert.equal(q1("SELECT COUNT(*) n FROM photon_messages WHERE space_id='space-uncertain' AND direction='outbound'").n, 0, "uncertain attempts are not duplicated on restart");
});

test("Photon redacts bearer, basic, token, and secret material from setup errors", () => {
  const redacted = photonAuth.redactPhotonError("Bearer abc.def secret=very-secret token token-value Basic cHJvamVjdDpzZWNyZXQ=");
  assert.doesNotMatch(redacted, /abc\.def|very-secret|token-value|cHJvamVjdDpzZWNyZXQ=/);
  assert.match(redacted, /Bearer \[redacted\].*secret \[redacted\].*token \[redacted\].*Basic \[redacted\]/i);
});

test("packaged Electron starts the Photon sidecar as Node and backs off transient polling failures", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../src/server/photon.ts", import.meta.url), "utf8"));
  assert.match(source, /ELECTRON_RUN_AS_NODE:\s*"1"/);
  assert.match(source, /retryDelay = Math\.min\(5000, retryDelay \* 2\)/);
});

test("Photon long-poll timeouts remove stale waiters instead of swallowing the next message", async () => {
  const queue = createPhotonInboundQueue(10);
  assert.equal(await queue.next(5), null);
  assert.equal(queue.waiting, 0);
  const event = { id: "after-idle" };
  queue.push(event);
  assert.deepEqual(await queue.next(5), event);
  assert.equal(queue.size, 0);
  const controller = new AbortController();
  const cancelled = queue.next(1000, controller.signal);
  controller.abort();
  assert.equal(await cancelled, null);
  assert.equal(queue.waiting, 0);
});

test.after(async () => {
  await photon.stopPhotonConnector();
  db.close();
  await new Promise((resolve) => server.close(resolve));
  rmSync(dataDir, { recursive: true, force: true });
});
