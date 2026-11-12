// Files in and out of app actions (10-06, composio-upgrade stage 4). Composio exchanges files through its own short-lived object storage:
//   IN:  an action input that is a FileUploadable ({ name, mimetype, s3key }, flagged file_uploadable in the schema; composio-schema.js
//        shows it to the helper as "file: give a Library file name or a /workspace path"). The helper passes a Library file (name or id)
//        or a computer path; stageInputs() reads the bytes (the Resident's ctx.files.read), checks size and type, stages them with the
//        transport's stageFile() (Composio's upload request + a PUT to its presigned URL) and fills in { name, mimetype, s3key }.
//        Staging happens only after every other check passed, so a write with an attachment (an email) still needs the tap on its confirm card (confirm.js)
//        first and nothing is uploaded before that. The self-managed backend (Connect MCP) has no way to take a file from 1Helm (its only
//        file path is the sandbox, which 1Helm never uses: hard rule 4), so it has no stageFile and the helper is told plainly.
//   OUT: a result holding a FileDownloadable ({ name, mimetype, s3url }: a Gmail attachment, a Drive download…): saveOutputs() downloads it
//        (a public https link, at most APP_FILE_MAX; up to APP_FILE_BUFFER_MAX is read into memory, a larger file is streamed into the Library when
//        it fits there and otherwise onto the channel computer under /workspace/workspace/downloads), checks the Library's type allowlist and saves it
//        to the channel's Library through the Resident (ctx.files.save → storage.js stPut with the storage check, then the computer's
//        /workspace/files when it's up). The file object stays in the result as the app returned it, with the Library save written beside it
//        ("saved_to_library", file id); a file that is not saved says why and keeps its link, so save_link (below) can take it later.
//        Any other link (a plain signed string in a result, a proxy's binary_data.url) is saved by the same code through the save_link tool.
//        Signed links are shown to the helper as the app returned them; they are removed only from the stored 7-day records (app-results.js).
// Billing: nothing per file. Composio's file staging is part of the action call; 1Helm's own cost is the R2 storage, which storage.js
// counts against the account's limit like any other Library file. Downloads are reads and get their work-log row like any app read.
import { safeName, mimeOf, extOf, humanBytes, LIBRARY_MIMES, extForMime, MAX_UPLOAD } from "../files.js";

// Two limits, because the bytes of a file are handled in two ways. APP_FILE_MAX is the most a file coming from an app (a Drive download, an
// attachment, a save_link link) or going to an app by a temporary link (app-file-links.js) can be: those bytes are streamed (the download goes
// straight into R2 or into the computer, the link is served from R2), so a Worker never holds the file. APP_FILE_BUFFER_MAX is for every place
// that holds the whole file in Worker memory (a file handed to an app action, which needs its MD5 first, Base64 inside a result, quick_script,
// SFTP, an MCP server's Base64 response, a link's first 25 MB read before its length is known). A Worker has about 128 MB of memory.
export const APP_FILE_MAX = 250 * 1024 * 1024;
export const APP_FILE_BUFFER_MAX = 25 * 1024 * 1024;
export const APP_FILE_BODY_MS = 5 * 60 * 1000;   // the longest a download may take once its headers are in
export const MAX_FILES_IN = 10, MAX_FILES_OUT = 10;
// ---- downloading a link: one guard for every link ----
// Composio's file objects (s3url), signed links an app returns as plain strings (Canva exports, Figma images, vendor CDNs) and a proxy's
// binary_data.url are all fetched through fetchFile() with the same guard (no host allowlist; the guard
// replaces FILE_HOSTS). The constraint is SSRF: a link the model passes (or an app returns) must not make the Worker call an internal address.
// publicUrlCheck() accepts https on port 443 only, no user:password in the address, and a host that is a public IP literal or a dotted public
// name; it refuses localhost, single-label and internal-looking names (.local .internal .lan .home .corp .arpa), and every private,
// loopback, link-local, carrier-grade, multicast or reserved IPv4 / IPv6 literal (the URL parser has already turned 0x7f.1 or 2130706433
// into 127.0.0.1). A Worker cannot see which address a public name resolves to, and Cloudflare's network does not route a Worker's fetch
// to private ranges; every redirect hop is checked again (at most 3), and no credential is ever sent.
export const APP_FILE_REDIRECTS = 3;
const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
function privateV4(h) {
  const m = V4.exec(h); if (!m) return null;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && Number(m[3]) === 0))) || (a === 198 && (b === 18 || b === 19));
}
export function publicUrlCheck(u) {
  let x; try { x = new URL(String(u || "").trim()); } catch { return { error: "that isn't a valid address" }; }
  if (x.protocol !== "https:") return { error: "only https addresses are fetched" };
  if (x.username || x.password) return { error: "an address with a user name or password isn't fetched" };
  if (x.port && x.port !== "443") return { error: "only the standard https port is fetched" };
  const h = x.hostname.toLowerCase().replace(/\.$/, "");
  if (h.startsWith("[")) {   // IPv6 literal: only global unicast 2000::/3, and not the documentation range or 6to4 (which embeds an IPv4 address)
    const g = h.slice(1, -1);
    if (!/^[23][0-9a-f]{3}:/.test(g) || g.startsWith("2001:db8") || g.startsWith("2002:")) return { error: "that address isn't a public one" };
    return { ok: true, url: x.toString() };
  }
  const v4 = privateV4(h);
  if (v4) return { error: "that address isn't a public one" };
  if (v4 === null) { if (!h.includes(".") || /(^|\.)(localhost|local|internal|intranet|lan|home|corp|private|arpa)$/.test(h)) return { error: "that address isn't a public one" }; }
  return { ok: true, url: x.toString() };
}
export const fileHostOk = (u) => !!publicUrlCheck(u).ok;

// Uploads are narrower than downloads: Library bytes are only ever sent to the object stores Composio hands out for staged files, so a
// presigned upload address anywhere else (or a redirect to one) receives nothing. Every hop is checked here before any bytes go out.
const UPLOAD_HOSTS = /(^|\.)(composio\.dev|composio\.io|amazonaws\.com|blob\.core\.windows\.net|r2\.cloudflarestorage\.com|storage\.googleapis\.com)$/i;
export const uploadHostOk = (u) => { try { const x = new URL(String(u)); return x.protocol === "https:" && !x.username && !x.password && UPLOAD_HOSTS.test(x.hostname); } catch { return false; } };
export async function fileStoreFetch(url, init = {}) {
  const method = String(init.method || "GET").toUpperCase();
  let next = String(url);
  for (let hops = 0; hops <= 3; hops++) {
    if (!uploadHostOk(next)) throw new Error("the file store address isn't approved");
    const response = await fetch(next, { ...init, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => {});
    if (!location || hops === 3 || (method !== "GET" && ![307, 308].includes(response.status)))
      throw new Error("the file store redirected too many times or changed the upload method");
    try { next = new URL(location, next).href; }
    catch { throw new Error("the file store gave an invalid redirect"); }
  }
}
// ---- md5 (Composio's upload request wants it): Workers' WebCrypto has MD5; elsewhere (tests) a small JS one ----
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
export async function md5Hex(bytes) {
  try { return hex(await crypto.subtle.digest("MD5", bytes)); } catch { return md5js(bytes); }
}
const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
export function md5js(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), n = b.length, total = (((n + 8) >> 6) + 1) * 64;
  const m = new Uint8Array(total); m.set(b); m[n] = 0x80;
  const dv = new DataView(m.buffer); dv.setUint32(total - 8, (n * 8) >>> 0, true); dv.setUint32(total - 4, Math.floor(n / 2 ** 29), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const w = new Uint32Array(16);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; } else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; } else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + w[g]) >>> 0; A = D; D = C; C = B; B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new DataView(new ArrayBuffer(16)); [a0, b0, c0, d0].forEach((x, i) => out.setUint32(i * 4, x, true));
  return hex(out.buffer);
}

// ---- inputs ----
// One file as the helper passed it → a reference (a Library name / id or a computer path), or { error }.
function refOf(v) {
  if (typeof v === "string") return v.trim();
  if (v && typeof v === "object" && !Array.isArray(v)) {
    if (v.s3key) return { error: "pass the file as a Library file name or a /workspace path (1Helm fills in name, mimetype and s3key itself)" };
    const r = v.path ?? v.file ?? v.library ?? v.id ?? v.name; if (typeof r === "string") return r.trim();
  }
  return { error: "pass a Library file name or a /workspace path" };
}
// t: the transport; m: app_run's action meta (m.files = { input: "one" | "many" | "either" }); args: the helper's inputs.
// read(ref) → { name, mime, bytes } | { error } (the Resident: a Library file, else a computer path).
// → { args (with FileUploadables), staged: [{ input, name, bytes }] } | { error } (an error means nothing was run).
export async function stageInputs(t, m, args, { toolkit, appName = toolkit, read, ctx } = {}) {
  const names = Object.keys(m?.files || {}).filter((k) => args?.[k] != null && args[k] !== "" && !(Array.isArray(args[k]) && !args[k].length));
  if (!names.length) return { args, staged: [] };
  const fail = (why) => ({ error: `error: ${why} Nothing was run.` });
  const selfManaged = () => fail(`${m.slug} takes a file, and attaching files to app actions isn't available with a self-managed Composio account (Composio's Connect has no way for 1Helm to hand it a file). Tell the person in one plain line; if the app can do it another way (a link to the file, or the text itself), offer that.`);
  // transportFor() picks the side lazily: ask it before reading anything (a backend object without stageFile is the self-managed one).
  if (typeof t?.stageFile !== "function") return selfManaged();
  if (typeof t.canStageFiles === "function" && !(await t.canStageFiles())) return selfManaged();   // a failure here (a self-managed sign-in that ended) goes to app_run's own handling
  if (!read) return fail("files can't be attached from here.");
  const out = { ...args }, staged = [];
  for (const k of names) {
    const kind = m.files[k], v = args[k], list = Array.isArray(v);
    if (list && kind === "one") return fail(`${k} takes one file, not a list.`);
    const items = list ? v : [v];
    if (items.length > MAX_FILES_IN) return fail(`at most ${MAX_FILES_IN} files in ${k}.`);
    const ups = [];
    for (const it of items) {
      const ref = refOf(it);
      if (typeof ref !== "string") return fail(`${k}: ${ref.error}.`);
      if (!ref) return fail(`${k}: which file? Give a Library file name or a /workspace path.`);
      let f; try { f = await read(ref); } catch (e) { return fail(`couldn't read "${ref}": ${String(e.message || e).slice(0, 200)}.`); }
      if (!f || f.error) return fail(f?.error || `couldn't read "${ref}".`);
      const size = f.bytes?.byteLength ?? 0, name = safeName(f.name || ref.split("/").pop());
      if (size > APP_FILE_BUFFER_MAX) return fail(`"${name}" is ${humanBytes(size)}; a file attached to an app action can be at most ${humanBytes(APP_FILE_BUFFER_MAX)}. For an action that takes a link, pass {"file_url": "<file>"} instead (a file of up to ${humanBytes(APP_FILE_MAX)}).`);
      const mime = mimeOf(name, f.mime);
      if (!LIBRARY_MIMES.has(mime)) return fail(`"${name}" is a kind of file 1Helm doesn't attach (${mime}).`);
      let up;
      try { up = await t.stageFile({ toolkit, tool: m.slug, name, mimetype: mime, bytes: f.bytes, md5: await md5Hex(f.bytes) }, ctx); }
      catch (e) { return fail(e.unsupported ? e.message : `couldn't hand "${name}" to ${appName}: ${String(e.message || e).slice(0, 200)}.`); }
      ups.push(up); staged.push({ input: k, name, bytes: size });
    }
    out[k] = list || kind === "many" ? ups : ups[0];
  }
  return { args: out, staged };
}

// ---- file contents as an input's value ----
// An input that takes text (GitHub's file content, a note's body) can't take a FileUploadable. {"file_text": ref} is replaced by the file's
// text (UTF-8), {"file_base64": ref} by its Base64, where ref is a Library file name or a computer path (read(ref) as in stageInputs()).
// Looked for in the arguments up to four levels deep. → { args, used: [{ name, bytes }] } | { error } (an error means nothing was run).
export const INLINE_MAX = 3 * 1024 * 1024;
const refKind = (v) => { if (!isPlain(v)) return null; const k = Object.keys(v); return k.length === 1 && (k[0] === "file_text" || k[0] === "file_base64") && typeof v[k[0]] === "string" ? k[0] : null; };
const hasRef = (v, d = 0) => d > 4 ? false : refKind(v) ? true : Array.isArray(v) ? v.some((x) => hasRef(x, d + 1)) : isPlain(v) ? Object.values(v).some((x) => hasRef(x, d + 1)) : false;
export const toBase64 = (bytes) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
// A computer path passed as the text itself (the helper meant "the file's contents") would be stored as that literal path (GitHub kept
// "/workspace/…/index.html" as the page, twice; a path passed as `code` would run as the program). Only inputs named like contents are checked, and only a lone path with no spaces.
const CONTENT_INPUTS = new Set(["content", "contents", "body", "text", "html", "data", "file_content", "code", "script", "source"]);
export const pathAsContent = (args) => Object.entries(args || {}).find(([k, v]) => CONTENT_INPUTS.has(k) && typeof v === "string" && v.length < 300 && /^\/workspace\/\S+$/.test(v.trim()))?.[0] || null;
export async function resolveFileRefs(args, read, { skipPathCheck = false } = {}) {
  const used = [], pc = skipPathCheck ? null : pathAsContent(args);
  if (pc) return { error: `error: "${pc}" is a computer path, and it would be sent as the text itself, not the file's contents. To send the file's contents, pass {"file_text": "${args[pc].trim().slice(0, 200)}"} as the value of ${pc} (or {"file_base64": "…"} for Base64). Nothing was run.`, used };
  if (!hasRef(args)) return { args, used };
  const fail = (why) => ({ error: `error: ${why} Nothing was run.` });
  if (!read) return fail("files can't be read from here.");
  let bad = null;
  const walk = async (v, d, path) => {
    if (bad) return v;
    const k = refKind(v);
    if (k) {
      const ref = v[k].trim();
      if (!ref) { bad = `${path}: which file? Give a Library file name or a /workspace path.`; return v; }
      let f; try { f = await read(ref); } catch (e) { bad = `couldn't read "${ref}": ${String(e.message || e).slice(0, 200)}.`; return v; }
      if (!f || f.error) { bad = f?.error || `couldn't read "${ref}".`; return v; }
      const bytes = f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(f.bytes || 0), name = safeName(f.name || ref.split("/").pop());
      if (bytes.byteLength > INLINE_MAX) { bad = `"${name}" is ${humanBytes(bytes.byteLength)}; a file sent as text can be at most ${humanBytes(INLINE_MAX)}.`; return v; }
      used.push({ name, bytes: bytes.byteLength });
      if (k === "file_base64") return toBase64(bytes);
      try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch { bad = `"${name}" isn't text (it isn't valid UTF-8); use {"file_base64": ...} for it.`; return v; }
    }
    if (d >= 4) return v;
    if (Array.isArray(v)) { const o = []; for (let i = 0; i < v.length; i++) o.push(await walk(v[i], d + 1, `${path}[${i}]`)); return o; }
    if (isPlain(v)) { const o = {}; for (const [kk, x] of Object.entries(v)) o[kk] = await walk(x, d + 1, path ? `${path}.${kk}` : kk); return o; }
    return v;
  };
  const out = await walk(args, 0, "");
  return bad ? fail(bad) : { args: out, used };
}

// ---- inline files: Base64 inside a result ----
// Composio's MCP bridge returns the first content block of a custom MCP tool's result as `data` (a bare Base64 string for an image block), and
// a structuredContent object as it is. Any such Base64 that decodes to a known file type is saved to the Library like a file link.
export const INLINE_MIN = 64;   // characters; shorter strings are never files
const MAGIC = [["image/png", [0x89, 0x50, 0x4e, 0x47]], ["image/jpeg", [0xff, 0xd8, 0xff]], ["image/gif", [0x47, 0x49, 0x46, 0x38]], ["application/pdf", [0x25, 0x50, 0x44, 0x46]]];
function b64Bytes(b64) { try { const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/")); const o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; } catch { return null; } }
function sniff(head) {
  for (const [mime, m] of MAGIC) if (m.every((x, i) => head[i] === x)) return mime;
  if (head.length >= 12 && String.fromCharCode(...head.slice(0, 4)) === "RIFF" && String.fromCharCode(...head.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}
// → { b64, mime } | null. `declared` is a mimeType the app stated (an MCP block): used when the Library takes it and the bytes show no known type.
function inlineBytes(s, declared) {
  let str = String(s).trim();
  const du = /^data:([\w.+-]+\/[\w.+-]+);base64,/i.exec(str);
  if (du) { declared = declared || du[1]; str = str.slice(du[0].length); }
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(str)) return null;
  const head = b64Bytes(str.slice(0, 32));
  if (!head) return null;
  let mime = sniff(head);
  if (!mime && declared && LIBRARY_MIMES.has(String(declared).toLowerCase())) mime = String(declared).toLowerCase();
  return mime ? { b64: str, mime } : null;
}

// ---- outputs ----
// Open one link: the redirects, the status and the length header, but no body read yet. → { body (a stream), length (null when the server
// didn't say), type, name, url, cancel() } | { error, tooBig? }. The caller reads the body and must cancel it when it stops early.
// Constraints: publicUrlCheck() above (SSRF), `max` (refused from the length header; countLimit() cuts a body that goes past it), 60 s to the headers.
export async function openFile(url, max = APP_FILE_MAX) {
  let cur = String(url || "").trim(), r;
  // 60 s to get each response's headers; after that the body may take up to APP_FILE_BODY_MS in all (a 250 MB file doesn't arrive in a minute).
  const ctl = new AbortController(); let timer = null; const arm = (ms) => { clearTimeout(timer); timer = setTimeout(() => ctl.abort(), ms); timer.unref?.(); };
  for (let hop = 0; ; hop++) {
    const c = publicUrlCheck(cur); if (c.error) return { error: c.error };
    arm(60000);
    try { r = await fetch(c.url, { redirect: "manual", signal: ctl.signal }); } catch (e) { clearTimeout(timer); return { error: `the download failed (${String(e.message || e).slice(0, 80)})` }; }
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      try { await r.body?.cancel(); } catch {}
      if (hop >= APP_FILE_REDIRECTS) return { error: "the link redirects too many times" };
      try { cur = new URL(r.headers.get("location"), c.url).toString(); } catch { return { error: "the link redirects to an invalid address" }; }
      continue;
    }
    cur = c.url; break;
  }
  arm(APP_FILE_BODY_MS);
  if (!r.ok) { clearTimeout(timer); try { await r.body?.cancel(); } catch {} return { error: `the download failed (HTTP ${r.status}${r.status === 403 ? ": the link may have expired; run the action again" : ""})` }; }
  const len = Number(r.headers.get("content-length") || 0);
  if (len > max) { clearTimeout(timer); try { await r.body?.cancel(); } catch {} return { error: `it's ${humanBytes(len)}, over the ${humanBytes(max)} limit for a file from an app`, tooBig: true }; }
  const cd = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(r.headers.get("content-disposition") || "")?.[1];
  let dn = ""; try { dn = cd ? decodeURIComponent(cd) : ""; } catch { dn = cd || ""; }
  const raw = r.body || new Response(new Uint8Array(await r.arrayBuffer())).body;
  const body = raw.pipeThrough(new TransformStream({ flush() { clearTimeout(timer); } }));   // the time limit ends with the body
  return { body, length: len > 0 ? len : null, type: (r.headers.get("content-type") || "").split(";")[0].trim(), name: dn, url: cur, cancel: async () => { clearTimeout(timer); try { await body.cancel(); } catch {} } };
}
// A stream that errors once more than `max` bytes went through it (a server that lies about, or leaves out, its length).
export function countLimit(max) {
  let n = 0;
  return new TransformStream({ transform(chunk, ctl) { n += chunk.byteLength; if (n > max) ctl.error(new Error(`it's over the ${humanBytes(max)} limit for a file from an app`)); else ctl.enqueue(chunk); } });
}
// Read a body into memory, at most `max` bytes. → { bytes } | { error, tooBig }.
async function readAll(body, max) {
  const parts = []; let got = 0; const rd = body.getReader();
  for (;;) { const { done, value } = await rd.read(); if (done) break; got += value.byteLength; if (got > max) { try { await rd.cancel(); } catch {} return { error: `it's over the ${humanBytes(max)} limit for a file from an app`, tooBig: true }; } parts.push(value); }
  const bytes = new Uint8Array(got); let o = 0; for (const p of parts) { bytes.set(p, o); o += p.byteLength; }
  return { bytes };
}
// Download one link into memory, at most `max` bytes (APP_FILE_BUFFER_MAX unless the caller holds more on purpose).
// → { bytes, type, name?, url } | { error, tooBig? }.
export async function fetchFile(url, max = APP_FILE_BUFFER_MAX) {
  const o = await openFile(url, max); if (o.error) return o;
  const r = await readAll(o.body, max); if (r.error) return r;
  return { bytes: r.bytes, type: o.type, name: o.name, url: o.url };
}
const isPlain = (v) => v && typeof v === "object" && !Array.isArray(v);
// Where a downloaded file goes by size. Up to APP_FILE_BUFFER_MAX it is read into memory and saved to the Library as always. A larger file is
// streamed (saveStream, the Resident's appFileSaveStream): into the Library when its length is known and within the Library's upload limit,
// else onto the channel computer at /workspace/workspace/downloads/<name>, which the helper can use (unzip it, read it) and the person doesn't see in the Library.
// One link → { file } (in the Library, with `type`: the content type the server answered with) | { onComputer: { name, bytes, path } } | { error, full? }.
export async function saveFromUrl(fd, { save, saveStream = null, max = APP_FILE_MAX, fetcher = fetchFile, opener = openFile } = {}) {
  if (!save) return { error: "files from apps aren't saved from here" };
  const link = fd.s3url || fd.url;
  const nameOf = (got) => safeName(String(fd.name || fd.file_name || got.name || (() => { try { return decodeURIComponent(new URL(got.url || link).pathname.split("/").pop() || ""); } catch { return ""; } })() || "file").split(/[\\/]/).pop());
  const toLibrary = async (got) => {
    const name0 = nameOf(got);
    let mime = mimeOf(name0, fd.mimetype || got.type);
    if (!LIBRARY_MIMES.has(mime)) mime = mimeOf(name0, "");   // the app's type is unusual but the name's extension is one the Library knows
    if (!LIBRARY_MIMES.has(mime)) return { error: `it's a kind of file the Library doesn't take (${String(fd.mimetype || got.type || "unknown").slice(0, 80)})` };
    const name = extOf(name0) ? name0 : `${name0}.${extForMime(mime)}`;
    let r; try { r = await save({ name, mime, bytes: got.bytes }); } catch (e) { return { error: `saving failed (${String(e.message || e).slice(0, 120)})` }; }
    if (r?.full) return { error: "storage is full", full: r.error };
    if (!r?.file) return { error: r?.error ? String(r.error).replace(/^error: /, "") : "saving failed" };
    return { file: r.file, type: got.type || mime, requestedName: name0 };
  };
  if (!saveStream) {   // nothing to stream into: memory only, so the memory limit
    const got = await fetcher(link, Math.min(max, APP_FILE_BUFFER_MAX));
    return got.error ? { error: got.error } : await toLibrary(got);
  }
  const o = await opener(link, max);
  if (o.error) return { error: o.error };
  let body = o.body;
  if (!(o.length > APP_FILE_BUFFER_MAX)) {
    // A length that is known and small, or not known at all: read the first APP_FILE_BUFFER_MAX bytes. A file that ends there is the ordinary case.
    const head = [], rd = body.getReader(); let got = 0, more = false;
    for (;;) { const { done, value } = await rd.read(); if (done) break; got += value.byteLength; head.push(value); if (got > APP_FILE_BUFFER_MAX) { more = true; break; } }
    if (!more) { const bytes = new Uint8Array(got); let p = 0; for (const c of head) { bytes.set(c, p); p += c.byteLength; } return await toLibrary({ bytes, type: o.type, name: o.name, url: o.url }); }
    let i = 0;   // longer than it said (or never said): the chunks read so far, then the rest
    body = new ReadableStream({ async pull(ctl) { if (i < head.length) { ctl.enqueue(head[i++]); return; } const { done, value } = await rd.read(); if (done) ctl.close(); else ctl.enqueue(value); }, cancel: (why) => rd.cancel(why) });
  }
  const name0 = nameOf(o), size = o.length || null;
  const name = extOf(name0) || !(o.type || fd.mimetype) ? name0 : `${name0}.${extForMime(mimeOf(name0, fd.mimetype || o.type)) || "bin"}`;
  const mime = mimeOf(name, fd.mimetype || o.type);
  let r; try { r = await saveStream({ name, mime, stream: body.pipeThrough(countLimit(max)), size }); } catch (e) { return { error: `saving failed (${String(e.message || e).slice(0, 160)})` }; }
  if (r?.full) return { error: "storage is full", full: r.error };
  if (r?.file) return { file: r.file, type: o.type || mime, requestedName: name0 };
  if (r?.onComputer) return { onComputer: r.onComputer, type: o.type || mime, requestedName: name0 };
  return { error: r?.error ? String(r.error).replace(/^error: /, "") : "saving failed" };
}
const computerFields = (c, type) => ({ saved_to_computer: `Saved ${c.name} (${humanBytes(c.bytes)}) on your computer at ${c.path}. It is too big for the Library, so the person doesn't see it as a card; unzip it or read it there, and put the pieces they need in the Library with share_file.`, name: c.name, bytes: c.bytes, content_type: type, path: c.path });
const savedFields = (f, type) => f.updated
  ? { saved_to_library: `Updated ${f.name} in place in the Library (${humanBytes(f.bytes)}), not a copy. The person now sees the new version everywhere this file appears, including cards shared earlier.${f.updated}`, file_id: f.id, name: f.name, bytes: f.bytes, content_type: type, path: `/workspace/files/${f.name}` }
  : { saved_to_library: `Saved ${f.name} (${humanBytes(f.bytes)}) to the Library`, file_id: f.id, name: f.name, bytes: f.bytes, content_type: type, path: `/workspace/files/${f.name}` };
// data: the action's result. → { data (each saved file object keeps what the app returned, plus where it was saved), saved: [file], onComputer: [{ name, bytes, path }],
// skipped: [{ name, why }], full: the storage note when the account is full | null }.
// MAX_FILES_OUT per result is a constraint of time (one tool call) and storage; a file past it, or one that fails, is left exactly as the
// app returned it with `not_saved` beside it, so its link is still there for save_link.
export async function saveOutputs(data, { save, saveStream = null, max = APP_FILE_MAX, maxFiles = MAX_FILES_OUT, fetcher = fetchFile, opener = openFile } = {}) {
  const saved = [], onComputer = [], skipped = []; let full = null, seen = 0;
  async function one(fd) {
    const name0 = safeName(String(fd.name || fd.file_name || "file").split(/[\\/]/).pop());
    const no = (why) => { skipped.push({ name: name0, why }); return { ...fd, not_saved: why }; };
    if (!save) return no("files from apps aren't saved from here");
    if (full) return no("storage is full");
    if (++seen > maxFiles) return no(`only the first ${maxFiles} files of one result are saved; use save_link with this link for the others`);
    const r = await saveFromUrl(fd, { save, saveStream, max, fetcher, opener });
    if (r.error) { if (r.full) full = r.full; return no(r.error); }
    if (r.onComputer) { onComputer.push(r.onComputer); return { ...fd, ...computerFields(r.onComputer, r.type) }; }
    saved.push(r.file);
    return { ...fd, ...savedFields(r.file, r.type) };
  }
  async function walk(v, d) {
    if (d > 12) return v;
    if (Array.isArray(v)) { const o = []; for (const x of v) o.push(await walk(x, d + 1)); return o; }
    if (typeof v === "string") { const b = v.length >= INLINE_MIN ? inlineBytes(v) : null; return b ? inline(v, b, b.b64.length) : v; }
    if (!isPlain(v)) return v;
    if (typeof v.s3url === "string") return one(v);
    // An MCP image / audio block ({ type: "image", data: <base64>, mimeType }) in a result; type "file" is 1Helm's own form of an embedded resource blob (custom-mcp-direct.js).
    if (typeof v.data === "string" && /^(image|audio|file)$/i.test(String(v.type || "")) && typeof v.mimeType === "string") { const b = inlineBytes(v.data, v.mimeType); if (b) return inline(v, b, b.b64.length); }
    const o = {}; for (const [k, x] of Object.entries(v)) o[k] = await walk(x, d + 1); return o;
  }
  // Base64 an app returned inside the result (a data: URI, or a bare string that decodes to a PNG, JPEG, GIF, WebP or PDF): one file, same limits as a link.
  async function inline(fd, b, len) {
    const name0 = safeName(String(fd.name || fd.file_name || `${b.mime.startsWith("image/") ? "image" : "file"}-from-app`)), ext = extForMime(b.mime), name = extOf(name0) ? name0 : ext ? `${name0}.${ext}` : name0;
    const no = (why) => { skipped.push({ name, why }); return typeof fd === "string" ? `[a ${b.mime} file from the app was NOT saved: ${why}]` : { ...fd, not_saved: why }; };
    if (!save) return no("files from apps aren't saved from here");
    if (full) return no("storage is full");
    if (++seen > maxFiles) return no(`only the first ${maxFiles} files of one result are saved`);
    const mem = Math.min(max, APP_FILE_BUFFER_MAX);   // Base64 inside a result is already in memory
    if (Math.floor(len * 3 / 4) > mem) return no(`it's over the ${humanBytes(mem)} limit for a file inside a result`);
    const bytes = b64Bytes(b.b64); if (!bytes) return no("its Base64 text couldn't be read");
    if (bytes.byteLength > mem) return no(`it's over the ${humanBytes(mem)} limit for a file inside a result`);
    let r; try { r = await save({ name, mime: b.mime, bytes }); } catch (e) { return no(`saving failed (${String(e.message || e).slice(0, 120)})`); }
    if (r?.full) { full = r.error; return no("storage is full"); }
    if (!r?.file) return no(r?.error ? String(r.error).replace(/^error: /, "") : "saving failed");
    saved.push(r.file);
    const f = savedFields(r.file, b.mime);
    return typeof fd === "string" ? f : (({ data: _d, ...rest }) => ({ ...rest, ...f }))(fd);
  }
  const out = await walk(data, 0);
  return { data: out, saved, onComputer, skipped, full };
}
// The save_link tool: any public https link → the Library. → the text for the helper.
export async function saveLinkTool(a, { save, saveStream = null, fetcher = fetchFile, opener = openFile } = {}) {
  const url = String(a?.url || "").trim();
  if (!url) return "error: which link? Pass url (an https address).";
  const c = publicUrlCheck(url); if (c.error) return `error: ${c.error}. Nothing was fetched.`;
  const r = await saveFromUrl({ url, name: a?.name, mimetype: a?.content_type }, { save, saveStream, fetcher, opener });
  if (r.error) return `error: couldn't save it: ${r.error}.${r.full ? ` ${String(r.full).replace(/^error: /, "")}` : ""}`;
  if (r.onComputer) return `Saved "${r.onComputer.name}" (${humanBytes(r.onComputer.bytes)}, ${r.type || "unknown type"}) on your computer at ${r.onComputer.path}. It is too big for the Library, so the person doesn't see it as a card. Use it from there (unzip it, read it), and put the pieces the person needs in the Library with share_file.`;
  return `Saved "${r.file.name}" (${humanBytes(r.file.bytes)}, ${r.type || "unknown type"}) to the Library (file id ${r.file.id}). The person sees it as a download card in this chat and in the Library; on your computer: /workspace/files/${r.file.name}. Don't paste the contents.${r.file.updated ? ` Updated in place, not a copy.${r.file.updated}` : ""}`;
}
// The one line in front of the result (on the result's first line, so the work log's trimming keeps it).
export function savedLine({ saved = [], onComputer = [], skipped = [] } = {}) {
  const s = saved.map((f) => f.updated ? `Updated "${f.name}" in place in the Library (${humanBytes(f.bytes)}, file id ${f.id}), not a copy. The person now sees the new version everywhere this file appears, including cards shared earlier.${f.updated}` : `Saved "${f.name}" (${humanBytes(f.bytes)}) to the Library (file id ${f.id})`);
  const c = onComputer.map((x) => `Saved "${x.name}" (${humanBytes(x.bytes)}) on your computer at ${x.path}, not in the Library (too big for it); the person doesn't see it as a card. Use it from there (unzip it, read it) and put the pieces they need in the Library with share_file`);
  const k = skipped.map((x) => `NOT saved "${x.name}": ${x.why}`);
  if (!s.length && !k.length && !c.length) return "";
  if (!s.length) return ` ${[...c, ...k].join("; ")}.`;
  return ` ${[...s, ...c, ...k].join("; ")}.${s.length ? ` The person sees ${s.length > 1 ? "them" : "it"} as a download card in this chat and in the Library; on your computer: ${saved.map((f) => `/workspace/files/${f.name}`).join(", ")}. Don't paste the contents.${saved.some((f) => /\.(png|jpe?g|gif|webp)$/i.test(f.name)) ? " To look at a picture yourself, read_file its path." : ""}` : ""}`;
}
