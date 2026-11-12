// "Export my data", inside the Durable Objects (data-export.js orchestrates). Only an object can read its own SQLite storage, so each kind of
// object gets a few read-only methods that hand back one page of rows at a time. They are mixed in from resident.js (Resident), index.js
// (Archive) and bee-sync.js (BeeSync), and they are only ever added to, never renamed or changed (old objects linger for a few minutes
// after a deploy).
//
// What is exported is an allow list of tables, not "everything", so a table added later is never exported by accident. Columns that hold a
// secret (by name) are never returned, and the notes in data-export.js list what is left out on purpose: saved keys, the vault, saved
// logins, API keys, connection tokens, payment details, sign-in sessions, the helper's computer disk and the memory vectors.
// Rows come back exactly as stored (text is not summarized or filtered); a binary column is returned as base64.

const has = (sql, t) => sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", t).toArray().length > 0;
export const SECRET_COL = /(secret|token|passw|api_?key|sealed|credential|cookie|bearer|private_?key|verifier|hmac)/i;
const SECRET_KEY = /(secret|token|passw|api_?key|sealed|credential|cookie|bearer|private_?key|verifier|auth_?header|authorization)/i;
export const PAGE_BYTES = 1_500_000;
export const PAGE_ROWS = 500;
// The big pages (dxPageBig, dxTurnsBig, dxRowsBig): one Durable Object call carries up to about 8 MB and 5,000 rows, so an account with many small rows
// needs a few calls instead of thousands. The limit for one call's answer is 32 MiB, and the pages stay far below it.
export const PAGE_BYTES_BIG = 8_000_000;
export const PAGE_ROWS_BIG = 5000;
const bigMax = (m) => Math.min(Math.max(Number(m) || PAGE_BYTES_BIG, 1000), 12_000_000);

const b64 = (buf) => { const u = new Uint8Array(buf); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
function clean(row, omit) {
  const o = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === "_r" || omit.has(k) || SECRET_COL.test(k)) continue;
    o[k] = v instanceof ArrayBuffer ? { base64: b64(v) } : ArrayBuffer.isView(v) ? { base64: b64(v.buffer) } : v;
  }
  return o;
}
// One page of `SELECT rowid, * FROM table WHERE <where> AND rowid > after ORDER BY rowid`, cut at about maxBytes (always at least one row).
// → { rows, next } where next is the rowid to continue after, or null when the table has no more rows.
export function pageOf(sql, table, { after = 0, max = PAGE_BYTES, where = "1=1", args = [], omit = [], filter = null, each = null, rowsMax = PAGE_ROWS } = {}) {
  if (!has(sql, table)) return { rows: [], next: null };
  const skip = new Set(omit), rows = []; let bytes = 0, last = Number(after) || 0, more = false;
  const got = sql.exec(`SELECT rowid AS _r, * FROM "${table}" WHERE (${where}) AND rowid > ? ORDER BY rowid LIMIT ?`, ...args, last, rowsMax + 1).toArray();
  for (let i = 0; i < got.length; i++) {
    if (i >= rowsMax) { more = true; break; }
    const raw = got[i]; let r = filter ? filter(raw) : raw;
    if (r) { r = clean(r, skip); if (each) r = each(r); const n = JSON.stringify(r).length; if (rows.length && bytes + n > max) { more = true; break; } rows.push(r); bytes += n; }
    last = Number(raw._r);
  }
  return { rows, next: more ? last : null };
}
// Settings that were saved as JSON may hold a key by name (e.g. a token field): drop those keys, wherever they sit.
export function dropSecretKeys(v) {
  if (Array.isArray(v)) return v.map(dropSecretKeys);
  if (v && typeof v === "object") { const o = {}; for (const [k, x] of Object.entries(v)) if (!SECRET_KEY.test(k)) o[k] = dropSecretKeys(x); return o; }
  return v;
}

// The tables of a channel's Resident that hold the person's text. turns (with their messages) are read by dxTurns, files by dxPage("files").
export const RESIDENT_TABLES = ["sessions", "workflows", "outbox", "files", "shots", "todos", "reactions", "plans", "chat_interviews", "secret_requests", "helpers", "helper_messages", "session_sections",
  "live_notes", "work_log", "user_questions", "mem_rows", "plan_origin", "kv"];
export const ARCHIVE_TABLES = ["people", "people_facts", "people_seen"];
export const BEE_TABLES = ["convs", "facts", "speaker_map", "speakers"];
// A kv row is a setting by name; one whose name says it is a key, token or secret is not exported.
const kvOk = (r) => (SECRET_KEY.test(String(r.k)) ? null : r);

export const residentExport = {
  // RPC (added only): one page of an allowed table. → { rows, next }
  async dxPage(table, after = 0, max = PAGE_BYTES) {
    if (!RESIDENT_TABLES.includes(table)) return { rows: [], next: null, refused: true };
    return pageOf(this.sql, table, { after, max, filter: table === "kv" ? kvOk : null });
  },
  // RPC (added only): like dxPage with bigger pages (see PAGE_BYTES_BIG).
  async dxPageBig(table, after = 0, max = PAGE_BYTES_BIG) {
    if (!RESIDENT_TABLES.includes(table)) return { rows: [], next: null, refused: true };
    return pageOf(this.sql, table, { after, max: bigMax(max), rowsMax: PAGE_ROWS_BIG, filter: table === "kv" ? kvOk : null });
  },
  // RPC (added only): like dxTurns with bigger pages.
  async dxTurnsBig(sid, after = 0, max = PAGE_BYTES_BIG) {
    const sql = this.sql;
    return pageOf(sql, "turns", { after, max: bigMax(max), rowsMax: PAGE_ROWS_BIG, where: sid == null ? "session IS NULL" : "session = ?", args: sid == null ? [] : [String(sid)],
      each: (t) => ({ ...t, messages: has(sql, "msgs") ? sql.exec("SELECT * FROM msgs WHERE turn=? ORDER BY seq", t.id).toArray().map((m) => clean(m, new Set())) : [] }) });
  },
  // RPC (added only): the turns of one chat (sid) with the stored messages of each turn. sid null = turns that belong to no chat.
  async dxTurns(sid, after = 0, max = PAGE_BYTES) {
    const sql = this.sql;
    return pageOf(sql, "turns", { after, max, where: sid == null ? "session IS NULL" : "session = ?", args: sid == null ? [] : [String(sid)],
      each: (t) => ({ ...t, messages: has(sql, "msgs") ? sql.exec("SELECT * FROM msgs WHERE turn=? ORDER BY seq", t.id).toArray().map((m) => clean(m, new Set())) : [] }) });
  },
  async dxHasLooseTurns() { return has(this.sql, "turns") && this.sql.exec("SELECT 1 FROM turns WHERE session IS NULL LIMIT 1").toArray().length > 0; },
};
export function residentExportMix(Cls) { for (const [k, v] of Object.entries(residentExport)) Cls.prototype[k] = v; }

export const archiveExport = {
  // RPC (added only): the imported rows (channel row, imported messages, Notebook notes, workflows, follow-ups) of one channel (cid), or the ones that belong to no channel.
  async dxRows(cid, after = 0, max = PAGE_BYTES) {
    const where = cid == null ? "channel_id IS NULL AND tbl <> 'channels'" : "(channel_id = ? OR (tbl = 'channels' AND id = ?))", args = cid == null ? [] : [String(cid), String(cid)];
    const r = pageOf(this.sql, "rows", { after, max, where, args });
    return { next: r.next, rows: r.rows.map((x) => { let d = x.data; try { d = JSON.parse(x.data); } catch {} return { tbl: x.tbl, id: x.id, channel_id: x.channel_id, data: dropSecretKeys(d) }; }) };
  },
  async dxPage(table, after = 0, max = PAGE_BYTES) {
    if (!ARCHIVE_TABLES.includes(table)) return { rows: [], next: null, refused: true };
    return pageOf(this.sql, table, { after, max });
  },
  // RPC (added only): like dxPage and dxRows with bigger pages.
  async dxPageBig(table, after = 0, max = PAGE_BYTES_BIG) {
    if (!ARCHIVE_TABLES.includes(table)) return { rows: [], next: null, refused: true };
    return pageOf(this.sql, table, { after, max: bigMax(max), rowsMax: PAGE_ROWS_BIG });
  },
  async dxRowsBig(cid, after = 0, max = PAGE_BYTES_BIG) {
    const where = cid == null ? "channel_id IS NULL AND tbl <> 'channels'" : "(channel_id = ? OR (tbl = 'channels' AND id = ?))", args = cid == null ? [] : [String(cid), String(cid)];
    const r = pageOf(this.sql, "rows", { after, max: bigMax(max), rowsMax: PAGE_ROWS_BIG, where, args });
    return { next: r.next, rows: r.rows.map((x) => { let d = x.data; try { d = JSON.parse(x.data); } catch {} return { tbl: x.tbl, id: x.id, channel_id: x.channel_id, data: dropSecretKeys(d) }; }) };
  },
  // RPC (added only): one contact photo (the stored data, as saved by the Contacts import), after the rowid given.
  async dxPhoto(after = 0) {
    if (!has(this.sql, "people_photos")) return { row: null };
    const r = this.sql.exec("SELECT rowid AS _r, person, data, at FROM people_photos WHERE rowid > ? ORDER BY rowid LIMIT 1", Number(after) || 0).toArray()[0];
    return { row: r ? { _r: Number(r._r), person: r.person, data: typeof r.data === "string" ? r.data : b64(r.data), at: r.at } : null };
  },
};
export function archiveExportMix(Cls) { for (const [k, v] of Object.entries(archiveExport)) Cls.prototype[k] = v; }

export const beeExport = {
  async dxPage(table, after = 0, max = PAGE_BYTES) {
    if (!BEE_TABLES.includes(table)) return { rows: [], next: null, refused: true };
    return pageOf(this.sql, table, { after, max });
  },
  async dxPageBig(table, after = 0, max = PAGE_BYTES_BIG) {
    if (!BEE_TABLES.includes(table)) return { rows: [], next: null, refused: true };
    return pageOf(this.sql, table, { after, max: bigMax(max), rowsMax: PAGE_ROWS_BIG });
  },
};
export function beeExportMix(Cls) { for (const [k, v] of Object.entries(beeExport)) Cls.prototype[k] = v; }
