import { q, q1, run, now, type Row } from "./db.ts";
import { agentForChannel, ensureThread, refreshThreadSummary } from "./agents.ts";
import { createMessage, serializeMessage } from "./store.ts";
import { broadcastToChannel } from "./events.ts";
import { ensureChannelComputerRecord, ensureChannelComputerRunning, satisfyObligation, upsertObligation } from "./channel-computers.ts";

type WorkflowDispatch = (bot: Row, channelId: number, triggerId: number, threadRootId: number) => void | Promise<void>;
let dispatcher: WorkflowDispatch | null = null;
let timer: NodeJS.Timeout | null = null;
let passRunning = false;
const LOOP_MS = Math.max(1000, Number(process.env.HELM_WORKFLOW_LOOP_MS || 15_000));

export function registerWorkflowDispatcher(value: WorkflowDispatch): void { dispatcher = value; }

export function createWorkflow(input: { channelId: number; name: string; prompt: string; intervalSeconds: number; startInSeconds?: number; maxRuns?: number }): Row {
  const resident = agentForChannel(input.channelId);
  const channel = q1("SELECT id,status,kind FROM channels WHERE id=?", input.channelId);
  const name = String(input.name || "").trim().slice(0, 120);
  const prompt = String(input.prompt || "").trim().slice(0, 20_000);
  const interval = Math.floor(Number(input.intervalSeconds || 0));
  const startIn = Math.max(1, Math.floor(Number(input.startInSeconds ?? interval)));
  const maxRuns = Math.max(0, Math.min(100_000, Math.floor(Number(input.maxRuns || 0))));
  if (!channel || channel.kind !== "channel" || channel.status !== "active" || !resident?.id || resident.kind !== "channel") throw new Error("Choose an active resident channel.");
  if (!name || prompt.length < 12) throw new Error("A workflow needs a clear name and operational prompt.");
  if (interval < 60 || interval > 31_536_000) throw new Error("Workflow interval must be between 60 seconds and one year.");
  const timestamp = now();
  const id = run(`INSERT INTO agent_workflows (channel_id,agent_id,name,prompt,interval_seconds,next_run,max_runs,status,created,updated)
    VALUES (?,?,?,?,?,?,?,'active',?,?)`, input.channelId, resident.id, name, prompt, interval, timestamp + startIn * 1000, maxRuns, timestamp, timestamp).lastInsertRowid;
  run("INSERT INTO channel_activity (channel_id,kind,summary,status,actor_type,created) VALUES (?,'workflow',?,'active','agent',?)", input.channelId, `Scheduled recurring workflow ${name} every ${interval} seconds.`, timestamp);
  ensureChannelComputerRecord(input.channelId);
  upsertObligation(input.channelId, "workflow", String(id), "wakeable", `Recurring workflow: ${name}`, timestamp + startIn * 1000);
  return q1("SELECT * FROM agent_workflows WHERE id=?", id)!;
}

export function listWorkflows(channelId?: number): Row[] {
  return channelId ? q("SELECT * FROM agent_workflows WHERE channel_id=? ORDER BY created DESC", channelId) : q("SELECT * FROM agent_workflows ORDER BY created DESC");
}

export function setWorkflowStatus(id: number, channelId: number, status: "active" | "paused" | "complete"): Row {
  const workflow = q1("SELECT * FROM agent_workflows WHERE id=? AND channel_id=?", id, channelId);
  if (!workflow) throw new Error("Workflow not found in this channel.");
  const nextRun = status === "active" ? now() + Number(workflow.interval_seconds) * 1000 : Number(workflow.next_run);
  run("UPDATE agent_workflows SET status=?,next_run=?,last_error='',updated=? WHERE id=?", status, nextRun, now(), id);
  if (status === "active") upsertObligation(channelId, "workflow", String(id), "wakeable", `Recurring workflow: ${workflow.name}`, nextRun);
  else satisfyObligation(channelId, "workflow", String(id));
  run("INSERT INTO channel_activity (channel_id,kind,summary,status,actor_type,created) VALUES (?,'workflow',?,?, 'agent',?)", channelId, `${status === "active" ? "Resumed" : status === "paused" ? "Paused" : "Completed"} workflow ${workflow.name}.`, status, now());
  return q1("SELECT * FROM agent_workflows WHERE id=?", id)!;
}

export async function runWorkflowPass(timestamp = now()): Promise<number> {
  if (passRunning) return 0;
  passRunning = true;
  try {
    const due = q("SELECT * FROM agent_workflows WHERE status='active' AND next_run<=? ORDER BY next_run,id LIMIT 50", timestamp);
    let dispatched = 0;
    for (const workflow of due) {
      const resident = agentForChannel(Number(workflow.channel_id));
      const bot = resident?.bot_id ? q1("SELECT * FROM bots WHERE id=?", resident.bot_id) : undefined;
      if (!resident?.id || !bot || !dispatcher) {
        run("UPDATE agent_workflows SET status='failed',last_error=?,updated=? WHERE id=?", "Resident or workflow dispatcher is unavailable.", timestamp, workflow.id);
        satisfyObligation(Number(workflow.channel_id), "workflow", String(workflow.id));
        continue;
      }
      try {
        await ensureChannelComputerRunning(Number(workflow.channel_id), `recurring workflow ${workflow.name}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        run("UPDATE agent_workflows SET status='failed',last_error=?,updated=? WHERE id=?", message.slice(0, 1000), timestamp, workflow.id);
        satisfyObligation(Number(workflow.channel_id), "workflow", String(workflow.id));
        run("INSERT INTO channel_activity (channel_id,kind,summary,status,actor_type,created) VALUES (?,'workflow',?,'failed','system',?)", workflow.channel_id, `Recurring workflow ${workflow.name} could not wake its resident computer: ${message}`.slice(0, 500), timestamp);
        continue;
      }
      const runNumber = Number(workflow.run_count) + 1;
      const body = `[Recurring workflow: ${workflow.name}; run ${runNumber}]\n${workflow.prompt}`;
      const messageId = createMessage({ channelId: Number(workflow.channel_id), parentId: null, botId: null, body });
      // Tag the run root with its workflow so it renders only in the Workflows tab.
      run("UPDATE messages SET system_message=1, workflow_id=? WHERE id=?", workflow.id, messageId);
      const threadId = ensureThread(messageId, Number(workflow.channel_id));
      const complete = Number(workflow.max_runs) > 0 && runNumber >= Number(workflow.max_runs);
      run(`UPDATE agent_workflows SET last_run=?,last_message_id=?,run_count=?,next_run=?,status=?,last_error='',updated=? WHERE id=?`,
        timestamp, messageId, runNumber, timestamp + Number(workflow.interval_seconds) * 1000, complete ? "complete" : "active", timestamp, workflow.id);
      if (complete) satisfyObligation(Number(workflow.channel_id), "workflow", String(workflow.id));
      else upsertObligation(Number(workflow.channel_id), "workflow", String(workflow.id), "wakeable", `Recurring workflow: ${workflow.name}`, timestamp + Number(workflow.interval_seconds) * 1000);
      run("INSERT INTO channel_activity (channel_id,thread_id,kind,summary,status,actor_type,created) VALUES (?,?,'workflow',?,?,'system',?)", workflow.channel_id, threadId, `Recurring workflow ${workflow.name} invoked @${resident.name} (run ${runNumber}).`, complete ? "complete" : "active", timestamp);
      broadcastToChannel(Number(workflow.channel_id), { type: "message", message: serializeMessage(messageId) });
      refreshThreadSummary(messageId);
      try {
        await dispatcher(bot, Number(workflow.channel_id), messageId, messageId);
        dispatched++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        run("UPDATE agent_workflows SET status='failed',last_error=?,updated=? WHERE id=?", message.slice(0, 1000), now(), workflow.id);
        satisfyObligation(Number(workflow.channel_id), "workflow", String(workflow.id));
        run("INSERT INTO channel_activity (channel_id,thread_id,kind,summary,status,actor_type,created) VALUES (?,?,'workflow',?,'failed','system',?)", workflow.channel_id, threadId, `Recurring workflow ${workflow.name} failed: ${message}`.slice(0, 500), now());
      }
    }
    return dispatched;
  } finally {
    passRunning = false;
  }
}

export function startWorkflowLoop(): void {
  if (timer) return;
  setTimeout(() => { void runWorkflowPass(); }, Math.min(5000, LOOP_MS)).unref();
  timer = setInterval(() => { void runWorkflowPass(); }, LOOP_MS);
  timer.unref();
}

export function stopWorkflowLoop(): void { if (timer) clearInterval(timer); timer = null; }
