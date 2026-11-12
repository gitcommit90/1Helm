// node test/ai-services-cache.test.mjs: Settings, AI services draws its full content on every open (task picker-speed). The last answers (connections and plan options, and the own-key Models setting) are kept
// in memory and in this browser's localStorage by workspace (no key or token in them); a page that has them draws them in the same frame with no "Loading" text, reads them again in the background and
// changes in place only when an answer differs. The very first open on a new browser draws the frame of the page without a loading line. Bundled with esbuild, run against a tiny fake DOM.
import assert from "node:assert"; import { build } from "esbuild"; import { mkdtempSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path"; import { pathToFileURL, fileURLToPath } from "node:url";
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "aisc-")), out = join(dir, "bundle.mjs"), entry = join(dir, "entry.ts");
writeFileSync(entry, `export * from ${JSON.stringify(here("../src/ee/byok-billing.ts"))};\nexport { cmodelsInit, cmodelsOwnPanel, cmodelsRefresh } from ${JSON.stringify(here("../src/ee/custom-models.ts"))};\n`);
await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "warning" });
const store = new Map(); globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.document = { addEventListener() {}, activeElement: null, querySelector() { return null; } }; globalThis.history = { replaceState() {} };
globalThis.window = { addEventListener() {}, setTimeout, __1HC: { slug: "demoslug" } }; globalThis.location = { search: "", pathname: "/", hash: "", href: "http://x/", origin: "http://x" };
const ok = (n) => console.log("  ok", n), wait = (ms) => new Promise((z) => setTimeout(z, ms));
const conns = [{ id: "chatgpt", kind: "chatgpt", label: "ChatGPT", host: "", last4: "", email: "sam@example.com", added_at: 1, tested_at: 1, test: { ok: true, checks: { reach: { ok: true } } } }, { id: "opencode", kind: "opencode", label: "OpenCode", host: "", last4: "9f3b", added_at: 2, tested_at: 2, test: null }];
const byok = (extra = {}) => ({ on_plan: false, full: true, plan_name: "Personal", price: 10, mode: "", connections: conns, openrouter: { manage: "" }, custom: { model: null }, opencode_oidc: { available: true, issuer: "i", subject: "s", audience: "a", console: "c" }, ...extra });
const view = (model) => ({ optional: true, on: true, level: "zdr", own_key: true, endpoint: "own", needs_choice: false, no_model: false, problems: [], max_categories: 12, categories: [{ id: "general", title: "General", chain: [{ model, effort: null }], max_price: null }], background: { title: "Background jobs", chain: [] }, connections: conns.map((c) => ({ id: c.id, kind: c.kind, label: c.label, host: "" })), has_openrouter: false,
  models: { [model]: { id: model, name: "GPT-6.1 Terra", source: "BYOK", conn: "chatgpt", service: "ChatGPT", efforts: [], default_effort: null, levels: [], pricing: null, allowed: true } } });
let served = { byok: byok(), models: view("chatgpt:gpt-6.1-terra") }, delay = 0, calls = [];
const api = async (path) => { calls.push(path); if (delay) await wait(delay); if (path === "/byok") return JSON.parse(JSON.stringify(served.byok)); if (path === "account/custom-models?scope=services") return JSON.parse(JSON.stringify(served.models)); return { ok: true }; };
let n = 0;
async function page() {
  const m = await import(`${pathToFileURL(out).href}?${++n}`); let repaints = 0;
  const srow = (i, t, s, r) => `<div class="sr">${t}|${s}|${r}</div>`;
  m.cmodelsInit({ api, repaint() { repaints++; }, shown: () => true, srow, ask: async () => false, openAdvanced() {}, openAi() {}, version: "t", noteBoot() {} }, { on: true, own_key: true, level: "zdr" });
  m.bykInit({ api, repaint() { repaints++; }, open() {}, note() {}, who: () => "Skipper", srow, icon: () => "", shown: () => true, credits() {} });
  return { m, html: () => m.bykPage(), repaints: () => repaints };
}

// 1) the very first open on a new browser: the frame, no loading line; then the content
delay = 40; let p = await page(); let h = p.html();
assert.ok(!/Loading/.test(h), "no loading text on the very first open"); assert.match(h, /cmskel/); assert.match(h, /data-cmown/); ok("first open on a new browser: the frame of the page, no loading line");
await wait(250); p.html(); await wait(100); h = p.html(); assert.match(h, /data-bykconn=/); assert.match(h, /data-cmpick="general\|0"/); assert.ok(!/Loading/.test(h)); ok("then the content");
const raw = [...store.values()].join(" "); assert.ok(!/sk_|bearer|token|secret/i.test(raw), "the cached answers hold no key or token"); assert.ok([...store.keys()].every((k) => k.endsWith(":demoslug")), "kept by workspace"); ok("the cache is keyed by workspace and holds no key or token");

// 2) the second open (a new page load with the same browser storage): the full content in the same frame, no loading text
calls = []; p = await page(); h = p.html();
assert.ok(!/Loading/.test(h) && !/cmskel/.test(h)); assert.match(h, /data-bykconn=/); assert.match(h, /data-cmpick="general\|0"/); assert.match(h, /GPT-6\.1 Terra/); ok("second open: the full content in the same frame, no loading text");
await wait(2000); assert.ok(calls.includes("/byok") && calls.includes("account/custom-models?scope=services"), "both answers are read again in the background at boot: " + calls.join()); ok("both answers are read again in the background");

// 3) an unchanged answer redraws nothing; a changed one updates in place
const before = p.repaints(); await p.m.cmodelsRefresh(); await wait(50); assert.equal(p.repaints(), before, "an unchanged answer causes no repaint"); ok("unchanged answers cause no repaint");
served.models = view("chatgpt:gpt-6-luna"); served.models.models["chatgpt:gpt-6-luna"] = { ...served.models.models["chatgpt:gpt-6-luna"], name: "GPT-6 Luna" };
await p.m.cmodelsRefresh(); await wait(50); h = p.html(); assert.match(h, /GPT-6 Luna/); assert.ok(p.repaints() > before); assert.ok(!/Loading/.test(h)); ok("fresh data updates in place");
// 4) a service added elsewhere shows up the next time the page opens, without the page ever showing a loading line
served.byok = byok({ connections: [...conns, { id: "openrouter", kind: "openrouter", label: "OpenRouter", host: "", last4: "abcd", added_at: 3, tested_at: 3, test: null }] });
p.m.bykLoad(true); await wait(80); h = p.html(); assert.match(h, /OpenRouter/); ok("a changed services answer updates in place");
// 5) storage that throws never breaks the page
globalThis.localStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
p = await page(); assert.doesNotThrow(() => p.html()); await wait(250); assert.match(p.html(), /data-bykconn=/); ok("blocked storage: the page still works");
console.log("ai services cache: all passed");
