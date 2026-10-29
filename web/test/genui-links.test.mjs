// node test/genui-links.test.mjs: links in card text (src/genui-render.ts inline + the option detail of an Options card).
// Only http and https become links; everything else, including HTML the model writes, stays escaped text.
import assert from "node:assert"; import { build } from "esbuild"; import { mkdtempSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "gl-")), entry = join(dir, "entry.ts"), out = join(dir, "gl.mjs");
writeFileSync(entry, `export { inline, renderCard } from ${JSON.stringify(new URL("../src/genui-render.ts", import.meta.url).pathname)};`);
await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "error", mainFields: ["module", "main"], loader: { ".json": "json" } });
globalThis.window = globalThis.window || {}; globalThis.document = globalThis.document || { addEventListener() {}, querySelectorAll: () => [] };
const { inline, renderCard } = await import(out);
const A = (u, t) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`;
assert.equal(inline("See [Official posting](https://jobs.example/a?x=1&y=2) now"), `See ${A("https://jobs.example/a?x=1&amp;y=2", "Official posting")} now`);
assert.equal(inline("Go to https://a.example/path, then stop."), `Go to ${A("https://a.example/path", "https://a.example/path")}, then stop.`);
assert.equal(inline("**bold** and [x](http://a.example)"), `<b>bold</b> and ${A("http://a.example", "x")}`);
for (const bad of ["javascript:alert(1)", "data:text/html,x", "mailto:a@example.com", "ftp://a.example", "//a.example", "/relative"]) {
  const h = inline(`[click](${bad})`); assert.ok(!h.includes("<a "), `${bad} must not link: ${h}`); assert.ok(h.includes("[click]"), "kept as text");
}
const h = inline(`[<img src=x onerror=alert(1)>](https://a.example/"><script>alert(1)</script>) <b>hi</b> <script>`);
assert.ok(!/<(?:img|script|b)\b/.test(h.replace(/<b>|<\/b>/g, "")) && !h.includes("onerror=alert(1)>"), h);
assert.equal(inline("plain <b>text</b> & more"), "plain &lt;b&gt;text&lt;/b&gt; &amp; more");
const lang = `root = Stack([o])\no = Options("pick", [Option("Staff Engineer", "Remote. [Official posting](https://jobs.example/a)", "$223,000 to $359,000 target base plus equity", "Look first"), Option("Contract", "x", "$55/hr")])`;
const html = renderCard(lang, { owner: {}, ref: {}, sid: "s", streaming: false, file: () => null, icon: () => "" }).html;
assert.ok(html.includes(A("https://jobs.example/a", "Official posting")), "option detail link");
assert.ok(html.includes('class="gu-pr long"') && html.includes('class="gu-pr">$55/hr'), "long price class only on the long price");
console.log("genui-links ok");
