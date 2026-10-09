// Plans (propose_plan): the helper splits one message into delegated work, the person confirms it on ONE plan card, and the
// SERVER starts everything once they approve, like a lead handing work to agents. Captain's decisions (2026-10-05):
//   1. One plan card, a checkbox per item (all ticked), then Approve (the ticked items) · Deny · Let's talk.
//   2. Any channel's helper can split work into new tasks in its own channel. Only General (slug "main") can propose a project
//      (a new channel); a project item creates the channel and starts its first task there.
//   3. On approve every approved task starts at once, in parallel, each as its own normal chat turn in its own new task.
//      Time-based items become a new task with a one-time follow-up at that time (the person's time zone). Results show up in
//      each task (unread dot); nothing is pushed to the person as a message (never proactive).
//   4. The helper offers a plan when one message clearly holds several separate asks, or one ask big enough to be a project,
//      and whenever the person asks ("split this up", "make this a project", "delegate this"). A single ordinary request: no card.
// The card is made by the SYSTEM (stream event {t:"plan", plan}, persisted, in sessionDetail.plans), never written by the model.
// Approving is the person's only: POST /api/res/<ch>/plans/<id>/approve|deny needs the signed-in owner (or the texted card's
// token); no tool can decide a plan. A plan never sends, buys or texts anything; the tasks it starts follow every normal rule.
// This module owns the two tables, the tool schema, every text the model sees, and the propose/decide/start logic. The Resident
// hooks are one-liners (constructor, tools(), localTool, sessionDetail, planDecide/planStartTask/planCardData).

import { savePlanCard, planLayout } from "./cards.js";
import { deliverCard } from "./ee/index.js";
import { createChannel } from "./channels.js";
import { planBudget, planBudgetText } from "./stop.js";
import { helperName } from "./helper-name.js";

export const PLAN_MAX_ITEMS = 8, PLAN_MAX_PROJECTS = 1, PLAN_TITLE_MAX = 80, PLAN_BRIEF_MAX = 4000, PLAN_NOTE_MAX = 400;
// Questions first (10-06): what the plan needs to know before the work starts (which email account, which dates…), on the card above the items.
export const PLAN_MAX_QUESTIONS = 4, PLAN_MAX_OPTIONS = 10, PLAN_Q_MAX = 200, PLAN_OPTION_MAX = 80, PLAN_ANSWER_MAX = 300;
export const PLAN_GENERAL = "main";
const KINDS = ["task", "followup", "project"];

export const PLANS_DDL = [
  // items: JSON [{ i, kind, title, brief, when?, when_ms?, project_name?, project_purpose?, result? }]; outcome: JSON { line, links, errors }.
  "CREATE TABLE IF NOT EXISTS plans (id INTEGER PRIMARY KEY AUTOINCREMENT, session TEXT NOT NULL, card TEXT, items TEXT NOT NULL, note TEXT, excerpt TEXT, status TEXT NOT NULL DEFAULT 'pending', outcome TEXT, picked TEXT, created INTEGER NOT NULL, decided INTEGER, replaced_by INTEGER, via_text INTEGER NOT NULL DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS plans_session ON plans(session, id)",
  // Where a task started from a plan came from (shown at the top of the task): one row per task, in the task's own channel.
  "CREATE TABLE IF NOT EXISTS plan_origin (session TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT, brief TEXT, when_ms INTEGER, helper TEXT, excerpt TEXT, from_channel TEXT, from_name TEXT, from_session TEXT, plan INTEGER, at INTEGER NOT NULL)",
];
// Added 10-06 (questions first): plans.questions/answers (JSON), plan_origin.answers (JSON [{q, a}] answered + [{q, options, open: true}] still open).
const PLANS_ALTER = ["ALTER TABLE plans ADD COLUMN questions TEXT", "ALTER TABLE plans ADD COLUMN answers TEXT", "ALTER TABLE plan_origin ADD COLUMN answers TEXT"];
export function plansInit(sql) {
  for (const q of PLANS_DDL) sql.exec(q);
  for (const q of PLANS_ALTER) { try { sql.exec(q); } catch {} }   // already there
}

// ---- New projects: channels.js createChannel(env, tenant, { name, purpose, by: "helper" }) → { id, slug, name, purpose }, the same
// function as the app's New channel sheet. setChannelMaker swaps it (tests); with none, project items are refused in plain words.
let makeChannel = createChannel;
export function setChannelMaker(fn) { makeChannel = typeof fn === "function" ? fn : null; }
export const channelMaker = () => makeChannel;

// ---- the tool ----
export const PROPOSE_PLAN_TOOL = { type: "function", function: { name: "propose_plan",
  description: "Offer the person a plan that splits what they asked into separate pieces of work, each handed to its own new task, started by you. It puts ONE plan card in front of them: a checkbox per item (all ticked) and Approve, Deny, Let's talk. Nothing starts until they approve; then every ticked item starts at once, in parallel, each in its own new task, with your brief as its first message. " +
    "Use it when one message clearly holds several separate asks (\"help with my website, don't let me forget the dogs at 4:30, flyers for Mark by end of day\"), or one ask big enough to be its own project, and whenever they ask you to split work up, delegate it, or make it a project. Don't use it for a single ordinary request: just do that here, with no card. " +
    "Each brief is your handoff to yourself in that new task, which can't see this conversation: the person's actual request in their own terms, their constraints (names, dates, deadlines, preferences), what to do, and what to report back. Nothing they didn't ask for, and never more permission than they gave. Don't name a provider they didn't name: write \"their email\" or \"their calendar\", not \"Gmail\" or \"Google Calendar\", unless they said it or it's the app they have connected; the new task checks what's connected itself. \"Their email\" never means every account: when they named an account or memory says which (\"trip stuff is in my personal Gmail\"), name it in the brief; when it's open, ask it in questions. " +
    "kind: task = start now, in a new task in this channel. followup = something at a set time (\"remind me at 4:30\", \"on Friday morning\"): a new task that wakes at `when` instead of running now. project = a new project (its own channel) with this item as its first task; only from General, at most one per plan. At most 8 items. " +
    "Results show up in each task with an unread dot; nothing is sent to the person as a message or text. A plan never sends, buys or texts anything by itself, and every task follows the usual rules (approvals, OK before sending). " +
    "Questions first: when the work depends on something only the person can say and memory doesn't (which email account when several are connected, which dates, which person, which of two meanings), ask it in this chat before proposing, or put it in questions, instead of guessing: each question shows on the card above the items with tappable choices (for accounts, each account by its label plus \"All of them\"), they answer there before approving, and each started task gets the answers. Anything they leave unanswered, the task asks them first and waits. Don't ask what memory or their message already makes clear. " +
    "After calling it, stop: don't start any of the work yourself. In one short line, ask them to tick what they want and choose. If they want to talk it over, discuss it, then call propose_plan again with the revised plan; it replaces the old card. Only the person can approve.",
  parameters: { type: "object", properties: {
    items: { type: "array", description: "The pieces of work, in the order the person mentioned them (1-8).", items: { type: "object", properties: {
      kind: { type: "string", enum: KINDS },
      title: { type: "string", description: "Short task title the person sees, e.g. 'Fix the logo on your website' (under 60 characters)" },
      brief: { type: "string", description: "The whole handoff: the person's request and limits in their terms, the inputs, what to do and what to report back. Nothing added: name an app or service (Gmail, Outlook…) only if they named it or it's the one they have connected." },
      when: { type: "string", description: "followup only: the local date and time in the person's time zone, ISO like 2026-10-05T16:30 (no offset needed)" },
      project_name: { type: "string", description: "project only: the new project's name, e.g. 'Website'" },
      project_purpose: { type: "string", description: "project only: one line on what the project is for" } }, required: ["kind", "title", "brief"] } },
    note: { type: "string", description: "Optional: one short line shown on the card above the items" },
    questions: { type: "array", description: "Optional, at most 4: what you need the person to answer before the work starts (shown first on the card).", items: { type: "object", properties: {
      question: { type: "string", description: "Short and plain, e.g. 'Which email should I check?'" },
      options: { type: "array", items: { type: "string" }, description: "Tappable answers, e.g. each email account by its label plus 'All of them'. They can also type their own. Leave out for a free answer." },
      items: { type: "array", items: { type: "integer" }, description: "Which items (1 = the first) need this answer. Leave out = all of them." } }, required: ["question"] } } }, required: ["items"] } } };

// ---- time: `when` is wall-clock time in the person's zone (an explicit offset/Z is honored) ----
function tzOffset(ms, tz) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}
export function wallToUtc(y, mo, d, h, mi, tz) { const g = Date.UTC(y, mo, d, h, mi); let t = g - tzOffset(g, tz); t = g - tzOffset(t, tz); return t; }
export function parseWhen(when, tz) {
  const s = String(when || "").trim(); if (!s) return null;
  if (/(Z|[+-]\d\d:?\d\d)$/i.test(s)) { const t = Date.parse(s); return Number.isFinite(t) ? t : null; }
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/); if (!m) return null;
  return wallToUtc(+m[1], +m[2] - 1, +m[3], m[4] != null ? +m[4] : 9, m[5] != null ? +m[5] : 0, tz);
}
const dayKey = (ms, tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
export function whenLabel(ms, tz, now = Date.now()) {
  if (!Number.isFinite(ms)) return "";
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(ms));
  const d = dayKey(ms, tz);
  if (d === dayKey(now, tz)) return `Today at ${time}`;
  if (d === dayKey(now + 86400e3, tz)) return `Tomorrow at ${time}`;
  const date = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(new Date(ms));
  return `${date} at ${time}`;
}

// ---- small text helpers ----
const one = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const ell = (s, n) => { s = one(s); return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; };
const qt = (s) => `"${one(s).replace(/"/g, "'")}"`;
const jp = (s, d) => { if (s == null || s === "") return d; try { return JSON.parse(s); } catch { return d; } };
const firstSentence = (s, n = 90) => ell((one(s).match(/^.+?[.!?](?=\s|$)/)?.[0] || one(s)), n);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

// ---- validation: the model's arguments → normalized items, or one plain error the model can fix ----
export function checkPlan(a = {}, { general = false, tz = "America/Los_Angeles", now = Date.now(), canProject = !!makeChannel } = {}) {
  const raw = Array.isArray(a.items) ? a.items : [];
  if (!raw.length) return { error: "error: a plan needs at least one item. For a single ordinary request, just do it here without a plan." };
  if (raw.length > PLAN_MAX_ITEMS) return { error: `error: a plan can have at most ${PLAN_MAX_ITEMS} items (you sent ${raw.length}). Combine related asks, or do the small ones here yourself.` };
  const items = [];
  for (const [i, x] of raw.entries()) {
    const n = i + 1, kind = String(x?.kind || "").trim().toLowerCase();
    if (!KINDS.includes(kind)) return { error: `error: item ${n} has kind ${qt(x?.kind)}; it must be task, followup or project.` };
    const title = ell(x.title, PLAN_TITLE_MAX), brief = String(x.brief ?? "").trim().slice(0, PLAN_BRIEF_MAX);
    if (!title || !brief) return { error: `error: item ${n} needs both a title and a brief (the handoff: their request and limits, what to do, what to report).` };
    const it = { i, kind, title, brief };
    if (kind === "followup") {
      const t = parseWhen(x.when, tz);
      if (t == null) return { error: `error: item ${n} is a followup, so it needs when: the local date and time in the person's time zone (${tz}), like 2026-10-05T16:30.` };
      if (t < now + 30e3) return { error: `error: item ${n}'s time (${whenLabel(t, tz, now)}) has already passed in the person's time zone (${tz}; it's ${whenLabel(now, tz, now).replace(/^Today at /, "")} now). Use the next time they meant, or make it a task.` };
      if (t > now + 366 * 86400e3) return { error: `error: item ${n}'s time is more than a year away. Pick a time within the next year.` };
      it.when = String(x.when); it.when_ms = t;
    }
    if (kind === "project") {
      if (!general) return { error: "error: a new project can only be started from General. Make it a task in this channel instead (kind task), or suggest the person ask in General if it should be its own project." };
      if (!canProject) return { error: "error: new projects can't be created yet. Make it a task here instead (kind task)." };
      const name = ell(x.project_name, 60); if (!name) return { error: `error: item ${n} is a project, so it needs project_name (e.g. "Website").` };
      it.project_name = name; it.project_purpose = ell(x.project_purpose, 200);
    }
    items.push(it);
  }
  const np = items.filter((x) => x.kind === "project").length;
  if (np > PLAN_MAX_PROJECTS) return { error: `error: a plan can start at most ${PLAN_MAX_PROJECTS} new project. Keep the most important one as a project and make the others tasks.` };
  const rq = Array.isArray(a.questions) ? a.questions : [];
  if (rq.length > PLAN_MAX_QUESTIONS) return { error: `error: a plan can ask at most ${PLAN_MAX_QUESTIONS} questions first (you sent ${rq.length}). Keep the ones the work truly depends on; a task can ask the rest itself.` };
  const questions = [];
  for (const [i, x] of rq.entries()) {
    const q = ell(typeof x === "string" ? x : x?.question, PLAN_Q_MAX); if (!q) return { error: `error: question ${i + 1} is empty.` };
    const options = [...new Set((Array.isArray(x?.options) ? x.options : []).map((o) => ell(o, PLAN_OPTION_MAX)).filter(Boolean))].slice(0, PLAN_MAX_OPTIONS);
    const its = [...new Set((Array.isArray(x?.items) ? x.items : []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= items.length).map((n) => n - 1))].sort((m, n) => m - n);
    questions.push({ i, q, options, ...(its.length && its.length < items.length ? { items: its } : {}) });
  }
  return { items, note: ell(a.note, PLAN_NOTE_MAX), questions };
}

// ---- views ----
export function itemLine(x, tz, now = Date.now()) {
  if (x.kind === "followup") return whenLabel(x.when_ms, tz, now);
  if (x.kind === "project") return `First task: ${x.title}`;
  return firstSentence(x.brief);
}
export function planView(p, tz = "America/Los_Angeles", now = Date.now()) {
  if (!p) return null;
  const items = jp(p.items, []).map((x) => ({ i: x.i, kind: x.kind, title: x.title, line: itemLine(x, tz, now), brief: x.brief, ...(x.when_ms ? { when_ms: x.when_ms } : {}),
    ...(x.kind === "project" ? { project_name: x.project_name, project_purpose: x.project_purpose || "" } : {}), ...(x.result ? { result: x.result } : {}) }));
  return { id: p.id, session: p.session, card: p.card ?? null, status: p.status, note: p.note || "", excerpt: p.excerpt || "", items, questions: jp(p.questions, []), answers: jp(p.answers, null), picked: jp(p.picked, null),
    outcome: jp(p.outcome, null), created: p.created, decided: p.decided ?? null, replaced_by: p.replaced_by ?? null };
}
export const planRow = (sql, id) => sql.exec("SELECT * FROM plans WHERE id=?", Number(id)).toArray()[0];
export const plansOf = (sql, session, tz, now = Date.now()) => sql.exec("SELECT * FROM plans WHERE session=? ORDER BY id DESC LIMIT 20", String(session)).toArray().reverse().map((p) => planView(p, tz, now));
export function originOf(sql, session, tz, now = Date.now()) {
  const o = sql.exec("SELECT * FROM plan_origin WHERE session=?", String(session)).toArray()[0]; if (!o) return null;
  return { kind: o.kind, title: o.title, brief: o.brief, helper: o.helper || "", excerpt: o.excerpt || "", from_channel: o.from_channel, from_name: o.from_name || "", from_session: o.from_session || null, answers: jp(o.answers, []),
    plan: o.plan ?? null, at: o.at, ...(o.when_ms ? { when_ms: o.when_ms, when: whenLabel(o.when_ms, tz, now) } : {}) };
}

// ---- texts the model sees ----
export function proposedText(p, view) {
  const k = (x) => x.kind === "followup" ? `follow-up ${x.line}` : x.kind === "project" ? `new project "${x.project_name}"` : "task";
  const qs = view.questions || [];
  return `Plan #${p.id} is on a card in front of the person with ${plural(view.items.length, "item")}: ${view.items.map((x, j) => `${j + 1}. ${qt(x.title)} (${k(x)})`).join("; ")}. ` +
    (qs.length ? `Questions first, above the items: ${qs.map((x) => qt(x.q)).join("; ")}. They answer those on the card, then approve; every started task gets the answers (and asks anything left open). ` : "") +
    "Stop here: don't call more tools and don't start any of it yourself. In one short line, ask them to tick what they want and tap Approve, or Deny, or Let's talk. Nothing starts until they choose; only they can approve it. " +
    `Once approved, ${planBudgetText()}; they can stop any of them at any time.`;
}
export function approvedNote(view) {
  const ok = view.items.filter((x) => x.result && x.result.status !== "failed" && x.result.status !== "skipped");
  const bad = view.items.filter((x) => x.result?.status === "failed"), skip = view.items.filter((x) => x.result?.status === "skipped");
  const desc = (x) => x.kind === "followup" ? `${qt(x.title)} (scheduled ${x.line})` : x.kind === "project" ? `new project "${x.project_name}" with its first task ${qt(x.title)}` : qt(x.title);
  return `(Context note, not from the person: they approved your plan #${view.id}. Started, each in its own new task: ${ok.length ? ok.map(desc).join("; ") : "nothing"}.` +
    `${skip.length ? ` They unticked: ${skip.map((x) => qt(x.title)).join("; ")} (not started).` : ""}${answeredText(view)}${bad.length ? ` Couldn't start: ${bad.map((x) => `${qt(x.title)} (${x.result.error || "error"})`).join("; ")}.` : ""}` +
    " Confirm what started in one short line. The results will show up in each task; don't do that work here.)";
}
const answeredText = (view) => { const a = answerList(view.questions, view.answers); return a.length ? ` Their answers on the card: ${a.map((x) => `${qt(x.q)} ${qt(x.a)}`).join("; ")}.` : ""; };
// The request body's answers (the card's "Questions first"): [{ i, a }] or { i: a } → [{ i, a }] (short strings, at most PLAN_MAX_QUESTIONS).
export function planAnswers(b) {
  const list = Array.isArray(b) ? b : b && typeof b === "object" ? Object.entries(b).map(([i, a]) => ({ i, a })) : [];
  return list.map((x) => ({ i: Number(x?.i), a: String(x?.a ?? "").replace(/\s+/g, " ").trim().slice(0, PLAN_ANSWER_MAX) })).filter((x) => Number.isInteger(x.i) && x.i >= 0 && x.a).slice(0, PLAN_MAX_QUESTIONS);
}
// [{ i, q, a }] for the questions they answered; answers = { [question index]: text } or [{ i, a }].
export function answerList(questions = [], answers = null) {
  const m = new Map(); if (Array.isArray(answers)) for (const x of answers) m.set(Number(x?.i), x?.a); else if (answers && typeof answers === "object") for (const [k, v] of Object.entries(answers)) m.set(Number(k), v);
  return (questions || []).map((q) => ({ i: q.i, q: q.q, a: ell(m.get(q.i) ?? "", PLAN_ANSWER_MAX) })).filter((x) => x.a);
}
export const deniedNote = (view) => `(Context note, not from the person: they tapped Deny on your plan #${view.id}, so nothing from it was started. Acknowledge in one short line and carry on normally; don't start any of it unless they ask.)`;
// The started task's helper-only note (after its first message, which is the brief).
export function briefNote(o) {
  const where = o.from_channel && o.to_channel && o.from_channel !== o.to_channel ? ` in ${o.from_name ? `#${o.from_name}` : "another channel"}` : "";
  return `This task was started from a plan the person approved${where}. The message above is your own brief, written from their message: ${qt(ell(o.excerpt, 600))}.${qaNote(o.answers)} Do exactly that work here, then end with what you found or made: they read the result in this task. Memory first: if what you need (which account, which dates, which person) isn't in the brief, their answers or memory, and the choice matters, ask here and wait instead of guessing or searching everywhere. If something needs their OK (sending, buying, posting), ask here as usual.${o.apps ? APPS_NOTE : ""}`;
}
// The plan card's questions for one task: what they answered, and what's still open (the task asks that first and waits).
export function qaNote(list = []) {
  const ans = (list || []).filter((x) => !x.open), open = (list || []).filter((x) => x.open);
  const qa = ans.length ? ` Before it started, they answered on the plan card: ${ans.map((x) => `${qt(x.q)} → ${qt(x.a)}`).join("; ")}. Go by those answers.` : "";
  const ask = open.length ? ` Still open (they didn't answer on the card): ${open.map((x) => `${qt(x.q)}${x.options?.length ? ` (choices: ${x.options.join(", ")})` : ""}`).join("; ")}. Unless memory already answers it, ask them that first, here, as a tappable choice, then end your turn and wait for their answer before doing the part that depends on it.` : "";
  return qa + ask;
}
// Plan briefs can sound surer about the app than the person was ("check Gmail" for "my emails"): the started task checks.
const APPS_NOTE = " If the work needs one of their apps (email, calendar, files…), don't assume which service: check what's connected, and if what it needs isn't, use find_app and offer_connect (or ask which service they use).";
export const followupPrompt = (brief) => `Scheduled follow-up you set for yourself: ${brief}`;

// ---- propose (the tool) ----
// ctx = the turn (tc). The card is attached to the turn's card; one pending plan per task (a new one replaces it).
export function proposePlan(res, a, ctx = {}) {
  if (ctx.kind !== "chat" || !ctx.session || !res.session(ctx.session)) return "error: a plan can only be offered while working on a task with the person.";
  const tz = res.tz(), now = Date.now();
  const c = checkPlan(a, { general: res.get("channel") === PLAN_GENERAL, tz, now }); if (c.error) return c.error;
  const sql = res.sql, old = sql.exec("SELECT * FROM plans WHERE session=? AND status='pending' ORDER BY id DESC", ctx.session).toArray();
  const words = personWordsOf(ctx), excerpt = ell(old[0]?.excerpt || words, 600) || ell(words, 600);
  sql.exec("INSERT INTO plans (session,card,items,note,excerpt,status,created,via_text,questions) VALUES (?,?,?,?,?,'pending',?,?,?)", ctx.session, ctx.card || ctx.turn || null, JSON.stringify(c.items), c.note || null, excerpt, now, ctx.viaText ? 1 : 0, c.questions.length ? JSON.stringify(c.questions) : null);
  const id = sql.exec("SELECT last_insert_rowid() id").one().id;
  for (const o of old) { sql.exec("UPDATE plans SET status='replaced', replaced_by=?, decided=? WHERE id=?", id, now, o.id); ctx.emit?.({ t: "plan", plan: planView(planRow(sql, o.id), tz, now) }); }
  sql.exec("UPDATE sessions SET waiting='plan' WHERE id=?", ctx.session);
  const p = planRow(sql, id), view = planView(p, tz, now);
  ctx.emit?.({ t: "plan", plan: view });
  if (ctx.viaText && typeof res.planText === "function") { ctx.planTexted = id; res.ctx?.waitUntil?.(Promise.resolve(res.planText(id)).catch((e) => console.log("plan text", e.message))); }
  return proposedText(p, view);
}
// The person's own words this turn (their message plus what they added while it ran), not a handed-back result.
function personWordsOf(tc) {
  const out = []; if (!tc.handoff && tc.userText) out.push(String(tc.userText));
  const p = tc.pend; if (p && Array.isArray(p.items)) for (const x of p.items.slice(0, p.next ?? p.items.length)) if (x?.type === "msg" && x.text) out.push(String(x.text));
  return out.join(" · ");
}

// ---- decide (the person's tap; never a tool) ----
// decision: approve (picks = the ticked item indexes) | deny. Marks the plan before any await, so a double tap can't start twice.
// answers (approve only): { [question index]: text } or [{ i, a }] from the card's "Questions first" part.
export async function decidePlan(res, id, decision, picks = null, answers = null) {
  const sql = res.sql, p = planRow(sql, id), tz = res.tz();
  if (!p) return { error: "No such plan in this channel.", status: 404 };
  if (p.status !== "pending") return { error: p.status === "replaced" ? "This plan was replaced by a newer one." : `This plan was already ${p.status}.`, status: 409, plan: planView(p, tz) };
  if (decision !== "approve" && decision !== "deny") return { error: "decision must be approve or deny", status: 400 };
  const items = jp(p.items, []), now = Date.now();
  let pick = null;
  if (decision === "approve") {
    pick = [...new Set((Array.isArray(picks) ? picks : items.map((x) => x.i)).map(Number).filter((n) => items.some((x) => x.i === n)))].sort((a, b) => a - b);
    if (!pick.length) return { error: "Tick at least one item to approve, or tap Deny.", status: 400 };
  }
  const qs = jp(p.questions, []), ans = decision === "approve" ? answerList(qs, planAnswers(answers)) : [];
  sql.exec("UPDATE plans SET status=?, decided=?, picked=?, answers=? WHERE id=? AND status='pending'", decision === "approve" ? "approved" : "denied", now, pick ? JSON.stringify(pick) : null, ans.length ? JSON.stringify(ans.map(({ i, a }) => ({ i, a }))) : null, p.id);
  sql.exec("UPDATE sessions SET waiting=NULL WHERE id=? AND waiting='plan'", p.session);
  if (decision === "deny") {
    const view = planView(planRow(sql, p.id), tz);
    sql.exec("UPDATE plans SET outcome=? WHERE id=?", JSON.stringify({ line: "Not started", links: [] }), p.id);
    const v2 = planView(planRow(sql, p.id), tz); emitPlan(res, v2);
    if (res.session(p.session)) res.handoff(p.session, { text: deniedNote(view), from: { type: "plan", id: p.id, title: "Plan" } });
    const own = res.session(p.session);
    return { ok: true, plan: v2, sessions: own ? [{ slug: res.get("channel"), session: res.sessionView(own), origin: true }] : [] };
  }
  // Approve: everything is created here, deterministically, with no model turn needed to create it.
  let helper = "your helper"; try { helper = helperName(await res.env.DB.prepare("SELECT helper_name FROM tenants WHERE id=?").bind(res.get("tenant")).first()); } catch {}
  const chName = res.get("channel") === PLAN_GENERAL ? "General" : await channelName(res);
  const origin = { helper, excerpt: p.excerpt || "", from_channel: res.get("channel"), from_name: chName, from_session: p.session, plan: p.id };
  const sessions = [];
  // Each item gets the answers to its questions, and the questions left open (that task asks them first).
  const qaFor = (x) => qs.filter((q) => !q.items || q.items.includes(x.i)).map((q) => { const a = ans.find((y) => y.i === q.i); return a ? { q: q.q, a: a.a } : { q: q.q, options: q.options || [], open: true }; });
  const jobs = items.map(async (x) => {
    if (!pick.includes(x.i)) { x.result = { status: "skipped" }; return; }
    try {
      if (x.kind === "project") {
        const mk = makeChannel; if (!mk) throw new Error("new projects aren't available yet");
        let c, existing = false;
        // A project with that name already exists (ChannelError "duplicate"): its first task starts there instead of failing.
        try { c = await mk(res.env, res.get("tenant"), { name: x.project_name, purpose: x.project_purpose || "", by: "helper" }); }
        catch (e) { if (e?.code === "duplicate" && e.existing?.slug && e.existing.slug !== PLAN_GENERAL) { c = e.existing; existing = true; } else throw e; }
        if (!c?.slug) throw new Error(c?.error || "couldn't create the project");
        const R = res.env.RESIDENT.get(res.env.RESIDENT.idFromName(`res:${res.get("tenant")}:${c.slug}`));
        await R.bind(res.get("tenant"), c.slug, String(c.id), tz);
        const r = await R.planStartTask({ kind: "task", title: x.title, brief: x.brief, answers: qaFor(x) }, { ...origin, to_channel: c.slug });
        if (r?.error) throw new Error(r.error);
        x.result = { status: "started", slug: c.slug, name: c.name || x.project_name, channel_id: String(c.id), session: r.session?.id || r.id || null, ...(existing ? { existing: true } : {}) };
        sessions.push({ slug: c.slug, name: c.name || x.project_name, purpose: c.purpose || x.project_purpose || "", id: c.id, created: !existing, session: r.session || null });
      } else {
        const r = startPlanTask(res, { ...x, answers: qaFor(x) }, { ...origin, to_channel: res.get("channel") });
        x.result = { status: x.kind === "followup" ? "scheduled" : "started", slug: res.get("channel"), session: r.session.id };
        sessions.push({ slug: res.get("channel"), session: r.session });
      }
    } catch (e) { x.result = { status: "failed", error: ell(e.message || e, 160) }; console.log("plan item", p.id, x.i, e.message); }
  });
  await Promise.all(jobs);
  const outcome = outcomeOf(items, tz);
  sql.exec("UPDATE plans SET items=?, outcome=? WHERE id=?", JSON.stringify(items), JSON.stringify(outcome), p.id);
  const view = planView(planRow(sql, p.id), tz);
  emitPlan(res, view);
  // The original task gets one short system note, so the helper confirms in one line what started.
  if (res.session(p.session)) res.handoff(p.session, { text: approvedNote(view), from: { type: "plan", id: p.id, title: "Plan" } });
  const own = res.session(p.session); if (own) sessions.push({ slug: res.get("channel"), session: res.sessionView(own), origin: true });   // no longer waiting on the person
  return { ok: true, plan: view, sessions };
}
async function channelName(res) {
  try { const c = (await res.archive().channels()).find((x) => (x.slug || x.name) === res.get("channel")); if (c?.name) return c.name; } catch {}
  return res.get("channel");
}
const emitPlan = (res, view) => { try { for (const t of res.active.values()) if (t.session === view.session && !t.finished && t.kind !== "helper") t.emit?.({ t: "plan", plan: view }); } catch {} };
export function outcomeOf(items, tz) {
  const done = items.filter((x) => x.result && !["failed", "skipped"].includes(x.result.status));
  const nt = done.filter((x) => x.kind === "task").length, nf = done.filter((x) => x.kind === "followup").length, pr = done.find((x) => x.kind === "project");
  const nbad = items.filter((x) => x.result?.status === "failed").length;
  const parts = [nt ? `Started ${plural(nt, "task")}` : "", nf ? `${nt ? "scheduled" : "Scheduled"} ${nf}` : "", pr ? (pr.result.existing ? `${nt || nf ? "added a task to" : "Added a task to"} ${pr.result.name || pr.project_name}` : `${nt || nf ? "created" : "Created"} ${pr.result.name || pr.project_name}`) : "", nbad ? `${nbad} couldn't start` : ""].filter(Boolean);
  const links = done.map((x) => x.kind === "project" ? { kind: "project", label: x.result.name || x.project_name, slug: x.result.slug, session: x.result.session, task: x.title }
    : { kind: x.kind, label: x.title, slug: x.result.slug, session: x.result.session, ...(x.kind === "followup" ? { when: whenLabel(x.when_ms, tz) } : {}) });
  return { line: parts.join(" · ") || "Nothing started", links, errors: items.filter((x) => x.result?.status === "failed").map((x) => ({ title: x.title, error: x.result.error })) };
}

// ---- start one task (runs in the Resident that owns the task's channel) ----
// task → a new task whose first message is the brief (via "plan"), run now as a normal chat turn (steering, cards, todos);
// followup → a new task + a one-time follow-up at when_ms that comes back into it (runWorkflow → handoff).
export function startPlanTask(res, x, o) {
  const now = Date.now(), sid = res.newSession(x.title);
  const qa = Array.isArray(x.answers) && x.answers.length ? x.answers : null;
  res.sql.exec("INSERT OR REPLACE INTO plan_origin (session,kind,title,brief,when_ms,helper,excerpt,from_channel,from_name,from_session,plan,at,answers) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    sid, x.kind === "followup" ? "followup" : "task", x.title, x.brief, x.when_ms ?? null, o.helper || null, ell(o.excerpt, 600), o.from_channel || null, o.from_name || null, o.from_session || null, o.plan ?? null, now, qa ? JSON.stringify(qa) : null);
  if (x.kind === "followup") {
    const d = Math.max(30, Math.round((x.when_ms - now) / 1000));
    const id = res.addWorkflow({ kind: "followup", name: x.title, prompt: followupPrompt(x.brief) + qaNote(qa), interval_seconds: d, next_run: x.when_ms, max_runs: 1, session: sid });
    res.sql.exec("UPDATE sessions SET preview=? WHERE id=?", `Scheduled for ${whenLabel(x.when_ms, res.tz(), now)}`, sid);
    res.arm?.().catch?.(() => {});
    return { session: res.sessionView(res.session(sid)), workflow: id };
  }
  const so = res.steerOrOpen(sid, { type: "msg", text: x.brief, via: "plan" });
  // Safety budget (stop.js): a brain-dump can start up to 8 of these at once, so each first run stops itself at the budget with a short report.
  const budget = planBudget();
  const run = res.runTurn(res.get("tenant"), res.get("channel"), res.get("channel_id"), x.brief, null, { session: sid, card: so.card.id, note: briefNote({ ...o, answers: qa || [], apps: !!res.env?.COMPOSIO_KEY }), handoff: { type: "plan", plan: o.plan ?? null }, ...budget })
    .catch((e) => console.log("plan task turn", e.message));
  res.ctx.waitUntil?.(run); (res._planRuns ||= []).push(run);
  return { session: res.sessionView(res.session(sid)) };
}

// ---- the texted card (/c/<token>, kind "plan"): proposed in a texting turn → an iMessage live app card with the same actions ----
// Falls back (new-contact limit, any send error) to a plain text with the items numbered and the link.
export async function textPlan(res, id) {
  const tenant = res.get("tenant"), channel = res.get("channel"), env = res.env, p = planRow(res.sql, id); if (!p) return false;
  const tx = await env.DB.prepare("SELECT status FROM texting WHERE tenant_id=?").bind(tenant).first().catch(() => null);
  if (tx?.status !== "connected") return false;
  const helper = helperName(await env.DB.prepare("SELECT helper_name FROM tenants WHERE id=?").bind(tenant).first().catch(() => null));
  const view = planView(p, res.tz()), chName = channel === PLAN_GENERAL ? "General" : await channelName(res);
  const card = await savePlanCard(env, { tenant, channel, plan: p, channelName: chName });
  if (!card.fresh) return true;
  const list = view.items.map((x, j) => `${j + 1}. ${x.kind === "project" ? `New project: ${x.project_name} (first task: ${x.title})` : x.title}${x.kind === "followup" ? ` (${x.line})` : ""}`).join("\n");
  const qs = view.questions?.length ? `\nFirst, a quick question${view.questions.length > 1 ? "s" : ""}: ${view.questions.map((x) => `${x.q}${x.options?.length ? ` (${x.options.join(" / ")})` : ""}`).join(" · ")}` : "";
  const d = await deliverCard(env, tenant, { url: card.url, layout: planLayout(view.items.length, helper), fallback: `${helper} can start these for you:\n${list}${qs}\nOpen to answer, tick what you want and approve: ${card.url}` });
  return !!d?.ok;
}
// ---- the texted card (/c/<token>, kind "plan") ----
export function planCardData(res, id) {
  const p = planRow(res.sql, id); if (!p) return { status: "expired" };
  return { status: p.status, plan: planView(p, res.tz()) };
}
