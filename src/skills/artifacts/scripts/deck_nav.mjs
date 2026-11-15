// Opening a built deck in Chrome and moving through its slides, shared by deck_check.mjs and export_pptx.mjs. A module the
// scripts load; you don't run it.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadBrowserRuntime } from "./browser_runtime.mjs";
import { shownSlide } from "./deck_checks.mjs";

if (process.argv[1] && import.meta.url.endsWith("/" + process.argv[1].split("/").pop()) && process.argv.slice(2).some((a) => a === "--help" || a === "-h")) {
  const HELP = (await import("node:fs")).readFileSync(new URL(import.meta.url), "utf8").split("\n"), end = HELP.findIndex((l, i) => i > 0 && !l.startsWith("//"));
  process.stdout.write(HELP.slice(HELP[0].startsWith("#!") ? 1 : 0, end).map((l) => l.replace(/^\/\/ ?/, "")).join("\n") + "\n"); process.exit(0);
}

// Launches Chrome and opens <project>/.src/build/deck.html (the template's own document) at 1920x1080. Only that file, and data:
// and blob: URLs, may load; anything else is refused and listed in `outside`. Returns { browser, ctx, page, count, outside, errors }.
export async function openDeck(project, extraAllowed = []) {
  const inner = join(project, ".src", "build", "deck.html");
  const { audit, playwright, executablePath } = await loadBrowserRuntime();
  const browser = await playwright.chromium.launch(audit.buildLaunchOptions(executablePath));
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, acceptDownloads: false });
  const outside = new Set(), errors = [], allowed = new Set([pathToFileURL(inner).href, ...extraAllowed.map((p) => pathToFileURL(p).href)]);
  await ctx.route("**/*", (route) => {
    const u = route.request().url();
    if (allowed.has(u) || u.startsWith("data:") || u.startsWith("blob:") || u === "about:srcdoc") return route.continue();
    outside.add(u.slice(0, 100)); return route.abort();
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 120)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 120)); });
  await page.goto(pathToFileURL(inner).href, { waitUntil: "load" });
  await page.evaluate("document.fonts.ready");
  const count = await page.evaluate("document.querySelectorAll('[data-hc-slide]').length");
  await settle(page, 3500);
  return { browser, ctx, page, count, outside, errors };
}

// Moves to slide i (0-based) with the right arrow key, as a person would, and lets its animations finish. Returns the slide shown
// afterwards (i when it worked; a slide past i when one press moved more than one).
export async function goTo(page, i, { quick = false } = {}) {
  if (i === 0) return page.evaluate(`(${shownSlide})()`);
  let at = await page.evaluate(`(${shownSlide})()`);
  for (let tries = 0; at < i && tries < 3; tries++) {
    const before = at;
    await page.keyboard.press("ArrowRight");
    // Wait for the slide shown to change (up to 4 s: a slow transition or a computer busy printing is not "did not move"), then until the slide stops moving.
    // Nothing is pressed again before that: a second press while the first is still moving the deck would skip a slide.
    await page.waitForFunction(`(${shownSlide})() !== ${before}`, null, { polling: "raf", timeout: 4000 }).catch(() => {});
    // Finish the animations that end (a template's slide transition takes about half a second of a deck of 40 slides' time): the slide is then in the state it settles to.
    await finishAnimations(page);
    await (quick ? settle(page, 1500, 4) : settle(page));
    at = await page.evaluate(`(${shownSlide})()`);
  }
  return at;
}

// Jumps the animations that have an end to that end. Ones that loop forever are left alone (settle ignores them too).
export async function finishAnimations(page) {
  await page.evaluate(() => { for (const a of document.getAnimations()) { try { if (a.effect && Number.isFinite(a.effect.getComputedTiming().endTime)) a.finish(); } catch {} } }).catch(() => {});
}

// Moves forward to slide i from wherever the deck is, one key press at a time (the slides in between get a short look only). Returns the slide shown.
export async function goToFar(page, i) {
  let at = await page.evaluate(`(${shownSlide})()`);
  while (at >= 0 && at < i) { const next = await goTo(page, at + 1, { quick: at + 1 < i }); if (next === at) break; at = next; }
  return at;
}

// Waits until the slide shown has stopped changing: its entrance animations and transitions have finished (the ones that end; a decoration that
// loops forever is ignored), and for `frames` frames in a row (about 15 ms each) the shown slide and the position, opacity and transform of everything in it are the same,
// which also covers a script that starts a change on a timer a moment after the slide appears. A slide with a canvas (a chart that draws itself) gets
// extra time to finish drawing. Waits at most maxMs.
export async function settle(page, maxMs = 2800, frames = 10) {
  const impl = (shown, maxMs, frames) => new Promise((resolve) => {
    const t0 = performance.now(), sig = () => {
      const idx = shown(), list = document.querySelectorAll("[data-hc-slide]"), el = list[idx];
      if (!el) return `none:${idx}`;
      const parts = [idx];
      let n = 0;
      for (const e of [el, ...el.querySelectorAll("*")]) {
        if (++n > 500) break;
        const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
        parts.push(`${Math.round(r.left * 4)},${Math.round(r.top * 4)},${Math.round(r.width * 4)},${Math.round(r.height * 4)},${cs.opacity},${cs.transform}`);
      }
      return parts.join("|");
    };
    let last = "", same = 0;
    const tick = () => {
      const running = document.getAnimations().some((a) => a.effect && Number.isFinite(a.effect.getComputedTiming().endTime) && a.playState === "running");
      const s = sig();
      same = !running && s === last ? same + 1 : 0; last = s;
      if (same >= frames || performance.now() - t0 > maxMs) {
        const idx = shown(), el = document.querySelectorAll("[data-hc-slide]")[idx];
        resolve(!!el && !!el.querySelector("canvas"));
      } else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const hasCanvas = await page.evaluate(`(${impl})(${shownSlide}, ${maxMs}, ${frames})`).catch(() => false);
  if (hasCanvas) await page.waitForTimeout(1200);
}

// Hides everything a template draws for moving through the deck on screen (the arrow-key hint, slide counter, progress bar, dots, arrow
// buttons, controls), in any template, so a PDF page shows the slide only. A slide's own page number is inside the slide and stays.
// An element outside the slides counts as navigation when its class or id names it (nav, counter, hint, progress, dots, arrows,
// controls, prev, next, pager), when it is a button or a nav, or when it is fixed on the screen and its words are about keys or
// read like "3 / 14". Looks inside shadow roots too. Returns a function that shows them again (the screen keeps working with keys).
export async function hideNavigation(page) {
  const n = await page.evaluate(() => {
    const NAME = /(^|[^a-z])(nav|navigation|counter|hint|hints|progress|pager|pagination|dots?|arrows?|controls?|prev|next|keys|slide-?num(ber)?|page-?num(ber)?|indicator)([^a-z]|$)/i;
    const WORDS = /arrow keys?|\bnavigate\b|keyboard|press\s+(space|any|the|f|n)\b|[←→]\s*(\/|and|or)?\s*[←→]?|\bspace\b.*\bnext\b|^\s*\d{1,3}\s*\/\s*\d{1,3}\s*$/i;
    let style = document.getElementById("hc-hide-nav");
    const inSlide = (el) => !!el.closest("[data-hc-slide]");
    const roots = [document];
    for (const el of document.querySelectorAll("*")) if (el.shadowRoot) roots.push(el.shadowRoot);
    let n = 0;
    for (const root of roots) {
      for (const el of root.querySelectorAll("body *, :host > *")) {
        if (/^(SCRIPT|STYLE|LINK|META|SVG|PATH|G|DEFS|USE|SLOT|IMG|PICTURE|VIDEO|CANVAS)$/i.test(el.tagName) || el.closest("svg")) continue;
        if (inSlide(el) || el.querySelector("[data-hc-slide]") || el.hasAttribute("data-hc-slide")) continue;
        if (el.tagName === "DECK-STAGE" || /^(HTML|BODY|HEAD)$/.test(el.tagName)) continue;
        if (el.hasAttribute("data-hc-nav") || el.closest("[data-hc-nav]")) continue;
        const cs = getComputedStyle(el);
        if (cs.display === "none") continue;
        const fixed = cs.position === "fixed" || cs.position === "sticky";
        const text = (el.textContent || "").trim();
        const label = `${el.id || ""} ${typeof el.className === "string" ? el.className : ""} ${el.getAttribute("aria-label") || ""}`;
        const isNav = NAME.test(label) || el.tagName === "NAV" || el.tagName === "BUTTON" || el.getAttribute("role") === "button" || (fixed && (WORDS.test(text) && text.length < 80 || !!el.querySelector("button")));
        if (isNav) { el.setAttribute("data-hc-nav", ""); n++; }
      }
    }
    if (!style) { style = document.createElement("style"); style.id = "hc-hide-nav"; style.textContent = "[data-hc-nav]{display:none!important}"; document.head.appendChild(style); }
    for (const root of roots) if (root !== document && !root.getElementById?.("hc-hide-nav")) { const st = document.createElement("style"); st.id = "hc-hide-nav"; st.textContent = "[data-hc-nav]{display:none!important}"; root.appendChild(st); }
    return n;
  });
  return async () => {
    await page.evaluate(() => {
      const roots = [document];
      for (const el of document.querySelectorAll("*")) if (el.shadowRoot) roots.push(el.shadowRoot);
      for (const root of roots) { root.querySelectorAll("[data-hc-nav]").forEach((e) => e.removeAttribute("data-hc-nav")); root.querySelectorAll("#hc-hide-nav").forEach((e) => e.remove()); }
    });
  };
}
