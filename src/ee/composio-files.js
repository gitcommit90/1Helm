// Files in and out of app actions (10-06, composio-upgrade stage 4). Composio exchanges files through its own short-lived object storage:
//   IN:  an action input that is a FileUploadable ({ name, mimetype, s3key }, flagged file_uploadable in the schema; composio-schema.js
//        shows it to the helper as "file: give a Library file name or a /workspace path"). The helper passes a Library file (name or id)
//        or a computer path; stageInputs() reads the bytes (the Resident's ctx.files.read), checks size and type, stages them with the
//        transport's stageFile() (Composio's upload request + a PUT to its presigned URL) and fills in { name, mimetype, s3key }.
//        Staging happens only after every other check passed, so a write with an attachment (an email) still needs the tap on its confirm card (confirm.js)
//        first and nothing is uploaded before that. The self-managed backend (Connect MCP) has no way to take a file from 1Helm (its only
//        file path is the sandbox, which 1Helm never uses: hard rule 4), so it has no stageFile and the helper is told plainly.
//   OUT: a result holding a FileDownloadable ({ name, mimetype, s3url }: a Gmail attachment, a Drive download…): saveOutputs() downloads it
//        (https, Composio's file stores only, at most APP_FILE_MAX, streamed with a cap), checks the Library's type allowlist and saves it
//        to the channel's Library through the Resident (ctx.files.save → storage.js stPut with the storage check, then the computer's
//        /workspace/files when it's up). The result the model sees says "Saved <name> (<size>) to the Library" with the file id, in place
//        of the file object; a full account saves nothing and says so. Signed download links never reach the model (scrubSigned).
// Billing: nothing per file. Composio's file staging is part of the action call; 1Helm's own cost is the R2 storage, which storage.js
// counts against the account's limit like any other Library file. Downloads are reads and get their work-log row like any app read.
import { safeName, mimeOf, extOf, humanBytes, LIBRARY_MIMES, extForMime } from "../files.js";

export const APP_FILE_MAX = 25 * 1024 * 1024;   // per file, both ways (Gmail's own message limit; uploads to the Library allow more)
export const MAX_FILES_IN = 10, MAX_FILES_OUT = 10;
// Where Composio puts staged files (its presigned URLs): an s3url anywhere else is not fetched.
const FILE_HOSTS = /(^|\.)(composio\.dev|composio\.io|amazonaws\.com|blob\.core\.windows\.net|r2\.cloudflarestorage\.com|storage\.googleapis\.com)$/i;
export const fileHostOk = (u) => { try { const x = new URL(String(u)); return x.protocol === "https:" && !x.username && !x.password && FILE_HOSTS.test(x.hostname); } catch { return false; } };

// Check every transfer hop ourselves. Fetch's automatic redirects can move a
// signed download or an upload containing Library bytes to an arbitrary host.
export async function fileStoreFetch(url, init = {}) {
  const method = String(init.method || "GET").toUpperCase();
  let next = String(url);
  for (let hops = 0; hops <= 3; hops++) {
    if (!fileHostOk(next)) throw new Error("the file store address isn't approved");
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

// ---- signed links never reach the model ----
// Presigned / SAS links (S3, GCS, Azure, CloudFront) and any link into a cloud file store become a short note.
const SIGNED = /https?:\/\/[^\s"'<>\\]+?(?:[?&](?:X-Amz-[A-Za-z-]+|X-Goog-[A-Za-z-]+|Signature|sig|AWSAccessKeyId)=)[^\s"'<>\\]*/gi;
const STORE_URL = /https?:\/\/(?:[\w-]+\.)*(?:amazonaws\.com|blob\.core\.windows\.net|r2\.cloudflarestorage\.com|storage\.googleapis\.com|storage\.composio\.dev)\/[^\s"'<>\\]*/gi;
export const SIGNED_NOTE = "[signed file link left out]";
export const scrubSigned = (s) => String(s ?? "").replace(SIGNED, SIGNED_NOTE).replace(STORE_URL, SIGNED_NOTE);

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
      if (size > APP_FILE_MAX) return fail(`"${name}" is ${humanBytes(size)}; a file for an app can be at most ${humanBytes(APP_FILE_MAX)}.`);
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

// ---- outputs ----
// Download one staged file, at most `max` bytes (refused from the length header, else cut off while streaming).
export async function fetchFile(url, max = APP_FILE_MAX) {
  if (!fileHostOk(url)) return { error: "its address isn't one of Composio's file stores" };
  let r; try { r = await fileStoreFetch(url, { signal: AbortSignal.timeout(60000) }); } catch (e) { return { error: `the download failed (${String(e.message || e).slice(0, 80)})` }; }
  if (!r.ok) { try { await r.body?.cancel(); } catch {} return { error: `the download failed (HTTP ${r.status}${r.status === 403 ? ": the link may have expired; run the action again" : ""})` }; }
  const len = Number(r.headers.get("content-length") || 0);
  if (len > max) { try { await r.body?.cancel(); } catch {} return { error: `it's ${humanBytes(len)}, over the ${humanBytes(max)} limit for a file from an app`, tooBig: true }; }
  const parts = []; let got = 0;
  if (r.body?.getReader) {
    const rd = r.body.getReader();
    for (;;) { const { done, value } = await rd.read(); if (done) break; got += value.byteLength; if (got > max) { try { await rd.cancel(); } catch {} return { error: `it's over the ${humanBytes(max)} limit for a file from an app`, tooBig: true }; } parts.push(value); }
  } else { const b = new Uint8Array(await r.arrayBuffer()); if (b.byteLength > max) return { error: `it's over the ${humanBytes(max)} limit for a file from an app`, tooBig: true }; parts.push(b); got = b.byteLength; }
  const bytes = new Uint8Array(got); let o = 0; for (const p of parts) { bytes.set(p, o); o += p.byteLength; }
  return { bytes, type: (r.headers.get("content-type") || "").split(";")[0].trim() };
}
const isPlain = (v) => v && typeof v === "object" && !Array.isArray(v);
// data: the action's result. save({ name, mime, bytes }) → { file: { id, name, bytes } } | { error, full } (the Resident; storage.js).
// → { data (file objects replaced), saved: [file], skipped: [{ name, why }], full: the storage note when the account is full | null }.
export async function saveOutputs(data, { save, max = APP_FILE_MAX, maxFiles = MAX_FILES_OUT, fetcher = fetchFile } = {}) {
  const saved = [], skipped = []; let full = null, seen = 0;
  async function one(fd) {
    const name0 = safeName(String(fd.name || fd.file_name || "file").split(/[\\/]/).pop());
    const no = (why) => { skipped.push({ name: name0, why }); return { file: name0, not_saved: why }; };
    if (!save) return no("files from apps aren't saved from here");
    if (full) return no("storage is full");
    if (++seen > maxFiles) return no(`only the first ${maxFiles} files of one result are saved`);
    const got = await fetcher(fd.s3url, max);
    if (got.error) return no(got.error);
    let mime = mimeOf(name0, fd.mimetype || got.type);
    if (!LIBRARY_MIMES.has(mime)) mime = mimeOf(name0, "");   // the app's type is unusual but the name's extension is one the Library knows
    if (!LIBRARY_MIMES.has(mime)) return no(`it's a kind of file the Library doesn't take (${String(fd.mimetype || got.type || "unknown").slice(0, 80)})`);
    const name = extOf(name0) ? name0 : `${name0}.${extForMime(mime)}`;
    let r; try { r = await save({ name, mime, bytes: got.bytes }); } catch (e) { return no(`saving failed (${String(e.message || e).slice(0, 120)})`); }
    if (r?.full) { full = r.error; return no("storage is full"); }
    if (!r?.file) return no(r?.error ? String(r.error).replace(/^error: /, "") : "saving failed");
    const f = r.file; saved.push(f);
    return { saved_to_library: `Saved ${f.name} (${humanBytes(f.bytes)}) to the Library`, file_id: f.id, name: f.name, bytes: f.bytes, path: `/workspace/files/${f.name}` };
  }
  async function walk(v, d) {
    if (d > 12) return v;
    if (Array.isArray(v)) { const o = []; for (const x of v) o.push(await walk(x, d + 1)); return o; }
    if (!isPlain(v)) return v;
    if (typeof v.s3url === "string") return one(v);
    const o = {}; for (const [k, x] of Object.entries(v)) o[k] = await walk(x, d + 1); return o;
  }
  const out = await walk(data, 0);
  return { data: out, saved, skipped, full };
}
// The one line in front of the result (on the result's first line, so the work log's trimming keeps it).
export function savedLine({ saved = [], skipped = [] } = {}) {
  const s = saved.map((f) => `Saved "${f.name}" (${humanBytes(f.bytes)}) to the Library (file id ${f.id})`);
  const k = skipped.map((x) => `NOT saved "${x.name}": ${x.why}`);
  if (!s.length && !k.length) return "";
  return ` ${[...s, ...k].join("; ")}.${s.length ? ` The person sees ${s.length > 1 ? "them" : "it"} as a download card in this chat and in the Library; on your computer: ${saved.map((f) => `/workspace/files/${f.name}`).join(", ")}. Don't paste the contents.` : ""}`;
}
