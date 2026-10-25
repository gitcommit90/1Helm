#!/usr/bin/env node
// Set smaller the words that make a slide fail the cut-off and overlap checks, so the next build passes.
//
//   node deck_repair.mjs <abs project dir>
//   node deck_repair.mjs <abs project dir> --figures
//
// make_deck.sh runs this when deck_check.mjs reported slides whose only failures are text cut off or overlapping text. new_deck.mjs already sized
// each text to its own box (deck_fit.mjs); what is left is words that share room with others on the slide (the lines of one card push the labels
// below it off the slide). For each such slide, the texts that differ from the template's sample are shown in Chrome and set smaller together, 7% at a
// time and never below their readable floor, until the slide passes the same rules deck_check.mjs uses. The sizes are written into the slide file
//. Slides that still fail are left as they are.
// --figures runs first, before any build, and needs no browser: for any deck, however its slide files were written, each impact figure (data-slot
// "stat1"/"stat2") that would be cut off is sized with new_deck's rules (deck_figures.mjs). stdout: { ok, figures: [{ id, slot, value, from, to }],
// problems: [{ id, slide, slot, value, chars }] } where a problem is a figure that fits no size.
// stdout: one JSON line { ok, repaired: [{ id, units: [{ u, slot, from, to }] }], unrepaired: [id] }. Exit 0, or 2 for bad arguments.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { goToFar, openDeck, settle } from "./deck_nav.mjs";
import { LIMITS, measureSlide } from "./deck_checks.mjs";
import { FIG, fitFigureSlide } from "./deck_figures.mjs";
import { templatesFor } from "./deck_templates_dir.mjs";
import { floorFor, flowOf, loadFit, scan, sizeDecl, unitsOf, withStyle } from "./deck_fit.mjs";

if (process.argv.slice(2).some((a) => a === "--help" || a === "-h")) {
  const L = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n"), end = L.findIndex((l, i) => i > 0 && !l.startsWith("//"));
  process.stdout.write(L.slice(1, end).map((l) => l.replace(/^\/\/ ?/, "")).join("\n") + "\n"); process.exit(0);
}
const P0 = process.argv[2] && !process.argv[2].startsWith("--") ? resolve(process.argv[2]) : "";
const P = P0;
if (!P) { console.log(JSON.stringify({ ok: false, error: "usage: deck_repair.mjs <project dir>" })); process.exit(2); }
const SRC = join(P, ".src"), j = (f) => { try { return JSON.parse(readFileSync(join(SRC, f), "utf8")); } catch { return null; } };
const deck = j("deck.json"), report = j("check_report.json");

if (process.argv.includes("--figures")) {
  const figures = [], problems = [];
  if (deck) {
    FIG.name = deck.template; FIG.root = templatesFor(P);
    deck.slides.forEach((sl, k) => {
      const file = join(SRC, "slides", `${sl.id}.html`); let html; try { html = readFileSync(file, "utf8"); } catch { return; }
      if (!/data-slot="stat1"/.test(html)) return;
      let base = 120; try { base = Number((readFileSync(join(FIG.root, deck.template, "slides", readdirSync(join(FIG.root, deck.template, "slides")).find((f) => f.endsWith(`-${sl.pattern}.html`))), "utf8").match(/data-slot="stat1"[^>]*font-size:(\d+)px/) || [])[1]) || 120; } catch { /* the usual size */ }
      const r = fitFigureSlide(html, base);
      if (r.html !== html) writeFileSync(file, r.html);
      figures.push(...r.changed.map((c) => ({ id: sl.id, ...c })));
      problems.push(...r.problems.map((q) => ({ id: sl.id, slide: k + 1, ...q })));
    });
  }
  console.log(JSON.stringify({ ok: !problems.length, figures, problems })); process.exit(0);
}
const fit = deck && loadFit(join(SRC, "template"), deck.template);
const todo = (report?.failed_slides || []).filter((s) => s.fixable);
if (!deck || !fit || !todo.length) { console.log(JSON.stringify({ ok: true, repaired: [], unrepaired: (report?.failed_slides || []).map((s) => s.id) })); process.exit(0); }

// For each slide to repair: the texts that are not the sample's, with their element numbers in the slide file.
const plan = [];
for (const f of todo) {
  const entry = deck.slides.findIndex((s) => s.id === f.id); if (entry < 0) continue;
  const file = join(SRC, "slides", `${f.id}.html`); let html; try { html = readFileSync(file, "utf8"); } catch { continue; }
  const s = scan(html), units = unitsOf(fit, deck.slides[entry].pattern), ids = new Set(units.map((u) => u.i));
  const changed = [];
  for (const u of units) {
    const el = s.els[u.i]; if (!el || el.tag !== u.tag || u.skip || /^stat[12]$/.test(u.slot || "")) continue;
    const now = flowOf(s, el, (e) => e.i !== el.i && ids.has(e.i)).join("\n");
    if (now && now !== u.t) changed.push({ u: u.u, i: u.i, tag: u.tag, slot: u.slot || "", fs: u.fs, floor: floorFor(u.fs), lh: u.lh, ls: u.ls });
  }
  plan.push({ id: f.id, index: entry, file, html, changed });
}

// Runs in the page for the slide shown: set the given texts smaller together until the slide has no cut-off or overlapping text.
const shrink = (idx, units, limits, measureSlide) => {
  const slide = document.querySelectorAll("[data-hc-slide]")[idx];
  const els = [slide, ...[...slide.querySelectorAll("*")].filter((e) => (e.tagName.toLowerCase() === "svg" ? !e.parentElement.closest("svg") : !e.closest("svg")))];
  const items = units.map((u) => ({ u, el: els[u.i] })).filter((x) => x.el && x.el.tagName.toLowerCase() === x.u.tag);
  const size = (el) => parseFloat(getComputedStyle(el).fontSize);
  const bad = () => { const m = measureSlide(idx, limits); return m.clipped.length + m.overlaps.length; };
  const start = items.map((x) => size(x.el));
  const result = (ok) => ({ ok, units: items.map((x, k) => ({ u: x.u.u, slot: x.u.slot, from: Math.round(start[k] * 10) / 10, to: Math.round(size(x.el)) })).filter((x) => x.to < x.from - 0.5) });
  if (!bad()) return result(true);
  for (let step = 0; step < 18; step++) {
    let moved = false;
    for (const x of items) {
      const c = size(x.el), s = Math.max(x.u.floor, Math.floor(c * 0.93));
      if (s < c - 0.01) { x.el.style.fontSize = `${s}px`; x.el.style.lineHeight = String(+(x.u.lh / x.u.fs).toFixed(3)); if (x.u.ls) x.el.style.letterSpacing = `${(x.u.ls * s / x.u.fs).toFixed(2)}px`; moved = true; }
    }
    if (!moved) break;
    if (!bad()) return result(true);
  }
  return result(false);
};

const { browser, page } = await openDeck(P);
const repaired = [], unrepaired = [];
try {
  for (const p of plan) {
    if (!p.changed.length) { unrepaired.push(p.id); continue; }
    if ((await goToFar(page, p.index)) !== p.index) { unrepaired.push(p.id); continue; }
    await settle(page);
    const r = await page.evaluate(`(${shrink})(${p.index}, ${JSON.stringify(p.changed)}, ${JSON.stringify(LIMITS)}, ${measureSlide})`);
    if (!r.ok || !r.units.length) { unrepaired.push(p.id); continue; }
    // Write the sizes into the slide file, from the last open tag to the first so the offsets hold.
    const s = scan(p.html); let out = p.html;
    for (const u of [...r.units].sort((a, b) => p.changed.find((x) => x.u === b.u).i - p.changed.find((x) => x.u === a.u).i)) {
      const c = p.changed.find((x) => x.u === u.u), el = s.els[c.i];
      out = out.slice(0, el.os) + withStyle(out.slice(el.os, el.oe), sizeDecl(c, u.to)) + out.slice(el.oe);
    }
    writeFileSync(p.file, out);
    repaired.push({ id: p.id, units: r.units });
  }
} finally { await browser.close(); }
console.log(JSON.stringify({ ok: true, repaired, unrepaired }));
