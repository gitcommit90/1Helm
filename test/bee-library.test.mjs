// node --import ./test/stubs/register.mjs test/bee-library.test.mjs
// General's Library, Bee conversations (src/bee-library.js, and the lib* methods of src/bee-sync.js).
// The real BeeSync DO (node:sqlite), the real Worker routes, the real memory and Ledger, R2 and General's Resident faked at their edges (as in bee-sync.test.mjs).
//  - an account with no Bee data gets an empty list and no BeeSync object is made for it;
//  - the list: newest first, paged with a cursor, the row facts (times, duration, summary, place, lines); an older row with no list columns is filled from R2 once;
//  - the transcript: lines with times and speakers, a contact's name from speaker_map, "You" for the wearer, "Unknown" for no label; a saved transcript is read with no Bee call;
//  - the .txt and .md exports (header in the person's time zone, "[time] Speaker: text" per line);
//  - owner only; an account that disconnected Bee and kept its transcripts still lists them;
//  - delete: memory document, R2 object, convs row, stored lines and speaker rows go, and neither the change feed nor the import list brings it back.
//  - the transport of a sync run (retries, Retry-After, 401) is tested in test/bee-api.test.mjs.
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { readFileSync, readdirSync } from "node:fs"; import { createHash } from "node:crypto";
import worker, { Ledger } from "../src/index.js"; import { retainV2, forgetDocument, bankId } from "../src/mem0.js"; import { fakeIndex, embedding } from "./helpers/mem0-fakes.mjs"; import { hsRawNano } from "../src/byok.js";
import * as B from "../src/ee/bee.js";
import { beeTiming } from "../src/ee/bee-api.js";
import { installBeeFetch } from "./stubs/bee-fetch.mjs";
import * as S from "../src/ee/bee-sync.js";
import { sealSecret } from "../src/sentinel.js";

const log0 = console.log, LOGS = []; for (const k of ["log", "error", "warn", "info"]) console[k] = (...a) => { const s = a.map((x) => typeof x === "string" ? x : JSON.stringify(x)).join(" "); if (/^ {2}ok /.test(s)) log0(s); else LOGS.push(s); };
process.on("exit", (c) => { if (c) log0(LOGS.slice(-30).join("\n")); });
const ok = (name) => console.log("  ok", name);

// ---- D1 ----
const d1 = new DatabaseSync(":memory:");
for (const f of ["0001_012_full_schema_dev.sql", "0009_020_interview.sql", "0017_026_plan_cancel.sql", "0020_029_storage.sql", "0024_033_pastdue.sql", "0026_035_ops_debug.sql", "0030_039_bee.sql", "0031_040_bee_sync.sql"]) d1.exec(readFileSync(new URL(`../db/migrations/${f}`, import.meta.url), "utf8"));
for (const q of readFileSync(new URL("../db/migrations/0021_030_account.sql", import.meta.url), "utf8").replace(/--.*$/gm, "").split(";")) { try { if (q.trim()) d1.exec(q); } catch {} }
d1.exec(readFileSync(new URL("../db/migrations/0063_memory.sql", import.meta.url), "utf8"));
const DB = { batch: async (list) => { const out = []; for (const s of list) out.push(await s.run()); return out; }, prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }),
  run: async () => ({ meta: { changes: Number(st.run(...a).changes) } }) }; return o; } };
const sha = (s) => createHash("sha256").update(s).digest("hex"), T0 = Date.UTC(2026, 9, 7, 19, 0, 0);   // Oct 7, noon in California
d1.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u1", "chk+beesync@example.com", T0);
d1.prepare("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)").run(sha("abcd1"), "u1", T0 + 864e5 * 30);
d1.prepare("INSERT INTO tenants (id,slug,owner_user_id,status,stripe_customer,stripe_subscription,created_at,updated_at,onboarding_completed,sub_status,plan) VALUES (?,?,?,?,?,?,?,?,1,'active',?)").run("t1", "ck1", "u1", "active", "cus_t1", "sub_1", T0, T0, "plus");
d1.prepare("INSERT INTO interviews (tenant_id,session_id,status,step,answers,known,created_at,updated_at) VALUES ('t1','x','open',0,'{}','{}',?,?)").run(T0, T0);

let clock = T0; const realNow = Date.now; Date.now = () => clock; const tick = (ms) => { clock += ms; };
const H = 3600e3, M = 60e3;

// ---- DO storage on node:sqlite ----
const mkSql = (db) => ({ exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
  const st = db.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } });

// ---- the Ledger (real), recording reserve / settle; `refuse` makes one kind of reservation fail ----
const L = new Ledger({ storage: { sql: mkSql(new DatabaseSync(":memory:")), transactionSync: (f) => f() } }, {});
const LED = []; let refuse = null;
const LEDGER = { idFromName: (x) => x, get: () => ({
  reserve: async (id, n) => { if (refuse && id.startsWith(refuse)) { LED.push(["reserve", id, n, false]); return { ok: false, reason: "out_of_credits" }; } const r = await L.reserve(id, n); LED.push(["reserve", id, n, r.ok]); return r; },
  settle: async (id, n) => { LED.push(["settle", id, n]); return L.settle(id, n); }, state: () => L.state() }) };
await L.grant("g1", 5e9, "topup");   // $5

// ---- the memory, as General's Resident receives it ----
const HS = [];   // every put and delete General's Resident received, in order
const docsOf = () => d1.prepare("SELECT DISTINCT json_extract(payload,'$.doc') d FROM mem ORDER BY d").all().map((r) => r.d);   // the documents the memory holds

// ---- R2 ----
const R2 = new Map();
const WS = { put: async (k, body) => { const b = typeof body === "string" ? body : String(body); R2.set(k, b); return { size: Buffer.byteLength(b) }; },
  head: async (k) => R2.has(k) ? { size: Buffer.byteLength(R2.get(k)) } : null, get: async (k) => R2.has(k) ? { text: async () => R2.get(k) } : null,
  delete: async (ks) => { for (const k of [].concat(ks)) R2.delete(k); }, list: async ({ prefix }) => ({ objects: [...R2.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, size: Buffer.byteLength(R2.get(key)) })), truncated: false }) };
const usage = () => d1.prepare("SELECT kind, bytes, objects FROM storage_usage WHERE tenant_id='t1' AND kind='other'").get() || { bytes: 0, objects: 0 };

// ---- Bee (fake), answering like the real API ----
const TOKEN = "bee-dev-token-" + "Hx4".repeat(16), TOKEN2 = "bee-dev-token-two-" + "Rk8".repeat(12);
const BEE = { token: TOKEN, convs: new Map(), deleted: new Map(), shape: "raw", rejectCursor: false, fail: null, calls: [], page: 50 };
const utter = (id, at, text, speaker = "Unknown") => ({ id, realtime: false, start: 0, end: 3.2, spoken_at: at, text, speaker, created_at: at });
function conv(id, { start, end = start + 30 * M, short = `Conversation ${id}`, summary = `## Summary\nTalked about item ${id}.`, updated = clock, live = false } = {}) {
  return { id, start_time: start, end_time: live ? null : end, device_type: "bee", summary: live ? null : summary, short_summary: short, state: live ? "CAPTURING" : "COMPLETED",
    created_at: start, updated_at: updated, transcriptions: [{ id: id * 10, realtime: !live, utterances: [utter(id * 100, start + 1000, `hello from ${id}`), utter(id * 100 + 1, start + 5000, "ok sounds good", "Joseph")] }],
    suggested_links: [], primary_location: { address: "1 Ferry Building, San Francisco, CA", latitude: 37.7955, longitude: -122.3937, created_at: start } };
}
const put = (c) => BEE.convs.set(c.id, c);
function bee(path, token) {
  BEE.calls.push(path);
  if (token !== BEE.token) return { status: 401, body: JSON.stringify({ error: "Unauthorized" }) };
  if (BEE.fail) { const f = BEE.fail(path); if (f) return f; }
  const u = new URL("https://x" + path);
  if (u.pathname === "/v1/changes") {
    const cur = u.searchParams.get("cursor");
    if (cur && BEE.rejectCursor) return { status: 400, body: JSON.stringify({ error: "cursor_too_old" }) };
    const since = cur ? Number(cur.slice(3)) : clock - 24 * H, until = clock;
    const changed = [...BEE.convs.values()].filter((c) => c.updated_at > since && c.updated_at <= until), gone = [...BEE.deleted].filter(([, at]) => at > since && at <= until).map(([id]) => id);
    const meta = { next_cursor: `v1-${until}`, since, until, updated: changed.length + gone.length > 0, timezone: "America/Los_Angeles" };
    if (BEE.shape === "cli") return { status: 200, body: JSON.stringify({ meta, facts: [], todos: [], dailies: [], conversations: changed, journals: [] }) };   // bee-data-shapes.json "changed"
    return { status: 200, body: JSON.stringify({ facts: [9001], conversations: [...changed.map((c) => c.id), ...gone], dailies: [], journals: [], todos: [], ...meta }) };   // CLI parseChangesResponse
  }
  if (u.pathname === "/v1/conversations") {   // the list, newest first, paged by an opaque cursor (BEE.page per page)
    const all = [...BEE.convs.values()].sort((a, b) => b.start_time - a.start_time), at = Number(u.searchParams.get("cursor")?.slice(2) || 0), n = Math.min(Number(u.searchParams.get("limit")) || 50, BEE.page);
    const page = all.slice(at, at + n).map(({ transcriptions, ...c }) => c);
    return { status: 200, body: JSON.stringify({ conversations: page, next_cursor: at + n < all.length ? `p-${at + n}` : null, timezone: "America/Los_Angeles" }) };
  }
  const m = /^\/v1\/conversations\/(\d+)$/.exec(u.pathname);
  if (m) { const c = BEE.convs.get(Number(m[1])); return c ? { status: 200, body: JSON.stringify({ conversation: c, timezone: "America/Los_Angeles" }) } : { status: 404, body: JSON.stringify({ error: "Conversation not found" }) }; }
  return { status: 404, body: "{}" };
}
// Bee behind fetch: /v1/me (step 2) or the real syncCore's reads against the fake Bee. JOBS holds each run's input (the token is checked on the requests).
const JOBS = []; let me = () => ({ status: 200, body: JSON.stringify({ id: 53828, first_name: "Joseph", last_name: "Y" }) });
const shim = installBeeFetch(async (method, path, token) => path === "/v1/me" ? me() : bee(path, token));
beeTiming.tap = (kind, input) => JOBS.push({ input: { kind, ...JSON.parse(JSON.stringify(input)) } });
const syncJobs = () => JOBS.filter((j) => j.input.kind === "sync");

// ---- the BeeSync DOs (real class), with alarms we fire by hand ----
const DOS = new Map(); const ALARM = { at: null, sets: 0 };
const BEE_SYNC = { idFromName: (n) => n, get: (id) => { if (!DOS.has(id)) { const db = new DatabaseSync(":memory:");
  const ctx = { storage: { sql: mkSql(db), getAlarm: async () => ALARM.at, setAlarm: async (t) => { ALARM.at = t; ALARM.sets++; }, deleteAlarm: async () => { ALARM.at = null; },
    deleteAll: async () => { for (const r of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()) db.exec(`DROP TABLE "${r.name}"`); ALARM.at = null; } }, _db: db };
  DOS.set(id, new S.BeeSync(ctx, env)); } return DOS.get(id); } };
const DO = () => BEE_SYNC.get("t1");
const fire = async () => { ALARM.at = null; await DO().alarm(); };
// The live sync is adaptive (5 min while busy, 10 → 20 → 30 min when quiet): wait at least `ms`, or until it is due.
const toDue = (ms) => tick(Math.max(ms, DO().dueAt() - clock));

const VAULT_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 11)).toString("base64");
// General's Resident as the Bee sync reaches it with HS_WRITERS on: hsBeePut puts the recording's words (its transcript lines) into General's bank as document bee:conv:<id>, and hsDrop deletes documents.
const GENERAL_RES = { bind: async () => {}, tz: () => "America/Los_Angeles", hsInboxPut: async () => ({ ok: true }), hsBeePut: async (a) => { const item = { document_id: `bee:conv:${a.id}`, content: a.lines.map((l) => l.text).join("\n"), at: a.at, strategy: "raw-transcript", tags: ["source:bee", "kind:raw"] }; HS.push({ method: "POST", doc: item.document_id, item, raw: item.content }); await retainV2(env, bankId(env, "t1", "main"), [item]); return { success: true }; },
  hsDrop: async (docs) => { for (const d of docs) { HS.push({ method: "DELETE", doc: d, raw: "" }); await forgetDocument(env, bankId(env, "t1", "main"), d); } return docs.length; } };
const env = { ONEHELM_EE: "1hc", DB, VAULT_KEY, BEE_APP_ID: "ph9fssu1kv1b0hns69fxf7rx", BEE_SYNC, LEDGER, MEMORY_INDEX: fakeIndex(), AI: { run: async (_m, i) => ({ data: i.text.map(embedding), usage: {} }) }, HS_FOUNDATIONS: "on", HS_WRITERS: "on", WS,
  ENV_NAME: "dev", APP_HOST: "app.example.test", TEST_MODE: "1", ARCHIVE: { idFromName: (x) => x, get: () => ({ channels: async () => [{ id: 1, slug: "main", name: "General" }] }) }, RESIDENT: { idFromName: (x) => x, get: () => GENERAL_RES } };
const BODIES = [];
const call = async (op, body) => { const r = await worker.fetch(new Request(`https://app.example.test/w/ck1/api/bee${op ? "/" + op : ""}`, { method: op ? "POST" : "GET", headers: { cookie: "hc_session=abcd1", "content-type": "application/json" }, ...(op ? { body: JSON.stringify(body || {}) } : {}) }), env, { waitUntil() {} });
  const t = await r.text(); BODIES.push(t); return { status: r.status, ...JSON.parse(t) }; };
const account = () => d1.prepare("SELECT * FROM bee_accounts WHERE tenant_id='t1'").get();
const events = () => d1.prepare("SELECT what FROM bee_events WHERE tenant_id='t1' ORDER BY id").all().map((e) => e.what);
const lastEvent = () => events().at(-1);
const posts = () => HS.filter((h) => h.method === "POST");
// Connect the way bee.js does it: token sealed, status verifying, then a poll runs /v1/me → connected → BeeSync.start.
async function connect(token) {
  d1.prepare("INSERT INTO bee_accounts (tenant_id,token_sealed,status,connected_at,check_next_at) VALUES (?,?,'verifying',?,0) ON CONFLICT(tenant_id) DO UPDATE SET token_sealed=excluded.token_sealed,status='verifying',check_next_at=0")
    .run("t1", await sealSecret(env, token), clock);
  return call("poll");
}

// ---- helpers ----
const W = (path, o = {}) => worker.fetch(new Request(`https://app.example.test/w/ck1/api/library/bee/conversations${path}`, { method: o.method || "GET", headers: o.nocookie ? {} : { cookie: "hc_session=abcd1" } }), env, { waitUntil() {} });
const J = async (path, o) => { const r = await W(path, o); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, j, text: t, headers: r.headers }; };
const sqlRows = (q, ...a) => DO().sql.exec(q, ...a).toArray();
const u = (id, at, text, speaker) => ({ id, realtime: false, start: 0, end: 2, spoken_at: at, text, ...(speaker === undefined ? {} : { speaker }), created_at: at });
const mk = (id, start, mins, utterances, extra = {}) => ({ id, start_time: start, end_time: start + mins * M, device_type: "bee", state: "COMPLETED", created_at: start, updated_at: start + mins * M, timezone: "America/Los_Angeles",
  short_summary: `Summary ${id}`, summary: `Long summary ${id}`, primary_location: { address: `${id} Market St, San Francisco, CA`, latitude: 37.79, longitude: -122.4, created_at: start },
  transcriptions: [{ id: id * 10, realtime: false, utterances }], ...extra });
const BASE = Date.UTC(2026, 9, 1, 17, 0, 0);   // Oct 1, 10:00 in California

// ---- 1. an account with no Bee data: an empty list, and no BeeSync object is made ----
{ const r = await J(""); assert.equal(r.status, 200); assert.deepEqual(r.j.items, []); assert.equal(r.j.total, 0); assert.equal(r.j.next, null); assert.equal(r.j.tz, "America/Los_Angeles");
  assert.equal(DOS.size, 0, "no BeeSync object was woken for an account with no Bee data");
  assert.equal((await J("/201")).status, 404); assert.equal((await J("/201/export?format=txt")).status, 404); assert.equal((await J("/201/delete", { method: "POST" })).status, 404); assert.equal(DOS.size, 0);
  assert.equal(BEE.calls.length, 0, "no Bee call"); }
ok("no Bee data: empty list, 404 for one conversation, no BeeSync object made, no Bee call");

// ---- 2. seed seven conversations the way a sync stores them (R2 copy, convs row, memory document) ----
for (let i = 0; i < 7; i++) {
  const id = 201 + i, start = BASE + i * 2 * H;
  await DO().testConvPut("t1", mk(id, start, 5 + i, [u(id * 100, start + 1000, `first words of ${id}`, "Joseph"), u(id * 100 + 1, start + 61000, `second words of ${id}`, "Unknown")]));
}
// 205: every kind of speaker. 3200 characters in one utterance: ambientLines cuts at 3000, the Library joins it again.
const S5 = BASE + 4 * 2 * H, LONG = "x".repeat(3200);
await DO().testConvPut("t1", mk(205, S5 + 0, 12, [
  u(20500, S5 + 1000, "Hi, I'm back", { id: "me", is_user: true }), u(20501, S5 + 5000, "Welcome back to the office", "Dana"), u(20502, S5 + 9000, "Who is this?", "Unknown"),
  u(20503, S5 + 12000, "no label at all"), u(20504, S5 + 15000, LONG, "Dana"), u(20505, S5 + 20000, "Line with\nnew line", "Priya")], { end_time: S5 + 12 * M + 10e3 }));
assert.equal(R2.size, 7); assert.equal(docsOf().length, 7);
d1.prepare("INSERT INTO bee_events (tenant_id,at,what) VALUES ('t1',?,'connected')").run(clock);   // what the first connection writes; it stays after a disconnect
ok("seeded seven conversations: R2, convs and memory");

// ---- 3. the list: newest first, paged, with the row facts ----
{ const p1 = await J("?limit=3"); assert.equal(p1.status, 200); assert.deepEqual(p1.j.items.map((x) => x.id), [207, 206, 205]); assert.equal(p1.j.total, 7); assert.ok(p1.j.next);
  const x = p1.j.items[2]; assert.equal(x.start, S5); assert.equal(x.end, S5 + 12 * M + 10e3); assert.equal(x.duration_ms, 12 * M + 10e3); assert.equal(x.summary, "Summary 205"); assert.equal(x.place, "205 Market St, San Francisco, CA"); assert.equal(x.lines, 6);
  const p2 = await J(`?limit=3&cursor=${p1.j.next}`); assert.deepEqual(p2.j.items.map((y) => y.id), [204, 203, 202]); assert.ok(p2.j.next);
  const p3 = await J(`?limit=3&cursor=${p2.j.next}`); assert.deepEqual(p3.j.items.map((y) => y.id), [201]); assert.equal(p3.j.next, null);
  const all = await J("?limit=500"); assert.equal(all.j.items.length, 7, "the page size is capped but seven fit"); assert.equal((await J("?limit=2&cursor=garbage")).j.items.length, 2, "a bad cursor starts at the top");
  // a conversation that starts later shows first, and a page already fetched is not shifted (keyset)
  await DO().testConvPut("t1", mk(208, BASE + 100 * H, 3, [u(1, BASE + 100 * H + 1000, "late one", "Joseph")]));
  assert.deepEqual((await J(`?limit=3&cursor=${p1.j.next}`)).j.items.map((y) => y.id), [204, 203, 202], "a new newest row does not move the next page");
  assert.deepEqual((await J("?limit=2")).j.items.map((y) => y.id), [208, 207]);
  // a name the provider gave the place wins over the address; a row with no place and no summary still lists
  await DO().testConvPut("t1", mk(209, BASE + 101 * H, 3, [u(2, BASE + 101 * H + 1000, "x y", "Joseph")], { short_summary: "", primary_location: { name: "Blue Bottle Coffee", address: "66 Mint St" } }));
  const n = (await J("?limit=1")).j.items[0]; assert.equal(n.id, 209); assert.equal(n.place, "Blue Bottle Coffee"); assert.equal(n.summary, null);
  await DO().testConvClear("t1", [208, 209]); }
ok("list: newest first, cursor paging (a new row doesn't shift a page), row facts, place name over address");

// an older row (saved before the list columns) is filled from its R2 copy the first time the list reaches it
{ DO().sql.exec("UPDATE convs SET lines=NULL, summary=NULL, place=NULL, meta_v=NULL WHERE id=203");
  const x = (await J("?limit=7")).j.items.find((y) => y.id === 203); assert.deepEqual([x.summary, x.place, x.lines], ["Summary 203", "203 Market St, San Francisco, CA", 2]); assert.equal(sqlRows("SELECT meta_v FROM convs WHERE id=203")[0].meta_v, 1, "filled once"); }
ok("an older row is filled from R2 once");

// ---- 4. the transcript: times, speakers, contact names, no Bee call ----
DO().spkInit(); DO().sql.exec("INSERT INTO speaker_map (k, label, person, person_name, rec, at) VALUES ('dana','Dana','p1','Dana Reyes','199',?)", clock);
{ const r = await J("/205"); assert.equal(r.status, 200); const c = r.j; assert.equal(c.tz, "America/Los_Angeles");
  assert.deepEqual([c.id, c.start, c.end, c.duration_ms, c.summary, c.place], [205, S5, S5 + 12 * M + 10e3, 12 * M + 10e3, "Summary 205", "205 Market St, San Francisco, CA"]);
  assert.deepEqual(c.lines.map((l) => l.who), ["You", "Dana Reyes", "Unknown", "Unknown", "Dana Reyes", "Priya"], "the wearer, a linked contact, Bee's own label, no label");
  assert.equal(c.lines[1].linked, true); assert.equal(c.lines[5].linked, undefined); assert.equal(c.lines[0].at, S5 + 1000);
  assert.equal(c.lines[4].text, LONG, "an utterance cut for memory at 3000 characters is joined again"); assert.equal(c.lines.length, 6); assert.equal(c.lines[2].text, "Who is this?");
  assert.equal(BEE.calls.length, 0, "reading a transcript never calls Bee"); }
{ // a link made for this recording wins over the remembered label
  DO().sql.exec("INSERT INTO speakers (rec, spk, label, name, state, person, person_name, at) VALUES ('205','label:Priya','Priya','Priya','linked','p9','Priya Shah',1)");
  const c = (await J("/205")).j; assert.equal(c.lines[5].who, "Priya Shah"); DO().sql.exec("DELETE FROM speakers WHERE rec='205'"); }
{ // the R2 copy is gone: the lines kept for the model passes are used
  const c202 = mk(202, BASE + 2 * H, 6, [u(20200, BASE + 2 * H + 1000, "first words of 202", "Joseph"), u(20201, BASE + 2 * H + 61000, "second words of 202", "Unknown")]); await DO().ambient.ingest("bee", 202, c202);
  const key = sqlRows("SELECT r2_key FROM convs WHERE id=202")[0].r2_key, keep = R2.get(key); R2.delete(key);
  const r = await J("/202"); assert.equal(r.status, 200); assert.deepEqual(r.j.lines.map((l) => [l.who, l.text]), [["Joseph", "first words of 202"], ["Unknown", "second words of 202"]]); R2.set(key, keep); }
assert.equal((await J("/99999")).status, 404);
ok("transcript: times and speakers, contact names (speaker_map, then a link for the recording), joined long utterance, no Bee call");

// ---- 5. the exports ----
{ const tx = await J("/205/export?format=txt"); assert.equal(tx.status, 200); assert.match(tx.headers.get("content-disposition"), /^attachment; filename\*=UTF-8''Bee%20conversation%202026-10-01%201800\.txt$/);
  assert.equal(tx.text, `Bee conversation
Started: Thu, Oct 1, 2026, 6:00 PM PDT
Ended: Thu, Oct 1, 2026, 6:12 PM PDT
Duration: 12 min
Summary: Summary 205
Location: 205 Market St, San Francisco, CA

[18:00:01] You: Hi, I'm back
[18:00:05] Dana Reyes: Welcome back to the office
[18:00:09] Unknown: Who is this?
[18:00:12] Unknown: no label at all
[18:00:15] Dana Reyes: ${LONG}
[18:00:20] Priya: Line with new line
`);
  const md = await J("/205/export?format=md"); assert.match(md.headers.get("content-disposition"), /\.md$/);
  assert.equal(md.text, `# Bee conversation

- Started: Thu, Oct 1, 2026, 6:00 PM PDT
- Ended: Thu, Oct 1, 2026, 6:12 PM PDT
- Duration: 12 min
- Summary: Summary 205
- Location: 205 Market St, San Francisco, CA

## Transcript

[18:00:01] You: Hi, I'm back

[18:00:05] Dana Reyes: Welcome back to the office

[18:00:09] Unknown: Who is this?

[18:00:12] Unknown: no label at all

[18:00:15] Dana Reyes: ${LONG}

[18:00:20] Priya: Line with new line
`);
  assert.equal((await J("/205/export")).text, tx.text, "txt is the default"); assert.equal((await J("/205/export?format=pdf")).text, tx.text, "an unknown format gives txt");
  assert.equal(tx.headers.get("x-content-type-options"), "nosniff"); }
ok("exports: .txt and .md carry the header in the person's zone and one [time] Speaker: text line per utterance");

// ---- 6. owner only ----
{ const r = await J("", { nocookie: true }).catch((e) => ({ status: 0, text: String(e) })); assert.notEqual(r.status, 200); assert.ok(!/Market St/.test(r.text), "no data without the owner's session");   // the Worker answers an unsigned request with its sign-in page (or, in this harness, stops at the page rewriter)
  const route = (await import("../src/ee/bee-library.js")).beeLibraryRoute, url = new URL("https://x/w/ck1/api/library/bee/conversations");
  for (const user of [null, { id: "someone-else" }]) { const r2 = await route({ req: new Request(url), env, t: { id: "t1", owner_user_id: "u1" }, user, sub: "/api/library/bee/conversations", url }); assert.equal(r2.status, 403); }
  const del = await route({ req: new Request(url, { method: "POST" }), env, t: { id: "t1", owner_user_id: "u1" }, user: { id: "u2" }, sub: "/api/library/bee/conversations/205/delete", url }); assert.equal(del.status, 403);
  assert.equal(sqlRows("SELECT COUNT(*) n FROM convs WHERE id=205")[0].n, 1, "a refused delete deleted nothing");
  assert.equal((await J("/205/delete")).status, 405, "delete is a POST"); assert.equal((await J("", { method: "POST" })).status, 405); }
ok("owner only: no session, another user and a wrong method are refused, and a refused delete deletes nothing");

// ---- 7. an account that disconnected Bee and kept its transcripts still lists them ----
{ assert.equal(d1.prepare("SELECT COUNT(*) n FROM bee_accounts WHERE tenant_id='t1'").get().n, 0, "no connection row, only the events");
  await DO().stop("keep"); const r = await J("?limit=3"); assert.equal(r.j.total, 7); assert.deepEqual(r.j.items.map((x) => x.id), [207, 206, 205]); assert.equal((await J("/205")).status, 200); }
ok("disconnected with transcripts kept: the list and transcripts still work");

// ---- 8. delete: every copy goes, and a sync does not bring it back ----
{ DO().sql.exec("INSERT INTO speakers (rec, spk, label, name, state, at) VALUES ('206','label:Dana','Dana','Dana','new',1)");
  assert.ok(docsOf().includes("bee:conv:206")); assert.ok(R2.has("t/t1/bee/conv/206.json")); assert.ok(sqlRows("SELECT COUNT(*) n FROM ambient_chunks WHERE source='bee' AND source_id='206'")[0].n >= 0);
  DO().sql.exec("INSERT INTO pending (id, why, at) VALUES (206, 'test', 0)");
  await DO().ambient.ingest("bee", 206, mk(206, BASE + 6 * H, 8, [u(20600, BASE + 6 * H + 1000, "something about the dentist on Thursday", "Joseph")]));
  assert.equal(sqlRows("SELECT COUNT(*) n FROM ambient_sources WHERE source='bee' AND source_id='206'")[0].n, 1); assert.equal(sqlRows("SELECT COUNT(*) n FROM ambient_chunks WHERE source='bee' AND source_id='206'")[0].n, 1, "it has stored lines before the delete");
  const memBefore = d1.prepare("SELECT COUNT(*) n FROM mem").get().n;
  const r = await J("/206/delete", { method: "POST" }); assert.equal(r.status, 200); assert.deepEqual(r.j, { ok: true, id: 206 });
  assert.ok(!docsOf().includes("bee:conv:206"), "the memory document is gone"); assert.ok(docsOf().includes("bee:conv:205"), "the others stay");
  assert.ok(d1.prepare("SELECT COUNT(*) n FROM mem").get().n < memBefore, "its facts are gone from D1");
  assert.ok(!R2.has("t/t1/bee/conv/206.json"), "the R2 copy is gone"); assert.equal(R2.size, 6);
  assert.equal(sqlRows("SELECT COUNT(*) n FROM convs WHERE id=206")[0].n, 0); assert.equal(sqlRows("SELECT COUNT(*) n FROM speakers WHERE rec='206'")[0].n, 0); assert.equal(sqlRows("SELECT COUNT(*) n FROM pending WHERE id=206")[0].n, 0);
  for (const t of ["ambient_sources", "ambient_chunks", "ambient_items"]) assert.equal(sqlRows(`SELECT COUNT(*) n FROM ${t} WHERE source='bee' AND source_id='206'`)[0].n, 0, `${t} has nothing of it`);
  assert.equal(sqlRows("SELECT COUNT(*) n FROM conv_gone WHERE id=206")[0].n, 1);
  assert.equal((await J("/206")).status, 404); assert.deepEqual((await J("?limit=7")).j.items.map((x) => x.id), [207, 205, 204, 203, 202, 201]); assert.equal((await J("?limit=7")).j.total, 6);
  assert.equal((await J("/206/delete", { method: "POST" })).status, 404, "deleting it again finds nothing");
  assert.equal(usage().objects, 6, "storage counts one object fewer"); }
ok("delete: memory document and facts, R2 object (and its storage count), convs row, stored lines, speaker rows and pending entry are removed");

// Bee still lists it, and changed it after the delete: the change feed names it again
{ put(mk(206, BASE + 3 * 2 * H, 8, [u(60601, BASE + 3 * 2 * H + 1000, "back again", "Joseph")], { updated_at: clock - 1000 })); put(mk(207, BASE + 6 * 2 * H, 11, [u(70701, BASE + 6 * 2 * H + 1000, "first words of 207", "Joseph")], { updated_at: clock - 500 }));
  let s = await connect(TOKEN); assert.equal(s.state, "connected");
  tick(1000); await fire();
  assert.ok(BEE.calls.some((c) => c === "/v1/conversations/206"), "the sync did read it from Bee");
  assert.ok(!docsOf().includes("bee:conv:206"), "but it did not go back into memory"); assert.ok(!R2.has("t/t1/bee/conv/206.json"), "nor into R2");
  assert.equal(sqlRows("SELECT COUNT(*) n FROM convs WHERE id=206")[0].n, 0); assert.equal(sqlRows("SELECT COUNT(*) n FROM ambient_sources WHERE source_id='206'")[0].n, 0);
  assert.equal(sqlRows("SELECT COUNT(*) n FROM pending WHERE id=206")[0].n, 0, "nothing waits to retry it");
  assert.ok(docsOf().includes("bee:conv:207"), "a conversation that was not deleted is imported as usual");
  // the import list (backfill count) and the catch-up skip it too: they leave out every id in convs or conv_gone
  assert.equal((await DO().opsBackfillCount("t1", 30)).to_import, 0, "the import list does not offer the deleted conversation");
  DO().sql.exec("DELETE FROM conv_gone WHERE id=206"); assert.equal((await DO().opsBackfillCount("t1", 30)).to_import, 1, "(without the deleted list it would offer it)"); DO().sql.exec("INSERT INTO conv_gone (id, at) VALUES (206, 1)"); }
ok("a sync that reads the deleted conversation again does not import it (change feed, catch-up and import skip it)");

// disconnecting and removing everything also forgets the list of deleted ones
{ await DO().stop("remove"); assert.equal(sqlRows("SELECT COUNT(*) n FROM conv_gone")[0].n, 0); assert.equal(sqlRows("SELECT COUNT(*) n FROM convs")[0].n, 0); assert.equal(R2.size, 0); }
ok("disconnect with remove clears the conversations and the deleted list");
console.log("done");
