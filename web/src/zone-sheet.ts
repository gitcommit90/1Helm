// The grid for a spreadsheet in the Zone (.xlsx and .csv). zone.ts loads this file (zone/sheet.js, with SheetJS and HyperFormula) only when a spreadsheet is opened, so app.js and
// zone.js stay as small as they were.
//
// What a person sees: the sheet's tabs (the pill tabs the file viewer uses), column letters, row numbers, the first row held in place, merged cells, fills and number formats as the file
// has them, and the same cap as the file viewer (2,000 rows, 100 columns, with its note). Only the rows and columns on screen are drawn, so a long sheet scrolls without lag.
//  - A click selects a cell and a drag selects a range (the arrow keys and Shift do too). The selection becomes the pin above the chat box: "<sheet> · B4:C9".
//  - Double click, Enter or typing starts an edit; Enter and Tab save it and move on; Esc cancels. A typed "=..." is a formula. HyperFormula recalculates the workbook at once, the
//    cells that depend on the change update on screen, and the change is saved as a new version of the same Library file (zone.ts sends it to the server, which writes it with ExcelJS).
//  - A workbook with charts, pivot tables, pictures or other parts ExcelJS would drop opens read-only, with one plain line saying so.
// The Pencil's marks are kept by zone-annotate.ts (zone.ts hosts it over this grid): this file gives it the grid's size and scroll, a picture of what is on screen, and the cells under a mark.
import { Model } from "./zone-sheet-model";
import { colName, parseRef, pinLabel, rangeText, readonlyLine, readonlyReason, refOf, SHOW_COLS, SHOW_ROWS, tooBigLine, zipNames, type Pos } from "./zone-sheet-core";

export type SheetPin = { sheet: string; range: string; text: string; label: string };
export type SheetDeps = {
  v: string;   // the app's version, for the reader loaded on demand
  name: string;
  save: (edits: any[]) => Promise<boolean>;   // zone.ts: POST .../zone-edit, one at a time
  pin: (p: SheetPin | null) => void;
  place: () => void;   // the Pencil's marks follow a scroll or a resize
  busy: () => boolean;   // the helper is changing the file
  note: (title: string, sub: string) => void;
  changed: () => void;   // the undo and redo buttons
};
export type Box = { x: number; y: number; w: number; h: number };
export type SheetCtl = {
  readonly: string; sheetCount: () => number; unit: () => number;
  hostSpec: () => { el: HTMLElement; unit: () => number; size: () => { w: number; h: number }; view: () => { ox: number; oy: number; w: number; h: number } };
  reload: (buf: ArrayBuffer) => void; rebase: (buf: ArrayBuffer, edits: any[]) => string[]; destroy: () => void;
  canUndo: () => boolean; canRedo: () => boolean; undo: () => void; redo: () => void;
  clearSel: () => boolean;
  shot: (unit: number, band: { x?: number; y?: number; w?: number; h?: number } | null) => Promise<{ canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number } | null>;
  under: (unit: number, r: Box) => { tag: string; label: string; text: string }[];
  wheel: (dx: number, dy: number) => void;
  test: () => any;
};

const RH = 46, CH = 24, ROW = 24;   // row number column, column letters row, row height
const esc = (s: any) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
let XL: Promise<any> | null = null;
const loadXL = (v: string) => XL ??= new Promise((ok, no) => { if ((window as any).XLSX) { ok((window as any).XLSX); return; } const sc = document.createElement("script"); sc.src = new URL(`../sheetjs/xlsx.full.min.js?v=${encodeURIComponent(v)}`, import.meta.url).href; sc.onload = () => ok((window as any).XLSX); sc.onerror = () => { XL = null; no(new Error("couldn't load the spreadsheet reader")); }; document.head.appendChild(sc); });

/** Open a spreadsheet in `host` (the canvas). Resolves when the first sheet is drawn. */
export async function sheetOpen(host: HTMLElement, deps: SheetDeps, buf: ArrayBuffer): Promise<SheetCtl> {
  const X = await loadXL(deps.v), csv = /\.csv$/i.test(deps.name);
  const open = (b: ArrayBuffer) => {
    const m = csv ? Model.fromCsv(X, new TextDecoder("utf-8").decode(b)) : Model.fromXlsx(X, b);
    const why = csv ? "" : readonlyReason(zipNames(new Uint8Array(b)) || []);
    return { m, ro: why ? readonlyLine(why) : m.tooBig ? tooBigLine : "" };
  };
  let { m: M, ro: RO } = open(buf);
  if (!M.visible().length) throw new Error("This spreadsheet has no sheets to show.");

  const wrap = document.createElement("div"); wrap.className = "zxw";
  wrap.innerHTML = `<div class="zsbar"><span class="zsref" data-zsref></span><span class="zsfx" data-zsfx></span></div><p class="zsro" data-zsro hidden></p>
    <div class="zsbody"><div class="zsscroll" tabindex="0" data-zsscroll role="grid" aria-label="${esc(deps.name)}"><div class="zsin" data-zsin>
      <div class="zscolh" data-zscolh></div><div class="zsfrz" data-zsfrz></div><div class="zsrowh" data-zsrowh></div><div class="zscells" data-zscells></div></div></div><div class="zsann" data-zsann></div><input class="zsedit" data-zsedit hidden spellcheck="false" autocomplete="off" aria-label="Cell"></div>
    <p class="zsmore" data-zsmore hidden></p><div class="xtabs zstabs" role="tablist" data-zstabs></div>`;
  host.appendChild(wrap);
  const q = <T extends HTMLElement>(s: string) => wrap.querySelector<T>(s)!;
  const scroller = q("[data-zsscroll]"), inner = q("[data-zsin]"), colh = q("[data-zscolh]"), frz = q("[data-zsfrz]"), rowh = q("[data-zsrowh]"), cells = q("[data-zscells]"), annEl = q("[data-zsann]"), edit = q<HTMLInputElement>("[data-zsedit]");

  // ---- state ----
  let si = M.visible()[0]; let a: Pos | null = null, b: Pos | null = null;   // a: the active cell, b: the other corner of the range
  let cx: number[] = [], rows = 1, cols = 1, merges = new Map<number, { r0: number; c0: number; r1: number; c1: number }>(), covered = new Set<number>(), raf = 0, dragging = false, ed: { r: number; c: number; was: string } | null = null;
  const hist = { undo: [] as { si: number; r: number; c: number; was: string; now: string }[], redo: [] as { si: number; r: number; c: number; was: string; now: string }[] };
  const K = (r: number, c: number) => r * 16384 + c;
  const editable = () => !RO && !deps.busy();

  // ---- the shape of the active sheet ----
  function shape() {
    const sh = M.shape(si); rows = sh.rows; cols = sh.cols; cx = [RH]; for (let c = 0; c < cols; c++) cx.push(cx[c] + M.width(si, c));
    merges = new Map(); covered = new Set();
    for (const g of M.sheets[si].merges) {
      if (g.r0 >= rows || g.c0 >= cols) continue; const r1 = g.r0 === 0 ? 0 : Math.min(g.r1, rows - 1), c1 = Math.min(g.c1, cols - 1);   // the held row keeps one row of height
      if (r1 === g.r0 && c1 === g.c0) continue; merges.set(K(g.r0, g.c0), { r0: g.r0, c0: g.c0, r1, c1 });
      for (let r = g.r0; r <= r1; r++) for (let c = g.c0; c <= c1; c++) if (r !== g.r0 || c !== g.c0) covered.add(K(r, c));
    }
    inner.style.width = cx[cols] + "px"; inner.style.height = CH + rows * ROW + "px";
    const more = q("[data-zsmore]"), sh2 = M.shape(si);
    if (sh2.allRows > SHOW_ROWS || sh2.allCols > SHOW_COLS) { more.hidden = false; more.textContent = `Showing ${Math.min(sh2.allRows, rows).toLocaleString("en-US")} rows × ${Math.min(sh2.allCols, cols)} columns of ${sh2.allRows.toLocaleString("en-US")} × ${sh2.allCols}. Download it to see everything.`; } else more.hidden = true;
  }
  const findCol = (x: number) => { if (x < RH) return -1; let lo = 0, hi = cols - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cx[mid] <= x) lo = mid; else hi = mid - 1; } return x >= cx[cols] ? -2 : lo; };
  const findRow = (y: number) => { if (y < CH) return -1; const r = Math.floor((y - CH) / ROW); return r >= rows ? -2 : r; };
  const norm = () => { if (!a || !b) return null; return { r0: Math.min(a.r, b.r), r1: Math.max(a.r, b.r), c0: Math.min(a.c, b.c), c1: Math.max(a.c, b.c) }; };

  // ---- drawing: only what is on screen ----
  function cellEl(r: number, c: number, top: number): string {
    const k = K(r, c); if (covered.has(k)) return "";
    const g = merges.get(k), w = g ? cx[g.c1 + 1] - cx[c] : cx[c + 1] - cx[c], h = g ? (g.r1 - g.r0 + 1) * ROW : ROW; if (w <= 0) return "";
    const t = M.text(si, r, c), fill = M.fill(si, r, c), s = norm(); let cls = "zc";
    if (M.isNum(si, r, c)) cls += " zcr"; if (t && M.isErr(si, r, c)) cls += " zce";
    if (fill) cls += " zcf";
    if (s && r >= s.r0 && r <= s.r1 && c >= s.c0 && c <= s.c1) { cls += " zcs"; if (r === s.r0) cls += " zcT"; if (r === s.r1) cls += " zcB"; if (c === s.c0) cls += " zcL"; if (c === s.c1) cls += " zcR"; }
    if (a && a.r === r && a.c === c) cls += " zca";
    return `<div class="${cls}" data-rc="${r},${c}" style="left:${cx[c]}px;top:${top}px;width:${w}px;height:${h}px${fill ? `;background:${fill}` : ""}">${esc(t)}</div>`;
  }
  function paint() {
    raf = 0; const sx = scroller.scrollLeft, sy = scroller.scrollTop, vw = scroller.clientWidth, vh = scroller.clientHeight;
    let c0 = Math.max(0, findCol(Math.max(sx, RH))), c1 = findCol(sx + vw); if (c1 < 0) c1 = cols - 1; c0 = Math.max(0, c0 - 1); c1 = Math.min(cols - 1, c1 + 1);
    const r0 = Math.max(1, Math.floor((sy - CH) / ROW) - 2), r1 = Math.min(rows - 1, Math.floor((sy + vh - CH) / ROW) + 2), s = norm();
    // column letters
    let h = `<div class="zscorner" data-zsall></div>`; for (let c = c0; c <= c1; c++) h += `<div class="zch${s && c >= s.c0 && c <= s.c1 ? " on" : ""}" data-zscol="${c}" style="left:${cx[c]}px;width:${cx[c + 1] - cx[c]}px">${colName(c)}</div>`; colh.innerHTML = h;
    // the first row, held in place
    let f = `<div class="zsr1h${s && s.r0 === 0 ? " on" : ""}" data-zsrow="0">1</div>`; for (let c = c0; c <= c1; c++) f += cellEl(0, c, 0); frz.innerHTML = f;
    // row numbers and the cells
    let rh = "", body = ""; for (let r = r0; r <= r1; r++) { rh += `<div class="zrh${s && r >= s.r0 && r <= s.r1 ? " on" : ""}" data-zsrow="${r}" style="top:${(r - 1) * ROW}px">${r + 1}</div>`; for (let c = c0; c <= c1; c++) body += cellEl(r, c, (r - 1) * ROW); }
    for (const [k, g] of merges) if (g.r0 >= 1 && (g.r0 < r0 || g.c0 < c0) && g.r1 >= r0 && g.r0 <= r1 && g.c1 >= c0 && g.c0 <= c1) body += cellEl(g.r0, g.c0, (g.r0 - 1) * ROW), void k;   // a merged cell that starts off screen
    rowh.innerHTML = rh; cells.innerHTML = body; placeEdit(); bar();
  }
  const later = () => { if (!raf) raf = requestAnimationFrame(paint); };
  function bar() {
    const ref = q("[data-zsref]"), fx = q("[data-zsfx]"), s = norm();
    ref.textContent = a && b ? rangeText(a, b) : ""; fx.textContent = a ? M.raw(si, a.r, a.c) : ""; void s;
    fx.classList.toggle("f", !!a && M.isFormula(si, a.r, a.c));
  }
  function tabs() {
    const vis = M.visible(), el = q("[data-zstabs]"); el.hidden = vis.length < 2;
    el.innerHTML = vis.length < 2 ? "" : vis.map(i => `<button role="tab" class="${i === si ? "on" : ""}" aria-selected="${i === si}" data-zst="${i}" title="${esc(M.sheets[i].name)}" aria-label="${esc(M.sheets[i].name)}">${esc(M.sheets[i].name)}</button>`).join("");
    const on = el.querySelector<HTMLElement>("button.on"); if (on) el.scrollLeft = Math.max(0, on.offsetLeft - (el.clientWidth - on.offsetWidth) / 2);
  }
  function roLine() { const p = q("[data-zsro]"); p.hidden = !RO; p.textContent = RO; }
  function layout() { annEl.style.width = scroller.clientWidth + "px"; annEl.style.height = scroller.clientHeight + "px"; later(); deps.place(); }

  // ---- the selection and its pin ----
  function pinNow() {
    if (!a || !b) { deps.pin(null); return; }
    const name = M.sheets[si].name, range = rangeText(a, b);
    deps.pin({ sheet: name, range, text: M.describe(si, a, b).slice(0, 400), label: pinLabel(name, a, b) });
  }
  function select(na: Pos | null, nb?: Pos | null, pin = true) { a = na; b = na ? (nb ?? na) : null; if (!na) { stopEdit(true); } paint(); if (pin) pinNow(); }
  function reveal(r: number, c: number) {
    const sx = scroller.scrollLeft, sy = scroller.scrollTop, vw = scroller.clientWidth, vh = scroller.clientHeight, x = cx[c], w = cx[c + 1] - cx[c], y = CH + r * ROW;
    if (x < sx + RH) scroller.scrollLeft = Math.max(0, x - RH); else if (x + w > sx + vw) scroller.scrollLeft = Math.min(x + w - vw + 2, Math.max(0, x - RH));
    if (r > 0) { if (y < sy + CH + ROW) scroller.scrollTop = Math.max(0, y - CH - ROW); else if (y + ROW > sy + vh) scroller.scrollTop = y + ROW - vh + 2; }
  }
  const hitAt = (e: PointerEvent | MouseEvent): { r: number; c: number; head: string } | null => {
    const bx = inner.getBoundingClientRect(), x = e.clientX - bx.left, y = e.clientY - bx.top, c = findCol(x), r = findRow(y);
    if (c === -2 || r === -2) return null; if (c === -1 && r === -1) return { r: 0, c: 0, head: "all" }; if (r === -1) return { r: 0, c, head: "col" }; if (c === -1) return { r, c: 0, head: "row" }; return { r, c, head: "" };
  };

  // ---- editing ----
  function placeEdit() {
    if (!ed) return; const sx = scroller.scrollLeft, sy = scroller.scrollTop, g = merges.get(K(ed.r, ed.c)), w = (g ? cx[g.c1 + 1] : cx[ed.c + 1]) - cx[ed.c];
    const x = cx[ed.c] - sx, y = ed.r === 0 ? CH : CH + ed.r * ROW - sy;
    edit.style.left = x + "px"; edit.style.top = y + "px"; edit.style.width = Math.max(w, 90) + "px"; edit.style.height = ROW + "px";
  }
  function startEdit(first?: string) {
    if (!a || !editable()) return; stopEdit(true); const was = M.raw(si, a.r, a.c); ed = { r: a.r, c: a.c, was }; edit.hidden = false; edit.value = first ?? was; placeEdit(); edit.focus({ preventScroll: true });
    if (first === undefined) edit.select(); else edit.setSelectionRange(edit.value.length, edit.value.length);
  }
  function stopEdit(cancel: boolean, refocus = false) {
    if (!ed) return; const e = ed; ed = null; const v = edit.value; edit.hidden = true; edit.value = "";
    if (!cancel) { if (!apply(si, e.r, e.c, v, true)) { /* an invalid formula: the note is up and the cell is as it was */ } }
    if (refocus) scroller.focus({ preventScroll: true });
  }
  /** Change a cell: the workbook recalculates, the cells that follow it update, and the change is saved. */
  function apply(i: number, r: number, c: number, raw: string, record: boolean): boolean {
    if (!editable()) return false;
    const res = M.set(i, r, c, raw);
    if (res === "invalid") { deps.note("That formula isn't valid", "Check it, then try again."); return false; }
    if (!res) return true;
    if (record) { hist.undo.push({ si: i, r, c, was: res.edit.was, now: raw }); if (hist.undo.length > 60) hist.undo.shift(); hist.redo = []; }
    shape(); paint(); deps.changed(); void deps.save([res.edit]); return true;
  }
  function jump(i: number, r: number, c: number) { if (i !== si) { go(i); } select({ r, c }); reveal(r, c); }
  function undo() { const st = hist.undo[hist.undo.length - 1]; if (!st || !editable()) return; if (apply(st.si, st.r, st.c, st.was, false)) { hist.undo.pop(); hist.redo.push(st); jump(st.si, st.r, st.c); deps.changed(); } }
  function redo() { const st = hist.redo[hist.redo.length - 1]; if (!st || !editable()) return; if (apply(st.si, st.r, st.c, st.now, false)) { hist.redo.pop(); hist.undo.push(st); jump(st.si, st.r, st.c); deps.changed(); } }

  function go(i: number) {
    if (i === si && cx.length) return; stopEdit(true); si = i; a = b = null; deps.pin(null); shape(); scroller.scrollTo(0, 0); tabs(); paint(); layout();
  }

  // ---- pointer and keys ----
  let moved = false, startHit: { r: number; c: number; head: string } | null = null;
  scroller.addEventListener("pointerdown", e => {
    if ((e.target as HTMLElement).closest("input")) return; if (e.pointerType === "mouse" && e.button !== 0) return;
    const h = hitAt(e); if (!h) { select(null); return; } scroller.focus({ preventScroll: true }); moved = false; startHit = h;
    const shift = e.shiftKey && a;
    if (h.head === "all") select({ r: 0, c: 0 }, { r: rows - 1, c: cols - 1 });
    else if (h.head === "col") select({ r: 0, c: h.c }, { r: rows - 1, c: h.c });
    else if (h.head === "row") select({ r: h.r, c: 0 }, { r: h.r, c: cols - 1 });
    else if (shift) select(a, { r: h.r, c: h.c });
    else if (e.pointerType !== "touch") { select({ r: h.r, c: h.c }, undefined, false); dragging = true; try { scroller.setPointerCapture(e.pointerId); } catch { /* the pointer is gone */ } }
    else { startHit = h; }
  });
  scroller.addEventListener("pointermove", e => { if (!dragging || !a) return; const h = hitAt(e); if (!h || h.head) return; if (!b || b.r !== h.r || b.c !== h.c) { moved = true; b = { r: h.r, c: h.c }; later(); bar(); } });
  const up = (e: PointerEvent) => { if (dragging) { dragging = false; try { scroller.releasePointerCapture(e.pointerId); } catch { /* released */ } pinNow(); bar(); }
    else if (e.pointerType === "touch" && startHit && !startHit.head && !moved) { const h = startHit; if (a && b && a.r === h.r && a.c === h.c && b.r === h.r && b.c === h.c) startEdit(); else select({ r: h.r, c: h.c }); } startHit = null; };   // a second tap on the selected cell edits it (there is no double click on a phone)
  scroller.addEventListener("pointerup", up); scroller.addEventListener("pointercancel", e => { dragging = false; startHit = null; void e; });
  scroller.addEventListener("dblclick", e => { const h = hitAt(e); if (h && !h.head && a) startEdit(); });
  scroller.addEventListener("scroll", () => { later(); placeEdit(); deps.place(); }, { passive: true });
  scroller.addEventListener("keydown", e => {
    if (e.target !== scroller || e.isComposing) return; const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === "a" || e.key === "A")) { e.preventDefault(); select({ r: 0, c: 0 }, { r: rows - 1, c: cols - 1 }); return; }
    if (mod) return;   // copy is the browser's own; undo and redo are zone.ts's
    const step = (dr: number, dc: number) => { if (!a) { select({ r: 0, c: 0 }); return; } const f = e.shiftKey ? b || a : a, nr = Math.max(0, Math.min(rows - 1, f.r + dr)), nc = Math.max(0, Math.min(cols - 1, f.c + dc)); if (e.shiftKey) select(a, { r: nr, c: nc }); else select({ r: nr, c: nc }); reveal(nr, nc); };
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); step(1, 0); return; case "ArrowUp": e.preventDefault(); step(-1, 0); return;
      case "ArrowRight": e.preventDefault(); step(0, 1); return; case "ArrowLeft": e.preventDefault(); step(0, -1); return;
      case "Tab": e.preventDefault(); step(0, e.shiftKey ? -1 : 1); return;
      case "Enter": case "F2": e.preventDefault(); startEdit(); return;
      case "Delete": case "Backspace": { const s = norm(); if (!s || !editable()) return; e.preventDefault(); const n = (s.r1 - s.r0 + 1) * (s.c1 - s.c0 + 1); if (n > 20) { deps.note("That's a lot of cells", "Select 20 cells or fewer to clear them."); return; } const items: any[] = []; for (let r = s.r0; r <= s.r1; r++) for (let c = s.c0; c <= s.c1; c++) { if (M.raw(si, r, c) === "") continue; const res = M.set(si, r, c, ""); if (res && res !== "invalid") { items.push(res.edit); hist.undo.push({ si, r, c, was: res.edit.was, now: "" }); } } if (items.length) { hist.redo = []; shape(); paint(); deps.changed(); void deps.save(items); } return; }
      case "Escape": if (a) { e.preventDefault(); e.stopPropagation(); select(null); } return;
    }
    if (e.key.length === 1 && !e.altKey && a && editable()) { e.preventDefault(); startEdit(e.key); }
  });
  edit.addEventListener("keydown", e => {
    if (e.isComposing) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); stopEdit(true); return; }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault(); e.stopPropagation(); const at = ed ? { r: ed.r, c: ed.c } : null, bad = !apply(si, at?.r ?? 0, at?.c ?? 0, edit.value, true);
      if (bad) return; ed = null; edit.hidden = true; edit.value = ""; scroller.focus({ preventScroll: true });
      if (at) { const nr = e.key === "Enter" ? Math.min(rows - 1, at.r + (e.shiftKey ? -1 : 1)) : at.r, nc = e.key === "Tab" ? Math.max(0, Math.min(cols - 1, at.c + (e.shiftKey ? -1 : 1))) : at.c; select({ r: Math.max(0, nr), c: nc }); reveal(Math.max(0, nr), nc); }
    }
  });
  edit.addEventListener("blur", () => { if (ed) stopEdit(false); });
  wrap.addEventListener("click", e => { const t = (e.target as HTMLElement).closest<HTMLElement>("[data-zst]"); if (t) { e.stopPropagation(); go(+t.dataset.zst!); } });
  scroller.addEventListener("copy", e => {
    const s = norm(); if (!s || ed) return; const out: string[] = []; for (let r = s.r0; r <= s.r1; r++) { const row: string[] = []; for (let c = s.c0; c <= s.c1; c++) row.push(M.text(si, r, c)); out.push(row.join("\t")); }
    e.clipboardData?.setData("text/plain", out.join("\n")); e.preventDefault();
  });
  const ro = new ResizeObserver(() => layout()); ro.observe(scroller);

  roLine(); shape(); tabs(); paint(); layout();

  // ---- what the Pencil needs ----
  const css = () => { const cs = getComputedStyle(wrap), v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d; return { bg: v("--sheet", "#fff"), ink: v("--ink", "#1c1b19"), line: v("--line", "#e3e1dc"), mute: v("--mute", "#77746d"), head: v("--hover", "#f0eee9") }; };
  async function shot(unit: number, band: { x?: number; y?: number; w?: number; h?: number } | null) {
    if (unit !== si + 1) return null; const W = cx[cols], H = CH + rows * ROW;
    const x = Math.max(0, Math.min(W - 1, band?.x ?? scroller.scrollLeft)), y = Math.max(0, Math.min(H - 1, band?.y ?? scroller.scrollTop)), w = Math.min(W - x, Math.min(4000, band?.w ?? scroller.clientWidth)), h = Math.min(H - y, Math.min(4000, band?.h ?? scroller.clientHeight));
    const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); const g = c.getContext("2d"); if (!g) return null; const k = css();
    g.fillStyle = k.bg; g.fillRect(0, 0, c.width, c.height); g.font = '13px system-ui,-apple-system,"Segoe UI",sans-serif'; g.textBaseline = "middle";
    const r0 = Math.max(0, Math.floor((y - CH) / ROW)), r1 = Math.min(rows - 1, Math.floor((y + h - CH) / ROW)), c0 = Math.max(0, findCol(Math.max(x, RH)) < 0 ? 0 : findCol(Math.max(x, RH))), c1 = (() => { const f = findCol(x + w); return f < 0 ? cols - 1 : f; })();
    const clip = (t: string, wd: number) => { if (g.measureText(t).width <= wd - 10) return t; let s = t; while (s.length > 1 && g.measureText(s + "…").width > wd - 10) s = s.slice(0, -1); return s + "…"; };
    for (let r = r0; r <= r1; r++) for (let cc = c0; cc <= c1; cc++) {
      if (covered.has(K(r, cc))) continue; const gm = merges.get(K(r, cc)), px = cx[cc] - x, py = CH + r * ROW - y, wd = (gm ? cx[gm.c1 + 1] : cx[cc + 1]) - cx[cc], ht = gm ? (gm.r1 - gm.r0 + 1) * ROW : ROW, fill = M.fill(si, r, cc), t = M.text(si, r, cc);
      if (fill) { g.fillStyle = fill; g.fillRect(px, py, wd, ht); } g.strokeStyle = k.line; g.lineWidth = 1; g.strokeRect(px + .5, py + .5, wd - 1, ht - 1);
      if (t) { g.fillStyle = fill ? "#1c1b19" : k.ink; if (M.isNum(si, r, cc)) { g.textAlign = "right"; g.fillText(clip(t, wd), px + wd - 6, py + ht / 2); } else { g.textAlign = "left"; g.fillText(clip(t, wd), px + 6, py + ht / 2); } }
    }
    g.fillStyle = k.head; g.textAlign = "center"; g.font = '11.5px system-ui,-apple-system,"Segoe UI",sans-serif';
    if (y < CH) for (let cc = c0; cc <= c1; cc++) { const px = cx[cc] - x; g.fillStyle = k.head; g.fillRect(px, -y, cx[cc + 1] - cx[cc], CH); g.fillStyle = k.mute; g.fillText(colName(cc), px + (cx[cc + 1] - cx[cc]) / 2, CH / 2 - y); }
    if (x < RH) for (let r = r0; r <= r1; r++) { const py = CH + r * ROW - y; g.fillStyle = k.head; g.fillRect(-x, py, RH, ROW); g.fillStyle = k.mute; g.fillText(String(r + 1), RH / 2 - x, py + ROW / 2); }
    return { canvas: c, x, y, w: c.width, h: c.height };
  }
  function under(unit: number, r: Box) {
    if (unit !== si + 1) return []; const c0 = findCol(r.x), c1 = findCol(r.x + r.w), r0 = findRow(r.y), r1 = findRow(r.y + r.h);
    if (c0 < 0 || r0 < 0) return [];
    const ec = c1 < 0 ? cols - 1 : c1, er = r1 < 0 ? rows - 1 : r1, ra = rangeText({ r: r0, c: c0 }, { r: er, c: ec });
    if (r0 === er && c0 === ec) return [{ tag: "cell", label: `cell ${ra}`, text: M.text(si, r0, c0).slice(0, 80) }];
    return [{ tag: "cells", label: `cells ${ra}`, text: M.describe(si, { r: r0, c: c0 }, { r: er, c: ec }).slice(0, 80) }];
  }

  return {
    get readonly() { return RO; }, sheetCount: () => M.visible().length, unit: () => si + 1,
    hostSpec: () => ({ el: annEl, unit: () => si + 1, size: () => ({ w: cx[cols] || 0, h: CH + rows * ROW }), view: () => ({ ox: scroller.scrollLeft, oy: scroller.scrollTop, w: Math.max(1, scroller.clientWidth), h: Math.max(1, scroller.clientHeight) }) }),
    reload: nb => {   // a new version of the file: the same sheet again, the selection let go
      stopEdit(true); const name = M.sheets[si].name, sx = scroller.scrollLeft, sy = scroller.scrollTop; const o = open(nb); M = o.m; RO = o.ro; hist.undo = []; hist.redo = [];
      const at = M.sheets.findIndex(s => s.name === name && !s.hidden); si = at >= 0 ? at : M.visible()[0]; a = b = null; deps.pin(null); roLine(); shape(); tabs(); scroller.scrollTo(sx, sy); paint(); layout(); deps.changed();
    },
    rebase(nb: ArrayBuffer, edits: any[]) {   // the newest file from another device: each edited cell is reapplied if it still holds what it held before; the others are returned
      const sel = a && { ...a }, lost: string[] = []; this.reload(nb); if (sel) select(sel);
      for (const e of edits) { const i = M.sheets.findIndex(s => s.name === e.sheet), p = parseRef(e.ref); if (i < 0 || !p || M.raw(i, p.r, p.c) !== e.was || !apply(i, p.r, p.c, e.f !== undefined ? "=" + e.f : String(e.v ?? ""), false)) lost.push(e.ref); }
      return lost;
    },
    destroy: () => { ro.disconnect(); cancelAnimationFrame(raf); wrap.remove(); },
    canUndo: () => hist.undo.length > 0, canRedo: () => hist.redo.length > 0, undo, redo,
    clearSel: () => { if (ed) { stopEdit(true); return true; } if (!a) return false; select(null); return true; },
    shot, under, wheel: (dx, dy) => scroller.scrollBy(dx, dy),
    test: () => ({ si, a, b, rows, cols, ro: RO, name: M.sheets[si].name, text: (r: number, c: number) => M.text(si, r, c), raw: (r: number, c: number) => M.raw(si, r, c), sheets: M.sheets.map(s => s.name) }),
  };
}
export { refOf };
