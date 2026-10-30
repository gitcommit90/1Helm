import { SEED } from "./helpers/seed-settings.mjs";
// node --import ./test/stubs/register.mjs test/browser-one-tool.test.mjs
// browser_task is the one browser tool: a fast job returns in the same turn, a slow one moves to the background.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Resident } from "../src/resident.js";
import { browserJobRow, browserTaskWaitMs, browserTaskInput } from "../src/ee/browser-tasks.js";

const db = new DatabaseSync(":memory:");
const sql = { exec(q, ...args) {
  if (!args.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
  const s = db.prepare(q), rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? s.all(...args) : (s.run(...args), []);
  return { toArray: () => rows, one: () => rows[0] };
} };
const env = { ONEHELM_EE: "1hc", BROWSER_AGENT: "jev", BROWSER_TASK_WAIT_MS: "400", MODEL_SETTINGS: SEED, OPENROUTER_API_KEY: "fixture", PROMPT_CACHE: "off", MEMORY: "off", GENUI: "off", WORKMEM: "off", NO_TOLERANT_STUBS: true,
  DB: { prepare: (query) => { const q = { bind: () => q, first: async () => (query.includes("SELECT level FROM perm_prefs") ? { level: "standard" } : null), all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 0 } }) }; return q; } } };
const waits = [];
const R = new Resident({ storage: { sql, getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {} }, waitUntil: (p) => waits.push(p) }, env);
R.put("tenant", "t1"); R.put("channel", "main"); R.put("channel_id", "1");
R.arm = async () => {};
R.browserFirstCheck = async () => null;
R.ledger = () => ({ reserve: async () => ({ ok: true }), settle: async () => {} });
const calls = { release: 0, acquire: 0, ops: [] }, handoffs = [];
R.computer = () => ({ acquireBrowserOwner: async () => { calls.acquire++; return { ok: true }; }, releaseBrowserOwner: async () => { calls.release++; return { ok: true }; },
  renewBrowserOwner: async () => ({ ok: true }), touch: async () => ({}),
  browser: async (op, _b, token) => { calls.ops.push([op, token ? "owned" : "free"]); return { ok: true, url: "https://example.com/", title: "Example", snapshot: '[e1] link "More"' }; } });
R.handoff = (_s, input) => { handoffs.push(input); return { mode: "open", card: { id: "c-next" } }; };

let gate = null;   // when set, the decider waits for it, which keeps a job running
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  if (String(url).endsWith("/systemone")) {
    if (gate) await gate.promise;
    const q = body.questions, answers = {};
    if (q.next) answers.next = { choice: Object.entries(q.next.criteria).find(([, t]) => /^FINISH/.test(t))[0] };
    if (q.done) answers.done = { noul: 1 };
    return Response.json({ model: body.model, answers, usage: { cost: 0.00001 } });
  }
  return Response.json({ id: "x", model: body.model, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ summary: "The page title is Example Domain." }) } }], usage: { cost: 0.00001 } });
};
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const mkTc = (extra = {}) => ({ kind: "chat", session: "s1", turn: "card1", subs: new Set(), emit: () => {}, inTool: 1, ...extra });
const sleep = (ms) => new Promise((z) => setTimeout(z, ms));
try {
  assert.equal(browserTaskWaitMs({}), 45000);
  assert.equal(browserTaskWaitMs({ BROWSER_TASK_WAIT_MS: "5000" }), 5000);
  assert.equal(browserTaskWaitMs({ BROWSER_TASK_WAIT_MS: "999999" }), 90000);
  assert.equal(browserTaskInput({ task: "Look" }).url, "");
  assert.match(browserTaskInput({ url: "ftp://x.com", task: "Look" }).error, /http/);

  // The test-only per-channel wait overrides the default and clears back to it.
  assert.deepEqual(await R.setBrowserWait(1234), { browser_wait_ms: 1234 });
  assert.deepEqual(await R.setBrowserWait(""), { browser_wait_ms: null });

  // 1. A fast job: the result comes back in the same turn and no message follows.
  const fast = await R.browserToolInner("browser_task", { url: "https://example.com/", task: "Read the title", values: [] }, mkTc());
  assert.equal(fast.code, 0);
  assert.match(fast.out, /browser_task finished/);
  assert.match(fast.out, /The page title is Example Domain/);
  const j1 = browserJobRow(sql, 1);
  assert.equal(j1.status, "done"); assert.equal(j1.handed, 1); assert.equal(j1.mode, "task");
  assert.equal(handoffs.length, 0, "a result returned in the turn is not sent again as a message");
  assert.equal(calls.release, 1, "the browser is released before the tool returns");
  assert.ok(calls.ops.every(([, t]) => t === "owned"), "the job uses its own owner token");

  // 2. A slow job moves to the background; the channel keeps one job; the result arrives as a message.
  gate = deferred();
  const slow = await R.browserToolInner("browser_task", { url: "https://example.com/", task: "Read the title", values: [] }, mkTc());
  assert.equal(slow.code, 0);
  assert.match(slow.out, /Browser job #2 is still working.*background/);
  assert.equal(browserJobRow(sql, 2).handed, 0);
  assert.equal(handoffs.length, 0);
  const again = await R.browserToolInner("browser_task", { url: "https://example.com/", task: "Another", values: [] }, mkTc());
  assert.equal(again.code, 1); assert.match(again.out, /job #2 is still working/);
  assert.equal(JSON.parse(await R.browserJobTool("list_browser_tasks", {}, mkTc())).jobs[0].status, "running");
  assert.match(await R.browserJobTool("start_browser_task", { url: "https://example.com/", task: "Legacy" }, mkTc()), /another background browser job/, "the legacy tool still works and honours the one-job lock");
  gate.resolve(); gate = null;
  await Promise.all(waits); await sleep(50);
  const j2 = browserJobRow(sql, 2);
  assert.equal(j2.status, "done"); assert.equal(j2.handed, 1); assert.equal(j2.result_card, "c-next");
  assert.equal(handoffs.length, 1);
  assert.match(handoffs[0].text, /browser job #2 finished/);
  assert.match(handoffs[0].text, /Example Domain/);

  // 3. Stop and list work on a browser_task job.
  gate = deferred();
  const stopMe = await R.browserToolInner("browser_task", { url: "https://example.com/", task: "Slow", values: [] }, mkTc());
  assert.match(stopMe.out, /job #3/);
  assert.match(await R.browserJobTool("stop_browser_task", { id: 3 }, mkTc()), /will stop before its next action/);
  assert.equal(browserJobRow(sql, 3).status, "stopping");
  gate.resolve(); gate = null; await Promise.all(waits); await sleep(50);
  assert.equal(browserJobRow(sql, 3).status, "stopped");
  assert.equal(handoffs.length, 2);

  // 4. A person who writes again while it waits does not block: the job moves to the background at once.
  gate = deferred();
  const t0 = Date.now();
  const steered = await R.browserToolInner("browser_task", { url: "https://example.com/", task: "Slow", values: [] }, mkTc({ abort: "soft" }));
  assert.match(steered.out, /still working/); assert.ok(Date.now() - t0 < 300);
  gate.resolve(); gate = null; await Promise.all(waits); await sleep(50);
  assert.equal(handoffs.length, 3);

  // 4b. A new message from the person while it waits stops the job at the next boundary and hands back, with no later message.
  gate = deferred(); let steer = false; const hs = R.hasSteers; R.hasSteers = () => steer;
  const pending = R.browserToolInner("browser_task", { url: "https://example.com/", task: "Slow", values: [] }, mkTc());
  await sleep(100); steer = true; gate.resolve(); gate = null;
  const handed = await pending; R.hasSteers = hs;
  assert.match(handed.out, /handed back for the person's updated request/);
  assert.equal(handoffs.length, 3, "a handed-back job sends no message");
  await Promise.all(waits);

  // 5. A caller that is not a task with the person (a workflow run) keeps the attended path: no job row.
  const before = sql.exec("SELECT COUNT(*) n FROM browser_jobs").one().n;
  const wf = await R.browserToolInner("browser_task", { url: "https://example.com/", task: "Read the title", values: [] }, { kind: "workflow", subs: new Set(), emit: () => {} });
  assert.equal(wf.code, 0); assert.match(wf.out, /browser_task finished/);
  assert.equal(sql.exec("SELECT COUNT(*) n FROM browser_jobs").one().n, before);

  // 5b. A job from one task is visible, explained and stoppable from another task of the same channel.
  const owner = R.newSession("Plan the trip"), other = R.newSession("Something else");
  const tcO = mkTc({ session: owner, turn: "cardO" }), tcX = mkTc({ session: other, turn: "cardX" });
  gate = deferred();
  const moved = await R.browserToolInner("browser_task", { url: "https://example.com/", task: "Slow", values: [] }, tcO);
  const xid = Number(moved.out.match(/#(\d+)/)[1]);
  const seen = JSON.parse(await R.browserJobTool("list_browser_tasks", {}, tcX)).jobs;
  assert.equal(seen.length, 1); assert.equal(seen[0].id, xid); assert.equal(seen[0].from_another_task, true); assert.equal(seen[0].task_title, "Plan the trip");
  // Each task has its own browser tab, so the job holds only its own task's tab: the same task is refused a second job, another task is not.
  const tcO2 = mkTc({ session: owner, turn: "cardO2" });
  const refusedO = await R.browserToolInner("browser_task", { url: "https://example.com/", task: "Mine", values: [] }, tcO2);
  assert.match(refusedO.out, new RegExp(`job #${xid} is still working in this task's browser tab.*from this task.*stop_browser_task \\(id ${xid}\\)`));
  assert.match(await R.browserJobTool("start_browser_task", { url: "https://example.com/", task: "Legacy" }, tcO2), /already running in this task \(from this task/);
  // the shared computer's refusal of other work says which job holds it and how to stop it (only the task that owns the job is told)
  const busyNote = R.browserBusyNote({ code: 1, out: "A background browser job is using this channel's computer. Wait for it to finish or take control of the browser.", browser_busy: true }, owner);
  assert.match(busyNote.out, new RegExp(`browser job #${xid} \\(from this task.*stop_browser_task with id ${xid}`));
  assert.equal(R.browserBusyNote({ code: 1, out: "A background browser job is using this channel's computer.", browser_busy: true }, other).out, "A background browser job is using this channel's computer.");
  assert.equal(R.browserBusyNote({ code: 1, out: "some other error" }, owner).out, "some other error");
  const hCount = handoffs.length;
  assert.match(await R.browserJobTool("stop_browser_task", { id: xid }, tcX), /from another task, "Plan the trip".*reported in that task/);
  assert.equal(browserJobRow(sql, xid).status, "stopping");
  gate.resolve(); gate = null; await Promise.all(waits); await sleep(50);
  assert.equal(browserJobRow(sql, xid).status, "stopped");
  assert.equal(handoffs.length, hCount + 1); assert.equal(handoffs[hCount].text.includes("Stopped from another task"), true, "the owning task is told it was stopped from elsewhere");
  assert.match(await R.browserJobTool("stop_browser_task", { id: xid }, tcX), /no browser job .* is working/);
  assert.match(await R.browserJobTool("stop_browser_task", { id: 9999 }, tcX), /exists in this channel/);
  // test cleanup: stops every working job
  gate = deferred();
  const lone = await R.browserToolInner("browser_task", { url: "https://example.com/", task: "Slow", values: [] }, tcO);
  const loneId = Number(lone.out.match(/#(\d+)/)[1]);
  const cl = await R.stopBrowserJobs(); assert.deepEqual(cl.stopping, [loneId]);
  gate.resolve(); gate = null; await Promise.all(waits); await sleep(50);
  assert.equal(browserJobRow(sql, loneId).status, "stopped");
  assert.equal((await R.stopBrowserJobs()).working, 0);

  // 6. A deploy during a job still makes it uncertain and never replays an action.
  gate = deferred();
  const dep = await R.browserToolInner("browser_task", { url: "https://example.com/", task: "Slow", values: [] }, mkTc());
  const depId = Number(dep.out.match(/#(\d+)/)[1]);
  await R.browserJobsRecover({ boot: true });
  assert.equal(browserJobRow(sql, depId).status, "uncertain");
  gate.resolve(); gate = null; await Promise.all(waits);
} finally { globalThis.fetch = realFetch; }
console.log("browser-one-tool: fast finish, background move, one-job lock, stop, steer, attended fallback, restart passed");
