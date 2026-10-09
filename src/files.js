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
  zip: "application/zip", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", mp4: "video/mp4", mov: "video/quicktime", py: "text/x-python", js: "text/javascript", ts: "text/plain", ics: "text/calendar" };
// The file types the Library takes from outside (app files, composio-files.js): exactly the types it knows by extension above.
export const LIBRARY_MIMES = new Set(Object.values(EXT));
export const extForMime = (mime) => Object.entries(EXT).find(([, m]) => m === String(mime || "").toLowerCase())?.[0] || "";
export const extOf = (n) => (String(n).match(/\.([a-z0-9]{1,8})$/i)?.[1] || "").toLowerCase();
export const mimeOf = (name, given = "") => (given && given !== "application/octet-stream" ? given : EXT[extOf(name)] || "application/octet-stream").slice(0, 120);
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
