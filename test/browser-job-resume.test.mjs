// node --import ./test/stubs/register.mjs test/browser-job-resume.test.mjs
// A background browser job that a restart interrupted resumes on boot: it keeps its history, step count and charge, never replays the action
// that was in flight, and is ended as before when it was taken over, is past its deadline, has no saved state or is out of steps.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Resident } from "../src/resident.js";
import { runBrowserTask } from "../src/ee/browser-agent.js";
import { SEED } from "./helpers/seed-settings.mjs";

const db = new DatabaseSync(":memory:");
const sql = { exec(q, ...args) {
  if (!args.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
  const s = db.prepare(q), rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? s.all(...args) : (s.run(...args), []);
  return { toArray: () => rows, one: () => rows[0] };
} };
const env = { BROWSER_AGENT: "jev", MEMORY: "off", GENUI: "off", WORKMEM: "off", NO_TOLERANT_STUBS: true, MODEL_SETTINGS: SEED, OPENROUTER_API_KEY: "fixture", PROMPT_CACHE: "off",
  DB: { prepare: () => { const q = { bind: () => q, first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 0 } }) }; return q; } } };
const waits = [];
const R = new Resident({ storage: { sql, getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {} }, waitUntil: (p) => waits.push(p) }, env);
R.put("tenant", "t1"); R.put("channel", "main"); R.put("channel_id", "1");
R.arm = async () => {}; R.handoff = () => ({ mode: "gone" });
R.ledger = () => ({ reserve: async () => ({ ok: true }), settle: async () => {} });
const sid = R.newSession("Fill the form");

// The decider always picks "Look again", so a resumed run takes no page action of its own.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  if (body.questions) {
    const q = body.questions.next ? "next" : "done", crit = body.questions[q].criteria;
    const choice = q === "done" ? "true" : Object.entries(crit).find(([, t]) => t.startsWith("Look again"))[0];
    return Response.json({ model: body.model, answers: { [q]: { choice } }, usage: { cost: 0.00001 } });
  }
  return Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"summary":"Form still open"}' } }], usage: { cost: 0.00001 } });
};

const page = { ok: true, url: "https://example.com/apply", title: "Apply", snapshot: '[e1] textbox "Name"\n[e2] button "Save"' };
const makeComputer = ({ humanControlled = false, acquire = { ok: true } } = {}) => {
  const ops = [];
  return { ops, c: { acquireBrowserOwner: async () => acquire, renewBrowserOwner: async () => ({ ok: true }), releaseBrowserOwner: async () => ({ ok: true }), touch: async () => {},
    browserOwnerState: async () => ({ human_controlled: humanControlled }), browser: async (op, body) => { ops.push({ op, body }); return page; } } };
};
const state = (extra = {}) => JSON.stringify({ hist: ['Click button "Name" → done', 'Click button "Save"'], dead: ['Click button "Name"'], steps: 3, values: ["Ann"], charge: 5000, inflight: 'Click button "Save"', ...extra });
const addJob = (extra = {}) => {
  const j = { status: "running", deadline: Date.now() + 5 * 60e3, resume_state: state(), ...extra };
  sql.exec("INSERT INTO browser_jobs (session,url,task,vals,status,started,deadline,token,lease_acquired,last_step,mode,resume_state) VALUES (?,?,?,?,?,?,?,?,1,3,'task',?)",
    sid, page.url, "Finish the application form", '["Ann"]', j.status, Date.now() - 1000, j.deadline, "t".repeat(40), j.resume_state);
  return sql.exec("SELECT last_insert_rowid() id").one().id;
};
const row = (id) => sql.exec("SELECT * FROM browser_jobs WHERE id=?", id).toArray()[0];
const settle = async () => { await Promise.all(waits.splice(0)); await new Promise((r) => setTimeout(r, 20)); await Promise.all(waits.splice(0)); };

try {
  // ---- runBrowserTask: resume keeps history, steps and charge, and sends no action ----
  { const saved = [], mc = makeComputer();
    const res = { env, get: () => null, ledger: R.ledger };
    const r = await runBrowserTask(res, mc.c, { url: page.url, task: "Finish the form", values: ["Ann"] }, { limits: { browserSteps: 4 } },
      { ownerToken: "tok", saveState: (s) => saved.push(s), resume: JSON.parse(state()) });
    assert.deepEqual(mc.ops.map((x) => x.op).filter((o) => o !== "snapshot"), [], "no navigate and no act on resume");
    assert.equal(mc.ops[0].op, "snapshot");
    assert.match(r.out, /in 4 step\(s\)/, "the saved step count continues");
    assert.match(r.out, /Click button "Name" → done/); assert.match(r.out, /Click button "Save" → ERROR \(outcome unconfirmed after a restart/);
    assert.match(r.out, /Resumed after a restart/);
    assert.ok(r.charge >= 5000, "the saved charge carries on");
    assert.equal(saved[0].inflight, null, "the in-flight note is cleared at once, so a second restart does not add it again");
    assert.equal(saved[0].steps, 3); assert.ok(saved[0].dead.includes('Click button "Save"')); assert.deepEqual(saved[0].values, ["Ann"]);
  }

  // ---- a normal run saves its state before each step, with the action about to be sent ----
  { const saved = [], mc = makeComputer();
    mc.c.browser = async (op, body) => { mc.ops.push({ op, body }); if (op === "act") throw Object.assign(new Error("restart"), { stopped: true }); return page; };
    globalThis.fetch = (f => async (u, i) => { const b = JSON.parse(i.body); if (b.questions?.next) { const choice = Object.entries(b.questions.next.criteria).find(([, t]) => t.startsWith("Click button"))[0]; return Response.json({ model: b.model, answers: { next: { choice } }, usage: { cost: 0 } }); } return f(u, i); })(globalThis.fetch);
    await runBrowserTask({ env, get: () => null, ledger: R.ledger }, mc.c, { url: page.url, task: "Finish the form", values: ["Ann"] }, {}, { ownerToken: "tok", saveState: (s) => saved.push(s) });
    assert.ok(saved.length >= 2); assert.match(saved.at(-1).inflight, /^Click button/);
  }
  globalThis.fetch = originalFetch;
} finally { /* restored below */ }
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  if (body.questions) { const q = body.questions.next ? "next" : "done", crit = body.questions[q].criteria;
    const choice = q === "done" ? "true" : Object.entries(crit).find(([, t]) => t.startsWith("FINISH"))[0];
    return Response.json({ model: body.model, answers: { [q]: { choice } }, usage: { cost: 0.00001 } }); }
  return Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"summary":"Form still open"}' } }], usage: { cost: 0.00001 } });
};

try {
  // ---- boot: a running job with saved state resumes ----
  { const mc = makeComputer(); R.computer = () => mc.c;
    const id = addJob(); await R.browserJobsRecover({ boot: true }); await settle();
    const j = row(id);
    assert.notEqual(j.status, "uncertain", "resumed, not ended"); assert.equal(j.pending_op, null);
    assert.equal(mc.ops.filter((x) => x.op === "navigate" || x.op === "act").length, 0, "the in-flight action is not replayed");
    assert.match(j.report || "", /Click button "Save" → ERROR \(outcome unconfirmed/);
    assert.equal(JSON.parse(j.resume_state).steps >= 3, true);
    // a second restart during the resumed run does not add the in-flight note again or reset the count
    const id2 = addJob({ resume_state: state({ inflight: null, hist: ['Click button "Save" → ERROR (outcome unconfirmed after a restart; do not repeat, check the page)', "Resumed after a restart: the page was read again"] }) });
    await R.browserJobsRecover({ boot: true }); await settle();
    const rep2 = row(id2).report || ""; assert.equal((rep2.match(/outcome unconfirmed/g) || []).length, 1);
  }
  // ---- boot: cases that cannot resume end as before ----
  const ended = async (extra, mc = makeComputer()) => { R.computer = () => mc.c; const id = addJob(extra); await R.browserJobsRecover({ boot: true }); await settle(); return { j: row(id), mc }; };
  { const { j, mc } = await ended({ deadline: Date.now() - 1000 });
    assert.equal(j.status, "uncertain"); assert.match(j.report, /interrupted by a restart/); assert.match(j.report, /no action was replayed/); assert.equal(mc.ops.length, 0); }
  { const { j, mc } = await ended({}, makeComputer({ humanControlled: true }));
    assert.equal(j.status, "uncertain"); assert.equal(mc.ops.length, 0, "a job the person took over is not resumed"); }
  { const { j } = await ended({ resume_state: null }); assert.equal(j.status, "uncertain"); }
  { const { j } = await ended({ status: "stopping" }); assert.equal(j.status, "uncertain"); }
  { const { j } = await ended({ resume_state: state({ steps: 999 }) }); assert.equal(j.status, "uncertain", "out of steps"); }
  { const { j, mc } = await ended({}, makeComputer({ acquire: { ok: false, error: "The person has control of the browser.", taken_over: true } }));
    assert.equal(j.status, "uncertain"); assert.match(j.report, /could not resume/); assert.equal(mc.ops.length, 0); }
} finally { globalThis.fetch = originalFetch; }
console.log("browser-job-resume passed");
