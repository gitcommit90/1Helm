#!/usr/bin/env node
// Start a new deck in one command: folders, the style plan, deck.css (the plan's :root block + deck_template.css), deck.json and
// one skeleton file per slide in the layout the plan gave it (from deck_layouts.html). Then you replace the FILL IN lines in the
// slide files and run make_deck.sh.
//
//   node new_deck.mjs <abs project dir> --title "<deck title>" --slides cover,<id>,...,closing [--brief "<request + look>"] [--force]
//   node new_deck.mjs <abs project dir> --input <style-plan-input.json>     ({"title","brief","slide_ids"} from a file)
//
// Slide ids: kebab-case, cover first, closing last, never "index". Existing slide files are kept unless --force.
// Prints a short summary and every skeleton file it wrote. Exit 0 ok, 1 failed, 2 bad arguments.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
if (!argv.length || argv.includes("--help") || argv.includes("-h")) { process.stdout.write(usage()); process.exit(argv.length ? 0 : 2); }
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const fail = (msg, code = 1) => { console.log(JSON.stringify({ ok: false, error: `new_deck: ${msg}` })); process.exit(code); };

const P = argv[0];
if (!P || !P.startsWith("/") || P.startsWith("--")) fail("the first argument is the absolute project folder, e.g. /workspace/workspace/kyoto-in-three-days", 2);
let input;
if (opt("input")) { try { input = JSON.parse(readFileSync(opt("input"), "utf8")); } catch (e) { fail(`can't read --input: ${e.message}`, 2); } }
else input = { title: opt("title"), brief: opt("brief") || opt("title"), slide_ids: String(opt("slides") || "").split(",").map((s) => s.trim()).filter(Boolean) };
if (!input.title) fail("--title is required", 2);
if (!Array.isArray(input.slide_ids) || input.slide_ids.length < 2) fail("--slides needs the slide ids in order, e.g. cover,day-1,day-2,closing", 2);
const ids = input.slide_ids;
for (const id of ids) if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id) || id === "index") fail(`bad slide id "${id}": lowercase kebab-case, never "index"`, 2);
if (new Set(ids).size !== ids.length) fail("slide ids must be unique", 2);

const SRC = join(P, ".src"), SL = join(SRC, "slides");
for (const d of [SL, join(SRC, "media"), join(SRC, "validate")]) mkdirSync(d, { recursive: true });
const inFile = join(SRC, "style-plan-input.json");
writeFileSync(inFile, JSON.stringify({ title: input.title, brief: input.brief || input.title, slide_ids: ids }, null, 1) + "\n");
let plan;
try { plan = JSON.parse(execFileSync(process.execPath, [join(HERE, "slide_style.mjs"), "plan", "--input", inFile], { encoding: "utf8" })); }
catch (e) { fail(`slide_style.mjs failed: ${String(e.stdout || e.message).slice(0, 300)}`); }
if (!plan.ok) fail(`slide_style.mjs: ${plan.error}`);
writeFileSync(join(SRC, "style_plan.json"), JSON.stringify(plan, null, 2) + "\n");

// deck.css: the plan's :root block, then the template. Kept if it exists (it may hold edits and the embedded fonts) unless --force.
const cssPath = join(SL, "deck.css"), force = argv.includes("--force");
if (!existsSync(cssPath) || force) writeFileSync(cssPath, `${plan.css_root}\n\n${readFileSync(join(HERE, "deck_template.css"), "utf8")}`);
writeFileSync(join(SL, "deck.json"), JSON.stringify({ main_title: input.title, slides: ids.map((id) => ({ id })) }, null, 1) + "\n");

// Skeletons from deck_layouts.html.
const cat = readFileSync(join(HERE, "deck_layouts.html"), "utf8"), layouts = {};
for (const m of cat.matchAll(/<!-- layout: ([\w-]+) -->\n([\s\S]*?)<!-- \/layout -->/g)) {
  const style = m[2].match(/<!-- style: ([\s\S]*?) -->\n/); layouts[m[1]] = { style: style?.[1] || "", section: m[2].replace(/<!-- style: [\s\S]*? -->\n/, "").trim() };
}
const lockups = (plan.lockups || ["L1", "L2"]).map((l) => `lockup-${String(l).toLowerCase()}`);
let two = 0;
const wrote = [], kept = [], files = [];
plan.layout_plan.forEach(({ id, layout }, i) => {
  const L = layouts[layout] || layouts[i === 0 ? "cover" : i === ids.length - 1 ? "closing" : "slide-headline-bullets"];
  const lock = layout === "slide-two-column" ? lockups[two++ % lockups.length] : "";
  const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const section = L.section.replaceAll("__ID__", id).replace(" __LOCKUP__", lock ? ` ${lock}` : "").replace("FILL IN the deck title", esc(input.title));
  const style = L.style ? `\n  <style>${L.style.replaceAll("__ID__", id)}</style>` : "";
  const html = `<!doctype html>\n<html><head>\n  <meta charset="utf-8">\n  <link rel="stylesheet" href="deck.css">${style}\n</head><body>\n${section}\n</body></html>\n`;
  const f = join(SL, `${id}.html`);
  if (existsSync(f) && !force) { kept.push(id); return; }
  writeFileSync(f, html); wrote.push(id); files.push({ id, layout: layout + (lock ? ` + ${lock}` : ""), path: f, html });
});

const S = "/opt/1hc/skills/artifacts/scripts";
const out = [
  `new_deck: ${ids.length} slides in ${P}`,
  `theme ${plan.theme} (${plan.mode}); fonts: ${plan.fonts.display} (headings), ${plan.fonts.body} (body); photos: ${plan.image_style}`,
  `layouts: ${plan.layout_plan.map((s) => `${s.id}=${s.layout}`).join(", ")}; lockups for text beside a photo: ${lockups.join(", ")}`,
  `wrote: .src/style_plan.json, .src/slides/deck.css (theme + every layout; don't rewrite it), .src/slides/deck.json, ${wrote.length} slide file(s)${kept.length ? `; kept existing: ${kept.join(", ")}` : ""}`,
  "",
  "Next:",
  `1. Photos, named after their slide (the media/... names in the files below), in one command:`,
  `   python3 /opt/1hc/skills/image-search/scripts/images.py fetch --to ${SRC}/media "${ids[0]}=<cover subject, wide>" "<id>=<subject>" ...`,
  `2. Replace every FILL IN line in each slide file below (write_file the whole file; keep its class names and media/ names). A slide may`,
  `   switch layout (see the presentation reference); remove a photo you don't have rather than leave a broken one.`,
  `3. bash ${S}/make_deck.sh ${P}`,
  "",
  ...files.flatMap((f) => [`----- ${f.path} (${f.layout})`, f.html.trim()]),
];
console.log(out.join("\n"));

function usage() {
  return readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1).filter((l) => l.startsWith("//")).map((l) => l.replace(/^\/\/ ?/, "")).join("\n") + "\n";
}
