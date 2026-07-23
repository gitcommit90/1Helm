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

function residentFixture() {
  seed();
  const channelId = run("INSERT INTO channels (name,slug,kind,topic,purpose,status,created) VALUES ('messages','messages','channel','','','active',?)", now()).lastInsertRowid;
  const botId = run("INSERT INTO bots (name,model,created) VALUES ('messages-agent','mock',?)", now()).lastInsertRowid;
  const agentId = run("INSERT INTO agents (bot_id,kind,name,display_name,status,created) VALUES (?,'channel','messages-agent','Messages Agent','ready',?)", botId, now()).lastInsertRowid;
  run("INSERT INTO agent_channels (agent_id,channel_id,bound_at) VALUES (?,?,?)", agentId, channelId, now());
  return { channelId, agentId };
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

test("Photon mappings grant narrow reply but deny new outbound destinations", async () => {
  const { channelId, agentId } = residentFixture();
  photon.mapPhotonChannel(channelId, ["+15551234567"]);
  const config = JSON.parse(String(q1("SELECT config FROM agent_capabilities WHERE agent_id=? AND capability='photon'", agentId).config));
  assert.equal(config.can_reply, true);
  assert.equal(config.can_send, false);
  await assert.rejects(() => photon.sendPhoton(channelId, "+15550000000", "new conversation"), /new outbound sending/i);
  run("INSERT INTO photon_messages (channel_id,external_id,space_id,sender,direction,body,received_at) VALUES (?,?,?,?, 'inbound',?,?)", channelId, "incoming-1", "space-1", "+15551234567", "hello", now());
  const sent = await photon.sendPhoton(channelId, "space-1", "authorized reply");
  assert.equal(sent.status, "sent");
});

test("Photon inbound delivery is allowlisted, deduplicated, and invokes the mapped resident", async () => {
  const channel = q1("SELECT id FROM channels WHERE name='messages'");
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

test("Photon keeps one durable sender thread until exact /new", async () => {
  const channel = q1("SELECT id FROM channels WHERE name='messages'");
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
  const sender = "+15559876543";
  const channel = q1("SELECT id FROM channels WHERE name='messages'");
  photon.mapPhotonChannel(channel.id, ["+15551234567", sender]);
  let dispatched = false;
  photon.registerPhotonDispatcher(() => { dispatched = true; });
  assert.equal(await photon.deliverPhotonEvent({ id: "first-ever-new", space_id: "space-first-new", space_type: "dm", sender, text: "/NEW", timestamp: new Date().toISOString() }), true);
  assert.equal(dispatched, false);
  assert.equal(q1("SELECT COUNT(*) n FROM photon_conversations WHERE channel_id=? AND sender=?", channel.id, sender).n, 0);
  assert.equal(q1("SELECT source_message_id FROM connector_deliveries WHERE idempotency_key='photon:event:first-ever-new:new'").source_message_id, null);
});

test("Photon upgrades the most recent existing sender thread without splitting it", () => {
  const sender = "+15551112222";
  const channel = q1("SELECT id FROM channels WHERE name='messages'");
  const stamp = now();
  const rootId = run("INSERT INTO messages (channel_id,parent_id,body,system_message,created) VALUES (?,NULL,?,1,?)", channel.id, `[Photon iMessage from ${sender}]\nexisting conversation`, stamp).lastInsertRowid;
  const threadId = run("INSERT INTO threads (root_message_id,channel_id,status,title,summary,opened_at,updated_at) VALUES (?,?,'open','Existing Photon conversation','',?,?)", rootId, channel.id, stamp, stamp).lastInsertRowid;
  run("INSERT INTO photon_messages (channel_id,external_id,space_id,sender,direction,body,received_at,message_id) VALUES (?,?,?,?, 'inbound',?,?,?)", channel.id, "pre-upgrade", "space-pre-upgrade", sender, "existing conversation", stamp, rootId);

  migrate();

  const conversation = q1("SELECT * FROM photon_conversations WHERE channel_id=? AND sender=? AND active=1", channel.id, sender);
  assert.equal(conversation.root_message_id, rootId);
  assert.equal(conversation.thread_id, threadId);
});

test("Photon returns the completed 1Helm reply exactly once to the inbound conversation", async () => {
  const channel = q1("SELECT id FROM channels WHERE name='messages'");
  const bot = q1("SELECT b.id FROM bots b JOIN agents a ON a.bot_id=b.id JOIN agent_channels ac ON ac.agent_id=a.id WHERE ac.channel_id=?", channel.id);
  photon.registerPhotonDispatcher(async (_bot, channelId, _triggerId, rootId) => {
    run("INSERT INTO messages (channel_id,parent_id,bot_id,body,created) VALUES (?,?,?,?,?)", channelId, rootId, bot.id, "Automatic Photon answer", now());
  });
  await photon.deliverPhotonEvent({ id: "reply-new-1", space_id: "space-reply", space_type: "dm", sender: "+15551234567", text: "/new", timestamp: new Date().toISOString() });
  const event = { id: "reply-1", space_id: "space-reply", space_type: "dm", sender: "+15551234567", text: "please reply", timestamp: new Date().toISOString() };
  assert.equal(await photon.deliverPhotonEvent(event), true);
  assert.equal(q1("SELECT COUNT(*) n FROM messages WHERE channel_id=? AND parent_id=(SELECT root_message_id FROM photon_conversations WHERE channel_id=? AND sender=? AND active=1) AND bot_id=?", channel.id, channel.id, "+15551234567", bot.id).n, 1, "the agent answer is retained in its 1Helm thread");
  assert.equal(q1("SELECT COUNT(*) n FROM photon_messages WHERE channel_id=? AND space_id='space-reply' AND direction='outbound' AND body='Automatic Photon answer'", channel.id).n, 1, "the completed answer is sent back once");

  photon.registerPhotonDispatcher(async (_bot, channelId, _triggerId, rootId) => {
    run("INSERT INTO messages (channel_id,parent_id,bot_id,body,created) VALUES (?,?,?,?,?)", channelId, rootId, bot.id, "Tool-sent Photon answer", now());
    await photon.sendPhoton(channelId, "space-tool-reply", "Tool-sent Photon answer");
  });
  const toolEvent = { id: "reply-2", space_id: "space-tool-reply", space_type: "dm", sender: "+15551234567", text: "reply with your tool", timestamp: new Date().toISOString() };
  assert.equal(await photon.deliverPhotonEvent(toolEvent), true);
  assert.equal(q1("SELECT COUNT(*) n FROM photon_messages WHERE channel_id=? AND space_id='space-tool-reply' AND direction='outbound'", channel.id).n, 1, "an explicit photon_send suppresses the automatic duplicate");
});

test("Photon drains persisted replies and never blindly replays a crash-interrupted attempt", async () => {
  const channel = q1("SELECT id FROM channels WHERE name='messages'");
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
