// Where the deck templates are: app-assets/deck-templates in a checkout of the repository, otherwise where the channel computer
// writes the ones a deck command names (/opt/1hc/deck-templates, one template at a time). A module the scripts load; you don't run it.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.argv[1] && import.meta.url.endsWith("/" + process.argv[1].split("/").pop()) && process.argv.slice(2).some((a) => a === "--help" || a === "-h")) {
  const L = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n"), end = L.findIndex((l, i) => i > 0 && !l.startsWith("//"));
  process.stdout.write(L.slice(1, end).map((l) => l.replace(/^\/\/ ?/, "")).join("\n") + "\n"); process.exit(0);
}
const HERE = dirname(fileURLToPath(import.meta.url));
export const TEMPLATES = [process.env.HC_DECK_TEMPLATES, join(HERE, "..", "..", "..", "..", "app-assets", "deck-templates"), "/opt/1hc/deck-templates"].find((d) => d && existsSync(join(d, "LICENSE"))) || "/opt/1hc/deck-templates";

// Every file a deck made from one template needs, as paths under the templates folder: the template's own files, the font files its
// fonts.json names, the shared scripts its slides load, the font width table for the PowerPoint export, and the license. The channel computer is sent these (src/deck-templates.js) and
// new_deck.mjs copies them into the deck's own .src/template, so a deck never depends on the shared folder staying where it is.
export function templateFileSet(root, name) {
  const walk = (dir, rel = "") => readdirSync(join(dir, rel)).sort().flatMap((n) => statSync(join(dir, rel, n)).isDirectory() ? walk(dir, `${rel}${n}/`) : [`${rel}${n}`]);
  const own = walk(join(root, name)).filter((f) => f !== ".hash").map((f) => `${name}/${f}`);
  const text = own.map((f) => readFileSync(join(root, f), "utf8")).join("\n");
  const fonts = JSON.parse(readFileSync(join(root, name, "fonts.json"), "utf8")).map((f) => `_fonts/${f.id}.b64`);
  const libs = [...text.matchAll(/hc-lib:([\w.-]+)/g)].map((m) => `_lib/${m[1]}`);
  const measure = existsSync(join(root, "_measure")) ? readdirSync(join(root, "_measure")).map((f) => `_measure/${f}`) : [];   // the font width table the PowerPoint export fits text with (and its licenses)
  return [...new Set([...own, ...fonts, ...libs, ...measure, "LICENSE"])].sort();
}

// The folder a deck reads its template from: its own copy (<project>/.src/template, made when the deck was started) when it has one.
export const templatesFor = (project) => existsSync(join(project, ".src", "template", "LICENSE")) ? join(project, ".src", "template") : TEMPLATES;
