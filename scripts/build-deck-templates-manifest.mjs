#!/usr/bin/env node
// Writes app-assets/deck-templates/manifest.json: for each deck template, the files a computer needs to build a deck from it
// (the template's own files, the font files its fonts.json names and the shared scripts its slides load) and one content hash of them.
// The Worker serves the templates from its static assets (the ASSETS binding, not the script bundle), reads this file, and sends a
// computer only the template a deck command uses, again only when the hash differs from the one that computer holds.
//   node scripts/build-deck-templates-manifest.mjs            write the manifest
//   node scripts/build-deck-templates-manifest.mjs --check    exit 1 when the manifest is stale (scripts/deploy.sh and the tests run this)
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { templateFileSet } from "../src/skills/artifacts/scripts/deck_templates_dir.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "app-assets", "deck-templates");

export function buildManifest(root = ROOT) {
  const templates = {};
  for (const name of readdirSync(root).filter((n) => !n.startsWith("_") && existsSync(join(root, n, "head.html"))).sort()) {
    const files = templateFileSet(root, name), h = createHash("sha256");
    for (const f of files) h.update(`${f}\0`).update(readFileSync(join(root, f))).update("\0");
    templates[name] = { hash: h.digest("hex").slice(0, 16), files };
  }
  return JSON.stringify({ version: 1, templates }, null, 1) + "\n";
}

if (process.argv[1] && process.argv[1].endsWith("build-deck-templates-manifest.mjs")) {
  const out = join(ROOT, "manifest.json"), text = buildManifest();
  if (process.argv.includes("--check")) {
    if (!existsSync(out) || readFileSync(out, "utf8") !== text) { console.error("app-assets/deck-templates/manifest.json is stale: run node scripts/build-deck-templates-manifest.mjs"); process.exit(1); }
    console.log("deck template manifest is current");
  } else { writeFileSync(out, text); console.log(`wrote ${out} (${Object.keys(JSON.parse(text).templates).length} templates)`); }
}
