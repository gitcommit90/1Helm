// Downloads inside the 1Helm phone apps (iOS and Android). The apps' web view cannot save a file: a link with the download attribute
// does nothing or replaces the page, and a file made in the page (a blob) shows as text with no way back. Both apps can open an address in
// the system browser sheet (Capacitor Browser: Safari view controller on iOS, a Chrome tab on Android), which has its own download and
// Share. That sheet has none of the web view's cookies, so the signed-in page first asks this module for an address that carries its own proof.
//
// A download link: exactly one file (a Library file's current bytes, or a temporary copy of bytes the page made), GET and HEAD only,
// always an attachment with the right file name, valid for DL_TTL_MS (3 minutes), made only by a signed-in, non-view-as request for the
// person's own workspace, never served with a cookie and never able to start a session (the answer sets nothing, and the address is only
// understood under /d/). It is made like a share link's token (share.js linkToken: HMAC of a random id + salt, only sha256 stored) and is
// served by share.js servePublic at <base>/d/<token>/<name> before any sign-in gate. An address that is expired, unknown, or on another
// workspace's address answers the same 404 as any unknown address. Limits: DL_MAX_BYTES per file, DL_PER_HOUR new links and DL_LIVE_MAX
// open ones for each account. Temporary copies live in R2 under t/<tenant>/dl/ and are deleted when their link has expired (at the
// next link made for that account).
import { linkToken, tokenHash, linkHeaders, publicBase } from "./share.js";
import { safeName, mimeOf } from "./files.js";

export const DL_TTL_MS = 3 * 60 * 1000;
export const DL_MAX_BYTES = 25 * 1024 * 1024;
export const DL_PER_HOUR = 120, DL_LIVE_MAX = 20;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const TABLE = `CREATE TABLE IF NOT EXISTS download_links (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, tenant_id TEXT NOT NULL, user_id TEXT, kind TEXT NOT NULL,
  channel TEXT, file_id TEXT, r2key TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, fetched INTEGER NOT NULL DEFAULT 0)`;
let ensured = null;
export const ensureTable = (env) => (ensured ||= env.DB.prepare(TABLE).run().catch((e) => { ensured = null; throw e; }));
export const _resetEnsured = () => { ensured = null; };

const refuse = (error, status) => ({ error, status });

// Sweeps this account's expired links: the R2 copy of an expired blob goes at once (its row stays for an hour, so the hourly limit counts it),
// and rows older than an hour go. A few at a time.
async function sweep(env, tenantId, now) {
  const old = (await env.DB.prepare("SELECT id, r2key FROM download_links WHERE tenant_id=? AND kind='blob' AND r2key<>'' AND expires_at<? LIMIT 25").bind(tenantId, now).all()).results || [];
  for (const r of old) { await env.WS.delete(r.r2key).catch(() => {}); await env.DB.prepare("UPDATE download_links SET r2key='' WHERE id=?").bind(r.id).run().catch(() => {}); }
  await env.DB.prepare("DELETE FROM download_links WHERE tenant_id=? AND expires_at<?").bind(tenantId, now - 3600e3).run().catch(() => {});
}

// file: { id, name, mime, bytes, r2key } for kind "file"; for kind "blob", { name, mime, body, len } (the bytes are copied to R2 first).
// who: { tenant, userId, channel }. → { url, expires_at, name, bytes } | { error, status }
export async function createDownloadLink(env, t, who, kind, file) {
  try { await ensureTable(env); } catch (e) { return refuse(`couldn't make a download link (${String(e.message || e).slice(0, 100)}).`, 500); }
  const now = Date.now();
  await sweep(env, t.id, now).catch(() => {});
  const n = await env.DB.prepare("SELECT COUNT(*) n FROM download_links WHERE tenant_id=? AND created_at>?").bind(t.id, now - 3600e3).first();
  if (Number(n?.n || 0) >= DL_PER_HOUR) return refuse("Too many downloads this hour. Try again later.", 429);
  const live = await env.DB.prepare("SELECT COUNT(*) n FROM download_links WHERE tenant_id=? AND expires_at>?").bind(t.id, now).first();
  if (Number(live?.n || 0) >= DL_LIVE_MAX) return refuse("Too many downloads are open. Try again in a few minutes.", 429);
  const id = crypto.randomUUID(), salt = b64url(crypto.getRandomValues(new Uint8Array(16))), token = await linkToken(env, id, salt), exp = now + DL_TTL_MS;
  let r2key, bytes, name = safeName(file.name), mime = file.mime || "application/octet-stream";
  if (kind === "blob") {
    r2key = `t/${t.id}/dl/${id}`; bytes = file.len;
    await env.WS.put(r2key, file.body, { httpMetadata: { contentType: mime } });
  } else {
    if (!file?.r2key) return refuse("That file isn't in the Library anymore.", 404);
    r2key = file.r2key; bytes = Number(file.bytes || 0); name = file.name;
    if (bytes > DL_MAX_BYTES) return refuse(`That file is ${Math.round(bytes / 1048576)} MB. A download from the app can be up to ${DL_MAX_BYTES / 1048576} MB.`, 413);
  }
  await env.DB.prepare("INSERT INTO download_links (id,token_hash,salt,tenant_id,user_id,kind,channel,file_id,r2key,name,mime,bytes,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, await tokenHash(token), salt, t.id, who.userId ? String(who.userId) : null, kind, who.channel ? String(who.channel) : null, file.id ? String(file.id) : null, r2key, name, mime, bytes, now, exp).run();
  return { url: `${publicBase(env, t)}/d/${token}/${encodeURIComponent(name)}`, expires_at: exp, name, bytes };
}

const notFound = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
// GET/HEAD <base>/d/<token>/<name>. The token must belong to this address's workspace and be unexpired. Always an attachment, never a page.
export async function serveDownloadLink(req, env, tenant, token) {
  if (!TOKEN_RE.test(token)) return notFound();
  let l; try { l = await env.DB.prepare("SELECT * FROM download_links WHERE token_hash=?").bind(await tokenHash(token)).first(); } catch { return notFound(); }
  if (!l || l.tenant_id !== tenant.id || Number(l.expires_at) <= Date.now()) return notFound();
  const o = await env.WS.get(l.r2key, { onlyIf: req.headers, range: req.headers });
  if (!o) return notFound();
  env.DB.prepare("UPDATE download_links SET fetched=fetched+1 WHERE id=?").bind(l.id).run().catch(() => {});
  const h = { ...linkHeaders(l.mime, l.name, true), "cache-control": "no-store", etag: o.httpEtag, "accept-ranges": "bytes" };
  if (!("body" in o) || !o.body) return new Response(null, { status: 304, headers: h });
  if (o.range && req.headers.has("range")) { const off = o.range.offset ?? 0, len = o.range.length ?? o.size - off; return new Response(req.method === "HEAD" ? null : o.body, { status: 206, headers: { ...h, "content-range": `bytes ${off}-${off + len - 1}/${o.size}`, "content-length": String(len) } }); }
  return new Response(req.method === "HEAD" ? null : o.body, { headers: { ...h, "content-length": String(o.size) } });
}

// The signed-in routes (index.js, under /w/<slug>): POST /api/download-link {channel, file} and POST /api/download-link/blob (raw body, x-file-name).
// deps: { json, channelOf(slug) → channel | null, fileRowOf(channel, id) → row | null, look (a view-as request) }
export async function downloadLinkApi(req, env, t, user, sub, deps) {
  const { json, look } = deps;
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (look) return json({ error: "view_as_read_only", message: "This is a read-only view." }, 403);
  if (!user?.id) return json({ error: "Sign in first." }, 401);
  const who = { userId: user.id };
  let r;
  if (sub === "/api/download-link") {
    const b = await req.json().catch(() => null); if (!b || typeof b !== "object" || Array.isArray(b)) return json({ error: "Send JSON." }, 400);
    const ch = await deps.channelOf(String(b.channel || "")); if (!ch) return json({ error: "no such channel" }, 404);
    const row = await deps.fileRowOf(ch, String(b.file || "")); if (!row) return json({ error: "That file isn't in the Library anymore." }, 404);
    r = await createDownloadLink(env, t, { ...who, channel: String(b.channel) }, "file", row);
  } else if (sub === "/api/download-link/blob") {
    const len = Number(req.headers.get("content-length") || -1);
    if (!req.body || len < 0) return json({ error: "Send the file as the request body with a Content-Length." }, 411);
    if (len > DL_MAX_BYTES) return json({ error: `That file is ${Math.round(len / 1048576)} MB. A download from the app can be up to ${DL_MAX_BYTES / 1048576} MB.` }, 413);
    let name = "download"; try { name = decodeURIComponent(req.headers.get("x-file-name") || "download"); } catch {}
    name = safeName(name);
    r = await createDownloadLink(env, t, who, "blob", { name, mime: mimeOf(name, req.headers.get("content-type") || ""), body: len ? req.body.pipeThrough(new FixedLengthStream(len)) : new Uint8Array(0), len });
  } else return json({ error: "not found" }, 404);
  return r.error ? json({ error: r.error }, r.status) : json({ url: r.url, expires_at: r.expires_at, name: r.name, bytes: r.bytes });
}
