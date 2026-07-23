import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "1helm-workflow-"));
process.env.CTRL_DATA_DIR = dataDir;
const { db, now, q, q1, run, seed } = await import("../src/server/db.ts");
const workflows = await import("../src/server/workflows.ts");
const agents = await import("../src/server/agents.ts");

function fixture() {
  seed();
  const channelId = run("INSERT INTO channels (name,slug,kind,topic,purpose,status,created) VALUES ('recurring','recurring','channel','','','active',?)", now()).lastInsertRowid;
  const botId = run("INSERT INTO bots (name,model,created) VALUES ('recurring-agent','mock',?)", now()).lastInsertRowid;
  const agentId = run("INSERT INTO agents (bot_id,kind,name,status,created) VALUES (?,'channel','recurring-agent','ready',?)", botId, now()).lastInsertRowid;
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
  assert.equal(dispatched[0].bot, "recurring-agent");
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

test("workflow status control is channel-scoped", () => {
  const workflow = q1("SELECT * FROM agent_workflows LIMIT 1");
  assert.throws(() => workflows.setWorkflowStatus(Number(workflow.id), 99999, "paused"), /not found/i);
  assert.equal(workflows.setWorkflowStatus(Number(workflow.id), Number(workflow.channel_id), "paused").status, "paused");
  assert.equal(q1("SELECT status FROM channel_computer_obligations WHERE channel_id=? AND kind='workflow' AND ref=?", workflow.channel_id, String(workflow.id)).status, "satisfied");
  assert.equal(workflows.setWorkflowStatus(Number(workflow.id), Number(workflow.channel_id), "active").status, "active");
  assert.equal(q1("SELECT status FROM channel_computer_obligations WHERE channel_id=? AND kind='workflow' AND ref=?", workflow.channel_id, String(workflow.id)).status, "active");
});

test("archiving pauses recurring work and cancels its native wake obligation", async () => {
  const workflow = q1("SELECT * FROM agent_workflows LIMIT 1");
  await agents.archiveChannel(Number(workflow.channel_id));
  assert.equal(q1("SELECT status FROM agent_workflows WHERE id=?", workflow.id).status, "paused");
  assert.equal(q1("SELECT status FROM channel_computer_obligations WHERE channel_id=? AND kind='workflow' AND ref=?", workflow.channel_id, String(workflow.id)).status, "cancelled");
});

test.after(() => { workflows.stopWorkflowLoop(); db.close(); rmSync(dataDir, { recursive: true, force: true }); });
