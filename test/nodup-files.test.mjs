// node --import ./test/stubs/register.mjs test/nodup-files.test.mjs
// EDITS/CHANGES TO FILES IN A CHAT DO NOT DUPLICATE (routing design section 9, src/file-versions.js). Real Worker routes, real Residents on
// node:sqlite, D1 on node:sqlite, a fake R2, a fake channel computer (with a downloads folder). For each of the four paths that made
// "name (2)" before: (1) editing a file the person uploaded, (2) rebuilding in another task or folder, (3) re-sharing an edit under a new
// name, (4) a browser download or an app file fetched again: no second visible Library row, the same id and name, the share link and the
// published page unchanged (the page updated at the same URL), and the person's original still restorable after several edits. Also: two
// channels never match; copy: true still copies; a " (N)" suffix is ignored by the name fallback; the tool results name the file and the
// versions kept; deleting the file removes the kept original; the storage counter equals a recount after every step.
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { createHash } from "node:crypto"; import { readFileSync } from "node:fs";
import { Resident } from "../src/resident.js";
import { stPut, recount } from "../src/storage.js";
const { default: worker } = await import("../src/index.js");

const sqlOf = (db) => ({ exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
  const st = db.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } });

// ---- D1 ----
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

// ---- fake R2 (sizes in list, so the recount works) ----
const R2 = new Map(); let etagN = 0;
const toBytes = async (v) => v == null ? new Uint8Array(0) : typeof v === "string" ? new TextEncoder().encode(v) : v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(await new Response(v).arrayBuffer());
const obj = (key, o, body) => ({ key, size: o.bytes.length, httpEtag: `"${o.etag}"`, etag: o.etag, httpMetadata: o.meta || {}, ...(body ? { body: new Response(body).body, arrayBuffer: async () => body.slice().buffer, text: async () => new TextDecoder().decode(body) } : {}) });
const WS = {
  async put(key, v, opts = {}) { const bytes = await toBytes(v); R2.set(key, { bytes, etag: `e${++etagN}`, meta: opts.httpMetadata }); return { size: bytes.length }; },
  async head(key) { const o = R2.get(key); return o ? obj(key, o) : null; },
  async get(key) { const o = R2.get(key); return o ? obj(key, o, o.bytes) : null; },
  async delete(keys) { for (const k of [].concat(keys)) R2.delete(k); },
  async list({ prefix = "", limit = 1000 } = {}) { const ks = [...R2.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, limit); return { objects: ks.map((k) => ({ key: k, size: R2.get(k).bytes.length })), truncated: false }; },
};
const r2Under = (p) => [...R2.keys()].filter((k) => k.startsWith(p));

// ---- fake channel computer: an in-memory /workspace; fileToR2 writes through storage.js like the real one ----
const FS = new Map();
const unq = (s) => s.replace(/^'|'$/g, "").replace(/'\\''/g, "'");
const computer = {
  async exec(cmd) {
    let m = cmd.match(/^stat -L -c '%F' -- ('(?:[^']|'\\'')*')$/);
    if (m) { const p = unq(m[1]); if (FS.has(p)) return { code: 0, out: "regular file\n" }; if ([...FS.keys()].some((k) => k.startsWith(p + "/"))) return { code: 0, out: "directory\n" }; return { code: 1, out: "stat: cannot stat" }; }
    m = cmd.match(/^cd -- ('(?:[^']|'\\'')*') && test -f index\.html && find .* \| head -n (\d+)$/);
    if (m) { const d = unq(m[1]), pre = d === "." ? "" : d + "/"; if (!FS.has(pre + "index.html")) return { code: 1, out: "" };
      const rows = [...FS.keys()].filter((k) => k.startsWith(pre)).map((k) => k.slice(pre.length)).sort();
      return { code: 0, out: rows.slice(0, Number(m[2])).map((r) => `${FS.get(pre + r).length}\t${r}`).join("\n") + "\n" }; }
    return { code: 127, out: "unexpected command" };
  },
  async listDownloads() { return { done: DL.map(([n, b]) => ({ name: n, bytes: b.length })), partial: [] }; },
  async takeDownload(name, to) { const i = DL.findIndex((d) => d[0] === name); if (i >= 0) DL.splice(i, 1); FS.delete(`files/downloads/${name}`); return { ok: false }; },
  async fileToR2(path, key, max) { const b = FS.get(path); if (!b) return { ok: false, error: `no such file: ${path}` }; if (b.length > max) return { ok: false, error: "too big" }; await stPut(env, key, b, {}, { size: b.length }); return { ok: true, bytes: b.length }; },
};
const DL = [];
const put = (p, s) => FS.set(p, new TextEncoder().encode(s));

// ---- env ----
const dos = new Map();
const env = { DB, WS, VAULT_KEY: Buffer.from(Array.from({ length: 32 }, (_, i) => i + 3)).toString("base64"), APP_HOST: "selfhost.example", GATEWAY_HOST: "selfhost.example", ENV_NAME: "dev", MODEL: "@cf/test/model", MEMORY: "off", GENUI: "off", WORKMEM: "off", TEST_MODE: "1",
  RESIDENT: { idFromName: (n) => n, get: (n) => { if (!dos.has(n)) { const db = new DatabaseSync(":memory:"); const R = new Resident({ storage: { sql: sqlOf(db), getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {} }, waitUntil: () => {} }, env);
    R.systemPrompt = async () => "SYSTEM"; R.computer = () => computer; R.syncFiles = async () => {};
    const [, tid, slug] = n.split(":"); R.bind(tid, slug, "1", "America/Los_Angeles"); dos.set(n, R); } return dos.get(n); } },
  ARCHIVE: { idFromName: (n) => n, get: () => ({ channels: async () => [{ id: 1, slug: "main", name: "General" }] }) },
  LEDGER: { idFromName: (n) => n, get: () => new Proxy({}, { get: (_, k) => k === "then" ? undefined : k === "state" ? async () => ({ balance_nano: 1e12, spent_nano: 0, granted_nano: 1e12 }) : async () => ({ ok: true }) }) },
};
const R = env.RESIDENT.get("res:t1:main");
const fetchW = (url, init = {}) => worker.fetch(new Request(url, init), env, { waitUntil() {} });
const api = async (path, body) => { const r = await fetchW(`https://selfhost.example/w/ck1/api${path}`, { method: body === undefined ? "GET" : "POST", headers: { cookie: "hc_session=aa11", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };
const text = async (url) => { const r = await fetchW(url); return { status: r.status, body: await r.text() }; };
const S = (await R.createSession("Make my page")).id;
const events = [];
const toolIn = (session, name, args) => R.runTool({ function: { name, arguments: JSON.stringify(args) } }, { kind: "chat", session, turn: crypto.randomUUID(), emit: (e) => events.push(e) });
const tool = (name, args) => R.runTool({ function: { name, arguments: JSON.stringify(args) } }, { kind: "chat", session: S, turn: crypto.randomUUID(), emit: (e) => events.push(e) });
const libFiles = async () => { const b = (await api("/res/main/files")).body; return Array.isArray(b) ? b : b.files; };
const fileBytes = async (id) => (await fetchW(`https://selfhost.example/w/ck1/api/res/main/files/${id}`, { headers: { cookie: "hc_session=aa11" } })).text();
const counter = () => Object.fromEntries(d1.prepare("SELECT kind, bytes, objects FROM storage_usage WHERE tenant_id='t1'").all().map((r) => [r.kind, [r.bytes, r.objects]]));
const countsRight = async (what) => { const before = counter(); const c = await recount(env, "t1"); assert.equal(c.drift, 0, `${what}: the counter matches a recount (${JSON.stringify(before)})`); };
let passed = 0; const ok = (name) => { passed++; console.log("  ok", name); };

const rowsOf = (R2_ = R) => R2_.sql.exec("SELECT * FROM files WHERE deleted=0 AND pending=0").toArray();
const upload = async (name, content, Res = R) => { const id = crypto.randomUUID(), key = `t/t1/files/${Res === R ? "main" : "other"}/${id}`; await stPut(env, key, content); const v = await Res.addUpload("t1", Res === R ? "main" : "other", "1", { id, name, mime: "text/plain", bytes: content.length, r2key: key }); return v.id; };
const enc = (s) => new TextEncoder().encode(s);
const sid = async (t) => (await R.createSession(t)).id;
const regex = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

// ---- path 1: editing a file the person uploaded (a web page with a published page and a share link, and a Word file) ----
let IDX, PAGE1, LINK1;
{
  const S1 = await sid("Make my page better");
  IDX = await upload("index.html", "<title>Mine</title>ORIGINAL index");
  const p = await api("/share/pages", { channel: "main", file: IDX }); assert.equal(p.status, 200, JSON.stringify(p.body)); PAGE1 = p.body.page.url;
  const l = await api("/share/links", { channel: "main", file: IDX }); assert.equal(l.status, 200); LINK1 = l.body.link.url;
  const DOC = await upload("report.docx", "ORIGINAL report");
  assert.equal((await libFiles()).length, 2);
  // the agent edits the Library copy (files/index.html) and shares it; then asks again with another path and another name each time
  put("files/index.html", "<title>Mine</title>edit 1");
  let out = await toolIn(S1, "share_file", { path: "files/index.html" });
  assert.match(out, /^Updated "index\.html" in place .*version 2.*Versions kept: version 2 \(current\), the version before it \(which is also the person's original\)/, out);
  assert.match(out, /Library file "index\.html" \(id /); assert.match(out, /"original": true/);
  put("workspace/site/v2.html", "<title>Mine</title>edit 2");
  assert.match(await toolIn(S1, "share_file", { path: "workspace/site/v2.html", name: "index v2.html" }), /^Updated "index\.html" in place/);   // same task, other path, other name: the saved path link from edit 1 is gone, the name is alike
  for (let i = 3; i <= 6; i++) { put("workspace/site/v2.html", `<title>Mine</title>edit ${i}`); assert.match(await toolIn(S1, "share_file", { path: "workspace/site/v2.html" }), /^Updated "index\.html" in place/); }
  const files = await libFiles(); assert.equal(files.length, 2, "no second visible row after six edits"); assert.ok(!files.some((f) => /\(\d\)/.test(f.name)));
  const f = files.find((x) => x.id === IDX); assert.equal(f.name, "index.html"); assert.equal(f.version, 7);
  assert.match((await text(PAGE1)).body, /edit 6/, "the published page shows the edit at the same URL"); assert.equal((await text(LINK1)).body, "<title>Mine</title>edit 6", "the share link serves the edit");
  assert.equal(d1.prepare("SELECT COUNT(*) n FROM published_pages").get().n, 1); assert.equal(d1.prepare("SELECT COUNT(*) n FROM share_links").get().n, 1);
  await countsRight("after six edits of an upload");
  // the person's original is still there, however many edits were made
  const row = R.sql.exec("SELECT * FROM files WHERE id=?", IDX).one(); assert.ok(row.orig_key && row.orig_key !== row.r2key && row.orig_key !== row.prev_key, "the original is neither current nor the one before it");
  assert.equal(new TextDecoder().decode(R2.get(row.orig_key).bytes), "<title>Mine</title>ORIGINAL index");
  out = await toolIn(S1, "share_file", { restore: "index.html", original: true });
  assert.match(out, /^Put back the person's original upload of "index\.html"/, out); assert.match(out, /Versions kept: version 7 \(current\), the version before it/);
  assert.equal(await fileBytes(IDX), "<title>Mine</title>ORIGINAL index"); assert.match((await text(PAGE1)).body, /ORIGINAL index/); assert.equal((await text(LINK1)).body, "<title>Mine</title>ORIGINAL index");
  assert.match(await toolIn(S1, "share_file", { restore: "index.html", original: true }), /^error: .* already the person's original/);
  // editing again after the restore keeps the original too
  put("workspace/site/v2.html", "<title>Mine</title>edit 7"); assert.match(await toolIn(S1, "share_file", { path: "workspace/site/v2.html" }), /^Updated "index\.html" in place/);
  assert.equal(await toolIn(S1, "share_file", { restore: "index.html", original: true }).then(() => fileBytes(IDX)), "<title>Mine</title>ORIGINAL index");
  assert.equal((await libFiles()).length, 2); await countsRight("after restoring the original");
  // report.docx: the same, from the Library copy, edited many times
  for (let i = 1; i <= 4; i++) { put("files/report.docx", `report edit ${i}`); assert.match(await toolIn(S1, "share_file", { path: "files/report.docx" }), /^Updated "report\.docx" in place/); }
  assert.equal((await libFiles()).length, 2); await tool("share_file", { restore: "report.docx", original: true }); assert.equal(await fileBytes(DOC), "ORIGINAL report");
  await countsRight("docx");
  ok("path 1: editing a file the person uploaded updates it in place (no second row, same page and link), and the original is restorable after many edits");
}

// ---- path 2: rebuilt in another task and another folder ----
{
  const A = await sid("Build a notes page"), B = await sid("Change the notes page");
  put("workspace/a/notes-site/index.html", "<p>site v1</p>"); assert.match(await toolIn(A, "share_file", { path: "workspace/a/notes-site/index.html", name: "site.html" }), /^Shared "site\.html"/);
  const n0 = (await libFiles()).length, s = (await libFiles()).find((x) => x.name === "site.html");
  const p = await api("/share/pages", { channel: "main", file: s.id }); assert.equal(p.status, 200); const page = p.body.page.url, l = await api("/share/links", { channel: "main", file: s.id }); const link = l.body.link.url;
  put("workspace/b/rebuild/index.html", "<p>site v2</p>");   // another task, another folder, same name
  const out = await toolIn(B, "share_file", { path: "workspace/b/rebuild/index.html", name: "site.html" });
  assert.match(out, /^Updated "site\.html" in place/, out); assert.match(out, /it has the same name/);
  assert.equal((await libFiles()).length, n0); assert.match((await text(page)).body, /site v2/); assert.equal((await text(link)).body, "<p>site v2</p>");
  // a " (N)" suffix on either side counts as the same name
  const up = await upload("budget (2).xlsx", "ORIGINAL budget"); put("workspace/c/budget.xlsx", "budget v2");
  assert.match(await toolIn(B, "share_file", { path: "workspace/c/budget.xlsx" }), /^Updated "budget \(2\)\.xlsx" in place/);
  assert.equal(await fileBytes(up), "budget v2"); assert.equal((await libFiles()).length, n0 + 1);
  // copy: true still adds a file
  assert.match(await toolIn(B, "share_file", { path: "workspace/c/budget.xlsx", copy: true }), /^Shared "budget\.xlsx"/); assert.equal((await libFiles()).length, n0 + 2);
  await countsRight("path 2");
  ok("path 2: rebuilt in another task and folder under the same name (or with a (N) suffix) updates in place; page and link unchanged; copy: true still copies");
}

// ---- path 3: an edit re-shared under a new name ----
{
  const up = await upload("Kyoto plan.pdf", "ORIGINAL kyoto"), up2 = await upload("Osaka plan.pdf", "ORIGINAL osaka"), n0 = (await libFiles()).length;
  const T = await sid("Update the Kyoto plan");
  // the agent copies the Library file to a work folder (a command that names files/<name>), edits it, and shares it as "Kyoto plan v2.pdf"
  await toolIn(T, "run_command", { command: "cp 'files/Kyoto plan.pdf' workspace/k/work.pdf" });
  assert.deepEqual(R.sql.exec("SELECT file_id FROM file_uses WHERE session=?", T).toArray().map((x) => x.file_id), [up], "the command is recorded as a use of that Library file");
  put("workspace/k/work.pdf", "kyoto edit 1");
  let out = await toolIn(T, "share_file", { path: "workspace/k/work.pdf", name: "Kyoto plan v2.pdf" });
  assert.match(out, /^Updated "Kyoto plan\.pdf" in place/, out); assert.match(out, /you used it in this task and the new file has a similar name/); assert.match(out, /It keeps its name "Kyoto plan\.pdf"/);
  assert.equal((await libFiles()).length, n0); assert.equal(await fileBytes(up), "kyoto edit 1");
  for (let i = 2; i <= 4; i++) { put("workspace/k/work.pdf", `kyoto edit ${i}`); await toolIn(T, "share_file", { path: "workspace/k/work.pdf", name: `Kyoto plan v${i + 1}.pdf` }); }
  assert.equal((await libFiles()).length, n0); await tool("share_file", { restore: "Kyoto plan.pdf", original: true }); assert.equal(await fileBytes(up), "ORIGINAL kyoto");
  // a name that shares its words with the original ("Kyoto trip plan.pdf" from "Kyoto plan.pdf") is an edit; a name nothing like it is not guessed
  const T2 = await sid("Make it final"); await toolIn(T2, "read_file", { path: "/workspace/files/Osaka plan.pdf" }); put("workspace/o/out.pdf", "osaka final");
  assert.match(await toolIn(T2, "share_file", { path: "workspace/o/out.pdf", name: "Osaka trip plan.pdf" }), /^Updated "Osaka plan\.pdf" in place/); assert.equal(await fileBytes(up2), "osaka final");
  put("workspace/o/flyer.pdf", "flyer"); assert.match(await toolIn(T2, "share_file", { path: "workspace/o/flyer.pdf", name: "Itinerary.pdf" }), /^Shared "Itinerary\.pdf"/);   // used a PDF as a template, made a new one: new file
  put("workspace/o/flyer.pdf", "flyer v2"); assert.match(await toolIn(T2, "share_file", { path: "workspace/o/flyer.pdf", name: "Itinerary.pdf", replace: "Osaka plan.pdf" }), /^Updated "Osaka plan\.pdf" in place/);   // replace: names the file when it really is an edit
  const n1 = (await libFiles()).length - 1;
  // two PDFs used and a name like neither: a new file (never a guess between them)
  const T3 = await sid("Combine"); await toolIn(T3, "run_command", { command: "cat 'files/Kyoto plan.pdf' 'files/Osaka plan.pdf'" }); put("workspace/x/combo.pdf", "combined");
  assert.match(await toolIn(T3, "share_file", { path: "workspace/x/combo.pdf", name: "Japan trip.pdf" }), /^Shared "Japan trip\.pdf"/); assert.equal((await libFiles()).length, n1 + 2);
  // a file the agent never used with a new name is a new file
  const T4 = await sid("Another"); put("workspace/y/z.pdf", "unrelated"); assert.match(await toolIn(T4, "share_file", { path: "workspace/y/z.pdf", name: "Tax return.pdf" }), /^Shared "Tax return\.pdf"/); assert.equal((await libFiles()).length, n1 + 3);
  // an attachment counts as evidence too
  const att = await upload("Menu.docx", "ORIGINAL menu"), T5 = await sid("Edit the attachment"); await R.attachParts([att], T5, "turnx"); put("workspace/m/out.docx", "menu edit");
  assert.match(await toolIn(T5, "share_file", { path: "workspace/m/out.docx", name: "Menu final.docx" }), /^Updated "Menu\.docx" in place/);
  await countsRight("path 3");
  ok("path 3: an edit shared under a new name updates the Library file it came from (copied, read or attached); a name unlike the original, ambiguous or unrelated files stay new (replace: names the file)");
}

// ---- path 4: a browser download and an app file fetched again ----
{
  const dl = await upload("data.csv", "ORIGINAL csv"), n0 = (await libFiles()).length, T = await sid("Export from the web app");
  const ev = []; const tc = { session: T, turn: "tt", emit: (e) => ev.push(e) };
  put("files/downloads/data.csv", "csv from the app, edited"); DL.push(["data.csv", enc("csv from the app, edited")]);
  const got = await R.collectDownloads(tc);
  assert.equal(got.files.length, 1); assert.match(got.files[0].said, /new version of the Library file "data\.csv".*updated in place \(version 2\), not a copy.*Versions kept: version 2 \(current\), the version before it \(which is also the person's original\)/);
  assert.equal((await libFiles()).length, n0); assert.equal(await fileBytes(dl), "csv from the app, edited"); assert.ok(ev.some((e) => e.t === "file" && e.file.id === dl));
  for (let i = 2; i <= 4; i++) { put("files/downloads/data.csv", `csv edit ${i}`); DL.push(["data.csv", enc(`csv edit ${i}`)]); await R.collectDownloads(tc); }
  assert.equal((await libFiles()).length, n0); await tool("share_file", { restore: "data.csv", original: true }); assert.equal(await fileBytes(dl), "ORIGINAL csv");
  // a new name still arrives as a new file
  put("files/downloads/other.csv", "fresh"); DL.push(["other.csv", enc("fresh")]); await R.collectDownloads(tc); assert.equal((await libFiles()).length, n0 + 1);
  // an app file (a Drive download, a Sheets export) returned again
  const hp = await upload("Budget.pdf", "ORIGINAL budget pdf");
  const pg = await api("/share/links", { channel: "main", file: hp }); const lk = pg.body.link.url;
  const r = await R.appFileSave({ name: "Budget.pdf", mime: "application/pdf", bytes: enc("budget pdf from the app, edited") }, { session: T, emit: (e) => ev.push(e) });
  assert.ok(r.file.updated, "the result says it updated"); assert.match(r.file.updated, /Versions kept: version 2 \(current\)/); assert.equal(r.file.id, hp);
  for (let i = 2; i <= 4; i++) await R.appFileSave({ name: "Budget.pdf", mime: "application/pdf", bytes: enc(`budget edit ${i}`) }, { session: T });
  assert.equal((await libFiles()).filter((f) => /^Budget/.test(f.name)).length, 1); assert.equal((await text(lk)).body, "budget edit 4", "the share link follows");
  await tool("share_file", { restore: "Budget.pdf", original: true }); assert.equal(await fileBytes(hp), "ORIGINAL budget pdf");
  await countsRight("path 4");
  ok("path 4: a download or an app file fetched again updates in place (share link follows, original restorable); a new name is a new file");
}

// ---- two channels never match ----
{
  const O = env.RESIDENT.get("res:t1:other"); await O.createSession("Other channel");
  const SO = (await O.createSession("x")).id; const idMain = await upload("plan.html", "MAIN plan"), idOther = await upload("plan.html", "OTHER plan", O);
  const before = R.sql.exec("SELECT COUNT(*) n FROM files WHERE deleted=0").one().n;
  put("workspace/p/plan.html", "channel other edit");
  const call = (Res, session, args) => Res.runTool({ function: { name: "share_file", arguments: JSON.stringify(args) } }, { kind: "chat", session, turn: "t", emit: () => {} });
  assert.match(await call(O, SO, { path: "workspace/p/plan.html" }), /^Updated "plan\.html" in place/);
  assert.equal(new TextDecoder().decode(R2.get(O.sql.exec("SELECT r2key FROM files WHERE id=?", idOther).one().r2key).bytes), "channel other edit");
  assert.equal(await fileBytes(idMain), "MAIN plan", "the main channel's file is untouched"); assert.equal(R.sql.exec("SELECT COUNT(*) n FROM files WHERE deleted=0").one().n, before);
  // a name that exists only in the other channel is a new file here, never a match
  put("workspace/p/only-other.html", "x"); assert.match(await call(O, SO, { path: "workspace/p/only-other.html" }), /^Shared/);
  const S1 = await sid("main"); put("workspace/p/only-other.html", "main version");
  assert.match(await toolIn(S1, "share_file", { path: "workspace/p/only-other.html" }), /^Shared "only-other\.html"/);
  assert.equal(O.sql.exec("SELECT COUNT(*) n FROM files WHERE name='only-other.html'").one().n, 1); assert.equal(R.sql.exec("SELECT COUNT(*) n FROM files WHERE name='only-other.html'").one().n, 1);
  // evidence from another channel's task cannot match either
  assert.equal(R.resolveFile({ path: null, name: "plan v2.html", session: SO })?.file?.id === idOther, false);
  ok("two channels never match: the same name and the same task evidence in another channel make a new file");
}

// ---- tradeoff, written down as a test: two unrelated files with the same name merge, and the person's original is kept ----
{
  const keep = await upload("notes.md", "MY OWN NOTES"), A = await sid("Take notes"); put("workspace/n1/notes.md", "agent's unrelated notes");
  assert.match(await toolIn(A, "share_file", { path: "workspace/n1/notes.md" }), /^Updated "notes\.md" in place/);
  assert.equal(await fileBytes(keep), "agent's unrelated notes");   // merged by name
  await tool("share_file", { restore: "notes.md", original: true }); assert.equal(await fileBytes(keep), "MY OWN NOTES");   // and the person's file comes back
  ok("same-name unrelated files merge by name (the documented tradeoff); the person's own original always comes back");
}

// ---- deleting removes every kept version, the original included; the counter stays exact ----
{
  const id = await upload("temp.txt", "ORIGINAL temp"); const T = await sid("temp");
  for (let i = 1; i <= 3; i++) { put("files/temp.txt", `temp ${i}`); await toolIn(T, "share_file", { path: "files/temp.txt" }); }
  assert.equal(r2Under(`t/t1/files/main/${id}`).length, 3, "original, the version before, the current");
  await countsRight("temp before delete");
  const del = await fetchW(`https://selfhost.example/w/ck1/api/res/main/files/${id}/delete`, { method: "POST", headers: { cookie: "hc_session=aa11", "content-type": "application/json" }, body: "{}" });
  assert.equal(del.status, 200); assert.equal(r2Under(`t/t1/files/main/${id}`).length, 0, "all versions and the original are gone"); await countsRight("temp after delete");
  ok("deleting an edited upload deletes its original and every kept version; storage stays exact");
}
// ---- addUpload sent twice (the Worker retries it after a Durable Object reset): one row, same id and name, still a draft ----
{
  const id = crypto.randomUUID(), key = `t/t1/files/main/${id}`; await stPut(env, key, "retry body");
  const f = { id, name: "retry.txt", mime: "text/plain", bytes: 10, r2key: key, pending: true };
  const a = await R.addUpload("t1", "main", "1", f), b = await R.addUpload("t1", "main", "1", f);
  assert.equal(a.id, id); assert.equal(b.id, id); assert.equal(b.name, "retry.txt", "the retry does not become 'retry (2).txt'"); assert.equal(b.pending, true);
  assert.equal(R.sql.exec("SELECT COUNT(*) n FROM files WHERE id=?", id).one().n, 1, "one row");
  assert.equal(R.sql.exec("SELECT pending FROM files WHERE id=?", id).one().pending, 1);
  ok("addUpload is safe to send again: one row, same name, still a draft");
}
console.log(`nodup-files: ${passed} checks passed`);
