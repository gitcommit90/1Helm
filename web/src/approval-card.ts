// Permission cards ("OK to send this to <host>?"): one markup for the app (v3.ts) and the card page inside Messages (card.ts),
// in the approved the design sandbox/genui look (CSS: the "Permission cards" block in genui-cards.css).
// These are made by the SYSTEM (Sentinel: stream events `approval` / `approval_done`, or GET /c/<token>/data kind:"approval"),
// never written by the model, so they never go through the OpenUI parser. No chat state in here: hosts pass what to show
// and how each button is wired (attr), and handle the taps themselves.
//   decisions: once = this request · session = this site for this task · channel = always, in this channel (asks "Are you sure?" first) · deny
// A request for a KIND of action (Settings → Permissions is Careful or Locked down; 1HC perms.js) has perm set: "OK to read your email?",
//   "<helper> wants to search your email for …". Its decisions: once (the rest of this request) · always (that kind, from now on;
//   listed in Settings → Permissions, where it can be taken back, so no "Are you sure?") · deny.
// A confirm card (perm "confirm", 1HC confirm.js): a send, delete, share or invite shown with its exact content (approval.action:
//   title, the lines that matter, the body, a note like "This can't be undone"). Two choices: Confirm (decision "once") · Cancel
//   ("deny"). It runs only on Confirm; an undecided card expires after 30 minutes.

import { logoOver } from "./logo";   // the destination's logo over the key icon (redirect=404: a look-alike host never borrows a brand's logo)

export type Decision = "once" | "session" | "channel" | "always" | "deny";
/** pending, a decision, "allowed" (approved somewhere else, decision unknown) or "expired". */
export type ApStatus = "pending" | Decision | "allowed" | "expired";
/** host: a site (Sentinel). perm: a kind of action (perms.js) with its plain name, what it would do, the question and the Always label. */
export type Approval = { id: number | string; host: string; bytes?: number; keys?: string[]; via?: "form" | "command" | "page" | string; perm?: string; name?: string; what?: string; ask?: string; always?: string; action?: ConfirmAction };
/** A confirm card (1HC confirm.js, perm "confirm"): the exact action, built by 1HC from what will run (never written by the model). */
export type ConfirmAction = { title?: string; app?: string; action?: string; lines?: [string, string][]; body?: string; note?: string };
export type ApView = {
  status: ApStatus;
  confirm?: boolean;        // "Always allow" was tapped: show the Are you sure? step
  busy?: Decision | "";     // a decision is being sent
  error?: string;           // the last send failed (plain words)
  fresh?: boolean;          // just arrived: play the arrival animation
};
export type ApOpts = {
  helper: string; channel: string;
  /** Attributes for each control (wiring is the host's). "confirm" = the Confirm in the Are you sure? step. */
  attr: (k: Decision | "confirm" | "cancel") => string;
  id?: string;              // element id (the app uses ap<id>)
  attrs?: string;           // more attributes on the card element
};

const esc = (s: any = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const KEY = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3"/><path d="m17 6 3 3"/><path d="m14 9 2 2"/></svg>`;
const CLOCK = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;

export function fmtBytes(n?: number) {
  const b = Math.max(0, Math.round(Number(n) || 0)); if (!b) return "";
  if (b < 1000) return `${b} ${b === 1 ? "byte" : "bytes"}`;
  if (b < 1e6) return `${(b / 1e3).toFixed(b < 1e4 ? 1 : 0).replace(/\.0$/, "")} KB`;
  return `${(b / 1e6).toFixed(1).replace(/\.0$/, "")} MB`;
}
const list = (xs: string[]) => xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
/** "Skipper wants to send 2.1 KB to <b>api.example.com</b>, using your saved key <b>WEATHER_KEY</b>."
 *  A form submitted in the browser (1HC Sentinel via "form"): "Skipper wants to submit a form on <b>shop.example</b> (2.1 KB)." */
export function apLine(a: Approval, helper: string) {
  const keys = (a.keys || []).filter(Boolean).map((k) => `<b>${esc(k)}</b>`), size = fmtBytes(a.bytes);
  const using = keys.length ? `, using your saved ${keys.length > 1 ? "keys" : "key"} ${list(keys)}` : "";
  if (a.via === "form") return `${esc(helper)} wants to submit a form on <b>${esc(a.host)}</b>${size ? ` (${esc(size)})` : ""}${using}.`;
  return `${esc(helper)} wants to send ${size ? esc(size) : "something"} to <b>${esc(a.host)}</b>${using}.`;
}
/** What a decided card says. */
export function apDone(s: ApStatus, helper: string, channel: string): { ok: boolean; label: string; after: string } | null {
  const carry = `${helper} will carry on`;
  switch (s) {
    case "once": return { ok: true, label: "Allowed once", after: carry };
    case "session": return { ok: true, label: "Allowed for this task", after: carry };
    case "channel": return { ok: true, label: `Always allowed${channel ? ` in #${channel}` : ""}`, after: carry };
    case "always": return { ok: true, label: "Always allowed", after: `${carry}. You can take it back in Settings → Permissions` };
    case "allowed": return { ok: true, label: "Allowed", after: carry };
    case "deny": return { ok: false, label: "Not sent", after: "" };
  }
  return null;
}

const HAND = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z"/><path d="m9 12 2 2 4-4"/></svg>`;
// A kind of action (perms.js): same card look, its own words and three choices.
function permHtml(a: Approval, v: ApView, o: ApOpts) {
  const st = v.status, done = st !== "pending", busy = v.busy || "", dis = busy || done ? " disabled" : "";
  const q = esc(a.ask || "OK to go ahead?"), name = esc(a.name || "this");
  const btn = (k: Decision, cls: string, label: string) =>
    `<button type="button" class="gu-b ${cls}${busy === k ? " busy" : ""}" ${o.attr(k)}${dis}>${busy === k ? `<i class="gu-bspin" aria-hidden="true"></i>` : ""}${label}</button>`;
  let foot = "";
  if (st === "expired") foot = `<div class="gu-pgone">${CLOCK}<span>This request expired. ${esc(o.helper)} will ask again if it still needs to.</span></div>`;
  else if (done) {
    const d = st === "deny" ? { ok: false, label: "Not allowed", after: "" } : apDone(st, o.helper, "")!;
    foot = `<div class="gu-pdone" role="status"><span class="gu-b ${d.ok ? "picked" : "nope"}">${d.ok ? "✓ " : ""}${esc(d.label)}</span>${d.after ? `<span>${esc(d.after)}</span>` : ""}</div>`;
  } else foot = `<div class="gu-btns">${btn("once", "primary", "Allow once")}${btn("always", "secondary", esc(a.always || `Always allow: ${a.name || "this"}`))}${btn("deny", "ghost", "Don't allow")}</div>`;
  const err = v.error && !done ? `<p class="gu-perr" role="alert">${esc(v.error)}</p>` : "";
  const what = a.what ? `${esc(o.helper)} wants to ${esc(a.what)}.` : `${esc(o.helper)} needs your OK for this: ${name}.`;
  return `<div class="gu-sys gu-perm${done ? " locked" : ""}${v.fresh ? " gu-in" : ""}"${o.id ? ` id="${esc(o.id)}"` : ""}${o.attrs || ""} data-apst="${esc(st)}" data-pkind="${esc(a.perm || "")}">
    <div class="gu-sh"><span class="gu-si">${HAND}</span><b>${q}</b></div>
    <p class="gu-sl">${what}${done ? "" : " Nothing happens until you choose."}</p>${err}${foot}</div>`;
}

const PLANE = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/></svg>`;
const TRASH = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/></svg>`;
const WARN = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>`;
// A confirm card: the exact action, then Confirm / Cancel. Decided: locked with the result; expired: says so.
function confirmHtml(a: Approval, v: ApView, o: ApOpts) {
  const x = a.action || {}, st = v.status, done = st !== "pending", busy = v.busy || "", dis = busy || done ? " disabled" : "";
  const title = x.title || a.ask || "Confirm this?";
  const icon = /^(delete|trash|remove|empty|purge)/i.test(title) ? TRASH : /^send/i.test(title) ? PLANE : HAND;
  const btn = (k: Decision, cls: string, label: string) =>
    `<button type="button" class="gu-b ${cls}${busy === k ? " busy" : ""}" ${o.attr(k)}${dis}>${busy === k ? `<i class="gu-bspin" aria-hidden="true"></i>` : ""}${label}</button>`;
  let foot = "";
  if (st === "expired") foot = `<div class="gu-pgone">${CLOCK}<span>This card expired, so nothing was done. Ask ${esc(o.helper)} again if you still want it.</span></div>`;
  else if (done) {
    const yes = st !== "deny";
    foot = `<div class="gu-pdone" role="status"><span class="gu-b ${yes ? "picked" : "nope"}">${yes ? "✓ Confirmed" : "Cancelled"}</span><span>${yes ? `${esc(o.helper)} will carry on` : "Nothing was done"}</span></div>`;
  } else foot = `<div class="gu-btns">${btn("once", "primary", "Confirm")}${btn("deny", "ghost", "Cancel")}</div>`;
  const lines = (x.lines || []).filter((l) => l && l[1]).map(([k, val]) => `<div><dt>${esc(k)}</dt><dd>${esc(val)}</dd></div>`).join("");
  const err = v.error && !done ? `<p class="gu-perr" role="alert">${esc(v.error)}</p>` : "";
  return `<div class="gu-sys gu-perm gu-confirm${done ? " locked" : ""}${v.fresh ? " gu-in" : ""}"${o.id ? ` id="${esc(o.id)}"` : ""}${o.attrs || ""} data-apst="${esc(st)}" data-pkind="confirm">
    <div class="gu-sh"><span class="gu-si">${icon}</span><b>${esc(title)}</b></div>
    <p class="gu-sl">${done ? `${esc(o.helper)} asked to do exactly this${x.app ? ` in ${esc(x.app)}` : ""}.` : `${esc(o.helper)} will do exactly this${x.app ? ` in ${esc(x.app)}` : ""} when you tap Confirm. Nothing happens until then.`}</p>
    ${lines ? `<dl class="gu-cf">${lines}</dl>` : ""}${x.body ? `<div class="gu-cfbody" tabindex="0" aria-label="Message">${esc(x.body)}</div>` : ""}${x.note ? `<p class="gu-cfnote">${WARN}<span>${esc(x.note)}</span></p>` : ""}${err}${foot}</div>`;
}

export function approvalHtml(a: Approval, v: ApView, o: ApOpts) {
  if (a.perm === "confirm") return confirmHtml(a, v, o);
  if (a.perm) return permHtml(a, v, o);
  const h = esc(a.host), st = v.status, done = st !== "pending", busy = v.busy || "";
  const dis = busy || done ? " disabled" : "";
  const btn = (k: Decision, cls: string, label: string) =>
    `<button type="button" class="gu-b ${cls}${busy === k ? " busy" : ""}" ${o.attr(k)}${dis}>${busy === k ? `<i class="gu-bspin" aria-hidden="true"></i>` : ""}${label}</button>`;
  let foot = "";
  if (st === "expired") foot = `<div class="gu-pgone">${CLOCK}<span>This request expired. ${esc(o.helper)} will ask again if it still needs to.</span></div>`;
  else if (done) {
    const d = apDone(st, o.helper, o.channel)!;
    foot = `<div class="gu-pdone" role="status"><span class="gu-b ${d.ok ? "picked" : "nope"}">${d.ok ? "✓ " : ""}${esc(d.label)}</span>${d.after ? `<span>${esc(d.after)}</span>` : ""}</div>`;
  } else if (v.confirm) {
    foot = `<div class="gu-pconf" role="group" aria-label="Always allow ${h}?"><p><b>Are you sure?</b> ${h} will always be allowed${o.channel ? ` in #${esc(o.channel)}` : ""}.</p>
      <div class="gu-btns"><button type="button" class="gu-b primary${busy === "channel" ? " busy" : ""}" ${o.attr("confirm")}${dis}>${busy === "channel" ? `<i class="gu-bspin" aria-hidden="true"></i>` : ""}Confirm</button><button type="button" class="gu-b ghost" ${o.attr("cancel")}${dis}>Cancel</button></div></div>`;
  } else {
    foot = `<div class="gu-btns">${btn("once", "primary", "Allow once")}${btn("session", "secondary", "Allow for this task")}${btn("channel", "secondary", a.host.length > 26 ? "Always allow this site" : `Always allow ${h}`)}${btn("deny", "ghost", "Don't allow")}</div>`;
  }
  const err = v.error && !done ? `<p class="gu-perr" role="alert">${esc(v.error)}</p>` : "";
  return `<div class="gu-sys gu-perm${done ? " locked" : ""}${v.fresh ? " gu-in" : ""}"${o.id ? ` id="${esc(o.id)}"` : ""}${o.attrs || ""} data-apst="${esc(st)}">
    <div class="gu-sh"><span class="gu-si">${KEY}${logoOver(a.host, 32)}</span><b>OK to send this to ${h}?</b></div>
    <p class="gu-sl">${apLine(a, o.helper)}${done ? "" : " Nothing is sent until you choose."}</p>${err}${foot}</div>`;
}
