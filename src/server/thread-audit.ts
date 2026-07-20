import { now, q, q1, run, type Row } from "./db.ts";
import { botEndpoint, resolveModel } from "./store.ts";
import { broadcastToChannel } from "./events.ts";
import { refreshThreadSummary, agentForChannel } from "./agents.ts";
import { scheduleAgentReview } from "./improvements.ts";

/** Default: every ~10 minutes Skipper audits thread statuses workspace-wide. */
const CHECK_EVERY_MS = Number(process.env.THREAD_AUDIT_INTERVAL_MS || 10 * 60_000);
/** Skip threads that moved in the last 2 minutes so live turns are not raced. */
const MIN_IDLE_MS = Number(process.env.THREAD_AUDIT_MIN_IDLE_MS || 2 * 60_000);
const MAX_THREADS_PER_PASS = Number(process.env.THREAD_AUDIT_MAX_THREADS || 40);
const AUDIT_STATUSES = new Set(["open", "waiting", "resolved", "failed"]);

type AuditDecision = {
  thread_id: number;
  status: "open" | "waiting" | "resolved" | "failed" | "keep";
  reason: string;
};

type ThreadDossier = {
  thread_id: number;
  channel_id: number;
  channel_name: string;
  root_message_id: number;
  status: string;
  title: string;
  summary: string;
  opened_at: number;
  updated_at: number;
  idle_minutes: number;
  open_escalations: number;
  recent_messages: { who: string; body: string }[];
  last_tools: { tool: string; status: string; result: string }[];
};

function compact(value: unknown, limit: number): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function threadPayload(threadId: number): Row | undefined {
  return q1(
    `SELECT t.*, m.body AS root_body FROM threads t
     JOIN messages m ON m.id=t.root_message_id WHERE t.id=?`,
    threadId,
  );
}

function collectCandidates(limit: number): ThreadDossier[] {
  const idleBefore = now() - MIN_IDLE_MS;
  const rows = q(
    `SELECT t.id, t.channel_id, t.root_message_id, t.status, t.title, t.summary, t.opened_at, t.updated_at, c.name AS channel_name
     FROM threads t
     JOIN channels c ON c.id=t.channel_id
     WHERE c.kind='channel' AND c.status='active'
       AND t.status IN ('open','waiting','failed')
       AND t.updated_at <= ?
     ORDER BY t.updated_at ASC
     LIMIT ?`,
    idleBefore,
    limit,
  );
  const dossiers: ThreadDossier[] = [];
  for (const row of rows) {
    const threadId = Number(row.id);
    const channelId = Number(row.channel_id);
    // Skip channels with an in-flight agent turn.
    if (q1("SELECT 1 FROM agents a JOIN agent_channels ac ON ac.agent_id=a.id WHERE ac.channel_id=? AND a.status='working'", channelId)) continue;
    if (q1("SELECT 1 FROM tool_actions WHERE thread_id=? AND status='running'", threadId)) continue;
    const rootId = Number(row.root_message_id);
    const messages = q(
      `SELECT m.body, m.user_id, m.bot_id, u.display AS user_display, b.name AS bot_name
       FROM messages m
       LEFT JOIN users u ON u.id=m.user_id
       LEFT JOIN bots b ON b.id=m.bot_id
       WHERE m.id=? OR m.parent_id=?
       ORDER BY m.id DESC LIMIT 8`,
      rootId,
      rootId,
    ).reverse();
    const tools = q(
      `SELECT tool, status, result_summary FROM tool_actions WHERE thread_id=? ORDER BY id DESC LIMIT 4`,
      threadId,
    );
    const openEscalations = Number(
      q1("SELECT COUNT(*) n FROM escalations WHERE thread_id=? AND status='open'", threadId)?.n || 0,
    );
    dossiers.push({
      thread_id: threadId,
      channel_id: channelId,
      channel_name: String(row.channel_name || channelId),
      root_message_id: rootId,
      status: String(row.status),
      title: String(row.title || ""),
      summary: String(row.summary || ""),
      opened_at: Number(row.opened_at),
      updated_at: Number(row.updated_at),
      idle_minutes: Math.max(0, Math.round((now() - Number(row.updated_at)) / 60_000)),
      open_escalations: openEscalations,
      recent_messages: messages.map((message) => ({
        who: message.bot_id != null
          ? `@${message.bot_name || "agent"}`
          : String(message.user_display || "human"),
        body: compact(message.body, 320),
      })),
      last_tools: tools.map((tool) => ({
        tool: String(tool.tool),
        status: String(tool.status),
        result: compact(tool.result_summary, 180),
      })),
    });
  }
  return dossiers;
}

/** Conservative local judgment when the model is unavailable or returns noise. */
export function heuristicAuditDecisions(dossiers: ThreadDossier[]): AuditDecision[] {
  const decisions: AuditDecision[] = [];
  for (const dossier of dossiers) {
    const blob = [
      dossier.title,
      dossier.summary,
      ...dossier.recent_messages.map((message) => `${message.who}: ${message.body}`),
    ].join("\n").toLowerCase();
    const last = dossier.recent_messages.at(-1);
    const humanClosed =
      /\b(that'?s all|all set|we'?re good|you can close|mark (this |it )?resolved|resolved|done for now|no further action|thanks[,!.]?\s*(that'?s|this is)?\s*(all|it|perfect|great)?)\b/i
        .test(blob)
      && last?.who.startsWith("@") === false
      && dossier.open_escalations === 0;
    const agentDelivered =
      last?.who.startsWith("@")
      && dossier.open_escalations === 0
      && dossier.last_tools.every((tool) => tool.status !== "running" && tool.status !== "failed")
      && /\b(done|complete|completed|finished|shipped|fixed|resolved|ready|here (is|are)|answer complete)\b/i.test(
        `${dossier.summary}\n${last.body}`,
      )
      && dossier.idle_minutes >= 5
      && !/\b(still need|waiting (on|for)|let me know|what would you like|need (your|more) (input|info|details)|blocked|can you|please (confirm|choose|provide))\b/i
        .test(`${dossier.summary}\n${last.body}`);
    const needsHuman =
      dossier.open_escalations > 0
      || /\b(waiting (on|for) (you|captain|human|approval|input)|need your (input|decision|approval)|blocked on|please (confirm|choose|provide|reply))\b/i
        .test(blob);
    const clearlyFailed =
      dossier.status === "failed"
      || (
        dossier.last_tools.some((tool) => tool.status === "failed")
        && /\b(failed|error|could not|unable to)\b/i.test(blob)
        && dossier.idle_minutes >= 30
        && !/\b(retry|try again|fixed|working now)\b/i.test(blob)
      );

    if (humanClosed || agentDelivered) {
      if (dossier.status !== "resolved") {
        decisions.push({
          thread_id: dossier.thread_id,
          status: "resolved",
          reason: humanClosed
            ? "Human closure language and no open escalations."
            : "Agent delivered a complete outcome; thread has been idle with no open work.",
        });
      } else {
        decisions.push({ thread_id: dossier.thread_id, status: "keep", reason: "Already resolved." });
      }
      continue;
    }
    if (clearlyFailed && dossier.status !== "failed") {
      decisions.push({
        thread_id: dossier.thread_id,
        status: "failed",
        reason: "Thread shows a durable failure with no recovery signal.",
      });
      continue;
    }
    if (needsHuman && dossier.status !== "waiting") {
      decisions.push({
        thread_id: dossier.thread_id,
        status: "waiting",
        reason: "Blocked on Captain/human input or an open escalation.",
      });
      continue;
    }
    decisions.push({
      thread_id: dossier.thread_id,
      status: "keep",
      reason: "Still looks like active or ambiguous work; leave status alone.",
    });
  }
  return decisions;
}

function parseAuditJson(raw: string): AuditDecision[] {
  const text = String(raw || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: AuditDecision[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const threadId = Number(row.thread_id ?? row.threadId);
      const status = String(row.status || "keep").toLowerCase();
      if (!Number.isFinite(threadId) || threadId <= 0) continue;
      if (!["open", "waiting", "resolved", "failed", "keep"].includes(status)) continue;
      out.push({
        thread_id: threadId,
        status: status as AuditDecision["status"],
        reason: compact(row.reason || row.rationale || "", 400) || "Skipper audit.",
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function skipperModelDecisions(dossiers: ThreadDossier[]): Promise<AuditDecision[] | null> {
  const skipper = q1(
    `SELECT a.id AS agent_id, a.bot_id, b.model FROM agents a
     JOIN bots b ON b.id=a.bot_id
     WHERE a.kind='skipper' AND a.status<>'deleted' LIMIT 1`,
  );
  if (!skipper?.bot_id) return null;
  const botId = Number(skipper.bot_id);
  const endpoint = botEndpoint(botId);
  if (!endpoint?.base_url) return null;
  const model = resolveModel(botId, null, null) || String(skipper.model || "");
  if (!model) return null;

  const system = [
    "You are Skipper, workspace-wide chief of staff for 1Helm.",
    "You are running a silent thread-status audit. Read each dossier (summary + recent messages + tools).",
    "Decide whether the session status should change.",
    "Statuses: open (active work), waiting (blocked on human/external input), resolved (clearly finished), failed (clearly broken/abandoned), keep (do not change).",
    "Be conservative: only mark resolved when the goal is clearly complete; only waiting when clearly blocked; only failed when clearly dead.",
    "Ambiguous or still-moving work must stay keep/open.",
    "Never invent work. Never archive. Respond with ONLY a JSON array:",
    '[{"thread_id":123,"status":"resolved|waiting|failed|open|keep","reason":"one short sentence"}]',
  ].join(" ");

  const user = `Audit these threads and return one decision object per thread_id:\n${JSON.stringify(dossiers, null, 2)}`;
  const base = endpoint.base_url.replace(/\/$/, "");
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(endpoint.api_key ? { authorization: `Bearer ${endpoint.api_key}` } : {}),
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        stream: false,
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) return null;
    const payload = await response.json() as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content || "";
    const parsed = parseAuditJson(content);
    return parsed.length ? parsed : null;
  } catch {
    return null;
  }
}

function applyDecision(dossier: ThreadDossier, decision: AuditDecision): boolean {
  if (decision.status === "keep") return false;
  if (!AUDIT_STATUSES.has(decision.status)) return false;
  if (decision.status === dossier.status) return false;
  const thread = q1("SELECT id, status, channel_id, root_message_id FROM threads WHERE id=?", dossier.thread_id);
  if (!thread) return false;
  // Another writer may have moved it (human message reopened, etc.).
  if (String(thread.status) !== dossier.status) return false;

  run("UPDATE threads SET status=?, updated_at=? WHERE id=?", decision.status, now(), dossier.thread_id);
  if (decision.status === "resolved") {
    run("UPDATE thread_agent_guests SET status='removed' WHERE thread_id=?", dossier.thread_id);
    const resident = agentForChannel(Number(thread.channel_id));
    if (resident) scheduleAgentReview(Number(resident.id));
  }
  refreshThreadSummary(Number(thread.root_message_id));
  const updated = threadPayload(dossier.thread_id);
  run(
    "INSERT INTO channel_activity (channel_id, thread_id, kind, summary, status, actor_type, created) VALUES (?,?,'thread_audit',?,?, 'skipper',?)",
    dossier.channel_id,
    dossier.thread_id,
    `Skipper marked thread "${compact(dossier.title, 80)}" ${decision.status}: ${decision.reason}`.slice(0, 500),
    decision.status,
    now(),
  );
  broadcastToChannel(Number(thread.channel_id), {
    type: "thread_update",
    channelId: Number(thread.channel_id),
    thread: updated,
  });
  return true;
}

/**
 * Skipper audits durable thread statuses across the workspace.
 * Prefer model judgment on summaries; fall back to conservative heuristics.
 */
export async function runThreadAuditPass(): Promise<{ examined: number; changed: number; source: string }> {
  const dossiers = collectCandidates(MAX_THREADS_PER_PASS);
  const main = q1("SELECT id FROM channels WHERE name='main' AND kind='channel' AND status='active' LIMIT 1");
  if (!dossiers.length) {
    if (main) {
      run(
        "INSERT INTO channel_activity (channel_id, kind, summary, status, actor_type, created) VALUES (?,'thread_audit',?,?, 'skipper',?)",
        main.id,
        "Skipper thread-status audit: no idle open/waiting/failed threads to review.",
        "quiet",
        now(),
      );
    }
    return { examined: 0, changed: 0, source: "none" };
  }

  let decisions = await skipperModelDecisions(dossiers);
  let source = "model";
  if (!decisions) {
    decisions = heuristicAuditDecisions(dossiers);
    source = "heuristic";
  }

  const byId = new Map(dossiers.map((dossier) => [dossier.thread_id, dossier]));
  let changed = 0;
  const notes: string[] = [];
  for (const decision of decisions) {
    const dossier = byId.get(decision.thread_id);
    if (!dossier) continue;
    if (applyDecision(dossier, decision)) {
      changed++;
      notes.push(`#${dossier.channel_name} “${compact(dossier.title, 40)}” → ${decision.status}`);
    }
  }

  // Always leave a #main breadcrumb so Activity shows Skipper's periodic checks —
  // not only when statuses move. Quiet "nothing changed" is still signal.
  if (main) {
    const summary = changed
      ? `Skipper audited ${dossiers.length} thread(s); updated ${changed}: ${notes.slice(0, 6).join("; ")}`
      : `Skipper audited ${dossiers.length} idle thread(s); no status changes (${source}).`;
    run(
      "INSERT INTO channel_activity (channel_id, kind, summary, status, actor_type, created) VALUES (?,'thread_audit',?,?, 'skipper',?)",
      main.id,
      summary.slice(0, 500),
      changed ? "complete" : "quiet",
      now(),
    );
  }
  return { examined: dossiers.length, changed, source };
}

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startThreadAuditLoop(): void {
  if (timer) return;
  const tick = () => {
    if (running) return;
    running = true;
    void runThreadAuditPass()
      .catch((error) => console.error("thread-audit pass failed:", (error as Error).message))
      .finally(() => { running = false; });
  };
  // First pass after a short settle so boot traffic finishes.
  setTimeout(tick, Math.min(45_000, CHECK_EVERY_MS)).unref();
  timer = setInterval(tick, Math.max(30_000, CHECK_EVERY_MS));
  timer.unref();
}
