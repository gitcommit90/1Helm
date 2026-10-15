// Original evidence only. Filter before LIMIT so recursive retrieval echoes cannot crowd it out.
import { scrubSecrets } from "./secrets-scrub.js";
import { isStatusNotice, looksLikeStatus, STATUS_MARK } from "./status-notes.js";
export const HISTORY_RETRIEVAL_TOOLS = ["recall_history", "work_log", "bring_back", "memory_explain", "list_channels", "list_tasks", "read_task", "read_doc", "read_skill"];
// HS_USE (opts.ranked): a paraphrase should still find the message, so a message matches when it holds ANY of the words (a short stem of each, so "moved"
// finds "move"), the messages with more matched words come first, then the newest. Without it every word (up to 6) must be in one message, as before.
const STOP = new Set("the and for are but not you your with this that these those from have has had was were will would could should can what when where which who whom why how into about then them they their there here did does just also any some".split(" "));
export const stem = (w) => { const m = w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""); for (const e of ["ing", "ed", "es", "s"]) if (m.endsWith(e) && m.length - e.length >= 4) return m.slice(0, -e.length); return m; };
export function recallHistory(sql, a = {}, ctx = {}, opts = {}) {
  const ranked = !!opts.ranked;
  let words = String(a.query || "").toLowerCase().split(/\s+/).filter(w => w.length > 2).slice(0, ranked ? 8 : 6);
  if (ranked) { const keep = words.filter((w) => !STOP.has(w)); words = [...new Set((keep.length ? keep : words).map(stem).filter((w) => w.length > 2))]; }
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
      AND (${words.map(() => "lower(m.content) LIKE ? ESCAPE '\\'").join(ranked ? " OR " : " AND ")})
      ORDER BY m.seq DESC LIMIT ?`, ...HISTORY_RETRIEVAL_TOOLS, ctx.turn || null, ...(Number.isFinite(ctx.t0) ? [ctx.t0] : []),
      ...words.map(w => `%${w.replace(/[\\%_]/g, "\\$&")}%`), ranked ? Math.max(limit * 25, 200) : limit).toArray();
  if (!rows.length) return "No matches in past conversation.";
  const hits = (r) => words.filter((w) => String(r.content || "").toLowerCase().includes(w));
  if (ranked) { const k = new Map(rows.map((r) => [r, hits(r).length])); rows.sort((x, y) => k.get(y) - k.get(x) || Number(y.seq) - Number(x.seq)); rows.length = Math.min(rows.length, limit); }   // rows came newest first, so the sort is stable on ties
  return rows.map(r => {
    const t = scrubSecrets(r.content || ""), low = t.toLowerCase(), at0 = ranked ? hits({ content: low }).map((w) => low.indexOf(w)).filter((x) => x >= 0).sort((x, y) => x - y)[0] ?? 0 : low.indexOf(words[0]), i = Math.max(0, at0 - 300);
    const other = r.session && ctx.session && r.session !== ctx.session;
    const note = r.role === "assistant" && (isStatusNotice(r.content) || looksLikeStatus(r.content));
    return `[${new Date(r.at).toISOString().slice(0, 16)} ${r.role}${other ? ", another task" : ""}${note ? ` ${STATUS_MARK}` : ""}] …${t.slice(i, i + 900)}…`;
  }).join("\n---\n").slice(0, 12000);
}
