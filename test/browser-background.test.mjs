import { SEED } from "./helpers/seed-settings.mjs";
// node --import ./test/stubs/register.mjs test/browser-background.test.mjs
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Resident } from "../src/resident.js";
import { runBrowserTask } from "../src/ee/browser-agent.js";
import { BROWSER_JOB_RELEASE_GRACE_MS, browserJobInput, browserJobRow, browserJobNextWake, browserPurchaseGuard, pendingBrowserHandoffs } from "../src/ee/browser-tasks.js";

const db = new DatabaseSync(":memory:");
const sql = { exec(q, ...args) {
  if (!args.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
  const s = db.prepare(q), rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? s.all(...args) : (s.run(...args), []);
  return { toArray: () => rows, one: () => rows[0] };
} };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
let permissionLevel = "standard";
const env = { ONEHELM_EE: "1hc", BROWSER_AGENT: "jev", MEMORY: "off", GENUI: "off", WORKMEM: "off", NO_TOLERANT_STUBS: true,
  DB: { prepare: (query) => { const q = { bind: () => q,
    first: async () => query.includes("SELECT level FROM perm_prefs") ? { level: permissionLevel } : null,
    all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 0 } }) }; return q; } } };
const waits = [];
const ctx = { storage: { sql, getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {} }, waitUntil: (p) => waits.push(p) };
const R = new Resident(ctx, env);
R.put("tenant", "t1"); R.put("channel", "main"); R.put("channel_id", "1");
R.arm = async () => {};
R.browserFirstCheck = async () => null;

assert.equal(browserJobInput({ url: "http://example.com/", task: "Look" }).error.includes("HTTPS"), true);
assert.equal(browserJobInput({ url: "https://user:pass@example.com/", task: "Look" }).error.includes("credentials"), true);
assert.match(browserJobInput({ url: "https://example.com/", task: "Type password: Tulip-2219" }).error, /secret/);
assert.deepEqual(browserJobInput({ url: "https://example.com/", task: "Type the email", values: ["sam@example.com"] }).values, ["sam@example.com"]);
const orderPage = { url: "https://example.com/products/widget", snapshot: '[e1] button "Place order"\n[e2] link "More details"' };
assert.match(browserPurchaseGuard([{ kind: "click", ref: "e1" }], orderPage), /payment or final-order/);
assert.equal(browserPurchaseGuard([{ kind: "click", ref: "e2" }], orderPage), null);
assert.match(browserPurchaseGuard([{ kind: "click", ref: "e2" }], { ...orderPage, url: "https://example.com/checkout" }), /checkout or payment page/);
assert.match(browserPurchaseGuard([{ kind: "click", ref: "e2" }], { ...orderPage, snapshot: '[e3] heading "Order summary"\n' + orderPage.snapshot }), /checkout or payment page/);
assert.match(browserPurchaseGuard([{ kind: "click", ref: "e9" }], orderPage), /could not be checked/);
assert.match(browserPurchaseGuard([{ kind: "press", key: "Enter" }], orderPage), /submitting a form/);
assert.ok(!R.tools().some((t) => t.function.name === "start_browser_task"), "start_browser_task is no longer offered to new tasks");
assert.ok(R.tools().some((t) => t.function.name === "browser_task"));
assert.ok(R.tools().some((t) => t.function.name === "stop_browser_task"));
assert.ok(R.tools().some((t) => t.function.name === "list_browser_tasks"));
assert.ok(!R.availableTools({ kind: "helper", exclude: new Set() }).some((t) => t.function.name === "start_browser_task"));

let started = null;
R.browserJobRun = async (id) => { started = id; };
const tc = { kind: "chat", session: "s1", turn: "card1", subs: new Set(), emit: () => {} };
const response = await R.browserJobTool("start_browser_task", { url: "https://example.com/", task: "Find the title", values: [] }, tc);
assert.match(response, /Browser job #\d+ started/);
assert.equal(started, 1);
assert.equal(browserJobRow(sql, started).status, "queued");
assert.match(await R.browserJobTool("start_browser_task", { url: "https://example.com/", task: "Again", values: [] }, tc), /another background browser job/);
assert.equal(JSON.parse(await R.browserJobTool("list_browser_tasks", {}, tc)).jobs[0].status, "queued");
assert.match(await R.browserJobTool("stop_browser_task", { id: started }, tc), /next action/);
assert.equal(browserJobRow(sql, started).status, "stopping");

// A reset must not restart a queued, running, or stopping browser action.
R.computer = () => ({ releaseBrowserOwner: async () => ({ owner_lost: true }) });
R.browserJobDeliver = () => { throw new Error("handoff should wait for the alarm"); };
await R.browserJobsRecover({ boot: true });
assert.equal(browserJobRow(sql, started).status, "uncertain");
assert.equal(pendingBrowserHandoffs(sql).length, 0, "an uncertain result waits until its owner lease expires");
assert.ok(browserJobNextWake(sql) > Date.now());
sql.exec("UPDATE browser_jobs SET ended=? WHERE id=?", Date.now() - BROWSER_JOB_RELEASE_GRACE_MS - 1, started);
assert.equal(pendingBrowserHandoffs(sql).length, 1);
R.browserJobDeliver = Resident.prototype.browserJobDeliver;
R.handoff = () => ({ mode: "gone" });
R.browserJobDeliver(started);
assert.equal(browserJobRow(sql, started).handed, 1, "a removed task cannot cause an alarm loop");

// A stricter permission setting must block start before any job is stored or browser ownership is requested.
permissionLevel = "locked";
const beforeCount = sql.exec("SELECT COUNT(*) n FROM browser_jobs").one().n;
assert.match(await R.localTool("start_browser_task", { url: "https://example.com/", task: "Open the page", values: [] }, tc), /NEEDS PERMISSION/);
assert.equal(sql.exec("SELECT COUNT(*) n FROM browser_jobs").one().n, beforeCount);
assert.equal(sql.exec("SELECT perm FROM approvals WHERE perm='browser' ORDER BY id DESC LIMIT 1").one().perm, "browser");
permissionLevel = "careful";
assert.match(await R.localTool("start_browser_task", { url: "https://example.com/", task: "Enter sam@example.com in the form", values: ["sam@example.com"] }, tc), /NEEDS PERMISSION/);
assert.equal(sql.exec("SELECT COUNT(*) n FROM browser_jobs").one().n, beforeCount);
assert.equal(sql.exec("SELECT perm FROM approvals WHERE perm='personal' ORDER BY id DESC LIMIT 1").one().perm, "personal");
permissionLevel = "standard";

// A protected browser request uses the browser job's task, even when another task has a live computer turn.
sql.exec("UPDATE browser_jobs SET status='running', lease_acquired=1 WHERE id=?", started);
R._browserJob = { id: started, session: "s1", turn: "card1", tc: { session: "s1", turn: "card1", subs: new Set(), emit: () => {} } };
R.active.set("other", { session: "s2", turn: "other-card", inTool: 1, finished: false, subs: new Set() });
R.computer = () => ({ browserOwnerState: async () => ({ owned: true }) });
R.approvalPolicy = async (session) => ({ effective: session === "s1" ? "always" : "ask", from: "session" });
assert.equal((await R.egressDecision({ host: "example.com", method: "POST", path: "/sensitive", via: "form" })).verdict, "allow");
R._browserJob = null;
assert.deepEqual(await R.egressDecision({ host: "example.com", method: "POST", path: "/sensitive", via: "form" }),
  { verdict: "deny", why: "background browser task attribution is unavailable" });
assert.equal(R.active.get("other").session, "s2");
R._browserJob = { id: started, session: "s1", turn: "card1", tc: { session: "s1", turn: "card1", subs: new Set(), emit: () => {} } };
R.computer = () => ({ browserOwnerState: async () => ({ owned: false, in_flight: true, human_controlled: true }) });
assert.deepEqual(await R.egressDecision({ host: "example.com", method: "POST", path: "/sensitive", via: "form" }),
  { verdict: "deny", why: "the person took control of a background browser task" });
R._browserJob = null;
assert.deepEqual(await R.egressDecision({ host: "example.com", method: "POST", path: "/sensitive", via: "form" }),
  { verdict: "deny", why: "the person took control of a background browser task" });
let sends = 0;
const uncertain = await runBrowserTask({ env: {}, get: () => "t1" }, { browser: async () => { sends++; return { ok: false, error: "owner changed", operation_may_have_completed: true }; } },
  { url: "https://example.com/", task: "Read the page", values: [] }, {}, { ownerToken: "owner_token", beforeBrowse: () => {}, afterBrowse: () => {} });
assert.equal(uncertain.uncertain, true);
assert.equal(sends, 1, "an uncertain browser action is never retried");
const originalFetch = globalThis.fetch, operations = [];
globalThis.fetch = async (url, init) => {
  assert.match(String(url), /\/systemone$/);
  const body = JSON.parse(init.body), choice = Object.entries(body.questions.next.criteria).find(([, text]) => text.startsWith("Click button"))[0];
  return Response.json({ model: body.model, answers: { next: { choice } }, usage: { cost: 0.00001 } });
};
try {
  const res = { env: { MODEL_SETTINGS: SEED, OPENROUTER_API_KEY: "fixture", PROMPT_CACHE: "off" }, get: () => null,
    ledger: () => ({ reserve: async () => ({ ok: true }), settle: async () => {} }) };
  const C = { browser: async (op) => { operations.push(op); return op === "act"
    ? { ok: false, error: "connection lost after click", operation_may_have_completed: true }
    : { ok: true, url: "https://example.com/", title: "Fixture", snapshot: '[e1] button "Submit"' }; } };
  const click = await runBrowserTask(res, C, { url: "https://example.com/", task: "Click Submit", values: [] }, {}, { ownerToken: "owner_token" });
  assert.equal(click.uncertain, true);
  assert.deepEqual(operations, ["navigate", "act"], "an interrupted click has no replay, snapshot, or next action");
} finally { globalThis.fetch = originalFetch; }
// The background runner checks a payment label before sending its click to Chrome.
const paymentOps = [];
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  const choice = Object.entries(body.questions.next.criteria).find(([, label]) => /Place order/.test(label))[0];
  return Response.json({ model: body.model, answers: { next: { choice } }, usage: { cost: 0.00001 } });
};
try {
  const res = { env: { MODEL_SETTINGS: SEED, OPENROUTER_API_KEY: "fixture", PROMPT_CACHE: "off" }, get: () => null,
    ledger: () => ({ reserve: async () => ({ ok: true }), settle: async () => {} }) };
  const C = { browser: async (op) => { paymentOps.push(op); return { ok: true, url: orderPage.url, title: "Widget", snapshot: orderPage.snapshot }; } };
  const stopped = await runBrowserTask(res, C, { url: orderPage.url, task: "Place order", values: [] }, {}, { ownerToken: "owner_token" });
  assert.equal(stopped.code, 1);
  assert.match(stopped.out, /payment or final-order control/);
  assert.deepEqual(paymentOps, ["navigate"], "a signed-in page never receives the final-order click");
} finally { globalThis.fetch = originalFetch; }

// A new handoff turn must not start until a confirmed release of browser ownership.
const releaseGate = deferred(), releaseStarted = deferred(), handoffs = [];
R.handoff = (_session, input) => { handoffs.push(input); return { mode: "gone" }; };
R.computer = () => ({ acquireBrowserOwner: async () => ({ ok: true }), releaseBrowserOwner: async () => {
  releaseStarted.resolve(); await releaseGate.promise; return { ok: true };
}, browser: async () => ({ ok: true }), touch: async () => ({}), renewBrowserOwner: async () => ({ ok: true }) });
const now = Date.now();
sql.exec("INSERT INTO browser_jobs (session,parent_card,url,task,vals,status,started,deadline,token) VALUES (?,?,?,?,?,'queued',?,?,?)",
  "s1", "card1", "https://example.com/", "Read the page", "invalid-json", now, now + 60000, "owner_token");
const next = sql.exec("SELECT last_insert_rowid() id").one().id;
const running = Resident.prototype.browserJobRun.call(R, next);
await releaseStarted.promise;
assert.equal(handoffs.length, 0, "the report is not delivered while ownership is still held");
releaseGate.resolve(); await running;
assert.equal(handoffs.length, 1);
assert.equal(browserJobRow(sql, next).lease_acquired, 0);
console.log("browser-background: optional start, single owner, stop, reset, and task attribution passed");
