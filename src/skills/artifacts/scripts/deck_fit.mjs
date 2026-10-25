// Fitting the words of a slide into the boxes the template gives them. A module new_deck.mjs and make_deck.sh load; you don't run it.
//
// Each template folder holds fit.json (scripts/build-text-fit.mjs measures it in Chrome from the template's own sample slides): for each slide
// pattern, every "text unit" (a block of text, such as a title, a label or a paragraph, with the inline pieces inside it) with the room it has
// (the longest unbreakable word that fits its line, the lines it can hold) and the font it is set in, plus the advance width of every
// character of those fonts. fitSlide() takes a slide written from the sample and, for each unit whose words changed, sets the biggest
// font size (never more than the template's own, never less than a readable floor) at which the words fit; words that fit at no size
// are returned as problems with the length that does fit. No browser is needed.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.argv[1] && import.meta.url.endsWith("/" + process.argv[1].split("/").pop()) && process.argv.slice(2).some((x) => x === "--help" || x === "-h")) {
  const L = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n"), end = L.findIndex((l, i) => i > 0 && !l.startsWith("//"));
  process.stdout.write(L.slice(1, end).map((l) => l.replace(/^\/\/ ?/, "")).join("\n") + "\nnode deck_fit.mjs --explain <project> \"<failure text>\"   names the field to shorten for a slide make_deck.sh found cut off\n"); process.exit(0);
}

export const FIT_VERSION = 1;
const NAMED = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", middot: "·", hellip: "…", times: "×", copy: "©", bull: "•", rarr: "→", larr: "←", laquo: "«", raquo: "»", deg: "°", euro: "€" };
export const unesc = (t) => t.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, d, h, n) => d ? String.fromCodePoint(Number(d)) : h ? String.fromCodePoint(parseInt(h, 16)) : (NAMED[n.toLowerCase()] ?? m));

const VOID = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
const RAW = new Set(["script", "style", "textarea", "title", "template", "noscript"]);

// Reads the markup of one slide into elements (in source order, the same order the probe numbers them) and the text between them.
// The inside of script, style and svg elements is skipped. Element i: { i, tag, os, oe (the open tag is html.slice(os, oe)), attrs, ev0, ev1 }.
export function scan(html) {
  const els = [], events = [], stack = [];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
  let last = 0, m;
  const text = (to) => { if (to > last) events.push({ t: "text", text: html.slice(last, to) }); };
  while ((m = re.exec(html))) {
    if (m[0].startsWith("<!--")) continue;
    text(m.index); last = m.index + m[0].length;
    const close = m[1] === "/", tag = m[2].toLowerCase();
    if (close) {
      let k = stack.length - 1; while (k >= 0 && els[stack[k]].tag !== tag) k--;
      if (k < 0) continue;
      while (stack.length > k) { const e = els[stack.pop()]; e.ev1 = events.length; events.push({ t: "close", el: e.i }); }
      continue;
    }
    const el = { i: els.length, tag, os: m.index, oe: m.index + m[0].length, attrs: m[3], ev0: events.length, ev1: -1 };
    els.push(el); events.push({ t: "open", el: el.i });
    if (VOID.has(tag) || /\/\s*$/.test(m[3])) { el.ev1 = events.length; events.push({ t: "close", el: el.i }); continue; }
    if (RAW.has(tag) || tag === "svg") {   // its inside is not text of the slide
      let depth = 1, n; const open = new RegExp(`<${tag}[\\s>]|</${tag}\\s*>`, "gi"); open.lastIndex = re.lastIndex;
      while ((n = open.exec(html))) { if (n[0][1] === "/") { if (--depth === 0) break; } else depth++; }
      const stop = n ? n.index + n[0].length : html.length;
      re.lastIndex = stop; last = stop; el.ev1 = events.length; events.push({ t: "close", el: el.i });
      continue;
    }
    stack.push(el.i);
  }
  text(html.length);
  while (stack.length) { const e = els[stack.pop()]; e.ev1 = events.length; events.push({ t: "close", el: e.i }); }
  return { html, els, events };
}

const attrOf = (el, name) => (el.attrs.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`)) || [])[1];

// Adds data-hce="<element number>" to every element's open tag (the probe loads the result, so its measurements name the elements).
export function numberElements(html) {
  const s = scan(html); let out = html;
  for (let k = s.els.length - 1; k >= 0; k--) { const e = s.els[k]; const at = e.os + 1 + e.tag.length; out = out.slice(0, at) + ` data-hce="${e.i}"` + out.slice(at); }
  return out;
}
// Adds data-hcu="<unit id>" to the open tag of each unit ({ i: element number, u: unit id }).
export function markUnits(html, units) {
  const s = scan(html); let out = html;
  // The attribute goes last in the open tag: new_deck's patterns for a slot look for data-slot straight after the tag name.
  for (const u of [...units].sort((a, b) => b.i - a.i)) { const e = s.els[u.i]; if (!e) continue; const at = e.oe - 1 - (/\/\s*$/.test(e.attrs) ? 1 : 0); out = out.slice(0, at) + ` data-hcu="${u.u}"` + out.slice(at); }
  return out;
}

// The words of an element as lines: text and inline pieces in order, a <br> starts a line, text of a nested unit (an element carrying data-hcu) is left out.
export function flowOf(s, el, isUnit = (e) => /(?:^|\s)data-hcu="/.test(e.attrs)) {
  let cur = "", lines = [];
  for (let k = el.ev0 + 1; k < el.ev1; k++) {
    const ev = s.events[k];
    if (ev.t === "text") cur += unesc(ev.text);
    else if (ev.t === "open") {
      const e = s.els[ev.el];
      if (e.tag === "br") { lines.push(cur); cur = ""; }
      else if (isUnit(e)) k = e.ev1;
      else if (e.tag === "script" || e.tag === "style" || e.tag === "svg") k = e.ev1;
    }
  }
  lines.push(cur);
  return lines.map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
}

// ---- measuring words -------------------------------------------------------------------------------------------------------------------
// m: { w: {char: em}, fb: em of a character the font lacks, ls: letter spacing in px at the unit's own size, up: capitals }.
export function textWidth(text, px, m) {
  const t = m.up ? text.toUpperCase() : text, w = m.w; let a = 0;
  for (const c of t) a += (w[c] ?? w[c.toLowerCase()] ?? m.fb) * px + (m.ls || 0) * px / m.fs;
  return a * 1.03;   // 3% to spare: kerning only narrows text, but Chrome and the table can differ a little
}
// Greedy wrapping like a browser: at spaces, and after a hyphen. A non-breaking space joins its words.
export function wrap(text, px, width, m) {
  const words = text.split(" "); let lines = 1, cur = 0, widest = 0;
  const sp = textWidth(" ", px, m);
  for (const word of words) {
    const parts = word.split(/(?<=-)(?=.)/);
    for (let k = 0; k < parts.length; k++) {
      const pw = textWidth(parts[k], px, m); widest = Math.max(widest, pw);
      const gap = cur && k === 0 ? sp : 0;
      if (cur && cur + gap + pw > width) { lines++; cur = pw; } else cur += gap + pw;
    }
  }
  return { lines, widest };
}
export const floorFor = (fs) => fs <= 16 ? Math.min(fs, Math.max(12, Math.round(fs * 0.8))) : Math.max(16, Math.round(fs * 0.55));

// Biggest size (px, whole numbers; at most the unit's own) at which the lines fit the unit's room, or null. softCap limits how many lines a size may use.
export function bestSize(lines, rec, m, softCap = Infinity) {
  const room = rec.Ls + rec.Lx, width = rec.W, floor = floorFor(rec.fs);
  for (let s = rec.fs; s >= floor; s -= Math.max(1, Math.round(rec.fs * 0.02))) {
    let total = 0, ok = true;
    for (const seg of lines) {
      const r = wrap(seg, s, width, { ...m, fs: rec.fs });
      if (r.widest > width) { ok = false; break; }
      total += rec.nw ? (r.lines > 1 ? 99 : 1) : r.lines;
    }
    if (!ok) continue;
    if (total <= Math.min(softCap, Math.floor(room * rec.fs / s + 1e-6))) return s;
  }
  return null;
}
// What the lines are at size s: the most words that fit, for a message that says how long the text may be.
function fits(text, rec, m) { return bestSize([text], rec, m) !== null; }
export function longestFit(text, rec, m) {
  const words = text.split(" "); let best = "";
  for (let n = 1; n <= words.length; n++) { const t = words.slice(0, n).join(" "); if (fits(t, rec, m)) best = t; else break; }
  if (best) return best;
  let n = Math.min(text.length, 60); while (n > 1 && !fits(text.slice(0, n), rec, m)) n--;
  return text.slice(0, n);
}

// ---- the template's table ----------------------------------------------------------------------------------------------------------------
const tables = new Map();
export function loadFit(root, template) {
  const f = join(root, template, "fit.json");
  if (!tables.has(f)) { let j = null; try { j = JSON.parse(readFileSync(f, "utf8")); } catch { /* an old template folder has none */ } tables.set(f, j && j.version === FIT_VERSION ? j : null); }
  return tables.get(f);
}
export const unitsOf = (fit, pattern) => fit?.patterns?.[pattern]?.units || [];
const modelOf = (fit, rec) => { const face = fit.faces[rec.fk]; return face ? { w: face.w, fb: face.fb, ls: rec.ls, up: rec.up, fs: rec.fs } : null; };

// The style that sets a unit at a size: the font size, the template's line height as a ratio, and the letter spacing in proportion.
export const sizeDecl = (rec, size) => `font-size:${size}px;line-height:${+(rec.lh / rec.fs).toFixed(3)};` + (rec.ls ? `letter-spacing:${+(rec.ls * size / rec.fs).toFixed(2)}px;` : "");
// An open tag with those declarations last in its style (any font size, line height and letter spacing it had are dropped).
export function withStyle(open, decl) {
  if (/\sstyle="/.test(open)) return open.replace(/(\sstyle=")([^"]*)(")/, (x, a, v, c) => a + v.replace(/(?:^|;)\s*(?:font-size|line-height|letter-spacing)\s*:[^;]*/gi, "").replace(/;+\s*$/, "").replace(/^;/, "") + (v.trim() ? ";" : "") + decl.replace(/;$/, "") + ";" + c);
  return open.replace(/^<([a-zA-Z][\w:-]*)/, `<$1 style="${decl}"`);
}
// Fits the words of one slide. `html` was written from the pattern's sample with markUnits() applied before the words went in.
// -> { html, changed: [{ u, from, to }], problems: [{ u, slot, text, fix, chars }] }; the html has no data-hcu left in it.
export function fitSlide(html, fit, pattern, { skip = (rec) => false } = {}) {
  const units = unitsOf(fit, pattern), byId = new Map(units.map((r) => [String(r.u), r]));
  const s = scan(html), edits = [], changed = [], problems = [];
  for (const el of s.els) {
    const id = attrOf(el, "data-hcu"); if (id === undefined) continue;
    const rec = byId.get(id), m = rec && modelOf(fit, rec);
    if (rec && m && !rec.skip && !skip(rec, el)) {
      const lines = flowOf(s, el), now = lines.join("\n");
      if (now && now !== rec.t) {
        const soft = Math.max(rec.Ls + 2, 3), caption = rec.fs < 12 && lines.some((l) => l.length >= 40);
        const size = caption ? null : bestSize(lines, rec, m, soft) ?? bestSize(lines, rec, m);
        if (caption) {   // the checks refuse running text (40 or more characters) under 12px, and the template sets this one smaller
          const whole = lines.join(" ");
          problems.push({ u: rec.u, slot: attrOf(el, "data-slot") || "", text: whole, kind: "caption", size: rec.fs, fix: whole.slice(0, 39).replace(/\s+\S*$/, "") });
        } else if (size === null) {
          const whole = lines.join(" "), fix = longestFit(whole, rec, m);
          const fl = floorFor(rec.fs), words = whole.split(" "), wide = words.reduce((a, w) => (textWidth(w, fl, m) > textWidth(a, fl, m) ? w : a), "");
          const widest = textWidth(wide, fl, m), tooWide = widest > rec.W;
          problems.push({ u: rec.u, slot: attrOf(el, "data-slot") || "", text: whole, kind: tooWide ? "word" : "lines", fix, floor: fl, width: rec.W, ...(tooWide ? { word: wide, letters: Math.max(1, Math.floor(wide.length * rec.W / widest)) } : {}) });
        } else if (size < rec.fs) {
          changed.push({ u: rec.u, from: rec.fs, to: size });
          edits.push({ el, decl: sizeDecl(rec, size) });
        }
      }
    }
  }
  // Rewrite open tags from the end: drop data-hcu everywhere, and set the sizes that changed.
  let out = html;
  const all = s.els.filter((e) => attrOf(e, "data-hcu") !== undefined);
  for (const el of all.sort((a, b) => b.os - a.os)) {
    let open = out.slice(el.os, el.oe).replace(/\sdata-hcu="[^"]*"/, "");
    const ed = edits.find((e) => e.el === el);
    if (ed) open = withStyle(open, ed.decl);
    out = out.slice(0, el.os) + open + out.slice(el.oe);
  }
  return { html: out, changed, problems };
}

// ---- naming the fix for a slide make_deck.sh found cut off --------------------------------------------------------------------------------
// explain(project, failure) -> a sentence that says which field of which slide to shorten, to about how many characters, and where, or "" when the words are not found.
// failure is make_deck's text: slide 29 (29-media): text is cut off or outside the slide: "Infrastructure", "now managed"
export function explain(project, failure) {
  const src = join(project, ".src");
  const j = (f) => { try { return JSON.parse(readFileSync(join(src, f), "utf8")); } catch { return null; } };
  const deck = j("deck.json"), build = j("data_build.json"), data = build?.data ? (() => { try { return JSON.parse(readFileSync(build.data, "utf8")); } catch { return null; } })() : null;
  const m = String(failure).match(/slide (\d+) \(([^)]+)\)[^"]*"([^"]+)"/); if (!deck || !m) return "";
  const n = Number(m[1]), id = m[2], quoted = [...String(failure).slice(failure.indexOf(m[0])).matchAll(/"([^"]+)"/g)].map((x) => x[1].replace(/\s+/g, " ").trim());
  const entry = deck.slides.find((s) => s.id === id), pattern = entry?.pattern || id.replace(/^\d+-/, "");
  let html; try { html = readFileSync(join(src, "slides", `${id}.html`), "utf8"); } catch { return ""; }
  const fit = loadFit(join(src, "template"), deck.template) || loadFit(join(project, ".src", "template"), deck.template);
  const text = quoted[0];
  // The data file's own field that holds these words.
  let where = "", field = "";
  const dataEntry = data?.slides?.[n - 1];
  if (dataEntry) {
    for (const [k, v] of Object.entries(dataEntry)) if (typeof v === "string" && v.replace(/\s+/g, " ").includes(text)) { field = k; where = `"${k}"`; }
    if (!field && Array.isArray(dataEntry.text)) { const k = dataEntry.text.findIndex((x) => String(x).replace(/\s+/g, " ").includes(text)); if (k >= 0) where = `"text" string number ${k + 1}`; }
  }
  // How long it can be: the room of the block of text that holds these words.
  let room = "";
  if (fit) {
    const s = scan(html), units = unitsOf(fit, pattern), rec = units.find((u) => { const el = s.els[u.i]; return el && !u.skip && flowOf(s, el, (e) => units.some((x) => x.i === e.i && x.i !== el.i)).join(" ").includes(text); });
    if (rec && fit.faces[rec.fk]) {
      const mm = modelOf(fit, rec), whole = flowOf(s, s.els[rec.i], (e) => units.some((x) => x.i === e.i && x.i !== rec.i)).join(" "), fix = longestFit(whole, rec, mm);
      room = ` The box holds about ${fix.length} characters at its smallest readable size (${floorFor(rec.fs)}px), for example "${fix}".`;
    }
  }
  const where2 = where ? `in the entry for slide ${n} of ${build.data}, ${where}` : `in .src/slides/${id}.html`;
  return `slide ${n} (the "${pattern}" pattern): "${text}"${quoted.length > 1 ? ` and ${quoted.length - 1} more` : ""} is cut off.${room} Fix: ${where2}, shorten that text${room ? " to fit" : " (a long single word is the usual cause: use a shorter word)"}, or move the detail to "notes".`;
}

// node deck_fit.mjs --explain <project> "<failure text>"
if (process.argv[1] && import.meta.url.endsWith("/" + process.argv[1].split("/").pop()) && process.argv[2] === "--explain") process.stdout.write(explain(process.argv[3], process.argv[4]) + "\n");
