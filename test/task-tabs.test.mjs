// node --import ./test/stubs/register.mjs test/task-tabs.test.mjs
// One browser tab per task (2026-10-30): two tasks in one channel never see or move each other's pages, a background browser job
// holds only its own task's tab, a click that opens a new tab follows it, the duplicate-page check reads the task's own tab,
// and the request shapes of older Workers and older browser services still work. No network and no model calls: the browser
// service is a stand-in that keeps one page per "_tab" key, the way image/opt/1hc-browser/server.mjs does.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { SEED } from "./helpers/seed-settings.mjs";
import { Resident } from "../src/resident.js";
import { ChannelComputer } from "../src/channel-computer.js";
import { tabKeyFor, tabKeyOf } from "../src/browser-tab.js";
import { repeatBlock, repeatNote, navRepeatPending } from "../src/ee/appfirst.js";
import { activeBrowserJob } from "../src/ee/browser-tasks.js";

const ok = (n) => console.log("  ok", n);
const mkSql = () => { const db = new DatabaseSync(":memory:");
  return { exec(q, ...args) { if (!args.length && q.split(";").filter((s) => s.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
    const st = db.prepare(q), rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...args) : (st.run(...args), []); return { toArray: () => rows, one: () => rows[0] }; } }; };

// ---- the stand-in browser service: one page per tab key, links with target=_blank open a second tab of the same key ----
const SITES = { "https://flights.example/": { title: "Flights", links: { e18: "https://flights.example/book", e19: "NEW:https://aa.example/checkout" } }, "https://shop.example/item": { title: "Shop", links: { e1: "https://shop.example/cart" } },
  "https://flights.example/book": { title: "Book", links: {} }, "https://aa.example/checkout": { title: "American", links: {} }, "https://shop.example/cart": { title: "Cart", links: {} } };
const svc = { tabs: new Map(), log: [], legacy: false };   // key -> { pages: [url], cur: index }
const pageOf = (url) => ({ url, title: SITES[url]?.title || "page", snapshot: Object.keys(SITES[url]?.links || {}).map((r) => `[${r}] link "go ${r}"`).join("\n") || "(empty)" });
const serve = async (url, init) => {
  const op = String(url).split("/cdp/")[1], b = JSON.parse(init.body || "{}"), key = svc.legacy ? "" : b._tab || "";
  svc.log.push({ op, key, hasTab: "_tab" in b });
  const tab = svc.tabs.get(key) || (svc.tabs.set(key, { pages: [], cur: -1 }), svc.tabs.get(key)), cur = () => tab.pages[tab.cur];
  if (op === "status") return Response.json({ ok: true, running: true, ...(svc.legacy ? {} : { tab: cur() ? { url: cur() } : null }) });
  if (op === "navigate") { tab.pages.push(b.url); tab.cur = tab.pages.length - 1; return Response.json({ ok: true, ...pageOf(b.url) }); }
  if (op === "snapshot") return Response.json({ ok: true, ...pageOf(cur() || "about:blank") });
  if (op === "act") {
    const before = cur(), ref = b.actions[0].ref, dest = SITES[before]?.links[ref];
    if (!dest) return Response.json({ ok: false, error: `no element ${ref} on the page now — take a new snapshot` });
    if (dest.startsWith("NEW:")) { tab.pages.push(dest.slice(4)); tab.cur = tab.pages.length - 1; return Response.json({ ok: true, completed: 1, page_changed: true, new_tab: true, ...pageOf(cur()) }); }
    tab.pages[tab.cur] = dest; return Response.json({ ok: true, completed: 1, page_changed: true, ...pageOf(dest) });
  }
  return Response.json({ ok: true });
};
const mkComputer = () => {
  const ctx = { storage: { sql: mkSql(), getAlarm: async () => null, setAlarm: async () => {} }, container: { running: true, monitor: () => new Promise(() => {}), getTcpPort: () => ({ fetch: serve }) }, waitUntil: () => {} };
  const C = new ChannelComputer(ctx, {}); C.ensureRunning = async () => ({ cold: false }); return C;
};
const C = mkComputer();
const env = { MODEL_SETTINGS: SEED, MEMORY: "off", GENUI: "off", WORKMEM: "off", PROMPT_CACHE: "off", NO_TOLERANT_STUBS: true,
  DB: { prepare: (query) => { const q = { bind: () => q, first: async () => (query.includes("SELECT level FROM perm_prefs") ? { level: "standard" } : null), all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 0 } }) }; return q; } } };
const R = new Resident({ storage: { sql: mkSql(), getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {} }, waitUntil: () => {} }, env);
R.put("tenant", "t1"); R.put("channel", "main"); R.arm = async () => {};
R.computer = () => C;
const A = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa", B = "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const tcA = { kind: "chat", session: A, turn: "ta", emit: () => {}, inTool: 1 }, tcB = { kind: "chat", session: B, turn: "tb", emit: () => {}, inTool: 1 };
const tool = (name, a, tc) => R.browserToolInner(name, a, tc);

{
  assert.equal(tabKeyFor(A), A); assert.match(tabKeyFor("weird id:1"), /^[A-Za-z0-9_-]{1,64}$/); assert.equal(tabKeyFor("weird id:1"), tabKeyFor("weird id:1")); assert.notEqual(tabKeyFor("a:1"), tabKeyFor("a:2"));
  assert.equal(tabKeyOf({ session: A }), A); assert.equal(tabKeyOf({ workflow_id: 7 }), "wf-7"); assert.equal(tabKeyOf({}), ""); assert.equal(tabKeyOf(null), "");
  ok("task keys: a session id is its own key; other callers get a stable safe key");
}
{
  // two tasks interleave navigate, act and snapshot on one channel without crossing (the Google Flights / Amazon case)
  const a1 = await tool("browser_navigate", { url: "https://flights.example/" }, tcA); assert.match(a1.out, /Page: Flights/);
  const b1 = await tool("browser_navigate", { url: "https://shop.example/item" }, tcB); assert.match(b1.out, /Page: Shop/);
  const a2 = await tool("browser_act", { actions: [{ kind: "click", ref: "e18" }] }, tcA);
  assert.equal(a2.code, 0, a2.out); assert.match(a2.out, /Page: Book — https:\/\/flights\.example\/book/, "A's click ran on A's own page (e18 exists there)");
  const b2 = await tool("browser_snapshot", {}, tcB); assert.match(b2.out, /shop\.example\/item/); assert.doesNotMatch(b2.out, /flights/);
  const a3 = await tool("browser_snapshot", {}, tcA); assert.match(a3.out, /flights\.example\/book/); assert.doesNotMatch(a3.out, /shop\.example/);
  const b3 = await tool("browser_act", { actions: [{ kind: "click", ref: "e1" }] }, tcB); assert.match(b3.out, /shop\.example\/cart/);
  assert.deepEqual([...new Set(svc.log.map((l) => l.key))].sort(), [A, B].sort(), "every call named its task's tab");
  assert.ok(svc.log.every((l) => l.hasTab));
  assert.equal(svc.tabs.get(A).pages.length, 1); assert.equal(svc.tabs.get(B).pages.length, 1);
  ok("two tasks interleaving navigate, act and snapshot stay on their own pages");
}
{
  // the outline refs of one task are never taken from the other task's page
  R._outlines.clear(); await tool("browser_navigate", { url: "https://flights.example/" }, tcA); await tool("browser_navigate", { url: "https://shop.example/item" }, tcB);
  assert.match(R._outlines.get(A).snapshot, /e18/); assert.match(R._outlines.get(B).snapshot, /e1\b/); assert.doesNotMatch(R._outlines.get(B).snapshot, /e18/);
  ok("each task keeps its own outline for the refs of its next browser_act");
}
{
  // a background job on task B holds only B's tab
  const tokB = "tokB_0123456789abcdef0123456789abcdef", tokA = "tokA_0123456789abcdef0123456789abcdef";
  assert.equal((await C.acquireBrowserOwner(tokB, 120000, B)).ok, true);
  assert.equal((await C.browser("snapshot", {}, null, A)).ok, true, "task A keeps working");
  assert.equal((await C.browser("navigate", { url: "https://flights.example/" }, null, A)).ok, true);
  const r = await tool("browser_snapshot", {}, tcA); assert.equal(r.code, 0);
  assert.equal((await C.browser("snapshot", {}, null, B)).browser_busy, true, "B's own other callers wait for its job");
  assert.equal((await C.browser("snapshot", {}, null, "")).browser_busy, true, "a call with no tab (older Worker) waits for any job");
  assert.equal((await C.browser("snapshot", {}, tokB, B)).ok, true, "the job's own calls run");
  assert.equal((await C.browser("snapshot", {}, tokB, A)).owner_lost, true, "the job's token is no good on another task's tab");
  assert.equal((await C.acquireBrowserOwner(tokA, 120000, B)).browser_busy, true, "a second job on the same tab is refused");
  assert.equal((await C.acquireBrowserOwner(tokA, 120000, A)).ok, true, "another task can have its own job at the same time");
  assert.equal((await C.browserOwnerState(B)).owned, true); assert.equal((await C.browserOwnerState("")).owned, true);
  assert.equal((await C.renewBrowserOwner(tokB, 120000, B)).ok, true); assert.equal((await C.renewBrowserOwner(tokB, 120000, A)).owner_lost, true);
  assert.equal((await C.releaseBrowserOwner(tokA, B)).owner_lost, true, "release names the tab too");
  assert.equal((await C.releaseBrowserOwner(tokA, A)).ok, true);
  assert.equal((await C.exec("echo x")).browser_busy, true, "shell commands still wait while any job holds a tab");
  assert.equal((await C.releaseBrowserOwner(tokB, B)).ok, true);
  assert.equal((await C.browser("snapshot", {}, null, B)).ok, true);
  ok("a background job holds only its own task's tab; same-task callers still wait for it");
}
{
  // an owner call in flight on one tab does not block another tab; the same tab still serialises
  const tok = "tokB_0123456789abcdef0123456789abcdef"; let release; const gate = new Promise((z) => { release = z; });
  assert.equal((await C.acquireBrowserOwner(tok, 120000, B)).ok, true);
  const C2 = C; const orig = C2.ctx.container.getTcpPort; C2.ctx.container.getTcpPort = () => ({ fetch: async (u, i) => { if (JSON.parse(i.body)._tab === B) await gate; return serve(u, i); } });
  const slowB = C.browser("snapshot", {}, tok, B);
  assert.equal((await C.browser("snapshot", {}, null, A)).ok, true, "A runs while B's job call is in flight");
  assert.equal((await C.browser("snapshot", {}, tok, B)).browser_busy, true, "two calls at once on B's tab are refused");
  release(); assert.equal((await slowB).ok, true);
  C2.ctx.container.getTcpPort = orig; assert.equal((await C.releaseBrowserOwner(tok, B)).ok, true);
  ok("a call in flight on one tab does not block another tab");
}
{
  // a click that opens a new tab returns the new tab's page, page_changed true, and stays in that task
  await tool("browser_navigate", { url: "https://flights.example/" }, tcA); await tool("browser_navigate", { url: "https://shop.example/item" }, tcB);
  const before = svc.tabs.get(B).pages.join();
  const r = await tool("browser_act", { actions: [{ kind: "click", ref: "e19" }] }, tcA);
  assert.equal(r.code, 0, r.out); assert.match(r.out, /Page: American — https:\/\/aa\.example\/checkout/);
  assert.match(r.out, /opened a new tab/); assert.doesNotMatch(r.out, /NOTHING VISIBLE CHANGED/);
  assert.equal(svc.tabs.get(B).pages.join(), before, "B's tab was not touched");
  assert.match((await tool("browser_snapshot", {}, tcA)).out, /aa\.example\/checkout/, "A's next call is on the new tab");
  assert.match((await tool("browser_snapshot", {}, tcB)).out, /shop\.example\/item/);
  ok("a click that opens a new tab returns that page with page_changed true and stays in the task");
}
{
  // a reply that carries a tab note (the tab was closed and reopened) tells the model
  const orig = svc.log.length; const real = serve;
  const C3 = mkComputer(); C3.ctx.container.getTcpPort = () => ({ fetch: async () => Response.json({ ok: true, url: "https://shop.example/item", title: "Shop", snapshot: "(empty)", tab_note: "The browser tab for this task was closed, so a new tab opened." }) });
  R.computer = () => C3; const r = await tool("browser_snapshot", {}, tcB); R.computer = () => C;
  assert.match(r.out, /^\(Note, not from the person: The browser tab for this task was closed/);
  ok("a recreated tab is reported to the model in plain words");
}
{
  // the duplicate-page check reads the task's own tab
  const tc = { session: A }; const url = "https://shop.example/item";
  repeatNote(tc, "browser_navigate", { url }, `Page: Shop — ${url}\n`);
  assert.ok(navRepeatPending(tc, { url }));
  assert.match(repeatBlock(tc, "browser_navigate", { url }) || "", /You already have this page/, "no tab information: the turn's record decides, as before");
  assert.equal(repeatBlock(tc, "browser_navigate", { url }, { known: true, url: "https://flights.example/" }), null, "the tab shows another page: reload allowed");
  assert.equal(repeatBlock(tc, "browser_navigate", { url }, { known: true, url: "" }), null, "the tab has no page: allowed");
  assert.match(repeatBlock(tc, "browser_navigate", { url }, { known: true, url }) || "", /You already have this page/, "the tab still shows it: a pointless repeat is stopped");
  const tc2 = { session: A }; repeatNote(tc2, "browser_navigate", { url: "https://shop.example/a" }, "Page: Shop — https://shop.example/item\n");   // a redirect: the tab reports where it ended up
  assert.match(repeatBlock(tc2, "browser_navigate", { url: "https://shop.example/a" }, { known: true, url: "https://shop.example/item" }) || "", /already have/);
  // through the resident: it reads the status of the task's own tab
  svc.legacy = false; R.computer = () => C;
  const tcR = { kind: "chat", session: A, turn: "tr", emit: () => {}, inTool: 1 };
  await tool("browser_navigate", { url }, tcR); repeatNote(tcR, "browser_navigate", { url }, `Page: Shop — ${url}\n`);
  svc.tabs.get(A).pages.push("https://flights.example/"); svc.tabs.get(A).cur = svc.tabs.get(A).pages.length - 1;   // the tab moved on its own
  assert.equal(await R.browserFirstCheck("browser_navigate", { url }, tcR), null, "a reload is allowed when the task's tab is showing something else");
  svc.tabs.get(A).pages.push(url); svc.tabs.get(A).cur = svc.tabs.get(A).pages.length - 1;
  assert.match(await R.browserFirstCheck("browser_navigate", { url }, tcR) || "", /You already have this page/);
  svc.legacy = true; assert.match(await R.browserFirstCheck("browser_navigate", { url }, tcR) || "", /You already have this page/, "an older browser service has no tab field: refused as before");
  svc.legacy = false;
  ok("the duplicate-page check compares with the task's current tab");
}
{
  // jobs are per task
  const sql = mkSql(); const R2 = new Resident({ storage: { sql, getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {} }, waitUntil: () => {} }, env);
  R2.put("tenant", "t1"); R2.put("channel", "main");
  const ins = (s) => sql.exec("INSERT INTO browser_jobs (session,parent_card,url,task,status,started,deadline,token) VALUES (?,?,?,?,?,?,?,?)", s, "c", "https://x.example/", "t", "running", 1, 2, "tok");
  ins(A);
  assert.ok(activeBrowserJob(sql, A)); assert.equal(activeBrowserJob(sql, B), null); assert.ok(activeBrowserJob(sql));
  assert.equal(R2.browserBusyNote({ code: 1, out: "A background browser job is using this channel's computer.", browser_busy: true }, B).out, "A background browser job is using this channel's computer.");
  ok("a browser job blocks only a second job of its own task");
}
{
  // handoff shows the handing-off task's tab and keeps it in front
  svc.log.length = 0; const r = await tool("browser_handoff", { instructions: "Please sign in" }, tcA);
  assert.equal(r.code, 0); const act = svc.log.find((l) => l.op === "activate"); assert.equal(act?.key, A);
  ok("take control activates the handing-off task's tab");
}
{
  // old request shapes: no tab argument means no "_tab" in the body, and the DO still takes the two-argument forms
  const C4 = mkComputer(); svc.log.length = 0;
  assert.equal((await C4.browser("navigate", { url: "https://flights.example/" })).ok, true);
  assert.equal(svc.log.at(-1).hasTab, false, "an older Worker's request reaches the service unchanged");
  const tok = "tokX_0123456789abcdef0123456789abcdef";
  assert.equal((await C4.acquireBrowserOwner(tok)).ok, true); assert.equal((await C4.browser("snapshot", {}, tok)).ok, true);
  assert.equal((await C4.browser("snapshot")).browser_busy, true); assert.equal((await C4.renewBrowserOwner(tok)).ok, true); assert.equal((await C4.releaseBrowserOwner(tok)).ok, true);
  assert.equal((await C4.browser("bogus")).error, "unknown browser op");
  assert.equal((await C4.browser("snapshot", {}, null, "bad key with spaces")).ok, true, "an unusable key is the tab-less case");
  ok("older request shapes (no tab) still work");
}
{
  const src = readFileSync(new URL("../image/opt/1hc-browser/server.mjs", import.meta.url), "utf8");
  assert.match(src, /Target\.setDiscoverTargets/); assert.match(src, /openerId/, "a new tab is found by its opener, not by being the newest tab");
  assert.doesNotMatch(src, /currentTarget|seenTargets/, "no one-current-tab-per-channel state is left");
  assert.match(src, /const TAB_RE = /); assert.match(src, /m\[1\] === "closetab"/); assert.match(src, /TAB_IDLE_MS/);
  assert.match(src, /serial\(k,/, "calls on one tab run one after the other");
  assert.ok(src.includes("^\\/cdp\\/([a-z]+)$"), "the request path is unchanged");
  for (const op of ["navigate", "snapshot", "act", "back", "screenshot", "status"]) assert.match(src, new RegExp(`async ${op}\\(`));
  ok("the browser service follows opener tabs, keeps no channel-wide current tab and keeps its old ops");
}
console.log("task-tabs: all ok");
