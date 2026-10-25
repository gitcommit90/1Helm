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
await build({ entryPoints: [source("src/contacts-import-worker.ts")], outfile: `${target}/contacts-import-worker.js`, bundle: true, minify: true, format: "esm", target: "es2022" });
await build({ external: ["/av/*"], entryPoints: [source("src/card.ts")], outfile: `${target}/card.js`, bundle: true, minify: true, format: "esm", target: "es2020" });
await build({ entryPoints: [source("src/card.css")], outfile: `${target}/card.css`, bundle: true, minify: true });
// The Zone (src/zone.ts and zone.css), loaded by the app only when a file is opened in it. zone/imgfx.js (img-fx, react and three, MIT) is a
// prebuilt bundle committed under app-assets/app-static/zone/; it is not built here.
await build({ entryPoints: { zone: source("src/zone.ts"), "zone-ui": source("src/zone.css") }, outdir: `${target}/zone`, bundle: true, minify: true, format: "esm", target: "es2022" });
mkdirSync(`${target}/pdfjs`, { recursive: true });
mkdirSync(`${target}/sheetjs`, { recursive: true });
for (const file of ["pdf.min.mjs", "pdf.worker.min.mjs"])
  cpSync(source(`node_modules/pdfjs-dist/build/${file}`), `${target}/pdfjs/${file}`);
for (const dir of ["wasm", "standard_fonts"])
  cpSync(source(`node_modules/pdfjs-dist/${dir}`), `${target}/pdfjs/${dir}`, { recursive: true });
cpSync(source("node_modules/xlsx/dist/xlsx.full.min.js"), `${target}/sheetjs/xlsx.full.min.js`);
console.log("Built the 1Helm app into app-assets/app-static");
