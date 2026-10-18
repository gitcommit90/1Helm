// node --import ./test/stubs/register.mjs test/resume-delegation-check.test.mjs
// A resumed turn checks an open approve_subagent / message_subagent call against the helper's saved rows (took effect: carry on from
// there; did not: run it again through the normal gates), and its notes say "updated" only when the code version changed.
// Judged on app facts only: rows, call counts, saved outcome and the note text.
import "./deploy-harness.mjs";   // loads the Resident first (resume.js and resident.js import each other)
import assert from "node:assert";
import { DatabaseSync } from "node:sqlite";
import { trackerInit } from "../src/tracker.js";
import { resumeMix, resumeInit, resumeNote, maybeDone, maybeRan, RESUME_NOTE, MAYBE_DONE, MAYBE_RAN, journalWasUpdated, whatHappened } from "../src/resume.js";

class Host { constructor(env = {}) { this.env = env; } }
resumeMix(Host);
const mk = (env = {}) => {
  const db = new DatabaseSync(":memory:");
  const h = new Host(env);
  h.sql = { exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
    const st = db.prepare(q); const rows = /^\s*(select|with)|\breturning\b/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => rows, one: () => rows[0] }; } };
  h.ctx = { storage: { transactionSync: (f) => f() } };
  resumeInit(h.sql); trackerInit(h.sql);
  db.exec(`CREATE TABLE helpers (id INTEGER PRIMARY KEY, session TEXT, status TEXT, round INTEGER);
    CREATE TABLE helper_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, helper_id INTEGER, session TEXT, text TEXT, status TEXT DEFAULT 'queued', queued_at INTEGER);
    CREATE TABLE approvals (id INTEGER PRIMARY KEY, perm TEXT, turn TEXT, status TEXT, at INTEGER, what TEXT);
    CREATE TABLE user_questions (id TEXT, session TEXT, source_turn TEXT, helper_id INTEGER, round INTEGER);`);
  h.db = db; h.saved = []; h.ran = [];
  h.save = (turn, m) => h.saved.push(m);
  h.runTool = async (call, tc) => { h.ran.push(call.function.name); tc.callId = call.id; return h.rerunText ?? "error: approval is available only after done."; };
  return h;
};
const TURN = "card-1", SESSION = "s1", AT = 1000;
const open = (h, name, args, { callId = "c1", at = AT } = {}) => {
  h.db.prepare("INSERT INTO turn_runs (card,session,kind,status,started,beat,updated,extra,code_v) VALUES (?,?,?,?,?,?,?,?,?)").run(TURN, SESSION, "chat", "running", at, at, at, "{}", "v1");
  h.db.prepare("INSERT INTO turn_effects (card,call_id,tool,cls,status,at) VALUES (?,?,?,?,?,?)").run(TURN, callId, name, "write", "started", at);
  return [{ role: "assistant", content: "", tool_calls: [{ id: callId, function: { name, arguments: JSON.stringify(args) } }] }];
};
const tcOf = (extra = {}) => ({ turn: TURN, session: SESSION, kind: "chat", taskProfile: { dynamicRouting: true }, orchestration: { review: 3 }, ...extra });
let passed = 0; const ok = (n) => { passed++; console.log("  ok", n); };

// 1. approve_subagent already took effect: no second run, the helper's state is restored, nothing is "unconfirmed".
{ const h = mk({ CODE_V: "v1" }); h.db.prepare("INSERT INTO helpers VALUES (3,?,?,1)").run(SESSION, "approved");
  const tc = tcOf(); const prior = open(h, "approve_subagent", { id: 3 });
  h.restoreDelegation(tc); assert.equal(tc.delegationUncertain, true, "before the check an open call is unknown");
  const out = await h.resumeClose(tc, prior); h.restoreDelegation(tc);
  assert.deepEqual(h.ran, [], "the approval is not run again"); assert.match(out[0].content, /Worker #3 approved/);
  assert.equal(tc.orchestration.approved, 3); assert.equal(tc.delegationUncertain, false);
  assert.equal(h.db.prepare("SELECT status FROM turn_effects WHERE card=?").get(TURN).status, "done");
  assert.ok(!out[0].content.includes("may or may not")); ok("approve_subagent that already took effect continues without running again"); }

// 2. approve_subagent did not take effect (helper still awaiting review): it runs again through runTool, and the turn is not "uncertain".
{ const h = mk({ CODE_V: "v1" }); h.db.prepare("INSERT INTO helpers VALUES (3,?,?,1)").run(SESSION, "awaiting_review");
  h.rerunText = "Worker #3 approved. The session is closed. Every selected file is attached."; const tc = tcOf(); const prior = open(h, "approve_subagent", { id: 3 });
  h.restoreDelegation(tc); const out = await h.resumeClose(tc, prior); h.restoreDelegation(tc);
  assert.deepEqual(h.ran, ["approve_subagent"], "run once through the normal path"); assert.equal(out[0].content, h.rerunText); assert.equal(tc.delegationUncertain, false);
  ok("approve_subagent that did not take effect runs again"); }

// 2b. the run again is refused by a gate (error text): the model sees the error, and the person never gets "couldn't confirm".
{ const h = mk({ CODE_V: "v1" }); h.db.prepare("INSERT INTO helpers VALUES (3,?,?,1)").run(SESSION, "awaiting_review");
  const tc = tcOf(); const prior = open(h, "approve_subagent", { id: 3 });
  h.restoreDelegation(tc); await h.resumeClose(tc, prior); h.restoreDelegation(tc);
  assert.equal(tc.delegationUncertain, false); ok("a refused rerun does not leave the turn uncertain"); }

// 3. message_subagent that already queued its message: not sent twice.
{ const h = mk({ CODE_V: "v1" }); h.db.prepare("INSERT INTO helpers VALUES (3,?,?,2)").run(SESSION, "running");
  h.db.prepare("INSERT INTO helper_messages (helper_id,session,text,queued_at) VALUES (3,?,?,?)").run(SESSION, "Use the logo", AT + 5);
  const tc = tcOf(); const prior = open(h, "message_subagent", { id: 3, message: "Use the logo" });
  h.restoreDelegation(tc); const out = await h.resumeClose(tc, prior); h.restoreDelegation(tc);
  assert.deepEqual(h.ran, []); assert.match(out[0].content, /Sent your correction to the same worker #3/); assert.equal(tc.orchestration.sent, true); assert.equal(tc.delegationUncertain, false);
  assert.equal(h.db.prepare("SELECT COUNT(*) n FROM helper_messages").get().n, 1); ok("message_subagent that already took effect is not sent again"); }

// 4. message_subagent with no message row (an older message does not count): runs again.
{ const h = mk({ CODE_V: "v1" }); h.db.prepare("INSERT INTO helpers VALUES (3,?,?,1)").run(SESSION, "awaiting_review");
  h.db.prepare("INSERT INTO helper_messages (helper_id,session,text,queued_at) VALUES (3,?,?,?)").run(SESSION, "older note", AT - 500);
  h.rerunText = "Sent your correction to the same worker #3."; const tc = tcOf(); const prior = open(h, "message_subagent", { id: 3, message: "Use the logo" });
  h.restoreDelegation(tc); const out = await h.resumeClose(tc, prior); h.restoreDelegation(tc);
  assert.deepEqual(h.ran, ["message_subagent"]); assert.equal(out[0].content, h.rerunText); assert.equal(tc.delegationUncertain, false); ok("message_subagent that did not take effect runs again"); }

// 5. an external send is still never run again, and a helper of another task is never treated as done.
{ const h = mk({ CODE_V: "v1" }); const tc = tcOf(); const prior = open(h, "gmail_send", { to: "a@example.com" });
  const out = await h.resumeClose(tc, prior); assert.deepEqual(h.ran, []); assert.equal(out[0].content, MAYBE_DONE); ok("external sends keep the never-run-again rule"); }
{ const h = mk({ CODE_V: "v1" }); h.db.prepare("INSERT INTO helpers VALUES (3,?,?,1)").run("other-task", "approved");
  const tc = tcOf(); const prior = open(h, "approve_subagent", { id: 3 }); await h.resumeClose(tc, prior);
  assert.deepEqual(h.ran, ["approve_subagent"], "another task's helper does not count"); ok("a helper from another task is not trusted"); }

// 6. wording: updated only when the code version changed.
assert.equal(journalWasUpdated({ code_v: "v1" }, { CODE_V: "v2" }), true);
assert.equal(journalWasUpdated({ code_v: "v2" }, { CODE_V: "v2" }), false);
assert.equal(journalWasUpdated({ code_v: null }, { CODE_V: "v2" }), false);
assert.match(resumeNote(true), /1Helm was updated/); assert.match(resumeNote(false), /1Helm restarted while you were working on this/); assert.doesNotMatch(resumeNote(false), /updated/);
assert.doesNotMatch(maybeDone(false) + maybeRan(false), /updated/); assert.match(maybeDone(false), /^\(1Helm restarted at the moment this ran/);
assert.equal(RESUME_NOTE, resumeNote(true)); assert.equal(MAYBE_DONE, maybeDone(true)); assert.equal(MAYBE_RAN, maybeRan(true)); assert.equal(whatHappened(false), "1Helm restarted");
ok("wording follows the code version");
{ const h = mk({ CODE_V: "v1" }); const tc = tcOf({ resumeUpdated: false }); const prior = open(h, "gmail_send", { to: "a@example.com" });
  const out = await h.resumeClose(tc, prior); assert.equal(out[0].content, maybeDone(false)); assert.doesNotMatch(out[0].content, /updated/);
  const tc2 = tcOf({ resumeUpdated: true }); const h2 = mk({ CODE_V: "v2" }); const prior2 = open(h2, "gmail_send", { to: "a@example.com" }); const out2 = await h2.resumeClose(tc2, prior2);
  assert.equal(out2[0].content, MAYBE_DONE); ok("a person-facing-adjacent tool text says restarted without a deploy and updated with one"); }

console.log(`PASS resume-delegation-check: ${passed} scenarios`);
