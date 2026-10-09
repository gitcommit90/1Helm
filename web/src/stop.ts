// Stop (1HC stop.js): a clear Stop wherever a task is working, and "Stop all" when several are.
//   Header: "■ Stop" next to the Working status · Composer: the send button becomes ■ while the helper works and the box is empty
//   · Activity feed: a Stop on the working card · Side list / Home rows: a small ■ on hover (always faintly visible on touch),
//   and "Stop" in the row's ⋯ menu · A pill "3 tasks working · Stop all" (in-app ask() confirm) when 2+ are working anywhere.
//   Esc never stops (too easy to hit): only explicit taps.
// Server: POST /res/<ch>/sessions/<id>/stop → { card, session } · POST /stop-all → every channel.
import { ask } from "./dialog";
import { pauseOf, stopHereBusy } from "./spendguard";   // why a card paused (1HC spendguard.js)

type Working = { slug: string; sid: string; title: string };
type Deps = {
  api: (path: string, body?: any) => Promise<any>;
  working: () => Working[];                          // every task working right now, all channels
  apply: (slug: string, view: any) => void;          // a session view from the server (state no longer "working")
  note: (title: string, body: string) => void;
  repaint: () => void;
};
let D: Deps | null = null;
const BUSY = new Set<string>();
let ALL = false;
const esc = (s: any = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const k = (slug: string, sid: any) => `${slug}|${sid}`;
export const SQ = `<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="3" fill="currentColor"/></svg>`;
export const stopBusy = (slug: string, sid: any) => BUSY.has(k(slug, sid));

/** Header: next to the "Working" status. */
export const headStop = (slug: string, sid: any, working: boolean) => !working ? "" : stopBusy(slug, sid)
  ? `<button type="button" class="hstop" disabled>${SQ}<span>Stopping…</span></button>`
  : `<button type="button" class="hstop" data-stop="${esc(k(slug, sid))}" title="Stop this task">${SQ}<span>Stop</span></button>`;
/** A list row (inside its <a>): a span-button, like the row's ⋯. */
export const rowStop = (slug: string, sid: any, title: string, working: boolean) => !working ? ""
  : `<span class="rstop" role="button" tabindex="0" data-stop="${esc(k(slug, sid))}" aria-label="Stop ${esc(title)}" title="Stop">${SQ}</span>`;
/** The composer's stop: shown instead of send while the open task works and the box is empty (CSS: .composer.working:not(.has)). */
export const composerStop = () => `<button type="button" id="gostop" class="gostop" data-stopcur aria-label="Stop" title="Stop">${SQ}</button>`;
/** The Activity feed's working card. */
export const cardStop = (slug: string, sid: any) => stopBusy(slug, sid) ? `<button type="button" class="tk-rowstop" disabled>${SQ}<span>Stopping…</span></button>`
  : `<button type="button" class="tk-rowstop" data-stop="${esc(k(slug, sid))}" title="Stop this task">${SQ}<span>Stop</span></button>`;

/** A card that hit its budget ("paused"): Continue grants one more (the app sends "Keep going." with continue=<card>). */
export const PLAY = `<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>`;
export const cardContinue = (slug: string, sid: any, card: string) => `<button type="button" class="tk-rowstop" data-continue="${esc(`${slug}|${sid}|${card}`)}" title="Let it carry on">${PLAY}<span>Keep going</span></button>`;
/** Under the paused reply: why it paused (spendguard.ts, when the server said) + Keep going / Stop here. */
export const pausedNote = (slug: string, sid: any, card: string) => {
  const p = pauseOf(card), kk = esc(`${slug}|${sid}|${card}`), busy = stopHereBusy(card);
  return `<div class="paused-note${p ? " sg" : ""}" role="status">${p ? `<div class="pn-t"><b>${esc(p.title)}</b><span>${esc(p.line)}</span></div>` : `<span>Paused: it hit its budget. Keep going?</span>`}<div class="pn-b"><button type="button" data-continue="${kk}">${PLAY}<span>Keep going</span></button><button type="button" class="pn-stop" data-sgstop="${kk}"${busy ? " disabled" : ""}>${busy ? "Stopping…" : "Stop here"}</button></div></div>`;
};
export async function stopTask(slug: string, sid: any) {
  if (!D || stopBusy(slug, sid)) return null;
  BUSY.add(k(slug, sid)); D.repaint(); sync(CUR);
  try {
    const r = await D.api(`/res/${slug}/sessions/${sid}/stop`, {});
    if (r?.error) D.note("Couldn't stop it", String(r.error));
    else if (r?.session) D.apply(slug, r.session);
    return r;
  } catch (e: any) { D.note("Couldn't stop it", e?.message || "Try again."); return null; }
  finally { BUSY.delete(k(slug, sid)); D.repaint(); sync(CUR); }
}
/** Several tasks at once (the plan card's "Stop these tasks"). */
export const stopMany = (list: { slug: string; sid: any }[]) => Promise.all(list.map((x) => stopTask(x.slug, x.sid)));
export async function stopAll() {
  if (!D || ALL) return;
  const n = D.working().length;
  const ok = await ask({ title: `Stop ${n === 1 ? "this task" : `all ${n} tasks`}?`, body: "Each one stops where it is. What's already done stays, and you can pick any of them up again with a message.", confirm: "Stop all", danger: true });
  if (!ok) return;
  ALL = true; sync(CUR);
  try {
    const r = await D.api(`/stop-all`, {});
    for (const c of r?.channels || []) for (const s of c.sessions || []) D.apply(c.slug, s);
    if (r?.error) D.note("Couldn't stop them", String(r.error));
  } catch (e: any) { D.note("Couldn't stop them", e?.message || "Try again."); }
  finally { ALL = false; D.repaint(); sync(CUR); }
}

let CUR: { slug: string; sid: string; working: boolean } | null = null;
/** After every render / repaint: the composer's stop follows the open task, the pill follows every task. */
export function sync(cur: { slug: string; sid: string; working: boolean } | null) {
  CUR = cur;
  const f = document.getElementById("send");
  if (f) { f.classList.toggle("working", !!cur?.working); const g = document.getElementById("gostop") as HTMLButtonElement | null; if (g) { const b = !!cur && stopBusy(cur.slug, cur.sid); g.disabled = b; g.classList.toggle("busy", b); } }
  if (!D) return;
  const n = D.working().length;
  let p = document.getElementById("stopall");
  if (n < 2) { p?.remove(); return; }
  if (!p) { p = document.createElement("div"); p.id = "stopall"; p.setAttribute("role", "status"); document.body.appendChild(p); }
  const h = `<span class="sa-dot" aria-hidden="true"></span><span>${n} tasks working</span><span class="sa-sep" aria-hidden="true">·</span><button type="button" data-stopall${ALL ? " disabled" : ""}>${ALL ? "Stopping…" : "Stop all"}</button>`;
  if (p.dataset.h !== h) { p.dataset.h = h; p.innerHTML = h; }
}

export function stInit(d: Deps) {
  D = d;
  const act = (t: HTMLElement, e: Event) => {
    const b = t.closest<HTMLElement>("[data-stop]");
    if (b) { e.preventDefault(); e.stopImmediatePropagation(); const [slug, sid] = b.dataset.stop!.split("|"); void stopTask(slug, sid); return; }
    if (t.closest("[data-stopcur]")) { e.preventDefault(); e.stopImmediatePropagation(); if (CUR?.working) void stopTask(CUR.slug, CUR.sid); return; }
    if (t.closest("[data-stopall]")) { e.preventDefault(); e.stopImmediatePropagation(); void stopAll(); }
  };
  window.addEventListener("click", (e) => act(e.target as HTMLElement, e), true);
  window.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && (e.target as HTMLElement).closest?.("span[data-stop]")) act(e.target as HTMLElement, e); }, true);
}
