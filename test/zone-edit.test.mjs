// node --import ./test/stubs/register.mjs test/zone-edit.test.mjs
// Zone A part 2: direct edits of a Library .html file through the REAL Worker route (POST /api/res/<ch>/files/<id>/zone-edit) and a real Resident, plus the pure string transforms in src/zone-edit.js.
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { createHash } from "node:crypto"; import { readFileSync, mkdtempSync, writeFileSync, chmodSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { Resident } from "../src/resident.js";
import { applyEdits, applyOne, locateDoc, asJs, parseHtml, zoneEditsLine, zoneEditsNote } from "../src/zone-edit.js";
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
const upload = async (name, body) => { const b = new TextEncoder().encode(body); const r = await fetchW("https://host.example.test/w/ck1/api/res/main/files", { method: "POST", headers: { ...H, "x-file-name": encodeURIComponent(name), "content-length": String(b.length) }, body: b }); assert.equal(r.status, 200); return (await r.json()).id; };
const preview = (id, q = "", h = {}) => fetchW(`https://host.example.test/w/ck1/api/res/main/files/${id}/preview${q}`, { headers: { ...H, ...h } });
const libFiles = async () => (await (await fetchW("https://host.example.test/w/ck1/api/res/main/files", { headers: H })).json()).files;
const countsRight = async (what) => { const c = await recount(env, "t1"); assert.equal(c.drift, 0, `${what}: the storage counter matches a recount`); };
let passed = 0; const ok = (name) => { passed++; console.log("  ok", name); };
const ZE = (ch, id, body, h = {}) => { const raw = typeof body === "string" ? body : JSON.stringify(body); return fetchW(`https://host.example.test/w/ck1/api/res/${ch}/files/${id}/zone-edit`, { method: "POST", headers: { ...H, "content-type": "application/json", "content-length": String(new TextEncoder().encode(raw).length), ...h }, body: raw }); };
const bytesOf = (id) => new TextDecoder().decode(R2.get(R.sql.exec("SELECT r2key FROM files WHERE id=?", id).one().r2key).bytes);
const rowOf = (id) => R.sql.exec("SELECT * FROM files WHERE id=?", id).one();
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const slides = '<div class="slide" data-hc-slide="0" style="background:#111"><h2 data-slot="title" style="color:red;font-family:&quot;Space Grotesk&quot;, sans-serif">Q3 plan</h2><p data-slot="body">Line one<br>Line two</p><div data-slot="media" style="border:2px dashed #999;width:300px;height:200px"></div><p data-slot="mixed">Hello <b>big</b> world</p></div><div class="slide" data-hc-slide="1"><h2 data-slot="title">Second</h2><ul><li>a<li>b</ul></div>';
const shellSrc = readFileSync(new URL("../src/skills/artifacts/scripts/deck_shell.html", import.meta.url), "utf8");
const DOC = `<!doctype html><html><head><style>.slide{color:#000}</style></head><body>${slides}<!-- </div> --></body></html>`;
const SHELL = shellSrc.replace("__TITLE__", () => "Q3 plan").replace("__NOTES__", () => asJs(["n1", "n2"])).replace("__DOC__", () => asJs(DOC));
const PAGE = '<!doctype html><html><head><title>T</title><script>var a = "<div>";</script></head><body><main><h1>Hi</h1><p>one &amp; two</p><section><p>x</p><p>y</p></section></main></body></html>';
const docOf = (t) => locateDoc(t).doc;

{   // pure transforms
  assert.equal(applyEdits(SHELL, []).text, SHELL, "no edits: the same bytes");
  const r = applyEdits(SHELL, [{ op: "text", slide: 1, slot: "title", text: "Q4 <plan> & more" }]);
  const d = docOf(r.text);
  assert.ok(d.includes('data-slot="title" style="color:red;font-family:&quot;Space Grotesk&quot;, sans-serif">Q4 &lt;plan&gt; &amp; more</h2>'), d.slice(0, 400));
  assert.equal(r.text.slice(0, locateDoc(r.text).start), SHELL.slice(0, locateDoc(SHELL).start), "the shell before the document is byte-identical");
  assert.equal(r.text.slice(locateDoc(r.text).end), SHELL.slice(locateDoc(SHELL).end), "and after it");
  assert.equal(d.replace("Q4 &lt;plan&gt; &amp; more", "Q3 plan"), DOC, "only the edited text changed inside the document");
  assert.deepEqual(r.recs, [{ slide: 1, slot: "title", op: "text", was: "Q3 plan", now: "Q4 <plan> & more" }]);
  const nl = docOf(applyEdits(SHELL, [{ op: "text", slide: 1, slot: "body", text: "A\nB\nC" }]).text); assert.ok(nl.includes('data-slot="body">A<br>B<br>C</p>'));
  assert.throws(() => applyEdits(SHELL, [{ op: "text", slide: 1, slot: "mixed", text: "x" }]), (e) => e.status === 400);
  assert.throws(() => applyEdits(SHELL, [{ op: "text", slide: 1, sel: "3", text: "x" }]), (e) => e.status === 400 && e.message === "This element has mixed content; ask the helper to change it.");
  // one text run among elements: only that run changes
  const one = docOf(applyEdits(SHELL, [{ op: "text", slide: 1, slot: "title", text: "T" }]).text); assert.ok(one.includes(">T</h2>"));
  assert.ok(!docOf(applyEdits(`var DOC = ${asJs('<div data-hc-slide="0"><p data-slot="a">one <i>two</i></p></div>')};`, [{ op: "text", slide: 1, slot: "a", text: "uno" }]).text).includes("one"), "a single text run is replaced");
  const by = docOf(applyEdits(SHELL, [{ op: "text", slide: 2, sel: "0", text: "Zwei" }]).text); assert.ok(by.includes('data-slot="title">Zwei</h2>'), "deck path from the slide root");
  // style and bg
  const st = applyEdits(SHELL, [{ op: "style", slide: 1, slot: "title", css: { color: "#0af", "font-size": "48px", "text-align": "center" } }, { op: "bg", slide: 1, value: "rgb(10, 20, 30)" }, { op: "bg", slide: 2, value: "navy" }]);
  const sd = docOf(st.text);
  assert.ok(sd.includes('style="color:#0af;font-family:&quot;Space Grotesk&quot;, sans-serif;font-size:48px;text-align:center"'), "merged into the existing style, entities kept: " + sd.slice(0, 500));
  assert.ok(sd.includes('data-hc-slide="0" style="background:rgb(10, 20, 30)"') && sd.includes('data-hc-slide="1" style="background:navy"'));
  for (const bad of [{ color: "url(x)" }, { color: "red;x:y" }, { "font-family": "x" }, { width: "5px}" }, { color: "a".repeat(70) }, { opacity: "2" }, { "font-size": "calc(1px)" }]) assert.throws(() => applyEdits(SHELL, [{ op: "style", slide: 1, slot: "title", css: bad }]), (e) => e.status === 400, JSON.stringify(bad));
  assert.throws(() => applyEdits(SHELL, [{ op: "bg", slide: 1, value: "url(javascript:1)" }]), (e) => e.status === 400);
  // image into the empty box
  const im = docOf(applyEdits(SHELL, [{ op: "image", slide: 1, slot: "media", mime: "image/png", data: PNG }]).text);
  assert.ok(im.includes(`<div data-slot="media" style="border:0;width:300px;height:200px"><img src="data:image/png;base64,${PNG}" alt="" style="width:100%;height:100%;object-fit:cover;display:block"></div>`), im.slice(im.indexOf("data-slot=\"media\"") - 10, im.indexOf("data-slot=\"media\"") + 300));
  const im2 = applyEdits(`var DOC = ${asJs('<div data-hc-slide="0"><img data-slot="media" src="a.png" srcset="b.png 2x"></div>')};`, [{ op: "image", slide: 1, slot: "media", mime: "image/png", data: PNG }]);
  assert.ok(docOf(im2.text).includes(`src="data:image/png;base64,${PNG}"`) && !docOf(im2.text).includes("srcset"));
  assert.throws(() => applyEdits(SHELL, [{ op: "image", slide: 1, slot: "media", mime: "image/svg+xml", data: PNG }]), (e) => e.status === 415);
  assert.throws(() => applyEdits(SHELL, [{ op: "image", slide: 1, slot: "media", mime: "image/jpeg", data: PNG }]), (e) => e.status === 415, "magic bytes must match");
  assert.throws(() => applyEdits(SHELL, [{ op: "image", slide: 1, slot: "media", mime: "image/png", data: "not base64!" }]), (e) => e.status === 400);
  assert.throws(() => applyEdits(SHELL, [{ op: "image", slide: 1, slot: "media", mime: "image/png", data: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(4 * 1024 * 1024)]).toString("base64") }]), (e) => e.status === 413);
  // missing things
  assert.throws(() => applyEdits(SHELL, [{ op: "text", slide: 9, slot: "title", text: "x" }]), (e) => e.status === 400);
  assert.throws(() => applyEdits(SHELL, [{ op: "text", slide: 1, slot: "nope", text: "x" }]), (e) => e.status === 400);
  assert.throws(() => applyEdits(SHELL, [{ op: "text", slide: 1, sel: "9/9", text: "x" }]), (e) => e.status === 400);
  assert.throws(() => applyEdits(SHELL, [{ op: "text", slide: 1, text: "x" }]), (e) => e.status === 400);
  // plain page by element path (from <body>), and tokenizer facts
  const pg = applyEdits(PAGE, [{ op: "text", slide: null, sel: "0/1", text: "three < four" }, { op: "text", slide: null, sel: "0/2/1", text: "Y" }, { op: "bg", slide: null, value: "#eee" }]);
  assert.ok(pg.text.includes("<p>three &lt; four</p>") && pg.text.includes("<p>x</p><p>Y</p>") && pg.text.includes('<body style="background:#eee">') && pg.text.includes('var a = "<div>";'), pg.text);
  const t = parseHtml("<ul><li>a<li>b</ul><p>x<p>y<br/><img src='a>b'><!-- <p> --><script>if(a<b){}</script>");
  assert.deepEqual(t.root.kids.map((k) => k.tag), ["ul", "p", "p"]); assert.equal(t.root.kids[0].kids.length, 2, "an unclosed li ends at the next li");
  assert.deepEqual(t.root.kids[2].kids.map((k) => k.tag), ["br", "img", "script"]);
  ok("pure transforms: text (escape, br, one run, mixed refused), style merge and whitelist, bg, image (magic bytes, size), page paths, tokenizer, DOC round trip leaves other bytes identical");
}

let DECK, PG;
{   // through the route: a new version, the old one kept as previous, the record
  DECK = await upload("Q3 plan.html", SHELL); PG = await upload("page.html", PAGE);
  const v1 = rowOf(DECK), k1 = v1.r2key; assert.equal(v1.version, 1);
  const r = await ZE("main", DECK, { base: 1, edits: [{ op: "text", slide: 1, slot: "title", text: "Q4 plan" }, { op: "image", slide: 1, slot: "media", mime: "image/png", data: PNG }, { op: "style", slide: 1, slot: "title", css: { color: "#fff" } }, { op: "bg", slide: 2, value: "#222" }] });
  assert.equal(r.status, 200, await r.clone().text()); const b = await r.json();
  assert.equal(b.ok, true); assert.equal(b.applied, 4); assert.equal(b.file.version, 2); assert.equal(b.file.id, DECK); assert.equal(b.file.name, "Q3 plan.html");
  const row = rowOf(DECK); assert.equal(row.version, 2); assert.equal(row.prev_key, k1, "the old version is kept as previous"); assert.match(row.r2key, new RegExp(`^t/t1/files/main/${DECK}\\.v2$`));
  assert.equal(new TextDecoder().decode(R2.get(k1).bytes), SHELL, "the old bytes are untouched");
  const d = docOf(bytesOf(DECK)); assert.ok(d.includes(">Q4 plan</h2>") && d.includes("data:image/png;base64,") && d.includes("color:#fff") && d.includes('data-hc-slide="1" style="background:#222"'));
  assert.equal(row.synced, 0, "the next file sync puts the bytes on the computer");
  const rec = JSON.parse(R.getRaw(`zone_edits:${DECK}`)); assert.equal(rec.v, 2); assert.equal(rec.edits.length, 4); assert.deepEqual(rec.edits[0], { slide: 1, slot: "title", op: "text", was: "Q3 plan", now: "Q4 plan" });
  const line = zoneEditsLine(R, DECK); assert.match(line, /^\(Since the deck was built, the person edited it by hand in the canvas, in "Q3 plan\.html" \(Library file .*\): slide 1 title "Q3 plan" is now "Q4 plan", .*not in the deck's \.src folder; keep them when you rebuild\.\)$/);
  assert.equal(zoneEditsNote(R, DECK), line);
  const again = await ZE("main", DECK, { base: 2, edits: [{ op: "text", slide: 1, slot: "body", text: "Hello" }] }); assert.equal((await again.json()).file.version, 3);
  assert.equal(JSON.parse(R.getRaw(`zone_edits:${DECK}`)).edits.length, 5, "the record keeps adding while the version is the one the last edit made");
  // a helper rebuild makes a newer version: the line is skipped
  const nk = `t/t1/files/main/${DECK}.v4`; await stPut(env, nk, SHELL, {}, { size: SHELL.length }); await R.putVersion(rowOf(DECK), { key: nk, bytes: SHELL.length, synced: 1 });
  assert.equal(zoneEditsLine(R, DECK), "", "the file moved on, so the line is skipped");
  const after = await ZE("main", DECK, { base: 4, edits: [{ op: "text", slide: 1, slot: "title", text: "Z" }] }); assert.equal(after.status, 200);
  assert.equal(JSON.parse(R.getRaw(`zone_edits:${DECK}`)).edits.length, 1, "a record of edits older than the rebuild is not carried over");
  await countsRight("after edits");
  ok("route: a deck edit stores a new version (old kept as previous, bytes untouched), the record and the helper line, skipped once a rebuild moved the file on");
  const p = await ZE("main", PG, { base: 1, edits: [{ op: "text", slide: null, sel: "0/0", text: "Hello there" }] }); assert.equal(p.status, 200, await p.clone().text());
  assert.ok(bytesOf(PG).includes("<h1>Hello there</h1>") && bytesOf(PG).startsWith("<!doctype html>")); assert.match(zoneEditsLine(R, PG), /^\(Since the page was built, the person edited it by hand/);
  ok("route: a plain page edited by element path");
}
{   // refusals
  const other = await upload("other.html", PAGE); const ST = rowOf(other);   // same channel; the other channel does not have it
  assert.equal((await ZE("other", other, { base: 1, edits: [{ op: "text", slide: null, sel: "0/0", text: "x" }] })).status, 404, "another channel's file id is not found");
  assert.equal(R_OTHER.sql.exec("SELECT count(*) n FROM files").one().n, 0); assert.equal(rowOf(other).version, 1);
  assert.equal((await ZE("main", "11111111-1111-4111-8111-111111111111", { base: 1, edits: [{ op: "text", slide: null, sel: "0", text: "x" }] })).status, 404);
  const stale = await ZE("main", other, { base: 7, edits: [{ op: "text", slide: null, sel: "0/0", text: "x" }] }); assert.equal(stale.status, 409); const sb = await stale.json();
  assert.equal(sb.version, 1); assert.equal(sb.error, "The file changed since you opened it."); assert.equal(rowOf(other).version, 1, "nothing was stored");
  const pdf = await upload("report.pdf", "%PDF-1.4 x"); assert.equal((await ZE("main", pdf, { base: 1, edits: [{ op: "text", slide: 1, sel: "0", text: "x" }] })).status, 400);
  const png = await upload("pic.png", "x"); assert.equal((await ZE("main", png, { base: 1, edits: [{ op: "text", slide: null, sel: "0", text: "x" }] })).status, 400);
  const e = (edits) => ZE("main", other, { base: 1, edits });
  assert.equal((await e([{ op: "style", slide: null, sel: "0", css: { color: "url(http://x)" } }])).status, 400);
  assert.equal((await e([{ op: "image", slide: null, sel: "0", mime: "image/svg+xml", data: PNG }])).status, 415);
  assert.equal((await e([{ op: "image", slide: null, sel: "0", mime: "image/jpeg", data: PNG }])).status, 415);
  assert.equal((await e([])).status, 400); assert.equal((await e(Array.from({ length: 21 }, () => ({ op: "text", slide: null, sel: "0", text: "x" })))).status, 400);
  assert.equal((await e([{ op: "text", slide: null, sel: "0/1/0", text: "x" }, { op: "text", slide: null, sel: "9", text: "x" }])).status, 400, "one bad edit stores none");
  assert.equal(rowOf(other).version, 1);
  const big = await ZE("main", other, "x".repeat(6.1e6)); assert.equal(big.status, 413);
  assert.equal((await ZE("main", other, "{nope")).status, 400);
  assert.equal((await fetchW(`https://host.example.test/w/ck1/api/res/main/files/${other}/zone-edit`, { headers: H })).status, 405, "GET is refused");
  const mixed = await ZE("main", DECK, { base: rowOf(DECK).version, edits: [{ op: "text", slide: 1, slot: "mixed", text: "x" }] }); assert.equal(mixed.status, 400, "two text runs around an element are refused"); assert.match((await mixed.json()).error, /^This element has mixed content; ask the helper to change it\.$/);
  const mixed2 = await ZE("main", PG, { base: rowOf(PG).version, edits: [{ op: "text", slide: null, sel: "0", text: "x" }] }); assert.equal(mixed2.status, 400); assert.match((await mixed2.json()).error, /mixed content; ask the helper to change it\./);
  d1.exec("UPDATE tenants SET status='past_due' WHERE id='t1'");
  const ro = await ZE("main", other, { base: 1, edits: [{ op: "text", slide: null, sel: "0/0", text: "x" }] }); assert.equal(ro.status, 402, "read-only accounts get the usual refusal"); assert.equal((await ro.json()).error, "payment_required");
  d1.exec("UPDATE tenants SET status='active' WHERE id='t1'");
  ok("route refusals: other channel 404, wrong base 409, PDF and image 400, url() 400, bad image 415, counts 400, size 413, mixed content 400, read-only 402; nothing stored on a refusal");
}
{   // restore the previous version
  const id = await upload("restore.html", PAGE); const before = rowOf(id);
  assert.equal((await ZE("main", id, { base: 1, restore: "previous" })).status, 400, "no earlier version kept");
  const bad = await ZE("main", id, { base: 1, restore: "previous" }); assert.equal((await bad.json()).error, "no earlier version kept");
  const info0 = await (await fetchW(`https://host.example.test/w/ck1/api/res/main/files/${id}/zone-info`, { headers: H })).json(); assert.deepEqual({ version: info0.version, has_previous: info0.has_previous }, { version: 1, has_previous: false });
  await ZE("main", id, { base: 1, edits: [{ op: "text", slide: null, sel: "0/0", text: "Edited" }] });
  const info1 = await (await fetchW(`https://host.example.test/w/ck1/api/res/main/files/${id}/zone-info`, { headers: H })).json(); assert.equal(info1.version, 2); assert.equal(info1.has_previous, true); assert.ok(info1.previous_at === null || typeof info1.previous_at === "number");
  const edited = rowOf(id);
  const r = await ZE("main", id, { base: 2, restore: "previous" }); assert.equal(r.status, 200, await r.clone().text()); const b = await r.json();
  assert.equal(b.ok, true); assert.equal(b.restored, true); assert.equal(b.file.version, 3, "a restore counts as a new version whose bytes are the earlier ones");
  const row = rowOf(id); assert.equal(row.r2key, before.r2key); assert.equal(row.prev_key, edited.r2key, "the version it replaced is kept; restore again swaps back"); assert.equal(row.synced, 0);
  assert.equal(bytesOf(id), PAGE);
  assert.equal(zoneEditsLine(R, id), "", "the earlier bytes carry none of the by-hand edits");
  assert.equal((await ZE("main", id, { base: 2, restore: "previous" })).status, 409, "stale base");
  const back = await ZE("main", id, { base: 3, restore: "previous" }); assert.equal((await back.json()).file.version, 4); assert.ok(bytesOf(id).includes("<h1>Edited</h1>"), "swaps back");
  const nextEdit = await ZE("main", id, { base: 4, edits: [{ op: "text", slide: null, sel: "0/0", text: "Again" }] }); assert.equal(nextEdit.status, 200, "a later edit works after a restore");
  assert.equal((await ZE("other", id, { base: 5, restore: "previous" })).status, 404, "another channel's file");
  assert.equal((await ZE("main", id, { base: 5, restore: "oldest" })).status, 400);
  await countsRight("after restore");
  ok("restore: swaps current and previous as a new version, 409 on a stale base, 400 with no earlier version, 404 in another channel, zone-info reports has_previous");
}
console.log(`zone-edit: ${passed} checks passed`); process.exit(0);
