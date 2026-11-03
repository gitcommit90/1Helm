// Copyright (c) 2026 Bruno Delorence. MIT License. (Ported from his qr-share component, components-src/bd/qr-share: the pill that opens into a
// card with a QR code drawn as round dots, and the dots popping in ring by ring. Plain TypeScript, no React; the code itself is made by uqr.)
// bdqrHtml(id, items) returns the "Show QR code" pill and its card. Open or closed is kept per id, so a repaint of the page keeps it.
import { encode } from "uqr";

const OPEN = new Map<string, boolean>();
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
export const bdqrReset = (id: string) => { OPEN.delete(id); };

const SPRING = "linear(0, 0.04, 0.137, 0.262, 0.394, 0.523, 0.638, 0.737, 0.819, 0.883, 0.932, 0.968, 0.992, 1.008, 1.018, 1.022, 1.023, 1.022, 1.02, 1.017, 1.014, 1.011, 1.008, 1.006, 1.004, 1.003, 1)";
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const easing = () => (CSS.supports("transition-timing-function", SPRING) ? SPRING : "cubic-bezier(0.3, 1.1, 0.4, 1)");

/** Round dots for the modules; the three finders (and the alignment pattern of versions 2 to 6) as rounded squares, which readers still recognise. */
export function bdqrSvg(text: string, label: string) {
  const q = encode(text, { ecc: "M", border: 0 }), n = q.size, c = (n - 1) / 2;
  const fin = [[3, 3], [n - 4, 3], [3, n - 4]];
  const ver = q.version, al = ver > 1 && ver < 7 ? n - 7 : null;
  let g = "", rings: string[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!q.data[y][x]) continue;
    if (fin.some(([fx, fy]) => Math.abs(x - fx) <= 3 && Math.abs(y - fy) <= 3)) continue;
    if (al !== null && Math.abs(x - al) <= 2 && Math.abs(y - al) <= 2) continue;
    const r = Math.round(Math.hypot(x - c, y - c) / 1.5);
    rings[r] = (rings[r] || "") + `<circle cx="${x + 0.5}" cy="${y + 0.5}" r="0.42"/>`;
  }
  g = rings.map((d, r) => d ? `<g style="--ring:${r}">${d}</g>` : "").join("");
  const f = fin.map(([x, y]) => `<g class="bdqr-finder"><rect x="${x - 2.5}" y="${y - 2.5}" width="6" height="6" rx="1.8" class="bdqr-ring"/><rect x="${x - 1}" y="${y - 1}" width="3" height="3" rx="0.95"/></g>`).join("");
  const a = al === null ? "" : `<g class="bdqr-finder"><rect x="${al - 1.5}" y="${al - 1.5}" width="4" height="4" rx="1.25" class="bdqr-ring"/><circle cx="${al + 0.5}" cy="${al + 0.5}" r="0.55"/></g>`;
  return `<svg class="bdqr-code" viewBox="0 0 ${n} ${n}" role="img" aria-label="${esc(label)}">${f}${a}${g}</svg>`;
}

const GLYPH = '<svg class="bdqr-glyph" viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3" width="5.5" height="5.5" rx="1.4"/><rect x="11.5" y="3" width="5.5" height="5.5" rx="1.4"/><rect x="3" y="11.5" width="5.5" height="5.5" rx="1.4"/><path d="M11.5 11.5h2v2h-2zM15 15h2v2h-2zM15 11.5h2M11.5 15v2"/></svg>';
const CROSS = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8m0-8-8 8"/></svg>';

export function bdqrHtml(id: string, items: { url: string; label?: string }[]) {
  SRC.set(id, items);
  const open = !!OPEN.get(id), fid = `bdqr-${id}`;
  const plates = items.map((i) => `<figure class="bdqr-plate"><div class="bdqr-panel">${open ? bdqrSvg(i.url, i.label ? `QR code for ${i.label}` : `QR code for ${i.url}`) : ""}</div>${i.label ? `<figcaption>${esc(i.label)}</figcaption>` : ""}</figure>`).join("");
  return `<div class="bdqr-qr" data-bdqr="${esc(id)}"${open ? " data-open" : ""}>
    <button type="button" class="bdqr-pill" data-bdqr-toggle aria-expanded="${open}" aria-controls="${fid}"${open ? " tabindex=\"-1\"" : ""}>${GLYPH}Show QR code</button>
    <div class="bdqr-face" id="${fid}" role="group" aria-label="QR code"${open ? "" : " inert"}>
      <div class="bdqr-plates">${plates}</div>
      <button type="button" class="bdqr-x" data-bdqr-toggle aria-label="Hide QR code">${CROSS}</button>
    </div></div>`;
}

const SRC = new Map<string, { url: string; label?: string }[]>();

function toggle(box: HTMLElement) {
  const id = box.dataset.bdqr!, pill = box.querySelector<HTMLElement>(".bdqr-pill")!, face = box.querySelector<HTMLElement>(".bdqr-face")!;
  if (box.hasAttribute("data-moving")) return;
  const next = !box.hasAttribute("data-open"), items = SRC.get(id) || [];
  const dlgWrap = box.closest<HTMLElement>(".shw"), dlg = box.closest<HTMLElement>(".dlg");
  const wide = matchMedia("(min-width:768px)").matches;
  const anim = !reduced();
  const h0 = box.offsetHeight, pr = pill.getBoundingClientRect(), t0 = dlg?.getBoundingClientRect().top ?? 0;
  OPEN.set(id, next);
  const focusIn = box.contains(document.activeElement);
  if (next) {
    face.querySelectorAll<HTMLElement>(".bdqr-panel").forEach((p, i) => { p.innerHTML = items[i] ? bdqrSvg(items[i].url, items[i].label ? `QR code for ${items[i].label}` : `QR code for ${items[i].url}`) : ""; });
    box.setAttribute("data-open", ""); face.removeAttribute("inert"); pill.setAttribute("aria-expanded", "true"); pill.tabIndex = -1;
  }
  const h1 = next ? box.offsetHeight : pill.offsetHeight;
  // The dialog keeps its top while the card grows down (it is centred on a wide screen, so it would move up otherwise).
  if (dlgWrap && dlg && wide && next) {
    const room = innerHeight - 24 - Math.min(dlg.offsetHeight, innerHeight - 48);
    dlgWrap.style.alignItems = "start"; dlgWrap.style.paddingTop = `${Math.max(24, Math.min(t0, room))}px`;
  }
  const done = () => {
    box.removeAttribute("data-moving"); box.style.height = ""; box.style.overflow = "";
    if (!next) {
      box.removeAttribute("data-open"); face.setAttribute("inert", ""); pill.setAttribute("aria-expanded", "false"); pill.tabIndex = 0;
      face.querySelectorAll<HTMLElement>(".bdqr-panel").forEach((p) => (p.innerHTML = ""));
      if (dlgWrap && dlg && dlgWrap.style.paddingTop) {
        const before = dlg.getBoundingClientRect().top; dlgWrap.style.alignItems = ""; dlgWrap.style.paddingTop = "";
        const after = dlg.getBoundingClientRect().top;
        if (anim && before !== after) dlg.animate([{ translate: `0 ${before - after}px` }, { translate: "0 0" }], { duration: 300, easing: easing() });
      }
    }
    if (focusIn) (next ? face.querySelector<HTMLElement>(".bdqr-x") : pill)?.focus({ preventScroll: true });
    if (next && dlg) face.scrollIntoView({ block: "nearest", behavior: anim ? "smooth" : "auto" });
  };
  if (!next && !anim) return done();
  if (!anim) return done();
  // The card is revealed from the pill's box (a clip that follows the shape), while the pill fades; closing runs it backwards.
  box.setAttribute("data-moving", ""); box.style.overflow = "clip";
  const fr = face.getBoundingClientRect();
  const clip = (r: { left: number; top: number; width: number; height: number }) => `inset(${Math.max(0, r.top - fr.top)}px ${Math.max(0, fr.right - (r.left + r.width))}px ${Math.max(0, fr.bottom - (r.top + r.height))}px ${Math.max(0, r.left - fr.left)}px round ${Math.min(r.height / 2, 999)}px)`;
  const full = `inset(0px round 32px)`, small = clip(pr);
  const timing = { duration: 620, easing: easing(), fill: "both" as const };
  const a = [
    box.animate([{ height: `${h0}px` }, { height: `${h1}px` }], timing),
    face.animate(next ? [{ clipPath: small, opacity: 0 }, { clipPath: full, opacity: 1 }] : [{ clipPath: full, opacity: 1 }, { clipPath: small, opacity: 0 }], timing),
    pill.animate(next ? [{ opacity: 1, scale: 1, filter: "blur(0)" }, { opacity: 0, scale: 0.8, filter: "blur(4px)" }] : [{ opacity: 0, scale: 0.8, filter: "blur(4px)" }, { opacity: 1, scale: 1, filter: "blur(0)" }], { ...timing, duration: 260, delay: next ? 0 : 360 }),
  ];
  if (next) box.setAttribute("data-pop", ""); else box.removeAttribute("data-pop");
  Promise.all(a.map((x) => x.finished)).then(() => { a.forEach((x) => x.cancel()); done(); if (next) setTimeout(() => box.removeAttribute("data-pop"), 900); }, () => { a.forEach((x) => x.cancel()); done(); });
}

let wired = false;
export function bdqrInit() {
  if (wired) return; wired = true;
  window.addEventListener("click", (e) => {
    const b = (e.target as Element | null)?.closest?.("[data-bdqr-toggle]"); const box = b?.closest<HTMLElement>("[data-bdqr]");
    if (box) { e.preventDefault(); e.stopPropagation(); toggle(box); }
  }, true);
}
