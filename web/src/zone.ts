// The Zone: a Library file (an HTML deck, a web page or a PDF report) beside its task. The chat stays where it is (the task view, on the left), the file
// is on a canvas in the middle, and an inspector is on the right. v3.ts loads this module only when someone opens a file in the Zone, so app.js stays small
// (zone.js, zone-ui.css and the img-fx effect are separate files served next to app.js).
//
// How it works
//  - The canvas shows the real file. An HTML file runs in a sandboxed frame (scripts allowed, no allow-same-origin). The Zone puts two small scripts into
//    the text it gives the frame (zone-bridge.ts), so the frame can say what is under the pointer, what was clicked and what was typed or dropped.
//    The frame and the app talk only by postMessage; every message carries a nonce made for this opening of the file, comes from the frame the app
//    made, has origin "null", and is cleaned field by field (clean()) before anything uses it. No HTML from the frame is ever put into the app.
//  - A click on an element selects it (outline and name on the canvas) and pins "Slide 2 · Title" above the chat box. The next message carries the pin
//    ({id, role: "zone", text, zone: {...}} as the reply field of /stream, 1HC src/reply-to.js) and the helper reads it as a plain line.
//  - The helper edits the real file on the channel computer and shares it again, which makes a new version of the same Library file. The stream's "file"
//    event for that file tells the Zone to load the new version. While the helper's turn is changing files the effect covers the canvas.
//  - A person can also type over text (double click, or Enter on a selected element), drop a picture on a picture box, and change size, weight, colour,
//    alignment, opacity and the slide background in the inspector. Each change goes to POST .../files/<id>/zone-edit, which applies it to the file and
//    saves a new version (src/zone-edit.js on the server). Undo and redo are per Zone session.
import { asJs, chipLabel, deckParts, docEditable, labelFor, patchForZone, thumbDoc, zoneKind, type ZKind } from "./zone-doc";
import { SHELL_CSS, bridgeFor, relayFor } from "./zone-bridge";
import { paragraphsOf, paraAt, splitMarker, norm, type Para, type TItem } from "./zone-docpara";

export type ZFileRef = { slug: string; id: string; name: string; mime?: string; tags?: string[]; session?: string | null; version?: number; bytes?: number };
export type ZDeps = {
  api: string;   // /w/<slug>/api
  v: string;   // the app's version, for the files loaded on demand
  fileUrl: (slug: string, id: string, dl?: boolean) => string;
  who: (slug: string) => string;   // the helper's name
  pinKey: () => string;   // the open task ("slug|id"), "" when none
  pin: (key: string, ref: any | null) => void;   // the chip above the chat box (msgreply.ts)
  note: (title: string, sub: string) => void;   // a quiet message
  leave: () => void;   // back to the task (the Zone closes itself first)
  styleBtn: (f: ZFileRef) => string;   // the deck styles button (deck-styles.ts), "" when the file is not a deck
  shareAttrs: (f: ZFileRef) => string;   // attributes that make an element open the share popover for the file (share.ts)
  helperWorking: () => boolean;   // the open task has a turn running
};

type Target = { slide: number | null; slot?: string; n?: number; sel?: string | null };
type Look = { fontSize: number; fontWeight: number; color: string; textAlign: string; bg: string; opacity: number; w: number; h: number };
type Info = { t: Target; path: string | null; tag: string; text: string; kind: "text" | "image" | "box"; edit: boolean; css: Look };
type Edit = Target & { op: "text" | "style" | "bg" | "image"; text?: string; css?: Record<string, string>; value?: string; mime?: string; data?: string };
type DocEdit = { op: "text"; page: number; was: string; n: number; text: string };
type Step = { edit: Edit | DocEdit; undo: Edit | DocEdit | "restore"; label: string };
type Rect = [number, number, number, number];

const $ = <T extends HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s);
const $$ = <T extends HTMLElement>(s: string, r: ParentNode = document) => [...r.querySelectorAll<T>(s)];
const esc = (s: any) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const phone = () => matchMedia("(max-width: 767px)").matches;
const mid = () => matchMedia("(min-width: 768px) and (max-width: 1359px)").matches;
const svg = (d: string, s = 18, w = 1.8) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC = {
  back: '<path d="m15 18-6-6 6-6"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>', undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>', redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>', share: '<path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>', down: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  full: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>', plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  cursor: '<path d="m5 3 14 7-6 2-2 6z"/>', image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4.5-4.5L5 21"/>', more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  deck: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>', page: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>', report: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
  bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>', al: '<path d="M4 6h16M4 12h10M4 18h14"/>', ac: '<path d="M4 6h16M7 12h10M5 18h14"/>', ar: '<path d="M4 6h16M10 12h10M6 18h14"/>',
  insp: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
};
const KIND_IC: Record<ZKind, string> = { deck: IC.deck, page: IC.page, report: IC.report, doc: IC.report };
const KIND_WORD: Record<ZKind, string> = { deck: "Deck", page: "Web page", report: "Report", doc: "Document" };

// ------------------------------------------------------------------------------------------------------------------------------------------------
// State
// ------------------------------------------------------------------------------------------------------------------------------------------------
type Frame = { el: HTMLIFrameElement; nonce: string; ready: boolean };
const Z = {
  deps: null as ZDeps | null, f: null as ZFileRef | null, kind: "deck" as ZKind, sid: "" as string,
  text: "", cur: null as Frame | null, next: null as Frame | null, gen: 0,
  slide: 1, count: 1, sel: null as { info: Info; r: Rect | null; slide: number | null } | null, hov: null as { r: Rect; label: string } | null, drop: null as Rect | null, editing: false,
  zoom: 1, k: 1, stage: null as [number, number, number, number] | null, version: 1, hasPrev: false, undo: [] as Step[], redo: [] as Step[], saving: 0, queue: Promise.resolve() as Promise<any>, err: "",
  busy: false, fx: null as any, fxHost: null as HTMLElement | null, fxPage: null as HTMLElement | null, pdf: null as any, pdfPages: [] as HTMLElement[],
  paras: new Map<number, { ps: Para[]; w: number; h: number }>(), phov: null as { page: number; i: number } | null, retry: false, refresh: false, seq: 0, edit: null as { page: number; i: number; ta: HTMLTextAreaElement } | null,
  chatW: 0, chatOff: false, drawer: false, menu: "" as "" | "more" | "ver", snaps: new Map<string, (png: string | null) => void>(), mounted: false, bg: "" as string,
};
const SPLIT_KEY = "1hc.zone.split", SPLIT_MIN = 280, SPLIT_OFF = 180, SPLIT_ON = 220;
const D = () => Z.deps!;

export const zoneIsOpen = () => Z.mounted;
export const zoneFile = () => (Z.mounted ? Z.f : null);
export const zoneSession = () => String(Z.sid);
const isPdf = () => Z.kind === "report" || Z.kind === "doc";   // pages drawn by pdf.js: a PDF report, or a Word document's preview

// ------------------------------------------------------------------------------------------------------------------------------------------------
// Opening and closing
// ------------------------------------------------------------------------------------------------------------------------------------------------
export async function zoneOpen(deps: ZDeps, f: ZFileRef, sid: string) {
  const kind = zoneKind(f); if (!kind) return;
  if (Z.mounted) zoneClose(true);
  Z.paras.clear(); Z.phov = null; Z.retry = false; Z.refresh = false; Z.fxPage = null; Z.edit = null;
  Object.assign(Z, { deps, f: { ...f }, kind, sid, text: "", slide: 1, count: 1, sel: null, hov: null, drop: null, editing: false, zoom: 1, k: 1, stage: null, undo: [], redo: [], saving: 0, err: "", busy: false, menu: "", drawer: false });
  Z.version = Number(f.version) || 1; Z.hasPrev = false; Z.mounted = true; Z.gen++; const gen0 = Z.gen;
  await styles(); if (!Z.mounted || Z.gen !== gen0) return;
  loadSplit(); mount(); void meta(); void load();
  if (D().helperWorking()) setBusy(true);
}
export function zoneClose(quiet = false) {
  if (!Z.mounted) return;
  Z.gen++; Z.mounted = false; fxStop(true); D().pin(D().pinKey(), null);
  for (const id of ["zcanvas", "zinsp", "zdiv", "zpresent"]) document.getElementById(id)?.remove();
  document.documentElement.classList.remove("zone-open", "zchat-off", "zinsp-open", "zchat-narrow", "zdoc-deck", "zdoc-page", "zdoc-report", "zdoc-doc"); document.documentElement.style.removeProperty("--zph");
  unwatchPlaceholder(); Z.cur = Z.next = null; Z.pdf?.destroy?.(); Z.pdf = null; window.removeEventListener("message", onMessage); window.removeEventListener("keydown", onKey, true); window.removeEventListener("resize", relayout); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onVisible);
  RO?.disconnect(); RO = null; pdfIO?.disconnect(); pdfIO = null;
  void quiet;
}
let RO: ResizeObserver | null = null;

async function meta(reloadIfNewer = false) {   // the file's version and whether a version before it is kept (GET .../files/<id>/zone-info)
  const f = Z.f!, gen = Z.gen;
  try {
    const r = await fetch(`${D().api}/res/${f.slug}/files/${f.id}/zone-info`, { credentials: "same-origin", cache: "no-store" }); if (!r.ok || gen !== Z.gen) return;
    const j = await r.json(), v = Number(j.version) || Z.version; Z.hasPrev = !!j.has_previous;
    if (reloadIfNewer && v !== Z.version && !Z.saving && !Z.busy) { Z.version = v; Z.undo = []; Z.redo = []; void load(true); } else if (!reloadIfNewer) Z.version = v;
    paintHead();
  } catch { /* the version label stays as it was */ }
}
// The file may have been changed somewhere else (another tab, the helper while this tab was in the background): coming back to the window checks.
const onVisible = () => { if (Z.mounted && document.visibilityState === "visible") void meta(true); };

// ------------------------------------------------------------------------------------------------------------------------------------------------
// The page of the Zone
// ------------------------------------------------------------------------------------------------------------------------------------------------
// The Zone's stylesheet is in before the Zone is drawn, so nothing shows unstyled.
function styles(): Promise<void> {
  const have = document.getElementById("zone-ui-css") as HTMLLinkElement | null; if (have) return Promise.resolve();
  return new Promise(done => { const l = document.createElement("link"); l.id = "zone-ui-css"; l.rel = "stylesheet"; l.href = new URL(`./zone-ui.css?v=${encodeURIComponent(D().v)}`, import.meta.url).href; l.onload = l.onerror = () => done(); document.head.appendChild(l); setTimeout(done, 3000); });
}
function mount() {
  const h = document.documentElement; h.classList.add("zone-open", `zdoc-${Z.kind}`); if (Z.kind === "doc") h.classList.add("zdoc-report");   // a document is laid out like a report: pages in a column, a strip of small pages
  const c = document.createElement("section"); c.id = "zcanvas"; c.className = "zs"; c.setAttribute("aria-label", "Canvas");
  c.innerHTML = `<header class="zhd" data-zp="head"></header><div class="zcv" data-zcv><div class="zscroll" data-zscroll><div class="zpages" data-zpages></div></div>
    <div class="zovl"><div class="zhov" hidden></div><div class="zdrop" hidden><span>Drop to place the picture</span></div><div class="zsel" hidden><span class="zseltag"></span></div><div class="zfxhost" hidden></div></div>
    <div class="zload" data-zload role="status"><span>Opening ${esc(Z.f!.name)}</span></div></div><div class="zstrip" data-zp="strip"></div>`;
  const i = document.createElement("aside"); i.id = "zinsp"; i.className = "zs"; i.setAttribute("aria-label", "Inspector"); i.setAttribute("data-zp", "insp");
  const d = document.createElement("div"); d.id = "zdiv"; d.setAttribute("role", "separator"); d.setAttribute("aria-orientation", "vertical"); d.setAttribute("aria-label", "Resize the chat"); d.tabIndex = 0; d.innerHTML = "<i></i>";
  document.body.append(c, i, d);
  wire(c, i); wireDoc(c); wireSplit(d); watchPlaceholder(); $("[data-zscroll]", c)!.addEventListener("scroll", () => { placeOverlay(); placeFx(); }, { passive: true });
  window.addEventListener("message", onMessage); window.addEventListener("keydown", onKey, true); window.addEventListener("resize", relayout); document.addEventListener("visibilitychange", onVisible); window.addEventListener("focus", onVisible);
  RO = new ResizeObserver(() => relayout()); RO.observe($(".zcv", c)!); RO.observe(c); if (chatEl()) RO.observe(chatEl()!);   // the canvas section too: on a phone the chat starts where it ends
  applySplit(); paintHead(); paintInsp(); paintStrip();
}
const cv = () => $<HTMLElement>("#zcanvas .zcv");
const pagesBox = () => $<HTMLElement>("#zcanvas [data-zpages]");

// ------------------------------------------------------------------------------------------------------------------------------------------------
// Loading the file
// ------------------------------------------------------------------------------------------------------------------------------------------------
const nonce = () => crypto.getRandomValues(new Uint32Array(4)).join("-");
async function load(quiet = false) {
  const gen = Z.gen, f = Z.f!; if (quiet && Z.kind === "doc") { Z.refresh = true; paintHead(); }
  try {
    if (isPdf()) { await loadPdf(gen, quiet); return; }
    const r = await fetch(D().fileUrl(f.slug, f.id), { credentials: "same-origin", cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text(); if (gen !== Z.gen) return;
    Z.text = text;
    let n = nonce(), html = patchForZone(Z.kind, text, { bridge: bridgeFor(n, Z.kind === "deck"), relay: relayFor(n), css: SHELL_CSS });
    if (!html && Z.kind === "deck") { Z.kind = "page"; const h = document.documentElement; h.classList.remove("zdoc-deck"); h.classList.add("zdoc-page"); n = nonce(); html = patchForZone("page", text, { bridge: bridgeFor(n, false), relay: relayFor(n) }); }   // a deck not made by the helper's builder: a page
    if (!html) throw new Error(Z.kind === "deck" ? "This deck's file isn't in the form the Zone can open." : "The page couldn't be opened.");
    const el = document.createElement("iframe"); el.className = "zframe"; el.title = f.name; el.setAttribute("sandbox", "allow-scripts allow-popups"); el.setAttribute("allow", "fullscreen"); el.setAttribute("referrerpolicy", "no-referrer");
    Z.next?.el.remove(); el.style.visibility = "hidden"; Z.next = { el, nonce: n, ready: false }; pagesBox()?.appendChild(el); sizeFrame(el); el.srcdoc = html;
    if (!quiet) setLoad(true);
  } catch (e: any) { if (gen !== Z.gen) return; if (quiet && Z.kind === "doc" && Z.pdf) { Z.refresh = false; paintHead(); D().note("Couldn't update the pages", String(e?.message || e).replace(/^Couldn't make a preview: /, "").slice(0, 160)); return; } setLoad(false, Z.kind === "doc" ? `Couldn't open this document. ${String(e?.message || e).replace(/^Couldn't make a preview: /, "").slice(0, 160)}` : `Couldn't open this file (${String(e?.message || e).slice(0, 120)}).`); }
}
function setLoad(on: boolean, msg = "") { const e = $("#zcanvas [data-zload]"); if (!e) return; e.classList.toggle("off", !on && !msg); e.classList.toggle("err", !!msg); if (msg) e.innerHTML = `<span>${esc(msg)}</span><button type="button" data-zact="retry">Try again</button>`; else e.innerHTML = `<span>Opening ${esc(Z.f!.name)}</span>`; }

// The frame the person sees is swapped for the new one when the new one is ready (a new version, an undo, a reload), so nothing flashes.
function swapIn(fr: Frame) {
  const old = Z.cur; Z.cur = fr; Z.next = null; fr.el.style.visibility = ""; fr.ready = true; old?.el.remove(); sizeFrame(fr.el); setLoad(false);
  const want = Z.slide; if (Z.kind === "deck" && want > 1) post("goto", { i: want - 1 });
  relayout(); paintAll();
}

// ------------------------------------------------------------------------------------------------------------------------------------------------
// Messages from the frame
// ------------------------------------------------------------------------------------------------------------------------------------------------
const num = (x: any, lo = -1e6, hi = 1e6) => { const n = Number(x); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : 0; };
const str = (x: any, n = 400) => (typeof x === "string" ? x.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").slice(0, n) : "");
const rect = (x: any): Rect | null => (Array.isArray(x) && x.length === 4 ? [num(x[0]), num(x[1]), num(x[2], 0), num(x[3], 0)] : null);
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|[a-z]{3,20})$/i, LEN = /^-?\d{1,4}(\.\d{1,3})?(px|em|rem|%|pt)?$/;
const CSSKEYS: Record<string, "len" | "color" | "word" | "num"> = { "font-size": "len", "font-weight": "num", "font-style": "word", "color": "color", "text-align": "word", "line-height": "len", "letter-spacing": "len", "background-color": "color", "width": "len", "height": "len", "opacity": "num" };
function target(x: any): Target | null {
  if (!x || typeof x !== "object") return null;
  const o: Target = { slide: x.slide == null ? null : Math.round(num(x.slide, 1, 999)) };
  if (typeof x.slot === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(x.slot)) { o.slot = x.slot; o.n = Math.round(num(x.n, 0, 999)); }
  else if (typeof x.sel === "string" && /^\d{1,4}(\/\d{1,4}){0,40}$/.test(x.sel)) o.sel = x.sel;
  else return null;
  return o;
}
function cleanEdit(x: any): Edit | null {
  if (!x || typeof x !== "object") return null;
  if (x.op === "bg") { const v = str(x.value, 60).trim(); return COLOR.test(v) ? { slide: x.slide == null ? null : Math.round(num(x.slide, 1, 999)), op: "bg", value: v } : null; }
  const t = target(x); if (!t) return null;
  if (x.op === "text") return { ...t, op: "text", text: str(x.text, 2000) };
  if (x.op === "style") { const css: Record<string, string> = {}; for (const k of Object.keys(x.css || {})) { const kind = CSSKEYS[k], v = str(x.css[k], 60).trim(); if (!kind || !v || /url\(|[;{}<>]/i.test(v)) continue; if (kind === "len" ? !LEN.test(v) : kind === "color" ? !COLOR.test(v) : kind === "num" ? !/^\d{1,4}(\.\d{1,3})?$/.test(v) : !/^[a-z-]{3,20}$/i.test(v)) continue; css[k] = v; } return Object.keys(css).length ? { ...t, op: "style", css } : null; }
  if (x.op === "image") { if (!/^image\/(png|jpeg|webp|gif)$/.test(x.mime) || typeof x.data !== "string" || x.data.length > 5_600_000 || !/^[A-Za-z0-9+/=]+$/.test(x.data)) return null; return { ...t, op: "image", mime: x.mime, data: x.data }; }
  return null;
}
function cleanInfo(x: any): Info | null {
  const t = target(x?.t); if (!t) return null; const c = x.css || {};
  return { t, path: typeof x.path === "string" && /^\d{1,4}(\/\d{1,4}){0,40}$/.test(x.path) ? x.path : null, tag: str(x.tag, 20).toLowerCase().replace(/[^a-z0-9]/g, ""), text: str(x.text, 400), kind: x.kind === "image" || x.kind === "text" ? x.kind : "box", edit: x.edit === true,
    css: { fontSize: num(c.fontSize, 0, 2000), fontWeight: num(c.fontWeight, 0, 1000), color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : "", textAlign: str(c.textAlign, 12), bg: /^#[0-9a-f]{6}$/i.test(c.bg) ? c.bg : "", opacity: num(c.opacity, 0, 1), w: num(c.w, 0, 20000), h: num(c.h, 0, 20000) } };
}
function onMessage(e: MessageEvent) {
  const d = e.data; if (!Z.mounted || e.origin !== "null" || !d || typeof d !== "object" || typeof d.zb !== "string") return;
  const fr = e.source && Z.cur && e.source === Z.cur.el.contentWindow ? Z.cur : e.source && Z.next && e.source === Z.next.el.contentWindow ? Z.next : null;
  if (!fr || d.zb !== fr.nonce) return;
  const r = rect(d.r), isNext = fr === Z.next;
  if (!isNext && Array.isArray(d.g) && d.g.length === 4) { const g = d.g.map((x: any) => num(x, -5, 5)); if (g[2] > 0 && g[3] > 0) Z.stage = [g[0], g[1], g[2], g[3]]; }
  switch (d.t) {
    case "stage": if (!isNext) placeOverlay(), placeFx(); break;
    case "ready": Z.bg = /^#[0-9a-f]{6}$/i.test(d.bg) ? d.bg : ""; if (isNext) { fr.ready = true; Z.count = Math.max(1, Math.round(num(d.n, 1, 999))); void swapAfter(fr); } else { Z.count = Math.max(1, Math.round(num(d.n, 1, 999))); Z.slide = Math.round(num(d.i, 0, 998)) + 1; paintAll(); } break;
    case "slide": if (isNext) break; Z.bg = /^#[0-9a-f]{6}$/i.test(d.bg) ? d.bg : ""; Z.slide = Math.round(num(d.i, 0, 998)) + 1; Z.count = Math.max(1, Math.round(num(d.n, 1, 999))); setSel(null); paintHead(); paintStrip(); paintInsp(); break;
    case "hover": if (isNext) break; Z.hov = r ? { r, label: labelFor({ slot: typeof d.slot === "string" ? d.slot.slice(0, 64) : null, tag: str(d.tag, 20) || "div", text: str(d.text, 40) }) } : null; placeOverlay(); break;
    case "select": { if (isNext) break; const info = cleanInfo(d.info); if (!info) Z.bg = /^#[0-9a-f]{6}$/i.test(d.bg) ? d.bg : Z.bg; Z.hov = null; const sl = d.slide == null ? null : Math.round(num(d.slide, 1, 999));
      setSel(info ? { info, r, slide: sl } : d.whole === 1 && sl ? { info: wholeInfo(sl), r: null, slide: sl } : null, true); break; }
    case "rect": if (!isNext && Z.sel && r) { Z.sel.r = r; placeOverlay(); } break;
    case "editing": if (isNext) break; Z.editing = d.on === true; if (r && Z.sel) Z.sel.r = r; placeOverlay(); break;
    case "drop": if (!isNext) { Z.drop = r; placeOverlay(); } break;
    case "note": if (!isNext) say(d.m); break;
    case "edit": if (!isNext) { const ed = cleanEdit(d.edit); if (ed) void recordEdit(ed, d); } break;
    case "snap": { const cb = Z.snaps.get(fr.nonce); Z.snaps.delete(fr.nonce); cb?.(typeof d.png === "string" && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(d.png) && d.png.length < 4_000_000 ? d.png : null); break; }
  }
}
function say(m: any) {
  const t = m === "mixed" ? ["This text can't be edited here", "It mixes text with other parts. Ask the helper to change it."] : m === "type" ? ["That isn't a picture the file can use", "Use a PNG, JPEG, WebP or GIF."] : m === "big" ? ["That picture is too big", "Use one under 4 MB."] : m === "bg" ? ["The background can't be set here", "This slide draws its background in layers. Ask the helper to change it."] : m === "where" ? ["Drop it on a picture box", "Pictures go in the boxes that have a picture or a place for one."] : null;
  if (t) D().note(t[0], t[1]);
}
function post(t: string, extra: Record<string, any> = {}) { const fr = Z.cur; if (fr) fr.el.contentWindow?.postMessage({ zb: fr.nonce, t, ...extra }, "*"); }

// ------------------------------------------------------------------------------------------------------------------------------------------------
// The selection and its chip above the chat box
// ------------------------------------------------------------------------------------------------------------------------------------------------
// A click on the empty part of a slide (or a click on a page of a report) picks that slide or page as a whole.
const wholeInfo = (n: number, tag = "slide"): Info => ({ t: { slide: n, sel: "0" }, path: null, tag, text: "", kind: "box", edit: false, css: { fontSize: 0, fontWeight: 0, color: "", textAlign: "", bg: "", opacity: 1, w: 0, h: 0 } });
const isWhole = (s: { info: Info } | null) => !!s && (s.info.tag === "slide" || s.info.tag === "page");
function setSel(s: typeof Z.sel, fromFrame = false) {
  Z.sel = s; if (!s) { Z.editing = false; Z.hov = null; if (!fromFrame) post("clear"); }
  pinSelection(); placeOverlay(); paintInsp(); paintHead(); docPaint();
}
function pinSelection() {
  const key = D().pinKey(), f = Z.f!; if (!key) return;
  const s = Z.sel;
  if (!s) { D().pin(key, null); return; }
  if (Z.kind === "doc" && !isWhole(s)) {   // a paragraph of a Word document: "Page 1 · the start of its text"
    const t = s.info.text, el = t.length > 44 ? t.slice(0, 43).trimEnd() + "…" : t;
    D().pin(key, { id: null, role: "zone", text: chipLabel("doc", s.slide, Z.count, el), mr: -1, zone: { file: f.id, name: f.name, kind: "doc", slide: s.slide, of: Z.count, slot: null, sel: null, label: "", text: t } }); return;
  }
  const el = isWhole(s) ? "" : labelFor({ slot: s.info.t.slot, tag: s.info.tag, text: s.info.text }), label = chipLabel(Z.kind, s.slide, Z.count, el || null);
  D().pin(key, { id: null, role: "zone", text: label, mr: -1, zone: { file: f.id, name: f.name, kind: Z.kind, slide: s.slide, of: Z.kind === "deck" ? Z.count : null, slot: isWhole(s) ? null : s.info.t.slot || null, sel: isWhole(s) ? null : s.info.path, label: el, text: isWhole(s) ? "" : s.info.text } });
}
/** v3.ts calls this once a message that carried the pin was sent: the helper will change that element, so the selection is let go. */
export function zoneSent() { if (!Z.mounted || !Z.sel) return; Z.sel = null; Z.editing = false; post("clear"); placeOverlay(); paintInsp(); paintHead(); docPaint(); }
/** The chip's own X: the selection goes with it. */
export function zoneUnpinned() { if (!Z.mounted || !Z.sel) return; Z.sel = null; post("clear"); placeOverlay(); paintInsp(); paintHead(); docPaint(); }

// ------------------------------------------------------------------------------------------------------------------------------------------------
// Sizing the frame, and the overlay (hover outline, selection outline and name, drop target) drawn over it
// ------------------------------------------------------------------------------------------------------------------------------------------------
const pad = () => (phone() ? 8 : 28);
function geometry() {
  const c = cv(); if (!c) return null;
  const W = Math.max(40, c.clientWidth - pad() * 2), H = Math.max(40, c.clientHeight - pad() * 2);
  if (Z.kind === "deck") { const s = Math.min(W / 1920, H / 1080) * Z.zoom; return { w: Math.round(1920 * s), h: Math.round(1080 * s), k: 1, s }; }
  const vw = phone() ? 900 : Math.max(Math.min(1280, W), 640), k0 = Math.min(1, W / vw), k = k0 * Z.zoom;
  return { w: Math.round(vw), h: Math.round(H / k0 / Z.zoom), k, s: k };
}
function sizeFrame(el: HTMLElement) {
  const g = geometry(); if (!g) return;
  el.style.width = g.w + "px"; el.style.height = g.h + "px"; el.style.transformOrigin = "0 0"; el.style.transform = g.k !== 1 ? `scale(${g.k})` : "";
  const wrap = pagesBox(); if (wrap) { wrap.style.setProperty("--zw", Math.round(g.w * g.k) + "px"); wrap.style.setProperty("--zh", Math.round(g.h * g.k) + "px"); }
  Z.k = g.k;
}
// While the chat column is narrow its header keeps the title: the status pill is a dot (its words are in its tooltip) and the right edge no longer reserves the computer button's corner.
function chatNarrow() { const w = chatEl()?.getBoundingClientRect().width || 0; document.documentElement.classList.toggle("zchat-narrow", w > 0 && w < 400); fitPlaceholder(); }
// The composer's placeholder ("Reply to Skipper") would wrap or be cut when the chat is narrow: it shows its first word then, and the whole text again when there is room.
let phObs: MutationObserver | null = null;
function fitPlaceholder() {
  const t = document.getElementById("box") as HTMLTextAreaElement | null; if (!t) return;
  const full = t.dataset.zph || t.placeholder; if (!full) return;
  const cs = getComputedStyle(t), room = t.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); if (room <= 0) return;
  const m = document.createElement("span"); m.style.cssText = `font:${cs.font};letter-spacing:${cs.letterSpacing};white-space:nowrap;position:absolute;visibility:hidden`; m.textContent = full; document.body.appendChild(m); const need = m.getBoundingClientRect().width; m.remove();
  if (need > room && full.includes(" ")) { if (!t.dataset.zph) t.dataset.zph = full; t.placeholder = full.split(" ")[0]; }
  else if (t.dataset.zph) { t.placeholder = t.dataset.zph; delete t.dataset.zph; }
}
function watchPlaceholder() { phObs?.disconnect(); const st = chatEl(); if (!st) return; phObs = new MutationObserver(() => fitPlaceholder()); phObs.observe(st, { childList: true, subtree: true }); }
function unwatchPlaceholder() { phObs?.disconnect(); phObs = null; const t = document.getElementById("box") as HTMLTextAreaElement | null; if (t?.dataset.zph) { t.placeholder = t.dataset.zph; delete t.dataset.zph; } }
function relayout() {
  if (!Z.mounted) return; chatNarrow();
  const g = geometry(); if (g) { Z.k = g.k; for (const fr of [Z.cur, Z.next]) if (fr) sizeFrame(fr.el); const z = $("[data-zzoom]"); if (z) z.textContent = Math.round(g.s * 100) + "%"; }
  if (isPdf()) { drawPdfPages(); docPaint(); }
  phoneVars(); placeOverlay(); placeFx(); fitStrip();
}
// A rectangle from the frame is in the page's own pixels (a deck: the template's 1920 by 1080 pixels; a page: its CSS pixels). It is turned into
// canvas pixels here, each time the overlay is drawn, from the frame's box as it is right now, so a zoom, a divider drag or a window resize
// can never leave an old rectangle in the wrong place. A deck's shell fits its stage into the frame by its own rule, so the relay reports where the
// stage is as fractions of the frame (Z.stage); until it has, the stage is taken to be the largest 16:9 box centred in the frame.
function boxOf(r: Rect): { x: number; y: number; w: number; h: number } | null {
  const c = cv(), f = Z.cur?.el; if (!c || !f) return null;
  const a = f.getBoundingClientRect(), b = c.getBoundingClientRect(), ox = a.left - b.left, oy = a.top - b.top;
  if (Z.kind === "deck") {
    const st = Z.stage || (() => { const s = Math.min(a.width / 1920, a.height / 1080); return [(a.width - 1920 * s) / 2 / a.width, (a.height - 1080 * s) / 2 / a.height, 1920 * s / a.width, 1080 * s / a.height] as [number, number, number, number]; })();
    const s = (st[2] * a.width) / 1920;
    return { x: ox + st[0] * a.width + r[0] * s, y: oy + st[1] * a.height + r[1] * s, w: r[2] * s, h: r[3] * s };
  }
  const s = f.offsetWidth ? a.width / f.offsetWidth : Z.k;
  return { x: ox + r[0] * s, y: oy + r[1] * s, w: r[2] * s, h: r[3] * s };
}
function frameOffset(): { x: number; y: number } | null {
  const c = cv(), f = Z.cur?.el; if (!c || !f) return null;
  const a = f.getBoundingClientRect(), b = c.getBoundingClientRect(); return { x: a.left - b.left, y: a.top - b.top };
}
function placeBox(el: HTMLElement | null, r: Rect | null): number | null {
  if (!el) return null; const bx = r ? boxOf(r) : null; if (!bx) { el.hidden = true; return null; }
  el.hidden = false; el.style.cssText = `left:${bx.x}px;top:${bx.y}px;width:${bx.w}px;height:${bx.h}px`; return bx.y;
}
function placeOverlay() {
  const hov = $<HTMLElement>("#zcanvas .zhov"), sel = $<HTMLElement>("#zcanvas .zsel"), drop = $<HTMLElement>("#zcanvas .zdrop"); if (!sel) return;
  const hy = placeBox(hov, Z.hov && !Z.busy ? Z.hov.r : null); if (hov && Z.hov) hov.dataset.l = Z.hov.label;
  placeBox(drop, Z.drop && !Z.busy ? Z.drop : null);
  const s = Z.sel, sy = placeBox(sel, s && s.r && !isWhole(s) && !Z.busy ? s.r : null);
  if (s && !sel.hidden) {
    const tag = $(".zseltag", sel)!, name = labelFor({ slot: s.info.t.slot, tag: s.info.tag, text: s.info.text }); tag.textContent = name + (Z.editing ? " · Editing text" : "");
    sel.classList.toggle("below", sy != null && sy < 34); sel.classList.toggle("typing", Z.editing);
  }
  if (hov && !hov.hidden && hy != null) hov.classList.toggle("below", hy < 34);
}

// ------------------------------------------------------------------------------------------------------------------------------------------------
// Saving edits: one at a time, each one a new version of the same Library file
// ------------------------------------------------------------------------------------------------------------------------------------------------
async function sendEdits(edits: (Edit | DocEdit)[] | null, restore = false): Promise<boolean> {
  const f = Z.f!, gen = Z.gen;
  const r = await fetch(`${D().api}/res/${f.slug}/files/${f.id}/zone-edit`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(restore ? { base: Z.version, restore: "previous" } : { base: Z.version, edits }) });
  const j = await r.json().catch(() => ({}));
  if (gen !== Z.gen) return false;
  if (r.ok && j.file) { Z.version = Number(j.file.version) || Z.version + 1; Z.hasPrev = true; if (j.file.bytes) Z.f!.bytes = j.file.bytes; return true; }
  if (r.status === 409) { D().note("The file changed", "It was changed since you opened it, so the latest version is shown. Your last change was not saved."); Z.undo = []; Z.redo = []; Z.version = Number(j.version) || Z.version; void meta(); void load(true); return false; }
  D().note("Couldn't save that change", String(j.error || `Something went wrong (${r.status}).`).slice(0, 160)); void load(true); return false;
}
function enqueue(job: () => Promise<any>) { Z.saving++; paintHead(); const run = Z.queue.then(job, job).catch(() => {}).finally(() => { Z.saving--; paintHead(); }); Z.queue = run; return run; }
const invert = (e: Edit, was: any): Edit | "restore" | null => {
  if (e.op === "text") return typeof was === "string" ? { ...e, text: was } : null;
  if (e.op === "style") { const css: Record<string, string> = {}; for (const k of Object.keys(e.css || {})) { const v = was?.[k]; if (typeof v === "string" && v) css[k] = v; } return Object.keys(css).length ? { ...e, css } : null; }
  if (e.op === "bg") return typeof was === "string" && was ? { ...e, value: was } : null;
  return "restore";   // a picture: the version before it is what comes back
};
async function recordEdit(e: Edit, d: any) {
  const un = invert(e, d.was), label = e.op === "text" ? "Edited text" : e.op === "image" ? "Replaced a picture" : e.op === "bg" ? "Changed the background" : "Changed the look";
  await enqueue(() => sendEdits([e]).then(v => { if (v) { if (un) { Z.undo.push({ edit: e, undo: un, label }); if (Z.undo.length > 40) Z.undo.shift(); } else Z.undo = []; Z.redo = []; void refreshText(); } return v; }));
  paintHead();
}
// The strip's small pictures are made from the file's text, so they follow a saved change.
async function refreshText() {
  if (isPdf()) return; const f = Z.f!, gen = Z.gen, v = Z.version;
  try { const r = await fetch(D().fileUrl(f.slug, f.id), { credentials: "same-origin", cache: "no-store" }); if (!r.ok || gen !== Z.gen || v !== Z.version) return; Z.text = await r.text(); const st = $("[data-zp=strip]"); if (st) { st.dataset.n = ""; paintStrip(); } } catch { /* the pictures stay as they were */ }
}
function undo() {
  const st = Z.undo[Z.undo.length - 1]; if (!st || Z.busy) return;
  void enqueue(async () => {
    const ok = st.undo === "restore" ? await sendEdits(null, true) : await sendEdits([st.undo]);
    if (ok) { Z.undo.pop(); Z.redo.push(st); void load(true); }
  });
}
function redo() {
  const st = Z.redo[Z.redo.length - 1]; if (!st || Z.busy) return;
  void enqueue(async () => {
    const ok = await sendEdits([st.edit]);
    if (ok) { Z.redo.pop(); Z.undo.push(st); void load(true); }
  });
}
function restorePrevious() { void enqueue(async () => { const ok = await sendEdits(null, true); if (ok) { Z.undo = []; Z.redo = []; void load(true); } }); }

// ------------------------------------------------------------------------------------------------------------------------------------------------
// The helper at work, and its new version
// ------------------------------------------------------------------------------------------------------------------------------------------------
const WRITES = /^(edit_file|write_file|run_command|apply_patch|start_helper|share_file)$/;
/** v3.ts calls this for every stream event of the open task. */
export function zoneEvent(slug: string, sid: string, ev: any) {
  if (!Z.mounted || !Z.f || slug !== Z.f.slug || (Z.sid && String(sid) !== String(Z.sid))) return;
  if (ev?.t === "card_event" && ev.event?.type === "step" && WRITES.test(String(ev.event.tool || "")) && ev.event.status === "running") { if (!Z.busy) setBusy(true); }
  else if (ev?.t === "file" && ev.file?.id === Z.f.id) {
    if (Number(ev.file.version) > Z.version || ev.file.at) { Z.version = Number(ev.file.version) || Z.version; Z.hasPrev = true; Z.undo = []; Z.redo = []; void meta(); void load(true); }
  }
  else if (ev?.t === "done" || ev?.t === "card_close") { if (Z.busy) setTimeout(() => { if (Z.busy && !Z.next) { setBusy(false); void meta(true); } }, 2500); }   // the turn is over: the canvas is free, and the file is checked in case it changed without an event
}
function setBusy(on: boolean) {
  if (Z.busy === on) return; Z.busy = on; $("#zcanvas")?.classList.toggle("busy", on);
  if (on) { post("clear"); cancelEdit(); Z.sel = null; Z.hov = null; Z.phov = null; Z.drop = null; Z.editing = false; D().pin(D().pinKey(), null); void fxStart(); } else fxStop(false);
  placeOverlay(); paintHead(); paintInsp(); docPaint();
}
// When the new version's page is ready, the effect (if there is one) dissolves into it; without the effect the new page just replaces the old one.
async function swapAfter(fr: Frame) {
  const fx = Z.fx;
  if (!fx || !Z.fxHost?.classList.contains("on")) { if (fx) fxStop(true); swapIn(fr); if (Z.busy) setBusy(false); return; }
  const g = geometry(), w = Math.min(1280, g?.w || 960), png = await snap(fr, w, Math.round(w * ((g?.h || 540) / (g?.w || 960))));
  swapIn(fr);
  if (png) { try { await within(fx.boil(png, 2600, true).done, 2600 + 6000); } catch { /* the effect failed; the new page is already there */ } }
  if (Z.fx === fx) fxStop(false);
  if (Z.busy) setBusy(false);
}
function snap(fr: Frame, w: number, h: number): Promise<string | null> {
  if (isPdf()) { const c = (Z.fxPage || $("#zcanvas .zpg"))?.querySelector("canvas") as HTMLCanvasElement | null; try { return Promise.resolve(c ? c.toDataURL("image/jpeg", 0.85) : null); } catch { return Promise.resolve(null); } }
  return new Promise(res => { const t = setTimeout(() => { Z.snaps.delete(fr.nonce); res(null); }, 4000); Z.snaps.set(fr.nonce, p => { clearTimeout(t); res(p); }); fr.el.contentWindow?.postMessage({ zb: fr.nonce, t: "snap", w, h }, "*"); });
}
const within = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error("slow")), ms))]);
const webgl = () => { try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; } };
// The page of a Word document that is most in view: the effect covers it while the helper works.
function visiblePage(): HTMLElement | null {
  const c = cv(); if (!c) return null; const cr = c.getBoundingClientRect(); let best: HTMLElement | null = null, bv = 0;
  for (const p of Z.pdfPages) { const r = p.getBoundingClientRect(), v = Math.min(r.bottom, cr.bottom) - Math.max(r.top, cr.top); if (v > bv) { bv = v; best = p; } }
  return best;
}
async function fxStart() {
  if (reduced() || Z.fx || (!Z.cur && Z.kind !== "doc") || !webgl()) return;   // no effect for people who asked for less motion, or when the browser can't draw it: the work still shows on the new version
  if (Z.kind === "doc") Z.fxPage = visiblePage();
  const g = Z.kind === "doc" ? (Z.fxPage?.querySelector("canvas") ? { w: Z.fxPage.clientWidth, h: Z.fxPage.clientHeight, k: 1, s: 1 } : null) : geometry(); if (!g) return; const gen = Z.gen;
  const w = Math.min(1280, g.w), png = await snap(Z.cur as Frame, w, Math.round(w * (g.h / g.w))); if (!png || gen !== Z.gen || !Z.busy) return;
  const host = $<HTMLElement>("#zcanvas .zfxhost"); if (!host) return; host.hidden = false; host.classList.remove("on", "out"); host.innerHTML = ""; Z.fxHost = host; placeFx();
  try {
    const mod: any = await import(/* @vite-ignore */ new URL(`./imgfx.js?v=${encodeURIComponent(D().v)}`, import.meta.url).href);
    if (gen !== Z.gen || !Z.busy) { host.hidden = true; return; }
    const fx = mod.mount(host, { preset: "pixels-mechanic", theme: "light", radius: 0 }); Z.fx = fx;
    await within(fx.show(png), 30000);
    if (gen !== Z.gen || !Z.busy || Z.fx !== fx) { if (Z.fx === fx) fxStop(true); return; }
    host.classList.add("on");
    fx.boil(png, 600000, true);   // while the helper works the picture keeps breaking into pixels; the new version dissolves in at the end (swapAfter)
  } catch { fxStop(true); }
}
function placeFx() {
  if (Z.kind === "doc") {   // over the page it was started on
    const host = Z.fxHost, c = cv(), pg = Z.fxPage; if (!host || !c || !pg || host.hidden) return; const a = pg.getBoundingClientRect(), b = c.getBoundingClientRect();
    host.style.cssText = `left:${a.left - b.left}px;top:${a.top - b.top}px;width:${a.width}px;height:${a.height}px`; return;
  }
  const host = Z.fxHost, o = frameOffset(), g = geometry(); if (!host || !o || !g || host.hidden) return;
  host.style.cssText = `left:${o.x}px;top:${o.y}px;width:${Math.round(g.w * g.k)}px;height:${Math.round(g.h * g.k)}px`;
}
function fxStop(now: boolean) {
  const host = Z.fxHost, fx = Z.fx; Z.fx = null; if (!host) return;
  const end = () => { try { fx?.destroy(); } catch { /* gone */ } host.hidden = true; host.classList.remove("on", "out"); host.innerHTML = ""; if (Z.fxHost === host) Z.fxHost = null; };
  if (now || !fx) { end(); return; }
  host.classList.add("out"); setTimeout(end, 420);
}

// ------------------------------------------------------------------------------------------------------------------------------------------------
// A PDF report: pages drawn with pdf.js (loaded on demand, like the file viewer does)
// ------------------------------------------------------------------------------------------------------------------------------------------------
async function loadPdf(gen: number, quiet: boolean) {
  const f = Z.f!, base = new URL("../pdfjs/", import.meta.url).href, lib: any = await import(/* @vite-ignore */ base + "pdf.min.mjs"), my = ++Z.seq;
  lib.GlobalWorkerOptions.workerSrc = base + "pdf.worker.min.mjs";
  let src: any = { url: D().fileUrl(f.slug, f.id) + (quiet ? `?t=${Date.now()}` : ""), withCredentials: true };
  if (Z.kind === "doc") {   // the server's PDF preview of the Word file (src/file-preview.js, the same one the file viewer shows); the first one is made on the channel computer
    const slow = setTimeout(() => { const e = $("#zcanvas [data-zload] span"); if (e && !$("#zcanvas [data-zload]")?.classList.contains("off")) e.textContent = "Making the pages. The first time takes a few seconds."; }, 3500);
    try {
      const r = await fetch(`${D().api}/res/${f.slug}/files/${f.id}/preview${Z.retry ? "?retry=1" : ""}`, { credentials: "same-origin", cache: "no-store" }); Z.retry = false;
      if (!r.ok) { const j = await r.json().catch(() => null); throw new Error(String(j?.error || `Something went wrong (${r.status}).`)); }
      src = { data: new Uint8Array(await r.arrayBuffer()) };
    } finally { clearTimeout(slow); }
    if (gen !== Z.gen || my !== Z.seq) return;
  }
  const doc = await lib.getDocument({ ...src, wasmUrl: base + "wasm/", standardFontDataUrl: base + "standard_fonts/", isEvalSupported: false }).promise;
  if (gen !== Z.gen || my !== Z.seq) { doc.destroy(); return; }
  const keep = $(".zscroll")?.scrollTop || 0;
  Z.pdf?.destroy?.(); Z.pdf = doc; Z.count = doc.numPages; Z.slide = Math.min(Z.slide, Z.count); Z.paras.clear(); Z.phov = null; cancelEdit();
  const box = pagesBox()!; box.innerHTML = ""; Z.pdfPages = [];
  const first = await doc.getPage(1), vp = first.getViewport({ scale: 1 });
  for (let i = 1; i <= doc.numPages; i++) { const w = document.createElement("div"); w.className = "zpgw"; const d = document.createElement("div"); d.className = "zpg"; d.dataset.p = String(i); d.style.aspectRatio = `${vp.width} / ${vp.height}`; w.appendChild(d); box.appendChild(w); Z.pdfPages.push(d); }
  Z.refresh = false; setLoad(false); relayout(); paintAll(); if (keep) { const sc = $(".zscroll"); if (sc) sc.scrollTop = keep; } if (quiet && Z.busy) setBusy(false);   // a new version of the report arrived: the helper is done
}
const pdfDone = new Map<string, boolean>();
let pdfIO: IntersectionObserver | null = null;
function pdfWidth() { const c = cv(); return Math.min(900, Math.max(200, (c?.clientWidth || 600) - pad() * 2)) * Z.zoom; }
function drawPdfPages() {
  if (!Z.pdf) return; const w = Math.round(pdfWidth()); pdfDone.clear();
  Z.pdfPages.forEach(d => { d.parentElement!.style.width = w + "px"; });
  pdfIO?.disconnect(); const io = pdfIO = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) void drawOne(e.target as HTMLElement, w); }), { root: $(".zscroll"), rootMargin: "500px 0px" });
  Z.pdfPages.forEach(p => io.observe(p));
}
async function drawOne(d: HTMLElement, w: number) {
  const n = +d.dataset.p!, key = `${n}:${w}`; if (pdfDone.get(key) || !Z.pdf) return; pdfDone.set(key, true);
  const gen = Z.gen, pg = await Z.pdf.getPage(n), v1 = pg.getViewport({ scale: 1 }), sc = (w / v1.width) * Math.min(2.5, devicePixelRatio || 1), vp = pg.getViewport({ scale: sc });
  const c = document.createElement("canvas"); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
  await pg.render({ canvasContext: c.getContext("2d")!, viewport: vp }).promise; if (gen !== Z.gen) return;
  d.style.aspectRatio = `${v1.width} / ${v1.height}`; d.querySelector("canvas")?.remove(); d.appendChild(c);
}
function pdfPageClick(n: number) {   // a page of a report is chosen as a whole: there are no parts of it to pick
  Z.slide = n; const f = Z.f!, label = chipLabel(Z.kind, n, Z.count, null);
  D().pin(D().pinKey(), { id: null, role: "zone", text: label, mr: -1, zone: { file: f.id, name: f.name, kind: Z.kind, slide: n, of: Z.count, slot: null, sel: null, label: "", text: "" } });
  Z.sel = { info: wholeInfo(n, "page"), r: null, slide: n };
  $$("#zcanvas .zpg").forEach(p => p.classList.toggle("on", +p.dataset.p! === n)); docPaint(); paintHead(); paintInsp(); paintStrip();
}

// ------------------------------------------------------------------------------------------------------------------------------------------------
// Painting: each part on its own
// ------------------------------------------------------------------------------------------------------------------------------------------------
function paintAll() { paintHead(); paintInsp(); paintStrip(); placeOverlay(); }
function saveState() { return Z.refresh ? "Updating the pages" : Z.saving > 0 ? "Saving" : Z.err ? Z.err : ""; }
function paintHead() {
  const h = $("[data-zp=head]"); if (!h) return; const f = Z.f!, k = Z.kind, noun = k === "deck" ? "slide" : "page";
  const ver = `v${Z.version}`, st = saveState();
  const present = k === "deck" ? `<button class="zbtn zsec" data-zact="present">${svg(IC.play, 15, 2)}<span>Present</span></button>` : k === "page" ? `<button class="zbtn zsec" data-zact="present">${svg(IC.full, 15)}<span>Full screen</span></button>` : `<a class="zbtn zsec" href="${esc(D().fileUrl(f.slug, f.id, true))}" download>${svg(IC.down, 15)}<span>Download</span></a>`;
  const ub = k === "report" ? "" : `<button class="zib zsec" data-zact="undo" aria-label="Undo" title="Undo"${Z.undo.length && !Z.busy ? "" : " disabled"}>${svg(IC.undo, 17)}</button><button class="zib zsec" data-zact="redo" aria-label="Redo" title="Redo"${Z.redo.length && !Z.busy ? "" : " disabled"}>${svg(IC.redo, 17)}</button>`;
  const vmenu = Z.menu === "ver" ? `<div class="zmenu" role="menu"><div class="zmv">Version ${Z.version} is open</div><button class="zmi" data-zact="restore"${Z.hasPrev ? "" : " disabled"}>${svg(IC.clock, 16)}<span>Restore the version before it</span></button></div>` : "";
  const verBtn = `<span class="zverw zsec"><button class="zver" data-zact="ver" aria-haspopup="menu" aria-expanded="${Z.menu === "ver"}" title="Versions of this file">${ver}</button>${vmenu}</span>`;
  const mi = (act: string, ic: string, label: string, off = false) => `<button class="zmi" data-zact="${act}"${off ? " disabled" : ""}>${svg(ic, 16, 1.9)}<span>${label}</span></button>`;
  const more = `<span class="zmorew"><button class="zib" data-zact="more" aria-label="More actions" aria-expanded="${Z.menu === "more"}" title="More">${svg(IC.more, 18)}</button>${Z.menu === "more" ? `<div class="zmenu" role="menu">${k === "report" ? "" : mi("undo", IC.undo, "Undo", !Z.undo.length || Z.busy) + mi("redo", IC.redo, "Redo", !Z.redo.length || Z.busy)}${mi("ver", IC.clock, `Versions, ${ver}`)}${mi("present", k === "deck" ? IC.play : k === "page" ? IC.full : IC.down, k === "deck" ? "Present" : k === "page" ? "Full screen" : "Download")}</div>` : ""}</span>`;
  const inspBtn = k !== "report" ? `<button class="zib zinspb${Z.drawer ? " on" : ""}" data-zact="insp" aria-label="Inspector" aria-expanded="${Z.drawer}" title="Inspector">${svg(IC.insp, 17)}</button>` : "";
  const chatBtn = `<button class="zib zchatb" data-zact="chat" aria-label="Show the chat" title="Show the chat">${svg(IC.chat, 17)}</button>`;
  const zoom = `<span class="zzoomw"><button class="zib sm" data-zact="zoom-" aria-label="Zoom out" title="Zoom out"${Z.zoom <= 0.5 ? " disabled" : ""}>${svg(IC.minus, 13, 2)}</button><button class="zzoom" data-zact="zoom0" data-zzoom title="Fit the canvas">${Math.round((geometry()?.s || 1) * 100)}%</button><button class="zib sm" data-zact="zoom+" aria-label="Zoom in" title="Zoom in"${Z.zoom >= 2 ? " disabled" : ""}>${svg(IC.plus, 13, 2)}</button></span>`;
  h.innerHTML = `${Z.chatOff && !phone() ? chatBtn : ""}<button class="zback" data-zact="back" title="Back to the task (Esc)" aria-label="Back to the task">${svg(IC.back, 18, 2)}<span>Task</span></button>
    <span class="zfile"><span class="zfi">${svg(KIND_IC[k], 16)}</span><b title="${esc(f.name)}">${esc(f.name)}</b><span class="zkind">${KIND_WORD[k]}${k !== "page" && Z.count > 1 ? ` · ${Z.count} ${noun}s` : ""}</span></span><span class="grow"></span>
    <span class="zsave" role="status" aria-live="polite">${esc(st)}</span>${zoom}${verBtn}${ub}${present}${inspBtn}${more}<button class="zbtn pri" data-sh="share|${esc(f.slug)}|${esc(f.id)}"${D().shareAttrs(f)}>${svg(IC.share, 15, 2)}<span>Share</span></button>`;
}
const hexOk = (c: string) => /^#[0-9a-f]{6}$/i.test(c);
function paintInsp() {
  const el = $("[data-zp=insp]"); if (!el) return; const f = Z.f!, s = Z.sel, k = Z.kind;
  const close = `<button type="button" class="zib sm zinspx" data-zact="insp" aria-label="Close the inspector">${svg(IC.x, 14, 2)}</button>`;
  const row = (l: string, inner: string) => `<div class="zir"><span class="zil">${l}</span><span class="zic">${inner}</span></div>`;
  const dis = Z.busy ? " disabled" : "";
  if (k === "doc") {
    const t = s && !isWhole(s) ? s.info.text : "", can = docEditable(f.name);
    el.innerHTML = `${close}<div class="zih"><b>${s ? `Page ${s.slide}` : "Document"}</b><span>${Z.count} ${Z.count === 1 ? "page" : "pages"}</span></div>
      ${t ? `<div class="zig"><p class="zquote">${esc(t.length > 280 ? t.slice(0, 279) + "…" : t)}</p>${can ? `<button class="zwide" data-zact="edit"${dis}>${svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>', 16)}<span>Edit text</span></button>` : ""}</div>` : ""}`; return;
  }
  if (k === "report") { el.innerHTML = `${close}<div class="zih"><b>${s ? `Page ${s.slide}` : "Report"}</b><span>${Z.count} ${Z.count === 1 ? "page" : "pages"}</span></div>`; return; }
  if (!s || isWhole(s)) {
    const bg = Z.cur ? slideBg() : "";
    el.innerHTML = `${close}<div class="zih"><b>${k === "deck" ? `Slide ${s?.slide || Z.slide}` : "Page"}</b><span>${k === "deck" ? `of ${Z.count}` : esc(f.name)}</span></div>
      <div class="zig"><h4>Background</h4>${row("Colour", `<label class="zfill"><input type="color" data-zbg value="${hexOk(bg) ? bg : "#ffffff"}"${dis} aria-label="Slide background colour"><i style="background:${hexOk(bg) ? bg : "transparent"}"></i>${hexOk(bg) ? bg.toUpperCase() : "Choose"}</label>`)}</div>
      ${k === "deck" && D().styleBtn(f) ? `<div class="zig"><h4>Style</h4>${D().styleBtn(f)}</div>` : ""}`;
    return;
  }
  const i = s.info, c = i.css, name = labelFor({ slot: i.t.slot, tag: i.tag, text: i.text });
  const kindWord = i.kind === "text" ? "Text" : i.kind === "image" ? "Picture" : "Shape";
  const sw = ["#1c1b19", "#ffffff", "#1d2fd1", "#c2410c", "#15803d"].map(x => `<button class="zsw" data-zact="color" data-c="${x}" style="--c:${x}" aria-label="Colour ${x}"${dis}></button>`).join("");
  const text = i.kind === "text";
  el.innerHTML = `${close}<div class="zih"><b>${esc(name)}</b><span>${kindWord}</span></div>
    ${text && i.edit ? `<div class="zig"><button class="zwide" data-zact="edit"${dis}>${svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>', 16)}<span>Edit text</span></button></div>` : ""}
    ${text ? `<div class="zig"><h4>Text</h4>${row("Size", `<span class="zstep"><button data-zact="size-" aria-label="Smaller"${dis}>${svg(IC.minus, 14, 2)}</button><b>${Math.round(c.fontSize)}</b><button data-zact="size+" aria-label="Bigger"${dis}>${svg(IC.plus, 14, 2)}</button></span>`)}
      ${row("Weight", `<span class="zseg"><button class="${c.fontWeight < 600 ? "on" : ""}" data-zact="weight" data-w="400"${dis}>Regular</button><button class="${c.fontWeight >= 600 ? "on" : ""}" data-zact="weight" data-w="700"${dis}>Bold</button></span>`)}
      ${row("Align", `<span class="zseg">${[["left", IC.al], ["center", IC.ac], ["right", IC.ar]].map(([a, ic]) => `<button class="${c.textAlign === a || (a === "left" && c.textAlign === "start") ? "on" : ""}" data-zact="align" data-a="${a}" aria-label="Align ${a}"${dis}>${svg(ic, 15)}</button>`).join("")}</span>`)}
      ${row("Colour", `<label class="zfill"><input type="color" data-zcolor value="${hexOk(c.color) ? c.color : "#000000"}"${dis} aria-label="Text colour"><i style="background:${hexOk(c.color) ? c.color : "transparent"}"></i>${hexOk(c.color) ? c.color.toUpperCase() : ""}</label>`)}
      <div class="zsws">${sw}</div></div>` : ""}
    ${i.kind === "image" ? `<div class="zig"><h4>Picture</h4><button class="zwide" data-zact="pickimg"${dis}>${svg(IC.image, 16)}<span>Replace the picture</span></button><input type="file" data-zpick accept="image/png,image/jpeg,image/webp,image/gif" hidden></div>` : ""}
    <div class="zig"><h4>Appearance</h4>${i.kind !== "image" ? row("Fill", `<label class="zfill"><input type="color" data-zfill value="${hexOk(c.bg) ? c.bg : "#ffffff"}"${dis} aria-label="Fill colour"><i class="${hexOk(c.bg) ? "" : "none"}" style="background:${hexOk(c.bg) ? c.bg : "transparent"}"></i>${hexOk(c.bg) ? c.bg.toUpperCase() : "None"}</label>`) : ""}
      ${row("Opacity", `<input type="range" class="zrange" data-zopacity min="0" max="100" value="${Math.round(c.opacity * 100)}"${dis} aria-label="Opacity"><span class="znum solo">${Math.round(c.opacity * 100)}%</span>`)}</div>
    <div class="zig"><h4>Size</h4>${row("Width", `<span class="znum">${c.w} px</span>`)}${row("Height", `<span class="znum">${c.h} px</span>`)}</div>`;
}
const slideBg = () => Z.bg;
function fitStrip() { /* the strip scrolls sideways; nothing to fit */ }
function paintStrip() {
  const el = $("[data-zp=strip]"); if (!el) return; const k = Z.kind;
  if (k === "page" || Z.count < 2) { el.innerHTML = ""; el.hidden = true; return; }
  el.hidden = false;
  const prev = el.scrollLeft, n = Z.count, items: string[] = [];
  for (let i = 1; i <= n; i++) items.push(`<button class="zth${i === Z.slide ? " on" : ""}" data-zth="${i}" aria-label="${k === "deck" ? "Slide" : "Page"} ${i}"${i === Z.slide ? ' aria-current="true"' : ""}><span class="zthi" data-zthi="${i}"></span><i>${i}</i></button>`);
  if (el.dataset.n === `${k}|${n}|${Z.version}|${Z.cur?.nonce || ""}`) { $$(".zth", el).forEach(b => { const on = +b.dataset.zth! === Z.slide; b.classList.toggle("on", on); on ? b.setAttribute("aria-current", "true") : b.removeAttribute("aria-current"); }); const b = $(".zth.on", el); b?.scrollIntoView({ inline: "nearest", block: "nearest" }); return; }
  el.dataset.n = `${k}|${n}|${Z.version}|${Z.cur?.nonce || ""}`; el.innerHTML = items.join(""); el.scrollLeft = prev;
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { io.unobserve(e.target); void thumb(e.target as HTMLElement); } }), { root: el, rootMargin: "200px" });
  $$("[data-zthi]", el).forEach(t => io.observe(t));
}
async function thumb(box: HTMLElement) {
  const i = +box.dataset.zthi!, gen = Z.gen;
  if (Z.kind === "deck") {
    const html = thumbDoc(Z.text, i - 1); if (!html) return;
    const w = box.clientWidth || 112, s = w / 1920; box.style.height = Math.round(1080 * s) + "px";
    const f = document.createElement("iframe"); f.className = "zthp"; f.setAttribute("sandbox", "allow-scripts"); f.setAttribute("tabindex", "-1"); f.setAttribute("aria-hidden", "true"); f.style.cssText = `width:1920px;height:1080px;transform:scale(${s})`; f.srcdoc = html; box.appendChild(f);
  } else if (Z.pdf) {
    const pg = await Z.pdf.getPage(i); if (gen !== Z.gen) return; const v1 = pg.getViewport({ scale: 1 }), w = box.clientWidth || 80, vp = pg.getViewport({ scale: (w / v1.width) * 2 });
    const c = document.createElement("canvas"); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height); c.style.cssText = "width:100%;display:block"; await pg.render({ canvasContext: c.getContext("2d")!, viewport: vp }).promise; if (gen === Z.gen) box.appendChild(c);
  }
}

// ------------------------------------------------------------------------------------------------------------------------------------------------
// Actions
// ------------------------------------------------------------------------------------------------------------------------------------------------
const STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2];
function setZoom(z: number) { Z.zoom = z; relayout(); paintHead(); }
function styleEdit(css: Record<string, string>) { if (Z.sel && !Z.busy) post("style", { css }); }
function wire(c: HTMLElement, insp: HTMLElement) {
  const act = (e: Event) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-zact]"); if (!b || (b as HTMLButtonElement).disabled) return false; const a = b.dataset.zact!;
    if (a !== "more" && a !== "ver" && Z.menu) { Z.menu = ""; paintHead(); }
    switch (a) {
      case "back": D().leave(); break;
      case "retry": Z.retry = true; setLoad(true); void load(); break;
      case "undo": undo(); break; case "redo": redo(); break;
      case "more": case "ver": Z.menu = Z.menu === a ? "" : (a as "more" | "ver"); paintHead(); break;
      case "restore": Z.menu = ""; paintHead(); restorePrevious(); break;
      case "present": present(); break;
      case "insp": Z.drawer = !Z.drawer; document.documentElement.classList.toggle("zinsp-open", Z.drawer); paintHead(); break;
      case "chat": setSplit(0, false); break;
      case "zoom-": setZoom(STEPS[Math.max(0, STEPS.indexOf(Z.zoom) - 1)] ?? 1); break;
      case "zoom+": setZoom(STEPS[Math.min(STEPS.length - 1, STEPS.indexOf(Z.zoom) + 1)] ?? 1); break;
      case "zoom0": setZoom(1); break;
      case "edit": if (Z.kind === "doc") { if (dsel) startEdit(dsel.page, dsel.i); } else post("edit"); break;
      case "size-": case "size+": if (Z.sel) { const cur = Z.sel.info.css.fontSize || 16, d = Math.max(1, Math.round(cur * 0.08)), n = Math.max(6, Math.round(cur + (a === "size+" ? d : -d))); styleEdit({ "font-size": n + "px" }); } break;
      case "weight": styleEdit({ "font-weight": b.dataset.w! }); break;
      case "align": styleEdit({ "text-align": b.dataset.a! }); break;
      case "color": styleEdit({ color: b.dataset.c! }); break;
      case "pickimg": $<HTMLInputElement>("[data-zpick]", insp)?.click(); break;
      default: return false;
    }
    return true;
  };
  c.addEventListener("click", e => {
    if (act(e)) { e.preventDefault(); return; }
    const t = (e.target as HTMLElement); const th = t.closest<HTMLElement>("[data-zth]"); if (th) { const n = +th.dataset.zth!; Z.slide = n; if (Z.kind === "deck") post("goto", { i: n - 1 }); else { pdfPageClick(n); $$("#zcanvas .zpg")[n - 1]?.scrollIntoView({ block: "start", behavior: reduced() ? "auto" : "smooth" }); } paintStrip(); paintHead(); return; }
    const pg = t.closest<HTMLElement>(".zpg[data-p]"); if (pg && Z.kind === "doc") { if (!t.closest(".zpedit")) void docClick(e as MouseEvent, pg); return; }
    if (pg && Z.kind === "report") { pdfPageClick(+pg.dataset.p!); return; }
    if (Z.menu && !t.closest(".zmenu,[data-zact=more],[data-zact=ver]")) { Z.menu = ""; paintHead(); }
  });
  insp.addEventListener("click", e => { if (act(e)) e.preventDefault(); });
  insp.addEventListener("input", e => {
    const t = e.target as HTMLInputElement;
    if (t.matches("[data-zopacity]")) { const n = $(".znum", insp); if (n) n.textContent = t.value + "%"; }
  });
  insp.addEventListener("change", e => {
    const t = e.target as HTMLInputElement;
    if (t.matches("[data-zcolor]")) styleEdit({ color: t.value });
    else if (t.matches("[data-zfill]")) styleEdit({ "background-color": t.value });
    else if (t.matches("[data-zopacity]")) styleEdit({ opacity: String(Math.round(+t.value) / 100) });
    else if (t.matches("[data-zbg]")) { if (!Z.busy) { Z.bg = t.value; post("bg", { value: t.value }); } }
    else if (t.matches("[data-zpick]") && t.files?.[0]) pickImage(t.files[0]);
    t.value = t.type === "file" ? "" : t.value;
  });
}
function pickImage(f: File) {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) { say("type"); return; } if (f.size > 4_000_000) { say("big"); return; }
  const r = new FileReader(); r.onload = () => { const d = String(r.result), b = d.slice(d.indexOf(",") + 1); post("image", { mime: f.type, data: b, name: f.name.slice(0, 120) }); }; r.readAsDataURL(f);
}
function onKey(e: KeyboardEvent) {
  if (!Z.mounted || e.defaultPrevented) return; const t = e.target as HTMLElement;
  const typing = !!t?.closest?.("input,textarea,select,[contenteditable]");
  if (e.key === "Escape" && !typing && !document.getElementById("fv") && !document.querySelector(".dsw.on,.shw.on,.dialog")) {
    if (document.getElementById("zpresent")) return;
    if (Z.menu) { Z.menu = ""; paintHead(); e.preventDefault(); return; }
    if (Z.sel) { setSel(null); e.preventDefault(); return; }
    e.preventDefault(); D().leave(); return;
  }
  if ((e.metaKey || e.ctrlKey) && !typing && !Z.editing && (e.key === "z" || e.key === "Z")) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
}

// ------------------------------------------------------------------------------------------------------------------------------------------------
// Present: the deck on its own, full screen, starting at the slide on the canvas (the deck's own keys and bar work there)
// ------------------------------------------------------------------------------------------------------------------------------------------------
function present() {
  if (isPdf()) return;
  const el = $<HTMLElement>("#zcanvas .zframe:not([style*='hidden'])") ; if (Z.kind === "page") { (Z.cur?.el || el)?.requestFullscreen?.().catch(() => {}); return; }
  const p = deckParts(Z.text); if (!p) return;
  const start = `(function(){var k=${Z.slide - 1};function go(){for(var i=0;i<k;i++)document.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}))}if(document.readyState==="complete")go();else addEventListener("load",go)})();`;
  const doc = p.doc.toLowerCase().lastIndexOf("</body>"), docx = doc < 0 ? p.doc + `<script>${start}</script>` : p.doc.slice(0, doc) + `<script>${start}</script>` + p.doc.slice(doc);
  const html = p.pre + asJs(docx) + p.post;
  document.getElementById("zpresent")?.remove();
  const o = document.createElement("div"); o.id = "zpresent"; o.innerHTML = `<iframe title="${esc(Z.f!.name)}" sandbox="allow-scripts allow-popups" allow="fullscreen" referrerpolicy="no-referrer"></iframe><button type="button" class="zpx" aria-label="Close the presentation" title="Close (Esc)">${svg(IC.x, 18, 2)}</button>`;
  document.body.appendChild(o); const fr = $<HTMLIFrameElement>("iframe", o)!; fr.srcdoc = html; fr.addEventListener("load", () => fr.focus());
  const close = () => { document.removeEventListener("fullscreenchange", fsc); window.removeEventListener("keydown", esc2, true); o.remove(); if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); };
  const fsc = () => { if (!document.fullscreenElement) close(); }, esc2 = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
  $(".zpx", o)!.addEventListener("click", close); document.addEventListener("fullscreenchange", fsc); window.addEventListener("keydown", esc2, true);
  o.requestFullscreen?.().catch(() => { /* the overlay still covers the window */ });
}

// ------------------------------------------------------------------------------------------------------------------------------------------------
// The divider between the chat and the canvas (A): drag, keyboard, double-click to reset, a width remembered for this viewer
// ------------------------------------------------------------------------------------------------------------------------------------------------
const CANVAS_MIN = () => Math.min(460, innerWidth * 0.56);
const splitMax = () => Math.max(SPLIT_MIN, Math.min(640, innerWidth - (mid() ? 30 : 40) - (mid() ? 0 : 280) - CANVAS_MIN()));
function loadSplit() { Z.chatW = 0; Z.chatOff = false; try { const o = JSON.parse(localStorage.getItem(SPLIT_KEY) || "null"); if (o) { if (typeof o.w === "number" && o.w >= SPLIT_MIN) Z.chatW = o.w; Z.chatOff = !!o.off; } } catch { /* no storage */ } }
function saveSplit() { try { if (!Z.chatW && !Z.chatOff) localStorage.removeItem(SPLIT_KEY); else localStorage.setItem(SPLIT_KEY, JSON.stringify({ w: Z.chatW, off: Z.chatOff })); } catch { /* no storage */ } }
const chatEl = () => document.getElementById("stage");
function applySplit() {
  const h = document.documentElement; if (Z.chatW) h.style.setProperty("--zchw", Z.chatW + "px"); else h.style.removeProperty("--zchw");
  h.classList.toggle("zchat-off", Z.chatOff && !phone());   // a phone has no divider: the chat is always there
  const d = document.getElementById("zdiv"), cur = Z.chatOff ? 0 : Math.round(chatEl()?.getBoundingClientRect().width || Z.chatW || SPLIT_MIN);
  if (d) { d.setAttribute("aria-valuemin", "0"); d.setAttribute("aria-valuemax", String(splitMax())); d.setAttribute("aria-valuenow", String(cur)); d.setAttribute("aria-valuetext", Z.chatOff ? "Chat hidden" : `Chat ${cur} px wide`); }
}
function setSplit(w: number, off: boolean, save = true) {
  const was = Z.chatOff; if (w) Z.chatW = Math.round(Math.max(SPLIT_MIN, Math.min(splitMax(), w))); Z.chatOff = off;
  applySplit(); if (was !== off) paintHead(); if (save) saveSplit(); requestAnimationFrame(relayout);
}
function resetSplit() { Z.chatW = 0; Z.chatOff = false; applySplit(); paintHead(); saveSplit(); requestAnimationFrame(relayout); }
function wireSplit(h: HTMLElement) {
  let drag: { x: number; w: number } | null = null, raf = 0, lastX = 0, lastDown = 0;
  const move = () => { raf = 0; if (!drag) return; const raw = drag.w + lastX - drag.x; if (Z.chatOff) { if (raw >= SPLIT_ON) setSplit(raw, false, false); } else if (raw < SPLIT_OFF) setSplit(0, true, false); else setSplit(raw, false, false); };
  h.addEventListener("pointerdown", e => { if (e.button !== 0) return; e.preventDefault(); if (e.timeStamp - lastDown < 350) { lastDown = 0; resetSplit(); return; } lastDown = e.timeStamp; h.setPointerCapture(e.pointerId); drag = { x: e.clientX, w: Z.chatOff ? 0 : chatEl()!.getBoundingClientRect().width }; lastX = e.clientX; document.documentElement.classList.add("zdragging"); });
  h.addEventListener("pointermove", e => { if (!drag) return; lastX = e.clientX; if (!raf) raf = requestAnimationFrame(move); });
  const end = () => { if (!drag) return; drag = null; if (raf) { cancelAnimationFrame(raf); raf = 0; } document.documentElement.classList.remove("zdragging"); applySplit(); saveSplit(); };
  h.addEventListener("pointerup", end); h.addEventListener("pointercancel", end); h.addEventListener("lostpointercapture", end); h.addEventListener("dblclick", resetSplit);
  h.addEventListener("keydown", e => {
    const cur = Z.chatOff ? 0 : chatEl()!.getBoundingClientRect().width, step = e.shiftKey ? 64 : 16;
    if (e.key === "ArrowLeft") { e.preventDefault(); if (Z.chatOff) return; if (cur - step < SPLIT_MIN) setSplit(0, true); else setSplit(cur - step, false); }
    else if (e.key === "ArrowRight") { e.preventDefault(); if (Z.chatOff) setSplit(Z.chatW || SPLIT_MIN, false); else setSplit(cur + step, false); }
    else if (e.key === "Home") { e.preventDefault(); setSplit(0, true); } else if (e.key === "End") { e.preventDefault(); setSplit(splitMax(), false); } else if (e.key === "Enter") { e.preventDefault(); resetSplit(); }
    else return; h.focus();
  });
  addEventListener("resize", () => { if (Z.mounted) applySplit(); });
}
// On a phone the canvas sits above the chat; the chat starts below it.
function phoneVars() { const c = document.getElementById("zcanvas"); if (!c) return; document.documentElement.style.setProperty("--zph", phone() ? c.getBoundingClientRect().height + "px" : "0px"); }


// ------------------------------------------------------------------------------------------------------------------------------------------------
// Word documents: paragraphs on the page pictures. Click selects one (it goes to the helper like a deck's element), double-click types over it.
// The page text comes from pdf.js; zone-docpara.ts turns it into paragraphs. A change is sent as { op: "text", page, was, n, text }: the server
// (1HC src/zone-docx.js) finds the paragraph in word/document.xml by its text (n = which copy of the same text) and changes only what differs.
// ------------------------------------------------------------------------------------------------------------------------------------------------
let dsel: { page: number; i: number } | null = null;
async function pageParas(n: number) {
  const have = Z.paras.get(n); if (have) return have;
  const pdf = Z.pdf; if (!pdf || n < 1 || n > Z.count) return null;
  const pg = await pdf.getPage(n), vp = pg.getViewport({ scale: 1 }), tc = await pg.getTextContent(); if (pdf !== Z.pdf) return null;
  const v = { ps: paragraphsOf(tc.items as TItem[], vp.height), w: vp.width, h: vp.height }; Z.paras.set(n, v); return v;
}
/** How many paragraphs with exactly this text come before the one at (page, i): the server uses it to pick the right copy. */
async function occBefore(text: string, page: number, i: number) {
  let n = 0; for (let p = 1; p <= page; p++) { const v = await pageParas(p); if (!v) break; v.ps.forEach((q, j) => { if ((p < page || j < i) && q.text === text) n++; }); }
  return n;
}
function docPaint() {
  if (Z.kind !== "doc") return;
  for (const e of $$(".zdh,.zds", document.getElementById("zcanvas") || document)) e.remove();
  if (!Z.sel || isWhole(Z.sel)) dsel = null;
  const box = (cls: string, page: number, i: number) => {
    const v = Z.paras.get(page), pg = Z.pdfPages[page - 1], q = v?.ps[i]; if (!v || !pg || !q) return;
    const e = document.createElement("div"); e.className = cls; e.style.cssText = `left:${(q.l - 2) / v.w * 100}%;top:${(q.t - 1) / v.h * 100}%;width:${(q.r - q.l + 4) / v.w * 100}%;height:${(q.b - q.t + 2) / v.h * 100}%`; pg.appendChild(e);
  };
  if (dsel && !Z.busy) box("zds", dsel.page, dsel.i);
  if (Z.phov && !Z.busy && !Z.edit && !(dsel && dsel.page === Z.phov.page && dsel.i === Z.phov.i)) box("zdh", Z.phov.page, Z.phov.i);
}
async function paraUnder(e: MouseEvent, pg: HTMLElement) {
  const n = +pg.dataset.p!, v = Z.paras.get(n) || await pageParas(n); if (!v) return null;
  const r = pg.getBoundingClientRect(), k = v.w / Math.max(1, r.width), i = paraAt(v.ps, (e.clientX - r.left) * k, (e.clientY - r.top) * k, 3 * k);
  return { n, i, v };
}
async function docClick(e: MouseEvent, pg: HTMLElement) {
  if (Z.busy || Z.edit) return; const hit = await paraUnder(e, pg); if (!hit) return;
  if (hit.i < 0) { dsel = null; pdfPageClick(hit.n); return; }
  docSelect(hit.n, hit.i);
}
function docSelect(page: number, i: number) {
  const q = Z.paras.get(page)?.ps[i]; if (!q) return;
  Z.slide = page; dsel = { page, i };
  $$("#zcanvas .zpg").forEach(p => p.classList.remove("on"));
  setSel({ info: { t: { slide: page, sel: "0" }, path: null, tag: "p", text: q.text, kind: "text", edit: docEditable(Z.f!.name), css: { fontSize: 0, fontWeight: 0, color: "", textAlign: "", bg: "", opacity: 1, w: 0, h: 0 } }, r: null, slide: page });
  paintStrip();
}
function wireDoc(c: HTMLElement) {
  c.addEventListener("pointermove", e => {
    if (Z.kind !== "doc" || Z.busy || Z.edit) return; const pg = (e.target as HTMLElement).closest<HTMLElement>(".zpg[data-p]");
    if (!pg) { if (Z.phov) { Z.phov = null; docPaint(); } return; }
    void paraUnder(e, pg).then(h => { if (!h || Z.busy || Z.edit) return; const was = Z.phov; Z.phov = h.i >= 0 ? { page: h.n, i: h.i } : null; pg.style.cursor = h.i >= 0 ? "text" : "default"; if (was?.page !== Z.phov?.page || was?.i !== Z.phov?.i) docPaint(); });
  });
  c.addEventListener("pointerleave", () => { if (Z.kind === "doc" && Z.phov) { Z.phov = null; docPaint(); } });
  c.addEventListener("dblclick", e => {
    if (Z.kind !== "doc" || Z.busy || Z.edit) return; const pg = (e.target as HTMLElement).closest<HTMLElement>(".zpg[data-p]"); if (!pg) return;
    void paraUnder(e, pg).then(h => { if (h && h.i >= 0 && !Z.busy && !Z.edit) { docSelect(h.n, h.i); startEdit(h.n, h.i); } });
  });
}
function startEdit(page: number, i: number) {
  if (Z.kind !== "doc" || Z.busy) return;
  if (!docEditable(Z.f!.name)) { D().note("Only the helper can change this file", `A .docx file can be edited here. Ask ${D().who(Z.f!.slug)} to change this one.`); return; }
  cancelEdit(); const v = Z.paras.get(page), pg = Z.pdfPages[page - 1], q = v?.ps[i]; if (!v || !pg || !q) return;
  const ta = document.createElement("textarea"); ta.className = "zpedit"; ta.value = (q.marker ? q.marker + " " : "") + q.text; ta.setAttribute("aria-label", "Type over the paragraph. Enter saves, Escape cancels."); ta.rows = 1;
  const k = pg.clientWidth / v.w, fs = q.lines[0].fs, pitch = q.lines.length > 1 ? Math.max(fs, q.lines[1].y - q.lines[0].y) : fs * 1.25;
  const right = Math.max(q.r, ...v.ps.map(x => x.r));   // as wide as the page's text, so a retyped line wraps where the page's would
  ta.style.cssText = `left:${(q.l - 3) / v.w * 100}%;top:${(q.t - 3) / v.h * 100}%;width:${(right - q.l + 8) / v.w * 100}%;font-size:${(fs * k).toFixed(2)}px;line-height:${(pitch * k).toFixed(2)}px;min-height:${((q.b - q.t + 6) * k).toFixed(1)}px`;
  const fit = () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + 2 + "px"; };
  let done = false; const end = (save: boolean) => { if (done) return; done = true; if (Z.edit?.ta === ta) { Z.edit = null; Z.editing = false; } ta.remove(); if (save) commitEdit(page, i, ta.value); docPaint(); };
  ta.addEventListener("input", fit); ta.addEventListener("blur", () => end(true));
  ta.addEventListener("keydown", ev => { if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); end(true); } else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); end(false); } });
  (ta as any)._end = end; pg.appendChild(ta); Z.edit = { page, i, ta }; Z.editing = true; Z.phov = null; docPaint(); fit(); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
}
function cancelEdit() { const ta = Z.edit?.ta as any; if (ta) { ta._end?.(false); } Z.edit = null; Z.editing = false; }
function commitEdit(page: number, i: number, raw: string) {
  const q = Z.paras.get(page)?.ps[i]; if (!q) return; const text = norm(splitMarker(raw).text);
  if (!text) { D().note("Nothing to save", `Type some text, or ask ${D().who(Z.f!.slug)} to remove the paragraph.`); return; }
  if (text === q.text) return;
  void docSave(page, i, q.text, text);
}
async function docSave(page: number, i: number, was: string, text: string) {
  const gen = Z.gen, n = await occBefore(was, page, i), n2 = await occBefore(text, page, i); if (gen !== Z.gen) return;
  const e: DocEdit = { op: "text", page, was, n, text }, un: DocEdit = { op: "text", page, was: text, n: n2, text: was };
  setSel(null);
  await enqueue(async () => {
    if (!(await sendEdits([e]))) return;
    Z.undo.push({ edit: e, undo: un, label: "Edited text" }); if (Z.undo.length > 40) Z.undo.shift(); Z.redo = [];
    await load(true);
  });
}
