// node --import ./test/stubs/register.mjs test/browser-handson.test.mjs
// Hands-on browser mode (task cu-escalate). When the browser worker (browser_task or a background job) ends with any status other than
// done, or the model's own browser_act errors, the model takes the browser at once: the uncertain job's lease is released to its own task,
// each browser_snapshot and browser_act result also shows the page (a screenshot when the model takes images, else the description),
// browser_task is not offered, and at most two screenshots stay in the input. The purchase, personal-fill and payment guards still run.
// A task that never fails sees exactly what it saw before. No network and no model calls: the decider and the browser are stand-ins.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Resident } from "../src/resident.js";
import { SEED } from "./helpers/seed-settings.mjs";
import { pendingBrowserHandoffs, browserJobRow, browserJobHandoff } from "../src/ee/browser-tasks.js";
import { jobNeedsHands, actErrorNeedsHands, keepLatestPictures, imageParts, handsOnMessage, HANDS_ON_KEEP, HANDS_ON_HIDDEN } from "../src/browser-handson.js";

const ok = (n) => console.log("  ok", n);

// ---- the trigger, from facts only ----
for (const s of ["uncertain", "blocked", "failed"]) assert.equal(jobNeedsHands(s), true, s);
assert.equal(jobNeedsHands("done"), false); assert.equal(jobNeedsHands("stopped"), false, "the person's own stop is not a failure"); assert.equal(jobNeedsHands(null), false);
assert.equal(actErrorNeedsHands({ ok: false, error: "no element e9" }), true);
assert.equal(actErrorNeedsHands({ ok: true }), false);
assert.equal(actErrorNeedsHands({ ok: false, error: "A background browser task is using this browser", browser_busy: true }), false, "another holder is not a page failure");
assert.equal(actErrorNeedsHands({ ok: false, taken_over: true }), false); assert.equal(actErrorNeedsHands({ ok: false, owner_lost: true }), false);
ok("trigger");

// ---- the cap on screenshots kept ----
{ const msgs = [], list = [];
  for (let i = 0; i < 5; i++) { const m = handsOnMessage({ type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } }); msgs.push({ role: "tool", content: "x" }, m); keepLatestPictures(list, m); }
  assert.equal(HANDS_ON_KEEP, 2); assert.equal(imageParts(msgs), 2, "only the latest two screenshots stay in the input");
  assert.match(msgs[1].content, /older screenshot .* removed/); assert.equal(typeof msgs[1].content, "string"); assert.equal(Array.isArray(msgs.at(-1).content), true); }
ok("cap");

// ---- a resident with stand-ins ----
const db = new DatabaseSync(":memory:");
const sql = { exec(q, ...args) {
  if (!args.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
  const s = db.prepare(q), rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? s.all(...args) : (s.run(...args), []);
  return { toArray: () => rows, one: () => rows[0] };
} };
const env = { ONEHELM_EE: "1hc", BROWSER_AGENT: "jev", MEMORY: "off", GENUI: "off", WORKMEM: "off", NO_TOLERANT_STUBS: true, MODEL_SETTINGS: SEED, OPENROUTER_API_KEY: "fixture", PROMPT_CACHE: "off", BROWSER_TASK_WAIT_MS: "60000",
  DB: { prepare: () => { const q = { bind: () => q, first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 0 } }) }; return q; } } };
const waits = [];
const R = new Resident({ storage: { sql, getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {} }, waitUntil: (p) => waits.push(p) }, env);
R.put("tenant", "t1"); R.put("channel", "main"); R.put("channel_id", "1");
R.arm = async () => {}; R.handoff = () => ({ mode: "gone" });
R.ledger = () => ({ reserve: async () => ({ ok: true }), settle: async () => {} });
R.put("browser_wait_ms", "60000");
const sid = R.newSession("Fill the form");
const settle = async () => { await Promise.all(waits.splice(0)); await new Promise((r) => setTimeout(r, 30)); await Promise.all(waits.splice(0)); };

const page = { ok: true, url: "https://jobs.example/apply", title: "Apply", snapshot: '[e1] textbox "Name"\n[e2] button "Save"' };
// the browser stand-in: act fails the way a lost action does when `actMode` is "lost"; every call is recorded
const mk = (actMode = "ok") => { const calls = [], rel = [];
  return { calls, rel, c: { acquireBrowserOwner: async () => ({ ok: true }), renewBrowserOwner: async () => ({ ok: true }), touch: async () => {},
    releaseBrowserOwner: async (t, tab) => { rel.push({ t, tab }); return { ok: true }; },
    browser: async (op, body, tok) => { calls.push({ op, body, tok });
      if (op === "act" && actMode === "lost") return { ok: false, error: "the connection dropped", operation_may_have_completed: true };
      if (op === "act" && actMode === "error") return { ok: false, error: "no element e9 on the page now" };
      if (op === "screenshot") return { ok: true, jpeg_base64: "QUJD", url: page.url, title: page.title };
      return { ...page, completed: 1, page_changed: true }; } } }; };
const originalFetch = globalThis.fetch;
// the decider picks `pick` ("Click", "FINISH") each time, and the report step answers
let pick = "Click";
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  if (body.questions) { const q = body.questions.next ? "next" : "done", crit = body.questions[q].criteria;
    const choice = q === "done" ? "true" : Object.entries(crit).find(([, t]) => t.startsWith(pick))[0];
    return Response.json({ model: body.model, answers: { [q]: { choice } }, usage: { cost: 0.00001 } }); }
  return Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"summary":"report"}' } }], usage: { cost: 0.00001 } });
};
const chat = (extra = {}) => ({ kind: "chat", session: sid, turn: "card-" + Math.random().toString(36).slice(2), subs: new Set(), emit: () => {}, inTool: 0, ...extra });
const seesImages = { taskProfile: { catalog: { input_modalities: ["text", "image"] } } }, textOnly = { taskProfile: { catalog: { input_modalities: ["text"] } } };

try {
  // ---- a job that ends uncertain: the lease goes back to the task at once, the result tells the model it has the browser ----
  { const mc = mk("lost"); R.computer = () => mc.c; const tc = chat(seesImages);
    const r = await R.browserTaskJob({ url: page.url, task: "Fill the form", values: ["Ann"] }, tc); await settle();
    const j = sql.exec("SELECT * FROM browser_jobs ORDER BY id DESC LIMIT 1").one();
    assert.equal(j.status, "uncertain"); assert.equal(mc.rel.length >= 1, true, "the lease was released when the job ended"); assert.equal(j.lease_free, 1); assert.equal(j.lease_acquired, 0);
    assert.match(r.out, /may or may not have happened/); assert.match(r.out, /You have the browser now/); assert.doesNotMatch(r.out, /take control/i);
    assert.equal(R.isHandsOn(tc), true, "hands-on mode is on for the rest of the turn");
    sql.exec("UPDATE browser_jobs SET handed=0 WHERE id=?", j.id);   // (browser_task already returned this result inline; check the background delivery rule)
    assert.equal(pendingBrowserHandoffs(sql).some((x) => x.id === j.id), true, "its result need not wait out the two minute lease");
    assert.match(browserJobHandoff(j), /The browser is free again/);
    ok("uncertain job releases the lease to its own task"); }

  // ---- a job that is blocked also puts the model on the browser; a done job changes nothing ----
  { pick = "Click"; const mc = mk("error"); R.computer = () => mc.c; const tc = chat(seesImages);
    const r = await R.browserTaskJob({ url: page.url, task: "Fill the form", values: [] }, tc); await settle();
    assert.equal(R.isHandsOn(tc), true); assert.match(r.out, /did not finish|may or may not/); }
  { pick = "FINISH"; const mc = mk("ok"); R.computer = () => mc.c; const tc = chat(seesImages);
    const r = await R.browserTaskJob({ url: page.url, task: "Read the title", values: [] }, tc); await settle();
    assert.equal(sql.exec("SELECT status FROM browser_jobs ORDER BY id DESC LIMIT 1").one().status, "done");
    assert.equal(R.isHandsOn(tc), false, "a done job does not turn hands-on mode on");
    assert.doesNotMatch(r.out, /You have the browser|did not finish|may or may not/);
    assert.equal(mc.calls.some((x) => x.op === "screenshot"), false, "no extra screenshot for a task that did not fail");
    assert.equal(tc.viewPics, undefined); assert.equal(tc.handsOn, undefined); }
  ok("blocked turns it on, done does not");

  // ---- the model's own browser_act: an error turns it on, a refusal because someone else holds the browser does not ----
  { const tc = chat(seesImages), mc = mk("error"); R.computer = () => mc.c;
    const r = await R.execComputerTool("browser_act", { actions: [{ kind: "click", ref: "e9" }] }, tc);
    assert.equal(r.code, 1); assert.match(r.out, /browser error: no element e9/); assert.match(r.out, /You have the browser yourself/);
    assert.equal(tc.handsOn, true); assert.equal(tc.viewPics.length, 1, "the page is shown at the moment of the failure"); assert.equal(tc.viewPics[0].part.type, "image_url");
    assert.match(r.out, /screenshot of the page follows/); }
  { const tc = chat(seesImages), mc = mk("ok"); mc.c.browser = async (op) => ({ ok: false, error: "A background browser task is using this browser.", browser_busy: true }); R.computer = () => mc.c;
    const r = await R.execComputerTool("browser_act", { actions: [{ kind: "click", ref: "e1" }] }, tc);
    assert.equal(r.code, 1); assert.equal(tc.handsOn, undefined, "a busy browser is not a page failure"); }
  ok("browser_act error trigger");

  // ---- hands-on: each snapshot and act result carries the page, as an image only when the model takes images ----
  { const tc = chat(seesImages), mc = mk("ok"); R.computer = () => mc.c; R.enterHandsOn(tc);
    const a = await R.execComputerTool("browser_snapshot", {}, tc), b = await R.execComputerTool("browser_act", { actions: [{ kind: "click", ref: "e2" }] }, tc);
    assert.equal(a.code, 0); assert.equal(b.code, 0); assert.equal(tc.viewPics.length, 2); assert.equal(tc.needImg, true);
    assert.deepEqual(tc.viewPics[0].part.image_url.url, "data:image/jpeg;base64,QUJD");
    const shots = mc.calls.filter((x) => x.op === "screenshot"); assert.equal(shots.length, 2); assert.equal(shots[0].body.max_width, 1000, "scaled to about 1000 px"); assert.equal(shots[0].body.ocr, undefined);
    // one flush per step keeps only the newest picture of that step, and the turn keeps the latest two
    const messages = []; R.save = () => {}; R.flushViewPics(tc, messages, "t"); assert.equal(imageParts(messages), 1);
    for (let i = 0; i < 4; i++) { tc.viewPics = [{ hands: true, name: "browser page", part: { type: "image_url", image_url: { url: "data:image/jpeg;base64,QQ" } } }]; R.flushViewPics(tc, messages, "t"); }
    assert.equal(imageParts(messages), 2, "at most two screenshots stay"); }
  { const tc = chat(textOnly), mc = mk("ok"); R.computer = () => mc.c; R.enterHandsOn(tc);
    let looked = 0; R.lookAtScreen = async () => { looked++; return { code: 0, out: "Description: a form with a Save button" }; };
    const a = await R.execComputerTool("browser_snapshot", {}, tc);
    assert.equal(tc.viewPics, undefined, "no image part for a model that cannot take images"); assert.equal(looked, 1); assert.match(a.out, /Description: a form with a Save button/);
    assert.equal(mc.calls.find((x) => x.op === "screenshot").body.ocr, true, "the description path asks for the text read too, like look:true"); }
  { const tc = chat(seesImages), mc = mk("ok"); R.computer = () => mc.c; R.enterHandsOn(tc); tc.noPics = true;   // the pi engine sends text only
    R.lookAtScreen = async () => ({ code: 0, out: "Description: pi" }); const a = await R.execComputerTool("browser_snapshot", {}, tc);
    assert.equal(tc.viewPics, undefined); assert.match(a.out, /Description: pi/); }
  { const tc = chat(seesImages), mc = mk("ok"); R.computer = () => mc.c; R.enterHandsOn(tc); R.put("card_filled_url", page.url);   // a card was just filled on this page
    const a = await R.execComputerTool("browser_snapshot", {}, tc); assert.equal(a.code, 0); assert.equal(tc.viewPics, undefined, "the page is not shown while a card is on it"); R.put("card_filled_url", ""); }
  ok("hands-on results show the page");

  // ---- a task that never failed: snapshot and act make no screenshot call, same as before ----
  { const tc = chat(seesImages), mc = mk("ok"); R.computer = () => mc.c;
    await R.execComputerTool("browser_snapshot", {}, tc); await R.execComputerTool("browser_act", { actions: [{ kind: "click", ref: "e2" }] }, tc);
    assert.deepEqual([...new Set(mc.calls.map((x) => x.op))].sort(), ["act", "snapshot"]); assert.equal(tc.viewPics, undefined); }
  ok("no failure, no change");

  // ---- browser_task is not offered, and is refused if called, in hands-on mode ----
  { const tc = chat(seesImages), mc = mk("ok"); R.computer = () => mc.c;
    const before = R.modelTools(tc).map((t) => t.function.name); assert.equal(before.includes("browser_task"), true);
    R.enterHandsOn(tc); const after = R.modelTools(tc).map((t) => t.function.name);
    for (const n of HANDS_ON_HIDDEN) assert.equal(after.includes(n), false, `${n} is not offered`);
    assert.equal(after.includes("browser_snapshot") || before.includes("browser_snapshot") === false, true, "the model's own browser tools stay");
    const r = await R.execComputerTool("browser_task", { task: "again" }, tc); assert.equal(r.code, 1); assert.match(r.out, /off for the rest of this turn/);
    assert.match(await R.browserJobTool("start_browser_task", { url: page.url, task: "again" }, tc), /off for the rest of this turn/);
    assert.equal(mc.calls.length, 0, "the refusal makes no browser call");
    // another task of the same channel is not in hands-on mode
    const other = chat(); assert.equal(R.isHandsOn(other), false); }
  ok("browser_task off in hands-on mode");

  // ---- the guards still run in hands-on mode ----
  { const tc = chat(seesImages), mc = mk("ok"); mc.c.browser = async (op, body) => { mc.calls.push({ op, body }); return op === "screenshot" ? { ok: true, jpeg_base64: "QUJD", url: page.url } : { ok: true, url: page.url, title: "Sign in", snapshot: '[e1] password input "Password"\n[e2] button "Sign in"', completed: 1 }; };
    R.computer = () => mc.c; R.enterHandsOn(tc);
    const r = await R.execComputerTool("browser_act", { actions: [{ kind: "fill", ref: "e1", text: "hunter2-secret" }] }, tc);
    assert.equal(r.code, 1, "typing a password is still refused: " + r.out); assert.equal(mc.calls.some((x) => x.op === "act"), false, "the act never reached the browser");
    assert.equal(tc.viewPics, undefined, "a refused act shows no page"); }
  ok("guards in hands-on mode");

  // ---- a failed background job puts the task's next turn in hands-on mode, once, and an old note expires ----
  { R.queueHandsOn(sid); const t1 = chat(seesImages); assert.equal(R.isHandsOn(t1), true); const t2 = chat(seesImages); assert.equal(R.isHandsOn(t2), false, "only the next turn");
    R.put("handson_next:" + sid, String(Date.now() - 31 * 60e3)); assert.equal(R.isHandsOn(chat()), false, "an old note expires");
    // a resumed turn keeps the mode: same card id
    const t3 = chat({ turn: "card-fixed" }); R.enterHandsOn(t3); const t4 = chat({ turn: "card-fixed" }); assert.equal(R.isHandsOn(t4), true); const t5 = chat({ turn: "card-other" }); assert.equal(R.isHandsOn(t5), false); }
  ok("background jobs and resume");
} finally { globalThis.fetch = originalFetch; }
console.log("browser-handson passed");
