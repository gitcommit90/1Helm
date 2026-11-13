// Spreadsheets in the Zone: the parts that need no page and no network (addresses, the text of a pin, the read-only rule, CSV reading). The grid is in zone-sheet.ts
// and the workbook with its formulas is in zone-sheet-model.ts. The read-only list below is the same list the server uses (1HC src/zone-sheet.js), which refuses to
// rewrite such a workbook, so the app and the server always agree on which files can be saved.

export type Pos = { r: number; c: number };   // 0-based row and column

/** 0 → "A", 25 → "Z", 26 → "AA" */
export const colName = (n: number): string => { let s = ""; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
export const colIndex = (s: string): number => { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
/** { r: 3, c: 1 } → "B4" */
export const refOf = (r: number, c: number): string => colName(c) + (r + 1);
export function parseRef(s: string): Pos | null {
  const m = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(String(s || "").trim().toUpperCase()); if (!m) return null;
  const c = colIndex(m[1]), r = Number(m[2]) - 1; return c < 16384 && r < 1048576 ? { r, c } : null;
}
/** Two corners (in any order) → "B4:C9", or "B4" when they are the same cell. */
export function rangeText(a: Pos, b: Pos): string {
  const r0 = Math.min(a.r, b.r), r1 = Math.max(a.r, b.r), c0 = Math.min(a.c, b.c), c1 = Math.max(a.c, b.c);
  return r0 === r1 && c0 === c1 ? refOf(r0, c0) : `${refOf(r0, c0)}:${refOf(r1, c1)}`;
}
/** The chip above the chat box: "Q3 budget · B4:C9" */
export const pinLabel = (sheet: string, a: Pos, b: Pos): string => `${sheet} · ${rangeText(a, b)}`;

// ---- the read-only rule ----
// ExcelJS (which the server saves with) keeps cell values, formulas, colors, number formats, column widths and merged cells. It drops charts, pivot tables, drawings,
// some embedded pictures, slicers, macros and similar parts, so a workbook that has any of them opens read-only.
export const READONLY_PARTS = [/^xl\/charts\//, /^xl\/chartsheets\//, /^xl\/drawings\//, /^xl\/media\//, /^xl\/pivotTables\//, /^xl\/pivotCache\//, /^xl\/slicers\//, /^xl\/slicerCaches\//, /^xl\/timelines\//, /^xl\/timelineCaches\//, /^xl\/embeddings\//, /^xl\/vbaProject\.bin$/, /^xl\/ctrlProps\//, /^xl\/activeX\//, /^xl\/externalLinks\//, /^xl\/threadedComments\//, /^xl\/queryTables\//];
/** The names of the parts of a zip file (read from its central directory), or null when it isn't a zip. */
export function zipNames(b: Uint8Array): string[] | null {
  const u16 = (o: number) => b[o] | (b[o + 1] << 8), u32 = (o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  let e = -1; for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 5 && b[i + 3] === 6) { e = i; break; }
  if (e < 0) return null;
  const n = u16(e + 10), off = u32(e + 16), dec = new TextDecoder(), out: string[] = []; let p = off;
  if (n === 0xffff || off >= b.length) return null;
  for (let i = 0; i < n; i++) { if (p + 46 > b.length || u32(p) !== 0x02014b50) return null; const nl = u16(p + 28), el = u16(p + 30), cl = u16(p + 32); out.push(dec.decode(b.subarray(p + 46, p + 46 + nl))); p += 46 + nl + el + cl; }
  return out;
}
/** "" when the workbook can be edited, else the word for what it has ("charts", "pivot tables", "pictures", ...). */
export function readonlyReason(names: string[]): string {
  const has = (re: RegExp) => names.some(n => re.test(n));
  if (has(/^xl\/(charts|chartsheets)\//)) return "charts";
  if (has(/^xl\/(pivotTables|pivotCache)\//)) return "pivot tables";
  if (has(/^xl\/(media|embeddings)\//)) return "pictures";
  return READONLY_PARTS.some(re => has(re)) ? "parts that only Excel keeps" : "";
}
export const readonlyLine = (why: string) => `This sheet has ${why}, so it opens read-only here. Download it to edit it in Excel.`;
export const tooBigLine = "This sheet is too large to edit here, so it opens read-only. Download it to edit it in Excel.";

// ---- limits ----
export const SHOW_ROWS = 2000, SHOW_COLS = 100;   // what the grid draws (the same cap as the file viewer)
export const ENGINE_ROWS = 100000;                // a sheet with more rows than this opens read-only (formulas can reach any row)

// ---- CSV ----
export function csvDelimiter(text: string): string { const first = text.split(/\r\n|\n|\r/, 1)[0] || "", n = (c: string) => first.split(c).length; return n("\t") > n(",") && n("\t") >= n(";") ? "\t" : n(";") > n(",") ? ";" : ","; }
export function parseCsv(text: string, d: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"' && cell === "") q = true;
    else if (c === d) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
/** A CSV cell is text, except when it is plainly a number ("12", "-3.5", "1e3"; not "007"). */
export const csvNumber = (s: string): number | null => (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(s) ? Number(s) : null);

/** What a typed cell becomes: a formula when it starts with "=", else a number, true or false, or text. */
export function typed(raw: string): { f: string } | { v: number | boolean | string | null } {
  if (/^=.+/.test(raw)) return { f: raw.slice(1) };
  if (raw === "") return { v: null };
  return { v: raw };
}
