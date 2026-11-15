// node --import ./test/stubs/register.mjs test/iterate-in-place.test.mjs
// ITERATING ON A PUBLISHED FILE EDITS THAT SAME LIBRARY FILE (src/file-versions.js resolveFile + putVersion).
// The Horse Tinder failure: round 1 of a routed helper made horse-tinder.html and the person published it; the next round, in the same task,
// made horse-tinder-v2.html from another work folder, and it became a second Library file. Real Worker routes and Residents on node:sqlite,
// a fake R2 and a fake computer, as in nodup-files.test.mjs. Checks: approving a routed helper's -v2 output in the same task updates the
// same id, name, share link and published page (version 2, no second row); the same through share_file; evidence from a command that
// names a loose copy; and explicit copies (copy: true, copy_new) still make a new file.
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
import { stageRoutingFile, collectRoutingFiles, approveRoutingFiles } from "../src/ee/routing-artifacts.js";

const helperRound = async (task, id, round, files, opts = {}) => {
  const h = { id, session: task, round, status: "awaiting_review", dynamic_routing: 1 };
  const held = [];
  for (const [name, content, extra] of files) { put(`workspace/helpers/${id}/${name}`, content); held.push(await stageRoutingFile(R, h, { path: `/workspace/workspace/helpers/${id}/${name}`, ...(extra || {}) })); }
  await collectRoutingFiles(R, h, {});
  const tc = { session: task, turn: crypto.randomUUID(), routingReviewHelper: id, emit: (e) => events.push(e) };
  return approveRoutingFiles(R, h, held.map((f) => f.id), tc);
};
const visible = async () => (await libFiles()).filter((f) => /horse|tinder/i.test(f.name));

// ---- 1. routed helpers, same task: horse-tinder.html then horse-tinder-v2.html ----
{
  const T = await sid("Make a horse tinder page");
  const r1 = await helperRound(T, 25, 1, [["horse-tinder.html", "<title>Horse Tinder</title>v1"]]);
  assert.equal(r1.attached.length, 1); const ID = r1.attached[0].id; assert.equal(r1.attached[0].name, "horse-tinder.html");
  const p = await api("/share/pages", { channel: "main", file: ID }); assert.equal(p.status, 200, JSON.stringify(p.body)); const page = p.body.page.url;
  const l = await api("/share/links", { channel: "main", file: ID }); assert.equal(l.status, 200); const link = l.body.link.url;
  // the helper also left a loose copy outside the Library; nothing records it
  put("horse-tinder.html", "<title>Horse Tinder</title>v1");
  const r2 = await helperRound(T, 26, 1, [["horse-tinder-v2.html", "<title>Horse Tinder</title>v2 much better design"]]);
  assert.equal(r2.attached.length, 1); assert.equal(r2.attached[0].id, ID, "the same Library file"); assert.equal(r2.attached[0].name, "horse-tinder.html", "the same name");
  const rows = await visible(); assert.equal(rows.length, 1, JSON.stringify(rows.map((x) => x.name))); assert.equal(rows[0].version, 2);
  assert.match((await text(page)).body, /v2 much better/, "the published page shows the new version at the same URL");
  assert.equal((await text(link)).body, "<title>Horse Tinder</title>v2 much better design", "the share link serves the new version");
  assert.equal(d1.prepare("SELECT COUNT(*) n FROM published_pages").get().n, 1); assert.equal(d1.prepare("SELECT COUNT(*) n FROM share_links").get().n, 1);
  // a third round with another work folder and another name is version 3
  const r3 = await helperRound(T, 27, 1, [["horse tinder final.html", "<title>Horse Tinder</title>v3"]]);
  assert.equal(r3.attached[0].id, ID); assert.equal((await visible()).length, 1); assert.equal(R.libFile(ID).version, 3); assert.match((await text(page)).body, /v3/);
  await countsRight("routed helper iteration");
  ok("routed helpers: a -v2 output in the same task updates the published Library file (same id, name, link, page), version 2 and 3, no second file");
}

// ---- 1b. same task, a different deliverable with a longer name stays a second file ----
{
  const T = await sid("Report and appendix");
  const a = await helperRound(T, 50, 1, [["report.html", "<p>report</p>"]]), b = await helperRound(T, 51, 1, [["report-appendix.html", "<p>appendix</p>"]]);
  assert.notEqual(a.attached[0].id, b.attached[0].id); assert.equal(b.attached[0].name, "report-appendix.html");
  put("workspace/k/kyoto-plan.html", "k1"); await toolIn(T, "share_file", { path: "workspace/k/kyoto-plan.html" });
  put("workspace/k/kyoto-plan-packing-list.html", "k2"); assert.match(await toolIn(T, "share_file", { path: "workspace/k/kyoto-plan-packing-list.html" }), /^Shared "kyoto-plan-packing-list\.html"/);
  const c = await helperRound(T, 52, 1, [["report-v2.html", "<p>report v2</p>"]]); assert.equal(c.attached[0].id, a.attached[0].id);
  const d = await helperRound(T, 53, 1, [["report final.html", "<p>report final</p>"]]); assert.equal(d.attached[0].id, a.attached[0].id);
  assert.equal((await libFiles()).filter((x) => /^report/.test(x.name)).length, 2);
  await countsRight("two deliverables in one task");
  ok("same task: report-appendix.html and kyoto-plan-packing-list.html stay separate files; report-v2 and report final update report.html");
}

// ---- 2. another task: the helper read a loose copy by path, and an unrelated name in the same task stays a new file ----
{
  const T = await sid("Earlier task"); const r1 = await helperRound(T, 30, 1, [["pony-quiz.html", "<p>quiz v1</p>"]]); const ID = r1.attached[0].id;
  const T2 = await sid("Improve the quiz");
  put("pony-quiz.html", "<p>quiz v1</p>");   // a loose copy in /workspace, not in files/
  await toolIn(T2, "run_command", { command: "cat /workspace/pony-quiz.html" });
  assert.deepEqual(R.sql.exec("SELECT file_id FROM file_uses WHERE session=?", T2).toArray().map((x) => x.file_id), [ID], "reading the loose copy by its name is recorded as a use of the Library file");
  const r2 = await helperRound(T2, 31, 1, [["pony-quiz-v2.html", "<p>quiz v2</p>"]]);
  assert.equal(r2.attached[0].id, ID); assert.equal(r2.attached[0].name, "pony-quiz.html");
  const r3 = await helperRound(T2, 32, 1, [["tax-return.html", "<p>taxes</p>"]]);
  assert.notEqual(r3.attached[0].id, ID, "a name unlike the original is a different file");
  await countsRight("loose copy evidence");
  ok("a command that names a loose copy counts as using the Library file; an unrelated name stays a new file");
}

// ---- 3. share_file (the Primary): the same sequence ----
{
  const T = await sid("Make a pony page");
  put("workspace/pony/pony-home.html", "<p>pony v1</p>"); assert.match(await toolIn(T, "share_file", { path: "workspace/pony/pony-home.html" }), /^Shared "pony-home\.html"/);
  const f = (await libFiles()).find((x) => x.name === "pony-home.html"), n0 = (await libFiles()).length;
  const p = await api("/share/pages", { channel: "main", file: f.id }); const page = p.body.page.url;
  put("workspace/pony2/pony-home-v2.html", "<p>pony v2</p>");
  const out = await toolIn(T, "share_file", { path: "workspace/pony2/pony-home-v2.html" });
  assert.match(out, /^Updated "pony-home\.html" in place/, out); assert.match(out, /Library file "pony-home\.html"/);
  assert.equal((await libFiles()).length, n0); assert.match((await text(page)).body, /pony v2/);
  put("workspace/pony2/pony-home-v2.html", "<p>pony v3</p>"); await toolIn(T, "share_file", { path: "workspace/pony2/pony-home-v2.html", name: "pony home better design.html" });
  assert.equal((await libFiles()).length, n0); assert.equal(R.libFile(f.id).version, 3); assert.match((await text(page)).body, /pony v3/);
  await countsRight("share_file iteration");
  ok("share_file: a -v2 / renamed output in the same task updates the Library file and its page");
}

// ---- 4. explicit copies still make a new file ----
{
  const T = await sid("Copy request");
  const r1 = await helperRound(T, 40, 1, [["zebra.html", "<p>zebra</p>"]]); const ID = r1.attached[0].id;
  const r2 = await helperRound(T, 41, 1, [["zebra-copy.html", "<p>zebra copy</p>", { copy: true }]]);
  assert.notEqual(r2.attached[0].id, ID); assert.equal(R.libFile(ID).version, 1); assert.equal((await libFiles()).filter((x) => /zebra/.test(x.name)).length, 2);
  put("workspace/z/zebra-b.html", "<p>zebra b</p>"); assert.match(await toolIn(T, "share_file", { path: "workspace/z/zebra-b.html", name: "zebra-b.html", copy: true }), /^Shared "zebra-b\.html"/);
  assert.equal(R.libFile(ID).version, 1);
  ok("explicit copies (copy for helper approvals, copy: true for share_file) still add a new file");
}
console.log(`iterate-in-place: ${passed} checks passed`);
