// A workbook in the Zone: the file's own values and number formats (read with SheetJS, passed in as X), and HyperFormula (GPL-3.0, license key "gpl-v3") for the formulas.
// What the grid shows for a cell nobody has changed is the text the file itself holds (so every number format, date and currency reads as Excel showed it). When the person
// changes a cell, HyperFormula recalculates the workbook at once and reports which cells changed (the cell and everything that depends on it, on any sheet); those cells are
// shown from HyperFormula's values, formatted with the number format the file has for the cell. Each change leaves as an edit for the server (1HC src/zone-sheet.js), with the
// new values of the formula cells, so the saved file holds the same numbers the person saw.
// Text cells are given to HyperFormula with a leading apostrophe so "007" and "=x" stay text. Nothing here touches the page.
import { HyperFormula } from "hyperformula";
import { colName, csvDelimiter, csvNumber, ENGINE_ROWS, parseCsv, refOf, SHOW_COLS, SHOW_ROWS, type Pos } from "./zone-sheet-core";

export type CellInfo = { w: string; z?: string; fill?: string; num: boolean; f: boolean };
export type Merge = { r0: number; c0: number; r1: number; c1: number };
export type SheetInfo = { name: string; hidden: boolean; nr: number; nc: number; cells: Map<number, CellInfo>; widths: number[]; merges: Merge[] };
export type Value = number | boolean | string | null | { err: string };
export type Result = { sheet: string; ref: string; v: Value };
export type CellEdit = { op: "cell"; sheet: string; ref: string; f?: string; v?: number | boolean | string | null; was: string; results: Result[] };

const K = (r: number, c: number) => r * 16384 + c;
const DEF_W = 80;
const general = (v: number) => (Number.isInteger(v) ? String(v) : String(+v.toPrecision(10)));
const isErr = (v: any): v is { value: string } => v != null && typeof v === "object" && typeof v.value === "string";
/** What a typed cell is: a formula, a number, true or false, or text. */
export function parseTyped(raw: string): { f: string } | { n: number } | { b: boolean } | { s: string } | { empty: true } {
  if (raw === "") return { empty: true };
  if (/^=.+/.test(raw)) return { f: raw.slice(1) };
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(raw.trim())) { const n = Number(raw); if (Number.isFinite(n)) return { n }; }
  if (/^(true|false)$/i.test(raw.trim())) return { b: raw.trim().toLowerCase() === "true" };
  return { s: raw };
}

export class Model {
  private datas: any[][][] = []; sheets: SheetInfo[] = []; hf!: HyperFormula; csv = false; tooBig = false; dirty = new Set<string>(); X: any;
  constructor(X: any) { this.X = X; }

  static fromXlsx(X: any, buf: ArrayBuffer | Uint8Array): Model {
    const m = new Model(X), wb = X.read(buf, { type: "array", cellNF: true, cellStyles: true, sheetStubs: true, sheetRows: ENGINE_ROWS + 1 });
    const metas = wb.Workbook?.Sheets || [];
    wb.SheetNames.forEach((name: string, i: number) => {
      const ws = wb.Sheets[name], hidden = (metas[i]?.Hidden || 0) > 0;
      if (!ws || !ws["!ref"]) { m.sheets.push({ name, hidden, nr: 0, nc: 0, cells: new Map(), widths: [], merges: [] }); m.datas.push([]); return; }
      const rg = X.utils.decode_range(ws["!ref"]), nr = rg.e.r + 1, nc = rg.e.c + 1;
      if (ws["!fullref"] && X.utils.decode_range(ws["!fullref"]).e.r >= ENGINE_ROWS) m.tooBig = true;
      const cells = new Map<number, CellInfo>(), data: any[][] = Array.from({ length: nr }, () => new Array(nc).fill(null));
      for (const key of Object.keys(ws)) {
        if (key[0] === "!") continue; const a = X.utils.decode_cell(key); if (a.r >= nr || a.c >= nc) continue; const cell = ws[key]; if (!cell) continue;
        const st = cell.s, fill = st && st.patternType === "solid" && st.fgColor?.rgb && /^[0-9a-f]{6,8}$/i.test(st.fgColor.rgb) ? "#" + String(st.fgColor.rgb).slice(-6) : undefined;
        if (cell.t === "z" && !fill) continue;
        const w = cell.w != null ? String(cell.w) : cell.v == null ? "" : String(cell.v);
        cells.set(K(a.r, a.c), { w, z: cell.z && cell.z !== "General" ? String(cell.z) : undefined, fill, num: cell.t === "n", f: !!cell.f });
        if (cell.f) data[a.r][a.c] = "=" + String(cell.f).replace(/^=/, "");
        else if (cell.t === "n" || cell.t === "b") data[a.r][a.c] = cell.v;
        else if (cell.t === "s" || cell.t === "e" || cell.t === "d") data[a.r][a.c] = "'" + w;
      }
      const widths: number[] = []; for (let c = 0; c < Math.min(nc, 2000); c++) { const d = (ws["!cols"] || [])[c]; widths.push(d?.hidden ? 0 : Math.max(24, Math.min(480, Math.round(d?.wpx ?? (d?.wch ? d.wch * 7 + 5 : DEF_W))))); }
      const merges: Merge[] = (ws["!merges"] || []).map((g: any) => ({ r0: g.s.r, c0: g.s.c, r1: g.e.r, c1: g.e.c }));
      m.sheets.push({ name, hidden, nr, nc, cells, widths, merges }); m.datas.push(data);
    });
    m.build(); return m;
  }
  static fromCsv(X: any, text: string): Model {
    const m = new Model(X); m.csv = true; if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const rows = parseCsv(text, csvDelimiter(text)), nr = rows.length, nc = Math.max(1, ...rows.map(r => r.length));
    if (nr > ENGINE_ROWS) m.tooBig = true;
    const cells = new Map<number, CellInfo>(), data: any[][] = rows.map(r => Array.from({ length: nc }, (_, c) => { const s = r[c]; if (s == null || s === "") return null; const n = csvNumber(s); return n !== null ? n : "'" + s; }));
    rows.forEach((r, i) => r.forEach((s, c) => { if (s !== "") cells.set(K(i, c), { w: s, num: csvNumber(s) !== null, f: false }); }));
    m.sheets.push({ name: "Sheet1", hidden: false, nr, nc, cells, widths: Array.from({ length: Math.min(nc, 2000) }, () => DEF_W), merges: [] }); m.datas.push(data);
    m.build(); return m;
  }
  private build() {
    const hf = this.hf = HyperFormula.buildEmpty({ licenseKey: "gpl-v3", maxRows: ENGINE_ROWS + 200, maxColumns: 16384 });
    this.sheets.forEach(s => hf.addSheet(s.name));
    this.sheets.forEach((_, i) => { hf.setSheetContent(i, this.datas[i]); });
    this.datas = [];
  }

  // ---- reading ----
  visible(): number[] { return this.sheets.map((s, i) => (s.hidden ? -1 : i)).filter(i => i >= 0); }
  private addr(si: number, r: number, c: number) { return { sheet: si, row: r, col: c }; }
  private fmt(z: string | undefined, v: any): string {
    if (isErr(v)) return v.value;
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    if (v == null) return "";
    if (typeof v === "number") { if (z) { try { const t = this.X.SSF.format(z, v); if (typeof t === "string") return t; } catch { /* the number format isn't one SheetJS knows */ } } return general(v); }
    return String(v);
  }
  /** The text the grid shows in a cell. */
  text(si: number, r: number, c: number): string {
    const s = this.sheets[si], info = s.cells.get(K(r, c)), key = `${si}:${K(r, c)}`;
    if (!this.dirty.has(key) && info && (info.w !== "" || !info.f)) return info.w;
    if (r >= s.nr || c >= s.nc) { if (!this.dirty.has(key)) return ""; }
    const v = this.hf.getCellValue(this.addr(si, r, c));
    if (isErr(v) && v.value === "#NAME?" && info?.w) return info.w;   // a function HyperFormula doesn't have: the file's own text stays
    return this.fmt(info?.z, v);
  }
  isNum(si: number, r: number, c: number): boolean {
    const key = `${si}:${K(r, c)}`, info = this.sheets[si].cells.get(K(r, c));
    if (!this.dirty.has(key)) return !!info?.num;
    const v = this.hf.getCellValue(this.addr(si, r, c)); return typeof v === "number";
  }
  isErr(si: number, r: number, c: number): boolean { return /^#[A-Z/0!?]+[!?]?$/.test(this.text(si, r, c)) && isErr(this.hf.getCellValue(this.addr(si, r, c))); }
  fill(si: number, r: number, c: number): string | undefined { return this.sheets[si].cells.get(K(r, c))?.fill; }
  isFormula(si: number, r: number, c: number): boolean { return this.hf.doesCellHaveFormula(this.addr(si, r, c)); }
  /** What a cell holds, as a person types it: "=SUM(A1:A3)", a number, or its text. */
  raw(si: number, r: number, c: number): string {
    const s = this.sheets[si]; if (r >= s.nr && c >= s.nc && !this.dirty.has(`${si}:${K(r, c)}`)) return "";
    const v = this.hf.getCellSerialized(this.addr(si, r, c));
    if (v == null) return ""; if (typeof v === "string") return v.startsWith("'") ? v.slice(1) : v; return String(v);
  }
  width(si: number, c: number): number { return this.sheets[si].widths[c] ?? DEF_W; }
  /** The shape of a sheet on screen: its rows and columns, capped. */
  shape(si: number): { rows: number; cols: number; allRows: number; allCols: number } {
    const s = this.sheets[si]; let nr = s.nr, nc = s.nc;
    for (const k of this.dirty) { const [i, kk] = k.split(":").map(Number); if (i === si) { nr = Math.max(nr, Math.floor(kk / 16384) + 1); nc = Math.max(nc, (kk % 16384) + 1); } }
    // a few empty rows and columns after the last one used, so a person can type below and beside the data
    return { rows: Math.min(Math.max(nr + 20, 40), SHOW_ROWS), cols: Math.min(Math.max(nc + 4, 12), SHOW_COLS), allRows: nr, allCols: nc };
  }
  /** A selection as the helper reads it: "B4 = 12; C4 = =B4*2 (24)", the first twenty cells that hold something. */
  describe(si: number, a: Pos, b: Pos): string {
    const r0 = Math.min(a.r, b.r), r1 = Math.max(a.r, b.r), c0 = Math.min(a.c, b.c), c1 = Math.max(a.c, b.c), out: string[] = []; let more = 0;
    outer: for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const raw = this.raw(si, r, c), t = this.text(si, r, c); if (raw === "" && t === "") continue;
      if (out.length >= 20) { more++; continue; }
      out.push(`${refOf(r, c)} = ${raw.startsWith("=") ? `${raw} (${t})` : t}`);
      if (out.join("; ").length > 380) { more++; break outer; }
    }
    return out.join("; ") + (more ? `; and more` : "");
  }

  // ---- changing ----
  /** Change a cell. → null when nothing changed, "invalid" for a formula that doesn't parse, else the edit for the server and the cells that changed on screen. */
  set(si: number, r: number, c: number, rawIn: string): { edit: CellEdit; changed: { si: number; r: number; c: number }[] } | "invalid" | null {
    const was = this.raw(si, r, c); if (rawIn === was) return null;
    const t = parseTyped(rawIn), name = this.sheets[si].name, ref = refOf(r, c), a = this.addr(si, r, c);
    let content: any, v: CellEdit["v"] = null, f: string | undefined;
    if ("f" in t) { if (!this.hf.validateFormula("=" + t.f)) return "invalid"; content = "=" + t.f; f = t.f; }
    else if ("n" in t) { content = t.n; v = t.n; } else if ("b" in t) { content = t.b; v = t.b; } else if ("s" in t) { content = "'" + t.s; v = t.s; } else { content = null; v = null; }
    let ch: any[]; try { ch = this.hf.setCellContents(a, content); } catch { return "invalid"; }
    const changed: { si: number; r: number; c: number }[] = [{ si, r, c }], results: Result[] = []; this.dirty.add(`${si}:${K(r, c)}`);
    for (const x of ch) {
      if (!x || !x.address || typeof x.address.sheet !== "number") continue;
      const p = x.address, same = p.sheet === si && p.row === r && p.col === c;
      if (!same) { changed.push({ si: p.sheet, r: p.row, c: p.col }); this.dirty.add(`${p.sheet}:${K(p.row, p.col)}`); }
      if (!this.hf.doesCellHaveFormula(p)) continue;
      const nv = x.newValue; if (isErr(nv) && nv.value === "#NAME?") continue;   // HyperFormula lacks the function: Excel works it out when the file opens
      results.push({ sheet: this.sheets[p.sheet].name, ref: refOf(p.row, p.col), v: isErr(nv) ? { err: nv.value } : nv === undefined ? null : nv });
    }
    return { edit: { op: "cell", sheet: name, ref, ...(f !== undefined ? { f } : { v }), was, results }, changed };
  }
}
export { colName };
