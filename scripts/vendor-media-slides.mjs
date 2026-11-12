#!/usr/bin/env node
// Adds one more slide pattern, "media", to every vendored template: a title, a short paragraph and a large dashed box marked
// "Screenshot or GIF goes here", styled with the template's own fonts and colours. The person drops their own screenshots into the
// box (an empty picture placeholder in the .pptx). Run after vendor-html-templates.mjs; a developer tool, not shipped.
//
//   ONEHC_CHROME=<chrome> node scripts/vendor-media-slides.mjs [--only a,b]
//
// For each template it starts from one of the template's own slides (scripts/vendor-media-slides.json says which, and how to place
// the box), opens it in Chrome, keeps the title and the paragraph, removes every other piece of text, adds the box, and writes
// templates/<name>/slides/00-media.html. The title, paragraph and box carry data-slot="title", "body" and "media" so
// new_deck.mjs --data can fill them without the slide's markup.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, "..", "src", "skills", "artifacts", "scripts");
const CFG = JSON.parse(readFileSync(join(HERE, "vendor-media-slides.json"), "utf8"));
const { loadBrowserRuntime } = await import(join(SCRIPTS, "browser_runtime.mjs"));
const { audit, playwright, executablePath } = await loadBrowserRuntime();
const KIND = process.argv.includes("--project") ? "project" : "media";   // --project writes slides/00-project.html instead of 00-media.html
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1].split(",") : null;
const DEFAULT_BASES = ["statement", "chapter", "section", "manifesto", "big-statement", "section-opener", "text", "list", "closing"];

// Runs in the page. Returns the new slide's markup: the base slide's own outer element (so its background and decoration stay),
// with a title, a paragraph and the box laid out on the 1920x1080 stage, in the base slide's own fonts and colours.
function edit(cfg, kind) {
  const slide = document.querySelector("[data-hc-slide]");
  const texts = [];
  const w = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode()); ) {
    const t = n.nodeValue.replace(/\s+/g, " ").trim(), el = n.parentElement;
    if (!t || el.closest("script,style,svg")) continue;
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    if (cs.visibility === "hidden" || cs.display === "none" || r.width < 2) continue;
    texts.push({ el, t, fs: parseFloat(cs.fontSize), words: t.split(" ").length });
  }
  const pick = (sel, f) => (sel ? slide.querySelector(sel) : f());
  const title = pick(cfg.title, () => (texts.filter((x) => x.words >= 1 && x.words <= 14 && x.t.length >= 3).sort((a, b) => b.fs - a.fs)[0] || {}).el);
  if (!title) throw new Error("no title found");
  const body = pick(cfg.body, () => (texts.filter((x) => x.words >= 5 && !title.contains(x.el) && x.fs >= 14 && x.fs <= 60).sort((a, b) => b.fs - a.fs)[0] || {}).el) || title;
  const look = (el, px, extra) => {
    const c = getComputedStyle(el);
    const keep = { "font-family": c.fontFamily, "font-weight": c.fontWeight, "font-style": c.fontStyle, "letter-spacing": c.letterSpacing, "text-transform": c.textTransform, color: readable(c.color), "font-size": px + "px", "line-height": cfg.lh || "1.15" };
    return Object.entries({ ...keep, ...extra }).map(([k, v]) => `${k}:${String(v).replace(/"/g, "'")}`).join(";") + ";margin:0;padding:0;text-align:left;text-shadow:none;opacity:1;transform:none;animation:none;position:static;width:auto;max-width:none;background:none;border:0;display:block;visibility:visible";
  };
  // The slide's backdrop colour, and a text colour that reads on it: the base slide's own title or paragraph colour when it does.
  const rgb = (c) => (c.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
  const lum = (c) => { const [r, g, b] = rgb(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  let backdrop = "rgb(255, 255, 255)";
  for (let a = slide; a; a = a.parentElement) { const c = getComputedStyle(a).backgroundColor; if (c && !/rgba\(.*,\s*0\)$/.test(c) && c !== "transparent") { backdrop = c; break; } }
  const readable = (c) => [c, getComputedStyle(body).color, getComputedStyle(title).color, "rgb(17, 17, 17)", "rgb(255, 255, 255)"].find((x) => contrast(x, backdrop) >= 4.5) || c;
  const tcolor = readable(getComputedStyle(title).color), bcolor = readable(getComputedStyle(body).color);
  const box = cfg.box || "left:724px;top:96px;width:1100px;height:888px";
  let html = `<div style="position:absolute;left:96px;top:96px;width:580px;display:flex;flex-direction:column;gap:32px;z-index:2">` +
    `<h2 data-slot="title" style="${look(title, cfg.titlePx || 84, { "line-height": "1.08", "font-weight": getComputedStyle(title).fontWeight })}">Slide title goes here</h2>` +
    `<p data-slot="body" style="${look(body, cfg.bodyPx || 30, { "font-weight": body === title ? "400" : getComputedStyle(body).fontWeight, "text-transform": "none", "line-height": "1.4", opacity: body === title ? "0.8" : "1" })}">One or two sentences about this slide go here.</p></div>` +
    `<div class="hc-drop" data-hc-media data-slot="media" style="position:absolute;${box};color:${cfg.dropColor || tcolor};font-family:${getComputedStyle(body).fontFamily.replace(/"/g, "'")}">Screenshot or GIF goes here</div>`;

  if (kind === "project") {
    // The accent: the most colourful colour the base slide uses for text or a filled shape that still reads on the backdrop (cfg.accent overrides).
    const chroma = (c) => { const [r, g, b] = rgb(c); return Math.max(r, g, b) - Math.min(r, g, b); };
    const seen = new Map();
    for (const el of slide.querySelectorAll("*")) { const cs = getComputedStyle(el); for (const c of [cs.color, cs.backgroundColor, cs.borderTopColor]) if (c && c.startsWith("rgb(") && c !== "rgb(0, 0, 0)") seen.set(c, (seen.get(c) || 0) + 1); }
    const accent = cfg.accent || [...seen.keys()].filter((c) => contrast(c, backdrop) >= 3.2 && chroma(c) >= 60).sort((a, b) => chroma(b) - chroma(a))[0] || tcolor;
    const strong = (c) => [c, tcolor, getComputedStyle(title).color, "rgb(17, 17, 17)", "rgb(255, 255, 255)"].find((x) => x.startsWith("rgb(") && contrast(x, backdrop) >= 7) || c;   // a colour with some transparency never counts: it renders paler than it measures
    const pcolor = strong(bcolor), muted = pcolor, tf = getComputedStyle(title).fontFamily.replace(/"/g, "'"), bf = (cfg.bodyFamily || getComputedStyle(body).fontFamily).replace(/"/g, "'");
    const tw = getComputedStyle(title).fontWeight, tt = getComputedStyle(title).textTransform;
    const base = "margin:0;padding:0;text-align:left;text-shadow:none;opacity:1;transform:none;animation:none;position:static;width:auto;max-width:none;background:none;border:0;display:block;visibility:visible;font-style:normal;";
    const small = (extra) => `${base}font-family:${bf};font-weight:700;font-size:24px;line-height:1.2;letter-spacing:3px;text-transform:uppercase;${extra}`;
    const text = (slot, px, extra) => `data-slot="${slot}" style="${base}font-family:${bf};font-weight:400;font-size:${px}px;line-height:1.35;letter-spacing:normal;text-transform:none;color:${pcolor};${extra || ""}"`;
    const stat = (n, v, l) => `<div data-slot="stat${n}-box" style="${base}display:flex;flex-direction:column;gap:6px"><p data-slot="stat${n}" style="white-space:nowrap;${base}font-family:${tf};font-weight:${tw};font-size:${cfg.statPx || 120}px;line-height:1;letter-spacing:${getComputedStyle(title).letterSpacing};text-transform:${tt};color:${accent}">${v}</p><p data-slot="stat${n}_label" style="${base}font-family:${bf};font-weight:500;font-size:26px;line-height:1.25;color:${muted}">${l}</p></div>`;
    const bx = cfg.projectBox || "left:916px;top:96px;width:908px;height:888px";
    html = `<div style="position:absolute;left:96px;top:96px;width:${cfg.colPx || 780}px;height:888px;display:flex;flex-direction:column;z-index:2">` +
      `<p data-slot="label" style="${small(`color:${accent}`)}">Department and users</p>` +
      `<h2 data-slot="title" style="${look(title, cfg.projectTitlePx || 80, { "line-height": "1.05", "font-weight": tw, color: strong(tcolor) })}margin-top:20px;">Project title goes here</h2>` +
      `<div style="width:72px;height:6px;background:${accent};margin:32px 0 40px"></div>` +
      `<p style="${small(`color:${accent};margin-bottom:12px`)}">The problem</p><p ${text("problem", 34, "margin-bottom:36px")}>What was slow, costly or hard before, in one or two lines.</p>` +
      `<p style="${small(`color:${accent};margin-bottom:12px`)}">What we built</p><p ${text("built", 34)}>What the team made, in one or two lines.</p>` +
      `<div data-slot="impact" style="margin-top:auto;display:flex;gap:64px;padding-top:26px;border-top:2px solid ${accent}">${stat(1, "00%", "what changed")}${stat(2, "0x", "what else changed")}</div></div>` +
      `<div class="hc-drop" data-hc-media data-slot="media" style="position:absolute;${bx};color:${cfg.dropColor || tcolor};font-family:${bf}">Screenshot or GIF goes here</div>`;
  }
  const root = slide.cloneNode(false);
  if (getComputedStyle(slide).position === "static") root.style.position = "relative";
  root.removeAttribute("data-hc-slide");
  for (const a of [...root.attributes]) if (/^data-(deck|screen-label|om-)/.test(a.name)) root.removeAttribute(a.name);
  root.classList.remove("active", "is-active");
  if (!root.className) root.removeAttribute("class");
  root.innerHTML = html;
  return root.outerHTML;
}

const browser = await playwright.chromium.launch(audit.buildLaunchOptions(executablePath));
const root = join(SCRIPTS, "..", "..", "..", "..", "app-assets", "deck-templates");
const names = readdirSync(root).filter((n) => existsSync(join(root, n, "head.html")) && (!only || only.includes(n)));
for (const t of names) {
  const cfg = CFG[t] || {};
  const patterns = readdirSync(join(root, t, "slides")).filter((f) => !f.startsWith("00-")).map((f) => f.replace(/^\d+-|\.html$/g, ""));
  const base = cfg.base || DEFAULT_BASES.find((b) => patterns.includes(b)) || patterns[1];
  const dir = mkdtempSync(join(tmpdir(), "media-"));
  try {
    execFileSync("node", [join(SCRIPTS, "new_deck.mjs"), dir, "--template", t, "--title", "x", "--slides", base], { stdio: "pipe" });
    execFileSync("node", [join(SCRIPTS, "assemble_deck.mjs"), dir], { stdio: "pipe" });
    const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
    await page.goto(pathToFileURL(join(dir, ".src", "build", "deck.html")).href);
    await page.evaluate("document.fonts.ready");
    await page.waitForTimeout(2200);
    const html = await page.evaluate(`(${edit})(${JSON.stringify(cfg)}, ${JSON.stringify(KIND)})`);
    writeFileSync(join(root, t, "slides", `00-${KIND}.html`), html + "\n");
    console.log(`${t}: ${KIND} from ${base}`);
  } catch (e) { console.error(`${t}: ${String(e.message).slice(0, 200)}`); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}
await browser.close();
