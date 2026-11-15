// A Word document (.docx, .docm) edited in the Zone like a normal document: one white page of text a person clicks into and types in. The page is contenteditable, and the
// model (zone-doc-model.ts) is a flat list of the paragraphs in the file's own order, so each paragraph on the page has the index the server addresses it by (1HC src/zone-docx.js).
//  - Typing inside a paragraph is the browser's own; the paragraph is read back into the model after each input. Everything that crosses a paragraph (Enter, Backspace or Delete at an
//    edge, a selection over several paragraphs, paste, cut, bold, italic, underline) is done on the model, and the page follows it paragraph by paragraph.
//  - About a second after typing stops (and on leaving the Zone) the difference between the file and the model is sent as paragraph ops, one new version of the same Library file.
//  - What it can't edit safely (a picture, a link, a field, a text box, a tracked change, a section break) is shown as it is and stays untouched in the file.
//  - Cmd or Ctrl plus Z and Shift Z undo and redo, per session. Paste is plain text.
// This file is zone/doc.js, fetched by the Zone only when a Word document is opened in the editable view.
import { diffOps, enter, joinBack, plen, ptext, rebase, rebaseParas, replace, snapshot, toggle, type Doc, type Flag, type Op, type Para, type Pos } from "./zone-doc-model";
import { parseDocx, type Parsed, type TableInfo } from "./zone-doc-parse";

export type DocPin = { label: string; text: string; para: number };
export type DocDeps = {
  name: string;
  save: (edits: Op[]) => Promise<{ ok: boolean }>;   // zone.ts: POST .../zone-edit; false when the file was reloaded after a refusal
  pin: (p: DocPin | null) => void;
  place: () => void; busy: () => boolean; note: (title: string, sub: string) => void; changed: () => void;
};
type Box = { x: number; y: number; w: number; h: number };
export type DocCtl = {
  hostSpec: () => { el: HTMLElement; unit: () => number; size: () => { w: number; h: number } };
  reload: (buf: ArrayBuffer) => Promise<void>; rebase: (buf: ArrayBuffer) => Promise<number[]>; destroy: () => void; flush: () => Promise<void>; setBusy: (on: boolean) => void;
  canUndo: () => boolean; canRedo: () => boolean; undo: () => void; redo: () => void; clearSel: () => boolean;
  shot: (unit: number, band: { x?: number; y?: number; w?: number; h?: number } | null) => Promise<{ canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number } | null>;
  under: (unit: number, r: Box) => { tag: string; label: string; text: string }[]; wheel: (dx: number, dy: number) => void;
  test: () => any;
};
const SAVE_MS = 1000, UNDO_MAX = 100, PASTE_MAX = 200_000;
const CTL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;

export async function docOpen(host: HTMLElement, deps: DocDeps, buf: ArrayBuffer): Promise<DocCtl> {
  let P: Parsed, doc: Doc, base: Para[], fileIdx = new Map<number, number>(), busy = false, gone = false;
  const hold = { urls: [] as string[] };
  const RT: string[] = [], RI = new Map<string, number>(), rid = (r: string) => { let i = RI.get(r); if (i === undefined) { i = RT.length; RT.push(r); RI.set(r, i); } return i; };
  const els = new Map<number, HTMLElement>(), cells = new Map<number, HTMLElement>();
  let undoS: { doc: Doc; sel: [Pos, Pos] | null }[] = [], redoS: typeof undoS = [], burst = 0, rev = 0, saving: Promise<void> | null = null, timer = 0, lastPin = "", pinT = 0, composing = false;

  const wrap = document.createElement("div"); wrap.className = "zddw";
  const body = document.createElement("div"); body.className = "zdd"; body.contentEditable = "true"; body.spellcheck = true; body.setAttribute("role", "textbox"); body.setAttribute("aria-multiline", "true"); body.setAttribute("aria-label", deps.name);
  wrap.appendChild(body); host.innerHTML = ""; host.appendChild(wrap);

  // ---- drawing ----
  const paraEl = (p: Para, i: number): HTMLElement => {
    const el = document.createElement("p"); el.className = "zdp"; el.dataset.pid = String(p.pid); el.style.cssText = P.paraCss(p);
    if (p.v.list && p.v.first < 0) el.style.setProperty("--zdh", -p.v.first + "px");
    if (p.v.head) { el.setAttribute("role", "heading"); el.setAttribute("aria-level", String(Math.min(6, p.v.head))); }
    if (p.prot) {
      el.classList.add("zdprot"); el.contentEditable = "false";
      for (const r of p.protRuns || []) { if (r.img) { const im = document.createElement("img"); im.src = r.img; im.alt = ""; im.draggable = false; const w = (r as any).w, h = (r as any).h; if (w) im.style.width = Math.round(w) + "px"; if (h) im.style.aspectRatio = `${Math.round(w)} / ${Math.round(h)}`; el.appendChild(im); } else if (r.t) { const s = document.createElement("span"); s.style.cssText = P.look(p, r.r); s.textContent = r.t; el.appendChild(s); } }
      if (!el.firstChild) el.appendChild(document.createElement("br"));
    } else if (!p.runs.length) { el.appendChild(document.createElement("br")); el.style.cssText += ";" + P.look(p, p.caret); }
    else for (const r of p.runs) { const s = document.createElement("span"); s.dataset.ri = String(rid(r.r)); s.style.cssText = P.look(p, r.r); s.textContent = r.t; el.appendChild(s); }
    void i; return el;
  };
  const tableEl = (t: TableInfo): HTMLElement => {
    const tb = document.createElement("table"); tb.className = "zdt"; const tot = t.cols.reduce((a, b) => a + b, 0);
    if (tot > 0) { const cg = document.createElement("colgroup"); for (const w of t.cols) { const c = document.createElement("col"); c.style.width = (w / tot * 100).toFixed(2) + "%"; cg.appendChild(c); } tb.appendChild(cg); }
    const bd = document.createElement("tbody"); tb.appendChild(bd);
    for (const row of t.rows) { const tr = document.createElement("tr"); for (const c of row) { const td = document.createElement("td"); if (c.span > 1) td.colSpan = c.span; cells.set(c.ct, td); tr.appendChild(td); } bd.appendChild(tr); }
    return tb;
  };
  const tableOf = new Map<number, TableInfo>();
  const ctEl = (ct: number): HTMLElement => {
    if (ct === 0) return body; const have = cells.get(ct); if (have) return have;
    const t = [...tableOf.values()].find(x => x.rows.some(r => r.some(c => c.ct === ct)))!; ctEl(t.parent).appendChild(tableEl(t)); return cells.get(ct)!;
  };
  const markers = () => {
    const m = P.markers(doc.paras);
    doc.paras.forEach((p, i) => { const el = els.get(p.pid); if (!el) return; const v = m[i]; if (v) { if (el.dataset.m !== v) el.dataset.m = v; el.classList.add("zdl"); } else if (el.dataset.m != null) { delete el.dataset.m; el.classList.remove("zdl"); } });
  };
  const renderAll = () => {
    body.textContent = ""; els.clear(); cells.clear(); body.style.cssText = `${P.baseCss};${P.font ? "font-family:" + P.font + ";" : ""}`;
    doc.paras.forEach((p, i) => { if (p.nested) return; const el = paraEl(p, i); els.set(p.pid, el); ctEl(p.ct).appendChild(el); });
    markers();
  };
  const pageStyle = () => { const w = Math.round(P.page.w); wrap.style.setProperty("--zdw", w + "px"); wrap.style.setProperty("--zdml", Math.round(P.page.ml) + "px"); wrap.style.setProperty("--zdmr", Math.round(P.page.mr) + "px"); wrap.style.setProperty("--zdmt", Math.round(P.page.mt) + "px"); wrap.style.setProperty("--zdmb", Math.round(P.page.mb) + "px"); };
  const load = async (b: ArrayBuffer) => {
    for (const u of hold.urls) URL.revokeObjectURL(u); hold.urls = [];
    P = await parseDocx(b, hold); doc = P.doc; base = P.base.map(p => ({ ...p })); fileIdx = new Map(doc.paras.map((p, i) => [p.pid, i])); undoS = []; redoS = []; rev = 0;
    tableOf.clear(); for (const t of P.tables) tableOf.set(t.id, t); pageStyle(); renderAll(); lastPin = "";
  };
  await load(buf);

  // ---- positions: the model's (paragraph index, character offset) and the page's ----
  const pidIdx = () => new Map(doc.paras.map((p, i) => [p.pid, i]));
  const paraOf = (n: Node | null): HTMLElement | null => { for (let a: Node | null = n; a && a !== body; a = a.parentNode) if (a instanceof HTMLElement && a.classList.contains("zdp") && a.parentNode) return a; return null; };
  const offIn = (el: HTMLElement, node: Node, o: number) => { const r = document.createRange(); r.selectNodeContents(el); try { r.setEnd(node, o); } catch { return 0; } return r.toString().length; };
  const posOf = (node: Node, o: number, m = pidIdx()): Pos | null => { const el = paraOf(node); if (!el) return null; const i = m.get(+el.dataset.pid!); return i == null ? null : { i, o: offIn(el, node, o) }; };
  const getSel = (): { a: Pos; b: Pos; collapsed: boolean; backward: boolean } | null => {
    const s = getSelection(); if (!s || !s.rangeCount || !s.anchorNode || !body.contains(s.anchorNode) || !s.focusNode || !body.contains(s.focusNode)) return null;
    const m = pidIdx(), a = posOf(s.anchorNode, s.anchorOffset, m), f = posOf(s.focusNode, s.focusOffset, m); if (!a || !f) return null;
    const back = a.i > f.i || (a.i === f.i && a.o > f.o); return { a: back ? f : a, b: back ? a : f, collapsed: s.isCollapsed, backward: back };
  };
  const where = (el: HTMLElement, o: number): [Node, number] => {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let at = 0, last: Text | null = null, n: Node | null;
    while ((n = w.nextNode())) { const t = n as Text, len = t.data.length; if (o <= at + len) return [t, o - at]; at += len; last = t; }
    return last ? [last, last.data.length] : [el, 0];
  };
  const setSel = (a: Pos, b: Pos = a) => {
    const pa = doc.paras[a.i], pb = doc.paras[b.i], ea = pa && els.get(pa.pid), eb = pb && els.get(pb.pid); if (!ea || !eb) return;
    const r = document.createRange(), x = where(ea, a.o), y = where(eb, b.o); r.setStart(x[0], x[1]); r.setEnd(y[0], y[1]);
    const s = getSelection()!; s.removeAllRanges(); s.addRange(r);
  };
  const selPair = (): [Pos, Pos] | null => { const s = getSel(); return s ? [s.a, s.b] : null; };

  // ---- changing the model, and the page after it ----
  const paintChanged = (before: Para[], after: Para[]) => {
    const was = new Map(before.map(p => [p.pid, p])), now = new Set(after.map(p => p.pid));
    for (const p of before) if (!now.has(p.pid)) { els.get(p.pid)?.remove(); els.delete(p.pid); }
    after.forEach((p, i) => {
      if (p.nested || was.get(p.pid) === p) return;
      const fresh = paraEl(p, i), old = els.get(p.pid);
      if (old) { old.replaceWith(fresh); } else {
        let at: HTMLElement | null = null; for (let k = i - 1; k >= 0; k--) { const q = after[k]; if (q.ct === p.ct && els.get(q.pid)?.isConnected) { at = els.get(q.pid)!; break; } if (q.ct !== p.ct) break; }
        if (at) at.after(fresh); else { let nx: HTMLElement | null = null; for (let k = i + 1; k < after.length; k++) { const q = after[k]; if (q.ct === p.ct && els.get(q.pid)?.isConnected) { nx = els.get(q.pid)!; break; } if (q.ct !== p.ct) break; } if (nx) nx.before(fresh); else ctEl(p.ct).appendChild(fresh); }
      }
      els.set(p.pid, fresh);
    });
    markers();
  };
  const pushUndo = () => { undoS.push({ doc: snapshot(doc), sel: selPair() }); if (undoS.length > UNDO_MAX) undoS.shift(); redoS = []; deps.changed(); };
  const touch = () => { rev++; clearTimeout(timer); timer = window.setTimeout(() => { void saveNow(); }, SAVE_MS); deps.changed(); };
  /** Run one change on the model; it returns where the selection goes (or null when the change was refused, which changes nothing). */
  const mutate = (fn: (d: Doc) => [Pos, Pos?] | Pos | null) => {
    const s0 = selPair(), before = doc.paras.slice(), nextPid = doc.nextPid, snap = snapshot(doc);
    const r = fn(doc); if (!r) { doc.paras = before; doc.nextPid = nextPid; return false; }
    undoS.push({ doc: snap, sel: s0 }); if (undoS.length > UNDO_MAX) undoS.shift(); redoS = []; clearTimeout(burst); burst = 0;
    paintChanged(before, doc.paras); const [a, b] = Array.isArray(r) ? r : [r, r]; setSel(a, b ?? a); touch(); return true;
  };
  const doEnter = (s: { a: Pos; b: Pos; collapsed: boolean }) => mutate(d => { const x = s.collapsed ? s.a : replace(d, s.a, s.b, ""); return x ? enter(d, x.i, x.o) : null; });
  const doFmt = (f: Flag) => { const s = getSel(); if (!s || s.collapsed) return; mutate(d => (toggle(d, s.a, s.b, f, P.dflt) ? [s.a, s.b] : null) as any); };

  // typing inside one paragraph: the browser changed the text, the model reads it back
  const readRuns = (el: HTMLElement, p: Para) => {
    const out: { t: string; r: string }[] = []; let last = p.runs.length ? p.runs[0].r : p.caret;
    const walk = (n: Node, r: string | null) => {
      if (n.nodeType === 3) { const t = (n as Text).data.replace(CTL, ""); if (t) { const rr = r ?? last; out.push({ t, r: rr }); last = rr; } return; }
      if (!(n instanceof HTMLElement) || n.tagName === "BR") return;
      const ri = n.dataset.ri != null ? RT[+n.dataset.ri] : r; for (const c of n.childNodes) walk(c, ri ?? null);
    };
    for (const c of el.childNodes) walk(c, null);
    return out;
  };
  const canonical = (el: HTMLElement) => [...el.childNodes].every(n => (n instanceof HTMLElement && ((n.tagName === "SPAN" && n.dataset.ri != null && n.childNodes.length === 1 && n.firstChild!.nodeType === 3) || n.tagName === "BR")));
  const sync = () => {
    const s = getSelection(), el = s?.anchorNode ? paraOf(s.anchorNode) : null; if (!el) return; const i = pidIdx().get(+el.dataset.pid!); if (i == null) return;
    const p = doc.paras[i]; if (p.prot) return;
    const runs: { t: string; r: string }[] = readRuns(el, p), merged = runs.reduce((a: { t: string; r: string }[], r) => { const l = a[a.length - 1]; if (l && l.r === r.r) l.t += r.t; else a.push({ ...r }); return a; }, []);
    const same = merged.length === p.runs.length && merged.every((r, k) => r.t === p.runs[k].t && r.r === p.runs[k].r); if (same && canonical(el)) return;
    const np: Para = { ...p, runs: merged, caret: merged.length ? merged[merged.length - 1].r : p.caret }, before = doc.paras.slice(); doc.paras[i] = np;
    const pos = posOf(s!.anchorNode!, s!.anchorOffset);
    if (!canonical(el) || !merged.length) { paintChanged(before, doc.paras); if (pos) setSel(pos); } else { els.set(np.pid, el); }
    touch();
  };

  // ---- the page's events ----
  const startBurst = () => { if (!burst) { undoS.push({ doc: snapshot(doc), sel: selPair() }); if (undoS.length > UNDO_MAX) undoS.shift(); redoS = []; deps.changed(); } clearTimeout(burst); burst = window.setTimeout(() => { burst = 0; }, 900); };
  const range = (r: StaticRange): [Pos, Pos] | null => { const m = pidIdx(), a = posOf(r.startContainer, r.startOffset, m), b = posOf(r.endContainer, r.endOffset, m); return a && b ? [a, b] : null; };
  const onBefore = (e: InputEvent) => {
    if (busy) { e.preventDefault(); return; }
    const t = e.inputType;
    if (t === "historyUndo") { e.preventDefault(); undo(); return; } if (t === "historyRedo") { e.preventDefault(); redo(); return; }
    if (e.isComposing || composing) { startBurst(); return; }
    if (t === "insertParagraph") { e.preventDefault(); const s = getSel(); if (s) doEnter(s); return; }
    if (t === "insertLineBreak" || t === "insertFromDrop" || t === "insertFromYank" || t === "insertFromPaste" || t === "insertFromPasteAsQuotation" || t === "formatBold" || t === "formatItalic" || t === "formatUnderline" || t.startsWith("format")) { e.preventDefault(); return; }
    if (t.startsWith("delete") || t === "insertText" || t === "insertReplacementText") {
      const s = getSel(); if (!s) { e.preventDefault(); return; }
      let a = s.a, b = s.b; const tr = e.getTargetRanges?.()[0], rg = tr ? range(tr) : null;
      if (rg) { a = rg[0]; b = rg[1]; } else if (s.collapsed && t.startsWith("delete")) { const fwd = /Forward/.test(t); a = fwd ? s.a : { i: s.a.i, o: Math.max(0, s.a.o - 1) }; b = fwd ? { i: s.a.i, o: s.a.o + 1 } : s.a; if (!fwd && s.a.o === 0) { a = { i: s.a.i - 1, o: plen(doc.paras[s.a.i - 1] || doc.paras[0]) }; } if (fwd && s.a.o >= plen(doc.paras[s.a.i])) b = { i: s.a.i + 1, o: 0 }; }
      if (a.i === b.i && !doc.paras[a.i]?.prot) { startBurst(); return; }   // inside one paragraph: the browser does it
      e.preventDefault();
      if (a.i < 0 || b.i >= doc.paras.length) return;
      const text = t === "insertText" || t === "insertReplacementText" ? (e.data ?? "").replace(CTL, "") : "";
      mutate(d => replace(d, a, b, text));
    }
  };
  const onInput = () => sync();
  const onPaste = (e: ClipboardEvent) => {
    e.preventDefault(); if (busy) return; const s = getSel(); if (!s) return;
    const text = (e.clipboardData?.getData("text/plain") || "").replace(CTL, "").replace(/ /g, " ").slice(0, PASTE_MAX); if (!text) return;
    mutate(d => replace(d, s.a, s.b, text));
  };
  const onCut = (e: ClipboardEvent) => {
    if (busy) { e.preventDefault(); return; } const s = getSel(); if (!s || s.collapsed) return; e.preventDefault();
    const txt = getSelection()!.toString(); mutate(d => replace(d, s.a, s.b, "")) && e.clipboardData?.setData("text/plain", txt);
  };
  const onKeydown = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
    if (mod && !e.altKey && (k === "b" || k === "i" || k === "u")) { e.preventDefault(); if (!busy) doFmt(k as Flag); return; }
    if (mod && !e.altKey && (k === "z" || k === "y")) { e.preventDefault(); if (busy) return; if (k === "y" || e.shiftKey) redo(); else undo(); return; }
    if (e.key === "Enter" && e.shiftKey) e.preventDefault();
  };
  const onDrag = (e: Event) => e.preventDefault();
  const onSelChange = () => {
    clearTimeout(pinT); pinT = window.setTimeout(() => {
      if (gone) return; const s = getSel(); if (!s) return; const p = doc.paras[s.a.i]; if (!p || p.prot || p.nested) return;
      let n = 0; for (let i = 0; i <= s.a.i; i++) if (!doc.paras[i].nested) n++;
      const one = s.a.i === s.b.i && !s.collapsed, full = ptext(p), t = one ? full.slice(s.a.o, s.b.o) : full, flat = t.replace(/\s+/g, " ").trim(), snip = flat.length > 44 ? flat.slice(0, 43).trimEnd() + "…" : flat;
      const key = `${p.pid}|${one ? s.a.o + "-" + s.b.o : ""}|${snip}`; if (key === lastPin) return; lastPin = key;
      deps.pin({ label: `¶ ${n}${snip ? " · " + snip : ""}`, text: (one ? t : full).replace(/\s+/g, " ").trim().slice(0, 400), para: n });
    }, 220);
  };
  body.addEventListener("beforeinput", onBefore as any); body.addEventListener("input", onInput); body.addEventListener("paste", onPaste as any); body.addEventListener("cut", onCut as any); body.addEventListener("keydown", onKeydown);
  body.addEventListener("compositionstart", () => { composing = true; }); body.addEventListener("compositionend", () => { composing = false; sync(); });
  body.addEventListener("dragstart", onDrag); body.addEventListener("drop", onDrag); body.addEventListener("dragover", onDrag);
  document.addEventListener("selectionchange", onSelChange);

  // ---- saving: the difference between the file and the model, as paragraph ops, in one request ----
  const saveNow = async (): Promise<void> => {
    clearTimeout(timer); if (gone) return; if (saving) { await saving; if (rev && !gone) return saveNow(); return; }
    const snap = snapshot(doc), cur = snap.paras.map(p => ({ ...p, orig: fileIdx.get(p.pid) ?? null })), ops = diffOps(base, cur), at = rev; if (!ops.length) return;
    saving = (async () => {
      let ok = true;
      for (let k = 0; k < ops.length && ok; k += 400) ok = (await deps.save(ops.slice(k, k + 400))).ok;
      if (!ok || gone) return;
      base = rebase({ paras: snap.paras.map(p => ({ ...p })), nextPid: 0 } as Doc).map(p => ({ ...p })); fileIdx = new Map(snap.paras.map((p, i) => [p.pid, i]));
      if (rev === at) rev = 0; else touch();
    })();
    try { await saving; } finally { saving = null; }
  };
  const flush = async () => { clearTimeout(timer); if (rev || diffOps(base, doc.paras.map(p => ({ ...p, orig: fileIdx.get(p.pid) ?? null }))).length) await saveNow(); };

  // ---- undo and redo ----
  const restore = (s: { doc: Doc; sel: [Pos, Pos] | null }) => { doc.paras = s.doc.paras.map(p => ({ ...p })); doc.nextPid = Math.max(doc.nextPid, s.doc.nextPid); renderAll(); if (s.sel) setSel(s.sel[0], s.sel[1]); touch(); };
  const undo = () => { const s = undoS.pop(); if (!s || busy) return; redoS.push({ doc: snapshot(doc), sel: selPair() }); restore(s); };
  const redo = () => { const s = redoS.pop(); if (!s || busy) return; undoS.push({ doc: snapshot(doc), sel: selPair() }); restore(s); };

  // ---- the Pencil: the page is one unit, and a mark's element is the paragraph under it ----
  const underBox = (r: Box) => { const w = wrap.getBoundingClientRect(), out: { tag: string; label: string; text: string }[] = []; let n = 0;
    doc.paras.forEach(p => { if (p.nested) return; n++; const el = els.get(p.pid); if (!el || out.length >= 3) return; const b = el.getBoundingClientRect(), x = b.left - w.left, y = b.top - w.top; if (x < r.x + r.w + 2 && x + b.width > r.x - 2 && y < r.y + r.h + 2 && y + b.height > r.y - 2) out.push({ tag: "p", label: `¶ ${n}`, text: (p.prot ? p.plain : ptext(p)).replace(/\s+/g, " ").trim().slice(0, 80) }); });
    return out; };
  const scroller = () => host.closest<HTMLElement>(".zscroll");
  return {
    hostSpec: () => ({ el: wrap, unit: () => 1, size: () => ({ w: wrap.offsetWidth, h: wrap.offsetHeight }) }),
    reload: async b => { await flushQuiet(); const sc = scroller(), top = sc?.scrollTop || 0; await load(b); if (sc) sc.scrollTop = top; deps.changed(); },
    rebase: async b => {   // the newest file from another device: the unsaved changes are reapplied to it, and the paragraphs that could not be are returned
      clearTimeout(timer); const was = base, mine = doc.paras.map(p => ({ ...p, orig: fileIdx.get(p.pid) ?? null })), dirty = diffOps(was, mine).length > 0, sel = selPair(), sc = scroller(), top = sc?.scrollTop || 0;
      await load(b); const r = rebaseParas(was, mine, doc); doc.paras = r.paras; renderAll(); if (sc) sc.scrollTop = top; if (sel && doc.paras[sel[0].i] && doc.paras[sel[1].i]) setSel(sel[0], sel[1]);
      if (dirty) touch(); deps.changed(); return r.lost;
    },
    destroy: () => { gone = true; clearTimeout(timer); clearTimeout(pinT); document.removeEventListener("selectionchange", onSelChange); for (const u of hold.urls) URL.revokeObjectURL(u); wrap.remove(); },
    flush, setBusy: on => { busy = on; body.contentEditable = on ? "false" : "true"; if (on) { void flush(); getSelection()?.removeAllRanges(); } },
    canUndo: () => undoS.length > 0, canRedo: () => redoS.length > 0, undo, redo,
    clearSel: () => { const s = getSel(); if (!s) return false; getSelection()!.removeAllRanges(); lastPin = ""; return true; },
    shot: async () => null, under: (_u, r) => underBox(r), wheel: (dx, dy) => scroller()?.scrollBy(dx, dy),
    test: () => ({ doc, base, fileIdx, ops: () => diffOps(base, doc.paras.map(p => ({ ...p, orig: fileIdx.get(p.pid) ?? null }))), rev, els, body, wrap, getSel, setSel, parsed: P }),
  };
  async function flushQuiet() { /* a newer version replaces the text: edits not saved by now are given up, the way a failed save is */ clearTimeout(timer); }
}
