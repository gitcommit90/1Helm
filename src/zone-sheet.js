// Zone: direct cell edits of a spreadsheet (.xlsx or .csv) in the Worker, with no model. The browser (web/src/zone-sheet.ts) recalculates the
// workbook on screen with HyperFormula, and sends each change as { op: "cell", sheet, ref, f | v, results }: the typed value (v) or formula (f, without
// the "="), and the new values of the formula cells that depend on it (results), so the file's cached results match what the person saw.
// ExcelJS (MIT) rewrites an .xlsx and keeps colors, number formats, column widths and merged cells, but it drops charts, pivot tables, pictures and
// some other parts. A workbook that has any of those is read-only in the Zone, and this module refuses to rewrite it, the same test the app uses
// (readonlyReason). Every saved workbook is set to recalculate fully when Excel opens it (fullCalcOnLoad).
// A CSV is text: its cells are changed in the text itself, a formula is saved as its value (a CSV can't hold one), and the delimiter, the line ends
// and the byte order mark stay as they were.
import { readZip } from "./zone-docx.js";
import { ZoneError } from "./zone-edit.js";

const bad = (m, status = 400) => { throw new ZoneError(status, m); };
export const SHEET_MAX = 15 * 1024 * 1024;   // a workbook bigger than this is not rewritten here
export const CSV_MAX = 8 * 1024 * 1024;
export const isXlsx = (name) => /\.xlsx$/i.test(String(name || ""));
export const isCsv = (name) => /\.csv$/i.test(String(name || ""));
export const isSheet = (name) => isXlsx(name) || isCsv(name);

// ---- the read-only rule (the same list is in the app, src/zone-sheet-core.ts) ----
export const READONLY_PARTS = [/^xl\/charts\//, /^xl\/chartsheets\//, /^xl\/drawings\//, /^xl\/media\//, /^xl\/pivotTables\//, /^xl\/pivotCache\//, /^xl\/slicers\//, /^xl\/slicerCaches\//, /^xl\/timelines\//, /^xl\/timelineCaches\//, /^xl\/embeddings\//, /^xl\/vbaProject\.bin$/, /^xl\/ctrlProps\//, /^xl\/activeX\//, /^xl\/externalLinks\//, /^xl\/threadedComments\//, /^xl\/queryTables\//];
export const readonlyReason = (names) => {
  const has = (re) => names.some((n) => re.test(n));
  if (has(/^xl\/(charts|chartsheets)\//)) return "charts";
  if (has(/^xl\/(pivotTables|pivotCache)\//)) return "pivot tables";
  if (has(/^xl\/(media|embeddings)\//)) return "pictures";
  return READONLY_PARTS.some((re) => has(re)) ? "parts that Excel keeps and this editor can't" : "";
};

// ---- addresses and values ----
const REF = /^([A-Z]{1,3})([1-9]\d{0,6})$/;
export function parseRef(ref) {
  const m = REF.exec(String(ref || "")); if (!m) return null;
  let c = 0; for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  const r = Number(m[2]); return c >= 1 && c <= 16384 && r <= 1048576 ? { r, c } : null;   // 1-based
}
const okValue = (v) => v === null || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.length <= 32767);
export function cleanEdit(e) {
  if (!e || typeof e !== "object" || e.op !== "cell") bad("Only cell edits can be applied to a spreadsheet.");
  const sheet = typeof e.sheet === "string" ? e.sheet : "", pos = parseRef(e.ref);
  if (!sheet || sheet.length > 64 || !pos) bad("That cell address isn't valid.");
  const f = typeof e.f === "string" && e.f.trim() ? e.f.trim().replace(/^=/, "") : null;
  if (f && f.length > 8192) bad("That formula is too long.");
  if (!f && !okValue(e.v)) bad("That value can't be saved in a cell.");
  const results = [];
  for (const x of Array.isArray(e.results) ? e.results.slice(0, 5000) : []) {
    const p = parseRef(x?.ref); if (typeof x?.sheet !== "string" || x.sheet.length > 64 || !p || !(okValue(x.v) || (x.v && typeof x.v === "object" && typeof x.v.err === "string"))) continue;
    results.push({ sheet: x.sheet, ref: x.ref, pos: p, v: x.v });
  }
  return { sheet, ref: e.ref, pos, f, v: f ? null : (e.v ?? null), was: typeof e.was === "string" ? e.was.slice(0, 120) : "", now: String(f ? "=" + f : e.v ?? "").slice(0, 120), results };
}
const resultOf = (v) => (v && typeof v === "object" ? { error: String(v.err).slice(0, 12) || "#VALUE!" } : v === null ? undefined : v);

// ---- .xlsx ----
export async function applyXlsxEdits(buf, edits) {
  if (buf.length > SHEET_MAX) bad("That workbook is too big to edit here.", 413);
  let names; try { names = readZip(buf).map((e) => e.name); } catch (e) { if (e instanceof ZoneError) throw e; bad("That file isn't a workbook the Zone can edit.", 415); }
  const why = readonlyReason(names); if (why) bad(`This workbook has ${why}, so it can't be edited here. Download it to edit it in Excel.`, 415);
  const list = edits.map(cleanEdit), total = list.reduce((n, e) => n + e.results.length, 0); if (total > 20000) bad("That edit touches too many cells.");
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf); } catch { bad("That file isn't a workbook the Zone can edit.", 415); }
  const recs = [];
  for (const e of list) {
    const ws = wb.getWorksheet(e.sheet); if (!ws) bad(`There is no sheet named "${e.sheet}".`);
    const cell = ws.getCell(e.pos.r, e.pos.c), mc = cell.master && cell.master !== cell ? cell.master : null;
    if (mc) bad(`${e.ref} is part of a merged cell. Edit the top left cell of it.`);
    if (e.f) cell.value = { formula: e.f };   // its result is filled in below, from the results the app sent
    else cell.value = e.v === null ? null : e.v;
    for (const x of e.results) { const w = x.sheet === e.sheet ? ws : wb.getWorksheet(x.sheet); if (!w) continue; const c = w.getCell(x.pos.r, x.pos.c), cur = c.value; if (cur && typeof cur === "object" && "formula" in cur) c.value = { formula: cur.formula, ...(cur.shareType ? { shareType: cur.shareType, ref: cur.ref } : {}), ...(cur.sharedFormula ? { sharedFormula: cur.sharedFormula } : {}), result: resultOf(x.v) }; else if (cur && typeof cur === "object" && "sharedFormula" in cur) c.value = { ...cur, result: resultOf(x.v) }; }
    recs.push({ op: "cell", sheet: e.sheet, ref: e.ref, was: e.was, now: e.now, doc: false, sheetEdit: true });
  }
  wb.calcProperties = { ...(wb.calcProperties || {}), fullCalcOnLoad: true };
  const out = new Uint8Array(await wb.xlsx.writeBuffer());
  return { bytes: out, recs };
}

// ---- .csv ----
export function parseCsv(text, d) {
  const rows = []; let row = [], cell = "", q = false;
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
export const csvDelimiter = (text) => { const first = text.split(/\r\n|\n|\r/, 1)[0] || ""; const n = (c) => first.split(c).length; return n("\t") > n(",") && n("\t") >= n(";") ? "\t" : n(";") > n(",") ? ";" : ","; };
const csvCell = (s, d) => (/["\r\n]/.test(s) || s.includes(d) ? `"${s.replace(/"/g, '""')}"` : s);
export function applyCsvEdits(buf, edits) {
  if (buf.length > CSV_MAX) bad("That file is too big to edit here.", 413);
  let text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(buf); const bom = text.charCodeAt(0) === 0xfeff; if (bom) text = text.slice(1);
  const nl = /\r\n/.test(text) ? "\r\n" : /\n/.test(text) ? "\n" : /\r/.test(text) ? "\r" : "\n", endsNl = /(\r\n|\n|\r)$/.test(text), d = csvDelimiter(text);
  const rows = parseCsv(text, d), recs = [];
  for (const raw of edits) {
    const e = cleanEdit(raw), val = e.f ? e.results.find((x) => x.sheet === e.sheet && x.ref === e.ref)?.v : e.v;
    // a formula cell is saved as its value: the app sends it in results under the cell's own address
    const s = val === null || val === undefined ? "" : typeof val === "object" ? String(val.err) : String(val);
    while (rows.length < e.pos.r) rows.push([]);
    const row = rows[e.pos.r - 1]; while (row.length < e.pos.c) row.push("");
    row[e.pos.c - 1] = s;
    for (const x of e.results) { if (x.sheet !== e.sheet || x.ref === e.ref) continue; while (rows.length < x.pos.r) rows.push([]); while (rows[x.pos.r - 1].length < x.pos.c) rows[x.pos.r - 1].push(""); rows[x.pos.r - 1][x.pos.c - 1] = x.v === null ? "" : typeof x.v === "object" ? String(x.v.err) : String(x.v); }   // a csv has no formulas: a cell that follows one keeps the value the person saw
    recs.push({ op: "cell", sheet: e.sheet, ref: e.ref, was: e.was, now: e.now, doc: false, sheetEdit: true });
  }
  const out = rows.map((r) => r.map((c) => csvCell(c, d)).join(d)).join(nl) + (endsNl ? nl : "");
  return { bytes: new TextEncoder().encode((bom ? "﻿" : "") + out), recs };
}
export async function applySheetEdits(buf, name, edits) { return isCsv(name) ? applyCsvEdits(buf, edits) : applyXlsxEdits(buf, edits); }
