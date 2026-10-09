// "Apps I use" picker (proto src/apps-used.js): app chips with logos (logo.ts appLogo: the letter tile first, the logo fades in over
// it), the most used first and the rest behind "More apps" or the search box, plus "None of these" (clears the others; any app clears
// it). One picker, two places: the Get to know you question "Do you use any of these apps?" (interview.ts) and Settings → Connected
// accounts → Apps I use (v3.ts). Chips grow to fit their label (never cut short) and wrap; the search only filters (nothing is sent
// anywhere while typing). Each picker registers a controller (get / set / onChange); taps and typing are handled here, and only the
// chip list repaints, so the search box keeps focus and the card doesn't jump.
import { appLogo } from "../logo";

export type AppOpt = { v: string; label: string; logo: string; top?: boolean; covers?: string };
type Ctl = { opts: AppOpt[]; get: () => string[]; set: (p: string[]) => void; none?: string; noneLabel?: string; onChange?: () => void; extras?: () => AppOpt[] };
const CTL = new Map<string, Ctl>();
const ST = new Map<string, { q: string; more: boolean }>();
const esc = (s: any) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const CHECK = `<svg class="apk-ck" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`;
const SEARCH = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const apkState = (id: string) => { let s = ST.get(id); if (!s) ST.set(id, s = { q: "", more: false }); return s; };
export function apkRegister(id: string, ctl: Ctl) { CTL.set(id, ctl); }
export function apkReset(id: string) { ST.delete(id); }

function all(c: Ctl) { const ex = c.extras?.() || []; return [...c.opts, ...ex.filter(x => !c.opts.some(o => o.v === x.v))]; }
function chip(o: AppOpt, on: boolean) {
  return `<button type="button" class="gu-chip apk-chip${on ? " on" : ""}" aria-pressed="${on}" data-apchip="${esc(o.v)}"${o.covers ? ` title="${esc(`${o.label}: ${o.covers}`)}"` : ""}>${appLogo(o.logo, o.label, "apk-logo", 22)}<span>${esc(o.label)}</span>${on ? CHECK : ""}</button>`;
}
/** The chips (and "More apps" / "None of these"), for the given state. */
export function apkChips(id: string) {
  const c = CTL.get(id); if (!c) return "";
  const st = apkState(id), picks = c.get(), q = norm(st.q), list = all(c);
  const match = (o: AppOpt) => !q || ` ${norm(`${o.label} ${o.v.replace(/_/g, " ")} ${o.covers || ""}`)}`.includes(` ${q}`);   // any word starts with what they typed
  let shown = q ? list.filter(match) : st.more ? list : list.filter(o => o.top || picks.includes(o.v) || !c.opts.includes(o));
  const rest = q || st.more ? 0 : list.length - shown.length;
  const noneOn = !!c.none && picks.includes(c.none);
  return `${shown.map(o => chip(o, picks.includes(o.v))).join("")}
    ${rest > 0 ? `<button type="button" class="gu-chip apk-more" data-apmore="${esc(id)}" aria-expanded="false">More apps <b>${rest}</b></button>` : ""}
    ${q && !shown.length ? `<p class="apk-empty">No app called “${esc(st.q)}” here. Tell your helper about any other app you use.</p>` : ""}
    ${c.none && !q ? `<button type="button" class="gu-chip apk-none${noneOn ? " on" : ""}" aria-pressed="${noneOn}" data-apchip="${esc(c.none)}">${noneOn ? CHECK : ""}<span>${esc(c.noneLabel || "None of these")}</span></button>` : ""}`;
}
/** The whole picker: search, chips, and what the grouped options cover. */
export function apkHtml(id: string, label: string) {
  const c = CTL.get(id); if (!c) return ""; const st = apkState(id);
  const covers = c.opts.filter(o => o.covers).map(o => `<b>${esc(o.label)}</b>: ${esc(o.covers)}`).join(" · ");
  return `<div class="apk" data-apk="${esc(id)}">
    <label class="apk-search">${SEARCH}<input id="apq-${esc(id)}" data-apq="${esc(id)}" type="search" placeholder="Search apps" aria-label="Search apps" value="${esc(st.q)}" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="search"></label>
    <div class="gu-chips apk-chips" role="group" aria-label="${esc(label)}" data-apkchips="${esc(id)}">${apkChips(id)}</div>
    ${covers ? `<p class="apk-note">${covers}</p>` : ""}</div>`;
}
function repaint(id: string) { const el = document.querySelector<HTMLElement>(`[data-apkchips="${CSS.escape(id)}"]`); if (el) el.innerHTML = apkChips(id); }

document.addEventListener("click", e => {
  const t = e.target as HTMLElement;
  const more = t.closest<HTMLElement>("[data-apmore]"); if (more) { e.preventDefault(); const id = more.dataset.apmore!; apkState(id).more = true; repaint(id);
    document.querySelector<HTMLElement>(`[data-apkchips="${CSS.escape(id)}"] .apk-chip:nth-child(${(CTL.get(id)?.opts.filter(o => o.top).length || 0) + 1})`)?.focus({ preventScroll: true }); return; }
  const b = t.closest<HTMLElement>("[data-apchip]"); if (!b) return;
  const id = b.closest<HTMLElement>("[data-apk]")?.dataset.apk || ""; const c = CTL.get(id); if (!c) return;
  e.preventDefault(); e.stopPropagation();
  const v = b.dataset.apchip!, s = new Set(c.get());
  if (s.has(v)) s.delete(v); else { s.add(v); if (c.none) { if (v === c.none) { s.clear(); s.add(v); } else s.delete(c.none); } }
  c.set([...s]); repaint(id);
  document.querySelector<HTMLElement>(`[data-apkchips="${CSS.escape(id)}"] [data-apchip="${CSS.escape(v)}"]`)?.focus({ preventScroll: true });
  c.onChange?.();
}, true);
document.addEventListener("input", e => {
  const t = e.target as HTMLInputElement; const id = t.dataset?.apq; if (!id || !CTL.has(id)) return;
  apkState(id).q = t.value; repaint(id);
});
// Enter in the search box picks the only match (and clears the search); Esc clears it.
document.addEventListener("keydown", e => {
  const t = e.target as HTMLInputElement; const id = t.dataset?.apq; if (!id || !CTL.has(id)) return;
  if (e.key === "Escape" && t.value) { e.preventDefault(); e.stopPropagation(); t.value = ""; apkState(id).q = ""; repaint(id); return; }
  if (e.key !== "Enter" || e.isComposing) return;
  e.preventDefault(); e.stopPropagation();
  const one = document.querySelectorAll<HTMLElement>(`[data-apkchips="${CSS.escape(id)}"] .apk-chip`);
  if (one.length === 1) { one[0].click(); t.value = ""; apkState(id).q = ""; repaint(id); t.focus(); }
}, true);
