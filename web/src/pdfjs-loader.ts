// Loads pdf.js on demand. The modern build (pdfjs/) needs newer engine features, e.g. URL.parse (Chrome 126) and Promise.withResolvers
// (Chrome 119), so an older Android WebView fails with "URL.parse is not a function". The legacy build (pdfjs/legacy/) is made for those engines.
// The main file and its worker always come from the same folder. wasm/ and standard_fonts/ are shared, so they stay in pdfjs/.
export function needsLegacyPdfjs(g: any = globalThis): boolean {
  return typeof g.URL?.parse !== "function" || typeof g.Promise?.withResolvers !== "function";
}
export async function loadPdfjs(pdfjsDir: string, g: any = globalThis, imp: (u: string) => Promise<any> = (u) => import(/* @vite-ignore */ u)) {
  const legacy = needsLegacyPdfjs(g), build = pdfjsDir + (legacy ? "legacy/" : ""), lib: any = await imp(build + "pdf.min.mjs");
  lib.GlobalWorkerOptions.workerSrc = build + "pdf.worker.min.mjs";
  return { lib, base: pdfjsDir, legacy };
}
