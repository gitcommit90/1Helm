// The card page that opens inside Messages (iMessage live app card, notes/photon-imessage.md §2, §7.3).
// Served by 1HC at /c/<token>: no login, no cookies, nothing from the chat app. It shows one helper reply with the same
// card renderer as the app (genui-render.ts) and sends taps back as the person's reply.
//   GET  /c/<token>/data → { body, answered, picked?, helper: { name, avatar }, sentAt }
//   POST /c/<token>/act  { text }   (text = the same tap message as in the app)
// A permission request (Sentinel, made by 1HC, never by the model) comes as kind:"approval" and uses the app's permission card:
//   GET  /c/<token>/data → { kind: "approval", approval: { id, host, bytes?, keys?, status }, helper, channel: { name }, sentAt }
//        status: "pending" | "once" | "session" | "channel" | "deny" | "expired"
//   POST /c/<token>/decide { decision: "once" | "session" | "channel" | "deny", confirm?: true }
//   A request for a kind of action (1HC perms.js) has approval.perm (host ""): decisions "once" | "always" | "deny".
//        200 { ok: true, status[, already: true] } · 410 { error: "expired", status: "expired" } · 400 { error: "confirmation_required" }
//        · 429 { error: "slow_down" } · 404 bad token / wrong kind. "channel" (Always allow) asks "Are you sure?" first, then sends confirm: true.
//   status can change underneath (decided in the app): /data is re-read when the person comes back to the card (visibilitychange).
// A plan (propose_plan, made by 1HC) comes as kind:"plan" and uses the app's plan card (plan-card.ts): tick items, then
//   POST /c/<token>/decide { decision: "approve", items: [ticked indexes] } | { decision: "deny" } | { decision: "talk" }
//        200 { ok: true, status, plan[, already | talked] } · 410 expired · 429 slow_down. Talk = "Let's talk about the plan" as a text.
import { responseId, type InputReply } from "./input-reply";
import { cardPaging } from "./card-paging";
import { paintCard, patchHtml, wireCards } from "./genui-render";
import { approvalHtml, type Approval, type ApStatus, type Decision } from "./approval-card";
import { planHtml, allPicks, planAnswers, type Plan, type PlanAct } from "./plan-card";
// An interview (the helper's `interview` tool in a texting turn) comes as kind:"interview" and uses the app's interview card:
//   GET  /c/<token>/data → { kind: "interview", interview: view, helper, sentAt }
//   POST /c/<token>/iv   { op: answer|skip|goto|send, … } → { interview[, message] }. Answers save as they go; send posts them as
//        the person's next text (the server does that), and the card locks into its "Answered 7 of 9" summary.
import { ivcHtml, type IvView } from "./interview-card";

const token = decodeURIComponent(location.pathname.replace(/\/+$/, "").split("/").pop() || "");
const base = `/c/${encodeURIComponent(token)}`;
const esc = (s: any = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

type Data = { closed_reason?: string; closed_note?: string; input_reply?: InputReply; kind?: "card" | "approval" | "plan" | "interview"; plan?: Plan | null; interview?: IvView; status?: string; task_url?: string; body: string; answered: boolean; picked?: string; helper: { name: string; avatar: number }; sentAt: number;
  approval?: Approval & { status?: ApStatus }; channel?: { name?: string } };
const st: { d?: Data; attempt?: { text: string; response_id: string }; reply?: string; note: "" | "sending" | "sent" | "error" | "slow" | "noloc"; ap?: { status: ApStatus; confirm?: boolean; busy?: Decision | "" }; pl?: { picks: Set<number>; answers?: Map<number, string>; busy?: PlanAct | ""; error?: string } } = { note: "" };
const AP_STATUS = new Set(["pending", "once", "session", "channel", "always", "trust", "deny", "expired", "host_key_required", "consumed", "cancelled", "failed"]);
// Server-owned deep link, restricted to an app task on this same origin.
const approvalTaskHref = (value?: string) => typeof value === "string" && /^\/w\/[a-z0-9-]+\/app#\/[a-z0-9][a-z0-9-]{0,62}\/s\/[a-zA-Z0-9-]+$/.test(value) ? value : "";

const root = document.createElement("main"); root.className = "cpage"; document.body.appendChild(root);
root.innerHTML = `<header class="chead" id="chead"></header><div class="creply" id="creply"><div class="cload"><i></i><i></i><i></i></div></div><nav class="cpager" id="cpager" aria-label="Card pages" hidden><button type="button" data-cprev aria-label="Previous page"><span aria-hidden="true">‹</span><span>Back</span></button><span class="cpager-center"><span data-cposition aria-live="polite"></span></span><button type="button" data-cnext aria-label="Next page"><span>Next</span><span aria-hidden="true">›</span></button></nav><div class="cnote" id="cnote" role="status" aria-live="polite"></div>`;
const $ = (id: string) => document.getElementById(id)!;
const owner = {};
const refreshPages = cardPaging($("creply"), $("cpager"));
let sentTimer = 0;

function when(t: number) {
  if (!t) return ""; const d = new Date(t), n = new Date(), time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === n.toDateString() ? time : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}
function paint() {
  const d = st.d; if (!d) return;
  const name = d.helper?.name || "Your helper", av = Number(d.helper?.avatar) || 8;
  $("chead").innerHTML = `<img class="cav" src="/av/${av}.png" alt=""><b>${esc(name)}</b><span>${esc(when(d.sentAt))}</span>`;
  if (d.kind === "plan" && d.plan && st.pl) {
    // The plan card (same markup as the app). Decided here or anywhere: locked, showing the outcome. No links inside Messages.
    patchHtml($("creply"), planHtml(d.plan, { picks: st.pl.picks, answers: st.pl.answers, busy: st.pl.busy, error: st.pl.error, fresh: true }, { helper: name, act: (k) => `data-cpa="${k}"`, pick: (i) => `data-cpp="${i}"`,
      ans: (q, opt) => `data-cpq="${q}" data-cpo="${opt.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)}"`, ansInput: (q) => `data-cpqi="${q}"` }));
  } else if (d.kind === "interview" && d.interview) {
    // The interview card (same markup as the app). Its own taps repaint it in place; this only draws it (and keeps it on re-draw).
    const html = ivcHtml(d.interview, { key: `c:${token}`, helper: name, phone: () => true, sentNote: `Sent ✓ ${name} will text you back.`,
      api: async (b: any) => { const r = await fetch(`${base}/iv`, { method: "POST", credentials: "omit", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }); return r.json().catch(() => ({ error: `HTTP ${r.status}` })); },
      sent: () => {} });
    patchHtml($("creply"), html);
  } else if (d.kind === "approval" && st.ap) {
    // The permission card (same markup as the app). Decided (here or anywhere) or expired: locked, showing the result.
    const a = d.approval!, at = (k: string) => k === "cancel" ? `data-cdx` : `data-cd="${k === "confirm" ? "channel" : k}"${k === "confirm" ? " data-cdok" : ""}`;
    const followup = st.ap.status === "host_key_required", task = approvalTaskHref(d.task_url);
    const next = followup ? `<div class="gu-sys"><p class="gu-sl">Open the task in 1Helm to check the server fingerprint and confirm the new request. This card authorizes only its original request.</p>${task ? `<a class="gu-b primary" href="${esc(task)}" target="_blank" rel="noopener noreferrer">Open task to verify fingerprint</a>` : `<p class="gu-sl">Open 1Helm and return to the requesting channel's task.</p>`}</div>` : "";
    patchHtml($("creply"), approvalHtml(a, { status: st.ap.status, confirm: st.ap.confirm, busy: st.ap.busy, fresh: true }, { helper: name, channel: d.channel?.name || "", attr: at }) + next);
  } else
  // Answered (here or anywhere): the controls lock and show what was picked.
  paintCard($("creply"), d.body, { owner, streaming: false, reply: st.reply, ref: { input_reply: d.input_reply } });
  const n = $("cnote"), nm = esc(name);
  n.className = `cnote${!st.note && d.closed_note ? " on" : ""}${st.note ? " on " + (st.note === "slow" || st.note === "noloc" ? "error" : st.note) : ""}`;
  n.innerHTML = st.note === "sending" ? `<span class="cspin"></span>Sending…` : st.note === "sent" ? `<b>Sent ✓</b><span>To ${nm}</span>`
    : st.note === "error" ? `Couldn't send that. Check your connection and tap again.` : st.note === "slow" ? `One moment. Tap again in a few seconds.`
    : st.note === "noloc" ? `Couldn't get your location. Allow location for this page, then tap again, or text ${nm} the area instead.` : esc(d.closed_note || "");
  refreshPages();
  clearTimeout(sentTimer);
  if (st.note === "sent") sentTimer = window.setTimeout(() => { st.note = ""; paint(); }, 2500);
}
async function load() {
  try {
    const r = await fetch(`${base}/data`, { credentials: "omit", cache: "no-store" }); if (!r.ok) throw new Error(String(r.status));
    st.d = await r.json();
    if (st.d!.kind === "plan") { if (!st.d!.plan) throw new Error("gone"); st.pl = { picks: allPicks(st.d!.plan) }; }
    if (st.d!.kind === "interview") { if (!st.d!.interview?.questions?.length) throw new Error("bad"); }
    else if (st.d!.kind === "approval") { const s = String(st.d!.approval?.status || "pending"); if (!st.d!.approval?.host && !st.d!.approval?.perm) throw new Error("bad"); st.ap = { status: (AP_STATUS.has(s) ? s : "expired") as ApStatus }; }
    else if (st.d!.answered) st.reply = st.d!.picked ?? ""; document.title = `${st.d!.helper?.name || "1Helm"} · 1Helm`; paint();
  } catch {
    $("creply").innerHTML = `<div class="cgone"><b>This card isn't available.</b><span>It may have expired. Your messages are all still in the thread.</span></div>`;
    refreshPages();
  }
}
// Permission card taps. Always allow → "Are you sure?" → Confirm sends confirm:true. A failed send keeps the card open with a note;
// if the request was meanwhile decided elsewhere or expired, the card shows that instead.
document.addEventListener("click", async (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-cd],[data-cdx]"); const ap = st.ap; if (!t || !ap || st.d?.kind !== "approval") return;
  e.preventDefault(); if (ap.busy || ap.status !== "pending" || (t as HTMLButtonElement).disabled) return;
  if (t.hasAttribute("data-cdx")) { ap.confirm = false; paint(); if (!e.detail) document.querySelector<HTMLElement>('[data-cd="channel"]')?.focus(); return; }
  const decision = t.dataset.cd as Decision;
  if (decision === "channel" && !t.hasAttribute("data-cdok")) { ap.confirm = true; st.note = ""; paint(); if (!e.detail) document.querySelector<HTMLElement>("[data-cdok]")?.focus(); return; }
  ap.busy = decision; st.note = ""; paint();
  // 200 { ok, status[, already] } → locked with that status (already decided is not an error) · 410 { status: "expired" } → expired
  // · 429 slow_down → "tap again in a few seconds" · anything else → re-check /data, else "Couldn't send that".
  let code = 0, status: any;
  try {
    const r = await fetch(`${base}/decide`, { method: "POST", credentials: "omit", headers: { "content-type": "application/json" }, body: JSON.stringify(decision === "channel" ? { decision, confirm: true } : { decision }) });
    const j = await r.json().catch(() => ({})); code = r.ok && j?.ok && !j.error ? 200 : r.status || -1; status = j?.status;
    if (st.d && approvalTaskHref(j?.task_url)) st.d.task_url = j.task_url;
  } catch {}
  ap.busy = "";
  if (code === 200 && ["ssh", "ssh_hostkey"].includes(st.d?.approval?.perm || "") && await refresh()) return;
  if (code === 200 || (AP_STATUS.has(status) && status !== "pending")) { ap.status = AP_STATUS.has(status) && status !== "pending" ? status : code === 410 ? "expired" : decision; ap.confirm = false; paint(); return; }
  if (code === 410) { ap.status = "expired"; ap.confirm = false; paint(); return; }
  if (code === 429) { st.note = "slow"; paint(); return; }
  // Failed: was it decided somewhere else, or did it expire? Then show that; otherwise let them tap again.
  if (await refresh()) return;
  st.note = "error"; paint();
});
// Plan card taps: tick/untick, Approve (the ticked items), Deny, Let's talk (sent as their text; the helper texts back).
document.addEventListener("click", async (e) => {
  const d = st.d, pl = st.pl; if (d?.kind !== "plan" || !d.plan || !pl) return;
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-cpp],[data-cpa],[data-cpq]"); if (!t) return;
  e.preventDefault(); if (pl.busy || d.plan.status !== "pending" || (t as HTMLButtonElement).disabled) return;
  if (t.dataset.cpq != null) { const n = Number(t.dataset.cpq), o = t.dataset.cpo || ""; const m = (pl.answers ||= new Map()); if (m.get(n) === o) m.delete(n); else m.set(n, o); paint(); return; }
  if (t.dataset.cpp != null) { const i = Number(t.dataset.cpp); if (pl.picks.has(i)) pl.picks.delete(i); else pl.picks.add(i); pl.error = ""; paint(); if (!e.detail) document.querySelector<HTMLElement>(`[data-cpp="${i}"]`)?.focus(); return; }
  const a = t.dataset.cpa as PlanAct, items = d.plan.items.filter((x) => pl.picks.has(x.i)).map((x) => x.i);
  if (a === "approve" && !items.length) return;
  pl.busy = a; pl.error = ""; st.note = ""; paint();
  let code = 0, j: any = null;
  try { const r = await fetch(`${base}/decide`, { method: "POST", credentials: "omit", headers: { "content-type": "application/json" }, body: JSON.stringify(a === "approve" ? { decision: a, items, ...(planAnswers(d.plan, pl).length ? { answers: planAnswers(d.plan, pl) } : {}) } : { decision: a }) });
    j = await r.json().catch(() => ({})); code = r.ok && j?.ok ? 200 : r.status || -1; } catch {}
  pl.busy = "";
  if (code === 200) { if (j.plan) d.plan = j.plan; if (j.talked) st.note = "sent"; paint(); return; }
  if (code === 410) { $("creply").innerHTML = `<div class="cgone"><b>This plan isn't available anymore.</b><span>Your messages are all still in the thread.</span></div>`; return; }
  if (code === 429) { st.note = "slow"; paint(); return; }
  if (await refreshPlan()) return;
  pl.error = a === "talk" ? "Couldn't send that. Check your connection and tap again." : `Couldn't ${a === "approve" ? "start that" : "send that"}. Check your connection and tap again.`; paint();
});
// A typed answer to a "Questions first" question: kept as they type (no repaint, so the box keeps focus).
document.addEventListener("input", (e) => {
  const t = e.target as HTMLInputElement, pl = st.pl; if (!pl || t?.dataset?.cpqi == null) return;
  const n = Number(t.dataset.cpqi), m = (pl.answers ||= new Map()); if (t.value.trim()) m.set(n, t.value); else m.delete(n);
  t.closest(".pl-q")?.querySelectorAll<HTMLElement>(".gu-chip.on").forEach((c) => { c.classList.remove("on"); c.setAttribute("aria-checked", "false"); });
}, true);
async function refreshPlan() {
  try { const r = await fetch(`${base}/data`, { credentials: "omit", cache: "no-store" }); const d = r.ok ? await r.json() : null;
    if (d?.kind === "plan" && d.plan && st.d?.plan && d.plan.status !== st.d.plan.status && !st.pl?.busy) { st.d = d; st.note = ""; paint(); return true; } } catch {}
  return false;
}
// The request can be decided in the app (or expire) while this card is open: re-check when the person comes back to it. No polling.
async function refresh() {
  try { const r = await fetch(`${base}/data`, { credentials: "omit", cache: "no-store" }); const d = r.ok ? await r.json() : null; const s = d?.approval?.status;
    if (d?.kind === "approval" && st.ap && AP_STATUS.has(s) && s !== "pending" && st.ap.status === "pending" && !st.ap.busy) { st.d = d; st.ap.status = s; st.ap.confirm = false; st.note = ""; paint(); return true; } } catch {}
  return false;
}
async function refreshCard() {
  if (st.note === "sending" || st.reply !== undefined) return;
  try { const r = await fetch(`${base}/data`, { credentials: "omit", cache: "no-store" }); const d = r.ok ? await r.json() : null;
    if (d?.answered && st.d && (!d.kind || d.kind === "card")) { st.d = d; st.reply = d.picked ?? ""; st.note = ""; paint(); }
  } catch {}
}
async function refreshInterview() {
  try { const r = await fetch(`${base}/data`, { credentials: "omit", cache: "no-store" }); const d = r.ok ? await r.json() : null;
    if (d?.kind === "interview" && d.interview) { st.d = d; paint(); }
  } catch {}
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && st.d?.kind === "interview") void refreshInterview(); if (document.visibilityState === "visible" && (!st.d?.kind || st.d.kind === "card")) void refreshCard(); if (document.visibilityState === "visible" && st.d?.kind === "approval" && st.ap?.status === "pending") refresh(); if (document.visibilityState === "visible" && st.d?.kind === "plan" && st.d.plan?.status === "pending") refreshPlan(); });
// A card's "Share my location" (Button action share_location): one rough fix (2 decimals, about 1 km) or null.
function shareFix(): Promise<{ lat: number; lng: number } | null> {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((done) => navigator.geolocation.getCurrentPosition((p) => done({ lat: Math.round(p.coords.latitude * 100) / 100, lng: Math.round(p.coords.longitude * 100) / 100 }), () => done(null), { enableHighAccuracy: false, timeout: 20000, maximumAge: 10 * 60e3 }));
}
wireCards({
  onChange: () => paint(),
  onSend: async (_ref, text, meta) => {
    if (st.note === "sending" || st.reply !== undefined) return;
    // "Share my location": the browser's location first (asked inside this tap), rounded to about 1 km, sent with the tap.
    const want = meta?.action === "share_location", locP = want ? shareFix() : null;
    st.reply = text; st.note = "sending"; paint();
    const loc = locP ? await locP : null;
    if (want && !loc) { st.reply = undefined; st.note = "noloc"; paint(); return; }
    try {
      const attempt = st.attempt?.text === text ? st.attempt : (st.attempt = { text, response_id: st.d?.input_reply?.response_id || responseId() });
      const r = await fetch(`${base}/act`, { method: "POST", credentials: "omit", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, ...(loc ? { loc } : {}), ...(st.d?.input_reply ? { input_reply: st.d.input_reply } : {}), response_id: attempt.response_id, ...(meta?.action ? { action: meta.action } : {}) }) });
      const receipt = await r.json().catch(() => ({}));
      if (receipt.closed_reason || receipt.answered) { Object.assign(st.d!, receipt, { answered: true }); st.reply = receipt.picked ?? ""; st.note = ""; }
      else { if (!r.ok) throw new Error(String(r.status)); st.note = "sent"; }
    } catch { st.reply = undefined; st.note = "error"; }
    paint();
  },
});
load();
