import { q, q1, run, now, type Row } from "./db.ts";
import { createMessage } from "./store.ts";
import { broadcastToChannel } from "./events.ts";
import { agentForBot, ensureThread, refreshThreadSummary, threadIdForRoot } from "./agents.ts";
import { ensureChannelComputerRunning, satisfyObligation, upsertObligation } from "./channel-computers.ts";

/** Poll due follow-ups often enough for media downloads without burning CPU. */
const CHECK_EVERY_MS = Number(process.env.FOLLOWUP_INTERVAL_MS || 15_000);
const MIN_DELAY_SEC = 30;
const MAX_DELAY_SEC = 6 * 60 * 60;
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
  /** When true, mark the durable thread waiting (async work, not human input). */
  markWaiting?: boolean;
};

function clampDelay(seconds: number): number {
  const n = Math.floor(Number(seconds) || 0);
  if (!Number.isFinite(n)) return MIN_DELAY_SEC;
  return Math.max(MIN_DELAY_SEC, Math.min(MAX_DELAY_SEC, n));
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
      (agent_id, bot_id, channel_id, thread_id, root_message_id, due_at, reason, check_hint, status, attempts, max_attempts, created, updated)
     VALUES (?,?,?,?,?,?,?,?,'pending',0,?,?,?)`,
    opts.agentId,
    opts.botId,
    opts.channelId,
    opts.threadId,
    opts.rootMessageId,
    dueAt,
    reason,
    String(opts.checkHint || "").slice(0, 2000),
    Math.max(1, Math.min(200, Number(opts.maxAttempts) || DEFAULT_MAX_ATTEMPTS)),
    now(),
    now(),
  ).lastInsertRowid;
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
  const followup = {
    id,
    due_at: dueAt,
    reason,
    attempts: 0,
    max_attempts: Math.max(1, Math.min(200, Number(opts.maxAttempts) || DEFAULT_MAX_ATTEMPTS)),
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
): void {
  if (status === "pending" && nextDueAt) {
    run(
      "UPDATE agent_followups SET status='pending', due_at=?, last_error=?, updated=? WHERE id=?",
      nextDueAt,
      error.slice(0, 500),
      now(),
      id,
    );
    return;
  }
  run(
    "UPDATE agent_followups SET status=?, last_error=?, updated=? WHERE id=?",
    status,
    error.slice(0, 500),
    now(),
    id,
  );
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
    `If the work is still in progress, call schedule_followup again (do not invent a silent background wait) and produce NO user-facing chat.`,
    `If finished or hard-blocked, post only the final user-facing result (e.g. Downloaded / Blocked + reason) and do not reschedule.`,
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
    await ensureChannelComputerRunning(channelId, `scheduled follow-up #${id}`);
    // Dynamic import avoids a static cycle with bots.ts (which imports scheduleAgentFollowup).
    const { runBot } = await import("./bots.ts");
    await runBot(bot, channelId, triggerId, rootMessageId, false, undefined, false);
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
      finishFollowup(id, "pending", msg, retryAt);
      upsertObligation(channelId, "followup", String(id), "wakeable", reason, retryAt);
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

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startFollowupLoop(): void {
  if (timer) return;
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
