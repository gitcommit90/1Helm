#!/usr/bin/env node
// Give a deck its own font bytes. Reads the two families named in deck.css's :root tokens (--slide-font-display,
// --slide-font-body), finds the installed font files for the weights the deck uses, cuts each down to the characters the
// slides actually contain, and appends them to deck.css as @font-face rules with data: URIs. After this the assembled
// index.html renders in the theme's faces anywhere, offline, with nothing to fetch.
//
//   node embed_deck_fonts.mjs --slides <abs .src/slides dir>
//
// Run it after the slides are written and before assemble_deck.mjs. Re-running is cheap: when the families, weights and
// characters are unchanged it leaves deck.css alone ("reused": true).
//
// stdout: one JSON line { ok, faces, bytes, families, weights, reused, warnings }. A font that can't be found or cut is
// a warning with exit 0 (the deck still renders in the installed face). Exit 1 only for bad arguments or an unreadable deck.

import { mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
// --help: print the header above and exit.
if (process.argv[1] && import.meta.url.endsWith("/" + process.argv[1].split("/").pop()) && process.argv.slice(2).some((a) => a === "--help" || a === "-h")) {
  const HELP = (await import("node:fs")).readFileSync(new URL(import.meta.url), "utf8").split("\n"), end = HELP.findIndex((l, i) => i > 0 && !l.startsWith("//"));
  process.stdout.write(HELP.slice(HELP[0].startsWith("#!") ? 1 : 0, end).map((l) => l.replace(/^\/\/ ?/, "")).join("\n") + "\n"); process.exit(0);
}

const DECK_CSS = "deck.css";
const BEGIN = "/* embedded-fonts:begin";
const END = "/* embedded-fonts:end */";
const BLOCK = /\n?\/\* embedded-fonts:begin[^*]*\*\/[\s\S]*?\/\* embedded-fonts:end \*\/\n?/g;
const TOKEN = /--slide-font-(?:display|body)\s*:\s*([^;}]+)/g;
const FAMILY_OK = /^[A-Za-z0-9][A-Za-z0-9 ]{0,47}$/;
const MAX_FACE_BYTES = 600_000;
const WRAP = 8_000;   // split long base64 so the stylesheet stays readable to line-based tools ("\" + newline is a no-op in a CSS string)
// CSS weight -> fontconfig weight.
const FC_WEIGHT = { 100: 0, 200: 40, 300: 50, 400: 80, 500: 100, 600: 180, 700: 200, 800: 205, 900: 210 };

function parseArgs(argv) {
  const i = argv.indexOf("--slides");
  const slides = i >= 0 ? (argv[i + 1] || "").trim() : "";
  if (!slides || !slides.startsWith("/")) throw new Error("usage: embed_deck_fonts.mjs --slides <abs .src/slides dir>");
  return { slides };
}

const stackHead = (v) => String(v).split(",")[0].trim().replace(/^["']|["']$/g, "");
const stripBlock = (css) => css.replace(BLOCK, "\n").replace(/\n{3,}$/, "\n\n");

// Weights the deck asks for, plus 400 and 700, which body text and headings fall back to.
function usedWeights(sources) {
  const set = new Set([400, 700]);
  for (const src of sources) {
    for (const m of String(src).matchAll(/font-weight\s*:\s*(\d{3}|bold|normal|bolder|lighter)/gi)) {
      const w = { bold: 700, normal: 400, bolder: 800, lighter: 300 }[m[1].toLowerCase()] ?? Number(m[1]);
      if (FC_WEIGHT[w] !== undefined) set.add(w);
    }
    // <b>, <strong>, h1-h6 paint bold by default.
    if (/<(b|strong|h[1-6])[\s>]/i.test(String(src))) set.add(700);
  }
  return [...set].sort((a, b) => a - b);
}

// Every character the slides paint (text and attribute values are close enough), plus ASCII so small edits don't
// drop glyphs.
function deckCharacters(htmlSources) {
  const chars = new Set();
  for (let c = 0x20; c < 0x7f; c++) chars.add(String.fromCharCode(c));
  for (const ch of "–—‘’“”… ·•¥€£") chars.add(ch);
  for (const html of htmlSources) {
    const text = String(html).replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/data:[^"')\s]+/g, " ").replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)));
    for (const ch of text) if (ch.codePointAt(0) >= 0x20) chars.add(ch);
  }
  return [...chars].sort().join("");
}

// The installed file for family + weight, or null when fontconfig would substitute another family.
function fontFile(family, weight) {
  let out;
  try {
    out = execFileSync("fc-match", ["-f", "%{file}\n%{family}\n%{variable}\n", `${family}:weight=${FC_WEIGHT[weight]}`], { encoding: "utf8" });
  } catch { return null; }
  const [file, families, variable] = out.split("\n");
  if (!file || !families.split(",").some((f) => f.trim().toLowerCase() === family.toLowerCase())) return null;
  return { file, variable: /true/i.test(variable || "") || /\[.*wght.*\]/.test(file) };
}

function hasBrotli() {
  try { execFileSync("python3", ["-c", "import brotli"], { stdio: "ignore" }); return true; } catch { return false; }
}

// Cut a font to the given characters. woff2 when brotli is available, else woff (zlib). Variable fonts keep their axes.
function subset(file, text, dir, flavor) {
  const textFile = join(dir, "chars.txt");
  const out = join(dir, `face-${createHash("sha1").update(file + flavor).digest("hex").slice(0, 10)}.${flavor}`);
  execFileSync("python3", ["-c", "import sys,pathlib; pathlib.Path(sys.argv[1]).write_text(sys.argv[2], encoding='utf-8')", textFile, text]);
  execFileSync("python3", ["-m", "fontTools.subset", file, `--text-file=${textFile}`, `--flavor=${flavor}`, `--output-file=${out}`,
    "--layout-features=*", "--no-hinting", "--desubroutinize"], { stdio: ["ignore", "ignore", "pipe"] });
  return out;
}

async function run({ slides }) {
  const cssPath = join(slides, DECK_CSS);
  let css;
  try { css = await readFile(cssPath, "utf8"); } catch { throw new Error(`no ${DECK_CSS} in ${slides}`); }
  const htmlNames = (await readdir(slides)).filter((n) => n.endsWith(".html")).sort();
  const htmls = await Promise.all(htmlNames.map((n) => readFile(join(slides, n), "utf8")));
  const authored = stripBlock(css);
  const warnings = [];

  const families = [...new Set([...authored.matchAll(TOKEN)].map((m) => stackHead(m[1])))].filter((f) => {
    if (FAMILY_OK.test(f)) return true;
    warnings.push(`skipped font name ${JSON.stringify(f)}: not a plain family name`);
    return false;
  });
  if (!families.length) warnings.push("deck.css names no --slide-font-display / --slide-font-body family; nothing to embed");
  const weights = usedWeights([authored, ...htmls]);
  const text = deckCharacters(htmls);
  const flavor = hasBrotli() ? "woff2" : "woff";
  const signature = createHash("sha256").update(JSON.stringify({ families, weights, text, flavor, v: 1 })).digest("hex").slice(0, 16);

  const current = css.match(/\/\* embedded-fonts:begin ([0-9a-f]{16}) \*\//);
  if (current && current[1] === signature) {
    return { ok: true, faces: (css.match(/@font-face/g) || []).length, bytes: 0, families, weights, reused: true, warnings };
  }

  const dir = await mkdtemp(join(tmpdir(), "deckfonts-"));
  const faces = [];
  let bytes = 0;
  try {
    for (const family of families) {
      const done = new Set();   // one face per file: a variable font covers every weight
      for (const weight of weights) {
        const found = fontFile(family, weight);
        if (!found) { warnings.push(`"${family}" is not installed (fc-list); the deck renders in a fallback face. Pick an installed family`); break; }
        if (done.has(found.file)) continue;
        done.add(found.file);
        let outFile;
        try { outFile = subset(found.file, text, dir, flavor); }
        catch (e) { warnings.push(`could not cut ${found.file}: ${String(e.stderr || e.message).slice(0, 200)}`); continue; }
        const data = await readFile(outFile);
        if (data.length > MAX_FACE_BYTES) { warnings.push(`${family} ${weight} is ${data.length} bytes after cutting; skipped (over ${MAX_FACE_BYTES})`); continue; }
        bytes += data.length;
        const b64 = data.toString("base64");
        const wrapped = b64.match(new RegExp(`.{1,${WRAP}}`, "g")).join("\\\n");
        const weightDecl = found.variable ? "100 900" : String(weight);
        faces.push(`@font-face {\n  font-family: "${family}";\n  font-style: normal;\n  font-weight: ${weightDecl};\n  font-display: block;\n  src: url("data:font/${flavor};base64,${wrapped}") format("${flavor}");\n}`);
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  const next = faces.length
    ? `${authored.replace(/\s*$/, "")}\n\n${BEGIN} ${signature} */\n/* Written by embed_deck_fonts.mjs from the installed font files. Don't edit by hand; edit the rules above. */\n${faces.join("\n")}\n${END}\n`
    : `${authored.replace(/\s*$/, "")}\n`;
  if (next !== css) {
    const tmp = `${cssPath}.${process.pid}.tmp`;
    await writeFile(tmp, next, "utf8");
    await rename(tmp, cssPath);
  }
  return { ok: true, faces: faces.length, bytes, families, weights, flavor, reused: false, warnings };
}

run(parseArgs(process.argv.slice(2)))
  .then((r) => { process.stdout.write(JSON.stringify(r) + "\n"); process.exit(0); })
  .catch((e) => { process.stdout.write(JSON.stringify({ ok: false, error: e.message }) + "\n"); process.exit(1); });
