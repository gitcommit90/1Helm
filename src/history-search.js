// Original evidence only. Filter before LIMIT so recursive retrieval echoes cannot crowd it out.
import { scrubSecrets } from "./secrets-scrub.js";
import { isStatusNotice, looksLikeStatus, STATUS_MARK } from "./status-notes.js";
export const HISTORY_RETRIEVAL_TOOLS = ["recall_history", "work_log", "bring_back", "memory_explain", "list_channels", "list_tasks", "read_task", "read_doc", "read_skill"];
export function recallHistory(sql, a = {}, ctx = {}) {
  const words = String(a.query || "").toLowerCase().split(/\s+/).filter(w => w.length > 2).slice(0, 6);
  if (!words.length) return "error: query required";
  const n = Number(a.limit), limit = Number.isFinite(n) ? Math.max(1, Math.min(Math.floor(n), 20)) : 8;
  const omit = HISTORY_RETRIEVAL_TOOLS.map(() => "?").join(",");
  // Split batches: a genuine call cannot bring adjacent search requests into history.
  // Tool results must match an original invocation in the same turn.
  const rows = sql.exec(`WITH calls AS (
      SELECT m.seq,m.turn,m.at,j.value AS content,json_extract(CASE WHEN j.type='object' THEN j.value ELSE '{}' END,'$.id') AS call_id
      FROM msgs m,json_each(CASE WHEN json_valid(m.tool_calls) THEN CASE WHEN json_type(m.tool_calls)='array' THEN m.tool_calls ELSE '[]' END ELSE '[]' END) j
      WHERE m.role='assistant' AND json_extract(CASE WHEN j.type='object' THEN j.value ELSE '{}' END,'$.function.name') NOT IN (${omit})
    ), originals AS (
      SELECT seq,turn,role,content,at FROM msgs WHERE role IN ('user','assistant') AND trim(coalesce(content,''))<>''
      UNION ALL SELECT seq,turn,'assistant',content,at FROM calls
      UNION ALL SELECT m.seq,m.turn,m.role,m.content,m.at FROM msgs m
        WHERE m.role='tool' AND EXISTS (SELECT 1 FROM calls c WHERE c.turn=m.turn AND c.call_id=m.tool_call_id)
    ) SELECT m.*,t.session FROM originals m LEFT JOIN turns t ON t.id=m.turn
      WHERE m.turn IS NOT ? ${Number.isFinite(ctx.t0) ? "AND m.at < ?" : ""}
      AND ${words.map(() => "lower(m.content) LIKE ? ESCAPE '\\'").join(" AND ")}
      ORDER BY m.seq DESC LIMIT ?`, ...HISTORY_RETRIEVAL_TOOLS, ctx.turn || null, ...(Number.isFinite(ctx.t0) ? [ctx.t0] : []),
      ...words.map(w => `%${w.replace(/[\\%_]/g, "\\$&")}%`), limit).toArray();
  if (!rows.length) return "No matches in past conversation.";
  return rows.map(r => {
    const t = scrubSecrets(r.content || ""), i = Math.max(0, t.toLowerCase().indexOf(words[0]) - 300);
    const other = r.session && ctx.session && r.session !== ctx.session;
    const note = r.role === "assistant" && (isStatusNotice(r.content) || looksLikeStatus(r.content));
    return `[${new Date(r.at).toISOString().slice(0, 16)} ${r.role}${other ? ", another task" : ""}${note ? ` ${STATUS_MARK}` : ""}] …${t.slice(i, i + 900)}…`;
  }).join("\n---\n").slice(0, 12000);
}
