import { readFile, readdir, writeFile } from "node:fs/promises";

const publicPath = new URL("../public/", import.meta.url);
const files = [new URL("bundle.js", publicPath)];
const walk = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const path = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) await walk(path);
    else if (entry.name.endsWith(".js")) files.push(path);
  }
};
await walk(new URL("assets/", publicPath));
const pattern = /`https:\/\/esm\.sh\/\$\{.*?\}\/dist\/prod\/`/g;
let matches = 0;
for (const path of files) {
  const source = await readFile(path, "utf8");
  const count = source.match(pattern)?.length || 0;
  if (!count) continue;
  matches += count;
  const next = source.replace(pattern, 'window.location.origin+"/excalidraw/"');
  if (next.includes("https://esm.sh/@excalidraw") || next.includes("https://esm.sh/${")) throw new Error(`Excalidraw CDN fallback remains in ${path.pathname}.`);
  await writeFile(path, next);
}
if (matches !== 1) throw new Error(`Expected one Excalidraw CDN fallback in client chunks, found ${matches}.`);
console.log("rewrote Excalidraw font fallback to same-origin assets");
