// Facts read back from an emitted PDF with poppler, for the geometry gate:
// page count, paper sizes, and markup that ended up printed as text.
// Every probe degrades to an empty result plus an entry in `errors`, so a
// missing binary reads as "not measured", never as a clean pass.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
// --help: print the header above and exit.
if (process.argv[1] && import.meta.url.endsWith("/" + process.argv[1].split("/").pop()) && process.argv.slice(2).some((a) => a === "--help" || a === "-h")) {
  const HELP = (await import("node:fs")).readFileSync(new URL(import.meta.url), "utf8").split("\n"), end = HELP.findIndex((l, i) => i > 0 && !l.startsWith("//"));
  process.stdout.write(HELP.slice(HELP[0].startsWith("#!") ? 1 : 0, end).map((l) => l.replace(/^\/\/ ?/, "")).join("\n") + "\n" + "(A module the other scripts load; you don't run it.)\n"); process.exit(0);
}

const run = promisify(execFile);
const ERR_PREFIX = "__ERR__ ";

async function poppler(bin, args) {
  try {
    const { stdout } = await run(bin, args, { timeout: 30_000, maxBuffer: 32 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    return `${ERR_PREFIX}${(err && err.message) || String(err)}`;
  }
}

export async function probePdfFacts(pdfPath) {
  const facts = { pdf_pages: null, page_sizes: [], markup_leaks: [], errors: [] };
  const info = await poppler("pdfinfo", ["-f", "1", "-l", "9999", pdfPath]);
  if (info.startsWith(ERR_PREFIX)) {
    facts.errors.push(`pdfinfo: ${info.slice(ERR_PREFIX.length)}`);
  } else {
    const pages = /^Pages:\s+(\d+)/m.exec(info);
    if (pages) facts.pdf_pages = Number(pages[1]);
    for (const m of info.matchAll(/^Page\s+\d+\s+size:\s+([\d.]+ x [\d.]+)/gm)) facts.page_sizes.push(m[1]);
    if (!facts.page_sizes.length) {
      const single = /^Page size:\s+([\d.]+ x [\d.]+)/m.exec(info);
      if (single) facts.page_sizes.push(single[1]);
    }
  }
  const text = await poppler("pdftotext", ["-layout", pdfPath, "-"]);
  if (text.startsWith(ERR_PREFIX)) facts.errors.push(`pdftotext: ${text.slice(ERR_PREFIX.length)}`);
  else facts.markup_leaks = detectMarkupLeaks(text);
  return facts;
}

// Markup printed as body text. A heuristic, so it only ever advises: prose
// uses ">" for comparisons (">212F"), so the signals are a word welded to a
// closing bracket, a whole tag, and an entity that never resolved.
export function detectMarkupLeaks(text) {
  const patterns = [
    { kind: "truncated_tag", re: /[A-Za-z]{2,}>(?![ \t]*[\d=])/g },
    { kind: "html_tag", re: /<\/?(?:div|span|p|li|ul|ol|td|tr|table|section|h[1-6]|br|img)\b[^>]*>/gi },
    { kind: "entity", re: /&(?:amp|lt|gt|nbsp|quot|#\d{2,4});/g },
  ];
  const found = [];
  for (const { kind, re } of patterns) {
    let perKind = 0; // a budget per kind, so one noisy kind can't hide the others
    for (const m of text.matchAll(re)) {
      const at = m.index ?? 0;
      found.push({ kind, sample: text.slice(Math.max(0, at - 30), at + 20).replace(/\s+/g, " ") });
      perKind += 1;
      if (perKind >= 4) break;
    }
  }
  return found;
}
