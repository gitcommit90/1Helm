// Live notes (the server's live-notes.js; SPEC §9): 1Helm follows what the person's Bee hears (or, without a Bee, this device's
// microphone: livemic.ts) and keeps meeting notes in the task.
// - A header button in every task (Bee connected or a microphone here): Start (our own confirm sheet, never the browser's), or show
//   the notes. Bee and a mic: Bee, with a small "Use this device's mic instead". Only a mic: the mic.
// - The mic: this device records while it's live (livemic.ts); "Paused: keep 1Helm open to keep listening" when the browser stops
//   the mic (a phone in the background), Resume when it needs a tap; other devices see that state. Stop sends the last chunk first.
// - A meeting tab (desktop Chrome/Edge, livemic.ts): the Start sheet lists the inputs (Bee, "A meeting tab (Meet, Zoom web, Teams
//   web…)" with "Also record my microphone", this device's mic; the last pick is the default). Picking the tab opens the browser's
//   share picker inside the Start tap; a share with no sound keeps the sheet open with the one-line fix and Try again. Sharing
//   stopped → "Sharing stopped, so Live notes are paused." with Continue with the mic only / Share the tab again / Stop and save.
//   Other browsers on a computer see the option off, with "Works in Chrome or Edge on a computer"; phones don't see it.
// - Desktop: the task splits, chat left, the live doc right, with a draggable divider; ✕ hides the pane without stopping.
// - Phone: a Chat | Notes switch under the header (a red dot while live) and the same live chip, so Stop is always one tap away.
// - The live chip "● Live · 23:41 · $0.04 [Stop]"; "Still in the meeting? [Continue]"; the sidebar row gets a red dot while live.
// - Bee's final transcript (auto refine): the server's "Update your meeting notes?" card in the chat (lnRefineCard: written by code,
//   what happened + the changes + [Apply] [Don't apply], then Applied / Not applied), and the same buttons on the pane's banner.
// - Presence (§9.6 caps): while a live task is open and the tab visible, a "seen" every 60 s; leaving it (another task, hidden tab)
//   says "away" once. The server decides the caps.
// The server is the truth: the session list's `livenotes` field (lnSet), and GET …/livenotes (the view + the doc) while the pane shows.
import { ask, tell, sheet } from "../dialog";
import { sourceChoice, sourceOptions, tabSupported, tabAcquire, inputRelease, shareEndedView, micShareAct, micSupported, micAcquire, micRelease, micNewId, micStored, micForget, micRun, micEnd, micInfo, micResumeTap, micLockFree, micDropKept, micInit } from "./livemic";
import type { Input, Src } from "./livemic";

export type LnView = { status: "idle" | "live" | "finalizing"; n?: number; started_at?: number | null; ended_at?: number | null; now?: number; cost_usd?: string | null; ask?: boolean; ask_deadline?: number | null;
  file?: { id: string; name: string; path: string; version?: number } | null; refine?: { n: number; state: string; added?: number; removed?: number; summary?: string | null } | null; lines?: number; waiting?: boolean;
  last?: { n: number; reason: string; stop_reason: string; started_at: number; ended_at: number; cost_usd: string } | null; sessions?: any[]; doc?: string | null; error?: string;
  speakers?: { id: string; name?: string | null; contact_id?: string | number | null }[]; source?: "bee" | "mic"; mic?: { id: string; state: "live" | "paused" | "lost"; since?: number; chunks?: number; via?: "mic" | "tab" | "system" } | null };
type Deps = {
  api: (path: string, body?: any) => Promise<any>;
  phone: () => boolean;
  current: () => string;                                   // "<slug>|<sid>" of the open task, or ""
  md: (s: string) => string;
  repaint: () => void;
  note: (title: string, sub: string) => void;
  base?: () => string | null;                              // the workspace API base (the mic posts its chunks there)
  look?: boolean;                                          // a dev "view as": never records
};
let D: Deps | null = null;
const S: Record<string, { v: LnView | null; doc: string | null; ver: number; skew: number; hidden: boolean; tab: "chat" | "notes"; busy: boolean; fetchedAt: number }> = {};
const B = { bee: false, checked: 0 };
const key = (slug: string, sid: any) => `${slug}|${sid}`;
const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const svg = (d: string, s = 16, w = 1.8) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const WAVE = '<path d="M3 12h2M7 8v8M11 5v14M15 8v8M19 10v4M21 12h0"/>', X = '<path d="M18 6 6 18M6 6l12 12"/>', DOC = '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>';
const store = { get(k: string) { try { return localStorage.getItem(k); } catch { return null; } }, set(k: string, v: string) { try { localStorage.setItem(k, v); } catch {} } };
const st = (k: string) => (S[k] ??= { v: null, doc: null, ver: -1, skew: 0, hidden: store.get(`1h-ln-hide:${k}`) === "1", tab: "chat", busy: false, fetchedAt: 0 });
const live = (v: LnView | null | undefined) => v?.status === "live";
const clock = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(s / 60); return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`; };
const pathOf = (k: string) => `/res/${k.split("|")[0]}/sessions/${k.split("|")[1]}/livenotes`;
// The session's speaker names changed (someone named a speaker): keep them with the session's view so every part of the app reads the same names.
export function lnSpeakers(slug: string, sid: any, list: LnView["speakers"]) { const x = st(key(slug, sid)); if (x.v) x.v = { ...x.v, speakers: list }; }
// The mic: is this device the one recording task k, and what is it doing?
const here = (k: string) => { const m = micInfo(); return m.k === k && m.state !== "off" ? m : null; };
const canStart = () => B.bee || micSupported();
export const lnCanStart = () => !!D && !D.look && canStart();
const LAST = "1h-ln-src", TABMIC = "1h-ln-tabmic";
const SRC_LABEL: Record<Src, [string, string]> = {
  bee: ["Your Bee", "Follows what your Bee hears."],
  tab: ["A meeting tab (Meet, Zoom web, Teams web…)", "Hears everyone in the call. You'll pick the tab and turn on \u201cShare tab audio\u201d. On Windows, \u201cEntire screen\u201d with system audio also hears the Zoom or Teams app."],
  mic: ["This device's microphone", "Hears the room. Keep 1Helm open while it listens."],
};
const STARTING = new Set<string>();   // a Start in progress on this device: it hands its own stream to the recorder
// Is the pane offered for this task? Live / being saved, or a doc exists (shown when they open it).
const hasPane = (k: string) => { const x = S[k]?.v; return !!x && (x.status !== "idle" || !!x.file); };
const paneOn = (k: string) => hasPane(k) && !st(k).hidden;

// ---- server truth ----
export function lnSet(slug: string, sid: any, v: LnView | null | undefined) {
  const k = key(slug, sid), x = st(k), was = x.v?.status;
  if (!v) { if (x.v && x.v.status !== "idle") { x.v = { ...x.v, status: "idle" }; } return; }
  x.v = { ...(x.v || {}), ...v } as LnView; if (v.now) x.skew = v.now - Date.now();
  if (was !== v.status) { if (v.status === "live" && was !== "live") { x.hidden = false; store.set(`1h-ln-hide:${k}`, "0"); } if (D?.current() === k) { D.repaint(); pull(k); } }
  micFollow(k, x.v);
  paintAll();
}
// The server is the truth for the mic too: live with this device's mic id → record here (after a reload too); not live → stop.
function micFollow(k: string, v: LnView | null) {
  const m = here(k);
  if (m && v?.status !== "live") { void micEnd(false); return; }
  if (v?.status === "idle" && micStored(k)) { micForget(k); void micDropKept(k); }
  if (!m && v?.status === "live" && v.source === "mic" && v.mic?.id && micStored(k)?.id === v.mic.id && !STARTING.has(k) && !D?.look && micLockFree(k) && micInfo().state === "off") void runMic(k, v.mic.id, null);
}
function runMic(k: string, mic: string, stream: MediaStream | Input | null) {
  const base = D?.base?.(); if (!base) { if (stream instanceof MediaStream) micRelease(stream); else inputRelease(stream); return; }
  return micRun({ k, mic, base, path: pathOf(k), now: () => Date.now() + st(k).skew, onChange: () => paintAll(), onStopped: () => pull(k), note: (t, b) => D?.note(t, b) }, stream);
}
export const lnLive = (slug: string, sid: any) => live(S[key(slug, sid)]?.v);
// The sidebar row's red dot.
export const lnDot = (slug: string, sid: any) => live(S[key(slug, sid)]?.v) ? `<span class="ln-dot" title="Live notes on" aria-label="Live notes on"></span>` : "";

// ---- the header button ----
export function lnBtn(slug: string, sid: any, phone = false) {
  const k = key(slug, sid), v = S[k]?.v; if (!canStart() && !hasPane(k)) return "";
  const on = live(v), lab = on ? "Live notes are on: show the notes" : hasPane(k) ? "Meeting notes" : "Start Live notes";
  return `<span class="lnw${phone ? " m" : ""}" data-lnw="${esc(k)}"><button class="${phone ? "cb lnbtn m" : "lnbtn"}${on ? " on" : ""}" data-lnbtn="${esc(k)}" title="${esc(lab)}" aria-label="${esc(lab)}">${svg(on ? WAVE : hasPane(k) && !canStart() ? DOC : WAVE, phone ? 20 : 16)}${on ? `<i class="ln-rec" aria-hidden="true"></i>` : ""}${phone ? "" : `<span>${on ? "Live" : "Live notes"}</span>`}</button></span>`;
}

// ---- the split ----
export function lnWrap(slug: string, sid: any, inner: string) {
  const k = key(slug, sid);
  if (!hasPane(k)) return inner;
  const x = st(k), ph = D?.phone(), w = Number(store.get("1h-ln-w") || 0);
  const cls = `ln-split${paneOn(k) && !ph ? " ln-open" : ""}${ph ? " ln-ph" : ""} ln-tab-${x.tab}${!ph && NARROW.has(k) ? " ln-narrow" : ""}`;
  // Too narrow for chat and notes side by side (a tablet in portrait with the side panel): one at a time, with the phone's Chat | Notes switch.
  return `<div class="${cls}" data-lnsplit="${esc(k)}" style="${w && !ph ? `--lnw:${Math.max(300, Math.min(w, 900))}px` : ""}"><div class="ln-bar${ph ? "" : " ln-nbar"}" data-lnbar="${esc(k)}">${barHtml(k)}</div><div class="ln-chat">${inner}</div>${!ph ? `<div class="ln-div" data-lndiv role="separator" aria-orientation="vertical" aria-label="Resize the notes" tabindex="0"></div>` : ""}<aside class="ln-pane" aria-label="Meeting notes" data-lnpane="${esc(k)}">${paneHtml(k)}</aside></div>`;
}
function chipHtml(k: string) {
  const x = st(k), v = x.v; if (!v) return "";
  const paused = v.status === "live" && (here(k)?.state === "paused" || (!here(k) && v.mic && v.mic.state !== "live"));
  if (paused) return `<span class="ln-chip paused"><i class="ln-pz" aria-hidden="true"></i><b>Paused</b><span class="ln-clock" data-lnclock="${esc(k)}">${clock(Date.now() + x.skew - (v.started_at || Date.now()))}</span><span class="ln-cost">${esc(v.cost_usd || "$0.00")}</span><button class="ln-stop" data-lnstop="${esc(k)}"${x.busy ? " disabled" : ""}>Stop</button></span>`;
  if (v.status === "live") return `<span class="ln-chip"><i class="ln-rec" aria-hidden="true"></i><b>Live</b><span class="ln-clock" data-lnclock="${esc(k)}">${clock(Date.now() + x.skew - (v.started_at || Date.now()))}</span><span class="ln-cost">${esc(v.cost_usd || "$0.00")}</span><button class="ln-stop" data-lnstop="${esc(k)}"${x.busy ? " disabled" : ""}>Stop</button></span>`;
  if (v.status === "finalizing") return `<span class="ln-chip saving"><span class="ln-spin" aria-hidden="true"></span><b>Writing the final notes…</b></span>`;
  return `<span class="ln-chip idle">${svg(DOC, 14)}<b>Meeting notes</b>${canStart() ? `<button class="ln-start" data-lnstart="${esc(k)}"${x.busy ? " disabled" : ""}>Start a new session</button>` : ""}</span>`;
}
function barHtml(k: string) {
  const x = st(k), on = live(x.v);
  return `${chipHtml(k)}<span class="ln-seg" role="tablist"><button role="tab" data-lntab="chat" aria-selected="${x.tab === "chat"}" class="${x.tab === "chat" ? "on" : ""}">Chat</button><button role="tab" data-lntab="notes" aria-selected="${x.tab === "notes"}" class="${x.tab === "notes" ? "on" : ""}">Notes${on ? `<i class="ln-rec sm" aria-label="live"></i>` : ""}</button></span>`;
}
function bannerHtml(k: string) {
  const x = st(k), v = x.v; if (!v) return "";
  const out: string[] = [];
  if (v.status === "live" && v.ask) out.push(`<div class="ln-ban ask" role="alert"><div><b>Still in the meeting?</b><span>Live notes stop${v.ask_deadline ? ` in <span data-lnask="${esc(k)}">${clock(v.ask_deadline - Date.now() - x.skew)}</span>` : " soon"} unless you continue.</span></div><button class="ln-go" data-lncont="${esc(k)}">Continue</button></div>`);
  const m = here(k), mic = v.source === "mic";
  if (v.status === "live" && m?.state === "paused" && m.why === "share") {
    const e = shareEndedView({ mic: m.canMic, system: m.system });
    out.push(`<div class="ln-ban warn" role="alert"><div><b>${esc(e.title)}</b><span>${esc(e.body)}</span>${m.shareErr ? `<span class="ln-fix">${esc(m.shareErr)}</span>` : ""}</div><span class="ln-acts">${e.acts.map((a, i) => `<button class="${i === 0 ? "ln-go" : a.id === "stop" ? "ln-stop" : "ln-no"}" data-lnshare="${a.id}" data-lnk="${esc(k)}"${st(k).busy ? " disabled" : ""}>${esc(a.label)}</button>`).join("")}</span></div>`);
  }
  else if (v.status === "live" && m?.state === "paused") out.push(`<div class="ln-ban warn" role="status"><div><b>Paused: keep 1Helm open to keep listening.</b><span>${m.needTap ? "This device stopped the microphone. Tap Resume to listen again." : m.why === "background" ? "This device can't hear while 1Helm is in the background. It picks up again when you come back." : "The browser stopped the microphone (another app may be using it). Live notes pick up again when it's back."}</span></div>${m.needTap ? `<button class="ln-go" data-lnresume="${esc(k)}">Resume</button>` : ""}</div>`);
  else if (v.status === "live" && mic && !m && v.mic?.state === "paused") out.push(`<div class="ln-ban warn" role="status"><div><b>Paused on the device that started Live notes.</b><span>Keep 1Helm open there to keep listening.</span></div></div>`);
  else if (v.status === "live" && mic && !m && v.mic?.state === "lost") out.push(`<div class="ln-ban warn" role="status"><div><b>Not hearing from the device that started Live notes.</b><span>Open 1Helm on it to keep listening, or stop here.</span></div></div>`);
  if (v.status === "live" && m && m.state === "live" && m.failing) out.push(`<div class="ln-ban soft"><div><b>Can't reach 1Helm right now.</b><span>What this device hears is kept here and sent when the connection is back.</span></div></div>`);
  if (v.status === "live" && m?.kind === "tab" && m.state === "live" && m.micOn === false) out.push(`<div class="ln-ban soft"><div><b>Your microphone stopped.</b><span>Only the others in the call are in the notes now.</span></div></div>`);
  if (v.status === "live" && m?.kind === "tab" && m.state === "live" && (v.waiting || m.system)) out.push(`<div class="ln-ban soft"><div><b>${m.system ? "Listening to this computer's sound" : "Listening to the meeting tab"}${m.micOn ? " and your microphone" : ""}.</b><span>${m.system ? "That's every app's sound, not only the meeting. " : ""}${v.waiting ? "Notes appear here about 30 seconds after people speak." : "Stop sharing in the browser's bar to pause."}</span></div></div>`);
  else if (v.status === "live" && v.waiting && !(m?.state === "paused")) out.push(mic ? `<div class="ln-ban soft"><div><b>Listening through ${m ? "this device's microphone" : v.mic?.via === "tab" ? "a meeting tab on the device that started Live notes" : v.mic?.via === "system" ? "the computer that started Live notes" : "the device that started Live notes"}.</b><span>Notes appear here about 30 seconds after people speak.</span></div></div>` : `<div class="ln-ban soft"><div><b>Listening through your Bee.</b><span>Notes appear here about 30 seconds after people speak.</span></div></div>`);
  if (v.refine && v.refine.state === "asked") out.push(`<div class="ln-ban"><div><b>Update your meeting notes?</b><span>Bee's final transcript of session ${v.refine.n} is in${v.refine.summary ? `: ${esc(v.refine.summary.replace(/^./, (c) => c.toLowerCase()))}` : ""}. The details are in the chat.</span></div><span class="ln-acts"><button class="ln-go" data-lnapply="${v.refine.n}" data-lnk="${esc(k)}">Apply</button><button class="ln-no" data-lnskip="${v.refine.n}" data-lnk="${esc(k)}">Don't apply</button></span></div>`);
  if (v.status === "idle" && v.last && Date.now() - (v.last.ended_at || 0) < 10 * 60e3) out.push(`<div class="ln-ban soft"><div><b>Saved to the Library under Meetings.</b><span>Session ${v.last.n} stopped: ${esc(v.last.reason)}. ${esc(v.last.cost_usd)}.</span></div></div>`);
  return out.join("");
}
function docHtml(k: string) {
  const x = st(k);
  if (x.doc == null) return `<div class="ln-empty">${x.v?.status === "live" ? "Starting…" : "Loading the notes…"}</div>`;
  return `<article class="ln-doc">${D!.md(x.doc.replace(/<!--[\s\S]*?-->/g, ""))}</article>`;
}
function paneHtml(k: string) {
  const x = st(k), ph = D?.phone();
  return `${ph ? "" : `<div class="ln-head">${chipHtml(k)}<span class="grow"></span>${x.v?.file ? `<a class="ln-lib" href="#/${esc(k.split("|")[0])}/library" title="Open the Library">Library</a>` : ""}<button class="ln-x" data-lnhide="${esc(k)}" aria-label="Hide the notes (Live notes keep going)" title="Hide (keeps going)">${svg(X, 16)}</button></div>`}<div class="ln-bans">${bannerHtml(k)}</div><div class="ln-body" data-lnbody="${esc(k)}">${docHtml(k)}</div>`;
}
// Repaint the parts that change (chip, banners, doc) without rebuilding the chat.
function paintAll() {
  document.querySelectorAll<HTMLElement>("[data-lnw]").forEach((w) => { const k = w.dataset.lnw!, [slug, sid] = k.split("|"), html = lnBtn(slug, sid, w.classList.contains("m")); const tmp = document.createElement("div"); tmp.innerHTML = html; const nb = tmp.firstElementChild as HTMLElement | null; if (nb && nb.innerHTML !== w.innerHTML) w.innerHTML = nb.innerHTML; });
  document.querySelectorAll<HTMLElement>("[data-lnpane]").forEach((p) => {
    const k = p.dataset.lnpane!, head = p.querySelector(".ln-head"), bans = p.querySelector(".ln-bans"), body = p.querySelector<HTMLElement>(".ln-body");
    if (head) { const h = `${chipHtml(k)}`, c = head.querySelector(".ln-chip"); const tmp = document.createElement("div"); tmp.innerHTML = h; const n = tmp.firstElementChild; if (c && n && (c.className !== n.className || c.querySelector(".ln-cost")?.textContent !== n.querySelector(".ln-cost")?.textContent || !!c.querySelector("[disabled]") !== !!n.querySelector("[disabled]"))) c.replaceWith(n); else if (!c && n) head.prepend(n); }
    if (bans) { const b = bannerHtml(k); if (bans.getAttribute("data-sig") !== b) { bans.setAttribute("data-sig", b); bans.innerHTML = b; } }
    if (body) { const x = st(k), sig = `${x.ver}|${x.doc == null}|${x.v?.status}`; if (body.dataset.sig !== sig) { const near = body.scrollTop < 40; body.dataset.sig = sig; body.innerHTML = docHtml(k); if (near) body.scrollTop = 0; body.querySelectorAll("a[href]").forEach((a) => { a.setAttribute("target", "_blank"); a.setAttribute("rel", "noopener"); }); } }
  });
  document.querySelectorAll<HTMLElement>("[data-lnbar]").forEach((b) => { const k = b.dataset.lnbar!, h = barHtml(k); if (b.dataset.sig !== h) { b.dataset.sig = h; b.innerHTML = h; } });
}
function ticks() {
  document.querySelectorAll<HTMLElement>("[data-lnclock]").forEach((c) => { const x = S[c.dataset.lnclock!]; if (x?.v?.started_at) c.textContent = clock(Date.now() + x.skew - x.v.started_at); });
  document.querySelectorAll<HTMLElement>("[data-lnask]").forEach((c) => { const x = S[c.dataset.lnask!]; if (x?.v?.ask_deadline) c.textContent = clock(x.v.ask_deadline - Date.now() - x.skew); });
}

// ---- the refine card in the chat (a "livenote" turn whose notes carry {refine: {n, title, lead, bullets, foot}}) ----
export type LnRefine = { n: number; title: string; lead: string; bullets: string[]; foot: string };
export function lnRefineCard(slug: string, sid: any, r: LnRefine, opts: { fresh?: boolean; attrs?: string } = {}) {
  const k = key(slug, sid), x = S[k], v = x?.v, n = Number(r.n);
  const st0 = v?.refine?.n === n ? v.refine.state : (v?.sessions || []).find((y: any) => y.n === n)?.refine || (v ? "gone" : "asked");
  const pending = st0 === "asked" || st0 === "proposed", busy = !!x?.busy, dis = busy ? " disabled" : "";
  const foot = pending ? `<p class="ln-rfoot">${esc(r.foot)}</p><div class="gu-btns"><button type="button" class="gu-b primary" data-lnapply="${n}" data-lnk="${esc(k)}"${dis}>Apply</button><button type="button" class="gu-b secondary" data-lnskip="${n}" data-lnk="${esc(k)}"${dis}>Don't apply</button></div>`
    : st0 === "applied" ? `<div class="gu-pdone" role="status"><span class="gu-b picked">✓ Applied</span><span>The meeting notes are updated</span></div>`
    : st0 === "declined" ? `<div class="gu-pdone" role="status"><span class="gu-b nope">Not applied</span><span>The meeting notes stay as they were</span></div>`
    : `<div class="gu-pdone" role="status"><span class="gu-b nope">No longer available</span></div>`;
  return `<div class="gu-sys ln-rcard${pending ? "" : " locked"}${opts.fresh ? " gu-in" : ""}"${opts.attrs || ""}><div class="gu-sh"><span class="gu-si">${svg(DOC, 16)}</span><b>${esc(r.title)}</b></div><p class="gu-sl">${esc(r.lead)}</p><ul class="ln-rlist">${(r.bullets || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>${foot}</div>`;
}

// ---- reading and acting ----
// While live: a light look (the view only, no doc) every 2 s; the doc itself only when its version moved (the note-taker wrote).
async function peek(k: string) {
  if (!D) return; const x = st(k); x.fetchedAt = Date.now();
  try { const d = await D.api(`${pathOf(k)}?doc=0`); if (d && !d.error) { const was = x.v; x.v = { ...d }; if (d.now) x.skew = d.now - Date.now(); micFollow(k, x.v); if (x.doc == null || (d.file?.version ?? 0) !== (was?.file?.version ?? -1) || d.status !== was?.status || Date.now() - (DOC_AT.get(k) || 0) > 10000) await pull(k); else paintAll(); } } catch {}
}
const DOC_AT = new Map<string, number>();   // when the doc was last read (an edit by the assistant shows within 10 s)
async function pull(k: string) {
  if (!D) return; const x = st(k); x.fetchedAt = Date.now(); DOC_AT.set(k, Date.now());
  try { const d = await D.api(pathOf(k)); if (d && !d.error) { const { doc, ...v } = d; x.v = v; if (v.now) x.skew = v.now - Date.now(); if (typeof doc === "string" && (doc !== x.doc)) { x.doc = doc; x.ver = (v.file?.version ?? x.ver + 1); } else if (doc == null && !v.file) x.doc = null; paintAll(); } } catch {}
}
async function act(k: string, body: any, okNote?: [string, string]) {
  if (!D) return null; const x = st(k); x.busy = true; paintAll();
  try { const d = await D.api(pathOf(k), body); if (d?.error) { await tell({ title: "Live notes", body: d.error }); return null; } const { doc: _d, ...v } = d || {}; x.v = v; if (v.now) x.skew = v.now - Date.now(); if (okNote) D.note(okNote[0], okNote[1]); return v; }
  catch { await tell({ title: "Live notes", body: "That didn't go through. Check your connection and try again." }); return null; }
  finally { x.busy = false; D.repaint(); pull(k); }
}
async function start(k: string, meeting = false) {
  const o = sourceOptions({ bee: B.bee, mic: micSupported(), tab: tabSupported(), last: store.get(LAST), meeting });
  if (!o.def) return;
  let src: Src = o.def, input: MediaStream | Input | null = null, system = false;
  if (o.list.length <= 1) {
    // One input here: the plain question (Bee: with "Use this device's mic instead" when there's a mic, which there isn't here).
    const c = sourceChoice({ bee: B.bee, mic: micSupported() });
    if (c.def === "bee") { if (!(await ask({ title: "Start Live notes?", body: "1Helm will follow what your Bee hears and write notes in this task. Make sure everyone's OK with being recorded.", confirm: "Start" }))) return; src = "bee"; }
    else if (!(await ask({ title: "Start Live notes?", body: "1Helm will listen through this device's microphone and write notes in this task. Keep 1Helm open while it listens. Make sure everyone's OK with being recorded.", confirm: "Start" }))) return;
  } else {
    // The Start sheet. A meeting tab is shared inside the Start tap (the browser's own picker); no sound → the fix, and Try again.
    let got: Input | null = null;
    const p = await sheet({ title: "Start Live notes?", body: "1Helm writes notes in this task while it listens. Make sure everyone's OK with being recorded.", confirm: "Start",
      choices: o.list.map((x) => ({ id: x.id, label: SRC_LABEL[x.id][0], sub: x.ok ? SRC_LABEL[x.id][1] : x.why, disabled: !x.ok })), value: o.def,
      toggle: { for: "tab", label: "Also record my microphone", sub: "Your side of the call. With headphones on, it hears only you.", on: store.get(TABMIC) !== "0" },
      check: async (pk) => {
        if (pk.v !== "tab") return null;
        inputRelease(got); got = null;
        const g = await tabAcquire(pk.toggle); if (!g.ok) return g.fix;
        got = g.input; if (g.micNote) D?.note("Your microphone didn't start", g.micNote);
        return null;
      } });
    if (!p) { inputRelease(got); return; }
    src = p.v as Src; store.set(LAST, src);
    if (src === "tab") { store.set(TABMIC, p.toggle ? "1" : "0"); const g = got as Input | null; if (!g) return; input = g; system = g.system; }
  }
  // The mic is asked for inside the tap, before the server starts anything (no session without a working input).
  let mic = "";
  if (src === "mic") { const g = await micAcquire(); if (!g.ok) { D!.note(g.title, g.body); return; } input = g.stream; }
  if (src !== "bee") mic = micNewId(k, src === "tab" ? "tab" : "mic");
  const via = src === "tab" ? (system ? "system" : "tab") : src === "mic" ? "mic" : "";
  const x = st(k); x.hidden = false; store.set(`1h-ln-hide:${k}`, "0"); x.tab = "notes";
  STARTING.add(k);
  try {
    const v = await act(k, { action: "start", source: src === "bee" ? "bee" : "mic", ...(mic ? { mic, via } : {}) });
    if (v && v.status === "live") { x.doc = null; presence(k, true); if (input) await runMic(k, mic, input); }
    else { if (input instanceof MediaStream) micRelease(input); else inputRelease(input); if (mic) micForget(k); }
  } finally { STARTING.delete(k); }
}
// From a meeting reminder (meetings.ts): the task is open; the Start sheet with a meeting tab as the default.
export async function lnStartFor(slug: string, sid: any) { const k = key(slug, sid); if (live(S[k]?.v) || !lnCanStart()) return; await start(k, true); }
// Stop: the device recording sends its last chunk first, so the final notes have every word.
async function stop(k: string, sure = false) {
  if (!sure && !(await ask({ title: "Stop Live notes?", body: "1Helm writes the final notes and saves them to the Library under Meetings.", confirm: "Stop" }))) return;
  const x = st(k); let flushed = false;
  if (here(k)) { x.busy = true; paintAll(); flushed = await micEnd(true); }
  await act(k, { action: "stop", flushed }, ["Stopping Live notes", "Writing the final notes…"]);
}
// ---- presence (§9.6) ----
const PR = { k: "", at: 0, away: "" };
function presence(k: string, view: boolean) { if (!D) return; PR.at = Date.now(); D.api(pathOf(k), { action: "presence", view }).catch(() => {}); }
function presenceTick() {
  const cur = D?.current() || "", vis = document.visibilityState === "visible";
  const k = cur && live(S[cur]?.v) ? cur : "";
  if (PR.k && (PR.k !== k || !vis) && PR.away !== PR.k && live(S[PR.k]?.v)) { presence(PR.k, false); PR.away = PR.k; }   // left it: away, once
  if (k && vis && (PR.k !== k || PR.away === k || Date.now() - PR.at > 60e3)) { presence(k, true); PR.away = ""; }
  PR.k = vis ? k : PR.k;
  const on = !!k && live(S[k]?.v), get = on ? peek : pull, every = on ? 1900 : 8000;   // live: a light look every 2 s, the doc when it changed
  if (k && vis && paneOn(k) && Date.now() - st(k).fetchedAt > every) get(k);
  else if (k && vis && D?.phone() && st(k).tab === "notes" && Date.now() - st(k).fetchedAt > every) get(k);
  if (cur && S[cur]?.v?.status === "finalizing" && Date.now() - st(cur).fetchedAt > 4000) pull(cur);
}

// After the open task repaints: make sure the pane has its doc, wire the divider.
// Which splits are narrow (< 640px wide): kept per task so a re-render starts in the right layout, updated as the stage resizes.
const NARROW = new Set<string>(), NARROW_W = 640;
let splitRO: ResizeObserver | null = null;
function fitSplit(el: HTMLElement) { const k = el.dataset.lnsplit!, n = el.clientWidth > 0 && el.clientWidth < NARROW_W; if (n) NARROW.add(k); else NARROW.delete(k); el.classList.toggle("ln-narrow", n && !el.classList.contains("ln-ph")); }
export function lnSync(slug: string, sid: any) {
  const k = key(slug, sid);
  splitRO ??= new ResizeObserver((es) => es.forEach((e) => fitSplit(e.target as HTMLElement)));
  document.querySelectorAll<HTMLElement>(".ln-split[data-lnsplit]").forEach((el) => { fitSplit(el); splitRO!.observe(el); });
  if (hasPane(k) && (paneOn(k) || D?.phone()) && (st(k).doc == null || Date.now() - st(k).fetchedAt > 8000)) pull(k);
  paintAll(); presenceTick();
}
function drag(e: PointerEvent, div: HTMLElement) {
  const split = div.closest<HTMLElement>(".ln-split"); if (!split) return; e.preventDefault();
  const r = split.getBoundingClientRect(); div.setPointerCapture(e.pointerId); split.classList.add("ln-drag");
  const move = (ev: PointerEvent) => { const w = Math.max(300, Math.min(r.right - ev.clientX, r.width * 0.7, 900)); split.style.setProperty("--lnw", `${Math.round(w)}px`); };
  const up = () => { div.removeEventListener("pointermove", move); div.removeEventListener("pointerup", up); split.classList.remove("ln-drag"); store.set("1h-ln-w", String(parseInt(split.style.getPropertyValue("--lnw")) || "")); };
  div.addEventListener("pointermove", move); div.addEventListener("pointerup", up);
}
export function lnInit(deps: Deps) {
  D = deps; micInit();
  const checkBee = () => { B.checked = Date.now(); D!.api("/bee").then((b) => { const on = b?.state === "connected"; if (on !== B.bee) { B.bee = on; D!.repaint(); } }).catch(() => {}); };
  checkBee();
  window.addEventListener("focus", () => { if (Date.now() - B.checked > 5 * 60e3) checkBee(); });
  document.addEventListener("visibilitychange", presenceTick);
  window.addEventListener("hashchange", () => setTimeout(presenceTick, 50));
  setInterval(ticks, 1000); setInterval(presenceTick, 2000);
  document.addEventListener("pointerdown", (e) => { const d = (e.target as HTMLElement).closest<HTMLElement>("[data-lndiv]"); if (d) drag(e, d); });
  document.addEventListener("keydown", (e) => { const d = (e.target as HTMLElement).closest?.<HTMLElement>("[data-lndiv]"); if (!d || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return; const split = d.closest<HTMLElement>(".ln-split")!, cur = parseInt(split.style.getPropertyValue("--lnw")) || split.querySelector<HTMLElement>(".ln-pane")!.offsetWidth; const w = Math.max(300, Math.min(cur + (e.key === "ArrowLeft" ? 40 : -40), 900)); split.style.setProperty("--lnw", `${w}px`); store.set("1h-ln-w", String(w)); e.preventDefault(); });
  document.addEventListener("click", async (e) => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>("[data-lnbtn]"); if (b) {
      e.preventDefault(); const k = b.dataset.lnbtn!, x = st(k);
      if (!hasPane(k)) { if (canStart()) await start(k); return; }   // never used in this task: Start
      if (D!.phone()) x.tab = x.tab === "notes" ? "chat" : "notes"; else { x.hidden = !x.hidden; store.set(`1h-ln-hide:${k}`, x.hidden ? "1" : "0"); }
      D!.repaint(); pull(k); return;
    }
    const sn = t.closest<HTMLElement>("[data-lnstart]"); if (sn) { await start(sn.dataset.lnstart!); return; }
    const h = t.closest<HTMLElement>("[data-lnhide]"); if (h) { const k = h.dataset.lnhide!; st(k).hidden = true; store.set(`1h-ln-hide:${k}`, "1"); D!.repaint(); return; }
    const s = t.closest<HTMLElement>("[data-lnstop]"); if (s) { await stop(s.dataset.lnstop!); return; }
    const rs = t.closest<HTMLElement>("[data-lnresume]"); if (rs) { await micResumeTap(); paintAll(); return; }
    const sh = t.closest<HTMLElement>("[data-lnshare]"); if (sh) {   // sharing stopped: mic only / share again / stop and save
      const k = sh.dataset.lnk!, a = sh.dataset.lnshare!;
      if (a === "stop") { await stop(k, true); return; }
      const x = st(k); x.busy = true; paintAll();
      try { await micShareAct(a === "mic" ? "mic" : "again", store.get(TABMIC) !== "0"); } finally { x.busy = false; paintAll(); }
      return;
    }
    const c = t.closest<HTMLElement>("[data-lncont]"); if (c) { await act(c.dataset.lncont!, { action: "continue" }); return; }
    const ap = t.closest<HTMLElement>("[data-lnapply]"); if (ap) { await act(ap.dataset.lnk!, { action: "apply", n: Number(ap.dataset.lnapply) }, ["Notes updated", "Bee's final transcript was applied to that session."]); return; }
    const sk = t.closest<HTMLElement>("[data-lnskip]"); if (sk) { await act(sk.dataset.lnk!, { action: "skip", n: Number(sk.dataset.lnskip) }); return; }
    const tb = t.closest<HTMLElement>("[data-lntab]"); if (tb) { const k = tb.closest<HTMLElement>("[data-lnbar]")!.dataset.lnbar!; st(k).tab = tb.dataset.lntab as any; D!.repaint(); if (st(k).tab === "notes") pull(k); return; }
  });
}
// Tests / the design sandbox: seed a view (and a doc) without the server.
export function lnSeed(slug: string, sid: any, v: LnView, doc: string | null, bee = true) { const x = st(key(slug, sid)); x.v = v; x.doc = doc; x.ver++; B.bee = bee; }
export const lnBeeOn = (on: boolean) => { B.bee = on; };
