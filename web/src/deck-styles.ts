// Deck styles (1HC src/deck-styles.js, thumbnails in /app-static/deck-styles/, made by scripts/build-deck-style-thumbs.mjs).
//  · A delivered HTML deck (its Library file carries the tag "deck") gets a quiet "Change style" button on its file card. It opens a sheet
//    with every template: its cover and a content slide, its name and its one-line feel. A tap sends the person's own message into that
//    task ("Restyle the deck "x.html" in the coral template.") and the helper restyles it.
//  · The helper's show_deck_styles tool puts the same picker in the chat as a card (stream event deck_styles). A tap sends "Use the coral style."
//  · A tap on a tile first opens a focused preview in the same sheet or card (its two slides large, its name and feel, and Back / Use this).
//    Nothing is sent until "Use this".
// Nothing here remembers a style: the message is all that happens. v3.ts hooks in with dsInit(), dsBtn(), dsCardHtml() and dsIsDeck().
type Style = { name: string; title: string; feel: string; use: string; scheme: string; cover: string; project: string; coverLarge?: string; projectLarge?: string };
type Deps = { send: (slug: string, sid: string | null, text: string) => void };
let D: Deps | null = null;
let STYLES: Style[] | null = null, LOADING: Promise<void> | null = null, FAILED = false;
const BASE = "/app-static/deck-styles/";
const esc = (s: any = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const PAL = '<circle cx="13.5" cy="6.5" r="1" fill="currentColor"/><circle cx="17.5" cy="10.5" r="1" fill="currentColor"/><circle cx="8.5" cy="7.5" r="1" fill="currentColor"/><circle cx="6.5" cy="12.5" r="1" fill="currentColor"/><path d="M12 2a10 10 0 1 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.4-.3-.4-.5-.9-.5-1.4 0-1.1.9-2 2-2h2.4a4.6 4.6 0 0 0 4.6-4.6C22 6 17.5 2 12 2z"/>';
const X = '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>';
const svg = (d: string, s: number) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export function dsInit(d: Deps) { D = d; }
/** A delivered HTML deck: its Library file is tagged "deck" by the server when share_file gives the files make_deck.sh built. */
export const dsIsDeck = (f: { name?: string; tags?: string[] }) => /\.html?$/i.test(f?.name || "") && !!f?.tags?.includes("deck");
/** The attribute that makes an element open the style sheet for a deck (used by the Zone's inspector, which has its own button). */
export const dsAttr = (slug: string, f: { id: string; name: string; session?: string | null }) => `data-dsopen="${esc(slug)}|${esc(f.id)}|${esc(f.session ?? "")}|${esc(f.name)}"`;
/** The quiet action on a deck's file card (same size and look as the card's share and download buttons). */
export const dsBtn = (slug: string, f: { id: string; name: string; session?: string | null; tags?: string[] }) => dsIsDeck(f)
  ? `<span class="fsh dsb" role="button" tabindex="0" data-dsopen="${esc(slug)}|${esc(f.id)}|${esc(f.session ?? "")}|${esc(f.name)}" aria-label="Change style of ${esc(f.name)}" title="Change style">${svg(PAL, 16)}</span>` : "";

function load(): Promise<void> {
  if (STYLES || LOADING) return LOADING || Promise.resolve();
  return LOADING = fetch(BASE + "index.json").then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
    .then((j) => { STYLES = (j.templates || []) as Style[]; FAILED = false; }).catch(() => { FAILED = true; }).finally(() => { LOADING = null; });
}
const tile = (s: Style, picked: string) => `<button type="button" class="dst${picked === s.name ? " on" : ""}" data-dspick="${esc(s.name)}" aria-pressed="${picked === s.name}" title="${esc(s.title)}: ${esc(s.feel)}">
  <span class="dsth ${esc(s.scheme)}"><img src="${BASE}${esc(s.cover)}" alt="" width="480" height="270" loading="lazy" decoding="async"><img src="${BASE}${esc(s.project)}" alt="" width="480" height="270" loading="lazy" decoding="async"></span>
  <span class="dsn"><b>${esc(s.title)}</b><small>${esc(s.feel)}</small></span></button>`;
const gridHtml = (picked = "") => STYLES ? `<div class="dsg">${STYLES.map((s) => tile(s, picked)).join("")}</div>` : FAILED ? `<p class="dsx">The styles didn't load. <button type="button" class="dsretry" data-dsretry>Try again</button></p>` : `<div class="dsg dsw0" aria-hidden="true">${"<i></i>".repeat(8)}</div>`;

// ---- The card the helper shows in the chat ----
const CARDS = new Map<string, string>();   // card key -> the style tapped last (only so the tapped tile stays marked)
/** c: the card ({t:"deckstyles", id}); ch/sid: where it sits. */
export function dsCardHtml(c: { id?: string }, slug: string, sid: string | null) {
  const key = `${slug}|${sid ?? ""}|${c.id ?? ""}`;
  if (!STYLES && !FAILED) void load().then(() => refreshCards());
  return `<div class="acard gu-sys dscard" data-dsctx="${esc(key)}" data-dsmode="use"><div class="gu-sh"><span class="gu-si">${svg(PAL, 18)}</span><b>Deck styles</b></div><div class="dsbox">${gridHtml(CARDS.get(key) || "")}</div></div>`;
}
function refreshCards() {
  document.querySelectorAll<HTMLElement>(".dscard").forEach((el) => { const box = el.querySelector<HTMLElement>(".dsbox"); if (box && !box.dataset.dsprev) box.innerHTML = gridHtml(CARDS.get(el.dataset.dsctx || "") || ""); });
  const pop = document.querySelector<HTMLElement>(".dsp .dsbody"); if (pop && !pop.dataset.dsprev) pop.innerHTML = gridHtml();
}

// ---- The focused preview: replaces the grid inside the same scroller, which keeps its height so nothing jumps ----
const SAVED = new WeakMap<HTMLElement, { html: string; top: number; name: string }>();
const holder = (from: HTMLElement) => from.closest<HTMLElement>(".dsbody,.dsbox");
function dsPreview(box: HTMLElement, name: string) {
  const s = STYLES?.find((x) => x.name === name); if (!s) return;
  SAVED.set(box, { html: box.innerHTML, top: box.scrollTop, name });
  box.style.height = box.clientHeight + "px"; box.dataset.dsprev = name;
  box.innerHTML = `<div class="dspv"><div class="dspvi"><div class="dspvg"><img src="${BASE}${esc(s.coverLarge || s.cover)}" alt="${esc(s.title)}, cover slide" width="960" height="540" decoding="async"><img src="${BASE}${esc(s.projectLarge || s.project)}" alt="${esc(s.title)}, project slide" width="960" height="540" decoding="async"></div></div>
    <div class="dspvn"><b>${esc(s.title)}</b><small>${esc(s.feel)}</small></div>
    <div class="dspva"><button type="button" class="dsbk" data-dsback>Back</button><button type="button" class="dsuse" data-dsuse="${esc(s.name)}">Use this</button></div></div>`;
  box.scrollTop = 0; box.querySelector<HTMLElement>(".dsuse")!.focus({ preventScroll: true });
}
function dsBack(box: HTMLElement) {
  const v = SAVED.get(box); if (!v) return; SAVED.delete(box);
  box.innerHTML = v.html; box.style.height = ""; delete box.dataset.dsprev; box.scrollTop = v.top;
  box.querySelector<HTMLElement>(`[data-dspick="${CSS.escape(v.name)}"]`)?.focus({ preventScroll: true });
}

// ---- The sheet opened from a deck's file card ----
let OPEN: { el: HTMLElement; prev: HTMLElement | null; slug: string; sid: string | null; file: string } | null = null;
export function dsClose() {
  if (!OPEN) return; const { el, prev } = OPEN; OPEN = null; el.classList.remove("on"); setTimeout(() => el.remove(), 220);
  if (prev?.isConnected) prev.focus({ preventScroll: true });
}
function dsOpen(slug: string, fid: string, sid: string, name: string, from: HTMLElement | null) {
  if (OPEN) dsClose();
  const el = document.createElement("div"); el.className = "dsw";
  el.innerHTML = `<div class="dsback" data-dsx></div><div class="dsp" role="dialog" aria-modal="true" aria-labelledby="dstt" tabindex="-1"><span class="dsgrab" aria-hidden="true"></span>
    <div class="dshead"><div><h2 id="dstt">Change style</h2><p>${esc(name)}</p></div><button type="button" class="dsclose" data-dsx aria-label="Close">${svg(X, 18)}</button></div>
    <div class="dsbody">${gridHtml()}</div></div>`;
  document.body.appendChild(el); OPEN = { el, prev: from, slug, sid: sid || null, file: name };
  if (!STYLES) void load().then(() => refreshCards());
  void el.offsetWidth; el.classList.add("on"); el.querySelector<HTMLElement>(".dsp")!.focus({ preventScroll: true });
}

let wired = false;
export function dsWire() {
  if (wired) return; wired = true;
  document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const o = t.closest<HTMLElement>("[data-dsopen]"); if (o) { e.preventDefault(); e.stopPropagation(); const [slug, fid, sid, ...name] = o.dataset.dsopen!.split("|"); dsOpen(slug, fid, sid, name.join("|"), o); return; }
    if (t.closest("[data-dsx]")) { dsClose(); return; }
    if (t.closest("[data-dsretry]")) { FAILED = false; void load().then(refreshCards); return; }
    const bk = t.closest<HTMLElement>("[data-dsback]"); if (bk) { e.preventDefault(); const b = holder(bk); if (b) dsBack(b); return; }
    const pk = t.closest<HTMLElement>("[data-dspick]"); if (pk) { e.preventDefault(); const b = holder(pk); if (b) dsPreview(b, pk.dataset.dspick!); return; }
    const p = t.closest<HTMLElement>("[data-dsuse]"); if (!p || !D) return;
    e.preventDefault(); const name = p.dataset.dsuse!;
    if (OPEN) { const { slug, sid, file } = OPEN; dsClose(); D.send(slug, sid, `Restyle the deck "${file}" in the ${name} template.`); return; }
    const card = p.closest<HTMLElement>(".dscard"); if (!card) return;
    const key = card.dataset.dsctx!, [slug, sid] = key.split("|"); CARDS.set(key, name); refreshCards(); D.send(slug, sid || null, `Use the ${name} style.`);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { const pv = (e.target as HTMLElement)?.closest?.<HTMLElement>("[data-dsprev]") || (OPEN ? OPEN.el.querySelector<HTMLElement>("[data-dsprev]") : null); if (pv) { e.preventDefault(); e.stopImmediatePropagation(); dsBack(pv); return; } }
    if (OPEN && e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); dsClose(); return; }
    const t = e.target as HTMLElement; if ((e.key === "Enter" || e.key === " ") && t?.matches?.("[data-dsopen]")) { e.preventDefault(); t.click(); }
  }, true);
}
