// node test/msgreply.test.mjs: Copy + Reply on chat bubbles (src/msgreply.ts), the pure parts.
// Checks: the text Copy puts on the clipboard (Markdown marks and card code cleaned away, links kept as "text (url)", code kept
// without its fences, tables as tab-separated rows, sandbox <small> notes dropped); a card reply copies as its words (genui-render's
// cardText); the one-line excerpt a reply quotes (≤ n chars with …). The UI itself is checked in the browser.
import assert from "node:assert"; import { build } from "esbuild"; import { mkdtempSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "mr-")), entry = join(dir, "entry.ts"), out = join(dir, "mr.mjs");
writeFileSync(entry, `export * from ${JSON.stringify(new URL("../src/msgreply.ts", import.meta.url).pathname)}; export { cardText, scrubCode } from ${JSON.stringify(new URL("../src/genui-render.ts", import.meta.url).pathname)};`);
await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "error", mainFields: ["module", "main"], loader: { ".json": "json" } });
const { copyPlain, excerpt, cardText, scrubCode, menuSpot, hasContainingBlock, offsetSpot } = await import(out);
const ok = (n) => console.log("  ok", n);
const H = { cardText, scrubCode };

assert.equal(copyPlain("**Lupa** at 7, or _Via Carota_ at 8.\n\n## Which one?\n\n* first\n+ second\n1. third", H),
  "Lupa at 7, or Via Carota at 8.\n\nWhich one?\n\n- first\n- second\n1. third");
assert.equal(copyPlain("See [the menu](https://lupa.example/menu) or https://x.example and <https://y.example>.", H), "See the menu (https://lupa.example/menu) or https://x.example and https://y.example.");
assert.equal(copyPlain("[https://a.example](https://a.example)", H), "https://a.example", "a link that is its own text: once");
assert.equal(copyPlain("Run:\n\n```bash\nls -la\n```\n\nthen `cd files`.", H), "Run:\n\nls -la\n\nthen cd files.");
assert.equal(copyPlain("| Place | Time |\n|---|:---:|\n| Lupa | 7pm |", H), "Place\tTime\nLupa\t7pm");
assert.equal(copyPlain("> quoted line\n\n---\n\n~~old~~ new", H), "quoted line\n\nnew".replace("new", "old new"));
assert.equal(copyPlain("Done.\n\n<small>Scripted reply · demo mode</small>", H), "Done.");
assert.equal(copyPlain("a snake_case_name and 2*3*4 stay", H), "a snake_case_name and 2*3*4 stay", "no false italics");
assert.equal(copyPlain("Tom &amp; Jerry", H), "Tom & Jerry");
ok("copy: Markdown marks gone, links as text (url), code without fences, tables as tab rows, sandbox notes dropped, no false italics");

// a card reply: its words, never the code
const card = 'Here are two options.\n\n```openui\nroot = Stack([s, b])\ns = Say("Lupa at 7 or Via Carota at 8?")\nb = Buttons([Button("Lupa", "Lupa"), Button("Via Carota", "Via Carota")])\n```';
const c = copyPlain(card, H);
assert.ok(!/Stack\(|Buttons\(|openui|root =/.test(c), `no card code: ${c}`);
assert.match(c, /Here are two options\./);
ok("copy: a reply with a card copies its words, never the card code");

assert.equal(excerpt("  one\n\n two   three "), "one two three");
const e = excerpt("word ".repeat(100), 50); assert.equal(e.length, 50); assert.ok(e.endsWith("…"));
assert.equal(excerpt(""), "");
assert.equal(excerpt("- Lupa at 7\n- Via Carota at 8"), "Lupa at 7 Via Carota at 8"); assert.equal(excerpt("1. Lupa\n2. Via Carota"), "1. Lupa 2. Via Carota");
ok("excerpt: one line, ≤ n chars with …");

// the held menu: near the finger, always inside the visible chat
{ const v = { top: 60, bottom: 700, left: 0, right: 390 };
  let s = menuSpot({ x: 200, y: 400 }, v, 150); assert.deepEqual(s, { x: 125, y: 328 }, "above the finger");
  s = menuSpot({ x: 200, y: 90 }, v, 150); assert.deepEqual(s, { x: 125, y: 118 }, "no room above: below the finger");
  s = menuSpot({ x: 5, y: 400 }, v, 150); assert.equal(s.x, 8, "kept inside the left edge");
  s = menuSpot({ x: 385, y: 400 }, v, 150); assert.equal(s.x, 232, "kept inside the right edge");
  s = menuSpot({ x: 200, y: 695 }, v, 150); assert.ok(s.y + 44 <= 700, "kept above the bottom edge");
  s = menuSpot({ x: 200, y: 100 }, { top: 0, bottom: 150, left: 0, right: 844 }, 150); assert.ok(s.y >= 32 && s.y + 44 <= 150, "short landscape view");
  ok("menu: placed near the finger and clamped inside the visible chat"); }

{ assert.deepEqual(offsetSpot({ x: 125, y: 328 }, { x: 20, y: 60 }), { x: 105, y: 268 }, "inside an offset containing block");
  const none = { transform: "none", filter: "none", perspective: "none", contain: "none", willChange: "auto" };
  assert.ok(!hasContainingBlock(none)); assert.ok(hasContainingBlock({ ...none, willChange: "transform" }), "will-change:transform");
  assert.ok(hasContainingBlock({ ...none, transform: "matrix(1,0,0,1,10,0)" })); assert.ok(hasContainingBlock({ ...none, contain: "layout paint" }));
  ok("menu: offset for a transformed ancestor"); }
