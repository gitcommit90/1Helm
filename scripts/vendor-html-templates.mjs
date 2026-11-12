#!/usr/bin/env node
// Vendors the 34 decks of https://github.com/zarazhangrui/beautiful-html-templates (MIT) into
// app-assets/deck-templates/, in the shape new_deck.mjs and assemble_deck.mjs read. A developer tool, not shipped to
// the computer. It needs network access for the font files.
//
//   node scripts/vendor-html-templates.mjs <path of a checkout of beautiful-html-templates> [--only name,name]
//
// For each template it writes templates/<name>/head.html (everything before the first slide, with the font links replaced by a
// marker), slides/NN-<pattern>.html (one file per slide, as authored), tail.html (everything after the last slide) and
// fonts.json (the latin faces the template asked Google Fonts for, by content id). The faces themselves are stored once in
// templates/_fonts/<id>.b64 (base64 woff2), the shared Chart.js build in templates/_lib/, the license in templates/LICENSE and
// the machine-readable list in templates/index.json. Slide pattern names come from the slide's own class or a comment in front of
// it; scripts/vendor-html-templates.names.json overrides the ones that are only numbers.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "app-assets", "deck-templates");
const NAMES = JSON.parse(readFileSync(join(HERE, "vendor-html-templates.names.json"), "utf8"));
const SRC = process.argv[2];
if (!SRC || !existsSync(join(SRC, "templates"))) { console.error("usage: vendor-html-templates.mjs <beautiful-html-templates checkout> [--only a,b]"); process.exit(2); }
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1].split(",") : null;
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const VOID = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));

function tokens(html) {
  const out = [], re = /<!--[\s\S]*?-->|<(script|style|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>|<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith("<!--")) { out.push({ type: "comment", text: m[0], start: m.index, end: m.index + m[0].length }); continue; }
    if (m[1]) continue;
    const attrs = m[4], tag = m[3].toLowerCase();
    out.push({ type: m[2] ? "close" : "open", tag, attrs, start: m.index, end: m.index + m[0].length, selfClose: /\/\s*$/.test(attrs) || VOID.has(tag) });
  }
  return out;
}
// The slide roots: elements with the class "slide", or the section children of a <deck-stage>.
function findSlides(html) {
  const t = tokens(html), stack = [], slides = [];
  for (const k of t) {
    if (k.type === "open" && !k.selfClose) {
      const cls = (k.attrs.match(/class\s*=\s*"([^"]*)"/) || [])[1] || "", parent = stack[stack.length - 1];
      stack.push({ tag: k.tag, start: k.start, cls, isSlide: cls.split(/\s+/).includes("slide") || (parent?.tag === "deck-stage" && k.tag === "section") });
    } else if (k.type === "close") {
      let j = stack.length - 1;
      while (j >= 0 && stack[j].tag !== k.tag) j--;
      if (j < 0) continue;
      const e = stack.splice(j)[0];
      if (e.isSlide && !stack.some((s) => s.isSlide)) slides.push({ start: e.start, end: k.end, cls: e.cls });
    }
  }
  slides.sort((a, b) => a.start - b.start);
  for (const s of slides) {   // a comment right in front of a slide labels it
    const before = t.filter((k) => k.type === "comment" && k.end <= s.start && !/[^\s]/.test(html.slice(k.end, s.start))).pop();
    s.comment = before ? before.text.replace(/^<!--|-->$/g, "").trim() : "";
  }
  return slides;
}

const slug = (s) => String(s).toLowerCase().replace(/&[a-z]+;/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const GENERIC = new Set(["slide", "active", "is-active", "light", "dark", "orange", "grain", "hairlines", "scanlines", "crt-glow", "bg-grid"]);
function patternName(s, text) {
  const cls = s.cls.split(/\s+/).filter((c) => c && !GENERIC.has(c) && !/^bg-/.test(c));
  for (const c of cls) {
    const n = slug(c.replace(/^(slide--?|s-|layout-)/, ""));
    if (n && !/^\d+$/.test(n) && !/^s\d+$/.test(n) && !/^slide-?\d+$/.test(n)) return n;
  }
  const c = s.comment.replace(/^[\s\d.·:/\-–—]*(slide|screen)?\s*\d*\s*[·:.\-–—]*\s*/i, "");
  if (c && c.length < 40 && slug(c)) return slug(c);
  return slug(text).split("-").slice(0, 3).join("-") || "slide";
}
const firstText = (html) => (html.match(/<(h1|h2|h3)[^>]*>([\s\S]*?)<\/\1>/i)?.[2] || html.match(/>([^<>]{4,})</)?.[1] || "").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ").trim();

async function get(url, binary) {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(url, { headers: { "user-agent": UA } }); if (r.ok) return binary ? Buffer.from(await r.arrayBuffer()) : await r.text(); } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error(`could not fetch ${url}`);
}
// Basic Latin, Latin-1 and common punctuation, which keeps the layout features and drops the rest of Google's "latin" range. A variable
// font keeps only the weights the template asked for (its font-weight, one value or a range) and its optical size axis: the other axes
// (width, slant, and weights nobody asked for) go, which makes the file much smaller.
const KEEP = "U+0020-007E,U+00A0-00FF,U+2010-2027,U+2030,U+2039-203A,U+20AC,U+2122,U+2190-2193,U+2212,U+2215,U+25A0-25CF";
const SLIM = `
import io, sys
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
src, dst, weight = sys.argv[1], sys.argv[2], sys.argv[3]
f = TTFont(src)
opts = subset.Options(); opts.layout_features = ["*"]; opts.hinting = False; opts.desubroutinize = True
s = subset.Subsetter(opts); s.populate(unicodes=subset.parse_unicodes(sys.argv[4])); s.subset(f)
buf = io.BytesIO(); f.flavor = None; f.save(buf); f = TTFont(io.BytesIO(buf.getvalue()))
if "fvar" in f:
    lim = {}
    for a in f["fvar"].axes:
        if a.axisTag == "wght":
            w = [float(x) for x in weight.split()]
            lo, hi = max(a.minValue, min(w)), min(a.maxValue, max(w))
            lim["wght"] = lo if lo >= hi else (lo, hi)
        elif a.axisTag != "opsz":
            lim[a.axisTag] = a.defaultValue
    f = instancer.instantiateVariableFont(f, lim)
f.flavor = "woff2"; f.save(dst)
`;
function latinOnly(buf, weight) {
  const dir = mkdtempSync(join(tmpdir(), "face-")), inp = join(dir, "in.woff2"), out = join(dir, "out.woff2");
  writeFileSync(inp, buf);
  try { execFileSync("python3", ["-c", SLIM, inp, out, weight || "400", KEEP], { stdio: "pipe" }); return readFileSync(out); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}
const faceCache = new Map();   // url -> id
const cssCache = new Map(), RANGE = new Map();   // Google Fonts CSS by address; the weights asked for per font file, over all templates
const cssUrlsOf = (html) => [...html.matchAll(/(?:href=["']|@import\s+url\(\s*['"]?)(https:\/\/fonts\.googleapis\.com\/css2?\?[^"')\s]+)/g)].map((m) => m[1].replace(/&amp;/g, "&"));
async function parseFaces(cssUrls) {
  const faces = [];
  for (const u of cssUrls) {
    if (!cssCache.has(u)) cssCache.set(u, await get(u));
    for (const m of cssCache.get(u).matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)) {
      if (m[1] !== "latin") continue;   // latin only: CJK and the other scripts fall back to the computer's fonts
      const body = m[2], g = (re) => (body.match(re) || [])[1];
      const url = g(/url\(([^)]+)\)/), family = g(/font-family:\s*['"]?([^;'"]+)['"]?/);
      if (url && family) faces.push({ family, style: g(/font-style:\s*([^;]+)/) || "normal", weight: g(/font-weight:\s*([^;]+)/) || "400", url });
    }
  }
  return faces;
}
// A font file is cut once, to the weights every template that uses it asks for.
async function fontFaces(cssUrls) {
  const out = [];
  for (const f of await parseFaces(cssUrls)) {
    let id = faceCache.get(f.url);
    if (!id) {
      const buf = await get(f.url, true), r = RANGE.get(f.url), range = `${r[0]} ${r[1]}`;
      id = createHash("sha1").update(buf).update(range).digest("hex").slice(0, 10);
      mkdirSync(join(OUT, "_fonts"), { recursive: true });
      writeFileSync(join(OUT, "_fonts", `${id}.b64`), latinOnly(buf, range).toString("base64"));
      faceCache.set(f.url, id);
    }
    out.push({ family: f.family, style: f.style, weight: f.weight, id });
  }
  return out;
}

// Fixes to the upstream templates, found by deck_check.mjs on the unchanged samples: text running off the slide, over other text,
// or below the size floor. Each applies to one template's head.html or to a sample slide ("slide:NN"), and must match exactly once or more.
const PATCHES = [
  { t: "bold-poster", in: "head", find: "background: var(--bg); justify-content: center;\n      align-items: center; text-align: center; position: relative;", repl: "background: var(--bg); justify-content: center;\n      align-items: center; text-align: center;", why: "position: relative on the closing slide took away the full-slide box, so the title sat at the top edge and ran off it" },
  { t: "bold-poster", in: "head", find: "font-size: clamp(10px, 0.85vw, 11px);\n      line-height: 1.4; color: var(--bg); opacity: 0.5;", repl: "font-size: 13px;\n      line-height: 1.4; color: var(--bg); opacity: 0.5;", why: "roadmap bullets were 11px" },
  { t: "capsule", in: "slide:05", find: "font-size:0.55rem", repl: "font-size:0.7rem", why: "floating pill words were 9px" },
  { t: "capsule", in: "slide:10", find: "font-size:0.55rem", repl: "font-size:0.7rem", why: "floating pill words were 9px" },
  { t: "emerald-editorial", in: "head", find: "font-size: 144px;\n    line-height: 0.9;\n    letter-spacing: -0.03em;\n    white-space: nowrap;", repl: "font-size: 116px;\n    line-height: 0.9;\n    letter-spacing: -0.03em;\n    white-space: nowrap;", why: "a four-digit figure ran out of its card" },
  { t: "pink-script", in: "head", find: "font-size: 132px; line-height: 1.04; color: var(--paper); max-width: 14ch;", repl: "font-size: 96px; line-height: 1.04; color: var(--paper); max-width: 14ch;", why: "a three-line title on the comparison slide ran into the table" },
  { t: "stencil-tablet", in: "head", find: "font-size: min(110px, 12vh); line-height: .92; text-transform: uppercase; letter-spacing: -.01em;\n    color: var(--bone);\n  }\n  .s-chart .left h2 em", repl: "font-size: min(92px, 10vh); line-height: .92; text-transform: uppercase; letter-spacing: -.01em;\n    color: var(--bone);\n  }\n  .s-chart .left h2 em", why: "a four-line title pushed the legend into the footer" },
  { t: "8-bit-orbit", in: "tail", find: "const totalSlides = 10;", repl: "const totalSlides = document.querySelectorAll('.slide').length;", why: "the slide count was written into the script, so a deck with another number of slides ran past its last slide" },
  { t: "daisy-days", in: "tail", find: "if(current<10)goToSlide(current+1)", repl: "if(current<slides.length)goToSlide(current+1)", why: "the slide count was written into the script" },
  { t: "daisy-days", in: "tail", find: "goToSlide(10);", repl: "goToSlide(slides.length);", why: "the slide count was written into the script" },
  { t: "daisy-days", in: "tail", find: "counter.textContent=id+' / 10'", repl: "counter.textContent=id+' / '+slides.length", why: "the slide count was written into the script" },
  { t: "daisy-days", in: "head", find: "</style>", repl: "/* 1Helm: the sizes in this template are written in rem for a laptop window; the deck stage is 1920 px wide, so everything in rem is 1.5 times larger */\nhtml{font-size:24px}\n</style>", why: "text was 11 to 14 px on the 1920 px stage" },
  { t: "editorial-tri-tone", in: "head", find: ".s-chart svg.chart { width:100%;", repl: ".s-chart svg.chart { overflow: visible; width:100%;", why: "the first axis label was cut at the chart's edge" },
];
function patch(t, where, text) {
  for (const p of PATCHES.filter((x) => x.t === t && x.in === where)) {
    if (!text.includes(p.find)) throw new Error(`${t} ${where}: patch does not match (${p.why})`);
    text = text.split(p.find).join(p.repl);
  }
  return text;
}

mkdirSync(OUT, { recursive: true });
const index = JSON.parse(readFileSync(join(SRC, "index.json"), "utf8")), list = [];
for (const meta of index.templates) {   // first, which weights of each font file the templates ask for
  if (only && !only.includes(meta.slug)) continue;
  for (const f of await parseFaces(cssUrlsOf(readFileSync(join(SRC, "templates", meta.slug, "template.html"), "utf8")))) {
    const w = f.weight.split(/\s+/).map(Number), r = RANGE.get(f.url) || [1e9, 0];
    RANGE.set(f.url, [Math.min(r[0], ...w), Math.max(r[1], ...w)]);
  }
}
for (const meta of index.templates) {
  if (only && !only.includes(meta.slug)) continue;
  const html = readFileSync(join(SRC, "templates", meta.slug, "template.html"), "utf8");
  const slides = findSlides(html);
  if (!slides.length) throw new Error(`${meta.slug}: no slides found`);
  const dir = join(OUT, meta.slug);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "slides"), { recursive: true });

  let head = html.slice(0, slides[0].start), tail = html.slice(slides.at(-1).end);
  // Fonts: take the Google Fonts links and @imports out, remember what they asked for.
  const cssUrls = new Set();
  const grab = (u) => cssUrls.add(u.replace(/&amp;/g, "&"));
  head = head.replace(/<link[^>]*rel=["']preconnect["'][^>]*>\s*/g, "");
  let marked = false;
  head = head.replace(/<link[^>]*href=["'](https:\/\/fonts\.googleapis\.com\/css2?\?[^"']+)["'][^>]*>\s*/g, (m, u) => { grab(u); const r = marked ? "" : "<!--hc-fonts-->\n"; marked = true; return r; });
  head = head.replace(/@import\s+url\(\s*['"]?(https:\/\/fonts\.googleapis\.com\/[^'")]+)['"]?\s*\);?/g, (m, u) => { grab(u); return ""; });
  if (cssUrls.size && !marked) head = head.replace("</head>", "<!--hc-fonts-->\n</head>");
  const faces = await fontFaces([...cssUrls]);
  // Chart.js from a CDN: the build puts the vendored copy in its place.
  let chart = false, stageJs = false;
  const lib = (m) => { chart = true; return '<script src="hc-lib:chart.umd.min.js"></script>'; };
  head = head.replace(/<script[^>]*src=["']https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js[^"']*["'][^>]*><\/script>/g, lib);
  tail = tail.replace(/<script[^>]*src=["']https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js[^"']*["'][^>]*><\/script>/g, lib);
  const stage = (m) => { stageJs = true; return '<script src="hc-lib:deck-stage.js"></script>'; };
  head = head.replace(/<script[^>]*src=["']deck-stage\.js["'][^>]*><\/script>/g, stage);
  tail = tail.replace(/<script[^>]*src=["']deck-stage\.js["'][^>]*><\/script>/g, stage);
  // Notes belong to the build, not the template.
  const strip = (s) => s.replace(/<script[^>]*id=["']speaker-notes["'][^>]*>[\s\S]*?<\/script>\s*/g, "");
  head = strip(head); tail = strip(tail);
  head = head.replace(/<title>[\s\S]*?<\/title>/, "<title>Deck</title>");
  if (/https?:\/\/(?!www\.w3\.org)[^"'\s)]+/.test((head + tail).replace(/<script[\s\S]*?<\/script>/g, "")) ) {
    const urls = [...new Set((head + tail).match(/https?:\/\/(?!www\.w3\.org)[^"'\s)]+/g))];
    console.error(`${meta.slug}: still refers to ${urls.slice(0, 3).join(" ")}`);
  }
  head = patch(meta.slug, "head", head);
  writeFileSync(join(dir, "head.html"), head);
  writeFileSync(join(dir, "tail.html"), patch(meta.slug, "tail", tail));
  writeFileSync(join(dir, "fonts.json"), JSON.stringify(faces) + "\n");

  const used = new Set(), names = [], over = NAMES[meta.slug] || {};
  slides.forEach((s, i) => {
    const raw = html.slice(s.start, s.end), n = String(i + 1).padStart(2, "0");
    let name = over[n] || patternName(s, firstText(raw));
    while (used.has(name)) name += "-2";
    used.add(name); names.push(name);
    writeFileSync(join(dir, "slides", `${n}-${name}.html`), patch(meta.slug, `slide:${n}`, raw) + "\n");
  });
  list.push({ name: meta.slug, title: meta.name, mood: meta.mood, tone: meta.tone, density: meta.density, scheme: meta.scheme, formality: meta.formality, best_for: meta.best_for, avoid_for: meta.avoid_for, tagline: meta.tagline, fonts: [...new Set(faces.map((f) => f.family))], chart, stage: stageJs, patterns: names });
  console.log(`${meta.slug}: ${slides.length} slides, ${faces.length} font faces${chart ? ", chart.js" : ""}: ${names.join(" ")}`);
}
// deck-stage.js (MIT, same repository): the same file with its on-screen control bar left out, because the deck file's own shell shows one.
{
  mkdirSync(join(OUT, "_lib"), { recursive: true });
  let js = readFileSync(join(SRC, "runtime", "deck-stage.js"), "utf8");
  const before = js;
  js = js.replace("this._root.append(style, stage, tapzones, overlay);", "this._root.append(style, stage, tapzones);   // 1Helm: no control bar, the deck file's shell has one");
  if (js === before) throw new Error("deck-stage.js changed upstream: update the patch in vendor-html-templates.mjs");
  writeFileSync(join(OUT, "_lib", "deck-stage.js"), js);
}
if (!only) {
  // font files no template refers to any more (an earlier run's, with another weight range) go
  const used = new Set(list.flatMap((t) => JSON.parse(readFileSync(join(OUT, t.name, "fonts.json"), "utf8")).map((f) => `${f.id}.b64`)));
  for (const f of readdirSync(join(OUT, "_fonts"))) if (!used.has(f)) rmSync(join(OUT, "_fonts", f));
  writeFileSync(join(OUT, "index.json"), JSON.stringify({ source: "https://github.com/zarazhangrui/beautiful-html-templates", commit: tryGit(SRC), templates: list }, null, 1) + "\n");
  writeFileSync(join(OUT, "LICENSE"), readFileSync(join(SRC, "LICENSE"), "utf8"));
  mkdirSync(join(OUT, "_lib"), { recursive: true });
  const lib = join(OUT, "_lib", "chart.umd.min.js");
  if (!existsSync(lib)) writeFileSync(lib, await get("https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"));
}
function tryGit(dir) { try { return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { return ""; } }
