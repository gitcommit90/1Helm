// The helper's to-do list for a task (the server's update_todos tool). A small checklist button in the task header shows
// progress ("3/7") once the helper has started a list; it opens a calm panel (popover on desktop, bottom sheet on phone)
// where the person can follow along and tick or untick items. Live from the stream ({t:"todos", items}); the session detail
// API brings it back after a reload. v3.ts only hooks in: the header buttons, liveLoad, the stream handler and repaints.
// ready: the helper finished it, but only the person ticks things done ("Ready to tick" until they do).
import { anchorRect } from "./headfit";
export type TodoItem = { id: string; text: string; status: "todo" | "doing" | "done"; ready?: boolean };
type Deps = {
  api: (path: string, body?: any) => Promise<any>;
  phone: () => boolean;
  working: (slug: string, sid: string) => boolean;   // the helper is working on this task right now (the "doing" item pulses)
  helper: (slug: string) => string;
  dragToClose: (el: HTMLElement, close: () => void) => void;
};
let D: Deps | null = null;
const LISTS: Record<string, TodoItem[]> = {};   // "<slug>|<sid>" → items, as the server last said
const TD = { open: "", btn: null as HTMLElement | null };
const key = (slug: string, sid: string) => `${slug}|${sid}`;
const esc = (s: string) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const svg = (d: string, s = 16, w = 1.75) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const CHECK = '<path d="M20 6 9 17l-5-5"/>';
const LIST = '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>';
const counts = (l: TodoItem[]) => ({ done: l.filter(x => x.status === "done").length, all: l.length });

// Phone: a progress ring around the count, filling as items get done; a check inside when everything is.
function ring(l: TodoItem[], px: number) {
  const { done, all } = counts(l), r = 8, c = 2 * Math.PI * r, f = all ? done / all : 0;
  return `<svg class="tdring" width="${px}" height="${px}" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="${r}" class="tdtrack"/><circle cx="10" cy="10" r="${r}" class="tdfill" stroke-dasharray="${(f * c).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 10 10)"/>${done === all && all ? `<path d="M6.6 10.2l2.2 2.2 4.6-4.8" class="tdok"/>` : ""}</svg>`;
}
function btnInner(slug: string, sid: string, phone: boolean) {
  const l = LISTS[key(slug, sid)] || [], { done, all } = counts(l);
  if (!all) return "";
  const lab = `To-do list, ${done} of ${all} done`, open = TD.open === key(slug, sid);
  return phone
    ? `<button class="cb tdbtn m${open ? " on" : ""}${done === all ? " all" : ""}" data-todo="${esc(slug)}|${esc(sid)}" aria-label="${lab}" aria-haspopup="dialog" aria-expanded="${open}">${ring(l, 40)}<b class="tdn">${done}/${all}</b></button>`
    : `<button class="tdbtn${open ? " on" : ""}${done === all ? " all" : ""}" data-todo="${esc(slug)}|${esc(sid)}" title="To-do list" aria-label="${lab}" aria-haspopup="dialog" aria-expanded="${open}">${svg(LIST, 16)}<b class="tdn">${done}/${all}</b></button>`;
}
// The header slot. Always rendered (empty with no list) so the button can appear live when the helper starts a list.
export function todoBtn(slug: string, sid: any, phone = false) {
  return `<span class="tdw${phone ? " m" : ""}" data-tdw="${esc(slug)}|${esc(String(sid))}">${btnInner(slug, String(sid), phone)}</span>`;
}
function paintBtns(k: string, bump = false) {
  document.querySelectorAll<HTMLElement>(".tdw").forEach(w => {
    if (w.dataset.tdw !== k) return; const [slug, sid] = k.split("|"), had = !!w.firstElementChild;
    w.innerHTML = btnInner(slug, sid, w.classList.contains("m"));
    const b = w.firstElementChild as HTMLElement | null; if (!b) return;
    if (!had) b.classList.add("fresh");
    if (bump) { b.classList.add("bump"); setTimeout(() => b.classList.remove("bump"), 1600); }
    if (TD.open === k) TD.btn = b;
  });
}

// Server truth arrives (session detail on load, a stream event, or a tick's reply).
export function todoSet(slug: string, sid: any, items: TodoItem[], live = false) {
  const k = key(slug, String(sid)), was = LISTS[k] || [];
  const list = (Array.isArray(items) ? items : []).filter(x => x && x.text).map(x => ({ id: String(x.id), text: String(x.text), status: (["todo", "doing", "done"].includes(x.status) ? x.status : "todo") as TodoItem["status"], ...(x.ready && x.status !== "done" ? { ready: true } : {}) }));
  LISTS[k] = list;
  // Something got done while the panel is closed: a brief, gentle bump on the count. Nothing else.
  const newlyDone = live && list.some(x => x.status === "done" && was.some(y => y.id === x.id && y.status !== "done"));
  paintBtns(k, newlyDone && TD.open !== k);
  if (TD.open === k) { if (!list.length) todoClose(false); else paintPanel(); }
}
export const todoItems = (slug: string, sid: any) => LISTS[key(slug, String(sid))] || [];
// After the open task repaints: the header slot follows the task's real id (a new task gets it from the stream), and the
// doing item's pulse follows the helper (working ↔ idle).
export function todoSync(slug: string, sid: any) {
  const k = key(slug, String(sid));
  document.querySelectorAll<HTMLElement>(".tdw").forEach(w => { if (w.dataset.tdw !== k) { w.dataset.tdw = k; w.innerHTML = ""; } });
  paintBtns(k); if (TD.open) paintPanel();
}

function rowHtml(x: TodoItem, live: boolean) {
  const done = x.status === "done", doing = x.status === "doing";
  return `<button type="button" class="tdrow${done ? " done" : ""}${doing ? " doing" : ""}" role="checkbox" aria-checked="${done}" data-tdtick="${esc(x.id)}">
    <span class="tdchk" aria-hidden="true">${svg(CHECK, 13, 2.6)}</span><span class="tdtext">${esc(x.text)}</span>${x.ready && !done ? `<span class="tdnow ready"><i></i>Ready to tick</span>` : doing ? `<span class="tdnow${live ? " live" : ""}"><i></i>${live ? "Now" : "Next"}</span>` : ""}</button>`;
}
function panelBody(k: string) {
  const [slug, sid] = k.split("|"), l = LISTS[k] || [], { done, all } = counts(l), live = !!D?.working(slug, sid);
  const pct = all ? Math.round((done / all) * 100) : 0;
  return `<div class="tdhead"><div class="tdtitle"><h2 id="tdtitle">To-do list</h2><span>${done === all ? `All ${all} done` : `${done} of ${all} done`}</span></div>
      <button type="button" class="tdx" data-tdclose aria-label="Close">${svg('<path d="M18 6 6 18M6 6l12 12"/>', 16)}</button></div>
    <div class="tdbar" role="progressbar" aria-valuemin="0" aria-valuemax="${all}" aria-valuenow="${done}" aria-label="${done} of ${all} done"><i style="width:${pct}%"></i></div>
    <div class="tdlist">${l.map(x => rowHtml(x, live)).join("")}</div>
    <p class="tdfoot">${esc(D?.helper(slug) || "Your helper")} keeps this list as it works. Only you tick things off.</p>`;
}
function paintPanel() {
  const w = document.getElementById("tdpw"), pop = w?.querySelector<HTMLElement>(".tdpop"); if (!pop || !TD.open) return;
  const f = (document.activeElement as HTMLElement | null)?.dataset?.tdtick, sc = pop.querySelector(".tdlist")?.scrollTop ?? 0;
  pop.innerHTML = `${D?.phone() ? `<i class="grab"></i>` : ""}${panelBody(TD.open)}`;
  const l = LISTS[TD.open] || []; pop.classList.toggle("all", !!l.length && l.every(x => x.status === "done"));
  const ls = pop.querySelector(".tdlist"); if (ls) ls.scrollTop = sc;
  if (f) pop.querySelector<HTMLElement>(`[data-tdtick="${CSS.escape(f)}"]`)?.focus({ preventScroll: true });
  place();
}
function place() {
  const el = document.querySelector<HTMLElement>("#tdpw .tdpop"), b = TD.btn; if (!el) return;
  if (!b || !b.isConnected || D?.phone()) { el.removeAttribute("style"); return; }
  const r = anchorRect(b), W = Math.min(360, innerWidth - 24);   // folded into the header's ⋯: under ⋯
  el.style.width = `${W}px`; el.style.left = `${Math.max(12, Math.min(r.right - W, innerWidth - W - 12))}px`;
  el.style.top = `${r.bottom + 8}px`; el.style.maxHeight = `${Math.min(560, innerHeight - r.bottom - 20)}px`;
}
function todoOpen(k: string, btn: HTMLElement) {
  if (!D || !(LISTS[k] || []).length) return;
  TD.open = k; TD.btn = btn;
  let w = document.getElementById("tdpw"); if (!w) { w = document.createElement("div"); w.id = "tdpw"; document.body.appendChild(w); }
  w.innerHTML = `<div class="tdback" data-tdclose></div><div class="tdpop" role="dialog" aria-modal="true" aria-labelledby="tdtitle"></div>`;
  paintBtns(k); paintPanel();
  if (D.phone()) D.dragToClose(w.querySelector<HTMLElement>(".tdpop")!, () => todoClose());
  requestAnimationFrame(() => requestAnimationFrame(() => w!.classList.add("on")));
  (w.querySelector<HTMLElement>(".tdrow.doing") || w.querySelector<HTMLElement>(".tdrow:not(.done)") || w.querySelector<HTMLElement>(".tdrow"))?.focus({ preventScroll: true });
}
export function todoClose(focus = true) {
  const w = document.getElementById("tdpw"); if (!TD.open) return; const k = TD.open; TD.open = "";
  paintBtns(k);
  if (focus && !D?.phone()) document.querySelector<HTMLElement>(`[data-todo="${CSS.escape(k)}"]`)?.focus({ preventScroll: true });
  if (!w) return; w.classList.remove("on"); setTimeout(() => { if (!TD.open) w.innerHTML = ""; }, 280);
}
// The person ticks or unticks: shown at once, then the server's list (which the helper will see) replaces it.
async function tick(k: string, id: string) {
  const [slug, sid] = k.split("|"), l = LISTS[k] || [], x = l.find(i => i.id === id); if (!x || !D) return;
  const was = x.status, status = was === "done" ? "todo" : "done";
  x.status = status; paintBtns(k); if (TD.open === k) paintPanel();
  try {
    const r = await D.api(`/res/${slug}/sessions/${sid}/todos`, { id, status });
    if (Array.isArray(r?.todos)) todoSet(slug, sid, r.todos); else throw new Error(r?.error || "failed");
  } catch { const y = (LISTS[k] || []).find(i => i.id === id); if (y && y.status === status) { y.status = was; paintBtns(k); if (TD.open === k) paintPanel(); } }
}

export function todoInit(d: Deps) {
  D = d;
  document.addEventListener("click", e => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>("[data-todo]");
    if (b) { e.preventDefault(); e.stopPropagation(); const k = b.dataset.todo!; if (TD.open === k) todoClose(); else { if (TD.open) todoClose(false); todoOpen(k, b); } return; }
    if (!TD.open) return;
    if (t.closest("[data-tdclose]")) { e.preventDefault(); todoClose(); return; }
    const r = t.closest<HTMLElement>("[data-tdtick]"); if (r && r.closest("#tdpw")) { e.preventDefault(); tick(TD.open, r.dataset.tdtick!); }
  }, true);
  window.addEventListener("keydown", e => {
    if (!TD.open) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); todoClose(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const rows = [...document.querySelectorAll<HTMLElement>("#tdpw .tdrow")], i = rows.indexOf(document.activeElement as HTMLElement); if (!rows.length) return;
      e.preventDefault(); rows[e.key === "ArrowDown" ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1)].focus(); return;
    }
    if (e.key === "Tab") {   // keep focus inside the panel
      const f = [...document.querySelectorAll<HTMLElement>("#tdpw .tdpop button")]; if (!f.length) return;
      const i = f.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  }, true);
  window.addEventListener("resize", () => { if (TD.open) place(); });
  window.addEventListener("hashchange", () => todoClose(false));
}
