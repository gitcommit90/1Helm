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
const server = createServer(async (req,res) => {
  if (req.headers["x-1helm-photon-token"] !== token) { res.writeHead(401); res.end("{}"); return; }
  const reply = (value) => { const body=JSON.stringify(value); res.writeHead(200,{"content-type":"application/json"}); res.end(body); };
  if (req.url === "/health") return reply({ok:true});
  if (req.url === "/next") return setTimeout(() => reply({ok:true,event:null}), 25);
  if (req.url === "/send") return reply({ok:true,message_id:"sent-1"});
  if (req.url === "/shutdown") { reply({ok:true}); return setTimeout(() => process.exit(0), 10); }
  res.writeHead(404); res.end("{}");
});
server.listen(Number(process.env.PHOTON_SIDECAR_PORT),"127.0.0.1");
process.stdin.resume(); process.stdin.on("end",()=>process.exit(0));
`);

const { db, now, q, q1, run, seed } = await import("../src/server/db.ts");
const photon = await import("../src/server/photon.ts");
const photonAuth = await import("../src/server/photon-auth.ts");

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

test.after(async () => {
  await photon.stopPhotonConnector();
  db.close();
  await new Promise((resolve) => server.close(resolve));
  rmSync(dataDir, { recursive: true, force: true });
});
