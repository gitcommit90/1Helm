import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = dirname(fileURLToPath(import.meta.url));
const source = (path) => join(web, path);
const target = resolve(web, "../app-assets/app-static");
mkdirSync(target, { recursive: true });
await build({ external: ["/fonts/*", "/av/*", "/agent-avatars/*"],
  entryPoints: { app: source("src/v3.ts"), style: source("src/v3.css") },
  outdir: target, bundle: true, minify: true, format: "esm", target: "es2022", loader: { ".json": "json" } });
await build({ external: ["/av/*"], entryPoints: [source("src/card.ts")], outfile: `${target}/card.js`, bundle: true, minify: true, format: "esm", target: "es2020" });
await build({ entryPoints: [source("src/card.css")], outfile: `${target}/card.css`, bundle: true, minify: true });
mkdirSync(`${target}/pdfjs`, { recursive: true });
mkdirSync(`${target}/sheetjs`, { recursive: true });
for (const file of ["pdf.min.mjs", "pdf.worker.min.mjs"])
  cpSync(source(`node_modules/pdfjs-dist/build/${file}`), `${target}/pdfjs/${file}`);
for (const dir of ["wasm", "standard_fonts"])
  cpSync(source(`node_modules/pdfjs-dist/${dir}`), `${target}/pdfjs/${dir}`, { recursive: true });
cpSync(source("node_modules/xlsx/dist/xlsx.full.min.js"), `${target}/sheetjs/xlsx.full.min.js`);
console.log("Built the 1Helm app into app-assets/app-static");
