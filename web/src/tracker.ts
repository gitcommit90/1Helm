// Tracker cards: one card per turn of a task (everything from the person's first message until the helper's reply), shown in
// an "Activity" feed inside the session view (a right panel ≥1200 px, a drawer at 768–1199 px, a bottom sheet on a phone) and
// opened in a card modal (status badge, a timeline rail, a Summary, and each step's receipts: what ran, exit, timing, output).
// Data: sessionDetail `cards` / `live.card` / `turns[].card`, the stream's card_open / steered / card_event / card_update /
// card_close / helper events, and GET …/sessions/<sid>/cards(/<id>(/steps/<seq>)) and …/helpers(/<id>/stop).
// Everything stays invisible until the server sends cards for a session: with today's backend the app is exactly as before.
// v3.ts only hooks in: the header slots, the stage wrapper, liveLoad, the stream handler, msgHtml and repaints.
import { cardStop, cardContinue } from "./stop";
import { orb } from "./activity-orb";
import { pauseOf } from "./spendguard";   // the working card's Stop
import { nativeHandoffText } from "./native-approval-progress";
import { focusHeaderAction } from "./headfit";
export type HelperView = { id: number; name: string; task?: string; status: string; started: number; ended?: number | null; steps?: number; charge_nano?: number;
  parent_card?: string | null; card?: string | null; result_card?: string | null; stopped_by?: string | null; input_kind?: string | null };
export type CardView = { id: string; session?: string; kind: string; status: string; title: string; title_src?: string; result?: string | null; opened: number;
  started?: number | null; closed?: number | null; steps?: number; msgs?: number; from?: any[]; helpers?: HelperView[]; legacy?: boolean };
export type EventView = { seq: number; type: "msg" | "step" | "handoff"; at: number; id?: string; cid?: string | null; text?: string; files?: any[]; via?: string;
  consumed?: number | null; reaction?: string | null; title?: string; title_src?: string; tool?: string; status?: string; exit?: number | null; ms?: number | null;
  input_preview?: string; out_preview?: string; out_bytes?: number; why?: string | null; ref?: string | null; from?: any; result?: StepResult };
// The server's readable result for a step (proto src/step-present.js): never the raw tool output, never 1Helm's own docs.
export type StepResult = { v: number; text?: string; error?: string; links?: { title: string; url: string; host: string }[]; items?: string[];
  files?: { name: string; path?: string; bytes?: number; size?: string; id?: string; mime?: string; image?: boolean }[]; code?: string;
  internal?: boolean; more?: boolean; hidden?: boolean; details?: string; cut?: boolean };
export type CardDetail = CardView & { summary?: string | null; events: EventView[]; reply?: string; charge_nano?: number; total_ms?: number; progress?: string[]; progress_omitted?: number; saved?: any[] };
export type StepDetail = EventView & { input?: any; cmd?: string | null; output?: string; truncated?: boolean; call_id?: string };
type Deps = {
  api: (path: string, body?: any) => Promise<any>;
  base: () => string;                                  // the live API base, for the Download link
  phone: () => boolean;
  helper: (slug: string) => string;                    // "Skipper"
  working: (slug: string, sid: string) => boolean;     // a stream is open for this task in this tab
  dragToClose: (el: HTMLElement, close: () => void) => void;
  repaint: (slug: string, sid: string) => void;        // repaint the chat (live step titles, finished-turn chips)
  showInChat: (slug: string, sid: string, card: string) => void;
  plain: (s: string) => string;                        // a reply as plain text
  note: (title: string, sub: string) => void;
  current: () => string;                               // "<slug>|<sid>" of the task on screen, or ""
  fileChip?: (slug: string, f: any) => string;         // a Library file's card (opens the file viewer)
  savedChip?: (slug: string, saved: any) => string;   // exact destination from the successful remember result
};
let D: Deps | null = null;
type Sess = { on: boolean; cards: CardView[]; more: boolean; helpers: HelperView[]; hcount: number; hoff: boolean; hbusy: boolean };
const SS: Record<string, Sess> = {};
const DET: Record<string, CardDetail> = {};       // card id → detail (server truth, plus live events merged in)
const STEP: Record<string, StepDetail> = {};      // "<card>|<seq>" → step detail
const BUSY: Record<string, boolean> = {};
const M = { k: "", id: "", sel: "sum", view: "list" as "list" | "detail", back: [] as string[], from: null as HTMLElement | null, err: "", det: {} as Record<string, boolean> };
const F = { sheet: "" };                          // phone: the feed sheet's "<slug>|<sid>"
const key = (slug: string, sid: any) => `${slug}|${sid}`;
const ss = (k: string) => SS[k] ??= { on: false, cards: [], more: false, helpers: [], hcount: 0, hoff: false, hbusy: false };
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const svg = (d: string, s = 16, w = 1.75) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const P = {
  act: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>', back: '<path d="m15 18-6-6 6-6"/>', chev: '<path d="m9 18 6-6-6-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', check: '<path d="M20 6 9 17l-5-5"/>',
  okc: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>', alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4.5M12 16h.01"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>', stopc: '<circle cx="12" cy="12" r="9"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', term: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>', globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>', cal: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', note: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  apps: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><path d="M17.5 14v7M14 17.5h7"/>',
  helper: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  sum: '<path d="M4 6h16M4 12h16M4 18h10"/>', copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V5a2 2 0 0 1 2-2h11"/>',
  dl: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>', handoff: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
};
const spin = () => orb("working");
const LABEL: Record<string, string> = { working: "Working", resuming: "Working", complete: "Complete", failed: "Failed", interrupted: "Interrupted", stopped: "Stopped", queued: "Queued", paused: "Paused" };
const isOpen = (c?: CardView | null) => !!c && (c.status === "working" || c.status === "queued" || c.status === "resuming") && !c.closed;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const hm = (t: number) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s?([AP])M$/i, (_, a) => ` ${a.toLowerCase()}m`);
const hms = (t: number) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }).replace(/\s?([AP])M$/i, (_, a) => ` ${a.toLowerCase()}m`);
function range(a: number, b?: number | null) {
  const x = hm(a); if (!b) return x; const y = hm(b); if (x === y) return x;
  const sx = x.slice(-2), sy = y.slice(-2); return `${sx === sy ? x.slice(0, -3) : x}–${y}`;
}
function dayLabel(t: number) {
  const d = new Date(t), n = new Date(), y = new Date(n); y.setDate(n.getDate() - 1);
  if (d.toDateString() === n.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", ...(d.getFullYear() !== n.getFullYear() ? { year: "numeric" } : {}) });
}
const ago = (t: number) => { const m = Math.floor((Date.now() - t) / 60e3); return m < 1 ? "just started" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
const fmtMs = (ms?: number | null) => ms == null ? "" : ms < 1000 ? `${ms} ms` : ms < 60e3 ? `${(ms / 1000).toFixed(ms < 10e3 ? 1 : 0)} s` : `${Math.floor(ms / 60e3)} min ${Math.round(ms % 60e3 / 1000)} s`;
const fmtBytes = (n?: number) => !n ? "" : n < 1024 ? `${n} bytes` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
function toolGlyph(t = "") {
  if (/^(run_command|search_files|exec)/.test(t)) return P.term;
  if (/file|edit|write|read/.test(t)) return P.file;
  if (/^(fetch_url|web|browser|open_url)/.test(t)) return P.globe;
  if (/gmail|email/.test(t)) return P.mail;
  if (/calendar/.test(t)) return P.cal;
  if (/recall|memory|search/.test(t)) return P.search;
  if (/remember|note|notebook/.test(t)) return P.note;
  if (/^app_/.test(t)) return P.apps;
  if (/helper/.test(t)) return P.helper;
  return P.wrench;
}
function statusIcon(st: string) {
  if (st === "working" || st === "resuming") return spin();   // resuming: a deploy cut it off and it's being picked up again (reads as working)
  if (st === "queued") return svg(P.clock, 16);
  if (st === "complete") return svg(P.okc, 16);
  if (st === "stopped") return svg(P.stopc, 16);
  if (st === "paused") return svg('<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>', 16);   // hit its budget (1HC stop.js)
  return svg(P.alert, 16);   // failed, interrupted
}
const sorted = (l: EventView[]) => [...l].sort((a, b) => a.seq - b.seq);

// ---------- State ----------
function upsertCard(k: string, c: Partial<CardView> & { id: string }, list = true) {
  const s = ss(k); s.on = true;
  const i = s.cards.findIndex(x => x.id === c.id);
  if (i >= 0) s.cards[i] = { ...s.cards[i], ...c } as CardView;
  else if (list && c.kind !== "helper" && !(c as any).hidden && c.title !== undefined) { s.cards.push(c as CardView); s.cards.sort((a, b) => (b.opened || 0) - (a.opened || 0)); }
  const d = DET[c.id]; if (d) Object.assign(d, c, { events: d.events });
  for (const h of c.helpers || []) upsertHelper(k, h);
}
function ensureDet(id: string, k: string): CardDetail {
  if (DET[id]) return DET[id];
  const c = ss(k).cards.find(x => x.id === id);
  return DET[id] = { ...(c || { id, kind: "chat", status: "working", title: "", opened: Date.now() }), events: [] } as CardDetail;
}
function mergeEvent(d: CardDetail, e: EventView) {
  if (!e) return null;
  // A message is the same message by id or cid; anything else by seq and type. A message without a seq yet (a steer's ack) gets a
  // provisional one just after the last event, never an integer, so a later step can't land on it.
  let x = e.type === "msg" && (e.id || e.cid) ? d.events.find(y => y.type === "msg" && ((!!e.id && y.id === e.id) || (!!e.cid && y.cid === e.cid))) : undefined;
  if (!x && e.seq != null) x = d.events.find(y => y.seq === e.seq && y.type === e.type);
  const was = x?.status;
  if (x) Object.assign(x, Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined)));
  else { x = { ...e, seq: e.seq ?? (Math.floor(d.events.reduce((m, y) => Math.max(m, y.seq), 0)) + 0.5) }; d.events.push(x); }
  d.events = sorted(d.events);
  d.steps = Math.max(d.steps || 0, d.events.filter(y => y.type === "step").length);
  d.msgs = Math.max(d.msgs || 0, d.events.filter(y => y.type === "msg").length);
  return { ev: x, was };
}
const msgEvent = (m: any, seq?: number): EventView => ({ type: "msg", seq: m.seq ?? seq, at: m.at || Date.now(), id: m.id, cid: m.cid ?? null, text: m.text || "", files: m.files || [], via: m.via, consumed: m.consumed ?? null, reaction: m.reaction ?? null } as EventView);
function upsertHelper(k: string, h: HelperView) {
  if (!h || h.id == null) return; const s = ss(k), i = s.helpers.findIndex(x => x.id === h.id);
  if (i >= 0) s.helpers[i] = { ...s.helpers[i], ...h }; else s.helpers.push(h);
  for (const d of Object.values(DET)) { const j = (d.helpers || []).findIndex(x => x.id === h.id); if (j >= 0) d.helpers![j] = { ...d.helpers![j], ...h }; }
}
const helperById = (k: string, id: any) => ss(k).helpers.find(h => String(h.id) === String(id)) || Object.values(DET).flatMap(d => d.helpers || []).find(h => String(h.id) === String(id));
const helperStatus = (status: string) => ({ running: "working", waiting_input: "Needs clarification", awaiting_review: "Reviewing result", approved: "Approved", done: "Finished", stopped: "Stopped" }[status] || status);
const running = (k: string) => ss(k).hoff ? [] : ss(k).helpers.filter(h => h.status === "running");

// ---------- Public: data in ----------
export const tkOn = (slug: string, sid: any) => !!SS[key(slug, sid)]?.on;
export function tkLiveCard(slug: string, sid: any) { const s = SS[key(slug, sid)]; if (!s?.on) return ""; const c = s.cards.find(isOpen); return c ? c.id : ""; }
export const tkCard = (id?: string) => id ? DET[id] : undefined;
export function tkCardView(slug: string, sid: any, id?: string): CardView | undefined { if (!id) return; return SS[key(slug, sid)]?.cards.find(x => x.id === id) || DET[id]; }
// Session detail (every liveLoad). No `cards` field = today's backend: nothing turns on.
export function tkLoad(slug: string, sid: any, d: any) {
  const k = key(slug, sid), s = ss(k);
  if (!Array.isArray(d?.cards)) { if (d?.live?.card) upsertCard(k, d.live.card); return; }
  s.on = true; const live = d.live?.card as CardDetail | undefined;
  const oldest = Math.min(Infinity, ...d.cards.map((x: CardView) => x.opened || 0));   // keep what "Show earlier" brought in
  const keep = s.cards.filter(c => !d.cards.some((x: CardView) => x.id === c.id) && c.opened < oldest);
  s.cards = [...d.cards, ...keep].filter(c => c.kind !== "helper" && !(c as any).hidden).sort((a, b) => (b.opened || 0) - (a.opened || 0));
  if (d.cards.length >= 30) s.more = true;
  for (const c of d.cards) { if (DET[c.id]) Object.assign(DET[c.id], c, { events: DET[c.id].events }); for (const h of c.helpers || []) upsertHelper(k, h); }
  if (live?.id) { upsertCard(k, live); DET[live.id] = { ...(DET[live.id] || {}), ...live, events: sorted(live.events || []) }; }
  if (typeof d.session?.helpers === "number") s.hcount = d.session.helpers;
  // Helper details are authoritative even when no worker is running: a worker
  // may be waiting for clarification or approval after its parent turn closes.
  void loadHelpers(slug, String(sid));
  tkSync(slug, sid);
}
// From the boot poll (sessionView.helpers). Returns true when the count changed.
export function tkHelperCount(slug: string, sid: any, n: any) {
  if (typeof n !== "number") return false; const k = key(slug, sid), s = ss(k);
  const changed = s.hcount !== n; s.hcount = n;
  // The count alone cannot distinguish waiting, review and approval. Refresh
  // open workers on the existing boot poll so reconnects also settle their UI.
  if (s.on && (changed || (D?.current() === k && (n > 0 || openHelpers(k).length)))) void loadHelpers(slug, String(sid));
  return changed;
}
// A stream event. Returns true when it was one of ours (the caller repaints the chat).
export function tkEvent(slug: string, sid: any, ev: any): boolean {
  const k = key(slug, sid), t = ev?.t;
  if (t === "card_open" || t === "steered") {
    if (!ev.card?.id) return true; upsertCard(k, ev.card); const d = ensureDet(ev.card.id, k); Object.assign(d, ev.card, { events: d.events });
    if (ev.msg) mergeEvent(d, msgEvent(ev.msg, t === "card_open" ? 1 : undefined));
  } else if (t === "card_event") {
    if (!ev.card || !ev.event) return true; const d = ensureDet(ev.card, k), r = mergeEvent(d, ev.event); upsertCard(k, { id: ev.card, steps: d.steps, msgs: d.msgs }, false);
    if (r && r.ev.type === "step" && r.was === "running" && r.ev.status !== "running") { delete STEP[`${ev.card}|${r.ev.seq}`]; if (M.id === ev.card && M.sel === `e${r.ev.seq}`) loadStep(); }
  } else if (t === "card_update" || t === "card_close") {
    const c = ev.card; if (!c?.id) return true; const { why, ...rest } = c;
    upsertCard(k, rest, t === "card_close"); const d = DET[c.id];
    if (d && why && typeof why === "object") for (const [seq, line] of Object.entries(why)) { const e = d.events.find(x => String(x.seq) === seq); if (e) e.why = String(line); }
  } else if (t === "helper") {
    if (!ev.helper) return true; ss(k).on = true; upsertHelper(k, ev.helper);
  } else if (t === "snapshot" && ev.card?.id) {
    upsertCard(k, ev.card); DET[ev.card.id] = { ...(DET[ev.card.id] || {}), ...ev.card, events: sorted(ev.card.events || []) };
    tkSync(slug, sid); return false;   // the snapshot itself is still v3's
  } else return false;
  tkSync(slug, sid);
  return true;
}
async function loadHelpers(slug: string, sid: string) {
  const k = key(slug, sid), s = ss(k); if (s.hbusy || !D) return; s.hbusy = true;
  try { const r = await D.api(`/res/${slug}/sessions/${sid}/helpers`); if (Array.isArray(r?.helpers)) { s.hoff = false; r.helpers.forEach((h: HelperView) => upsertHelper(k, h)); } }
  catch { /* Keep the last server state through a temporary connection failure. */ }
  s.hbusy = false; tkSync(slug, sid);
}

// ---------- Header slot ("Activity") ----------
const mode = () => D?.phone() ? "sheet" : innerWidth >= 1200 && !document.body.classList.contains("pc-on") ? "panel" : "drawer";
const PREF = { panel: "1hc-tk-panel", drawer: "1hc-tk-drawer" };
function pref(m: "panel" | "drawer") { try { const v = localStorage.getItem(PREF[m]); return v === null ? false : v === "1"; } catch { return false; } }
function setPref(m: "panel" | "drawer", on: boolean) { try { localStorage.setItem(PREF[m], on ? "1" : "0"); } catch {} }
const feedOpen = () => { const m = mode(); return m === "sheet" ? false : pref(m); };
// A plain tool button like Live notes and To-dos: no dot, no badge, no animation, shown whether or not work is running.
function btnInner(k: string, phone: boolean) {
  if (!ss(k).on) return "";
  const open = phone ? F.sheet === k : feedOpen();
  return phone ? `<button class="cb tk-btn m${open ? " on" : ""}" data-tkbtn="${esc(k)}" aria-label="Activity" aria-haspopup="dialog" aria-expanded="${open}">${svg(P.act, 19)}</button>`
    : `<button class="tk-btn${open ? " on" : ""}" data-tkbtn="${esc(k)}" title="Activity: each request as a task card" aria-label="Activity" aria-expanded="${open}">${svg(P.act, 16)}<span>Activity</span></button>`;
}
export function tkBtn(slug: string, sid: any, phone = false) {
  const k = key(slug, sid); return `<span class="tk-slot${phone ? " m" : ""}" data-tks="${esc(k)}">${btnInner(k, phone)}</span>`;
}
// ---------- The feed (panel / drawer / sheet) ----------
export function tkWrap(slug: string, sid: any, inner: string) {
  const k = key(slug, sid), on = ss(k).on;
  return `<div class="tk-w${on ? " tk-on" : ""}${on && feedOpen() ? " tk-open" : ""}" data-tkw="${esc(k)}"><div class="tk-col">${inner}</div><div class="tk-scrim" data-tkfeedx></div><aside class="tk-feed" aria-label="Activity">${on ? feedHtml(k) : ""}</aside></div>`;
}
function subLine(c: CardView) {
  const d = DET[c.id];
  if (c.status === "resuming") return "1Helm was updated, picking up where it left off";
  if (c.status === "working") { const st = d && sorted(d.events).filter(e => e.type === "step").at(-1); return st?.title ? st.title : "Working…"; }
  if (c.status === "queued") return "Waiting for the last request to finish";
  if (c.status === "stopped" && (c.kind === "chat" || c.kind === "handoff")) return "Stopped by you";
  if (c.status === "paused") return pauseOf(c.id)?.title ? `Paused: ${pauseOf(c.id)!.title.replace(/^./, (x) => x.toLowerCase())}` : "Paused: hit its budget";   // why (spendguard.ts)
  if (c.result) return c.result;
  return c.status === "interrupted" ? "Interrupted by a restart" : c.status === "stopped" ? "Stopped" : c.status === "failed" ? "Didn't finish" : "";
}
function rowHtml(c: CardView, k = "") {
  const t = c.closed || c.opened, sub = subLine(c);
  // The working card carries a Stop (stop.ts), beside the row button (a button can't hold another).
  if (k && c.status === "working" && !c.closed && (c.kind === "chat" || c.kind === "handoff")) { const [slug, sid] = k.split("|"); return `<div class="tk-rw">${rowHtml(c)}${cardStop(slug, sid)}</div>`; }
  if (k && c.status === "paused") { const [slug, sid] = k.split("|"); return `<div class="tk-rw">${rowHtml(c)}${cardContinue(slug, sid, c.id)}</div>`; }   // Continue: one more budget
  return `<button type="button" class="tk-row s-${esc(c.status)}${c.legacy ? " legacy" : ""}" data-tkcard="${esc(c.id)}"><span class="tk-si" title="${esc(LABEL[c.status] || c.status)}">${statusIcon(c.status)}</span>
    <span class="tk-rt"><b>${esc(c.title || "Task")}</b>${sub ? `<span>${esc(sub)}</span>` : ""}</span><time>${esc(hm(t))}</time></button>`;
}
function stripHtml(k: string) {
  const hs = running(k); if (!hs.length) return "";
  return `<div class="tk-hstrip">${hs.map(h => `<div class="tk-hrow"><span class="tk-hico">${spin()}</span><button type="button" class="tk-hname" data-tkhelper="${esc(String(h.id))}"><b>${esc(h.name)}</b><span data-tkel="${h.started}">In the background · ${esc(ago(h.started))}</span></button>
    <button type="button" class="tk-stop" data-tkstop="${esc(String(h.id))}"${BUSY[`stop${h.id}`] ? " disabled" : ""}>${svg(P.stop, 13, 2)}<span>${BUSY[`stop${h.id}`] ? "Stopping…" : "Stop"}</span></button></div>`).join("")}</div>`;
}
function feedHtml(k: string, sheet = false) {
  const s = ss(k), [slug] = k.split("|"); let last = "", rows = "";
  for (const c of s.cards) { const g = dayLabel(c.opened); if (g !== last) { rows += `<div class="tk-day">${esc(g)}</div>`; last = g; } rows += rowHtml(c, k); }
  return `${sheet ? `<i class="grab"></i>` : ""}<div class="tk-fhead"><h2>Activity</h2><button type="button" class="tk-x" data-tkfeedx aria-label="Close activity">${svg(P.x, 16)}</button></div>
    ${stripHtml(k)}<div class="tk-flist">${rows || `<p class="tk-empty">Each thing you ask ${esc(D?.helper(slug) || "your helper")} shows up here as a task card you can open and follow.</p>`}
    ${s.more ? `<button type="button" class="tk-more" data-tkmore${BUSY[`more${k}`] ? " disabled" : ""}>${BUSY[`more${k}`] ? "Loading…" : "Show earlier"}</button>` : ""}</div>`;
}
async function loadMore(k: string) {
  const s = ss(k), [slug, sid] = k.split("|"), last = s.cards.at(-1); if (!last || BUSY[`more${k}`]) return;
  BUSY[`more${k}`] = true; paintFeed(k);
  try { const r = await D!.api(`/res/${slug}/sessions/${sid}/cards?n=50&before=${last.opened}`); if (Array.isArray(r?.cards)) { r.cards.forEach((c: CardView) => upsertCard(k, c)); s.more = !!r.more; } } catch {}
  BUSY[`more${k}`] = false; paintFeed(k);
}
function paintFeed(k: string) {
  document.querySelectorAll<HTMLElement>(".tk-w").forEach(w => {
    if (w.dataset.tkw !== k) return; const on = ss(k).on;
    w.classList.toggle("tk-on", on); w.classList.toggle("tk-open", on && feedOpen());
    const a = w.querySelector<HTMLElement>(".tk-feed"); if (!a) return;
    const h = on ? feedHtml(k) : ""; if (a.dataset.h === h.replace(/animation-delay:-\d+ms/g, "")) return; a.dataset.h = h.replace(/animation-delay:-\d+ms/g, "");
    const sc = a.querySelector(".tk-flist")?.scrollTop ?? 0, f = (document.activeElement as HTMLElement | null)?.closest?.(".tk-feed") ? (document.activeElement as HTMLElement).dataset : null;
    a.innerHTML = h; const l = a.querySelector(".tk-flist"); if (l) l.scrollTop = sc;
    if (f?.tkcard) a.querySelector<HTMLElement>(`[data-tkcard="${CSS.escape(f.tkcard)}"]`)?.focus({ preventScroll: true });
  });
  const sh = document.querySelector<HTMLElement>("#tkfs .tk-sheet");
  if (sh && F.sheet === k) { const sc = sh.querySelector(".tk-flist")?.scrollTop ?? 0; sh.innerHTML = feedHtml(k, true); const l = sh.querySelector(".tk-flist"); if (l) l.scrollTop = sc; }
}
// After the open task repaints (or any data change): the slots and the wrapper follow the task's real id, everything repaints.
export function tkSync(slug: string, sid: any) {
  const k = key(slug, sid);
  if (D?.current() === k) {
    document.querySelectorAll<HTMLElement>(".tk-slot").forEach(w => { if (w.dataset.tks !== k) { w.dataset.tks = k; w.innerHTML = ""; } });
    document.querySelectorAll<HTMLElement>(".tk-w").forEach(w => { if (w.dataset.tkw !== k) w.dataset.tkw = k; });
  }
  paintBtns(k); paintFeed(k); paintProgress(k); placeholder(k);
  if (M.k === k && M.id) paintModal();
}
function placeholder(k: string) {
  const b = document.getElementById("box") as HTMLTextAreaElement | null; if (!b || !D) return;
  const [slug, sid] = k.split("|"), on = ss(k).on && !!tkLiveCard(slug, sid) && D.working(slug, sid) && !!document.querySelector(`.tk-w[data-tkw="${CSS.escape(k)}"]`);
  if (b.dataset.tkph === undefined) b.dataset.tkph = b.placeholder;
  b.placeholder = on ? (D.phone() ? "Add more or steer" : `Add more or steer · ${D.helper(slug)} is working`) : b.dataset.tkph!;   // the phone's one line fits the short form
}
function paintBtns(k: string) {
  document.querySelectorAll<HTMLElement>(".tk-slot").forEach(w => {
    if (w.dataset.tks !== k) return; const h = btnInner(k, w.classList.contains("m")); if (w.dataset.h === h && (!!h === !!w.firstElementChild)) return;
    const f = document.activeElement === w.firstElementChild; w.dataset.h = h; w.innerHTML = h;
    const b = w.firstElementChild as HTMLElement | null; if (b && f) b.focus({ preventScroll: true });
  });
}
function toggleFeed(k: string, btn?: HTMLElement, kb = false) {
  const m = mode(); if (m === "sheet") { openSheet(k); return; }
  const on = !feedOpen(); setPref(m, on); paintFeed(k); paintBtns(k);
  if (on && m === "drawer" && kb) document.querySelector<HTMLElement>(`.tk-w[data-tkw="${CSS.escape(k)}"] .tk-feed .tk-row, .tk-w[data-tkw="${CSS.escape(k)}"] .tk-feed .tk-x`)?.focus({ preventScroll: true });
  else if (!on && btn) document.querySelector<HTMLElement>(`[data-tkbtn="${CSS.escape(k)}"]`)?.focus({ preventScroll: true });
}
function openSheet(k: string) {
  if (!D) return; F.sheet = k;
  let w = document.getElementById("tkfs"); if (!w) { w = document.createElement("div"); w.id = "tkfs"; document.body.appendChild(w); }
  w.innerHTML = `<div class="tk-sback" data-tkfeedx></div><div class="tk-sheet" role="dialog" aria-modal="true" aria-label="Activity">${feedHtml(k, true)}</div>`;
  D.dragToClose(w.querySelector<HTMLElement>(".tk-sheet")!, () => closeSheet());
  paintBtns(k); requestAnimationFrame(() => requestAnimationFrame(() => w!.classList.add("on")));
  w.querySelector<HTMLElement>(".tk-row, .tk-x")?.focus({ preventScroll: true });
}
function closeSheet(focus = true) {
  const w = document.getElementById("tkfs"), k = F.sheet; if (!k) return; F.sheet = ""; paintBtns(k);
  if (focus) focusHeaderAction(document.querySelector<HTMLElement>(`[data-tkbtn="${CSS.escape(k)}"]`), D?.phone());
  if (!w) return; w.classList.remove("on"); setTimeout(() => { if (!F.sheet) w.innerHTML = ""; }, 320);
}

// The turn's one progress row: one orb in a fixed slot and two lines of text. Line 1 is the open helper's title, else the
// assistant's name. Line 2 is the status. The row never gains or loses a part; only its text changes. The same row stays after the
// turn's reply while a helper is open, and a click on it opens that helper.
// The orb always animates. A helper that is waiting on the person gets the still helper icon in the same slot, unless the turn itself is running.
const helperMark = (h: HelperView, turnRunning = false) => h.status === "running" || turnRunning ? orb("working") : svg(P.helper, 15);
const isOpenHelper = (h: HelperView) => ["running", "waiting_input", "awaiting_review"].includes(h.status);
const openHelpers = (k: string) => ss(k).helpers.filter(isOpenHelper);
// The turn's own card: the card that is working now, else the newest card (the turn that just replied).
const turnCardId = (k: string) => { const s = ss(k); return s.on ? (s.cards.find(isOpen) || s.cards[0])?.id || "" : ""; };
// A helper belongs to the turn when that turn's card started it (parent_card) or is its own or result card. An older turn's helper that is still open
// never shows in a later turn's row; it stays reachable in the task's job list. With no turn card known, only a helper with no parent card counts.
export const turnHelpers = (k: string) => { const id = turnCardId(k);
  return openHelpers(k).filter(h => id ? h.parent_card === id || h.card === id || h.result_card === id : !h.parent_card); };
// A paused worker says what the person can do on screen: the browser card, the Link approval, or a visible question. Otherwise Primary is deciding.
export const progressStatus = (h: HelperView, question = false) => h.status === "waiting_input" ? (h.input_kind === "browser" ? "Waiting on you in the browser" : h.input_kind === "purchase_wait" ? "Waiting on you to approve in Link" : question ? "Needs your answer" : "Subagent working") : h.status === "awaiting_review" ? "Ready for review" : "Subagent working";
export function tkProgress(slug: string, sid: any, name: string, primary: string, question = false) {
  const h = turnHelpers(key(slug, sid))[0];
  if (!h && !primary) return `<div class="turn-progress" role="status"></div>`;
  const open = h ? ` data-tkhelper="${esc(String(h.id))}" tabindex="0" aria-label="${esc(h.name || "Subagent")}. ${progressStatus(h, question)}. Open task"` : "";
  return `<div class="turn-progress" role="status"${open}><span class="tp-orb">${h ? helperMark(h, !!primary) : orb("working")}</span><span class="tp-text"><b>${esc((h ? h.name : "") || name)}</b><span>${esc(h ? progressStatus(h) : primary)}</span></span></div>`;
}
// A helper change repaints the chat once, so the row's text follows it. The repaint calls tkSync again with the same signature.
const progressSig = new Map<string, string>();
function paintProgress(k: string) {
  const sig = turnHelpers(k).map(h => `${h.id}:${h.status}:${h.input_kind || ""}:${h.name}`).join("|");
  if ((progressSig.get(k) ?? "") === sig) return; progressSig.set(k, sig);
  const [slug, sid] = k.split("|"); if (D?.current() === k) D.repaint(slug, sid);
}

// ---------- Chat hooks: finished-turn chip, live steps ----------
export function tkChip(slug: string, sid: any, id?: string) {
  if (!id || !tkOn(slug, sid)) return ""; const c = tkCardView(slug, sid, id); if (!c || isOpen(c)) return "";
  const n = c.steps || 0, quiet = !n && (c.msgs || 1) <= 1 && c.kind === "chat" && !(c.from || []).length; if (quiet) return "";
  const ic = c.status === "complete" ? svg(P.check, 13, 2.2) : statusIcon(c.status);
  return `<button type="button" class="tk-chip s-${esc(c.status)}" data-tkcard="${esc(c.id)}" title="Open the task card">${ic}<b>${esc(c.title || "Task")}</b>${n ? `<span>· ${plural(n, "step")}</span>` : ""}</button>`;
}
// A person's message added by the server (another tab, a text): v3 adds the bubble if it's missing.
export const tkMsgOf = (ev: any) => ev?.t === "card_event" && ev.event?.type === "msg" ? ev.event as EventView : null;

// ---------- Card modal ----------
export function tkOpen(slug: string, sid: any, id: string, sel = "sum", push = false) {
  if (!D) return; const k = key(slug, sid);
  if (push && M.id && M.id !== id) M.back.push(M.id); else if (!push) M.back = [];
  if (!M.id) M.from = document.activeElement as HTMLElement | null;
  M.k = k; M.id = id; M.sel = sel; M.view = sel === "sum" ? "list" : "detail"; M.err = "";
  let w = document.getElementById("tkm"); if (!w) { w = document.createElement("div"); w.id = "tkm"; document.body.appendChild(w); }
  if (!w.firstElementChild) { w.innerHTML = `<div class="tk-mback" data-tkmx></div><div class="tk-modal" role="dialog" aria-modal="true" aria-labelledby="tkmt"></div>`; requestAnimationFrame(() => requestAnimationFrame(() => w!.classList.add("on"))); }
  paintModal(true); fetchCard();
  if (sel !== "sum") loadStep();
}
async function fetchCard() {
  const id = M.id, [slug, sid] = M.k.split("|"); if (!id || !D) return;
  try {
    const r = await D.api(`/res/${slug}/sessions/${sid}/cards/${id}`);
    if (r?.card?.id) {
      const cur = DET[id], ev = sorted(r.card.events || []);
      for (const e of cur?.events || []) if (!ev.some(x => x.seq === e.seq)) ev.push(e);   // live events newer than the fetch
      DET[id] = { ...(cur || {}), ...r.card, events: sorted(ev) };
      upsertCard(M.k, r.card, false); for (const h of r.card.helpers || []) upsertHelper(M.k, h);
    } else if (!DET[id]) M.err = r?.error === "not found" || !r?.error ? "This card isn't available any more." : `Couldn't open this card (${r.error}).`;
  } catch (e: any) { if (!DET[id]) M.err = `Couldn't open this card (${e.message}).`; }
  if (M.id === id) { paintModal(); if (M.sel !== "sum") loadStep(); }
}
async function loadStep() {
  const id = M.id, seq = M.sel.startsWith("e") ? +M.sel.slice(1) : 0, [slug, sid] = M.k.split("|"), e = DET[id]?.events.find(x => x.seq === seq);
  if (!e || e.type !== "step" || !D || STEP[`${id}|${seq}`] || BUSY[`st${id}|${seq}`]) return;
  BUSY[`st${id}|${seq}`] = true;
  try { const r = await D.api(`/res/${slug}/sessions/${sid}/cards/${id}/steps/${seq}`); if (r?.step) STEP[`${id}|${seq}`] = r.step; } catch {}
  BUSY[`st${id}|${seq}`] = false; if (M.id === id && M.sel === `e${seq}`) paintModal();
}
export function tkClose(focus = true) {
  const w = document.getElementById("tkm"); if (!M.id) return; M.id = ""; M.back = [];
  if (w) { w.classList.remove("on"); setTimeout(() => { if (!M.id) w.innerHTML = ""; }, 240); }
  // Focus goes back where it came from; if that's gone or hidden (the drawer closed when the card opened), to the Activity button.
  if (focus) { const f = M.from, k = M.k, shown = !!f?.isConnected && !!f.offsetParent && !f.closest(".tk-w:not(.tk-open) .tk-feed");
    if (shown) f!.focus({ preventScroll: true });
    else focusHeaderAction(document.querySelector<HTMLElement>(`[data-tkbtn="${CSS.escape(k)}"]`), D?.phone()); }
  M.from = null;
}
function railRow(d: CardDetail, e: EventView, k: string) {
  const on = M.sel === `e${e.seq}`, attr = `data-tksel="e${e.seq}" role="option" aria-selected="${on}" tabindex="${on ? 0 : -1}"`;
  if (e.type === "msg") return `<button type="button" class="tk-rr t-msg${on ? " on" : ""}" ${attr}><span class="tk-ri">${svg(P.user, 14)}</span><span class="tk-rtx"><b class="tk-2l">${esc(e.text || (e.files?.length ? plural(e.files.length, "file") : "Message"))}</b><small>${e.seq > 1 || (e.consumed || 0) > 0 ? "You added · " : "You · "}${esc(hm(e.at))}</small></span></button>`;
  if (e.type === "handoff") { const h = e.from || {}; const nm = h.type === "followup" ? `Follow-up: ${h.title || "due now"}` : h.type === "connect" ? h.title || "App connected" : `From background job #${h.id ?? e.ref}: ${h.title || ""}`;
    return `<button type="button" class="tk-rr t-hand${on ? " on" : ""}" ${attr}><span class="tk-ri">${svg(P.handoff, 14)}</span><span class="tk-rtx"><b>${esc(nm)}</b><small>${esc(hm(e.at))}</small></span></button>`; }
  const st = e.status || "ok", h = e.tool === "start_helper" && e.ref ? helperById(k, e.ref) : null;
  return `<button type="button" class="tk-rr t-step s-${esc(st)}${on ? " on" : ""}" ${attr}><span class="tk-ri">${svg(toolGlyph(e.tool), 14)}</span><span class="tk-rtx"><b>${esc(e.title || e.tool || "Step")}</b>
    <small>${st === "running" ? "Running…" : st === "skipped" ? "Not run" : st === "error" ? `Failed${e.ms != null ? ` · ${fmtMs(e.ms)}` : ""}` : fmtMs(e.ms) || "Done"}</small>${e.tool === "start_helper" && e.ref ? `<span class="tk-hchip h-${esc(h?.status || "running")}" data-tkhelper="${esc(String(e.ref))}" role="link" tabindex="-1">${svg(P.helper, 12)}Background job #${esc(String(e.ref))} · ${esc(h ? helperStatus(h.status) : "working")}</span>` : ""}</span><i class="tk-sd" aria-hidden="true"></i></button>`;
}
function railHtml(d: CardDetail, k: string) {
  const end = isOpen(d) ? `<div class="tk-rr tk-edge live">${d.status === "queued" ? svg(P.clock, 14) : spin()}<span>${d.status === "queued" ? "Queued…" : "Working…"}</span></div>`
    : `<div class="tk-rr tk-edge s-${esc(d.status)}">${statusIcon(d.status)}<span>${esc(d.status === "complete" ? "Completed" : LABEL[d.status] || d.status)}${d.closed ? ` · ${esc(hm(d.closed))}` : ""}</span></div>`;
  const sum = M.sel === "sum";
  return `<button type="button" class="tk-rr t-sum${sum ? " on" : ""}" data-tksel="sum" role="option" aria-selected="${sum}" tabindex="${sum ? 0 : -1}"><span class="tk-ri">${svg(P.sum, 14)}</span><span class="tk-rtx"><b>Summary</b></span>${D?.phone() ? `<span class="tk-rch">${svg(P.chev, 14)}</span>` : ""}</button>
    <div class="tk-tl"><div class="tk-rr tk-edge">${svg(P.clock, 14)}<span>Started · ${esc(hm(d.started || d.opened))}</span></div>
    ${sorted(d.events).map(e => railRow(d, e, k)).join("")}${end}</div>`;
}
function summaryHtml(d: CardDetail, k: string) {
  const [slug] = k.split("|"), who = D?.helper(slug) || "your helper", live = isOpen(d), steps = d.steps ?? d.events.filter(e => e.type === "step").length, msgs = d.msgs ?? d.events.filter(e => e.type === "msg").length;
  const meta = [range(d.started || d.opened, d.closed), steps ? plural(steps, "step") : "", msgs > 1 ? plural(msgs, "message") : ""].filter(Boolean).join(" · ");
  const hs = (d.helpers || []).length ? d.helpers! : d.kind === "helper" ? ss(k).helpers.filter(h => h.card === d.id) : [];
  const text = d.summary ? d.summary.split(/\n{2,}/).map(p => `<p>${esc(p)}</p>`).join("")
    : live ? `<p class="tk-mute">Working… the summary appears when ${esc(d.kind === "helper" ? "the background job finishes" : `${who} replies`)}.</p>`
    : d.legacy ? `<p class="tk-mute">This task ran before task cards kept summaries. Its steps are on the left.</p>`
    : d.status === "interrupted" ? `<p class="tk-mute">A restart interrupted this task before ${esc(who)} replied. Your messages are kept in the chat.</p>`
    : `<p class="tk-mute">No summary for this one.</p>`;
  const reply = d.reply ? (D?.plain(d.reply) || d.reply) : "";
  return `<div class="tk-sum">${d.result ? `<p class="tk-res">${esc(d.result)}</p>` : ""}<p class="tk-meta">${esc(meta)}</p>
    <div class="tk-stext">${text}</div>
    ${d.progress?.length || d.progress_omitted ? `<section class="tk-progress"><h3>Progress notes</h3>${d.progress_omitted ? `<p class="tk-mute">${esc(d.progress_omitted)} earlier notes are no longer retained. The available steps remain in this card.</p>` : ""}${(d.progress || []).map(p => `<p>${esc(p)}</p>`).join("")}</section>` : ""}
    ${d.saved?.length ? `<section class="tk-saved"><h3>Saved memory</h3>${d.saved.map(x => D?.savedChip?.(slug, x) || "").join("")}</section>` : ""}
    ${hs.map(h => `<div class="tk-hcard"><span class="tk-hico">${helperMark(h)}</span><div><b>Background job #${h.id}: ${esc(h.name)}</b><span>${esc(h.status === "running" ? `Working · ${ago(h.started)}` : h.status === "stopped" ? `Stopped${h.stopped_by ? ` by ${h.stopped_by === "person" ? "you" : h.stopped_by === "limit" ? "its limit" : who}` : ""}` : helperStatus(h.status))}</span></div>
      ${["running", "waiting_input", "awaiting_review"].includes(h.status) ? `<button type="button" class="tk-stop" data-tkstop="${h.id}"${BUSY[`stop${h.id}`] ? " disabled" : ""}>${svg(P.stop, 13, 2)}<span>${BUSY[`stop${h.id}`] ? "Stopping…" : "Stop"}</span></button>` : ""}
      ${h.card && h.card !== d.id ? `<button type="button" class="tk-lnk" data-tkopen="${esc(h.card)}">Open</button>` : ""}</div>`).join("")}
    ${reply ? `<div class="tk-reply"><h3>${d.kind === "helper" ? "Report" : "Reply"}</h3><p>${esc(reply.length > 420 ? reply.slice(0, 418).replace(/\s+\S*$/, "") + "…" : reply)}</p>${d.kind === "helper" ? "" : `<button type="button" class="tk-lnk" data-tkchat>Show in chat</button>`}</div>` : ""}</div>`;
}
// "What ran": the command, or the inputs as plain "name: value" lines (none for 1Helm's own tools: the server sends no input).
function ranText(x: StepDetail) {
  if (x.cmd) return x.cmd;
  const inp = x.input;
  if (inp && typeof inp === "object") {
    const l = Object.entries(inp).filter(([, v]) => v != null && v !== "" && v !== false && !(Array.isArray(v) && !v.length)).map(([k2, v]) => `${k2.replace(/_/g, " ")}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
    return l.map(z => z.length > 400 ? z.slice(0, 399) + "…" : z).join("\n");
  }
  return x.result?.internal ? "" : x.input_preview || "";
}
const fileIco = '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>';
function resultHtml(x: StepDetail, slug: string, loaded: boolean, key2: string) {
  const r = x.result!, who = D?.helper(slug) || "your helper";
  const files = (r.files || []).map(f => f.id && D?.fileChip ? D.fileChip(slug, { id: f.id, name: f.name, mime: f.mime || "", bytes: f.bytes || 0, at: 0, image: !!f.image })
    : `<span class="tk-fchip" title="${esc(f.path || f.name)}">${svg(fileIco, 15)}<span><b>${esc(f.name)}</b>${f.size || f.bytes != null ? `<small>${esc(f.size || fmtBytes(f.bytes || 0))}${f.path && !f.id ? " · on the computer" : ""}</small>` : f.path ? `<small>on the computer</small>` : ""}</span></span>`).join("");
  const links = (r.links || []).map(l => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer"><span class="tk-lt">${esc(l.title || l.host)}</span><span class="tk-lh">${esc(l.host)}</span></a></li>`).join("");
  const items = (r.items || []).map(t => `<li>${esc(t)}</li>`).join("");
  const det = loaded ? x.result?.details || "" : "", open = !!M.det[key2];
  const dl = det && D ? `${D.base()}/res/${encodeURIComponent(slug)}/sessions/${encodeURIComponent(M.k.split("|")[1])}/cards/${encodeURIComponent(M.id)}/steps/${x.seq}?dl=1` : "";
  return `<div class="tk-res${r.error ? " bad" : ""}">
    ${r.error ? `<p class="tk-rerr">${svg(P.alert, 16)}<span>${esc(r.error)}</span></p>${r.text ? `<p class="tk-rtext">${esc(r.text)}</p>` : ""}` : `<p class="tk-rtext">${esc(r.text || "Done")}</p>`}
    ${files ? `<div class="tk-files2">${files}</div>` : ""}
    ${links ? `<ul class="tk-links">${links}</ul>` : ""}
    ${items ? `<ul class="tk-items">${items}</ul>` : ""}
    ${r.code ? `<details class="tk-fold" data-tkfold="${esc(`code${key2}`)}"${M.det[`code${key2}`] === false ? "" : " open"}><summary>${svg(P.chev, 13)}<span>Last lines of output</span></summary><pre class="tk-out tk-tail" data-tkout>${esc(r.code)}</pre></details>` : ""}
    ${r.hidden ? `<p class="tk-trunc">Part of this was ${esc(who)}'s own instructions, so it isn't shown.</p>` : ""}
    ${r.more || det ? `<details class="tk-fold" data-tkfold="${esc(key2)}"${open ? " open" : ""}><summary>${svg(P.chev, 13)}<span>Details</span></summary>
      ${det ? `<div class="tk-obar"><span>${x.result?.cut ? "The first part" : "Everything it got back, cleaned up"}</span><button type="button" class="tk-cp" data-tkcopy="out">${svg(P.copy, 13)}<span>Copy</span></button><a class="tk-cp" href="${esc(dl)}" download data-tkdl>${svg(P.dl, 13)}<span>Download</span></a></div><pre class="tk-out" data-tkdet>${esc(det)}</pre>`
        : `<p class="tk-mute">${loaded ? "Nothing more to show." : `${spin()} Loading…`}</p>`}</details>` : ""}
  </div>`;
}
function stepPane(d: CardDetail, e: EventView, k: string) {
  const [slug, sid] = k.split("|"), x: StepDetail = { ...e, ...(STEP[`${d.id}|${e.seq}`] || {}) }, loaded = !!STEP[`${d.id}|${e.seq}`], st = x.status || "ok";
  const ran = x.result ? ranText(x) : x.cmd || (x.input !== undefined ? `${x.tool || ""}\n${JSON.stringify(x.input, null, 2)}` : x.input_preview ? `${x.tool ? `${x.tool}\n` : ""}${x.input_preview}` : x.tool || "");
  const exit = st === "running" ? `<span class="tk-exit run">${spin()}Running</span>` : st === "skipped" ? `<span class="tk-exit skip">Not run</span>`
    : x.exit == null ? `<span class="tk-exit ${st === "error" ? "bad" : "ok"}">${st === "error" ? "Failed" : "Done"}</span>` : `<span class="tk-exit ${x.exit === 0 ? "ok" : "bad"}">exit ${x.exit}</span>`;
  const out = loaded ? x.output ?? "" : x.out_preview ?? "", dl = `${D!.base()}/res/${encodeURIComponent(slug)}/sessions/${encodeURIComponent(sid)}/cards/${encodeURIComponent(d.id)}/steps/${e.seq}?dl=1`;
  const h = x.tool === "start_helper" && x.ref ? helperById(k, x.ref) : null;
  const body = st === "skipped" ? `<p class="tk-mute">Not run: you sent a new message before this step, so ${esc(D?.helper(slug) || "your helper")} read that first.</p>`
    : st === "running" && !x.result?.text && !out ? `<p class="tk-mute">Running now. The result shows here when it finishes.</p>`
    : x.result ? resultHtml(x, slug, loaded, `${d.id}|${e.seq}`)
    // an older server without results: the preview as before
    : `<div class="tk-outw"><div class="tk-obar"><span>Output${x.out_bytes ? ` · ${esc(fmtBytes(x.out_bytes))}` : ""}</span><button type="button" class="tk-cp" data-tkcopy="out">${svg(P.copy, 13)}<span>Copy</span></button><a class="tk-cp" href="${esc(dl)}" download data-tkdl>${svg(P.dl, 13)}<span>Download</span></a></div>
        <pre class="tk-out" data-tkout>${esc(out || "(no output)")}</pre></div>`;
  return `<div class="tk-step"><h3 class="tk-pt">${esc(x.title || x.tool || "Step")}</h3>
    <div class="tk-why"><b>Why it mattered</b><p${x.why ? "" : ` class="tk-mute"`}>${esc(x.why || "Written when the task completes.")}</p></div>
    ${x.tool === "start_helper" && x.ref ? `<button type="button" class="tk-hchip big h-${esc(h?.status || "running")}" data-tkhelper="${esc(String(x.ref))}">${svg(P.helper, 13)}Background job #${esc(String(x.ref))}${h ? `: ${esc(h.name)} · ${esc(helperStatus(h.status))}` : ""} ›</button>` : ""}
    <div class="tk-sec"><div class="tk-sh"><b>Result</b>${exit}${x.ms != null && st !== "running" ? `<span class="tk-ms">${esc(fmtMs(x.ms))}</span>` : ""}<span class="tk-at">${esc(hms(x.at))}</span></div>${body}</div>
    ${ran ? `<div class="tk-sec"><div class="tk-sh"><b>${x.cmd ? "What ran" : "What it asked for"}</b><button type="button" class="tk-cp" data-tkcopy="ran">${svg(P.copy, 13)}<span>Copy</span></button></div><pre class="tk-code" data-tkran>${esc(ran)}</pre></div>` : ""}
  </div>`;
}
function msgPane(e: EventView) {
  return `<div class="tk-msgp"><h3 class="tk-pt">${e.seq > 1 || (e.consumed || 0) > 0 ? "Joined while working" : "Started the task"}</h3><p class="tk-meta">${esc(hms(e.at))}${e.via === "text" ? " · by text" : ""}</p>
    <div class="tk-full">${esc(e.text || "")}</div>${(e.files || []).length ? `<ul class="tk-files">${e.files!.map((f: any) => `<li>${svg(P.file, 13)}${esc(f.name || "File")}</li>`).join("")}</ul>` : ""}</div>`;
}
function handPane(e: EventView, k: string) {
  const f = e.from || {}, h = f.type === "helper" ? helperById(k, f.id ?? e.ref) : null;
  return `<div class="tk-msgp"><h3 class="tk-pt">${esc(f.type === "followup" ? `Follow-up: ${f.title || ""}` : f.type === "connect" ? f.title || "App connected" : `From background job #${f.id ?? e.ref}: ${f.title || h?.name || ""}`)}</h3><p class="tk-meta">${esc(hms(e.at))}</p>
    <div class="tk-full">${esc(nativeHandoffText(e))}</div>${h?.card ? `<button type="button" class="tk-lnk" data-tkopen="${esc(h.card)}">Open its card ›</button>` : f.type === "helper" ? `<button type="button" class="tk-lnk" data-tkhelper="${esc(String(f.id ?? e.ref))}">Open its card ›</button>` : ""}</div>`;
}
function paneHtml(d: CardDetail, k: string) {
  if (M.sel === "sum") return summaryHtml(d, k);
  const e = d.events.find(x => `e${x.seq}` === M.sel); if (!e) return summaryHtml(d, k);
  return e.type === "step" ? stepPane(d, e, k) : e.type === "handoff" ? handPane(e, k) : msgPane(e);
}
function paintModal(focus = false) {
  const box = document.querySelector<HTMLElement>("#tkm .tk-modal"); if (!box || !M.id) return;
  const d = DET[M.id], phone = !!D?.phone(), k = M.k;
  const sc = { r: box.querySelector(".tk-rail")?.scrollTop ?? 0, p: box.querySelector(".tk-pane")?.scrollTop ?? 0 }, fsel = (document.activeElement as HTMLElement | null)?.closest?.("#tkm") ? (document.activeElement as HTMLElement).dataset.tksel : undefined;
  const st = d?.status || "working", helper = d?.kind === "helper";
  const back = M.back.length ? `<button type="button" class="tk-x tk-bk" data-tkup aria-label="Back to the task">${svg(P.back, 18)}</button>` : "";
  const head = `<div class="tk-mhead">${back}<span class="tk-badge b-${esc(st)}"><i></i>${esc(LABEL[st] || st)}</span>${helper ? `<span class="tk-tag">Background</span>` : ""}<h2 id="tkmt">${esc(d?.title || (M.err ? "Task card" : "Loading…"))}</h2><button type="button" class="tk-x" data-tkmx aria-label="Close">${svg(P.x, 18)}</button></div>`;
  let body: string;
  if (!d) body = `<div class="tk-mbody one"><div class="tk-pane">${M.err ? `<p class="tk-mute">${esc(M.err)}</p>` : `<p class="tk-mute">${spin()} Loading…</p>`}</div></div>`;
  else if (phone && M.view === "detail") {
    const lab = M.sel === "sum" ? "Summary" : (() => { const e = d.events.find(x => `e${x.seq}` === M.sel); return e?.type === "msg" ? "Your message" : e?.type === "handoff" ? "Handoff" : "Step"; })();
    body = `<div class="tk-mbody one"><button type="button" class="tk-pback" data-tkpback>${svg(P.back, 18)}<span>${esc(d.title || "Task")}</span></button><div class="tk-pane" aria-label="${esc(lab)}">${paneHtml(d, k)}</div></div>`;
  } else body = `<div class="tk-mbody${phone ? " one" : ""}"><nav class="tk-rail" role="listbox" aria-label="Timeline">${railHtml(d, k)}</nav>${phone ? "" : `<section class="tk-pane">${paneHtml(d, k)}</section>`}</div>`;
  box.classList.toggle("phone", phone);
  box.innerHTML = head + body;
  const r = box.querySelector(".tk-rail"), p = box.querySelector(".tk-pane"); if (r) r.scrollTop = sc.r; if (p && !focus) p.scrollTop = sc.p;
  if (focus) (box.querySelector<HTMLElement>(phone && M.view === "detail" ? "[data-tkpback]" : `[data-tksel="${M.sel}"]`) || box.querySelector<HTMLElement>("[data-tkmx]"))?.focus({ preventScroll: true });
  else if (fsel) box.querySelector<HTMLElement>(`[data-tksel="${CSS.escape(fsel)}"]`)?.focus({ preventScroll: true });
}
function select(sel: string, focus = true) {
  M.sel = sel; if (D?.phone()) M.view = "detail";
  paintModal(); if (focus) document.querySelector<HTMLElement>(D?.phone() ? "#tkm [data-tkpback]" : `#tkm [data-tksel="${CSS.escape(sel)}"]`)?.focus({ preventScroll: true });
  const p = document.querySelector("#tkm .tk-pane"); if (p) p.scrollTop = 0;
  loadStep();
}
async function openHelper(k: string, id: string) {
  const [slug, sid] = k.split("|"); let h = helperById(k, id);
  if (!h?.card) { await loadHelpers(slug, sid); h = helperById(k, id); }
  if (h?.card) tkOpen(slug, sid, h.card, "sum", !!M.id); else D?.note("That card isn't ready yet", "Try again in a moment.");
}
async function stopHelper(k: string, id: string) {
  const [slug, sid] = k.split("|"); if (BUSY[`stop${id}`] || !D) return; BUSY[`stop${id}`] = true; tkSync(slug, sid);
  try {
    const r = await D.api(`/res/${slug}/sessions/${sid}/helpers/${id}/stop`, {});
    if (r?.helper) upsertHelper(k, r.helper); else if (r?.ok) upsertHelper(k, { ...(helperById(k, id) as HelperView), status: "stopped", stopped_by: "person" });
    else D.note("Couldn't stop the background job", r?.error === "payment_required" || r?.error === "read_only" ? "Your plan needs attention before you can change things." : r?.error || "Try again in a moment.");
  } catch (e: any) { D.note("Couldn't stop the background job", e.message || "Try again in a moment."); }
  BUSY[`stop${id}`] = false; tkSync(slug, sid);
}
async function copy(btn: HTMLElement, text: string) {
  let ok = false; try { await navigator.clipboard.writeText(text); ok = true; } catch {
    const t = document.createElement("textarea"); t.value = text; t.style.cssText = "position:fixed;opacity:0"; document.body.appendChild(t); t.select(); try { ok = document.execCommand("copy"); } catch {} t.remove(); }
  const sp = btn.querySelector("span"); if (sp) { sp.textContent = ok ? "Copied" : "Couldn't copy"; btn.classList.add("done"); setTimeout(() => { if (sp.isConnected) { sp.textContent = "Copy"; btn.classList.remove("done"); } }, 1600); }
}

export function tkInit(d: Deps) {
  D = d;
  document.addEventListener("click", e => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>("[data-tkbtn]"); if (b) { e.preventDefault(); e.stopPropagation(); toggleFeed(b.dataset.tkbtn!, b, !(e as MouseEvent).detail); return; }
    if (t.closest("[data-tkfeedx]")) { e.preventDefault(); const w = t.closest<HTMLElement>(".tk-w"); if (F.sheet && t.closest("#tkfs")) closeSheet(); else if (w) { const m = mode(); if (m !== "sheet") setPref(m, false); paintFeed(w.dataset.tkw!); paintBtns(w.dataset.tkw!); } return; }
    const st = t.closest<HTMLElement>("[data-tkstop]"); if (st) { e.preventDefault(); e.stopPropagation(); const k = M.id && t.closest("#tkm") ? M.k : (t.closest<HTMLElement>(".tk-w")?.dataset.tkw || F.sheet || D!.current()); stopHelper(k, st.dataset.tkstop!); return; }
    const hp = t.closest<HTMLElement>("[data-tkhelper]"); if (hp) { e.preventDefault(); e.stopPropagation(); const k = t.closest("#tkm") ? M.k : (t.closest<HTMLElement>(".tk-w")?.dataset.tkw || F.sheet || D!.current()); if (k) { if (F.sheet && t.closest("#tkfs")) closeSheet(); openHelper(k, hp.dataset.tkhelper!); } return; }
    const op = t.closest<HTMLElement>("[data-tkopen]"); if (op && M.id) { e.preventDefault(); const [slug, sid] = M.k.split("|"); tkOpen(slug, sid, op.dataset.tkopen!, "sum", true); return; }
    const c = t.closest<HTMLElement>("[data-tkcard]"); if (c) {
      e.preventDefault(); const k = t.closest<HTMLElement>(".tk-w")?.dataset.tkw || (t.closest("#tkfs") ? F.sheet : "") || D!.current();
      if (!k) return; const [slug, sid] = k.split("|"); if (t.closest("#tkfs")) closeSheet();
      if (mode() === "drawer" && t.closest(".tk-feed")) { setPref("drawer", false); paintFeed(k); paintBtns(k); }
      tkOpen(slug, sid, c.dataset.tkcard!); return;
    }
    if (t.closest("[data-tkmore]")) { e.preventDefault(); const k = t.closest<HTMLElement>(".tk-w")?.dataset.tkw || F.sheet; if (k) loadMore(k); return; }
    if (!M.id || !t.closest("#tkm")) return;
    if (t.closest("[data-tkmx]")) { e.preventDefault(); tkClose(); return; }
    if (t.closest("[data-tkup]")) { e.preventDefault(); const id = M.back.pop()!, [slug, sid] = M.k.split("|"), bk = M.back; tkOpen(slug, sid, id, "sum", false); M.back = bk; paintModal(true); return; }
    if (t.closest("[data-tkpback]")) { e.preventDefault(); M.view = "list"; paintModal(); document.querySelector<HTMLElement>(`#tkm [data-tksel="${CSS.escape(M.sel)}"]`)?.focus({ preventScroll: true }); return; }
    const s = t.closest<HTMLElement>("[data-tksel]"); if (s) { e.preventDefault(); select(s.dataset.tksel!); return; }
    const cp = t.closest<HTMLElement>("[data-tkcopy]"); if (cp) { e.preventDefault(); const el = document.querySelector<HTMLElement>(cp.dataset.tkcopy === "ran" ? "#tkm [data-tkran]" : "#tkm [data-tkdet], #tkm [data-tkout]");
      const x = STEP[`${M.id}|${M.sel.slice(1)}`]; copy(cp, cp.dataset.tkcopy === "out" && x?.result?.details ? x.result.details : cp.dataset.tkcopy === "out" && x?.output !== undefined ? x.output : el?.textContent || ""); return; }
    if (t.closest("[data-tkchat]")) { e.preventDefault(); const [slug, sid] = M.k.split("|"), id = M.id; tkClose(false); D!.showInChat(slug, sid, id); return; }
  }, true);
  window.addEventListener("keydown", e => {
    const row = (e.target as HTMLElement).closest?.<HTMLElement>(".turn-progress[data-tkhelper]"); if (row && e.target === row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); row.click(); return; }
    if (M.id) {
      if (e.key === "Escape" && document.getElementById("fv")?.classList.contains("on")) return;   // a file opened from a result: the viewer closes first
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); if (D?.phone() && M.view === "detail") { M.view = "list"; paintModal(true); } else tkClose(); return; }
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !(e.target as HTMLElement).closest?.("pre")) {
        const rows = [...document.querySelectorAll<HTMLElement>("#tkm [data-tksel]")]; if (!rows.length) return;
        e.preventDefault(); e.stopImmediatePropagation();
        const i = Math.max(0, rows.findIndex(r => r.dataset.tksel === M.sel)), cur = rows.indexOf(document.activeElement as HTMLElement), at = cur >= 0 ? cur : i;
        const n = rows[e.key === "ArrowDown" ? Math.min(rows.length - 1, at + 1) : Math.max(0, at - 1)];
        if (D?.phone()) n.focus(); else select(n.dataset.tksel!); return;
      }
      if (e.key === "Tab") {   // keep focus inside the card
        const f = [...document.querySelectorAll<HTMLElement>("#tkm .tk-modal button:not([disabled]), #tkm .tk-modal a[href]")].filter(x => x.tabIndex >= 0 && x.offsetParent !== null); if (!f.length) return;
        const i = f.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); }
      }
      return;
    }
    if (e.key === "Escape" && F.sheet) { e.preventDefault(); e.stopImmediatePropagation(); closeSheet(); return; }
    if (e.key === "Escape" && mode() === "drawer" && (e.target as HTMLElement).closest?.(".tk-feed")) { const w = (e.target as HTMLElement).closest<HTMLElement>(".tk-w")!; e.preventDefault(); e.stopImmediatePropagation(); setPref("drawer", false); paintFeed(w.dataset.tkw!); paintBtns(w.dataset.tkw!); document.querySelector<HTMLElement>(`[data-tkbtn="${CSS.escape(w.dataset.tkw!)}"]`)?.focus(); }
  }, true);
  // Result folds (Last lines, Details) keep their state across live repaints.
  document.addEventListener("toggle", e => { const t = e.target as HTMLDetailsElement; if (t?.matches?.("#tkm details[data-tkfold]")) M.det[t.dataset.tkfold!] = t.open; }, true);
  let lastMode = mode();
  window.addEventListener("resize", () => { const m = mode(); if (m === lastMode) return; lastMode = m; document.querySelectorAll<HTMLElement>(".tk-w").forEach(w => { paintFeed(w.dataset.tkw!); paintBtns(w.dataset.tkw!); }); if (M.id) paintModal(); if (m !== "sheet") closeSheet(); });
  new MutationObserver(() => { const m = mode(); if (m !== lastMode) { lastMode = m; document.querySelectorAll<HTMLElement>(".tk-w").forEach(w => paintFeed(w.dataset.tkw!)); } }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  window.addEventListener("hashchange", () => { tkClose(false); closeSheet(); });
  // Live clocks on the helper strip; a running helper's card refreshes every 3 s while it's open.
  setInterval(() => document.querySelectorAll<HTMLElement>("[data-tkel]").forEach(x => { x.textContent = `In the background · ${ago(+x.dataset.tkel!)}`; }), 20e3);
  setInterval(() => { const d = M.id ? DET[M.id] : null; if (d && d.kind === "helper" && isOpen(d) && !document.hidden) fetchCard(); }, 3000);
}
