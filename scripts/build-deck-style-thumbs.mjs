#!/usr/bin/env node
// Writes the deck style thumbnails the app shows in its style picker: for each deck template (app-assets/deck-templates/<name>/), its cover and
// its "project" slide as small webp pictures, plus app-assets/app-static/deck-styles/index.json (name, title, one-line feel, use, scheme, the
// template's content hash and the two picture names). The pictures are rendered from a real deck built with new_deck.mjs and make_deck's own
// Chrome tooling (deck_nav.mjs), so they look exactly like the template.
//   node scripts/build-deck-style-thumbs.mjs                 render every template again and write the files (needs Chrome, playwright-core and ffmpeg)
//   node scripts/build-deck-style-thumbs.mjs --only a,b      render only those templates (the index keeps the others as they are)
//   node scripts/build-deck-style-thumbs.mjs --check [--out <dir>]         exit 1 when a template changed (or its feel line in deck-templates.md) and its thumbnails
//                                                            were not rendered again, or a picture is missing (scripts/deploy.sh and the tests run this)
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifest } from "./build-deck-templates-manifest.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATES = join(REPO, "app-assets", "deck-templates"), OUT = join(REPO, "app-assets", "app-static", "deck-styles");
const SCRIPTS = join(REPO, "src", "skills", "artifacts", "scripts"), REFERENCE = join(REPO, "src", "skills", "artifacts", "references", "deck-templates.md");
export const THUMB = { width: 480, height: 270 }, LARGE = { width: 960, height: 540 };   // the grid shows THUMB; the focused preview shows LARGE

// The words one template line of deck-templates.md carries: "- name (light, medium, small): feel; for use."
export function styleLines(md = readFileSync(REFERENCE, "utf8")) {
  const out = {};
  for (const m of md.matchAll(/^- ([a-z0-9-]+) \(([^)]*)\): ([^\n]*?)(?:\n {2}Patterns:|$)/gm)) {
    const [feel, ...rest] = m[3].replace(/\.$/, "").split(/; for /);
    out[m[1]] = { feel: feel.trim(), use: rest.join("; for ").trim(), scheme: m[2].split(",")[0].trim() };
  }
  return out;
}

// index.json as text, from the templates now on disk. `keep` holds the earlier entries of templates that are not rendered again (--only).
export function buildIndex({ root = TEMPLATES, manifest, lines = styleLines(), keep = {}, rendered = null } = {}) {
  const hashes = JSON.parse(manifest || buildManifest(root)).templates, titles = Object.fromEntries(JSON.parse(readFileSync(join(root, "index.json"), "utf8")).templates.map((t) => [t.name, t.title]));
  const list = Object.keys(hashes).sort().map((name) => {
    const l = lines[name]; if (!l) throw new Error(`deck-templates.md has no line for the template ${name}`);
    const fresh = !rendered || rendered.includes(name), old = keep[name];
    return { name, title: titles[name] || name, feel: l.feel, use: l.use, scheme: l.scheme, hash: fresh ? hashes[name].hash : old?.hash || "", cover: `${name}-cover.webp`, project: `${name}-project.webp`, coverLarge: `${name}-cover-l.webp`, projectLarge: `${name}-project-l.webp` };
  });
  return JSON.stringify({ version: 1, size: THUMB, large: LARGE, templates: list }, null, 1) + "\n";
}

export function checkThumbs({ out = OUT } = {}) {
  const file = join(out, "index.json"); if (!existsSync(file)) return ["app-assets/app-static/deck-styles/index.json is missing"];
  const have = JSON.parse(readFileSync(file, "utf8")), now = JSON.parse(buildIndex({ rendered: [] , keep: Object.fromEntries(have.templates.map((t) => [t.name, t])) }));
  const bad = [], want = JSON.parse(buildManifest()).templates, lines = styleLines();
  for (const t of now.templates) {
    const was = have.templates.find((x) => x.name === t.name);
    if (!was) { bad.push(`${t.name}: no thumbnails`); continue; }
    if (was.hash !== want[t.name].hash) bad.push(`${t.name}: the template changed after its thumbnails were made`);
    else if (was.feel !== lines[t.name].feel || was.use !== lines[t.name].use || was.scheme !== lines[t.name].scheme || was.title !== t.title) bad.push(`${t.name}: its line in deck-templates.md changed after the index was made`);
    for (const f of [was.cover, was.project, was.coverLarge, was.projectLarge]) if (!existsSync(join(out, f)) || statSync(join(out, f)).size < 500) bad.push(`${t.name}: ${f} is missing`);
  }
  for (const t of have.templates) if (!now.templates.some((x) => x.name === t.name)) bad.push(`${t.name}: has thumbnails but no template`);
  return bad;
}

// The words every project slide gets, so the styles compare like for like (the box for the person's screenshot stays empty).
const PROJECT = { pattern: "project", title: "Support desk automation", users: "Support team, 120 agents", problem: "Agents retyped the same answers all day, and repeat tickets kept growing.",
  built: "A reply assistant inside the ticket tool that drafts answers from past tickets.", impact: [{ value: "42%", label: "fewer repeat tickets" }, { value: "3 days → 4 hours", label: "report time" }], drop: "Your screenshot" };

async function renderOne(name, work) {
  const dir = join(work, name), data = join(work, `${name}.json`), run = (cmd, args, env = {}) => spawnSync(cmd, args, { encoding: "utf8", env: { ...process.env, ...env } });
  let ends = {}; try { ends = JSON.parse(readFileSync(join(TEMPLATES, name, "ends.json"), "utf8")); } catch {}
  const patterns = readdirSync(join(TEMPLATES, name, "slides")).map((f) => f.replace(/^\d+-|\.html$/g, ""));
  const cover = ends.cover && patterns.includes(ends.cover) ? ends.cover : patterns.find((p) => p !== "media" && p !== "project");
  writeFileSync(data, JSON.stringify({ template: name, title: "Sample", slides: [{ pattern: cover }, PROJECT] }));
  let r = run("node", [join(SCRIPTS, "new_deck.mjs"), dir, "--data", data, "--redo"]); if (r.status !== 0) throw new Error(`${name}: new_deck failed: ${r.stdout.slice(0, 400)}`);
  r = run("node", [join(SCRIPTS, "assemble_deck.mjs"), dir]); if (r.status !== 0) throw new Error(`${name}: assemble failed: ${r.stdout.slice(-400)}`);
  const { openDeck, goTo, hideNavigation, settle } = await import(join(SCRIPTS, "deck_nav.mjs"));
  const d = await openDeck(dir);
  try {
    if (d.count < 2) throw new Error(`${name}: the deck has ${d.count} slides`);
    for (const [i, kind] of [[0, "cover"], [1, "project"]]) {
      await goTo(d.page, i); await hideNavigation(d.page); await settle(d.page, 1500, 4);
      const png = join(work, `${name}-${kind}.png`); await d.page.screenshot({ path: png });
      for (const [z, suffix] of [[THUMB, ""], [LARGE, "-l"]]) {
        const w = run("ffmpeg", ["-y", "-loglevel", "error", "-i", png, "-vf", `scale=${z.width}:${z.height}:flags=lanczos`, "-c:v", "libwebp", "-quality", "70", "-compression_level", "6", join(OUT, `${name}-${kind}${suffix}.webp`)]);
        if (w.status !== 0) throw new Error(`${name}: ffmpeg failed: ${(w.stderr || w.error?.message || "").slice(0, 300)}`);
      }
    }
  } finally { await d.browser.close(); }
}

if (process.argv[1] && process.argv[1].endsWith("build-deck-style-thumbs.mjs")) {
  const argv = process.argv.slice(2);
  if (argv.includes("--lines")) { console.log(JSON.stringify(styleLines())); process.exit(0); }
  if (argv.includes("--check")) {
    const bad = checkThumbs({ out: argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : OUT });
    if (bad.length) { console.error(`deck style thumbnails are stale: run node scripts/build-deck-style-thumbs.mjs\n  ${bad.slice(0, 12).join("\n  ")}${bad.length > 12 ? `\n  and ${bad.length - 12} more` : ""}`); process.exit(1); }
    console.log("deck style thumbnails are current"); process.exit(0);
  }
  const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1].split(",") : null;
  const all = Object.keys(JSON.parse(buildManifest()).templates), names = only || all;
  for (const n of names) if (!all.includes(n)) { console.error(`no template ${n}`); process.exit(2); }
  mkdirSync(OUT, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), "deck-thumbs-")); process.env.ONEHC_CHROME ||= ["/opt/chrome/chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => existsSync(p)) || "";
  const keep = existsSync(join(OUT, "index.json")) ? Object.fromEntries(JSON.parse(readFileSync(join(OUT, "index.json"), "utf8")).templates.map((t) => [t.name, t])) : {};
  const queue = [...names]; let failed = 0;
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (let n; (n = queue.shift());) { try { await renderOne(n, work); console.log(`rendered ${n}`); } catch (e) { failed++; console.error(String(e.message || e)); } }
  }));
  rmSync(work, { recursive: true, force: true });
  if (failed) { console.error(`${failed} template(s) failed; index.json not written`); process.exit(1); }
  writeFileSync(join(OUT, "index.json"), buildIndex({ keep, rendered: only }));
  const bytes = readdirSync(OUT).reduce((a, f) => a + statSync(join(OUT, f)).size, 0);
  console.log(`wrote ${names.length} template(s) to ${OUT}; the folder is ${(bytes / 1024).toFixed(0)} KB`);
}
