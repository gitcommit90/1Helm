// node --import ./test/stubs/register.mjs test/sw-quiet.test.mjs
// The service worker stays quiet for a task push while any app window on the device is visible (visibilityState), whatever
// screen or task it shows, and never uses WindowClient.focused. Tests, other kinds, hidden windows and no window always notify.
import assert from "node:assert";
import { swQuiet, SW_JS } from "../src/pwa.js";
const W = (url, v = "visible", f = true) => ({ url: `https://example.com/w/ck1/app${url}`, visibilityState: v, focused: f });
const ev = { kind: "finished", session: "42", url: "https://example.com/w/ck1/app#/main/s/42", tag: "task-42" };
assert.equal(swQuiet([W("#/main/s/42")], ev), true);
assert.equal(swQuiet([W("#/main/s/7")], ev), true);
assert.equal(swQuiet([W("#/main")], ev), true);
assert.equal(swQuiet([W("#/main/s/42", "visible", false)], ev), true);
assert.equal(swQuiet([W("#/main/s/42", "visible", undefined)], { kind: "needs" }), true);
assert.equal(swQuiet([W("#/main/s/42", "hidden", false)], ev), false);
assert.equal(swQuiet([W("#/main/s/42")], { kind: "test", test: true }), false);
assert.equal(swQuiet([W("#/main/s/42")], { kind: "events_skipped" }), false);
assert.equal(swQuiet([], ev), false);
assert.equal(swQuiet(null, ev), false);
assert.equal(swQuiet([W("")], null), false);
assert.equal(swQuiet([W("#/main/s/7", "hidden", false), W("#/ops/s/42")], ev), true);
assert.match(SW_JS, /visibilityState === "visible"/);
assert.doesNotMatch(SW_JS, /focused === true/);
assert.doesNotMatch(SW_JS, /"where"/);
// Run the real service worker script against a fake worker scope.
const runSw = async (wins, payload) => {
  const shown = [], posted = [], store = new Map(), handlers = {};
  const reg = { scope: "https://example.com/w/ck1/", showNotification: async (title, o) => { shown.push({ title, ...o }); }, getNotifications: async ({ tag }) => shown.filter((n) => n.tag === tag) };
  const clients = wins.map((w) => ({ ...w, postMessage: (m) => { posted.push(m); } }));
  const self = { registration: reg, clients: { matchAll: async () => clients, claim: async () => {} }, addEventListener: (k, f) => { handlers[k] = f; }, Notification: { permission: "granted" } };
  const caches = { open: async () => ({ put: async (k, r) => store.set(k, await r.json()) }) };
  const fetch = async () => new Response(null, { status: 204 });
  new Function("self", "caches", "fetch", "Notification", "Response", SW_JS)(self, caches, fetch, self.Notification, Response);
  let wait; handlers.push({ data: { json: () => payload }, waitUntil: (p) => { wait = p; } });
  await wait; return { shown, posted, rec: store.get("https://example.com/w/ck1/nf-last") };
};
const onIt = await runSw([W("#/main/s/42")], ev);
assert.equal(onIt.shown.length, 0); assert.equal(onIt.rec.quiet, true); assert.ok(onIt.posted.some((m) => m.t === "push" && m.d.kind === "finished"));
const other = await runSw([W("#/main/s/7")], ev);
assert.equal(other.shown.length, 0); assert.equal(other.rec.quiet, true);
const bg = await runSw([W("#/main/s/42", "hidden", false)], ev);
assert.equal(bg.shown.length, 1); assert.equal(bg.shown[0].tag, "task-42"); assert.equal(bg.rec.quiet, false);
const test1 = await runSw([W("#/main/s/42")], { kind: "test", test: true, title: "Notifications are on", tag: "test-1" });
assert.equal(test1.shown.length, 1); assert.match(test1.shown[0].tag, /^test-\d+$/);
console.log("sw-quiet ok");
