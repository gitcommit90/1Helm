#!/usr/bin/env node
// Build the one self-contained deck file from the deck's source.
//
//   .src/deck.json            { template, title, slides: [{ id, pattern, orig }] }, the slides in order
//   .src/slides/<id>.html     one slide each, copied from the template by new_deck.mjs and rewritten with the deck's words
//   .src/media/<file>         photos, referenced as src="media/<file>" or url('media/<file>')
//   .src/notes.json           optional: speaker notes, one string per slide, in order
//     -> .src/build/deck.html   the template's own document with every slide, fonts and photos embedded
//     -> .src/build/notes.json  the notes plus each photo's credit (from .src/media/SOURCES.md)
//     -> <project>/<slug>.html  deck_shell.html wrapped around it: the 1920x1080 stage scaled to the window, keys, tap,
//                               fullscreen, counter and the notes view
//
//   node assemble_deck.mjs <abs project dir>
//
// Fonts are cut to the characters the deck uses and embedded as base64 woff2; photos are embedded as data: URIs (scaled to at
// most 2560 px); Chart.js, when the template draws charts with it, is embedded. The file works offline.
// stdout: one JSON line { ok, out, slides, bytes, fonts, missing_media, warnings } or { ok:false, error }. Exit 0 ok, 1 failed, 2 bad arguments.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { shownSlide } from "./deck_checks.mjs";
import { templatesFor } from "./deck_templates_dir.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
if (process.argv.slice(2).some((a) => a === "--help" || a === "-h")) {
  const L = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n"), end = L.findIndex((l, i) => i > 0 && !l.startsWith("//"));
  process.stdout.write(L.slice(1, end).map((l) => l.replace(/^\/\/ ?/, "")).join("\n") + "\n"); process.exit(0);
}
const fail = (error, code = 1) => { console.log(JSON.stringify({ ok: false, error })); process.exit(code); };
const P = process.argv[2] && !process.argv[2].startsWith("--") ? resolve(process.argv[2]) : "";
if (!P) fail("usage: assemble_deck.mjs <project dir>", 2);

const SRC = join(P, ".src"), BUILD = join(SRC, "build"), SLUG = basename(P);
let deck;
try { deck = JSON.parse(readFileSync(join(SRC, "deck.json"), "utf8")); } catch { fail(`no readable ${SRC}/deck.json: start the deck with new_deck.mjs`); }
const TEMPLATES = templatesFor(P);
const T = join(TEMPLATES, String(deck.template || ""));
if (!/^[a-z0-9-]+$/.test(String(deck.template || "")) || !existsSync(join(T, "head.html"))) fail(`unknown template "${deck.template}"`);
if (!Array.isArray(deck.slides) || !deck.slides.length) fail("deck.json lists no slides");

const warnings = [];
const read = (p) => readFileSync(p, "utf8");
const slideFiles = deck.slides.map((s) => {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(s.id || "")) fail(`bad slide id "${s.id}" in deck.json`);
  const f = join(SRC, "slides", `${s.id}.html`);
  if (!existsSync(f)) fail(`deck.json lists slide "${s.id}" but ${f} does not exist`);
  return f;
});
const tplSlides = readdirSync(join(T, "slides")).filter((f) => !f.startsWith("00-")).sort();   // 00-media is 1Helm's own pattern, not one of the template's numbered slides
const origTotal = tplSlides.length, total = deck.slides.length;

// Photos: embed into copies of the slide files, so the source files stay small.
mkdirSync(BUILD, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "deck-"));
let missing = [];
slideFiles.forEach((f, i) => copyFileSync(f, join(tmp, `${String(i).padStart(3, "0")}.html`)));
if (existsSync(join(SRC, "media"))) {
  const run = (() => { try { return { out: execFileSync("python3", [join(HERE, "inline_media.py"), "--media", join(SRC, "media"), ...readdirSync(tmp).map((n) => join(tmp, n))], { encoding: "utf8" }) }; } catch (e) { return { out: String(e.stdout || ""), err: e }; } })();
  let j = null;
  try { j = JSON.parse(run.out.trim().split("\n").pop()); } catch { /* not JSON */ }
  if (!j) fail(`inline_media.py failed: ${String((run.err && (run.err.stderr || run.err.message)) || run.out).slice(-300)}`);   // it exits 1 when a picture is missing, and says which
  missing = [...new Set((j.files || []).flatMap((f) => (f.missing || []).map((m) => `media/${m}`)))];
} else {
  for (const n of readdirSync(tmp)) for (const m of read(join(tmp, n)).matchAll(/\b(?:src\s*=\s*["']|url\(\s*["']?)(media\/[^"')\s]+)/g)) missing.push(m[1]);
  missing = [...new Set(missing)];
}
let slides = readdirSync(tmp).sort().map((n) => read(join(tmp, n)));
rmSync(tmp, { recursive: true, force: true });

// Page labels such as "04 / 12" in a slide: the template's own numbers become the deck's.
const pad = (n, w) => String(n).padStart(w, "0");
const LABEL = /(?<=>\s*)(\d{1,2})(\s*(?:\/|·|•|of)\s*)(\d{1,2})(?=\s*<)/g;
const firstClass = (read(join(T, "slides", tplSlides[0])).match(/^\s*<[^>]*?\sclass="([^"]*)"/) || [])[1] || "";
const activeTokens = firstClass.split(/\s+/).filter((t) => t === "active" || t === "is-active");
slides = slides.map((html, i) => {
  const orig = Number(deck.slides[i].orig) || 0;
  let out = html.replace(LABEL, (m, a, sep, b) => (Number(a) === orig && Number(b) === origTotal ? `${pad(i + 1, a.length)}${sep}${pad(total, b.length)}` : m));
  // Mark the slide's root element so the shell and the checks can find it whatever the template calls it.
  out = out.replace(/^\s*<([a-zA-Z][\w-]*)/, `<$1 data-hc-slide="${i}"`);
  // The template marks its first slide as the shown one with a class; the deck's first slide, whatever it is, gets it.
  out = out.replace(/^(\s*<[^>]*?\sclass=")([^"]*)(")/, (m, a, cls, c) => {
    const rest = cls.split(/\s+/).filter((t) => t && !activeTokens.includes(t));
    return a + [...rest, ...(i === 0 ? activeTokens : [])].join(" ") + c;
  });
  return out;
});
// Some templates number their slides in the markup (data-slide="3", data-index="2") and look a slide up by that number: the deck's
// slides are numbered by position, from the number the template's own first slide has.
const firstOpen = (read(join(T, "slides", tplSlides[0])).match(/^\s*<[^>]*>/) || [""])[0];
const baseOf = (attr) => { const m = firstOpen.match(new RegExp(`\\s${attr}="(\\d+)"`)); return m ? Number(m[1]) : null; };
const bases = { "data-slide": baseOf("data-slide"), "data-index": baseOf("data-index") };
slides = slides.map((html, i) => html.replace(/^\s*<[^>]*>/, (open) => {
  for (const [attr, base] of Object.entries(bases)) if (base !== null) open = open.replace(new RegExp(`(\\s${attr}=")\\d+(")`), `$1${base + i}$2`);
  return open.replace(/(\sid="slide-)\d+(")/, `$1${i + 1}$2`);   // a slide looked up by id="slide-3"
}));
let head = read(join(T, "head.html")), tail = read(join(T, "tail.html"));
// Navigation dots written out in the markup (one per sample slide): one per slide of the deck.
const DOTS = /(?:[ \t]*<(div|button|span)\b[^>]*class="[^"]*\bnav-dot\b[^"]*"[^>]*>\s*<\/\1>[ \t]*\n?)+/;
const fixDots = (text) => text.replace(DOTS, (run) => {
  const one = run.match(/[ \t]*<(div|button|span)\b[^>]*class="[^"]*\bnav-dot\b[^"]*"[^>]*>\s*<\/\1>[ \t]*\n?/)[0], dots = [];
  for (let k = 0; k < total; k++) dots.push(one.replace(/(data-slide=")\d+(")/, `$1${k + 1}$2`).replace(/\bactive\b/, k === 0 ? "active" : "").replace(/class="([^"]*?)\s*"/, 'class="$1"'));
  return dots.join("");
});
head = fixDots(head); tail = fixDots(tail);
for (const k of ["head", "tail"]) {
  const re = new RegExp(`(?<=>\\s*)(\\d{1,2})(\\s*(?:\\/|\\u00b7|\\u2022|of)\\s*)${origTotal}(?=\\s*<)`, "g");
  if (k === "head") head = head.replace(re, (m, a, sep) => `${a}${sep}${pad(total, String(origTotal).length)}`);
  else tail = tail.replace(re, (m, a, sep) => `${a}${sep}${pad(total, String(origTotal).length)}`);
}

// Fonts: the faces the template uses, cut to the deck's characters.
const text = [head, ...slides, tail].join(" ").replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/data:[^"')\s]+/g, " ").replace(/<[^>]+>/g, " ");
const faces = JSON.parse(read(join(T, "fonts.json")));
let fontsCss = "", fontBytes = 0;
if (faces.length) {
  try {
    // Cutting the fonts takes seconds. The cut is the same for the same faces and the same characters beyond the ones deck_fonts.py always keeps (ASCII and common
    // punctuation), which is nearly every deck of a template, so the result is kept in .src/cache (new_deck.mjs --redo leaves that folder alone).
    const BASE = new Set([...Array(0x5f).keys()].map((k) => String.fromCharCode(0x20 + k)).concat([..."\u2013\u2014\u2018\u2019\u201c\u201d\u2026\u00b7\u2022\u20ac\u00a3\u00a5 \u2192\u2190\u2191\u2193\u00d7\u2212"]));
    const extra = [...new Set([...text].filter((c) => c.codePointAt(0) >= 0x20 && !BASE.has(c)))].sort().join("");
    const key = createHash("sha256").update(JSON.stringify([faces, extra, "v1"])).digest("hex").slice(0, 24), cached = join(SRC, "cache", `fonts-${key}.json`);
    let j = null;
    try { j = JSON.parse(read(cached)); } catch { /* not cut yet */ }
    if (!j) {
      const out = execFileSync("python3", [join(HERE, "deck_fonts.py"), join(TEMPLATES, "_fonts")], { input: JSON.stringify({ faces, text, html: slides.join("\n") + head }), encoding: "utf8", maxBuffer: 1 << 28 });
      j = JSON.parse(out);
      try { mkdirSync(join(SRC, "cache"), { recursive: true }); writeFileSync(cached, JSON.stringify(j)); } catch { /* a read-only folder just means no cache */ }
    }
    fontsCss = j.css; fontBytes = j.bytes; warnings.push(...(j.warnings || []));
  } catch (e) { fail(`deck_fonts.py failed: ${String(e.stderr || e.stdout || e.message).slice(-300)}`); }
}
// The empty box of the "media" pattern: dashed, drawn in the slide's own colour.
const BASE_CSS = `<style id="hc-base">.hc-drop{position:absolute;box-sizing:border-box;border:4px dashed currentColor;border-radius:18px;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;font-size:30px;line-height:1.3;font-weight:600;letter-spacing:0;text-transform:none;opacity:.9;z-index:2}</style>`;
head = head.replace("</head>", () => `${BASE_CSS}\n</head>`);
head = head.replace("<!--hc-fonts-->", fontsCss ? `<style id="hc-fonts">\n${fontsCss}</style>` : "");
// Chart.js when the template charts with it.
const lib = (s) => s.replace(/<script src="hc-lib:([\w.-]+)"><\/script>/g, (m, f) => `<script>${read(join(TEMPLATES, "_lib", f)).replace(/<\/script/gi, "<\\/script")}</script>`);
// A template that draws its charts at load looks them up by id; a deck without that chart slide must not stop its script there.
if (/hc-lib:chart/.test(head + tail)) head = head.replace("</head>", () => `<script>(function(){var g=document.getElementById.bind(document);document.getElementById=function(i){return g(i)||(/Chart$/.test(i)?document.createElement("canvas"):null)}})()</script>\n</head>`);
head = lib(head); tail = lib(tail);

// The bridge the shell talks to (deck_bridge.js), just before the document ends.
const bridge = `<script id="hc-bridge">${read(join(HERE, "deck_bridge.js")).replace("var shown = __SHOWN__;", () => `var shown = ${shownSlide.toString()};`)}</script>`;
tail = /<\/body>/i.test(tail) ? tail.replace(/<\/body>(?![\s\S]*<\/body>)/i, () => `${bridge}\n</body>`) : `${tail}\n${bridge}`;
const doc = `${head}${slides.join("\n")}\n${tail}`;
writeFileSync(join(BUILD, "deck.html"), doc);

// Notes: the author's notes and each photo's credit.
let notes = [];
try { notes = JSON.parse(read(join(SRC, "notes.json"))); } catch { /* none */ }
// A bare array of strings, or the same list under a key ({"notes": [...]}), a list of {"notes": "..."} objects, or an object keyed by slide id or number.
const noteText = (x) => typeof x === "string" ? x : x && typeof x === "object" ? String(x.notes ?? x.note ?? x.speaker_notes ?? x.text ?? "") : "";
if (notes && !Array.isArray(notes) && typeof notes === "object") {
  const list = Object.values(notes).find(Array.isArray);
  if (list) notes = list;
  else notes = deck.slides.map((s, i) => notes[s.id] ?? notes[String(i + 1)] ?? notes[String(parseInt(s.id, 10))] ?? "");
}
if (!Array.isArray(notes)) { warnings.push("notes.json is not a list of notes and was ignored"); notes = []; }
notes = notes.map(noteText);
const credits = {};
try {
  for (const row of read(join(SRC, "media", "SOURCES.md")).split("\n")) {
    const c = row.trim().replace(/^\||\|$/g, "").split("|").map((x) => x.trim().replace(/^None$/, ""));
    if (c.length < 4 || c[0].toLowerCase() === "file" || /^[-: ]*$/.test(c[0])) continue;
    const title = (c[1] || "Photo").replace(/^File:/, "").replace(/\.(jpe?g|png|webp|gif|tiff?)$/i, "").trim() || "Photo";
    credits[basename(c[0])] = [c[2] ? `${title} by ${c[2]}` : title, c[3], c[4]].filter(Boolean).join(", ");
  }
} catch { /* no photos with credits */ }
const finalNotes = deck.slides.map((s, i) => {
  const used = [...new Set([...read(slideFiles[i]).matchAll(/media\/([^"')\s]+)/g)].map((m) => m[1]))].map((f) => credits[f]).filter(Boolean);
  return [String(notes[i] || "").trim(), ...used.map((c) => `Photo: ${c}`)].filter(Boolean).join("\n\n");
});
writeFileSync(join(BUILD, "notes.json"), JSON.stringify(finalNotes));

// The shell around the template's document. The document goes in as a JS string, so "</" and "<!--" are escaped.
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const asJs = (s) => JSON.stringify(s).replace(/<\//g, "<\\/").replace(/<!--/g, "<\\!--").replace(new RegExp("[\\u2028\\u2029]", "g"), (c) => "\\u" + c.charCodeAt(0).toString(16));
const shell = read(join(HERE, "deck_shell.html")).replace("__TITLE__", () => esc(deck.title || SLUG)).replace("__NOTES__", () => asJs(finalNotes)).replace("__DOC__", () => asJs(doc));
writeFileSync(join(P, `${SLUG}.html`), shell);
console.log(JSON.stringify({ ok: true, out: join(P, `${SLUG}.html`), slides: total, bytes: Buffer.byteLength(shell), fonts: fontBytes, missing_media: missing, warnings }));
