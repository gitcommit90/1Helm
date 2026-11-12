#!/usr/bin/env node
// Start a deck from one of the vendored templates (app-assets/deck-templates/<name>/ in the repository, /opt/1hc/deck-templates/<name>/ on the computer), or add a slide to a deck.
//
//   node new_deck.mjs <abs project dir> --template <name> --title "<deck title>" --data <slides.json> [--redo]
//   node new_deck.mjs <abs project dir> --template <name> --title "<deck title>" --slides <pattern>,<pattern>,...
//   node new_deck.mjs <abs project dir> --add <pattern> [--after <slide id>]
//   node new_deck.mjs --patterns <name>          the template's slide patterns, and the numbered text of its cover and closing slides
//
// A deck starts from --data (one file holds every slide's words) or from --slides, which lists
// the template's slide patterns in the order the deck shows them. A pattern may repeat (three "stats" slides);
// each use becomes its own file, .src/slides/<NN>-<pattern>.html, a copy of the template's sample slide with its sample words.
// --data builds the whole deck from one file (--redo starts a deck again from its data file; its .src/media stays, and slide files changed by hand are thrown away):
//   {"slides": [ {"pattern": "title-cover", "text": ["2026", "AI Impact Report", ...], "notes": "..."},
//                {"pattern": "project", "title": "...", "users": "Support, 120 agents", "problem": "...", "built": "...",
//                 "impact": [{"value": "42%", "label": "repeat tickets"}], "notes": "..."},
//                {"pattern": "media", "title": "...", "body": "...", "drop": "label of the empty picture box"} ]}
// "trend" (a pattern whose change figures carry data-trend, see --patterns) says which way each change figure moved, one string for each figure in reading order
// ("up", "down", "flat", "none"; add "good" or "bad" only when the data says so, e.g. "down good" for fewer defects). With no "trend" the direction follows a leading + or - in the figure's own words and the colour stays neutral.
// "text" (any pattern) is one string for each piece of the pattern's text in reading order ("" removes one): --patterns <template>
// numbers the pieces of the template's cover and closing slides. "impact" holds one or two figures ([] none): "value" is the whole figure as a reader says it ("3 days → 4 hours", "2.4×"), "label" what it measures. "replace" swaps one piece
// of a pattern's sample words for yours ({"sample words": "yours"}, "" removes it, the longest keys first). "notes" is the speaker note.
// Otherwise rewrite the words (and the number of items) in each file. .src/deck.json holds the order: to drop a slide, remove it there and
// delete its file; to move one, reorder it there. Speaker notes go in .src/notes.json, one string per slide, in order.
//   node new_deck.mjs --show <template> <pattern> [<pattern>...]    prints each pattern's full slide markup, to write a slide by hand
// Prints each slide file it wrote. Exit 0 ok, 1 failed, 2 bad arguments.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { TEMPLATES, templateFileSet, templatesFor } from "./deck_templates_dir.mjs";
import { fileURLToPath } from "node:url";
import { fitSlide, loadFit, markUnits, unitsOf } from "./deck_fit.mjs";
import { FIG, fitFigures, figureText, sizeFigure } from "./deck_figures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const fail = (msg, code = 1, extra = {}) => { console.log(JSON.stringify({ ok: false, error: `new_deck: ${msg}`, ...extra })); process.exit(code); };
if (!argv.length || argv.includes("--help") || argv.includes("-h")) {
  const L = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n"), end = L.findIndex((l, i) => i > 0 && !l.startsWith("//"));
  process.stdout.write(L.slice(1, end).map((l) => l.replace(/^\/\/ ?/, "")).join("\n") + "\n"); process.exit(argv.length ? 0 : 2);
}

// The template's sample slides: pattern name -> file.
function patterns(name, root = TEMPLATES) {
  const dir = join(root, name, "slides");
  if (!/^[a-z0-9-]+$/.test(name) || !existsSync(dir)) fail(`unknown template "${name}". The names are in the deck-templates reference.`, 2);
  return readdirSync(dir).sort().map((f) => { const m = f.match(/^(\d+)-(.+)\.html$/); return { orig: m[1], pattern: m[2], file: join(dir, f) }; });
}
const NAMED = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", rsquo: "\u2019", lsquo: "\u2018", rdquo: "\u201d", ldquo: "\u201c", mdash: "\u2014", ndash: "\u2013", middot: "\u00b7", hellip: "\u2026", times: "\u00d7", copy: "\u00a9", bull: "\u2022", rarr: "\u2192", larr: "\u2190", laquo: "\u00ab", raquo: "\u00bb", deg: "\u00b0", euro: "\u20ac" };
const unesc = (t) => t.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, d, h, n) => d ? String.fromCodePoint(Number(d)) : h ? String.fromCodePoint(parseInt(h, 16)) : (NAMED[n.toLowerCase()] ?? m));
const words = (html) => unesc(html.replace(/<(script|style|svg)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

// The pieces of text of a slide, in reading order (what --patterns numbers and "text": [...] replaces). Text in script, style and svg is not one.
const PROTECT = /<(script|style|svg)[\s\S]*?<\/\1>/gi;
const pieces = (html) => [...html.replace(PROTECT, "").matchAll(/>([^<>]+)</g)].map((m) => unesc(m[1]).replace(/\s+/g, " ").trim()).filter(Boolean);
function replacePieces(html, list, where, pattern) {
  const have = pieces(html).length;
  if (list.length !== have) fail(`${where}: the "${pattern}" pattern has ${have} pieces of text and "text" has ${list.length}. Give one string for each, in order ("" removes one): node new_deck.mjs --patterns <template> numbers them`, 2);
  const keep = []; html = html.replace(PROTECT, (m) => `\u0000${keep.push(m) - 1}\u0000`);
  let i = 0;
  // A protected block (an svg) stands in the markup as \u0000N\u0000: it is not a piece of text, so it keeps its place and takes no string from the list.
  html = html.replace(/>([^<>]+)</g, (m, seg) => {
    const ph = /\u0000\d+\u0000/g, bare = seg.replace(ph, "");
    if (!unesc(bare).trim()) return m;
    const t = String(list[i++] ?? ""), lead = (seg.match(/^(?:\s*\u0000\d+\u0000)*/) || [""])[0].trim(), tail = (seg.match(/(?:\u0000\d+\u0000\s*)*$/) || [""])[0].trim();
    return ">" + lead + (t ? esc(t) : "\u0001") + tail + "<";
  });
  // A piece set to "" takes its own empty button, link or line with it, so no empty pill or gap stays on the slide.
  for (let k = 0; k < 4; k++) html = html.replace(/<(a|button|p|span|li|h[1-6]|small|label|em|strong)\b[^>]*>\s*\u0001\s*<\/\1>/gi, "\u0001");
  html = html.replace(/\u0001/g, "");
  return html.replace(/\u0000(\d+)\u0000/g, (m, n) => keep[n]);
}

// A pattern whose change figures follow the data says so in --patterns and --show.
const trendNote = (html) => { const n = (html.match(/\sdata-trend="/g) || []).length; return n ? `[trend: ${n} change figure${n > 1 ? "s" : ""}, "trend": ["up"|"down"|"flat"|"none" (+ "good"|"bad")] one for each] ` : ""; };

if (opt("patterns")) {
  for (const p of patterns(opt("patterns"))) {
    const html = readFileSync(p.file, "utf8"), slots = [...html.matchAll(/data-slot="(\w+)"/g)].map((m) => m[1]);
    console.log(`${p.pattern.padEnd(22)} ${slots.length ? `[fields: ${slots.filter((x) => x !== "media" && !/^stat\d-box$|^stat\d_label$/.test(x)).map((x) => x === "label" ? "users" : x === "stat1" || x === "stat2" ? null : x).filter(Boolean).join(", ")}, drop] ` : ""}${trendNote(html)}${words(html).slice(0, 90)}`);
  }
  let ends = {}; try { ends = JSON.parse(readFileSync(join(TEMPLATES, opt("patterns"), "ends.json"), "utf8")); } catch {}
  for (const [role, name] of Object.entries(ends)) {
    const p = patterns(opt("patterns")).find((x) => x.pattern === name); if (!p) continue;
    const list = pieces(readFileSync(p.file, "utf8"));
    console.log(`\nThe ${role} slide is the "${name}" pattern. Its ${list.length} pieces of text, in order ("text": [one string for each, "" removes one]):`);
    const px = ends.sizes?.[role], big = px && px.length === list.length ? Math.max(...px) : 0;   // the text sizes measured on the slide (scripts/vendor-ends.mjs)
    const tag = (k) => !big ? "" : px[k] >= 0.6 * big ? "[headline] " : px[k] <= Math.max(22, 0.25 * big) ? "[small label] " : "[text] ";
    list.forEach((t, k) => console.log(`${String(k + 1).padStart(3)} ${tag(k)}${JSON.stringify(t.length > 110 ? t.slice(0, 107) + "..." : t)}`));
  }
  process.exit(0);
}

if (opt("show")) {   // --show <template> <pattern>...: the full markup of each pattern's sample slide
  const name = opt("show"), want = argv.slice(argv.indexOf("--show") + 2).filter((x) => !x.startsWith("--")), all = patterns(name);
  if (!want.length) fail(`name the patterns to show. The ${name} template has: ${all.map((x) => x.pattern).join(", ")}`, 2);
  for (const w of want) {
    const p = all.find((x) => x.pattern === w);
    if (!p) fail(`the ${name} template has no slide pattern "${w}". Its patterns: ${all.map((x) => x.pattern).join(", ")}`, 2);
    const tn = trendNote(readFileSync(p.file, "utf8"));
    console.log(`----- ${name} / ${w}${tn ? `\n(${tn.trim()}; with no "trend" the direction follows a leading + or - and the colour stays neutral)` : ""}\n${readFileSync(p.file, "utf8").trim()}\n`);
  }
  process.exit(0);
}

// A relative project folder (and a relative --data file) is resolved against the folder the command runs in.
const P = argv[0] && !argv[0].startsWith("--") ? resolve(argv[0]) : "";
if (!P) fail("the first argument is the project folder, e.g. /workspace/workspace/kyoto-in-three-days", 2);
const SRC = join(P, ".src"), SL = join(SRC, "slides");
const wrote = [];

// Words that fit no size of their box, collected over the whole deck and reported together (see fitProblemsText).
const FITS = { problems: [], changed: [] };
const SLOT_FIELD = { title: "title", body: "body", media: "drop", label: "users", problem: "problem", built: "built", stat1_label: "impact label", stat2_label: "impact label" };
function writeSlide(tpl, pattern, n, entry = null) {
  const p = tpl.find((x) => x.pattern === pattern);
  if (!p) fail(`${n ? `slide ${n}: ` : ""}this template has no slide pattern "${pattern}". Its patterns: ${tpl.map((x) => x.pattern).join(", ")}`, 2);
  const id = `${String(n).padStart(2, "0")}-${pattern}`;
  let html = readFileSync(p.file, "utf8");
  const filled = !!entry && (["title", "body", "drop", "users", "problem", "built", "impact", "text", "trend"].some((k) => entry[k] !== undefined) || !!entry.replace);
  if (filled) {
    // Every block of text the template measured for this pattern is marked, so the words that go in can be sized to its room afterwards.
    const fit = loadFit(TEMPLATES, FIG.name), units = unitsOf(fit, pattern);
    if (units.length) html = markUnits(html, units.map((x) => ({ i: x.i, u: x.u })));
    html = fill(html, entry, `slide ${n}`);
    if (units.length) {
      const r = fitSlide(html, fit, pattern, { skip: (rec) => /^stat[12]$/.test(rec.slot || "") });
      html = r.html;
      for (const c of r.changed) { const rec = units.find((x) => x.u === c.u); FITS.changed.push({ id, slot: rec?.slot || "", from: c.from, to: c.to }); }
      for (const q of r.problems) FITS.problems.push({ n, id, pattern, ...q, slot: SLOT_FIELD[q.slot] || q.slot });
    }
  }
  writeFileSync(join(SL, `${id}.html`), html);
  wrote.push({ id, path: join(SL, `${id}.html`), html, filled });
  return { id, pattern, orig: p.orig };
}

// An impact figure reads alone: "value" is the whole figure as a reader says it ("3 days → 4 hours", "9 → 5 days", "2.4×", or with no digit at all,
// "Days → seconds", "Multi-six-figure") and "label" says what it measures ("report time"). A figure split in the middle of a phrase ("3 days" and "to 4 hours: report time cut") is refused with the fix.
// A connector starts a split figure only when a number follows it ("to 4 hours"); "to get an answer" is a label that reads on its own.
const UNIT_FIRST = /^(?:(?:to|from|of|by|than|and|then)\s+[$\u20ac\u00a3~]?\d|(?:→|->|×|x|%|percent|per cent|times|days?|hours?|minutes?|weeks?|months?|years?|hrs?|mins?)(?![\w-]))/i;
const SYMBOL_FIRST = /^(?:→|->|×|%)/;
const UNIT_ONLY = /^(?:to|from|of|by|than|and|then|per|percent|times|days?|hours?|minutes?|weeks?|months?|years?|hrs?|mins?|[%\u00d7x\u2192]|->)$/i;
function figureProblem(it) {
  const value = String(it.value ?? "").trim(), label = String(it.label ?? "").trim();
  if (!value) return 'has no "value". The value is the whole figure as a reader says it ("38%", "9 → 5 days", "2.4×", or in words "Days → seconds", "Multi-six-figure").';
  if (UNIT_ONLY.test(value)) return `has a "value" that is only a unit or a joining word ("${value}"). The value is the whole figure as a reader says it ("38%", "9 → 5 days", or in words "Days → seconds"), and the label says what it measures.`;
  if (/(?:\bto|\bfrom|\bof|\bby|\bthan|→|->)\s*$/i.test(value)) return `has a "value" that stops in the middle of a figure ("${value}"). Put the whole figure in "value" ("3 days → 4 hours") and only what it measures in "label" ("report time").`;
  if ((/\d/.test(value) ? UNIT_FIRST : SYMBOL_FIRST).test(label)) return `has a "label" that starts with part of the figure ("${label}"). Move that part into "value" ("2.4×", "9 → 5 days") and make the label say what it measures ("reported hazards", "close time").`;
  return "";
}
const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Fill one slide's slots and text swaps from a --data entry.
function fill(html, e, where) {
  for (const [field, slot] of [["title", "title"], ["body", "body"], ["drop", "media"], ["users", "label"], ["problem", "problem"], ["built", "built"]]) {
    if (e[field] === undefined) continue;
    const re = new RegExp(`(<(\\w+)[^>]*\\sdata-slot="${slot}"[^>]*>)[\\s\\S]*?(</\\2>)`);
    if (!re.test(html)) fail(`${where}: the "${e.pattern}" pattern has no "${field}" field. Use "replace" with its sample words (new_deck.mjs --patterns <template>)`, 2);
    const text = (Array.isArray(e[field]) ? e[field] : [e[field]]).map(esc).join("<br>");
    html = html.replace(re, (m, a, t, c) => a + text + c);
  }
  if (e.text !== undefined) {   // any pattern: one string for each piece of its text, in reading order (new_deck.mjs --patterns numbers them)
    if (!Array.isArray(e.text)) fail(`${where}: "text" is a list with one string for each piece of the pattern's text`, 2);
    html = replacePieces(html, e.text, where, e.pattern);
  }
  if (e.impact !== undefined) {   // the "project" pattern: up to two numbers, each {"value", "label"}; a missing second one leaves no empty space
    const list = [].concat(e.impact).filter((x) => x && x.value !== undefined);
    if (!/data-slot="stat1"/.test(html)) fail(`${where}: the "${e.pattern}" pattern has no "impact" field`, 2);
    if (list.length > 2) fail(`${where}: "impact" holds at most two numbers; put the rest in "body" words or another slide`, 2);
    for (const it of list) { const bad = figureProblem(it); if (bad) fail(`${where}: impact ${JSON.stringify(it)} ${bad}`, 2); }
    if (!list.length) html = html.replace(/<div data-slot="stat1-box"[\s\S]*?<\/div>/, "").replace(/<div data-slot="stat2-box"[\s\S]*?<\/div>/, "").replace(/<div data-slot="impact"[^>]*>\s*<\/div>/, "");
    else {
      const base = Number((html.match(/data-slot="stat1"[^>]*font-size:(\d+)px/) || [])[1]) || 120;
      const fit = fitFigures(list.map((x) => String(x.value)), base, list.length);
      if (!fit.ok) {
        const bad = list.find((x) => !fitFigures([String(x.value)], base, list.length).ok) || list[0], v = String(bad.value);
        let n = v.length; while (n > 3 && !fitFigures([v.slice(0, n)], base, list.length).ok) n--;
        fail(`${where}: the impact figure "${v}" is too long for the ${FIG.name} template's big number (${list.length === 2 ? "the two figures are stacked and each gets" : "it gets"} a ${fit.width}px column, and it needs more than two lines at 40px). Fix: in the "impact" entry whose "value" is "${v}", shorten "value" to about ${n} characters or fewer ("3 days → 4 hours" becomes "3d → 4h", "1.7B+ impressions" becomes "1.7B+") and put the unit in "label", or give this slide one impact entry instead of two. Then run the same new_deck command again with --redo.`, 2);
      }
      [1, 2].forEach((n) => {
        const it = list[n - 1];
        if (!it) { html = html.replace(new RegExp(`<div data-slot="stat${n}-box"[^>]*>[\\s\\S]*?</div>`), ""); return; }
        for (const [slot, v] of [[`stat${n}`, it.value], [`stat${n}_label`, it.label ?? ""]]) html = html.replace(new RegExp(`(<p data-slot="${slot}"[^>]*>)[\\s\\S]*?(</p>)`), (m, a, c) => (slot === `stat${n}` ? sizeFigure(a, fit) + esc(figureText(v)) : a + esc(v)) + c);
        if (fit.px < base) html = html.replace(new RegExp(`(<div data-slot="stat${n}-box" style="[^"]*?)max-width:none`), `$1max-width:${fit.width}px`);
      });
      if (fit.stack && list.length === 2) html = html.replace(/(<div data-slot="impact" style="[^"]*?)display:flex;gap:\d+px/, "$1display:flex;flex-direction:column;gap:28px");
    }
  }
  for (const [from, to] of Object.entries(e.replace || {}).sort((a, b) => b[0].length - a[0].length)) {   // the longest piece first, so a short key never eats part of a longer one
    let hit = false;
    html = html.replace(/>([^<>]+)</g, (m, seg) => {   // whitespace in the markup (line breaks, indents) doesn't matter to the match
      const u = unesc(seg).replace(/\s+/g, " "), key = String(from).replace(/\s+/g, " ");
      if (!u.includes(key)) return m;
      hit = true; return ">" + (/^\s/.test(seg) ? " " : "") + esc(u.split(key).join(to)).trim() + (/\s$/.test(seg) ? " " : "") + "<";
    });
    if (!hit) fail(`${where}: the text "${from}" is not in the "${e.pattern}" pattern. Its words: ${words(html).slice(0, 160)}`, 2);
  }
  return applyTrends(html, e, where);
}

// Change figures (data-trend="up|down|flat" plus an optional "good" or "bad") take their direction from the entry's "trend" or from the sign the figure's own words start with,
// and their tone only from the entry, so a sample's red or green never stays on words that say something else.
const TREND_WORDS = ["up", "down", "flat", "none", "good", "bad"];
const TREND_EL = /(<(\w+)\b[^>]*?\sdata-trend=")([^"]*)("[^>]*>)([\s\S]*?)(<\/\2>)/g;
function applyTrends(html, e, where) {
  const has = /\sdata-trend="/.test(html);
  if (e.trend !== undefined && !has) fail(`${where}: the "${e.pattern}" pattern has no change figures, so it has no "trend" field`, 2);
  const given = e.trend === undefined ? [] : Array.isArray(e.trend) ? e.trend : [e.trend];
  for (const g of given) for (const w of String(g ?? "").toLowerCase().split(/[\s,]+/).filter(Boolean)) if (!TREND_WORDS.includes(w)) fail(`${where}: "trend" has "${w}". Use "up", "down", "flat" or "none", and add "good" or "bad" only when the data says so ("down good")`, 2);
  const n = (html.match(/\sdata-trend="/g) || []).length;
  if (e.trend !== undefined && Array.isArray(e.trend) && e.trend.length > n) fail(`${where}: "trend" has ${e.trend.length} entries and the "${e.pattern}" pattern has ${n} change figures`, 2);
  let i = 0;
  return html.replace(TREND_EL, (m, a, tag, old, b, inner, close) => {
    const g = e.trend === undefined ? "" : String(Array.isArray(e.trend) ? e.trend[i] ?? "" : e.trend).toLowerCase(); i++;
    const w = g.split(/[\s,]+/).filter(Boolean);
    let dir = w.find((x) => ["up", "down", "flat", "none"].includes(x)) || "";
    if (!dir) { const t = unesc(inner.replace(/<[^>]+>/g, "")).trim(); dir = /^[+\uff0b]/.test(t) ? "up" : /^[-\u2212\u2013\u2014]/.test(t) ? "down" : ""; }
    const tone = dir === "none" ? "" : w.find((x) => x === "good" || x === "bad") || "";
    return a + [dir === "none" ? "" : dir, tone].filter(Boolean).join(" ") + b + inner + close;
  });
}

// What to change when words fit no size of their box: which field of which slide, how long the words may be, and the command to run again.
function fitProblemsText(list) {
  const lines = list.slice(0, 6).map((q) => {
    const field = q.slot ? `"${q.slot}"` : "that text";
    const quoted = `"${q.text.length > 70 ? q.text.slice(0, 67) + "..." : q.text}"`;
    if (q.kind === "caption") return `slide ${q.n} (the "${q.pattern}" pattern): ${field} reads ${quoted} and is a caption set at ${q.size}px in the ${FIG.name} template, where text of 40 or more characters is too small to read. Fix: in the entry for slide ${q.n} of the data file, shorten ${field} to under 40 characters (for example "${q.fix}"), or put the detail in "notes".`;
    if (q.kind === "word") return `slide ${q.n} (the "${q.pattern}" pattern): ${field} reads ${quoted} and the word "${q.word}" (${q.word.length} letters) is wider than the ${Math.round(q.width)}px line of the ${FIG.name} template even at ${q.floor}px. Fix: in the entry for slide ${q.n} of the data file, replace that word in ${field} with one of about ${q.letters} letters or fewer, or put the detail in "notes".`;
    return `slide ${q.n} (the "${q.pattern}" pattern): ${field} reads ${quoted} and needs more lines than its box in the ${FIG.name} template has, even at ${q.floor}px. Fix: in the entry for slide ${q.n} of the data file, change ${field} to about "${q.fix}" (${q.fix.length} characters, which is what the box holds), or put the detail in "notes".`;
  });
  return `${list.length} text${list.length > 1 ? "s do" : " does"} not fit its box. ${lines.join(" ")}${list.length > 6 ? ` And ${list.length - 6} more.` : ""} Then run the same new_deck command again with --redo.`;
}

// Every field a --data entry may hold, and the template slots a pattern needs to take it. An entry with no "pattern" gets the one pattern of the template that has
// a slot for each of its fields (a project entry: users, problem, built, impact; a media entry: title, body, drop). More than one fits, or none, and the error names the slide.
const NOTES = [];
const ENTRY_SLOTS = { title: ["title"], body: ["body"], drop: ["media"], users: ["label"], problem: ["problem"], built: ["built"], impact: ["stat1"] };
const ENTRY_KEYS = [...Object.keys(ENTRY_SLOTS), "text", "replace", "trend", "notes", "pattern"];
function resolveEntry(e, n, tpl) {
  if (!e || typeof e !== "object" || Array.isArray(e)) fail(`slide ${n} of the data file is not an object. Each slide is {"pattern": "...", "title": "...", ...}`, 2);
  for (const k of Object.keys(e).filter((k) => !ENTRY_KEYS.includes(k))) NOTES.push(`note: slide ${n} field "${k}" isn't a slot in ${e.pattern ? `the "${e.pattern}" pattern` : "a pattern"}, so it was left out; new_deck.mjs --show <template> <pattern> lists the slots`);
  if (e.pattern !== undefined && (typeof e.pattern !== "string" || !e.pattern.trim())) fail(`slide ${n}: "pattern" must be the name of one of the template's slide patterns (${tpl.map((x) => x.pattern).join(", ")})`, 2);
  if (e.notes !== undefined && typeof e.notes !== "string") fail(`slide ${n}: "notes" must be one string of speaker notes`, 2);
  for (const k of ["title", "body", "drop", "users", "problem", "built"]) if (e[k] !== undefined && typeof e[k] !== "string" && !(Array.isArray(e[k]) && e[k].every((x) => typeof x === "string"))) fail(`slide ${n}: "${k}" must be a string (or a list of strings, one for each line)`, 2);
  if (e.impact !== undefined) {
    const list = [].concat(e.impact);
    if (!list.every((x) => x && typeof x === "object" && !Array.isArray(x))) fail(`slide ${n}: "impact" must be a list of {"value": "...", "label": "..."}, for example [{"value": "42%", "label": "repeat tickets"}]`, 2);
  }
  if (e.replace !== undefined && (!e.replace || typeof e.replace !== "object" || Array.isArray(e.replace))) fail(`slide ${n}: "replace" must be an object that maps sample words to new words`, 2);
  if (e.pattern !== undefined) return { ...e, pattern: e.pattern.trim() };
  const fields = Object.keys(ENTRY_SLOTS).filter((k) => e[k] !== undefined);
  const fits = tpl.filter((p) => { const html = readFileSync(p.file, "utf8"); return fields.every((k) => ENTRY_SLOTS[k].every((s) => html.includes(`data-slot="${s}"`))); }).map((p) => p.pattern);
  const names = [...new Set(fits)];
  if (e.text === undefined && fields.length && names.length === 1) return { ...e, pattern: names[0] };
  if (e.text === undefined && fields.length && names.length > 1) {   // title alone fits both project and media; a field only one of them has decides
    const own = names.filter((nm) => fields.some((k) => !tpl.filter((p) => names.includes(p.pattern) && p.pattern !== nm).some((p) => ENTRY_SLOTS[k].every((s) => readFileSync(p.file, "utf8").includes(`data-slot="${s}"`)))));
    if (own.length === 1) return { ...e, pattern: own[0] };
  }
  const could = (e.text !== undefined || !names.length ? tpl.map((p) => p.pattern) : names);
  fail(`slide ${n} has no "pattern" and its fields (${Object.keys(e).filter((k) => k !== "notes").map((k) => `"${k}"`).join(", ") || "none"}) do not point to one pattern. It could be: ${[...new Set(could)].join(", ")}. Add "pattern": "<name>" to slide ${n} of the data file (new_deck.mjs --patterns <template> lists them)`, 2);
}

let deck;
if (opt("add")) {
  try { deck = JSON.parse(readFileSync(join(SRC, "deck.json"), "utf8")); } catch { fail(`no ${SRC}/deck.json: start the deck first`, 2); }
  const next = Math.max(0, ...deck.slides.map((s) => parseInt(s.id, 10) || 0)) + 1;
  FIG.name = deck.template; FIG.root = templatesFor(P);
  const entry = writeSlide(patterns(deck.template, templatesFor(P)), opt("add"), next);
  const after = opt("after") ? deck.slides.findIndex((s) => s.id === opt("after")) : deck.slides.length - 1;
  if (opt("after") && after < 0) fail(`no slide "${opt("after")}" in deck.json`, 2);
  deck.slides.splice(after + 1, 0, entry);
} else {
  let data = null;
  if (opt("data")) { try { data = JSON.parse(readFileSync(opt("data"), "utf8")); } catch (e) { fail(`can't read --data: ${e.message}`, 2); } }
  const template = opt("template") || data?.template, title = opt("title") || data?.title;
  if (data && (typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.slides))) fail('the --data file must be an object with a "slides" list: {"slides": [ {...}, {...} ]}', 2);
  if (!template) fail('no template. Give --template <name> (or "template" in the data file)', 2);
  if (!title) fail('no title. Give --title "<deck title>" (or "title" in the data file)', 2);
  const tpl = patterns(template);
  const entries = data ? data.slides.map((e, i) => resolveEntry(e, i + 1, tpl)) : String(opt("slides") || "").split(",").map((s) => s.trim()).filter(Boolean).map((pattern) => ({ pattern }));
  if (entries.length < 1) fail(data ? 'the data file has no slides: "slides" is an empty list' : "no slides. Give --slides pattern,pattern,... or --data slides.json", 2);
  if (argv.includes("--redo")) { rmSync(join(SRC, "deck.json"), { force: true }); rmSync(SL, { recursive: true, force: true }); rmSync(join(SRC, "template"), { recursive: true, force: true }); rmSync(join(SRC, "build"), { recursive: true, force: true }); }
  if (existsSync(join(SRC, "deck.json"))) fail(`${SRC}/deck.json exists: this deck is already started (use --add to add a slide)`, 2);
  mkdirSync(SL, { recursive: true });
  mkdirSync(join(SRC, "media"), { recursive: true });
  FIG.name = template;
  // The deck keeps its own copy of what it needs from the template (slides, head and tail, its fonts, the shared scripts, the license), so
  // building, checking and exporting read only this folder and never the shared one.
  for (const f of templateFileSet(TEMPLATES, template)) { const to = join(SRC, "template", f); mkdirSync(dirname(to), { recursive: true }); copyFileSync(join(TEMPLATES, f), to); }
  deck = { template, title, slides: entries.map((e, i) => writeSlide(tpl, e.pattern, i + 1, e)) };
  writeFileSync(join(SRC, "notes.json"), JSON.stringify(entries.map((e) => e.notes || ""), null, 1) + "\n");
}
if (FITS.problems.length) fail(fitProblemsText(FITS.problems), 2, { problems: FITS.problems.map((q) => ({ slide: q.n, pattern: q.pattern, field: q.slot || "", text: q.text, ...(q.word ? { word: q.word, letters: q.letters } : {}), fix: q.fix })) });
writeFileSync(join(SRC, "deck.json"), JSON.stringify(deck, null, 1) + "\n");
// A deck built from a data file: remember the file, so a cut-off text can be traced to its field in it.
if (opt("data")) writeFileSync(join(SRC, "data_build.json"), JSON.stringify({ data: resolve(opt("data")) }, null, 1) + "\n");
else rmSync(join(SRC, "data_build.json"), { force: true });

const S = "/opt/1hc/skills/artifacts/scripts";
const todo = wrote.filter((w) => !w.filled), done = wrote.length - todo.length;
console.log([
  `new_deck: ${deck.slides.length} slides in ${P} from the ${deck.template} template; order in .src/deck.json: ${deck.slides.map((s) => s.id).join(", ")}`,
  ...(done ? [`${done} slide(s) were filled from the data file.`] : []),
  ...NOTES,
  ...(FITS.changed.length ? [`${FITS.changed.length} text(s) were set smaller to fit their boxes: ${FITS.changed.slice(0, 6).map((c) => `${c.id}${c.slot ? " " + c.slot : ""} ${c.from}px to ${c.to}px`).join(", ")}${FITS.changed.length > 6 ? ", ..." : ""}.`] : []),
  "",
  todo.length ? "Next: rewrite the slide file(s) below with the deck's own words (keep the outer element, classes and structure; change the number of items by" : "Next:",
  todo.length ? "copying or removing one), put each slide's speaker notes in .src/notes.json, then run:" : "put each slide's speaker notes in .src/notes.json if they aren't there yet, then run:",
  `  bash ${S}/make_deck.sh ${P}`,
  "",
  ...(todo.length > 8 ? [`(${todo.length} slide files still have the template's sample words: .src/slides/${todo[0].id}.html and the rest; write them in full, one write_file each, in one step)`] : todo.flatMap((w) => [`----- ${w.path}`, w.html.trim(), ""])),
].join("\n"));
