import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "1helm-thread-ux-"));
process.env.CTRL_DATA_DIR = dataDir;
const { q1, run, now, seed } = await import("../src/server/db.ts");
const { buildThreadHandoffPacket, handoffThread, retryAgentMessage, retryAndHandoffContext } = await import("../src/server/turns.ts");
await import("../src/server/bots.ts");
const { appendThreadHistory, operationalThreadMessages, serializeMessage } = await import("../src/server/store.ts");

seed();

test("thread handoff packet emphasizes latest state and preserves active-work boundaries", () => {
  const stamp = now();
  const userId = run("INSERT INTO users (username,pass,display,is_admin,created) VALUES (?,?,?,?,?)", `handoff-${stamp}`, "x", "Captain", 1, stamp).lastInsertRowid;
  const channelId = run("INSERT INTO channels (name,slug,kind,topic,purpose,status,created_by,created) VALUES (?,?,?,?,?,'active',?,?)", `handoff-${stamp}`, `handoff-${stamp}`, "channel", "", "test", userId, stamp).lastInsertRowid;
  const botId = run("INSERT INTO bots (name,model,created) VALUES (?,?,?)", `agent-${stamp}`, "mock", stamp).lastInsertRowid;
  const agentId = run("INSERT INTO agents (bot_id,kind,name,status,created) VALUES (?,'channel',?,'ready',?)", botId, `agent-${stamp}`, stamp).lastInsertRowid;
  run("INSERT INTO agent_channels (agent_id,channel_id,bound_at) VALUES (?,?,?)", agentId, channelId, stamp);
  const rootId = run("INSERT INTO messages (channel_id,user_id,body,created) VALUES (?,?,?,?)", channelId, userId, "Deliver the verified release", stamp).lastInsertRowid;
  const threadId = run("INSERT INTO threads (root_message_id,channel_id,status,title,summary,opened_at,updated_at) VALUES (?,?,'open','','',?,?)", rootId, channelId, stamp, stamp).lastInsertRowid;
  run("INSERT INTO messages (channel_id,parent_id,bot_id,body,created,completed_at) VALUES (?,?,?,?,?,?)", channelId, rootId, botId, "Build passed; public verification remains.", stamp + 1, stamp + 2);
  run("INSERT INTO tool_actions (agent_id,thread_id,tool,input_summary,result_summary,status,created) VALUES (?,?,?,?,?,'complete',?)", agentId, threadId, "run_command", "run build", "335 tests passed", stamp + 3);
  run(`INSERT INTO agent_followups (agent_id,bot_id,channel_id,thread_id,root_message_id,due_at,reason,check_hint,status,created,updated)
    VALUES (?,?,?,?,?,?,?,?, 'pending',?,?)`, agentId, botId, channelId, threadId, rootId, stamp + 60_000, "wait for publish", "verify public assets", stamp, stamp);

  const result = buildThreadHandoffPacket(channelId, rootId);
  assert.equal(result.threadId, threadId);
  assert.match(result.packet, /Deliver the verified release/);
  assert.match(result.packet, /Build passed; public verification remains/);
  assert.match(result.packet, /335 tests passed/);
  assert.match(result.packet, /verify public assets/);
  assert.match(result.packet, /not transferred/);
  assert.match(result.packet, /remain unchanged/);

  const handed = handoffThread(channelId, rootId, q1("SELECT * FROM users WHERE id=?", userId));
  assert.notEqual(handed.root.id, rootId);
  const persisted = q1("SELECT * FROM thread_handoffs WHERE destination_root_id=?", handed.root.id);
  assert.equal(Number(persisted.source_root_id), rootId);
  assert.equal(persisted.model, "mock");
  assert.equal(q1("SELECT model FROM model_prefs WHERE bot_id=? AND scope='thread' AND scope_id=?", botId, String(handed.root.id)).model, "mock", "new thread pins the selected source model");
  assert.equal(q1("SELECT state FROM agent_turns WHERE thread_root_id=?", handed.root.id).state, "queued");
});

test("retry projection excludes only the selected invocation and keeps later unrelated history", () => {
  const stamp = now();
  const userId = run("INSERT INTO users (username,pass,display,is_admin,created) VALUES (?,?,?,?,?)", `retry-${stamp}`, "x", "Captain", 1, stamp).lastInsertRowid;
  const channelId = run("INSERT INTO channels (name,slug,kind,topic,purpose,status,created_by,created) VALUES (?,?,?,?,?,'active',?,?)", `retry-${stamp}`, `retry-${stamp}`, "channel", "", "test", userId, stamp).lastInsertRowid;
  const botId = run("INSERT INTO bots (name,model,created) VALUES (?,?,?)", `retry-agent-${stamp}`, "mock", stamp).lastInsertRowid;
  const agentId = run("INSERT INTO agents (bot_id,kind,name,status,created) VALUES (?,'channel',?,'ready',?)", botId, `retry-agent-${stamp}`, stamp).lastInsertRowid;
  run("INSERT INTO agent_channels (agent_id,channel_id,bound_at) VALUES (?,?,?)", agentId, channelId, stamp);
  const rootId = run("INSERT INTO messages (channel_id,user_id,body,created) VALUES (?,?,?,?)", channelId, userId, "Original request", stamp).lastInsertRowid;
  const threadId = run("INSERT INTO threads (root_message_id,channel_id,status,title,summary,opened_at,updated_at) VALUES (?,?,'open','','',?,?)", rootId, channelId, stamp, stamp).lastInsertRowid;
  const replyId = run("INSERT INTO messages (channel_id,parent_id,bot_id,body,created) VALUES (?,?,?,?,?)", channelId, rootId, botId, "Original reply", stamp + 1).lastInsertRowid;
  const turnId = run("INSERT INTO agent_turns (bot_id,channel_id,trigger_id,thread_root_id,message_id,state,queued_at) VALUES (?,?,?,?,?,'completed',?)", botId, channelId, rootId, rootId, replyId, stamp).lastInsertRowid;
  const laterId = run("INSERT INTO messages (channel_id,parent_id,user_id,body,created) VALUES (?,?,?,?,?)", channelId, rootId, userId, "Later unrelated direction", stamp + 2).lastInsertRowid;
  appendThreadHistory(threadId, "assistant_message", { message_id: replyId, body: "Original reply" }, "message", replyId, `message:${replyId}`, stamp + 1, turnId);
  appendThreadHistory(threadId, "human_message", { message_id: laterId, body: "Later unrelated direction" }, "message", laterId, `message:${laterId}`, stamp + 2);

  const projected = operationalThreadMessages(threadId, undefined, undefined, turnId, rootId);
  assert.equal(projected.some((item) => item.content.includes("Original reply")), false);
  assert.equal(projected.some((item) => item.content.includes("Original request")), false, "originating request is moved to the current trigger");
  assert.equal(projected.some((item) => item.content.includes("Later unrelated direction")), true);

  const retried = retryAgentMessage(channelId, replyId, q1("SELECT * FROM users WHERE id=?", userId), `retry_key_${stamp}`);
  const duplicate = retryAgentMessage(channelId, replyId, q1("SELECT * FROM users WHERE id=?", userId), `retry_key_${stamp}`);
  assert.equal(duplicate.message.id, retried.message.id, "same retry key is idempotent");
  const retryTurn = q1("SELECT * FROM agent_turns WHERE message_id=?", retried.message.id);
  assert.equal(Number(retryTurn.retry_of_turn_id), turnId);
  assert.match(String(q1("SELECT body FROM messages WHERE id=?", retryTurn.trigger_id).body), /^\[retry-trigger/);
  assert.equal(serializeMessage(Number(retryTurn.trigger_id)), undefined, "retry trigger stays out of chat");
  assert.equal(serializeMessage(rootId).reply_count, 2, "hidden retry trigger does not inflate visible replies");

  const wakeTriggerId = run("INSERT INTO messages (channel_id,parent_id,bot_id,body,created) VALUES (?,?,?,?,?)", channelId, rootId, botId, "[scheduled-followup id=99] check", stamp + 3).lastInsertRowid;
  const wakeReplyId = run("INSERT INTO messages (channel_id,parent_id,bot_id,body,created) VALUES (?,?,?,?,?)", channelId, rootId, botId, "wake result", stamp + 4).lastInsertRowid;
  const wakeTurnId = run("INSERT INTO agent_turns (bot_id,agent_id,channel_id,trigger_id,thread_root_id,message_id,state,queued_at) VALUES (?,?,?,?,?,?,'completed',?)", botId, agentId, channelId, wakeTriggerId, rootId, wakeReplyId, stamp + 3).lastInsertRowid;
  const wakeRetryTriggerId = run("INSERT INTO messages (channel_id,parent_id,user_id,body,created) VALUES (?,?,?,?,?)", channelId, rootId, userId, "[retry-trigger original-message=scheduled]", stamp + 5).lastInsertRowid;
  const retryInvocationId = run("INSERT INTO agent_turns (bot_id,agent_id,channel_id,trigger_id,thread_root_id,message_id,state,queued_at,retry_of_turn_id) VALUES (?,?,?,?,?,?,'queued',?,?)", botId, agentId, channelId, wakeRetryTriggerId, rootId, run("INSERT INTO messages (channel_id,parent_id,bot_id,body,created) VALUES (?,?,?,?,?)", channelId, rootId, botId, "_Working…_", stamp + 5).lastInsertRowid, stamp + 5, wakeTurnId).lastInsertRowid;
  assert.equal(retryAndHandoffContext(retryInvocationId, threadId).retryTriggerId, laterId, "retrying a wake resolves its latest originating human request");
});

test("thread UI exposes copy, handoff confirmation, and retry on every agent reply", () => {
  const client = readFileSync(new URL("../src/client/app.ts", import.meta.url), "utf8");
  const clientUx = readFileSync(new URL("../src/client/thread-ux.ts", import.meta.url), "utf8");
  const server = readFileSync(new URL("../src/server/turns.ts", import.meta.url), "utf8");
  assert.match(client + clientUx, /Copy thread number/);
  assert.match(client, /title: "Copy message"/);
  assert.match(client, /copyTextToClipboard\(body\)/, "message action copies the exact displayed message source");
  assert.match(client, /showToast\("Message copied"\)/, "successful message copies are confirmed");
  assert.match(clientUx, /Electron can expose Clipboard API while rejecting its write permission/, "desktop clipboard rejection falls back instead of immediately showing a Notice");
  assert.match(clientUx, /if \(!copied\) copied = legacyCopyText\(value\)/, "copy fallback runs when the modern Clipboard API rejects");
  assert.match(clientUx, /export async function copyTextToClipboard/, "thread numbers and message bodies share the resilient clipboard path");
  assert.match(clientUx, /Hand off this thread in a new thread\?/);
  assert.match(client, /isBot \? h\("button", \{/);
  assert.match(client, /Retry this agent reply/);
  assert.match(server, /handoffConfirmation: true/);
  assert.match(server, /retryOfTurnId/);
  assert.match(server, /idempotency_key/);
});

test.after(() => rmSync(dataDir, { recursive: true, force: true }));
