#!/usr/bin/env node
// Export the deck as a PowerPoint file with editable text, shapes and pictures, from the same built deck the checks use.
//
//   node export_pptx.mjs <abs project dir>
//
// Steps through every slide in Chrome, reads each one into text boxes, rectangles, pictures and empty picture boxes
// (pptx_extract.mjs), cuts a picture of whatever PowerPoint can't draw (gradients, background images, blurs, charts and other SVG,
// marks drawn by CSS; each is reported) and has build_pptx.py write <project>/<slug>.pptx with the speaker notes. An empty
// "Screenshot or GIF goes here" box becomes an empty picture placeholder. Fonts: each font of the deck is mapped to the closest of
// Arial, Arial Narrow, Times New Roman and Courier New (build_pptx.py), so the layout holds on any computer; nothing is embedded.
// stdout: one JSON line { ok, out, slides, shapes, texts, pictures, placeholders, fallbacks:[...], fonts:[...], problems:[...], overflows:[...], fit_measured, fitted, smallest_fit } or { ok:false, error }.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { goTo, openDeck } from "./deck_nav.mjs";
import { extractSlide } from "./pptx_extract.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
if (process.argv.slice(2).some((a) => a === "--help" || a === "-h")) {
  const L = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n"), end = L.findIndex((l, i) => i > 0 && !l.startsWith("//"));
  process.stdout.write(L.slice(1, end).map((l) => l.replace(/^\/\/ ?/, "")).join("\n") + "\n"); process.exit(0);
}
const P = process.argv[2] && !process.argv[2].startsWith("--") ? resolve(process.argv[2]) : "";
const fail = (error, code = 1) => { console.log(JSON.stringify({ ok: false, error })); process.exit(code); };
if (!P) fail("usage: export_pptx.mjs <abs project dir>", 2);
const SRC = join(P, ".src"), OUT = join(SRC, "build", "pptx"), SLUG = basename(P);
let deck, notes = [];
try { deck = JSON.parse(readFileSync(join(SRC, "deck.json"), "utf8")); notes = JSON.parse(readFileSync(join(SRC, "build", "notes.json"), "utf8")); } catch { fail("no built deck: run assemble_deck.mjs first"); }
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });

const slides = [], fallbacks = [], fonts = new Set();
const { browser, page, count } = await openDeck(P);
try {
  // Let a picture be cut out with only its own paint: everything else hidden, the page and the stage transparent.
  await page.evaluate(() => document.querySelectorAll("deck-stage").forEach((d) => { const c = d.shadowRoot && d.shadowRoot.querySelector(".canvas"); if (c) c.style.background = "transparent"; }));
  for (let i = 0; i < count; i++) {
    if ((await goTo(page, i)) !== i) fail(`slide ${i + 1}: the template did not move to it with the right arrow key`);
    const ex = await page.evaluate(`(${extractSlide})(${i})`);
    ex.fonts.forEach((f) => fonts.add(f));
    const files = [];
    for (let k = 0; k < ex.pics.length; k++) {
      const q = ex.pics[k];
      const x = Math.max(0, Math.round(ex.left + q.x)), y = Math.max(0, Math.round(ex.top + q.y));
      const w = Math.min(1920 - x, Math.round(q.w)), h = Math.min(1080 - y, Math.round(q.h));
      if (w < 2 || h < 2) { files.push(null); continue; }
      const css = `html,body{background:transparent!important}deck-stage{background:transparent!important}body *{visibility:hidden!important;text-shadow:none!important}[data-hc-pic="${k}"]{visibility:visible!important}${q.own ? `[data-hc-pic="${k}"]{color:transparent!important;-webkit-text-fill-color:transparent!important}[data-hc-pic="${k}"]::before{color:${q.before}!important;-webkit-text-fill-color:${q.before}!important}[data-hc-pic="${k}"]::after{color:${q.after}!important;-webkit-text-fill-color:${q.after}!important}` : `[data-hc-pic="${k}"] *{visibility:visible!important}`}`;
      const tag = await page.addStyleTag({ content: css });
      const file = join(OUT, `slide-${String(i + 1).padStart(2, "0")}-${k}.png`);
      await page.screenshot({ path: file, clip: { x, y, width: w, height: h }, omitBackground: true });
      await tag.evaluate((n) => n.remove());
      files.push({ file, x: x - ex.left, y: y - ex.top, w, h });
      if (!/an image$/.test(q.why)) fallbacks.push(`slide ${i + 1} ${q.why}`);
    }
    const items = ex.items.map((it) => it.type === "picture" ? (files[it.pic] ? { type: "picture", ...files[it.pic] } : null) : it).filter(Boolean);
    slides.push({ items, notes: notes[i] || "" });
  }
} finally { await browser.close(); }
writeFileSync(join(SRC, "build", "pptx.json"), JSON.stringify({ title: deck.title, slides }));
let res;
try { res = JSON.parse(execFileSync("python3", [join(HERE, "build_pptx.py"), P], { encoding: "utf8" }).trim().split("\n").pop()); }
catch (e) { fail(`build_pptx.py failed: ${String(e.stderr || e.stdout || e.message).slice(-300)}`); }
console.log(JSON.stringify({ ok: true, out: join(P, `${SLUG}.pptx`), slides: slides.length, ...res, fallbacks: [...new Set(fallbacks)].slice(0, 12), fonts: [...fonts] }));
