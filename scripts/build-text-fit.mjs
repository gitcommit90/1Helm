#!/usr/bin/env node
// Writes app-assets/deck-templates/<template>/fit.json: for every slide pattern of a template, the room each block of text has, measured in Chrome
// on the template's own sample slides, and the advance width of every character in the fonts the blocks use (scripts/build-text-fit-widths.py).
// new_deck.mjs reads it (scripts/deck_fit.mjs) to set the biggest font size at which the deck's own words fit, with no browser.
//
//   node scripts/build-text-fit.mjs [template ...] [--jobs N]        (all templates when none is named; ONEHC_CHROME names the Chrome to use)
//
// A "text unit" is a block-level element with words of its own (an h2, a paragraph, a pill), together with the inline pieces inside it. For each unit:
//   W   the longest unbreakable word, in px at the unit's own size, that fits its line without text being cut off or overlapping other text
//       (found by growing a word of capital M until deck_checks.mjs reports the word cut off or overlapping, and capped by the unit's own box
//       when the box does not grow with its words);
//   Ls  the lines the sample words take; Lx the lines that can be added after them (each line a word of 60% of W) before text is cut off or overlaps.
// Probes use the same rules make_deck.sh judges a deck by (measureSlide in deck_checks.mjs), so a fit found here passes that check.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = resolve(HERE, ".."), S = join(ROOT, "src/skills/artifacts/scripts"), T = join(ROOT, "app-assets/deck-templates");
const args = process.argv.slice(2);
const jobsAt = args.indexOf("--jobs"), JOBS = jobsAt >= 0 ? Number(args[jobsAt + 1]) : 6;
const names = args.filter((a, i) => !a.startsWith("--") && !(jobsAt >= 0 && i === jobsAt + 1));
const all = readdirSync(T).filter((n) => existsSync(join(T, n, "head.html"))).sort();
const todo = names.length ? names : all;

if (process.env.HC_FIT_CHILD) {   // one template: probe it and write its fit.json
  const { scan, numberElements, flowOf, FIT_VERSION } = await import(join(S, "deck_fit.mjs"));
  const { goTo, openDeck, settle } = await import(join(S, "deck_nav.mjs"));
  const { LIMITS, measureSlide } = await import(join(S, "deck_checks.mjs"));
  const name = process.env.HC_FIT_CHILD, tmp = mkdtempSync(join(tmpdir(), `fit-${name}-`)), P = join(tmp, "deck");
  const files = readdirSync(join(T, name, "slides")).sort(), patterns = files.map((f) => f.match(/^\d+-(.+)\.html$/)[1]);
  writeFileSync(join(tmp, "data.json"), JSON.stringify({ slides: patterns.map((pattern) => ({ pattern })) }));
  const run = (cmd, a) => { const r = spawnSync("node", [join(S, cmd), ...a], { encoding: "utf8", env: { ...process.env, HC_FIT_CHILD: "" } }); if (r.status !== 0) throw new Error(`${cmd}: ${r.stdout.slice(-300)}${r.stderr.slice(-300)}`); };
  run("new_deck.mjs", [P, "--template", name, "--title", "fit", "--data", join(tmp, "data.json")]);
  const sampleOf = {};   // the sample's own markup, element numbers as the probe sees them
  for (const f of readdirSync(join(P, ".src/slides")).sort()) {
    const h = readFileSync(join(P, ".src/slides", f), "utf8"), id = f.replace(/\.html$/, ""); sampleOf[id] = h;
    writeFileSync(join(P, ".src/slides", f), numberElements(h));
  }
  run("assemble_deck.mjs", [P]);

  // Runs in the page for the slide shown. Returns the units found with what was measured.
  const probe = async (idx, limits, measureSlide) => {
    const slide = document.querySelectorAll("[data-hc-slide]")[idx];
    const norm = (s) => s.replace(/\s+/g, " ").trim();
    const lim = limits;
    const meas = () => measureSlide(idx, lim);
    const isInline = (e) => getComputedStyle(e).display === "inline";
    const groups = new Map(), walker = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode()); ) {
      if (!n.nodeValue.trim() || !n.parentElement || n.parentElement.closest("script,style,noscript,title,template,svg")) continue;
      let e = n.parentElement; while (e && e !== slide.parentElement && isInline(e)) e = e.parentElement;
      if (!e) continue;
      if (!groups.has(e)) groups.set(e, []);
      groups.get(e).push(n);
    }
    const out = [];
    const opacityOf = (el) => { let o = 1; for (let e = el; e && e !== slide.parentElement; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o; };
    const rotated = (el) => { for (let e = el; e && e !== slide.parentElement; e = e.parentElement) { const cs = getComputedStyle(e); if (/vertical|sideways/.test(cs.writingMode)) return true; const t = cs.transform; if (t && t !== "none") { const m = t.match(/matrix\(([^)]*)\)/); if (m) { const v = m[1].split(",").map(Number); if (Math.abs(v[1]) > 0.2 || Math.abs(v[2]) > 0.2) return true; } else return true; } } return false; };
    const rectsOf = (nodes) => nodes.flatMap((n) => { const r = document.createRange(); r.selectNodeContents(n); return [...r.getClientRects()].filter((x) => x.width > 1 && x.height > 1); });
    const baseline = meas(), baseClipped = new Set(baseline.clipped.map((x) => x.t)), baseOverlaps = new Set(baseline.overlaps.map((o) => `${o.a}|${o.b}`));
    for (const [E, nodes] of groups) {
      const idAttr = E.getAttribute("data-hce"); if (idAttr === null) continue;
      const cs = getComputedStyle(E), rects = rectsOf(nodes);
      const rec = { i: Number(idAttr), tag: E.tagName.toLowerCase(), slot: E.getAttribute("data-slot") || "" };
      if (!rects.length || cs.visibility === "hidden" || cs.display === "none") { out.push({ ...rec, skip: "not shown" }); continue; }
      const cm = cs.color.match(/^rgba?\(([^)]*)\)$/), parts = cm ? cm[1].split(/[,/]/).map((x) => x.trim()).filter(Boolean) : [], alpha = parts.length >= 4 ? parseFloat(parts[3]) : 1;
      rec.faint = opacityOf(E) < 0.4 || alpha < 0.4;   // the checks treat such text as decoration, so only the slide margins and the unit's box limit it
      if (rotated(E)) { out.push({ ...rec, skip: "turned" }); continue; }   // turned more than about 11 degrees (a small tilt measures like level text)
      const fs = parseFloat(cs.fontSize), lhRaw = parseFloat(cs.lineHeight), lh = Number.isFinite(lhRaw) ? lhRaw : rects[0].height;
      const tops = rects.map((r) => r.top).sort((a, b) => a - b); let Ls = 1; for (let k = 1; k < tops.length; k++) if (tops[k] - tops[k - 1] > lh * 0.5) Ls++;
      const fam = cs.fontFamily.split(",")[0].trim().replace(/^["']|["']$/g, "");
      const ls = parseFloat(cs.letterSpacing) || 0;
      Object.assign(rec, { fk: `${fam}|${cs.fontWeight}|${cs.fontStyle}`, fs, lh: +lh.toFixed(2), ls: +ls.toFixed(3), up: cs.textTransform === "uppercase", Ls });
      const clamp = parseInt(cs.webkitLineClamp, 10);
      rec.nw = /^(nowrap|pre)$/.test(cs.whiteSpace) || (Number.isFinite(clamp) && clamp === 1);
      if (Number.isFinite(clamp) && clamp > 1) rec.clamp = clamp;
      const n1 = nodes[0], orig = nodes.map((n) => n.nodeValue), inl = { ls: E.style.letterSpacing, ws: E.style.whiteSpace };
      const restore = () => { nodes.forEach((n, k) => { n.nodeValue = orig[k]; }); E.style.letterSpacing = inl.ls; E.style.whiteSpace = inl.ws; };
      // Words keep the margin the sample keeps to the slide's edges (at most 64px sideways and 40px up and down), as well as passing the checks.
      const sr = slide.getBoundingClientRect(), mx = Math.max(0, Math.min(64, Math.min(...rects.map((r) => r.left)) - sr.left, sr.right - Math.max(...rects.map((r) => r.right)))), my = Math.max(0, Math.min(40, Math.min(...rects.map((r) => r.top)) - sr.top, sr.bottom - Math.max(...rects.map((r) => r.bottom))));
      const inside = () => { const r = document.createRange(); r.selectNodeContents(n1); return [...r.getClientRects()].every((x) => x.left >= sr.left + mx - 0.5 && x.right <= sr.right - mx + 0.5 && x.top >= sr.top + my - 0.5 && x.bottom <= sr.bottom - my + 0.5); };
      // Bad when the probe breaks the margin, or anything on the slide is cut off or overlaps that was not already so in the sample (a longer paragraph pushes the labels below it off the slide).
      const bad = (probeText, bc = baseClipped, bo = baseOverlaps) => { const p = norm(probeText), m = meas(); return !inside() || m.clipped.some((x) => x.t === p || !bc.has(x.t)) || m.overlaps.some((o) => o.a === p || o.b === p || !bo.has(`${o.a}|${o.b}`)); };
      const widthOf = () => { const r = document.createRange(); r.selectNodeContents(n1); const rs = [...r.getClientRects()]; return rs.length ? Math.max(...rs.map((x) => x.right)) - Math.min(...rs.map((x) => x.left)) : 0; };
      const setWord = (k, lsPx) => { n1.nodeValue = "M".repeat(k); E.style.letterSpacing = `${lsPx}px`; return widthOf(); };
      // 1. The longest single word that fits one line.
      const wM = setWord(8, ls) / 8;
      // Setting the words short can itself move other text (a bottom-aligned block drops, a row re-spaces): what is already wrong with a short word is not the long word's doing.
      setWord(3, ls); const m0 = meas();
      const bc0 = new Set([...baseClipped, ...m0.clipped.map((x) => x.t)]), bo0 = new Set([...baseOverlaps, ...m0.overlaps.map((o) => `${o.a}|${o.b}`)]);
      let kLo = 0, kHi = 1;
      const ok = (k, l) => { setWord(k, l); return !bad("M".repeat(k), bc0, bo0); };
      if (wM > 0.5) {
        while (kHi < 400 && ok(kHi, ls)) { kLo = kHi; kHi *= 2; }
        if (kHi >= 400) kLo = 400;
        else while (kHi - kLo > 1) { const mid = (kLo + kHi) >> 1; if (ok(mid, ls)) kLo = mid; else kHi = mid; }
      }
      let W = kLo ? setWord(kLo, ls) : 0;
      if (kLo && kLo < 400) {   // between kLo and kLo + 1 letters: spread the letters of the longest word that fits
        let a = ls, b = ls + wM / kLo;
        for (let it = 0; it < 7; it++) { const mid = (a + b) / 2; if (ok(kLo, mid)) a = mid; else b = mid; }
        W = setWord(kLo, a);
      }
      // the unit's own box, when it does not grow with its words
      setWord(1, ls); const w1 = E.getBoundingClientRect().width; setWord(Math.max(1, Math.min(kLo, 40)), ls); const w2 = E.getBoundingClientRect().width;
      const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
      const boxFixed = Math.abs(w1 - w2) < 1 && !/inline/.test(cs.display);
      // A box that grows with its words (a flex item) still wraps at the width its container gives it: that is the line.
      let wrapW = 0;
      if (!/^(nowrap|pre)$/.test(cs.whiteSpace)) { n1.nodeValue = "a ".repeat(200); const ww = E.getBoundingClientRect().width - pad; if (ww > 20) wrapW = ww; }
      if (!kLo) W = wrapW;   // not even one letter passed the probe (it moved other text): take the line the container gives
      else if (boxFixed) W = Math.min(W, w1 - pad);
      else if (wrapW) W = Math.min(W, wrapW);
      E.style.letterSpacing = inl.ls;
      if (!(W > 0)) { restore(); out.push({ ...rec, skip: "no room" }); continue; }
      rec.W = +W.toFixed(1);
      // 2. The lines that can be added after the sample words.
      rec.Lx = 0;
      if (!rec.nw && !rec.clamp) {
        n1.nodeValue = orig[0]; E.style.whiteSpace = "pre-line";
        const wk = Math.max(1, Math.floor(0.6 * W / wM)), word = "M".repeat(wk);
        for (let k = 1; k <= 40; k++) { n1.nodeValue = orig[0] + ("\n" + word).repeat(k); if (bad(n1.nodeValue)) break; rec.Lx = k; }
      } else if (rec.clamp) rec.Lx = Math.max(0, rec.clamp - Ls);
      if (rec.faint) rec.Lx = Math.min(rec.Lx, Math.max(2, Ls));
      restore();
      out.push(rec);
    }
    return out;
  };

  const { browser, page, count } = await openDeck(P);
  const result = { version: FIT_VERSION, patterns: {} };
  const needKeys = new Set();
  try {
    const decks = JSON.parse(readFileSync(join(P, ".src/deck.json"), "utf8")).slides;
    for (let i = 0; i < count; i++) {
      if ((await goTo(page, i)) !== i) throw new Error(`${name}: slide ${i + 1} not reached`);
      await settle(page);
      const found = await page.evaluate(`(${probe})(${i}, ${JSON.stringify(LIMITS)}, ${measureSlide})`);
      const id = decks[i].id, pattern = decks[i].pattern, s = scan(sampleOf[id]), ids = new Set(found.map((r) => r.i));
      let u = 0; const units = [];
      for (const r of found) {
        const el = s.els[r.i];
        if (!el || el.tag !== r.tag) { console.error(`${name}/${pattern}: element ${r.i} is <${el && el.tag}> in the markup but <${r.tag}> in the page; unit dropped`); continue; }
        const t = flowOf(s, el, (e) => e.i !== el.i && ids.has(e.i)).join("\n");
        if (!t) continue;
        const unit = { u: u++, i: r.i, tag: r.tag, ...(r.slot ? { slot: r.slot } : {}), t };
        if (r.skip) unit.skip = r.skip; else { Object.assign(unit, { fk: r.fk, fs: r.fs, lh: r.lh, ls: r.ls, up: r.up, W: r.W, Ls: r.Ls, Lx: r.Lx, nw: r.nw }); if (r.clamp) unit.clamp = r.clamp; if (r.faint) unit.faint = true; needKeys.add(r.fk); }
        units.push(unit);
      }
      result.patterns[pattern] = { units };
    }
  } finally { await browser.close(); }
  const w = spawnSync("python3", [join(HERE, "build-text-fit-widths.py")], { input: JSON.stringify({ root: T, template: name, keys: [...needKeys].sort() }), encoding: "utf8", maxBuffer: 1 << 26 });
  if (w.status !== 0) throw new Error(`widths: ${w.stderr.slice(-400)}`);
  result.faces = JSON.parse(w.stdout).faces;
  writeFileSync(join(T, name, "fit.json"), JSON.stringify(result) + "\n");
  rmSync(tmp, { recursive: true, force: true });
  const n = Object.values(result.patterns).flatMap((p) => p.units), skipped = n.filter((x) => x.skip).length;
  console.log(`${name}: ${patterns.length} patterns, ${n.length} units, ${skipped} skipped`);
  process.exit(0);
}

// The parent: one child process for each template, JOBS at a time.
let next = 0, failed = 0;
const worker = async () => {
  for (;;) {
    const name = todo[next++]; if (!name) return;
    await new Promise((done) => {
      const c = spawn("node", [fileURLToPath(import.meta.url)], { env: { ...process.env, HC_FIT_CHILD: name }, stdio: ["ignore", "inherit", "inherit"] });
      c.on("exit", (code) => { if (code !== 0) { failed++; console.error(`${name}: failed (${code})`); } done(); });
    });
  }
};
await Promise.all(Array.from({ length: Math.max(1, JOBS) }, worker));
process.exit(failed ? 1 : 0);
