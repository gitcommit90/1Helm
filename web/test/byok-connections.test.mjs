// node test/byok-connections.test.mjs: Settings → AI services (src/byok.ts) on its sandbox data, with several AI services connected at once. The page is the list of
// connected services only (no model fields, no reasoning sliders): each shows its name, the account or address and the last 4 of its key, with Test and Remove; buttons add
// OpenRouter, ChatGPT, OpenCode and any OpenAI-compatible service, and a service that can only be connected once leaves the buttons when it is connected. Models are chosen in
// the Models section under the list (test/ai-services-panel.test.mjs). byok.ts is bundled with esbuild and run against a tiny fake DOM (the page is plain HTML strings).
import assert from "node:assert"; import { build } from "esbuild"; import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = join(mkdtempSync(join(tmpdir(), "bykc-")), "byok.mjs");
await build({ entryPoints: [new URL("../src/ee/byok-billing.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "warning" });
globalThis.document = { addEventListener() {}, querySelector() { return null; }, getElementById() { return null; }, createElement() { return { setAttribute() {}, classList: { add() {} } }; }, body: {} };
globalThis.history = { replaceState() {} }; globalThis.window = { addEventListener() {} };
const ok = (name) => console.log("  ok", name);
async function page(search) {
  globalThis.location = { search, pathname: "/v3/", hash: "", href: `http://x/v3/${search}`, origin: "http://x" };
  const m = await import(`${pathToFileURL(out).href}?${encodeURIComponent(search)}`);
  m.bykInit({ api: null, repaint() {}, open() {}, note() {}, who: () => "Skipper", srow: (i, t, s, r) => `<div class="sr">${t}|${s}|${r}</div>`, icon: () => "", shown: () => false, credits() {} });
  m.bykPage(); await new Promise((z) => setTimeout(z, 400));
  return { m, html: m.bykPage() };
}
const buttons = (html) => ["data-bykor", "data-bykcg", "data-bykoc", "data-bykplain"].filter((k) => html.includes(k));

let p = await page("?byokplan");
assert.strictEqual((p.html.match(/data-bykconn=/g) || []).length, 0); assert.deepStrictEqual(buttons(p.html), ["data-bykor", "data-bykcg", "data-bykoc", "data-bykplain"]);
assert.match(p.html, /needs a connected AI service to answer/);
ok("nothing connected: no list, all four ways to add one");

p = await page("?byoksaved");
assert.strictEqual((p.html.match(/data-bykconn=/g) || []).length, 1); assert.match(p.html, /Work account\|api\.openai\.com/); assert.match(p.html, /••••x7Qa/); assert.match(p.html, /data-byktest="p_work1"/); assert.match(p.html, /data-bykrm="p_work1"/);
assert.ok(!/id="byk-(model|fast)"/.test(p.html) && !/data-efs/.test(p.html), "no model fields and no sliders on this page");
assert.doesNotMatch(p.html, /data-bykchoose/, "a model is chosen, so no reminder");
ok("one service: its name, address, last 4, Test and Remove; no model fields");

p = await page("?byokthree");
assert.strictEqual((p.html.match(/data-bykconn=/g) || []).length, 3); assert.match(p.html, /ChatGPT\|Signed in as sam@example\.com/); assert.match(p.html, /OpenCode\|OpenCode Go plan · <span class="bykmask">••••9f3b/);
assert.deepStrictEqual(buttons(p.html), ["data-bykor", "data-bykplain"], "ChatGPT and OpenCode are connected once, so their buttons are gone");
ok("three services: all listed, the one-per-account kinds leave the add buttons");

p = await page("?byokthree&byokoc");
assert.match(p.html, /https:\/\/opencode\.ai\/console/); assert.match(p.html, /data-bykack/);
assert.match(p.html, /id="byk-ock"/); assert.match(p.html, /Paste your OpenCode key/); assert.match(p.html, /OpenCode Go plan/); assert.match(p.html, /data-bykplanpick="go" checked/); assert.match(p.html, /Pay as you go from my OpenCode balance/); assert.ok(p.html.includes("https://opencode.ai/console/account")); assert.ok(!/Open the <a href="https:\/\/opencode\.ai\/console"/.test(p.html), "the key step links to the account page, not the bare console"); assert.match((await page("?byokthree")).html, /data-bykplan="payg"[^>]*>Use pay as you go/);
assert.match(p.html, /Personal API keys/); assert.match(p.html, /Add API key/); assert.match(p.html, /choose your workspace/);
assert.doesNotMatch(p.html, /No key|Service Account|OIDC|credential|data-bykcopy|data-bykocway|byk-cred/i, "OpenCode is an API key only");
p = await page("?byoksaved&byokform");
assert.match(p.html, /id="byk-base"/); assert.match(p.html, /id="byk-key"/); assert.match(p.html, /data-bykack/); assert.ok(!/id="byk-model"/.test(p.html));
ok("the OpenCode step (console link, key box, note) and the address and key form");
console.log("byok connections: all passed");
