// Share links and published pages: the person's own web address serves files and pages to anyone they give the link to.
//
// Addresses (publicBase): Live with the person's address ready → https://<slug>.<PUBLIC_BASE_DOMAIN>; otherwise (dev, or Live before the
// address is ready) → https://<APP_HOST>/s/<slug>. Both stay valid: a link made on one keeps working.
//   <base>/f/<token>/<file name>   a file share link (src: a Library file). Anyone with it can view/download it, no sign-in.
//   <base>/p/<name>/…              a published page (src/publish.js).
//
// File links: token = HMAC-SHA256 (key derived from VAULT_KEY) over a random link id + a random 128-bit salt, base64url, 43 chars
// (256 bits). D1 keeps sha256(token) → tenant, file, R2 key, expiry; the token itself is never stored (the owner's list recomputes
// it from id + salt). Revoke = the row is deleted, so the next request is a 404. Expired → 404. Deleting the file deletes its links
// (Resident.deleteFile → shareFileDeleted), and a link whose R2 object is gone is a 404 too. Bytes are streamed from R2 by the Worker
// (no R2 URL is ever exposed), with cache-control: private, x-robots-tag: noindex, nosniff, referrer-policy: no-referrer, and
// inline only for viewable types (images, PDF, audio, video, plain text); web pages, SVG and scripts always download.
//
// Nothing goes public without the person's tap. The helper's tools (publish_page, share_file_link) only PREPARE an offer (D1
// share_offers, plus staged page bytes) and show a card in the chat; POST /api/share/offers/<id>/accept (the person's tap) makes it
// live. Background helpers can't use either tool. The app's own buttons (Library, file viewer) are the person's taps already.
// Once a page is live, its updates are not asked again (Captain 10-06: an edit shows at the link they already have): publish_page of the
// same file/folder, or share_file updating the Library file it came from (Resident.shareFile → republishFrom), republishes at the
// same name at once and leaves an "Updated <page>" card. File share links follow their file: an in-place update moves the link's R2 key.
//
// Owner API (signed in, under /w/<slug>/api): GET /share · POST /share/links {channel, file, expires: never|7d|30d}
//   · POST /share/links/<id>/revoke · POST /share/pages {channel, file, name, replace?} (an .html Library file)
//   · POST /share/pages/<name>/unpublish · POST /share/offers/<id>/accept {name?, expires?} · POST /share/offers/<id>/decline
import { PAGE_MAX_BYTES, PAGES_PER_TENANT, NAME_RE, pageName, pageView, listPages, getPage, freeName, stageFromR2, stageFromComputer, publishVersion, unpublish, dropPrefix, servePage } from "./publish.js";
import { boundedJson, BodyTooLargeError } from "./bounded-body.js";

export const LINK_MAX_BYTES = 50 * 1024 * 1024;
export const LINKS_PER_TENANT = 200;
export const OFFERS_PENDING_MAX = 20;
export const OFFER_TTL = 7 * 86400e3;
export const EXPIRY = { never: null, "7d": 7 * 86400e3, "30d": 30 * 86400e3 };
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

const te = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
export const tokenHash = async (token) => hex(await crypto.subtle.digest("SHA-256", te.encode(token)));
let _key = null, _keyFor = null;
async function tokenKey(env) {
  if (_key && _keyFor === env.VAULT_KEY) return _key;
  if (!env.VAULT_KEY) throw new Error("Sharing isn't set up on this server (VAULT_KEY missing).");
  const base = await crypto.subtle.importKey("raw", Uint8Array.from(atob(env.VAULT_KEY), (c) => c.charCodeAt(0)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const derived = await crypto.subtle.sign("HMAC", base, te.encode("1hc share token v1"));   // never reuse the vault key itself
  _key = await crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); _keyFor = env.VAULT_KEY;
  return _key;
}
export async function linkToken(env, id, salt) { return b64url(await crypto.subtle.sign("HMAC", await tokenKey(env), te.encode(`share\n${id}\n${salt}`))); }

// ---- addresses ----
export const publicBase = (env, t) => env.PUBLIC_BASE_DOMAIN && env.ENV_NAME !== "dev" && Number(t.host_ready) === 1 ? `https://${t.slug}.${env.PUBLIC_BASE_DOMAIN}` : `https://${env.APP_HOST || env.GATEWAY_HOST}/s/${t.slug}`;
const slugHost = (env, host) => {
  const domain = String(env.PUBLIC_BASE_DOMAIN || "").toLowerCase();
  const hostname = String(host || "").toLowerCase();
  if (!domain || hostname === env.APP_HOST || !hostname.endsWith(`.${domain}`)) return null;
  const slug = hostname.slice(0, -domain.length - 1);
  return /^[a-z0-9-]+$/.test(slug) ? slug : null;
};
// Is this request for a public share route? (index.js: answered before any sign-in gate; the dev strip is never injected.)
export function isPublicShare(env, url) {
  return /^\/s\/[a-z0-9-]+\/(f|p)\/./.test(url.pathname) || (!!slugHost(env, url.hostname) && /^\/(f|p)\/./.test(url.pathname));
}

// ---- file links ----
const linkUrl = async (env, base, l) => `${base}/f/${await linkToken(env, l.id, l.salt)}/${encodeURIComponent(l.name)}`;
async function linkView(env, base, l) { return { id: l.id, file_id: l.file_id, channel: l.channel, name: l.name, mime: l.mime, bytes: Number(l.bytes || 0), created_at: Number(l.created_at), expires_at: l.expires_at == null ? null : Number(l.expires_at), url: await linkUrl(env, base, l) }; }
const liveLinks = async (env, tenantId) => (await env.DB.prepare("SELECT * FROM share_links WHERE tenant_id=? AND (expires_at IS NULL OR expires_at>?) ORDER BY created_at DESC").bind(tenantId, Date.now()).all()).results || [];
export async function createLink(env, t, { channel, file, expires = "never" }) {
  if (!file) return { error: "That file isn't in the Library anymore.", status: 404 };
  if (!(expires in EXPIRY)) return { error: "Pick when it expires: never, 7 days or 30 days.", status: 400 };
  if (Number(file.bytes || 0) > LINK_MAX_BYTES) return { error: `Share links work for files up to ${LINK_MAX_BYTES / 1048576} MB.`, status: 413 };
  const base = publicBase(env, t), now = Date.now();
  const have = await env.DB.prepare("SELECT * FROM share_links WHERE tenant_id=? AND file_id=? AND (expires_at IS NULL OR expires_at>?) ORDER BY created_at DESC LIMIT 1").bind(t.id, file.id, now).first();
  if (have) return { link: await linkView(env, base, have), existing: true };
  const n = await env.DB.prepare("SELECT COUNT(*) n FROM share_links WHERE tenant_id=? AND (expires_at IS NULL OR expires_at>?)").bind(t.id, now).first();
  if (Number(n?.n || 0) >= LINKS_PER_TENANT) return { error: `You can have up to ${LINKS_PER_TENANT} share links. Revoke one in the Library first.`, status: 409 };
  const id = crypto.randomUUID(), salt = b64url(crypto.getRandomValues(new Uint8Array(16))), token = await linkToken(env, id, salt);
  const row = { id, token_hash: await tokenHash(token), salt, tenant_id: t.id, channel, file_id: file.id, r2key: file.r2key, name: file.name, mime: file.mime || "application/octet-stream", bytes: Number(file.bytes || 0), created_at: now, expires_at: EXPIRY[expires] ? now + EXPIRY[expires] : null };
  await env.DB.prepare("INSERT INTO share_links (id,token_hash,salt,tenant_id,channel,file_id,r2key,name,mime,bytes,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(row.id, row.token_hash, row.salt, row.tenant_id, row.channel, row.file_id, row.r2key, row.name, row.mime, row.bytes, row.created_at, row.expires_at).run();
  return { link: await linkView(env, base, row), existing: false };
}
export async function revokeLink(env, tenantId, id) {
  const r = await env.DB.prepare("DELETE FROM share_links WHERE tenant_id=? AND id=?").bind(tenantId, String(id)).run();
  return r.meta?.changes ? { ok: true } : { error: "No such link.", status: 404 };
}
// Resident.deleteFile: the file is gone, so are its links.
export async function shareFileDeleted(env, tenantId, fileId) {
  if (!tenantId || !fileId) return;
  await env.DB.prepare("DELETE FROM share_links WHERE tenant_id=? AND file_id=?").bind(tenantId, String(fileId)).run();
}

const mediaType = (m) => String(m || "").split(";", 1)[0].trim().toLowerCase();
const VIEWABLE = (m) => /^(?:image\/(?:png|jpe?g|gif|webp|avif|bmp|heic|heif)|application\/pdf|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+|text\/(?:plain|csv|markdown|tab-separated-values))$/.test(mediaType(m));
const RISKY = (m) => /html|svg|xml|javascript|ecmascript/i.test(m);
export function linkHeaders(mime, name, download) {
  const type = mediaType(mime), risky = RISKY(mime), valid = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(type);
  const inline = !download && VIEWABLE(type) && !risky, text = type.startsWith("text/") && !risky;
  return { "content-type": !valid || risky ? "application/octet-stream" : text ? `${type}; charset=utf-8` : type, "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
    "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow", "cache-control": "private, no-cache", "referrer-policy": "no-referrer",
    // PDFs: the browser's own viewer (with its download button) won't run inside a CSP sandbox, so they get no-scripts-by-type instead.
    "content-security-policy": type === "application/pdf" && !risky ? "frame-ancestors 'self'" : "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'; sandbox" };
}
const escH = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const human = (b) => b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(b < 10485760 ? 1 : 0)} MB`;
// A browser opening a picture, video, audio or text link gets a small page: the preview and a Download button. No scripts.
function viewerPage(l) {
  const m = l.mime, raw = "?raw=1", el = /^image\//.test(m) ? `<img src="${raw}" alt="${escH(l.name)}">` : /^video\//.test(m) ? `<video src="${raw}" controls playsinline></video>`
    : /^audio\//.test(m) ? `<audio src="${raw}" controls></audio>` : `<iframe src="${raw}" title="${escH(l.name)}"></iframe>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escH(l.name)}</title>
<style>:root{color-scheme:light dark;--bg:#f3f2ef;--card:#fff;--ink:#1c1b19;--ink2:#6b675f;--line:#e4e1da}@media (prefers-color-scheme:dark){:root{--bg:#121212;--card:#1c1c1c;--ink:#f1efea;--ink2:#a19d94;--line:#2c2c2c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;min-height:100dvh;display:flex;flex-direction:column}
header{display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--card);border-bottom:1px solid var(--line)}header div{flex:1;min-width:0}header b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}header span{color:var(--ink2);font-size:13px}
a.dl{flex:none;background:var(--ink);color:var(--card);text-decoration:none;font-weight:600;padding:10px 18px;border-radius:999px}main{flex:1;display:grid;place-items:center;padding:16px;min-height:0}
img,video{max-width:100%;max-height:calc(100dvh - 120px);border-radius:10px}audio{width:min(520px,100%)}iframe{width:min(900px,100%);height:calc(100dvh - 120px);border:1px solid var(--line);border-radius:10px;background:#fff}
footer{text-align:center;color:var(--ink2);font-size:12px;padding:8px 16px 14px}</style></head>
<body><header><div><b>${escH(l.name)}</b><span>${human(Number(l.bytes || 0))}</span></div><a class="dl" href="?dl=1" download>Download</a></header><main>${el}</main><footer>Shared with 1Helm</footer></body></html>`;
}
const notFound = () => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Not found</title><body style="font:16px/1.5 system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 16px;color:#55524c"><h1 style="font-size:20px;color:#1c1b19">This link doesn't work</h1><p>It may have been turned off, or it expired.</p></body>`,
  { status: 404, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" } });

export async function serveLink(req, env, tenant, token) {
  if (!TOKEN_RE.test(token)) return notFound();
  let l = await env.DB.prepare("SELECT * FROM share_links WHERE token_hash=?").bind(await tokenHash(token)).first();
  if (!l || l.tenant_id !== tenant.id) return notFound();
  if (l.expires_at != null && Number(l.expires_at) <= Date.now()) { await env.DB.prepare("DELETE FROM share_links WHERE id=?").bind(l.id).run(); return notFound(); }
  // D1 link updates and revocation after a Library edit/delete can fail independently of the Resident's SQLite write.
  // Resolve the current file before reading R2, so a stale link never exposes deleted or superseded bytes.
  const file = await resident(env, tenant.id, l.channel).fileRow(l.file_id);
  if (!file || !String(file.r2key || "").startsWith(`t/${tenant.id}/files/${l.channel}/`)) return notFound();
  l = { ...l, r2key: file.r2key, name: file.name, mime: file.mime, bytes: file.bytes };
  const url = new URL(req.url), dl = url.searchParams.get("dl") === "1", raw = url.searchParams.has("raw");
  const nav = req.headers.get("sec-fetch-dest") === "document" && req.headers.get("sec-fetch-mode") === "navigate";
  if (nav && !dl && !raw && VIEWABLE(l.mime) && !RISKY(l.mime) && mediaType(l.mime) !== "application/pdf") {
    if (!(await env.WS.head(l.r2key))) { await env.DB.prepare("DELETE FROM share_links WHERE id=?").bind(l.id).run(); return notFound(); }
    return new Response(viewerPage(l), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-cache", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; media-src 'self'; frame-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" } });
  }
  const o = await env.WS.get(l.r2key, { onlyIf: req.headers, range: req.headers });
  if (!o) { await env.DB.prepare("DELETE FROM share_links WHERE id=?").bind(l.id).run(); return notFound(); }
  const h = { ...linkHeaders(l.mime, l.name, dl), etag: o.httpEtag, "accept-ranges": "bytes" };
  if (!("body" in o) || !o.body) return new Response(null, { status: 304, headers: h });
  if (o.range && req.headers.has("range")) { const off = o.range.offset ?? 0, len = o.range.length ?? o.size - off; return new Response(req.method === "HEAD" ? null : o.body, { status: 206, headers: { ...h, "content-range": `bytes ${off}-${off + len - 1}/${o.size}`, "content-length": String(len) } }); }
  return new Response(req.method === "HEAD" ? null : o.body, { headers: { ...h, "content-length": String(o.size) } });
}

// The public router (index.js calls it first, before any sign-in gate; it never reads the session cookie).
export async function servePublic(req, env, url) {
  let slug, rest, base;
  const s = url.pathname.match(/^\/s\/([a-z0-9-]+)(\/.*)$/);
  const host = slugHost(env, url.hostname);
  if (s) { slug = s[1]; rest = s[2]; base = `/s/${slug}`; if (host && host !== slug) return notFound(); }   // someone's address only serves their own things
  else { slug = host; rest = url.pathname; base = ""; }
  if (!slug || !/^\/(f|p)\/./.test(rest)) return null;
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  const t = await env.DB.prepare("SELECT id, slug FROM tenants WHERE slug=?").bind(slug).first();
  if (!t) return notFound();
  const f = rest.match(/^\/f\/([^/]+)(?:\/.*)?$/); if (f) return serveLink(req, env, t, f[1]);
  const p = rest.match(/^\/p\/([^/]+)(\/.*)?$/); if (p) return servePage(req, env, t, p[1], p[2] || "", base);
  return notFound();
}

// ---- offers (what the helper prepared; the person's tap decides) ----
const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
export function offerView(base, o) {
  const pending = o.status === "pending" && Date.now() - Number(o.created_at) > OFFER_TTL ? "expired" : o.status;
  return { id: o.id, kind: o.kind, status: pending, name: o.name || null, title: o.title || null, url: o.kind === "page" && o.name ? `${base}/p/${o.name}/` : null, base: `${base}/p/`,
    update: o.kind === "page" && !!parse(o.source)?.update, file: o.kind === "link" ? { id: o.file_id, name: o.title, bytes: Number(o.bytes || 0) } : null, files: Number(o.files || 0), bytes: Number(o.bytes || 0),
    channel: o.channel, session: o.session || null, turn: o.turn || null, result: parse(o.result), created_at: Number(o.created_at) };
}
async function sweepOffers(env, tenantId) {
  const old = (await env.DB.prepare("SELECT id, prefix FROM share_offers WHERE tenant_id=? AND status='pending' AND created_at<?").bind(tenantId, Date.now() - OFFER_TTL).all()).results || [];
  for (const o of old) { await env.DB.prepare("UPDATE share_offers SET status='expired', decided_at=? WHERE id=?").bind(Date.now(), o.id).run(); if (o.prefix) await dropPrefix(env, o.prefix).catch(() => {}); }
}
async function tenantRow(env, tenantId) { return env.DB.prepare("SELECT id, slug, host_ready FROM tenants WHERE id=?").bind(tenantId).first(); }
// sessionDetail + the offers of that task, on each turn (and the live one), so the cards survive a reload.
export async function attachOffers(env, t, d) {
  if (!d || d.error || !d.session?.id) return d;
  let rows = []; try { rows = (await env.DB.prepare("SELECT * FROM share_offers WHERE tenant_id=? AND session=? ORDER BY created_at").bind(t.id, String(d.session.id)).all()).results || []; } catch { return d; }
  if (!rows.length) return d;
  const base = publicBase(env, t), by = {};
  for (const o of rows) (by[o.turn] ??= []).push(offerView(base, o));
  for (const x of d.turns || []) if (by[x.id]) x.offers = by[x.id];
  if (d.live && by[d.live.turn]) d.live.offers = by[d.live.turn];
  return d;
}

const resident = (env, tenantId, channel) => env.RESIDENT.get(env.RESIDENT.idFromName(`res:${tenantId}:${channel}`));
async function acceptOffer(env, t, id, b) {
  const o = await env.DB.prepare("SELECT * FROM share_offers WHERE id=? AND tenant_id=?").bind(String(id), t.id).first();
  if (!o) return { error: "No such offer.", status: 404 };
  const base = publicBase(env, t);
  if (o.status === "accepted") return { offer: offerView(base, o) };
  if (o.status !== "pending" || Date.now() - Number(o.created_at) > OFFER_TTL) return { error: "This expired. Ask again and it will be prepared fresh.", status: 410 };
  let result;
  if (o.kind === "page") {
    const src = parse(o.source) || {}, name = String(b.name ?? o.name ?? "").trim().toLowerCase();
    const r = await publishVersion(env, t.id, { name, prefix: o.prefix, files: o.files, bytes: o.bytes, title: o.title, channel: o.channel, source: src.key || null, replace: !!src.update && name === o.name || b.replace === true });
    if (r.error) return r;
    result = { url: `${base}/p/${name}/`, name, updated: r.updated };
    await env.DB.prepare("UPDATE share_offers SET status='accepted', name=?, result=?, decided_at=? WHERE id=? AND status='pending'").bind(name, JSON.stringify(result), Date.now(), o.id).run();
  } else {
    const file = await resident(env, t.id, o.channel).fileRow(o.file_id);
    const r = await createLink(env, t, { channel: o.channel, file, expires: String(b.expires || "never") });
    if (r.error) return r;
    result = { url: r.link.url, link: r.link.id, expires_at: r.link.expires_at };
    await env.DB.prepare("UPDATE share_offers SET status='accepted', result=?, decided_at=? WHERE id=? AND status='pending'").bind(JSON.stringify(result), Date.now(), o.id).run();
  }
  return { offer: offerView(base, { ...o, status: "accepted", name: result.name || o.name, result: JSON.stringify(result) }) };
}
async function declineOffer(env, t, id) {
  const o = await env.DB.prepare("SELECT * FROM share_offers WHERE id=? AND tenant_id=?").bind(String(id), t.id).first();
  if (!o) return { error: "No such offer.", status: 404 };
  if (o.status === "pending") { await env.DB.prepare("UPDATE share_offers SET status='declined', decided_at=? WHERE id=?").bind(Date.now(), o.id).run(); if (o.prefix) await dropPrefix(env, o.prefix).catch(() => {}); }
  return { offer: offerView(publicBase(env, t), { ...o, status: o.status === "pending" ? "declined" : o.status }) };
}

// ---- the owner's API ----
export async function shareApi(req, env, t, sub, access) {
  const out = (d, ok = 200) => new Response(JSON.stringify(d), { status: d?.error ? d.status || 400 : ok, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  const base = publicBase(env, t);
  if (sub === "/api/share" && req.method === "GET") {
    const [links, pages] = await Promise.all([liveLinks(env, t.id), listPages(env, t.id)]);
    return out({ base, links: await Promise.all(links.map((l) => linkView(env, base, l))), pages: pages.map((p) => pageView(base, p)), limits: { link_bytes: LINK_MAX_BYTES, page_bytes: PAGE_MAX_BYTES, links: LINKS_PER_TENANT, pages: PAGES_PER_TENANT } });
  }
  if (req.method !== "POST") return out({ error: "method", status: 405 });
  let b;
  try { b = await boundedJson(req, 65536); }
  catch (e) { return out({ error: e instanceof BodyTooLargeError ? "too_large" : "bad_request", status: e instanceof BodyTooLargeError ? 413 : 400 }); }
  const m = sub.match(/^\/api\/share\/(links|pages|offers)(?:\/([^/]+)(?:\/(revoke|unpublish|accept|decline))?)?$/);
  if (!m) return out({ error: "not found", status: 404 });
  const making = (m[1] === "links" && !m[2]) || (m[1] === "pages" && !m[2]) || m[3] === "accept";
  if (making && access?.mode === "read_only") return out({ error: "payment_required", message: access.message || "Your 1Helm plan isn't active, so 1Helm is read-only.", access, status: 402 });
  const chan = String(b.channel || ""), fileId = String(b.file || "");
  if (m[1] === "links" && !m[2]) {
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(chan) || !/^[0-9a-f-]{36}$/.test(fileId)) return out({ error: "channel and file are required", status: 400 });
    return out(await createLink(env, t, { channel: chan, file: await resident(env, t.id, chan).fileRow(fileId), expires: String(b.expires || "never") }));
  }
  if (m[1] === "links" && m[3] === "revoke") return out(await revokeLink(env, t.id, m[2]));
  if (m[1] === "pages" && !m[2]) {
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(chan) || !/^[0-9a-f-]{36}$/.test(fileId)) return out({ error: "channel and file are required", status: 400 });
    const f = await resident(env, t.id, chan).fileRow(fileId);
    if (!f) return out({ error: "That file isn't in the Library anymore.", status: 404 });
    if (!/\.html?$/i.test(f.name) && !/text\/html/i.test(f.mime)) return out({ error: "Only web pages (.html files) can be published.", status: 400 });
    const name = String(b.name || "").trim().toLowerCase() || pageName(f.name);
    if (!NAME_RE.test(name)) return out({ error: "Use 1–40 lowercase letters, numbers or dashes for the name.", status: 400 });
    const old = await getPage(env, t.id, name);
    if (old && b.replace !== true) return out({ error: `You already have a page called “${name}”.`, taken: true, suggestion: await freeName(env, t.id, name), status: 409 });
    const st = await stageFromR2(env, t.id, f.r2key); if (st.error) return out({ error: st.error, ...(st.storage_full ? { storage_full: true } : {}), status: st.storage_full ? 507 : 400 });
    const r = await publishVersion(env, t.id, { name, prefix: st.prefix, files: st.files, bytes: st.bytes, title: st.title || f.name.replace(/\.html?$/i, ""), channel: chan, source: `file:${chan}:${f.id}`, replace: b.replace === true });
    if (r.error) { await dropPrefix(env, st.prefix).catch(() => {}); return out(r); }
    return out({ page: pageView(base, r.page), updated: r.updated });
  }
  if (m[1] === "pages" && m[3] === "unpublish") return out(await unpublish(env, t.id, decodeURIComponent(m[2])));
  if (m[1] === "offers" && m[3] === "accept") return out(await acceptOffer(env, t, m[2], b));
  if (m[1] === "offers" && m[3] === "decline") return out(await declineOffer(env, t, m[2]));
  return out({ error: "not found", status: 404 });
}

// ---- the helper's tools (Resident.localTool → runShareTool). They PREPARE; the person's tap publishes. ----
export const SHARE_TOOLS = [
  { type: "function", function: { name: "publish_page", description: "Offer to publish a web page you made at the person's own web address (…/p/<name>/), so anyone with the link can open it. This only PREPARES it: the person sees a card \"Publish <name> at <url>?\" and nothing is public until they tap Publish. Pages run sandboxed: scripts work, but cookies and localStorage don't. Up to 25 MB, 200 files. Calling it again for a page that's already live from the same file or folder updates it at the same link at once (no card to tap); a Library file you update with share_file updates its live page by itself.", parameters: { type: "object", properties: {
    path_or_file: { type: "string", description: "An .html file or a folder with index.html (plus its assets) on your computer, or an .html file's name in this channel's Library" },
    name: { type: "string", description: "Optional web name: lowercase letters, numbers, dashes (e.g. \"kyoto-trip\"). Default: from the page title" } }, required: ["path_or_file"] } } },
  { type: "function", function: { name: "share_file_link", description: "Offer the person a public link to a file in this channel's Library, so anyone they give it to can view or download it without signing in. This only PREPARES it: the person sees a card, picks an expiry and taps Create link. A file only on your computer goes in the Library first with share_file. For a web page (.html), offer publish_page instead or as well: a link only hands out a copy, a published page opens live in any browser.", parameters: { type: "object", properties: {
    file: { type: "string", description: "The file's name in this channel's Library (or its id)" } }, required: ["file"] } } },
];
export const SHARE_TOOL_NAMES = new Set(SHARE_TOOLS.map((t) => t.function.name));

async function newOffer(env, R, ctx, o) {
  const tenantId = R.get("tenant"), id = crypto.randomUUID(), now = Date.now();
  await env.DB.prepare("INSERT INTO share_offers (id,tenant_id,channel,session,turn,kind,name,title,file_id,source,prefix,files,bytes,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?)")
    .bind(id, tenantId, R.get("channel"), ctx.session || null, ctx.turn || null, o.kind, o.name || null, o.title || null, o.file_id || null, o.source ? JSON.stringify(o.source) : null, o.prefix || null, o.files || 0, o.bytes || 0, now).run();
  return env.DB.prepare("SELECT * FROM share_offers WHERE id=?").bind(id).first();
}
// An already-published page whose source changed: republished at the same link at once (the person published it already, and an edit
// is expected to show at that link), with an "Updated <page>" card in the chat (an accepted offer, so it survives a reload).
async function updatedCard(env, R, ctx, base, { name, title, files, bytes, source }) {
  if (!ctx.session) return;
  const id = crypto.randomUUID(), now = Date.now(), result = { url: `${base}/p/${name}/`, name, updated: true, auto: true };
  try {
    await env.DB.prepare("INSERT INTO share_offers (id,tenant_id,channel,session,turn,kind,name,title,source,files,bytes,status,result,created_at,decided_at) VALUES (?,?,?,?,?,'page',?,?,?,?,?,'accepted',?,?,?)")
      .bind(id, R.get("tenant"), R.get("channel"), ctx.session, ctx.turn || null, name, title || name, JSON.stringify({ key: source, update: true }), files || 0, bytes || 0, JSON.stringify(result), now, now).run();
    ctx.emit?.({ t: "share_offer", offer: offerView(base, await env.DB.prepare("SELECT * FROM share_offers WHERE id=?").bind(id).first()) });
  } catch (e) { console.log("updated card", e.message); }
}
async function republish(env, R, ctx, base, pg, st) {
  if (st.error) return { name: pg.name, url: `${base}/p/${pg.name}/`, error: st.error };
  const title = st.title || pg.title || pg.name;
  const r = await publishVersion(env, R.get("tenant"), { name: pg.name, prefix: st.prefix, files: st.files, bytes: st.bytes, title, channel: pg.channel || R.get("channel"), source: pg.source, replace: true });
  if (r.error) { await dropPrefix(env, st.prefix).catch(() => {}); return { name: pg.name, url: `${base}/p/${pg.name}/`, error: r.error }; }
  await updatedCard(env, R, ctx, base, { name: pg.name, title, files: st.files, bytes: st.bytes, source: pg.source });
  return { name: pg.name, url: `${base}/p/${pg.name}/`, title };
}
const normPath = (p) => String(p || "").trim().replace(/^\/workspace\//, "").replace(/^\.\//, "").replace(/\/+$/, "");
// Does a page published from computer path `sp` (an .html file, or a folder) include the file at `p`?
const covers = (sp, p) => sp === p || (sp === "." ? !p.includes("/") : p.startsWith(sp + "/"));
// Resident.shareFile: a Library file was shared again / updated in place (or put back). Every page published from it (the Library's
// Publish, or publish_page of the Library file: source file:<channel>:<id>) is restaged from its new bytes, and every page published
// from its computer path or a folder holding it (path:<channel>:<p>) is restaged from the computer. → [{ name, url, error? }]
export async function republishFrom(R, { fileId, r2key, path }, ctx = {}) {
  const env = R.env, tenantId = R.get("tenant"), channel = R.get("channel"); if (!env.DB || !tenantId) return [];
  const fileKey = `file:${channel}:${fileId}`, pre = `path:${channel}:`, p = path ? normPath(path) : "";
  let rows = []; try { rows = (await env.DB.prepare("SELECT * FROM published_pages WHERE tenant_id=? AND (source=? OR substr(source,1,?)=?) ORDER BY updated_at DESC").bind(tenantId, fileKey, pre.length, pre).all()).results || []; } catch { return []; }
  const hits = rows.filter((pg) => pg.source === fileKey || (p && covers(normPath(pg.source.slice(pre.length)), p))).slice(0, 10);
  if (!hits.length) return [];
  const t = await tenantRow(env, tenantId); if (!t) return [];
  const base = publicBase(env, t), out = [];
  for (const pg of hits) {
    let st; try { st = pg.source === fileKey ? await stageFromR2(env, tenantId, r2key) : await stageFromComputer(env, tenantId, R.computer(), normPath(pg.source.slice(pre.length))); } catch (e) { st = { error: e.message }; }
    out.push(await republish(env, R, ctx, base, pg, st));
  }
  return out;
}
export async function runShareTool(R, name, a, ctx = {}) {
  const env = R.env;
  if (!ctx.session) return `error: ${name} needs a task the person can see, to show them the card.`;
  const tenantId = R.get("tenant"), t = await tenantRow(env, tenantId); if (!t) return "error: this workspace isn't set up.";
  await sweepOffers(env, tenantId).catch(() => {});
  const pend = await env.DB.prepare("SELECT COUNT(*) n FROM share_offers WHERE tenant_id=? AND status='pending'").bind(tenantId).first();
  if (Number(pend?.n || 0) >= OFFERS_PENDING_MAX) return `error: there are already ${OFFERS_PENDING_MAX} cards waiting for the person's answer. Ask them to answer those first.`;
  const base = publicBase(env, t), channel = R.get("channel");
  const libFile = (s) => R.sql.exec("SELECT * FROM files WHERE deleted=0 AND pending=0 AND (id=? OR lower(name)=lower(?)) ORDER BY at DESC LIMIT 1", s, s).toArray()[0] || null;
  if (name === "share_file_link") {
    const want = String(a.file || "").trim().replace(/^\/workspace\/files\//, "").replace(/^files\//, ""); if (!want) return "error: file is required";
    const f = libFile(want) || libFile(want.split("/").pop());
    if (!f) return `error: there's no "${want}" in this channel's Library. If it's on your computer, put it in the Library with share_file first, then call share_file_link with its name.`;
    if (f.bytes > LINK_MAX_BYTES) return `error: share links work for files up to ${LINK_MAX_BYTES / 1048576} MB; ${f.name} is bigger.`;
    const have = await env.DB.prepare("SELECT * FROM share_links WHERE tenant_id=? AND file_id=? AND (expires_at IS NULL OR expires_at>?) LIMIT 1").bind(tenantId, f.id, Date.now()).first();
    if (have) return `"${f.name}" already has a share link: ${await linkUrl(env, base, have)} . Give them that one; they can turn it off in the Library.`;
    const o = await newOffer(env, R, ctx, { kind: "link", title: f.name, file_id: f.id, bytes: f.bytes });
    ctx.emit?.({ t: "share_offer", offer: offerView(base, o) });
    return `Prepared. The person sees a card "Make a public link for ${f.name}?" with Create link / Not now (they pick when it expires). Nothing is shared until they tap Create link, so don't say it's shared and don't make up a link. Tell them in one line to tap Create link.`;
  }
  // publish_page
  const want = String(a.path_or_file || "").trim(); if (!want) return "error: path_or_file is required";
  const lf = !want.includes("/") || /^\/?workspace\/files\/[^/]+$/.test(want) || /^files\/[^/]+$/.test(want) ? libFile(want.split("/").pop()) : null;
  let st, sourceKey;
  if (lf && /\.html?$/i.test(lf.name)) { st = await stageFromR2(env, tenantId, lf.r2key); sourceKey = `file:${channel}:${lf.id}`; }
  else { try { st = await stageFromComputer(env, tenantId, R.computer(), want); } catch (e) { return `error: ${e.message}`; } sourceKey = `path:${channel}:${String(st.folder ?? want).replace(/^\/workspace\//, "")}`; }
  if (st.error) return st.tool || `error: ${st.error}`;
  let pname, update = false, live = null;
  if (a.name) {
    pname = pageName(a.name); if (!NAME_RE.test(pname)) { await dropPrefix(env, st.prefix); return "error: name must be 1–40 lowercase letters, numbers or dashes."; }
    const have = await getPage(env, tenantId, pname); update = !!have; if (have?.source === sourceKey) live = have;
  } else {
    const same = await env.DB.prepare("SELECT * FROM published_pages WHERE tenant_id=? AND source=? ORDER BY updated_at DESC LIMIT 1").bind(tenantId, sourceKey).first();
    if (same) { pname = same.name; update = true; live = same; }
    else pname = await freeName(env, tenantId, pageName(st.title || want.replace(/\/index\.html?$/i, "").split("/").filter(Boolean).pop() || "page"));
  }
  // The same page (same file or folder) is already live at that name: the person published it, so the new version goes live at once.
  if (live) {
    const r = await republish(env, R, ctx, base, live, st);
    if (r.error) return `error: couldn't update ${r.url}: ${r.error}`;
    return `Updated the live page at ${r.url} (${st.files} file${st.files === 1 ? "" : "s"}); the person sees an "Updated" card with the link. Tell them in one line: "Updated your live page: ${r.url}".`;
  }
  if (!update) { const n = await env.DB.prepare("SELECT COUNT(*) n FROM published_pages WHERE tenant_id=?").bind(tenantId).first(); if (Number(n?.n || 0) >= PAGES_PER_TENANT) { await dropPrefix(env, st.prefix); return `error: the person already has ${PAGES_PER_TENANT} published pages (the limit). They can unpublish one in the Library.`; } }
  const o = await newOffer(env, R, ctx, { kind: "page", name: pname, title: st.title || pname, prefix: st.prefix, files: st.files, bytes: st.bytes, source: { key: sourceKey, update } });
  ctx.emit?.({ t: "share_offer", offer: offerView(base, o) });
  return `Prepared (${st.files} file${st.files === 1 ? "" : "s"}). The person sees a card "${update ? "Update" : "Publish"} ${pname} at ${base}/p/${pname}/?" with Publish / Not now, and can change the name. Nothing is public until they tap Publish, so don't say it's live yet. Tell them in one line to tap Publish.`;
}
