// node --import ./test/stubs/register.mjs test/helper-no-approval.test.mjs
// A returned worker needs no approval: the tool, its forced review and its nudge are gone, an old saved run that waited on approval is closed or handed over once,
// and a closed worker never loops. Judged on rows, tool lists and source text only; no model is called.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { ORCHESTRATOR_TOOLS, orchestrationPolicy, routingToolsAllowed } from "../src/ee/orchestrator.js";
import { helpersInit, reconcileHelperReviews, reviewableWorker } from "../src/helpers.js";
import { trackerInit } from "../src/tracker.js";

// 1. No approve tool anywhere, and nothing in any delegation state allows or describes it.
assert.ok(!ORCHESTRATOR_TOOLS.some((t) => t.function.name === "approve_subagent"));
assert.ok(ORCHESTRATOR_TOOLS.some((t) => t.function.name === "message_subagent"), "message_subagent stays");
for (const flow of [{ review: 3 }, { review: 3, pausedKind: "browser" }, { review: 3, pausedKind: "login" }, { review: 3, pausedKind: "purchase_wait" }, { steer: 3 }, { requiredDelegation: true }, { approved: 3 }, {}]) {
  assert.equal(routingToolsAllowed({ orchestration: flow }, "approve_subagent"), false, JSON.stringify(flow));
  assert.ok(!/approve_subagent|Approval is required/.test(orchestrationPolicy({ orchestration: flow })), JSON.stringify(flow));
}
// an ordinary turn after a worker returned may send a follow-up to an open worker, and may start another worker
assert.equal(routingToolsAllowed({ orchestration: {} }, "message_subagent"), true);
assert.equal(routingToolsAllowed({ orchestration: {} }, "start_helper"), true);
// a returned worker is not a review; one paused with a question still is
assert.equal(reviewableWorker({ dynamic_routing: 1, session: "s", status: "awaiting_review" }, "s"), false);
assert.equal(reviewableWorker({ dynamic_routing: 1, session: "s", status: "waiting_input" }, "s"), true);

// 2. The source has no approve_subagent tool, no approval nudge and no review-only filter (resume.js answers old saved calls; orchestrator.js refuses the name).
const files = readdirSync(new URL("../src/", import.meta.url)).filter((f) => f.endsWith(".js"));
for (const f of files) {
  const text = readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
  assert.ok(!/Approval is required before presenting/.test(text), `${f}: no approval nudge`);
  if (f !== "resume.js" && f !== "orchestrator.js") assert.ok(!/["'`]approve_subagent["'`]/.test(text), `${f}: no approve_subagent tool name`);
}

// 3. An old saved run (status awaiting_review, handed, its handoff turn complete) is closed when it was released, and handed over once more when it was not. Never failed.
const db = new DatabaseSync(":memory:");
const sql = { exec: (q, ...a) => { const st = db.prepare(q); const rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => rows, one: () => rows[0] }; } };
helpersInit(sql); trackerInit(sql);
const worker = (id, released, cardStatus) => {
  sql.exec("INSERT INTO helpers(id,session,name,task,status,started,deadline,dynamic_routing,required_delegation,round,handed,result_card,handoff_json) VALUES(?,?,?,?,'awaiting_review',1,9999999999999,1,1,1,1,?,?)", id, "s1", "w", "t", `rc${id}`, released ? JSON.stringify({ released: [] }) : "{}");
  db.prepare("INSERT INTO cards(id,session,kind,status,title,opened) VALUES(?,?,?,?,?,?)").run(`rc${id}`, "s1", "handoff", cardStatus, "t", 1);
};
try { worker(1, true, "complete"); worker(2, false, "complete"); worker(3, true, "working"); }
catch (e) { console.log("cards columns", db.prepare("PRAGMA table_info(cards)").all().map((c) => c.name).join()); throw e; }
const out = reconcileHelperReviews(sql);
assert.deepEqual(out.closed, [1], "a released worker whose handoff turn ended is closed");
assert.deepEqual(out.reoffered, [2], "an old run with no release record is handed over again (its files are released then)");
assert.deepEqual(out.failed, [], "nothing fails");
const status = (id) => sql.exec("SELECT status,handed FROM helpers WHERE id=?", id).one();
assert.equal(status(1).status, "approved"); assert.equal(status(2).status, "awaiting_review"); assert.equal(status(2).handed, 0); assert.equal(status(3).status, "awaiting_review", "its handoff turn is still running");
assert.deepEqual(reconcileHelperReviews(sql).closed, [], "closing twice changes nothing");
console.log("PASS helper-no-approval");
process.exit(0);
