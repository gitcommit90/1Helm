// node test/service-logos.test.mjs: every AI service in Settings, AI services shows its logo.dev logo through 1HC's /logo/<domain> route (never img.logo.dev, never a key), except the Continue with ChatGPT button, which uses OpenAI's official assets and data-oai-siwc-button:
// ChatGPT chatgpt.com, OpenCode opencode.ai, OpenRouter openrouter.ai, an OpenAI-compatible service the registrable domain of its address. The model picker's service labels do the same.
import assert from "node:assert"; import { build } from "esbuild"; import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = join(mkdtempSync(join(tmpdir(), "svcl-")), "byok.mjs");
await build({ entryPoints: [new URL("../src/ee/byok-billing.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "warning" });
const lout = join(mkdtempSync(join(tmpdir(), "svcl-")), "logo.mjs");
await build({ entryPoints: [new URL("../src/logo.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "neutral", outfile: lout, logLevel: "warning" });
globalThis.document = { addEventListener() {}, querySelector() { return null; }, getElementById() { return null; }, createElement() { return { setAttribute() {}, classList: { add() {} } }; }, body: {} };
globalThis.history = { replaceState() {} }; globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
const ok = (name) => console.log("  ok", name);
async function page(search) {
  globalThis.location = { search, pathname: "/v3/", hash: "", href: `http://x/v3/${search}`, origin: "http://x" };
  const m = await import(`${pathToFileURL(out).href}?${encodeURIComponent(search)}`);
  m.bykInit({ api: null, repaint() {}, open() {}, note() {}, who: () => "Skipper", srow: (i, t, s, r) => `<div class="sr">${i}|${t}|${s}|${r}</div>`, icon: () => "", shown: () => false, credits() {} });
  m.bykPage(); await new Promise((z) => setTimeout(z, 400));
  return m.bykPage();
}
const urls = (html) => [...html.matchAll(/src="(\/logo\/[^"]+)"/g)].map((x) => x[1]);
const cgBtn = (html) => html.match(/<button[^>]*data-oai-siwc-button[^>]*data-bykcg[^>]*>.*?<\/button>/s)?.[0] || "";
const officialCg = (html) => { const b = cgBtn(html); assert.ok(b, "the Continue with ChatGPT button carries data-oai-siwc-button");
  assert.ok(b.includes("/fonts/siwc/chatgpt-logo-white.svg") && b.includes("/fonts/siwc/chatgpt-logo-black.svg"), "the ChatGPT button uses OpenAI's official logo files");
  assert.ok(!b.includes("/logo/chatgpt.com"), "the ChatGPT button does not use logo.dev"); };

let html = await page("?byokplan");
assert.deepStrictEqual(urls(html).sort(), ["/logo/claude.ai", "/logo/opencode.ai", "/logo/openrouter.ai"].sort(), "the Claude, OpenCode and OpenRouter add buttons ask for their logo.dev logos");
officialCg(html);
assert.ok(!/img\.logo\.dev|token=pk_/.test(html), "the app never asks logo.dev itself and never holds a key");
ok("add buttons: ChatGPT uses the official OpenAI asset, OpenCode and OpenRouter use /logo/<domain>");

html = await page("?byokthree");
assert.deepStrictEqual(urls(html).sort(), ["/logo/chatgpt.com", "/logo/claude.ai", "/logo/openai.com", "/logo/opencode.ai", "/logo/openrouter.ai"].sort(), "connected rows: ChatGPT, OpenCode, and api.openai.com as openai.com; the add buttons left are Claude and OpenRouter");
ok("connected rows ask for each service's own domain (an address shows its registrable domain)");

const { serviceDomain } = await import(pathToFileURL(lout).href);
assert.strictEqual(serviceDomain("plain", "api.openai.com"), "openai.com");
assert.strictEqual(serviceDomain("plain", "api.groq.com"), "groq.com");
assert.strictEqual(serviceDomain("plain", "llm.example.co.uk"), "example.co.uk");
assert.strictEqual(serviceDomain("plain", "localhost"), "");
assert.strictEqual(serviceDomain("plain", "192.168.1.5"), "");
assert.strictEqual(serviceDomain("openrouter", "anything"), "openrouter.ai");
ok("serviceDomain: fixed domains, registrable domain for an address, nothing for private or numeric addresses");
