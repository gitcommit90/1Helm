import { q, q1, run, now, type Row } from "./db.ts";
export { queueLastRead, shutdownReadStateWorker } from "./read-state.ts";

export type Msg = { channelId: number; parentId: number | null; userId?: number | null; botId?: number | null; body: string };

/** Internal wake scaffolds are stored for model context but never shown in chat. */
export function isInternalMessageBody(body: string): boolean {
  const text = String(body || "").trim();
  return /^\[scheduled-followup\b/i.test(text) || text.startsWith("⟦followup⟧");
}

export function createMessage(m: Msg): number {
  const id = run(
    "INSERT INTO messages (channel_id, parent_id, user_id, bot_id, body, created) VALUES (?,?,?,?,?,?)",
    m.channelId, m.parentId, m.userId ?? null, m.botId ?? null, m.body, now(),
  ).lastInsertRowid;
  if (m.parentId) {
    const conversationId = q1("SELECT photon_conversation_id FROM messages WHERE id=?", m.parentId)?.photon_conversation_id;
    if (conversationId) run("UPDATE messages SET photon_conversation_id=? WHERE id=?", conversationId, id);
  }
  // Internal wake triggers still need a parent_id link for ordering, but must not
  // inflate the user-visible reply count.
  if (m.parentId && !isInternalMessageBody(m.body)) {
    run("UPDATE messages SET reply_count = reply_count + 1, last_reply=? WHERE id=?", now(), m.parentId);
  }
  return id;
}

export type DeleteMessageResult = {
  id: number;
  channel_id: number;
  parent_id: number | null;
  deleted_ids: number[];
  parent?: { id: number; reply_count: number; last_reply: number | null };
};

/** Hard-delete a message. Authors can delete their own user messages; admins can delete any (including bots). Root delete cascades replies. */
export function deleteMessage(id: number, actorUserId: number, isAdmin: boolean): DeleteMessageResult {
  const msg = q1("SELECT * FROM messages WHERE id=?", id);
  if (!msg) {
    const err = new Error("Message not found");
    (err as Error & { status: number }).status = 404;
    throw err;
  }
  const isAuthor = msg.user_id != null && Number(msg.user_id) === actorUserId && msg.bot_id == null;
  if (!isAuthor && !isAdmin) {
    const err = new Error("You can only delete your own messages");
    (err as Error & { status: number }).status = 403;
    throw err;
  }

  const channelId = Number(msg.channel_id);
  const parentId = msg.parent_id == null ? null : Number(msg.parent_id);
  const ids: number[] = [Number(msg.id)];
  if (parentId == null) {
    for (const r of q("SELECT id FROM messages WHERE parent_id=?", msg.id)) ids.push(Number(r.id));
  }

  for (const mid of ids) run("DELETE FROM attachments WHERE message_id=?", mid);
  for (const mid of ids) run("DELETE FROM messages WHERE id=?", mid);

  // Cascade: removing a root drops its thread row (FKs on tool_actions/memory use ON DELETE)
  if (parentId == null) run("DELETE FROM threads WHERE root_message_id=?", msg.id);

  let parent: DeleteMessageResult["parent"];
  if (parentId != null) {
    const remaining = q("SELECT created FROM messages WHERE parent_id=? ORDER BY id", parentId);
    const last = remaining.length ? Number(remaining[remaining.length - 1].created) : null;
    run("UPDATE messages SET reply_count=?, last_reply=? WHERE id=?", remaining.length, last, parentId);
    parent = { id: parentId, reply_count: remaining.length, last_reply: last };
  }

  return { id: Number(msg.id), channel_id: channelId, parent_id: parentId, deleted_ids: ids, parent };
}

export function serializeMessage(id: number): Row | undefined {
  const m = q1("SELECT * FROM messages WHERE id=?", id);
  if (!m) return undefined;
  // Never ship internal follow-up wake scaffolds to the client.
  if (isInternalMessageBody(String(m.body || ""))) return undefined;
  const author = m.system_message
    ? { kind: "system", id: 0, name: "1Helm", avatar: "" }
    : m.bot_id
    ? (() => {
      const bot = q1("SELECT name FROM bots WHERE id=?", m.bot_id);
      return {
        kind: "bot",
        id: m.bot_id,
        agent_id: q1("SELECT id FROM agents WHERE bot_id=? AND status<>'deleted'", m.bot_id)?.id || null,
        name: (bot?.name as string) || "agent",
      };
    })()
    : (() => {
      const person = q1("SELECT display FROM users WHERE id=?", m.user_id);
      return {
        kind: "user",
        id: m.user_id,
        name: (person?.display as string) || "user",
      };
    })();
  const attachments = q("SELECT id, name, mime, size, workspace_path FROM attachments WHERE message_id=?", id);
  // A transient Working placeholder is visible activity, not a completed
  // reply. Compute the user-facing total from durable reply bodies so it can
  // never be inflated by reconnects or placeholder creation.
  let replyCount = Number(m.reply_count || 0);
  let lastReply = m.last_reply == null ? null : Number(m.last_reply);
  if (m.parent_id == null) {
    const replies = q(`SELECT created FROM messages r WHERE parent_id=? AND trim(body)<>'' AND body<>'_Working…_'
      AND body NOT LIKE '[scheduled-followup%'
      AND body NOT LIKE '⟦followup⟧%'
      AND NOT EXISTS (SELECT 1 FROM agent_progress ap WHERE ap.message_id=r.id AND ap.status='running') ORDER BY id`, id);
    replyCount = replies.length;
    lastReply = replies.length ? Number(replies[replies.length - 1].created) : null;
  }
  const progress = q("SELECT id, kind, body, status, created, updated FROM agent_progress WHERE message_id=? ORDER BY id", id);
  const questionRow = q1("SELECT payload,answers,status,answered FROM agent_questions WHERE message_id=?", id);
  let questions: unknown = null;
  if (questionRow) {
    try {
      questions = {
        ...JSON.parse(String(questionRow.payload || "{}")),
        status: String(questionRow.status),
        answers: questionRow.answers ? JSON.parse(String(questionRow.answers)) : null,
        answered: questionRow.answered == null ? null : Number(questionRow.answered),
      };
    } catch { questions = null; }
  }
  // stopped_followup is backend-only prompt context and must never be exposed.
  const { stopped_followup: _stoppedFollowup, ...publicMessage } = m;
  return { ...publicMessage, reply_count: replyCount, last_reply: lastReply, author, attachments, progress, questions };
}

/**
 * Resolve which model a bot uses in a given context, honoring overrides:
 * thread → channel → global → the bot's own default model.
 */
export function resolveModel(botId: number, channelId: number | null, threadRootId: number | null): string {
  const pick = (scope: string, scopeId: string): string | undefined =>
    q1("SELECT model FROM model_prefs WHERE bot_id=? AND scope=? AND scope_id=?", botId, scope, scopeId)?.model as string | undefined;
  if (threadRootId != null) { const m = pick("thread", String(threadRootId)); if (m) return m; }
  if (channelId != null) { const m = pick("channel", String(channelId)); if (m) return m; }
  if (q1("SELECT 1 FROM agents WHERE bot_id=? AND status<>'deleted'", botId)) {
    const workspaceDefault = String(q1("SELECT default_model FROM workspace WHERE id=1")?.default_model || "");
    if (workspaceDefault) return workspaceDefault;
  }
  const g = pick("global", "");
  if (g) return g;
  return (q1("SELECT model FROM bots WHERE id=?", botId)?.model as string) || "";
}

export function resolveModelForUser(botId: number, channelId: number | null, threadRootId: number | null, userId: number): string {
  return String(resolvedModelPolicy(botId, channelId, threadRootId, userId).model || "");
}

export function setModelPref(botId: number, scope: string, scopeId: string, model: string | null): void {
  if (model) run("INSERT INTO model_prefs (bot_id, scope, scope_id, model) VALUES (?,?,?,?) ON CONFLICT(bot_id,scope,scope_id) DO UPDATE SET model=excluded.model", botId, scope, scopeId, model);
  else run("DELETE FROM model_prefs WHERE bot_id=? AND scope=? AND scope_id=?", botId, scope, scopeId);
}

export function setModelPolicy(botId: number, scope: string, scopeId: string, providerId: number | null, model: string | null): void {
  if (!model) { run("DELETE FROM model_prefs WHERE bot_id=? AND scope=? AND scope_id=?", botId, scope, scopeId); return; }
  run(`INSERT INTO model_prefs (bot_id,scope,scope_id,model,provider_id) VALUES (?,?,?,?,?)
    ON CONFLICT(bot_id,scope,scope_id) DO UPDATE SET model=excluded.model,provider_id=excluded.provider_id`, botId, scope, scopeId, model, providerId);
}

export function resolveProviderId(botId: number, channelId: number | null, threadRootId: number | null): number | null {
  const pick = (scope: string, scopeId: string): Row | undefined =>
    q1("SELECT provider_id FROM model_prefs WHERE bot_id=? AND scope=? AND scope_id=?", botId, scope, scopeId);
  if (threadRootId != null) { const row = pick("thread", String(threadRootId)); if (row?.provider_id) return Number(row.provider_id); }
  if (channelId != null) { const row = pick("channel", String(channelId)); if (row?.provider_id) return Number(row.provider_id); }
  const bot = q1("SELECT provider_id FROM bots WHERE id=?", botId);
  return bot?.provider_id ? Number(bot.provider_id) : null;
}

export function resolvedModelPolicy(botId: number, channelId: number | null, threadRootId: number | null, userId = 0): Record<string, unknown> {
  const scoped = (scope: string, scopeId: string): Row | undefined =>
    q1("SELECT model,provider_id FROM model_prefs WHERE bot_id=? AND scope=? AND scope_id=?", botId, scope, scopeId);
  const thread = threadRootId != null ? scoped("thread", String(threadRootId)) : undefined;
  const channel = channelId != null ? scoped("channel", String(channelId)) : undefined;
  const personalModel = userId ? String(q1("SELECT model FROM user_model_prefs WHERE user_id=?", userId)?.model || "") : "";
  const workspaceModel = String(q1("SELECT default_model FROM workspace WHERE id=1")?.default_model || "");
  const global = scoped("global", "");
  const agentModel = String(q1("SELECT model FROM bots WHERE id=?", botId)?.model || "");
  let source: "thread" | "channel" | "personal" | "workspace" | "agent" = "agent";
  let model = agentModel;
  if (thread?.model) { source = "thread"; model = String(thread.model); }
  else if (channel?.model) { source = "channel"; model = String(channel.model); }
  else if (personalModel) { source = "personal"; model = personalModel; }
  else if (workspaceModel) { source = "workspace"; model = workspaceModel; }
  else if (global?.model) { source = "agent"; model = String(global.model); }
  const providerId = resolveProviderId(botId, channelId, threadRootId);
  const provider = providerId ? q1("SELECT id,name,kind FROM providers WHERE id=?", providerId) : undefined;
  return {
    provider_id: provider?.id ? Number(provider.id) : null,
    provider_name: provider?.name ? String(provider.name) : null,
    provider_kind: provider?.kind ? String(provider.kind) : null,
    model,
    requested_model: model,
    source,
    source_label: source === "personal" ? "Personal override" : source === "workspace" ? "Workspace default" : source === "thread" ? "Thread policy" : source === "channel" ? "Channel policy" : "Agent default",
    personal_model: personalModel || null,
    workspace_model: workspaceModel,
    overridden: source === "thread" || source === "channel" || source === "personal",
    editable: true,
  };
}

/** All prefs for a bot, so the client can render the three-level model picker. */
export function botPrefs(botId: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of q("SELECT scope, scope_id, model FROM model_prefs WHERE bot_id=?", botId)) out[`${r.scope}:${r.scope_id}`] = r.model as string;
  return out;
}

export const botsInChannel = (channelId: number): Row[] =>
  q("SELECT b.* FROM bots b JOIN bot_channels bc ON bc.bot_id=b.id WHERE bc.channel_id=?", channelId);

export const botIsInChannel = (botId: number, channelId: number): boolean =>
  !!q1("SELECT 1 FROM bot_channels WHERE bot_id=? AND channel_id=?", botId, channelId);

export const addBotToChannel = (botId: number, channelId: number): void => {
  const agent = q1("SELECT a.id, a.kind, ac.channel_id FROM agents a LEFT JOIN agent_channels ac ON ac.agent_id=a.id WHERE a.bot_id=? AND a.status<>'deleted'", botId);
  if (agent?.kind === "channel" && agent.channel_id == null) {
    run("INSERT INTO agent_channels (agent_id, channel_id, bound_at) VALUES (?,?,?)", agent.id, channelId, now());
    return;
  }
  if (agent?.kind === "channel" && Number(agent.channel_id) !== channelId) throw new Error("A resident agent cannot be assigned to another channel.");
  run("INSERT OR IGNORE INTO bot_channels (bot_id, channel_id) VALUES (?,?)", botId, channelId);
};

export function botView(r: Row): Record<string, unknown> {
  const provider = r.provider_id ? q1("SELECT id, name, kind FROM providers WHERE id=?", r.provider_id) : undefined;
  const agent = q1(`SELECT a.id, a.kind, a.display_name, a.status, ac.channel_id
    FROM agents a LEFT JOIN agent_channels ac ON ac.agent_id=a.id WHERE a.bot_id=? AND a.status<>'deleted'`, r.id);
  return {
    id: r.id, name: r.name, model: r.model, avatar: r.avatar,
    provider_id: provider ? Number(r.provider_id) : null,
    provider_name: provider ? String(provider.name) : null,
    provider_kind: provider ? String(provider.kind) : null,
    computers: q("SELECT computer_id FROM bot_computers WHERE bot_id=?", r.id).map((x) => Number(x.computer_id)),
    prefs: botPrefs(Number(r.id)),
    agent_id: agent?.id || null,
    agent_kind: agent?.kind || null,
    agent_status: agent?.status || null,
    resident_channel_id: agent?.channel_id || null,
  };
}

export const providerView = (r: Row): Record<string, unknown> => ({
  id: r.id, name: r.name, base_url: r.base_url, kind: r.kind, has_key: Boolean(r.api_key),
  bots: q("SELECT COUNT(*) n FROM bots WHERE provider_id=?", r.id)[0]?.n ?? 0,
});

/** Resolve a bot's live endpoint (base URL + key) via its provider, with legacy fallback. */
export function botEndpoint(botId: number, channelId: number | null = null, threadRootId: number | null = null): { base_url: string; api_key: string } | null {
  const b = q1("SELECT provider_id, base_url, api_key FROM bots WHERE id=?", botId);
  if (!b) return null;
  const providerId = channelId == null ? (b.provider_id ? Number(b.provider_id) : null) : resolveProviderId(botId, channelId, threadRootId);
  if (providerId) {
    const p = q1("SELECT base_url, api_key FROM providers WHERE id=?", providerId);
    return p ? { base_url: String(p.base_url), api_key: String(p.api_key) } : null;
  }
  return b.base_url ? { base_url: String(b.base_url), api_key: String(b.api_key) } : null;
}

/** Find @bot mentions in text and return matching bot rows (case-insensitive, unique). */
export function findMentionedBots(body: string): Row[] {
  const names = new Set((body.match(/@([a-zA-Z0-9_-]+)/g) || []).map((m) => m.slice(1).toLowerCase()));
  if (!names.size) return [];
  return q("SELECT * FROM bots").filter((b) => names.has(String(b.name).toLowerCase()));
}
