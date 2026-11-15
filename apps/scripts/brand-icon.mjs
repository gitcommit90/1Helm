// The 1Helm app icon, shared by the mobile asset generator and the desktop packager.
// desktop/icons/1helm-icon.svg is the vector source of the production 1helm-icon.png
// (rounded 912-unit tile); every platform variant below reuses its one sailboat path.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
export const iconPng = join(root, "desktop", "icons", "1helm-icon.png");
export const iconSvg = join(root, "desktop", "icons", "1helm-icon.svg");
export const iconBlue = "#1677FF";

const vector = readFileSync(iconSvg, "utf8");
const boat = vector.match(/<path\b[^>]*\/>/s)?.[0];
if (!boat) throw new Error(`No sailboat path in ${iconSvg}`);
const tile = (rx) => `<rect x="56" y="56" width="912" height="912"${rx ? ` rx="${rx}"` : ""} fill="${iconBlue}"/>`;
const svg = (viewBox, body) => (size) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${viewBox}">${body}</svg>`;

export const variants = {
  // Rounded tile with transparent corners, identical to app-assets/1helm-icon.png.
  rounded: svg("56 56 912 912", tile(224) + boat),
  // Full-bleed opaque square: iOS applies its own mask.
  square: svg("56 56 912 912", tile(0) + boat),
  // Legacy Android round launcher.
  round: svg("56 56 912 912", `<circle cx="512" cy="512" r="456" fill="${iconBlue}"/>` + boat),
  // Android adaptive foreground: the tile maps to the inner 72 of 108 dp, the boat sits well inside the 66 dp safe zone.
  foreground: svg("-172 -172 1368 1368", boat),
  // macOS: rounded tile on the 824/1024 grid with transparent margin.
  macos: svg("0 0 1024 1024", `<g transform="translate(49.404 49.404) scale(0.903509)">${tile(224)}${boat}</g>`),
};

export function render(variant, size) {
  return sharp(Buffer.from(variants[variant](size))).resize(size, size);
}
