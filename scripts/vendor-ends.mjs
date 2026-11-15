#!/usr/bin/env node
// Measures the size of each piece of text on every template's cover and closing slide and records it in <template>/ends.json
// ("sizes": {"cover": [px, ...], "closing": [px, ...]}, one number per piece in the order new_deck.mjs --patterns numbers them), so that
// --patterns can tell the helper which pieces are the headline and which are small labels. A developer tool, not shipped.
//   ONEHC_CHROME=<chrome> node scripts/vendor-ends.mjs [--only a,b]
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, "..", "src", "skills", "artifacts", "scripts");
const ROOT = join(HERE, "..", "app-assets", "deck-templates");
const { loadBrowserRuntime } = await import(join(SCRIPTS, "browser_runtime.mjs"));
const { audit, playwright, executablePath } = await loadBrowserRuntime();
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1].split(",") : null;

// Runs in the page: the font size of each text node of slide `index`, skipping script, style and svg, in document order.
function sizes(index) {
  const slide = document.querySelectorAll("[data-hc-slide]")[index], out = [];
  const w = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode()); ) { if (!n.nodeValue.trim() || n.parentElement.closest("script,style,svg")) continue; out.push(Math.round(parseFloat(getComputedStyle(n.parentElement).fontSize))); }
  return out;
}
const browser = await playwright.chromium.launch(audit.buildLaunchOptions(executablePath));
for (const t of readdirSync(ROOT).filter((n) => existsSync(join(ROOT, n, "ends.json")) && (!only || only.includes(n)))) {
  const f = join(ROOT, t, "ends.json"), ends = JSON.parse(readFileSync(f, "utf8")), dir = mkdtempSync(join(tmpdir(), "ends-"));
  try {
    execFileSync("node", [join(SCRIPTS, "new_deck.mjs"), dir, "--template", t, "--title", "x", "--slides", `${ends.cover},${ends.closing}`], { stdio: "pipe" });
    execFileSync("node", [join(SCRIPTS, "assemble_deck.mjs"), dir], { stdio: "pipe" });
    const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
    await page.goto(pathToFileURL(join(dir, ".src", "build", "deck.html")).href);
    await page.evaluate("document.fonts.ready"); await page.waitForTimeout(800);
    const s = { cover: await page.evaluate(`(${sizes})(0)`), closing: await page.evaluate(`(${sizes})(1)`) };
    writeFileSync(f, JSON.stringify({ cover: ends.cover, closing: ends.closing, sizes: s }) + "\n");
    console.log(`${t}: ${s.cover.length} and ${s.closing.length} pieces`);
  } catch (e) { console.error(`${t}: ${String(e.message).slice(0, 160)}`); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}
await browser.close();
