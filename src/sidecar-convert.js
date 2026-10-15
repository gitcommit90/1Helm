// File sidecars, the pure part (sidecar.js runs the jobs): which kind of file this is, the file → Markdown conversion, the outline,
// the chunks and the in-file search. No network, no env: everything here is plain JS or the vendored WASM.
//
// Conversion: anydoc (firecrawl/anydoc 0.2.4, MIT) with pdf-inspector (MIT) inside, built to WASM from source with one 1Helm addition
// (src/vendor/anydoc/anydoc-wasm.patch on anydoc 261fc25): pdfPages, a PDF's Markdown page by page with the pages that need OCR
// (Indra OCR then reads those in the container job, sidecar.js). Linked with a 64 MB memory ceiling
// (RUSTFLAGS="-C link-arg=--max-memory=67108864"), so a file too big to convert makes the WASM trap ("unreachable") instead of
// growing the isolate past its 128 MB: the trap is caught, the instance is thrown away (__reset) and the file goes to the container
// job (sidecar.js). Build: cargo build -p anydoc-wasm --target wasm32-unknown-unknown --release, then
// wasm-bindgen --target web; anydoc.js is that glue plus the __reset export. Neither library makes a network call in this build.
// Benchmarks (2026-10-08, node 22, same WASM): lease.docx 36 KB 13 ms · q3-budget.xlsx 6 KB 1 ms · pitch.pptx 36 KB 2 ms ·
// memo.pdf 2 KB 1 ms · annual-report.pdf 14 KB (43k chars) 60 ms · handbook.docx 38 KB (131k chars) 20 ms · a 300-page text PDF
// 1.3 s · a 3.6M-char docx 0.4 s; compile 12 ms, instantiate 2 ms. Memory: xlsx is the outlier (~180 MB of WASM per MB of xlsx),
// so spreadsheets over XLSX_WORKER_MAX skip the Worker; everything else is tried in the Worker and traps out cleanly when too big.
import wasmModule from "./vendor/anydoc/anydoc.wasm";
import * as anydoc from "./vendor/anydoc/anydoc.js";

export const SC_V = 1;                                    // the sidecar's format; a row made by an older format is made again
export const CHARS_PER_TOKEN = 4;
export const tokensOf = (s) => Math.ceil(String(s || "").length / CHARS_PER_TOKEN);
export const WORKER_MAX_BYTES = 20 * 1024 * 1024;         // bigger files are converted / transcribed by the container job
export const XLSX_WORKER_MAX = 1024 * 1024;               // xlsx/ods: memory grows ~180× the file in WASM
export const MD_MAX_CHARS = 4_000_000;                    // the Markdown kept (≈1M tokens)
const OFFICE = { doc: "doc", docx: "docx", docm: "docx", dotx: "docx", odt: "odt", rtf: "rtf", epub: "epub", ppt: "ppt", pptx: "pptx", pptm: "pptx", ppsx: "pptx", pps: "ppt", odp: "odp",
  xlsx: "xlsx", xlsm: "xlsx", xls: null, ods: "ods", csv: "csv", tsv: "csv", pdf: "pdf" };
const TEXT_EXT = new Set(["txt", "md", "markdown", "json", "html", "htm", "xml", "ics", "py", "js", "ts", "log", "yaml", "yml", "sql", "sh", "css", "vtt", "srt"]);
const AUDIO_EXT = new Set(["mp3", "m4a", "wav", "ogg", "oga", "opus", "flac", "aac", "weba", "amr"]);
const VIDEO_EXT = new Set(["mp4", "mov", "m4v", "webm", "mkv", "avi", "3gp"]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "bmp", "tif", "tiff"]);
const extOf = (n) => (String(n).match(/\.([a-z0-9]{1,8})$/i)?.[1] || "").toLowerCase();

// "doc" (words: docx, odt, rtf, epub), "sheet", "deck", "pdf", "text", "image", "audio", "video", or null (no sidecar: zip, svg, …).
export function kindOf(name, mime = "") {
  const e = extOf(name), m = String(mime || "").toLowerCase();
  if (e === "pdf" || m === "application/pdf") return "pdf";
  if (["xlsx", "xlsm", "ods", "csv", "tsv"].includes(e)) return "sheet";
  if (["pptx", "pptm", "ppsx", "ppt", "pps", "odp"].includes(e)) return "deck";
  if (OFFICE[e]) return "doc";
  if (IMAGE_EXT.has(e) || (/^image\//.test(m) && !/svg/.test(m))) return "image";
  if (AUDIO_EXT.has(e) || /^audio\//.test(m)) return "audio";
  if (VIDEO_EXT.has(e) || /^video\//.test(m)) return "video";
  if (TEXT_EXT.has(e) || (/^text\//.test(m) && !/html/.test(m))) return "text";
  return null;
}
export const anydocFormat = (name) => OFFICE[extOf(name)] || null;

// ---- the WASM: one instance at a time, made fresh after a trap or a big conversion (its memory never shrinks) ----
let inst = null, grown = false;
function wasm() { if (!inst || grown) { anydoc.__reset(); anydoc.initSync({ module: wasmModule }); inst = true; grown = false; } return anydoc; }
const TRAP_RE = /unreachable|out of memory|memory access out of bounds|RuntimeError/i;
// Run f on the WASM. → { ok, value } | { ok: false, code, message, pages? } (code "tooBig" after a trap).
function onWasm(f) {
  const g = wasm();
  try { const value = f(g); grown = true; return { ok: true, value }; }
  catch (e) {
    grown = true;   // a trap leaves the instance unusable; any error: start clean next time
    if (e instanceof WebAssembly.RuntimeError || (!e?.code && TRAP_RE.test(String(e?.message || e)))) return { ok: false, code: "tooBig", message: "too big to convert here" };
    return { ok: false, code: e?.code || "malformed", message: String(e?.message || e).slice(0, 300), ...(e?.pages ? { pages: [...e.pages], pageCount: e.pageCount } : {}) };
  }
}

// A file → Markdown. bytes: Uint8Array. → { md, pages?: [{page, start}], needsOcr?: [1-based pages], pageCount? } | { error, code }
export function convertBytes(bytes, name) {
  const kind = kindOf(name), e = extOf(name);
  if (kind === "text") return { md: textToMd(bytes, e) };
  if (kind === "pdf") {
    const r = onWasm((g) => g.pdfPages(bytes));
    if (!r.ok) return { error: r.message, code: r.code };
    const pages = [], parts = []; let at = 0;
    for (const p of r.value.pages) {
      const head = `\n\n[Page ${p.page}]\n\n`, body = p.needsOcr ? "" : String(p.markdown || "").trim();
      pages.push({ page: p.page, start: at + head.length, ocr: !!p.needsOcr }); parts.push(head + body); at += head.length + body.length;
    }
    return { md: parts.join("").trim() ? parts.join("") : "", pages, needsOcr: [...r.value.needsOcr].map(Number), pageCount: r.value.pageCount };
  }
  const fmt = anydocFormat(name); if (!fmt) return { error: "no converter for this type", code: "unsupported" };
  if ((fmt === "xlsx" || fmt === "ods") && bytes.byteLength > XLSX_WORKER_MAX) return { error: "too big to convert here", code: "tooBig" };
  const r = onWasm((g) => g.toMarkdownBytes(bytes, fmt === "csv" ? "csv" : fmt));
  if (!r.ok) return { error: r.message, code: r.code };
  return { md: String(r.value) };
}
// Plain text formats: decoded as UTF-8; HTML loses its tags; subtitles lose their timing lines.
export function textToMd(bytes, ext = "txt") {
  let s = new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/\r\n?/g, "\n").replace(/^﻿/, "");
  if (ext === "html" || ext === "htm") s = s.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, "\n\n")
    .replace(/<h([1-6])[^>]*>/gi, (_, n) => "#".repeat(Number(n)) + " ").replace(/<li[^>]*>/gi, "- ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/[ \t]+/g, " ").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n");
  if (ext === "vtt" || ext === "srt") s = s.split("\n").filter((l) => !/^(WEBVTT|\d+|[\d:.,]+ --> [\d:.,]+.*)$/.test(l.trim())).join("\n").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

// ---- outline: headings (#…####) start sections; [Page N] lines carry the page; no headings in a long text → parts of ~6k chars ----
// → [{ t: title, l: level, s: start char, e: end char, p: first page or null }]
export const PART_CHARS = 6000;
export function sectionsOf(md) {
  const text = String(md || ""), out = []; let page = null, at = 0;
  const lines = text.split("\n");
  const firstPage = (s) => { const m = /\[Page (\d+)\]/.exec(s); return m ? Number(m[1]) : null; };
  for (const line of lines) {
    const pm = /^\[Page (\d+)\]$/.exec(line.trim()); if (pm) page = Number(pm[1]);
    const h = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) { if (out.length) out[out.length - 1].e = at; else if (text.slice(0, at).replace(/\[Page \d+\]/g, "").trim()) out.push({ t: "Start", l: 1, s: 0, e: at, p: firstPage(text.slice(0, at)) });
      out.push({ t: h[2].replace(/[*_`]/g, "").slice(0, 120), l: h[1].length, s: at, e: text.length, p: page }); }
    at += line.length + 1;
  }
  if (out.length) { out[out.length - 1].e = text.length; return out.filter((x) => x.e > x.s); }
  // No headings: by pages when there are page markers (a group of pages per part), else by size on paragraph boundaries.
  const parts = []; let s = 0;
  while (s < text.length) {
    let e = Math.min(text.length, s + PART_CHARS);
    if (e < text.length) { const cut = text.lastIndexOf("\n\n", e); if (cut > s + PART_CHARS / 3) e = cut; }
    parts.push({ s, e }); s = e;
  }
  return parts.map((x, i) => { const p0 = firstPage(text.slice(x.s, x.e)) ?? pageAt(text, x.s); const last = [...text.slice(x.s, x.e).matchAll(/\[Page (\d+)\]/g)].at(-1);
    return { t: parts.length === 1 ? "All" : p0 != null ? `Pages ${p0}${last && Number(last[1]) !== p0 ? `–${last[1]}` : ""}` : `Part ${i + 1}`, l: 1, s: x.s, e: x.e, p: p0 }; });
}
function pageAt(text, pos) { const m = [...text.slice(0, pos).matchAll(/\[Page (\d+)\]/g)].at(-1); return m ? Number(m[1]) : null; }

// The outline as lines for the helper: "3. Rent (p. 2, ~410 tokens)". At most `max` lines (the rest counted).
export function outlineLines(sections, max = 40) {
  const top = Math.min(...sections.map((x) => x.l), 9);
  const l = sections.slice(0, max).map((x, i) => `${i + 1}. ${"  ".repeat(Math.max(0, x.l - top))}${x.t}${x.p != null ? ` (p. ${x.p})` : ""}, ~${Math.ceil((x.e - x.s) / CHARS_PER_TOKEN)} tokens`);
  return sections.length > max ? [...l, `… and ${sections.length - max} more sections (file_text with a section number past ${max} reads them)`] : l;
}

// ---- chunks for search: ~1,500 chars on paragraph boundaries, never across sections. → [[start, end, section]] ----
export const CHUNK_CHARS = 1500;
export function chunksOf(md, sections) {
  const text = String(md || ""), out = [];
  (sections?.length ? sections : [{ s: 0, e: text.length }]).forEach((sec, si) => {
    let s = sec.s;
    while (s < sec.e) {
      let e = Math.min(sec.e, s + CHUNK_CHARS);
      if (e < sec.e) { const cut = text.lastIndexOf("\n", e); if (cut > s + CHUNK_CHARS / 3) e = cut; }
      if (text.slice(s, e).trim()) out.push([s, e, si]);
      s = e;
    }
  });
  return out;
}

// ---- keyword search (BM25 over the chunks) ----
const STOP = new Set("a an and are as at be by for from has have in is it its of on or that the this to was were will with what which who when where how do does did i you we they he she".split(" "));
export const words = (s) => (String(s || "").toLowerCase().normalize("NFKD").match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*[\p{L}\p{N}]|[\p{L}\p{N}]/gu) || []).filter((w) => !STOP.has(w));
export function keywordRank(md, chunks, query) {
  const q = [...new Set(words(query))]; if (!q.length) return [];
  const docs = chunks.map(([s, e]) => words(md.slice(s, e))), N = docs.length, avg = docs.reduce((a, d) => a + d.length, 0) / Math.max(1, N);
  const df = new Map(q.map((w) => [w, docs.filter((d) => d.includes(w)).length]));
  return docs.map((d, i) => {
    let score = 0; const tf = new Map(); for (const w of d) if (df.has(w)) tf.set(w, (tf.get(w) || 0) + 1);
    for (const w of q) { const f = tf.get(w) || 0; if (!f) continue; const idf = Math.log(1 + (N - df.get(w) + 0.5) / (df.get(w) + 0.5)); score += idf * f * 2.2 / (f + 1.2 * (0.25 + 0.75 * d.length / avg)); }
    // an exact phrase match counts double
    if (q.length > 1 && md.slice(chunks[i][0], chunks[i][1]).toLowerCase().includes(String(query).toLowerCase().trim())) score *= 2;
    return [i, score];
  }).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
}
// Vectors: int8 per dimension (v / max|v| × 127), cosine on the ints. → Int8Array of n × dims
export function quantize(vectors) {
  const dims = vectors[0]?.length || 0, out = new Int8Array(vectors.length * dims);
  vectors.forEach((v, i) => { let m = 0; for (const x of v) m = Math.max(m, Math.abs(x)); const k = m ? 127 / m : 0; for (let j = 0; j < dims; j++) out[i * dims + j] = Math.round(v[j] * k); });
  return out;
}
export function vectorRank(q, packed, dims) {
  const n = Math.floor(packed.length / dims); let qn = 0; for (const x of q) qn += x * x; qn = Math.sqrt(qn) || 1;
  const scores = [];
  for (let i = 0; i < n; i++) { let d = 0, vn = 0; for (let j = 0; j < dims; j++) { const v = packed[i * dims + j]; d += v * q[j]; vn += v * v; } scores.push([i, vn ? d / (Math.sqrt(vn) * qn) : 0]); }
  return scores.sort((a, b) => b[1] - a[1]).map((x) => x[0]);
}
// Reciprocal-rank fusion of several rankings (lists of chunk indexes, best first).
export function fuse(rankings, k = 60) {
  const s = new Map(); for (const r of rankings) r.forEach((i, pos) => s.set(i, (s.get(i) || 0) + 1 / (k + pos + 1)));
  return [...s.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0]);
}

// What the summary card model reads: the whole text when it's short; otherwise the start, every section's opening lines, and the end.
export function cardSource(md, sections, max = 24000) {
  const t = String(md || ""); if (t.length <= max) return t;
  const head = t.slice(0, Math.floor(max * 0.45)), tail = t.slice(-Math.floor(max * 0.12));
  const per = Math.max(120, Math.floor((max * 0.4) / Math.max(1, sections.length)));
  const mids = sections.filter((x) => x.s > head.length && x.s < t.length - tail.length).map((x) => t.slice(x.s, Math.min(x.e, x.s + per)).trim());
  return `${head}\n\n[… middle of the file: each section's opening lines …]\n\n${mids.join("\n\n").slice(0, Math.floor(max * 0.43))}\n\n[… end of the file …]\n\n${tail}`;
}
