// node --import ./test/stubs/register.mjs test/step-warning.test.mjs
// One note 3 steps before the step limit, on both engines (the plain loop and pi), for a chat turn and for a worker. The limit itself is not changed.
// Judged on what the model is sent (app facts), with a scripted model that only calls run_command.
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
import { Resident } from "../src/resident.js";
import { shouldWarnSteps, stepsLeft, stepWarning, hasStepWarning } from "../src/step-warning.js";

let passed = 0; const ok = (name) => { passed++; console.log("  ok", name); };

// ---- the real Resident, both engines ----
const d1 = new DatabaseSync(":memory:");
d1.exec(readFileSync(new URL("fixtures/migrations/migrations_009.sql", import.meta.url), "utf8"));
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
const ctx = { id: { toString: () => "do-step-warning-0000000000000" }, storage: { sql, getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {} }, waitUntil: (p) => waits.push(p) };
const computer = { exec: async (cmd) => ({ code: 0, out: `FlightAware: UA 4 estimated arrival 6:07 PM CDT (ran: ${cmd})` }), browser: async () => ({ ok: true, url: "about:blank", snapshot: "" }),
  listDownloads: async () => ({ done: [], partial: [] }), warm: async () => ({ ok: true }), cancel: async () => ({ ok: true }) };
const R = new Resident(ctx, env); R.systemPrompt = async () => "SYSTEM"; R.computer = () => computer; R.syncFiles = async () => {}; R.conns = async () => [];
R.put("tenant", "t1"); R.put("channel", "main"); R.put("channel_id", "1");
async function settle() { for (let i = 0; i < 200; i++) { const n = waits.length; await Promise.all(waits.map((p) => p.catch?.(() => {}) ?? p)); await new Promise((z) => setTimeout(z, 2)); if (waits.length === n && ![...R.active.values()].some((t) => !t.finished)) break; } }
const nudged = (c) => c.messages.some((m) => m.role === "user" && String(typeof m.content === "string" ? m.content : m.content?.[0]?.text || "").startsWith("(You said you'd do it now"));
const mainCalls = () => calls.filter((c) => c.who === "main" && !/^\(Turn finished/.test(String(c.messages.at(-1)?.content || "")));

const warned = (c) => c.messages.filter((m) => m.role === "user" && /steps? left before the step limit/.test(String(typeof m.content === "string" ? m.content : m.content?.[0]?.text || ""))).length;
const isWarn = (c) => warned(c) > 0;

// pure rules
assert.equal(stepsLeft(4, 8), 3); assert.equal(shouldWarnSteps(4, 8, false), true); assert.equal(shouldWarnSteps(3, 8, false), false, "4 left is too early"); assert.equal(shouldWarnSteps(5, 8, false), true);
assert.equal(shouldWarnSteps(4, 8, true), false, "once"); assert.equal(shouldWarnSteps(7, 8, false), false, "no tool step is left");
assert.match(stepWarning(3, true), /^\(3 steps left before the step limit\. Finish the deliverable now: write or save the output the job asks for, then call done\.\)$/);
assert.match(stepWarning(1, false), /^\(1 step left/); assert.ok(!/call done/.test(stepWarning(3, false)));
assert.ok(hasStepWarning([{ role: "user", content: stepWarning(3, true) }]) && !hasStepWarning([{ role: "user", content: "hi" }]));
ok("step warning rules");

for (const engine of ["classic", "pi"]) {
  // A chat turn with max_steps 8 that keeps calling a tool: the note arrives with the call that has 3 tool steps left, once, and the limit stays 8.
  R.put("engine", engine); calls.length = 0; const s = R.newSession("Limit");
  brain = () => ({ calls: [["run_command", { cmd: "echo hi" }]] });
  const r = await R.runTurn("t1", "main", "1", "keep checking", () => {}, { session: s, max_steps: 8 }); await settle();
  const mc = calls.filter((c) => c.who === "main");
  const first = mc.findIndex(isWarn);
  assert.ok(first >= 0, `${engine}: the model was warned (${mc.length} calls)`);
  assert.equal(first, 4, `${engine}: the warning arrives with the 5th call, which leaves 3 tool steps (calls 5, 6, 7) before the final report`);
  assert.equal(Math.max(...mc.map(warned)), 1, `${engine}: sent once, not repeated`);
  assert.ok(mc.slice(first).every(isWarn), `${engine}: the note stays in the conversation`);
  assert.ok(mc.slice(0, first).every((c) => !isWarn(c)), `${engine}: not before`);
  assert.ok(mc.length <= 9, `${engine}: the limit itself is unchanged (${mc.length} calls)`);
  void r;
  ok(`${engine}: one warning 3 steps before the limit`);
  // A short turn that ends before the window gets no note.
  calls.length = 0; brain = () => "Done."; await R.runTurn("t1", "main", "1", "hi", () => {}, { session: R.newSession("Short"), max_steps: 8 }); await settle();
  assert.ok(calls.filter((c) => c.who === "main").every((c) => !isWarn(c)), `${engine}: no note on a short turn`);
  ok(`${engine}: no warning when the turn ends early`);
}
console.log(`PASS step-warning: ${passed} scenarios`);
process.exit(0);
