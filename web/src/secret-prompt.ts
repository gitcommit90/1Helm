// The quiet prompt above the message box when what the person typed or pasted looks like a secret (a key, a token, a password, a private
// key). Server rules for what counts: src/secrets-scrub.js, ported in secret-detect.ts. Nothing typed leaves the browser to be checked.
//   "Save as a key"    opens a small form (name, sites, the value filled in) that saves to Passwords & keys with POST /api/vault.
//   "Send anyway"      sends the message as it is (the composer's own send).
//   x                  hides the prompt for this secret; a different secret asks again.
//   "Don't ask again"  turns the prompt off for the account (POST account/prefs { secret_prompt: false }). Settings → Passwords & keys turns it on.
// It never blocks sending and never changes the message. The prompt floats over the space above the message box, so nothing moves when it
// appears. The value is held in this module's memory only while the prompt is up, never in storage.
import { findSecrets } from "./secret-detect";
import { cbAdd, cbBar } from "./composer-bars";

export type ScpDeps = {
  on: () => boolean;                                     // the account setting (on unless "Don't ask again")
  api: (path: string, body: any) => Promise<any>;        // POST an account route
  turnOff: () => Promise<void>;                          // save "Don't ask again" on the account
  saved: (name: string) => void;                         // a key was saved
  send: () => void;                                      // the composer's own send
  keysChanged: () => void;                               // the Passwords & keys list should reload
};
let D: ScpDeps | null = null;
type Form = { name: string; hosts: string; value: string; busy: boolean; err: string };
const ST: { mode: "" | "bar" | "form"; form: Form | null; value: string; dismissed: Set<string>; sig: string; text: string; found: string } = { mode: "", form: null, value: "", dismissed: new Set(), sig: "", text: "", found: "" };
const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const KEY_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3M16 7l3 3"/></svg>`;
const box = () => document.getElementById("box") as HTMLTextAreaElement | null;
const normHost = (v: string) => { const w = String(v || "").trim().toLowerCase(), star = w.startsWith("*.") ? "*." : ""; return star + w.slice(star.length).replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^[^/?#]*@/, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/\.$/, "").replace(/^www\./, ""); };
const hostList = (t: string) => [...new Set(String(t).split(/[\s,]+/).map(normHost).filter(Boolean))];

// The first secret in the box that was not dismissed, or "".
function found(): string {
  const b = box(), t = b?.value || "";
  if (t === ST.text) return ST.found;
  ST.text = t; ST.found = "";
  if (t.length >= 8) for (const sp of findSecrets(t)) { const v = t.slice(sp.start, sp.end); if (v.length >= 4 && !ST.dismissed.has(v)) { ST.found = v; break; } }
  return ST.found;
}
function barHtml() {
  return `<div class="scp">${cbBar({ id: "scp", icon: KEY_ICON, title: "This looks like a secret. Save it as a key instead of sending it in chat?", label: "Save this secret as a key",
    actions: [{ k: "save", label: "Save as a key", primary: true }, { k: "send", label: "Send anyway" }, { k: "never", label: "Don't ask again" }], close: "dismiss", closeLabel: "Dismiss" })}</div>`;
}
function formHtml(f: Form) {
  return `<div class="scp"><form class="scpf" data-scpf novalidate aria-label="Save as a key"><div class="scpf-h"><span class="cbico">${KEY_ICON}</span><b>Save as a key</b></div>
    <label class="scpf-f"><span>Name</span><input data-scpn value="${esc(f.name)}" placeholder="OPENWEATHER_KEY" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
    <label class="scpf-f"><span>Sites it's for</span><input data-scph value="${esc(f.hosts)}" placeholder="api.example.com" autocomplete="off" autocapitalize="none" spellcheck="false" inputmode="url"></label>
    <label class="scpf-f"><span>Key</span><input data-scpv type="password" value="${esc(f.value)}" autocomplete="new-password" spellcheck="false" data-1p-ignore data-lpignore="true" data-bwignore="true" data-form-type="other"></label>
    ${f.err ? `<p class="scpf-e" role="alert">${esc(f.err)}</p>` : ""}
    <div class="scpf-b"><button type="submit" class="cbb pri"${f.busy ? " disabled" : ""}>${f.busy ? "Saving…" : "Save key"}</button><button type="button" class="cbb" data-cba="scp|cancel"${f.busy ? " disabled" : ""}>Cancel</button></div></form></div>`;
}
const view = () => ST.mode === "form" && ST.form ? formHtml(ST.form) : ST.mode === "bar" ? barHtml() : "";
/** The markup for the slot above the message box (v3.ts composer()). */
export const scpHtml = () => `<div class="scp-wrap" id="scp-box">${view()}</div>`;
// Redraw only when the prompt changes (what is typed in the form never redraws it, so focus and caret stay).
export function scpPaint() {
  const el = document.getElementById("scp-box"); if (!el) return;
  const sig = `${ST.mode}|${ST.mode === "form" ? `${ST.form?.busy}|${ST.form?.err}` : ""}`;
  if (sig === ST.sig && (ST.mode === "" ? !el.firstChild : !!el.firstChild)) return;
  ST.sig = sig; el.innerHTML = view();
}
function sync() {
  if (!D || !D.on()) { ST.mode = ""; ST.form = null; ST.value = ""; return scpPaint(); }
  const v = found();
  if (ST.mode === "form") { if (!v && !box()?.value.trim()) { ST.mode = ""; ST.form = null; ST.value = ""; } }   // the message was sent or cleared
  else if (v) { ST.mode = "bar"; ST.value = v; } else { ST.mode = ""; ST.value = ""; }
  scpPaint();
}
function dismiss(v = ST.value) { if (v) ST.dismissed.add(v); ST.mode = ""; ST.form = null; ST.value = ""; scpPaint(); }
async function save(f: Form) {
  if (f.busy) return;
  const name = f.name.trim().toUpperCase(), hosts = hostList(f.hosts);
  if (!/^[A-Z][A-Z0-9_]{1,40}$/.test(name)) { f.err = "Give it a name with capital letters, digits and underscores, like OPENWEATHER_KEY."; return scpPaint(); }
  if (!hosts.length) { f.err = "Add the site this key is for, like api.example.com."; return scpPaint(); }
  if (!f.value.trim()) { f.err = "The key is empty."; return scpPaint(); }
  f.busy = true; f.err = ""; scpPaint();
  try { await D!.api("vault", { name, hosts, value: f.value }); }
  catch (e: any) { f.busy = false; f.err = e?.message || "Couldn't save that. Try again."; return scpPaint(); }
  f.value = ""; dismiss(ST.value); D!.keysChanged(); D!.saved(name);
}
export function scpInit(deps: ScpDeps) {
  if (D) return; D = deps;
  cbAdd({ id: "scp", order: 60, html: () => "", act: a => {
    if (a === "save") { ST.form = { name: "", hosts: "", value: ST.value, busy: false, err: "" }; ST.mode = "form"; scpPaint(); setTimeout(() => document.querySelector<HTMLInputElement>("[data-scpn]")?.focus({ preventScroll: true }), 0); }
    else if (a === "send") { dismiss(); D!.send(); }
    else if (a === "dismiss") dismiss();
    else if (a === "cancel") { ST.form = null; ST.mode = found() ? "bar" : ""; ST.value = found(); scpPaint(); box()?.focus({ preventScroll: true }); }
    else if (a === "never") { dismiss(); void D!.turnOff(); }
  } });
  document.addEventListener("input", e => {
    const t = e.target as HTMLInputElement;
    if (t.id === "box") { sync(); return; }
    const f = ST.form; if (!f) return;
    if (t.hasAttribute("data-scpn")) f.name = t.value; else if (t.hasAttribute("data-scph")) f.hosts = t.value; else if (t.hasAttribute("data-scpv")) f.value = t.value;
  });
  document.addEventListener("submit", e => { if (!(e.target as HTMLElement).hasAttribute?.("data-scpf")) return; e.preventDefault(); e.stopImmediatePropagation(); if (ST.form) void save(ST.form); }, true);
}
/** The account setting changed (Settings → Passwords & keys): show or hide the prompt for what is in the box now. */
export const scpRefresh = () => { ST.text = "\u0000"; sync(); };
