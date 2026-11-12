// Plan cards in the live app (v3.ts): state, server actions and the brief at the top of a task a plan started.
// The plan itself (Plan) comes from the server (stream event `plan`, sessionDetail.plans); per-card view state (ticks, busy,
// error) lives here, keyed by channel + plan id, so every repaint (and every copy) shows the same thing.
//   Approve → POST /res/<ch>/plans/<id>/approve {items: [ticked indexes], answers: [{i, a}]} · Deny → …/deny · Let's talk → a normal message.
//   "Questions first": a chip picks an answer (tap again to clear), the box types one; both live in the view state until Approve.
import { planHtml, briefHtml, allPicks, planAnswers, type Plan, type PlanView, type PlanItem, type Origin, type PlanAct } from "./plan-card";

type Deps = {
  api: (path: string, body?: any) => Promise<any>;
  helper: (slug: string) => string;          // the channel's helper name
  chName: (slug: string) => string;          // "General", "Website", …
  hasChannel: (slug: string) => boolean;
  repaint: () => void;
  send: (slug: string, sid: string, text: string) => void;   // a normal message from the person in that task
  addSessions: (list: any[]) => void;        // tasks the server just created ({slug, session} / a new channel)
  working?: (slug: string, sid: string) => boolean;                       // Stop (stop.ts): is that started task working now
  stopMany?: (list: { slug: string; sid: string }[]) => Promise<any>;     // …and stop them
};
let D: Deps | null = null;
const PL = new Map<string, Plan>(), ST = new Map<string, PlanView>();
const key = (slug: string, id: number | string) => `${slug}|${id}`;
const esc = (s: any = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export const LETS_TALK = "Let's talk about the plan";

export function planSet(slug: string, p: Plan, fresh = false) {
  const k = key(slug, p.id); PL.set(k, p);
  const v = ST.get(k);
  if (!v) ST.set(k, { picks: p.status === "pending" ? allPicks(p) : new Set(p.picked || []), answers: new Map(), fresh });
  else if (p.status !== "pending") { v.busy = ""; v.error = ""; }
}
export const planOf = (slug: string, id: number | string) => PL.get(key(slug, id));
type Card = { t: "plan"; id: number; slug: string };
/** sessionDetail.plans → each plan's card on the reply of the turn that proposed it (else the last reply). */
export function planAttach(slug: string, msgs: any[], plans: Plan[] = []) {
  for (const p of plans) {
    planSet(slug, p);
    const m = [...msgs].reverse().find((x) => x.role === "agent" && p.card && x.card === p.card) || [...msgs].reverse().find((x) => x.role === "agent");
    if (m && !(m.cards ||= []).some((c: any) => c.t === "plan" && c.id === p.id)) m.cards.push({ t: "plan", id: p.id, slug } as Card);
  }
}
/** {t:"plan", plan} on a stream: a new plan joins this reply; an update (replaced, decided) repaints wherever it is. */
export function planEvent(slug: string, reply: any, p: Plan) {
  planSet(slug, p, p.status === "pending");
  if (p.status === "pending" && !(reply.cards ||= []).some((c: any) => c.t === "plan" && c.id === p.id)) reply.cards.push({ t: "plan", id: p.id, slug } as Card);
}
// "Stop these tasks" on an approved plan, while any task it started is still working (the brain-dump case).
const STOPPING = new Set<string>();
const workingOf = (p: Plan) => !D?.working ? [] : p.items.filter((x) => x.result?.status === "started" && x.result.slug && x.result.session && D!.working!(x.result.slug, String(x.result.session))).map((x) => ({ slug: x.result!.slug!, sid: String(x.result!.session) }));
function stopExtra(slug: string, p: Plan) {
  if (p.status !== "approved" || !D?.stopMany) return "";
  const k = key(slug, p.id), n = workingOf(p).length;
  if (STOPPING.has(k)) return `<button type="button" class="gu-b secondary pl-stop" disabled><i class="gu-bspin" aria-hidden="true"></i>Stopping…</button>`;
  return n ? `<button type="button" class="gu-b secondary pl-stop" data-plstop="${esc(k)}">Stop ${n === 1 ? "this task" : "these tasks"}</button>` : "";
}
export function planCardHtml(c: Card) {
  const p = PL.get(key(c.slug, c.id)); if (!p || !D) return "";
  const v = ST.get(key(c.slug, c.id))!, k = `${esc(c.slug)}|${c.id}`;
  const out = planHtml(p, v, { helper: D.helper(c.slug), id: `pl${esc(c.slug)}-${c.id}`,
    act: (a: PlanAct) => `data-plact="${k}|${a}"`, pick: (i) => `data-plpick="${k}|${i}"`,
    ans: (q, opt) => `data-plans="${k}|${q}" data-plopt="${esc(opt)}"`, ansInput: (q) => `data-plqin="${k}|${q}"`,
    href: (it: PlanItem) => it.result?.slug ? `#/${it.result.slug}${it.result.session ? `/s/${it.result.session}` : ""}` : "",
    linkAttr: (it: PlanItem) => `data-pllink="${esc(it.result?.slug || "")}"`, extra: stopExtra(c.slug, p) });
  v.fresh = false;   // the arrival animation plays once
  return out;
}
/** A task a plan started: its first message (via "plan") becomes the brief block; a scheduled one (no message yet) gets it too. */
export function planBriefs(msgs: any[], origin: Origin | null) {
  if (!origin) return;
  const first = msgs.find((m) => m.role === "user" && m.via === "plan");
  if (first) first.brief = origin;
  else msgs.unshift({ id: -1 - msgs.length, role: "user", body: origin.brief || "", at: (origin as any).at || Date.now(), steps: [], brief: origin, via: "plan" });
}
export function briefMsgHtml(m: any, slug: string) {
  if (!D) return "";
  const o: Origin = m.brief, from = o.from_channel || slug;
  const back = o.from_session ? `<a href="#/${esc(from)}/s/${esc(o.from_session)}" data-pllink="${esc(from)}">See your message${from !== slug ? ` in ${esc(o.from_name || D.chName(from))}` : ""}</a>` : "";
  return `<div class="m brief first">${briefHtml(o, D.helper(from) || o.helper || "your helper", m.body, { from: back })}</div>`;
}

async function act(slug: string, id: number, a: PlanAct) {
  const p = PL.get(key(slug, id)), v = ST.get(key(slug, id)); if (!p || !v || !D || v.busy || p.status !== "pending") return;
  if (a === "talk") { D.send(slug, p.session, LETS_TALK); return; }
  const picks = p.items.filter((x) => v.picks.has(x.i)).map((x) => x.i);
  if (a === "approve" && !picks.length) return;
  v.busy = a; v.error = ""; D.repaint();
  const r = await D.api(`/res/${slug}/plans/${id}/${a}`, a === "approve" ? { items: picks, ...(planAnswers(p, v).length ? { answers: planAnswers(p, v) } : {}) } : {}).catch((e: any) => ({ error: e.message }));
  v.busy = "";
  if (r?.plan) planSet(slug, r.plan);
  if (r?.ok && Array.isArray(r.sessions)) D.addSessions(r.sessions);
  else if (r?.error && !(r.plan && r.plan.status !== "pending")) v.error = `Couldn't ${a === "approve" ? "start that" : "send that"} (${r.error}). Try again.`;
  D.repaint();
}
export function planInit(d: Deps) {
  D = d;
  document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const pk = t.closest<HTMLElement>("[data-plpick]");
    if (pk) { e.preventDefault(); const [slug, id, i] = pk.dataset.plpick!.split("|"); const v = ST.get(key(slug, id)), p = PL.get(key(slug, id)); if (!v || !p || v.busy || p.status !== "pending") return;
      const n = Number(i); if (v.picks.has(n)) v.picks.delete(n); else v.picks.add(n); v.error = ""; d.repaint(); if (!e.detail) document.querySelector<HTMLElement>(`[data-plpick="${CSS.escape(pk.dataset.plpick!)}"]`)?.focus(); return; }
    const qa = t.closest<HTMLElement>("[data-plans]");
    if (qa) { e.preventDefault(); const [slug, id, qi] = qa.dataset.plans!.split("|"); const v = ST.get(key(slug, id)), p = PL.get(key(slug, id)); if (!v || !p || v.busy || p.status !== "pending") return;
      const opt = qa.dataset.plopt || "", n = Number(qi); (v.answers ||= new Map()); if (v.answers.get(n) === opt) v.answers.delete(n); else v.answers.set(n, opt); d.repaint(); return; }
    const ps = t.closest<HTMLElement>("[data-plstop]");
    if (ps) { e.preventDefault(); e.stopImmediatePropagation(); const k = ps.dataset.plstop!, [slug, id] = k.split("|"), p = PL.get(key(slug, id)); if (!p || STOPPING.has(k) || !d.stopMany) return;
      STOPPING.add(k); d.repaint(); d.stopMany(workingOf(p)).finally(() => { STOPPING.delete(k); d.repaint(); }); return; }
    const b = t.closest<HTMLElement>("[data-plact]");
    if (b) { e.preventDefault(); const [slug, id, a] = b.dataset.plact!.split("|"); act(slug, Number(id), a as PlanAct); return; }
    // A started item in a project the app hasn't loaded yet (just created): open it after a reload.
    const l = t.closest<HTMLAnchorElement>("a[data-pllink]");
    if (l && l.dataset.pllink && !d.hasChannel(l.dataset.pllink)) { e.preventDefault(); location.hash = l.getAttribute("href")!.slice(1); location.reload(); }
  }, true);
  // A typed answer: kept in the view state as they type (no repaint, so the box keeps focus); it replaces a picked chip.
  document.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement; if (!t?.dataset?.plqin) return;
    const [slug, id, qi] = t.dataset.plqin.split("|"), v = ST.get(key(slug, id)); if (!v) return;
    (v.answers ||= new Map()); const n = Number(qi), val = t.value;
    if (val.trim()) v.answers.set(n, val); else v.answers.delete(n);
    t.closest(".pl-q")?.querySelectorAll<HTMLElement>(".gu-chip.on").forEach((c) => { c.classList.remove("on"); c.setAttribute("aria-checked", "false"); });
  }, true);
}
