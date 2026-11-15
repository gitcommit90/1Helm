// Saved data for published pages: like a Google Form, anyone with the page link can read and write the page's data.
// No passcode, no sign-in, always on for every published page (no switch). A page uses relative addresses, e.g. fetch("./_data/orders"):
//   GET    <page>/_data/<collection>        → { entries: [{ id, data, created_at, updated_at }], count, next }   (?limit=, ?offset=)
//   POST   <page>/_data/<collection>        → 201 { id, data, … }   (the server makes the id; the body is any JSON value)
//   GET    <page>/_data/<collection>/<id>   → one entry
//   PUT    <page>/_data/<collection>/<id>   → makes or replaces the entry (the id is the page's own, e.g. a game code)
//   DELETE <page>/_data/<collection>/<id>
// The page runs sandboxed (opaque origin, Origin: null, CSP unchanged), so these answers carry CORS headers and OPTIONS is answered.
// The session cookie is never read here. Keyed by tenant + the page's stable id (published_pages.id, kept by a republish). Limits are below.
// Bytes count against the account's storage (storage.js storageOf adds pageDataBytes to "Pages & shares").
import { room, fullMessage } from "./storage.js";
import { boundedText, BodyTooLargeError } from "./bounded-body.js";   // public edition: the anonymous request body is read with a streaming limit, so a missing or forged Content-Length cannot buffer more

export const PAGE_DATA = { entry_bytes: 64 * 1024, entries: 5000, page_bytes: 25 * 1024 * 1024, collections: 20, writes_per_minute: 60, page_writes_per_minute: 600, list_max: 1000 };
const COLL_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/, ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "600" };
const reply = (status, body, extra = {}) => new Response(body == null || status === 204 ? null : JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
  "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow", "content-security-policy": "sandbox; default-src 'none'", ...extra } });
const fail = (status, error, extra) => reply(status, { error }, extra);
export const pageDataPreflight = () => new Response(null, { status: 204, headers: CORS });
const enc = new TextEncoder();
const view = (r) => ({ id: r.id, data: JSON.parse(r.data), created_at: Number(r.created_at), updated_at: Number(r.updated_at) });
const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");

// One more write from this visitor (and from everyone, on this page) in this minute? → null when allowed, else the seconds to wait.
async function writeBlocked(env, req, tenantId, pageId) {
  const now = Date.now(), win = Math.floor(now / 60000), ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown";
  const bump = async (visitor) => Number((await env.DB.prepare("INSERT INTO page_data_rate (tenant_id,page_id,visitor,win,n) VALUES (?,?,?,?,1) ON CONFLICT(tenant_id,page_id,visitor,win) DO UPDATE SET n=n+1 RETURNING n")
    .bind(tenantId, pageId, visitor, win).first())?.n || 1);
  const mine = await bump(await sha(`${pageId}|${ip}`));
  if (mine === 1) await env.DB.prepare("DELETE FROM page_data_rate WHERE tenant_id=? AND page_id=? AND win<?").bind(tenantId, pageId, win - 5).run().catch(() => {});
  const all = await bump("*");
  return mine > PAGE_DATA.writes_per_minute || all > PAGE_DATA.page_writes_per_minute ? Math.max(1, 60 - Math.floor((now % 60000) / 1000)) : null;
}

export async function pageDataBytes(env, tenantId) {
  try { return Number((await env.DB.prepare("SELECT COALESCE(SUM(bytes),0) b FROM page_data WHERE tenant_id=?").bind(tenantId).first())?.b || 0); } catch { return 0; }
}
// Saved entries per page name-less: { [page_id]: count } for the owner's Library.
export async function pageDataCounts(env, tenantId) {
  let rows = []; try { rows = (await env.DB.prepare("SELECT page_id, COUNT(*) n, COALESCE(SUM(bytes),0) b FROM page_data WHERE tenant_id=? GROUP BY page_id").bind(tenantId).all()).results || []; } catch {}
  return Object.fromEntries(rows.map((r) => [r.page_id, { entries: Number(r.n), bytes: Number(r.b) }]));
}
// Remove a page's data (unpublish, channel or account deletion). → rows removed
export async function pageDataGone(env, tenantId, pageId) {
  if (!tenantId || !pageId) return 0;
  try { await env.DB.prepare("DELETE FROM page_data_rate WHERE tenant_id=? AND page_id=?").bind(tenantId, pageId).run(); } catch {}
  try { return Number((await env.DB.prepare("DELETE FROM page_data WHERE tenant_id=? AND page_id=?").bind(tenantId, pageId).run()).meta?.changes || 0); } catch { return 0; }
}

async function readBody(req) {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > PAGE_DATA.entry_bytes * 2) return { error: `That entry is too big. Each saved entry can hold up to ${PAGE_DATA.entry_bytes / 1024} KB.`, status: 413 };
  const text = await boundedText(req, PAGE_DATA.entry_bytes * 2).catch((e) => (e instanceof BodyTooLargeError ? false : null));
  if (text === false) return { error: `That entry is too big. Each saved entry can hold up to ${PAGE_DATA.entry_bytes / 1024} KB.`, status: 413 };
  if (text == null || !text.trim()) return { error: "Send the entry as JSON in the request body.", status: 400 };
  let value; try { value = JSON.parse(text); } catch { return { error: "The entry isn't valid JSON.", status: 400 }; }
  const data = JSON.stringify(value), bytes = enc.encode(data).length;
  if (bytes > PAGE_DATA.entry_bytes) return { error: `That entry is too big (${Math.ceil(bytes / 1024)} KB). Each saved entry can hold up to ${PAGE_DATA.entry_bytes / 1024} KB.`, status: 413 };
  return { data, bytes };
}

// <base>/p/<name>/_data<rest>. page: the published_pages row. rest: "" | "/<collection>" | "/<collection>/<id>".
export async function servePageData(req, env, tenant, page, rest) {
  const m = rest.match(/^(?:\/([^/]+)(?:\/([^/]+))?)?\/?$/); if (!m || !m[1]) return fail(404, "Use ./_data/<collection> to save and load entries.");
  let coll, id; try { coll = decodeURIComponent(m[1]); id = m[2] == null ? null : decodeURIComponent(m[2]); } catch { return fail(404, "Not found."); }
  if (!COLL_RE.test(coll)) return fail(400, "A collection name uses 1 to 40 lowercase letters, numbers, dashes or underscores.");
  if (id != null && !ID_RE.test(id)) return fail(400, "An entry id uses 1 to 64 letters, numbers, dashes or underscores.");
  const tid = tenant.id, pid = page.id, method = req.method;
  if (method === "GET" || method === "HEAD") {
    if (id == null) {
      const u = new URL(req.url), limit = Math.min(PAGE_DATA.list_max, Math.max(1, Math.floor(Number(u.searchParams.get("limit"))) || PAGE_DATA.list_max)), offset = Math.max(0, Math.floor(Number(u.searchParams.get("offset"))) || 0);
      const total = Number((await env.DB.prepare("SELECT COUNT(*) n FROM page_data WHERE tenant_id=? AND page_id=? AND collection=?").bind(tid, pid, coll).first())?.n || 0);
      const rows = (await env.DB.prepare("SELECT * FROM page_data WHERE tenant_id=? AND page_id=? AND collection=? ORDER BY created_at, id LIMIT ? OFFSET ?").bind(tid, pid, coll, limit, offset).all()).results || [];
      return reply(200, { entries: rows.map(view), count: total, next: offset + rows.length < total ? offset + rows.length : null });
    }
    const r = await env.DB.prepare("SELECT * FROM page_data WHERE tenant_id=? AND page_id=? AND collection=? AND id=?").bind(tid, pid, coll, id).first();
    return r ? reply(200, view(r)) : fail(404, "Nothing is saved there yet.");
  }
  if (method === "DELETE") {
    if (id == null) return fail(405, "Delete one entry at ./_data/<collection>/<id>.", { allow: "GET, HEAD, POST, OPTIONS" });
    const wait = await writeBlocked(env, req, tid, pid); if (wait) return fail(429, "Too many saves from this address. Try again in a minute.", { "retry-after": String(wait) });
    const r = await env.DB.prepare("DELETE FROM page_data WHERE tenant_id=? AND page_id=? AND collection=? AND id=?").bind(tid, pid, coll, id).run();
    return reply(200, { ok: true, deleted: Number(r.meta?.changes || 0) });
  }
  if ((method === "POST" && id != null) || (method === "PUT" && id == null)) return fail(405, method === "POST" ? "Add an entry with POST ./_data/<collection>. To change one, use PUT ./_data/<collection>/<id>." : "Replace an entry with PUT ./_data/<collection>/<id>.", { allow: "GET, HEAD, POST, PUT, DELETE, OPTIONS" });
  if (method !== "POST" && method !== "PUT") return fail(405, "Method not allowed.", { allow: "GET, HEAD, POST, PUT, DELETE, OPTIONS" });
  const body = await readBody(req); if (body.error) return fail(body.status, body.error);
  const wait = await writeBlocked(env, req, tid, pid); if (wait) return fail(429, "Too many saves from this address. Try again in a minute.", { "retry-after": String(wait) });
  const now = Date.now(), newId = id ?? crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const old = await env.DB.prepare("SELECT bytes, created_at FROM page_data WHERE tenant_id=? AND page_id=? AND collection=? AND id=?").bind(tid, pid, coll, newId).first();
  if (method === "POST" && old) return fail(409, "That id is taken. Try again.");
  const tot = await env.DB.prepare("SELECT COUNT(*) n, COALESCE(SUM(bytes),0) b FROM page_data WHERE tenant_id=? AND page_id=?").bind(tid, pid).first();
  const delta = body.bytes - Number(old?.bytes || 0);
  if (!old && Number(tot?.n || 0) >= PAGE_DATA.entries) return fail(409, `This page has saved as many entries as it can hold (${PAGE_DATA.entries}). Delete some to save more.`);
  if (Number(tot?.b || 0) + delta > PAGE_DATA.page_bytes) return fail(413, `This page has saved as much as it can hold (${PAGE_DATA.page_bytes / 1048576} MB). Delete some entries to save more.`);
  if (!old) {
    const has = await env.DB.prepare("SELECT 1 x FROM page_data WHERE tenant_id=? AND page_id=? AND collection=? LIMIT 1").bind(tid, pid, coll).first();
    if (!has) { const c = await env.DB.prepare("SELECT COUNT(DISTINCT collection) n FROM page_data WHERE tenant_id=? AND page_id=?").bind(tid, pid).first();
      if (Number(c?.n || 0) >= PAGE_DATA.collections) return fail(409, `This page can have up to ${PAGE_DATA.collections} collections of saved entries.`); }
  }
  if (delta > 0) { const rm = await room(env, tid, delta); if (!rm.ok) return fail(507, fullMessage(rm)); }
  await env.DB.prepare("INSERT INTO page_data (tenant_id,page_id,collection,id,data,bytes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,page_id,collection,id) DO UPDATE SET data=excluded.data, bytes=excluded.bytes, updated_at=excluded.updated_at")
    .bind(tid, pid, coll, newId, body.data, body.bytes, now, now).run();
  return reply(old ? 200 : 201, { id: newId, data: JSON.parse(body.data), created_at: Number(old?.created_at || now), updated_at: now });
}

// ---- the owner (Library card, helper tool) ----
export async function pageDataRows(env, tenantId, pageId, { collection = null, limit = 20000 } = {}) {
  const q = collection ? "SELECT * FROM page_data WHERE tenant_id=? AND page_id=? AND collection=? ORDER BY collection, created_at, id LIMIT ?" : "SELECT * FROM page_data WHERE tenant_id=? AND page_id=? ORDER BY collection, created_at, id LIMIT ?";
  const st = env.DB.prepare(q).bind(...(collection ? [tenantId, pageId, collection, limit] : [tenantId, pageId, limit]));
  return ((await st.all()).results || []).map((r) => ({ collection: r.collection, ...view(r) }));
}
const csvCell = (v) => {
  let s = v == null ? "" : typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;   // a visitor typed it: a spreadsheet must not run it as a formula
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function pageDataCsv(rows) {
  const keys = []; let plain = false;
  for (const r of rows) { if (r.data && typeof r.data === "object" && !Array.isArray(r.data)) { for (const k of Object.keys(r.data)) if (!keys.includes(k)) keys.push(k); } else plain = true; }
  const head = ["collection", "id", "created_at", "updated_at", ...keys, ...(plain ? ["value"] : [])];
  const iso = (n) => new Date(n).toISOString();
  const lines = [head.map(csvCell).join(",")];
  for (const r of rows) {
    const obj = r.data && typeof r.data === "object" && !Array.isArray(r.data);
    lines.push([r.collection, r.id, iso(r.created_at), iso(r.updated_at), ...keys.map((k) => obj ? r.data[k] : ""), ...(plain ? [obj ? "" : r.data] : [])].map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
// The owner's download (a Response) of a page's saved entries, format json | csv.
export async function pageDataDownload(env, tenantId, page, format) {
  const rows = await pageDataRows(env, tenantId, page.id), csv = format === "csv";
  return new Response(csv ? pageDataCsv(rows) : JSON.stringify({ page: page.name, entries: rows }, null, 2), { headers: { "content-type": csv ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
    "content-disposition": `attachment; filename="${page.name}-saved-data.${csv ? "csv" : "json"}"`, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
export async function pageDataClear(env, tenantId, page) {
  const n = await pageDataGone(env, tenantId, page.id); return { ok: true, cleared: n };
}
