// Original evidence only. Filter before LIMIT so recursive retrieval echoes cannot crowd it out.
import { scrubSecrets } from "./secrets-scrub.js";
import { isStatusNotice, looksLikeStatus, STATUS_MARK } from "./status-notes.js";
export const HISTORY_RETRIEVAL_TOOLS = ["recall_history", "work_log", "bring_back", "memory_explain", "list_channels", "list_tasks", "read_task", "read_doc", "read_skill"];
// HS_USE (opts.ranked): a paraphrase should still find the message, so a message matches when it holds ANY of the words (a short stem of each, so "moved"
// finds "move"), the messages with more matched words come first, then the newest. Without it every word (up to 6) must be in one message, as before.
const STOP = new Set("the and for are but not you your with this that these those from have has had was were will would could should can what when where which who whom why how into about then them they their there here did does just also any some".split(" "));
export const stem = (w) => { const m = w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""); for (const e of ["ing", "ed", "es", "s"]) if (m.endsWith(e) && m.length - e.length >= 4) return m.slice(0, -e.length); return m; };
// Bounds of one search: message numbers per read, characters of a message that are searched, and the time after which the search stops.
export const SCAN_WINDOW = 150, SCAN_CHARS = 20000, SCAN_BUDGET_MS = 2500;
export function recallHistory(sql, a = {}, ctx = {}, opts = {}) {
  const ranked = !!opts.ranked;
  let words = String(a.query || "").toLowerCase().split(/\s+/).filter(w => w.length > 2).slice(0, ranked ? 8 : 6);
  if (ranked) { const keep = words.filter((w) => !STOP.has(w)); words = [...new Set((keep.length ? keep : words).map(stem).filter((w) => w.length > 2))]; }
  if (!words.length) return "error: query required";
  const n = Number(a.limit), limit = Number.isFinite(n) ? Math.max(1, Math.min(Math.floor(n), 20)) : 8;
  const omit = HISTORY_RETRIEVAL_TOOLS.map(() => "?").join(",");
  const need = ranked ? Math.max(limit * 25, 200) : limit;
  // Bounded scan. One statement over every saved message of the channel (json_each on every tool call list, lower() and LIKE on every
  // content, images included) could run for a long time in a large channel. The Resident answers nothing while a statement runs, so Cloudflare ended it with
  // "storage operation exceeded timeout" and reset the object, and the resumed turn ran the same search again. The search now reads the newest messages
  // first in small windows of message numbers, looks only at the first SCAN_CHARS of each content, and stops when it has enough matches, when it has
  // read everything, or when its time budget is used. A stop for time is said in the answer.
  const win = Math.max(10, Number(opts.window) || SCAN_WINDOW), budget = Number.isFinite(Number(opts.budgetMs)) ? Number(opts.budgetMs) : SCAN_BUDGET_MS, started = Date.now();
  const range = sql.exec("SELECT MIN(seq) AS lo, MAX(seq) AS hi FROM msgs").toArray()[0] || {};
  const lo = Number(range.lo), top = Number(range.hi);
  const callOf = "json_extract(CASE WHEN j.type='object' THEN j.value ELSE '{}' END";
  const callsOf = (alias) => `json_each(CASE WHEN json_valid(${alias}.tool_calls) THEN CASE WHEN json_type(${alias}.tool_calls)='array' THEN ${alias}.tool_calls ELSE '[]' END ELSE '[]' END) j`;
  const text = `WITH calls AS (
      SELECT m.seq,m.turn,m.at,substr(j.value,1,${SCAN_CHARS}) AS content
      FROM msgs m,${callsOf("m")}
      WHERE m.seq BETWEEN ? AND ? AND m.role='assistant' AND ${callOf},'$.function.name') NOT IN (${omit})
    ), originals AS (
      SELECT seq,turn,role,substr(content,1,${SCAN_CHARS}) AS content,at FROM msgs WHERE seq BETWEEN ? AND ? AND role IN ('user','assistant') AND trim(coalesce(substr(content,1,${SCAN_CHARS}),''))<>''
      UNION ALL SELECT seq,turn,'assistant',content,at FROM calls
      UNION ALL SELECT m.seq,m.turn,m.role,substr(m.content,1,${SCAN_CHARS}),m.at FROM msgs m
        WHERE m.seq BETWEEN ? AND ? AND m.role='tool' AND EXISTS (SELECT 1 FROM msgs a,${callsOf("a")} WHERE a.turn=m.turn AND a.role='assistant' AND ${callOf},'$.id')=m.tool_call_id AND ${callOf},'$.function.name') NOT IN (${omit}))
    ) SELECT m.*,t.session FROM originals m LEFT JOIN turns t ON t.id=m.turn
      WHERE m.turn IS NOT ? ${Number.isFinite(ctx.t0) ? "AND m.at < ?" : ""}
      AND (${words.map(() => "lower(m.content) LIKE ? ESCAPE '\\'").join(ranked ? " OR " : " AND ")})
      ORDER BY m.seq DESC LIMIT ?`;
  const likes = words.map(w => `%${w.replace(/[\\%_]/g, "\\$&")}%`);
  let rows = [], scanned = 0, stopped = false;
  if (Number.isFinite(top)) for (let hi = top; hi >= lo; hi -= win) {
    const from = Math.max(lo, hi - win + 1);
    rows.push(...sql.exec(text, from, hi, ...HISTORY_RETRIEVAL_TOOLS, from, hi, from, hi, ...HISTORY_RETRIEVAL_TOOLS, ctx.turn || null, ...(Number.isFinite(ctx.t0) ? [ctx.t0] : []), ...likes, need - rows.length).toArray());
    scanned = top - from + 1;
    if (rows.length >= need) break;
    if (from > lo && Date.now() - started >= budget) { stopped = true; break; }
  }
  const partial = stopped ? `\n[Only the newest ${scanned} saved messages were searched, because searching all of them takes too long. Older messages were not searched. Use words from the part you want, or ask for a task or date.]` : "";
  if (!rows.length) return stopped ? `No matches in the newest part of the past conversation that was searched.${partial}` : "No matches in past conversation.";
  const hits = (r) => words.filter((w) => String(r.content || "").toLowerCase().includes(w));
  if (ranked) { const k = new Map(rows.map((r) => [r, hits(r).length])); rows.sort((x, y) => k.get(y) - k.get(x) || Number(y.seq) - Number(x.seq)); rows.length = Math.min(rows.length, limit); }   // rows came newest first, so the sort is stable on ties
  return rows.map(r => {
    const t = scrubSecrets(r.content || ""), low = t.toLowerCase(), at0 = ranked ? hits({ content: low }).map((w) => low.indexOf(w)).filter((x) => x >= 0).sort((x, y) => x - y)[0] ?? 0 : low.indexOf(words[0]), i = Math.max(0, at0 - 300);
    const other = r.session && ctx.session && r.session !== ctx.session;
    const note = r.role === "assistant" && (isStatusNotice(r.content) || looksLikeStatus(r.content));
    return `[${new Date(r.at).toISOString().slice(0, 16)} ${r.role}${other ? ", another task" : ""}${note ? ` ${STATUS_MARK}` : ""}] …${t.slice(i, i + 900)}…`;
  }).join("\n---\n").slice(0, 12000) + partial;
}
