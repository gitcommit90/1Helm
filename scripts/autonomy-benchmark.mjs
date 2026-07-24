#!/usr/bin/env node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const startedAt = new Date().toISOString();
const dataDir = mkdtempSync(join(tmpdir(), "1helm-autonomy-benchmark-"));
process.env.CTRL_DATA_DIR = dataDir;
process.env.HELM_CHANNEL_COMPUTER_BACKEND = "native";

const checks = [];
const record = (id, passed, evidence) => checks.push({ id, passed: Boolean(passed), evidence });

let db;
try {
  const database = await import("../src/server/db.ts");
  db = database.db;
  const { q1, run, now, seed } = database;
  const { BUILTIN_SKILLS } = await import("../src/server/builtin-skills.ts");
  const { runtimePromptTiersForChannel, validateAskUserInput, runtimeToolNamesForChannel } = await import("../src/server/bots.ts");
  const { createWorkflow, setWorkflowStatus, stopWorkflowLoop } = await import("../src/server/workflows.ts");
  const { verifyAuditChain } = await import("../src/server/audit.ts");

  seed();
  const channelId = run("INSERT INTO channels (name,slug,kind,topic,purpose,status,created) VALUES ('benchmark','benchmark','channel','','Autonomy benchmark','active',?)", now()).lastInsertRowid;
  const botId = run("INSERT INTO bots (name,model,created) VALUES ('benchmark-agent','benchmark-model',?)", now()).lastInsertRowid;
  const agentId = run("INSERT INTO agents (bot_id,kind,name,status,created) VALUES (?,'channel','benchmark-agent','ready',?)", botId, now()).lastInsertRowid;
  run("INSERT INTO agent_channels (agent_id,channel_id,bound_at) VALUES (?,?,?)", agentId, channelId, now());
  run("INSERT INTO channel_computers (channel_id,backend,machine_id,image,desired_state,observed_state,cpus,memory_bytes,disk_bytes,home_mount,provision_status,last_used,created,updated) VALUES (?,'native','benchmark-machine','benchmark-image','auto','running',1,1073741824,2147483648,'none','ready',?,?,?)", channelId, now(), now(), now());

  const completePlaybooks = BUILTIN_SKILLS.filter((skill) => skill.instructions.length >= 500 && skill.description.length >= 40);
  record("substantive_builtin_arsenal", BUILTIN_SKILLS.length >= 30 && completePlaybooks.length === BUILTIN_SKILLS.length, {
    shipped: BUILTIN_SKILLS.length,
    complete: completePlaybooks.length,
  });

  const routine = validateAskUserInput({
    evidence: "I have not inspected the resident computer and would prefer the human to choose a package manager.",
    questions: [{ question: "Which package manager?", options: [{ label: "A" }, { label: "B" }] }],
  });
  const realBoundary = validateAskUserInput({
    blocker_kind: "external_authority",
    evidence: "The external service requires the account owner to accept a binding agreement before its API permits this operation.",
    questions: [{ question: "Accept the agreement?", options: [{ label: "Accept" }, { label: "Stop" }] }],
  });
  record("structured_human_boundary", !routine.valid && realBoundary.valid, { routine, real_boundary: realBoundary });

  const prompt = runtimePromptTiersForChannel(botId, channelId, false, "Install and verify the CLI");
  const promptLength = prompt.identity.length + prompt.operating.length + prompt.context.length;
  record("compact_capability_map", promptLength < 2_000 && /isolated persistent Linux computer/i.test(prompt.operating) && /skill-arsenal count=/i.test(prompt.context) && !/active-skill-playbooks|### /.test(prompt.context), {
    characters: promptLength,
    has_linux_computer: /isolated persistent Linux computer/i.test(prompt.operating),
    has_skill_inventory: /skill-arsenal count=/i.test(prompt.context),
    injects_full_playbooks: /active-skill-playbooks|### /.test(prompt.context),
  });

  const toolNames = runtimeToolNamesForChannel(botId, channelId);
  const requiredTools = ["run_command", "call_skipper", "schedule_followup", "schedule_workflow", "request_skill", "propose_skill"];
  record("resident_autonomy_surface", requiredTools.every((name) => toolNames.includes(name)), {
    required: requiredTools,
    available: toolNames.filter((name) => requiredTools.includes(name)),
  });

  const workflow = createWorkflow({ channelId, name: "Benchmark recurring work", prompt: "Inspect current state, perform the bounded task, and verify the observable outcome.", intervalSeconds: 60 });
  const wake = q1("SELECT mode,status,due_at FROM channel_computer_obligations WHERE channel_id=? AND kind='workflow' AND ref=?", channelId, String(workflow.id));
  setWorkflowStatus(Number(workflow.id), channelId, "paused");
  const paused = q1("SELECT status FROM channel_computer_obligations WHERE channel_id=? AND kind='workflow' AND ref=?", channelId, String(workflow.id));
  record("durable_workflow_obligation", wake?.mode === "wakeable" && wake?.status === "active" && paused?.status === "satisfied", { wake, paused });

  run("INSERT INTO channel_activity (channel_id,kind,summary,status,actor_type,created) VALUES (?,'benchmark','autonomy contract checked','complete','system',?)", channelId, now());
  const audit = verifyAuditChain();
  record("tamper_evident_activity", audit.valid && audit.events > 0, audit);
  stopWorkflowLoop();
} catch (error) {
  record("benchmark_runtime", false, { error: error instanceof Error ? error.message : String(error) });
} finally {
  db?.close();
  rmSync(dataDir, { recursive: true, force: true });
}

const passed = checks.filter((check) => check.passed).length;
const report = {
  schema: "https://1helm.com/schemas/autonomy-benchmark-v1.json",
  product: "1Helm",
  kind: "deterministic_runtime_contract",
  started_at: startedAt,
  finished_at: new Date().toISOString(),
  deterministic: true,
  scope: {
    validates: [
      "shipped built-in playbook completeness",
      "structured human-blocker validation",
      "compact factual capability-map delivery",
      "resident autonomy tool availability",
      "wakeable recurring-work persistence",
      "audit-chain integrity for the executed fixture",
    ],
    does_not_validate: [
      "task success rates for a live model or provider",
      "behavior on code paths this benchmark did not execute",
      "external connector availability or end-to-end service reliability",
      "security beyond the named runtime invariants",
    ],
  },
  summary: { passed, failed: checks.length - passed, total: checks.length },
  checks,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (passed !== checks.length) process.exitCode = 1;
