// node --import ./test/stubs/register.mjs test/browser-effects.test.mjs
// The wording of what a browser_act did (src/browser-effects.js) for each effect, the result text the Resident builds from it (no more "probably had no
// effect" guess), the older browser service that sends no effects, browser_snapshot's from_line, and a downloads folder check that fails loudly.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SEED } from "./helpers/seed-settings.mjs";
import { Resident } from "../src/resident.js";
import { describeEffects, actOutcome } from "../src/browser-effects.js";

const ok = (n) => console.log("  ok", n);
const base = { outline_changed: false, address_changed: false, visible: false };
const say = (e, more = {}) => describeEffects({ completed: 1, effects: { ...base, ...e }, ...more });
{
  assert.equal(say({}), "No change was seen: same page text and address, no download, no new tab, no network request and no change to the page structure. Check the page (browser_snapshot or a screenshot) before saying it worked. ");
  assert.doesNotMatch(say({}), /probably|Don't report/);
  assert.match(say({ downloads: [{ name: "lease.pdf", bytes: 2045, state: "completed" }], visible: true }), /^What the steps did: the page text and address stayed the same; a download of "lease.pdf" \(2 KB\) finished\. $/);
  assert.match(say({ downloads: [{ name: "big.zip", bytes: 5242880, state: "in_progress" }] }), /a download of "big.zip" is still in progress/);
  assert.match(say({ downloads: [{ name: "x.pdf", bytes: 0, state: "canceled" }] }), /was cancelled or failed/);
  assert.match(say({ pdf_saved: "inline.pdf" }), /this tab shows a PDF, which the outline cannot read, and a copy was saved as "inline.pdf"/);
  assert.match(say({ popups_blocked: ["host/a.pdf"], popup_opened_for_you: true }), /tried to open a window at host\/a\.pdf and the browser blocked it; that address was opened as a new tab for you instead/);
  assert.match(say({ popups_blocked: ["host/a.pdf"] }), /blocked it\. $/);
  assert.match(say({ dialogs: [{ type: "confirm", message: "Delete?", handled: "cancelled" }] }), /a JavaScript confirm box saying "Delete\?" appeared and the browser cancelled it/);
  assert.match(say({ file_chooser: true }), /opened a file chooser.*upload step/);
  assert.match(say({ requests: { count: 6, items: ["POST a.com/x", "GET a.com/y"] } }), /6 network requests \(POST a\.com\/x, GET a\.com\/y, and more\)/);
  assert.match(say({ requests: { count: 1, items: ["POST a.com/x"] } }), /1 network request \(POST a\.com\/x\)\. $/);
  assert.match(say({ mutations: 14 }), /14 changes to the page structure/);
  assert.doesNotMatch(say({ outline_changed: true, mutations: 14, visible: true }), /page structure/);
  assert.match(say({ navigations: [{ main: false, url: "pay.example/frame" }] }), /a frame loaded pay\.example\/frame/);
  assert.match(say({ navigations: [{ main: true, same: true, url: "a.com/#x" }] }), /without reloading/);
  assert.doesNotMatch(say({ address_changed: true, navigations: [{ main: true, url: "a.com/b" }], visible: true }), /the page loaded/);
  assert.match(say({ uploaded: true, visible: true }), /a file was attached/);
  assert.equal(describeEffects({ completed: 1, page_changed: true }), "");
  assert.match(describeEffects({ completed: 1, page_changed: false }), /^No change was seen in the page text or address\. Check the page/);
  ok("each effect has its own plain wording; none seen is a neutral fact; an older service still works");
}
const db = new DatabaseSync(":memory:");
const sql = { exec(q, ...args) { if (!args.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
  const st = db.prepare(q), rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...args) : (st.run(...args), []); return { toArray: () => rows, one: () => rows[0] }; } };
const env = { MODEL_SETTINGS: SEED, MEMORY: "off", GENUI: "off", WORKMEM: "off", PROMPT_CACHE: "off", NO_TOLERANT_STUBS: true,
  DB: { prepare: (query) => { const q = { bind: () => q, first: async () => (query.includes("SELECT level FROM perm_prefs") ? { level: "standard" } : null), all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 0 } }) }; return q; } } };
const R = new Resident({ storage: { sql, getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {} }, waitUntil: () => {} }, env);
R.put("tenant", "t1"); R.put("channel", "main"); R.arm = async () => {};
let reply = {}, ops = [];
R.computer = () => ({ browser: async (op, body) => { ops.push([op, body]); return { ok: true, url: "https://x.example/c", title: "Docs", snapshot: '[e19] link "Download PDF" → /a.pdf', completed: 1, ...reply }; } });
const tc = () => ({ kind: "chat", session: "s1", turn: "t1", emit: () => {}, inTool: 1, extraCharge: 0 });
{
  reply = { page_changed: false, effects: { ...base } };
  const r = await R.browserToolInner("browser_act", { actions: [{ kind: "click", ref: "e19" }] }, tc());
  assert.match(r.out, /^completed 1 step\(s\)\. No change was seen: same page text and address, no download/); assert.doesNotMatch(r.out, /NOTHING VISIBLE CHANGED|probably had no effect/);
  reply = { page_changed: true, effects: { ...base, downloads: [{ name: "lease.pdf", bytes: 2045, state: "completed" }], visible: true } };
  assert.match((await R.browserToolInner("browser_act", { actions: [{ kind: "click", ref: "e19" }] }, tc())).out, /completed 1 step\(s\)\. What the steps did: .*a download of "lease\.pdf"/);
  reply = { page_changed: false };
  assert.match((await R.browserToolInner("browser_act", { actions: [{ kind: "click", ref: "e19" }] }, tc())).out, /No change was seen in the page text or address\./);
  ok("the Resident's act result lists the effects, and no longer says the action probably had no effect");
}
{
  // Outcome label and the change list (test/browser-outline.test.mjs tests both in detail)
  reply = { page_changed: true, effects: { ...base, outline_changed: true, visible: true }, outline_changes: "[outline changes since your last look at this tab; the whole outline has 40 lines and browser_snapshot lists it.]\nAdded:\n[e30] button \"Next\"\n", snapshot: "WHOLE OUTLINE" };
  const r = await R.browserToolInner("browser_act", { actions: [{ kind: "click", ref: "e19" }] }, tc());
  assert.match(r.out, /Outcome: worked\. Suggested next step: .+\. Page: Docs/); assert.match(r.out, /Added:\n\[e30\] button "Next"/); assert.doesNotMatch(r.out, /WHOLE OUTLINE/);
  reply = { page_changed: true, effects: { ...base, outline_changed: true, visible: true }, snapshot: "WHOLE OUTLINE" };
  const w = await R.browserToolInner("browser_act", { actions: [{ kind: "click", ref: "e19" }] }, tc()); assert.match(w.out, /WHOLE OUTLINE/);
  const sn = await R.browserToolInner("browser_snapshot", {}, tc()); assert.doesNotMatch(sn.out, /Outcome:/);
  ok("the act result shows the outcome label and the change list when there is one, the whole outline otherwise");
}
{
  reply = {}; ops = [];
  await R.browserToolInner("browser_snapshot", { from_line: 120 }, tc()); assert.deepEqual(ops.at(-1), ["snapshot", { from_line: 120 }]);
  await R.browserToolInner("browser_snapshot", {}, tc()); assert.deepEqual(ops.at(-1), ["snapshot", {}]);
  const t = Object.fromEntries(R.tools().map((x) => [x.function.name, x.function])).browser_snapshot; assert.equal(t.parameters.properties.from_line.type, "integer"); assert.match(t.description, /outline continues/);
  reply = { saved_pdf: "lease.pdf" }; assert.match((await R.browserToolInner("browser_navigate", { url: "https://x.example/l.pdf" }, tc())).out, /This tab shows a PDF, which the outline cannot read, and a copy was saved as "lease\.pdf"/);
  ok("browser_snapshot passes from_line; a navigation to an inline PDF says a copy was saved");
}
{
  // The browser service said a download finished, but the downloads folder holds nothing: say so (it used to leave no line), and a failing folder check is reported too.
  reply = { effects: { ...base, downloads: [{ name: "lease.pdf", bytes: 2045, state: "completed" }], visible: true } };
  R.collectDownloads = async () => ({ files: [], partial: [] });
  assert.match((await R.browserTool("browser_act", { actions: [{ kind: "click", ref: "e19" }] }, tc())).out, /The browser finished downloading "lease\.pdf", but it is not in the downloads folder/);
  R.collectDownloads = async () => ({ files: [{ orig: "lease.pdf", file: { name: "lease.pdf", bytes: 2045, path: "files/lease.pdf" } }], partial: [] });
  const done = (await R.browserTool("browser_act", { actions: [{ kind: "click", ref: "e19" }] }, tc())).out; assert.match(done, /Downloaded lease\.pdf \(2 KB\) → Library/); assert.doesNotMatch(done, /not in the downloads folder/);
  R.collectDownloads = async () => { throw new Error("computer asleep"); };
  assert.match((await R.browserTool("browser_act", { actions: [{ kind: "click", ref: "e19" }] }, tc())).out, /Checking the browser's downloads folder failed \(computer asleep\)/);
  ok("a finished download that is missing from the folder, and a failed folder check, are said in the result");
}
{
  // A page script that throws while the steps run (a rename box whose save refers to a removed element): the result says so, and the outcome is not "worked" or a bare "nothing happened".
  const err = "ReferenceError: nm is not defined";
  assert.match(say({ page_errors: [err] }), new RegExp(`the page reported a JavaScript error: ${err}`));
  assert.doesNotMatch(say({ page_errors: [err] }), /^No change was seen/);
  const nothing = actOutcome({ completed: 2, effects: { ...base, page_errors: [err] } }, 2);
  assert.equal(nothing.label, "blocked"); assert.match(nothing.next, /JavaScript error/); assert.match(nothing.next, /tell the person what the page reported/);
  assert.equal(actOutcome({ completed: 2, effects: { ...base, outline_changed: true, visible: true, page_errors: [err] } }, 2).label, "partly worked");
  assert.equal(actOutcome({ completed: 2, effects: { ...base, outline_changed: true, visible: true } }, 2).label, "worked");
  assert.equal(actOutcome({ completed: 1, effects: base }, 1).label, "nothing happened");
  ok("an error thrown by the page is in the result and changes the outcome");
}
console.log("browser-effects: all ok");
