#!/usr/bin/env node
// Build the one combined deck document from the per-slide source.
//
//   .src/slides/deck.json    the authored manifest: main_title + slides in order (the order is the manifest's)
//   .src/slides/deck.css     the shared stylesheet: :root tokens, layouts, lockups, embedded fonts
//   .src/slides/<id>.html    one standalone slide each, images embedded as data: URIs
//     -> .src/index.html     one self-contained document holding every <section class="slide">
//     -> .src/slides/deck.json rewritten with derived fields (canvas, theme tokens, per-slide titles and layouts)
//
// Everything downstream (render_audit.mjs, validate_pdf.sh, build_pptx.py, an HTML export) reads index.html, so a deck
// that fails here can't be checked or shipped: every failure exits non-zero and names the file to fix.
//
//   node assemble_deck.mjs --slides <abs .src/slides dir> --out <abs .src/index.html>
//
// stdout: one JSON line { ok, out, count, manifest, deck_css_bytes, bytes, slides:[{id,path}], unlisted } or { ok:false, error }.

import { mkdir, readdir, writeFile, readFile, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadBrowserRuntime } from "./browser_runtime.mjs";
import { fileUrlWithinRoots, realRootsFor } from "./deck_asset_scope.mjs";
// --help: print the header above and exit.
if (process.argv[1] && import.meta.url.endsWith("/" + process.argv[1].split("/").pop()) && process.argv.slice(2).some((a) => a === "--help" || a === "-h")) {
  const HELP = (await import("node:fs")).readFileSync(new URL(import.meta.url), "utf8").split("\n"), end = HELP.findIndex((l, i) => i > 0 && !l.startsWith("//"));
  process.stdout.write(HELP.slice(HELP[0].startsWith("#!") ? 1 : 0, end).map((l) => l.replace(/^\/\/ ?/, "")).join("\n") + "\n"); process.exit(0);
}

const SLIDE_SELECTOR = "section.slide";
const PAGE_LOAD_TIMEOUT_MS = 30_000;
const MANIFEST_NAME = "deck.json";
const DECK_CSS_NAME = "deck.css";
const FORMAT_VERSION = 1;
// Kebab-case ids only: a "." would need escaping in a selector and the scope check could never match it.
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const RESERVED_ID = "index";   // index.html is the combined document

// Slides are untrusted markup opened in a real browser, and the page images are given to the person, so a slide must
// not be able to name a local file or run script. Schemes that read or execute are refused anywhere in a URL; a path
// that starts at / or climbs with .. is refused unless the URL is a data: URI (whose payload may contain "/../").
const UNSAFE_SCHEME = /^(?:file|javascript|vbscript):|^data:text\/html/i;
const UNSAFE_PATH = /^\/|(?:^|\/)\.\.(?:\/|$)/;
const DATA_URI = /^data:/i;
// Elements that execute, navigate, or pull in content no URL check can see.
const FORBIDDEN_SLIDE_TAGS = ["script", "iframe", "object", "embed", "frame", "frameset", "base", "form"];
const URL_ATTRIBUTES = [
  "src", "srcset", "href", "xlink:href", "poster", "data", "background",
  "action", "formaction", "ping", "cite", "longdesc", "manifest", "profile",
  "codebase", "archive",
];
// Only these hold a list of URLs and are split. Splitting anything else breaks data: URIs (a JPEG payload after the
// comma starts with "/").
const LIST_URL_ATTRIBUTES = ["srcset", "imagesrcset", "ping"];

// url() targets in CSS. Quoted forms are read as strings so an escaped ")" can't end the token early.
const CSS_URL_TOKEN = /url\(\s*(?:"((?:[^"\\]|\\[\s\S])*)"|'((?:[^'\\]|\\[\s\S])*)'|([^)]*?))\s*\)/gi;
function cssUrlTargets(css) {
  return [...String(css ?? "").matchAll(CSS_URL_TOKEN)].map((m) => (m[1] ?? m[2] ?? m[3] ?? "").trim());
}

// CSS decodes "\69" style escapes before resolving a URL ("f\69le:" is "file:"), so decode them before checking.
// CSS values only: in an HTML attribute a backslash is a path separator, not an escape.
function decodeCssEscapes(value) {
  return String(value ?? "").replace(/\\(?:([0-9a-fA-F]{1,6})[ \t\n\f\r]?|([\s\S]))/g, (whole, hex, literal) => {
    if (literal !== undefined) return literal;
    const point = parseInt(hex, 16);
    if (!Number.isFinite(point) || point === 0 || point > 0x10ffff) return "�";
    try { return String.fromCodePoint(point); } catch { return "�"; }
  });
}

// Fold a URL the way the browser will: drop whitespace/control characters, read %2e as a dot, and treat a backslash as
// a slash. Stops there on purpose: decoding everything would let %00 or %2f change how the rest parses.
function normalizeUrl(value) {
  return String(value ?? "").replace(/[\u0000- ]/g, "").replace(/%2e/gi, ".").replace(/\\/g, "/");
}
function urlIsUnsafe(raw) {
  const url = normalizeUrl(raw);
  if (url === "") return false;
  if (UNSAFE_SCHEME.test(url)) return true;
  if (DATA_URI.test(url)) return false;
  return UNSAFE_PATH.test(url);
}
const cssUrlIsUnsafe = (raw) => urlIsUnsafe(decodeCssEscapes(raw));
const firstUnsafeCssUrl = (css) => cssUrlTargets(css).find(cssUrlIsUnsafe);

// deck.css must not import another sheet: the deck carries its fonts embedded and fetches nothing.
const CSS_IMPORT_TARGET = /@import\s+(?:url\(\s*(['"]?)([^'")]*)\1\s*\)|(['"])([^'"]*)\3)/gi;
function firstCssImport(css) {
  for (const m of String(css ?? "").matchAll(CSS_IMPORT_TARGET)) {
    const target = (m[2] ?? m[4] ?? "").trim();
    if (target !== "") return target;
  }
  return undefined;
}

// This browser only reads the DOM: no network. Failing name resolution also silences Chrome's own startup requests.
const HERMETIC_LAUNCH_ARGS = ["--disable-quic", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost"];

function parseArgs(argv) {
  const flags = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const eq = argv[i].indexOf("=");
    if (eq >= 0) flags.set(argv[i].slice(2, eq), argv[i].slice(eq + 1));
    else if (typeof argv[i + 1] === "string" && !argv[i + 1].startsWith("--")) flags.set(argv[i].slice(2), argv[(i += 1)]);
    else flags.set(argv[i].slice(2), "");
  }
  const slides = (flags.get("slides") ?? "").trim();
  const out = (flags.get("out") ?? "").trim();
  if (!slides || !out) throw new Error("assemble_deck: --slides (the .src/slides dir) and --out (the combined .src/index.html) are both required");
  for (const [name, value] of [["slides", slides], ["out", out]]) {
    if (!value.startsWith("/")) throw new Error(`assemble_deck: --${name} must be an absolute path (got: ${value})`);
    const parts = value.split("/").filter(Boolean);
    const idx = parts.lastIndexOf("workspace");
    if (idx === -1 || idx === parts.length - 1) throw new Error(`assemble_deck: --${name} must be under /workspace (got: ${value})`);
  }
  if (resolve(dirname(out)) === resolve(slides)) throw new Error(`assemble_deck: refusing to write the combined deck into the slides directory ${slides}`);
  return { slides, out };
}

// The authored manifest decides which slides are in the deck and in what order; its other fields are derived later.
async function readAuthoredManifest(slidesDir) {
  const path = join(slidesDir, MANIFEST_NAME);
  let raw;
  try { raw = await readFile(path, "utf8"); } catch { throw new Error(`assemble_deck: no ${MANIFEST_NAME} in ${slidesDir}; it lists the deck's slides in order`); }
  let manifest;
  try { manifest = JSON.parse(raw); } catch (err) { throw new Error(`assemble_deck: ${path} is not valid JSON: ${err?.message ?? err}`); }
  if (!Array.isArray(manifest?.slides) || manifest.slides.length === 0) throw new Error(`assemble_deck: ${path} needs a non-empty "slides" array in deck order`);
  const seen = new Set();
  const slides = manifest.slides.map((slide, index) => {
    const id = typeof slide?.id === "string" ? slide.id.trim() : "";
    if (!SAFE_ID.test(id) || id === RESERVED_ID) throw new Error(`assemble_deck: ${path} slide ${index + 1} has an unusable id ${JSON.stringify(slide?.id)}`);
    if (seen.has(id)) throw new Error(`assemble_deck: ${path} repeats the slide id "${id}"`);
    seen.add(id);
    // The file name comes from the id; a path in the manifest may only restate it.
    const declared = typeof slide?.path === "string" ? slide.path.trim() : "";
    if (declared && basename(declared) !== declared) throw new Error(`assemble_deck: ${path} slide "${id}" path must be a bare file name (got: ${declared})`);
    const file = declared || `${id}.html`;
    if (basename(file, ".html") !== id) throw new Error(`assemble_deck: ${path} slide "${id}" must live in ${id}.html (got: ${file})`);
    return { id, path: file };
  });
  return { mainTitle: typeof manifest?.main_title === "string" ? manifest.main_title.trim() : "", slides };
}

// ---- runs inside Chrome (serialized: no closures over this module) -------------------------------------------------

// Check one slide file holds exactly the slide the manifest names, refuse unsafe markup and unscoped CSS, and return
// the parts the combined document is built from (or { error }).
function readAuthoredSlide([selector, expectedId, scopePrefixSource, cssLinkName, unsafeSchemeSource, unsafePathSource, forbiddenTags, urlAttributeNames, listUrlAttributeNames]) {
  const sections = Array.from(document.querySelectorAll(selector));
  if (sections.length !== 1) return { error: `expected exactly one '${selector}', found ${sections.length}` };
  const section = sections[0];
  const id = (section.id || "").trim();
  if (id !== expectedId) return { error: `its '${selector}' has id "${id}", but the manifest calls it "${expectedId}"` };

  const unsafeScheme = new RegExp(unsafeSchemeSource, "i");
  const unsafePath = new RegExp(unsafePathSource);
  const forbidden = new Set(forbiddenTags.map((t) => t.toUpperCase()));
  const urlNames = new Set(urlAttributeNames);
  const listUrlNames = new Set(listUrlAttributeNames);
  const namesUnsafeUrl = (value, isList) => {
    const text = String(value);
    const parts = isList && !/^\s*data:/i.test(text) ? [text, ...text.split(/[,\s]+/)] : [text];
    return parts.some((part) => {
      const url = part.replace(/[\x00-\x20]/g, "").replace(/%2e/gi, ".").replace(/\\/g, "/");
      if (url === "") return false;
      if (unsafeScheme.test(url)) return true;
      if (/^data:/i.test(url)) return false;
      return unsafePath.test(url);
    });
  };
  const urlTargets = (css) => {
    const found = [];
    const token = /url\(\s*(?:"((?:[^"\\]|\\[\s\S])*)"|'((?:[^'\\]|\\[\s\S])*)'|([^)]*?))\s*\)/gi;
    for (const m of String(css).matchAll(token)) found.push((m[1] ?? m[2] ?? m[3] ?? "").trim());
    return found;
  };
  const decodeCss = (value) => String(value ?? "").replace(/\\(?:([0-9a-fA-F]{1,6})[ \t\n\f\r]?|([\s\S]))/g, (w, hex, literal) => {
    if (literal !== undefined) return literal;
    const p = parseInt(hex, 16);
    if (!Number.isFinite(p) || p === 0 || p > 0x10ffff) return "�";
    try { return String.fromCodePoint(p); } catch { return "�"; }
  });
  const unsafeStyleUrl = (css) => urlTargets(css).find((t) => namesUnsafeUrl(decodeCss(t), false));
  for (const node of Array.from(document.querySelectorAll("*"))) {
    const tag = (node.tagName || "").toUpperCase();
    if (forbidden.has(tag)) return { error: `carries <${tag.toLowerCase()}>, which a slide may not (it runs code or pulls in another document)` };
    if (tag === "META" && node.hasAttribute("http-equiv")) return { error: "carries a <meta http-equiv>, which can navigate the page away mid-render" };
    if (tag === "STYLE" && unsafeStyleUrl(node.textContent || "") !== undefined) {
      return { error: `has a <style> url() the deck can't carry: ${unsafeStyleUrl(node.textContent || "").slice(0, 120)} (embed the asset as a data: URI)` };
    }
    for (const name of node.getAttributeNames()) {
      const lower = name.toLowerCase();
      if (lower.startsWith("on") && lower in node) return { error: `sets the inline handler ${lower}=, which runs script during the render` };
      if (lower === "srcdoc") return { error: "sets srcdoc, a nested document the checks can't see" };
      const value = node.getAttribute(name) || "";
      if (urlNames.has(lower) && namesUnsafeUrl(value, listUrlNames.has(lower))) {
        return { error: `points ${lower} at ${value.slice(0, 120)}, which a slide may not name (no file:, no javascript:, no absolute path, no ..)` };
      }
      if (lower === "style" && unsafeStyleUrl(value) !== undefined) {
        return { error: `has a style="" url() the deck can't carry: ${unsafeStyleUrl(value).slice(0, 120)} (embed the asset as a data: URI)` };
      }
    }
  }

  // The only stylesheet a slide may link is deck.css (inlined once in the combined document). Anything else would become
  // deck-wide there while the slide's own view looks fine.
  for (const node of Array.from(document.querySelectorAll("link"))) {
    const rel = (node.getAttribute("rel") || "").toLowerCase().split(/\s+/);
    if (!rel.includes("stylesheet")) continue;
    const href = (node.getAttribute("href") || "").trim();
    if (href === cssLinkName || href.endsWith(`/${cssLinkName}`)) continue;
    return { error: `links a stylesheet the deck can't carry: ${href.slice(0, 120) || "<empty href>"} (shared CSS belongs in ${cssLinkName}; fonts are embedded by embed_deck_fonts.mjs)` };
  }

  // A slide's own rules end up in one document with every other slide's, so each selector must name this slide.
  const scoped = new RegExp(scopePrefixSource);
  const unscoped = [];
  const styles = [];
  const walk = (rules) => {
    for (const rule of rules) {
      if (typeof rule.href === "string" && rule.cssRules === undefined) { unscoped.push(`@import ${rule.href.slice(0, 60)}`); continue; }
      if (typeof rule.selectorText === "string") {
        const parts = rule.selectorText.split(",").map((p) => p.trim());
        if (parts.every((p) => p === "")) { unscoped.push(`${rule.constructor.name} with no selector`); continue; }   // e.g. a bare @page
        for (const part of parts) if (part && !scoped.test(part)) unscoped.push(part.slice(0, 80));
        continue;
      }
      // Any grouping rule (@media, @supports, @layer...) holds selectors; only @keyframes children are not selectors.
      if (rule.cssRules && !(rule instanceof CSSKeyframesRule)) walk(Array.from(rule.cssRules));
    }
  };
  for (const node of Array.from(document.querySelectorAll("style"))) {
    const styleMedia = (node.getAttribute("media") || "").trim();
    if (styleMedia !== "") return { error: `has a <style media="${styleMedia.slice(0, 40)}">, which the combined deck can't carry: use an @media block inside the <style>` };
    // Head styles are hoisted; a <style> inside the section already travels with it. Both get scope-checked.
    if (node.closest(selector) === null) styles.push(node.textContent || "");
    let rules;
    try { rules = Array.from(node.sheet?.cssRules || []); } catch { continue; }
    walk(rules);
  }
  if (unscoped.length > 0) {
    return { error: `has <style> rules not scoped to #${expectedId}: ${unscoped.slice(0, 5).join(", ")} (shared CSS goes in ${cssLinkName}; a slide's own rules start with #${expectedId})` };
  }

  const heading = section.querySelector("h1, .title, h2, h3");
  return { html: section.outerHTML, styles, pageTitle: heading ? (heading.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200) : "" };
}

// Read back the combined document: slide ids in order, the canvas size, and the :root tokens as authored.
function readAssembledDeck(selector) {
  const slides = Array.from(document.querySelectorAll(selector));
  let canvas = null;
  if (slides.length > 0) {
    const width = Math.round(slides[0].offsetWidth), height = Math.round(slides[0].offsetHeight);
    if (width > 0 && height > 0) canvas = { width, height };
  }
  const cssVariables = {};
  for (const sheet of Array.from(document.styleSheets)) {
    let rules;
    try { rules = Array.from(sheet.cssRules || []); } catch { continue; }
    for (const rule of rules) {
      if (typeof rule.selectorText !== "string" || !rule.selectorText.includes(":root")) continue;
      for (let i = 0; i < rule.style.length; i += 1) {
        const prop = rule.style[i];
        if (prop.startsWith("--")) cssVariables[prop] = rule.style.getPropertyValue(prop).trim();
      }
    }
  }
  return { ids: slides.map((s) => (s.id || "").trim()), canvas, cssVariables };
}

// ---- assembly -----------------------------------------------------------------------------------------------------

// "</style" inside CSS would close the element early; "<\/" keeps it inert.
const escapeStyleContent = (css) => css.replace(/<\/(style)/gi, "<\\/$1");
const escapeHtmlText = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttribute = (v) => escapeHtmlText(v).replace(/"/g, "&quot;");

function buildCombinedDocument({ title, deckCss, slides }) {
  const head = ['<meta charset="utf-8">'];
  if (title) head.push(`<title>${escapeHtmlText(title)}</title>`);
  if (deckCss.trim()) head.push(`<style>\n${escapeStyleContent(deckCss)}\n</style>`);
  for (const slide of slides) {
    for (const style of slide.styles) {
      if (style.trim()) head.push(`<style data-slide="${escapeAttribute(slide.id)}">\n${escapeStyleContent(style)}\n</style>`);
    }
  }
  return ["<!doctype html>", '<html lang="en">', "<head>", ...head, "</head>", "<body>", ...slides.map((s) => s.html), "</body>", "</html>", ""].join("\n");
}

// An @font-face carrying its bytes, as embed_deck_fonts.mjs writes it.
const EMBEDDED_FACE = /@font-face\s*\{[^}]*url\(\s*["']?data:font\/[^}]*\}/i;

// The saved style plan (optional): theme id and per-slide layouts for the manifest.
async function readStylePlan(deckFile) {
  const plan = await readFile(join(dirname(deckFile), "style_plan.json"), "utf8").then(JSON.parse).catch(() => null);
  const layouts = new Map();
  for (const entry of (plan && plan.layout_plan) || []) {
    if (typeof entry?.id === "string" && typeof entry.layout === "string") layouts.set(entry.id, entry.layout);
  }
  return { themeId: typeof plan?.theme === "string" ? plan.theme : "", layouts };
}

function buildManifest({ mainTitle, slides, canvas, cssVariables, stylePlan, hasDeckCss }) {
  const manifest = { format_version: FORMAT_VERSION, main_title: mainTitle };
  if (canvas) manifest.canvas = canvas;
  if (hasDeckCss) manifest.deck_css = DECK_CSS_NAME;
  const variables = cssVariables || {};
  if (stylePlan.themeId || Object.keys(variables).length > 0) {
    manifest.theme = {};
    if (stylePlan.themeId) manifest.theme.id = stylePlan.themeId;
    manifest.theme.css_variables = variables;
  }
  manifest.slides = slides.map((slide, index) => {
    const entry = { index, id: slide.id };
    if (slide.pageTitle) entry.page_title = slide.pageTitle;
    entry.path = slide.path;
    const layout = stylePlan.layouts.get(slide.id);
    if (layout) entry.layout = layout;
    return entry;
  });
  return manifest;
}

async function run(args) {
  const authored = await readAuthoredManifest(args.slides);
  for (const slide of authored.slides) {
    if (!existsSync(join(args.slides, slide.path))) throw new Error(`assemble_deck: ${MANIFEST_NAME} lists ${slide.path}, which does not exist`);
  }
  // A slide file the manifest leaves out is not in the deck. Could be scratch, could be a forgotten slide: say so.
  const listed = new Set(authored.slides.map((s) => s.path));
  const unlisted = (await readdir(args.slides)).filter((n) => n.endsWith(".html") && !listed.has(n)).sort();
  if (unlisted.length) {
    process.stderr.write(`assemble_deck: WARNING ${unlisted.length} file(s) in ${args.slides} are not in ${MANIFEST_NAME}, so they are NOT in the deck: ${unlisted.join(", ")}. Add real slides to ${MANIFEST_NAME}, delete scratch.\n`);
  }
  const deckCss = await readFile(join(args.slides, DECK_CSS_NAME), "utf8").catch(() => "");
  const unsafeDeckCssUrl = firstUnsafeCssUrl(deckCss);
  if (unsafeDeckCssUrl !== undefined) {
    throw new Error(`assemble_deck: ${DECK_CSS_NAME} names a url() the deck can't carry: ${unsafeDeckCssUrl.slice(0, 120)} (no file:, no javascript:, no absolute path, no ..; embed the asset as a data: URI)`);
  }
  const deckCssImport = firstCssImport(deckCss);
  if (deckCssImport !== undefined) {
    throw new Error(`assemble_deck: ${DECK_CSS_NAME} imports ${deckCssImport.slice(0, 120)}; a deck fetches nothing. Remove the @import (name the font in the :root tokens and run embed_deck_fonts.mjs)`);
  }
  const stylePlan = await readStylePlan(args.out);

  const { audit, playwright, executablePath } = await loadBrowserRuntime();
  const launchOptions = audit.buildLaunchOptions(executablePath);
  launchOptions.args = [...(launchOptions.args ?? []), ...HERMETIC_LAUNCH_ARGS];
  const browser = await playwright.chromium.launch(launchOptions);

  // Keep the .html suffix: Chrome picks the parser for a file:// URL by extension.
  const temporary = `${args.out}.assembling.${process.pid}.html`;
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    // file: requests may only reach the deck's own folders; everything remote is aborted.
    const assetRoots = realRootsFor([dirname(args.out), args.slides]);
    let blocked = 0, blockedLocal = 0;
    await context.route("**/*", (route) => {
      const url = route.request().url();
      if (/^(data|about):/.test(url)) return route.continue();
      if (url.startsWith("file:")) {
        if (fileUrlWithinRoots(url, assetRoots)) return route.continue();
        blockedLocal += 1;
        process.stderr.write(`assemble_deck: refused a local request outside the deck: ${url.slice(0, 160)}\n`);
        return route.abort();
      }
      blocked += 1;
      return route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => process.stderr.write(`assemble_deck pageerror: ${err.message}\n`));

    // Pass one: each authored slide, in manifest order.
    const collected = [];
    for (const slide of authored.slides) {
      await page.goto(pathToFileURL(join(args.slides, slide.path)).href, { waitUntil: "domcontentloaded", timeout: PAGE_LOAD_TIMEOUT_MS });
      const read = await page.evaluate(readAuthoredSlide, [
        SLIDE_SELECTOR,
        slide.id,
        // A selector must start with #<id> (optionally after a tag name) and must not hop to a sibling with ~ or +,
        // which would reach every later slide once the deck is combined.
        `^(?:[A-Za-z][\\w-]*)?#${slide.id.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}(?![\\w-])(?!\\s*[~+])`,
        DECK_CSS_NAME,
        UNSAFE_SCHEME.source,
        UNSAFE_PATH.source,
        FORBIDDEN_SLIDE_TAGS,
        URL_ATTRIBUTES,
        LIST_URL_ATTRIBUTES,
      ]);
      if (read.error) throw new Error(`assemble_deck: ${slide.path} ${read.error}`);
      collected.push({ ...slide, ...read });
    }
    if (!EMBEDDED_FACE.test(deckCss)) {
      process.stderr.write(`assemble_deck: WARNING ${DECK_CSS_NAME} has no embedded @font-face, so an HTML or PDF copy opened elsewhere falls back to another font. Run embed_deck_fonts.mjs --slides ${args.slides} and re-assemble.\n`);
    }

    const title = authored.mainTitle || collected[0].pageTitle;
    const combined = buildCombinedDocument({ title, deckCss, slides: collected });
    await mkdir(dirname(args.out), { recursive: true });
    await writeFile(temporary, combined, "utf8");

    // Pass two: load exactly what the renderer will load and derive the manifest from it.
    await page.goto(pathToFileURL(temporary).href, { waitUntil: "domcontentloaded", timeout: PAGE_LOAD_TIMEOUT_MS });
    const outline = await page.evaluate(readAssembledDeck, SLIDE_SELECTOR);
    const expected = collected.map((s) => s.id);
    if (outline.ids.length !== expected.length || outline.ids.some((id, i) => id !== expected[i])) {
      throw new Error(`assemble_deck: the combined deck holds [${outline.ids.join(", ")}], expected [${expected.join(", ")}]`);
    }
    await context.close();

    const manifestPath = join(args.slides, MANIFEST_NAME);
    const manifest = buildManifest({ mainTitle: title, slides: collected, canvas: outline.canvas, cssVariables: outline.cssVariables, stylePlan, hasDeckCss: deckCss.trim().length > 0 });
    await rename(temporary, args.out);
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    process.stderr.write(`assemble_deck: ${collected.length} slides, deck.css ${deckCss.length} bytes, ${EMBEDDED_FACE.test(deckCss) ? "fonts embedded" : "NO fonts embedded"}, ${blocked} remote and ${blockedLocal} out-of-deck requests blocked\n`);
    return {
      ok: true,
      out: args.out,
      count: collected.length,
      manifest: manifestPath,
      deck_css_bytes: Buffer.byteLength(deckCss, "utf8"),
      bytes: Buffer.byteLength(combined, "utf8"),
      slides: collected.map((s) => ({ id: s.id, path: s.path })),
      unlisted,
    };
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
    await browser.close();
  }
}

async function main() {
  try {
    process.stdout.write(JSON.stringify(await run(parseArgs(process.argv.slice(2)))) + "\n");
    return true;
  } catch (err) {
    const message = err?.message ?? String(err);
    process.stderr.write(`${message.startsWith("assemble_deck") ? message : `assemble_deck: ${message}`}\n`);
    process.stdout.write(JSON.stringify({ ok: false, error: message }) + "\n");
    return false;
  }
}

main().then((ok) => process.exit(ok ? 0 : 1));
