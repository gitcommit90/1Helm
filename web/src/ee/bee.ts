// Settings → Ambient → Bee (1HC notes/2026-10-07-ambient-bee/SPEC.md §1, §2, §11; server: proto src/bee.js).
// The card: Not connected [Connect] · Connecting [Continue][Cancel] · Connected as <name> · synced Xm ago · N convs [Sync now]
// [Disconnect] (+ why syncing is paused, when it is) · Needs reconnect [Reconnect].
// The Connect sheet: step 1 Developer mode ("I've done this"), step 2 Pair: the request ID large with Copy (first on a phone, which
// can't scan its own screen) and a QR we draw here of https://bee.computer/connect#<requestId> (never a link to that page), a
// countdown to expiresAt (the server renews the code by itself when it runs out), the steps in the Bee app, the "Bee CLI" note,
// and the privacy block in plain words. While the sheet (or the section, mid-pairing) is on screen and the tab is visible, the app
// asks the server to take one step every 2 s (POST /api/bee/poll); the server decides whether to call Bee.
// Sync now runs one sync on the server at once (step 3: the BeeSync DO; it also runs by itself every 5 min). While the section is
// on screen the card re-reads its line now and then (every 5 s until the first sync lands, then every minute); "Xm ago" ticks.
// Disconnect asks "Keep memories from Bee, or remove them?": remove deletes the conversations Bee added to memory + their transcripts.
// Import past conversations (step 5, SPEC §6): offered right after Connect (the "Connected" step of the sheet) and any time from the
// card. All | 30 | 60 | 90 days | Skip → the server counts with list calls only → "~N conversations · est $X · ~Y min" [Start][Cancel].
// While it runs the card shows "41 of 120 · 6m elapsed · ~9m left · $0.31 so far" [Pause][Cancel] (re-read every 5 s while on
// screen); finished 30/60/90-day runs leave a history line ("All" doesn't), a cancelled one says "Cancelled at X of Y".
// v3.ts hooks in: beeInit() once, beeSec() as the "ambient" section.
import { encode } from "uqr";
import { choose, ask } from "../dialog";

type Pairing = { request_id: string; url: string; expires_at: number; expires_in?: number; waiting?: boolean };
type Sync = { at: number | null; convs: number; note?: string | null };
type Backfill = { status: "ready" | "running" | "paused"; days: number; total: number; done: number; failed?: number; elapsed_ms: number; left_ms: number; cost_usd: string; est_usd: string; est_ms: number; reason?: string | null; recording?: number };
type Hist = { days: number; at: number; convs: number; took_ms: number; cost_usd: string; outcome: "done" | "cancelled"; done: number; total: number };
type State = { state: "none" | "pairing" | "connecting" | "connected" | "needs_reconnect" | "unavailable"; name?: string | null; connected_at?: number; checked_at?: number | null;
  pairing?: Pairing; reconnecting?: boolean; error?: string; memories?: string; removed?: number; sync?: Sync; backfill?: Backfill | null; history?: Hist[]; offer?: boolean;
  writes?: { stuck: number; owed: number } };   // Notebook changes owed to Bee (bee-sync.js): stuck = stopped retrying, shown with Retry
type Deps = {
  live: { api: string; slug: string } | null;
  repaint: () => void;                       // Settings, if it's open on Ambient
  shown: () => boolean;                      // Settings is open on Ambient
  note: (title: string, sub: string, bad?: boolean) => void;
  srow: (icon: string, title: string, sub: string, right: string, attrs?: string) => string;
  helper: () => string;
  phone: () => boolean;
};
let D: Deps | null = null;
const BF: { busy: "" | "count" | "start" | "pause" | "resume" | "cancel" | "skip"; days: number; err: string } = { busy: "", days: 30, err: "" };
const B: { st: State | null; loaded: boolean; err: string; busy: "" | "connect" | "cancel" | "disconnect" | "sync"; sheet: HTMLElement | null; step: 1 | 2 | 3 | 4; deadline: number;
  copied: number; tick: number; poll: number; inflight: boolean; checked: boolean; prev: HTMLElement | null; refresh: number; firstSync: number } =
  { st: null, loaded: false, err: "", busy: "", sheet: null, step: 1, deadline: 0, copied: 0, tick: 0, poll: 0, inflight: false, checked: false, prev: null, refresh: 0, firstSync: 0 };

export const LINKS = {
  privacy: "https://bee.computer/privacy",
  protects: "https://www.aboutamazon.com/news/devices/bee-private-compute-data-protection",
  audit: "https://assets.aboutamazon.com/1a/90/702935c1490dbc001b39ce86f334/2026-09-amazonbeeprivatecompute-securityreview.pdf",
};
const esc = (s: any = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const I = (p: string, s = 17, w = 1.8) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const ic = {
  copy: I('<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>', 16),
  check: I('<path d="M20 6 9 17l-5-5"/>', 16, 2.2),
  ext: I('<path d="M7 7h10v10"/><path d="M7 17 17 7"/>', 15),
  shield: I('<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>', 18),
  doc: I('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 13h4M10 17h4"/>', 18),
  lock: I('<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', 18),
  warn: I('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>', 16),
  keypad: I('<circle cx="6" cy="5" r="1.4"/><circle cx="12" cy="5" r="1.4"/><circle cx="18" cy="5" r="1.4"/><circle cx="6" cy="11" r="1.4"/><circle cx="12" cy="11" r="1.4"/><circle cx="18" cy="11" r="1.4"/><circle cx="6" cy="17" r="1.4"/><circle cx="12" cy="17" r="1.4"/><circle cx="18" cy="17" r="1.4"/><circle cx="12" cy="22" r="1.1"/>', 15, 1.5),
};
// A plain mark for the card (a yellow tile with three dots), not Bee's logo.
export const beeMark = (s = 38) => `<span class="beemark" style="width:${s}px;height:${s}px" aria-hidden="true"><svg viewBox="0 0 24 24" width="${Math.round(s * .58)}" height="${Math.round(s * .58)}"><circle cx="8" cy="9" r="3.2"/><circle cx="15.5" cy="8.5" r="2.4"/><circle cx="13" cy="15.5" r="3.6"/></svg></span>`;

// ---------- the QR code (drawn here; black on white whatever the theme, so any camera reads it) ----------
export function qrSvg(text: string, px = 200) {
  const q = encode(text, { ecc: "M", border: 2 }), n = q.size; let d = "";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.data[y][x]) d += `M${x} ${y}h1v1h-1z`;
  return `<svg class="beeqr" viewBox="0 0 ${n} ${n}" width="${px}" height="${px}" shape-rendering="crispEdges" role="img" aria-label="QR code for the Bee app"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// ---------- server ----------
let fake: State = { state: "none" }, fakePolls = 0;   // the design sandbox: a pretend server
async function call(op: string, body?: any): Promise<State> {
  if (!D?.live) {
    await new Promise(z => setTimeout(z, 300));
    const p = (): Pairing => ({ request_id: "q7m2k9x4v8t1c5n3b6z0r2wd", url: "https://bee.computer/connect#q7m2k9x4v8t1c5n3b6z0r2wd", expires_at: Date.now() + 300e3, expires_in: 300e3 });
    if (op === "connect") { fake = { ...fake, state: fake.state === "connected" ? "connected" : "pairing", pairing: fake.pairing ?? p() }; fakePolls = 0; }
    if (op === "poll" && fake.pairing && ++fakePolls > 6) { fake = { state: "connected", name: "Joseph Yaksich", connected_at: Date.now(), sync: { at: null, convs: 0, note: null }, backfill: null, history: [], offer: true }; }
    if (op === "" && fake.state === "connected" && fake.sync && !fake.sync.at && Date.now() - (fake.connected_at || 0) > 4000) fake.sync = { at: Date.now(), convs: 7, note: null };
    if (op === "sync" && fake.state === "connected") { await new Promise(z => setTimeout(z, 1200)); fake.sync = { at: Date.now(), convs: (fake.sync?.convs || 0) + 1, note: null }; }
    if (op === "cancel") { delete fake.pairing; if (fake.state === "pairing") fake.state = "none"; }
    if (op === "backfill") { const o = body?.op;
      if (o === "count") { await new Promise(z => setTimeout(z, 900)); const n = { 0: 212, 30: 43, 60: 97, 90: 131 }[body.days as 0] ?? 43; fake.backfill = { status: "ready", days: body.days, total: n, done: 0, elapsed_ms: 0, left_ms: n * 900, cost_usd: "$0.00", est_usd: n * 0.00024 < 0.005 ? "<$0.01" : `$${(n * 0.00024).toFixed(2)}`, est_ms: n * 900 }; }
      if (o === "start" && fake.backfill) fake.backfill = { ...fake.backfill, status: "running", done: 0, elapsed_ms: 0 };
      if (o === "pause" && fake.backfill) fake.backfill = { ...fake.backfill, status: "paused" };
      if (o === "resume" && fake.backfill) fake.backfill = { ...fake.backfill, status: "running" };
      if (o === "cancel" && fake.backfill) { const b = fake.backfill; if (b.status !== "ready" && b.days) fake.history = [{ days: b.days, at: Date.now(), convs: b.done, took_ms: b.elapsed_ms, cost_usd: "<$0.01", outcome: "cancelled", done: b.done, total: b.total }, ...(fake.history || [])]; fake.backfill = null; }
      if (o === "skip") fake.backfill = null;
      fake.offer = false; }
    if (op === "" && fake.backfill?.status === "running") { const b = fake.backfill; b.done = Math.min(b.total, b.done + 7); b.elapsed_ms += 6000; b.left_ms = (b.total - b.done) * 900; b.cost_usd = b.done * 0.00024 < 0.005 ? "<$0.01" : `$${(b.done * 0.00024).toFixed(2)}`;
      if (b.done >= b.total) { if (b.days) fake.history = [{ days: b.days, at: Date.now(), convs: b.total, took_ms: b.elapsed_ms, cost_usd: b.cost_usd, outcome: "done", done: b.total, total: b.total }, ...(fake.history || [])]; fake.backfill = null; } }
    if (op === "writes") delete fake.writes;
    if (op === "disconnect") fake = { state: "none", memories: body?.memories === "remove" ? "removed" : "kept", removed: body?.memories === "remove" ? (fake.sync?.convs || 0) : 0 };
    return JSON.parse(JSON.stringify(fake));
  }
  const r = await fetch(`${D.live.api}/bee${op ? "/" + op : ""}`, op ? { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) } : { credentials: "same-origin" });
  const d = await r.json().catch(() => null);
  if (!d || !d.state) throw new Error(r.status === 403 ? "This is a read-only view." : "Couldn't reach 1Helm. Check your connection.");
  return d;
}
function take(st: State) {
  const was = B.st?.state;
  B.st = st; B.loaded = true; B.err = st.error || "";
  if (st.pairing) { const left = st.pairing.expires_in ?? st.pairing.expires_at - Date.now(); B.deadline = Date.now() + Math.max(0, left); }
  if (B.sheet && st.state === "connected" && !st.pairing && B.step === 2) B.step = 3;   // just connected
  if (was && was !== "connected" && st.state === "connected" && !B.sheet) D?.note(`Connected as ${st.name || "your Bee account"}`, "Your Bee is connected to 1Helm.");
  paint(); schedule(); scheduleRefresh();
}
export function beeLoad(force = false) {
  if (B.loaded && !force) return;
  B.loaded = true;
  call("").then(take).catch((e) => { B.loaded = false; B.err = e.message; paint(); });
}

// ---------- polling: only while the sheet (or the section, mid-pairing) is on screen and the tab is visible ----------
const pairingNow = () => !!B.st?.pairing || B.st?.state === "connecting";
const watching = () => !document.hidden && pairingNow() && (!!B.sheet || !!D?.shown());
function schedule() {
  clearTimeout(B.poll);
  if (!watching()) return;
  B.poll = window.setTimeout(pollOnce, 2000);
}
async function pollOnce() {
  if (B.inflight || !watching()) return schedule();
  B.inflight = true;
  try { take(await call("poll")); } catch (e: any) { B.err = e.message; paint(); schedule(); }
  finally { B.inflight = false; }
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && pairingNow()) { clearTimeout(B.poll); void pollOnce(); } if (!document.hidden) scheduleRefresh(); });
// The connected card's line ("synced Xm ago · N convs"): re-read (GET, read-only) while the section is on screen: every 5 s for the
// first minute after connecting until the first sync lands, then every minute.
function scheduleRefresh() {
  clearTimeout(B.refresh);
  const st = B.st; if (document.hidden || !D?.shown() || st?.state !== "connected" || B.busy || BF.busy) return;
  const waiting = !st.sync?.at; if (waiting && !B.firstSync) B.firstSync = Date.now();
  const fast = (waiting && Date.now() - B.firstSync < 60e3) || st.backfill?.status === "running";
  B.refresh = window.setTimeout(() => { if (!D?.shown() || B.busy || BF.busy) return; call("").then(take).catch(() => {}); }, fast ? 5000 : 60e3);
}

// ---------- the card (Settings → Ambient) ----------
// "just now" · "4m ago" · "3h ago" · "Oct 6"
export function ago(at: number | null | undefined, now = Date.now()) {
  if (!at) return "";
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
// Approve / Deny / a note edit go to Bee in the background; only a change that stopped retrying shows here (no toast), quietly.
const chg = (n: number) => `${n} ${n === 1 ? "change" : "changes"}`;
const wrLine = (st: State) => { const w = st.writes; if (!w) return "";
  if (w.stuck) return `<span class="beewhy beewr">${chg(w.stuck)} couldn't reach your Bee. <button class="beelink" data-beewr="retry">Retry</button><span aria-hidden="true">·</span><button class="beelink" data-beewr="dismiss">Dismiss</button></span>`;
  return st.state === "needs_reconnect" && w.owed ? `<span class="beewhy">${chg(w.owed)} will reach your Bee after you reconnect.</span>` : ""; };
const syncLine = (y?: Sync) => !y ? "" : `<span>${y.at ? `synced <span data-beeago="${y.at}">${ago(y.at)}</span>` : "first sync on its way"} · ${y.convs} ${y.convs === 1 ? "conversation" : "conversations"}</span>`;
const fmtLeft = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const btn = (label: string, attr: string, cls = "") => `<button class="sa${cls ? " " + cls : ""}" ${attr}>${label}</button>`;
// "card": inside the connected card (the section's own rows below carry the links); "fold": folded on the pairing step.
function privacyHtml(kind: "full" | "card" | "fold" = "full") {
  const items = [
    "Bee doesn't store audio.",
    "Transcripts are encrypted with keys held on your devices, and processed in attested confidential computing that Trail of Bits audited.",
    "Connecting gives 1Helm access to all of your Bee data. 1Helm keeps copies in your memory, under 1Helm's terms.",
    "You can disconnect here anytime, or in the Bee app (Developer, then the trash icon).",
  ];
  const list = `<ul>${items.map(t => `<li>${esc(t)}</li>`).join("")}</ul>`, links = kind === "card" ? ""
    : `<div class="beelinks"><a href="${LINKS.privacy}" target="_blank" rel="noopener">Bee privacy notice${ic.ext}</a><a href="${LINKS.protects}" target="_blank" rel="noopener">How Bee protects your data${ic.ext}</a><a href="${LINKS.audit}" target="_blank" rel="noopener">Security audit${ic.ext}</a></div>`;
  if (kind === "fold") return `<details class="beepriv fold"><summary class="beeph">${ic.lock}<b>Your privacy</b><span class="beefold">What connecting means</span></summary>${list}${links}</details>`;
  return `<div class="beepriv${kind === "card" ? " compact" : ""}"><div class="beeph">${ic.lock}<b>Your privacy</b></div>${list}${links}</div>`;
}
// ---------- Import past conversations (§6) ----------
// "45s" · "6m" · "1h 5m"; took: "4m12s"
export const dur = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); if (s < 60) return `${s}s`; const m = Math.round(s / 60); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`; };
export const took = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)), m = Math.floor(s / 60); return m ? `${m}m${String(s % 60).padStart(2, "0")}s` : `${s}s`; };
const rangeName = (d: number) => d ? `Last ${d} days` : "Everything";
const whenAt = (at: number) => new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const estLine = (b: Backfill) => `~${b.total} ${b.total === 1 ? "conversation" : "conversations"} · est ${b.est_usd} · ~${Math.max(1, Math.round(b.est_ms / 60e3))} min`;
export const progLine = (b: Backfill) => `${b.done} of ${b.total} · ${dur(b.elapsed_ms)} elapsed${b.status === "running" ? ` · ~${dur(b.left_ms)} left` : ""} · ${b.cost_usd} so far`;
export const histLine = (h: Hist) => `${rangeName(h.days)} · ${whenAt(h.at)} · ${h.outcome === "cancelled" ? `Cancelled at ${h.done} of ${h.total}` : `${h.convs} ${h.convs === 1 ? "conv" : "convs"} · took ${took(h.took_ms)} · ${h.cost_usd}`}`;
const WHY: Record<string, string> = { credits: "Paused: out of credits. Add credits in Settings → Usage, then Resume.", day: "Paused: today's spending limit is reached. Resume tomorrow.",
  reconnect: "Paused: Bee needs reconnecting.", readonly: "Paused: 1Helm is read-only.", down: "Paused: Bee isn't answering. Try Resume in a few minutes." };
function bfCardHtml(st: State): string {
  const b = st.backfill, hist = st.history || [], bb = BF.busy; if (!b && !hist.length) return "";
  let row = "";
  if (b) {
    const title = b.status === "ready" ? `Import ${rangeName(b.days).toLowerCase()}?` : b.status === "paused" ? `Import paused · ${rangeName(b.days).toLowerCase()}` : `Importing ${rangeName(b.days).toLowerCase()}`;
    const line = b.status === "ready" ? (b.total ? estLine(b) : "Nothing new in that range.") : progLine(b);
    const btns = b.status === "ready" ? (b.total ? btn(bb === "start" ? "Starting…" : "Start", `data-bfgo="start"${bb ? " disabled" : ""}`, "blue") : "") + btn(bb === "cancel" ? "Cancelling…" : "Cancel", `data-bfgo="cancel"${bb ? " disabled" : ""}`, "mute")
      : (b.status === "running" ? btn(bb === "pause" ? "Pausing…" : "Pause", `data-bfgo="pause"${bb ? " disabled" : ""}`) : btn(bb === "resume" ? "Resuming…" : "Resume", `data-bfgo="resume"${bb ? " disabled" : ""}`, "blue"))
        + btn(bb === "cancel" ? "Cancelling…" : "Cancel", `data-bfgo="cancel"${bb ? " disabled" : ""}`, "mute");
    const pct = b.total ? Math.round(b.done / b.total * 100) : 0;
    row = `<div class="sr beerow beebf" data-bfstate="${b.status}"><span class="srt"><b>${esc(title)}</b><span class="beesub"><span class="beemeta">${b.status === "running" ? `<i class="apspin"></i>` : ""}${esc(line)}</span>
      ${b.status !== "ready" ? `<span class="bfbar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></span>` : ""}
      ${b.status === "paused" && b.reason ? `<span class="beewhy beenote">${ic.warn}${esc(WHY[b.reason] || "Paused.")}</span>` : ""}</span></span><span class="beebtns">${btns}</span></div>`;
  }
  const hl = hist.length ? `<div class="sr beehist"><span class="srt"><b>Past imports</b>${hist.map(h => `<span class="bfh">${esc(histLine(h))}</span>`).join("")}</span></div>` : "";
  return row + hl;
}
// The chooser, in the sheet: after Connect (step 3) and from the card (step 4).
function importHtml(afterConnect: boolean): string {
  const b = B.st?.backfill, bb = BF.busy;
  if (b?.status === "ready") return `<div class="bfpick"><h3 class="bsh3">Import ${esc(rangeName(b.days).toLowerCase())}?</h3>
    <p class="bfest">${b.total ? esc(estLine(b)) : "Nothing new in that range. Everything there is already in memory."}</p>
    <p class="bfnote">Finished conversations only, newest first. Each one's summary goes into memory and its transcript into your storage, the same as new ones. You can pause or cancel anytime.</p>
    ${BF.err ? `<p class="beeerr" role="alert">${esc(BF.err)}</p>` : ""}
    <div class="bsbtns"><button type="button" class="dlgb no" data-bfgo="cancel"${bb ? " disabled" : ""}>${bb === "cancel" ? "Cancelling…" : "Cancel"}</button>${b.total ? `<button type="button" class="dlgb ok" data-bfgo="start"${bb ? " disabled" : ""}>${bb === "start" ? "Starting…" : "Start"}</button>` : ""}</div></div>`;
  if (b) return `<div class="bfpick"><p class="bfest">${esc(progLine(b))}</p><div class="bsbtns"><button type="button" class="dlgb ok" data-bsx>Done</button></div></div>`;
  const opt = (d: number, label: string) => `<button type="button" class="bfopt${BF.days === d ? " on" : ""}" data-bfdays="${d}" aria-pressed="${BF.days === d}"${bb ? " disabled" : ""}>${label}</button>`;
  return `<div class="bfpick"><h3 class="bsh3">${afterConnect ? "Import past conversations too?" : "Import past conversations"}</h3>
    <p class="bfnote">New conversations come in by themselves from now on. ${esc(D!.helper())} can also learn from the ones you already had. First we count them, so you see the cost before anything starts.</p>
    <div class="bfopts" role="group" aria-label="How far back">${opt(30, "Last 30 days")}${opt(60, "Last 60 days")}${opt(90, "Last 90 days")}${opt(0, "All")}</div>
    ${BF.err ? `<p class="beeerr" role="alert">${esc(BF.err)}</p>` : ""}
    <div class="bsbtns"><button type="button" class="dlgb no" data-bfskip${bb ? " disabled" : ""}>${afterConnect ? "Skip" : "Cancel"}</button><button type="button" class="dlgb ok" data-bfcount${bb ? " disabled" : ""}>${bb === "count" ? "Counting…" : "Count them"}</button></div></div>`;
}
async function bfDo(op: "count" | "start" | "pause" | "resume" | "cancel" | "skip") {
  if (BF.busy) return;
  const b = B.st?.backfill;
  if (op === "cancel" && b && b.status !== "ready" && !(await ask({ title: "Stop the import?", body: `${b.done} of ${b.total} conversations are in. They stay in memory; the rest won't be imported.`, confirm: "Stop import", cancel: "Keep going" }))) return;
  BF.busy = op; BF.err = ""; paint();
  try { const r = await call("backfill", op === "count" ? { op, days: BF.days } : { op }); BF.busy = ""; take(r); if (r.error) BF.err = r.error;
    if (op === "start" && !r.error) { if (B.sheet) close(); D?.note("Importing past conversations", r.backfill ? progLine(r.backfill) : "It runs in the background. You can pause it on the Bee card."); }
    if (op === "cancel" && !r.error && B.sheet && B.step === 4) close(); }
  catch (e: any) { BF.busy = ""; BF.err = e.message; }
  paint();
}
export function beeImport() { if (!D || B.sheet) return; BF.err = ""; beeOpen(4); }

export function beeSec(): string {
  if (!D) return "";
  beeLoad();
  if (D.shown() && !B.checked && B.st?.state === "connected" && D.live) { B.checked = true; call("check").then(take).catch(() => {}); }
  setTimeout(() => { schedule(); scheduleRefresh(); }, 0);
  const h = esc(D.helper()), st = B.st, s = st?.state, busy = B.busy;
  let sub = "", right = "";
  if (!st) sub = B.err ? esc(B.err) : `<span class="beeload"><i class="apspin"></i>Checking…</span>`;
  else if (s === "unavailable") sub = "Not available yet.";
  else if (s === "none") { sub = `Its conversations become memories ${h} can use.`; right = btn(busy === "connect" ? "Starting…" : "Connect", `data-beeopen${busy ? " disabled" : ""}`, "blue"); }
  else if (s === "pairing") { sub = `Connecting · finish in the Bee app${st.pairing ? ` · code renews in <span data-beeleft>${fmtLeft(B.deadline - Date.now())}</span>` : ""}`; right = btn("Continue", "data-beeopen", "blue") + btn(busy === "cancel" ? "Cancelling…" : "Cancel", `data-beecancel${busy ? " disabled" : ""}`, "mute"); }
  else if (s === "connecting") sub = `<span class="beeload"><i class="apspin"></i>Connecting… checking your Bee account</span>`;
  else if (s === "connected") { sub = `<span class="beeok">${ic.check}Connected as ${esc(st.name || "your Bee account")}</span>${st.sync ? `<span class="beemeta" data-beesync>${busy === "sync" ? `<i class="apspin"></i>Syncing…` : syncLine(st.sync)}</span>` : ""}${st.sync?.note ? `<span class="beewhy beenote">${ic.warn}${esc(st.sync.note)}</span>` : ""}${wrLine(st)}`;
    right = btn(busy === "sync" ? "Syncing…" : "Sync now", `data-beesync-now${busy ? " disabled" : ""}`) + (st.backfill ? "" : btn("Import past conversations", `data-beeimport${busy ? " disabled" : ""}`)) + btn(busy === "disconnect" ? "Disconnecting…" : "Disconnect", `data-beeoff${busy ? " disabled" : ""}`, "mute"); }
  else if (s === "needs_reconnect") { sub = `<span class="beewarn">${ic.warn}Needs reconnect</span><span class="beewhy">Bee stopped accepting 1Helm's connection${st.name ? ` (${esc(st.name)})` : ""}. Reconnect to keep it working.</span>${wrLine(st)}`;
    right = btn("Reconnect", "data-beeopen", "blue") + btn(busy === "disconnect" ? "Disconnecting…" : "Disconnect", `data-beeoff${busy ? " disabled" : ""}`, "mute"); }
  const card = `<div class="sr beerow" data-beecard="${s || "loading"}">${beeMark()}<span class="srt"><b>Bee</b><span class="beesub">${sub}</span></span>${right ? `<span class="beebtns">${right}</span>` : ""}</div>`
    + (s === "connected" || s === "needs_reconnect" ? bfCardHtml(st!) + `<div class="sr beeprivrow">${privacyHtml("card")}</div>` : "");
  const links = `<a class="sr" href="${LINKS.privacy}" target="_blank" rel="noopener" data-beelink="privacy"><span class="bico">${ic.shield}</span><span class="srt"><b>Bee privacy</b><span>Bee's Privacy Notice</span></span><span class="schev">${ic.ext}</span></a>
    <a class="sr beesub2" href="${LINKS.protects}" target="_blank" rel="noopener" data-beelink="protects"><span class="srt"><b>How Bee protects your data</b></span><span class="schev">${ic.ext}</span></a>
    <a class="sr beesub2" href="${LINKS.audit}" target="_blank" rel="noopener" data-beelink="audit"><span class="srt"><b>Security audit</b><span>Trail of Bits, September 2026 (PDF)</span></span><span class="schev">${ic.ext}</span></a>`;
  return `<h2>Ambient</h2><p class="slead">Devices that listen through your day, so ${h} remembers what was said. Nothing connects unless you connect it here.</p>
    <div class="sc beecard">${card}</div>${B.err && st ? `<p class="beeerr" role="alert">${esc(B.err)}</p>` : ""}
    <div class="sc">${links}</div>`;
}

// ---------- the Connect sheet ----------
function sheetBody(): string {
  const st = B.st, p = st?.pairing, phone = D!.phone();
  const head = (n: string) => `<div class="dlggrab"></div><div class="bshd">${beeMark(42)}<div><h2 id="bst">${st?.reconnecting || st?.state === "needs_reconnect" ? "Reconnect your Bee" : "Connect your Bee"}</h2>${n ? `<p class="bsn">${n}</p>` : ""}</div></div>`;
  if (B.step === 4) return `<div class="dlggrab"></div><div class="bshd">${beeMark(42)}<div><h2 id="bst">Your Bee</h2></div></div>${importHtml(false)}`;
  if (B.step === 3) return `${head("")}<div class="bsdone"><span class="bsok">${I('<path d="M20 6 9 17l-5-5"/>', 26, 2.2)}</span><h3>Connected as ${esc(st?.name || "your Bee account")}</h3>
    <p>Your Bee is connected to 1Helm. You can disconnect anytime in Settings → Ambient.</p></div>${st?.offer !== false || st?.backfill ? importHtml(true) : `<div class="bsbtns"><button type="button" class="dlgb ok" data-bsx>Done</button></div>`}`;
  if (B.step === 1) return `${head("Step 1 of 2")}
    <h3 class="bsh3">Turn on Developer mode in the Bee app</h3>
    <ol class="bsol"><li>Update the Bee app to the newest version.</li><li>Open <b>Settings</b> and tap <b>Version</b> 5 times.</li><li><b>Developer</b> now shows in Settings.</li></ol>
    ${privacyHtml()}
    <div class="bsbtns"><button type="button" class="dlgb no" data-bscancel>Cancel</button><button type="button" class="dlgb ok" data-bsnext>I've done this</button></div>`;
  // step 2: pair
  const left = B.deadline - Date.now(), renewing = !!p && left <= 0, connecting = st?.state === "connecting";
  const idBox = p ? `<div class="bsid"><span class="bsidl">Request ID</span><code class="bsidv" data-beeid>${esc(p.request_id)}</code>
      <button type="button" class="dlgb ${phone ? "ok" : "no"} bscopy" data-bscopy>${Date.now() - B.copied < 2500 ? `${ic.check}<span>Copied</span>` : `${ic.copy}<span>Copy</span>`}</button></div>` : "";
  const qr = p ? `<div class="bsqr">${qrSvg(p.url, phone ? 168 : 196)}${phone ? `<span>Or scan it with the Bee app on another phone</span>` : ""}</div>` : "";
  const code = !p ? `<div class="bswait">${B.err ? `<p class="beeerr" role="alert">${esc(B.err)}</p><button type="button" class="dlgb no" data-bsretry>Try again</button>` : `<span class="beeload"><i class="apspin"></i>Getting a code from Bee…</span>`}</div>`
    : `<div class="bscode${phone ? " ph" : ""}">${phone ? idBox + qr : qr + `<div class="bsside"><p class="bsor">Or paste this ID in the Bee app</p>${idBox}</div>`}</div>
      <p class="bstimer" aria-live="polite">${renewing ? `<i class="apspin"></i>Getting a new code…` : `This code renews by itself in <b data-beeleft>${fmtLeft(left)}</b>`}</p>`;
  const how = `<ol class="bsol"><li>In the Bee app, open <b>Settings</b>, then <b>Developer</b>, then <b>Connect App</b>.</li>
      <li>${phone ? `Tap the keypad icon ${ic.keypad} at the bottom left and paste the ID. Or scan the code from another screen.` : `Scan the code. Or tap the keypad icon ${ic.keypad} at the bottom left and paste the ID.`}</li><li>Tap <b>Connect</b>.</li></ol>
    <p class="bscli">The Bee app will call this connection <b>Bee CLI</b>. That's expected.</p>`;
  const status = connecting ? `<p class="bsstat"><i class="apspin"></i>Connected. Checking your Bee account…</p>`
    : p ? `<p class="bsstat"><i class="apspin"></i>${p.waiting ? "Bee isn't answering right now. Still trying…" : "Waiting for the Bee app…"}</p>` : "";
  return `${head("Step 2 of 2")}<h3 class="bsh3">Pair with the Bee app</h3>${code}${p && B.err ? `<p class="beeerr" role="alert">${esc(B.err)}</p>` : ""}${status}${how}${privacyHtml("fold")}
    <div class="bsbtns"><button type="button" class="dlgb no" data-bscancel>Cancel</button><button type="button" class="dlgb no" data-bsback>Back</button></div>`;
}
function paint() {
  if (D?.shown()) D.repaint();
  if (!B.sheet) return;
  const box = B.sheet.querySelector(".bsbox")!, sc = box.scrollTop;
  box.innerHTML = sheetBody(); box.scrollTop = sc;
}
// Every second: the countdowns only (no full repaint), and the "Getting a new code…" switch when one runs out.
function tickTimer() {
  const left = B.deadline - Date.now();
  document.querySelectorAll<HTMLElement>("[data-beeleft]").forEach(el => { el.textContent = fmtLeft(left); });
  if (B.sheet && B.st?.pairing && left <= 0 && !B.sheet.querySelector(".bstimer .apspin")) paint();
  if (B.sheet && B.copied && Date.now() - B.copied > 2500) { B.copied = 0; paint(); }
}
async function start() {
  B.busy = "connect"; B.err = ""; paint();
  try { take(await call("connect")); } catch (e: any) { B.err = e.message; }
  B.busy = ""; paint(); schedule();
}
let devDone = false;   // "I've done this" once this visit: Reconnect / Continue go straight to the code
export function beeOpen(step?: 4) {
  if (!D || B.sheet) return;
  B.step = step || (devDone || pairingNow() ? 2 : 1); B.copied = 0;
  B.prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const el = document.createElement("div"); el.className = "dlgw bsw";
  el.innerHTML = `<div class="dlgback" data-bsx></div><div class="dlg bsbox" role="dialog" aria-modal="true" aria-labelledby="bst" tabindex="-1"></div>`;
  B.sheet = el; document.body.appendChild(el); paint();
  void el.offsetWidth; el.classList.add("on");
  setTimeout(() => B.sheet?.querySelector<HTMLElement>("[data-bsnext],[data-bscopy],[data-bsx].dlgb,[data-bfcount]")?.focus({ preventScroll: true }), 30);
  B.tick = window.setInterval(tickTimer, 1000);
  if (B.step === 2 && !B.st?.pairing && B.st?.state !== "connecting") void start();
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    const t = e.target as HTMLElement;
    if (t.closest("[data-bsx]")) { close(); return; }
    if (t.closest("[data-bscancel]")) { close(true); return; }
    if (t.closest("[data-bsnext]")) { devDone = true; B.step = 2; paint(); if (!B.st?.pairing) void start(); return; }
    if (t.closest("[data-bsback]")) { B.step = 1; paint(); return; }
    if (t.closest("[data-bsretry]")) { void start(); return; }
    if (t.closest("[data-bscopy]")) { copyId(); return; }
    const dd = t.closest<HTMLElement>("[data-bfdays]"); if (dd) { BF.days = Number(dd.dataset.bfdays); paint(); return; }
    if (t.closest("[data-bfcount]")) { void bfDo("count"); return; }
    if (t.closest("[data-bfskip]")) { if (B.step === 3) void bfDo("skip").then(() => close()); else close(); return; }
    const go = t.closest<HTMLElement>("[data-bfgo]"); if (go) { void bfDo(go.dataset.bfgo as any); return; }
  });
}
function copyId() {
  const id = B.st?.pairing?.request_id; if (!id) return;
  const done = () => { B.copied = Date.now(); paint(); };
  navigator.clipboard?.writeText(id).then(done, () => { selectId(); }) ?? selectId();
  function selectId() { const c = B.sheet?.querySelector("[data-beeid]"); if (!c) return; const r = document.createRange(); r.selectNodeContents(c); const s = getSelection(); s?.removeAllRanges(); s?.addRange(r); D?.note("Select and copy", "The ID is selected. Copy it, then paste it in the Bee app."); }
}
function close(cancel = false) {
  const el = B.sheet; if (!el) return; B.sheet = null; clearInterval(B.tick);
  el.classList.remove("on"); el.classList.add("off"); setTimeout(() => el.remove(), 300);
  if (B.prev?.isConnected) B.prev.focus({ preventScroll: true });
  if (cancel && B.st?.pairing) void doCancel(); else { paint(); schedule(); }
}
async function doCancel() {
  B.busy = "cancel"; paint();
  try { take(await call("cancel")); } catch (e: any) { B.err = e.message; }
  B.busy = ""; paint();
}
async function disconnect() {
  const pick = await choose({ title: "Disconnect Bee?", body: `Keep memories from Bee, or remove them? To take 1Helm out of the Bee app too, open Developer there and delete “Bee CLI”.`,
    confirm: "Keep them", alt: "Remove them", cancel: "Cancel" });
  if (pick === "no") return;
  B.busy = "disconnect"; paint();
  try { const r = await call("disconnect", { memories: pick === "alt" ? "remove" : "keep" }); take(r);
    D?.note("Bee disconnected", pick === "alt" ? (r.removed ? `${r.removed} ${r.removed === 1 ? "conversation" : "conversations"} from Bee removed from memory.` : "Memories from Bee are removed.") : "Memories from Bee stay in your memory."); }
  catch (e: any) { D?.note("Couldn't disconnect", e.message, true); }
  B.busy = ""; B.checked = false; paint();
}
async function syncNow() {
  const before = B.st?.sync?.convs ?? 0;
  B.busy = "sync"; B.err = ""; paint();
  try { const r = await call("sync"); B.busy = ""; take(r); const n = (r.sync?.convs ?? 0) - before;
    if (!r.error && r.state === "connected") D?.note("Bee synced", r.sync?.note || (n > 0 ? `${n} new ${n === 1 ? "conversation" : "conversations"} in memory.` : "Nothing new since the last sync."), !!r.sync?.note); }
  catch (e: any) { B.busy = ""; D?.note("Couldn't sync", e.message, true); }
  paint();
}
export const beeSheetOpen = () => !!B.sheet;

// Keys while the sheet is open: Esc closes it (the pairing keeps going on the server until it expires; the card says Connecting),
// Tab stays inside. Registered at import, before the app's own listeners (v3.ts imports this right after dialog.ts).
addEventListener("keydown", (e) => {
  const el = B.sheet; if (!el) return;
  if (document.querySelector(".dlgw:not(.bsw).on")) return;   // a dialog on top handles its own keys
  e.stopImmediatePropagation();
  if (e.key === "Escape") { e.preventDefault(); close(); }
  else if (e.key === "Tab") { const f = [...el.querySelectorAll<HTMLElement>("button:not(:disabled),a[href]")]; if (!f.length) return;
    const i = f.indexOf(document.activeElement as HTMLElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); } }
}, true);

export function beeInit(deps: Deps) {
  D = deps;
  if (!D.live) (window as any).__beeDemo = (st: State) => { fake = st; take(JSON.parse(JSON.stringify(st))); };   // design sandbox: show any state
  document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-beeopen]")) { e.preventDefault(); beeOpen(); return; }
    if (t.closest("[data-beecancel]")) { e.preventDefault(); if (!B.busy) void doCancel(); return; }
    if (t.closest("[data-beeoff]")) { e.preventDefault(); if (!B.busy) void disconnect(); return; }
    if (t.closest("[data-beesync-now]")) { e.preventDefault(); if (!B.busy) void syncNow(); return; }
    if (t.closest("[data-beeimport]")) { e.preventDefault(); beeImport(); return; }
    const wr = t.closest<HTMLElement>("[data-beewr]"); if (wr) { e.preventDefault(); const op = wr.dataset.beewr;
      if (B.st?.writes) { if (op === "dismiss") delete B.st.writes; else B.st.writes = { stuck: 0, owed: B.st.writes.owed + B.st.writes.stuck }; paint(); }   // at once; the answer settles it
      call("writes", { op }).then(take).catch(() => {}); return; }
    const go = t.closest<HTMLElement>("[data-bfgo]"); if (go && !go.closest(".bsw")) { e.preventDefault(); void bfDo(go.dataset.bfgo as any); return; }
  });
  setInterval(() => { if (!D?.shown()) return;
    document.querySelectorAll<HTMLElement>("[data-beeleft]").forEach(el => { el.textContent = fmtLeft(B.deadline - Date.now()); });
    document.querySelectorAll<HTMLElement>("[data-beeago]").forEach(el => { const t = ago(Number(el.dataset.beeago)); if (el.textContent !== t) el.textContent = t; }); }, 1000);
}
