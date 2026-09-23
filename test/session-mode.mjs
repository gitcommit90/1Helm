import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dataDir = mkdtempSync(join(tmpdir(), "1helm-session-mode-"));
process.env.CTRL_DATA_DIR = dataDir;
const database = await import("../src/server/db.ts");
database.migrate();
const { q1, run, db } = database;
const { operationalSessionView } = await import("../src/server/operational-sessions.ts");
const { channelRootMessageIds } = await import("../src/server/store.ts");
const timestamp = Date.now();
run("INSERT INTO users (id,username,pass,display,is_admin,created) VALUES (1,'captain','x','Captain',1,?)", timestamp);
run("INSERT INTO channels (id,name,kind,topic,purpose,created_by,created,status,slug) VALUES (1,'lab','channel','','Lab',1,?,'active','lab')", timestamp);
run("INSERT INTO members (channel_id,user_id) VALUES (1,1)");
run("INSERT INTO messages (id,channel_id,parent_id,user_id,body,created) VALUES (10,1,NULL,1,'Investigate the benchmark',?)", timestamp);
run("INSERT INTO threads (id,root_message_id,channel_id,status,title,summary,opened_at,updated_at) VALUES (20,10,1,'open','Investigate','',?,?)", timestamp, timestamp);
const thread = () => q1("SELECT * FROM threads WHERE id=20");

test("session presentation preferences keep their per-channel defaults", () => {
  assert.equal(Number(q1("SELECT session_mode FROM channels WHERE id=1").session_mode), 0);
  assert.equal(String(q1("SELECT session_sort FROM channels WHERE id=1").session_sort), "default");
  assert.equal(String(q1("SELECT session_density FROM channels WHERE id=1").session_density), "default");
  const columns = database.q("PRAGMA table_info(threads)").map((row) => String(row.name));
  for (const invented of ["display_title", "current_state", "next_action", "title_generated", "presentation_updated_at"]) assert.equal(columns.includes(invented), false);
});

test("active sorting uses the latest visible user or agent reply and puts newest last", () => {
  run("INSERT INTO messages (id,channel_id,parent_id,user_id,body,created) VALUES (12,1,NULL,1,'Second root',?)", timestamp + 100);
  run("INSERT INTO messages (id,channel_id,parent_id,user_id,body,created) VALUES (14,1,NULL,1,'Third root',?)", timestamp + 200);
  run("INSERT INTO messages (id,channel_id,parent_id,user_id,body,created) VALUES (15,1,12,1,'Earlier reply',?)", timestamp + 150);
  run("INSERT INTO messages (id,channel_id,parent_id,user_id,body,created) VALUES (16,1,10,1,'Newest reply',?)", timestamp + 500);
  assert.deepEqual(channelRootMessageIds(1), [10, 12, 14]);
  run("UPDATE channels SET session_sort='active' WHERE id=1");
  assert.deepEqual(channelRootMessageIds(1), [12, 14, 10]);
  run("INSERT INTO messages (id,channel_id,parent_id,bot_id,body,created) VALUES (17,1,12,2,'Working answer',?)", timestamp + 700);
  run("INSERT INTO agent_progress (id,message_id,kind,body,status,created,updated) VALUES (18,17,'status','Working','running',?,?)", timestamp + 700, timestamp + 700);
  assert.deepEqual(channelRootMessageIds(1), [12, 14, 10]);
});

test("Board state follows authoritative runtime records", () => {
  assert.equal(operationalSessionView(thread()).operational_state, "idle");
  run("INSERT INTO bots (id,name,created) VALUES (2,'lab-agent',?)", timestamp);
  run("INSERT INTO agents (id,bot_id,kind,name,display_name,status,created) VALUES (3,2,'channel','lab-agent','Lab agent','working',?)", timestamp);
  run("INSERT INTO agent_turns (id,bot_id,agent_id,channel_id,trigger_id,thread_root_id,message_id,state,queued_at) VALUES (30,2,3,1,10,10,10,'running',?)", timestamp);
  assert.equal(operationalSessionView(thread()).operational_state, "working");
  run("DELETE FROM agent_turns WHERE id=30");
  run("INSERT INTO messages (id,channel_id,parent_id,bot_id,body,created) VALUES (11,1,10,2,'Choose one',?)", timestamp);
  run("INSERT INTO agent_questions (message_id,payload,status,created) VALUES (11,'{}','pending',?)", timestamp);
  assert.equal(operationalSessionView(thread()).operational_state, "needs_you");
  run("UPDATE agent_questions SET status='answered',answered=? WHERE message_id=11", timestamp);
  run("INSERT INTO agent_followups (id,agent_id,bot_id,channel_id,thread_id,root_message_id,due_at,reason,status,created,updated) VALUES (40,3,2,1,20,10,?,'Wait','pending',?,?)", timestamp + 60_000, timestamp, timestamp);
  assert.equal(operationalSessionView(thread()).operational_state, "scheduled");
});

test("mode changes only existing Chat row presentation", () => {
  const app = readFileSync(new URL("../src/client/app.ts", import.meta.url), "utf8");
  const attachments = readFileSync(new URL("../src/client/message-attachments.ts", import.meta.url), "utf8");
  const channel = readFileSync(new URL("../src/client/channel.ts", import.meta.url), "utf8");
  const state = readFileSync(new URL("../src/client/state.ts", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../src/client/styles.css", import.meta.url), "utf8");
  const server = readFileSync(new URL("../src/server/index.ts", import.meta.url), "utf8");
  const photon = readFileSync(new URL("../src/server/photon.ts", import.meta.url), "utf8");
  assert.match(app, /box\.classList\.toggle\("chat-session-mode", cardPresentation\)/);
  assert.match(app, /const grouped = !cardPresentation/);
  assert.match(app, /renderMessageAttachments\(m, opts\.inThread, sessionCard\)/);
  assert.doesNotMatch(app, /closest\([^\n]*\.attachments/);
  assert.match(attachments, /cardNavigates[\s\S]*title: "Open session"/);
  assert.doesNotMatch(app, /renderSessionWorkspace|\["sessions", "Sessions"\]|view === "sessions"/);
  assert.doesNotMatch(state, /"sessions"/);
  assert.match(channel, /same Chat tab, session order, content, labels, colors, and thread behavior/);
  assert.match(channel, /"Default sort"/);
  assert.match(channel, /"By active"/);
  assert.match(channel, /newest user message or agent response closest to the message box/);
  assert.match(app, /sessionActivity\(a\) - sessionActivity\(b\) \|\| a\.id - b\.id/);
  assert.match(app, /activeSort && msg\.parent_id != null && messageIsSettled\(msg\)/);
  assert.match(channel, /"Default"/);
  assert.match(channel, /"Comfy"/);
  assert.match(channel, /"Compact"/);
  assert.match(channel, /uniform roomy card/);
  assert.match(channel, /uniform skinny card/);
  assert.match(app, /chat-session-density-comfy/);
  assert.match(app, /chat-session-density-compact/);
  assert.match(app, /row\.classList\.add\("chat-session-card", `chat-session-card-density-\$\{sessionDensity\}`\)/);
  assert.match(styles, /chat-session-card-density-comfy[\s\S]*height: 8\.5rem;[\s\S]*min-height: 8\.5rem;[\s\S]*max-height: 8\.5rem/);
  assert.match(styles, /chat-session-card-density-compact[\s\S]*height: 4\.5rem;[\s\S]*min-height: 4\.5rem;[\s\S]*max-height: 4\.5rem/);
  assert.match(styles, /session-thread-footer \{ display: none; \}/);
  assert.match(server, /function threadListView[\s\S]*summary: String\(thread\.summary/);
  assert.equal((server.match(/\.\.\.threadListView\(thread\)/g) || []).length, 2);
  assert.match(server, /root: \{ id: rootId \}/);
  assert.match(server, /root: \{ id: Number\(thread\.root_message_id\) \}/);
  assert.match(app, /renderBoard\(container, channel\.id, \(root\) => \{ void openThread\(root\); \}/);
  assert.match(photon, /startPhotonConnector\(\)\.catch\(\(error\) => console\.warn\(`1Helm Photon connector retry/);
  assert.doesNotMatch(photon, /restartTimer = setTimeout\(\(\) => \{ restartTimer = null; void startPhotonConnector\(\);/);
});

test.after(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });
