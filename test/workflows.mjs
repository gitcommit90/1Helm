import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "1helm-workflow-"));
process.env.CTRL_DATA_DIR = dataDir;
process.env.HELM_CHANNEL_COMPUTER_BACKEND = "native";
const { db, now, q, q1, run, seed } = await import("../src/server/db.ts");
const workflows = await import("../src/server/workflows.ts");
const agents = await import("../src/server/agents.ts");
const store = await import("../src/server/store.ts");

let fixtureNumber = 0;
function fixture(createdBy = null) {
  seed();
  fixtureNumber++;
  const channelName = `recurring-${fixtureNumber}`;
  const agentName = `recurring-agent-${fixtureNumber}`;
  const channelId = run("INSERT INTO channels (name,slug,kind,topic,purpose,status,created_by,created) VALUES (?,?,'channel','','','active',?,?)", channelName, channelName, createdBy, now()).lastInsertRowid;
  const botId = run("INSERT INTO bots (name,model,created) VALUES (?,'mock',?)", agentName, now()).lastInsertRowid;
  const agentId = run("INSERT INTO agents (bot_id,kind,name,status,created) VALUES (?,'channel',?,'ready',?)", botId, agentName, now()).lastInsertRowid;
  run("INSERT INTO agent_channels (agent_id,channel_id,bound_at) VALUES (?,?,?)", agentId, channelId, now());
  return { channelId, agentId };
}

test("recurring workflows persist, invoke the same resident, and complete at a bounded run count", async () => {
  const { channelId } = fixture();
  const dispatched = [];
  workflows.registerWorkflowDispatcher((bot, targetChannel, triggerId, rootId) => dispatched.push({ bot: bot.name, targetChannel, triggerId, rootId }));
  const workflow = workflows.createWorkflow({ channelId, name: "Daily evidence", prompt: "Inspect the launch evidence, resolve routine gaps, and publish a verified status report.", intervalSeconds: 60, startInSeconds: 1, maxRuns: 2 });
  assert.equal(workflow.status, "active");
  assert.equal(q1("SELECT status FROM channel_computer_obligations WHERE channel_id=? AND kind='workflow' AND ref=?", channelId, String(workflow.id)).status, "active");
  assert.equal((await workflows.runWorkflowPass(Number(workflow.next_run) + 1)), 1);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].bot, "recurring-agent-1");
  let saved = q1("SELECT * FROM agent_workflows WHERE id=?", workflow.id);
  assert.equal(saved.run_count, 1);
  assert.equal(saved.status, "active");
  assert.equal((await workflows.runWorkflowPass(Number(saved.next_run) + 1)), 1);
  saved = q1("SELECT * FROM agent_workflows WHERE id=?", workflow.id);
  assert.equal(saved.run_count, 2);
  assert.equal(saved.status, "complete");
  assert.equal(q1("SELECT status FROM channel_computer_obligations WHERE channel_id=? AND kind='workflow' AND ref=?", channelId, String(workflow.id)).status, "satisfied");
  assert.equal(q("SELECT * FROM messages WHERE channel_id=? AND system_message=1", channelId).length, 2);
  assert.equal(q("SELECT * FROM channel_activity WHERE channel_id=? AND kind='workflow'", channelId).length >= 3, true);
});

test("workflow dispatch attributes the admitted turn to its channel owner", async () => {
  const ownerId = run("INSERT INTO users (username,pass,display,is_admin,created) VALUES ('workflow-owner','x','Workflow Owner',0,?)", now()).lastInsertRowid;
  const { channelId } = fixture(ownerId);
  workflows.registerWorkflowDispatcher(async (bot, targetChannel, triggerId, rootId) => {
    const { runBot } = await import("../src/server/bots.ts");
    await runBot(bot, targetChannel, triggerId, rootId, true);
  });
  const workflow = workflows.createWorkflow({ channelId, name: "Owned workflow", prompt: "Run the inexpensive owned recurring workflow and report its result.", intervalSeconds: 60, startInSeconds: 1, maxRuns: 1 });
  await workflows.runWorkflowPass(Number(workflow.next_run) + 1);
  const turn = q1("SELECT request_user_id FROM agent_turns WHERE channel_id=? ORDER BY id DESC LIMIT 1", channelId);
  assert.equal(Number(turn.request_user_id), ownerId);
});

test("workflow status control is channel-scoped", () => {
  const workflow = q1("SELECT * FROM agent_workflows LIMIT 1");
  assert.throws(() => workflows.setWorkflowStatus(Number(workflow.id), 99999, "paused"), /not found/i);
  assert.equal(workflows.setWorkflowStatus(Number(workflow.id), Number(workflow.channel_id), "paused").status, "paused");
  assert.equal(q1("SELECT status FROM channel_computer_obligations WHERE channel_id=? AND kind='workflow' AND ref=?", workflow.channel_id, String(workflow.id)).status, "satisfied");
  assert.equal(workflows.setWorkflowStatus(Number(workflow.id), Number(workflow.channel_id), "active").status, "active");
  assert.equal(q1("SELECT status FROM channel_computer_obligations WHERE channel_id=? AND kind='workflow' AND ref=?", workflow.channel_id, String(workflow.id)).status, "active");
});

test("one channel-wide workflow model overrides ordinary channel policy only for workflow runs", () => {
  const workflow = q1("SELECT * FROM agent_workflows LIMIT 1");
  const botId = Number(q1("SELECT bot_id FROM agents WHERE id=?", workflow.agent_id).bot_id);
  const channelId = Number(workflow.channel_id);
  const workflowRootId = Number(q1("SELECT id FROM messages WHERE workflow_id=? ORDER BY id DESC LIMIT 1", workflow.id).id);
  const ordinaryRootId = run("INSERT INTO messages (channel_id,body,created) VALUES (?,'ordinary channel turn',?)", channelId, now()).lastInsertRowid;

  store.setModelPolicy(botId, "channel", String(channelId), null, "costly-channel-model");
  store.setModelPolicy(botId, "workflow", String(channelId), null, "cheap-workflow-model");
  assert.deepEqual(
    { model: store.resolvedTurnModelPolicy(botId, channelId, workflowRootId).model, source: store.resolvedTurnModelPolicy(botId, channelId, workflowRootId).source },
    { model: "cheap-workflow-model", source: "workflow" },
  );
  assert.deepEqual(
    { model: store.resolvedTurnModelPolicy(botId, channelId, ordinaryRootId).model, source: store.resolvedTurnModelPolicy(botId, channelId, ordinaryRootId).source },
    { model: "costly-channel-model", source: "channel" },
  );

  store.setModelPolicy(botId, "thread", String(workflowRootId), null, "explicit-run-model");
  assert.deepEqual(
    { model: store.resolvedTurnModelPolicy(botId, channelId, workflowRootId).model, source: store.resolvedTurnModelPolicy(botId, channelId, workflowRootId).source },
    { model: "explicit-run-model", source: "thread" },
  );
  store.setModelPolicy(botId, "thread", String(workflowRootId), null, null);
  store.setModelPolicy(botId, "workflow", String(channelId), null, null);
  assert.equal(store.resolvedTurnModelPolicy(botId, channelId, workflowRootId).model, "costly-channel-model", "Follow channel model is the durable blank/default");
});

test("archiving pauses recurring work and cancels its native wake obligation", async () => {
  const workflow = q1("SELECT * FROM agent_workflows LIMIT 1");
  await agents.archiveChannel(Number(workflow.channel_id));
  assert.equal(q1("SELECT status FROM agent_workflows WHERE id=?", workflow.id).status, "paused");
  assert.equal(q1("SELECT status FROM channel_computer_obligations WHERE channel_id=? AND kind='workflow' AND ref=?", workflow.channel_id, String(workflow.id)).status, "cancelled");
});

test.after(() => { workflows.stopWorkflowLoop(); db.close(); rmSync(dataDir, { recursive: true, force: true }); });
