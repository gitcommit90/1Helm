// General's Library: the person's saved Bee conversations (server: proto src/bee-library.js).
//   A "Bee conversations" chip next to the Library's other filters, and a separate "Bee conversations" section under the files. Both exist only when the account has
//   at least one stored conversation, so the Library of an account with no Bee data is unchanged. Conversations never appear in the file list.
//   All filter: the newest few conversations under the files, with a button that selects the Bee conversations filter.
//   Bee conversations filter: only the conversations (the files are not shown), newest first, "Show more" for the next page.
//   Opening a conversation takes the Library body: its transcript (time, speaker, words), a Download menu (.txt, .md) and Delete (asks first).
// Every class and data attribute here starts with beelib, so no other screen's style can match it (the stylesheet is one file).
import { ask, tell, dialogOpen } from "../dialog";
import { openMenu } from "../delete";

export type BeeRow = { id: number; start: number | null; end: number | null; duration_ms: number | null; summary: string | null; place: string | null; lines: number };
type Line = { at: number | null; who: string; linked?: boolean; text: string };
type Deps = { live: boolean; api: (path: string, body?: any) => Promise<any>; url: (path: string) => string; repaint: () => void };
let D: Deps | null = null;

export const BEE_TYPE = "bee";                    // the filter's key in the Library's L.type
const PAGE = 25, PREVIEW = 5, FRESH_MS = 30e3;
const S = { rows: [] as BeeRow[], next: null as string | null, total: 0, tz: "", at: 0, busy: false, more: false,
  open: null as number | null, conv: null as { lines: Line[] } | null, scroll: 0, deleting: false };

const esc = (s: any = "") => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const svg = (d: string, s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  back: svg('<path d="m15 18-6-6 6-6"/>', 18), down: svg('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>', 15), chev: svg('<path d="m6 9 6 6 6-6"/>', 14),
  trash: svg('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>', 15), file: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>', 15),
};

// ---- formatting, in the person's time zone (the server sends it) ----
function fmt(ms: number, o: Intl.DateTimeFormatOptions) {
  try { return new Intl.DateTimeFormat(undefined, { ...o, ...(S.tz ? { timeZone: S.tz } : {}) }).format(ms); } catch { return new Intl.DateTimeFormat(undefined, o).format(ms); }
}
const yearOf = (ms: number) => fmt(ms, { year: "numeric" });
export const dateText = (ms: number) => fmt(ms, { weekday: "short", month: "short", day: "numeric", ...(yearOf(ms) !== yearOf(Date.now()) ? { year: "numeric" } : {}) });
export const timeText = (ms: number) => fmt(ms, { hour: "numeric", minute: "2-digit" });
const lineTime = (ms: number) => fmt(ms, { hour: "numeric", minute: "2-digit", second: "2-digit" });
export function durText(ms: number | null) {
  if (ms == null || !Number.isFinite(ms)) return "";
  const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h} hr${m ? ` ${m} min` : ""}` : m ? `${m} min` : `${s} sec`;
}
const rangeText = (r: BeeRow) => r.start == null ? "" : r.end == null ? timeText(r.start) : `${timeText(r.start)} to ${timeText(r.end)}`;

// ---- loading ----
const base = "/library/bee/conversations";
async function load(more = false) {
  if (!D?.live || S.busy) return;
  S.busy = true; S.more = more; if (more) D.repaint();
  try {
    const r = await D.api(`${base}?limit=${PAGE}${more && S.next ? `&cursor=${encodeURIComponent(S.next)}` : ""}`);
    if (r?.error || !Array.isArray(r?.items)) throw new Error(r?.error || "failed");
    const sig = JSON.stringify([S.rows.slice(0, PAGE), S.total, S.tz]);
    S.tz = String(r.tz || "");
    if (more) { const have = new Set(S.rows.map(x => x.id)); S.rows = [...S.rows, ...r.items.filter((x: BeeRow) => !have.has(x.id))]; S.next = r.next ?? null; S.total = Number(r.total || S.rows.length); S.at = Date.now(); S.busy = S.more = false; D.repaint(); return; }
    // A reload of the first page keeps the pages already shown when nothing changed, and never repaints under an open transcript.
    const same = JSON.stringify([r.items, Number(r.total || 0), S.tz]) === sig;
    if (!same) { S.rows = r.items; S.next = r.next ?? null; S.total = Number(r.total || 0); }
    S.at = Date.now(); S.busy = false;
    if (!same && S.open == null) D.repaint();
  } catch { S.busy = S.more = false; S.at = Date.now(); if (more) D?.repaint(); }
}
/** Called whenever the Library body is built: fetches the first page when there is none yet or it is stale. */
export function beeLibEnsure(on: boolean) { if (on && D?.live && !S.busy && Date.now() - S.at > FRESH_MS) void load(false); }
/** The person left the Library or opened it again: back to the list. */
export function beeLibReset() { S.open = null; S.conv = null; }

// ---- markup ----
export const beeLibHas = () => S.total > 0 || S.rows.length > 0;
const rowHtml = (r: BeeRow) => `<button type="button" class="beelib-row" data-beelib-open="${r.id}" aria-label="Open the conversation from ${esc(r.start != null ? `${dateText(r.start)} ${timeText(r.start)}` : "Bee")}">
    <span class="beelib-when"><b>${r.start != null ? esc(dateText(r.start)) : ""}</b><span>${esc(rangeText(r))}</span></span>
    <span class="beelib-main"><span class="beelib-sum${r.summary ? "" : " none"}">${r.summary ? esc(r.summary) : "No summary"}</span>${r.place ? `<span class="beelib-place">${esc(r.place)}</span>` : ""}</span>
    <span class="beelib-dur">${esc(durText(r.duration_ms))}</span></button>`;

function section(only: boolean) {
  const rows = only ? S.rows : S.rows.slice(0, PREVIEW), total = Math.max(S.total, S.rows.length);
  const foot = only ? (S.next ? `<button type="button" class="beelib-more" data-beelib-more${S.more ? " disabled" : ""}>Show more</button>` : "")
    : (total > rows.length ? `<button type="button" class="beelib-more" data-beelib-all>See all ${total}</button>` : "");
  return `<section class="beelib${only ? " only" : ""}" id="beelib" aria-label="Bee conversations"><div class="beelib-bar"><h2>Bee conversations</h2></div><div class="beelib-rows">${rows.map(rowHtml).join("")}</div>${foot}</section>`;
}

function view() {
  const r = S.rows.find(x => x.id === S.open), c = S.conv;
  const meta = r ? [r.start != null ? `${dateText(r.start)}, ${rangeText(r)}` : "", durText(r.duration_ms), r.place || ""].filter(Boolean).map(esc).join(" · ") : "";
  return `<section class="beelib-view" id="beelib-view">
    <div class="beelib-vbar"><button type="button" class="beelib-back" data-beelib-back>${ICON.back}<span>Bee conversations</span></button>
      <span class="beelib-acts"><button type="button" class="beelib-btn" data-beelib-dl aria-haspopup="menu"${c ? "" : " disabled"}>${ICON.down}<span>Download</span>${ICON.chev}</button><button type="button" class="beelib-btn bad" data-beelib-del${S.deleting ? " disabled" : ""}>${ICON.trash}<span>Delete</span></button></span></div>
    <h2 class="beelib-title${r?.summary ? "" : " none"}">${r?.summary ? esc(r.summary) : "No summary"}</h2><p class="beelib-meta">${meta}</p>
    <div class="beelib-lines">${(c?.lines || []).map(l => `<div class="beelib-line"><span class="beelib-t">${l.at != null ? esc(lineTime(l.at)) : ""}</span><span class="beelib-text"><b class="beelib-who">${esc(l.who)}</b>${esc(l.text)}</span></div>`).join("")}</div></section>`;
}

/** What the Library body shows for Bee. `on`: General's own Library. `type`: the Library's current filter.
 *  chip: the filter button; section: the section under the files; only: the filter is on, so the files are left out; view: an open conversation (replaces the whole body);
 *  reset: the filter is on but there is nothing to show any more, so the Library goes back to All. */
export function beeLibParts(on: boolean, type: string): { chip: string; section: string; only: boolean; view: string | null; reset: boolean } {
  const none = { chip: "", section: "", only: false, view: null as string | null, reset: type === BEE_TYPE };
  if (!on || !D?.live) { S.open = null; S.conv = null; return { ...none, reset: false }; }
  beeLibEnsure(true);
  if (!beeLibHas()) return none;
  if (S.open != null) return { chip: "", section: "", only: false, view: view(), reset: false };
  const only = type === BEE_TYPE;
  return { chip: `<button class="fchip beelib-chip${only ? " on" : ""}" data-beelib-type>Bee conversations</button>`, section: type === "all" || only ? section(only) : "", only, view: null, reset: false };
}

// ---- actions ----
const scroller = () => document.getElementById("scroll");
async function openConv(id: number) {
  S.scroll = scroller()?.scrollTop ?? 0; S.open = id; S.conv = null; D!.repaint(); scroller()?.scrollTo(0, 0);
  try {
    const r = await D!.api(`${base}/${id}`);
    if (S.open !== id) return;
    if (r?.error || !Array.isArray(r?.lines)) throw new Error(r?.error || "failed");
    if (r.tz) S.tz = String(r.tz);
    S.conv = { lines: r.lines }; D!.repaint();
  } catch (e: any) {
    if (S.open !== id) return;
    close(); await tell({ title: "Couldn't open that conversation", body: /^(HTTP|failed|Failed to fetch)/.test(String(e?.message)) || !e?.message ? "Check your connection and try again." : String(e.message) });
  }
}
function close() { S.open = null; S.conv = null; D!.repaint(); const y = S.scroll; requestAnimationFrame(() => scroller()?.scrollTo(0, y)); }
function download(format: "txt" | "md") {
  if (S.open == null) return;
  const a = document.createElement("a"); a.href = D!.url(`${base}/${S.open}/export?format=${format}`); a.download = ""; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove();
}
async function remove() {
  const id = S.open; if (id == null || S.deleting) return;
  const ok = await ask({ title: "Delete this conversation?", body: "The transcript is deleted from 1Helm, along with what it added to memory and to your voice inbox. It stays in the Bee app, and 1Helm won't import it again. This can't be undone.", confirm: "Delete", danger: true });
  if (!ok) return;
  S.deleting = true; D!.repaint();
  try {
    const r = await D!.api(`${base}/${id}/delete`, {});
    if (r?.error || !r?.ok) throw new Error(r?.error || "failed");
    S.rows = S.rows.filter(x => x.id !== id); S.total = Math.max(0, S.total - 1); S.deleting = false; S.at = 0; close();
  } catch (e: any) {
    S.deleting = false; D!.repaint();
    await tell({ title: "Couldn't delete that conversation", body: /^(HTTP|failed|Failed to fetch)/.test(String(e?.message)) || !e?.message ? "Check your connection and try again." : String(e.message) });
  }
}

export function beeLibInit(deps: Deps, setType: (t: string) => void) {
  D = deps;
  document.addEventListener("click", e => {
    const t = e.target as HTMLElement; if (!t.closest) return;
    const o = t.closest<HTMLElement>("[data-beelib-open]"); if (o) { e.preventDefault(); void openConv(Number(o.dataset.beelibOpen)); return; }
    if (t.closest("[data-beelib-back]")) { e.preventDefault(); close(); return; }
    const dl = t.closest<HTMLElement>("[data-beelib-dl]"); if (dl && !(dl as HTMLButtonElement).disabled) { e.preventDefault(); openMenu(dl, [["Download .txt", ICON.file, () => download("txt")], ["Download .md", ICON.file, () => download("md")]]); return; }
    if (t.closest("[data-beelib-del]")) { e.preventDefault(); void remove(); return; }
    if (t.closest("[data-beelib-more]")) { e.preventDefault(); void load(true); return; }
    if (t.closest("[data-beelib-all]") || t.closest("[data-beelib-type]")) { e.preventDefault(); setType(BEE_TYPE); return; }
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && S.open != null && !dialogOpen() && !document.getElementById("delmenu")) { e.preventDefault(); close(); } });
}
