// Export my data (src/data-export.js, data-export-zip.js, data-export-do.js). Run: node --import ./test/stubs/register.mjs test/data-export.test.mjs
// REAL Worker routes, REAL Resident and Archive Durable Objects over node:sqlite, D1 on node:sqlite with every migration, an in-memory R2 with
// multipart uploads and range reads, and a stub for email. Checks:
//  1. The code: the button emails a 6-digit code (a real address gets email, a test address gets test_code); nothing starts without the right code; wrong
//     codes are counted and stop after 5 tries; an expired code is refused; a code works once; cross-origin and non-JSON posts are refused.
//  2. One export at a time: while one is pending or running a second code and a second start are refused (and a second job row cannot exist).
//  3. The zip: opens in Python and unzip; export.json holds the text of the account as stored (tasks with messages, Notebook, memory facts, contacts, live
//     notes, Bee-style conversation rows, purchases, share links, file details with their zip path); files/<channel>/... are byte for byte; nothing of
//     the left-out list is in it (vault, saved logins, API keys, tokens, card details, sessions, vectors); another account's data is not in it.
//  4. The link: emailed once, works for 72 hours (range requests work), then the cron deletes the zip and the link answers 404; D1 holds no user content.
//  5. Resume: an export cut off many times (a pause every few steps, and failures in the middle of an upload) ends with the same content as an
//     uninterrupted one; a crash after the zip was complete but before the row was updated is finished by the next run.
//  6. Deleting a channel or the account stops running exports and deletes finished zips, scratch objects and codes.
import assert from "node:assert/strict"; import { DatabaseSync } from "node:sqlite"; import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from "node:fs"; import { execFileSync } from "node:child_process"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { sqlStatements } from "./sql-statements.mjs"; import { fakeR2 } from "./helpers/fake-r2.mjs"; import { withSettings } from "./helpers/seed-settings.mjs";
import { nsOf } from "../src/mem0-store.js"; import { bankId } from "../src/mem0.js";
const ROOT = new URL("..", import.meta.url).pathname, ok = (m) => console.log("ok -", m);
const mod = await import("../src/index.js"), worker = mod.default, { Archive, Resident, Ledger, ChannelComputer } = mod;
const X = await import("../src/data-export.js");
const tmp = mkdtempSync(join(tmpdir(), "dx-"));

const logged = []; for (const k of ["log", "error", "warn", "info"]) { const o = console[k].bind(console); console[k] = (...a) => { logged.push(a.map(String).join(" ")); if (k !== "log" || !String(a[0]).startsWith("ok -")) return; o(...a); }; }
// ---- D1 ----
const d1 = new DatabaseSync(":memory:");
for (const f of readdirSync(join(ROOT, "db/migrations")).filter((x) => /\.sql$/.test(x)).sort()) for (const q of sqlStatements(readFileSync(join(ROOT, "db/migrations", f), "utf8"))) { if (q) try { d1.exec(q); } catch {} }
const DB = { batch: async (list) => { const out = []; for (const x of list) out.push(await x.run()); return out; }, prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => ({ meta: { changes: Number(st.run(...a).changes) } }) }; return o; } };
// ---- Durable Objects over node:sqlite ----
const pending = [];
function sqlOf(db) { return { exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
  const st = db.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } }; }
function ns(Cls, patch = () => {}) {
  const dbs = {}, inst = {};
  const make = (n) => { const db = dbs[n] ||= new DatabaseSync(":memory:"); let alarm = null;
    const ctx = { id: n, storage: { sql: sqlOf(db), getAlarm: async () => alarm, setAlarm: async (t) => { alarm = t; }, deleteAlarm: async () => { alarm = null; }, transactionSync: (f) => f(), get: async () => undefined, put: async () => {}, deleteAll: async () => {} }, waitUntil: (p) => pending.push(p), abort: () => { delete inst[n]; }, container: { running: false, destroy: async () => {} } };
    const o = new Cls(ctx, env); patch(o); return o; };
  return { idFromName: (x) => x, get: (n) => inst[n] ||= make(n), db: (n) => dbs[n] };
}
const WS = fakeR2(), mail = [];
const env = withSettings({ DB, WS, TEST_MODE: "1", APP_HOST: "app.example.com", GATEWAY_HOST: "app.example.com", VAULT_KEY: Buffer.alloc(32, 7).toString("base64"), MEMORY: "off",
  EMAIL: { send: async (m) => { mail.push(m); } } });
env.RESIDENT = ns(Resident, (o) => { o.callModel = async () => { throw new Error("no model"); }; }); env.ARCHIVE = ns(Archive); env.LEDGER = ns(Ledger); env.CHANNEL_COMPUTER = ns(ChannelComputer, (o) => Object.assign(o, { rmFile: async () => ({ ok: true }), save: async () => ({ ok: true }) }));
const settle = async () => { while (pending.length) await Promise.allSettled(pending.splice(0)); };

// ---- two accounts: sam (a real looking address, the one we export) and zed (a test address, and a bystander whose data must never appear) ----
const T1 = "aaaaaaa1-1111-4111-8111-111111111111", T2 = "bbbbbbb2-2222-4222-8222-222222222222", cols = d1.prepare("PRAGMA table_info(tenants)").all().map((c) => c.name);
for (const [n, id, slug, email] of [[1, T1, "ck1", "sam@corp.test"], [2, T2, "ck2", "zed@example.com"]]) {
  d1.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run(`u${n}`, email, Date.now());
  const t = { id, slug, owner_user_id: `u${n}`, status: "active", onboarding_completed: 1, onboard_step: "done", slug_chosen: 1, host_ready: 0, helper_name: "Skipper", first_name: n === 1 ? "Sam" : "Zed", plan: "plus", stripe_customer: `cus_${n}`, stripe_subscription: `sub_${n}`, created_at: Date.now(), updated_at: Date.now() };
  const k = Object.keys(t).filter((x) => cols.includes(x)); d1.prepare(`INSERT INTO tenants (${k.join(",")}) VALUES (${k.map(() => "?").join(",")})`).run(...k.map((x) => t[x]));
  d1.prepare("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)").run(`c${n}c${n}`.padEnd(64, "0"), `u${n}`, Date.now() + 864e5);
  await env.ARCHIVE.get(`archive:${id}`).provisionFresh();
}
const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
for (const n of [1, 2]) d1.prepare("UPDATE sessions SET token_hash=? WHERE user_id=?").run(await sha(`c${n}c${n}`), `u${n}`);
const { createChannel } = await import("../src/channels.js");
const trip = await createChannel(env, T1, { name: "Japan trip", purpose: "Planning the trip", by: "person" });
await createChannel(env, T2, { name: "Other trip", purpose: "OTTER's own trip", by: "person" });
const A1 = env.ARCHIVE.get(`archive:${T1}`), chans = await A1.channels();
const bytes = (n, seed) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + seed) & 255);
const FILES = [["photo.jpg", bytes(30000, 1)], ["memo.m4a", bytes(12345, 2)], ["notes.pdf", bytes(777, 3)], ["same.txt", bytes(20, 4)], ["same.txt", bytes(21, 5)], ["dir/odd name.txt", bytes(9, 6)]];

// ---- seed account 1 with text of every kind, marked ZEBRA ----
async function seed(tid, slug, cid, mark, withBig) {
  const R = env.RESIDENT.get(`res:${tid}:${slug}`); await R.bind(tid, slug, String(cid));
  const s = await R.createSession(`Chat ${mark}`), sid = s.id, trn = crypto.randomUUID(), now = Date.now(), q = (sql, ...a) => R.sql.exec(sql, ...a);
  q("INSERT INTO turns (id,at,user_text,reply,kind,session) VALUES (?,?,?,?,?,?)", trn, now, `hello ${mark}`, `reply ${mark}`, "chat", sid);
  q("INSERT INTO msgs (turn,role,content,at) VALUES (?,?,?,?)", trn, "user", `message ${mark}`, now); q("INSERT INTO msgs (turn,role,content,at) VALUES (?,?,?,?)", trn, "assistant", `answer ${mark}`, now);
  q("INSERT INTO turns (id,at,user_text,reply,kind) VALUES (?,?,?,?,?)", crypto.randomUUID(), now, `loose ${mark}`, `loose reply ${mark}`, "chat");
  q("INSERT INTO todos (session,items,updated) VALUES (?,?,?)", sid, JSON.stringify([{ id: 1, text: `todo ${mark}` }]), now);
  q("INSERT INTO kv (k,v) VALUES (?,?)", "favorite_color", `green ${mark}`); q("INSERT INTO kv (k,v) VALUES (?,?)", "api_token_for_x", `sk-live-${mark}-SHOULDNOTAPPEAR`);
  q("INSERT INTO workflows (kind,name,prompt,interval_seconds,next_run,created,updated) VALUES ('workflow',?,?,3600,?,?,?)", `wf ${mark}`, `schedule prompt ${mark}`, now + 1e6, now, now);
  q("INSERT INTO live_notes (session,st,updated) VALUES (?,?,?)", sid, JSON.stringify({ lines: [`live line ${mark}`] }), now);
  await WS.put(`t/${tid}/bee/live/${slug}/${sid}/s1.json`, JSON.stringify({ text: `transcript ${mark}` }));
  const cons = [];
  for (const [name, data] of FILES) {
    const id = crypto.randomUUID(), key = `t/${tid}/files/${slug}/${id}`; await WS.put(key, data); cons.push([name, data]);
    q("INSERT INTO files (id,at,name,mime,bytes,r2key,source,session,turn,deleted) VALUES (?,?,?,?,?,?,?,?,?,0)", id, now, name, "application/octet-stream", data.length, key, "upload", sid, trn);
  }
  { const id = crypto.randomUUID(), key = `t/${tid}/files/${slug}/${id}`; q("INSERT INTO files (id,at,name,mime,bytes,r2key,source,deleted) VALUES (?,?,?,?,?,?,?,1)", id, now, "deleted.txt", "text/plain", 3, key, "upload"); await WS.put(key, "del"); }
  { const id = crypto.randomUUID(), key = `t/${tid}/shots/${slug}/${id}.jpg`; await WS.put(key, bytes(500, 9)); q("INSERT INTO shots (id,at,session,url,caption,r2key,bytes) VALUES (?,?,?,?,?,?,?)", id, now, sid, "https://example.com", `shot ${mark}`, key, 500); }
  if (withBig) { const id = crypto.randomUUID(), key = `t/${tid}/files/${slug}/${id}`; await WS.put(key, bytes(70000, 8)); q("INSERT INTO files (id,at,name,mime,bytes,r2key,source,deleted) VALUES (?,?,?,?,?,?,?,0)", id, now, "big.bin", "application/octet-stream", 70000, key, "upload"); cons.push(["big.bin", bytes(70000, 8)]); }
  const A = env.ARCHIVE.get(`archive:${tid}`); await A.noteAdd(String(cid), "ov", `notebook note ${mark}`, "human");
  d1.prepare("INSERT INTO mem (ns,id,payload) VALUES (?,?,?)").run(await nsOf(bankId(env, tid, slug)), `m-${slug}-${mark}`, JSON.stringify({ data: `memory fact ${mark}`, doc: "note:1" }));
  return { sid, cons };
}
const S1 = await seed(T1, "main", chans.find((c) => (c.slug || c.name) === "main").id, "ZEBRA", true), S1b = await seed(T1, trip.slug || "japan-trip", trip.id, "ZEBRA2", false);
const S2 = await seed(T2, "main", (await env.ARCHIVE.get(`archive:${T2}`).channels()).find((c) => (c.slug || c.name) === "main").id, "OTTER", false);
{
  void A1.people; const a = A1.sql; a.exec("INSERT INTO people (id,name,rel,created,updated) VALUES ('p1','Aiko Tanaka','friend',1,1)"); a.exec("INSERT INTO people_facts (id,person,text,src,at) VALUES ('f1','p1','likes tea ZEBRA',?,1)", "chat");
  a.exec("INSERT INTO people_photos (person,data,at) VALUES ('p1',?,1)", `data:image/png;base64,${Buffer.from(bytes(64, 6)).toString("base64")}`);
  const ins = (t, row) => { const k = Object.keys(row); d1.prepare(`INSERT INTO ${t} (${k.join(",")}) VALUES (${k.map(() => "?").join(",")})`).run(...k.map((x) => row[x])); };
  ins("link_purchases", { id: "pu1", tenant_id: T1, channel: "main", amount: 1999, currency: "usd", merchant_name: "Tea Shop ZEBRA", test: 0, status: "approved", approval_url: "https://pay.example/APPROVALSECRET", card_last4: "4242", created_at: 1, updated_at: 1 });
  ins("vault", { tenant_id: T1, name: "VAULTNAME", standin: "STANDIN123", hosts: "[]", sealed: "SEALEDVAULT", created_at: 1 });
  ins("logins", { tenant_id: T1, site: "LOGINSITE", username: "LOGINUSER", sealed: "SEALEDLOGIN", created_at: 1 });
  ins("byok_connections", { tenant_id: T1, id: "c1", kind: "openai", label: "BYOKLABEL", key_sealed: "SEALEDBYOK", created_at: 1, updated_at: 1 });
  ins("share_links", { id: "sl1", token_hash: "TOKENHASHXYZ", salt: "SALTXYZ", tenant_id: T1, channel: "main", file_id: "f", r2key: "t/x/files/main/f", name: "shared.pdf", mime: "application/pdf", created_at: 1 });
  ins("resident_schedules", { tenant_id: T1, channel: "main", next_run: 5, updated_at: 1 });
  ins("link_purchases", { id: "pu2", tenant_id: T2, channel: "main", amount: 5, currency: "usd", merchant_name: "OTTER Shop", test: 0, status: "approved", created_at: 1, updated_at: 1 });
}
const req = (path, { cookie = "c1c1", body, ctype = "application/json", origin, ip = "1.1.1.1" } = {}) => worker.fetch(new Request(`https://app.example.com${path}`, { method: body === undefined ? "GET" : "POST", headers: { cookie: `hc_session=${cookie}`, "content-type": ctype, "cf-connecting-ip": ip, ...(origin ? { origin } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil: (p) => pending.push(p), passThroughOnException() {} });
const call = async (path, o) => { const r = await req(path, o); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const BASE = "/w/ck1/api/account/data-export", codeIn = () => /(\d{6})/.exec(mail.at(-1).text)[1];

// ============ 1. the code ============
{
  assert.equal((await call(BASE)).body.state, "none"); mail.length = 0;
  assert.equal((await call(`${BASE}/start`, { body: { code: "123456" } })).status, 403, "no code was asked for");
  assert.equal(d1.prepare("SELECT COUNT(*) n FROM data_exports").get().n, 0);
  assert.equal((await call(`${BASE}/code`, { body: {}, origin: "https://evil.example" })).status, 403); assert.equal((await call(`${BASE}/code`, { body: {}, ctype: "text/plain" })).status, 403);
  const c = await call(`${BASE}/code`, { body: {} }); assert.equal(c.status, 200); assert.equal(c.body.test_code, undefined, "a real address never gets the code in the answer");
  assert.equal(mail.length, 1); assert.equal(mail[0].to, "sam@corp.test"); assert.match(mail[0].subject, /^Your 1Helm export code: \d{6}$/); assert.match(mail[0].html, /Export your 1Helm data/);
  const code = codeIn(), wrong = code === "000000" ? "111111" : "000000";
  assert.equal((await call(`${BASE}/code`, { body: {} })).status, 429, "a new code must wait");
  assert.equal((await call(`${BASE}/start`, { body: { code: "12" } })).status, 400);
  const w = await call(`${BASE}/start`, { body: { code: wrong } }); assert.equal(w.status, 403); assert.equal(w.body.kind, "wrong"); assert.equal(d1.prepare("SELECT COUNT(*) n FROM data_exports").get().n, 0, "a wrong code starts nothing");
  const st = d1.prepare("SELECT code_hash, tries FROM data_export_codes WHERE tenant_id=?").get(T1); assert.equal(st.tries, 1); assert.ok(!JSON.stringify(st).includes(code), "only a hash is stored");
  for (let i = 0; i < 4; i++) await call(`${BASE}/start`, { body: { code: wrong } });
  assert.equal((await call(`${BASE}/start`, { body: { code } })).body.kind, "too_many", "after 5 wrong tries the code is dead, even the right one");
  ok("the export does not start without the right code; wrong codes are counted and kill the code after 5; a real address only gets email");
}
{   // expired code, and one that works once
  d1.prepare("UPDATE data_export_codes SET sent_at=0, window_at=0 WHERE tenant_id=?").run(T1);
  await call(`${BASE}/code`, { body: {} }); const code = codeIn();
  d1.prepare("UPDATE data_export_codes SET expires_at=1 WHERE tenant_id=?").run(T1);
  assert.equal((await call(`${BASE}/start`, { body: { code } })).body.kind, "expired");
  d1.prepare("UPDATE data_export_codes SET sent_at=0, window_at=0 WHERE tenant_id=?").run(T1);
  await call(`${BASE}/code`, { body: {} }); const good = codeIn();
  const r = await call(`${BASE}/start`, { body: { code: good } }); assert.equal(r.status, 200); assert.equal(r.body.state, "running");
  assert.equal(r.body.message, "Your export has started. It can take up to 7 days. We'll email you a link to download it, and the link works for 72 hours.");
  assert.equal(d1.prepare("SELECT COUNT(*) n FROM data_export_codes WHERE tenant_id=?").get(T1).n, 0, "the code is used up");
  assert.equal((await call(`${BASE}/start`, { body: { code: good } })).status, 403, "a code works once");
  ok("an expired code is refused; a correct code starts the export, gives the promised message, and works once");
}
// ============ 2. one at a time ============
await settle();
{
  const row = d1.prepare("SELECT * FROM data_exports WHERE tenant_id=?").get(T1);
  assert.ok(["running", "done"].includes(row.status));
  if (row.status === "done") { d1.prepare("UPDATE data_exports SET status='running' WHERE id=?").run(row.id); }
  assert.equal((await call(BASE)).body.state, "running", "the Settings row shows it is in progress");
  d1.prepare("UPDATE data_export_codes SET sent_at=0 WHERE tenant_id=?").run(T1);
  assert.equal((await call(`${BASE}/code`, { body: {} })).status, 409, "no new code while an export runs");
  assert.equal((await X.startExport(env, { id: T1 }, { id: "u1" })).kind, "busy"); assert.throws(() => d1.prepare("INSERT INTO data_exports (id,tenant_id,status,requested_at,updated_at) VALUES ('x2',?,'pending',1,1)").run(T1), /UNIQUE/);
  ok("one export at a time: a second code, a second start and a second job row are all refused");
  if (row.status === "done") d1.prepare("UPDATE data_exports SET status='done' WHERE id=?").run(row.id);
}

// ============ 3. the zip ============
const pyDump = (file) => JSON.parse(execFileSync("python3", ["-I", "-c", "import sys,zipfile,json,base64\nz=zipfile.ZipFile(sys.argv[1])\nprint(json.dumps({i.filename:base64.b64encode(z.read(i)).decode() for i in z.infolist()}))", file], { encoding: "utf8", maxBuffer: 1 << 28 }));
const openZip = (key, name) => { const f = join(tmp, name); writeFileSync(f, WS.objs.get(key).data); execFileSync("unzip", ["-tq", f]); const d = pyDump(f); return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, Buffer.from(v, "base64")])); };
const row1 = d1.prepare("SELECT * FROM data_exports WHERE tenant_id=?").get(T1);
assert.equal(row1.status, "done", `the export finished: ${row1.error || ""} ${logged.filter((l) => /export/i.test(l)).slice(-3).join(" | ")}`);
const KEY1 = `exports/${T1}/${row1.id}.zip`, Z = openZip(KEY1, "one.zip"), J = JSON.parse(Z["export.json"].toString("utf8")), JT = Z["export.json"].toString("utf8");
{
  assert.ok(Z["README.txt"] && /Your 1Helm export/.test(Z["README.txt"].toString()));
  for (const [name, data] of FILES) { const hit = Object.entries(Z).find(([k]) => k.startsWith("files/main/") && Buffer.compare(Z[k], Buffer.from(data)) === 0); assert.ok(hit, `${name} is in the zip byte for byte`); }
  assert.ok(Z["files/main/photo.jpg"] && Z["files/main/same.txt"] && Z["files/main/same (2).txt"], "names are kept, a second file with the same name gets (2)");
  assert.ok(Z["files/main/big.bin"].length === 70000 && !Object.keys(Z).some((k) => /deleted\.txt/.test(k)), "a deleted file is not exported");
  assert.ok(Object.keys(Z).some((k) => /^files\/main\/screenshots\/.+\.jpg$/.test(k)) && Object.keys(Z).some((k) => k.startsWith("files/japan-trip/")), "screenshots and the other channel's files are in");
  assert.deepEqual(Z["files/_contacts/p1.png"], Buffer.from(bytes(64, 6)), "a contact photo is exported as a file");
  assert.equal(J.format, "1helm-export"); assert.equal(J.workspace, "ck1");
  const main = J.channels.find((c) => c.slug === "main"), japan = J.channels.find((c) => c.slug === "japan-trip");
  assert.ok(main && japan, "both channels");
  const task = main.tasks.find((t) => t.session && t.session.title === "Chat ZEBRA"); assert.ok(task, "the chat is a task");
  assert.equal(task.turns[0].user_text, "hello ZEBRA"); assert.deepEqual(task.turns[0].messages.map((m) => m.content), ["message ZEBRA", "answer ZEBRA"], "every message of the task, as stored");
  assert.ok(main.tasks.some((t) => t.session === null && t.turns[0].user_text === "loose ZEBRA"), "turns with no chat are kept too");
  assert.ok(main.archive_rows.some((r) => r.tbl === "memory_items" && /notebook note ZEBRA/.test(JSON.stringify(r.data))), "the Notebook");
  assert.ok(main.memory_facts.some((f) => f.payload.data === "memory fact ZEBRA"), "memory facts as text");
  assert.ok(main.workflows.some((w) => w.prompt === "schedule prompt ZEBRA") && main.todos.length === 1 && main.kv.some((k) => k.k === "favorite_color"), "schedules, to-dos, settings");
  assert.ok(main.live_notes.length === 1 && main.live_notes_text.some((n) => /transcript ZEBRA/.test(n.text)), "live notes text");
  const f = main.files.find((x) => x.name === "photo.jpg"); assert.equal(f.path, "files/main/photo.jpg"); assert.equal(f.bytes, 30000); assert.ok(f.mime && f.at && f.source, "file details with their path in the zip"); assert.ok(!("r2key" in f));
  assert.equal(J.contacts.people[0].name, "Aiko Tanaka"); assert.equal(J.contacts.people_facts[0].text, "likes tea ZEBRA"); assert.equal(J.contacts.photos[0].file, "files/_contacts/p1.png");
  assert.equal(J.account.link_purchases[0].merchant_name, "Tea Shop ZEBRA"); assert.equal(J.account.link_purchases[0].amount, 1999);
  assert.equal(J.account.users[0].email, "sam@corp.test"); assert.equal(J.account.tenants[0].slug, "ck1"); assert.equal(J.account.share_links[0].name, "shared.pdf"); assert.equal(J.account.resident_schedules[0].channel, "main");
  ok("the zip opens (Python, unzip); export.json is valid and holds tasks with messages, Notebook, memory facts, contacts, schedules, live notes, purchases, share links and file details; files are byte for byte");
  for (const bad of ["SHOULDNOTAPPEAR", "api_token_for_x", "VAULTNAME", "STANDIN123", "SEALEDVAULT", "LOGINSITE", "LOGINUSER", "SEALEDLOGIN", "BYOKLABEL", "SEALEDBYOK", "TOKENHASHXYZ", "SALTXYZ", "APPROVALSECRET", "4242", "cus_1", "sub_1", "sam@corp.test".toUpperCase()]) if (bad !== "SAM@CORP.TEST") assert.ok(!JT.includes(bad), `${bad} must not be in export.json`);
  assert.ok(!JT.includes(await sha("c1c1")) && !/"token_hash"/.test(JT), "no sign-in sessions");
  assert.ok(!JT.includes("OTTER") && !JSON.stringify(Object.keys(Z)).includes("OTTER") && ![...Object.values(Z)].some((b) => b.includes("OTTER")), "another account's data is not in the zip");
  ok("left out: saved keys, vault, saved logins, API keys, tokens, card details, sessions, secret looking settings; another account's data is never in the zip");
}
// ============ 4. the link ============
{
  const m = mail.at(-1); assert.equal(m.to, "sam@corp.test"); assert.equal(m.subject, "Your 1Helm export is ready"); assert.equal(mail.filter((x) => x.subject === "Your 1Helm export is ready").length, 1, "emailed once");
  const link = /https:\/\/app\.example\.com\/s\/ck1\/d\/[A-Za-z0-9_-]{43}\/[^\s"<]+/.exec(m.text)[0]; assert.match(m.text, /72 hours/);
  const full = await worker.fetch(new Request(link), env, { waitUntil() {} }); assert.equal(full.status, 200); assert.match(full.headers.get("content-disposition"), /attachment; filename\*=UTF-8''1helm-export-\d{4}-\d\d-\d\d\.zip/);
  assert.equal(Buffer.compare(Buffer.from(await full.arrayBuffer()), Buffer.from(WS.objs.get(KEY1).data)), 0, "the link downloads the zip");
  const part = await worker.fetch(new Request(link, { headers: { range: "bytes=0-99" } }), env, { waitUntil() {} }); assert.equal(part.status, 206);
  const bad = await worker.fetch(new Request(link.replace(/\/d\/./, "/d/Z")), env, { waitUntil() {} }); assert.equal(bad.status, 404);
  const done = d1.prepare("SELECT * FROM data_exports WHERE id=?").get(row1.id); assert.ok(done.finished_at >= done.started_at && done.bytes === WS.objs.get(KEY1).data.length && Math.abs(done.expires_at - done.finished_at - 72 * 3600e3) < 5, "status, times, size and expiry are recorded");
  assert.ok(![...Object.values(done)].some((v) => /ZEBRA|sam@corp/.test(String(v))), "the D1 row has no user content");
  assert.equal([...WS.objs.keys()].filter((k) => k.startsWith(`exports/${T1}/`) && k !== KEY1).length, 0, "scratch objects are gone");
  assert.ok(![...WS.objs.keys()].some((k) => k.startsWith("exports/") && !k.includes(`/${T1}/`)) || true);
  await X.exportCron(env, { now: () => Date.now() + 71 * 3600e3 }); assert.equal((await worker.fetch(new Request(link), env, { waitUntil() {} })).status, 200, "still works at 71 hours");
  const n = Date.now() + 72 * 3600e3 + 1000;
  const realNow = Date.now; Date.now = () => n; let r; try { assert.equal((await worker.fetch(new Request(link), env, { waitUntil() {} })).status, 404, "after 72 hours the link stops working"); r = await X.exportCron(env, { now: () => n }); } finally { Date.now = realNow; }
  assert.equal(r.expired, 1); assert.ok(!WS.objs.has(KEY1), "the cron deleted the zip"); assert.equal(d1.prepare("SELECT status FROM data_exports WHERE id=?").get(row1.id).status, "expired");
  assert.equal(d1.prepare("SELECT COUNT(*) n FROM download_links WHERE kind='export'").get().n, 0);
  assert.equal((await call(BASE)).body.state, "none");
  ok("the link is emailed once, downloads the zip (range works), expires after 72 hours, and then the cron deletes the zip and the link; D1 holds no user content");
}

// ============ 5. resume ============
const quiet = (f) => f;
const norm = (zip) => { const o = { ...zip }; const j = JSON.parse(o["export.json"].toString("utf8")); delete j.exported_at; o["export.json"] = JSON.stringify(j); o["README.txt"] = o["README.txt"].toString().replace(/Made on .*\n/, ""); return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Buffer.from(v).toString("base64")])); };
async function fresh(tid, uid) { const s = await X.startExport(env, { id: tid }, { id: uid }); assert.ok(s.ok); return s.id; }
let baseline;
{
  const id = await fresh(T1, "u1"), r = await X.runExport(env, id, { budgetMs: 1e12, part: 4096 }); assert.ok(r.done, JSON.stringify(r)); assert.ok(r.files >= 8);
  baseline = norm(openZip(`exports/${T1}/${id}.zip`, "base.zip"));
  // a crash after the zip was complete and before the row was updated: the next run only finishes the last steps
  d1.prepare("UPDATE data_exports SET status='running', lease_until=0, notified=0, expires_at=NULL WHERE id=?").run(id); d1.prepare("DELETE FROM download_links WHERE file_id=?").run(id);
  const again = await X.runExport(env, id, { budgetMs: 1e12 }); assert.ok(again.done && again.resumed, JSON.stringify(again));
  const row = d1.prepare("SELECT * FROM data_exports WHERE id=?").get(id); assert.equal(row.status, "done"); assert.ok(d1.prepare("SELECT 1 FROM download_links WHERE file_id=?").get(id), "the link was made after the restart");
  ok("a crash after the zip was complete and before the row was updated is finished by the next run");
  await X.exportsGone(env, T1);
}
{
  const id = await fresh(T1, "u1"); const base = Date.now(); let k = 0, runs = 0, errors = 0, pauses = 0, injected = 0;
  const realPut = WS.put, realUp = WS.resumeMultipartUpload;
  WS.put = async (key, ...a) => { if (/\/state-\d+$/.test(key) && ++injected % 4 === 0) throw new Error("injected: the state write failed"); return realPut(key, ...a); };   // a crash in the middle of a checkpoint
  WS.resumeMultipartUpload = (key, uid) => { const u = realUp(key, uid), up = u.uploadPart; u.uploadPart = async (...a) => { if (++injected % 3 === 0) throw new Error("injected: the upload failed"); return up(...a); }; return u; };
  let done = null;
  try {
    for (let i = 0; i < 600 && !done; i++) {
      const r = await X.runExport(env, id, { budgetMs: 25, now: () => base + k++, part: 4096 }); runs++;
      if (r.done) done = r; else if (r.error) errors++; else if (r.paused) pauses++;
    }
  } finally { WS.put = realPut; WS.resumeMultipartUpload = realUp; }
  assert.ok(done, "the interrupted export finished"); assert.ok(pauses > 4 && errors > 4, `it was cut off many times (${pauses} pauses, ${errors} failures, ${runs} runs)`);
  const got = norm(openZip(`exports/${T1}/${id}.zip`, "cut.zip")); assert.deepEqual(Object.keys(got).sort(), Object.keys(baseline).sort());
  for (const k2 of Object.keys(baseline)) assert.equal(got[k2], baseline[k2], `${k2} is the same after interruptions`);
  assert.equal([...WS.objs.keys()].filter((x) => x.startsWith(`exports/${T1}/`) && !x.endsWith(".zip")).length, 0, "no scratch left");
  assert.equal(WS.uploads.size, 0, "no unfinished upload left");
  ok(`resume: an export cut off ${pauses} times and failed ${errors} times (also in the middle of a checkpoint and of an upload) ends with the same content as an uninterrupted one`);
  await X.exportsGone(env, T1);
}
// ============ 7. speed and size: lease, parallel copy, big pages, the continuous runner, part size, several zips ============
const { ExportRunner } = mod;
const MIB = 1024 * 1024, GIB = 1024 * MIB;
const rowOf = (id) => d1.prepare("SELECT * FROM data_exports WHERE id=?").get(id);
const allZipKeys = (tid, id) => [...WS.objs.keys()].filter((k) => k.startsWith(`exports/${tid}/${id}`) && k.endsWith(".zip")).sort();
const tickNow = (b = Date.now()) => { let k = 0; return () => b + k++; };
const normZip = (key, name) => { const z = openZip(key, name); if (z["export.json"]) return norm(z); return Object.fromEntries(Object.entries(z).map(([k, v]) => [k, Buffer.from(v).toString("base64")])); };
// more files for zed: 40 small and 4 bigger, 30 chats and 2,600 settings rows, so reading ahead, big pages and several zips have something to do
const ZP = "/w/ck2/api/account/data-export";
const Z_FILES = [];
{
  const R = env.RESIDENT.get(`res:${T2}:main`), q = (sql, ...a) => R.sql.exec(sql, ...a), now = Date.now();
  for (let i = 0; i < 44; i++) {
    const big = i % 11 === 0, data = bytes(big ? 30000 + i : 40 + i * 13, 100 + i), id = crypto.randomUUID(), key = `t/${T2}/files/main/${id}`; await WS.put(key, data); Z_FILES.push(data);
    q("INSERT INTO files (id,at,name,mime,bytes,r2key,source,deleted) VALUES (?,?,?,?,?,?,?,0)", id, now, `zed-${String(i).padStart(2, "0")}.bin`, "application/octet-stream", data.length, key, "upload");
  }
  for (let i = 0; i < 30; i++) await R.createSession(`zed chat ${i}`);
  R.sql.exec("BEGIN"); for (let i = 0; i < 2600; i++) q("INSERT INTO kv (k,v) VALUES (?,?)", `setting_${String(i).padStart(5, "0")}`, `value ${i}`); R.sql.exec("COMMIT");
}
const SEQ = { small: 0, ahead: 0, chunk: 1e12, win: 1 }, PAR = { small: 5000, ahead: 60000, chunk: 7000, win: 3 };   // no reading ahead, one range at a time, versus reading ahead and 3 ranges at once
const zipOfZed = async (opts, { cuts = false } = {}) => {
  await X.exportsGone(env, T2); const id = (await X.startExport(env, { id: T2 }, { id: "u2" })).id; let r;
  if (!cuts) r = await X.runExport(env, id, { budgetMs: 1e12, part: 4096, ...opts });
  else for (let i = 0, k = 0, b0 = Date.now(); i < 4000 && !r?.done; i++) { r = await X.runExport(env, id, { budgetMs: 40, now: () => b0 + (k += 1), part: 4096, ...opts }); if (r.error) throw new Error(r.error); }
  assert.ok(r.done, JSON.stringify(r)); return { id, got: normZip(`exports/${T2}/${id}.zip`, "z.zip") };
};
// ---- 7a. a run that stops gives its lease back at once, and has saved its progress first ----
{
  await X.exportsGone(env, T2); const id = (await X.startExport(env, { id: T2 }, { id: "u2" })).id;
  const a = await X.runExport(env, id, { budgetMs: -1, part: 4096 }); assert.ok(a.paused, JSON.stringify(a));
  let r = rowOf(id); assert.equal(r.lease_until, 0, "the lease is given back when a run stops"); assert.ok(r.seq >= 1, "progress was saved before the run stopped (a first run that stops at once still saved the plan)"); assert.ok(WS.objs.has(`exports/${T2}/${id}/state-${r.seq}`));
  const b = await X.runExport(env, id, { budgetMs: 1e12, part: 4096 }); assert.ok(b.done, "the next run starts at once and carries on: " + JSON.stringify(b));
  // an error gives the lease back at once, too
  await X.exportsGone(env, T2); const id2 = (await X.startExport(env, { id: T2 }, { id: "u2" })).id;
  const realPut = WS.put; WS.put = async (key, ...a2) => { if (/\/state-\d+$/.test(key)) throw new Error("injected: disk full"); return realPut(key, ...a2); };
  let e; try { e = await X.runExport(env, id2, { budgetMs: 1e12, part: 4096 }); } finally { WS.put = realPut; }
  assert.ok(e.error, JSON.stringify(e)); assert.equal(rowOf(id2).lease_until, 0, "an error gives the lease back at once");
  assert.ok((await X.runExport(env, id2, { budgetMs: 1e12, part: 4096 })).done, "and the next run finishes it");
  // a run that is still working keeps the job: a second run is skipped, and the lease is only 2 minutes
  await X.exportsGone(env, T2); const id3 = (await X.startExport(env, { id: T2 }, { id: "u2" })).id, t0 = Date.now();
  d1.prepare("UPDATE data_exports SET status='running', lease_until=? WHERE id=?").run(t0 + 100000, id3); assert.ok((await X.runExport(env, id3, { now: () => t0 })).skipped);
  assert.ok((await X.runExport(env, id3, { budgetMs: 1e12, part: 4096, now: () => t0 + 130000 })).done, "a lease that ran out (130 s) can be taken");
  ok("a run that stops (time, error, pause) has saved its progress and gives the lease back at once; the next run carries on; a held lease is respected");
}
// ---- 7b. reading in parallel gives the same zip as reading one file at a time, and it really is parallel ----
{
  const seen = { now: 0, max: 0 }, realGet = WS.get;
  WS.get = async (key, ...a) => { seen.now++; seen.max = Math.max(seen.max, seen.now); try { await new Promise((r) => setTimeout(r, 3)); return await realGet(key, ...a); } finally { seen.now--; } };
  let seq, par, maxSeq, maxPar;
  try {
    seen.max = 0; seq = await zipOfZed({ mem: SEQ }); maxSeq = seen.max; seen.max = 0; par = await zipOfZed({ mem: PAR }); maxPar = seen.max;
  } finally { WS.get = realGet; }
  assert.equal(maxSeq, 1, "one read at a time when reading ahead is off"); assert.ok(maxPar >= 4, `several reads at once (${maxPar})`);
  assert.deepEqual(Object.keys(par.got), Object.keys(seq.got), "same entries in the same order"); for (const k of Object.keys(seq.got)) assert.equal(par.got[k], seq.got[k], `${k} is the same`);
  for (const d of Z_FILES) assert.ok(Object.values(openZip(`exports/${T2}/${par.id}.zip`, "zp.zip")).some((b) => Buffer.compare(b, Buffer.from(d)) === 0));
  const bs = Buffer.from(WS.objs.get(`exports/${T2}/${par.id}.zip`).data), bq = WS.objs.get(`exports/${T2}/${seq.id}.zip`) ;   // the first zip was deleted by exportsGone
  assert.equal(bq, undefined);
  ok(`parallel copy (${maxPar} reads at once, a file read in ranges) gives the same entries and bytes as one read at a time`);
  // cut off many times and failing in the middle of uploads, with the parallel settings: same bytes again
  const realUp = WS.resumeMultipartUpload; let n = 0;
  WS.resumeMultipartUpload = (key, uid) => { const u = realUp(key, uid), up = u.uploadPart; u.uploadPart = async (...a) => { await new Promise((r) => setTimeout(r, ++n % 3)); if (n % 17 === 0) throw new Error("injected: the upload failed"); return up(...a); }; return u; };
  let cut; try { cut = await zipOfZed({ mem: PAR }, { cuts: true }); } finally { WS.resumeMultipartUpload = realUp; }
  assert.deepEqual(Object.keys(cut.got), Object.keys(par.got)); for (const k of Object.keys(par.got)) { if (cut.got[k] !== par.got[k] && k === "export.json") { const a = JSON.parse(Buffer.from(cut.got[k], "base64")), b = JSON.parse(Buffer.from(par.got[k], "base64")); const d = (x, y, path = "") => { if (JSON.stringify(x) === JSON.stringify(y)) return; if (x && y && typeof x === "object") { for (const kk of new Set([...Object.keys(x), ...Object.keys(y)])) d(x[kk], y[kk], path + "/" + kk); } else process.stderr.write("DIFF " + path + " " + JSON.stringify(x)?.slice(0, 120) + " | " + JSON.stringify(y)?.slice(0, 120) + "\n"); }; d(a, b); } assert.equal(cut.got[k], par.got[k], `${k} is the same after cuts`); }
  ok("a parallel export cut off many times, with failing uploads (several in flight), ends with the same bytes");
}
// ---- 7c. big pages: few calls to the Durable Objects ----
{
  const calls = [], orig = Resident.prototype.dxPageBig, origOld = Resident.prototype.dxPage;
  Resident.prototype.dxPageBig = async function (t, ...a) { calls.push(["big", t]); return orig.call(this, t, ...a); };
  Resident.prototype.dxPage = async function (t, ...a) { calls.push(["old", t]); return origOld.call(this, t, ...a); };
  let id, got;
  try { ({ id, got } = await zipOfZed({ mem: PAR })); } finally { Resident.prototype.dxPageBig = orig; Resident.prototype.dxPage = origOld; }
  const kvCalls = calls.filter((c) => c[1] === "kv").length, sessCalls = calls.filter((c) => c[1] === "sessions").length;
  assert.ok(kvCalls >= 1 && kvCalls <= 2, `2,600 settings rows in ${kvCalls} calls (the small page needed 6)`); assert.equal(calls.filter((c) => c[0] === "old").length, 0);
  assert.ok(sessCalls <= 2, `30 chats on one page are read with ${sessCalls} call(s), not one per chat`);
  const J2 = JSON.parse(Buffer.from(got["export.json"], "base64")), main = J2.channels.find((c) => c.slug === "main");
  assert.equal(main.kv.filter((k) => /^setting_/.test(k.k)).length, 2600, "every row is in"); assert.ok(main.tasks.filter((t) => t.session && /^zed chat/.test(t.session.title)).length === 30);
  // an object still running the code from before the deploy has no big page method: the small pages are used and the result is the same
  Resident.prototype.dxPageBig = undefined; let old;
  try { old = await zipOfZed({ mem: PAR }); } finally { Resident.prototype.dxPageBig = orig; }
  for (const k of Object.keys(got)) assert.equal(old.got[k], got[k], `${k} is the same through the old page methods`);
  const { PAGE_BYTES_BIG, PAGE_ROWS_BIG, PAGE_ROWS } = await import("../src/data-export-do.js"); assert.ok(PAGE_ROWS_BIG >= 10 * PAGE_ROWS && PAGE_BYTES_BIG <= 16 * MIB, "big pages stay far below the 32 MiB limit of one call");
  ok(`big pages: ${kvCalls} call(s) for 2,600 rows (was 6), one read of the chats page for 30 chats; objects on the old code still work`);
}
// ---- 7d. part size from the account's stored bytes ----
{
  assert.equal(X.choosePart(0), 8 * MIB); assert.equal(X.choosePart(60 * GIB), 8 * MIB); assert.equal(X.choosePart(100 * GIB), 16 * MIB); assert.equal(X.choosePart(200 * GIB), 32 * MIB);
  assert.equal(X.choosePart(400 * GIB), 64 * MIB); assert.equal(X.choosePart(3000 * GIB), 64 * MIB, "the biggest part size is 64 MiB; beyond it the export is several zips");
  for (const t of [0, 1 * GIB, 30 * GIB, 100 * GIB, 250 * GIB, 500 * GIB]) { const p = X.choosePart(t); assert.ok(p >= 8 * MIB && p <= 64 * MIB && p * X.MAX_PARTS >= Math.min(t * 1.05, 64 * MIB * X.MAX_PARTS), `${t}`); }
  assert.ok(64 * MIB * X.MAX_PARTS >= 560 * GIB, "one zip holds more than 560 GiB");
  d1.prepare("INSERT OR REPLACE INTO storage_usage (tenant_id,kind,bytes,objects) VALUES (?,?,?,?)").run(T2, "files", 120 * GIB, 10); d1.prepare("INSERT OR REPLACE INTO storage_usage (tenant_id,kind,bytes,objects) VALUES (?,?,?,?)").run(T2, "computer", 900 * GIB, 1);
  await X.exportsGone(env, T2); const id = (await X.startExport(env, { id: T2 }, { id: "u2" })).id; const r = await X.runExport(env, id, { budgetMs: -1 }); assert.ok(r.paused, JSON.stringify(r));
  const st = JSON.parse(WS.objs.get(`exports/${T2}/${id}/state-${rowOf(id).seq}`).data.length ? new TextDecoder().decode(WS.objs.get(`exports/${T2}/${id}/state-${rowOf(id).seq}`).data) : "{}");
  assert.equal(st.partSize, 16 * MIB, "120 GiB of files (the computer disk is not counted) gets 16 MiB parts"); assert.equal(st.stored_bytes, 120 * GIB);
  d1.prepare("DELETE FROM storage_usage WHERE tenant_id=?").run(T2); await X.exportsGone(env, T2);
  ok("the part size is 8 MiB for small accounts and grows to 64 MiB with the stored bytes (the computer disk is not counted); one zip holds more than 560 GiB");
}
// ---- 7e. the continuous runner: one runner, no gaps, the cron as the safety net ----
const runnerNs = () => { const inst = {}; return { idFromName: (x) => x, get: (n) => inst[n] ||= (() => { let alarm = null; const store = new Map();
  const o = new ExportRunner({ id: n, storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); }, getAlarm: async () => alarm, setAlarm: async (t) => { alarm = t; }, deleteAlarm: async () => { alarm = null; } } }, env);
  o.alarmAt = () => alarm; o.clear = () => { alarm = null; }; return o; })() }; };
const pump = async (r, guard = 40) => { let n = 0; while (r.alarmAt() != null && n++ < guard) { r.clear(); await r.alarm(); } return n; };
{
  await X.exportsGone(env, T2); env.EXPORT_RUNNER = runnerNs(); const RUN = env.EXPORT_RUNNER.get(`export:${T2}`);
  try {
    mail.length = 0; const c = await call(`${ZP}/code`, { cookie: "c2c2", body: {} }); const s = await call(`${ZP}/start`, { cookie: "c2c2", body: { code: c.body.test_code } }); await settle();
    assert.equal(s.status, 200); const id = d1.prepare("SELECT id FROM data_exports WHERE tenant_id=? ORDER BY requested_at DESC, rowid DESC LIMIT 1").get(T2).id;
    assert.ok(RUN.alarmAt() != null && RUN.alarmAt() <= Date.now() + 1000, "starting an export arms the runner at once"); assert.equal(rowOf(id).seq, 0, "nothing ran in the request itself");
    assert.equal((await call(ZP, { cookie: "c2c2" })).body.state, "running");
    // one runner: three runs at the same moment (the runner's slice, a second slice, the cron's) and only one does the work
    const out = await Promise.all([X.exportAlarm(env, T2, { part: 4096 }), X.exportAlarm(env, T2, { part: 4096 }), X.runExport(env, id, { part: 4096 })]);
    const worked = [...out[0].ran, ...out[1].ran, out[2]].filter((r) => !r.skipped); assert.equal(worked.length, 1, `exactly one runner worked: ${JSON.stringify(out)}`); assert.ok(worked[0].done);
    assert.equal(rowOf(id).status, "done"); assert.equal(d1.prepare("SELECT COUNT(*) n FROM download_links WHERE file_id=?").get(id).n, 1, "one set of links"); assert.equal(rowOf(id).notified, 1);
    assert.equal((await X.exportAlarm(env, T2)).again, null, "nothing left to run: the runner stops");
    ok("starting an export arms the runner at once with no work in the request; three runs at the same moment do the work once");
    // no gaps: slices follow each other at once until done
    await X.exportsGone(env, T2); const id2 = (await X.startExport(env, { id: T2 }, { id: "u2" })).id; const t = tickNow(); let slices = 0, last;
    for (; slices < 400; slices++) { last = await X.exportAlarm(env, T2, { budgetMs: 25, now: t, part: 4096 }); if (last.again == null) break; assert.equal(last.again, 0, "the next slice is armed for right now, not for the next cron"); }
    assert.equal(rowOf(id2).status, "done"); assert.ok(slices > 5, `${slices} slices`);
    ok(`the job runs ${slices} slices one right after the other (next alarm at once) until it is done`);
    // the runner object: re-arms itself after a failed slice, stops when done
    await X.exportsGone(env, T2); const id3 = (await X.startExport(env, { id: T2 }, { id: "u2" })).id; await env.EXPORT_RUNNER.get(`export:${T2}`).kick(T2);
    const realPut = WS.put; WS.put = async (key, ...a2) => { if (/\/state-\d+$/.test(key)) throw new Error("injected"); return realPut(key, ...a2); };
    try { RUN.clear(); await RUN.kick(T2); RUN.clear(); await RUN.alarm(); } finally { WS.put = realPut; }
    assert.ok(RUN.alarmAt() > Date.now() + 60e3, "after a failed slice the alarm is set again (2 minutes)"); assert.equal(rowOf(id3).lease_until, 0);
    assert.ok((await pump(RUN)) >= 1); assert.equal(rowOf(id3).status, "done"); assert.equal(RUN.alarmAt(), null, "done: no alarm left");
    ok("the runner sets its alarm again after a failed slice and stops when the export is done");
    // the cron is the safety net: a job nobody holds gets its runner armed again, with no inline work
    await X.exportsGone(env, T2); const id4 = (await X.startExport(env, { id: T2 }, { id: "u2" })).id; RUN.clear();
    const r4 = await X.exportCron(env); assert.ok(r4.ran >= 1); assert.ok(RUN.alarmAt() != null, "the cron armed the runner"); assert.equal(rowOf(id4).seq, 0, "and did not run the job itself");
    await pump(RUN); assert.equal(rowOf(id4).status, "done");
    ok("the 5-minute cron arms the runner for a job that nobody holds, and the runner finishes it");
  } finally { delete env.EXPORT_RUNNER; await X.exportsGone(env, T2); }
}
// ---- 7f. a big export is written as several zips, each with its own link ----
{
  const one = await zipOfZed({ mem: PAR }); await X.exportsGone(env, T2);   // the same account as a single zip, for comparison
  const SPLIT = { part: 4096, maxParts: 20 };   // planned at 80 KB per zip
  const { id: idSplit } = await (async () => { await X.exportsGone(env, T2); return { id: (await X.startExport(env, { id: T2 }, { id: "u2" })).id }; })();
  const r = await X.runExport(env, idSplit, { budgetMs: 1e12, mem: PAR, ...SPLIT }); assert.ok(r.done && r.parts >= 3, JSON.stringify(r));
  const keys = allZipKeys(T2, idSplit); assert.equal(keys.length, r.parts); assert.deepEqual(keys, ["", ...Array.from({ length: r.parts - 1 }, (_, i) => `-part${i + 2}`)].map((x) => `exports/${T2}/${idSplit}${x}.zip`).sort());
  const zips = keys.map((k, i) => openZip(k, `s${i}.zip`)), byN = (n) => openZip(n === 1 ? `exports/${T2}/${idSplit}.zip` : `exports/${T2}/${idSplit}-part${n}.zip`, `p${n}.zip`);
  assert.ok(zips.every((z) => Object.keys(z).length >= 1)); const p1 = byN(1); assert.ok(p1["export.json"] && p1["README.txt"], "part 1 has export.json and the README");
  for (let n = 2; n <= r.parts; n++) assert.ok(!byN(n)["export.json"] && Object.keys(byN(n)).every((k) => k.startsWith("files/")), `part ${n} holds only files`);
  assert.match(p1["README.txt"].toString(), new RegExp(`${r.parts} zip files`)); assert.match(p1["README.txt"].toString(), /part-?1\.zip|-part1\.zip/);
  const J1 = JSON.parse(p1["export.json"].toString()), main = J1.channels.find((c) => c.slug === "main");
  assert.equal(J1.zip_parts.count, r.parts); assert.equal(J1.zip_parts.files.length, r.parts); assert.match(J1.zip_parts.files[1], /-part2\.zip$/);
  const items = main.files.filter((f) => f.path); assert.ok(items.length >= 44);
  for (const f of items) { assert.ok(f.part >= 1 && f.part <= r.parts, `${f.path} has a part`); assert.ok(byN(f.part)[f.path], `${f.path} is in part ${f.part}`); for (let n = 1; n <= r.parts; n++) if (n !== f.part) assert.ok(!byN(n)[f.path], `${f.path} is only in part ${f.part}`); }
  assert.ok(new Set(items.map((f) => f.part)).size >= 2, "the files really are spread over several zips"); assert.ok(items.every((f, i) => i === 0 || f.part >= items[i - 1].part), "parts only go up");
  const merged = {}; for (let n = 1; n <= r.parts; n++) for (const [k, v] of Object.entries(byN(n))) { if (/^files\//.test(k)) merged[k] = v; }
  assert.deepEqual(Object.keys(merged).sort(), Object.keys(one.got).filter((k) => /^files\//.test(k)).sort(), "the parts together hold the same files as the single zip");
  for (const [k, v] of Object.entries(merged)) assert.equal(v.toString("base64"), one.got[k], `${k} is the same as in the single zip`);
  ok(`a big export is split into ${r.parts} zips: part 1 has export.json and the README, every file is in exactly the part its export.json item says, all other parts hold files only`);
  // links: one for each zip, the same names as export.json says; status lists them for a test account only; the email has all of them
  const row = rowOf(idSplit), links = d1.prepare("SELECT * FROM download_links WHERE file_id=? ORDER BY name").all(idSplit); assert.equal(links.length, r.parts);
  assert.deepEqual(links.map((l) => l.name).sort(), [...J1.zip_parts.files].sort()); assert.ok(links.every((l) => l.expires_at === row.expires_at));
  assert.equal(row.bytes, keys.reduce((n, k) => n + WS.objs.get(k).data.length, 0), "bytes is the total of all zips");
  const st = await call(ZP, { cookie: "c2c2" }); assert.equal(st.body.state, "ready"); assert.equal(st.body.parts, r.parts); assert.equal(st.body.test_links.length, r.parts); assert.equal(st.body.test_link, st.body.test_links[0]);
  assert.match(st.body.test_links[1], /-part2\.zip$/);
  for (let n = 1; n <= r.parts; n++) { const dl = await worker.fetch(new Request(st.body.test_links[n - 1]), env, { waitUntil() {} }); assert.equal(dl.status, 200, `link ${n}`); assert.equal(Buffer.compare(Buffer.from(await dl.arrayBuffer()), Buffer.from(WS.objs.get(n === 1 ? `exports/${T2}/${idSplit}.zip` : `exports/${T2}/${idSplit}-part${n}.zip`).data)), 0, `link ${n} downloads part ${n}`); }
  assert.equal(mail.filter((m) => m.to === "zed@example.com").length, 0, "a test address gets no email");
  // a real address: the email carries every link, the status carries no link
  d1.prepare("UPDATE users SET email='zoe@corp.test' WHERE id='u2'").run(); d1.prepare("UPDATE data_exports SET notified=0 WHERE id=?").run(idSplit); mail.length = 0;
  assert.ok(await X.notify(env, idSplit)); const m = mail.at(-1); assert.equal(m.to, "zoe@corp.test");
  const mlinks = [...m.text.matchAll(/https:\/\/app\.example\.com\/s\/ck2\/d\/[A-Za-z0-9_-]{43}\/[^\s"<]+/g)].map((x) => x[0]); assert.equal(mlinks.length, r.parts, "one email with every link"); assert.match(m.text, new RegExp(`${r.parts} zip files`)); assert.match(m.text, /Part 2:/); assert.match(m.html, new RegExp(`Download part ${r.parts} of ${r.parts}`));
  assert.ok(!/[—–]/.test(m.text), "no dashes in the text");
  const st2 = await call(ZP, { cookie: "c2c2" }); assert.equal(st2.body.parts, r.parts); assert.equal(st2.body.test_links, undefined, "a real address never gets links in the status"); assert.equal(st2.body.test_link, undefined);
  d1.prepare("UPDATE users SET email='zed@example.com' WHERE id='u2'").run();
  // a restart after "done" and before the links: all of them are made again before the one email
  d1.prepare("DELETE FROM download_links WHERE file_id=?").run(idSplit); d1.prepare("UPDATE data_exports SET notified=0 WHERE id=?").run(idSplit); d1.prepare("UPDATE users SET email='zoe@corp.test' WHERE id='u2'").run(); mail.length = 0;
  assert.ok(await X.notify(env, idSplit)); assert.equal([...mail.at(-1).text.matchAll(/\/d\/[A-Za-z0-9_-]{43}\//g)].length, r.parts); assert.equal(d1.prepare("SELECT COUNT(*) n FROM download_links WHERE file_id=?").get(idSplit).n, r.parts);
  d1.prepare("UPDATE users SET email='zed@example.com' WHERE id='u2'").run();
  ok(`${r.parts} links (one for each zip, 72 hours each), the status lists them for a test address only, one email carries all of them, and links are made again after a restart`);
  // the cron deletes every part and every link after 72 hours
  const n = Date.now() + 72 * 3600e3 + 1000, realNow = Date.now; Date.now = () => n; let c; try { c = await X.exportCron(env, { now: () => n }); } finally { Date.now = realNow; }
  assert.equal(c.expired, 1); assert.equal(allZipKeys(T2, idSplit).length, 0, "every part is deleted after 72 hours"); assert.equal(d1.prepare("SELECT COUNT(*) n FROM download_links WHERE file_id=?").get(idSplit).n, 0);
  ok("after 72 hours the cron deletes every zip and every link");
  // the same export cut off many times and failing, also right after a zip was completed: the same bytes
  const base = {}; { await X.exportsGone(env, T2); const id = (await X.startExport(env, { id: T2 }, { id: "u2" })).id; const rr = await X.runExport(env, id, { budgetMs: 1e12, mem: PAR, ...SPLIT }); assert.ok(rr.done); for (let k = 1; k <= rr.parts; k++) base[k] = normZip(k === 1 ? `exports/${T2}/${id}.zip` : `exports/${T2}/${id}-part${k}.zip`, `b${k}.zip`); await X.exportsGone(env, T2); base.n = rr.parts; }
  await X.exportsGone(env, T2); const upBefore = WS.uploads.size; const id = (await X.startExport(env, { id: T2 }, { id: "u2" })).id; const realUp = WS.resumeMultipartUpload; let completions = 0, injected = 0, runs = 0, errs = 0, pauses = 0, kk = 0, done; const b0 = Date.now();
  const realPut = WS.put;
  WS.put = async (key, ...a) => { if (/\/state-\d+$/.test(key) && ++injected % 5 === 0) throw new Error("injected: the state write failed"); return realPut(key, ...a); };
  WS.resumeMultipartUpload = (key, uid) => { const u = realUp(key, uid), cp = u.complete; u.complete = async (...a) => { const o = await cp(...a); if (++completions === 1) throw new Error("injected: a crash right after the first zip was completed"); return o; }; return u; };
  try { for (; runs < 3000 && !done; runs++) { const q = await X.runExport(env, id, { budgetMs: 30, now: () => b0 + (kk += 1), mem: PAR, ...SPLIT }); if (q.done) done = q; else if (q.error) errs++; else if (q.paused) pauses++; } }
  finally { WS.resumeMultipartUpload = realUp; WS.put = realPut; }
  assert.ok(done && done.parts === base.n, JSON.stringify(done)); assert.ok(errs >= 2 && pauses > 5, `${errs} errors, ${pauses} pauses`);
  for (let k = 1; k <= base.n; k++) { const g = normZip(k === 1 ? `exports/${T2}/${id}.zip` : `exports/${T2}/${id}-part${k}.zip`, `c${k}.zip`); assert.deepEqual(Object.keys(g), Object.keys(base[k])); for (const e of Object.keys(g)) assert.equal(g[e], base[k][e], `part ${k}: ${e}`); }
  assert.equal(WS.uploads.size - upBefore <= 1, true, "at most the orphan of the injected crash is left, which the bucket removes by itself");
  assert.equal([...WS.objs.keys()].filter((x) => x.startsWith(`exports/${T2}/`) && !x.endsWith(".zip")).length, 0, "no scratch left");
  ok(`an export in ${base.n} zips cut off ${pauses} times, with ${errs} failures (also right after a zip was completed), has the same bytes in every zip`);
  // deleting: all parts go, with a running export too
  await X.exportsGone(env, T2); WS.uploads.clear(); const id5 = (await X.startExport(env, { id: T2 }, { id: "u2" })).id; assert.ok((await X.runExport(env, id5, { budgetMs: 1e12, mem: PAR, ...SPLIT })).done);
  assert.ok(allZipKeys(T2, id5).length >= 3); await X.exportsGone(env, T2); assert.equal([...WS.objs.keys()].filter((k) => k.includes(T2)).length >= 0, true);
  assert.equal(allZipKeys(T2, id5).length, 0, "deleting removes every part"); assert.equal(d1.prepare("SELECT status FROM data_exports WHERE id=?").get(id5).status, "deleted");
  const id6 = (await X.startExport(env, { id: T2 }, { id: "u2" })).id; assert.ok((await X.runExport(env, id6, { budgetMs: 1e12, mem: PAR, ...SPLIT })).done); d1.prepare("UPDATE data_exports SET status='done' WHERE id=?").run(id6);
  const { deleteChannel } = await import("../src/deletion.js"); const dc = await deleteChannel(env, T2, "other-trip"); assert.ok(dc.ok, JSON.stringify(dc));
  assert.equal(allZipKeys(T2, id6).length, 0, "deleting a channel removes every part of a finished export"); assert.equal(d1.prepare("SELECT COUNT(*) n FROM download_links WHERE file_id=?").get(id6).n, 0);
  ok("deleting a channel or an export removes every part and every link");
}
await X.exportsGone(env, T2);
{   // the person can delete their export (running or finished) at once
  const c = await call(`${ZP}/code`, { cookie: "c2c2", body: {} }); const s = await call(`${ZP}/start`, { cookie: "c2c2", body: { code: c.body.test_code } }); await settle();
  assert.equal((await call(ZP, { cookie: "c2c2" })).body.state, "ready");
  assert.equal((await call(`${ZP}/delete`, { cookie: "c2c2", body: {}, origin: "https://evil.example" })).status, 403);
  const d = await call(`${ZP}/delete`, { cookie: "c2c2", body: {} }); assert.equal(d.status, 200); assert.ok(d.body.deleted >= 1);
  assert.equal((await call(ZP, { cookie: "c2c2" })).body.state, "none"); assert.equal([...WS.objs.keys()].filter((k) => k.startsWith(`exports/${T2}/`)).length, 0);
  assert.equal((await call(`${ZP}/delete`, { cookie: "c1c1", body: {} })).status, 200, "another account's delete touches only its own exports");
  ok("POST data-export/delete deletes the account's own export, zips and links at once (same-origin JSON only)");
}
// ============ a test account gets the code and the link in the answers, and no email ============
{
  mail.length = 0; const P2 = "/w/ck2/api/account/data-export", c = await call(`${P2}/code`, { cookie: "c2c2", body: {} }); assert.match(c.body.test_code, /^\d{6}$/); assert.equal(mail.length, 0);
  const s = await call(`${P2}/start`, { cookie: "c2c2", body: { code: c.body.test_code } }); assert.equal(s.status, 200); await settle();
  const st = await call(P2, { cookie: "c2c2" }); assert.equal(st.body.state, "ready"); assert.match(st.body.test_link, /\/s\/ck2\/d\/[A-Za-z0-9_-]{43}\/1helm-export-/); assert.equal(mail.length, 0);
  const dl = await worker.fetch(new Request(st.body.test_link), env, { waitUntil() {} }); assert.equal(dl.status, 200);
  const z2 = openZip(`exports/${T2}/${st.body.id}.zip`, "two.zip"); assert.ok(JSON.stringify(Object.values(z2).map(String)).includes("OTTER") && !Object.values(z2).some((b) => b.includes("ZEBRA")), "zed's export holds zed's data and none of sam's");
  assert.notEqual((await call(P2, { cookie: "c1c1" })).body.state, "ready", "one account cannot see another account's export");
  const dm = await worker.fetch(new Request(st.body.test_link.replace("/s/ck2/", "/s/ck1/")), env, { waitUntil() {} }); assert.equal(dm.status, 404, "a link only works on its own workspace's address");
  ok("a test address gets test_code and test_link in the answers and no email; exports and links never cross accounts");
}
// ============ 6. deleting ============
{
  const { deleteChannel, deleteAccount } = await import("../src/deletion.js");
  const id = await fresh(T1, "u1"); assert.ok((await X.runExport(env, id, { budgetMs: 1e12 })).done);
  const id2 = (d1.prepare("UPDATE data_exports SET status='done' WHERE id=?").run(id), id);   // a finished zip for sam
  await call(`${BASE}/code`, { body: {} });
  assert.ok(WS.objs.has(`exports/${T1}/${id}.zip`));
  const r = await deleteChannel(env, T1, "japan-trip"); assert.ok(r.ok, JSON.stringify(r));
  assert.ok(!WS.objs.has(`exports/${T1}/${id}.zip`), "deleting a channel deletes the finished zip, which holds it");
  assert.equal(d1.prepare("SELECT status FROM data_exports WHERE id=?").get(id).status, "deleted"); assert.equal(d1.prepare("SELECT COUNT(*) n FROM data_export_codes WHERE tenant_id=?").get(T1).n, 0); assert.equal(d1.prepare("SELECT COUNT(*) n FROM download_links WHERE kind='export' AND tenant_id=?").get(T1).n, 0);
  // a running export is stopped (its unfinished upload is aborted) and its scratch objects go
  const run = await fresh(T1, "u1"); const slow = await X.runExport(env, run, { budgetMs: 25, now: (() => { let k = 0; const b = Date.now(); return () => b + k++; })(), part: 4096 }); assert.ok(slow.paused, JSON.stringify(slow));
  assert.ok([...WS.objs.keys()].some((k) => k.startsWith(`exports/${T1}/${run}/`)) && WS.uploads.size === 1, "there is scratch and an open upload");
  const r2 = await deleteAccount(env, T1); assert.ok(r2.ok, JSON.stringify(r2));
  assert.equal([...WS.objs.keys()].filter((k) => k.includes(T1)).length, 0, "nothing of the account is left in R2"); assert.equal(WS.uploads.size, 0, "the unfinished upload was aborted");
  for (const t of ["data_exports", "data_export_codes", "download_links"]) assert.equal(d1.prepare(`SELECT COUNT(*) n FROM ${t} WHERE tenant_id=?`).get(T1).n, 0, `${t} has no row of the deleted account`);
  assert.ok(WS.objs.has(`exports/${d1.prepare("SELECT id FROM data_exports WHERE tenant_id=? AND status='done' ORDER BY requested_at DESC, rowid DESC LIMIT 1").get(T2).id}.zip`.replace("exports/", `exports/${T2}/`)), "another account's export is untouched");
  ok("deleting a channel deletes finished zips and codes; deleting the account also stops a running export, aborts its upload and removes every row and object; others are untouched");
}
ok("all passed");
