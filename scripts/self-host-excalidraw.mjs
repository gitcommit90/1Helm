import { readFile, writeFile } from "node:fs/promises";

const bundlePath = new URL("../public/bundle.js", import.meta.url);
const source = await readFile(bundlePath, "utf8");
const pattern = /`https:\/\/esm\.sh\/\$\{.*?\}\/dist\/prod\/`/g;
const matches = source.match(pattern) || [];
if (matches.length !== 1) throw new Error(`Expected one Excalidraw CDN fallback in bundle.js, found ${matches.length}.`);
const next = source.replace(pattern, 'window.location.origin+"/excalidraw/"');
if (next.includes("https://esm.sh/@excalidraw") || next.includes("https://esm.sh/${")) throw new Error("Excalidraw CDN fallback remains in bundle.js.");
await writeFile(bundlePath, next);
console.log("rewrote Excalidraw font fallback to same-origin assets");
