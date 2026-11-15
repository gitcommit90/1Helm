// node --import ./test/stubs/register.mjs test/browser-job-state.test.mjs
// A task with an active browser job is "working" from the moment its turn ends until the job's handoff takes over, and a browser job's
// report step accepts extra fields and, when it still fails, carries a summary built from the recorded steps. Only app facts are judged.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Resident } from "../src/resident.js";
import { runBrowserTask, stepSummary } from "../src/ee/browser-agent.js";
import { pruneUnknownFields, parseStructuredResponse } from "../src/structured-output.js";
import { BROWSER_RESULT_SCHEMA } from "../src/ee/browser-agent.js";
import { SEED } from "./helpers/seed-settings.mjs";

const db = new DatabaseSync(":memory:");
const sql = { exec(q, ...args) {
  if (!args.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
  const s = db.prepare(q), rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? s.all(...args) : (s.run(...args), []);
  return { toArray: () => rows, one: () => rows[0] };
} };
const env = { BROWSER_AGENT: "jev", MEMORY: "off", GENUI: "off", WORKMEM: "off", NO_TOLERANT_STUBS: true,
  DB: { prepare: () => { const q = { bind: () => q, first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 0 } }) }; return q; } } };
const waits = [];
const R = new Resident({ storage: { sql, getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {} }, waitUntil: (p) => waits.push(p) }, env);
R.put("tenant", "t1"); R.put("channel", "main"); R.put("channel_id", "1");
R.arm = async () => {};

// ---- state of a task while a browser job is active ----
const sid = R.newSession("Book a table");
const view = () => R.sessionView(R.session(sid));
const addJob = (status) => sql.exec("INSERT INTO browser_jobs (session,url,task,status,started,deadline,token) VALUES (?,?,?,?,?,?,?)", sid, "https://example.com/", "Do it", status, Date.now(), Date.now() + 6e5, "tok");
assert.equal(view().state, "ready");
for (const status of ["queued", "running", "stopping"]) {
  sql.exec("DELETE FROM browser_jobs"); addJob(status);
  const v = view();
  assert.equal(v.state, "working", `${status}: working`);
  assert.equal(v.background, "browser");
  assert.equal(typeof v.line, "string"); assert.ok(v.line.length > 0 && v.line.length < 80);
}
// a job in another task does not change this task
const other = R.newSession("Other");
assert.equal(R.sessionView(R.session(other)).state, "ready");
// a question for the person still wins over the job
sql.exec("DELETE FROM browser_jobs"); addJob("running");
sql.exec("UPDATE sessions SET waiting='answer' WHERE id=?", sid);
assert.equal(view().state, "waiting"); assert.equal(view().line, null);
sql.exec("UPDATE sessions SET waiting=NULL WHERE id=?", sid);
// after the job ends and is delivered, the task is ready again
R.handoff = () => ({ mode: "gone" });
sql.exec("UPDATE browser_jobs SET status='done',ended=?,report='ok'", Date.now());
assert.equal(view().state, "ready", "a finished job no longer holds the task");
R.browserJobDeliver(sql.exec("SELECT id FROM browser_jobs").toArray()[0].id);
assert.equal(view().state, "ready"); assert.equal(view().line, null); assert.equal(view().background, undefined);

// ---- a report with extra fields is accepted ----
assert.deepEqual(pruneUnknownFields({ summary: "s", extra: 1 }, BROWSER_RESULT_SCHEMA), { summary: "s" });
const resp = (content) => ({ choices: [{ finish_reason: "stop", message: { content } }] });
assert.throws(() => parseStructuredResponse(resp('{"summary":"s","x":1}'), BROWSER_RESULT_SCHEMA), /unexpected field/);
assert.deepEqual(parseStructuredResponse(resp('{"summary":"s","x":1}'), BROWSER_RESULT_SCHEMA, { prune: true }), { summary: "s" });
assert.throws(() => parseStructuredResponse(resp('{"x":1}'), BROWSER_RESULT_SCHEMA, { prune: true }), /missing summary/);

// ---- runBrowserTask: extra-field report accepted; a failed report still carries the step history ----
const originalFetch = globalThis.fetch;
let reportContent = '{"summary":"Table is booked","note":"extra"}';
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  if (body.questions) { const choice = Object.entries(body.questions.next.criteria).find(([, t]) => t.startsWith("Click button"))[0]; return Response.json({ model: body.model, answers: { next: { choice } }, usage: { cost: 0.00001 } }); }
  return Response.json({ choices: [{ finish_reason: "stop", message: { content: reportContent } }], usage: { cost: 0.00001 } });
};
try {
  const res = { env: { MODEL_SETTINGS: SEED, OPENROUTER_API_KEY: "fixture", PROMPT_CACHE: "off" }, get: () => null, ledger: () => ({ reserve: async () => ({ ok: true }), settle: async () => {} }) };
  let n = 0;
  const C = { browser: async (op) => ({ ok: true, url: "https://example.com/r", title: `Page ${op === "act" ? ++n : 0}`, snapshot: op === "act" ? `[e1] button "Submit ${n}"` : '[e1] button "Submit"' }) };
  const ok = await runBrowserTask(res, C, { url: "https://example.com/", task: "Submit", values: [] }, { limits: { browserSteps: 1 } }, {});
  assert.match(ok.out, /Table is booked/); assert.doesNotMatch(ok.out, /unexpected field|report step failed/);
  reportContent = '{"other":"no summary"}';
  const bad = await runBrowserTask(res, C, { url: "https://example.com/", task: "Submit", values: [] }, { limits: { browserSteps: 1 } }, {});
  assert.match(bad.out, /report step failed/);
  assert.match(bad.out, /1 step\(s\) taken/); assert.match(bad.out, /Submit/); assert.match(bad.out, /Page \d/);
  assert.match(bad.out, /Steps: .*→ done/);
  // an error after some steps (a failed action in a background job) also carries the recorded steps
  let calls = 0;
  const C2 = { browser: async (op) => { if (op === "act") { calls++; return { ok: false, error: "tab crashed", operation_may_have_completed: false }; } return { ok: true, url: "https://example.com/", title: "P", snapshot: '[e1] button "Submit"' }; } };
  const err = await runBrowserTask(res, C2, { url: "https://example.com/", task: "Submit", values: [] }, {}, { ownerToken: "t" });
  assert.equal(calls, 1); assert.match(err.out, /tab crashed/); assert.match(err.out, /Recorded steps: 0 step\(s\) taken.*ERROR/);
} finally { globalThis.fetch = originalFetch; }
const sum = stepSummary(['Click button "Submit" → done'], { title: "T", url: "https://x.test/" }, 1);
assert.match(sum, /submit or send was clicked/); assert.doesNotMatch(sum, /No step/);
assert.match(stepSummary(['Looked again'], null, 1), /No step that looks like a submit/);
console.log("browser-job-state passed");
