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
assert.match(b, /<b>5 hours<\/b><span>38% used<\/span><em>Resets in 2h \d+m<\/em>/); assert.match(b, /<b>This week<\/b><span>12% used<\/span><em>Resets \w{3}, \w{3} \d+<\/em>/);
assert.match(b, /style="width:38%"/); assert.match(b, /role="progressbar"[^>]*aria-valuenow="38"/); assert.match(b, /href="https:\/\/chatgpt\.com\/settings\/usage" target="_blank" rel="noopener noreferrer">Manage usage/);
assert.strictEqual((b.match(/class="bukw/g) || []).length, 2, "two bars");
ok("saved numbers draw two bars with reset times at once, and a Manage usage link");

p = await page("?byokthree");
assert.match(block(p.html, "chatgpt"), /class="bykusage bukwait"/, "before the numbers arrive the space is kept and nothing is written in it");
assert.doesNotMatch(block(p.html, "chatgpt"), /Manage usage|used/);
await new Promise((z) => setTimeout(z, 100)); await p.m.bykUsageLoad(); await new Promise((z) => setTimeout(z, 600));
b = block(p.m.bykPage(), "chatgpt"); assert.match(b, /38% used/); assert.match(block(p.m.bykPage(), "opencode"), /bukno/);
ok("the space is kept while loading, then the numbers fill it");

p = await page("?byokthree&byokusagelink&byokusagecached", 400);
for (const k of ["chatgpt"]) { b = block(p.html, k); assert.match(b, /class="bykusage bukno"/); assert.match(b, /Usage isn't shown here\. <a class="bukmanage" href="https:\/\/chatgpt\.com\/settings\/usage"/); assert.doesNotMatch(b, /progressbar/); }
b = block(p.html, "opencode"); assert.match(b, /bukno/); assert.match(b, /href="https:\/\/opencode\.ai\/console"/);
ok("no numbers: the Manage usage link only; OpenCode is always the link");

p = await page("?byokcc&byokusagecached", 400);
b = block(p.html, "claudecode"); assert.match(b, /<b>5 hours<\/b><span>64% used<\/span>/); assert.match(b, /href="https:\/\/claude\.ai\/settings\/usage"/); assert.match(block(p.html, "opencode"), /opencode\.ai\/console/);
ok("Claude Code: two bars and its own Manage usage page");

p = await page("?byokthree&byokusagelimit&byokusagecached", 400);
b = block(p.html, "chatgpt"); assert.match(b, /class="bukw full"/); assert.match(b, /<p class="bukhit" role="status">5 hour limit reached\. Resets in 1h \d+m\. <a class="bukmanage"/); assert.match(b, /100% used/);
ok("a limit reached says which limit, when it resets, and links Manage usage");

const stale = await page("?byoksaved", 400);
assert.doesNotMatch(stale.html, /data-bykusage/, "a plain OpenAI-compatible service has no plan usage block");
ok("an OpenAI-compatible service has no usage block");

p = await page("?byokcgagain&byokusagecached", 400);
assert.doesNotMatch(p.html, /data-bykusage/, "a ChatGPT sign-in that ended shows no numbers");
ok("a sign-in that ended shows no usage");
console.log("byok usage bars: all passed");
