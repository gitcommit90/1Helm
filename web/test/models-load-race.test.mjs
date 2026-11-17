// node test/models-load-race.test.mjs: a read of the account's models (custom-models.ts) or of the AI services state (byok.ts) that began before a save, and answers after it, holds the
// older copy. The page must keep what the save returned instead of drawing the older copy until the next read.
import assert from "node:assert"; import { build } from "esbuild"; import { mkdtempSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path"; import { pathToFileURL, fileURLToPath } from "node:url";
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "mlr-")), out = join(dir, "bundle.mjs"), entry = join(dir, "entry.ts");
writeFileSync(entry, `export * from ${JSON.stringify(here("../src/ee/byok-billing.ts"))};\nexport { cmodelsInit, cmodelsCard, cmodelsPrivacy } from ${JSON.stringify(here("../src/ee/custom-models.ts"))};\n`);
await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "warning" });
const clicks = [];
globalThis.document = { addEventListener(t, f) { if (t === "click") clicks.push(f); }, activeElement: null, querySelector() { return null; }, querySelectorAll() { return []; }, getElementById() { return null; }, createElement() { return { setAttribute() {}, classList: { add() {} } }; }, body: {} };
globalThis.history = { replaceState() {} }; globalThis.window = { addEventListener() {}, setTimeout }; globalThis.location = { search: "", pathname: "/v3/", hash: "", href: "http://x/v3/", origin: "http://x" };
const wait = (ms) => new Promise((z) => setTimeout(z, ms));
const m = await import(pathToFileURL(out).href);
// The server: a read is answered 400 ms after it arrives, with the copy it had on arrival; a write applies at once.
const srv = { on: true, mode: "now" };
const models = () => ({ on: srv.on, level: "zdr", own_key: false, categories: [], models: {}, connections: [] });
const byok = () => ({ on_plan: false, full: true, plan_name: "Personal", price: 10, mode: srv.mode, connections: [{ id: "c1", kind: "openrouter", label: "OpenRouter", last4: "abcd", added_at: 1 }], usage: {} });
const api = async (path, init) => {
  if (path.startsWith("account/custom-models")) { if (init?.method === "POST") { srv.on = init.body.on; return models(); } const v = models(); await wait(400); return v; }
  if (path === "/byok/mode") { srv.mode = init.mode; return byok(); }
  if (path === "/byok") { const v = byok(); await wait(400); return v; }
  return {};
};
m.cmodelsInit({ api, repaint() {}, shown: () => true, srow: (i, t, s, r) => r, ask: async () => false, channels: () => [], openAdvanced() {}, version: "t", noteBoot() {} }, { on: true });
const toggle = () => { for (const f of clicks) f({ target: { closest: (q) => (q === "[data-cmtoggle]" ? {} : null) }, preventDefault() {} }); };
m.cmodelsPrivacy({ on: true });   // reads the models: the answer (on) is on its way for 400 ms
await wait(50); toggle();         // Custom Model Selection is switched off meanwhile; the save answers at once
await wait(600);
assert.match(m.cmodelsCard(), /aria-checked="false"/, "the older read drew the switch back on");
// The same for Settings, AI services: a /byok read is on its way while the plan option is changed.
m.bykInit({ api, repaint() {}, open() {}, note() {}, who: () => "Skipper", srow: (i, t, s, r) => r, icon: () => "", shown: () => true, credits() {} });
const press = (sel, dataset) => { for (const f of clicks) f({ target: { closest: (q) => (q === sel ? { dataset } : null) }, preventDefault() {}, stopPropagation() {} }); };
m.bykPage(); await wait(600);
press("[data-bykmode]", { bykmode: "fallback" }); await wait(100);   // first change: saved
m.bykLoad(true); await wait(50);                                     // a read that sees the first change is on its way
press("[data-bykundo]", {}); await wait(700);                        // second change: saved, then the older read lands
assert.doesNotMatch(m.bykPage(), /aria-checked="true" data-bykmode="fallback"/, "the older read drew the first change back");
console.log("models load race: all passed");
