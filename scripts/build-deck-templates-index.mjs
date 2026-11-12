#!/usr/bin/env node
// Writes src/skills/artifacts/references/deck-templates.md, the short list the helper reads to pick a deck template, from
// app-assets/deck-templates/index.json (the vendored templates and their slide patterns) and scripts/deck-template-notes.json (one line of feel and
// use per template, and the size of its running type). `--check` exits 1 when the file is out of date.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "src", "skills", "artifacts", "references", "deck-templates.md");
const idx = JSON.parse(readFileSync(join(HERE, "..", "app-assets", "deck-templates", "index.json"), "utf8"));
const notes = JSON.parse(readFileSync(join(HERE, "deck-template-notes.json"), "utf8"));
const rows = idx.templates.map((t) => {
  const n = notes[t.name];
  if (!n) throw new Error(`no entry for ${t.name} in deck-template-notes.json`);
  return `- ${t.name} (${t.scheme}, ${t.density}, ${n[2]}): ${n[0]}; for ${n[1]}.\n  Patterns: ${["media", "project", ...t.patterns].join(", ")}`;
});
const text = `# Deck templates

Pick the one template whose feel and use match the request's tone and occasion; don't ask the person about taste. Each line is
(light or dark, how much one slide holds, type size), then its feel and use. Small type suits reading decks, large type suits
talking over slides. Every template has the pattern "media" (a title, a few words and a large empty box for the person's own
screenshots or GIFs) and the pattern "project" (a title, who it is for, the problem, what was built, one or two impact numbers and the
same empty box; use it for a deck with one slide per project); the others are its own sample slides. A pattern can be used as often as the deck needs.

${rows.join("\n")}
`;
if (process.argv.includes("--check")) {
  const have = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (have !== text) { console.error("references/deck-templates.md is stale: run node scripts/build-deck-templates-index.mjs"); process.exit(1); }
  console.log("deck-templates.md is current");
} else { writeFileSync(OUT, text); console.log(`wrote ${OUT} (${text.length} bytes)`); }
