#!/usr/bin/env node
// Open the built deck in Chrome, step through every slide at 1920x1080, and check each one.
//
//   node deck_check.mjs <abs project dir> [--png-dir <dir>] [--pdf <file>] [--allow-sample] [--report-out <file>]
//
// Reads .src/build/deck.html (the template's own document, built by assemble_deck.mjs) and <project>/<slug>.html (the shell).
// For every slide: a PNG (page-NN.png in --png-dir, default .src/validate), then the rules in deck_checks.mjs: text cut off or
// outside the slide, text overlapping text, text under the size floor, pictures that did not load, empty picture boxes, and
// leftover placeholder or sample text (--allow-sample skips the sample-text rule, for checking an unchanged template). For the
// whole deck: fonts that failed to load, requests for anything outside the file, script errors, and a smoke test of the shell
// (counter, arrow key, full screen button). --pdf writes one page per slide with Chrome's print, text kept selectable.
// The slide text is written to .src/readback.txt. Nothing outside the file is ever fetched.
// stdout: one JSON line { ok, slides, failures:[...], notes:[...], pdf, report }. Exit 0 ok, 1 failures, 2 bad arguments.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { goTo, hideNavigation, openDeck, settle } from "./deck_nav.mjs";
import { templatesFor } from "./deck_templates_dir.mjs";
import { LIMITS, judgeSlide, measureSlide, sampleSegments, textProblems } from "./deck_checks.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
if (!argv.length || argv.includes("--help") || argv.includes("-h")) {
  const L = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n"), end = L.findIndex((l, i) => i > 0 && !l.startsWith("//"));
  process.stdout.write(L.slice(1, end).map((l) => l.replace(/^\/\/ ?/, "")).join("\n") + "\n"); process.exit(argv.length ? 0 : 2);
}
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const P = argv[0] && !argv[0].startsWith("--") ? resolve(argv[0]) : "";
if (!P) { console.log(JSON.stringify({ ok: false, error: "usage: deck_check.mjs <abs project dir>" })); process.exit(2); }
const SRC = join(P, ".src"), SLUG = basename(P), PNG = opt("png-dir") || join(SRC, "validate");
const inner = join(SRC, "build", "deck.html"), shell = join(P, `${SLUG}.html`);
if (!existsSync(inner) || !existsSync(shell)) { console.log(JSON.stringify({ ok: false, error: "no built deck: run assemble_deck.mjs first" })); process.exit(2); }
const deck = JSON.parse(readFileSync(join(SRC, "deck.json"), "utf8"));
const TEMPLATES = templatesFor(P);
const samples = argv.includes("--allow-sample") ? null : sampleSegments(readdirSync(join(TEMPLATES, deck.template, "slides")).map((f) => readFileSync(join(TEMPLATES, deck.template, "slides", f), "utf8")));
mkdirSync(PNG, { recursive: true });
for (const f of readdirSync(PNG)) if (/^page-\d+\.png$/.test(f)) rmSync(join(PNG, f));

const failures = [], notes = [], bad = [], pdfParts = [];
const { browser, ctx, page, count: n, outside, errors } = await openDeck(P, [shell]);
try {
  if (n !== deck.slides.length) failures.push(`the template shows ${n} slides but deck.json lists ${deck.slides.length}`);
  const fontState = await page.evaluate("[...document.fonts].map(f => f.family.replace(/['\"]/g, '') + '|' + f.status)");
  for (const f of fontState) if (f.endsWith("|error")) failures.push(`font did not load: ${f.split("|")[0]}`);
  if (argv.includes("--pdf")) await page.emulateMedia({ media: "screen" });

  const readback = [];
  for (let i = 0; i < n; i++) {
    const at = await goTo(page, i);
    if (at !== i) { failures.push(`slide ${i + 1} (${deck.slides[i].id}): the template did not move to it when the right arrow key was pressed (it shows slide ${at + 1})`); continue; }
    await page.screenshot({ path: join(PNG, `page-${String(i + 1).padStart(2, "0")}.png`) });
    const m = await page.evaluate(`(${measureSlide})(${i}, ${JSON.stringify(LIMITS)})`);
    const j = judgeSlide(m);
    const lines = [...new Set(m.texts.map((x) => x.t))];
    j.fail.push(...textProblems(lines, samples));
    readback.push(`--- slide ${i + 1} (${deck.slides[i].id})\n${lines.join("\n")}`);
    if (j.fail.length) bad.push({ slide: i + 1, id: deck.slides[i].id, fail: j.fail });
    if (argv.includes("--pdf")) {
      const showNav = await hideNavigation(page);   // the PDF is the slides only: no arrow-key hint, counter, progress bar or buttons, in any template
      pdfParts.push(await page.pdf({ width: "1920px", height: "1080px", printBackground: true, pageRanges: "1", margin: { top: 0, right: 0, bottom: 0, left: 0 } }));
      await showNav();
      // Printing leaves the page laid out as it was for print: a template that slides its slides sideways then looks like it is on the first one,
      // so the next arrow key press would be repeated. Put the screen layout back.
      await page.emulateMedia({ media: "screen" }); await page.evaluate(() => { void document.body.offsetWidth; window.dispatchEvent(new Event("resize")); }); await settle(page, 2000, 5);
    }
  }
  writeFileSync(join(SRC, "readback.txt"), readback.join("\n\n") + "\n");
  for (const b of bad) failures.push(`slide ${b.slide} (${b.id}): ${b.fail.join("; ")}`);
  if (outside.size) failures.push(`the deck asks for files outside itself (it must work offline): ${[...outside].slice(0, 3).join(", ")}`);
  if (errors.length) failures.push(`script errors in the deck: ${[...new Set(errors)].slice(0, 3).join(" | ")}`);
  await page.close();

  // The shell: counter, arrow key, full screen button, notes view.
  const sp = await ctx.newPage();
  await sp.setViewportSize({ width: 1280, height: 720 });
  await sp.goto(pathToFileURL(shell).href, { waitUntil: "load" });
  // The counter shows "1 / N" as soon as the shell has loaded the deck; wait for that rather than a fixed time.
  await sp.waitForFunction((k) => (document.getElementById("count")?.textContent || "").startsWith(`1 / ${k}`), n, { timeout: 6000 }).catch(() => {});
  const c1 = await sp.textContent("#count");
  // The shell counts at once but takes keys only when its frame has loaded the deck: press again (up to three times) when the counter has not moved after a second.
  let c2 = c1;
  for (let k = 0; k < 3 && (c2 || "").startsWith("1 / "); k++) {
    await sp.keyboard.press("ArrowRight");
    await sp.waitForFunction((t) => !(document.getElementById("count")?.textContent || "").startsWith("1 / "), null, { timeout: k < 2 ? 1200 : 6000 }).catch(() => {});
    c2 = await sp.textContent("#count");
  }
  const hasFull = await sp.evaluate("!!document.getElementById('full')");
  if (!(c1 || "").startsWith(`1 / ${n}`)) failures.push(`the deck file's counter reads "${c1}", expected "1 / ${n}"`);
  else if (n > 1 && !/^[2-9]\d* \//.test(c2 || "")) failures.push(`in the deck file the right arrow key did not move to slide 2 (counter "${c2}")`);
  if (!hasFull) failures.push("the deck file has no full screen button");
  await sp.close();
  await ctx.close();
} finally { await browser.close(); }

let pdf = null;
if (opt("pdf") && pdfParts.length) {
  const tmpDir = join(SRC, "build", "pdf-pages");
  rmSync(tmpDir, { recursive: true, force: true }); mkdirSync(tmpDir, { recursive: true });
  const files = pdfParts.map((b, i) => { const f = join(tmpDir, `${String(i).padStart(3, "0")}.pdf`); writeFileSync(f, b); return f; });
  try { execFileSync("python3", ["-c", "import sys\nfrom pypdf import PdfWriter\nw=PdfWriter()\nfor f in sys.argv[2:]: w.append(f)\nw.write(sys.argv[1])", opt("pdf"), ...files]); pdf = opt("pdf"); }
  catch (e) { failures.push(`could not write the PDF: ${String(e.stderr || e.message).slice(-200)}`); }
  rmSync(tmpDir, { recursive: true, force: true });
}
// fixable: the slide's only failures are text cut off or overlapping text, which deck_repair.mjs can set right by making words smaller.
const failed_slides = bad.map((b) => ({ slide: b.slide, id: b.id, fixable: b.fail.every((f) => /^text is cut off or outside the slide|^text overlaps other text/.test(f)) }));
const report = { ok: failures.length === 0, slides: deck.slides.length, failures, notes, pdf, failed_slides };
if (opt("report-out")) writeFileSync(opt("report-out"), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report));
process.exit(report.ok ? 0 : 1);
