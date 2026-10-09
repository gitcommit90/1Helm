// Effective image resolution in a rendered PDF (pure).
//
// The 150 dpi page read-back upsamples a small image instead of exposing it,
// so a blurry photo looks fine in review and prints soft. An image shown wider
// than its own pixels is upscaled on every surface: that fails. One below twice
// its rendered width is soft on retina screens and in print: that only advises,
// because an honest, slightly soft real photo beats no photo. Slots under 100px
// (icons, markers) are exempt.

export const MIN_GATED_RENDER_PX = 100;
// --help: print the header above and exit.
if (process.argv[1] && import.meta.url.endsWith("/" + process.argv[1].split("/").pop()) && process.argv.slice(2).some((a) => a === "--help" || a === "-h")) {
  const HELP = (await import("node:fs")).readFileSync(new URL(import.meta.url), "utf8").split("\n"), end = HELP.findIndex((l, i) => i > 0 && !l.startsWith("//"));
  process.stdout.write(HELP.slice(HELP[0].startsWith("#!") ? 1 : 0, end).map((l) => l.replace(/^\/\/ ?/, "")).join("\n") + "\n" + "(A module the other scripts load; you don't run it.)\n"); process.exit(0);
}
export const TARGET_RATIO = 2;
const UPSCALE_TOLERANCE = 0.98; // layout rounding must not fail an exact fit

/**
 * @param pages [{index, images:[{rendered_w, natural_w, src_head}]}]
 * @returns {{failures, advisories}} of {kind, message}
 */
export function evaluateImageResolution(pages) {
  const failures = [];
  const advisories = [];
  const upscaled = [];
  const soft = [];
  for (const page of pages || []) {
    for (const img of page.images || []) {
      if (!Number.isFinite(img.rendered_w) || !Number.isFinite(img.natural_w)) continue;
      if (img.rendered_w < MIN_GATED_RENDER_PX || img.natural_w <= 0) continue;
      const ratio = img.natural_w / img.rendered_w;
      if (ratio < UPSCALE_TOLERANCE) upscaled.push({ page: page.index, ...img, ratio });
      else if (ratio < TARGET_RATIO) soft.push({ page: page.index, ...img, ratio });
    }
  }
  if (upscaled.length > 0) {
    upscaled.sort((a, b) => a.ratio - b.ratio);
    const worst = upscaled[0];
    const pageList = [...new Set(upscaled.map((u) => u.page + 1))].join(", ");
    failures.push({
      kind: "image_upscaled",
      message:
        `${upscaled.length} image(s) render wider than their own pixels on page(s) ${pageList} ` +
        `(worst: ${worst.natural_w}px shown at ${Math.round(worst.rendered_w)}px, "${(worst.src_head || "").slice(0, 40)}"); ` +
        "they print blurry. Find a larger image or show it smaller; never stretch pixels",
    });
  }
  if (soft.length > 0) {
    soft.sort((a, b) => a.ratio - b.ratio);
    const worst = soft[0];
    advisories.push({
      kind: "image_below_target",
      message:
        `${soft.length} image(s) below the sharp target of ${TARGET_RATIO}x their rendered width ` +
        `(worst ${worst.natural_w}px at ${Math.round(worst.rendered_w)}px); fine if no larger source exists`,
    });
  }
  return { failures, advisories };
}
