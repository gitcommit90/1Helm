// node --import ./test/stubs/register.mjs test/promise-check.test.mjs
// The promise check (promise-check.js): a chat turn about to end on a reply with no tool call asks the saved job "promise_check" whether the reply leaves an
// unfinished promise, and sends the reply back to the chat model once when it does. Unit parts are pure; the loop part runs the real Resident with a scripted
// chat model and a scripted decision call (no model is called).
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { readFileSync, existsSync } from "node:fs"; import { createHash } from "node:crypto";
import { Resident } from "../src/resident.js";
import { PROMISE_QUESTIONS, PROMISE_NOTE, PROMISE_JOB, promiseSkip, promiseState, turnFacts, runPromiseCheck, promiseTrace } from "../src/ee/promise-check.js";
import { seedFresh, PROMISE_CHECK_MODEL, OPTIONAL_JOB_IDS } from "../src/ee/model-seed.js";
import { JOBS, MODEL_PAGE_JOBS, jobDef } from "../src/ee/model-jobs.js";
import { modelSettingsOptions, validateModelSettings } from "../src/ee/model-settings.js";
import { jobTimeoutDefault } from "../src/limits.js";

let passed = 0; const ok = (name) => { passed++; console.log("  ok", name); };

// ---- the question is the approved evaluation's, word for word ----
{
  const sha = (o) => createHash("sha256").update(JSON.stringify(o)).digest("hex");
  assert.equal(sha(PROMISE_QUESTIONS), "7e8ad71d2fb685c5d0e15667e702c4a3e801580be912979caaad786c2ebb6798", "the pinned question");
  assert.deepEqual(Object.keys(PROMISE_QUESTIONS.promise.criteria), ["unfinished", "done", "waiting", "running", "stopped"]);
  ok("the question equals the evaluation's");
}

// ---- the job: default model, Models page entry, timeout ----
{
  assert.equal(PROMISE_JOB, "promise_check"); assert.equal(PROMISE_CHECK_MODEL, "liquid/d1.1");
  const s = seedFresh({});
  assert.equal(s.jobs.promise_check.model, "liquid/d1.1"); assert.deepEqual(s.jobs.promise_check.fallbacks, []);
  assert.deepEqual(s.catalog["liquid/d1.1"].kinds, ["decider"]);
  assert.equal(s.jobs.promise_check.timeout_ms ?? jobTimeoutDefault("promise_check"), jobTimeoutDefault("promise_check")); assert.ok(jobTimeoutDefault("promise_check") > 0);
  const d = jobDef("promise_check"); assert.equal(d.label, "Promise check"); assert.equal(d.kind, "decider");
  assert.ok(MODEL_PAGE_JOBS.some((j) => j.id === "promise_check"), "listed on the Models page");
  assert.ok(modelSettingsOptions(s).jobs.some((j) => j.id === "promise_check"), "the page options carry it");
  assert.ok(OPTIONAL_JOB_IDS.includes("promise_check"), "a saved version without it reads the starting value");
  const old = JSON.parse(JSON.stringify(s)); delete old.jobs.promise_check;
  assert.equal(validateModelSettings(old).jobs.promise_check.model, "liquid/d1.1");
  assert.equal(JOBS.filter((j) => j.id === "promise_check").length, 1);
  ok("promise_check: default liquid/d1.1, listed on the Models page, timeout set");
}

// ---- the state built from a turn ----
{
  const dodb = new DatabaseSync(":memory:");
  dodb.exec(`CREATE TABLE card_events (card TEXT, seq INTEGER, type TEXT, tool TEXT, title TEXT, status TEXT);
    CREATE TABLE browser_jobs (id INTEGER PRIMARY KEY, session TEXT, task TEXT, status TEXT);
    CREATE TABLE helpers (id INTEGER PRIMARY KEY, session TEXT, name TEXT, task TEXT, status TEXT);
    CREATE TABLE workflows (id INTEGER PRIMARY KEY, kind TEXT, name TEXT, status TEXT, created INTEGER, session TEXT, on_event TEXT);`);
  const ins = (q, ...a) => dodb.prepare(q).run(...a);
  ins("INSERT INTO card_events VALUES ('c1',1,'step','read_page','Read the page','ok')"); ins("INSERT INTO card_events VALUES ('c1',2,'step','run_command','Ran a command','error')");
  ins("INSERT INTO card_events VALUES ('c1',3,'msg',NULL,NULL,NULL)"); ins("INSERT INTO card_events VALUES ('c2',1,'step','other','Another turn','ok')");
  ins("INSERT INTO browser_jobs VALUES (1,'s1','Fill the form','running')"); ins("INSERT INTO browser_jobs VALUES (2,'s1','Old','done')"); ins("INSERT INTO browser_jobs VALUES (3,'s2','Other task','running')");
  ins("INSERT INTO helpers VALUES (1,'s1','Researcher','x','running')"); ins("INSERT INTO helpers VALUES (2,'s1','Finished','x','awaiting_review')");
  ins("INSERT INTO workflows VALUES (1,'workflow','Daily digest','active',2000,'s1',NULL)"); ins("INSERT INTO workflows VALUES (2,'workflow','Old schedule','active',500,'s1',NULL)");
  ins("INSERT INTO workflows VALUES (3,'workflow','Gmail watcher','active',2500,'s1','{\"app\":\"gmail\"}')"); ins("INSERT INTO workflows VALUES (4,'followup','Check back','active',2600,'s1',NULL)");
  const sql = { exec: (q, ...a) => { const r = dodb.prepare(q).all(...a); return { toArray: () => r, one: () => r[0] }; } };
  const f = turnFacts(sql, { turn: "c1", session: "s1", since: 1000 });
  assert.deepEqual(f.steps, [{ tool: "read_page", title: "Read the page", ok: true }, { tool: "run_command", title: "Ran a command", ok: false }], "this turn's steps only, a failed step has ok false");
  assert.deepEqual(f.running, [{ kind: "browser job", title: "Fill the form", status: "running" }, { kind: "helper", title: "Researcher", status: "running" }], "this task's running work only");
  assert.deepEqual(f.setUp, [{ kind: "workflow", title: "Daily digest" }, { kind: "watcher", title: "Gmail watcher" }, { kind: "follow-up", title: "Check back" }], "created since the turn began");
  const st = promiseState({ personMessage: "fix the bullets", reply: "I'll fix them.", ...f });
  assert.deepEqual(Object.keys(st), ["person_message", "reply", "steps_this_turn", "still_running", "set_up_this_turn"]);
  assert.equal(st.steps_this_turn[1].ok, false); assert.equal(st.still_running[0].kind, "browser job"); assert.equal(st.set_up_this_turn.length, 3);
  assert.equal(promiseState({ personMessage: "x".repeat(9000), reply: "y".repeat(9000), steps: Array(100).fill({ tool: "t", title: "t" }) }).steps_this_turn.length, 40);
  assert.equal(turnFacts({ exec: () => { throw new Error("no table"); } }, { turn: "c", session: "s" }).steps.length, 0, "a missing table reads as nothing");
  ok("state is built from the turn's steps, running work and set-up items");
}

// ---- skips ----
{
  const base = { kind: "chat", step: 1, stepLimit: 25, reply: "I'll do it." };
  assert.equal(promiseSkip(base), null);
  const cases = { kind: "helper", byok: true, nativeWorker: true, restricted: true, abort: "soft", paused: true, stalled: true, step: 24, reply: "  ", resent: true };
  for (const [k, v] of Object.entries(cases)) assert.ok(promiseSkip({ ...base, [k]: v }), `skips for ${k}`);
  assert.ok(promiseSkip({ ...base, kind: "workflow" })); assert.ok(promiseSkip({ ...base, abort: "hard" }));
  ok("every skip reason");
}

// ---- one check: ledger, fail open ----
{
  const L = () => { const o = { open: new Map(), settled: [], reserved: [], reserve: async (rid, n) => { o.reserved.push(n); if (o.deny) return { ok: false, reason: o.deny }; o.open.set(rid, n); return { ok: true }; }, settle: async (rid, ch) => { o.settled.push(ch); o.open.delete(rid); } }; return o; };
  const state = promiseState({ personMessage: "p", reply: "I'll do it." });
  let l = L(), seen;
  let r = await runPromiseCheck({}, { ledger: () => l, state, deps: { timeoutFor: async (_e, j) => (seen = j, 1234), ask: async (_e, s, q, o) => { seen = { s, q, o }; return { answers: { promise: { choice: "unfinished" } }, ms: 5, nano: 1000 }; } } });
  assert.equal(r.choice, "unfinished"); assert.equal(r.error, null); assert.equal(r.charge, 1150, "settled at the cost times 1.15");
  assert.equal(seen.o.job, "promise_check"); assert.equal(seen.o.timeoutMs, 1234, "the saved timeout"); assert.deepEqual(seen.q, PROMISE_QUESTIONS); assert.equal(seen.s, state);
  assert.equal(l.reserved.length, 1); assert.ok(l.reserved[0] > 0); assert.deepEqual(l.settled, [1150]); assert.equal(l.open.size, 0);
  const t = promiseTrace(r); assert.ok(!JSON.stringify(t).includes("I'll do it"), "no reply text in the trace"); assert.deepEqual(JSON.parse(t.out), { choice: "unfinished", ms: r.ms, nano: 1150, error: null });
  for (const choice of ["done", "waiting", "running", "stopped"]) { l = L(); r = await runPromiseCheck({}, { ledger: () => l, state, deps: { timeoutFor: async () => 1, ask: async () => ({ answers: { promise: { choice } }, nano: 1 }) } }); assert.equal(r.choice, choice); }
  // fail open
  l = L(); r = await runPromiseCheck({}, { ledger: () => l, state, deps: { timeoutFor: async () => 1, ask: async () => ({ error: "timeout after 8 s", nano: 40 }) } });
  assert.equal(r.choice, null); assert.match(r.error, /timeout/); assert.deepEqual(l.settled, [46], "a failed call still settles its cost"); assert.equal(l.open.size, 0);
  l = L(); r = await runPromiseCheck({}, { ledger: () => l, state, deps: { timeoutFor: async () => 1, ask: async () => ({ answers: { promise: { choice: "maybe" } }, nano: 0 }) } }); assert.equal(r.choice, null); assert.equal(r.error, "no valid answer");
  l = L(); r = await runPromiseCheck({}, { ledger: () => l, state, deps: { timeoutFor: async () => 1, ask: async () => ({}) } }); assert.equal(r.choice, null);
  l = L(); r = await runPromiseCheck({}, { ledger: () => l, state, deps: { timeoutFor: async () => 1, ask: async () => { throw new Error("boom"); } } }); assert.equal(r.choice, null); assert.equal(r.error, "boom"); assert.equal(l.open.size, 0);
  l = L(); l.deny = "insufficient"; let asked = false; r = await runPromiseCheck({}, { ledger: () => l, state, deps: { ask: async () => { asked = true; return {}; } } });
  assert.equal(r.choice, null); assert.equal(r.error, "out of credits"); assert.equal(asked, false, "no call without a reservation"); assert.equal(l.settled.length, 0);
  l = L(); l.deny = "day_limit"; r = await runPromiseCheck({}, { ledger: () => l, state, deps: { ask: async () => ({}) } }); assert.equal(r.error, "day limit reached");
  l = L(); r = await runPromiseCheck({}, { ledger: () => ({ reserve: async () => { throw new Error("ledger down"); } }), state, deps: { ask: async () => ({}) } }); assert.equal(r.choice, null); assert.match(r.error, /ledger down/);
  ok("reserve and settle on the Ledger; every failure ends with no choice");
}

// ---- the real Resident loop ----
const d1 = new DatabaseSync(":memory:");
d1.exec(readFileSync(new URL("../db/migrations/0001_012_full_schema_dev.sql", import.meta.url), "utf8").match(/CREATE TABLE IF NOT EXISTS texting \([\s\S]*?\n\);/)[0]);
d1.exec("CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT, helper_name TEXT, first_name TEXT, status TEXT, past_due_since INTEGER); INSERT INTO tenants VALUES ('t1','ck1','Ollie','Sam','active',NULL);");
d1.exec("CREATE TABLE resident_schedules (tenant_id TEXT, channel TEXT, channel_id TEXT, next_run INTEGER, updated_at INTEGER, PRIMARY KEY (tenant_id, channel))");
const D1 = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }),
  run: async () => { const r = st.run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; } };
const ledger = { open: new Map(), denyCheck: false, info: { allowance_nano: 20e9, period_spent_nano: 0, pct: 0, day_spent_nano: 0, day_share_nano: 20e9 / 30, day_ok_nano: 0 },
  guardInfo: async () => ledger.info, dayCheckin: async () => ledger.info, usageNotice: async () => null,
  reserve: async (rid, n) => { if (ledger.denyCheck && rid.startsWith("pchk:")) return { ok: false, reason: "insufficient" }; ledger.open.set(rid, n); return { ok: true }; }, settle: async (rid) => { ledger.open.delete(rid); } };
let brain = () => "Done."; const calls = [];
const whoOf = (messages) => /^You label one finished task/.test(String(messages[0]?.content || "")) ? "label" : "main";
const sse = (objs) => new Response(objs.map((o) => `data: ${JSON.stringify(o)}\n\n`).join("") + "data: [DONE]\n\n").body;
const env = { ONEHELM_EE: "1hc", DB: D1, MEMORY: "off", GENUI: "off", WORKMEM: "off", MODEL: "@cf/test/model", CLEF_DOORS: "off", LEDGER: { idFromName: (n) => n, get: () => ledger },
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
const ctx = { id: { toString: () => "do-promise-check-000000000000000" }, storage: { sql, getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {} }, waitUntil: (p) => waits.push(p) };
const computer = { exec: async (cmd) => ({ code: 0, out: `ran: ${cmd}` }), browser: async () => ({ ok: true, url: "about:blank", snapshot: "" }),
  listDownloads: async () => ({ done: [], partial: [] }), warm: async () => ({ ok: true }), cancel: async () => ({ ok: true }) };
const R = new Resident(ctx, env); R.systemPrompt = async () => "SYSTEM"; R.computer = () => computer; R.syncFiles = async () => {}; R.conns = async () => [];
R.put("tenant", "t1"); R.put("channel", "main"); R.put("channel_id", "1");
const asks = []; let verdict = () => "unfinished";
R.promiseDeps = { timeoutFor: async () => 1000, ask: async (_e, state, questions, o) => { asks.push({ state, questions, o }); const v = verdict(asks.length); return typeof v === "string" ? { answers: { promise: { choice: v } }, ms: 3, nano: 500 } : v; } };
async function settle() { for (let i = 0; i < 200; i++) { const n = waits.length; await Promise.all(waits.map((p) => p.catch?.(() => {}) ?? p)); await new Promise((z) => setTimeout(z, 2)); if (waits.length === n && ![...R.active.values()].some((t) => !t.finished)) break; } }
const noted = (c) => c.messages.some((m) => m.role === "user" && String(typeof m.content === "string" ? m.content : m.content?.[0]?.text || "") === PROMISE_NOTE);
const mainCalls = () => calls.filter((c) => c.who === "main" && !/^\(Turn finished/.test(String(c.messages.at(-1)?.content || "")));
async function chat(text, engine = "classic") { R.put("engine", engine); calls.length = 0; asks.length = 0; const s = R.newSession("Bullets"); const r = await R.runTurn("t1", "main", "1", text, () => {}, { session: s }); await settle(); return r; }
const rowOf = (r) => dodb.prepare("SELECT parts, progress, trace FROM turns WHERE id=?").get(r.turn);
const checkTrace = (r) => JSON.parse(rowOf(r).trace).filter((t) => t.tool === "promise_check").map((t) => JSON.parse(t.out));
const PROMISE = "I'll leave your dropdown selections untouched and make the formatting consistent across all three job descriptions.";
const FINAL = "I made the bullet points the same across all three job descriptions.";

{
  verdict = () => "unfinished"; brain = ({ n }) => n === 1 ? PROMISE : FINAL;
  const r = await chat("fix the uneven bullet points"); const mc = mainCalls();
  assert.equal(mc.length, 2, `two model calls (${mc.length})`); assert.ok(!noted(mc[0])); assert.ok(noted(mc[1]), "the second call carries the note");
  const second = mc[1].messages; assert.ok(second.some((m) => m.role === "assistant" && String(m.content) === PROMISE), "the promise stays in the conversation as the model's message");
  assert.equal(asks.length, 1, "asked once"); assert.equal(asks[0].o.job, "promise_check"); assert.deepEqual(asks[0].questions, PROMISE_QUESTIONS);
  assert.equal(asks[0].state.reply, PROMISE); assert.equal(asks[0].state.person_message, "fix the uneven bullet points"); assert.deepEqual(asks[0].state.steps_this_turn, []);
  assert.equal(r.reply, FINAL, `the coherent final reply (${r.reply})`);
  const row = rowOf(r); assert.deepEqual(JSON.parse(row.parts), [PROMISE, FINAL], "the promise shows once, as an interim message"); assert.deepEqual(JSON.parse(row.progress), [0]);
  const ct = checkTrace(r); assert.equal(ct.length, 1); assert.equal(ct[0].choice, "unfinished");
  assert.ok(!JSON.stringify(ct).includes("dropdown"), "no reply text in the check's record");
  assert.equal(ledger.open.size, 0, "every reservation settled");
  ok("unfinished: the reply goes back once with the note, the promise stays as an interim message, the final reply ends the turn");
}
{
  verdict = () => "unfinished"; brain = () => PROMISE;
  const r = await chat("fix the uneven bullet points"); assert.equal(mainCalls().length, 2, "one resend only"); assert.equal(asks.length, 1, "checked once per turn");
  assert.equal(r.reply, PROMISE); ok("a second promise ends the turn, checked and resent once per turn");
}
{
  // A public deployment (no ONEHELM_EE) never runs the check, so it never asks a decision model or reserves on a Ledger.
  env.ONEHELM_EE = ""; verdict = () => "unfinished"; brain = () => PROMISE;
  const r = await chat("fix the uneven bullet points"); env.ONEHELM_EE = "1hc";
  assert.equal(asks.length, 0, "no check without the licensed gate"); assert.equal(checkTrace(r).length, 0);
  assert.match(readFileSync(new URL("../src/resident.js", import.meta.url), "utf8"), /if \(eeEnabled\(this\.env\) && !promiseSkip\(/, "the call site is behind the licensed gate");
  ok("without the licensed gate the turn ends as before and nothing is asked");
}
for (const v of ["done", "waiting", "running", "stopped"]) {
  verdict = () => v; brain = () => PROMISE; const r = await chat("fix it"); assert.equal(mainCalls().length, 1, v); assert.equal(r.reply, PROMISE); assert.equal(checkTrace(r)[0].choice, v);
}
ok("done, waiting, running and stopped end the turn as before");
{
  for (const [name, v] of [["error", () => ({ error: "timeout after 8 s", ms: 8000, nano: 0 })], ["nothing valid", () => ({ answers: {}, nano: 0 })], ["throws", () => { throw new Error("boom"); }]]) {
    verdict = v; brain = () => PROMISE; const r = await chat("fix it"); assert.equal(mainCalls().length, 1, name); assert.equal(r.reply, PROMISE, name); assert.equal(checkTrace(r)[0].choice, null, name); assert.ok(checkTrace(r)[0].error, name);
  }
  verdict = () => "unfinished"; ledger.denyCheck = true; asks.length = 0; brain = () => PROMISE; const r = await chat("fix it");
  assert.equal(mainCalls().length, 1, "out of credits"); assert.equal(asks.length, 0); assert.match(checkTrace(r)[0].error, /credits/); ledger.denyCheck = false;
  ok("fail open: error, no valid answer, exception and out of credits all end the turn as today, and the turn records it");
}
{
  verdict = () => "done"; brain = ({ n }) => n === 1 ? { content: "Reading it.", calls: [["run_command", { cmd: "cat bullets.txt" }]] } : "Everything matches.";
  const r = await chat("check the bullets");
  assert.equal(asks.length, 1, "asked once, at the final reply only"); assert.equal(asks[0].state.reply, "Everything matches.");
  assert.ok(asks[0].state.steps_this_turn.some((s) => s.tool === "run_command" && s.ok === true), "the turn's tool step is in the state");
  assert.equal(r.reply, "Everything matches."); ok("a tool step is in the state; a step with tool calls is never checked");
}
{
  verdict = () => "unfinished"; brain = () => PROMISE; R.put("engine", "pi");
  const r = await chat("fix it", "pi"); assert.equal(asks.length, 0, "the pi engine is not covered"); assert.equal(mainCalls().length, 1);
  ok("the pi engine does not run the check");
}
assert.equal(ledger.open.size, 0, "every reservation settled");
console.log(`promise-check: ${passed} passed`);
