// "Connect YouTube?" cards in chat (1HC connect-offer.js, tool offer_connect). Made by the SYSTEM, never by the model: the helper
// asks for one, 1HC stores it with the task (GET …/sessions/<id> → offers) and streams it live ({"t":"connect_offer"}).
//   Connect            the app's normal connect flow (Composio sign-in, or its secure key page for key-based apps) with from=offer,
//                      so coming back marks the card connected and the helper carries on (a note handed back into the task).
//   Not now            POST <api>/connect-offer {op:"dismiss"}; then "Don't suggest connecting apps" ({op:"off"}, Undo = {op:"on"}).
//   See what it can do the app's own page (app-detail.ts); its Connect also counts as this offer's.
//   Another account   (Captain 10-07) o.another: the app is already connected and they asked for one more: "Connect another Gmail
//                      account", Connect = Settings' Add another (another: true); once it's in, "✓ <its email> connected".
//   The draft          (Captain 10-07) what the helper would send or create once it's connected, under the buttons, in full: an
//                      email (to, cc, subject, body), an event (title, when and how long, calendar, guests) or plain text. Also on
//                      the app's page when it's opened from this card or from a texted offer's link (GET <api>/connect-offer?ch=&id=).
// Markup in the approved system-card look (genui-cards.css .gu-sys); its own bits are cxo-* (never ad-*: ad blockers hide those).
import { appLogo } from "../logo";
export type Draft =
  | { kind: "email"; to: string; cc?: string; subject: string; body: string }
  | { kind: "event"; title: string; start: string; end?: string; timezone?: string; calendar?: string; guests?: string[]; location?: string }
  | { kind: "text"; text: string; title?: string };
export type Offer = { id: number; app: string; name: string; why: string; logo: string; kind: "oauth" | "key"; reconnect: boolean; status: "pending" | "connected" | "dismissed"; turn: string | null; session?: string; draft?: Draft | null; another?: boolean; email?: string; already?: boolean };
export type OfferCard = { t: "offer"; o: Offer; ch: string; busy?: "go" | "no" | "off" | ""; err?: string; fresh?: boolean; ak?: number };
export type CxoDeps = {
  api: string;
  helper: (ch: string) => string;                                   // "Skipper"
  connected: (app: string) => boolean;                              // connected anywhere (the app's connected-apps store)
  connect: (app: string, name: string, offer: { ch: string; id: number }, another?: boolean) => void;   // existing connect flow, from=offer (another: Add another)
  openDetail: (app: string, name: string) => void;                  // the app's own page
  repaint: () => void;
  cards: () => OfferCard[];                                         // every offer card in loaded messages
  note: (title: string, sub: string) => void;
};
let D: CxoDeps | null = null;
let OFF = false;                 // the person tapped "Don't suggest connecting apps" (this page's view of the tenant flag)
let CTX: { app: string; ch: string; id: number; draft?: Draft | null } | null = null;   // the app page was opened from this offer

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const SPIN = `<i class="gu-bspin" aria-hidden="true"></i>`;
const ARROW = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>`;
const logoImg = (o: Offer) => appLogo(o.logo || o.app, o.name, "cxo-logo", 26);   // logo.ts: tinted initial tile at once, logo fades in over it (/applogo on live)

// ---------------- the draft ----------------
// An event's time, read the way it was written: with an offset (or Z) it's an instant, shown in the event's zone; without one it's
// that wall-clock time already (shown as is); a bare date is all day. → null when it can't be read (the raw text is shown instead).
type When = { at: Date; zone: string; allDay: boolean };
const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const zoneOk = (z?: string) => { if (!z) return false; try { new Intl.DateTimeFormat("en-US", { timeZone: z }); return true; } catch { return false; } };
function readWhen(s: string | undefined, tz: string): When | null {
  const m = String(s || "").trim().match(ISO); if (!m) return null;
  const [, y, mo, d, h, mi, se, off] = m;
  if (h == null) return { at: new Date(Date.UTC(+y, +mo - 1, +d)), zone: "UTC", allDay: true };
  if (!off) return { at: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(se || 0))), zone: "UTC", allDay: false };   // wall clock as written
  const at = new Date(`${y}-${mo}-${d}T${h}:${mi}:${se || "00"}${off === "Z" ? "Z" : off.length === 5 ? `${off.slice(0, 3)}:${off.slice(3)}` : off}`);
  return isNaN(+at) ? null : { at, zone: tz, allDay: false };
}
const fmt = (w: When, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: w.zone, ...o }).format(w.at);
const dayKey = (w: When) => fmt(w, { year: "numeric", month: "2-digit", day: "2-digit" });
const dayText = (w: When) => fmt(w, { weekday: "short", month: "short", day: "numeric", ...(fmt(w, { year: "numeric" }) !== String(new Date().getFullYear()) ? { year: "numeric" } : {}) });
const timeText = (w: When) => fmt(w, { hour: "numeric", minute: "2-digit" });
function zoneText(w: When, tz: string) {
  if (w.zone === "UTC" && !tz) return "";
  try { return new Intl.DateTimeFormat("en-US", { timeZone: tz || w.zone, timeZoneName: "short" }).formatToParts(w.at).find(p => p.type === "timeZoneName")?.value || ""; } catch { return ""; }
}
function lenText(mins: number) {
  if (!(mins > 0)) return "";
  if (mins % 1440 === 0 && mins >= 1440) return `${mins / 1440} day${mins === 1440 ? "" : "s"}`;
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return [h ? `${h} hr` : "", m ? `${m} min` : ""].filter(Boolean).join(" ");
}
/** When and how long, in plain words: "Fri, Oct 9 · 3:00 – 3:30 PM PDT" and "30 min". */
export function eventWhen(d: { start: string; end?: string; timezone?: string }): { when: string; len: string } {
  const tz = zoneOk(d.timezone) ? d.timezone! : "", a = readWhen(d.start, tz || Intl.DateTimeFormat().resolvedOptions().timeZone), b = d.end ? readWhen(d.end, a?.zone || tz) : null;
  if (!a) return { when: [d.start, d.end].filter(Boolean).join(" – "), len: "" };
  if (a.allDay) {
    const last = b && b.allDay && +b.at > +a.at ? { ...b, at: new Date(+b.at - 864e5) } : null;   // an all-day end is the day after the last day
    const days = last ? Math.round((+last.at - +a.at) / 864e5) + 1 : 1;
    return { when: `${dayText(a)}${last && days > 1 ? ` – ${dayText(last)}` : ""} · all day`, len: days > 1 ? `${days} days` : "" };
  }
  const z = zoneText(a, tz && a.zone === "UTC" ? tz : "") || (a.zone !== "UTC" ? zoneText(a, a.zone) : "");
  if (!b || b.allDay) return { when: `${dayText(a)} · ${timeText(a)}${z ? ` ${z}` : ""}`, len: "" };
  const mins = Math.round((+b.at - +a.at) / 6e4);
  const ta = timeText(a), tb = timeText(b), half = ta.slice(-3) === tb.slice(-3) ? ta.slice(0, -3) : ta;   // "3:00 – 3:30 PM"
  const when = dayKey(a) === dayKey(b) ? `${dayText(a)} · ${half} – ${tb}${z ? ` ${z}` : ""}` : `${dayText(a)}, ${timeText(a)} – ${dayText(b)}, ${timeText(b)}${z ? ` ${z}` : ""}`;
  return { when, len: lenText(mins) };
}
const MAIL_IC = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>`;
const CAL_IC = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>`;
const TXT_IC = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const row = (k: string, v: string) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
/** The draft under the card's buttons (and on the app's page). helper: "Skipper". state: the offer's status. */
export function draftHtml(d: Draft | null | undefined, opts: { helper: string; state?: string } = { helper: "Your helper" }) {
  if (!d || typeof d !== "object") return "";
  const h = esc(opts.helper), done = opts.state === "dismissed";
  if (d.kind === "email") {
    const fine = done ? "Not sent." : `Nothing is sent until you say so. ${h} will check it with you first.`;
    return `<div class="cxo-draft" role="group" aria-label="The email ${h} would send"><p class="cxo-dh">${MAIL_IC}<span>The email</span></p>
      <dl class="cxo-dm">${row("To", esc(d.to) || "<i>Not set yet</i>")}${d.cc ? row("Cc", esc(d.cc)) : ""}${row("Subject", esc(d.subject) || "<i>No subject</i>")}</dl>
      ${d.body ? `<div class="cxo-dbody">${esc(d.body)}</div>` : ""}<p class="cxo-dfine">${fine}</p></div>`;
  }
  if (d.kind === "event") {
    const w = eventWhen(d), g = (d.guests || []).filter(Boolean);
    const fine = done ? "Not added." : `Nothing is added until you say so. ${h} will check it with you first.${g.length ? " Guests get an email from the calendar." : ""}`;
    return `<div class="cxo-draft" role="group" aria-label="The event ${h} would add"><p class="cxo-dh">${CAL_IC}<span>The event</span></p>
      <p class="cxo-dt">${esc(d.title)}</p>
      <dl class="cxo-dm">${row("When", esc(w.when))}${w.len ? row("Length", esc(w.len)) : ""}${row("Calendar", esc(d.calendar || "Your main calendar"))}${d.location ? row("Where", esc(d.location)) : ""}${row("Guests", g.length ? g.map(esc).join(", ") : "None")}</dl>
      <p class="cxo-dfine">${fine}</p></div>`;
  }
  if (d.kind === "text" && d.text) return `<div class="cxo-draft" role="group" aria-label="What ${h} would send"><p class="cxo-dh">${TXT_IC}<span>${esc(d.title || "The draft")}</span></p>
      <div class="cxo-dbody">${esc(d.text)}</div><p class="cxo-dfine">${done ? "Nothing was done." : `Nothing goes until you say so. ${h} will check it with you first.`}</p></div>`;
  return "";
}

/** One card. state: pending (Connect / Not now), connected (✓ … connected), dismissed (Not now · Don't suggest…). */
export function offerCardHtml(c: OfferCard, opts: { helper: string; fresh?: boolean; attrs?: string } = { helper: "Your helper" }) {
  const o = c.o, k = `${esc(c.ch)}|${o.id}`, conn = o.status === "connected" || (o.status === "pending" && !o.another && !!D?.connected(o.app));   // another: it's connected already
  const st = conn ? "connected" : o.status, busy = c.busy || "", dis = busy ? " disabled" : "";
  const title = conn ? esc(o.name) : o.another ? `Connect another ${esc(o.name)} account` : `${o.reconnect ? "Reconnect" : "Connect"} ${esc(o.name)}?`;
  const what = o.another && o.email ? esc(o.email) : esc(o.name);
  let foot = "";
  if (st === "connected" && o.already) foot = `<div class="gu-pdone" role="status"><span class="gu-b nope">${what} was already connected</span><span>Nothing new was added</span></div>`;
  else if (st === "connected") foot = `<div class="gu-pdone" role="status"><span class="gu-b picked">✓ ${what} connected</span><span>${o.status === "connected" ? `${esc(opts.helper)} is carrying on` : `${esc(opts.helper)} can use it now`}</span></div>`;
  else if (st === "dismissed") foot = OFF
    ? `<p class="cxo-fine" role="status">OK. ${esc(opts.helper)} won't suggest connecting apps. You can still connect any app in Apps. <button type="button" class="cxo-link" data-cxoon="${k}"${dis}>Undo</button></p>`
    : `<div class="gu-pdone"><span class="gu-b nope">Not now</span><button type="button" class="cxo-link" data-cxooff="${k}"${dis}>${busy === "off" ? SPIN : ""}Don't suggest connecting apps</button></div>`;
  else foot = `<div class="gu-btns"><button type="button" class="gu-b primary${busy === "go" ? " busy" : ""}" data-cxogo="${k}"${dis}>${busy === "go" ? `${SPIN}Opening…` : o.reconnect ? "Reconnect" : "Connect"}</button><button type="button" class="gu-b ghost${busy === "no" ? " busy" : ""}" data-cxono="${k}"${dis}>Not now</button></div>`;
  const key = st === "pending" && o.kind === "key" ? `<p class="cxo-fine">You'll paste an API key from ${esc(o.name)} on a secure page. 1Helm never sees it.</p>` : "";
  const err = c.err && st === "pending" ? `<p class="gu-perr" role="alert">${esc(c.err)}</p>` : "";
  return `<div class="gu-sys cxo-card${st !== "pending" ? " locked" : ""}${opts.fresh ? " gu-in" : ""}" id="cxo${o.id}" data-cxost="${st}"${opts.attrs || ""}>
    <div class="gu-sh">${logoImg(o)}<b>${title}</b></div>
    ${o.why ? `<p class="gu-sl">${esc(o.why)}</p>` : ""}${key}${err}${foot}${draftHtml(o.draft, { helper: opts.helper, state: st })}
    ${o.app === "composio" ? "" : `<button type="button" class="cxo-more" data-cxoinfo="${k}">See what it can do${ARROW}</button>`}</div>`;   // composio: the Self-managed "Reconnect Composio" card (sign-in ended), not an app
}

const find = (k: string) => { const [ch, id] = k.split("|"); return (D?.cards() || []).filter(c => c.ch === ch && String(c.o.id) === id); };
async function post(body: any) {
  const r = await fetch(`${D!.api}/connect-offer`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({})); if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`); return d;
}
/** The app page's Connect: from=offer when the page was opened from this app's offer card (or its texted link). */
export function cxoFrom(app: string) { return CTX && CTX.app === app ? { ch: CTX.ch, id: CTX.id } : null; }
/** A card's server state changed (stream event connect_offer_done, or a reload). */
export function cxoUpdate(o: Offer) { for (const c of D?.cards() || []) if (c.o.id === o.id && c.o.session === o.session) { c.o = { ...c.o, ...o }; c.busy = ""; } }

export function cxoInit(deps: CxoDeps) {
  D = deps;
  document.addEventListener("click", async e => {
    const t = e.target as HTMLElement;
    const go = t.closest<HTMLElement>("[data-cxogo]"), no = t.closest<HTMLElement>("[data-cxono]"), info = t.closest<HTMLElement>("[data-cxoinfo]");
    const off = t.closest<HTMLElement>("[data-cxooff]"), on = t.closest<HTMLElement>("[data-cxoon]");
    const el = go || no || info || off || on; if (!el || !D) return;
    e.preventDefault();
    const k = (el.dataset.cxogo || el.dataset.cxono || el.dataset.cxoinfo || el.dataset.cxooff || el.dataset.cxoon)!, cs = find(k), c = cs[0]; if (!c) return;
    const set = (f: Partial<OfferCard>) => { cs.forEach(x => Object.assign(x, f)); D!.repaint(); };
    if (info) { CTX = { app: c.o.app, ch: c.ch, id: c.o.id, draft: c.o.draft || null }; D.openDetail(c.o.app, c.o.name); return; }
    if (c.busy) return;
    if (go) { if (c.o.status !== "pending") return; set({ busy: "go", err: "" }); CTX = { app: c.o.app, ch: c.ch, id: c.o.id, draft: c.o.draft || null }; D.connect(c.o.app, c.o.name, { ch: c.ch, id: c.o.id }, !!c.o.another);
      setTimeout(() => { if (c.busy === "go") set({ busy: "" }); }, 15e3); return; }   // the page normally leaves for the sign-in long before this
    if (no) { set({ busy: "no", err: "" });
      try { const d = await post({ op: "dismiss", ch: c.ch, id: c.o.id }); set({ busy: "", o: { ...c.o, ...(d.offer || {}), status: "dismissed" } }); }
      catch (err: any) { set({ busy: "", err: `Couldn't send that (${err.message}). Try again.` }); }
      return; }
    if (off) { set({ busy: "off" });
      try { await post({ op: "off" }); OFF = true; set({ busy: "" }); } catch (err: any) { set({ busy: "" }); D.note("Couldn't save that", err.message || "Try again in a moment."); }
      return; }
    if (on) { try { await post({ op: "on" }); OFF = false; D.repaint(); } catch (err: any) { D.note("Couldn't save that", err.message || "Try again in a moment."); } }
  }, true);
}
/** The app's page, opened from an offer that has a draft: the draft, under its Connect. "" otherwise. */
export function cxoDraftHtml(app: string) {
  if (!CTX || CTX.app !== app || !CTX.draft) return "";
  const live = (D?.cards() || []).find(c => c.ch === CTX!.ch && c.o.id === CTX!.id)?.o.status;
  return `<section class="apdsec cxo-onpage"><h3>What ${esc(D?.helper(CTX.ch) || "your helper")} will ${CTX.draft.kind === "event" ? "add" : "send"} once it's connected</h3>${draftHtml(CTX.draft, { helper: D?.helper(CTX.ch) || "Your helper", state: live })}</section>`;
}
/** On page load: ?appinfo=<app>[&offer=<ch>.<id>] (the link a texted offer carries) opens that app's page, tied to the offer, and
 *  fetches the offer for its draft (repaint draws it in). */
export function cxoBoot(openDetail: (app: string) => void, repaint: () => void = () => {}) {
  const sp = new URLSearchParams(location.search), app = (sp.get("appinfo") || "").toLowerCase().replace(/[^a-z0-9_]/g, ""); if (!app) return;
  const m = (sp.get("offer") || "").match(/^([a-z0-9][a-z0-9-]{0,62})\.(\d+)$/); if (m) CTX = { app, ch: m[1], id: +m[2] };
  sp.delete("appinfo"); sp.delete("offer"); const q = sp.toString(); history.replaceState(null, "", location.pathname + (q ? `?${q}` : "") + location.hash);
  setTimeout(() => openDetail(app), 60);
  if (m && D) { const want = CTX!;
    fetch(`${D.api}/connect-offer?ch=${encodeURIComponent(want.ch)}&id=${want.id}`, { credentials: "same-origin" }).then(r => r.ok ? r.json() : null)
      .then(d => { const o = d?.offer; if (!o || CTX !== want || o.app !== app) return; want.draft = o.draft || null; if (want.draft) repaint(); }).catch(() => {}); }
}
