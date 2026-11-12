// node test/pdfjs-loader.test.mjs: the PDF loader (src/pdfjs-loader.ts) picks pdf.js's legacy build on engines without URL.parse or
// Promise.withResolvers (older Android WebView), the modern build otherwise, and the worker always matches the main file.
import assert from "node:assert"; import { build } from "esbuild"; import { mkdtempSync, writeFileSync, existsSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "pl-")), out = join(dir, "pl.mjs");
await build({ entryPoints: [new URL("../src/pdfjs-loader.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "error" });
const { needsLegacyPdfjs, loadPdfjs } = await import(out);
const modern = { URL: { parse() {} }, Promise: { withResolvers() {} } };
assert.equal(needsLegacyPdfjs(modern), false);
assert.equal(needsLegacyPdfjs({ ...modern, URL: {} }), true);
assert.equal(needsLegacyPdfjs({ ...modern, Promise: {} }), true);
const B = "https://x.test/app-static/pdfjs/";
for (const [g, dirName] of [[modern, ""], [{ ...modern, URL: {} }, "legacy/"]]) {
  const seen = [], r = await loadPdfjs(B, g, async (u) => { seen.push(u); return { GlobalWorkerOptions: {} } });
  assert.deepEqual(seen, [B + dirName + "pdf.min.mjs"]);
  assert.equal(r.lib.GlobalWorkerOptions.workerSrc, B + dirName + "pdf.worker.min.mjs");
  assert.equal(r.base, B); assert.equal(r.legacy, dirName !== "");
}
// the build ships both folders
const bs = (await import("node:fs")).readFileSync(new URL("../build.mjs", import.meta.url), "utf8");
assert.ok(bs.includes("pdfjs-dist/legacy/build/") && bs.includes("pdfjs/legacy"));
console.log("pdfjs-loader ok");
