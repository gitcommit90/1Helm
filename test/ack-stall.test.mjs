// node --import ./test/stubs/register.mjs test/ack-stall.test.mjs
// A promise with no work behind it (ack-stall.js; Live, 10-18: "Got it, thanks for sharing that guide, reading it now." was
// the whole reply, no tool ran, the turn closed). The detector is pure; the loop test runs the real Resident on both engines with a scripted model.
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
import { Resident } from "../src/resident.js";
import { isPromiseOnly, ackNudge, ACK_NUDGE, isClosingPromise, workNudge, WORK_NUDGE } from "../src/ack-stall.js";

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
const computer = { exec: async (cmd) => ({ code: 0, out: `FlightAware: UA 4 estimated arrival 6:07 PM CDT (ran: ${cmd})` }), browser: async () => ({ ok: true, url: "about:blank", snapshot: "" }),
  listDownloads: async () => ({ done: [], partial: [] }), warm: async () => ({ ok: true }), cancel: async () => ({ ok: true }) };
const R = new Resident(ctx, env); R.systemPrompt = async () => "SYSTEM"; R.computer = () => computer; R.syncFiles = async () => {}; R.conns = async () => [];
R.put("tenant", "t1"); R.put("channel", "main"); R.put("channel_id", "1");
async function settle() { for (let i = 0; i < 200; i++) { const n = waits.length; await Promise.all(waits.map((p) => p.catch?.(() => {}) ?? p)); await new Promise((z) => setTimeout(z, 2)); if (waits.length === n && ![...R.active.values()].some((t) => !t.finished)) break; } }
const nudged = (c) => c.messages.some((m) => m.role === "user" && String(typeof m.content === "string" ? m.content : m.content?.[0]?.text || "").startsWith("(You said you'd do it now"));
const mainCalls = () => calls.filter((c) => c.who === "main" && !/^\(Turn finished/.test(String(c.messages.at(-1)?.content || "")));
async function chat(engine, text) { R.put("engine", engine); calls.length = 0; const s = R.newSession("Flight"); const r = await R.runTurn("t1", "main", "1", text, () => {}, { session: s }); await settle(); return r; }

// ---- the detector ----
const POS = ["Got it — thanks for sharing that guide, reading it now.", "On it.", "Let me look.", "I'll check that now.", "Working on it.", "Give me a sec.", "One moment.", "Looking into it.", "Starting now.",
  "Sure, let me take a look at the file.", "Okay, I'll go through the runbook now.", "Thanks! I'm reading through it now.", "Got it, I'll dig into that and get back to you.", "Let me look at that for you.",
  "I'll get started on it right away.", "Got it. Reading it now.", "Reading it now 👀", "Let me check that real quick."];
const NEG = ["Done.", "Yes, it's on Friday.", "Got it.", "Got it, I'll remember that.", "Do you want me to read it now?", "I'll check that on Friday at 3.", "Let me know if you need anything else.", "Sure, I can help with that.",
  "Thanks for sharing that guide. The runbook says to restart the service first, then check the logs for errors.", "Let me look at the part about billing: it says nothing.", "Here is a link https://example.com", "", "x".repeat(200),
  "I'll check the oven.", "I've read it. The setup uses two servers."];
for (const s of POS) assert.ok(isPromiseOnly(s), `should fire: ${s}`);
for (const s of NEG) assert.ok(!isPromiseOnly(s), `should not fire: ${s}`);
{ const tc = { kind: "chat" }; assert.equal(ackNudge(tc, { tool_calls: 0 }, ["Reading it now."]), ACK_NUDGE); assert.equal(ackNudge(tc, { tool_calls: 0 }, ["Reading it now."]), null, "once per turn"); }
assert.equal(ackNudge({ kind: "chat" }, { tool_calls: 1 }, ["Reading it now."]), null, "a tool ran (a pause or approval ends the turn on purpose)");
assert.equal(ackNudge({ kind: "helper" }, { tool_calls: 0 }, ["Reading it now."]), null, "chat turns only");
ok("isPromiseOnly / ackNudge");

// ---- the closing-promise guard (workNudge): real Live replies of 2026-11-04 ----
const CLOSE_POS = [
  "The Comfy Cloud connection responded this time. I'm creating the visual references and working on the commercial now.",
  "I ran the job and it hit an auth error, so no reference image was generated. The workflows are prepared, but they haven't yet produced the commercial. The next step is to check the Comfy account's access to that image model.",
  "No. I paused because the image generation job returned a login-required error, and I hadn't resolved it. But I should have investigated the account access instead of stopping at the error... I'll continue checking the Comfy setup and tell you if I need you to sign in or make a decision.",
  "Got it, I'll continue with the next scene.", "Next, I'll run the export again.", "I'm working on it now.", "The first pass is saved. Now I'll generate the rest of the frames.",
  "On it. I'm checking the logs now.", "- Fixed the config.\n- Next step is to re-run the build."];
const CLOSE_NEG = [
  "Done. The commercial is saved as commercial.mp4 and the three reference images are in the Videos folder.",
  "The job failed with a login-required error. Do you want me to try again with a different account?", "I can't continue until you sign in to Comfy. Please sign in and tell me when it's done.",
  "The report is ready. Tell me if you want me to make the intro shorter.", "All three images were generated. Let me know if you want changes.", "I'll check again tomorrow morning and message you.",
  "I'll continue once the render finishes.", "I'll keep that in mind.", "I'll remember that you prefer short intros.", "If you'd like, I can start on the second scene.", "Next step is up to you: choose one of the two styles.",
  "The build passed and the tests are green.", "Yes, it's on Friday.", "I'm sorry, I can't do that.", "", "Should I continue with the commercial now?", "Once you approve the script, I'll start creating the frames."];
for (const t of CLOSE_POS) assert.ok(isClosingPromise(t), `should fire: ${t}`);
for (const t of CLOSE_NEG) assert.ok(!isClosingPromise(t), `should not fire: ${t}`);
{
  const R1 = CLOSE_POS[0], none = () => ({ running: [], setUp: [] });
  const tc = { kind: "chat" };
  assert.equal(workNudge(tc, { tool_calls: 4 }, R1, none), WORK_NUDGE, "tools earlier in the turn do not exempt it");
  assert.equal(workNudge(tc, { tool_calls: 4 }, R1, none), null, "once per turn");
  assert.equal(workNudge({ kind: "chat", ackNudged: true }, { tool_calls: 0 }, R1, none), null, "already nudged by the ack guard");
  assert.equal(ackNudge(tc, { tool_calls: 0 }, ["Reading it now."]), null, "the ack guard skips a turn the work guard nudged");
  assert.equal(workNudge({ kind: "chat" }, { promise_resent: 1 }, R1, none), null, "the promise check already sent it back");
  assert.equal(workNudge({ kind: "chat" }, {}, R1, () => ({ running: [{ kind: "helper", title: "x", status: "running" }], setUp: [] })), null, "a helper is running");
  assert.equal(workNudge({ kind: "chat" }, {}, R1, () => ({ running: [], setUp: [{ kind: "workflow", title: "x" }] })), null, "something was set up this turn");
  assert.equal(workNudge({ kind: "chat", pause: { kind: "approval" } }, {}, R1, none), null, "a pause");
  assert.equal(workNudge({ kind: "helper" }, {}, R1, none), null, "chat turns only");
  assert.equal(workNudge({ kind: "chat" }, {}, "Done.", () => { throw new Error("facts must not be read"); }), null, "facts are read only after a match");
}
ok("isClosingPromise / workNudge");

for (const engine of ["classic", "pi"]) {
  const partsOf = (r) => { const row = dodb.prepare("SELECT parts, progress FROM turns WHERE id=?").get(r.turn); return { parts: row.parts && JSON.parse(row.parts), progress: row.progress && JSON.parse(row.progress) }; };
  brain = ({ n }) => n === 1 ? "Got it, reading it now." : "The runbook says to restart the worker first. That is the whole setup.";
  let r = await chat(engine, "here's some helpful info from my agent who set things up with my husband");
  let mc = mainCalls();
  assert.equal(mc.length, 2, `${engine}: two model calls (${mc.length})`);
  assert.equal(mc.filter(nudged).length, 1, `${engine}: the second call carries the nudge`);
  assert.ok(!nudged(mc[0]), `${engine}: not before the first answer`);
  assert.equal(r.reply, "The runbook says to restart the worker first. That is the whole setup.", `${engine}: ${r.reply}`);
  assert.equal(r.ack_nudge, 1, `${engine}: stats flag`);
  const pp = partsOf(r);
  assert.deepEqual(pp.parts, ["Got it, reading it now.", "The runbook says to restart the worker first. That is the whole setup."], `${engine}: the acknowledgment appears once`);
  assert.deepEqual(pp.progress, [0], `${engine}: the acknowledgment is progress`);
  ok(`${engine}: a promise-only step gets one nudge, the next answer is the reply, the acknowledgment stays once as progress`);

  // a second promise-only step: no second nudge, the turn ends
  brain = () => "Got it, reading it now.";
  r = await chat(engine, "here is the guide"); mc = mainCalls();
  assert.equal(mc.length, 2, `${engine}: one nudge only (${mc.length})`);
  ok(`${engine}: at most one nudge per turn`);

  // real answers, a question and a short final answer are not nudged
  for (const a of ["Yes, it's on Friday.", "Done.", "Do you want me to read it now?"]) { brain = () => a; r = await chat(engine, "when is it?"); assert.equal(mainCalls().length, 1, `${engine}: ${a}`); assert.equal(r.reply, a); }
  ok(`${engine}: real answers, "Done." and questions are not nudged`);

  // a promise before a tool call is normal: no nudge
  brain = ({ n }) => n === 1 ? { content: "Reading it now.", calls: [["run_command", { cmd: "cat guide.txt" }]] } : "Here is what it says.";
  r = await chat(engine, "read the guide"); assert.ok(!mainCalls().some(nudged), `${engine}: no nudge when it acts`);
  ok(`${engine}: a promise followed by a tool call is not nudged`);

  // closing promise after tools ran: one nudge, then the next answer is the reply
  const isWork = (c) => c.messages.some((m) => m.role === "user" && String(typeof m.content === "string" ? m.content : m.content?.[0]?.text || "").startsWith("(You said you'd keep working"));
  brain = ({ n }) => n === 1 ? { content: "", calls: [["run_command", { cmd: "ls" }]] } : n === 2 ? "A job hit an auth error. The next step is to check the account's access to that model." : { content: "", calls: [["run_command", { cmd: "ls" }]] };
  r = await chat(engine, "go on"); mc = mainCalls();
  assert.equal(mc.filter(isWork).length >= 1, true, `${engine}: the closing promise after a tool is nudged`);
  assert.ok(!isWork(mc[1]), `${engine}: not before the promise`);
  assert.equal(r.work_nudge, 1, `${engine}: stats flag`);
  ok(`${engine}: a closing promise after tool steps gets one nudge`);
  brain = ({ n }) => n === 1 ? "Here you go. Tell me if you want me to change it." : "unused";
  r = await chat(engine, "make it"); assert.equal(mainCalls().length, 1, `${engine}: an offer is not nudged`);
  ok(`${engine}: an offer is not nudged`);
}
assert.equal(ledger.open.size, 0, "every reservation settled");
console.log(`ack-stall: ${passed} passed`);
