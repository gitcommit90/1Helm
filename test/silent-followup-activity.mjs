import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "1helm-silent-followup-activity-"));
process.env.CTRL_DATA_DIR = dataDir;
const { q1, run, seed } = await import("../src/server/db.ts");
const { silentFollowupActivityForThread } = await import("../src/server/store.ts");
seed();

function fixture() {
  const stamp = Date.now();
  const userId = run("INSERT INTO users (username,pass,display,is_admin,created) VALUES (?,?,?,?,?)", `captain-${stamp}`, "x", "Captain", 1, stamp).lastInsertRowid;
  const channelId = run("INSERT INTO channels (name,slug,kind,topic,purpose,status,created_by,created) VALUES (?,?,?,?,?,'active',?,?)", `activity-${stamp}`, `activity-${stamp}`, "channel", "", "test", userId, stamp).lastInsertRowid;
  const botId = run("INSERT INTO bots (name,model,created) VALUES (?,?,?)", `agent-${stamp}`, "mock", stamp).lastInsertRowid;
  const agentId = run("INSERT INTO agents (bot_id,kind,name,status,created) VALUES (?,'channel',?,'ready',?)", botId, `agent-${stamp}`, stamp).lastInsertRowid;
  const rootId = run("INSERT INTO messages (channel_id,user_id,body,created) VALUES (?,?,?,?)", channelId, userId, "Monitor it", stamp).lastInsertRowid;
  const threadId = run("INSERT INTO threads (root_message_id,channel_id,status,title,summary,opened_at,updated_at) VALUES (?,?,'open','','',?,?)", rootId, channelId, stamp, stamp).lastInsertRowid;

  const addFollowup = (sourceId, offset, disposition = "continued") => {
    const followupId = run(`INSERT INTO agent_followups
      (agent_id,bot_id,channel_id,thread_id,root_message_id,due_at,reason,check_hint,source_followup_id,status,attempts,max_attempts,created,updated,completion_disposition,completion_evidence)
      VALUES (?,?,?,?,?,?,?,?,?,'done',1,48,?,?,?,?)`, agentId, botId, channelId, threadId, rootId, stamp + offset, "check the job", "inspect status", sourceId, stamp + offset, stamp + offset + 4, disposition, disposition === "continued" ? "Persisted linked successor." : "").lastInsertRowid;
    const triggerId = run("INSERT INTO messages (channel_id,parent_id,bot_id,body,created) VALUES (?,?,?,?,?)", channelId, rootId, botId, `[scheduled-followup id=${followupId} attempt=1/48]\nCheck / finish: check the job`, stamp + offset).lastInsertRowid;
    const messageId = run("INSERT INTO messages (channel_id,parent_id,bot_id,body,created,completed_at) VALUES (?,?,?,?,?,?)", channelId, rootId, botId, "[silent-success]", stamp + offset + 1, stamp + offset + 4).lastInsertRowid;
    const turnId = run(`INSERT INTO agent_turns
      (bot_id,agent_id,channel_id,trigger_id,thread_root_id,message_id,state,queued_at,started_at,finished_at,completion_mode,continuation_disposition,continuation_evidence)
      VALUES (?,?,?,?,?,?,'completed',?,?,?,'silent_success',?,?)`, botId, agentId, channelId, triggerId, rootId, messageId, stamp + offset, stamp + offset + 1, stamp + offset + 4, disposition, disposition === "continued" ? "Persisted linked successor." : "").lastInsertRowid;
    run("INSERT INTO agent_progress (message_id,kind,body,status,created,updated) VALUES (?,'status','Working…','complete',?,?)", messageId, stamp + offset + 1, stamp + offset + 2);
    run("INSERT INTO agent_progress (message_id,kind,body,status,created,updated) VALUES (?,'tool','run command: inspect\\nresult: still running','complete',?,?)", messageId, stamp + offset + 2, stamp + offset + 3);
    return { followupId, messageId, turnId };
  };

  const first = addFollowup(null, 10);
  const second = addFollowup(first.followupId, 20);
  const separate = addFollowup(null, 30);
  // A silent recurring-workflow invocation is real, but is not scheduled-follow-up activity.
  const workflowTrigger = run("INSERT INTO messages (channel_id,parent_id,bot_id,body,created) VALUES (?,?,?,?,?)", channelId, rootId, botId, "[Recurring workflow: example]", stamp + 40).lastInsertRowid;
  const workflowReply = run("INSERT INTO messages (channel_id,parent_id,bot_id,body,created) VALUES (?,?,?,?,?)", channelId, rootId, botId, "[silent-success]", stamp + 41).lastInsertRowid;
  run("INSERT INTO agent_turns (bot_id,agent_id,channel_id,trigger_id,thread_root_id,message_id,state,queued_at,completion_mode) VALUES (?,?,?,?,?,?,'completed',?,'silent_success')", botId, agentId, channelId, workflowTrigger, rootId, workflowReply, stamp + 40);
  return { threadId, first, second, separate };
}

test("silent scheduled invocations are projected read-only from existing records", () => {
  const { threadId, first, second, separate } = fixture();
  const before = {
    turns: q1("SELECT COUNT(*) n FROM agent_turns").n,
    followups: q1("SELECT COUNT(*) n FROM agent_followups").n,
    messages: q1("SELECT COUNT(*) n FROM messages").n,
    progress: q1("SELECT COUNT(*) n FROM agent_progress").n,
  };
  const activity = silentFollowupActivityForThread(threadId);
  const after = {
    turns: q1("SELECT COUNT(*) n FROM agent_turns").n,
    followups: q1("SELECT COUNT(*) n FROM agent_followups").n,
    messages: q1("SELECT COUNT(*) n FROM messages").n,
    progress: q1("SELECT COUNT(*) n FROM agent_progress").n,
  };

  assert.deepEqual(after, before, "the visual projection performs no writes");
  assert.deepEqual(activity.map((item) => item.turn_id), [first.turnId, second.turnId, separate.turnId]);
  assert.equal(activity[0].lineage_id, first.followupId);
  assert.equal(activity[1].lineage_id, first.followupId, "linked successors share one visual lineage");
  assert.equal(activity[2].lineage_id, separate.followupId, "unrelated follow-ups remain separate");
  assert.equal(activity[0].continuation_disposition, "continued");
  assert.equal(activity[0].continuation_evidence, "Persisted linked successor.");
  assert.equal(activity[0].progress_count, 2);
  assert.equal(activity[0].progress.length, 1, "collapsed payload reuses the existing latest-step summary");
  assert.match(activity[0].progress[0].body, /still running/);
});

test("thread UI groups consecutive silent checks without changing follow-up execution", () => {
  const client = readFileSync(new URL("../src/client/thread-ux.ts", import.meta.url), "utf8");
  const server = readFileSync(new URL("../src/server/store.ts", import.meta.url), "utf8");
  assert.match(client, /Follow-up activity · \$\{checks\.length\}/);
  assert.match(client, /Latest: \$\{status\.label\}/);
  assert.match(client, /items\[index\]\.kind === "activity"[\s\S]*lineage_id === item\.check\.lineage_id/);
  assert.match(client, /ui\.renderProgress\(check\)/, "each check exposes its existing work log");
  const projection = server.slice(server.indexOf("Read-only UI projection"));
  assert.match(projection, /WHERE at\.completion_mode='silent_success'/);
  assert.doesNotMatch(projection, /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE)\b/i, "projection contains no writes or migrations");
});

test.after(() => rmSync(dataDir, { recursive: true, force: true }));
