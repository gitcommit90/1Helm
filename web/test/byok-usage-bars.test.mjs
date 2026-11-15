// node test/byok-usage-bars.test.mjs: the plan usage under each connected AI service in Settings, AI services (src/byok.ts usageBlock, bykUsageLoad).
// States: bars with a reset time (from saved numbers, drawn at once), the space kept while they load, the Manage usage link when no numbers can be read (and always for OpenCode),
// a limit reached, a window whose reset time has passed, and no block at all when the sign-in ended. byok.ts is bundled with esbuild and run against a tiny fake DOM.
import assert from "node:assert"; import { build } from "esbuild"; import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = join(mkdtempSync(join(tmpdir(), "bykub-")), "byok.mjs");
await build({ entryPoints: [new URL("../src/ee/byok-billing.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "warning" });
globalThis.document = { addEventListener() {}, querySelector() { return null; }, getElementById() { return null; }, createElement() { return { setAttribute() {}, classList: { add() {} } }; }, body: {} };
globalThis.history = { replaceState() {} }; globalThis.window = { addEventListener() {} };
const ok = (name) => console.log("  ok", name);
let repaints = 0;
async function page(search, wait = 400) {
  globalThis.location = { search, pathname: "/v3/", hash: "", href: `http://x/v3/${search}`, origin: "http://x" };
  const m = await import(`${pathToFileURL(out).href}?${encodeURIComponent(search)}`);
  m.bykInit({ api: null, repaint() { repaints++; }, open() {}, note() {}, who: () => "Skipper", srow: (i, t, s, r) => `<div class="sr">${t}|${s}|${r}</div>`, icon: () => "", shown: () => true, credits() {} });
  m.bykPage(); await new Promise((z) => setTimeout(z, wait));
  return { m, html: m.bykPage() };
}
const block = (html, kind) => (new RegExp(`<div class="bykusage[^"]*" data-bykusage="${kind}"[^>]*>(?:(?!<div class="sfoot)[\\s\\S])*`).exec(html) || [""])[0];

let p = await page("?byokthree&byokusagecached", 400);
let b = block(p.html, "chatgpt");
// ChatGPT shows a 30 day summary counted from our own calls (Sign in with ChatGPT guidelines), never percent bars or reset times.
assert.match(b, /class="bykusage siwcuse"/); assert.match(b, /<b>ChatGPT plan usage<\/b><span>Last 30 days across your threads and agents\.<\/span>/);
assert.match(b, /<dt>Total<\/dt><dd>1\.2M tokens<\/dd>/); assert.match(b, /<dt>Peak \/ day<\/dt><dd>486K tokens<\/dd>/); assert.match(b, /<dt>Active days<\/dt><dd>11<\/dd>/);
assert.match(b, /href="https:\/\/chatgpt\.com\/settings\/usage" target="_blank" rel="noopener noreferrer">Manage usage/); assert.doesNotMatch(b, /progressbar|% used|Resets/);
ok("ChatGPT: the 30 day summary and a Manage usage link, no bars");

p = await page("?byokthree");
assert.match(block(p.html, "chatgpt"), /class="bykusage siwcuse"/, "the summary is drawn at once from the state");
await new Promise((z) => setTimeout(z, 100)); await p.m.bykUsageLoad(); await new Promise((z) => setTimeout(z, 600));
b = block(p.m.bykPage(), "chatgpt"); assert.match(b, /1\.2M tokens/); assert.match(block(p.m.bykPage(), "opencode"), /bukno/);
ok("the summary stays after the usage load, and OpenCode is the link");

p = await page("?byokthree&byokusagelink&byokusagecached", 400);
b = block(p.html, "chatgpt"); assert.match(b, /Manage usage/); assert.doesNotMatch(b, /progressbar/);
b = block(p.html, "opencode"); assert.match(b, /bukno/); assert.match(b, /href="https:\/\/opencode\.ai\/console"/);
ok("ChatGPT keeps its summary and link; OpenCode is always the link");

p = await page("?byokcc&byokusagecached", 400);
b = block(p.html, "claudecode"); assert.match(b, /<b>5 hours<\/b><span>64% used<\/span>/); assert.match(b, /href="https:\/\/claude\.ai\/settings\/usage"/); assert.match(block(p.html, "opencode"), /opencode\.ai\/console/);
ok("Claude Code: two bars and its own Manage usage page");

p = await page("?byokthree&byokusagelimit&byokusagecached", 400);
b = block(p.html, "chatgpt"); assert.match(b, /<p class="bukhit" role="status">Usage limit reached\. Review your plan or this app's limit in ChatGPT settings\.<\/p>/); assert.doesNotMatch(b, /Resets|hour/);
ok("a ChatGPT limit uses OpenAI's wording with no reset time");

const stale = await page("?byoksaved", 400);
assert.doesNotMatch(stale.html, /data-bykusage/, "a plain OpenAI-compatible service has no plan usage block");
ok("an OpenAI-compatible service has no usage block");

p = await page("?byokcgagain&byokusagecached", 400);
assert.doesNotMatch(p.html, /data-bykusage/, "a ChatGPT sign-in that ended shows no numbers");
ok("a sign-in that ended shows no usage");
console.log("byok usage bars: all passed");
// ---- the waiting state, a new connection, a failed read and the late /byok answer (a fake api records the calls) ----
async function apiPage(search, handler) {
  globalThis.location = { search, pathname: "/v3/", hash: "", href: `http://x/v3/${search}`, origin: "http://x" };
  const calls = [];
  const api = async (path, body) => { calls.push(path); return handler(path, body, calls); };
  const m = await import(`${pathToFileURL(out).href}?api${Math.random()}`);
  m.bykInit({ api, repaint() { repaints++; }, open() {}, note() {}, who: () => "Skipper", srow: (i, t, s, r) => `<div class="sr">${t}|${s}|${r}</div>`, icon: () => "", shown: () => true, credits() {} });
  return { m, calls };
}
const wait = (ms) => new Promise((z) => setTimeout(z, ms));
const claude = { id: "claudecode", kind: "claudecode", label: "Claude Code", host: "", last4: "", email: "sam@example.com", plan_name: "Max", added_at: 1, tested_at: null, test: null };
const stateOf = (conns, usage = {}) => ({ on_plan: false, full: true, plan_name: "Personal", price: 10, mode: "", connections: conns, usage, openrouter: { manage: "https://openrouter.ai/keys/x" }, custom: { model: null }, chatgpt: { manage: "https://chatgpt.com/settings/usage", summary: null, welcome: false, invite: false } });
const tried = (at) => ({ claudecode: { windows: [{ id: "session", label: "5 hours", used: 64, resets_at: Date.now() + 36e5 }, { id: "weekly", label: "This week", used: 41, resets_at: Date.now() + 864e5 }], at, tried: true, manage: "https://claude.ai/settings/usage", limit: null } });

// 1. waiting: same rows as the bars (labels, dashes, empty bars) and the link, never an empty box
let live = stateOf([claude]), hold = true;
let a = await apiPage("?x1", async (path) => { if (path === "/byok") return live; if (path === "/byok/usage") { while (hold) await wait(20); return { usage: tried(Date.now()) }; } return {}; });
a.m.bykLoad(); await wait(100); const waiting = block(a.m.bykPage(), "claudecode");
assert.match(waiting, /bykusage bukwait/); assert.match(waiting, /<b>5 hours<\/b><span>—<\/span>/); assert.match(waiting, /<b>This week<\/b><span>—<\/span>/);
assert.equal((waiting.match(/class="bukbar"/g) || []).length, 2); assert.match(waiting, /Manage usage/); assert.doesNotMatch(waiting, /Loading|spinner/i);
hold = false; await wait(150); assert.match(block(a.m.bykPage(), "claudecode"), /<span>64% used<\/span>/);
ok("waiting state draws the bar layout with dashes and the link; numbers replace it");

// 2. a connection added within 60 s of the last read is asked for at once
live = stateOf([]); let n = 0;
a = await apiPage("?x2", async (path) => { if (path === "/byok") return live; if (path === "/byok/usage") { n++; return { usage: n ? tried(Date.now()) : {} }; } return {}; });
a.m.bykLoad(); await wait(100); a.m.bykUsageLoad(); assert.equal(a.calls.filter((c) => c === "/byok/usage").length, 0, "no plan service yet, nothing to read");
live = stateOf([claude]); a.m.bykLoad(true); await wait(200);
assert.equal(a.calls.filter((c) => c === "/byok/usage").length, 1, "the new Claude Code connection is read at once");
assert.match(block(a.m.bykPage(), "claudecode"), /64% used/);
a.m.bykUsageLoad(); await wait(50); assert.equal(a.calls.filter((c) => c === "/byok/usage").length, 1, "known numbers are still throttled for 60 s");
ok("a new connection triggers a usage read inside the 60 s throttle");

// 3. a failed read shows the Manage usage line; a later open tries again
let fail = true; live = stateOf([claude]);
a = await apiPage("?x3", async (path) => { if (path === "/byok") return live; if (path === "/byok/usage") return fail ? { error: "nope" } : { usage: tried(Date.now()) }; return {}; });
a.m.bykLoad(); await wait(250); let f = block(a.m.bykPage(), "claudecode");
assert.match(f, /bykusage bukno/); assert.match(f, /Usage isn't shown here\. <a class="bukmanage"/); assert.doesNotMatch(f, /bukwait/);
// numbers still missing are asked again at most every 15 s (a repaint after every answer used to ask again at once and redraw the page about three times a second)
fail = false; const asked = a.calls.filter((c) => c === "/byok/usage").length; a.m.bykUsageLoad(); await wait(50);
assert.equal(a.calls.filter((c) => c === "/byok/usage").length, asked, "inside 15 s a missing read is not asked for again");
const realNow = Date.now; Date.now = () => realNow() + 16000;
try { a.m.bykUsageLoad(); await wait(150); } finally { Date.now = realNow; }
assert.match(block(a.m.bykPage(), "claudecode"), /64% used/);
ok("a failed usage read shows the Manage usage line, and a read after 15 s tries again");

// 4. a late /byok answer (older, usage not tried) does not erase newer usage
let releaseByok; live = stateOf([claude]);
a = await apiPage("?x4", async (path) => { if (path === "/byok") { await new Promise((z) => { releaseByok = z; }); return stateOf([claude], { claudecode: { ...tried(1).claudecode, windows: [], tried: false } }); } if (path === "/byok/usage") return { usage: tried(Date.now()) }; return {}; });
a.m.bykPage(); a.m.bykLoad(); await wait(50); a.m.bykUsageLoad(); await wait(50);
assert.ok(releaseByok, "the /byok request is waiting"); releaseByok(); await wait(100);
assert.match(block(a.m.bykPage(), "claudecode"), /64% used/, "the older answer kept the newer numbers");
ok("a late /byok answer keeps the newer usage");
console.log("byok usage wait: all passed");

