// node test/byok-options.test.mjs: 1HC Settings → Use my own AI key (src/ee/byok-billing.ts) on its sandbox data. The two options ("Keep my plan, use
// my key as a backup" / "Switch to the $10 plan with my key when this billing period ends") show only on a full plan with a saved key,
// never on the Bring your own key plan; the Usage note says which AI is in use (a backup key in use, a switch pending with Switch now and Undo).
// The billing module is bundled with esbuild and run against a tiny fake DOM (the page is plain HTML strings).
import assert from "node:assert"; import { build } from "esbuild"; import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = join(mkdtempSync(join(tmpdir(), "byk-")), "byok.mjs");
await build({ entryPoints: [new URL("../src/ee/byok-billing.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "warning" });
globalThis.document = { addEventListener() {}, querySelector() { return null; }, getElementById() { return null; }, createElement() { return { setAttribute() {}, classList: { add() {} } }; }, body: { appendChild() {} } };
globalThis.history = { replaceState() {} }; globalThis.window = { addEventListener() {} };
const ok = (name) => console.log("  ok", name);

// One fresh copy of the module per pretend account (the sandbox reads its state from the address once).
async function page(search) {
  globalThis.location = { search, pathname: "/v3/", hash: "", href: `http://x/v3/${search}`, origin: "http://x" };
  const m = await import(`${pathToFileURL(out).href}?${encodeURIComponent(search)}`);
  m.bykInit({ api: null, repaint() {}, open() {}, note() {}, who: () => "Skipper", srow: (i, t, s, r) => `<div class="sr">${t}|${s}|${r}</div>`, icon: () => "", shown: () => false, credits() {} });
  m.bykPage(); await new Promise((z) => setTimeout(z, 400));   // the pretend GET /byok
  return { m, html: m.bykPage(), usage: m.bykUsageNote(), row: m.bykRow() };
}
const opts = (html) => [...html.matchAll(/data-bykmode="(\w*)"/g)].map((x) => x[1]);

let p = await page("?byoksaved");
assert.deepStrictEqual(opts(p.html), ["fallback"]);
assert.match(p.html, /Keep my plan, use my key as a backup/); assert.match(p.html, /data-bykswitchnow/); assert.match(p.html, /Switch now to the \$10 plan with my key/); assert.match(p.html, /Your unused Personal usage becomes credits/);
assert.match(p.html, /Your key is saved but not in use yet/); assert.match(p.html, /Zero data retention: while your key is in use/);
assert.strictEqual(p.usage, "", "nothing in Usage until a choice is made");
ok("Personal plan with a saved key: the two options, nothing picked yet, the ZDR line");

p = await page("?byokplan");
assert.deepStrictEqual(opts(p.html), [], "no choice on the Bring your own key plan"); assert.strictEqual(p.usage, "");
p = await page("");
assert.deepStrictEqual(opts(p.html), [], "no options before a key is saved"); assert.match(p.html, /Two ways to use it on Personal/);
ok("Bring your own key plan: no options; a full plan with no key yet: the two ways explained, no options until it's saved");

p = await page("?byokfb");
assert.match(p.usage, /Using your own AI key \(1Helm credits used up\)/); assert.match(p.html, /class="sr sradio bykopt on" role="radio" aria-checked="true" data-bykmode="fallback"/);
assert.match(p.html, /data-bykcredits/); assert.match(p.row, /In use/);
ok("backup key in use: the Usage note, the option ticked, Add credits on the page, 'In use' in General");

p = await page("?byokswitch");
assert.match(p.usage, /Switching to Use your own AI key on .+data-bykundo/s); assert.match(p.html, /Switching to Use your own AI key on/); assert.match(p.html, />Undo</);
assert.match(p.html, /data-bykswitchnow[^>]*>Switch now</); assert.match(p.usage, /data-bykswitchnow/);
ok("switch pending: 'Switching to Use your own AI key on <date>' with Undo, in Usage and on the page");
console.log("byok options: all passed");
