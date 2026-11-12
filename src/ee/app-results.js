// What an app returned, shown to the helper as it came.
//
// Every app_run / app_proxy result (Composio actions, Composio proxy calls and custom MCP servers alike) goes through here once:
//   1. The exact result text is stored under a handle ("ar12") in this channel's Durable Object (tables app_result / app_result_part).
//   2. The helper sees the first VIEW_CHARS characters of that exact text, and when there is more, the total size and the handle.
//   3. result_read(handle, path | offset, limit) returns any exact slice of the stored result: a JSON path (data.items[3]) or a character range.
// Nothing is renamed, dropped or summarized: no key is removed for its name, no list is cut to a few items, no string is shortened.
//
// The constraints that remain, each one stated where it applies:
//   VIEW_CHARS   what rides in the model's context on every later step (cost and context size). Everything past it is one result_read away.
//   READ_MAX     one result_read answer carries at most this many characters, for the same reason; it says where the next slice starts.
//   STORE_MAX    the Worker's memory while it holds one result. A result over it is stored up to the limit and says so.
//   PART         one SQLite value in a Durable Object is limited to about 2 MB, so a result is stored in parts.
//   Retention    7 days, newest RESULT_KEEP results (the work log keeps its own 7 days). Signed file links in a stored result are
//                exact for 24 hours (the longest a Composio link lives) and are replaced by a note after that, so the 7-day record
//                holds no bearer link.
export const VIEW_CHARS = 40000, READ_MAX = 40000, STORE_MAX = 8_000_000, PART = 400_000;
export const RESULT_KEEP = 300, RESULT_DAYS = 7, LINK_LIVE_MS = 24 * 3600e3;

// Presigned / SAS links (S3, GCS, Azure, CloudFront, vendor CDNs that sign with a query) and any link into a cloud file store.
const SIGNED = /https?:\/\/[^\s"'<>\\]+?(?:[?&](?:X-Amz-[A-Za-z-]+|X-Goog-[A-Za-z-]+|Signature|sig|se|sv|AWSAccessKeyId|Expires|Key-Pair-Id|Policy|token)=)[^\s"'<>\\]*/gi;
const STORE_URL = /https?:\/\/(?:[\w-]+\.)*(?:amazonaws\.com|blob\.core\.windows\.net|r2\.cloudflarestorage\.com|storage\.googleapis\.com|storage\.composio\.dev)\/[^\s"'<>\\]*/gi;
export const LINK_REMOVED = "[signed file link removed from the stored copy; run the action again for a new one]";
// Only for stored records (never for what the helper sees live).
export const scrubStored = (s) => String(s ?? "").replace(SIGNED, LINK_REMOVED).replace(STORE_URL, LINK_REMOVED);

export const DDL = `CREATE TABLE IF NOT EXISTS app_result (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, tool TEXT, action TEXT, custom TEXT, chars INTEGER NOT NULL DEFAULT 0, cut INTEGER NOT NULL DEFAULT 0, scrubbed INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS app_result_part (id INTEGER NOT NULL, part INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY (id, part))`;
const ready = new WeakSet();
function ensure(sql) { if (!ready.has(sql)) { sql.exec(DDL); ready.add(sql); } }
export function appResultInit(sql) { ensure(sql); }

// A cut never lands between the two halves of one character: the end moves back one, a start inside a pair moves back one.
const bounds = (s, a, b) => { let e = Math.min(s.length, b); if (e < s.length && e > 0) { const c = s.charCodeAt(e - 1); if (c >= 0xd800 && c <= 0xdbff) e--; } let st = a; if (st > 0 && st < s.length) { const d = s.charCodeAt(st); if (d >= 0xdc00 && d <= 0xdfff) st--; } return [Math.min(st, e), e]; };
const safeSlice = (s, a, b) => { const [x, y] = bounds(s, a, b); return s.slice(x, y); };

let puts = 0;
// text: the exact result text. meta: { tool, action, custom }. → { handle, chars, cut } (cut: stored only up to STORE_MAX).
export function putResult(sql, text, meta = {}) {
  ensure(sql);
  const s = String(text ?? ""), cut = s.length > STORE_MAX, body = cut ? s.slice(0, STORE_MAX) : s, now = Date.now();
  sql.exec("INSERT INTO app_result (at,tool,action,custom,chars,cut) VALUES (?,?,?,?,?,?)", now, meta.tool ? String(meta.tool) : null, meta.action ? String(meta.action).slice(0, 120) : null, meta.custom ? String(meta.custom) : null, s.length, cut ? 1 : 0);
  const id = Number(sql.exec("SELECT last_insert_rowid() AS id").toArray()[0]?.id);
  for (let i = 0, p = 0; i < body.length || p === 0; i += PART, p++) sql.exec("INSERT INTO app_result_part (id,part,body) VALUES (?,?,?)", id, p, safeSlice(body, i, Math.min(body.length, i + PART)));
  if (++puts % 25 === 0) { try { pruneResults(sql, now); } catch (e) { console.log("app result prune", e.message); } }
  return { handle: `ar${id}`, chars: s.length, cut };
}
const idOf = (h) => { const m = /^(?:ar)?(\d{1,12})$/i.exec(String(h || "").trim()); return m ? Number(m[1]) : null; };
export function resultMeta(sql, handle) {
  const id = idOf(handle); if (id == null) return null; ensure(sql);
  const r = sql.exec("SELECT * FROM app_result WHERE id=?", id).toArray()[0];
  return r ? { id, handle: `ar${id}`, at: Number(r.at), tool: r.tool, action: r.action, custom: r.custom || null, chars: Number(r.chars), cut: !!r.cut, scrubbed: !!r.scrubbed } : null;
}
export function resultText(sql, handle) {
  const id = idOf(handle); if (id == null) return null; ensure(sql);
  const rows = sql.exec("SELECT body FROM app_result_part WHERE id=? ORDER BY part", id).toArray();
  return rows.length ? rows.map((r) => r.body).join("") : null;
}
export function dropResult(sql, handle) { const id = idOf(handle); if (id == null) return; ensure(sql); sql.exec("DELETE FROM app_result_part WHERE id=?", id); sql.exec("DELETE FROM app_result WHERE id=?", id); }
export function pruneResults(sql, now = Date.now()) {
  ensure(sql);
  const gone = sql.exec("SELECT id FROM app_result WHERE at < ? OR id NOT IN (SELECT id FROM app_result ORDER BY id DESC LIMIT ?)", now - RESULT_DAYS * 864e5, RESULT_KEEP).toArray();
  for (const g of gone) { sql.exec("DELETE FROM app_result_part WHERE id=?", g.id); sql.exec("DELETE FROM app_result WHERE id=?", g.id); }
  for (const r of sql.exec("SELECT id FROM app_result WHERE scrubbed=0 AND at < ?", now - LINK_LIVE_MS).toArray()) {
    for (const p of sql.exec("SELECT part, body FROM app_result_part WHERE id=?", r.id).toArray()) { const b = scrubStored(p.body); if (b !== p.body) sql.exec("UPDATE app_result_part SET body=? WHERE id=? AND part=?", b, r.id, p.part); }
    sql.exec("UPDATE app_result SET scrubbed=1 WHERE id=?", r.id);
  }
}

// What the helper reads: the exact text up to VIEW_CHARS, then (only when cut) the size and the handle.
export function viewOf(text, handle, { chars = String(text ?? "").length } = {}) {
  const s = String(text ?? "");
  if (s.length <= VIEW_CHARS) return s;
  const head = safeSlice(s, 0, VIEW_CHARS);
  return `${head}\n[Showing the first ${head.length} of ${chars} characters of the exact result.${handle ? ` The whole result is stored as ${handle}: result_read with handle "${handle}" and a path (like data.items[3]) or an offset returns any part of it, up to ${READ_MAX} characters per call.` : ""}]`;
}

// ---- result_read ----
export const RESULT_READ_TOOL = { type: "function", function: { name: "result_read", description: `Read an exact part of a stored app result. app_run and app_proxy show the first ${VIEW_CHARS} characters of what the app returned; when there is more, the answer ends with a handle (like ar12). Give that handle and either a path into the JSON (like data.items[3].name, or /data/items/3) or an offset and limit in characters. The text is exactly what the app returned, up to ${READ_MAX} characters per call, and the answer says where the next part starts.`, parameters: { type: "object", properties: {
  handle: { type: "string", description: "the handle from the end of an app result, e.g. ar12" },
  path: { type: "string", description: "a path into the JSON result, e.g. data.items[3] or /data/items/3 (optional; without it the whole text is read from offset)" },
  offset: { type: "integer", description: "start position in characters inside the selected value (default 0)" },
  limit: { type: "integer", description: `characters to return (default and maximum ${READ_MAX})` } }, required: ["handle"] } } };

// "a.b[2].c", "a.b.2.c" or "/a/b/2/c" → ["a","b","2","c"]
export function parsePath(p) {
  const s = String(p || "").trim(); if (!s || s === "$" || s === "/") return [];
  if (s.startsWith("/")) return s.slice(1).split("/").map((x) => x.replace(/~1/g, "/").replace(/~0/g, "~"));
  const out = []; const re = /\[(?:"([^"]*)"|'([^']*)'|(\d+))\]|([^.[\]]+)/g; let m;
  for (const part of s.replace(/^\$\.?/, "").matchAll(re)) { m = part; out.push(m[1] ?? m[2] ?? m[3] ?? m[4]); }
  return out;
}
const kindOf = (v) => (v === null ? "null" : Array.isArray(v) ? `array of ${v.length}` : typeof v === "object" ? `object with keys ${Object.keys(v).slice(0, 40).join(", ")}${Object.keys(v).length > 40 ? ", …" : ""}` : typeof v);
// → text for the helper. handle must exist; an `error:` line otherwise.
export function readResult(sql, { handle, path, offset, limit } = {}) {
  const meta = resultMeta(sql, handle); if (!meta) return `error: no stored result "${String(handle || "").slice(0, 40)}". It may be older than ${RESULT_DAYS} days, or the handle is wrong; run the action again.`;
  const text = resultText(sql, handle); if (text == null) return `error: the stored result ${meta.handle} has no text.`;
  let sel = text, where = "";
  if (path != null && String(path).trim() !== "") {
    let v; try { v = JSON.parse(text); } catch { return `error: ${meta.handle} isn't JSON${meta.cut ? " (or it was stored only in part)" : ""}, so a path can't be read. Use offset and limit.`; }
    const keys = parsePath(path); let at = v, walked = "";
    for (const k of keys) {
      if (at && typeof at === "object" && (Array.isArray(at) ? /^\d+$/.test(k) && Number(k) < at.length : Object.prototype.hasOwnProperty.call(at, k))) { at = at[k]; walked += `${walked ? "." : ""}${k}`; continue; }
      return `error: ${meta.handle} has nothing at "${String(path).slice(0, 120)}". At ${walked || "the top"} it is ${kindOf(at)}.`;
    }
    sel = typeof at === "string" ? at : JSON.stringify(at); where = ` at ${String(path).slice(0, 120)}`;
    if (sel === undefined) sel = "undefined";
  }
  const total = sel.length, off = Math.max(0, Math.min(total, Math.floor(Number(offset)) || 0)), lim = Math.max(1, Math.min(READ_MAX, Math.floor(Number(limit)) || READ_MAX));
  const [from, end] = bounds(sel, off, off + lim), slice = sel.slice(from, end);
  const head = `${meta.handle}${where}: characters ${from} to ${end} of ${total}${meta.cut && !where ? ` (the stored copy stops at ${STORE_MAX} characters; the app returned ${meta.chars})` : ""}`;
  return `${head}\n${slice}${end < total ? `\n[more: result_read with handle "${meta.handle}"${where ? ` path "${String(path).slice(0, 120)}"` : ""} and offset ${end}]` : ""}`;
}
