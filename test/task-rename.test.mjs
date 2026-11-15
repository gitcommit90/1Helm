// Real Resident SQL (including pre-existing schema) and real Worker auth boundary. No providers/model calls.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { Resident } from "../src/resident.js";
import worker from "../src/index.js";
import { openCard, labelCard } from "../src/tracker.js";

const dbs = [];
const emptyDB = { prepare() { const s = { bind: () => s, first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 0 } }) }; return s; } };
function resident(db = new DatabaseSync(":memory:"), channel = "main") {
  if (!dbs.includes(db)) dbs.push(db);
  const sql = { exec(q, ...args) { if (!args.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
    const st = db.prepare(q), rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...args) : (st.run(...args), []); return { toArray: () => rows, one: () => rows[0] }; } };
  const R = new Resident({ storage: { sql, getAlarm: async () => null, setAlarm: async () => {} }, waitUntil() {} }, { DB: emptyDB, MEMORY: "off", GENUI: "off", WORKMEM: "off" });
  R.put("tenant", "owner"); R.put("channel", channel); return { R, db };
}
let checks = 0;
const test = async (name, fn) => { await fn(); console.log(`ok ${++checks} - ${name}`); };
try {
  await test("manual rename is validated, title-only, persisted/reversible with monotonic revision", async () => {
    const { R, db } = resident(), id = R.newSession("Original");
    R.sql.exec("UPDATE sessions SET pinned=1,done=1,done_at=4,preview='keep',waiting='plan',last_reply_at=3 WHERE id=?", id);
    R.todoSave(id, [{ id: "1", text: "Keep checklist", status: "done", by: "person", at: 1 }], 1, 0, 2);
    const before = { ...R.session(id) }, todos = R.todoRow(id);
    let view = await R.updateSession(id, { title: "  Budget review ✅  " });
    assert.equal(view.title, "Budget review ✅"); assert.equal(view.title_manual, true); assert.equal(view.title_revision, 1);
    const after = { ...R.session(id) }; for (const k of ["title", "title_manual", "title_revision"]) { delete before[k]; delete after[k]; }
    assert.deepEqual(after, before); assert.deepEqual(R.todoRow(id), todos);
    const reloaded = resident(db).R;
    assert.equal(reloaded.session(id).title, "Budget review ✅"); assert.equal(reloaded.session(id).title_manual, 1); assert.equal(reloaded.session(id).title_revision, 1);
    view = await reloaded.updateSession(id, { title: "Original" }); assert.equal(view.title_revision, 2);
    assert.equal((await reloaded.sessionDetail(id)).session.title_revision, 2);
    assert.equal((await reloaded.listSessions()).find((s) => s.id === id).title, "Original");
    const checkpoint = { ...reloaded.session(id) };
    for (const title of [null, 1, {}, [], "", " ", "a".repeat(121), "a\nb", "a\tb", "a\u0000b", "a\u0085b", "a\u2028b", "a\u2029b"]) {
      const invalid = await reloaded.updateSession(id, { title, pinned: false, done: false }); assert.equal(invalid.status, 400); assert.deepEqual({ ...reloaded.session(id) }, checkpoint);
    }
    for (const body of [null, [], 1, "bad"]) assert.equal((await reloaded.updateSession(id, body)).status, 400);
    assert.equal((await reloaded.updateSession(id, { title: "a".repeat(120) })).title.length, 120);
    assert.match((await resident().R.updateSession(id, { title: "foreign" })).error, /No such task/);
  });
  await test("constructor upgrades an existing database idempotently without changing titles", async () => {
    const db = new DatabaseSync(":memory:"); dbs.push(db);
    db.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY,title TEXT NOT NULL,pinned INTEGER DEFAULT 0,done INTEGER DEFAULT 0,done_at INTEGER,created INTEGER NOT NULL,updated INTEGER NOT NULL,last_reply_at INTEGER,seen_at INTEGER DEFAULT 0,waiting TEXT,preview TEXT); INSERT INTO sessions(id,title,created,updated) VALUES('old','Keep old title',1,2)");
    let R = resident(db).R; assert.equal(R.session("old").title, "Keep old title"); assert.equal(R.session("old").title_manual, 0); assert.equal(R.session("old").title_revision, 0);
    await R.updateSession("old", { title: "Manual" }); R = resident(db).R; assert.equal(R.session("old").title_revision, 1); assert.equal(R.session("old").title, "Manual");
  });
  await test("manual Texts survives the asynchronous legacy title-upgrade race", async () => {
    const { R } = resident(), manual = R.newSession("Texts"), automatic = R.newSession("Texts");
    R.put("texts_sessions", JSON.stringify([manual, automatic])); let resolveTitle;
    R.textsTitle = () => new Promise((resolve) => { resolveTitle = resolve; });
    const pending = R.listSessions(); await R.updateSession(manual, { title: "Texts" }); resolveTitle("Text with Renamed helper");
    await pending; assert.equal(R.session(manual).title, "Texts"); assert.equal(R.session(automatic).title, "Text with Renamed helper");
  });
  await test("manual texting-title pattern survives textTurn race; untouched automatic names still refresh", async () => {
    const { R } = resident(), id = R.newSession("Text with Original"); R.put("texts_session", id);
    R.steerOrOpen = () => ({ mode: "open", card: { id: "test-card" } }); R.runTurn = async () => ({ reply: "", turn: "test-card" }); R.deliverTextReply = async () => {};
    let resolveTitle; R.textsTitle = () => new Promise((resolve) => { resolveTitle = resolve; });
    const pending = R.textTurn("owner", "main", "1", "hello"); await R.updateSession(id, { title: "Text with My custom name" }); resolveTitle("Text with Automatic name");
    await pending; await R._lastTextRun; assert.equal(R.session(id).title, "Text with My custom name");
    const auto = R.newSession("Text with Old helper"); R.put("texts_session", auto); R.textsTitle = async () => "Text with New helper";
    await R.textTurn("owner", "main", "1", "hello again"); await R._lastTextRun; assert.equal(R.session(auto).title, "Text with New helper");
  });
  await test("agent-requested renames share protection and automatic card labels cannot rename the task", async () => {
    const { R } = resident(), id = R.newSession("Original");
    const out = JSON.parse(await R.localTool("rename_task", { title: "Chosen name", person_asked: "Rename this task to Chosen name" }, { kind: "chat", turn: "current", session: id, userText: "Rename this task to Chosen name" }));
    assert.equal(out.renamed, true); assert.equal(R.session(id).title_manual, 1);
    const card = openCard(R.sql, { session: id, input: { text: "automatic title" } });
    labelCard(R.sql, null, card.id, { title: "Automatic model label", title_src: "model" }); assert.equal(R.session(id).title, "Chosen name");
  });

  const d1 = new DatabaseSync(":memory:"); dbs.push(d1);
  d1.exec("CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT); CREATE TABLE sessions(token_hash TEXT,user_id TEXT,expires_at INTEGER); CREATE TABLE tenants(id TEXT PRIMARY KEY,slug TEXT,owner_user_id TEXT,status TEXT,onboarding_completed INTEGER,onboard_step TEXT,slug_chosen INTEGER,helper_name TEXT,first_name TEXT,plan TEXT,past_due_since INTEGER); INSERT INTO users VALUES('u1','one@example.com'),('u2','two@example.com'); INSERT INTO tenants VALUES('t1','ck1','u1','active',1,'',1,'Ollie','One','starter',NULL),('t2','ck2','u2','active',1,'',1,'Pip','Two','starter',NULL)");
  for (const [token, uid] of [["aa11", "u1"], ["bb22", "u2"]]) d1.prepare("INSERT INTO sessions VALUES(?,?,?)").run(createHash("sha256").update(token).digest("hex"), uid, Date.now() + 864e5);
  const DB = { prepare(q) { const st = d1.prepare(q); let a = []; const s = { bind(...v) { a = v; return s; }, first: async () => st.get(...a) || null, all: async () => ({ results: st.all(...a) }), run: async () => ({ meta: { changes: Number(st.run(...a).changes) } }) }; return s; } };
  const main = resident().R, other = resident(undefined, "other").R, id = main.newSession("HTTP original"), idOther = other.newSession("Other channel");
  main.bind = other.bind = async () => true;
  const env = { DB, TEST_MODE: "1", APP_HOST: "owner.example.com", RESIDENT: { idFromName: (x) => x, get: (x) => x === "res:t1:main" ? main : other }, ARCHIVE: { idFromName: (x) => x, get: () => ({ channels: async () => [{ id: 1, slug: "main" }, { id: 2, slug: "other" }] }) }, LEDGER: { idFromName: (x) => x, get: () => ({}) } };
  const H = "https://owner.example.com", endpoint = `/w/ck1/api/res/main/sessions/${id}`;
  const call = (path = endpoint, { method = "POST", token = "aa11", origin = H, ct = "application/json", body = { title: "HTTP renamed" }, headers = {} } = {}) => worker.fetch(new Request(H + path, { method, headers: { ...(token ? { cookie: `hc_session=${token}` } : {}), ...(origin ? { origin } : {}), "content-type": ct, ...headers }, ...(method !== "GET" && method !== "HEAD" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}) }), env, { waitUntil() {} });
  await test("real Worker owner mutation, invalid400/missing404/method405, auth/CSRF/view-as isolation", async () => {
    let r = await call(); assert.equal(r.status, 200); const saved = await r.json(); assert.equal(saved.title, "HTTP renamed"); assert.equal(saved.title_manual, true); assert.equal(saved.title_revision, 1);
    for (const body of [{ title: "" }, { title: "x".repeat(121) }, { title: "line\nbreak" }, null, [], "{"]) assert.equal((await call(endpoint, { body })).status, 400);
    assert.equal((await call(endpoint.replace(id, crypto.randomUUID()))).status, 404);
    assert.equal((await call(endpoint.replace(id, idOther))).status, 404);
    assert.equal((await call(endpoint.replace("/main/", "/other/"))).status, 404);
    for (const method of ["PUT", "DELETE", "PATCH"]) assert.equal((await call(endpoint, { method })).status, 405);
    for (const options of [{ origin: "https://evil.example" }, { origin: null }, { origin: "null" }, { ct: "text/plain" }, { headers: { "sec-fetch-site": "cross-site" } }]) assert.equal((await call(endpoint, options)).status, 403);
    assert.ok([302, 303, 401].includes((await call(endpoint, { token: null })).status));
    assert.equal((await call(endpoint, { token: "e".repeat(80) })).status, 302, "public build has no private view-as tokens");
    r = await call(endpoint, { token: "bb22" }); assert.ok(r.status !== 200 || !(await r.text()).includes("title_revision"));
    assert.equal(main.session(id).title, "HTTP renamed"); assert.equal(main.session(id).title_revision, 1); assert.equal(other.session(idOther).title, "Other channel");
    assert.equal((await call(endpoint, { origin: null, body: { pinned: true } })).status, 200, "unrelated existing session-update clients retain their Origin behavior");
  });
  console.log(`PASS task rename: ${checks} groups; no model calls or external writes.`);
} finally { for (const db of dbs) db.close(); }
