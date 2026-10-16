// "Interview me" in chat: the interview card (server: proto src/interview-chat.js, the helper's `interview` tool).
// A SYSTEM card inline in a reply, in the Get to know you look (interview.css: iv-bar progress, iv-opts / iv-chips, iv-act,
// iv-back-b, iv-foot, iv-link, the slide-in) on the cards-in-chat surfaces (genui-cards.css: gu-sys, gu-opt, gu-chip, gu-field,
// gu-b). One question at a time: pick one / pick several / yes-no / 1–5 / their own words, with an "Other" box where the helper
// allowed it; Back, Skip, Skip the rest; a review screen ("tap one to change it"), then Send answers. Answers are saved on the
// server as they go (resume after reload or on another device). Sent: a compact "✓ Answered 7 of 9 · <title>" that expands.
// One markup for the app (v3.ts cardHtml) and the card page inside Messages (card.ts): the host passes how to save (api) and
// what happens after Send (sent). State lives here per card key, so a whole-chat re-render (morph) keeps it.
//   ops: answer {q, answer, step} · skip {q, step} · goto {step} · send → { interview[, message] } | { error }

import type { InputReply } from "./input-reply";

export type IvQ = { id: string; text: string; kind: "one" | "many" | "yesno" | "text" | "scale"; options?: string[]; allow_other?: boolean; placeholder?: string; help?: string };
export type IvAns = { pick?: string; picks?: string[]; other?: string; text?: string; scale?: number; skipped?: boolean };
export type IvView = { id: string; session?: string; turn?: string; input_reply?: InputReply; title: string; intro?: string; purpose?: string; questions: IvQ[]; answers: Record<string, IvAns>; step: number; total: number;
  status: "open" | "sent" | "closed"; closed_reason?: "answered_elsewhere" | "cancelled" | "superseded"; closed_note?: string; posted?: boolean; sent_at?: number | null; answered?: number; updated?: number; limits?: { answer?: number } };
export type IvHost = {
  key: string;                                            // unique per card on the page
  api: (body: any) => Promise<any>;                       // POST one op
  sent: (message: string, v: IvView, result?: { posted?: boolean }) => void;             // after the server posts the answers
  helper: string;                                         // the helper's name
  phone: () => boolean;
  sentNote?: string;                                      // a line under the locked card right after sending (card page)
};
type Draft = IvAns & { otherOn?: boolean };
type St = { v: IvView; step: number; draft: Record<string, Draft>; pending: number; queue: Promise<any>; err: string; fromReview: boolean; dir: number; busy: boolean;
  host: IvHost; shown: string; justSent: boolean; open: boolean };
const S = new Map<string, St>();
const SCALE = 5;
const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const svg = (d: string, s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const CHECK = '<path d="M20 6 9 17l-5-5"/>', BACK = '<path d="M15 18l-6-6 6-6"/>', CHEV = '<path d="m6 9 6 6 6-6"/>';
const ASK = '<path d="M21 12a8.5 8.5 0 0 1-12.4 7.6L3 21l1.4-5.6A8.5 8.5 0 1 1 21 12z"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.4"/><path d="M12 16.6h.01"/>';
const domId = (key: string) => `ivc-${key.replace(/[^A-Za-z0-9_-]/g, "_")}`;
const cap = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
const maxLen = (st: St) => st.v.limits?.answer || 600;

// ---- Answers ----
function cur(st: St, q: IvQ): Draft {
  const d = st.draft[q.id], a = st.v.answers[q.id];
  if (d) return d;
  if (!a || a.skipped) return {};
  return { ...a, otherOn: !!a.other };
}
const has = (a?: IvAns) => !!a && !a.skipped && (a.pick != null || (a.picks || []).length > 0 || !!a.other || !!a.text || a.scale != null);
function ok(q: IvQ, a: Draft) {
  const other = !!a.otherOn && !!(a.other || "").trim();
  if (q.kind === "one" || q.kind === "yesno") return a.pick != null || other;
  if (q.kind === "many") return (a.picks || []).length > 0 || other;
  if (q.kind === "scale") return a.scale != null;
  return !!(a.text || "").trim();
}
/** The answer in plain words (same as the server's message). */
export function ansText(q: IvQ, a?: IvAns) {
  if (!has(a)) return "";
  if (q.kind === "scale") { const l = q.options || []; return `${a!.scale} of ${SCALE}${l.length === 2 ? ` (1 = ${l[0]}, ${SCALE} = ${l[1]})` : ""}`; }
  if (q.kind === "text") return String(a!.text).split(/\n+/).map(x => x.trim()).filter(Boolean).join(" / ");
  return [...(a!.pick != null ? [a!.pick] : []), ...(a!.picks || []), ...(a!.other ? [`Other: ${a!.other}`] : [])].join("; ");
}
function payload(q: IvQ, a: Draft): IvAns {
  const other = a.otherOn && (a.other || "").trim() ? (a.other || "").trim() : undefined;
  if (q.kind === "one" || q.kind === "yesno") return a.pick != null && !(a.otherOn) ? { pick: a.pick } : { other };
  if (q.kind === "many") return { picks: a.picks || [], ...(other ? { other } : {}) };
  if (q.kind === "scale") return { scale: a.scale };
  return { text: (a.text || "").trim() };
}

// ---- Saving: one op at a time, in order. The screen moves on at once; the server's view replaces ours once nothing waits. ----
function save(st: St, body: any, onFail: () => void) {
  st.pending++;
  st.queue = st.queue.then(() => st.host.api(body)).then((r: any) => {
    st.pending--;
    if (!r || r.error) { if (r?.error === "already_sent" && r.interview) { st.v = r.interview; paint(st); return; } throw new Error(r?.error || "save failed"); }
    if (!st.pending && r.interview) { st.v = { ...r.interview }; }
    else if (r.interview) st.v.answers = r.interview.answers;
  }).catch(() => { st.pending = Math.max(0, st.pending - 1); onFail(); st.err = "save"; paint(st); setTimeout(() => { if (st.err === "save") { st.err = ""; paint(st); } }, 4000); });
}
function go(st: St, step: number, dir = 1) { st.dir = dir; st.step = Math.max(0, Math.min(step, st.v.total)); paint(st, true); }
function next(st: St, i: number) { return st.fromReview ? st.v.total : i + 1; }
function answer(st: St, q: IvQ) {
  const a = cur(st, q), i = st.v.questions.indexOf(q);
  if (!ok(q, a)) return skip(st, q);
  const p = payload(q, a), to = next(st, i), back = st.step;
  st.v.answers[q.id] = { ...p }; delete st.draft[q.id];
  if (to >= st.v.total) st.fromReview = false;
  go(st, to); save(st, { op: "answer", q: q.id, answer: p, step: to }, () => go(st, back, -1));
}
function skip(st: St, q: IvQ) {
  const i = st.v.questions.indexOf(q), to = next(st, i), back = st.step;
  st.v.answers[q.id] = { skipped: true }; delete st.draft[q.id]; if (to >= st.v.total) st.fromReview = false;
  go(st, to); save(st, { op: "skip", q: q.id, step: to }, () => go(st, back, -1));
}
async function send(st: St) {
  if (st.busy) return; st.busy = true; st.err = ""; paint(st);
  let r: any = null;
  try { await st.queue; r = await st.host.api({ op: "send", response_id: `interview:${st.v.id}` }); } catch { r = null; }
  st.busy = false;
  if (r?.interview?.status === "closed") { st.v = r.interview; st.err = ""; st.step = st.v.total; st.draft = {}; paint(st, true); return; }
  if (r?.interview && r.posted !== false && (r.message || r.posted || r.error === "already_sent")) {
    st.v = r.interview; st.step = st.v.total; st.draft = {};
    if (r.message || r.posted) { st.justSent = true; try { st.host.sent(r.message || "", st.v, r); } catch {} }
    paint(st, true); return;
  }
  if (r?.interview) st.v = r.interview;
  st.err = "send"; paint(st);
}

// ---- Screens ----
function head(st: St) {
  const v = st.v, sub = v.purpose ? cap(v.purpose) : `${v.total} questions`;
  return `<div class="gu-sh ivc-h"><span class="gu-si">${svg(ASK, 17)}</span><span class="ivc-ht"><b>${esc(v.title)}</b><span>${esc(sub)}</span></span></div>`;
}
function progress(st: St) {
  const n = st.v.total, k = Math.min(st.step + 1, n), pct = Math.round((Math.min(st.step, n) / n) * 100);
  return `<div class="iv-top ivc-top"><div class="iv-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${st.step}" aria-label="Question ${k} of ${n}"><i style="width:${pct}%"></i></div>
    <div class="iv-meta"><b>${k} of ${n}</b>${st.step === 0 && !Object.keys(st.v.answers).length ? `<span>about ${Math.max(1, Math.round(n * 0.3))} min · skip anything</span>` : ""}</div></div>`;
}
function otherField(st: St, q: IvQ, a: Draft) {
  if (!q.allow_other || !a.otherOn) return "";
  return `<label class="gu-field iv-field ivc-other"><span>Your answer</span><input data-ivcother="${esc(q.id)}" maxlength="${maxLen(st)}" autocomplete="off" enterkeyhint="next" value="${esc(a.other || "")}" placeholder="${esc(q.placeholder || "Type your answer")}"></label>`;
}
function choices(st: St, q: IvQ, a: Draft) {
  const kb = (k: number) => !st.host.phone() && k < 9 ? `<kbd class="iv-k">${k + 1}</kbd>` : "";
  if (q.kind === "one" || q.kind === "yesno") {
    const opts = (q.options || []).map((o, k) => { const on = a.pick === o && !a.otherOn;
      return `<button type="button" class="gu-opt${on ? " on" : ""}" role="radio" aria-checked="${on}" data-ivcpick="${esc(o)}"><i class="gu-rad"></i><span class="gu-ot"><b>${esc(o)}</b></span>${kb(k)}</button>`; });
    if (q.allow_other) { const on = !!a.otherOn, k = opts.length; opts.push(`<button type="button" class="gu-opt${on ? " on" : ""}" role="radio" aria-checked="${on}" data-ivcpick="" data-ivcotheron><i class="gu-rad"></i><span class="gu-ot"><b>Other…</b></span>${kb(k)}</button>`); }
    return `<div class="gu-opts iv-opts${q.kind === "yesno" && !q.allow_other ? " ivc-yn" : ""}" role="radiogroup" aria-labelledby="${domId(st.host.key)}-q">${opts.join("")}</div>${otherField(st, q, a)}`;
  }
  if (q.kind === "many") {
    const chips = (q.options || []).map(o => { const on = (a.picks || []).includes(o);
      return `<button type="button" class="gu-chip${on ? " on" : ""}" aria-pressed="${on}" data-ivcchip="${esc(o)}">${on ? svg(CHECK, 14) : ""}${esc(o)}</button>`; });
    if (q.allow_other) { const on = !!a.otherOn; chips.push(`<button type="button" class="gu-chip${on ? " on" : ""}" aria-pressed="${on}" data-ivcchip="" data-ivcotheron>${on ? svg(CHECK, 14) : ""}Other…</button>`); }
    return `<p class="ivc-hint">Pick any that fit.</p><div class="gu-chips iv-chips" role="group" aria-labelledby="${domId(st.host.key)}-q">${chips.join("")}</div>${otherField(st, q, a)}`;
  }
  if (q.kind === "scale") {
    const l = q.options || [];
    return `<div class="ivc-scale" role="radiogroup" aria-labelledby="${domId(st.host.key)}-q">${Array.from({ length: SCALE }, (_, k) => { const n = k + 1, on = a.scale === n;
      return `<button type="button" class="${on ? "on" : ""}" role="radio" aria-checked="${on}" aria-label="${n} of ${SCALE}${n === 1 && l[0] ? `, ${esc(l[0])}` : n === SCALE && l[1] ? `, ${esc(l[1])}` : ""}" data-ivcscale="${n}">${n}</button>`; }).join("")}</div>
      ${l.length === 2 ? `<div class="ivc-ends"><span>${esc(l[0])}</span><span>${esc(l[1])}</span></div>` : ""}`;
  }
  const t = a.text || "", mx = maxLen(st), near = t.length > mx * 0.8;
  return `<label class="gu-field iv-field ivc-text"><span class="ivc-sr">Your answer</span><textarea data-ivctext="${esc(q.id)}" maxlength="${mx}" rows="3" placeholder="${esc(q.placeholder || "Type your answer")}">${esc(t)}</textarea>
    <small class="ivc-count${near ? " on" : ""}" data-ivccount>${near ? `${t.length} / ${mx}` : ""}</small></label>`;
}
function question(st: St) {
  const v = st.v, q = v.questions[st.step], a = cur(st, q), i = st.step, good = ok(q, a), auto = (q.kind === "one" || q.kind === "yesno" || q.kind === "scale") && !a.otherOn;
  const label = st.fromReview ? "Done" : i === v.total - 1 ? "Review" : "Next";
  return `${progress(st)}<div class="ivc-body${anim(st)}" data-ivcq="${esc(q.id)}">
    <h3 class="ivc-q" id="${domId(st.host.key)}-q" tabindex="-1">${esc(q.text)}</h3>${q.help ? `<p class="ivc-help">${esc(q.help)}</p>` : ""}
    ${choices(st, q, a)}
    <div class="iv-act">${i > 0 ? `<button type="button" class="iv-back-b" data-ivcgo="back" aria-label="Back">${svg(BACK, 18)}</button>` : "<span></span>"}
      <span class="iv-grow"></span><button type="button" class="gu-b ghost" data-ivcgo="skip">Skip</button>
      ${auto && !good ? "" : `<button type="button" class="gu-b primary" data-ivcgo="next"${good ? "" : " disabled"}>${label}</button>`}</div></div>
    <div class="iv-foot ivc-foot"><span>Saved as you go. Come back anytime.</span>${st.fromReview ? "" : `<button type="button" class="iv-link" data-ivcgo="rest">Skip the rest</button>`}</div>`;
}
function list(st: St, edit: boolean) {
  return `<ol class="ivc-list">${st.v.questions.map((q, i) => { const t = ansText(q, st.v.answers[q.id]);
    const inner = `<span class="ivc-lq">${i + 1}. ${esc(q.text)}</span><span class="ivc-la${t ? "" : " skip"}">${t ? esc(t) : "Skipped"}</span>`;
    return `<li>${edit ? `<button type="button" data-ivcedit="${i}" aria-label="Change answer ${i + 1}">${inner}</button>` : `<div>${inner}</div>`}</li>`; }).join("")}</ol>`;
}
function review(st: St) {
  const n = st.v.questions.filter(q => has(st.v.answers[q.id])).length, h = esc(st.host.helper || "your helper");
  return `<div class="ivc-body${anim(st)}"><div class="ivc-rh"><h3 class="ivc-q" id="${domId(st.host.key)}-q" tabindex="-1">Check your answers</h3>
    <p class="ivc-help">${n} of ${st.v.total} answered. Tap one to change it, then send them to ${h}.</p></div>
    ${list(st, !st.busy)}
    ${st.err === "send" ? `<p class="iv-err" role="alert">Couldn't send that. Check your connection and try again.</p>` : ""}
    <div class="iv-act"><button type="button" class="iv-back-b" data-ivcgo="back" aria-label="Back"${st.busy ? " disabled" : ""}>${svg(BACK, 18)}</button><span class="iv-grow"></span>
      <button type="button" class="gu-b primary${st.busy ? " busy" : ""}" data-ivcgo="send"${st.busy ? " disabled" : ""}>${st.busy ? `<span class="gu-bspin"></span>Sending…` : "Send answers"}</button></div></div>`;
}
function done(st: St) {
  const n = st.v.answered ?? st.v.questions.filter(q => has(st.v.answers[q.id])).length;
  const closed = st.v.status === "closed", title = closed ? st.v.closed_reason === "answered_elsewhere" ? "Answered in chat" : "Question closed" : `Answered ${n} of ${st.v.total}`;
  return `<details class="ivc-done"${st.open ? " open" : ""}><summary><span class="ivc-ok">${svg(CHECK, 14)}</span><span class="ivc-dt"><b>${esc(title)}</b><span> · ${esc(st.v.title)}</span></span><span class="ivc-chev">${svg(CHEV, 16)}</span></summary>
    ${list(st, false)}</details>${!closed && (st.v.posted === false || st.err === "send") ? `<p class="iv-err" role="alert">Your answers are saved. They still need to be sent.</p><button type="button" class="gu-b primary" data-ivcgo="send"${st.busy ? " disabled" : ""}>${st.busy ? "Sending…" : "Retry sending"}</button>` : ""}${closed && st.v.closed_note ? `<p class="ivc-note">${esc(st.v.closed_note)}</p>` : ""}${st.justSent && st.host.sentNote ? `<p class="ivc-note">${esc(st.host.sentNote)}</p>` : ""}`;
}
let ANIM_ON = true;
const sig = (st: St) => `${st.v.status}|${st.step}`;
const anim = (st: St) => ANIM_ON ? (st.dir > 0 ? " iv-in" : " iv-back") : "";
function inner(st: St) {
  if (st.v.status !== "open") return done(st);
  const err = st.err === "save" ? `<p class="iv-err" role="alert">Couldn't save that. Check your connection and try again.</p>` : "";
  const intro = st.step === 0 && st.v.intro && !Object.keys(st.v.answers).length ? `<p class="gu-sl ivc-intro">${esc(st.v.intro)}</p>` : "";
  return `${head(st)}${intro}${err}${st.step >= st.v.total ? review(st) : question(st)}`;
}
const cls = (st: St, fresh: boolean) => `acard gu-sys ivc${st.v.status !== "open" ? " sent" : ""}${fresh ? " gu-in" : ""}`;

/** The card's HTML. Call on every render: state is kept per host.key; a newer server view is adopted when nothing is pending. */
export function ivcHtml(v: IvView, host: IvHost, fresh = false) {
  let st = S.get(host.key);
  if (!st) { st = { v: { ...v, answers: { ...(v.answers || {}) } }, step: Math.min(v.step || 0, v.total), draft: {}, pending: 0, queue: Promise.resolve(), err: "", fromReview: false, dir: 1, busy: false, host, shown: "", justSent: false, open: false }; S.set(host.key, st); }
  else {
    st.host = host;
    // Another device (or a reload's fresh copy) moved on: take the server's state when we have nothing in flight.
    if (!st.pending && !st.busy && ((v.updated || 0) > (st.v.updated || 0) || (v.status !== "open" && v.status !== st.v.status) || (v.posted === true && st.v.posted !== true))) { st.v = { ...v, answers: { ...(v.answers || {}) } }; st.step = Math.min(v.step || 0, v.total); }
  }
  ANIM_ON = st.shown !== "" && st.shown !== sig(st); st.shown = sig(st);
  return `<div class="${cls(st, fresh)}" id="${domId(host.key)}" data-ivc="${esc(host.key)}">${inner(st)}</div>`;
}
function paint(st: St, moved = false) {
  const el = document.getElementById(domId(st.host.key)); if (!el) return;
  const hadFocus = el.contains(document.activeElement);
  ANIM_ON = moved && st.shown !== sig(st); st.shown = sig(st);
  el.className = cls(st, false); el.innerHTML = inner(st);
  // Keyboard users stay in the card: the new question's heading takes focus (never on a phone: no keyboard popping up).
  if (moved && hadFocus && !st.host.phone()) {
    const only = el.querySelector<HTMLElement>("[data-ivctext]");
    (only || el.querySelector<HTMLElement>(".ivc-q") || el.querySelector<HTMLElement>("summary"))?.focus({ preventScroll: true });
  }
  if (moved) { const r = el.getBoundingClientRect(); if (r.top < 0) el.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }
}
// In place: the same question, new choices (no slide-in, focus kept on the tapped control).
function repaintQ(st: St) {
  const el = document.getElementById(domId(st.host.key)); if (!el) return;
  const body = el.querySelector<HTMLElement>(".ivc-body"); if (!body) return paint(st);
  const was = (document.activeElement as HTMLElement | null)?.dataset || {};
  ANIM_ON = false; const t = document.createElement("div"); t.innerHTML = question(st);
  const fresh = t.querySelector<HTMLElement>(".ivc-body")!; body.className = fresh.className; body.innerHTML = fresh.innerHTML;
  const sel = was.ivcpick != null ? `[data-ivcpick="${CSS.escape(was.ivcpick)}"]` : was.ivcchip != null ? `[data-ivcchip="${CSS.escape(was.ivcchip)}"]` : was.ivcscale ? `[data-ivcscale="${was.ivcscale}"]` : "";
  if (sel) el.querySelector<HTMLElement>(sel)?.focus({ preventScroll: true });
}

// ---- Taps, typing and keys (delegated: works for every card on the page) ----
const stOf = (el: Element | null) => { const k = el?.closest<HTMLElement>("[data-ivc]")?.dataset.ivc; return k ? S.get(k) : undefined; };
const qNow = (st: St) => st.step < st.v.total ? st.v.questions[st.step] : undefined;
document.addEventListener("click", e => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-ivcpick],[data-ivcchip],[data-ivcscale],[data-ivcgo],[data-ivcedit]"); if (!t) return;
  const st = stOf(t); if (!st || (st.v.status !== "open" && !(st.v.status === "sent" && t.dataset.ivcgo === "send" && (st.v.posted === false || st.err === "send")))) return;
  e.preventDefault(); const q = qNow(st);
  if (t.dataset.ivcpick != null && q) {
    if (t.hasAttribute("data-ivcotheron")) { st.draft[q.id] = { ...cur(st, q), pick: undefined, otherOn: true }; repaintQ(st); document.querySelector<HTMLInputElement>(`#${domId(st.host.key)} [data-ivcother]`)?.focus(); return; }
    st.draft[q.id] = { ...cur(st, q), pick: t.dataset.ivcpick, otherOn: false }; repaintQ(st);
    setTimeout(() => { if (qNow(st) === q && st.v.status === "open") answer(st, q); }, 170); return;   // the quickest question: one tap
  }
  if (t.dataset.ivcchip != null && q) {
    const a = cur(st, q);
    if (t.hasAttribute("data-ivcotheron")) { const on = !a.otherOn; st.draft[q.id] = { ...a, otherOn: on }; repaintQ(st); if (on) document.querySelector<HTMLInputElement>(`#${domId(st.host.key)} [data-ivcother]`)?.focus(); return; }
    const s = new Set(a.picks || []), v = t.dataset.ivcchip; if (s.has(v)) s.delete(v); else s.add(v);
    st.draft[q.id] = { ...a, picks: (q.options || []).filter(o => s.has(o)) }; repaintQ(st); return;
  }
  if (t.dataset.ivcscale && q) { st.draft[q.id] = { ...cur(st, q), scale: Number(t.dataset.ivcscale) }; repaintQ(st); setTimeout(() => { if (qNow(st) === q && st.v.status === "open") answer(st, q); }, 170); return; }
  if (t.dataset.ivcedit != null) { if (st.busy) return; st.fromReview = true; go(st, Number(t.dataset.ivcedit), -1); save(st, { op: "goto", step: st.step }, () => {}); return; }
  const g = t.dataset.ivcgo;
  if (g === "next" && q) return answer(st, q);
  if (g === "skip" && q) return skip(st, q);
  if (g === "back") { if (st.busy) return; const b = st.step; st.fromReview = false; go(st, st.step - 1, -1); save(st, { op: "goto", step: st.step }, () => go(st, b)); return; }
  if (g === "rest") { const b = st.step; go(st, st.v.total); save(st, { op: "goto", step: st.v.total }, () => go(st, b, -1)); return; }
  if (g === "send") send(st);
});
// The locked card's open/closed state survives re-renders.
document.addEventListener("toggle", e => { const d = e.target as HTMLDetailsElement; if (!d.classList?.contains("ivc-done")) return; const st = stOf(d); if (st) st.open = d.open; }, true);
document.addEventListener("input", e => {
  const t = e.target as HTMLInputElement | HTMLTextAreaElement, st = stOf(t); if (!st) return;
  const q = qNow(st); if (!q) return;
  if (t.dataset.ivcother != null) st.draft[q.id] = { ...cur(st, q), other: t.value, otherOn: true };
  else if (t.dataset.ivctext != null) {
    st.draft[q.id] = { ...cur(st, q), text: t.value };
    const c = t.parentElement?.querySelector<HTMLElement>("[data-ivccount]"), mx = maxLen(st), near = t.value.length > mx * 0.8;
    if (c) { c.textContent = near ? `${t.value.length} / ${mx}` : ""; c.classList.toggle("on", near); }
    t.style.height = "auto"; t.style.height = `${Math.min(t.scrollHeight + 2, 320)}px`;
  } else return;
  const el = document.getElementById(domId(st.host.key)), nx = el?.querySelector<HTMLButtonElement>('[data-ivcgo="next"]'), good = ok(q, cur(st, q));
  if (nx) nx.disabled = !good;   // with "Other…" picked, every question shows Next (disabled until something is typed)
});
document.addEventListener("keydown", e => {
  const t = e.target as HTMLElement, st = stOf(t); if (!st || st.v.status !== "open" || e.altKey) return;
  const q = qNow(st); if (!q) return;
  if (t.dataset?.ivcother != null && e.key === "Enter") { e.preventDefault(); answer(st, q); return; }
  if (t.dataset?.ivctext != null && e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); answer(st, q); return; }
  if (t.closest?.("input,textarea,[contenteditable]") || e.metaKey || e.ctrlKey) return;
  if (/^[1-9]$/.test(e.key)) { const el = document.getElementById(domId(st.host.key)); const b = el?.querySelectorAll<HTMLElement>("[data-ivcpick],[data-ivcchip],[data-ivcscale]")[+e.key - 1]; if (b) { e.preventDefault(); b.click(); } }
});
// A whole-chat repaint while they type (v3 morph) keeps the field's node, so focus and caret stay; its value follows the draft.
