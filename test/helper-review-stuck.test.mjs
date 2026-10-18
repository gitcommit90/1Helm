// node --import ./test/stubs/register.mjs test/helper-review-stuck.test.mjs
// A background helper never stays "awaiting_review" for good: a failed own run (out of credits) ends it as failed, and a review handoff that
// ended failed (a restart) is handed back once and then closed as failed (helpers.js reconcileHelperReviews). Judged on rows only.
import "./deploy-harness.mjs";   // loads the Resident first
import assert from "node:assert";
import { DatabaseSync } from "node:sqlite";
import { helpersInit, reconcileHelperReviews } from "../src/helpers.js";
import { trackerInit } from "../src/tracker.js";
import { Resident } from "../src/resident.js";
import { OUT_OF_TIME_REPLY } from "../src/spendguard.js";

const mk = () => {
  const db = new DatabaseSync(":memory:");
  const sql = { exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
    const st = db.prepare(q); const rows = /^\s*(select|with)|\breturning\b/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => rows, one: () => rows[0] }; } };
  trackerInit(sql); helpersInit(sql);
  sql.exec("CREATE TABLE IF NOT EXISTS user_questions (id TEXT, helper_id INTEGER, status TEXT)");
  return { db, sql };
};
const card = (db, id, status) => db.prepare("INSERT INTO cards (id,session,kind,status,title,opened) VALUES (?,?,?,?,?,?)").run(id, "s1", "chat", status, "t", 1);
const helper = (db, id, { own, review, handed = 1, status = "awaiting_review" }) =>
  db.prepare("INSERT INTO helpers (id,session,name,task,status,started,deadline,card,result_card,handed,dynamic_routing,round) VALUES (?,?,?,?,?,?,?,?,?,?,1,1)").run(id, "s1", "h" + id, "task", status, 1, 2, own, review, handed);
const row = (db, id) => db.prepare("SELECT status,error,why,handed,result_card,review_tries FROM helpers WHERE id=?").get(id);
let passed = 0; const ok = (n) => { passed++; console.log("  ok", n); };

// Helper #1 (out of credits): its own run and its review handoff both failed. Closed as failed, not reviewable.
{ const { db, sql } = mk(); card(db, "own1", "failed"); card(db, "rev1", "failed"); helper(db, 1, { own: "own1", review: "rev1" });
  const r = reconcileHelperReviews(sql, 5000); assert.deepEqual(r, { failed: [1], reoffered: [] });
  const h = row(db, 1); assert.equal(h.status, "failed"); assert.equal(h.why, "its own run failed"); assert.ok(h.error); assert.equal(h.handed, 1);
  assert.deepEqual(reconcileHelperReviews(sql), { failed: [], reoffered: [] }, "a second read changes nothing"); ok("own run failed (out of credits): the stuck row ends failed"); }

// Helper #3 (restart): its own run was fine, the review handoff failed. Handed back once, then closed.
{ const { db, sql } = mk(); card(db, "own3", "complete"); card(db, "rev3", "failed"); helper(db, 3, { own: "own3", review: "rev3" });
  db.prepare("INSERT INTO helper_rounds (helper_id,round,card,response,log,files_json,ended) VALUES (3,1,'own3','the result','log','[]',1)").run();
  const r1 = reconcileHelperReviews(sql); assert.deepEqual(r1, { failed: [], reoffered: [3] });
  let h = row(db, 3); assert.equal(h.status, "awaiting_review"); assert.equal(h.handed, 0, "the alarm will hand it to the task again"); assert.equal(h.result_card, null); assert.equal(h.review_tries, 1);
  assert.deepEqual(reconcileHelperReviews(sql), { failed: [], reoffered: [] }, "nothing to do while the second handoff has not run");
  card(db, "rev3b", "interrupted"); db.prepare("UPDATE helpers SET handed=1, result_card='rev3b' WHERE id=3").run();
  assert.deepEqual(reconcileHelperReviews(sql), { failed: [3], reoffered: [] });
  h = row(db, 3); assert.equal(h.status, "failed"); assert.equal(h.why, "review did not finish");
  assert.equal(db.prepare("SELECT response FROM helper_rounds WHERE helper_id=3").get().response, "the result", "its response is kept"); ok("review handoff failed in a restart: handed back once, then closed failed, result kept"); }

// Healthy reviews are untouched: review card still working, or complete; a helper handed but with no card yet.
{ const { db, sql } = mk(); card(db, "o", "complete"); card(db, "w", "working"); card(db, "c", "complete"); helper(db, 1, { own: "o", review: "w" }); helper(db, 2, { own: "o", review: "c" }); helper(db, 4, { own: "o", review: null, handed: 0 });
  assert.deepEqual(reconcileHelperReviews(sql), { failed: [], reoffered: [] }); assert.equal(row(db, 1).status, "awaiting_review"); assert.equal(row(db, 2).status, "awaiting_review"); ok("reviews still in progress or finished are not touched"); }

// orchestrationFailed: out of credits ends the round as failed and sends no handoff; another error ends failed and is handed back once.
const fake = (db, sql) => { const f = { sql, calls: [], hl: () => ({ reportMax: 4000 }), arm: () => Promise.resolve(), handoff(session, input) { f.calls.push(input); return { card: { id: "hand1" } }; } }; return f; };
{ const { db, sql } = mk(); helper(db, 1, { own: null, review: null, handed: 0, status: "running" }); const f = fake(db, sql);
  const h = Resident.prototype.orchestrationFailed.call(f, sql.exec("SELECT * FROM helpers WHERE id=1").toArray()[0], { error: "out_of_credits", reply: OUT_OF_TIME_REPLY, charge: 5 }, "own1");
  assert.equal(h.status, "failed"); assert.equal(h.why, "out of credits"); assert.equal(h.handed, 1); assert.equal(f.calls.length, 0); assert.equal(h.card, "own1"); ok("out of credits: worker round ends failed, no review"); }
{ const { db, sql } = mk(); helper(db, 1, { own: null, review: null, handed: 0, status: "running" }); const f = fake(db, sql);
  const h = Resident.prototype.orchestrationFailed.call(f, sql.exec("SELECT * FROM helpers WHERE id=1").toArray()[0], { error: "model exploded", reply: "", charge: 0 }, "own1");
  assert.equal(h.status, "failed"); assert.equal(f.calls.length, 1); assert.equal(h.result_card, "hand1"); assert.equal(h.handed, 1); ok("another failure: worker ends failed and the task hears about it once"); }

console.log(`PASS helper-review-stuck: ${passed} scenarios`);
