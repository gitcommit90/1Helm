// Readability floor for the text of a rendered PDF (pure).
//
// The fit gates (overflow, geometry) are easiest to pass by shrinking type
// until everything squeezes in. This gate closes that door: text below 8pt
// fails, so the only moves left are cutting content or adding a page. A body
// that sits mostly below 10pt only advises; a deliberately compact reference
// card is the author's call. Single glyphs (bullets, footnote marks) are exempt.

const PT_PER_CSS_PX = 72 / 96;
// --help: print the header above and exit.
if (process.argv[1] && import.meta.url.endsWith("/" + process.argv[1].split("/").pop()) && process.argv.slice(2).some((a) => a === "--help" || a === "-h")) {
  const HELP = (await import("node:fs")).readFileSync(new URL(import.meta.url), "utf8").split("\n"), end = HELP.findIndex((l, i) => i > 0 && !l.startsWith("//"));
  process.stdout.write(HELP.slice(HELP[0].startsWith("#!") ? 1 : 0, end).map((l) => l.replace(/^\/\/ ?/, "")).join("\n") + "\n" + "(A module the other scripts load; you don't run it.)\n"); process.exit(0);
}
export const MIN_TEXT_PT = 8;
export const BODY_TARGET_PT = 10;
const FLOOR_TOLERANCE_PT = 0.05; // 8pt can round-trip to 7.98pt
// The largest single text node at a size must have at least this many glyphs
// to gate; judged per node, so three separate markers don't add up.
export const GATED_MIN_CHARS = 2;

export function cssPxToPt(px) {
  return px * PT_PER_CSS_PX;
}

/**
 * @param pages [{index, runs:[{pt, chars, max_node_chars?, sample}]}], one per page element
 * @returns {{failures, advisories}} of {kind, message}
 */
export function evaluateTextFloor(pages) {
  const failures = [];
  const advisories = [];
  const perPage = [];
  let totalChars = 0;
  const charsByPt = new Map();

  for (const page of pages || []) {
    const violations = [];
    for (const run of page.runs || []) {
      if (!Number.isFinite(run.pt) || run.chars <= 0) continue;
      totalChars += run.chars;
      charsByPt.set(run.pt, (charsByPt.get(run.pt) ?? 0) + run.chars);
      const largestNode = run.max_node_chars ?? run.chars;
      if (run.pt < MIN_TEXT_PT - FLOOR_TOLERANCE_PT && largestNode >= GATED_MIN_CHARS) violations.push(run);
    }
    if (violations.length > 0) {
      violations.sort((a, b) => a.pt - b.pt);
      perPage.push({ index: page.index, violations });
    }
  }

  if (perPage.length > 0) {
    const shown = perPage.slice(0, 3).map((entry) => {
      const worst = entry.violations[0];
      const sample = worst.sample ? ` e.g. "${worst.sample.slice(0, 40)}"` : "";
      return `${entry.index + 1}: ${worst.pt}pt${sample}`;
    });
    const omitted = perPage.length - shown.length;
    failures.push({
      kind: "text_below_floor",
      message:
        `text below the ${MIN_TEXT_PT}pt readability floor on page(s) ${perPage.map((e) => e.index + 1).join(", ")} ` +
        `(${shown.join("; ")}${omitted > 0 ? `; ${omitted} more` : ""}); ` +
        "fix by cutting content or adding a page, never by shrinking further",
    });
  }

  // The size a typical character is set at (character-weighted median).
  if (totalChars > 0) {
    const buckets = [...charsByPt.entries()].sort((a, b) => a[0] - b[0]);
    let seen = 0;
    let median = buckets[buckets.length - 1][0];
    for (const [pt, chars] of buckets) {
      seen += chars;
      if (seen >= totalChars / 2) {
        median = pt;
        break;
      }
    }
    if (median < BODY_TARGET_PT) {
      advisories.push({
        kind: "body_below_target",
        message: `most text renders at ${median}pt, below the ${BODY_TARGET_PT}pt body target; ` +
          "acceptable only when the person asked for a compact document",
      });
    }
  }
  return { failures, advisories };
}
