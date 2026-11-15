// node --import ./test/stubs/register.mjs test/turn-save.test.mjs
// (A) the turns row is stored before the end-of-turn computer save, which runs in the background; (B) recoverTurns keeps the due time of a row already resuming;
// (C) a to-do list last updated before a stopped card closed is not unfinished work.
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
import { Resident } from "../src/resident.js";
import { openWorkFacts } from "../src/ack-stall.js";
let passed = 0; const ok = (name) => { passed++; console.log("  ok", name); };

// ---- the real Resident, both engines ----
const d1 = new DatabaseSync(":memory:");
d1.exec(readFileSync(new URL("../db/migrations/0001_012_full_schema_dev.sql", import.meta.url), "utf8").match(/CREATE TABLE IF NOT EXISTS texting \([\s\S]*?\n\);/)[0]);
d1.exec("CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT, helper_name TEXT, first_name TEXT, status TEXT, past_due_since INTEGER); INSERT INTO tenants VALUES ('t1','ck1','Ollie','Sam','active',NULL);");
d1.exec("CREATE TABLE resident_schedules (tenant_id TEXT, channel TEXT, channel_id TEXT, next_run INTEGER, updated_at INTEGER, PRIMARY KEY (tenant_id, channel))");
const D1 = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }),
  run: async () => { const r = st.run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; } };
const ledger = { open: new Map(), info: { allowance_nano: 20e9, period_spent_nano: 0, pct: 0, day_spent_nano: 0, day_share_nano: 20e9 / 30, day_ok_nano: 0 },
  guardInfo: async () => ledger.info, dayCheckin: async () => ledger.info, usageNotice: async () => null,
  reserve: async (rid, n) => { ledger.open.set(rid, n); return { ok: true }; }, settle: async (rid) => { ledger.open.delete(rid); } };
let brain = () => "Done."; const calls = [];
const whoOf = (messages) => /^You label one finished task/.test(String(messages[0]?.content || "")) ? "label" : "main";
const sse = (objs) => new Response(objs.map((o) => `data: ${JSON.stringify(o)}\n\n`).join("") + "data: [DONE]\n\n").body;
const env = { DB: D1, ONEHELM_EE: "1hc", MEMORY: "off", GENUI: "off", WORKMEM: "off", MODEL: "@cf/test/model", CLEF_DOORS: "off", LEDGER: { idFromName: (n) => n, get: () => ledger },
  AI: { run: async (_m, body) => { const who = whoOf(body.messages); calls.push({ who, messages: [...body.messages] });
    let s = who === "label" ? '{"title":"Labelled","result":"Done","summary":"Done.","why":{}}' : await brain({ messages: body.messages, n: calls.filter((x) => x.who === who).length });
    if (typeof s === "string") s = { content: s };
    const ev = []; if (s.content) ev.push({ choices: [{ delta: { content: s.content } }] });
    (s.calls || []).forEach(([name, args], i) => ev.push({ choices: [{ delta: { tool_calls: [{ index: i, id: `call_${calls.length}_${i}`, function: { name, arguments: JSON.stringify(args) } }] } }] }));
    ev.push({ choices: [{ delta: {}, finish_reason: s.calls?.length ? "tool_calls" : "stop" }], usage: { prompt_tokens: 100, completion_tokens: 10 } }); return sse(ev); } } };
const dodb = new DatabaseSync(":memory:");
const sql = { exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { dodb.exec(q); return { toArray: () => [], one: () => undefined }; }
  const st = dodb.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } };
const waits = [];
const ctx = { id: { toString: () => "do-ack-stall-000000000000000" }, storage: { sql, getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {} }, waitUntil: (p) => waits.push(p) };
let saveGate = null; const saves = []; const computer = { save: (r) => { saves.push(r); return saveGate; }, exec: async (cmd) => ({ code: 0, out: `FlightAware: UA 4 estimated arrival 6:07 PM CDT (ran: ${cmd})` }), browser: async () => ({ ok: true, url: "about:blank", snapshot: "" }),
  listDownloads: async () => ({ done: [], partial: [] }), warm: async () => ({ ok: true }), cancel: async () => ({ ok: true }) };
const R = new Resident(ctx, env); R.systemPrompt = async () => "SYSTEM"; R.computer = () => computer; R.syncFiles = async () => {}; R.conns = async () => [];
R.put("tenant", "t1"); R.put("channel", "main"); R.put("channel_id", "1");
async function settle() { for (let i = 0; i < 200; i++) { const n = waits.length; await Promise.all(waits.map((p) => p.catch?.(() => {}) ?? p)); await new Promise((z) => setTimeout(z, 2)); if (waits.length === n && ![...R.active.values()].some((t) => !t.finished)) break; } }

// ---- A ----
{
  let release; saveGate = new Promise((r) => { release = r; });
  brain = ({ n }) => n === 1 ? { content: "", calls: [["run_command", { cmd: "ls" }]] } : "Here it is.";
  R.put("engine", "classic"); const s = R.newSession("Save");
  const r = await Promise.race([R.runTurn("t1", "main", "1", "list files", () => {}, { session: s }), new Promise((z) => setTimeout(() => z("held"), 3000))]);
  assert.notEqual(r, "held", "the turn does not wait for the computer save");
  assert.deepEqual(saves, ["turn"], "the save was started");
  const row = R.sql.exec("SELECT reply, computer_used FROM turns WHERE session=?", s).toArray()[0];
  assert.ok(row && row.computer_used === 1 && row.reply, "the turn row exists while the save is still running");
  release({ ok: true }); await Promise.all(waits.map((p) => p.catch?.(() => {}) ?? p));
  console.log("  ok A turn row before the background save");
}

// ---- B ----
{
  const row = (status, resume_at) => R.sql.exec("SELECT status, resume_at FROM turn_runs WHERE card='cb'").toArray()[0];
  R.sql.exec("INSERT INTO cards (id,session,kind,status,title,title_src,opened) VALUES ('cb','sb','chat','resuming','t','x',1)");
  const keep = (v) => { R.sql.exec("DELETE FROM turn_runs"); R.sql.exec("INSERT INTO turn_runs (card,session,kind,status,started,beat,resume_at,resumes,updated) VALUES ('cb','sb','chat',?,1,1,?,1,1)", v.status, v.at); R.recoverTurns(); return row().resume_at; };
  const due = Date.now() + 5000;
  assert.equal(keep({ status: "resuming", at: due }), due, "an existing due time is kept");
  const before = Date.now(); assert.ok(keep({ status: "working", at: null }) >= before + 1000 - 5, "a working row gets now + delay");
  console.log("  ok B resume_at kept");
}

// ---- C ----
{
  const db = new DatabaseSync(":memory:"), q = { exec: (x, ...a) => { const st = db.prepare(x); const rows = /^\s*SELECT/i.test(x) ? st.all(...a) : (st.run(...a), []); return { toArray: () => rows }; } };
  db.exec("CREATE TABLE todos (session TEXT PRIMARY KEY, items TEXT, updated INTEGER); CREATE TABLE cards (id TEXT, session TEXT, status TEXT, closed INTEGER)");
  db.prepare("INSERT INTO todos VALUES ('s1', ?, 100)").run(JSON.stringify([{ id: "1", text: "a", status: "pending" }]));
  assert.equal(openWorkFacts(q, { session: "s1" }).open.length, 1, "no stopped card: the list counts");
  db.exec("INSERT INTO cards VALUES ('c1','s1','stopped',200)");
  assert.equal(openWorkFacts(q, { session: "s1" }).open.length, 0, "list older than the stop is ignored");
  db.exec("UPDATE todos SET updated=300");
  assert.equal(openWorkFacts(q, { session: "s1" }).open.length, 1, "list updated after the stop counts");
  console.log("  ok C stopped list ignored");
}
