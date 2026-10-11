// "Get to know you": the optional interview task in General (server: proto src/interview.js, GET/POST /api/interview).
// Opening the task shows one easy question at a time inside the task view, in the cards-in-chat look (genui-cards.css:
// gu-opt rows for pick-one, gu-chip for pick-several, gu-field for a short optional answer, gu-b buttons), with "3 of 15".
// Skip a question, skip the rest, leave and come back (the server keeps the step). At the end: what was added to the Notebook,
// by section, a button to open it, and a gentle "tick it off when you're happy" (the app never ticks it: the person does).
// No model call anywhere: the questions and the sentences they become are fixed on the server.
// v3.ts only hooks in: ivSet (boot), ivIs (is this task the interview?), ivView (the task body) and the deps below.
import { ask } from "./dialog";
import { apkRegister, apkHtml, apkReset, type AppOpt } from "./ee/apps-pick";

type Opt = { v: string; label: string };
type Q = { id: string; sec: string; secName: string; ask: string; sub: string; kind: "one" | "many"; none: string; opts: Opt[]; text: { label: string; placeholder: string; show: string; max?: number } | null; def: string;
  look?: "apps"; apps?: AppOpt[]; defPicks?: string[] };   // look "apps": "Do you use any of these apps?" (apps-pick.ts); defPicks: the account's saved list
type Row = { id: string; sec: string; text: string };
type Ans = { pick?: string; picks?: string[]; text?: string; rows?: Row[]; skipped?: boolean };
type St = { status: string; session?: string; step: number; total: number; finished?: boolean; known?: any; questions: Q[]; answers: Record<string, Ans>; secNames: Record<string, string>; error?: string };
type Deps = {
  api: (path: string, body?: any) => Promise<any>;
  helper: () => string;                       // General's helper name
  avatar: () => string;                       // its avatar <img>
  phone: () => boolean;
  notebook: () => void;                       // rows were written: the Notebook re-reads them next time it opens
  removed: (sid: string) => void;             // the person removed the task
  home: () => void;                           // "Not now"
  done: () => boolean;                        // the person has ticked the task
};
let D: Deps | null = null;
const IV = { boot: null as null | { session: string; step: number; total: number }, st: null as St | null, loading: false, err: "", started: false,
  draft: {} as Record<string, Ans>, pending: 0, queue: Promise.resolve() as Promise<any>, dir: 1, shown: "" };
const SEC_ORDER = ["about", "how", "people", "places", "now"];
const esc = (s: any) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const svg = (d: string, s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const CHECK = '<path d="M20 6 9 17l-5-5"/>', BACK = '<path d="M15 18l-6-6 6-6"/>', BOOK = '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z"/><path d="M8 7h8M8 11h6"/>';

export function ivInit(d: Deps) { D = d; }
export function ivSet(b: any) { IV.boot = b && b.session ? { session: String(b.session), step: Number(b.step) || 0, total: Number(b.total) || 0 } : null; }
export const ivIs = (slug: string, sid: any) => slug === "main" && !!IV.boot && IV.boot.session === String(sid);
export const ivSession = () => IV.boot?.session || "";

// ---- Loading and saving ----
function load() {
  if (!D || IV.loading) return; IV.loading = true; IV.err = "";
  D.api(`/interview?tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || "")}`).then((s: St) => {
    IV.loading = false; if (s?.status !== "open") { IV.err = s?.status === "removed" ? "removed" : "Couldn't load this right now."; paint(); return; }
    IV.st = s; IV.started = s.step > 0 || Object.keys(s.answers || {}).length > 0; paint();
  }).catch(() => { IV.loading = false; IV.err = "Couldn't load this right now."; paint(); });
}
// Posts go one at a time, in order. The screen moves on right away; the server's answer replaces the state once nothing else is waiting.
function send(body: any, onFail: () => void) {
  if (!D || !IV.st) return; IV.pending++;
  IV.queue = IV.queue.then(() => D!.api("/interview", body)).then((s: St) => {
    IV.pending--;
    if (!s || s.error || s.status !== "open") { if (s?.status === "removed") { IV.err = "removed"; paint(); return; } throw new Error(s?.error || "save failed"); }
    if (body.op === "answer" && D) D.notebook();
    if (!IV.pending) { const keep = IV.st?.step; IV.st = s; if (keep !== undefined && keep !== s.step) IV.st.step = keep; paintIf(); }
    else if (IV.st) IV.st.answers = s.answers;
  }).catch(() => { IV.pending = Math.max(0, IV.pending - 1); onFail(); IV.err = "save"; paint(); setTimeout(() => { if (IV.err === "save") { IV.err = ""; paint(); } }, 4000); });
}
function paintIf() { const el = document.getElementById("iv"); if (el && IV.shown !== sig()) paint(); else if (el) { /* same screen: refresh the summary rows quietly */ const sm = el.querySelector(".iv-sum"); if (sm && IV.st && IV.st.step >= IV.st.total) paint(); } }
// The slide-in plays when the screen changes, never on a re-render of the same screen.
let ANIM = true;
const anim = () => ANIM ? (IV.dir > 0 ? "iv-in" : "iv-back") : "";
const sig = () => IV.st ? `${IV.st.step}|${IV.started}` : "";

// ---- What an answer is right now: the draft, else what they said before, else the suggested start ----
function cur(q: Q): Ans {
  const d = IV.draft[q.id] || {}, a = IV.st?.answers[q.id] || {};
  return { pick: d.pick ?? a.pick ?? (q.def || undefined), picks: d.picks ?? a.picks ?? q.defPicks ?? [], text: d.text ?? a.text ?? "" };
}
const hasAnswer = (q: Q, a: Ans) => q.kind === "one" ? !!a.pick || !!(a.text || "").trim() && showText(q, a) : (a.picks || []).length > 0 || !!(a.text || "").trim();
const showText = (q: Q, a: Ans) => !!q.text && (q.text.show === "always" || q.text.show === a.pick);
// Selecting or typing only edits the draft. Next/Finish is always an explicit action.

function go(step: number, dir = 1) { if (!IV.st) return; IV.dir = dir; IV.st.step = Math.max(0, Math.min(step, IV.st.total)); paint(); }
function answer(q: Q) {
  const st = IV.st!, i = st.questions.indexOf(q), a = cur(q);
  if (!hasAnswer(q, a)) return skip(q);
  const body: any = { op: "answer", q: q.id }; if (q.kind === "one" && a.pick) body.pick = a.pick; if (q.kind === "many") body.picks = a.picks; if (showText(q, a) && a.text) body.text = a.text;
  // Show it as answered at once (the summary's rows come back from the server).
  st.answers[q.id] = { ...st.answers[q.id], pick: body.pick, picks: body.picks, text: body.text, skipped: false };
  delete IV.draft[q.id]; const back = st.step; go(i + 1); send(body, () => go(back, -1));
}
function skip(q: Q) { const st = IV.st!, i = st.questions.indexOf(q), back = st.step; delete IV.draft[q.id]; go(i + 1); send({ op: "skip", q: q.id }, () => go(back, -1)); }

// ---- Screens ----
function progress(st: St, q?: Q) {
  const n = Math.min(st.step + 1, st.total), pct = Math.round((Math.min(st.step, st.total) / st.total) * 100);
  return `<div class="iv-top"><div class="iv-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${st.total}" aria-valuenow="${st.step}" aria-label="Question ${n} of ${st.total}"><i style="width:${pct}%"></i></div>
    <div class="iv-meta"><b>${n} of ${st.total}</b>${q ? `<span class="iv-sec">${esc(q.secName)}</span>` : ""}</div></div>`;
}
function intro(st: St) {
  const h = esc(D!.helper());
  return `<div class="iv-card iv-intro ${anim()}">
    <div class="iv-who">${D!.avatar()}<span>${h}</span></div>
    <h2>Want ${h} to get to know you?</h2>
    <p class="iv-lead">${st.total} quick questions, about 3 minutes. Tap an answer, skip anything, stop whenever you like and pick up later.</p>
    <ul class="iv-points"><li>${svg(CHECK, 15)}<span>Everything is optional.</span></li><li>${svg(CHECK, 15)}<span>Each answer becomes a note in ${h}'s Notebook, in plain words. Change or delete any of them.</span></li><li>${svg(CHECK, 15)}<span>It stays in your 1Helm. Nothing is shared.</span></li></ul>
    <div class="gu-btns iv-act"><button type="button" class="gu-b primary" data-ivgo="start">Start</button><button type="button" class="gu-b ghost" data-ivgo="later">Not now</button></div>
    <button type="button" class="iv-link" data-ivgo="remove">Remove this task</button></div>`;
}
function question(st: St, q: Q) {
  const a = cur(q), i = st.questions.indexOf(q), txt = showText(q, a), ok = hasAnswer(q, a);
  const opts = q.look === "apps" ? appsPicker(q) : q.kind === "one"
    ? (q.opts.length ? `<div class="gu-opts iv-opts" role="radiogroup" aria-label="${esc(q.ask)}">${q.opts.map((o, k) => { const on = a.pick === o.v;
        return `<button type="button" class="gu-opt${on ? " on" : ""}" role="radio" aria-checked="${on}" data-ivpick="${esc(o.v)}"><i class="gu-rad"></i><span class="gu-ot"><b>${esc(o.label)}</b></span>${!D!.phone() && k < 9 ? `<kbd class="iv-k">${k + 1}</kbd>` : ""}</button>`; }).join("")}</div>` : "")
    : `<div class="gu-chips iv-chips" role="group" aria-label="${esc(q.ask)}">${q.opts.map(o => { const on = (a.picks || []).includes(o.v);
        return `<button type="button" class="gu-chip${on ? " on" : ""}" aria-pressed="${on}" data-ivchip="${esc(o.v)}">${on ? svg(CHECK, 14) : ""}${esc(o.label)}</button>`; }).join("")}</div>`;
  const field = txt ? textField(q, a.text || "") : "";
  return `${progress(st, q)}<div class="iv-card iv-q ${anim()}" data-ivq="${esc(q.id)}" tabindex="-1">
    <h2 id="ivask">${esc(q.ask)}</h2>${q.sub ? `<p class="iv-sub">${esc(q.sub)}</p>` : ""}
    ${opts}${field}
    <div class="iv-act">${i > 0 ? `<button type="button" class="iv-back-b" data-ivgo="back" aria-label="Back">${svg(BACK, 18)}</button>` : "<span></span>"}
      <span class="iv-grow"></span><button type="button" class="gu-b ghost" data-ivgo="skip">Skip</button>
      <button type="button" class="gu-b primary" data-ivgo="next"${ok ? "" : " disabled"}>${i === st.total - 1 ? "Finish" : "Next"}</button></div>
    </div>
    <div class="iv-foot"><span>Saved as you go. Come back anytime.</span><button type="button" class="iv-link" data-ivgo="rest">Skip the rest</button></div>`;
}
// "Do you use any of these apps?": the shared app picker (apps-pick.ts) on this question's draft; Next turns on once anything is picked.
function appsPicker(q: Q) {
  apkRegister("iv-apps", { opts: q.apps || [], none: q.none, noneLabel: q.opts.find(o => o.v === q.none)?.label,
    get: () => cur(q).picks || [], set: p => { IV.draft[q.id] = { ...IV.draft[q.id], picks: p }; },
    onChange: () => { const nx = document.querySelector<HTMLButtonElement>('#iv [data-ivgo="next"]'); if (nx) nx.disabled = !hasAnswer(q, cur(q)); } });
  return apkHtml("iv-apps", q.ask);
}
// The optional field: one line for a short answer (a name, a city), a box that grows as they type for the longer ones.
// The limit comes from the server (text.max); a quiet "N left" shows only near it.
const maxOf = (q: Q) => Math.max(20, Number(q.text?.max) || 120);
const GROW_AT = 250;   // limits this long get the growing box
function textField(q: Q, v: string) {
  const max = maxOf(q), common = `id="ivtext" data-ivtext="${esc(q.id)}" maxlength="${max}" autocomplete="off" placeholder="${esc(q.text!.placeholder)}" aria-describedby="ivleft"`;
  const box = max >= GROW_AT ? `<textarea ${common} rows="1" class="iv-ta">${esc(v)}</textarea>` : `<input ${common} value="${esc(v)}">`;
  return `<label class="gu-field iv-field"><span>${esc(q.text!.label)}</span>${box}<small class="iv-left" id="ivleft">${leftText(v.length, max)}</small></label>`;
}
// Shown from 80% of the limit (or the last 30 characters on a short field), else empty.
function leftText(n: number, max: number) { const left = max - n; return left <= Math.max(30, Math.round(max * 0.2)) ? (left > 0 ? `${left} left` : "That's the limit") : ""; }
function grow(t: HTMLTextAreaElement | null) { if (!t || t.tagName !== "TEXTAREA") return; t.style.height = "auto"; t.style.height = `${t.scrollHeight + 2}px`; }
const growField = () => grow(document.getElementById("ivtext") as HTMLTextAreaElement | null);
function summary(st: St, done: boolean) {
  const h = esc(D!.helper()), rows: Record<string, Row[]> = {};
  for (const q of st.questions) for (const r of st.answers[q.id]?.rows || []) (rows[r.sec] ||= []).push(r);
  const n = Object.values(rows).reduce((x, l) => x + l.length, 0);
  // The apps question writes no Notebook rows: its answer is the account's apps list for helper context.
  const aq = st.questions.find(q => q.look === "apps"), ap = aq ? (st.answers[aq.id]?.picks || []).filter(v => v !== aq.none) : [];
  const apNames = ap.map(v => aq!.apps?.find(o => o.v === v)?.label || v);
  const apSec = apNames.length ? `<div class="iv-ss"><h3>Apps you use</h3><p>${svg(CHECK, 14)}<span>${esc(apNames.join(", "))}. ${h} offers to connect one when it comes up. Tell your helper whenever that changes.</span></p></div>` : "";
  const secs = SEC_ORDER.filter(k => rows[k]?.length).map(k => `<div class="iv-ss"><h3>${esc(st.secNames[k] || k)}</h3>${rows[k].map(r => `<p>${svg(CHECK, 14)}<span>${esc(r.text)}</span></p>`).join("")}</div>`).join("");
  return `<div class="iv-card iv-sum ${anim()}">
    <div class="iv-who">${D!.avatar()}<span>${h}</span></div>
    <h2>${n || apNames.length ? `Thanks. ${h} knows you a little better.` : "No problem. Nothing was saved."}</h2>
    <p class="iv-lead">${n ? `${n} ${n === 1 ? "note was" : "notes were"} added to ${h}'s Notebook. ${h} uses them starting with your next task.` : apNames.length ? `${h} knows which apps you use, starting with your next task.` : `You can go through the questions whenever you like.`}</p>
    ${secs || apSec ? `<div class="iv-sums">${secs}${apSec}</div>` : ""}
    <div class="gu-btns iv-act">${n ? `<a class="gu-b primary iv-nb" href="#/main/notebook">${svg(BOOK, 16)}Open the Notebook</a>` : ""}<button type="button" class="gu-b ${n ? "secondary" : "primary"}" data-ivgo="again">${n || apNames.length ? "Change answers" : "Go through the questions"}</button></div>
    <div class="gu-tip iv-tick">${svg(done ? CHECK : '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>', 16)}<span>${done ? "Ticked off. Nice." : "When you're happy with it, tick this task off. It stays here until you do."}</span></div>
    <button type="button" class="iv-link" data-ivgo="remove">Remove this task</button></div>`;
}
function inner() {
  const done = !!D?.done();
  if (IV.err === "removed") return `<div class="iv-card ${anim()}"><h2>This task was removed.</h2><p class="iv-lead">Anything you answered is still in the Notebook.</p></div>`;
  const st = IV.st;
  if (!st) return IV.err ? `<div class="iv-card"><p class="iv-lead">${esc(IV.err)}</p><div class="gu-btns"><button type="button" class="gu-b secondary" data-ivgo="retry">Try again</button></div></div>`
    : `<div class="iv-card iv-load" aria-busy="true"><i></i><i></i><i></i></div>`;
  const err = IV.err === "save" ? `<p class="iv-err" role="alert">Couldn't save that. Check your connection and try again.</p>` : "";
  if (st.step >= st.total) return err + summary(st, done);
  if (!IV.started) return intro(st);
  return err + question(st, st.questions[st.step]);
}
/** The task body (replaces the chat and composer for this one task). */
export function ivView() {
  if (!IV.st && !IV.loading && IV.err !== "removed") queueMicrotask(load);
  keepFocus(); queueMicrotask(growField);
  ANIM = IV.shown !== sig(); IV.shown = sig();
  return `<div class="ivscroll" id="ivscroll"><div class="iv" id="iv">${inner()}</div></div>`;
}
function paint() {
  const el = document.getElementById("iv"); if (!el) return;
  ANIM = true; el.innerHTML = inner(); IV.shown = sig();
  const sc = document.getElementById("ivscroll"); if (sc) sc.scrollTop = 0; growField();
  // Keyboard users land on the question; the text field gets focus only where typing is the point (never popping a phone keyboard).
  const q = el.querySelector<HTMLElement>(".iv-q");
  if (q && !D!.phone()) { const t = el.querySelector<HTMLInputElement>("#ivtext"); const only = t && !el.querySelector("[data-ivpick],[data-ivchip]"); (only ? t : q).focus({ preventScroll: true }); }
}
// A whole-app re-render while they type keeps the field focused and the caret where it was.
function keepFocus() {
  const a = document.activeElement as HTMLInputElement | null; if (!a || (a.id !== "ivtext" && a.id !== "apq-iv-apps")) return;
  const id = a.id, s = a.selectionStart, e = a.selectionEnd; queueMicrotask(() => { const t = document.getElementById(id) as HTMLInputElement | null; if (t) { t.focus({ preventScroll: true }); try { t.setSelectionRange(s, e); } catch {} } });
}
// The person ticks or unticks the task (the header's done button, anywhere): the summary's hint follows.
document.addEventListener("click", e => { if (!(e.target as HTMLElement).closest?.("[data-done]")) return; setTimeout(() => { if (document.getElementById("iv") && IV.st && IV.st.step >= IV.st.total) paint(); }, 60); }, true);

// ---- Taps and keys ----
function qOf(el: Element | null): Q | undefined { const id = el?.closest<HTMLElement>("[data-ivq]")?.dataset.ivq; return IV.st?.questions.find(x => x.id === id); }
function repaintQ(q: Q) {
  // In-place: keep the card (no re-animation), just update choices, field and the Next button.
  const card = document.querySelector<HTMLElement>(`[data-ivq="${CSS.escape(q.id)}"]`); if (!card || !IV.st) return paint();
  const t = document.createElement("div"); t.innerHTML = question(IV.st, q); const fresh = t.querySelector<HTMLElement>(".iv-q")!;
  const had = (document.activeElement as HTMLElement | null)?.dataset;
  card.className = card.className.replace(/\biv-(in|back)\b/g, "").trim();
  card.innerHTML = fresh.innerHTML; growField();
  if (had?.ivpick) card.querySelector<HTMLElement>(`[data-ivpick="${CSS.escape(had.ivpick)}"]`)?.focus({ preventScroll: true });
  if (had?.ivchip) card.querySelector<HTMLElement>(`[data-ivchip="${CSS.escape(had.ivchip)}"]`)?.focus({ preventScroll: true });
}
document.addEventListener("click", async e => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-ivpick],[data-ivchip],[data-ivgo]"); if (!t || !t.closest("#iv") || !D) return;
  e.preventDefault(); const st = IV.st;
  if (t.dataset.ivgo === "retry") { IV.err = ""; paint(); load(); return; }
  if (!st) return;
  const q = qOf(t);
  if (t.dataset.ivpick != null && q) {
    const v = t.dataset.ivpick; IV.draft[q.id] = { ...IV.draft[q.id], pick: v };
    repaintQ(q); if (showText(q, cur(q))) (document.getElementById("ivtext") as HTMLInputElement | null)?.focus(); return;
  }
  if (t.dataset.ivchip != null && q) {
    const v = t.dataset.ivchip, s = new Set(cur(q).picks || []);
    if (s.has(v)) s.delete(v); else { s.add(v); if (q.none) { if (v === q.none) { s.clear(); s.add(v); } else s.delete(q.none); } }
    IV.draft[q.id] = { ...IV.draft[q.id], picks: [...s] }; repaintQ(q); return;
  }
  const g = t.dataset.ivgo;
  if (g === "start") { IV.started = true; IV.dir = 1; paint(); return; }
  if (g === "later") { D.home(); return; }
  if (g === "next" && q) return answer(q);
  if (g === "skip" && q) return skip(q);
  if (g === "back") { const b = st.step; go(st.step - 1, -1); send({ op: "back" }, () => go(b)); return; }
  if (g === "rest") { const b = st.step; go(st.total); send({ op: "rest" }, () => go(b, -1)); return; }
  if (g === "again") { const b = st.step; IV.draft = {}; apkReset("iv-apps"); go(0, 1); send({ op: "again" }, () => go(b)); return; }
  if (g === "remove") {
    if (!(await ask({ title: "Remove Get to know you?", body: "The task goes away and won't come back. Anything you already answered stays in the Notebook.", confirm: "Remove", danger: true }))) return;
    const sid = IV.boot?.session || ""; IV.queue = IV.queue.then(() => D!.api("/interview", { op: "remove" })).then(() => { IV.boot = null; IV.st = null; D!.removed(sid); }).catch(() => { IV.err = "save"; paint(); });
  }
});
document.addEventListener("input", e => {
  const t = e.target as HTMLInputElement; if (!t.dataset?.ivtext || !IV.st) return;
  const q = IV.st.questions.find(x => x.id === t.dataset.ivtext); if (!q) return;
  IV.draft[q.id] = { ...IV.draft[q.id], text: t.value };
  grow(t as any); const left = document.getElementById("ivleft"); if (left) left.textContent = leftText(t.value.length, maxOf(q));
  const nx = document.querySelector<HTMLButtonElement>('#iv [data-ivgo="next"]'); if (nx) nx.disabled = !hasAnswer(q, cur(q));
});
document.addEventListener("keydown", e => {
  const iv = document.getElementById("iv"); if (!iv || !IV.st || !IV.started || IV.st.step >= IV.st.total || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target as HTMLElement, q = IV.st.questions[IV.st.step];
  // Enter in an answer field must not submit it. Keyboard users can still Tab to
  // Next and activate that button normally; number shortcuts only select a choice.
  if (t.closest?.("input,textarea,[contenteditable]") || !iv.isConnected) return;
  if (/^[1-9]$/.test(e.key) && q) { const b = iv.querySelectorAll<HTMLElement>("[data-ivpick],[data-ivchip]")[+e.key - 1]; if (b) { e.preventDefault(); b.click(); } }
});
