// Image generation in the composer and the chat.
// Composer: "Create an image" in the + panel pins a bar above the composer ("Creating an image") and the next send carries image:true.
// Suggestion: when the task is not in image mode, a send first asks POST /image-intent; if it says ask, nothing is sent and a bar offers
// Yes / No / Don't ask again. A slow or failed answer (3 s) sends normally. The helper's own "image_offer" question uses the same bar.
// Chat: an image_gen card shows 1 to 3 slots at the image size. A working slot runs img-fx (public/v3/zone/imgfx.js, loaded on demand);
// when the files arrive the effect dissolves into the picture, then the slot is the ordinary file tile (opens like any image file).
// Everything stays hidden when boot image_ok is false (BYOK). v3.ts supplies the deps; the pure parts are tested in test/image-gen.test.mjs.
import { cbAdd, cbBar, cbPaint } from "../composer-bars";

export type IgWhere = { key: string; slug: string; sid: string | null; mode: "on" | "dismissed" | null };
export type IgOffer = { question_id: string; source_turn: string };
type Deps = {
  api: (path: string, body?: any, o?: { signal?: AbortSignal }) => Promise<any>;
  ok: () => boolean;                       // boot image_ok
  where: () => IgWhere | null;             // the composer in view (null: none)
  offer: () => IgOffer | null;             // the open task's pending image_offer question
  answer: (q: IgOffer, text: "yes" | "no" | "dismiss") => void;
  resubmit: () => void;                    // the composer's send, once more
  setMode: (slug: string, sid: string, mode: "on" | "dismissed" | null) => void;
  v: () => string;                         // app version for the lazily loaded effect
};
let D: Deps | null = null;
export const IG_WAIT_MS = 3000;
const PEND = new Set<string>();            // composer keys with "Creating an image" chosen
let ASK: { key: string; text: string } | null = null;
let PASS: { image: boolean } | null = null;
const HOME_OFF = new Set<string>();        // Home composer, "Don't ask again" (no task exists yet to remember it)
const ic = (d: string) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const IG_ICON = ic('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.6"/><path d="m21 15-4.5-4.5L6 21"/>');
const here = () => (D?.ok() ? D.where() : null);

// ---------- pure helpers ----------
// Which sends ask first: an image-capable account, no image mode yet, nothing chosen, a real message, and a plain send.
export function igShouldAsk(o: { ok: boolean; mode: "on" | "dismissed" | null; pending: boolean; homeOff: boolean; text: string; sl: string }) {
  return o.ok && o.mode === null && !o.pending && !o.homeOff && o.sl === "send" && o.text.trim().length > 0;
}
export const igCount = (n: unknown) => Math.max(1, Math.min(3, Math.round(Number(n)) || 1));
// One slot's state from the card: a file means done; no file once the card is finished means failed; else working.
export function igSlotState(status: string, hasFile: boolean): "working" | "done" | "failed" {
  if (hasFile) return "done";
  return status === "working" ? "working" : "failed";
}

// ---------- composer ----------
export function igInit(d: Deps) {
  D = d;
  cbAdd({ id: "ig-make", order: 40, html: () => { const w = here(); if (!w || !PEND.has(w.key) || w.mode === "on") return "";
    return cbBar({ id: "ig-make", icon: IG_ICON, title: "Creating an image", close: "cancel", closeLabel: "Cancel creating an image" }); },
    act: () => { const w = here(); if (w) PEND.delete(w.key); cbPaint(); focusBox(); } });
  cbAdd({ id: "ig-ask", order: 41, html: () => { const w = here(); return w && ASK && ASK.key === w.key ? askBar("ig-ask") : ""; },
    act: a => { const w = here(), t = ASK; if (!w || !t || t.key !== w.key) return; ASK = null;
      if (a === "dismiss") { if (w.sid) { D!.setMode(w.slug, w.sid, "dismissed"); D!.api(`/res/${w.slug}/sessions/${w.sid}/image-mode`, { mode: "dismissed" }).catch(() => {}); } else igRememberHomeOff(w.slug); }
      PASS = { image: a === "yes" }; cbPaint(); D!.resubmit(); } });
  cbAdd({ id: "ig-offer", order: 42, html: () => (here() && D!.offer() ? askBar("ig-offer") : ""),
    act: a => { const q = D!.offer(); if (q && (a === "yes" || a === "no" || a === "dismiss")) { D!.answer(q, a); setTimeout(cbPaint, 0); } } });
  // The suggestion goes away when the box is emptied (nothing left to send).
  document.addEventListener("input", e => { const t = e.target as HTMLTextAreaElement; if (t.id === "box" && ASK && !t.value.trim()) { ASK = null; cbPaint(); } });
  wireFx();
}
const askBar = (id: string) => cbBar({ id, icon: IG_ICON, title: "Do you want to generate an image?", actions: [{ k: "yes", label: "Yes", primary: true }, { k: "no", label: "No" }, { k: "dismiss", label: "Don't ask again" }] });
const focusBox = () => { const b = document.getElementById("box") as HTMLTextAreaElement | null; if (b && !matchMedia("(hover:none)").matches) b.focus({ preventScroll: true }); };
// The + panel's row. Hidden on BYOK, for tasks already in image mode, and in the new-task dialog.
export function igMenuHtml(key: string) {
  const w = here(); if (key !== "box" || !w || w.mode === "on") return "";
  const on = PEND.has(w.key);
  return `<button type="button" class="igmk${on ? " on" : ""}" data-igmake aria-pressed="${on}"><span class="igmi">${IG_ICON}</span><span>Create an image</span></button>`;
}
export function igToggle() { const w = here(); if (!w) return; if (PEND.has(w.key)) PEND.delete(w.key); else PEND.add(w.key); cbPaint(); }
// Called by the submit handler before anything is taken from the composer. Returns what to send now. When the message needs the image
// request check, the result also carries `check`: a promise that settles (3 s at most) with true when the person should be asked first.
// The send handler clears the box and shows the message at once and holds the real send until `check` settles, so the check never keeps the text in the box.
export function igGate(text: string, sl: string, hasFiles = false): { image: boolean; check?: Promise<boolean> } {
  const w = here(); if (!w || sl !== "send" || (!text.trim() && !hasFiles)) return { image: false };
  const chosen = PEND.has(w.key);
  if (PASS) { const p = PASS; PASS = null; if (chosen) { PEND.delete(w.key); cbPaint(); } return { image: p.image || chosen }; }
  if (chosen && w.mode !== "on") { PEND.delete(w.key); cbPaint(); return { image: true }; }
  if (!igShouldAsk({ ok: true, mode: w.mode, pending: chosen, homeOff: !w.sid && HOME_OFF.has(w.slug), text, sl })) return { image: false };
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), IG_WAIT_MS);
  const check = D!.api("/image-intent", { channel: w.slug, session: w.sid, text }, { signal: ctl.signal }).then(r => r?.ask === true, () => false).finally(() => clearTimeout(t));
  return { image: false, check };
}
// The check said to ask: the bar shows above the composer for this composer key (the message was taken back out of the thread).
export function igAskFor(key: string, text: string) { const w = here(); ASK = { key, text }; if (w && w.key === key) cbPaint(); }
// "Don't ask again" was chosen in this channel before any task existed (Home): a task made from any composer in the channel carries it, so the server starts it dismissed.
export const igHomeOff = (slug: string) => HOME_OFF.has(slug);
export const igRememberHomeOff = (slug: string) => { HOME_OFF.add(slug); };
// A send went out: the chosen bar and any suggestion are done.
export const igSent = () => { const w = here(); if (w) { PEND.delete(w.key); ASK = null; cbPaint(); } };

// ---------- chat card ----------
// The card's slots as HTML. h.tile(file) is the file's ordinary tile (v3.ts fileCard); h.url(file) its picture address.
export function igCardHtml(c: { id?: string; n?: number; status?: string; files?: any[] }, h: { tile: (f: any) => string; url: (f: any) => string }) {
  const n = igCount(c.n), id = String(c.id || "ig").replace(/[^\w:.-]/g, ""), files = Array.isArray(c.files) ? c.files : [];
  const slot = (i: number) => { const f = files[i], st = igSlotState(String(c.status || "working"), !!f);
    return `<div class="ig-slot" data-igfx="${id}:${i}" data-igs="${st}" data-igu="${f ? h.url(f).replace(/"/g, "&quot;") : ""}"${st === "working" ? ' aria-busy="true" aria-label="Creating an image"' : ""}><div class="ig-fx"></div><div class="ig-real">${f ? h.tile(f) : ""}</div></div>`; };
  return `<div class="igcard n${n}" role="group" aria-label="${n === 1 ? "Generated image" : "Generated images"}">${Array.from({ length: n }, (_, i) => slot(i)).join("")}</div>`;
}

// ---------- the effect ----------
type Rec = { fx: any; host: HTMLElement; done: boolean };
const FX = new Map<string, Rec>();
let mod: Promise<any> | null = null;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const webgl = () => { try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; } };
const dark = () => document.documentElement.dataset.theme === "dark" || (document.documentElement.dataset.theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
const loadFx = () => mod ||= import(/* @vite-ignore */ new URL(`./zone/imgfx.js?v=${encodeURIComponent(D?.v() || "")}`, import.meta.url).href);
function stop(key: string, soft: boolean) {
  const r = FX.get(key); if (!r) return; FX.delete(key);
  const end = () => { try { r.fx?.destroy(); } catch { /* gone */ } r.host.classList.remove("on", "out"); r.host.innerHTML = ""; };
  if (soft) { r.host.classList.add("out"); r.host.classList.remove("on"); setTimeout(end, 700); } else end();
}
// Working: the library's noise runs alone (nothing revealed). Done: the picture is revealed out of the noise by the library's own reveal
// (cell by cell, about a second and a half) and the noise layer then fades out over the identical picture in the tile, so nothing moves.
async function start(key: string, host: HTMLElement) {
  const rec: Rec = { fx: null, host, done: false }; FX.set(key, rec);
  try {
    const m = await loadFx(); if (FX.get(key) !== rec) return;
    rec.fx = m.mount(host, { theme: dark() ? "dark" : "light", radius: 14 });
    requestAnimationFrame(() => { if (FX.get(key) === rec) host.classList.add("on"); });   // fades in (css), never pops
    const slot = host.closest<HTMLElement>(".ig-slot"); if (slot?.dataset.igs === "done") finish(key, rec, slot.dataset.igu || "");   // it finished while the effect loaded
  } catch { stop(key, false); }
}
function finish(key: string, rec: Rec, url: string) {
  if (rec.done || !rec.fx || !url) return; rec.done = true;
  const cap = new Promise(r => setTimeout(r, 20000));   // a very slow renderer never leaves the picture hidden under the effect
  Promise.race([Promise.resolve(rec.fx.reveal(url)).catch(() => {}), cap]).then(async () => {
    const img = rec.host.closest(".ig-slot")?.querySelector<HTMLImageElement>(".chat-tile-preview img");   // the tile's own picture must be ready before the noise layer fades
    if (img && !img.complete) await Promise.race([new Promise(r => { img.addEventListener("load", r, { once: true }); img.addEventListener("error", r, { once: true }); }), new Promise(r => setTimeout(r, 3000))]);
    stop(key, true);
  });
}
// Starts, finishes or stops the effect on every slot in view. A slot is seen working first; a finished card loaded from history gets none.
export function igScan(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>(".ig-slot[data-igfx]").forEach(slot => {
    const key = slot.dataset.igfx!, st = slot.dataset.igs, host = slot.querySelector<HTMLElement>(".ig-fx")!, rec = FX.get(key);
    if (rec && rec.host !== host) { stop(key, false); if (st === "working") void start(key, host); return; }   // the slot was rebuilt: carry on in the new one
    if (st === "working" && !rec && !reduced() && webgl()) void start(key, host);
    else if (st === "done" && rec && !rec.done && rec.fx && host.classList.contains("on")) finish(key, rec, slot.dataset.igu || "");
    else if (st === "failed" && rec) stop(key, false);
  });
}
let scanT = 0;
function wireFx() {
  new MutationObserver(() => { if (scanT) return; scanT = requestAnimationFrame(() => { scanT = 0; igScan(); }); }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-igs"] });
}
