// Contacts list for hundreds or thousands of people: letter sections with a sticky header, an A–Z rail (tap or drag-scrub),
// a short "knows best" shelf on top, instant search, and a windowed list (only the rows on screen plus a buffer are in the DOM).
// v3.ts hooks in: clInit() once, clList() builds the list's HTML, clMount() after it's in the page (restores scroll, wires the rail).
// VList is the windowing helper; the import preview (contacts-import.ts) uses it too.

// ---------- VList: fixed-height windowing over a scroll container ----------
// Every item has a known height (heights can differ per item, e.g. section headers vs rows). Items are absolutely positioned
// inside `box`, whose height is the sum of all items, so the scrollbar and scroll position are real. On scroll (once per frame)
// it works out the visible range from a prefix-sum table (binary search), drops rows that left the range and adds the ones that
// came in, keeping DOM order = list order (so Tab order stays sane). Untouched rows are reused, so photos and hover don't flicker.
export type VOpts = { count: number; height: (i: number) => number; html: (i: number) => string; overscan?: number; pad?: number; onPaint?: (top: number) => void };
export class VList {
  offs: Float64Array; els = new Map<number, HTMLElement>(); private raf = 0; private ro: ResizeObserver | null = null; private tpl = document.createElement("template");
  private onS = () => { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.paint(); }); };
  constructor(public sc: HTMLElement, public box: HTMLElement, public o: VOpts) {
    this.offs = new Float64Array(o.count + 1);
    for (let i = 0; i < o.count; i++) this.offs[i + 1] = this.offs[i] + o.height(i);
    box.style.height = `${this.offs[o.count]}px`;
    sc.addEventListener("scroll", this.onS, { passive: true });
    if (typeof ResizeObserver !== "undefined") { this.ro = new ResizeObserver(this.onS); this.ro.observe(sc); }
  }
  get count() { return this.o.count; }
  boxTop() { return this.box.getBoundingClientRect().top - this.sc.getBoundingClientRect().top + this.sc.scrollTop; }
  // The last item whose top is at or above y (box coordinates).
  find(y: number) { let lo = 0, hi = this.o.count - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.offs[m] <= y) lo = m; else hi = m - 1; } return Math.max(0, lo); }
  top(i: number) { return this.offs[i]; }
  private make(i: number) {
    this.tpl.innerHTML = this.o.html(i); const el = this.tpl.content.firstElementChild as HTMLElement;
    el.style.position = "absolute"; el.style.top = `${this.offs[i]}px`; el.style.height = `${this.offs[i + 1] - this.offs[i]}px`; el.dataset.vi = String(i);
    return el;
  }
  paint() {
    const n = this.o.count; if (!this.box.isConnected) return;
    const top = this.sc.scrollTop - this.boxTop(), h = this.sc.clientHeight || innerHeight, os = this.o.overscan ?? 480;
    const a = n ? this.find(Math.max(0, top - os)) : 0, b = n ? this.find(Math.max(0, top + h + os)) : -1;
    for (const [i, el] of this.els) if (i < a || i > b) { el.remove(); this.els.delete(i); }
    let prev: HTMLElement | null = null;
    for (let i = a; i <= b; i++) {
      let el = this.els.get(i);
      if (!el) { el = this.make(i); this.els.set(i, el); if (prev) prev.after(el); else { const first = [...this.els.entries()].filter(([k]) => k > i).sort((x, y) => x[0] - y[0])[0]; first ? first[1].before(el) : this.box.appendChild(el); } }
      prev = el;
    }
    this.o.onPaint?.(top);
  }
  refresh(i: number) { const el = this.els.get(i); if (!el) return; const nu = this.make(i); el.replaceWith(nu); this.els.set(i, nu); }
  scrollTo(i: number, align: "start" | "nearest" = "nearest") {
    if (i < 0 || i >= this.o.count) return;
    const pad = this.o.pad || 0, bt = this.boxTop(), y = bt + this.offs[i], y2 = bt + this.offs[i + 1], st = this.sc.scrollTop, ch = this.sc.clientHeight;
    if (align === "start") this.sc.scrollTop = y;
    else if (y < st + pad) this.sc.scrollTop = y - pad;
    else if (y2 > st + ch) this.sc.scrollTop = y2 - ch;
    this.paint();
  }
  // Also takes its rows out of the box: a new VList on the same box would otherwise paint its rows over the old ones
  // (the merge picker's "stacked names" bug, 2026-10-06).
  destroy() { this.sc.removeEventListener("scroll", this.onS); this.ro?.disconnect(); if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; for (const el of this.els.values()) el.remove(); this.els.clear(); }
}

// ---------- the Contacts list ----------
export type CLContact = { id: number; name: string; rel: string; aka: string[]; phone?: string; email?: string; phones?: { v: string }[]; emails?: { v: string }[]; group: string; color: string; photo?: string; fresh?: boolean; from: string;
  facts: { src: string; at: number; fresh?: boolean }[]; seen: unknown[] };
type Deps = { av: (c: CLContact, cls?: string) => string; href: (c: CLContact) => string; helper: () => string; phone: () => boolean; sel: () => number; go: (c: CLContact) => void; repaint: () => void };
type Item = { h: string } | { c: CLContact };

const AZ = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "#"];
const HH = 32;                                   // section header height
const rowH = () => D?.phone() ? 62 : 56;
const esc = (s: any = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const coll = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
const PREFIX = /^(dr|mr|mrs|ms|mx|prof|rev)\.?\s+/i, SUFFIX = /^(jr|sr|ii|iii|iv|md|phd|dds|esq|cpa|rn)\.?$/i;
const digits = (s: string) => s.replace(/\D+/g, "");
const sub = (c: CLContact) => c.rel && c.rel !== "Contact" ? c.rel : c.phone || c.email || "";
const FAMILY = /\b(spouse|wife|husband|partner|mother|mom|mum|father|dad|parent|child|son|daughter|kid|brother|sister|sibling|grand\w*|aunt|uncle|cousin|niece|nephew|in-law|fianc\w*|boss|girlfriend|boyfriend)\b/i;

let D: Deps | null = null;
const CL = {
  sort: (() => { try { return localStorage.getItem("1hc-ct-sort") === "last" ? "last" : "first"; } catch { return "first"; } })() as "first" | "last",
  items: [] as Item[], heads: [] as { i: number; L: string }[], count: 0, q: "", key: "", mountedKey: "", top: 0, sel: 0, refocus: "" as "" | "q" | "row",
  vl: null as VList | null, cur: "", rail: false,
};
// Sort keys are cached per contact and rebuilt only when the name changes.
const KEYS = new WeakMap<CLContact, { n: string; first: string; last: string; lf: string }>();
function keys(c: CLContact) {
  let k = KEYS.get(c); if (k && k.n === c.name) return k;
  const clean = fold(c.name).replace(/\(.*?\)/g, " ").replace(PREFIX, "").replace(/\s+/g, " ").trim() || c.name;
  const w = clean.split(/[\s,]+/).filter(Boolean); while (w.length > 1 && SUFFIX.test(w[w.length - 1])) w.pop();
  const last = w.length > 1 ? `${w[w.length - 1]} ${w.slice(0, -1).join(" ")}` : clean;
  k = { n: c.name, first: clean, last, lf: fold(c.name).toLowerCase() }; KEYS.set(c, k); return k;
}
const letter = (s: string) => { const ch = (s.match(/[\p{L}\p{N}]/u)?.[0] || "").toUpperCase(); return /^[A-Z]$/.test(ch) ? ch : "#"; };
const rank = (L: string) => L === "#" ? 26 : L.charCodeAt(0) - 65;

// Search: name, alias ("my boss"), relation, email, phone digits. Best matches first.
function score(c: CLContact, q: string, qd: string) {
  const n = keys(c).lf;
  if (n.startsWith(q)) return 100;
  if (n.split(/[\s\-.'()]+/).some(w => w.startsWith(q))) return 80;
  const aka = c.aka.map(a => fold(a).toLowerCase());
  if (aka.some(a => a.startsWith(q))) return 70;
  if (n.includes(q)) return 60;
  if (aka.some(a => a.includes(q))) return 50;
  if (c.rel.toLowerCase().includes(q)) return 40;
  if ((c.emails?.length ? c.emails.map(e => e.v) : [c.email || ""]).some(e => e.toLowerCase().includes(q))) return 30;
  if (qd && (c.phones?.length ? c.phones.map(x => x.v) : [c.phone || ""]).some(x => digits(x).includes(qd))) return 30;   // every number, not only the primary
  return 0;
}
// "Knows best": people with real knowledge behind them (facts not from the import file), that came up in tasks, or are close family.
function best(c: CLContact) {
  const own = c.facts.filter(f => f.src !== "You imported"), now = Date.now();
  let s = Math.min(own.length, 5) * 3 + c.seen.length * 3;
  if (own.some(f => f.fresh)) s += 2;
  if (own.some(f => now - f.at < 30 * 864e5)) s += 2;
  if (FAMILY.test(c.rel)) s += 4;
  if (c.aka.some(a => /^my /i.test(a))) s += 3;
  if (/added/i.test(c.from)) s += 2;
  return { s, at: own.reduce((m, f) => Math.max(m, f.at || 0), 0) };
}

export function clInit(d: Deps) {
  D = d;
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement, s = t.closest<HTMLElement>("[data-clsort]"); if (!s) return;
    e.preventDefault(); e.stopPropagation(); CL.sort = s.dataset.clsort === "last" ? "last" : "first"; try { localStorage.setItem("1hc-ct-sort", CL.sort); } catch {}
    CL.top = 0; d.repaint();
  }, true);
}

// The HTML inside #cxlist (the list's own scroller): the extra top (suggestions), the shelf, the count line, the windowed box, the footer.
export function clList(all: CLContact[], o: { q: string; grp: string; top?: string; foot?: string }): string {
  const q = fold(o.q.trim()).toLowerCase(), qd = /^[\d\s()+.\-]+$/.test(q) ? digits(q).replace(/^1(?=\d{10}$)/, "") : "";
  const list = o.grp === "All" ? all : all.filter(c => c.group === o.grp);
  const items: Item[] = [], heads: { i: number; L: string }[] = [];
  let shelf = "";
  if (q) {
    const hits = list.map(c => ({ c, s: score(c, q, qd.length >= 3 ? qd : "") })).filter(x => x.s).map(x => ({ ...x, b: best(x.c).s })).sort((a, b) => b.s - a.s || b.b - a.b || coll.compare(keys(a.c).first, keys(b.c).first));   // equal matches: the people you talk about first
    for (const h of hits) items.push({ c: h.c });
  } else {
    const k = CL.sort, rows = list.map(c => { const s = keys(c)[k]; return { c, s, L: letter(s) }; })
      .sort((a, b) => rank(a.L) - rank(b.L) || coll.compare(a.s, b.s) || coll.compare(a.c.name, b.c.name));
    let L = "";
    for (const r of rows) { if (r.L !== L) { L = r.L; heads.push({ i: items.length, L }); items.push({ h: L }); } items.push({ c: r.c }); }
    if (list.length > 15) {
      const top = list.map(c => ({ c, ...best(c) })).filter(x => x.s >= 3).sort((a, b) => b.s - a.s || b.at - a.at).slice(0, 8);
      if (top.length) shelf = `<section class="cxshelf" aria-label="People ${esc(D!.helper())} knows best"><h3>People ${esc(D!.helper())} knows best</h3><div class="cxshr">${top.map(({ c }) =>
        `<a class="cxtile" href="${D!.href(c)}" title="${esc(c.name)}">${D!.av(c, "cxav lg")}<b>${esc(c.name.replace(PREFIX, "").split(/\s+/)[0] || c.name)}</b><small>${esc(c.rel && c.rel !== "Contact" ? c.rel : "")}</small></a>`).join("")}</div></section>`;
    }
  }
  CL.items = items; CL.heads = heads; CL.count = items.length - heads.length; CL.q = q; CL.rail = !q && CL.count > 20;
  CL.key = `${o.grp}|${q}|${CL.sort}`;
  const n = CL.count, word = n === 1 ? "contact" : "contacts";
  const meta = !list.length && !q ? "" : `<div class="cxmeta"><span>${q ? `${n.toLocaleString()} ${n === 1 ? "match" : "matches"}` : o.grp === "All" ? `${n.toLocaleString()} ${word}` : `${n.toLocaleString()} in ${esc(o.grp)}`}</span>
    ${!q && n > 1 ? `<span class="cxsort" role="group" aria-label="Sort by">Sort<button type="button" data-clsort="first" aria-pressed="${CL.sort === "first"}">First</button><button type="button" data-clsort="last" aria-pressed="${CL.sort === "last"}">Last</button></span>` : ""}</div>`;
  const empty = !n ? `<div class="nempty">${q ? `Nobody matches “${esc(o.q.trim())}”.` : o.grp === "All" ? "No contacts yet." : `Nobody in ${esc(o.grp)} yet.`}</div>` : "";
  const total = items.reduce((s, it) => s + ("h" in it ? HH : rowH()), 0);
  return `${o.top || ""}${shelf}${meta}${empty}<div class="cxvb${q ? " srch" : ""}" id="cxvb" role="list" style="height:${total}px">${heads.length ? `<div class="cxstick" aria-hidden="true">${heads[0].L}</div>` : ""}</div>${o.foot || ""}`;
}
function itemHtml(i: number) {
  const it = CL.items[i];
  if ("h" in it) return `<div class="cxhd" role="presentation" id="cxL-${it.h === "#" ? "num" : it.h}">${it.h}</div>`;
  const c = it.c;
  return `<a class="cxrow${CL.sel === c.id ? " on" : ""}${c.fresh ? " fresh" : ""}" role="listitem" href="${D!.href(c)}" data-cid="${c.id}"${CL.sel === c.id ? ` aria-current="true"` : ""}>${D!.av(c)}<span class="cxmain"><b>${esc(c.name)}</b>${sub(c) ? `<small>${esc(sub(c))}</small>` : ""}</span>${c.facts.some(f => f.fresh) ? `<i class="cxnew" title="Recently updated"></i>` : ""}</a>`;
}
const idxOf = (id: number) => CL.items.findIndex(it => "c" in it && it.c.id === id);

// After the list HTML is in the page: window it, restore the scroll, wire the rail, and put focus back if the keyboard was moving.
export function clMount() {
  const sc = document.getElementById("cxlist"), box = document.getElementById("cxvb"); if (!sc || !box || !D) return;
  CL.vl?.destroy();
  const selNow = D.sel(), selChanged = selNow !== CL.sel; CL.sel = selNow;
  const vl = CL.vl = new VList(sc, box, { count: CL.items.length, height: i => "h" in CL.items[i] ? HH : rowH(), html: itemHtml, pad: CL.heads.length ? HH : 0, onPaint: stick });
  sc.scrollTop = CL.key === CL.mountedKey ? CL.top : 0; CL.mountedKey = CL.key;
  sc.addEventListener("scroll", () => { CL.top = sc.scrollTop; }, { passive: true });
  CL.cur = ""; vl.paint();
  const si = selNow ? idxOf(selNow) : -1;
  if (si >= 0 && (selChanged || CL.refocus)) vl.scrollTo(si, "nearest");
  rail(sc);
  if (CL.refocus === "row" && si >= 0) vl.els.get(si)?.focus({ preventScroll: true });
  else if (CL.refocus === "q") { const i = document.getElementById("cxq") as HTMLInputElement | null; if (i) { i.focus({ preventScroll: true }); i.setSelectionRange(i.value.length, i.value.length); } }
  CL.refocus = "";
}
// The sticky header shows the section at the top; the next header pushes it up as it arrives (like iOS). The rail marks it too.
function stick(top: number) {
  top = Math.max(0, top + 1);   // sub-pixel box offsets: a header scrolled exactly to the top counts as "at the top"
  const vl = CL.vl, el = vl?.box.querySelector<HTMLElement>(".cxstick"); if (!vl || !el || !CL.heads.length) return;
  let k = 0; for (let lo = 0, hi = CL.heads.length - 1; lo <= hi;) { const m = (lo + hi) >> 1; if (vl.top(CL.heads[m].i) <= top) { k = m; lo = m + 1; } else hi = m - 1; }
  const h = CL.heads[k], nx = CL.heads[k + 1];
  if (el.textContent !== h.L) el.textContent = h.L;
  const d = nx ? vl.top(nx.i) - top + 1 : Infinity;
  el.style.transform = d < HH ? `translateY(${d - HH}px)` : "";
  if (CL.cur !== h.L) { CL.cur = h.L; document.querySelectorAll("#cxaz button").forEach(b => b.classList.toggle("on", (b as HTMLElement).dataset.letter === h.L)); }
}

// ---------- the A–Z rail: tap a letter, or press and drag along it ----------
function rail(sc: HTMLElement) {
  const az = document.getElementById("cxaz"); if (!az) return;
  const wrap = az.parentElement; wrap?.classList.toggle("rail", CL.rail);
  if (!CL.rail) { az.innerHTML = ""; return; }
  const has = new Set(CL.heads.map(h => h.L));
  az.innerHTML = `<div class="cxazl">${AZ.map(L => `<button type="button" tabindex="-1" data-letter="${L}"${has.has(L) ? "" : ` class="off"`} aria-label="Jump to ${L === "#" ? "numbers and symbols" : L}">${L}</button>`).join("")}</div><span class="cxazb" aria-hidden="true"></span>`;
  const list = az.firstElementChild as HTMLElement, bub = az.lastElementChild as HTMLElement;
  let last = "";
  const at = (y: number) => { const r = list.getBoundingClientRect(); return AZ[Math.max(0, Math.min(AZ.length - 1, Math.floor((y - r.top) / (r.height / AZ.length))))]; };
  const jump = (L: string, y: number) => {
    const r = az.getBoundingClientRect(); bub.textContent = L; bub.style.top = `${Math.max(24, Math.min(r.height - 24, y - r.top))}px`;
    if (L === last) return; last = L;
    const tgt = CL.heads.find(h => rank(h.L) >= rank(L)) || CL.heads[CL.heads.length - 1]; if (!tgt || !CL.vl) return;
    CL.vl.scrollTo(tgt.i, "start"); CL.top = sc.scrollTop;
    try { navigator.vibrate?.(4); } catch {}
  };
  az.onpointerdown = (e) => { e.preventDefault(); az.setPointerCapture(e.pointerId); az.classList.add("down"); last = ""; jump(at(e.clientY), e.clientY); };
  az.onpointermove = (e) => { if (az.classList.contains("down")) jump(at(e.clientY), e.clientY); };
  az.onpointerup = az.onpointercancel = (e) => { az.classList.remove("down"); try { az.releasePointerCapture(e.pointerId); } catch {} };
}

// ---------- keyboard: arrows move through the list (from the search box too), Enter opens, a letter jumps to its section ----------
function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement, vl = CL.vl; if (!vl || !D || !vl.box.isConnected) return;
  const inQ = t.id === "cxq", row = t.closest?.<HTMLElement>("#cxvb .cxrow");
  if (!inQ && !row) return;
  const rows = CL.items.map((it, i) => "c" in it ? i : -1).filter(i => i >= 0); if (!rows.length) return;
  const cur = row ? rows.indexOf(+row.dataset.vi!) : -1;
  let to = -1;
  if (e.key === "ArrowDown") to = cur < 0 ? (CL.sel && !inQ ? rows.indexOf(idxOf(CL.sel)) + 1 : 0) : cur + 1;
  else if (e.key === "ArrowUp") { if (cur <= 0) { if (row) { e.preventDefault(); document.getElementById("cxq")?.focus(); } return; } to = cur - 1; }
  else if (row && e.key === "PageDown") to = cur + 10;
  else if (row && e.key === "PageUp") to = Math.max(0, cur - 10);
  else if (row && e.key === "Home") to = 0;
  else if (row && e.key === "End") to = rows.length - 1;
  else if (inQ && e.key === "Enter") { const first = CL.items[rows[0]] as { c: CLContact }; e.preventDefault(); if (first.c.id !== CL.sel) { CL.refocus = D.phone() ? "" : "q"; D.go(first.c); } return; }
  else if (row && !CL.q && e.key.length === 1 && /[a-z#]/i.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const L = e.key.toUpperCase(), h = CL.heads.find(x => rank(x.L) >= rank(L)); if (!h) return; to = rows.indexOf(h.i + 1);
  } else return;
  e.preventDefault(); e.stopPropagation();
  to = Math.max(0, Math.min(rows.length - 1, to));
  const i = rows[to], c = (CL.items[i] as { c: CLContact }).c;
  vl.scrollTo(i, "nearest");
  if (D.phone() || c.id === CL.sel) { vl.els.get(i)?.focus({ preventScroll: true }); return; }
  CL.refocus = inQ && e.key !== "ArrowDown" ? "q" : "row"; D.go(c);   // desktop: the selection follows (the detail opens beside the list)
}

// ---------- pill radio groups (the Edit form's Group, and the labels on numbers/emails) ----------
// role="radiogroup" + role="radio"/aria-checked, roving tabindex, arrows move and select, Space/Enter select. The value lives in a hidden input.
export function pills(name: string, opts: string[], cur: string, label: string, cls = "", show?: (o: string) => string) {
  const v = opts.includes(cur) ? cur : opts[0];
  return `<div class="cxpills${cls ? " " + cls : ""}" role="radiogroup" aria-label="${esc(label)}" data-pills>${opts.map(o => `<button type="button" class="cxpill" role="radio" aria-checked="${o === v}" tabindex="${o === v ? 0 : -1}" data-pill="${esc(o)}">${show ? show(o) : esc(o)}</button>`).join("")}<input type="hidden" name="${esc(name)}" value="${esc(v)}"></div>`;
}
function pick(b: HTMLElement) {
  const g = b.closest<HTMLElement>("[data-pills]"); if (!g) return;
  g.querySelectorAll<HTMLElement>("[data-pill]").forEach(x => { const on = x === b; x.setAttribute("aria-checked", String(on)); x.tabIndex = on ? 0 : -1; });
  const inp = g.querySelector<HTMLInputElement>(":scope > input[type=hidden]"); if (inp) { inp.value = b.dataset.pill!; inp.dispatchEvent(new Event("change", { bubbles: true })); }
}
// Exported for sheets that stop clicks / keys from reaching the document (the merge sheet).
export function pillClick(t: HTMLElement) { const b = t.closest?.<HTMLElement>("[data-pills] [data-pill]"); if (b) pick(b); return !!b; }
document.addEventListener("click", (e) => { if (pillClick(e.target as HTMLElement)) e.preventDefault(); });
document.addEventListener("keydown", pillKey, true);
export function pillKey(e: KeyboardEvent) {
  const b = (e.target as HTMLElement).closest?.<HTMLElement>("[data-pills] [data-pill]"); if (!b) return;
  const all = [...b.closest("[data-pills]")!.querySelectorAll<HTMLElement>("[data-pill]")], i = all.indexOf(b);
  const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
  if (e.key === " " || e.key === "Enter") { e.preventDefault(); e.stopPropagation(); pick(b); return; }
  if (!d && e.key !== "Home" && e.key !== "End") return;
  e.preventDefault(); e.stopPropagation();
  const to = all[e.key === "Home" ? 0 : e.key === "End" ? all.length - 1 : (i + d + all.length) % all.length]; pick(to); to.focus();
}
