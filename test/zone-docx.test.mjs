// node --import ./test/stubs/register.mjs test/zone-docx.test.mjs
// Word documents in the Zone: direct edits of a Library .docx file through the REAL Worker route (POST /api/res/<ch>/files/<id>/zone-edit) and a real Resident, plus the pure string transforms in src/zone-edit.js.
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { createHash } from "node:crypto"; import { readFileSync, mkdtempSync, writeFileSync, chmodSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { Resident } from "../src/resident.js";
import { zoneEditsLine, zoneEditsNote } from "../src/zone-edit.js";
import { readZip, entryBytes, writeZip, newEntry, paragraphs, editParagraph, findParagraph, applyDocxEdits } from "../src/zone-docx.js";
import { replyRef, replyLine } from "../src/reply-to.js";
import { stPut, recount } from "../src/storage.js";
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
const FS = new Map(), jobs = []; let failStart = false, gate = null;
const computer = {
  async exec() { return { code: 127, out: "unexpected command" }; },
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
const env = { DB, WS, VAULT_KEY: Buffer.from(Array.from({ length: 32 }, (_, i) => i + 3)).toString("base64"), APP_HOST: "host.example.test", GATEWAY_HOST: "host.example.test", ENV_NAME: "dev", MODEL: "@cf/test/model", MEMORY: "off", GENUI: "off", WORKMEM: "off", TEST_MODE: "1",
  RESIDENT: { idFromName: (n) => n, get: (n) => { if (!dos.has(n)) { const db = new DatabaseSync(":memory:"); const R = new Resident({ storage: { sql: sqlOf(db), getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {} }, waitUntil: () => {} }, env);
    R.systemPrompt = async () => "SYSTEM"; R.computer = () => computer; R.syncFiles = async () => {};
    const [, tid, slug] = n.split(":"); R.bind(tid, slug, "1", "America/Los_Angeles"); dos.set(n, R); } return dos.get(n); } },
  ARCHIVE: { idFromName: (n) => n, get: () => ({ channels: async () => [{ id: 1, slug: "main", name: "General" }, { id: 2, slug: "other", name: "Other" }] }) },
  LEDGER: { idFromName: (n) => n, get: () => new Proxy({}, { get: (_, k) => k === "then" ? undefined : k === "state" ? async () => ({ balance_nano: 1e12, spent_nano: 0, granted_nano: 1e12 }) : async () => ({ ok: true }) }) },
};
const R = env.RESIDENT.get("res:t1:main"), R_OTHER = env.RESIDENT.get("res:t1:other");
const fetchW = (url, init = {}) => worker.fetch(new Request(url, init), env, { waitUntil() {} });
const H = { cookie: "hc_session=aa11" };
const upload = async (name, body) => { const b = typeof body === "string" ? new TextEncoder().encode(body) : body; const r = await fetchW("https://host.example.test/w/ck1/api/res/main/files", { method: "POST", headers: { ...H, "x-file-name": encodeURIComponent(name), "content-length": String(b.length) }, body: b }); assert.equal(r.status, 200); return (await r.json()).id; };
const preview = (id, q = "", h = {}) => fetchW(`https://host.example.test/w/ck1/api/res/main/files/${id}/preview${q}`, { headers: { ...H, ...h } });
const libFiles = async () => (await (await fetchW("https://host.example.test/w/ck1/api/res/main/files", { headers: H })).json()).files;
const countsRight = async (what) => { const c = await recount(env, "t1"); assert.equal(c.drift, 0, `${what}: the storage counter matches a recount`); };
let passed = 0; const ok = (name) => { passed++; console.log("  ok", name); };
const ZE = (ch, id, body, h = {}) => { const raw = typeof body === "string" ? body : JSON.stringify(body); return fetchW(`https://host.example.test/w/ck1/api/res/${ch}/files/${id}/zone-edit`, { method: "POST", headers: { ...H, "content-type": "application/json", "content-length": String(new TextEncoder().encode(raw).length), ...h }, body: raw }); };
const rowOf = (id) => R.sql.exec("SELECT * FROM files WHERE id=?", id).one();
const bytesOf = (id) => R2.get(rowOf(id).r2key).bytes;
const dec = new TextDecoder(), enc = new TextEncoder();

// ---- a small .docx made by the module's own zip writer (the tests never need Word or LibreOffice) ----
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';
const run = (t, bold) => `<w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${t}</w:t></w:r>`;
const BODY = `<w:p><w:pPr><w:pStyle w:val="Title"/><w:tabs><w:tab w:val="right" w:pos="9000"/></w:tabs></w:pPr>${run("Joseph ", true)}${run("Yaksich")}</w:p>
<w:p>${run("Engineer, R&amp;D")}<w:r><w:tab/></w:r>${run("2020 to 2022")}</w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${run("Led the team of five.")}</w:p>
<w:p>${run("Repeat me")}</w:p><w:p>${run("Repeat me")}</w:p>
<w:tbl><w:tr><w:tc><w:p>${run("Cell A")}</w:p></w:tc><w:tc><w:p>${run("Cell B")}</w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><w:txbxContent><w:p>${run("In a box")}</w:p></w:txbxContent></w:drawing></mc:Choice><mc:Fallback><w:pict><w:txbxContent><w:p>${run("In a box")}</w:p></w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>
<w:p>${run("Café ")}${run("naïve 😀 end")}</w:p>`;
const XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${BODY}<w:sectPr/></w:body></w:document>`;
const PARTS = { "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>', "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>', "word/styles.xml": `<w:styles ${W}>${"<w:style w:styleId=\"S\"/>".repeat(40)}</w:styles>`, "word/document.xml": XML, "docProps/core.xml": "<cp/>" };
const mk = async (parts = PARTS) => writeZip(await Promise.all(Object.entries(parts).map(([name, t]) => newEntry({ name, made: 20, flags: 0x800, time: 0, date: 0x21, iattr: 0, eattr: 0 }, typeof t === "string" ? enc.encode(t) : t))));
const DOCX = await mk();
const xmlOf = async (zip) => dec.decode(await entryBytes(readZip(zip).find((e) => e.name === "word/document.xml")));
const texts = (xml) => paragraphs(xml).map((p) => p.text);
const throwsStatus = async (fn, status, re) => { try { await fn(); } catch (e) { assert.equal(e.status, status, e.message); if (re) assert.match(e.message, re); return; } assert.fail("expected an error"); };

{   // the zip: reads, rewrites, keeps every other part's bytes
  const es = readZip(DOCX); assert.deepEqual(es.map((e) => e.name), Object.keys(PARTS));
  for (const e of es) assert.equal(dec.decode(await entryBytes(e)), PARTS[e.name], e.name);
  const out = await applyDocxEdits(DOCX, [{ op: "text", was: "Cell A", text: "Cell Z" }]);
  const a = readZip(DOCX), b = readZip(out.bytes);
  for (let i = 0; i < a.length; i++) if (a[i].name !== "word/document.xml") { assert.deepEqual(b[i].raw, a[i].raw, `${a[i].name} is copied byte for byte`); assert.equal(b[i].crc, a[i].crc); }
  assert.equal(b.length, a.length); assert.deepEqual(b.map((e) => e.name), a.map((e) => e.name), "same parts in the same order");
  try { const py = execFileSync("python3", ["-I", "-c", "import sys,zipfile,io;z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));print(z.testzip());print(len(z.namelist()))"], { input: Buffer.from(out.bytes) }).toString(); assert.equal(py.trim(), "None\n5", "an independent zip reader accepts the result"); } catch (e) { if (e.code !== "ENOENT") throw e; }
  await throwsStatus(() => applyDocxEdits(new Uint8Array(1000), []), 415);
  const noDoc = await mk({ "a.xml": "<a/>" }); await throwsStatus(() => applyDocxEdits(noDoc, [{ op: "text", was: "x", text: "y" }]), 415);
  await throwsStatus(() => readZip(new Uint8Array(26 * 1024 * 1024)), 413);
  ok("zip: reads and rewrites a document, every part but word/document.xml is copied byte for byte, an independent reader accepts it, bad and oversize files refused");
}
{   // which paragraphs there are
  assert.deepEqual(texts(XML), ["Joseph Yaksich", "Engineer, R&D\t2020 to 2022", "Led the team of five.", "Repeat me", "Repeat me", "Cell A", "Cell B", "", "In a box", "Café naïve 😀 end"], "tab stops are not tabs, a text box is listed once (its mc:Fallback copy is skipped), table cells are paragraphs");
  ok("paragraphs: text per paragraph, tabs, tables, text boxes");
}
{   // editing one paragraph
  const ed = (edit, xml = XML) => editParagraph(xml, edit);
  const cases = [
    [{ was: "Joseph Yaksich", text: "Joseph Q. Yaksich" }, 0, "Joseph Q. Yaksich"],
    [{ was: "Engineer, R&D 2020 to 2022", text: "Senior Engineer, R&D 2020 to 2023" }, 1, "Senior Engineer, R&D\t2020 to 2023"],
    [{ was: "• Led the team of five.", text: "• Led the group of 5 & <more>." }, 2, "Led the group of 5 & <more>."],
    [{ was: "Cell B", text: "" }, 6, ""],
  ];
  for (const [edit, i, want] of cases) {
    const r = ed(edit), t = texts(r.xml); assert.equal(t[i], want, JSON.stringify(edit));
    const base = texts(XML); assert.deepEqual(t.filter((_, k) => k !== i), base.filter((_, k) => k !== i), "every other paragraph is the same");
  }
  const one = ed({ was: "Joseph Yaksich", text: "Joseph Q. Yaksich" }).xml;
  assert.ok(one.includes('<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Joseph Q. </w:t></w:r><w:r><w:t xml:space="preserve">Yaksich</w:t></w:r>'), "the typed text goes into the bold run next to it, and the plain run is untouched: " + one.slice(one.indexOf("<w:body>"), one.indexOf("<w:body>") + 400));
  const tab = ed({ was: "Engineer, R&D 2020 to 2022", text: "Senior Engineer, R&D 2020 to 2023" }).xml;
  assert.ok(tab.includes("<w:r><w:tab/></w:r>") && tab.includes(">Senior Engineer, R&amp;D</w:t>") && tab.includes(">2020 to 2023</w:t>"), "a change before and after a tab leaves the tab alone");
  assert.ok(ed({ was: "Led the team of five.", text: "x </w:t><w:p>& y" }).xml.includes(">x &lt;/w:t&gt;&lt;w:p&gt;&amp; y</w:t>"), "new text is escaped as XML");
  const xs = ed({ was: "Cell A", text: "  lead & trail  " }).xml; assert.ok(xs.includes(">lead &amp; trail</w:t>"));
  assert.equal(texts(ed({ was: "Café naïve 😀 end", text: "Café naïve 😁 end" }).xml)[9], "Café naïve 😁 end", "a surrogate pair is never split");
  assert.equal(texts(ed({ was: "Joseph Yaksich", text: "Joseph\nQ.\n  Yaksich" }).xml)[0], "Joseph Q. Yaksich", "line breaks in the new text become spaces");
  // finding by the text the PDF shows
  assert.equal(texts(ed({ was: "Repeat me", n: 1, text: "Second" }).xml).join("|").includes("Repeat me|Second"), true, "n picks the occurrence");
  assert.equal(texts(ed({ was: "Repeat me", n: 0, text: "First" }).xml).join("|").includes("First|Repeat me"), true);
  await throwsStatus(() => ed({ was: "Repeat me", text: "x" }), 409, /more than once/);
  await throwsStatus(() => ed({ was: "Repeat me", n: 5, text: "x" }), 409);
  await throwsStatus(() => ed({ was: "Not there at all", text: "x" }), 422, /Couldn't find that text/);
  assert.equal(texts(ed({ was: "In a box", text: "In a crate" }).xml)[8], "In a crate", "a text box's paragraph is found once (its fallback copy is skipped)");
  assert.equal(texts(ed({ was: "Engineer, R&D 2020 to 2022", text: "Engineer, R&D and 2020 to 2022" }).xml)[1], "Engineer, R&D\tand 2020 to 2022", "text added just after a tab goes in the run after it");
  await throwsStatus(() => ed({ was: "Joseph Yaksich", text: "Joseph Yaksich" }), 400, /Nothing changed/);
  await throwsStatus(() => ed({ was: "Joseph Yaksich", text: "x".repeat(5001) }), 400);
  await throwsStatus(() => ed({ was: "", text: "x" }), 400);
  await throwsStatus(() => ed({ was: "Engineer, R&D 2020 to 2022", text: "Engineer,R&D2020 to 2022" }), 400, /tab or a line break/);
  // a part of a line (a segment the page showed on its own)
  assert.equal(texts(ed({ was: "2020 to 2022", text: "2019 to 2022" }).xml)[1], "Engineer, R&D\t2019 to 2022", "a stretch of a paragraph can be changed alone");
  // a different quote or ligature on the page still finds it
  assert.equal(texts(ed({ was: "Led the team of ﬁve", text: "Led the team of six." }).xml)[2], "Led the team of six.", "found by letters and digits when the page's punctuation or ligatures differ");
  ok("edit: only the changed characters change, runs keep their formatting, tabs stay, escaped, surrogates intact, occurrence and partial matches, refusals with plain messages");
}

let DID;
{   // through the route
  DID = await upload("Resume.docx", DOCX); const v1 = rowOf(DID), k1 = v1.r2key; assert.equal(v1.version, 1);
  const before = jobs.length;
  const r = await ZE("main", DID, { base: 1, edits: [{ op: "text", page: 1, was: "Joseph Yaksich", n: 0, text: "Joseph Q. Yaksich" }, { op: "text", page: 1, was: "Repeat me", n: 1, text: "Second copy" }] });
  assert.equal(r.status, 200, await r.clone().text()); const b = await r.json();
  assert.equal(b.ok, true); assert.equal(b.applied, 2); assert.equal(b.file.version, 2); assert.equal(b.file.id, DID); assert.equal(b.file.name, "Resume.docx");
  const row = rowOf(DID); assert.equal(row.prev_key, k1, "the old version is kept as previous"); assert.match(row.r2key, new RegExp(`^t/t1/files/main/${DID}\\.v2$`)); assert.equal(row.synced, 0);
  assert.deepEqual(R2.get(k1).bytes, DOCX, "the old bytes are untouched");
  const nx = await xmlOf(bytesOf(DID)); assert.deepEqual(texts(nx).filter((t, i) => ![0, 4].includes(i)), texts(XML).filter((t, i) => ![0, 4].includes(i)), "only the two paragraphs changed");
  assert.equal(texts(nx)[0], "Joseph Q. Yaksich"); assert.equal(texts(nx)[4], "Second copy");
  const rec = JSON.parse(R.getRaw(`zone_edits:${DID}`)); assert.equal(rec.v, 2); assert.equal(rec.doc, true); assert.deepEqual(rec.edits[0], { slide: 1, op: "text", doc: true, was: "Joseph Yaksich", now: "Joseph Q. Yaksich" });
  const line = zoneEditsLine(R, DID); assert.match(line, /^\(Since the document was built, the person edited it by hand in the canvas, in "Resume\.docx" \(Library file .*\): a paragraph on page 1 "Joseph Yaksich" is now "Joseph Q\. Yaksich", .*not in the document's \.src folder; keep them when you rebuild\.\)$/);
  assert.equal(zoneEditsNote(R, DID), line);
  await new Promise((r) => setTimeout(r, 50)); assert.ok(jobs.slice(before).some((j) => j.out.endsWith(".v2.preview.pdf") && j.ext === "docx"), "the page pictures of the new version are being made");
  const pv = await preview(DID); assert.equal(pv.status, 200); assert.equal(pv.headers.get("x-preview-kind"), "doc"); assert.match(dec.decode(new Uint8Array(await pv.arrayBuffer())), /^%PDF-1\.7 preview of /, "the preview follows the new version");
  assert.equal(jobs.filter((j) => j.out.endsWith(".v2.preview.pdf")).length, 1, "one conversion, not two");
  // restore the version before
  const rs = await ZE("main", DID, { base: 2, restore: "previous" }); assert.equal(rs.status, 200); assert.equal((await rs.json()).file.version, 3); assert.deepEqual(bytesOf(DID), DOCX, "the earlier bytes are back");
  assert.equal(zoneEditsLine(R, DID), "", "no hand edits are left to tell the helper about");
  const info = await (await fetchW(`https://host.example.test/w/ck1/api/res/main/files/${DID}/zone-info`, { headers: H })).json(); assert.equal(info.version, 3); assert.equal(info.has_previous, true);
  await countsRight("after document edits");
  ok("route: a document edit stores a new version (old kept as previous), the record and the helper line, makes the preview, and restore-previous brings the earlier bytes back");
}
{   // refusals
  const base = rowOf(DID).version;
  const e = (edits, ch = "main", id = DID, b = base) => ZE(ch, id, { base: b, edits });
  assert.equal((await e([{ op: "text", was: "Cell A", text: "x" }], "other")).status, 404, "another channel's file is not found");
  assert.equal(R_OTHER.sql.exec("SELECT count(*) n FROM files").one().n, 0);
  assert.equal((await e([{ op: "text", was: "Cell A", text: "x" }], "main", DID, 99)).status, 409, "a stale base");
  assert.equal((await e([{ op: "text", was: "No such words", text: "x" }])).status, 422);
  assert.equal((await e([{ op: "text", was: "Repeat me", text: "x" }])).status, 409);
  assert.equal((await e([{ op: "style", css: { color: "red" } }])).status, 400, "only text changes in a document");
  assert.equal((await e([{ op: "image", mime: "image/png", data: "aaaa" }])).status, 400);
  assert.equal((await e([{ op: "text", was: "Cell A", text: "ok" }, { op: "text", was: "No such words", text: "x" }])).status, 422, "one bad edit stores none");
  assert.deepEqual(bytesOf(DID), DOCX); assert.equal(rowOf(DID).version, base);
  assert.equal((await e(Array.from({ length: 21 }, () => ({ op: "text", was: "Cell A", text: "x" })))).status, 400);
  const old = await upload("Old.doc", "BIN"); assert.equal((await e([{ op: "text", was: "x", text: "y" }], "main", old, 1)).status, 400, "a binary .doc is not edited here"); assert.match((await (await e([{ op: "text", was: "x", text: "y" }], "main", old, 1)).json()).error, /Word document \(\.docx\)/);
  const junk = await upload("Junk.docx", new Uint8Array(5000)); assert.equal((await e([{ op: "text", was: "x", text: "y" }], "main", junk, 1)).status, 415, "bytes that are not a zip");
  const big = await upload("Big.docx", DOCX); R.sql.exec("UPDATE files SET bytes=? WHERE id=?", 26 * 1024 * 1024, big); assert.equal((await e([{ op: "text", was: "Cell A", text: "x" }], "main", big, 1)).status, 413);
  d1.exec("UPDATE tenants SET status='past_due' WHERE id='t1'");
  const ro = await e([{ op: "text", was: "Cell A", text: "x" }]); assert.equal(ro.status, 402, "read-only accounts get the usual refusal");
  d1.exec("UPDATE tenants SET status='active' WHERE id='t1'");
  await countsRight("after refusals");
  ok("route refusals: other channel 404, stale base 409, text not found 422, ambiguous 409, style and image 400, nothing stored on a refusal, .doc 400, not a zip 415, oversize 413, read-only 402");
}
{   // the selection travels
  const z = { file: DID, name: "Resume.docx", kind: "doc", slide: 1, of: 2, slot: null, sel: null, label: "", text: "Led the team of five." };
  const r = replyRef({ role: "zone", text: "Page 1 · Led the team of five.", zone: z });
  assert.equal(r.role, "zone"); assert.deepEqual(r.zone, z, "the file, the page and the paragraph's text are kept");
  assert.equal(replyLine({ role: "zone", text: "x", zone: z }), `(The person has this selected in the canvas: a paragraph on page 1 of 2 of the document "Resume.docx" (Library file ${DID}), now reading "Led the team of five.". Their message is about it.)`);
  assert.match(replyLine({ role: "zone", zone: { ...z, text: "" } }), /page 1 of 2 of the document "Resume\.docx"/);
  assert.equal(replyRef({ role: "zone", text: "", zone: { ...z, text: "" } }).text, "Page 1", "a selection with no text gets a short label");
  assert.equal(replyRef({ role: "zone", text: "x", zone: { ...z, kind: "slides" } })?.zone, undefined, "an unknown kind is dropped");
  assert.equal(replyRef({ role: "zone", text: "x", zone: { ...z, file: "../x" } })?.zone, undefined);
  ok("selection: a document paragraph travels in the reply ref and reads as one plain line");
}
console.log(`zone-docx: ${passed} checks passed`); process.exit(0);
