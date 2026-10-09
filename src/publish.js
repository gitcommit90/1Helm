// Published pages: a web page the helper made (one .html file, or a folder with index.html + its assets) served at the person's
// own address: https://<slug>.1helm.com/p/<name>/ (Live, once the address is ready) or https://<APP_HOST>/s/<slug>/p/<name>/
// (dev, and Live before the address is ready). Only the person's tap publishes (src/share.js has the API, offers and the tools).
//
// Storage: the bytes are copied once into R2 under t/<tenant>/pages/<version>/<path> ("staging", when the publish is prepared);
// D1 published_pages (tenant, name) → prefix points at the live version. Publishing = writing that row; republishing swaps the
// prefix and deletes the old version; unpublishing deletes the row (the next request is a 404) and then the objects.
//
// Security: pages share a host with the app (the configured app host and any workspace domain), so every
// page response carries CSP `sandbox allow-scripts allow-forms allow-popups` (no allow-same-origin): the page runs in an opaque
// origin, can't read or use 1Helm cookies, can't register a service worker, and its requests to the app API are cross-site
// (SameSite=Lax session cookie not sent; Origin: null is refused by the API anyway). x-robots-tag: noindex. The Worker never reads
// the session cookie on these routes.
import { stPut, stDeleteListed, room, fullMessage, fullToolNote } from "./storage.js";
export const PAGE_MAX_BYTES = 25 * 1024 * 1024;   // one page bundle
export const PAGE_MAX_FILES = 200;
export const PAGES_PER_TENANT = 50;
export const NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

const TYPES = { html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8", map: "application/json; charset=utf-8", webmanifest: "application/manifest+json", txt: "text/plain; charset=utf-8", md: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8", xml: "application/xml; charset=utf-8", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  avif: "image/avif", ico: "image/x-icon", bmp: "image/bmp", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", eot: "application/vnd.ms-fontobject",
  mp4: "video/mp4", webm: "video/webm", ogg: "audio/ogg", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", pdf: "application/pdf", wasm: "application/wasm", zip: "application/zip" };
export const pageType = (path) => TYPES[(String(path).match(/\.([a-z0-9]{1,12})$/i)?.[1] || "").toLowerCase()] || "application/octet-stream";

export const PAGE_CSP = "sandbox allow-scripts allow-forms allow-popups; default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; base-uri 'self'";
export function pageHeaders(path, extra = {}) {
  return { "content-type": pageType(path), "content-security-policy": PAGE_CSP, "x-robots-tag": "noindex, nofollow", "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin", "cache-control": "private, no-cache", "access-control-allow-origin": "*", ...extra };
}

// A web name from a title or file name: "Kyoto Trip — Day 1!" → "kyoto-trip-day-1".
export function pageName(s) {
  let n = String(s || "").replace(/\.(html?|zip)$/i, "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  if (n.length < 2) n = n ? `page-${n}` : "page";
  return n;
}
export function titleOf(html) {
  const m = String(html || "").match(/<title[^>]*>([^<]{1,200})<\/title>/i); if (!m) return "";
  return m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim().slice(0, 120);
}
export const pageView = (base, p) => ({ name: p.name, title: p.title || p.name, url: `${base}/p/${p.name}/`, files: Number(p.files || 0), bytes: Number(p.bytes || 0), channel: p.channel || null, source: p.source || null,
  created_at: Number(p.created_at), updated_at: Number(p.updated_at) });

export async function getPage(env, tenantId, name) { return env.DB.prepare("SELECT * FROM published_pages WHERE tenant_id=? AND name=?").bind(tenantId, name).first(); }
export async function listPages(env, tenantId) { return (await env.DB.prepare("SELECT * FROM published_pages WHERE tenant_id=? ORDER BY updated_at DESC").bind(tenantId).all()).results || []; }
// A free name: the name itself, else name-2, name-3 …
export async function freeName(env, tenantId, name) {
  for (let i = 1; i < 100; i++) { const n = i === 1 ? name : `${name.slice(0, 36)}-${i}`; if (!(await getPage(env, tenantId, n))) return n; }
  return `${name.slice(0, 30)}-${crypto.randomUUID().slice(0, 6)}`;
}

// Delete every object under a version prefix (R2 list is paged, delete takes up to 1000 keys).
export async function dropPrefix(env, prefix) {
  if (!prefix || !/^t\/[^/]+\/pages\/[0-9a-f-]{36}$/.test(prefix)) return;
  let cursor;
  do { const l = await env.WS.list({ prefix: `${prefix}/`, cursor, limit: 1000 }); if (l.objects?.length) await stDeleteListed(env, l.objects); cursor = l.truncated ? l.cursor : null; } while (cursor);
}

// Stage a single HTML file that's already in R2 (a Library file) as a page version: <prefix>/index.html.
export async function stageFromR2(env, tenantId, r2key) {
  const o = await env.WS.get(r2key); if (!o) return { error: "That file isn't in the Library anymore." };
  if (o.size > PAGE_MAX_BYTES) return { error: `That page is ${Math.round(o.size / 1048576)} MB. The limit is ${PAGE_MAX_BYTES / 1048576} MB.` };
  const rm = await room(env, tenantId, o.size); if (!rm.ok) return { error: fullMessage(rm), storage_full: true, tool: fullToolNote(rm) };   // storage.js
  const buf = await o.arrayBuffer(), prefix = `t/${tenantId}/pages/${crypto.randomUUID()}`;
  await stPut(env, `${prefix}/index.html`, buf, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
  return { prefix, files: 1, bytes: buf.byteLength, title: titleOf(new TextDecoder().decode(buf.slice(0, 65536))) };
}

const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
// Stage from the helper's computer: an .html file (just that file, as index.html), a file named index.html (its whole folder),
// or a folder with index.html at its top. Dotfiles and node_modules are skipped. C = the channel computer (Resident.computer()).
export async function stageFromComputer(env, tenantId, C, path) {
  const requested = String(path || "").trim().replace(/\/+$/, "");
  if (!requested) return { error: "path_or_file is required." };
  if (requested.startsWith("/") && requested !== "/workspace" && !requested.startsWith("/workspace/")) return { error: "Publish a page from /workspace." };
  path = requested === "/workspace" ? "." : requested.replace(/^\/workspace\//, "").replace(/^\.\//, "");
  if (path !== "." && (/[\u0000-\u001f]/.test(path) || path.split("/").some((part) => !part || part === ".." || part.startsWith(".") || part === "node_modules")))
    return { error: "Publish a page from a visible file or folder under /workspace." };
  // realpath -s leaves symlinks unresolved; a difference means the source path crosses one.
  const sourcePath = await C.exec(`test "$(realpath -e -- ${q(path)})" = "$(realpath -m -s -- ${q(path)})"`, { save: "none" });
  if (sourcePath.code !== 0) return { error: "A page source cannot be a symlink." };
  const st = await C.exec(`stat -c '%F' -- ${q(path)}`, { save: "none" });
  if (st.code !== 0) return { error: `There's no ${path} on your computer or in this channel's Library.` };
  let dir = null, single = null;
  if (/directory/.test(st.out)) dir = path;
  else if (/regular/.test(st.out)) { if (/(^|\/)index\.html?$/i.test(path)) dir = path.replace(/\/?index\.html?$/i, "") || "."; else if (/\.html?$/i.test(path)) single = path; else return { error: "publish_page takes a web page: an .html file, or a folder with index.html in it." }; }
  else return { error: `${path} isn't a file or folder.` };
  const prefix = `t/${tenantId}/pages/${crypto.randomUUID()}`;
  let list;
  if (single) list = [{ src: single, rel: "index.html" }];
  else {
    // File names can contain tabs and newlines. Encode NUL-separated records before
    // crossing C.exec's text boundary; keep the result below its 20 KB output cap.
    const r = await C.exec(`set -e; cd -- ${q(dir)}; test -f index.html; test ! -L index.html; m=$(find . -type f ! -path '*/.*' ! -path '*/node_modules/*' -printf '%s\\t%P\\0' | head -z -n ${PAGE_MAX_FILES + 1} | base64 -w0); if [ \${#m} -gt 16000 ]; then printf 'manifest-too-long'; exit 65; fi; printf 'manifest:%s' "$m"`, { save: "none" });
    if (r.out === "manifest-too-long") return { error: "That folder has too many or unusually long file names to publish." };
    if (r.code !== 0) return { error: `${dir === "." ? "That folder" : dir} has no index.html at its top. A page folder needs index.html (the page) next to its assets.` };
    let manifest;
    try { manifest = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(r.out.slice(9)), (c) => c.charCodeAt(0))); }
    catch { return { error: "The page's file list could not be read." }; }
    if (!r.out.startsWith("manifest:") || !manifest.endsWith("\0")) return { error: "The page's file list was incomplete." };
    list = [];
    for (const record of manifest.slice(0, -1).split("\0")) {
      const tab = record.indexOf("\t"), sz = record.slice(0, tab), rel = record.slice(tab + 1), parts = rel.split("/");
      const size = Number(sz);
      if (tab < 1 || !/^(0|[1-9][0-9]*)$/.test(sz) || !Number.isSafeInteger(size) || !rel || rel.startsWith("/") ||
          /[\u0000-\u001f\\]/.test(rel) || parts.some((p) => !p || p === ".." || p.startsWith(".") || p === "node_modules"))
        return { error: "The page has a file name that cannot be published." };
      list.push({ size, rel, src: dir === "." ? rel : `${dir}/${rel}` });
    }
    if (list.length > PAGE_MAX_FILES) return { error: `That folder has more than ${PAGE_MAX_FILES} files. A page can have up to ${PAGE_MAX_FILES}; leave out what the page doesn't load.` };
    if (!list.some((x) => x.rel === "index.html")) return { error: "The page's index.html was missing from its file list." };
    const total = list.reduce((a, x) => a + (x.size || 0), 0);
    if (total > PAGE_MAX_BYTES) return { error: `That folder is ${Math.round(total / 1048576)} MB. A page can be up to ${PAGE_MAX_BYTES / 1048576} MB.` };
    const rm = await room(env, tenantId, total); if (!rm.ok) return { error: fullMessage(rm), storage_full: true, tool: fullToolNote(rm) };   // storage.js
  }
  let bytes = 0, i = 0, err = null;
  const worker = async () => { while (i < list.length && !err) { const x = list[i++]; const r = await C.fileToR2(x.src, `${prefix}/${x.rel}`, PAGE_MAX_BYTES, { noSymlink: true, expectedSize: x.size }).catch((e) => ({ ok: false, error: e.message }));
    if (!r.ok) err = `${x.src}: ${r.error}`; else bytes += r.bytes; if (bytes > PAGE_MAX_BYTES) err = `the page is over ${PAGE_MAX_BYTES / 1048576} MB`; } };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (err) { await dropPrefix(env, prefix).catch(() => {}); return { error: `Couldn't copy the page: ${err}` }; }
  const idx = await env.WS.get(`${prefix}/index.html`); const head = idx ? new TextDecoder().decode((await idx.arrayBuffer()).slice(0, 65536)) : "";
  return { prefix, files: list.length, bytes, title: titleOf(head), folder: single ? null : dir };
}

// Make a staged version live at `name`. replace: an existing page of that name is updated (the person chose to update it).
export async function publishVersion(env, tenantId, { name, prefix, files, bytes, title, channel, source, replace = false }) {
  if (!NAME_RE.test(name)) return { error: "Use 1–40 lowercase letters, numbers or dashes for the name.", status: 400 };
  const now = Date.now(), old = await getPage(env, tenantId, name);
  if (old && !replace) return { error: `You already have a page called “${name}”.`, taken: true, suggestion: await freeName(env, tenantId, name), status: 409 };
  if (old) {
    await env.DB.prepare("UPDATE published_pages SET prefix=?, files=?, bytes=?, title=?, channel=?, source=?, updated_at=? WHERE tenant_id=? AND name=?").bind(prefix, files, bytes, title || null, channel || null, source || null, now, tenantId, name).run();
    if (old.prefix !== prefix) await dropPrefix(env, old.prefix).catch(() => {});
    return { page: { ...old, prefix, files, bytes, title, channel, source, updated_at: now }, updated: true };
  }
  const n = await env.DB.prepare("SELECT COUNT(*) n FROM published_pages WHERE tenant_id=?").bind(tenantId).first();
  if (Number(n?.n || 0) >= PAGES_PER_TENANT) return { error: `You can have up to ${PAGES_PER_TENANT} published pages. Unpublish one in the Library first.`, status: 409 };
  const r = await env.DB.prepare("INSERT OR IGNORE INTO published_pages (tenant_id,name,id,title,prefix,files,bytes,channel,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .bind(tenantId, name, crypto.randomUUID(), title || null, prefix, files, bytes, channel || null, source || null, now, now).run();
  if (!r.meta?.changes) return { error: `You already have a page called “${name}”.`, taken: true, suggestion: await freeName(env, tenantId, name), status: 409 };
  return { page: await getPage(env, tenantId, name), updated: false };
}

export async function unpublish(env, tenantId, name) {
  const p = await getPage(env, tenantId, name); if (!p) return { error: "No such page.", status: 404 };
  await env.DB.prepare("DELETE FROM published_pages WHERE tenant_id=? AND name=?").bind(tenantId, name).run();
  await dropPrefix(env, p.prefix).catch(() => {});
  return { ok: true };
}

const notFound = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
// GET/HEAD <base>/p/<name>/<rest>. base: the path prefix the page lives under on this host ("" or "/s/<slug>").
export async function servePage(req, env, tenant, name, rest, base) {
  if (!NAME_RE.test(name)) return notFound();
  const pg = await getPage(env, tenant.id, name); if (!pg) return notFound();
  const url = new URL(req.url);
  if (rest === "") return new Response(null, { status: 301, headers: { location: `${base}/p/${name}/${url.search}`, "cache-control": "no-store" } });
  let parts; try { parts = rest.slice(1).split("/").map(decodeURIComponent); } catch { return notFound(); }
  if (parts.some((s) => s === ".." || s === "." || /[\u0000\\]/.test(s))) return notFound();
  let rel = parts.join("/"); if (rel === "" || rel.endsWith("/")) rel += "index.html";
  const key = `${pg.prefix}/${rel}`;
  const o = await env.WS.get(key, { onlyIf: req.headers, range: req.headers });
  if (!o) {
    if (!/\.[a-z0-9]{1,12}$/i.test(rel) && await env.WS.head(`${key}/index.html`)) return new Response(null, { status: 301, headers: { location: `${base}/p/${name}/${parts.map(encodeURIComponent).join("/")}/${url.search}`, "cache-control": "no-store" } });
    const nf = await env.WS.get(`${pg.prefix}/404.html`);
    return nf ? new Response(nf.body, { status: 404, headers: pageHeaders("404.html") }) : notFound();
  }
  const h = pageHeaders(rel, { etag: o.httpEtag, "accept-ranges": "bytes" });
  if (!("body" in o) || !o.body) return new Response(null, { status: 304, headers: h });
  if (o.range && req.headers.has("range")) { const off = o.range.offset ?? 0, len = o.range.length ?? o.size - off; return new Response(req.method === "HEAD" ? null : o.body, { status: 206, headers: { ...h, "content-range": `bytes ${off}-${off + len - 1}/${o.size}`, "content-length": String(len) } }); }
  return new Response(req.method === "HEAD" ? null : o.body, { headers: { ...h, "content-length": String(o.size) } });
}
