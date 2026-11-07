// Files: what the person uploads (chat attachments, Library "Add file") and what the helper shares (share_file).
// Bytes live in R2 under t/<tenant>/files/<channel>/<id>; the channel's Resident owns the id → key mapping, so one
// channel can't read another's. Each file is also copied into the channel computer at /workspace/files/<name>.
import { stPut } from "./storage.js";
export const MAX_UPLOAD = 50 * 1024 * 1024;        // per file (Worker request bodies cap at 100 MB)
export const MAX_VIEW = 3 * 1024 * 1024;           // the downsized copy an image gets for the model to look at
const EXT = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", heic: "image/heic", heif: "image/heif", svg: "image/svg+xml",
  csv: "text/csv", tsv: "text/tab-separated-values", txt: "text/plain", md: "text/markdown", json: "application/json", html: "text/html", htm: "text/html", xml: "application/xml",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ppt: "application/vnd.ms-powerpoint", rtf: "application/rtf",
  zip: "application/zip", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", m4v: "video/x-m4v", mkv: "video/x-matroska", avi: "video/x-msvideo", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/opus", aac: "audio/aac", flac: "audio/flac", py: "text/x-python", js: "text/javascript", ts: "text/plain", ics: "text/calendar" };
// The file types the Library takes from outside (app files, composio-files.js): exactly the types it knows by extension above.
export const LIBRARY_MIMES = new Set(Object.values(EXT));
export const extForMime = (mime) => Object.entries(EXT).find(([, m]) => m === String(mime || "").toLowerCase())?.[0] || "";
export const extOf = (n) => (String(n).match(/\.([a-z0-9]{1,8})$/i)?.[1] || "").toLowerCase();
export const mimeOf = (name, given = "") => (given && given !== "application/octet-stream" ? given : EXT[extOf(name)] || "application/octet-stream").slice(0, 120);
// A name the helper chose with no extension of its own ("Fall menu board demo") keeps the extension of the file it came from
// ("fall-menu-board-demo.mp4" gives "Fall menu board demo.mp4"). A name that already ends in an extension is returned as it was.
export function nameWithSourceExt(name, sourcePath) {
  const n = String(name || "").trim(), e = extOf(n), src = extOf(String(sourcePath || "").split("/").pop());
  return n && src && (!e || /^\d+$/.test(e)) ? `${n}.${src}` : n;
}
// A display name that is also a safe single path segment on the computer.
export function safeName(n) {
  let s = String(n || "").normalize("NFC").replace(/[\u0000-\u001f\u007f/\\]+/g, " ").replace(/^[.\s]+/, "").replace(/\s+/g, " ").trim();
  if (!s) s = "file";
  if (s.length > 120) { const e = extOf(s); s = s.slice(0, 110 - e.length).trim() + (e ? "." + e : ""); }
  return s;
}
// Never let an uploaded file run as a page on the app's own origin.
export function servedHeaders(mime, name, download = false) {
  const risky = /html|svg|xml|javascript/i.test(mime), text = /^text\//.test(mime) && !risky;
  const inline = !download && !risky && (text || /^(image\/|application\/pdf|audio\/|video\/)/.test(mime));
  return { "content-type": risky ? "application/octet-stream" : text ? "text/plain; charset=utf-8" : mime, "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
    "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox", "cache-control": "private, no-cache" };
}
// Byte ranges (RFC 9110): one range of "bytes=a-b", "bytes=a-" or "bytes=-n" against a file of `size` bytes.
// Returns null when the header is absent, malformed or asks for several ranges (the caller then sends the whole file),
// "unsatisfiable" when the range is outside the file, or { offset, length } (the last byte is clamped to the file end).
export function parseByteRange(header, size) {
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(String(header || "")); if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") { const n = Number(m[2]); return n === 0 || size === 0 ? "unsatisfiable" : { offset: Math.max(0, size - n), length: Math.min(n, size) }; }
  const a = Number(m[1]), b = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (m[2] !== "" && Number(m[2]) < a) return null;   // "bytes=5-2" is not a valid range: ignored
  return a >= size ? "unsatisfiable" : { offset: a, length: b - a + 1 };
}
// The one way the app answers a GET for stored file bytes that a browser may play (video, audio) or show. headers: servedHeaders(...).
// No Range header: 200 with the whole file. A Range header: 206 + Content-Range with just that part, or 416 outside the file.
// Always sends Accept-Ranges: bytes (desktop Chrome refuses to seek without it) and the ETag; If-None-Match gives 304.
// If-Range: when its ETag no longer matches, the whole file is sent. Resolves to a Response, or null when the object is missing.
export async function serveStoredBytes(req, env, key, headers) {
  const inm = req.headers.get("if-none-match"), rng = req.headers.get("range"), base = { ...headers, "accept-ranges": "bytes" }, bare = (x) => String(x || "").replace(/^W\//, "").replace(/"/g, "");
  const cond = inm ? { onlyIf: { etagDoesNotMatch: bare(inm) } } : {};
  if (!rng) {
    const o = await env.WS.get(key, cond); if (!o) return null;
    if (!("body" in o) || !o.body) return new Response(null, { status: 304, headers: { ...base, etag: o.httpEtag } });
    return new Response(o.body, { headers: { ...base, etag: o.httpEtag, "content-length": String(o.size) } });
  }
  const head = await env.WS.head(key); if (!head) return null;
  const etag = head.httpEtag, ir = req.headers.get("if-range");
  if (inm && etag && bare(inm) === bare(etag)) return new Response(null, { status: 304, headers: { ...base, etag } });
  const r = ir && bare(ir) !== bare(etag) ? null : parseByteRange(rng, head.size);
  if (r === "unsatisfiable") return new Response(null, { status: 416, headers: { ...base, etag, "content-range": `bytes */${head.size}`, "cache-control": "no-store" } });
  if (!r) { const o = await env.WS.get(key); return o ? new Response(o.body, { headers: { ...base, etag: o.httpEtag, "content-length": String(o.size) } }) : null; }
  const o = await env.WS.get(key, { range: { offset: r.offset, length: r.length } }); if (!o) return null;
  return new Response(o.body, { status: 206, headers: { ...base, etag: o.httpEtag || etag, "content-range": `bytes ${r.offset}-${r.offset + r.length - 1}/${head.size}`, "content-length": String(r.length) } });
}
export const humanBytes = (b) => b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(b < 10485760 ? 1 : 0)} MB`;
// The one place an uploaded file's bytes land, for the app's POST /files and for a file texted to the helper:
// R2 key t/<tenant>/files/<channel>/<id> + metadata. The caller then registers it with Resident.addUpload.
// Refused with StorageFull (storage.js) when the account has no room for it.
export async function storeUpload(env, tenantId, slug, { name, mime, body, len }) {
  const id = crypto.randomUUID(), r2key = `t/${tenantId}/files/${slug}/${id}`;
  await stPut(env, r2key, len ? body : new Uint8Array(0), { httpMetadata: { contentType: mime }, customMetadata: { name: String(name).slice(0, 200) } }, { check: true, size: len || 0 });
  return { id, name, mime, bytes: len, r2key };
}
// The small JPEG the model looks at (the app makes it in the browser and POSTs /files/<id>/view); then Resident.setFileView.
export async function storeView(env, r2key, body, size = null) {
  const key = `${r2key}.view.jpg`; await stPut(env, key, body, { httpMetadata: { contentType: "image/jpeg" } }, { check: true, size, replace: true }); return key;
}
// Server-side twin of the app's smallJpeg (v3.ts): longest side ≤1568 px, JPEG q85, for files that arrive without a browser
// (texted photos). Uses the Cloudflare Images binding, which also reads iPhone HEIC. null when the binding isn't there.
export const VIEW_MAX_PX = 1568;
export async function viewJpeg(env, bytes) {
  if (!env.IMAGES) return null;
  const out = await env.IMAGES.input(new Response(bytes).body).transform({ width: VIEW_MAX_PX, height: VIEW_MAX_PX, fit: "scale-down" }).output({ format: "image/jpeg", quality: 85 });
  const b = new Uint8Array(await out.response().arrayBuffer());
  return b.length && b.length <= MAX_VIEW ? b : null;
}
// A Library file's tags (files.tags in the Resident: a JSON array). Accepts that JSON, an array or "a, b"; gives unique lowercase words.
export function fileTags(v) {
  let a = v; if (typeof v === "string") { try { a = JSON.parse(v); } catch { a = v.split(","); } if (typeof a === "string") a = [a]; }
  return [...new Set((Array.isArray(a) ? a : []).map((x) => String(x).trim().toLowerCase()).filter((x) => /^[a-z0-9][a-z0-9-]{0,31}$/.test(x)))].slice(0, 20);
}
