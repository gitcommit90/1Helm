// node test/ai-services-panel.test.mjs: Settings → AI services is a side panel of its own (task ai-panel). It holds the connected services, then a Models section with the
// own-key editor (custom-models.ts cmodelsOwnPanel, moved from Advanced), then the plan options. Advanced no longer draws the own-key editor, the old name ?settings=byok points at the
// panel, and after a first service connects the panel scrolls to Models with an empty "Choose a model" slot (nothing is picked for the person). Both modules are bundled together
// with esbuild and run against a tiny fake DOM (the page is plain HTML strings), on the sandbox data.
import assert from "node:assert"; import { build } from "esbuild"; import { mkdtempSync, writeFileSync, readFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "aisp-")), out = join(dir, "bundle.mjs"), entry = join(dir, "entry.ts");
writeFileSync(entry, `export * from ${JSON.stringify(here("../src/ee/byok-billing.ts"))};\nexport { cmodelsInit, cmodelsCard, cmodelsOwnPanel, cmodelsRefresh } from ${JSON.stringify(here("../src/ee/custom-models.ts"))};\n`);
await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "warning" });
const scrolled = [], clicks = [];
globalThis.document = { addEventListener(t, f) { if (t === "click") clicks.push(f); }, activeElement: null, querySelector(sel) { return sel === "[data-cmown]" ? { scrollIntoView: (o) => scrolled.push(o) } : null; }, querySelectorAll() { return []; }, getElementById() { return null; }, createElement() { return { setAttribute() {}, classList: { add() {} } }; }, body: {} };
globalThis.history = { replaceState() {} }; globalThis.window = { addEventListener() {}, setTimeout };
const ok = (name) => console.log("  ok", name);
const wait = (ms) => new Promise((z) => setTimeout(z, ms));
async function page(search) {
  globalThis.location = { search, pathname: "/v3/", hash: "", href: `http://x/v3/${search}`, origin: "http://x" };
  const m = await import(`${pathToFileURL(out).href}?${encodeURIComponent(search)}`);
  clicks.length = 0; let repaints = 0;
  const srow = (i, t, s, r) => `<div class="sr">${t}|${s}|${r}</div>`;
  m.cmodelsInit({ api: null, repaint() { repaints++; }, shown: () => true, srow, ask: async () => false, openAdvanced() {}, openAi() {}, version: "t", noteBoot() {} }, null);
  m.bykInit({ api: null, repaint() { repaints++; }, open() {}, note() {}, who: () => "Skipper", srow, icon: () => "", shown: () => true, credits() {} });
  m.bykPage(); await wait(500); m.bykPage(); await wait(100);
  return { m, html: () => m.bykPage(), repaints: () => repaints };
}

assert.match(readFileSync(here("../src/settings-links.ts"), "utf8"), /byok: \{ section: "ai"/, "the old link name opens the new panel");
const v3 = readFileSync(here("../src/v3.ts"), "utf8");
assert.match(v3, /\[BYK_SEC, "AI services", "spark"\]/, "AI services is a nav entry");
assert.ok(v3.indexOf('["general", "General", "gear"], [BYK_SEC, "AI services"') >= 0, "right after General");
assert.ok(!/bykRow/.test(v3), "General has no Use my own AI key row any more");
ok("nav entry right after General, the General row is gone, ?settings=byok points at the panel");

// An own key with services connected and models chosen: the editor is in the panel, between the list and the plan options, and Advanced draws nothing for it.
let p = await page("?byokthree&cmown");
let h = p.html();
assert.match(h, /data-cmown/); assert.match(h, /data-cmcat="general"/); assert.match(h, /data-cmpick="general\|0"/);
assert.ok(h.indexOf("data-bykconn=") < h.indexOf("data-cmown"), "services first, then Models");
assert.ok(h.indexOf("data-cmown") < h.indexOf('class="sfine"'), "Models before the fine print");
assert.strictEqual(p.m.cmodelsCard(), "", "Advanced no longer shows the own-key editor");
assert.doesNotMatch(h, /No model is chosen yet/);
ok("services, then Models with the editor, then the fine print; Advanced shows nothing for an own key");

// Services connected, nothing chosen: one plain line and an empty slot that says Choose a model.
p = await page("?byokthree&cmown&cmownnone");
h = p.html();
assert.match(h, /No model is chosen yet\./); assert.match(h, /cmempty/); assert.match(h, /Choose a model/);
assert.strictEqual((h.match(/data-cmpick=/g) || []).length >= 1, true);
assert.ok(!/data-bykchoose/.test(h), "the old Choose models banner is gone");
ok("connected with no model chosen: one line and an empty Choose a model slot, nothing picked");

// First service connects: the models are read again and the panel scrolls to Models.
p = await page("?byokplan&cmown&cmownnone");
assert.doesNotMatch(p.html(), /data-cmown/, "nothing connected: no Models section");
p.m.bykAfter(); assert.strictEqual(scrolled.length, 0, "no scroll without a connection");
const before = p.repaints();
for (const f of clicks) f({ target: { closest: (q) => (q === "[data-bykor]" ? {} : null) }, preventDefault() {}, stopPropagation() {} });   // Sign in with OpenRouter (sandbox: yes)
await wait(1300);
assert.ok(p.repaints() > before, "the page is drawn again once the models are read");
h = p.html();
assert.match(h, /data-cmown/); assert.match(h, /Choose a model/); assert.match(h, /No model is chosen yet\./);
assert.ok(!/data-cmpick="general\|0"[^>]*aria-label="First choice model for General: (?!Choose a model)/.test(h), "the slot is empty: nothing was picked");
p.m.bykAfter(); assert.deepStrictEqual(scrolled.map((o) => o.block), ["start"], "scrolled to Models once");
p.m.bykAfter(); assert.strictEqual(scrolled.length, 1, "only once per connect");
ok("first service connects: Models appears with an empty Choose a model slot and the panel scrolls to it, once");
console.log("ai services panel: all passed");
