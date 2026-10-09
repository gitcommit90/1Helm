// Geometry verdict for a rendered PDF (pure; the facts come from
// pdf_geometry_probe.mjs and the page wrappers measured under print media).
//
// The overflow probe only fires when a page wrapper has a fixed height; a
// wrapper with height:auto just grows. What really matters is a wrapper taller
// than the paper: Chrome will split it wherever the break lands. That, and an
// authored page count that doesn't match the produced one, are plain integer
// comparisons, so they fail the gate. A probe that couldn't measure and markup
// printed as text only advise.
//
// Findings are {kind, message}; tests assert on `kind`, the message is copy.

const PT_PER_CSS_PX = 72 / 96;
// --help: print the header above and exit.
if (process.argv[1] && import.meta.url.endsWith("/" + process.argv[1].split("/").pop()) && process.argv.slice(2).some((a) => a === "--help" || a === "-h")) {
  const HELP = (await import("node:fs")).readFileSync(new URL(import.meta.url), "utf8").split("\n"), end = HELP.findIndex((l, i) => i > 0 && !l.startsWith("//"));
  process.stdout.write(HELP.slice(HELP[0].startsWith("#!") ? 1 : 0, end).map((l) => l.replace(/^\/\/ ?/, "")).join("\n") + "\n" + "(A module the other scripts load; you don't run it.)\n"); process.exit(0);
}
const FIT_TOLERANCE_PX = 2; // sub-pixel rounding and border collapse

export function paperHeightCssPx(paperHeightPt) {
  if (!Number.isFinite(paperHeightPt) || paperHeightPt <= 0) return null;
  return paperHeightPt / PT_PER_CSS_PX;
}

export function evaluatePdfGeometry(facts) {
  const failures = [];
  const advisories = [];
  const fail = (kind, message) => failures.push({ kind, message });
  const advise = (kind, message) => advisories.push({ kind, message });
  const wrappers = facts.wrappers || [];
  const paperPx = paperHeightCssPx(facts.paperHeightPt);

  const probeErrors = facts.probeErrors || [];
  if (probeErrors.length) {
    advise("not_measured", `geometry could not be measured (${probeErrors.join("; ")}); these checks did not run`);
  }

  if (paperPx !== null) {
    for (const w of wrappers) {
      if (!Number.isFinite(w.rectH)) continue;
      const over = w.rectH - paperPx;
      if (over > FIT_TOLERANCE_PX) {
        fail(
          "wrapper_taller_than_paper",
          `page ${w.index + 1} is ${Math.round(over)}px taller than the page box ` +
            `(${Math.round(w.rectH)}px content vs ${Math.round(paperPx)}px paper); it will be split across pages`,
        );
      }
    }
  }

  if (Number.isFinite(facts.pdfPages) && wrappers.length > 0 && facts.pdfPages !== wrappers.length) {
    fail(
      "pagination_mismatch",
      `${wrappers.length} page element(s) rendered ${facts.pdfPages} PDF page(s); ` +
        "pagination does not match the authored pages",
    );
  }

  const leaks = facts.markupLeaks || [];
  if (leaks.length) {
    const sample = leaks[0]?.sample ? ` e.g. "${leaks[0].sample.trim().slice(0, 60)}"` : "";
    advise(
      "markup_leak",
      `${leaks.length} markup fragment(s) printed as body text${sample}; ` +
        "a reader sees these (ignore if the document quotes code on purpose)",
    );
  }
  return { failures, advisories };
}
