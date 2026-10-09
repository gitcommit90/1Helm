// Plan cards (propose_plan): the helper split one message into delegated work and asks once. One card, a checkbox per item
// (all ticked), then Approve (the ticked items) · Deny · Let's talk. Made by the SYSTEM (stream event `plan`, sessionDetail.plans,
// or GET /c/<token>/data kind:"plan"), never written by the model, so it never goes through the OpenUI parser.
// After a choice the card locks and shows the outcome ("Started 2 tasks · scheduled 1 · created Website") with each started task
// one tap away. A task started from a plan opens with briefHtml: "Started by <helper> from your message: …" and the brief.
// Markup is shared by the app (v3.ts, wired by planInit) and the card page inside Messages (card.ts). CSS: plan-card.css.

export type PlanItem = { i: number; kind: "task" | "followup" | "project"; title: string; line: string; brief?: string; when_ms?: number; project_name?: string; project_purpose?: string;
  result?: { status: "started" | "scheduled" | "skipped" | "failed"; slug?: string; session?: string | null; name?: string; error?: string; existing?: boolean } };
export type PlanLink = { kind: string; label: string; slug: string; session?: string | null; task?: string; when?: string };
/** "Questions first" (10-06): what the plan needs to know before the work starts; answered on the card, sent with Approve. */
export type PlanQuestion = { i: number; q: string; options?: string[]; items?: number[] };
export type Plan = { id: number; session: string; card?: string | null; status: "pending" | "approved" | "denied" | "replaced"; note?: string; excerpt?: string; items: PlanItem[];
  questions?: PlanQuestion[]; answers?: { i: number; a: string }[] | null;
  picked?: number[] | null; outcome?: { line: string; links: PlanLink[]; errors?: { title: string; error: string }[] } | null };
export type PlanAct = "approve" | "deny" | "talk";
export type PlanView = { picks: Set<number>; answers?: Map<number, string>; busy?: PlanAct | ""; error?: string; fresh?: boolean };
export type PlanOpts = {
  helper: string;
  /** Attributes for each control (wiring is the host's). */
  act: (k: PlanAct) => string;
  pick: (i: number) => string;
  /** A question's answer chip (question index, option text) and its "type an answer" box. Left out: questions show read-only. */
  ans?: (q: number, option: string) => string;
  ansInput?: (q: number) => string;
  /** Where a started item opens (href), or "" for no link (the card page inside Messages). */
  href?: (it: PlanItem) => string;
  /** Extra attributes on a started item's link. */
  linkAttr?: (it: PlanItem) => string;
  id?: string; attrs?: string;
  /** Extra controls after an approved plan's outcome (the app: "Stop these tasks" while they work). */
  extra?: string;
};
export type Origin = { kind: "task" | "followup"; title?: string; brief?: string; helper?: string; excerpt?: string; from_channel?: string; from_name?: string; from_session?: string | null; when?: string;
  answers?: { q: string; a?: string; open?: boolean; options?: string[] }[] };

const esc = (s: any = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const svg = (d: string, s = 17) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const LIST = svg('<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2"/>');
const TICK = svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 14);
const CLOCK = svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 14);
const FOLDER = svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', 14);
const CHEV = svg('<path d="m9 6 6 6-6 6"/>', 15);
const SPLIT = svg('<path d="M6 3v6a4 4 0 0 0 4 4h4a4 4 0 0 1 4 4v4"/><path d="m15 18 3 3 3-3"/><path d="M6 21V9"/>');
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

const ASK = svg('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.2a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.6"/><path d="M12 17h.01"/>', 14);
/** The answers to send with Approve: [{ i, a }] for each question answered (chip or typed). */
export const planAnswers = (p: Plan, v: PlanView) => (p.questions || []).map((q) => ({ i: q.i, a: String(v.answers?.get(q.i) || "").trim() })).filter((x) => x.a);
function questionsHtml(p: Plan, v: PlanView, o: PlanOpts) {
  const qs = p.questions || []; if (!qs.length) return "";
  const pending = p.status === "pending", dis = v.busy ? " disabled" : "";
  const sent = new Map((p.answers || []).map((x) => [x.i, x.a]));
  const one = (q: PlanQuestion) => {
    const head = `<div class="pl-q-t">${ASK}<b>${esc(q.q)}</b></div>`;
    if (!pending) {
      const a = sent.get(q.i);
      return `<li class="pl-q">${head}<p class="pl-q-a${a ? "" : " open"}">${a ? esc(a) : p.status === "approved" ? "Asked in the task" : "Not answered"}</p></li>`;
    }
    const cur = v.answers?.get(q.i) || "", opts = q.options || [], picked = opts.includes(cur);
    const chips = opts.length ? `<div class="gu-chips pl-q-c" role="radiogroup" aria-label="${esc(q.q)}">${opts.map((x) => `<button type="button" role="radio" aria-checked="${cur === x}" class="gu-chip${cur === x ? " on" : ""}"${o.ans ? ` ${o.ans(q.i, x)}` : ""}${dis}>${esc(x)}</button>`).join("")}</div>` : "";
    const box = o.ansInput ? `<input class="pl-q-in" type="text" enterkeyhint="done" maxlength="300" placeholder="${opts.length ? "Or type your answer" : "Your answer"}" aria-label="${esc(q.q)}" value="${picked ? "" : esc(cur)}" ${o.ansInput(q.i)}${dis}>` : "";
    return `<li class="pl-q">${head}${chips}${box}</li>`;
  };
  const left = pending ? qs.filter((q) => !String(v.answers?.get(q.i) || "").trim()).length : 0;
  return `<div class="pl-sec pl-qs"><div class="pl-h">${pending ? "Questions first" : "Your answers"}</div><ul class="pl-list">${qs.map(one).join("")}</ul>${pending && left ? `<p class="pl-q-note">${left === qs.length ? "Answer here, or approve and each task will ask you first." : "Anything you skip, the task will ask you first."}</p>` : ""}</div>`;
}

/** The items the person can tick: everything on a pending card (all ticked by default). */
export const allPicks = (p: Plan) => new Set(p.items.map((x) => x.i));

function itemHtml(p: Plan, it: PlanItem, v: PlanView, o: PlanOpts) {
  const pending = p.status === "pending", on = pending ? v.picks.has(it.i) : (p.picked ? p.picked.includes(it.i) : it.result ? it.result.status !== "skipped" : p.status !== "denied");
  const title = it.kind === "project" ? it.project_name || it.title : it.title;
  const icon = it.kind === "followup" ? CLOCK : it.kind === "project" ? FOLDER : "";
  const line = `<span class="pl-l">${icon}${esc(it.line)}</span>`;
  if (pending) {
    const dis = v.busy ? " disabled" : "";
    return `<li><button type="button" role="checkbox" aria-checked="${on}" class="pl-item${on ? " on" : ""}" ${o.pick(it.i)}${dis}><span class="pl-box">${TICK}</span><span class="pl-t"><b>${esc(title)}</b>${line}</span></button></li>`;
  }
  const r = it.result, st = r?.status || (on ? "" : "skipped");
  const tag = st === "failed" ? `<em class="pl-tag bad" title="${esc(r?.error || "")}">Couldn't start</em>` : st === "skipped" || (!on && p.status !== "approved") ? `<em class="pl-tag">Not started</em>`
    : st === "scheduled" ? `<em class="pl-tag ok">Scheduled</em>` : st === "started" ? `<em class="pl-tag ok">${it.kind === "project" && !r?.existing ? "Created" : "Started"}</em>` : "";
  const href = (st === "started" || st === "scheduled") && o.href ? o.href(it) : "";
  const inner = `<span class="pl-box">${on && st !== "failed" && st !== "skipped" && p.status === "approved" ? TICK : ""}</span><span class="pl-t"><b>${esc(title)}</b>${line}</span>${tag}${href ? `<span class="pl-go">${CHEV}</span>` : ""}`;
  const cls = `pl-item${st === "started" || st === "scheduled" ? " done" : ""}${st === "skipped" || st === "failed" || p.status !== "approved" ? " off" : ""}`;
  return `<li>${href ? `<a class="${cls}" href="${esc(href)}"${o.linkAttr ? ` ${o.linkAttr(it)}` : ""}>${inner}</a>` : `<div class="${cls}">${inner}</div>`}</li>`;
}

export function planHtml(p: Plan, v: PlanView, o: PlanOpts) {
  const st = p.status, pending = st === "pending", busy = v.busy || "", n = pending ? p.items.filter((x) => v.picks.has(x.i)).length : 0;
  const tasks = p.items.filter((x) => x.kind !== "project"), proj = p.items.filter((x) => x.kind === "project");
  const sec = (h: string, xs: PlanItem[]) => xs.length ? `<div class="pl-sec"><div class="pl-h">${esc(h)}</div><ul class="pl-list">${xs.map((x) => itemHtml(p, x, v, o)).join("")}</ul></div>` : "";
  const title = pending ? "Start these for you?" : st === "approved" ? "Plan approved" : st === "denied" ? "Plan not started" : "Earlier plan";
  const note = String(p.note || "").trim(), lead = note ? esc(/[.!?…:]$/.test(note) ? note : `${note}.`) + (pending ? " " : "") : "";
  const sub = pending ? `${lead}${esc(o.helper)} will start each one as its own task${proj.length ? " and set up the new project" : ""}. Nothing starts until you approve.` : lead;
  const btn = (k: PlanAct, cls: string, label: string, off = false) => `<button type="button" class="gu-b ${cls}${busy === k ? " busy" : ""}" ${o.act(k)}${busy || off ? " disabled" : ""}>${busy === k ? `<i class="gu-bspin" aria-hidden="true"></i>` : ""}${label}</button>`;
  let foot = "";
  if (pending) foot = `<div class="gu-btns">${btn("approve", "primary", n && n < p.items.length ? `Approve ${n}` : "Approve", !n)}${btn("deny", "secondary", "Deny")}${btn("talk", "secondary", "Let's talk")}</div>`;
  else if (st === "approved") foot = `<div class="gu-pdone" role="status"><span class="gu-b picked">✓ ${esc(p.outcome?.line || "Started")}</span>${o.extra || ""}</div>`;
  else if (st === "denied") foot = `<div class="gu-pdone" role="status"><span class="gu-b nope">Not started</span><span>${esc(o.helper)} will carry on</span></div>`;
  else foot = `<div class="gu-pgone">${LIST}<span>Replaced by a newer plan.</span></div>`;
  const err = v.error && pending ? `<p class="gu-perr" role="alert">${esc(v.error)}</p>` : "";
  return `<div class="gu-sys gu-plan${pending ? "" : " locked"}${v.fresh ? " gu-in" : ""}"${o.id ? ` id="${esc(o.id)}"` : ""}${o.attrs || ""} data-plst="${esc(st)}">
    <div class="gu-sh"><span class="gu-si">${LIST}</span><b>${title}</b></div>${sub ? `<p class="gu-sl">${sub}</p>` : ""}
    ${questionsHtml(p, v, o)}${sec("Tasks", tasks)}${sec("New project", proj)}${err}${foot}</div>`;
}
/** "Started 2 tasks …" for a toast, from a decided plan. */
export const planOutcome = (p: Plan) => p.status === "approved" ? p.outcome?.line || "Started" : p.status === "denied" ? "Not started" : "";
export const planCount = (p: Plan) => plural(p.items.length, "item");

/** The top of a task a plan started: where it came from, and the brief it was given (or when it's scheduled for). */
export function briefHtml(o: Origin, helper: string, brief: string, opts: { from?: string } = {}) {
  const ex = String(o.excerpt || "").trim();
  return `<div class="gu-sys pl-brief">
    <div class="gu-sh"><span class="gu-si">${SPLIT}</span><b>Started by ${esc(helper)} from your message${ex ? ":" : ""}</b></div>
    ${ex ? `<blockquote class="pl-quote" title="${esc(ex)}">“${esc(ex)}”</blockquote>` : ""}
    <div class="pl-bb"><span class="pl-bl">${o.kind === "followup" ? `${CLOCK}Scheduled${o.when ? ` for ${esc(o.when)}` : ""}` : "Brief"}</span><p>${esc(brief || o.brief || "")}</p></div>
    ${(o.answers || []).filter((x) => x.a).length ? `<div class="pl-bb"><span class="pl-bl">${ASK}Your answers</span>${(o.answers || []).filter((x) => x.a).map((x) => `<p><b>${esc(x.q)}</b> ${esc(x.a)}</p>`).join("")}</div>` : ""}
    ${opts.from ? `<p class="pl-from">${opts.from}</p>` : ""}</div>`;
}
