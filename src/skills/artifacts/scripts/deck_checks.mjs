// The rules deck_check.mjs applies to a slide: the measurements taken inside the page (measureSlide, run in Chrome) and the
// judgements made on them (judgeSlide and the text checks, plain functions). Kept apart from the browser driver so the rules can
// be tested without a browser. A module the scripts load; you don't run it.

if (process.argv[1] && import.meta.url.endsWith("/" + process.argv[1].split("/").pop()) && process.argv.slice(2).some((a) => a === "--help" || a === "-h")) {
  const HELP = (await import("node:fs")).readFileSync(new URL(import.meta.url), "utf8").split("\n"), end = HELP.findIndex((l, i) => i > 0 && !l.startsWith("//"));
  process.stdout.write(HELP.slice(HELP[0].startsWith("#!") ? 1 : 0, end).map((l) => l.replace(/^\/\/ ?/, "")).join("\n") + "\n"); process.exit(0);
}

export const LIMITS = {
  minTextPx: 9,         // no visible text smaller than this on the 1920x1080 stage
  minBodyPx: 12,        // running text (a paragraph or list item of 40+ characters) at least this
  comfortPx: 16,        // running text under this is reported as a note: the template's own small type, or text made smaller to fit
  clipSlackPx: 2,       // how far text may stick out of its box before it counts as clipped
  overlapShare: 0.25,   // two lines of text overlap when this share of the smaller one's letter area is covered
  maxEdgeNote: 6,
};

const PLACEHOLDER = [
  [/lorem ipsum|\bdolor sit\b/i, "lorem ipsum"],
  [/\b(TBD|TODO|FILL IN|XXX)\b/, "a TBD, TODO, FILL IN or XXX marker"],
  [/\bplaceholder\b/i, "the word placeholder"],
  [/\[[A-Za-z][^\]\n]{2,45}\]/, "a [bracketed] placeholder"],
  [/\btemplate\b/i, "the word template"],
  [/\b(replace freely|your (?:name|title|text|logo|company) here)\b/i, "sample instructions"],
];

export const MEDIA_BOX = "screenshot or gif goes here";
const norm = (s) => String(s).replace(/\s+/g, " ").trim().toLowerCase();
const wordsOf = (s) => norm(s).split(" ").filter(Boolean).length;

// Text segments of a template's sample slides: the strings that must not survive into a finished deck.
export function sampleSegments(slideHtmls) {
  const out = new Set();
  for (const html of slideHtmls) {
    const body = html.replace(/<(script|style|svg)[\s\S]*?<\/\1>/gi, "<br>").replace(/<!--[\s\S]*?-->/g, "");
    for (const seg of body.split(/<[^>]*>/)) {
      const t = norm(seg.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#?\w+;/g, " "));
      if (t.length >= 14 && wordsOf(t) >= 2) out.add(t);
    }
  }
  out.delete(MEDIA_BOX);   // the label of an empty picture box is meant to stay
  return out;
}

// Placeholder and sample text in one slide's text lines. samples: the Set from sampleSegments (or null to skip that rule).
export function textProblems(lines, samples) {
  const found = [];
  for (const line of lines) {
    for (const [re, what] of PLACEHOLDER) if (re.test(line)) { found.push(`${what}: "${line.slice(0, 60)}"`); break; }
    if (samples && samples.has(norm(line))) found.push(`unchanged template text: "${line.slice(0, 60)}"`);
  }
  return [...new Set(found)];
}

// m: what measureSlide returned for one slide. Returns { fail: [...], note: [...] } as short sentences.
export function judgeSlide(m, limits = LIMITS) {
  const fail = [], note = [];
  const list = (a, n = 3) => a.slice(0, n).map((x) => `"${x.t.slice(0, 40)}"`).join(", ") + (a.length > n ? ` and ${a.length - n} more` : "");
  if (m.clipped.length) fail.push(`text is cut off or outside the slide: ${list(m.clipped)}`);
  if (m.overlaps.length) fail.push(`text overlaps other text: ${m.overlaps.slice(0, 3).map((o) => `"${o.a.slice(0, 30)}" over "${o.b.slice(0, 30)}"`).join(", ")}`);
  const tiny = m.texts.filter((x) => x.fs < limits.minTextPx);
  if (tiny.length) fail.push(`text under ${limits.minTextPx}px: ${list(tiny)}`);
  const small = m.texts.filter((x) => x.fs >= limits.minTextPx && x.fs < limits.minBodyPx && x.t.length >= 40);
  if (small.length) fail.push(`running text under ${limits.minBodyPx}px: ${list(small)}`);
  const snug = m.texts.filter((x) => x.fs >= limits.minBodyPx && x.fs < limits.comfortPx && x.t.length >= 40);
  if (snug.length) note.push(`running text is ${Math.min(...snug.map((x) => Math.round(x.fs)))}px on the 1920x1080 stage: ${list(snug, 2)}. Fine for the template's own style; cut words rather than shrink`);
  if (m.brokenImages.length) fail.push(`pictures that did not load: ${m.brokenImages.slice(0, 3).join(", ")}`);
  if (m.emptyBoxes.length) fail.push(`empty picture boxes (a placeholder with no picture): ${m.emptyBoxes.slice(0, 3).join(", ")}`);
  if (!m.texts.length && !m.imageCount) fail.push("the slide shows no text and no picture");
  return { fail, note };
}

// The code that runs inside the page. Returns what judgeSlide reads. Everything is measured in the page's own pixels, relative to the
// slide's box, so a template that slides a strip of slides sideways measures the same as one that stacks them.
export function measureSlide(index, limits) {
  const slide = document.querySelectorAll("[data-hc-slide]")[index];
  const sr = slide.getBoundingClientRect();
  const out = { texts: [], clipped: [], overlaps: [], brokenImages: [], emptyBoxes: [], imageCount: 0 };
  const lines = [];
  const clips = (el) => { const cs = getComputedStyle(el); return /(hidden|clip|auto|scroll)/.test(cs.overflowX + cs.overflowY) ? cs : null; };
  const effectiveOpacity = (el) => { let o = 1; for (let e = el; e && e !== slide.parentElement; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o; };
  const w = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode()); ) {
    const t = n.nodeValue.replace(/\s+/g, " ").trim();
    const el = n.parentElement;
    if (!t || !el || el.closest("script,style,noscript,title,template")) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || effectiveOpacity(el) < 0.05) continue;
    // The alpha of the text colour: the fourth number of rgba(r, g, b, a) or the number after the slash of rgb(r g b / a); a colour with no alpha is opaque.
    const cm = cs.color.match(/^rgba?\(([^)]*)\)$/), parts = cm ? cm[1].split(/[,/]/).map((x) => x.trim()).filter(Boolean) : [], alpha = parts.length >= 4 ? parseFloat(parts[3]) : 1;
    const fs0 = parseFloat(cs.fontSize);
    // A faint or huge one-to-three character glyph (a ghost numeral, a quote mark) is decoration and may bleed off the slide.
    const decorative = effectiveOpacity(el) < 0.4 || parseFloat(alpha) < 0.4 || (t.length <= 3 && fs0 >= 100);
    // Text that scrolls past for ever (a marquee, a ticker) is partly outside its window and the slide at any moment, and is meant to be: it is not cut off.
    let moving = false;
    for (let a = el; a && a !== slide.parentElement && !moving; a = a.parentElement) moving = a.getAnimations().some((an) => an.effect && an.effect.getComputedTiming().iterations === Infinity && Object.keys(an.effect.getKeyframes()[0] || {}).some((k) => /^(transform|translate|left|margin)/i.test(k)));
    const range = document.createRange(); range.selectNodeContents(n);
    const rects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
    if (!rects.length) continue;
    const fs = parseFloat(cs.fontSize);
    out.texts.push({ t, fs, tag: el.tagName.toLowerCase() });
    if (!decorative && !moving) for (const r of rects) { const h = Math.min(r.height, fs * 0.72), mid = r.top + r.height / 2; lines.push({ t, el, r: { left: r.left, right: r.right, top: mid - h / 2, bottom: mid + h / 2, width: r.width, height: h }, fs }); }
    // clipped: outside the slide, or outside a box that clips
    let bad = false;
    const u = rects.reduce((a, r) => ({ left: Math.min(a.left, r.left), top: Math.min(a.top, r.top), right: Math.max(a.right, r.right), bottom: Math.max(a.bottom, r.bottom) }), { left: 1e9, top: 1e9, right: -1e9, bottom: -1e9 });
    const k = limits.clipSlackPx;
    if (u.left < sr.left - k || u.right > sr.right + k || u.top < sr.top - k || u.bottom > sr.bottom + k) bad = true;
    for (let a = el; a && a !== slide && !bad; a = a.parentElement) {
      const c = clips(a);
      if (!c) continue;
      const ar = a.getBoundingClientRect();
      const x = /(hidden|clip|auto|scroll)/.test(c.overflowX), y = /(hidden|clip|auto|scroll)/.test(c.overflowY);
      if ((x && (u.left < ar.left - k || u.right > ar.right + k)) || (y && (u.top < ar.top - k || u.bottom > ar.bottom + k))) bad = true;
    }
    // spilling out of a fixed-width column (a long figure on a slide that has a picture box beside it) is cut off too
    for (let a = el; a && a !== slide && !bad; a = a.parentElement) {
      if (!/^\d+(\.\d+)?px$/.test(a.style.width || "")) continue;
      const ar = a.getBoundingClientRect();
      if (u.right > ar.right + k || u.left < ar.left - k) bad = true;
    }
    if (bad && !decorative && !moving) out.clipped.push({ t });
  }
  // overlap: two lines from elements that don't contain each other
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i], b = lines[j];
      if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const ix = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), iy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (ix <= 8 || iy <= 0) continue;
      const small = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
      if (ix * iy > limits.overlapShare * small) out.overlaps.push({ a: a.t, b: b.t });
    }
  }
  for (const img of slide.querySelectorAll("img")) {
    const cs = getComputedStyle(img);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    out.imageCount++;
    if (!img.complete || img.naturalWidth === 0) out.brokenImages.push((img.getAttribute("src") || "").slice(0, 40) || "an image");
  }
  for (const el of slide.querySelectorAll("*")) {
    const cs = getComputedStyle(el);
    if (cs.backgroundImage && /url\(/.test(cs.backgroundImage)) {
      out.imageCount++;
      if (!/url\(["']?data:/.test(cs.backgroundImage)) out.brokenImages.push(cs.backgroundImage.slice(0, 50));
    }
    if (/placeholder/i.test(el.className && el.className.baseVal === undefined ? el.className : "") && !el.querySelector("img,video,canvas,svg")) {
      const r = el.getBoundingClientRect();
      if (r.width > 40 && r.height > 40) out.emptyBoxes.push(String(el.className).slice(0, 30));
    }
  }
  out.canvasCount = slide.querySelectorAll("canvas,svg").length;
  return out;
}

// The visible slide, the same rule the shell uses.
export function shownSlide() {
  const list = document.querySelectorAll("[data-hc-slide]");
  let best = -1, area = 0;
  for (let i = 0; i < list.length; i++) {
    const cs = getComputedStyle(list[i]);
    if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.5) continue;
    const r = list[i].getBoundingClientRect();
    const a = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    if (a > area) { area = a; best = i; }
  }
  return best;
}
