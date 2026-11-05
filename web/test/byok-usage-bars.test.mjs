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
