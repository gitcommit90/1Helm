import { q, q1, run, now, type Row } from "./db.ts";
import { isInternalMessageBody } from "./store.ts";
import { recallTranscriptForAgent, syncTranscriptForAgent } from "./memory.ts";

const MAX_SYNC_BATCH = 250;
const MAX_SYNC_MESSAGES = MAX_SYNC_BATCH;
const indexing = new Map<string, Promise<number>>();
const retryAfter = new Map<string, number>();

const eligibleBody = (value: unknown): boolean => {
  const body = String(value || "").trim();
  return Boolean(body && body !== "_Working…_" && !isInternalMessageBody(body));
};

function ownedChannel(agent: Row, channelId: number): boolean {
  if (String(agent.kind) === "skipper") return true;
  return Number(agent.channel_id || 0) === channelId;
}

/** Incrementally index authoritative raw messages in the owning agent's
 * Mnemosyne database. Re-index edited rows by body hash; deleted rows can no
 * longer be resolved and are never returned by the read path. */
export async function syncChannelTranscript(agent: Row, channelId: number, maxMessages = MAX_SYNC_MESSAGES): Promise<number> {
  if (!ownedChannel(agent, channelId)) return 0;
  let indexed = 0;
  while (indexed < maxMessages) {
    const pending = q(`SELECT m.id,m.body,m.created,m.parent_id,m.user_id,m.bot_id,
        COALESCE(m.parent_id,m.id) thread_root_id,t.id thread_id,
        CASE WHEN m.user_id IS NOT NULL THEN 'human' WHEN m.bot_id IS NOT NULL THEN 'agent' ELSE 'system' END author_type,
        i.memory_id previous_memory_id,sha256(m.body) body_hash
      FROM messages m
      LEFT JOIN threads t ON t.root_message_id=COALESCE(m.parent_id,m.id) AND t.channel_id=m.channel_id
      LEFT JOIN transcript_memory_index i ON i.agent_id=? AND i.message_id=m.id
      WHERE m.channel_id=? AND m.system_message=0
        AND trim(m.body)<>'' AND trim(m.body)<>'_Working…_'
        AND trim(m.body) NOT LIKE '[scheduled-followup%' AND trim(m.body) NOT LIKE '⟦followup⟧%'
        AND (i.message_id IS NULL OR i.body_hash<>sha256(m.body))
      ORDER BY m.id LIMIT ?`, agent.id, channelId, Math.min(MAX_SYNC_BATCH, maxMessages - indexed));
    const usable = pending.filter((row) => eligibleBody(row.body));
    if (!usable.length) break;
    const synced = await syncTranscriptForAgent(agent, usable.map((row) => ({
      message_id: Number(row.id),
      content: String(row.body),
      previous_memory_id: row.previous_memory_id ? String(row.previous_memory_id) : undefined,
      metadata: {
        kind: "raw-channel-message",
        message_id: Number(row.id),
        channel_id: channelId,
        thread_id: Number(row.thread_id || 0) || null,
        thread_root_id: Number(row.thread_root_id),
        author_type: String(row.author_type),
        author_id: Number(row.user_id || row.bot_id || 0) || null,
        created: Number(row.created),
      },
    })));
    if (!synced.length) break;
    const byMessage = new Map(synced.map((entry) => [Number(entry.message_id), String(entry.memory_id)]));
    for (const row of usable) {
      const memoryId = byMessage.get(Number(row.id));
      if (!memoryId) continue;
      run(`INSERT INTO transcript_memory_index (agent_id,message_id,memory_id,body_hash,indexed_at)
        VALUES (?,?,?,?,?) ON CONFLICT(agent_id,message_id) DO UPDATE SET
        memory_id=excluded.memory_id,body_hash=excluded.body_hash,indexed_at=excluded.indexed_at`,
      agent.id, row.id, memoryId, row.body_hash, now());
      indexed += 1;
    }
    if (usable.length < pending.length || pending.length < Math.min(MAX_SYNC_BATCH, maxMessages - indexed + usable.length)) break;
  }
  return indexed;
}

export type ChannelHistorySearch = {
  retrieval: "semantic" | "exact" | "recent";
  query: string;
  indexed: number;
  results: Record<string, unknown>[];
};

const isoTime = (value: unknown): string => new Date(Number(value) || 0).toISOString();

function publicHistoryRow(row: Row, complete = false): Record<string, unknown> {
  const rootId = Number(row.parent_id || row.id);
  const authorType = row.user_id != null ? "human" : row.bot_id != null ? "agent" : "system";
  const author = row.user_id != null
    ? String(q1("SELECT display FROM users WHERE id=?", row.user_id)?.display || "user")
    : row.bot_id != null ? `@${String(q1("SELECT name FROM bots WHERE id=?", row.bot_id)?.name || "agent")}` : "1Helm";
  const channel = q1("SELECT slug FROM channels WHERE id=?", row.channel_id);
  return {
    message_id: Number(row.id),
    thread_id: Number(row.thread_id || 0) || null,
    thread_root_id: rootId,
    thread_title: String(row.thread_title || ""),
    author_type: authorType,
    author,
    created_at: isoTime(row.created),
    text: complete ? String(row.body) : String(row.body).slice(0, 4_000),
    path: `/c/${encodeURIComponent(String(channel?.slug || row.channel_id))}/thread/${rootId}`,
  };
}

function dateBound(value: unknown, end = false): number | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${end ? "to" : "from"} date.`);
  return parsed;
}


/** Start one bounded indexing batch without putting it on the retrieval path. */
function scheduleTranscriptSync(agent: Row, channelId: number): void {
  const key = `${Number(agent.id)}:${channelId}`;
  if (indexing.has(key) || Number(retryAfter.get(key) || 0) > Date.now()) return;
  const job = syncChannelTranscript(agent, channelId, MAX_SYNC_BATCH)
    .catch(() => { retryAfter.set(key, Date.now() + 60_000); return 0; })
    .finally(() => indexing.delete(key));
  indexing.set(key, job);
}

export async function searchChannelHistory(agent: Row, channelId: number, options: {
  query?: unknown; mode?: unknown; limit?: unknown; from?: unknown; to?: unknown;
}): Promise<ChannelHistorySearch> {
  if (!ownedChannel(agent, channelId)) throw new Error("Channel history belongs only to its resident agent.");
  const query = String(options.query || "").trim().slice(0, 4_000);
  const mode = String(options.mode || "semantic") === "exact" ? "exact" : "semantic";
  const limit = Math.max(1, Math.min(30, Number(options.limit) || 10));
  const from = dateBound(options.from);
  const to = dateBound(options.to, true);
  let indexed = 0;
  let rows: Row[] = [];
  let retrieval: ChannelHistorySearch["retrieval"] = query ? mode : "recent";
  if (query && mode === "semantic") {
    scheduleTranscriptSync(agent, channelId);
    const hits = await recallTranscriptForAgent(agent, query, Math.min(100, Math.max(24, limit * 5)));
    const ids = hits.map((hit) => Number(hit.metadata?.message_id || 0)).filter(Boolean);
    const rank = new Map(ids.map((id, index) => [id, index]));
    if (ids.length) {
      const placeholders = ids.map(() => "?").join(",");
      rows = q(`SELECT m.*,t.id thread_id,t.title thread_title FROM messages m
        LEFT JOIN threads t ON t.root_message_id=COALESCE(m.parent_id,m.id) AND t.channel_id=m.channel_id
        WHERE m.channel_id=? AND m.id IN (${placeholders})`, channelId, ...ids)
        .sort((left, right) => (rank.get(Number(left.id)) ?? 1e9) - (rank.get(Number(right.id)) ?? 1e9));
    }
    // Mnemosyne's base runtime deliberately falls back to FTS/keyword recall
    // when optional local embedding wheels are unavailable. Keep transcript
    // search useful and honest on those supported hosts instead of returning
    // an empty semantic result for text the raw archive plainly contains.
    if (!rows.length) {
      rows = q(`SELECT m.*,t.id thread_id,t.title thread_title FROM messages m
        LEFT JOIN threads t ON t.root_message_id=COALESCE(m.parent_id,m.id) AND t.channel_id=m.channel_id
        WHERE m.channel_id=? AND m.system_message=0 AND trim(m.body)<>''
          AND m.body<>'_Working…_' AND m.body NOT LIKE '[scheduled-followup%' AND m.body NOT LIKE '⟦followup⟧%'
          AND instr(lower(m.body),lower(?))>0
        ORDER BY m.created DESC,m.id DESC LIMIT ?`, channelId, query, limit);
    }
  } else {
    const clauses = ["m.channel_id=?", "m.system_message=0", "trim(m.body)<>''", "m.body<>'_Working…_'", "m.body NOT LIKE '[scheduled-followup%'", "m.body NOT LIKE '⟦followup⟧%'"];
    const params: unknown[] = [channelId];
    if (query) { clauses.push("instr(lower(m.body),lower(?))>0"); params.push(query); }
    if (from != null) { clauses.push("m.created>=?"); params.push(from); }
    if (to != null) { clauses.push("m.created<=?"); params.push(to); }
    rows = q(`SELECT m.*,t.id thread_id,t.title thread_title FROM messages m
      LEFT JOIN threads t ON t.root_message_id=COALESCE(m.parent_id,m.id) AND t.channel_id=m.channel_id
      WHERE ${clauses.join(" AND ")} ORDER BY m.created DESC,m.id DESC LIMIT ?`, ...params, limit);
  }
  rows = rows.filter((row) => eligibleBody(row.body)
    && (from == null || Number(row.created) >= from)
    && (to == null || Number(row.created) <= to)).slice(0, limit);
  return { retrieval, query, indexed, results: rows.map((row) => publicHistoryRow(row)) };
}

export function readChannelThread(agent: Row, channelId: number, rootMessageId: unknown): Record<string, unknown> {
  if (!ownedChannel(agent, channelId)) throw new Error("Channel history belongs only to its resident agent.");
  const rootId = Number(rootMessageId);
  const thread = q1("SELECT * FROM threads WHERE channel_id=? AND root_message_id=?", channelId, rootId);
  if (!thread) throw new Error("That session does not exist in this channel.");
  const messages = q(`SELECT m.*,? thread_id,? thread_title FROM messages m
    WHERE m.channel_id=? AND (m.id=? OR m.parent_id=?) ORDER BY m.id`, thread.id, thread.title, channelId, rootId, rootId)
    .filter((row) => eligibleBody(row.body));
  return {
    thread_id: Number(thread.id),
    thread_root_id: rootId,
    title: String(thread.title || ""),
    status: String(thread.status || ""),
    opened_at: isoTime(thread.opened_at),
    updated_at: isoTime(thread.updated_at),
    messages: messages.map((message) => publicHistoryRow(message, true)),
  };
}
