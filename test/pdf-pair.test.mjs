// node --import ./test/stubs/register.mjs test/pdf-pair.test.mjs
// A PDF shared with its editable file is one Library item (its PDF copy); every Word document, deck and spreadsheet downloads as a PDF (GET .../files/<id>/pdf).
// Slide decks and Word documents open in the file viewer as a PDF made on the channel computer (src/file-preview.js), through the
// REAL Worker routes (GET /api/res/<ch>/files/<id>/preview) and a real Resident on node:sqlite, D1 on node:sqlite (029 storage), a fake
// R2 and a fake channel computer whose officeToPdf stands in for LibreOffice. Checks: first open makes the preview, later opens are
// served from storage (no second job; 304 with the etag); two opens at once share one job; the preview never shows in the Library;
// a deck made by share_file gets its preview right away (in the background), and a new version gets a new one (the old one deleted);
// non-office files and spreadsheets get 415; a file LibreOffice can't read is remembered for 10 minutes (no new job) unless retry=1;
// a computer that won't start isn't remembered; make:false (view-as, read-only) never starts a job; deleting the file, its chat or
// the channel deletes the preview; storage stays exact. Plus the job's shell script itself, run with a fake soffice/pdfinfo.
import { cleanupOnExit } from "./stubs/cleanup.mjs";
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { createHash } from "node:crypto"; import { readFileSync, mkdtempSync, writeFileSync, chmodSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { Resident } from "../src/resident.js";
import { stPut, recount } from "../src/storage.js";
import { previewKeyOf } from "../src/file-preview.js";
import { pickSource, pickPdfs, baseOf } from "../src/pdf-pair.js";
globalThis.HTMLRewriter ??= class { on() { return this; } transform(r) { return r; } };
globalThis.FixedLengthStream ??= class extends TransformStream { constructor() { super(); } };
const { default: worker } = await import("../src/index.js");

const sqlOf = (db) => ({ exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
  const st = db.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } });
const d1 = new DatabaseSync(":memory:");
d1.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT); CREATE TABLE sessions (token_hash TEXT, user_id TEXT, expires_at INTEGER);
  CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT, owner_user_id TEXT, status TEXT, past_due_since INTEGER, onboarding_completed INTEGER, onboard_step TEXT, slug_chosen INTEGER, helper_name TEXT, helper_avatar INTEGER, helper_tone INTEGER, first_name TEXT, plan TEXT, host_ready INTEGER);
  CREATE TABLE resident_schedules (tenant_id TEXT, channel TEXT, channel_id TEXT, next_run INTEGER, updated_at INTEGER, PRIMARY KEY (tenant_id, channel));
  INSERT INTO users VALUES ('u1','sam@example.com');
  INSERT INTO tenants VALUES ('t1','ck1','u1','active',NULL,1,'',1,'Ollie',3,0,'Sam','plus',0);`);
d1.exec(readFileSync(new URL("../db/migrations/0015_025_share.sql", import.meta.url), "utf8"));
d1.exec(readFileSync(new URL("../db/migrations/0020_029_storage.sql", import.meta.url), "utf8"));
d1.prepare("INSERT INTO sessions VALUES (?,?,?)").run(createHash("sha256").update("aa11").digest("hex"), "u1", Date.now() + 864e5 * 400);
const DB = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => ({ meta: { changes: Number(st.run(...a).changes) } }) }; return o; } };

const R2 = new Map(); let etagN = 0;
const toBytes = async (v) => v == null ? new Uint8Array(0) : typeof v === "string" ? new TextEncoder().encode(v) : v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(await new Response(v).arrayBuffer());
const obj = (key, o, body) => ({ key, size: o.bytes.length, httpEtag: `"${o.etag}"`, etag: o.etag, httpMetadata: o.meta || {}, ...(body ? { body: new Response(body).body, arrayBuffer: async () => body.slice().buffer, text: async () => new TextDecoder().decode(body) } : {}) });
const WS = {
  async put(key, v, opts = {}) { const bytes = await toBytes(v); R2.set(key, { bytes, etag: `e${++etagN}`, meta: opts.httpMetadata }); return { size: bytes.length }; },
  async head(key) { const o = R2.get(key); return o ? obj(key, o) : null; },
  async get(key, opts = {}) { const o = R2.get(key); if (!o) return null; const m = opts.onlyIf?.etagDoesNotMatch; return m && m === o.etag ? obj(key, o) : obj(key, o, o.bytes); },
  async delete(keys) { for (const k of [].concat(keys)) R2.delete(k); },
  async list({ prefix = "", limit = 1000 } = {}) { const ks = [...R2.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, limit); return { objects: ks.map((k) => ({ key: k, size: R2.get(k).bytes.length })), truncated: false }; },
};
const r2Under = (p) => [...R2.keys()].filter((k) => k.startsWith(p));

// The fake computer: an in-memory /workspace for share_file; officeToPdf "converts" by writing a fake PDF of the source bytes.
const FS = new Map(), MT = new Map(), jobs = []; let failStart = false, gate = null;
const computer = {
  async exec(cmd) {   // the sibling lookup of pdf-pair.js: prints "<ext> <mtime>" for each editable file with the PDF's base name
    const m = String(cmd).match(/f='((?:[^']|'\\'')*)'\.\$e/); if (!m) return { code: 127, out: "unexpected command" };
    const base = m[1].replace(/'\\''/g, "'"), exts = String(cmd).match(/for e in ([a-z0-9 ]+);/)[1].split(" ");
    return { code: 0, out: exts.filter((e) => FS.has(`${base}.${e}`)).map((e) => `${e} ${MT.get(`${base}.${e}`) ?? Math.floor(Date.now() / 1000)}`).join("\n") };
  },
  async fileToR2(path, key, max) { const b = FS.get(path); if (!b) return { ok: false, error: `no such file: ${path}` }; await stPut(env, key, b, {}, { size: b.length }); return { ok: true, bytes: b.length }; },
  async officeToPdf(src, out, ext) {
    jobs.push({ src, out, ext });
    if (failStart) throw new Error("container didn't start");
    if (gate) await gate;
    const o = R2.get(src); if (!o) return { ok: false, error: "the file is missing from storage" };
    const s = new TextDecoder().decode(o.bytes); if (s.startsWith("BAD")) return { ok: false, error: "LibreOffice couldn't read it: source file could not be loaded" };
    const pdf = `%PDF-1.7 preview of ${s}`; await stPut(env, out, pdf, { httpMetadata: { contentType: "application/pdf" } }, { size: pdf.length, replace: true });
    return { ok: true, bytes: pdf.length, pages: 3 };
  },
};
const dos = new Map();
const env = { DB, WS, VAULT_KEY: Buffer.from(Array.from({ length: 32 }, (_, i) => i + 3)).toString("base64"), APP_HOST: "app.example.test", GATEWAY_HOST: "app.example.test", ENV_NAME: "dev", MODEL: "@cf/test/model", MEMORY: "off", GENUI: "off", WORKMEM: "off", TEST_MODE: "1",
  RESIDENT: { idFromName: (n) => n, get: (n) => { if (!dos.has(n)) { const db = new DatabaseSync(":memory:"); const R = new Resident({ storage: { sql: sqlOf(db), getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {} }, waitUntil: () => {} }, env);
    R.systemPrompt = async () => "SYSTEM"; R.computer = () => computer; R.syncFiles = async () => {};
    const [, tid, slug] = n.split(":"); R.bind(tid, slug, "1", "America/Los_Angeles"); dos.set(n, R); } return dos.get(n); } },
  ARCHIVE: { idFromName: (n) => n, get: () => ({ channels: async () => [{ id: 1, slug: "main", name: "General" }] }) },
  LEDGER: { idFromName: (n) => n, get: () => new Proxy({}, { get: (_, k) => k === "then" ? undefined : k === "state" ? async () => ({ balance_nano: 1e12, spent_nano: 0, granted_nano: 1e12 }) : async () => ({ ok: true }) }) },
};
const R = env.RESIDENT.get("res:t1:main");
const fetchW = (url, init = {}) => worker.fetch(new Request(url, init), env, { waitUntil() {} });
const H = { cookie: "hc_session=aa11" };
const upload = async (name, body) => { const b = new TextEncoder().encode(body); const r = await fetchW("https://app.example.test/w/ck1/api/res/main/files", { method: "POST", headers: { ...H, "x-file-name": encodeURIComponent(name), "content-length": String(b.length) }, body: b }); assert.equal(r.status, 200); return (await r.json()).id; };
const preview = (id, q = "", h = {}) => fetchW(`https://app.example.test/w/ck1/api/res/main/files/${id}/preview${q}`, { headers: { ...H, ...h } });
const libFiles = async () => (await (await fetchW("https://app.example.test/w/ck1/api/res/main/files", { headers: H })).json()).files;
const countsRight = async (what) => { const c = await recount(env, "t1"); assert.equal(c.drift, 0, `${what}: the storage counter matches a recount`); };
const S = (await R.createSession("Make my deck")).id;
const tool = (name, args, session = S) => R.runTool({ function: { name, arguments: JSON.stringify(args) } }, { kind: "chat", session, turn: crypto.randomUUID(), emit: () => {} });
const settle = async () => { for (let i = 0; i < 50 && R._pvJobs?.size; i++) await Promise.all([...R._pvJobs.values()]); };
let passed = 0; const ok = (name) => { passed++; console.log("  ok", name); };
const put = (p, s) => FS.set(p, new TextEncoder().encode(s));
const pdfUrl = (id, h = H) => fetchW(`https://app.example.test/w/ck1/api/res/main/files/${id}/pdf`, { headers: h });
const items = () => R.sql.exec("SELECT * FROM files WHERE deleted=0 AND pending=0 AND hidden=0").toArray();
const idOf = (name) => items().find((r) => r.name === name)?.id;
const share = async (path, session, extra = {}) => { const out = await tool("share_file", { path, ...extra }, session); await settle(); return out; };

{
  assert.equal(baseOf("Resume (2).docx"), "resume"); assert.equal(baseOf("Plan.v2.pdf"), "plan.v2");
  const rows = [{ id: "1", name: "Resume.docx", session: "S", at: 5 }, { id: "2", name: "Resume.html", session: "S", at: 9 }, { id: "3", name: "Resume.docx", session: "OTHER", at: 9 }, { id: "4", name: "Resume.pdf", session: "S", at: 1 }];
  assert.equal(pickSource(rows, new Set(["resume"]), "S").id, "1", "the Word file wins a tie with the page; another task's file never counts");
  assert.equal(pickSource(rows, new Set(["cv"]), "S"), null); assert.equal(pickSource(rows, new Set(["resume"]), null), null);
  assert.deepEqual(pickPdfs(rows, "resume", "S").map((r) => r.id), ["4"]);
  ok("pairing rule: same task, same base name, an editable type; another task, another name or no task never pairs");
}
let DOC;
{
  const S1 = (await R.createSession("Edit my resume")).id;
  put("docs/Resume.docx", "resume v1"); put("docs/Resume.pdf", "%PDF resume v1");
  await share("docs/Resume.docx", S1); const said = await share("docs/Resume.pdf", S1);
  assert.match(said, /Kept "Resume\.pdf".*PDF copy/); assert.deepEqual(items().map((r) => r.name), ["Resume.docx"], "one Library item");
  DOC = idOf("Resume.docx"); const lib = await libFiles(); assert.equal(lib.length, 1); assert.equal(lib[0].pdf_copy, true);
  const r = await pdfUrl(DOC); assert.equal(r.status, 200); assert.equal(r.headers.get("content-type"), "application/pdf");
  assert.match(r.headers.get("content-disposition"), /^attachment; filename\*=UTF-8''Resume\.pdf$/); assert.equal(await r.text(), "%PDF resume v1", "the agent's own PDF is the copy");
  const n = jobs.length; await pdfUrl(DOC); assert.equal(jobs.length, n, "no conversion when the shared PDF is current");
  await countsRight("shared pair");
  ok("same task, same base name: the PDF is the editable file's PDF copy, one Library item, downloaded as the agent's own PDF");
}
{
  const S2 = (await R.createSession("Two reports")).id;
  put("Q3 report.docx", "q3"); put("Summary.pdf", "%PDF summary");
  await share("Q3 report.docx", S2); await share("Summary.pdf", S2);
  assert.deepEqual(items().map((r) => r.name).filter((n) => /^(Q3|Summary)/.test(n)).sort(), ["Q3 report.docx", "Summary.pdf"], "different names, no pair");
  assert.equal(R.pcRow(idOf("Q3 report.docx")), null);
  const S3 = (await R.createSession("Another task")).id; put("Resume.pdf", "%PDF other task");
  await share("Resume.pdf", S3); assert.ok(items().some((r) => r.name === "Resume.pdf"), "a PDF from another task never pairs with the Resume.docx of the first task");
  ok("different names: two items; a PDF from another task: its own item");
}
{
  const S4 = (await R.createSession("PDF first")).id;
  put("Offer.pdf", "%PDF offer");
  await share("Offer.pdf", S4); put("Offer.docx", "offer docx"); assert.deepEqual(items().filter((r) => /^Offer/.test(r.name)).map((r) => r.name), ["Offer.pdf"]);
  const pdfId = idOf("Offer.pdf"), pdfKey = R.sql.exec("SELECT r2key FROM files WHERE id=?", pdfId).one().r2key;
  const said = await share("Offer.docx", S4); assert.match(said, /Offer\.pdf" you shared earlier.*PDF copy/);
  assert.deepEqual(items().filter((r) => /^Offer/.test(r.name)).map((r) => r.name), ["Offer.docx"], "the PDF row is folded into the source");
  const id = idOf("Offer.docx"), c = R.pcRow(id); assert.equal(c.key, pdfKey, "the PDF's bytes are kept, not copied"); assert.ok(R2.has(pdfKey));
  assert.equal(await (await pdfUrl(id)).text(), "%PDF offer"); await countsRight("source after the PDF");
  ok("a source shared after the PDF in the same task folds the PDF in: one item");
}
{
  put("docs/Resume.pdf", "%PDF resume v2"); const S1 = R.sql.exec("SELECT session FROM files WHERE id=?", DOC).one().session;
  const old = R.pcRow(DOC).key; await share("docs/Resume.pdf", S1);
  assert.equal(items().filter((r) => /^Resume/.test(r.name) && r.session === S1).length, 1, "still one item");
  assert.equal(await (await pdfUrl(DOC)).text(), "%PDF resume v2"); assert.ok(!R2.has(old), "the earlier PDF copy is deleted"); await countsRight("second pdf version");
  ok("a second PDF for the same file replaces the copy (old bytes deleted), still one item");
}
{
  const S1 = R.sql.exec("SELECT session FROM files WHERE id=?", DOC).one().session;
  put("docs/Resume.docx", "resume v3"); const shared = R.pcRow(DOC).key;
  await share("docs/Resume.docx", S1); assert.equal(R.sql.exec("SELECT version FROM files WHERE id=?", DOC).one().version, 2);
  const n = jobs.length, r = await pdfUrl(DOC); assert.equal(r.status, 200); assert.match(await r.text(), /preview of resume v3/, "a new version: the old shared PDF isn't served as current; a fresh one is made from the new version");
  assert.ok(!R2.has(shared), "the stale shared PDF is deleted"); const n2 = jobs.length; await pdfUrl(DOC); assert.equal(jobs.length, n2, "cached per version");
  assert.ok(items().filter((r) => r.id === DOC).length === 1); await countsRight("new version");
  ok("a new version makes the shared PDF stale: the next download is made from the new version and cached for it");
}
{
  const S5 = (await R.createSession("Sibling")).id;
  put("out/Letter.docx", "letter"); put("out/Letter.pdf", "%PDF letter");
  const said = await share("out/Letter.pdf", S5); assert.match(said, /next to the PDF on your computer/);
  assert.deepEqual(items().filter((r) => /^Letter/.test(r.name)).map((r) => r.name), ["Letter.docx"]); assert.equal(await (await pdfUrl(idOf("Letter.docx"))).text(), "%PDF letter");
  const S6 = (await R.createSession("Old sibling")).id;
  put("out/Memo.docx", "memo"); MT.set("out/Memo.docx", 1000); put("out/Memo.pdf", "%PDF memo");
  await share("out/Memo.pdf", S6); assert.deepEqual(items().filter((r) => /^Memo/.test(r.name)).map((r) => r.name), ["Memo.pdf"], "a file this task didn't write is not a source");
  ok("only the PDF shared: the editable file next to it that this task wrote is shared too and paired; an older one is not");
}
{
  const xl = await upload("Budget.xlsx", "sheet v1"), n0 = jobs.length;
  const r = await pdfUrl(xl); assert.equal(r.status, 200); assert.match(await r.text(), /preview of sheet v1/); assert.equal(jobs.length, n0 + 1); assert.equal(jobs.at(-1).ext, "xlsx");
  await pdfUrl(xl); assert.equal(jobs.length, n0 + 1, "cached for this version");
  const deck = await upload("Talk.pptx", "deck"); assert.equal((await pdfUrl(deck)).status, 200);
  for (const [n, b] of [["scan.pdf", "%PDF"], ["page.html", "<p>x</p>"], ["notes.txt", "hi"]]) assert.equal((await pdfUrl(await upload(n, b))).status, 415, n);
  assert.equal((await pdfUrl("00000000-0000-4000-8000-000000000000")).status, 404);
  const d = await R.filePdfCopy(await upload("Fresh.xlsx", "x"), { make: false }); assert.equal(d.status, 409, "make:false (view-as, read-only) never starts a job");
  ok("spreadsheets and decks download as a PDF made on the computer and cached per version; PDFs, pages and text get 415; unknown file 404");
}
{
  const anon = await fetchW(`https://app.example.test/w/ck1/api/res/main/files/${DOC}/pdf`); assert.notEqual(anon.headers.get("content-type"), "application/pdf", "needs a signed-in session");
  const bad = await fetchW(`https://app.example.test/w/ck1/api/res/main/files/${DOC}/pdf`, { headers: { cookie: "hc_session=wrong" } }); assert.notEqual(bad.headers.get("content-type"), "application/pdf");
  const other = await fetchW(`https://app.example.test/w/other/api/res/main/files/${DOC}/pdf`, { headers: H }); assert.notEqual(other.headers.get("content-type"), "application/pdf", "another workspace's address never serves it");
  ok("the PDF route needs the workspace's own session");
}
{
  const id = idOf("Resume.docx"), keys = [R.pcRow(id)?.key, R.sql.exec("SELECT r2key FROM files WHERE id=?", id).one().r2key].filter(Boolean);
  assert.equal((await fetchW(`https://app.example.test/w/ck1/api/res/main/files/${id}/delete`, { method: "POST", headers: H })).status, 200);
  for (const k of keys) assert.ok(!R2.has(k), "deleted with the file"); assert.equal(R.pcRow(id), null); await countsRight("after delete");
  ok("deleting the file deletes its PDF copy; storage stays exact");
}
console.log(`pdf-pair: ${passed} groups passed`); cleanupOnExit?.();
