// node test/share-page-data.test.mjs: the Library card of a published page shows its saved-entry count, a download link and "Clear saved data"
// (src/share.ts). Nothing extra shows while nothing is saved, so a page without saved data looks as before. No switch, no helper text.
import assert from "node:assert"; import { build } from "esbuild"; import { mkdtempSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "spd-")), entry = join(dir, "entry.ts"), out = join(dir, "sh.mjs");
writeFileSync(entry, `export * from ${JSON.stringify(new URL("../src/share.ts", import.meta.url).pathname)};`);
await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "error", mainFields: ["module", "main"], loader: { ".json": "json" } });
const listeners = {}; globalThis.window = { addEventListener(t, f) { listeners[t] = f; } }; globalThis.document = { addEventListener() {}, getElementById: () => null, activeElement: null, createElement: () => ({}), body: { appendChild() {} }, querySelector: () => null };
globalThis.location = { origin: "https://onehelm.test" };
const pages = [{ name: "dinner", title: "Dinner", url: "https://onehelm.test/s/ck1/p/dinner/", files: 1, bytes: 10, channel: "main", created_at: 1, updated_at: 2, saved_entries: 12, saved_bytes: 900 },
  { name: "plain", title: "Plain", url: "https://onehelm.test/s/ck1/p/plain/", files: 1, bytes: 10, channel: "main", created_at: 1, updated_at: 2, saved_entries: 0, saved_bytes: 0 }];
const calls = [], notes = []; let asked = 0;
const { shInit, shLibHtml } = await import(out);
shInit({ api: async (p, b) => { calls.push([p, b]); return p === "/share" ? { base: "x", links: [], pages, chats: [] } : { ok: true, cleared: 12 }; }, apiUrl: (p) => `/w/ck1/api${p}`, phone: () => false, note: (t, s) => notes.push([t, s]), repaint() {}, helper: () => "" });
await new Promise((r) => setTimeout(r, 20));
const html = shLibHtml("main");
const rows = html.split('<div class="shrow">').slice(1); assert.equal(rows.length, 2);
const dinner = rows.find((r) => r.includes("Dinner")), plain = rows.find((r) => r.includes("Plain"));
assert.match(dinner, /12 saved entries, updated/); assert.match(dinner, /href="\/w\/ck1\/api\/share\/pages\/dinner\/data\?format=csv" download="dinner-saved-data\.csv"/);
assert.match(dinner, /data-sh="pdclear\|dinner"[^>]*title="Clear saved data"/); assert.match(dinner, /data-sh="unpub\|dinner"/);
assert.doesNotMatch(plain, /saved|pdclear|download/, "a page with nothing saved shows no extra text or buttons");
assert.match(plain, /Updated /);
console.log("PASS share-page-data");
