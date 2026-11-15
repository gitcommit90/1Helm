// The Pencil in the Zone: numbered marks on any file the Zone opens (a generated image, an HTML deck, a web page, a Word document or a PDF report).
//
// With the Pencil on, a click makes a dot mark and a click and drag makes a box (a rectangle, not a freehand line). On release the mark gets the next number
// and its own colour, and a small note box opens beside its badge. The note is optional; the next click or drag closes the box and stacks mark 2 after mark 1.
// Each mark also has a card above the composer (the number, the colour, the note to edit, and a button that removes the mark and renumbers the rest).
//
// Where a mark is kept: in the file's own space, so a zoom, a window resize or a scroll never moves it. A "unit" is the thing a mark sits on: the image (1), a
// slide of a deck (1920 by 1080 pixels), a page of a document or report (PDF points), or the web page (its CSS pixels from its top left, scrolled or not).
// zone.ts gives each drawn unit to annHost() with a function that returns its size and, for a scrolled web page, the part of it that is on screen.
// The badges and boxes are plain elements placed by percent, so they keep their size; nothing from a file is ever put into the page as HTML.
//
// Sending: a screenshot of what the person was looking at is made with the marks and numbered badges drawn on it (a picture is its own pixels, a PDF page is
// its canvas, a deck slide and a web page come from the frame's own render through the bridge, zone-bridge.ts) and uploaded as a task file. The message carries
// { source, marked, marks: [{ n, color, note, kind, unit, x, y, w, h, pct, el }], zone: { kind, name, of, units } } (1HC src/zone-marks.js reads it).
export type El = { slot?: string; n?: number; sel?: string; tag: string; text: string; label?: string };
export type Mark = { n: number; color: string; note: string; kind: "point" | "box"; unit: number; x: number; y: number; w: number; h: number; sw: number; sh: number; el?: El[]; elp?: Promise<void> };
export type View = { ox: number; oy: number; w: number; h: number };   // the part of a unit that is on screen (a scrolled web page); a whole unit when there is none
export type Shot = { canvas: CanvasImageSource & { width: number; height: number }; x: number; y: number; w: number; h: number };   // a picture of the part x, y, w, h of a unit
export type HostSpec = { el: HTMLElement; unit: () => number; size: () => { w: number; h: number }; view?: () => View };
export type AnnDeps = {
  kind: string;   // image, deck, page, report or doc
  url?: string;   // the image file (an image only)
  name: string;
  source: string;   // the file's id
  count: () => number;   // how many slides or pages the file has (0 for a picture or a web page)
  upload: (blob: Blob, name: string) => Promise<{ id: string; [k: string]: any }>;   // a task file through the app's upload path (v3.ts)
  loaded?: () => void; failed?: (msg: string) => void;
  changed: () => void;   // the Pencil or the marks changed: the header repaints
  note: (title: string, sub: string) => void;
  busy: () => boolean;   // the helper is changing the file: no marks now
  early?: boolean;   // the screenshot of a unit is taken when its first mark is made (a deck: the slide may be gone by the time of the send)
  shot?: (unit: number, band: { y: number; h: number; x?: number; w?: number } | null) => Promise<Shot | null>;
  under?: (unit: number, r: { x: number; y: number; w: number; h: number }) => Promise<El[]>;   // the elements under a point or a box (an HTML file)
  wheel?: (dx: number, dy: number) => void;   // the wheel over a web page while the Pencil is on: scroll the page
};
export type AnnMarkOut = { n: number; color: string; note: string; kind: "point" | "box"; unit: number; x: number; y: number; w: number; h: number; pct: { x: number; y: number; w: number; h: number }; el?: El[] };
export type AnnSend = { annotations: { source: string; marked: string; marks: AnnMarkOut[]; zone: { kind: string; name: string; of: number | null; units: { unit: number; w: number; h: number }[] } }; file: { id: string; [k: string]: any } };

// Eight colours that read on a white or a dark card and keep white badge numbers readable. A mark's colour follows its number (removing mark 1 makes the old 2 the new 1).
export const PALETTE = ["#d6293e", "#2563eb", "#15803d", "#c2570c", "#7c3aed", "#be185d", "#0e7490", "#4d7c0f"];
const MAX_MARKS = 20, MAX_UNITS = 4, MAX_OUT = 2048, NOTE_MAX = 300, DRAG_MIN = 7;
const colorOf = (n: number) => PALETTE[(n - 1) % PALETTE.length];
const esc = (s: any) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const X = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
type Host = { key: string; spec: HostSpec; layer: HTMLElement };
type Live = { h: Host; id: number; x0: number; y0: number; x1: number; y1: number; cx0: number; cy0: number; cx: number; cy: number };

const A = {
  d: null as AnnDeps | null, marks: [] as Mark[], on: false, nw: 0, nh: 0, img: null as HTMLImageElement | null, pop: null as Mark | null, popEl: null as HTMLElement | null,
  hosts: new Map<string, Host>(), live: null as Live | null, sending: false, gen: 0, redo: [] as Mark[], typed: null as HTMLElement | null, shots: new Map<number, Promise<Shot | null>>(),
};
const q = <T extends HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s);
const r1 = (v: number) => Math.round(v * 10) / 10, r2 = (v: number) => Math.round(v * 100) / 100;

export const annHas = () => A.marks.length > 0;
export const annOn = () => A.on;
export const annCount = () => A.marks.length;

// ---------- opening, hosts, closing ----------
/** A file other than a picture: the Zone starts the Pencil, then gives each drawn unit to annHost(). */
export function annStart(d: AnnDeps) {
  annClose(); A.d = d; popEl();
}
/** A generated image: the image is drawn here, fitted to the canvas, and its own unit is host "img". */
export function annOpen(host: HTMLElement, d: AnnDeps) {
  annStart(d);
  const w = document.createElement("div"); w.className = "zimgw";
  w.innerHTML = `<img class="zimg" alt="" draggable="false">`;
  host.innerHTML = ""; host.appendChild(w);
  const img = q<HTMLImageElement>(".zimg", w)!; A.img = img;
  img.onload = () => { A.nw = img.naturalWidth || 1; A.nh = img.naturalHeight || 1; w.style.aspectRatio = `${A.nw} / ${A.nh}`; w.dataset.ready = "1"; d.loaded?.(); paint(); };
  img.onerror = () => d.failed?.("The image couldn't be opened.");
  img.src = d.url!;
  annHost("img", { el: w, unit: () => 1, size: () => ({ w: A.nw, h: A.nh }) });
}
export function annHost(key: string, spec: HostSpec) {
  const old = A.hosts.get(key); if (old && old.spec.el === spec.el) { old.spec = spec; paint(); return; }
  old?.layer.remove();
  let layer = spec.el.querySelector<HTMLElement>(":scope > .zann-layer");
  if (!layer) { layer = document.createElement("div"); layer.className = "zann-layer"; layer.innerHTML = `<div class="zann-boxes"></div><div class="zann-hit" data-zann-hit></div><div class="zann-pins"></div><div class="zann-live" hidden></div>`; spec.el.appendChild(layer); }
  const h: Host = { key, spec, layer }; A.hosts.set(key, h); wire(h); paint();
}
export function annUnhost(key?: string) {
  for (const [k, h] of [...A.hosts]) if (!key || k === key) { h.layer.remove(); A.hosts.delete(k); }
}
export function annClose() {
  A.gen++; annUnhost(); A.d = null; A.marks = []; A.redo = []; A.on = false; A.pop = null; A.live = null; A.img = null; A.nw = A.nh = 0; A.shots.clear(); A.sending = false;
  A.popEl?.remove(); A.popEl = null; document.documentElement.classList.remove("zann-on");
  q("#ann-box")?.remove(); q("#send")?.classList.remove("ann-hl");
}
/** The file changed under the marks (a new version): they no longer point at what they did. */
export function annClear() {
  A.gen++;   // a marked send that fails now can't put its marks back: the file changed
  if (!A.marks.length && !A.redo.length) return;
  A.marks = []; A.redo = []; A.shots.clear(); closePop(); paint(); cards(); A.d?.changed();
}
// The size the image is shown at: it fits the canvas (less its padding) at zoom 1.
export function annFit(cv: HTMLElement, pad: number, zoom: number): { w: number; h: number; s: number } | null {
  const wrap = A.hosts.get("img")?.spec.el; if (!wrap || !A.nw) return null;
  const W = Math.max(40, cv.clientWidth - pad * 2), H = Math.max(40, cv.clientHeight - pad * 2), s = Math.min(W / A.nw, H / A.nh) * zoom;
  const w = Math.max(20, Math.round(A.nw * s)), h = Math.max(20, Math.round(A.nh * s)); wrap.style.width = w + "px"; wrap.style.height = h + "px";
  placePop(); return { w, h, s };
}
export function annSetPencil(on: boolean) {
  if (!A.d) return; A.on = on; document.documentElement.classList.toggle("zann-on", on);
  if (!on) { closePop(); A.live = null; for (const h of A.hosts.values()) liveBox(h, null); } A.d.changed();
}
/** The units on screen moved or changed (a scroll, a slide, a resize): the marks and the note box follow. */
export function annPlace() { paint(); placePop(); }

// ---------- placing a mark ----------
const viewOf = (h: Host): View => { const s = h.spec.size(); return h.spec.view ? h.spec.view() : { ox: 0, oy: 0, w: s.w, h: s.h }; };
const at = (h: Host, cx: number, cy: number): [number, number] => {
  const s = h.spec.size(), v = viewOf(h), r = h.layer.getBoundingClientRect();
  return [Math.max(0, Math.min(s.w, v.ox + (cx - r.left) / Math.max(1, r.width) * v.w)), Math.max(0, Math.min(s.h, v.oy + (cy - r.top) / Math.max(1, r.height) * v.h))];
};
function wire(h: Host) {
  const hit = q<HTMLElement>("[data-zann-hit]", h.layer)!, layer = h.layer;
  hit.addEventListener("pointerdown", e => {
    if (!A.on || A.sending || A.d?.busy() || !h.spec.size().w || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault(); closePop();
    if (A.marks.length >= MAX_MARKS) { A.d?.note("That's the most marks", `Send these ${MAX_MARKS}, then mark more.`); return; }
    try { hit.setPointerCapture(e.pointerId); } catch { /* the pointer is gone */ }
    const [x, y] = at(h, e.clientX, e.clientY); A.live = { h, id: e.pointerId, x0: x, y0: y, x1: x, y1: y, cx0: e.clientX, cy0: e.clientY, cx: e.clientX, cy: e.clientY };
  });
  hit.addEventListener("pointermove", e => {
    const l = A.live; if (!l || l.h !== h || e.pointerId !== l.id) return; e.preventDefault();
    l.cx = e.clientX; l.cy = e.clientY; [l.x1, l.y1] = at(h, e.clientX, e.clientY);
    liveBox(h, Math.hypot(l.cx - l.cx0, l.cy - l.cy0) >= DRAG_MIN ? l : null);
  });
  const end = (e: PointerEvent, cancel: boolean) => {
    const l = A.live; if (!l || l.h !== h || e.pointerId !== l.id) return; A.live = null; liveBox(h, null); try { hit.releasePointerCapture(e.pointerId); } catch { /* released already */ }
    if (cancel) return;
    const drag = Math.hypot(e.clientX - l.cx0, e.clientY - l.cy0) >= DRAG_MIN;
    if (!drag) { addMark(h, "point", l.x0, l.y0, 0, 0); return; }
    const [x1, y1] = at(h, e.clientX, e.clientY), x = Math.min(l.x0, x1), y = Math.min(l.y0, y1);
    addMark(h, "box", x, y, Math.abs(x1 - l.x0), Math.abs(y1 - l.y0));
  };
  hit.addEventListener("pointerup", e => end(e, false)); hit.addEventListener("pointercancel", e => end(e, true));
  hit.addEventListener("contextmenu", e => e.preventDefault());
  // With the Pencil on the file underneath never sees a click (no selecting, no editing); the wheel still scrolls a web page.
  for (const t of ["click", "dblclick", "mousedown", "pointermove"]) hit.addEventListener(t, e => { if (A.on) e.stopPropagation(); });
  hit.addEventListener("wheel", e => { if (A.on && A.d?.wheel) { e.preventDefault(); A.d.wheel(e.deltaX, e.deltaY); } }, { passive: false });
  layer.addEventListener("click", e => { const b = (e.target as HTMLElement).closest<HTMLElement>("[data-zann-pin]"); if (!b) return; e.stopPropagation(); const m = A.marks[+b.dataset.zannPin! - 1]; if (m) openPop(m); });
}
function liveBox(h: Host, l: Live | null) {
  const el = q<HTMLElement>(".zann-live", h.layer); if (!el) return;
  if (!l) { el.hidden = true; return; }
  const s = h.spec.size(), v = viewOf(h), x = Math.min(l.x0, l.x1), y = Math.min(l.y0, l.y1), w = Math.abs(l.x1 - l.x0), hh = Math.abs(l.y1 - l.y0);
  el.hidden = false; el.style.cssText = `left:${(x - v.ox) / v.w * 100}%;top:${(y - v.oy) / v.h * 100}%;width:${w / v.w * 100}%;height:${hh / v.h * 100}%;--c:${colorOf(A.marks.length + 1)}`; void s;
}
function makeMark(h: Host, kind: "point" | "box", x: number, y: number, w: number, hh: number): Mark {
  const n = A.marks.length + 1, s = h.spec.size();
  return { n, color: colorOf(n), note: "", kind, unit: h.spec.unit(), x, y, w, h: hh, sw: s.w, sh: s.h };
}
function addMark(h: Host, kind: "point" | "box", x: number, y: number, w: number, hh: number) {
  const unit = h.spec.unit();
  if (!A.marks.some(m => m.unit === unit) && new Set(A.marks.map(m => m.unit)).size >= MAX_UNITS) { A.d?.note(`That's the most ${A.d.kind === "deck" ? "slides" : A.d.kind === "sheet" ? "sheets" : "pages"}`, `Send these marks, then mark more.`); return; }
  push(makeMark(h, kind, x, y, w, hh));
}
function push(m: Mark, keepEl = false) {
  A.marks.push(m); A.typed = null;
  const d = A.d!;
  if (d.early && !A.shots.has(m.unit) && d.shot) A.shots.set(m.unit, d.shot(m.unit, null).catch(() => null));
  if (!keepEl && d.under) m.elp = d.under(m.unit, { x: m.x, y: m.y, w: m.w, h: m.h }).then(els => { m.el = els; }).catch(() => {});
  paint(); cards(); openPop(m); d.changed();
}
function removeMark(n: number) {
  const m = A.marks[n - 1]; if (!m) return; if (A.pop === m) closePop();
  A.marks.splice(n - 1, 1); A.typed = null; A.marks.forEach((x, i) => { x.n = i + 1; x.color = colorOf(x.n); });
  paint(); cards(); A.d?.changed(); if (A.pop) placePop();
}
export function annRemove(n: number) { removeMark(n); }
// Undo (Cmd or Ctrl Z) takes off the newest mark, again and again; redo (Cmd Shift Z or Ctrl Y) puts it back. In a field that has text typed since the last mark, the browser's own undo goes first.
export function annUndo(): boolean { const m = A.marks[A.marks.length - 1]; if (!m || A.sending) return false; A.redo.push({ ...m }); removeMark(m.n); return true; }
export function annRedo(): boolean { const m = A.redo.pop(); if (!m || A.sending || A.marks.length >= MAX_MARKS) return false; push({ ...m, n: A.marks.length + 1, color: colorOf(A.marks.length + 1) }, true); return true; }
document.addEventListener("input", e => { const t = e.target as HTMLElement | null; if (t?.matches?.("#box, #ann-box .annn, .zann-pop textarea")) A.typed = t; }, true);
document.addEventListener("keydown", e => {
  if (!A.d || !(e.metaKey || e.ctrlKey) || e.altKey) return; const k = e.key.toLowerCase(), redo = k === "y" || (k === "z" && e.shiftKey); if (k !== "z" && k !== "y") return;
  if (k === "y" && e.metaKey) return;
  if (redo ? !A.redo.length : !A.marks.length) return;
  const t = e.target as HTMLInputElement | HTMLTextAreaElement | null, field = !!t?.matches?.("input,textarea");
  if (field && A.typed === t && t!.value !== "") return;   // text typed here since the mark: the field's own undo or redo
  e.preventDefault(); e.stopPropagation(); if (redo) annRedo(); else annUndo();
}, true);

// ---------- the marks on the file ----------
function paint() {
  for (const h of A.hosts.values()) {
    const unit = h.spec.unit(), v = viewOf(h), ms = A.marks.filter(m => m.unit === unit && (!h.spec.view || (m.x + m.w >= v.ox - 24 && m.x <= v.ox + v.w + 24 && m.y + m.h >= v.oy - 24 && m.y <= v.oy + v.h + 24)));   // a scrolled web page shows only the marks that are on screen
    const sig = `${ms.map(m => `${m.n}|${m.color}|${m.kind}|${m.x}|${m.y}|${m.w}|${m.h}|${m.note}`).join(";")}#${v.ox}|${v.oy}|${v.w}|${v.h}`;
    if (h.layer.dataset.sig === sig) continue; h.layer.dataset.sig = sig;
    const pct = (a: number, o: number, len: number) => ((a - o) / Math.max(1, len) * 100).toFixed(3);
    q<HTMLElement>(".zann-boxes", h.layer)!.innerHTML = ms.filter(m => m.kind === "box").map(m => `<i class="zann-box" style="left:${pct(m.x, v.ox, v.w)}%;top:${pct(m.y, v.oy, v.h)}%;width:${(m.w / Math.max(1, v.w) * 100).toFixed(3)}%;height:${(m.h / Math.max(1, v.h) * 100).toFixed(3)}%;--c:${m.color}"></i>`).join("");
    q<HTMLElement>(".zann-pins", h.layer)!.innerHTML = ms.map(m => {
      const dot = m.kind === "point";
      return `<div class="zann-m" style="left:${pct(m.x, v.ox, v.w)}%;top:${pct(m.y, v.oy, v.h)}%;--c:${m.color}">${dot ? '<i class="zann-ring"></i>' : ""}<button type="button" class="zann-b${dot ? " off" : ""}" data-zann-pin="${m.n}" aria-label="Mark ${m.n}${m.note ? ": " + esc(m.note) : ""}">${m.n}</button></div>`;
    }).join("");
  }
}

// ---------- the note box on the file ----------
const grow = (t: HTMLTextAreaElement) => { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 96) + "px"; };
// One note box, in the canvas' overlay (above the frames and the pages, so a page's own clipping never cuts it).
function popEl(): HTMLElement | null {
  if (A.popEl?.isConnected) return A.popEl; const host = q<HTMLElement>("#zcanvas .zovl"); if (!host) return null;
  const box = document.createElement("div"); box.className = "zann-pop"; box.hidden = true; box.innerHTML = `<textarea rows="1" maxlength="${NOTE_MAX}" aria-label="Note for this mark" autocomplete="off" enterkeyhint="done"></textarea>`; host.appendChild(box); A.popEl = box;
  const ta = q<HTMLTextAreaElement>("textarea", box)!;
  ta.addEventListener("input", () => { const m = A.pop; if (!m) return; m.note = ta.value; grow(ta); const c = q<HTMLInputElement>(`#ann-box [data-ann-n="${m.n}"]`); if (c && c !== document.activeElement) c.value = m.note; paint(); });
  ta.addEventListener("keydown", e => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closePop(); return; }
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); e.stopPropagation(); closePop(); focusComposer(); }
  });
  return box;
}
function openPop(m: Mark) {
  const box = popEl(); if (!box) return; const ta = q<HTMLTextAreaElement>("textarea", box)!;
  A.pop = m; ta.value = m.note; box.style.setProperty("--c", m.color); box.hidden = false; placePop(); grow(ta); placePop();
  try { ta.focus({ preventScroll: true }); const e = ta.value.length; ta.setSelectionRange(e, e); } catch { /* not focusable yet */ }
}
function closePop() {
  A.pop = null; const box = A.popEl; if (!box || box.hidden) return; box.hidden = true; const ta = q<HTMLTextAreaElement>("textarea", box); if (ta && document.activeElement === ta) ta.blur();
}
const hostOf = (m: Mark) => [...A.hosts.values()].find(h => h.layer.isConnected && h.spec.unit() === m.unit && h.spec.el.getClientRects().length > 0);
// Next to the badge, on the side with room; kept inside the canvas.
function placePop() {
  const m = A.pop, box = A.popEl; if (!m || !box || box.hidden) return;
  const h = hostOf(m); if (!h) { box.style.visibility = "hidden"; return; } box.style.visibility = "";
  const ov = (box.parentElement as HTMLElement).getBoundingClientRect(), r = h.layer.getBoundingClientRect(), v = viewOf(h);
  const ax = r.left - ov.left + r.width * (m.x - v.ox) / Math.max(1, v.w), ay = r.top - ov.top + r.height * (m.y - v.oy) / Math.max(1, v.h);
  const bw = box.offsetWidth || 220, bh = box.offsetHeight || 40, gap = 18, edge = 6;
  const minL = edge, maxL = ov.width - edge - bw, minT = edge, maxT = ov.height - edge - bh;
  const go = m.kind === "point" ? 28 : 8; let x = ax + gap + go, y = ay - bh / 2;
  if (x > maxL) x = ax - gap - bw - (m.kind === "point" ? 6 : 0);
  if (x < minL || x > maxL) { x = Math.max(minL, Math.min(maxL, ax - bw / 2)); y = ay + gap; if (y > maxT) y = ay - gap - bh; }
  box.style.left = Math.round(Math.max(minL, Math.min(Math.max(minL, maxL), x))) + "px"; box.style.top = Math.round(Math.max(minT, Math.min(Math.max(minT, maxT), y))) + "px";
}

// ---------- the cards above the composer ----------
function slot(): HTMLElement | null {
  if (!A.marks.length) { q("#ann-box")?.remove(); q("#send")?.classList.remove("ann-hl"); return null; }
  const form = q("#send"); if (!form?.parentElement) return null; form.classList.add("ann-hl");
  let el = q<HTMLElement>("#ann-box"); if (el && el.nextElementSibling === form) return el;
  el?.remove(); el = document.createElement("div"); el.id = "ann-box"; el.className = "annbar"; el.setAttribute("role", "group"); el.setAttribute("aria-label", "Marks on the file");
  form.parentElement.insertBefore(el, form); return el;
}
function cards() {
  const el = slot(); if (!el) return;
  const keep = document.activeElement instanceof HTMLInputElement && el.contains(document.activeElement) ? document.activeElement.dataset.annN : "";
  el.innerHTML = A.marks.map(m => `<div class="anncard" style="--c:${m.color}"><span class="annb">${m.n}</span><input class="annn" data-ann-n="${m.n}" maxlength="${NOTE_MAX}" value="${esc(m.note)}" aria-label="Note for mark ${m.n}" autocomplete="off"><button type="button" class="annx" data-ann-x="${m.n}" aria-label="Remove mark ${m.n}" title="Remove mark ${m.n}">${X}</button></div>`).join("");
  if (keep) q<HTMLInputElement>(`[data-ann-n="${keep}"]`, el)?.focus();
  el.scrollTop = el.scrollHeight;
}
// The composer is drawn again when the task view repaints: the cards and the highlight come back.
export function annEnsure() { if (A.marks.length && (!q("#ann-box") || !q("#send")?.classList.contains("ann-hl"))) cards(); }
export function focusComposer() { const b = document.getElementById("box") as HTMLTextAreaElement | null; if (!b) return; try { b.focus({ preventScroll: true }); } catch { b.focus(); } }
document.addEventListener("input", e => { const t = e.target as HTMLInputElement; if (!t?.matches?.("#ann-box .annn")) return; const m = A.marks[+t.dataset.annN! - 1]; if (!m) return; m.note = t.value; paint(); if (A.pop === m) { const ta = q<HTMLTextAreaElement>("textarea", A.popEl!); if (ta) ta.value = t.value; } });
document.addEventListener("click", e => {
  const t = (e.target as HTMLElement | null)?.closest?.<HTMLElement>("#ann-box [data-ann-x]"); if (!t) return;
  e.preventDefault(); removeMark(+t.dataset.annX!); focusComposer();
});
document.addEventListener("keydown", e => {
  const t = e.target as HTMLElement | null; if (!t?.matches?.("#ann-box .annn")) return;
  if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); e.stopPropagation(); focusComposer(); }
  else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); focusComposer(); }
}, true);

// ---------- the picture that is sent ----------
// One piece for each slide or page that has marks (at most four), stacked: the screenshot of that unit at its own size (at most MAX_OUT pixels on the long side)
// with each box, dot and numbered badge drawn on it. A PNG, unless that is over ANN_MAX_BYTES: then a JPEG at 0.9 on white, and if that is still over, the same at
// a smaller size, so the server never has to fall back to a smaller view of it (its reference limit is 6 MB).
export const ANN_MAX_BYTES = 5.5 * 1024 * 1024;
const SIZES = [MAX_OUT, 1600, 1280, 1024, 768];
const BADGE = 22, RING = 18, OFF = 13;   // screen pixels, scaled to the picture
type Piece = { unit: number; shot: Shot | null; region: { x: number; y: number; w: number; h: number }; marks: Mark[] };
function drawPiece(p: Piece, maxOut: number): HTMLCanvasElement {
  const R = p.region, bw = p.shot ? Math.max(1, Number((p.shot.canvas as any).naturalWidth || p.shot.canvas.width) || 1) : 0;
  const r = Math.min(bw ? bw / Math.max(1, p.shot!.w) : 1, maxOut / Math.max(R.w, R.h)), W = Math.max(1, Math.round(R.w * r)), H = Math.max(1, Math.round(R.h * r));
  const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d"); if (!g) throw new Error("This browser can't draw the marks.");
  g.fillStyle = "#f4f3ef"; g.fillRect(0, 0, W, H);
  if (p.shot) { const S = p.shot; g.drawImage(S.canvas, 0, 0, Math.max(1, Number((S.canvas as any).naturalWidth || S.canvas.width)), Math.max(1, Number((S.canvas as any).naturalHeight || S.canvas.height)), (S.x - R.x) * r, (S.y - R.y) * r, S.w * r, S.h * r); }
  const u = Math.max(0.8, Math.max(W, H) / 900);   // the on-screen sizes, scaled to the picture
  g.lineCap = "round"; g.lineJoin = "round";
  const px = (m: Mark): [number, number] => [(m.x - R.x) * r, (m.y - R.y) * r];
  for (const m of p.marks) if (m.kind === "box") {
    const [x, y] = px(m), w = m.w * r, h = m.h * r;
    g.fillStyle = m.color + "22"; g.fillRect(x, y, w, h);
    g.strokeStyle = "rgba(255,255,255,.9)"; g.lineWidth = 5.5 * u; g.strokeRect(x, y, w, h); g.strokeStyle = m.color; g.lineWidth = 3 * u; g.strokeRect(x, y, w, h);
  }
  for (const m of p.marks) {
    let [x, y] = px(m);
    if (m.kind === "point") { g.beginPath(); g.arc(x, y, RING / 2 * u, 0, Math.PI * 2); g.strokeStyle = "rgba(255,255,255,.9)"; g.lineWidth = 5.5 * u; g.stroke(); g.strokeStyle = m.color; g.lineWidth = 3 * u; g.stroke(); x += OFF * u; y -= OFF * u; }
    x = Math.max(BADGE / 2 * u, Math.min(W - BADGE / 2 * u, x)); y = Math.max(BADGE / 2 * u, Math.min(H - BADGE / 2 * u, y));
    g.beginPath(); g.arc(x, y, BADGE / 2 * u, 0, Math.PI * 2); g.fillStyle = m.color; g.fill(); g.lineWidth = 2 * u; g.strokeStyle = "#fff"; g.stroke();
    g.fillStyle = "#fff"; g.font = `700 ${12.5 * u}px system-ui,-apple-system,"Segoe UI",sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(m.n), x, y + 0.5 * u);
  }
  return c;
}
function drawAll(pieces: Piece[], maxOut: number): HTMLCanvasElement {
  const each = pieces.length === 1 ? maxOut : Math.round(maxOut / 1.5), cs = pieces.map(p => drawPiece(p, each));
  if (cs.length === 1) return cs[0];
  const gap = 14, W = Math.max(...cs.map(c => c.width)), H = cs.reduce((a, c) => a + c.height, 0) + gap * (cs.length - 1);
  const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d")!; g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
  let y = 0; for (const x of cs) { g.drawImage(x, 0, y); y += x.height + gap; }
  return c;
}
const toBlob = (c: HTMLCanvasElement, type: string, qual?: number) => new Promise<Blob | null>(ok => c.toBlob(b => ok(b), type, qual));
async function annRender(pieces: Piece[]): Promise<Blob> {
  let last: Blob | null = null;
  for (const size of SIZES) {
    const c = drawAll(pieces, size), png = await toBlob(c, "image/png"); if (!png) throw new Error("The marked picture couldn't be made.");
    if (png.size <= ANN_MAX_BYTES) return png;
    const w = document.createElement("canvas"); w.width = c.width; w.height = c.height; const g = w.getContext("2d"); if (g) { g.fillStyle = "#fff"; g.fillRect(0, 0, w.width, w.height); g.drawImage(c, 0, 0); }
    const jpg = await toBlob(w, "image/jpeg", 0.9); if (jpg) { last = jpg; if (jpg.size <= ANN_MAX_BYTES) return jpg; }
  }
  if (!last) throw new Error("The marked picture couldn't be made.");
  return last;
}
// What the person was looking at, for each unit with marks. A screenshot that can't be made leaves a plain background: the marks and their numbers are still drawn,
// and the message still carries every coordinate and element.
async function pieces(marks: Mark[], shots: Map<number, Promise<Shot | null>>, d: AnnDeps): Promise<Piece[]> {
  const units = [...new Set(marks.map(m => m.unit))].sort((a, b) => a - b), out: Piece[] = [];
  for (const unit of units) {
    const ms = marks.filter(m => m.unit === unit), sw = ms[0].sw, sh = ms[0].sh; let region = { x: 0, y: 0, w: sw, h: sh }, shot: Shot | null = null;
    try {
      if (A.img) shot = { canvas: A.img as any, x: 0, y: 0, w: A.nw, h: A.nh };
      else if (shots.has(unit)) shot = await shots.get(unit)!;
      else if (d.kind === "page" || d.kind === "sheet") {   // the band of the page (or the part of a sheet) that holds the marks, at least one screen tall
        const host = [...A.hosts.values()][0], vh = host ? viewOf(host).h : sh, y0 = Math.max(0, Math.min(...ms.map(m => m.y)) - 60), y1 = Math.min(sh, Math.max(...ms.map(m => m.y + m.h)) + 60);
        let top = y0, hgt = Math.max(y1 - y0, Math.min(vh, sh)); if (hgt > vh * 3) hgt = vh * 3; if (top + hgt > sh) top = Math.max(0, sh - hgt);
        if (d.kind === "sheet") {   // a sheet is wide as well as tall: the same rule across
          const vw = host ? viewOf(host).w : sw, x0 = Math.max(0, Math.min(...ms.map(m => m.x)) - 60), x1 = Math.min(sw, Math.max(...ms.map(m => m.x + m.w)) + 60);
          let left = x0, wid = Math.max(x1 - x0, Math.min(vw, sw)); if (wid > vw * 3) wid = vw * 3; if (left + wid > sw) left = Math.max(0, sw - wid);
          shot = await d.shot!(unit, { y: top, h: hgt, x: left, w: wid });
        } else shot = await d.shot!(unit, { y: top, h: hgt });
      } else shot = await d.shot!(unit, null);
    } catch { shot = null; }
    if (shot) region = { x: shot.x, y: shot.y, w: shot.w, h: shot.h };
    else if (d.kind === "page" || d.kind === "sheet") { const y0 = Math.max(0, Math.min(...ms.map(m => m.y)) - 60), y1 = Math.min(sh, Math.max(...ms.map(m => m.y + m.h)) + 60), x0 = d.kind === "sheet" ? Math.max(0, Math.min(...ms.map(m => m.x)) - 60) : 0, x1 = d.kind === "sheet" ? Math.min(sw, Math.max(...ms.map(m => m.x + m.w)) + 60) : sw; region = { x: x0, y: y0, w: Math.max(60, x1 - x0), h: Math.max(60, y1 - y0) }; }
    out.push({ unit, shot, region, marks: ms });
  }
  return out;
}
// Sending, in two steps so the message can show at once. annBegin() takes the marks out of the file and the composer on the spot and gives back what the message
// shows right away (each mark's number and note) and run(), which makes the picture, uploads it and gives the app what goes in the message. When run() gives
// nothing (a failure), restore() puts every mark back.
export type AnnBegin = { rows: { n: number; color: string; note: string }[]; ar: number; run: () => Promise<AnnSend | null>; restore: () => void; local: () => string };
export function annBegin(): AnnBegin | null {
  const d = A.d; if (!d || !A.marks.length || A.sending) return null; A.sending = true; closePop();
  const gen = A.gen, marks = A.marks, redo = A.redo, shots = new Map(A.shots), img = A.img;
  A.marks = []; A.redo = []; A.pop = null; paint(); cards(); d.changed();
  // The shape of the picture that will be made (width over height), so the message can keep a slot of the same size before and after the picture arrives.
  const arOf = (): number => {
    const units = [...new Set(marks.map(m => m.unit))].sort((a, b) => a - b); let W = 0, H = 0;
    for (const unit of units) {
      const ms = marks.filter(m => m.unit === unit), sw = ms[0].sw, sh = ms[0].sh; let w = sw, h = sh;
      if (img) { w = A.nw; h = A.nh; }
      else if (d.kind === "page") { const host = [...A.hosts.values()][0], vh = host ? viewOf(host).h : sh, y0 = Math.max(0, Math.min(...ms.map(m => m.y)) - 60), y1 = Math.min(sh, Math.max(...ms.map(m => m.y + m.h)) + 60); h = Math.min(Math.max(y1 - y0, Math.min(vh, sh)), vh * 3, sh); }
      W = Math.max(W, w); H += h + (H ? 14 : 0);
    }
    const r = W / Math.max(1, H); return Number.isFinite(r) && r > 0 ? Math.round(r * 1000) / 1000 : 1.33;
  };
  const ar = arOf();
  let url = "";
  const rows = marks.map(m => ({ n: m.n, color: m.color, note: m.note.trim().slice(0, NOTE_MAX) }));
  const run = async (): Promise<AnnSend | null> => {
    try {
      await Promise.all(marks.map(m => m.elp));
      const blob = await annRender(await pieces(marks, shots, d)); try { url = URL.createObjectURL(blob); } catch { url = ""; }
      const base = d.name.replace(/\.[^.]+$/, "").slice(0, 80) || "file", f = await d.upload(blob, `${base}-marked.${blob.type === "image/jpeg" ? "jpg" : "png"}`);
      if (!f?.id) throw new Error("The upload didn't finish.");
      const out: AnnMarkOut[] = marks.map(m => {
        const sw = Math.max(1, m.sw), sh = Math.max(1, m.sh), o: AnnMarkOut = { n: m.n, color: m.color, note: m.note.trim().slice(0, NOTE_MAX), kind: m.kind, unit: m.unit, x: r1(m.x), y: r1(m.y), w: r1(m.w), h: r1(m.h),
          pct: { x: r2(m.x / sw * 100), y: r2(m.y / sh * 100), w: r2(m.w / sw * 100), h: r2(m.h / sh * 100) } };
        if (m.el?.length) o.el = m.el.slice(0, 4); return o;
      });
      const units = [...new Set(marks.map(m => m.unit))].sort((a, b) => a - b).map(unit => { const m = marks.find(x => x.unit === unit)!; return { unit, w: r1(m.sw), h: r1(m.sh) }; });
      const of = d.count();
      return { annotations: { source: d.source, marked: f.id, marks: out, zone: { kind: d.kind, name: d.name, of: of > 0 ? of : null, units } }, file: f };
    } catch (e: any) { d.note("Couldn't send the marks", String(e?.message || e).slice(0, 160)); return null; }
    finally { A.sending = false; }
  };
  const restore = () => {
    // Only when the same file is still open and nothing new was marked meanwhile; otherwise the marks can't go back onto a picture that is gone.
    if (A.d !== d || A.gen !== gen || A.marks.length) return;
    A.marks = marks; A.redo = redo; A.img = A.img || img; for (const [k, v] of shots) if (!A.shots.has(k)) A.shots.set(k, v);
    paint(); cards(); d.changed();
  };
  return { rows, ar, run, restore, local: () => url };
}
// The message went out: the marks were already taken out by annBegin(); this clears anything marked since and the screenshots kept for the send.
export function annDone() { A.shots.clear(); }
