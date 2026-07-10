import { q, q1, run, now, type Row } from "./db.ts";

export type Msg = { channelId: number; parentId: number | null; userId?: number | null; botId?: number | null; body: string };

export function createMessage(m: Msg): number {
  const id = run(
    "INSERT INTO messages (channel_id, parent_id, user_id, bot_id, body, created) VALUES (?,?,?,?,?,?)",
    m.channelId, m.parentId, m.userId ?? null, m.botId ?? null, m.body, now(),
  ).lastInsertRowid;
  if (m.parentId) run("UPDATE messages SET reply_count = reply_count + 1, last_reply=? WHERE id=?", now(), m.parentId);
  return id;
}

export function serializeMessage(id: number): Row | undefined {
  const m = q1("SELECT * FROM messages WHERE id=?", id);
  if (!m) return undefined;
  const author = m.bot_id
    ? { kind: "bot", id: m.bot_id, name: (q1("SELECT name FROM bots WHERE id=?", m.bot_id)?.name as string) || "bot" }
    : { kind: "user", id: m.user_id, name: (q1("SELECT display FROM users WHERE id=?", m.user_id)?.display as string) || "user" };
  const attachments = q("SELECT id, name, mime, size FROM attachments WHERE message_id=?", id);
  return { ...m, author, attachments };
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
  const g = pick("global", "");
  if (g) return g;
  return (q1("SELECT model FROM bots WHERE id=?", botId)?.model as string) || "";
}

export function setModelPref(botId: number, scope: string, scopeId: string, model: string | null): void {
  if (model) run("INSERT INTO model_prefs (bot_id, scope, scope_id, model) VALUES (?,?,?,?) ON CONFLICT(bot_id,scope,scope_id) DO UPDATE SET model=excluded.model", botId, scope, scopeId, model);
  else run("DELETE FROM model_prefs WHERE bot_id=? AND scope=? AND scope_id=?", botId, scope, scopeId);
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

export const addBotToChannel = (botId: number, channelId: number): void =>
  void run("INSERT OR IGNORE INTO bot_channels (bot_id, channel_id) VALUES (?,?)", botId, channelId);

export function botView(r: Row): Record<string, unknown> {
  const provider = r.provider_id ? q1("SELECT id, name, kind FROM providers WHERE id=?", r.provider_id) : undefined;
  return {
    id: r.id, name: r.name, model: r.model, prompt: r.prompt, avatar: r.avatar,
    provider_id: provider ? Number(r.provider_id) : null,
    provider_name: provider ? String(provider.name) : null,
    provider_kind: provider ? String(provider.kind) : null,
    computers: q("SELECT computer_id FROM bot_computers WHERE bot_id=?", r.id).map((x) => Number(x.computer_id)),
    prefs: botPrefs(Number(r.id)),
  };
}

export const providerView = (r: Row): Record<string, unknown> => ({
  id: r.id, name: r.name, base_url: r.base_url, kind: r.kind, has_key: Boolean(r.api_key),
  bots: q("SELECT COUNT(*) n FROM bots WHERE provider_id=?", r.id)[0]?.n ?? 0,
});

/** Resolve a bot's live endpoint (base URL + key) via its provider, with legacy fallback. */
export function botEndpoint(botId: number): { base_url: string; api_key: string } | null {
  const b = q1("SELECT provider_id, base_url, api_key FROM bots WHERE id=?", botId);
  if (!b) return null;
  if (b.provider_id) {
    const p = q1("SELECT base_url, api_key FROM providers WHERE id=?", b.provider_id);
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
