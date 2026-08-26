import { q, q1, run, now, type Row } from "./db.ts";
import { appendThreadHistory, createMessage, isInternalMessageBody } from "./store.ts";
import { broadcastToChannel } from "./events.ts";
import { agentForBot, ensureThread, refreshThreadSummary, setAgentStatus, threadIdForRoot } from "./agents.ts";
import { ensureChannelComputerRunning, satisfyObligation, upsertObligation } from "./channel-computers.ts";
import { captainTextConsent, deliverCaptainText, mentionsCaptainTexting } from "./captain-texting.ts";
import { SKIPPER_CALL_APPROVAL_KIND, SKIPPER_CALL_APPROVE_ONCE, SKIPPER_CALL_APPROVE_THREAD, SKIPPER_CALL_DENY } from "./bot-output.ts";

export { CAPTAIN_TEXTING_ACCEPT, CAPTAIN_TEXTING_DECLINE, CAPTAIN_TEXTING_PERMISSION_KIND, captainTextConsent, captainTextingPermissionPayload, captainTextingPrompt, captainTextToolDefinitions, deliverCaptainText, deliverResidentCaptainText, mentionsCaptainTexting } from "./captain-texting.ts";
export { SKIPPER_CALL_APPROVAL_KIND, skipperCallApprovalPayload } from "./bot-output.ts";

type SkipperDispatcher = (agent: Row, channelId: number, rootMessageId: number, reason: string) => string;
let skipperDispatcher: SkipperDispatcher | null = null;
export const registerSkipperCallDispatcher = (dispatcher: SkipperDispatcher): void => { skipperDispatcher = dispatcher; };
export const skipperCallNeedsApproval = (channelId: number, threadId: number): boolean => {
  const policy = q1(`SELECT c.call_skipper_without_confirmation,t.skipper_call_approved FROM channels c JOIN threads t ON t.channel_id=c.id WHERE c.id=? AND t.id=?`, channelId, threadId);
  return !Boolean(policy?.call_skipper_without_confirmation) && !Boolean(policy?.skipper_call_approved);
};
export function resolveSkipperCallApproval(messageId: number, decision: string, userId: number): string {
  const row = q1(`SELECT m.channel_id,m.parent_id,m.bot_id,aq.payload,t.id thread_id FROM messages m JOIN agent_questions aq ON aq.message_id=m.id JOIN threads t ON t.root_message_id=m.parent_id WHERE m.id=?`, messageId);
  if (!row?.parent_id || !row.bot_id || !skipperDispatcher) throw new Error("Skipper approval request not found.");
  let payload: Record<string, unknown> = {}; try { payload = JSON.parse(String(row.payload || "{}")); } catch { /* rejected below */ }
  if (String(payload.kind || "") !== SKIPPER_CALL_APPROVAL_KIND) throw new Error("This is not a Skipper approval request.");
  const agent = agentForBot(Number(row.bot_id)); if (!agent || agent.kind !== "channel") throw new Error("Resident agent not found.");
  if (![SKIPPER_CALL_APPROVE_ONCE, SKIPPER_CALL_APPROVE_THREAD, SKIPPER_CALL_DENY].includes(decision)) throw new Error("Choose Approve once, Approve always for thread, or Deny.");
  if (decision === SKIPPER_CALL_APPROVE_THREAD) run("UPDATE threads SET skipper_call_approved=1,updated_at=? WHERE id=?", now(), row.thread_id);
  const outcome = decision === SKIPPER_CALL_DENY ? "Skipper call denied." : skipperDispatcher(agent, Number(row.channel_id), Number(row.parent_id), String(payload.reason || "").slice(0, 4000));
  const actionId = Number(payload.action_id || 0), progressId = Number(payload.progress_id || 0), updated = now();
  if (actionId) { run("UPDATE tool_actions SET result_summary=?,status='complete' WHERE id=?", outcome, actionId); run("UPDATE channel_activity SET summary=?,status='complete',updated=? WHERE action_id=?", outcome, updated, actionId); }
  if (progressId) run("UPDATE agent_progress SET body=?,status='complete',updated=? WHERE id=?", outcome, updated, progressId);
  if (decision === SKIPPER_CALL_DENY) { setAgentStatus(Number(agent.id), "ready", Number(row.channel_id)); broadcastToChannel(Number(row.channel_id), { type: "agent_status", channelId: Number(row.channel_id), agentId: agent.id, status: "ready" }); }
  run("INSERT INTO channel_activity (channel_id,thread_id,kind,summary,status,actor_type,created) VALUES (?,?,'escalation_approval',?,'complete','user',?)", row.channel_id, row.thread_id, `${decision} by user ${userId}.`, updated);
  broadcastToChannel(Number(row.channel_id), { type: "activity", channelId: Number(row.channel_id) }); refreshThreadSummary(Number(row.parent_id)); return outcome;
}

const CAPTAIN_TEXTING_CAPABILITY = "captain_texting";
function residentAgentId(channelId: number): number {
  return Number(q1(`SELECT a.id FROM agents a JOIN agent_channels ac ON ac.agent_id=a.id
    WHERE ac.channel_id=? AND a.kind='channel' AND a.status<>'deleted'`, channelId)?.id || 0);
}
export function channelTextingGrant(channelId: number): { granted: boolean; granted_by: number | null; created: number | null } {
  const agentId = residentAgentId(channelId);
  const row = agentId ? q1("SELECT granted_by, created FROM agent_capabilities WHERE agent_id=? AND capability=?", agentId, CAPTAIN_TEXTING_CAPABILITY) : undefined;
  return row ? { granted: true, granted_by: row.granted_by == null ? null : Number(row.granted_by), created: Number(row.created) } : { granted: false, granted_by: null, created: null };
}
export function grantChannelTexting(channelId: number, grantedBy: number): boolean {
  const agentId = residentAgentId(channelId);
  if (!agentId) return false;
  run(`INSERT INTO agent_capabilities (agent_id,capability,config,granted_by,created) VALUES (?,?,?,?,?)
    ON CONFLICT(agent_id,capability) DO UPDATE SET granted_by=excluded.granted_by,created=excluded.created`, agentId, CAPTAIN_TEXTING_CAPABILITY, JSON.stringify({ channel_id: channelId }), grantedBy, now());
  run("INSERT INTO channel_activity (channel_id,kind,summary,status,actor_type,created) VALUES (?,'connector',?,'complete','user',?)", channelId, "The Captain enabled outbound texting for this channel.", now());
  return true;
}
export function revokeChannelTexting(channelId: number): boolean {
  const agentId = residentAgentId(channelId);
  if (!agentId) return false;
  const changed = run("DELETE FROM agent_capabilities WHERE agent_id=? AND capability=?", agentId, CAPTAIN_TEXTING_CAPABILITY).changes > 0;
  if (changed) run("INSERT INTO channel_activity (channel_id,kind,summary,status,actor_type,created) VALUES (?,'connector',?,'complete','user',?)", channelId, "The Captain revoked outbound texting for this channel.", now());
  return changed;
}

export function followupToolDefinition(skipper: boolean): unknown {
  return {
    type: "function",
    function: {
      name: "schedule_followup",
      description: skipper ? "Schedule a one-shot durable re-invocation of Skipper in this private thread. For an explicitly authorized text reminder, put the exact reminder and the instruction to call text_captain in reason. Survives server restarts." : "Schedule a durable re-invocation of yourself in this thread after a delay. Survives session end and server restart.",
      parameters: {
        type: "object",
        properties: {
          delay_seconds: { type: "integer", minimum: 30, maximum: 31536000, description: "Seconds until re-entry (min 30, max 1 year)." },
          reason: { type: "string", description: "What to check or finish when you wake (e.g. Sonarr S19 episode files / Jellyfin import)." },
          check_hint: { type: "string", description: "Optional concrete command or API check to run on wake." },
          max_attempts: { type: "integer", minimum: 1, maximum: 200, description: "Optional cap on wake cycles (default 48)." },
          observed_state: { type: "string", enum: ["confirmed_running"], description: "On an automatic follow-up wake only: set this only after an available tool directly confirms the task is still running. Omit it when first scheduling, when complete, or when state is unknown." },
          user_update: {
            type: "object",
            description: "Substantive status published before this turn waits.",
            properties: {
              completed: { type: "string", description: "What was completed so far." },
              observed_state: { type: "string", description: "The current state directly observed with a tool or API." },
              wait_reason: { type: "string", description: "Why another check must wait." },
              next_check: { type: "string", description: "What the next wake will inspect or finish." },
            },
            required: ["completed", "observed_state", "wait_reason", "next_check"],
          },
        },
        required: ["delay_seconds", "reason", "user_update"],
      },
    },
  };
}

/** Poll due follow-ups often enough for media downloads without burning CPU. */
const CHECK_EVERY_MS = Number(process.env.FOLLOWUP_INTERVAL_MS || 15_000);
const MIN_DELAY_SEC = 30;
const MAX_DELAY_SEC = 365 * 24 * 60 * 60;
const DEFAULT_MAX_ATTEMPTS = 48;
const MAX_PENDING_PER_THREAD = 3;

type ScheduleOpts = {
  agentId: number;
  botId: number;
  channelId: number;
  threadId: number;
  rootMessageId: number;
  delaySeconds: number;
  reason: string;
  checkHint?: string;
  maxAttempts?: number;
  /** Host authority already admitted for the creating turn. Residents ignore it. */
  hostAuthorized?: boolean;
  /** Assigned computer IDs admitted for host run_command on the creating turn. */
  hostAuthorizedComputerIds?: number[];
  /** Runtime-owned lineage for a confirmed-running wake reschedule. */
  sourceFollowupId?: number;
  /** When true, mark the durable thread waiting (async work, not human input). */
  markWaiting?: boolean;
};

function clampDelay(seconds: number): number {
  const n = Math.floor(Number(seconds) || 0);
  if (!Number.isFinite(n)) return MIN_DELAY_SEC;
  return Math.max(MIN_DELAY_SEC, Math.min(MAX_DELAY_SEC, n));
}

export function normalizedAuthorizationComputerIds(value: unknown): number[] {
  return [...new Set((Array.isArray(value) ? value : []).map(Number).filter((id) => Number.isInteger(id) && id > 0))].sort((a, b) => a - b);
}

function storedComputerIds(value: unknown): number[] {
  try { return normalizedAuthorizationComputerIds(JSON.parse(String(value || "[]"))); } catch { return []; }
}

/** Persist a durable re-entry for an agent on a thread. Survives process restart. */
export function scheduleAgentFollowup(opts: ScheduleOpts): { id: number; due_at: number; delay_seconds: number } {
  const delay = clampDelay(opts.delaySeconds);
  const dueAt = now() + delay * 1000;
  const reason = String(opts.reason || "").trim().slice(0, 2000);
  if (!reason) throw new Error("schedule_followup requires a reason describing what to check or finish.");
  if (!opts.agentId || !opts.botId || !opts.channelId || !opts.threadId || !opts.rootMessageId) {
    throw new Error("schedule_followup is missing thread/agent context.");
  }
  const creatingAgent = q1("SELECT kind,bot_id FROM agents WHERE id=?", opts.agentId);
  if (!creatingAgent || Number(creatingAgent.bot_id) !== Number(opts.botId)) {
    throw new Error("schedule_followup agent and bot context do not match.");
  }
  let hostAuthorized = String(creatingAgent.kind) === "skipper" && opts.hostAuthorized === true;
  let hostAuthorizedComputerIds = hostAuthorized
    ? normalizedAuthorizationComputerIds(opts.hostAuthorizedComputerIds ?? q("SELECT computer_id FROM bot_computers WHERE bot_id=?", opts.botId).map((row) => row.computer_id))
    : [];
  let initialAttempts = 0;
  let maxAttempts = Math.max(1, Math.min(200, Number(opts.maxAttempts) || DEFAULT_MAX_ATTEMPTS));
  let sourceFollowupId: number | null = null;
  if (opts.sourceFollowupId) {
    const source = q1(
      `SELECT id,host_authorized,host_authorized_computer_ids,attempts,max_attempts FROM agent_followups
       WHERE id=? AND agent_id=? AND bot_id=? AND channel_id=? AND thread_id=? AND root_message_id=? AND status='running'`,
      opts.sourceFollowupId, opts.agentId, opts.botId, opts.channelId, opts.threadId, opts.rootMessageId,
    );
    if (!source) throw new Error("The originating scheduled wake is no longer active.");
    if (q1("SELECT 1 FROM agent_followups WHERE source_followup_id=?", source.id)) {
      throw new Error("This scheduled wake already created its one allowed subsequent check.");
    }
    initialAttempts = Number(source.attempts || 0);
    maxAttempts = Math.max(1, Number(source.max_attempts || DEFAULT_MAX_ATTEMPTS));
    if (initialAttempts >= maxAttempts) {
      throw new Error(`The scheduled follow-up reached its ${maxAttempts}-check limit; report the unresolved state instead of scheduling again.`);
    }
    // Defense in depth: even a malformed or stale invocation cannot gain more
    // authority than both the admitted wake and its persisted parent possessed.
    hostAuthorized = hostAuthorized && Number(source.host_authorized || 0) === 1;
    const sourceComputerIds = new Set(storedComputerIds(source.host_authorized_computer_ids));
    hostAuthorizedComputerIds = hostAuthorized ? hostAuthorizedComputerIds.filter((id) => sourceComputerIds.has(id)) : [];
    sourceFollowupId = Number(source.id);
  }
  const channel = q1("SELECT status FROM channels WHERE id=?", opts.channelId);
  if (!channel || channel.status !== "active") throw new Error("Cannot schedule a follow-up on an inactive channel.");
  const thread = q1("SELECT status FROM threads WHERE id=?", opts.threadId);
  if (!thread) throw new Error("Thread not found for follow-up.");
  if (String(thread.status) === "archived") throw new Error("Cannot schedule a follow-up on an archived thread.");
  const pending = Number(
    q1(
      "SELECT COUNT(*) n FROM agent_followups WHERE thread_id=? AND status='pending'",
      opts.threadId,
    )?.n || 0,
  );
  if (pending >= MAX_PENDING_PER_THREAD) {
    throw new Error(`This thread already has ${pending} pending follow-ups (max ${MAX_PENDING_PER_THREAD}). Cancel one or wait.`);
  }

  const id = run(
    `INSERT INTO agent_followups
      (agent_id, bot_id, channel_id, thread_id, root_message_id, due_at, reason, check_hint, host_authorized, host_authorized_computer_ids, source_followup_id, status, attempts, max_attempts, created, updated)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?,?)`,
    opts.agentId,
    opts.botId,
    opts.channelId,
    opts.threadId,
    opts.rootMessageId,
    dueAt,
    reason,
    String(opts.checkHint || "").slice(0, 2000),
    hostAuthorized ? 1 : 0,
    JSON.stringify(hostAuthorizedComputerIds),
    sourceFollowupId,
    initialAttempts,
    maxAttempts,
    now(),
    now(),
  ).lastInsertRowid;
  // A scheduled wake supersedes the stopped-turn continuation: the wake itself
  // carries this context, so the one-shot block must not also fire.
  run("UPDATE threads SET stop_requested=0 WHERE id=?", opts.threadId);
  upsertObligation(opts.channelId, "followup", String(id), "wakeable", reason, dueAt);

  if (opts.markWaiting !== false) {
    run("UPDATE threads SET status='waiting', updated_at=? WHERE id=? AND status IN ('open','failed')", now(), opts.threadId);
    const updated = q1("SELECT * FROM threads WHERE id=?", opts.threadId);
    if (updated) {
      broadcastToChannel(opts.channelId, { type: "thread_update", channelId: opts.channelId, thread: updated });
    }
  }

  run(
    "INSERT INTO channel_activity (channel_id, thread_id, kind, summary, status, actor_type, created) VALUES (?,?,'followup',?,'pending','agent',?)",
    opts.channelId,
    opts.threadId,
    `Scheduled follow-up #${id} in ${delay}s: ${reason}`.slice(0, 500),
    now(),
  );
  refreshThreadSummary(opts.rootMessageId);
  appendThreadHistory(opts.threadId, "followup", { id, due_at: dueAt, reason, check_hint: String(opts.checkHint || ""), status: "pending", attempts: 0, max_attempts: maxAttempts }, "followup", id, `followup:${id}`);
  const followup = {
    id,
    due_at: dueAt,
    reason,
    attempts: 0,
    max_attempts: maxAttempts,
    status: "pending" as const,
    check_hint: String(opts.checkHint || ""),
  };
  broadcastToChannel(opts.channelId, {
    type: "followup",
    channelId: opts.channelId,
    threadId: opts.threadId,
    rootMessageId: opts.rootMessageId,
    followup,
  });
  return { id, due_at: dueAt, delay_seconds: delay };
}

function captainTextAuthorizedForTurn(triggerId: number, threadRootId: number, botId: number): boolean {
  const current = String(q1("SELECT body FROM messages WHERE id=?", triggerId)?.body || "");
  if (isInternalMessageBody(current) && /\[captain-text-authorized\]/i.test(current)) return true;
  const prior = q1(`SELECT body FROM messages WHERE bot_id=? AND id<? AND (id=? OR parent_id=?)
    AND trim(body)<>'' AND body<>'_Working…_' ORDER BY id DESC LIMIT 1`, botId, triggerId, threadRootId, threadRootId);
  const earlierCaptain = q(`SELECT body FROM messages WHERE user_id IS NOT NULL AND id<? AND (id=? OR parent_id=?)
    AND trim(body)<>'' ORDER BY id DESC`, triggerId, threadRootId, threadRootId)
    .find((message) => captainTextConsent(String(message.body || "")));
  return captainTextConsent(current, String(prior?.body || ""), String(earlierCaptain?.body || ""));
}

export async function sendCaptainTextForTurn(input: { triggerId: number; threadRootId: number; botId: number; ownerUserId: number; message: string }): Promise<string> {
  if (!captainTextAuthorizedForTurn(input.triggerId, input.threadRootId, input.botId)) {
    return "Error: outbound texting requires a clear Captain request, a natural continuation of an existing text request, or acceptance of Skipper's offer in this thread.";
  }
  return deliverCaptainText(input.ownerUserId, input.botId, input.message);
}

export function scheduleRuntimeFollowup(opts: ScheduleOpts & { agentKind: string; triggerId: number; observedState?: string }): { id: number; due_at: number; delay_seconds: number } {
  // Strip any model-written sentinel — only the runtime stamp below, issued
  // after the consent check, may carry authorization into the wake. Channel
  // residents need no stamp: their texting runs on the durable channel grant.
  let reason = String(opts.reason || "").replace(/\[captain-text-authorized\]\s*/gi, "");
  if (opts.agentKind === "skipper" && mentionsCaptainTexting(reason)) {
    if (!captainTextAuthorizedForTurn(opts.triggerId, opts.rootMessageId, opts.botId)) {
      throw new Error("A text reminder requires clear conversational permission from the Captain in this thread.");
    }
    reason = `[captain-text-authorized] ${reason}`;
  }
  const trigger = q1("SELECT bot_id,body FROM messages WHERE id=?", opts.triggerId);
  const creatingTurn = q1("SELECT host_authorized,host_authorized_computer_ids FROM agent_turns WHERE trigger_id=? AND bot_id=? AND channel_id=? AND thread_root_id=?", opts.triggerId, opts.botId, opts.channelId, opts.rootMessageId);
  const admittedHostAuthorized = opts.agentKind === "skipper" && opts.hostAuthorized === true && Number(creatingTurn?.host_authorized || 0) === 1;
  const admittedTurnComputers = new Set(storedComputerIds(creatingTurn?.host_authorized_computer_ids));
  const admittedHostComputerIds = admittedHostAuthorized
    ? normalizedAuthorizationComputerIds(opts.hostAuthorizedComputerIds).filter((id) => admittedTurnComputers.has(id))
    : [];
  const wakeId = Number(String(trigger?.body || "").match(/^\[scheduled-followup\s+id=(\d+)\b/i)?.[1] || 0);
  const source = wakeId && Number(trigger?.bot_id || 0) === Number(opts.botId)
    ? q1(`SELECT id,host_authorized FROM agent_followups WHERE id=? AND agent_id=? AND bot_id=? AND channel_id=?
        AND thread_id=? AND root_message_id=? AND status='running'`, wakeId, opts.agentId, opts.botId, opts.channelId, opts.threadId, opts.rootMessageId)
    : undefined;
  if (source && opts.observedState !== "confirmed_running") {
    throw new Error("A scheduled wake may create another check only after available tools confirm the task is still running. If inspection is unavailable or failed, task state is unknown: report one useful blocker and do not reschedule.");
  }
  if (source) {
    const admitted = q1("SELECT queued_at FROM agent_turns WHERE trigger_id=? AND bot_id=? AND channel_id=? AND thread_root_id=?", opts.triggerId, opts.botId, opts.channelId, opts.rootMessageId);
    const observableTool = admitted && q1(`SELECT 1 FROM tool_actions WHERE agent_id=? AND thread_id=? AND created>=? AND status IN ('complete','running')
      AND tool IN ('run_command','search_web','inspect_web_source','gmail_search','gmail_get','inspect_channel','inspect_fleet') LIMIT 1`, opts.agentId, opts.threadId, admitted.queued_at);
    if (!observableTool) {
      throw new Error("Task state is unknown: no available inspection tool completed successfully on this wake. Report one useful blocker and do not reschedule.");
    }
  }
  return scheduleAgentFollowup({
    ...opts,
    reason,
    hostAuthorized: admittedHostAuthorized,
    hostAuthorizedComputerIds: admittedHostComputerIds,
    sourceFollowupId: source ? Number(source.id) : undefined,
  });
}

export function followupWakeStateInstructions(hostCommand: "available" | "unavailable" | "resident"): string {
  const capability = hostCommand === "available"
    ? "Host run_command capability: available for Skipper's currently assigned computers, under the authority captured when this follow-up was created."
    : hostCommand === "resident"
      ? "Host run_command capability: unavailable. Any run_command you receive is confined to this channel's resident computer."
      : "Host run_command capability: unavailable for this wake. If the requested check depends on host files or processes, its state is unknown.";
  return `${capability}\nClassify the task from direct evidence as exactly one of: confirmed still running; confirmed complete; or state unknown because inspection capability is unavailable or the check failed. Only a directly confirmed-running task may call schedule_followup, exactly once, with observed_state=confirmed_running. A complete task must report completion and not reschedule. An unknown task must report one useful blocker and not reschedule. Never interpret inability to inspect as evidence that work is still running.`;
}

/** Next pending wake for a thread (soonest due_at), or null. */
export function nextFollowupForThread(threadId: number): {
  id: number;
  due_at: number;
  reason: string;
  attempts: number;
  max_attempts: number;
  status: string;
  check_hint: string;
} | null {
  const row = q1(
    `SELECT id, due_at, reason, attempts, max_attempts, status, check_hint
     FROM agent_followups
     WHERE thread_id=? AND status='pending'
     ORDER BY due_at ASC LIMIT 1`,
    threadId,
  );
  if (!row) return null;
  return {
    id: Number(row.id),
    due_at: Number(row.due_at),
    reason: String(row.reason || ""),
    attempts: Number(row.attempts || 0),
    max_attempts: Number(row.max_attempts || DEFAULT_MAX_ATTEMPTS),
    status: String(row.status || "pending"),
    check_hint: String(row.check_hint || ""),
  };
}

/** Attach follow-up payload for Board / Threads API responses. */
export function threadFollowupView(threadId: number): Record<string, unknown> | null {
  const f = nextFollowupForThread(threadId);
  return f;
}

/**
 * Captain "Check now" / bump: drop due_at to now and fire the same wake path
 * immediately (not a fake status change — same durable follow-up outcome).
 * Returns after queueing the wake; agent turn runs async like the timer loop.
 */
export function bumpThreadFollowup(threadId: number): {
  ok: true;
  followup_id: number;
  due_at: number;
} | { ok: false; error: string } {
  const pending = q1(
    `SELECT * FROM agent_followups
     WHERE thread_id=? AND status='pending'
     ORDER BY due_at ASC LIMIT 1`,
    threadId,
  );
  if (!pending) {
    return { ok: false, error: "No pending scheduled wake on this thread." };
  }
  const id = Number(pending.id);
  const channelId = Number(pending.channel_id);
  const rootMessageId = Number(pending.root_message_id);
  const due = now();
  // Countdown → 0 (due now).
  run(
    "UPDATE agent_followups SET due_at=?, last_error=?, updated=? WHERE id=? AND status='pending'",
    due,
    "bumped by Captain — check now",
    due,
    id,
  );
  const followup = nextFollowupForThread(threadId);
  broadcastToChannel(channelId, {
    type: "followup",
    channelId,
    threadId,
    rootMessageId,
    followup,
  });
  // Same claim/wake path as the timer — don't block the HTTP request on the agent turn.
  setTimeout(() => {
    void runFollowupPass().catch((error) => console.error("bump followup fire failed:", (error as Error).message));
  }, 0);
  return { ok: true, followup_id: id, due_at: due };
}

export function cancelPendingFollowup(threadId: number, followupId: number): { ok: true; followup: Record<string, unknown> | null } | { ok: false; code: 404 | 409; error: string } {
  const row = q1("SELECT id,thread_id,channel_id,root_message_id,status FROM agent_followups WHERE id=?", followupId);
  if (!row || Number(row.thread_id) !== threadId) return { ok: false, code: 404, error: "Follow-up not found." };
  if (String(row.status) !== "pending") return { ok: false, code: 409, error: String(row.status) === "running" ? "Follow-up has already started." : "Follow-up is no longer pending." };
  const changed = run("UPDATE agent_followups SET status='cancelled',updated=?,last_error='cancelled by Captain' WHERE id=? AND thread_id=? AND status='pending'", now(), followupId, threadId).changes;
  if (!changed) return { ok: false, code: 409, error: "Follow-up has already started." };
  satisfyObligation(Number(row.channel_id), "followup", String(followupId));
  appendThreadHistory(threadId, "followup", { id: followupId, status: "cancelled", reason: "cancelled by Captain" }, "followup_cancel", followupId, `followup:${followupId}`);
  const followup = threadFollowupView(threadId);
  broadcastToChannel(Number(row.channel_id), { type: "followup", channelId: Number(row.channel_id), threadId, rootMessageId: Number(row.root_message_id), followup });
  return { ok: true, followup };
}

export function cancelThreadFollowups(threadId: number, reason = "cancelled"): number {
  for (const row of q("SELECT id,channel_id FROM agent_followups WHERE thread_id=? AND status IN ('pending','running')", threadId)) satisfyObligation(Number(row.channel_id), "followup", String(row.id));
  return run(
    "UPDATE agent_followups SET status='cancelled', updated=?, last_error=? WHERE thread_id=? AND status IN ('pending','running')",
    now(),
    reason.slice(0, 500),
    threadId,
  ).changes;
}

export function cancelChannelFollowups(channelId: number, reason = "channel archived"): number {
  for (const row of q("SELECT id FROM agent_followups WHERE channel_id=? AND status IN ('pending','running')", channelId)) satisfyObligation(channelId, "followup", String(row.id));
  return run(
    "UPDATE agent_followups SET status='cancelled', updated=?, last_error=? WHERE channel_id=? AND status IN ('pending','running')",
    now(),
    reason.slice(0, 500),
    channelId,
  ).changes;
}

function claimDueFollowups(limit = 10): Row[] {
  const due = now();
  const rows = q(
    `SELECT * FROM agent_followups
     WHERE status='pending' AND due_at<=?
     ORDER BY due_at ASC LIMIT ?`,
    due,
    limit,
  );
  const claimed: Row[] = [];
  for (const row of rows) {
    const result = run(
      "UPDATE agent_followups SET status='running', updated=?, attempts=attempts+1 WHERE id=? AND status='pending'",
      now(),
      row.id,
    );
    if (result.changes) claimed.push({ ...row, attempts: Number(row.attempts) + 1, status: "running" });
  }
  return claimed;
}

function finishFollowup(
  id: number,
  status: "done" | "failed" | "pending" | "cancelled",
  error = "",
  nextDueAt?: number,
): boolean {
  const row = q1("SELECT thread_id FROM agent_followups WHERE id=?", id);
  const changed = status === "pending" && nextDueAt
    ? run("UPDATE agent_followups SET status='pending',due_at=?,last_error=?,updated=? WHERE id=? AND status='running'", nextDueAt, error.slice(0, 500), now(), id).changes > 0
    : run("UPDATE agent_followups SET status=?,last_error=?,updated=? WHERE id=? AND status='running'", status, error.slice(0, 500), now(), id).changes > 0;
  if (changed && row) appendThreadHistory(Number(row.thread_id), "followup", { id, status, error, next_due_at: nextDueAt || null }, "followup_finish", id, `followup:${id}`);
  return changed;
}

/** Fire one due follow-up: create a wake trigger and run the agent turn. */
async function fireFollowup(row: Row): Promise<void> {
  const id = Number(row.id);
  const channelId = Number(row.channel_id);
  const rootMessageId = Number(row.root_message_id);
  const threadId = Number(row.thread_id);
  const botId = Number(row.bot_id);
  const attempts = Number(row.attempts || 0);
  const maxAttempts = Number(row.max_attempts || DEFAULT_MAX_ATTEMPTS);
  const reason = String(row.reason || "");
  const checkHint = String(row.check_hint || "");
  const hostAuthorized = String(agentForBot(botId)?.kind || "") === "skipper" && Number(row.host_authorized || 0) === 1;
  const hostAuthorizedComputerIds = hostAuthorized ? storedComputerIds(row.host_authorized_computer_ids) : [];
  appendThreadHistory(threadId, "followup", { id, status: "wake_started", attempts, max_attempts: maxAttempts, reason, check_hint: checkHint }, "followup_wake", id, `followup:${id}`);

  const channel = q1("SELECT status FROM channels WHERE id=?", channelId);
  if (!channel || channel.status !== "active") {
    finishFollowup(id, "cancelled", "channel inactive");
    satisfyObligation(channelId, "followup", String(id));
    broadcastToChannel(channelId, { type: "followup", channelId, threadId, rootMessageId, followup: null });
    return;
  }
  const thread = q1("SELECT status, root_message_id FROM threads WHERE id=?", threadId);
  if (!thread || String(thread.status) === "archived") {
    finishFollowup(id, "cancelled", "thread gone or archived");
    satisfyObligation(channelId, "followup", String(id));
    broadcastToChannel(channelId, { type: "followup", channelId, threadId, rootMessageId, followup: null });
    return;
  }
  // If Captain already resolved the thread, stop polling.
  if (String(thread.status) === "resolved") {
    finishFollowup(id, "done", "thread already resolved");
    satisfyObligation(channelId, "followup", String(id));
    broadcastToChannel(channelId, { type: "followup", channelId, threadId, rootMessageId, followup: null });
    return;
  }

  const bot = q1("SELECT * FROM bots WHERE id=?", botId);
  const agent = agentForBot(botId);
  if (!bot || !agent || ["archived", "paused", "deleted"].includes(String(agent.status))) {
    finishFollowup(id, "failed", "agent unavailable");
    satisfyObligation(channelId, "followup", String(id));
    broadcastToChannel(channelId, { type: "followup", channelId, threadId, rootMessageId, followup: null });
    return;
  }

  if (attempts > maxAttempts) {
    const body = `Blocked — scheduled follow-up exhausted after ${maxAttempts} checks.\n\nReason: ${reason}${checkHint ? `\nCheck: ${checkHint}` : ""}`;
    createMessage({ channelId, parentId: rootMessageId, botId, body });
    run("UPDATE threads SET status='failed', updated_at=? WHERE id=?", now(), threadId);
    finishFollowup(id, "failed", "max attempts exceeded");
    satisfyObligation(channelId, "followup", String(id));
    refreshThreadSummary(rootMessageId);
    const updated = q1("SELECT * FROM threads WHERE id=?", threadId);
    if (updated) broadcastToChannel(channelId, { type: "thread_update", channelId, thread: updated });
    broadcastToChannel(channelId, { type: "followup", channelId, threadId, rootMessageId, followup: null });
    return;
  }

  // Re-open waiting threads so the wake is active work.
  if (String(thread.status) === "waiting") {
    run("UPDATE threads SET status='open', updated_at=? WHERE id=?", now(), threadId);
    const updated = q1("SELECT * FROM threads WHERE id=?", threadId);
    if (updated) broadcastToChannel(channelId, { type: "thread_update", channelId, thread: updated });
  }

  const wakeBody = [
    `[scheduled-followup id=${id} attempt=${attempts}/${maxAttempts}]`,
    `You were re-invoked by a durable scheduled follow-up (not a new human message).`,
    `Check / finish: ${reason}`,
    checkHint ? `Hint: ${checkHint}` : "",
    followupWakeStateInstructions(String(agent.kind) === "skipper" ? (hostAuthorized ? "available" : "unavailable") : "resident"),
    `Never echo this scaffold, never paste raw memory dumps, never paste <memory-context> / tool journals into chat.`,
  ].filter(Boolean).join("\n");

  // Stored for model context only — not broadcast, not shown in chat UI.
  const triggerId = createMessage({
    channelId,
    parentId: rootMessageId,
    botId,
    body: wakeBody,
  });

  run(
    "INSERT INTO channel_activity (channel_id, thread_id, kind, summary, status, actor_type, created) VALUES (?,?,'followup',?,'running','system',?)",
    channelId,
    threadId,
    `Waking follow-up #${id} (attempt ${attempts}/${maxAttempts})`.slice(0, 500),
    now(),
  );
  // No WS message broadcast — wakes are invisible; only the agent's final reply (if any) is public.

  try {
    // Skipper lives in the control plane and has no resident channel computer.
    // Ordinary residents still wake their isolated computer before re-entry.
    if (String(agent.kind) !== "skipper") await ensureChannelComputerRunning(channelId, `scheduled follow-up #${id}`);
    // Dynamic import avoids a static cycle with bots.ts (which imports scheduleAgentFollowup).
    const { runBot } = await import("./bots.ts");
    await runBot(bot, channelId, triggerId, rootMessageId, false, undefined, hostAuthorized, undefined, hostAuthorizedComputerIds);
    finishFollowup(id, "done");
    satisfyObligation(channelId, "followup", String(id));
    broadcastToChannel(channelId, {
      type: "followup",
      channelId,
      threadId,
      rootMessageId,
      followup: nextFollowupForThread(threadId),
    });
  } catch (error) {
    const msg = (error as Error).message || "wake failed";
    if (attempts < maxAttempts) {
      const retryAt = now() + 60_000;
      if (finishFollowup(id, "pending", msg, retryAt)) {
        upsertObligation(channelId, "followup", String(id), "wakeable", reason, retryAt);
      }
    } else {
      finishFollowup(id, "failed", msg);
      satisfyObligation(channelId, "followup", String(id));
    }
    broadcastToChannel(channelId, {
      type: "followup",
      channelId,
      threadId,
      rootMessageId,
      followup: nextFollowupForThread(threadId),
    });
  }
}

export async function runFollowupPass(): Promise<{ due: number; fired: number }> {
  const claimed = claimDueFollowups(10);
  let fired = 0;
  for (const row of claimed) {
    await fireFollowup(row);
    fired++;
  }
  return { due: claimed.length, fired };
}

/** A process may stop after claiming a wake but before recording its outcome.
 * Re-queue that same durable row without changing its authorization provenance
 * or refunding the already-consumed attempt. */
export function recoverInterruptedFollowups(): number {
  const recoveredAt = now();
  const rows = q("SELECT id,channel_id,reason FROM agent_followups WHERE status='running'");
  for (const row of rows) {
    if (q1("SELECT 1 FROM agent_followups WHERE source_followup_id=?", row.id)) {
      run("UPDATE agent_followups SET status='done',last_error='successor persisted before server restart',updated=? WHERE id=? AND status='running'", recoveredAt, row.id);
      satisfyObligation(Number(row.channel_id), "followup", String(row.id));
    } else {
      run("UPDATE agent_followups SET status='pending',due_at=?,last_error='server restart interrupted scheduled wake',updated=? WHERE id=? AND status='running'", recoveredAt, recoveredAt, row.id);
      upsertObligation(Number(row.channel_id), "followup", String(row.id), "wakeable", String(row.reason || ""), recoveredAt);
    }
  }
  return rows.length;
}

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startFollowupLoop(): void {
  if (timer) return;
  recoverInterruptedFollowups();
  const tick = () => {
    if (running) return;
    running = true;
    void runFollowupPass()
      .catch((error) => console.error("followup pass failed:", (error as Error).message))
      .finally(() => { running = false; });
  };
  setTimeout(tick, Math.min(5_000, CHECK_EVERY_MS)).unref();
  timer = setInterval(tick, Math.max(5_000, CHECK_EVERY_MS));
  timer.unref();
}

/** Test/helper: ensure thread id exists for a root. */
export function ensureFollowupThread(rootMessageId: number, channelId: number): number {
  return threadIdForRoot(rootMessageId, channelId) ?? ensureThread(rootMessageId, channelId);
}
