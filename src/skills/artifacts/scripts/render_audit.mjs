#!/usr/bin/env node
// render_audit.mjs: render an artifact's HTML source in headless Chrome, write
// a PDF and/or PNGs, and print one JSON report with the render gates.
// Shared by PDFs, slide decks and static web pages on the channel computer.
//
// Usage (all paths absolute):
//   node render_audit.mjs --html <src.html> [--pdf <out.pdf>] [--png-dir <dir>] [flags]
//
//   --html <path>              the source HTML (required)
//   --pdf <path>               write the PDF here (honours CSS @page size)
//   --png-dir <dir>            write PNGs here: one per page element (page-01.png ...),
//                              or one full-height page-1.png with --full-page
//   --viewport WxH             screen viewport, default 1280x720. A web page is checked
//                              at 1280x800 (desktop) and 390x844 (phone).
//   --full-page                plain web page: no page elements; one full-height PNG,
//                              plus a page-level sideways-scroll check (page_overflow_x)
//   --page-selector "<css>"    the page/slide elements (default ".slide-container, .page,
//                              section.slide"); overflow and screenshots run over these
//   --fonts "Family:wt,..."    faces that must render; without it, a deck's own
//                              --slide-font-display / --slide-font-body are checked
//   --require-webfonts         a face must come from an @font-face in the document,
//                              not from an installed font with the same name
//   --structure-check          deck checks: cover image, broken images, canvas fill,
//                              and the restraint read (furniture, uppercase, tracking)
//   --style-plan <path>        the deck's style_plan.json: advisory plan comparison
//   --require-fill [pct]       fail a slide whose content stops above pct (default 75)
//                              of its canvas AND is packed against the top
//   --require-cover-image      fail a deck whose first slide has no real image
//   --require-restraint        fail slides with furniture classes, uppercase or tracking
//                              (needs --structure-check)
//   --require-geometry         compare the PDF's pages with the authored page boxes (needs --pdf)
//   --require-text-floor       fail text under 8pt; advise when the body is mostly under 10pt
//   --require-image-resolution fail images shown wider than their pixels (needs --pdf)
//   --gate                     turn findings into a verdict: ok:false, gate_failures, exit 1
//   --report-out <path>        also write the report to this file
//   --hermetic                 no network at all: only the document, data: URIs and files
//                              inside the artifact folder load
//
// Report: { ok, pdf, pages, pngs, fonts:{missing,unused,used,expected}, overflow:[{index,
//   overflowY_px, overflowX_px}], cover_no_image?, broken_images?, fill?, restraint?, plan?,
//   geometry?:{failures,advisories}, text_floor?, image_resolution?, page_overflow_x?,
//   browser_failures?, blocked_requests?, gate_failures?, advisories?, error? }
// Diagnostics go to stderr. Exit 0 = ok, 1 = failed gate or render, 2 = bad arguments.
//
// Local files outside the artifact folder are always refused, because the
// pictures and PDFs this writes are handed to the person.

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { loadBrowserRuntime } from "./browser_runtime.mjs";
import { fileUrlWithinRoots, realRootsFor } from "./deck_asset_scope.mjs";
import { probePdfFacts } from "./pdf_geometry_probe.mjs";
import { evaluatePdfGeometry } from "./pdf_geometry_gate.mjs";
import { evaluateTextFloor } from "./pdf_text_floor.mjs";
import { evaluateImageResolution } from "./pdf_image_resolution.mjs";
// --help: print the header above and exit.
if (process.argv[1] && import.meta.url.endsWith("/" + process.argv[1].split("/").pop()) && process.argv.slice(2).some((a) => a === "--help" || a === "-h")) {
  const HELP = (await import("node:fs")).readFileSync(new URL(import.meta.url), "utf8").split("\n"), end = HELP.findIndex((l, i) => i > 0 && !l.startsWith("//"));
  process.stdout.write(HELP.slice(HELP[0].startsWith("#!") ? 1 : 0, end).map((l) => l.replace(/^\/\/ ?/, "")).join("\n") + "\n"); process.exit(0);
}

const DEFAULT_PAGE_SELECTOR = ".slide-container, .page, section.slide";
// Default --require-fill: tells a deck whose slides stop half-way down from a
// finished one, without flagging a deliberately sparse statement slide.
const DEFAULT_REQUIRE_FILL_PCT = 75;
const PAGE_LOAD_TIMEOUT_MS = 30_000;
const FONTS_READY_TIMEOUT_MS = 10_000; // a face that never loads must not hang the run
const CHART_SETTLE_MS = 600; // let canvas/rAF painting finish before screenshots
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
// A page wider than the phone viewport by more than this scrolls sideways.
const PAGE_OVERFLOW_TOLERANCE_PX = 4;

// Tagged PDF (reading order for screen readers) with a bookmark outline from the headings.
const PDF_EXPORT_OPTIONS = { preferCSSPageSize: true, printBackground: true, tagged: true, outline: true };

// Unknown flags only warn: a misspelled gate flag would otherwise pass silently.
const KNOWN_FLAGS = new Set([
  "html", "pdf", "png-dir", "fonts", "require-webfonts", "page-selector", "viewport", "full-page",
  "structure-check", "style-plan", "require-fill", "require-cover-image", "require-restraint",
  "require-geometry", "require-text-floor", "require-image-resolution", "gate", "report-out", "hermetic",
]);

// Folders the document may read local files from: its own, plus the artifact
// folder when the source sits in .src/ (so .src/media and siblings resolve).
function artifactAssetRoots(html) {
  const own = dirname(html);
  return basename(own) === ".src" ? [own, dirname(own)] : [own];
}

function parseViewport(raw) {
  if (!raw) return { ...DEFAULT_VIEWPORT };
  const m = /^(\d{2,5})x(\d{2,5})$/i.exec(raw.trim());
  if (!m) throw new Error(`render_audit: --viewport expects WxH (e.g. 390x844), got '${raw}'`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

function parseArgs(argv) {
  const map = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq >= 0) {
      map.set(arg.slice(2, eq), arg.slice(eq + 1));
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (typeof next === "string" && !next.startsWith("--")) {
      map.set(key, next);
      i += 1;
    } else {
      map.set(key, "");
    }
  }
  for (const key of map.keys()) {
    if (!KNOWN_FLAGS.has(key)) {
      process.stderr.write(`render_audit: unknown flag --${key} ignored; check the spelling before trusting this run\n`);
    }
  }
  const html = (map.get("html") ?? "").trim();
  const pdf = (map.get("pdf") ?? "").trim();
  const pngDir = (map.get("png-dir") ?? "").trim();
  if (!html || (!pdf && !pngDir)) {
    throw new Error("render_audit: --html and at least one of --pdf or --png-dir are required (absolute paths)");
  }
  // Gates that read something only another flag produces must not pass silently.
  if (map.has("require-geometry") && !pdf) throw new Error("render_audit: --require-geometry reads the PDF and needs --pdf");
  if (map.has("require-image-resolution") && !pdf) {
    throw new Error("render_audit: --require-image-resolution measures at the PDF's paper width and needs --pdf");
  }
  if (map.has("require-restraint") && !map.has("structure-check")) {
    throw new Error("render_audit: --require-restraint needs --structure-check");
  }
  let requireFillPct = null;
  if (map.has("require-fill")) {
    const raw = (map.get("require-fill") ?? "").trim();
    if (raw === "") requireFillPct = DEFAULT_REQUIRE_FILL_PCT;
    else {
      const parsed = Number.parseFloat(raw);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        throw new Error(`render_audit: --require-fill expects 0-100, got '${raw}'`);
      }
      requireFillPct = parsed;
    }
  }
  const fullPage = map.has("full-page");
  return {
    html,
    pdf,
    pngDir,
    fullPage,
    viewport: parseViewport(map.get("viewport")),
    pageSelector: fullPage ? "body" : (map.get("page-selector") ?? "").trim() || DEFAULT_PAGE_SELECTOR,
    fonts: parseFonts((map.get("fonts") ?? "").trim()),
    requireWebfonts: map.has("require-webfonts"),
    structureCheck: map.has("structure-check"),
    stylePlan: (map.get("style-plan") ?? "").trim(),
    reportOut: (map.get("report-out") ?? "").trim(),
    requireFillPct,
    requireCoverImage: map.has("require-cover-image"),
    requireRestraint: map.has("require-restraint"),
    requireGeometry: map.has("require-geometry"),
    requireTextFloor: map.has("require-text-floor"),
    requireImageResolution: map.has("require-image-resolution"),
    gate: map.has("gate"),
    hermetic: map.has("hermetic"),
  };
}

// "Inter:600,Inter:400,Space Grotesk:700" -> [{family, weight}]; no weight means 400.
function parseFonts(raw) {
  if (!raw) return [];
  const out = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colon = trimmed.lastIndexOf(":");
    if (colon <= 0) {
      out.push({ family: trimmed, weight: "400" });
      continue;
    }
    const family = trimmed.slice(0, colon).trim();
    const weight = trimmed.slice(colon + 1).trim() || "400";
    if (family) out.push({ family, weight });
  }
  return out;
}

// --- Page probes -----------------------------------------------------------
// Compare family names without quotes, extra spaces or case.
function normalizeFamily(raw) {
  return String(raw)
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

const CSS_GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
  "fangsong",
  "inherit",
  "initial",
  "unset",
]);

function weightNumber(raw) {
  const value = String(raw).trim().toLowerCase();
  if (value === "normal") return 400;
  if (value === "bold") return 700;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// An installed static family names each weight as its own family ("Inter Semi Bold",
// "IBM Plex Sans Medm"). Accept the base name plus weight/style words only, so
// "Roboto Condensed" never counts as "Roboto".
const WEIGHT_WORDS = /^(?:(?:thin|hairline|extra ?light|ultra ?light|extlt|light|book|regular|normal|text|medium|medm|semi ?bold|demi ?bold|smbld|bold|extra ?bold|ultra ?bold|black|heavy|italic|oblique|\d+pt)\s*)+$/i;
function sameLocalFamily(platformName, requested) {
  const a = normalizeFamily(platformName);
  const b = normalizeFamily(requested);
  if (a === b) return true;
  return a.startsWith(b + " ") && WEIGHT_WORDS.test(a.slice(b.length + 1));
}

// FontFace.weight is one weight ("400") or a variable range ("100 900").
function weightDescriptorIncludes(descriptor, requested) {
  if (!String(requested ?? "").trim()) return true;
  const wanted = weightNumber(requested);
  if (wanted === null) return false;
  const values = String(descriptor)
    .trim()
    .split(/\s+/)
    .map(weightNumber)
    .filter((value) => value !== null);
  if (values.length === 1) return values[0] === wanted;
  if (values.length === 2) return wanted >= values[0] && wanted <= values[1];
  return false;
}

function fontUsageKey(font) {
  return [font.familyName, font.postScriptName, String(font.isCustomFont)].join("\u0000");
}

function normalizePlatformFont(font) {
  return {
    familyName: String(font.familyName ?? "").trim(),
    postScriptName: String(font.postScriptName ?? "").trim(),
    isCustomFont: font.isCustomFont === true,
    glyphCount: Number(font.glyphCount ?? 0),
  };
}

// The deck's own theme faces (first family of each :root token), used when no --fonts is given.
async function probeThemeFamilies(page) {
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return ["--slide-font-display", "--slide-font-body"]
      .map((name) => root.getPropertyValue(name).split(",")[0].trim())
      .filter(Boolean);
  });
}

// What Chrome actually rasterized, via CDP. document.fonts.check() and computed styles
// stay green when a face silently falls back; this does not. CDP reports glyphs per
// element, so every descendant of the page elements is asked.
async function openUsedFontProbe(context, page, selector) {
  const session = await context.newCDPSession(page);
  try {
    await session.send("DOM.enable");
    await session.send("CSS.enable");
    const { root } = await session.send("DOM.getDocument", { depth: -1 });
    const matched = await session.send("DOM.querySelectorAll", {
      nodeId: root.nodeId,
      selector,
    });
    let nodeIds = matched.nodeIds ?? [];
    let scopeSelector = selector;
    if (nodeIds.length === 0) {
      const body = await session.send("DOM.querySelector", {
        nodeId: root.nodeId,
        selector: "body",
      });
      if (body.nodeId) nodeIds = [body.nodeId];
      scopeSelector = "body";
    }
    const usageNodeIds = new Set(nodeIds);
    for (const nodeId of nodeIds) {
      const descendants = await session.send("DOM.querySelectorAll", {
        nodeId,
        selector: "*",
      });
      for (const descendantId of descendants.nodeIds ?? []) {
        usageNodeIds.add(descendantId);
      }
    }

    const usageByFace = new Map();
    for (const nodeId of usageNodeIds) {
      const platform = await session.send("CSS.getPlatformFontsForNode", { nodeId });
      for (const font of platform.fonts ?? []) {
        const normalized = normalizePlatformFont(font);
        if (!normalized.familyName) continue;
        const key = fontUsageKey(normalized);
        const previous = usageByFace.get(key);
        normalized.glyphCount += previous?.glyphCount ?? 0;
        usageByFace.set(key, normalized);
      }
    }
    const hasText = await page.evaluate((sel) =>
      Array.from(document.querySelectorAll(sel)).some((node) =>
        String(node.innerText ?? "").trim().length > 0), scopeSelector);
    if (hasText && usageByFace.size === 0) {
      throw new Error("CDP returned no platform fonts for rendered text");
    }
    return {
      session,
      rootNodeId: root.nodeId,
      usages: [...usageByFace.values()].sort((a, b) => b.glyphCount - a.glyphCount),
    };
  } catch (err) {
    await session.detach().catch(() => {});
    throw err;
  }
}

// Resolve one requested family+weight to Chrome's platform font with a small
// off-screen probe, then check that the page really painted with it. Learns aliases
// (CSS "DM Sans" -> platform "DM Sans 9pt") without accepting unrelated families.
async function resolveExpectedFace(page, fontProbe, face, index, requireWebfonts) {
  const probeId = `onehc-font-probe-${index}`;
  const declaredFaces = await page.evaluate(async ({
    family,
    weight,
    probeIdIn,
    offsetY,
    timeoutMs,
  }) => {
    const spec = `${weight || "400"} 16px "${family.replaceAll('"', '\\"')}"`;
    await Promise.race([
      document.fonts.load(spec, "Font Probe 0123 Aa").catch(() => []),
      new Promise((_, reject) => setTimeout(
        () => reject(new Error(
          `font load timed out after ${timeoutMs}ms: ${family}:${weight || "400"}`,
        )),
        timeoutMs,
      )),
    ]);
    const normalize = (value) => String(value)
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/\s+/g, " ")
      .toLowerCase();
    const entries = [];
    document.fonts.forEach((font) => {
      if (normalize(font.family) === normalize(family)) {
        entries.push({ weight: String(font.weight), status: String(font.status) });
      }
    });
    const span = document.createElement("span");
    span.id = probeIdIn;
    Object.assign(span.style, {
      position: "fixed",
      left: "-10000px",
      top: `${offsetY}px`,
      fontFamily: `"${family.replaceAll('"', '\\"')}"`,
      fontWeight: weight || "400",
      fontSize: "16px",
    });
    span.textContent = "Font Probe 0123 Aa";
    document.body.appendChild(span);
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return entries;
  }, {
    family: face.family,
    weight: face.weight,
    probeIdIn: probeId,
    offsetY: index * 24,
    timeoutMs: FONTS_READY_TIMEOUT_MS,
  });

  const probeNode = await fontProbe.session.send("DOM.querySelector", {
    nodeId: fontProbe.rootNodeId,
    selector: `#${probeId}`,
  });
  if (!probeNode.nodeId) throw new Error(`could not inspect font probe for ${face.family}`);
  const platform = await fontProbe.session.send("CSS.getPlatformFontsForNode", {
    nodeId: probeNode.nodeId,
  });
  const aliases = (platform.fonts ?? [])
    .map(normalizePlatformFont)
    .filter((font) => font.familyName);
  await page.evaluate((id) => document.getElementById(id)?.remove(), probeId);

  const declaredWeightLoaded = declaredFaces.some((entry) =>
    weightDescriptorIncludes(entry.weight, face.weight) && entry.status === "loaded");
  const customResolved = declaredWeightLoaded && aliases.some((font) => font.isCustomFont);
  const localResolved = !requireWebfonts && aliases.some((font) =>
    !font.isCustomFont && sameLocalFamily(font.familyName, face.family));
  const available = customResolved || localResolved;
  const actualKeys = new Set(fontProbe.usages.map(fontUsageKey));
  const rendered = face.weight
    ? aliases.some((alias) => actualKeys.has(fontUsageKey(alias)))
    : aliases.some((alias) => fontProbe.usages.some((used) =>
        normalizeFamily(used.familyName) === normalizeFamily(alias.familyName)
        && used.isCustomFont === alias.isCustomFont));

  return { available, rendered };
}

// Page elements whose content spills past their own box (scrollHeight > clientHeight).
// A flowing page grows to fit, so it never false-positives here.
async function probeOverflow(page, selector) {
  return page.evaluate(
    (sel) => {
      const els = Array.from(document.querySelectorAll(sel));
      const overflows = [];
      els.forEach((el, index) => {
        const scrollH = el.scrollHeight;
        const scrollW = el.scrollWidth;
        const clientH = el.clientHeight;
        const clientW = el.clientWidth;
        const overflowY = Math.max(0, scrollH - clientH);
        const overflowX = Math.max(0, scrollW - clientW);
        if (overflowY > 1 || overflowX > 1) {
          overflows.push({
            index,
            overflowY_px: Math.round(overflowY),
            overflowX_px: Math.round(overflowX),
          });
        }
      });
      return overflows;
    },
    selector,
  );
}

// Deck image checks: a cover with no decoded image, and <img> tags that did not decode.
async function probeStructure(page, selector) {
  return page.evaluate((sel) => {
    const slides = Array.from(document.querySelectorAll(sel));
    const hasImage = (root) =>
      Array.from(root.querySelectorAll("img")).some((i) => i.complete && i.naturalWidth > 0) ||
      [root, ...root.querySelectorAll("*")].some((el) =>
        (getComputedStyle(el).backgroundImage || "").includes("data:image"));
    const broken_images = [];
    slides.forEach((slide, index) => {
      slide.querySelectorAll("img").forEach((img) => {
        if (img.complete && img.naturalWidth === 0) {
          broken_images.push({ index, src_head: (img.getAttribute("src") || "").slice(0, 24) });
        }
      });
    });
    return { cover_no_image: slides.length > 0 && !hasImage(slides[0]), broken_images };
  }, selector);
}

// Deck restraint, read from computed style (so a CSS comment can't trip it): furniture
// class names (kicker, eyebrow, pill, badge, chip, tag as the head noun), uppercase
// transforms, and positive letter tracking over 0.5px. One finding per rule per slide.
async function probeRestraint(page, selector) {
  return page.evaluate((sel) => {
    const FURNITURE = /^(kicker|eyebrow|pill|badge|chip|tag)$/i;
    const MODIFIER =
      /^(xs|sm|md|lg|xl|small|medium|large|alt|primary|secondary|dark|light|outline|solid|\d+)$/i;
    const isHead = (piece) => {
      const parts = piece.split(/[-_]/).filter(Boolean);
      if (parts.length === 0) return false;
      if (FURNITURE.test(parts[parts.length - 1])) return true;
      return FURNITURE.test(parts[0]) && parts.slice(1).every((p) => MODIFIER.test(p));
    };
    const isFurniture = (cls) =>
      cls.split(/\s+/).some((token) => token.split(/--|__/).filter(Boolean).some(isHead));
    const TRACK_PX = 0.5;
    const out = [];
    Array.from(document.querySelectorAll(sel)).forEach((slide, index) => {
      const findings = [];
      const seen = new Set();
      const add = (key, msg) => {
        if (!seen.has(key)) { seen.add(key); findings.push(msg); }
      };
      for (const el of slide.querySelectorAll("*")) {
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") continue;
        const cls = (el.getAttribute("class") || "").trim();
        if (cls && isFurniture(cls)) {
          add("furniture", `furniture class "${cls.slice(0, 40)}"`);
        }
        const own = Array.from(el.childNodes)
          .some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!own) continue;
        const text = (el.textContent || "").trim().slice(0, 24);
        if (style.textTransform === "uppercase") {
          add("uppercase", `text-transform:uppercase on "${text}"`);
        }
        const spacing = Number.parseFloat(style.letterSpacing);
        if (Number.isFinite(spacing) && spacing > TRACK_PX) {
          add("tracking", `letter-spacing ${style.letterSpacing} on "${text}"`);
        }
      }
      if (findings.length > 0) out.push({ index, findings });
    });
    return out;
  }, selector);
}

// How far each page element's visible ink reaches inside its box. Ink is text, images
// and anything with a background or border; a wrapper that only positions children is
// not ink. A painted full-bleed surface reads as full, by design.
async function probeFill(page, selector) {
  return page.evaluate((sel) => {
    const INK_TAGS = new Set(["IMG", "SVG", "CANVAS", "VIDEO"]);
    const opaque = (color) =>
      color !== "" && color !== "transparent"
      && !/^rgba\(.*,\s*0(?:\.0+)?\)$/.test(color);
    const paints = (style) =>
      style.visibility !== "hidden" && style.display !== "none"
      && Number.parseFloat(style.opacity || "1") > 0.01;
    const marksInk = (node, style) =>
      INK_TAGS.has(node.tagName.toUpperCase())
      || style.backgroundImage !== "none"
      || opaque(style.backgroundColor)
      || ["Top", "Right", "Bottom", "Left"].some(
        (side) => Number.parseFloat(style[`border${side}Width`]) > 0
          && opaque(style[`border${side}Color`]),
      );

    const els = Array.from(document.querySelectorAll(sel));
    return els.map((el, index) => {
      const box = el.getBoundingClientRect();
      if (box.height <= 0 || box.width <= 0) {
        return { index, top_gap_pct: 0, v_fill_pct: 100, h_fill_pct: 100 };
      }
      let top = box.bottom;
      let bottom = box.top;
      let right = box.left;
      const add = (r) => {
        if (r.width <= 0 || r.height <= 0) return;
        top = Math.min(top, Math.max(r.top, box.top));
        bottom = Math.max(bottom, Math.min(r.bottom, box.bottom));
        right = Math.max(right, Math.min(r.right, box.right));
      };
      const walker = document.createTreeWalker(
        el,
        NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      );
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if (node.nodeType === Node.TEXT_NODE) {
          if (node.nodeValue.trim() === "") continue;
          const parent = node.parentElement;
          if (parent === null || !paints(getComputedStyle(parent))) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const r of range.getClientRects()) add(r);
          continue;
        }
        const style = getComputedStyle(node);
        if (paints(style) && marksInk(node, style)) add(node.getBoundingClientRect());
      }
      const pct = (edge, start, size) =>
        Math.max(0, Math.min(100, Math.round(((edge - start) / size) * 100)));
      return {
        index,
        top_gap_pct: pct(top, box.top, box.height),
        v_fill_pct: pct(bottom, box.top, box.height),
        h_fill_pct: pct(right, box.left, box.width),
      };
    });
  }, selector);
}

// Text sizes as printed: per page element, visible text grouped by computed size,
// measured under print media (the stylesheet the PDF uses). The verdict is pdf_text_floor.mjs.
async function probeTextFloor(page, selector) {
  try {
    await page.emulateMedia({ media: "print" });
  } catch {
  }
  try {
    return await page.evaluate((sel) => {
      let scopes = Array.from(document.querySelectorAll(sel));
      if (scopes.length === 0 && document.body) scopes = [document.body];
      const paints = (style) =>
        style.visibility !== "hidden" && style.display !== "none"
        && Number.parseFloat(style.opacity || "1") > 0.01;
      return scopes.map((scope, index) => {
        const bySize = new Map();
        const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          const glyphs = (node.nodeValue || "").replace(/\s+/g, "");
          if (glyphs.length === 0) continue;
          const parent = node.parentElement;
          if (parent === null) continue;
          const style = getComputedStyle(parent);
          if (!paints(style)) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const laid = Array.from(range.getClientRects())
            .some((r) => r.width > 0 && r.height > 0);
          if (!laid) continue;
          const px = Number.parseFloat(style.fontSize);
          if (!Number.isFinite(px)) continue;
          const pt = Math.round(px * (72 / 96) * 10) / 10;
          const entry = bySize.get(pt) ?? { pt, chars: 0, max_node_chars: 0, sample: "" };
          entry.chars += glyphs.length;
          entry.max_node_chars = Math.max(entry.max_node_chars, glyphs.length);
          if (entry.sample === "") {
            entry.sample = (node.nodeValue || "").trim().slice(0, 40);
          }
          bySize.set(pt, entry);
        }
        const runs = [...bySize.values()].sort((a, b) => a.pt - b.pt).slice(0, 40);
        return { index, runs };
      });
    }, selector);
  } finally {
    await page.emulateMedia({ media: null }).catch(() => {});
  }
}

// Painted width vs bitmap width for every decoded image (incl. data: backgrounds),
// at the PDF's paper width under print media. The verdict is pdf_image_resolution.mjs.
async function probeImageResolution(page, selector, paperWidthPx) {
  const viewport = page.viewportSize() || DEFAULT_VIEWPORT;
  try {
    await page.emulateMedia({ media: "print" });
    await page.setViewportSize({ width: paperWidthPx, height: viewport.height });
  } catch {
  }
  try {
    return await page.evaluate(async (sel) => {
      let scopes = Array.from(document.querySelectorAll(sel));
      if (scopes.length === 0 && document.body) scopes = [document.body];
      const out = [];
      for (let index = 0; index < scopes.length; index += 1) {
        const scope = scopes[index];
        const images = [];
        for (const img of scope.querySelectorAll("img")) {
          const rect = img.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) continue;
          if (!img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0) continue;
          const aspect = img.naturalWidth / img.naturalHeight;
          const fit = getComputedStyle(img).objectFit || "fill";
          let paintedW = rect.width;
          if (fit === "contain" || fit === "scale-down" || fit === "none") {
            paintedW = Math.min(rect.width, rect.height * aspect);
          } else if (fit === "cover") {
            paintedW = Math.max(rect.width, rect.height * aspect);
          }
          if (paintedW <= 0) continue;
          images.push({
            rendered_w: Math.round(paintedW * 10) / 10,
            natural_w: img.naturalWidth,
            src_head: (img.getAttribute("src") || "").slice(0, 40),
          });
        }
        const seen = [scope, ...scope.querySelectorAll("*")];
        let decoded = 0;
        for (const el of seen) {
          if (decoded >= 12) break;
          const bg = getComputedStyle(el).backgroundImage || "";
          const match = bg.match(/url\("?(data:image[^")]+)"?\)/);
          if (!match) continue;
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0) continue;
          decoded += 1;
          const dims = await new Promise((resolve) => {
            const probe = new Image();
            probe.onload = () => resolve({ w: probe.naturalWidth, h: probe.naturalHeight });
            probe.onerror = () => resolve(null);
            probe.src = match[1];
          });
          if (dims && dims.w > 0 && dims.h > 0) {
            const size = getComputedStyle(el).backgroundSize || "auto";
            const aspect = dims.w / dims.h;
            let paintedW = rect.width;
            if (size === "contain") {
              paintedW = Math.min(rect.width, rect.height * aspect);
            } else if (size === "cover") {
              paintedW = Math.max(rect.width, rect.height * aspect);
            } else if (size === "auto" || size === "auto auto") {
              paintedW = Math.min(rect.width, dims.w);
            }
            if (paintedW > 0) {
              images.push({
                rendered_w: Math.round(paintedW * 10) / 10,
                natural_w: dims.w,
                src_head: "background-image data:",
              });
            }
          }
        }
        out.push({ index, images });
      }
      return out;
    }, selector);
  } finally {
    await page.emulateMedia({ media: null }).catch(() => {});
    await page.setViewportSize(viewport).catch(() => {});
  }
}

// Slide ids in document order ('' when a slide has none).
async function probeSlideIds(page, selector) {
  return page.evaluate(
    (sel) => Array.from(document.querySelectorAll(sel)).map((el) => el.id || ""),
    selector,
  );
}

// Built slides vs the style plan's layout_plan. Advisory only.
function comparePlan(stylePlan, slideIds) {
  const entries = Array.isArray(stylePlan?.layout_plan) ? stylePlan.layout_plan : [];
  const planned = entries.map((entry) => (entry && entry.id) || "").filter((id) => id !== "");
  const built = new Set(slideIds.filter((id) => id !== ""));
  const plannedSet = new Set(planned);
  return {
    missing_slides: planned.filter((id) => !built.has(id)),
    extra_slides: [...built].filter((id) => !plannedSet.has(id)),
  };
}

// 1-based list, matching the page-NN.png names.
function slideList(findings) {
  return findings.map((f) => f.index + 1).join(", ");
}

// "page" for documents, "slide" for decks.
function unitWord(args) {
  return args.requireGeometry && !args.structureCheck ? "page" : "slide";
}

function zeroPad(n, width) {
  const s = String(n);
  return s.length >= width ? s : "0".repeat(width - s.length) + s;
}

// Remove page-*.png from an earlier render so fewer pages can't leave orphans behind.
async function clearStalePagePngs(pngDir) {
  let entries;
  try {
    entries = await readdir(pngDir);
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter((name) => /^page-\d+\.png$/.test(name))
      .map((name) => rm(join(pngDir, name), { force: true })),
  );
}

// Read the PDF back and pair it with the page boxes measured under print media.
async function measureEmittedPdf(pdfPath, page, selector) {
  const pdfFacts = await probePdfFacts(pdfPath);
  const firstSize = (pdfFacts.page_sizes || [])[0] || "";
  const widthPt = Number.parseFloat((firstSize.split(" x ")[0] || "").trim());
  const heightPt = Number.parseFloat((firstSize.split(" x ")[1] || "").trim());
  const wrappers = await measureWrappersInPrintMedia(page, selector, widthPt);
  return {
    paperHeightPt: Number.isFinite(heightPt) ? heightPt : null,
    pdfPages: pdfFacts.pdf_pages,
    markupLeaks: pdfFacts.markup_leaks,
    probeErrors: [...(pdfFacts.errors || [])],
    wrappers,
  };
}

// Page wrapper heights as the PDF saw them: print media at the paper's width.
async function measureWrappersInPrintMedia(page, selector, paperWidthPt) {
  const widthPx = Number.isFinite(paperWidthPt)
    ? Math.round((paperWidthPt / 72) * 96)
    : DEFAULT_VIEWPORT.width;
  const viewport = page.viewportSize() || DEFAULT_VIEWPORT;
  try {
    await page.emulateMedia({ media: "print" });
    await page.setViewportSize({ width: widthPx, height: viewport.height });
  } catch {
  }
  try {
    return await page.evaluate(
      (sel) =>
        Array.from(document.querySelectorAll(sel)).map((el, index) => ({
          index,
          rectH: Math.round(el.getBoundingClientRect().height),
        })),
      selector,
    );
  } finally {
    await page.emulateMedia({ media: "screen" }).catch(() => {});
    await page.setViewportSize(viewport).catch(() => {});
  }
}

// Sideways scroll of a plain web page: the document laid out wider than the viewport.
// Inner scrollers (a wide table in overflow-x:auto) don't widen the document, so they pass.
async function probePageOverflowX(page) {
  return page.evaluate((tolerance) => {
    const vw = document.documentElement.clientWidth;
    const sw = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0);
    const overflow = Math.max(0, Math.round(sw - vw));
    let widest = null;
    if (overflow > tolerance) {
      let best = 0;
      for (const el of document.body.querySelectorAll("*")) {
        const r = el.getBoundingClientRect();
        if (r.right > vw + tolerance && r.right > best) {
          best = r.right;
          const id = el.id ? `#${el.id}` : "";
          const cls = (el.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean)[0];
          widest = `${el.tagName.toLowerCase()}${id}${cls ? `.${cls}` : ""}`;
        }
      }
    }
    return { viewport_width: vw, scroll_width: Math.round(sw), overflow_px: overflow, widest };
  }, PAGE_OVERFLOW_TOLERANCE_PX);
}

// --- Verdict ---------------------------------------------------------------

// Only under --gate. Only unambiguous defects fail; anything a legitimate
// artifact can produce is an advisory, because a failed gate means nothing
// gets delivered.
function evaluateGate(report, args) {
  const failures = [];
  const advisories = [];
  const { fonts, overflow, broken_images: broken, fill, plan } = report;

  if (report.browser_failures !== undefined) {
    const shown = report.browser_failures.slice(0, 5);
    const omitted = report.browser_failures.length - shown.length;
    failures.push(`browser audit failed: ${shown.join("; ")}${omitted > 0 ? `; ${omitted} more` : ""}`);
  }
  // A missing face is reported but never fails: fix it when it's real.
  if (fonts.missing.length > 0) advisories.push(`fonts not rasterized: ${fonts.missing.join(", ")}`);
  if (overflow.length > 0) failures.push(`content overflows its canvas on ${unitWord(args)}(s) ${slideList(overflow)}`);
  if (report.page_overflow_x && report.page_overflow_x.overflow_px > PAGE_OVERFLOW_TOLERANCE_PX) {
    const o = report.page_overflow_x;
    failures.push(
      `the page scrolls sideways at ${o.viewport_width}px wide (laid out ${o.scroll_width}px` +
        `${o.widest ? `, widest element ${o.widest}` : ""}); make it reflow`,
    );
  }
  if (report.geometry) {
    failures.push(...report.geometry.failures);
    advisories.push(...report.geometry.advisories);
  }
  if (args.requireTextFloor && Array.isArray(report.text_floor)) {
    const floor = evaluateTextFloor(report.text_floor);
    failures.push(...floor.failures.map((f) => f.message));
    advisories.push(...floor.advisories.map((f) => f.message));
  }
  if (args.requireImageResolution && Array.isArray(report.image_resolution)) {
    const res = evaluateImageResolution(report.image_resolution);
    failures.push(...res.failures.map((f) => f.message));
    advisories.push(...res.advisories.map((f) => f.message));
  }
  if (report.image_resolution_not_measured !== undefined) {
    advisories.push(`image resolution could not be measured (${report.image_resolution_not_measured}); this check did not run`);
  }
  if (broken?.length > 0) failures.push(`broken image(s) on ${unitWord(args)}(s) ${slideList(broken)}`);
  if (args.requireCoverImage && report.cover_no_image === true) failures.push("cover has no decoded image");
  if (args.requireRestraint && Array.isArray(report.restraint) && report.restraint.length > 0) {
    const shown = report.restraint.slice(0, 3).map((r) => `${r.index + 1}: ${r.findings.join(", ")}`);
    const omitted = report.restraint.length - shown.length;
    failures.push(
      `banned slide furniture, uppercase, or letter tracking on ${unitWord(args)}(s) ${slideList(report.restraint)} ` +
        `(${shown.join("; ")}${omitted > 0 ? `; ${omitted} more` : ""})`,
    );
  }
  if (args.requireFillPct !== null && Array.isArray(fill)) {
    // Sparse is fine when centred; the defect is content packed at the top with
    // dead space below (bottom gap more than twice the top gap).
    const topPacked = (f) => 100 - f.v_fill_pct > 2 * f.top_gap_pct;
    const short = fill.filter((f) => f.v_fill_pct < args.requireFillPct && topPacked(f));
    if (short.length > 0) {
      failures.push(
        `content stops short of the canvas (need >=${args.requireFillPct}% vertical fill) on slide(s) ` +
          short.map((f) => `${f.index + 1}:${f.v_fill_pct}%`).join(", "),
      );
    }
  }
  if (plan !== undefined && plan.missing_slides.length > 0) {
    advisories.push(`style plan slide(s) not built: ${plan.missing_slides.join(", ")}`);
  }
  report.gate_failures = failures;
  report.advisories = advisories;
  if (failures.length > 0) report.ok = false;
}

// --- Main ------------------------------------------------------------------

async function runAudit(args) {
  if (!existsSync(args.html)) throw new Error(`--html file not found: ${args.html}`);
  if (args.pngDir) await mkdir(args.pngDir, { recursive: true });
  if (args.pdf) await mkdir(dirname(args.pdf), { recursive: true });

  const { audit, playwright, executablePath } = await loadBrowserRuntime();
  process.stderr.write(`render_audit: chrome at ${executablePath}\n`);
  const launchOptions = audit.buildLaunchOptions(executablePath);
  if (args.hermetic) {
    // Nothing resolves, so nothing is reachable even if a request slipped past
    // the route handler below.
    launchOptions.args = [
      ...(launchOptions.args ?? []),
      "--disable-quic",
      "--proxy-server=direct://",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost",
      "--disable-file-access-from-file-urls",
    ];
  }
  const browser = await playwright.chromium.launch(launchOptions);
  const report = { ok: true, pdf: args.pdf, pages: 0, pngs: [], fonts: { missing: [], unused: [], used: [], expected: [] }, overflow: [] };

  try {
    const context = await browser.newContext({ viewport: args.viewport, deviceScaleFactor: 2 });
    // file: requests outside the artifact folder are always refused; remote
    // requests only under --hermetic (a document may hotlink on purpose).
    const assetRoots = realRootsFor(artifactAssetRoots(args.html));
    const blockedRequests = { local: [], remote: 0 };
    await context.route("**/*", (route) => {
      const url = route.request().url();
      if (/^(data|about|blob):/.test(url)) return route.continue();
      if (url.startsWith("file:")) {
        if (fileUrlWithinRoots(url, assetRoots)) return route.continue();
        if (blockedRequests.local.length < 20) blockedRequests.local.push(url.slice(0, 200));
        return route.abort();
      }
      if (!args.hermetic) return route.continue();
      blockedRequests.remote += 1;
      return route.abort();
    });
    const page = await context.newPage();
    const consoleErrors = [];
    const failedImageResponses = [];
    const brokenAssets = [];
    const fileUrl = pathToFileURL(args.html).href;
    audit.installPageDiagnostics(page, consoleErrors, failedImageResponses, new URL(fileUrl).origin, [], brokenAssets);
    await page.goto(fileUrl, { waitUntil: "load", timeout: PAGE_LOAD_TIMEOUT_MS });

    const fontsReady = await page
      .evaluate((ms) => Promise.race([document.fonts.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), ms))]), FONTS_READY_TIMEOUT_MS)
      .catch(() => null);
    if (fontsReady === false) {
      process.stderr.write(`render_audit: a webfont was still loading after ${FONTS_READY_TIMEOUT_MS}ms; the page rasterized mid-load\n`);
    }
    await page.waitForTimeout(CHART_SETTLE_MS);
    // Make lazy images load and wait for every image to finish (or time out).
    await page.evaluate((ms) => {
      for (const image of document.images) image.loading = "eager";
      return Promise.all(Array.from(document.images, (image) => {
        if (image.complete) return Promise.resolve();
        return Promise.race([
          new Promise((resolve) => {
            image.addEventListener("load", resolve, { once: true });
            image.addEventListener("error", resolve, { once: true });
          }),
          new Promise((resolve) => setTimeout(resolve, ms)),
        ]);
      }));
    }, PAGE_LOAD_TIMEOUT_MS);

    const imageAudit = audit.summarizeImages(await audit.collectRawImages(page), failedImageResponses);
    const browserFailures = [
      ...consoleErrors,
      ...imageAudit.broken.map(({ src, reason }) => `broken image: ${src.slice(0, 80)} (${reason})`),
      ...imageAudit.unstable.map(({ src, reason }) => `unstable image: ${src.slice(0, 80)} (${reason})`),
      ...audit.dedupeBrokenAssets(brokenAssets).map(({ url, status, resource_type }) => `broken ${resource_type}: ${url.slice(0, 80)} (${status})`),
    ];
    // Recorded now, judged at exit, so the probes and outputs below still land.
    if (browserFailures.length > 0) report.browser_failures = browserFailures;
    if (blockedRequests.local.length > 0 || blockedRequests.remote > 0) {
      report.blocked_requests = blockedRequests;
      for (const url of blockedRequests.local) process.stderr.write(`render_audit: refused a local request outside the artifact: ${url}\n`);
      if (blockedRequests.remote > 0) process.stderr.write(`render_audit: hermetic render refused ${blockedRequests.remote} remote request(s)\n`);
    }

    // Font gate. Fails closed: if CDP can't inspect the text, the run fails.
    let fontProbe = null;
    try {
      const requested = args.fonts.length > 0
        ? args.fonts.map((face) => ({ family: face.family, weight: face.weight, label: `${face.family}:${face.weight}` }))
        : (await probeThemeFamilies(page)).map((raw) => {
            const family = raw.trim().replace(/^["']|["']$/g, "");
            return { family, weight: null, label: family };
          });
      const seen = new Set();
      const gated = requested.filter((face) => {
        const familyKey = normalizeFamily(face.family);
        const key = `${familyKey}:${face.weight ?? "*"}`;
        if (familyKey.length === 0 || CSS_GENERIC_FAMILIES.has(familyKey) || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      report.fonts.expected = gated.map((face) => face.label);
      if (gated.length > 0) {
        fontProbe = await openUsedFontProbe(context, page, args.pageSelector);
        report.fonts.used = [...new Set(fontProbe.usages.map((font) => font.familyName))];
        for (let index = 0; index < gated.length; index += 1) {
          const result = await resolveExpectedFace(page, fontProbe, gated[index], index, args.requireWebfonts);
          if (!result.available) report.fonts.missing.push(gated[index].label);
          else if (!result.rendered) report.fonts.unused.push(gated[index].label);
        }
      }
    } catch (err) {
      throw new Error(`font probe failed: ${(err && err.message) || String(err)}`);
    } finally {
      if (fontProbe !== null) await fontProbe.session.detach().catch(() => {});
    }

    if (args.fullPage) report.page_overflow_x = await probePageOverflowX(page);
    else report.overflow = await probeOverflow(page, args.pageSelector);
    if (args.requireTextFloor) report.text_floor = await probeTextFloor(page, args.pageSelector);
    if (args.structureCheck) {
      const structure = await probeStructure(page, args.pageSelector);
      report.cover_no_image = structure.cover_no_image;
      report.restraint = await probeRestraint(page, args.pageSelector);
      report.broken_images = structure.broken_images;
      report.fill = await probeFill(page, args.pageSelector);
    }
    // A missing plan file is a normal state and skips the comparison; a plan that
    // exists but doesn't parse is an error.
    if (args.stylePlan) {
      let raw = null;
      try {
        raw = await readFile(args.stylePlan, "utf8");
      } catch (err) {
        if (err?.code !== "ENOENT") throw new Error(`style plan unreadable at ${args.stylePlan}: ${err.message}`);
        process.stderr.write(`render_audit: no style plan at ${args.stylePlan}; skipping the plan comparison\n`);
      }
      if (raw !== null) {
        let plan;
        try {
          plan = JSON.parse(raw);
        } catch (err) {
          throw new Error(`style plan malformed at ${args.stylePlan}: ${err.message}`);
        }
        report.plan = comparePlan(plan, await probeSlideIds(page, args.pageSelector));
      }
    }

    if (args.pdf) {
      await page.pdf({ path: args.pdf, ...PDF_EXPORT_OPTIONS });
      process.stderr.write(`render_audit: wrote PDF ${args.pdf}\n`);
      if (args.requireImageResolution) {
        const facts = await probePdfFacts(args.pdf);
        const firstSize = (facts.page_sizes || [])[0] || "";
        const paperWidthPt = Number.parseFloat((firstSize.split(" x ")[0] || "").trim());
        if (Number.isFinite(paperWidthPt)) {
          report.image_resolution = await probeImageResolution(page, args.pageSelector, Math.round((paperWidthPt / 72) * 96));
        } else {
          report.image_resolution_not_measured = `paper width unreadable (${(facts.errors || []).join("; ")})`;
        }
      }
      if (args.requireGeometry) {
        const geometry = evaluatePdfGeometry(await measureEmittedPdf(args.pdf, page, args.pageSelector));
        report.geometry = { failures: geometry.failures.map((f) => f.message), advisories: geometry.advisories.map((f) => f.message) };
        for (const f of [...geometry.failures, ...geometry.advisories]) process.stderr.write(`render_audit geometry: ${f.message}\n`);
      }
    }

    if (args.pngDir) {
      await clearStalePagePngs(args.pngDir);
      const handles = args.fullPage ? [] : await page.$$(args.pageSelector);
      if (handles.length > 0) {
        const width = String(handles.length).length;
        for (let i = 0; i < handles.length; i += 1) {
          const pngPath = join(args.pngDir, `page-${zeroPad(i + 1, width)}.png`);
          await handles[i].screenshot({ path: pngPath });
          report.pngs.push(pngPath);
        }
      } else {
        if (!args.fullPage) {
          process.stderr.write(`render_audit: page selector '${args.pageSelector}' matched nothing; taking one full-page screenshot\n`);
        }
        const pngPath = join(args.pngDir, "page-1.png");
        await page.screenshot({ path: pngPath, fullPage: true });
        report.pngs.push(pngPath);
      }
      report.pages = report.pngs.length;
    }
    await context.close();
  } finally {
    await browser.close();
  }
  return report;
}

async function writeReport(path, report) {
  if (!path) return;
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(report, null, 2) + "\n", "utf8");
  } catch (err) {
    process.stderr.write(`render_audit: could not write --report-out ${path}: ${(err && err.message) || String(err)}\n`);
  }
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    const message = (err && err.message) || String(err);
    process.stderr.write(`${message}\n`);
    process.stdout.write(JSON.stringify({ ok: false, error: message }) + "\n");
    return 2;
  }
  try {
    const report = await runAudit(args);
    if (args.gate) {
      evaluateGate(report, args);
      for (const f of report.gate_failures) process.stderr.write(`render_audit gate: ${f}\n`);
      for (const a of report.advisories) process.stderr.write(`render_audit advisory: ${a}\n`);
    } else if (report.browser_failures !== undefined) {
      // Browser failures fail the run with or without --gate.
      report.ok = false;
      for (const f of report.browser_failures) process.stderr.write(`render_audit browser: ${f}\n`);
    }
    process.stdout.write(JSON.stringify(report) + "\n");
    await writeReport(args.reportOut, report);
    return report.ok ? 0 : 1;
  } catch (err) {
    const message = (err && err.message) || String(err);
    process.stderr.write(`render_audit fatal: ${message}\n`);
    const failed = { ok: false, pdf: args.pdf, pages: 0, pngs: [], fonts: { missing: [], unused: [], used: [], expected: [] }, overflow: [], error: message };
    process.stdout.write(JSON.stringify(failed) + "\n");
    await writeReport(args.reportOut, failed);
    return 1;
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`render_audit unexpected: ${String(err)}\n`);
      process.stdout.write(JSON.stringify({ ok: false, error: `unexpected: ${String(err)}` }) + "\n");
      process.exit(1);
    },
  );
}
