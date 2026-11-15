// The slot above the composer where bars stack under the pinned reply (msgreply.ts rqHtml): "Creating an image", the image suggestion, the
// helper's "Do you want to generate an image?" and (annotation cards) anything else that belongs to the next send.
// A bar is registered once with cbAdd({ id, order, html, act }). html() returns the bar's markup (use cbBar below) or "" for nothing.
// cbHtml() is the always-present wrapper (v3.ts composer()); cbPaint() redraws it in place without touching the box.
// Buttons carry data-cba="<bar id>|<action>"; the click goes to that bar's act(action, el). The pure markup helper is cbBar.
export type CbAction = { k: string; label: string; primary?: boolean; aria?: string };
export type Bar = { id: string; order?: number; html: () => string; act?: (action: string, el: HTMLElement) => void };
const BARS = new Map<string, Bar>();
const esc = (s: string) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const X = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>`;
// One bar: icon (ready HTML), the words, text buttons and/or an X (close: the action name the X sends).
export function cbBar(o: { id: string; icon: string; title: string; label?: string; actions?: CbAction[]; close?: string; closeLabel?: string }) {
  const btns = (o.actions || []).map(a => `<button type="button" class="cbb${a.primary ? " pri" : ""}" data-cba="${esc(o.id)}|${esc(a.k)}"${a.aria ? ` aria-label="${esc(a.aria)}"` : ""}>${esc(a.label)}</button>`).join("");
  const x = o.close ? `<button type="button" class="cbx" data-cba="${esc(o.id)}|${esc(o.close)}" aria-label="${esc(o.closeLabel || "Cancel")}" title="${esc(o.closeLabel || "Cancel")}">${X}</button>` : "";
  return `<div class="cbin" role="group" aria-label="${esc(o.label || o.title)}" data-cbbar="${esc(o.id)}"><span class="cbico">${o.icon}</span><span class="cbtx">${esc(o.title)}</span>${btns ? `<span class="cbbtns">${btns}</span>` : ""}${x}</div>`;
}
export function cbAdd(bar: Bar) { BARS.set(bar.id, bar); }
let LAST = "";   // what the wrapper holds now: a repaint with the same markup leaves it alone (no replayed animation, no lost focus)
export const cbHtml = () => (LAST = `<div class="cbars" id="cbars-box">${[...BARS.values()].sort((a, b) => (a.order ?? 50) - (b.order ?? 50)).map(b => b.html()).join("")}</div>`);
export function cbPaint() { const el = document.getElementById("cbars-box"); if (!el) return; const was = LAST, html = cbHtml(); if (html !== was) el.outerHTML = html; }
let wired = false;
export function cbInit() {
  if (wired) return; wired = true;
  document.addEventListener("click", e => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-cba]"); if (!el) return;
    const [id, ...rest] = el.dataset.cba!.split("|"), bar = BARS.get(id); if (!bar?.act) return;
    e.preventDefault(); e.stopPropagation(); bar.act(rest.join("|"), el);
  });
}
