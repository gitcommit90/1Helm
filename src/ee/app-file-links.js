// Temporary links that hand one of the person's own files to a connected app. Many app actions (Canva's CANVA_MCP_UPLOAD_ASSET_FROM_URL, and actions of other Composio toolkits and
// custom MCP servers) take a file only as a public URL, so the helper could not put a Library file into the person's own app.
//
// Reused: share.js's token scheme (HMAC of a random id + salt, only sha256 stored, linkToken/tokenHash), its public routes (servePublic answers
// <base>/a/<token>/<name> before any sign-in gate, never reading the cookie, on the same addresses as share links), its response headers
// (linkHeaders: nosniff, noindex, no-referrer, private cache) and its byte-range handling; composio-files.js's file limit (APP_FILE_MAX) and
// the Resident's appFileRead / appFileSave (a Library file by name or id; a computer file is saved to the Library first, as for any app file).
// Not reused: share_links itself. Those rows are the person's own lasting links and show in their Library; these expire in minutes, so they
// have their own table (db/migrations/0077_app_file_links.sql; created here too when missing, so nothing depends on the migration being applied).
//
// A link: read-only, exactly one file, 15 minutes (long enough for the app to fetch it, retry, or process it in a queue; short enough that a
// link that leaks stops working before anyone can use it), served with the file's type and length, byte ranges, no listing, no page, noindex,
// no cookies. Past its time, or with a wrong token, it answers the same 404 as any unknown address. At most APP_FILE_MAX bytes, 60 new links per
// account per hour, 40 live at once. Each row records tenant, channel, task, file, time, expiry, app action and how often it was fetched (never the token).
//
// Two ways to get one: (1) app_run does it itself. A value of {"file_url": "<Library file name or /workspace path>"} anywhere in the arguments, or a
// bare Library name / /workspace path given to an input the action's schema describes as a URL, is replaced by a fresh link before the call, and the
// tool result says so. (2) The app_file_link tool returns a link for a file. The link goes to the app the person connected, in the call they asked for.
import { linkToken, tokenHash, linkHeaders, publicBase } from "../share.js";
import { APP_FILE_MAX } from "./composio-files.js";
import { humanBytes } from "../files.js";
export { urlInputs } from "./composio-schema.js";   // which inputs of an action want a URL (kept with the other schema readers)

export const LINK_TTL_MS = 15 * 60 * 1000;
export const LINKS_PER_HOUR = 60, LIVE_MAX = 40, ROWS_KEEP_MS = 30 * 86400e3;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const TABLE = `CREATE TABLE IF NOT EXISTS app_file_links (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, tenant_id TEXT NOT NULL, channel TEXT NOT NULL, session TEXT,
  file_id TEXT NOT NULL, r2key TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL DEFAULT 0, app TEXT, action TEXT, via TEXT,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, fetched INTEGER NOT NULL DEFAULT 0, last_fetch_at INTEGER)`;
let ensured = null;
export const ensureTable = (env) => (ensured ||= env.DB.prepare(TABLE).run().catch((e) => { ensured = null; throw e; }));
export const _resetEnsured = () => { ensured = null; };

// file: { id, name, mime, bytes, r2key }; meta: { channel, session, app, action, via: "auto" | "tool" }.
// → { url, expires_at, name, bytes, id } | { error }
export async function createAppLink(env, t, file, meta = {}) {
  if (!file?.r2key) return { error: "that file isn't in the Library anymore." };
  const bytes = Number(file.bytes || 0);
  if (bytes > APP_FILE_MAX) return { error: `"${file.name}" is ${humanBytes(bytes)}; a link for an app can be for a file of at most ${humanBytes(APP_FILE_MAX)}.` };
  try { await ensureTable(env); } catch (e) { return { error: `couldn't make a temporary link (${String(e.message || e).slice(0, 100)}).` }; }
  const now = Date.now();
  const n = await env.DB.prepare("SELECT COUNT(*) n FROM app_file_links WHERE tenant_id=? AND created_at>?").bind(t.id, now - 3600e3).first();
  if (Number(n?.n || 0) >= LINKS_PER_HOUR) return { error: `too many temporary file links this hour (${LINKS_PER_HOUR} at most). Try again later.` };
  const live = await env.DB.prepare("SELECT COUNT(*) n FROM app_file_links WHERE tenant_id=? AND expires_at>?").bind(t.id, now).first();
  if (Number(live?.n || 0) >= LIVE_MAX) return { error: `there are already ${LIVE_MAX} temporary file links open. They stop working after ${LINK_TTL_MS / 60000} minutes; try again then.` };
  const id = crypto.randomUUID(), salt = b64url(crypto.getRandomValues(new Uint8Array(16))), token = await linkToken(env, id, salt), exp = now + LINK_TTL_MS;
  await env.DB.prepare("INSERT INTO app_file_links (id,token_hash,salt,tenant_id,channel,session,file_id,r2key,name,mime,bytes,app,action,via,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, await tokenHash(token), salt, t.id, String(meta.channel || ""), meta.session ? String(meta.session) : null, String(file.id || ""), file.r2key, String(file.name), file.mime || "application/octet-stream", bytes,
      meta.app ? String(meta.app).slice(0, 80) : null, meta.action ? String(meta.action).slice(0, 120) : null, meta.via || "auto", now, exp).run();
  env.DB.prepare("DELETE FROM app_file_links WHERE tenant_id=? AND expires_at<?").bind(t.id, now - ROWS_KEEP_MS).run().catch(() => {});
  return { url: `${publicBase(env, t)}/a/${token}/${encodeURIComponent(file.name)}`, expires_at: exp, name: file.name, bytes, id };
}

const notFound = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
// GET/HEAD <base>/a/<token>/<name>. The token must belong to this address's tenant and be unexpired. Never a page, never a listing.
export async function serveAppLink(req, env, tenant, token) {
  if (!TOKEN_RE.test(token)) return notFound();
  let l; try { l = await env.DB.prepare("SELECT * FROM app_file_links WHERE token_hash=?").bind(await tokenHash(token)).first(); } catch { return notFound(); }   // no table yet: no link exists
  if (!l || l.tenant_id !== tenant.id || Number(l.expires_at) <= Date.now()) return notFound();
  const o = await env.WS.get(l.r2key, { onlyIf: req.headers, range: req.headers });
  if (!o) return notFound();
  env.DB.prepare("UPDATE app_file_links SET fetched=fetched+1, last_fetch_at=? WHERE id=?").bind(Date.now(), l.id).run().catch(() => {});
  const h = { ...linkHeaders(l.mime, l.name, true), etag: o.httpEtag, "accept-ranges": "bytes" };
  if (!("body" in o) || !o.body) return new Response(null, { status: 304, headers: h });
  if (o.range && req.headers.has("range")) { const off = o.range.offset ?? 0, len = o.range.length ?? o.size - off; return new Response(req.method === "HEAD" ? null : o.body, { status: 206, headers: { ...h, "content-range": `bytes ${off}-${off + len - 1}/${o.size}`, "content-length": String(len) } }); }
  return new Response(req.method === "HEAD" ? null : o.body, { headers: { ...h, "content-length": String(o.size) } });
}

// The person's own records of these links (no tokens): newest first.
export async function listAppLinks(env, tenantId, limit = 50) {
  try {
    const rows = (await env.DB.prepare("SELECT id, channel, session, file_id, name, bytes, app, action, via, created_at, expires_at, fetched, last_fetch_at FROM app_file_links WHERE tenant_id=? ORDER BY created_at DESC LIMIT ?").bind(tenantId, limit).all()).results || [];
    return rows.map((r) => ({ ...r, created_at: Number(r.created_at), expires_at: Number(r.expires_at), bytes: Number(r.bytes || 0), fetched: Number(r.fetched || 0) }));
  } catch { return []; }
}

// ---- app_run: file references → temporary links ----
const isPlain = (v) => v && typeof v === "object" && !Array.isArray(v);
const urlRefKey = (v) => isPlain(v) && Object.keys(v).length === 1 && typeof v.file_url === "string" ? v.file_url.trim() : null;
export const hasUrlRef = (v, d = 0) => d > 4 ? false : urlRefKey(v) != null ? true : Array.isArray(v) ? v.some((x) => hasUrlRef(x, d + 1)) : isPlain(v) ? Object.values(v).some((x) => hasUrlRef(x, d + 1)) : false;
// A bare string that could name one of the person's files: not an address, not a sentence.
const bareRef = (s) => typeof s === "string" && s.trim() && s.length < 300 && !/^[a-z][a-z0-9+.-]*:/i.test(s.trim()) && !/^\/\//.test(s.trim()) && (/^\/workspace\//.test(s.trim()) || !/\s{2,}|\n/.test(s));
// link(ref, { soft }) → { url, expires_at, name, bytes } | { error } | null (soft: it isn't one of the person's files).
// → { args, made: [{ input, name, expires_at, url }] } | { error } (an error means nothing was run).
export async function linkRefs(args, { urls = [], link } = {}) {
  const made = [], fail = (why) => ({ error: `error: ${why} Nothing was run.` });
  if (!link) return { args, made };
  const want = new Set(urls);
  let bad = null;
  const one = async (ref, path, soft) => {
    const r = await link(ref, { soft });
    if (!r) return null;
    if (r.error) { bad = `${path}: ${r.error}`; return null; }
    made.push({ input: path, name: r.name, expires_at: r.expires_at, url: r.url }); return r.url;
  };
  const walk = async (v, d, path, top) => {
    if (bad) return v;
    const ref = urlRefKey(v);
    if (ref != null) { if (!ref) { bad = `${path}: which file? Give a Library file name or a /workspace path.`; return v; } return (await one(ref, path, false)) ?? v; }
    if (d >= 4) return v;
    if (Array.isArray(v)) { const o = []; for (let i = 0; i < v.length; i++) o.push(typeof v[i] === "string" && top && want.has(top) && bareRef(v[i]) ? ((await one(v[i].trim(), `${path}[${i}]`, true)) ?? v[i]) : await walk(v[i], d + 1, `${path}[${i}]`, null)); return o; }
    if (isPlain(v)) { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = await walk(x, d + 1, path ? `${path}.${k}` : k, d === 0 ? k : null); return o; }
    if (typeof v === "string" && top && want.has(top) && bareRef(v)) return (await one(v.trim(), path, true)) ?? v;
    return v;
  };
  const out = await walk(args, 0, "", null);
  return bad ? fail(bad) : { args: out, made };
}

const hhmm = (ms) => new Date(ms).toISOString().slice(11, 16);
// The words on the result's first line: the helper learns a temporary link was used and when it stops working. Never the link itself.
export const linkNote = (made = []) => made.length ? ` (gave the app a temporary link to ${made.map((x) => x.name).join(", ")}, read-only; it stops working at ${hhmm(Math.min(...made.map((x) => x.expires_at)))} UTC, ${LINK_TTL_MS / 60000} minutes after it was made)` : "";
// A result that echoes the link back never shows it to the helper.
export const hideLinks = (text, made = []) => made.reduce((s, x) => { const tok = /\/a\/([A-Za-z0-9_-]{43})\//.exec(x.url)?.[1]; const r = s.split(x.url).join(`[temporary link to ${x.name}]`); return tok ? r.split(tok).join("[token]") : r; }, String(text ?? ""));
