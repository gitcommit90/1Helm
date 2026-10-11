// Ask first (Captain, 10-06): memory first, then ask. A brain dump like "check the columbia trip dates" must not send the helper
// through all 9 of their connected email accounts on its own. The rule: when memory or their words say where something lives, go;
// when it's new and ambiguous and the choice matters (which account, which person, which dates), ask; with one account, never ask which.
// This module is the tool-level guard for the "which account" part. It sits in front of the read/search tools (gmail_search,
// calendar_events, gmail_read, read-only app_run actions) and keeps one small per-task record of what the person chose:
//   ask_scope(session, kind) → scope: "all" | [labels] (null while a question is open), source, asked (when it last asked).
// kind = "email" | "calendar" | an app id (any app with several accounts, e.g. two Slacks).
// Guard, when 2+ accounts of that kind are connected and this is a person's task (scheduled runs and helpers have nobody to ask):
//   - no account given, nothing chosen in this task, and their words (or memory) don't say "all" → "ASK FIRST" (nothing runs);
//   - account "all" (or every account listed) → runs over all of them in one call, only when their words in this task (or memory) say so;
//   - an explicit account (from memory or their words) → runs, and becomes this task's choice; a DIFFERENT account later in the same
//     task (one by one through every inbox) → "ASK FIRST" unless they named it;
//   - after a question, their answer (the next call with an account) is this task's choice AND a Notebook note, so next time memory says it.
// The question itself is the model's reply (a tappable card in the app, a numbered choice by text); the task shows "Waiting on you".
import { pickAccount, SUPER_COVERS } from "./ee/index.js";

export const ASK_DDL = "CREATE TABLE IF NOT EXISTS ask_scope (session TEXT NOT NULL, kind TEXT NOT NULL, scope TEXT, source TEXT, asked INTEGER, at INTEGER NOT NULL, PRIMARY KEY (session, kind))";
const ready = new WeakSet();
function init(sql) { if (!ready.has(sql)) { sql.exec(ASK_DDL); ready.add(sql); } }

// ---- kinds: which connected accounts count as "the same kind of thing" ----
export const EMAIL_APPS = new Set(["gmail", "googlesuper", "outlook", "yahoo_mail", "zoho_mail", "fastmail", "icloud_mail", "protonmail", "imap"]);
export const CALENDAR_APPS = new Set(["googlecalendar", "googlesuper", "outlook", "icloud_calendar", "zoho_calendar"]);
const MAILISH = /MAIL|MESSAGE|INBOX|THREAD|DRAFT|LABEL|FOLDER/, CALISH = /CALENDAR|EVENT|FREE_?BUSY|AVAILAB/;
export const READ_ACTION = /(^|_)(SEARCH|LIST|FETCH|GET|FIND|QUERY|READ)(_|$)/;
const WORD = { email: "email", calendar: "calendar" };
// The app an action id belongs to: its id starts with the app's (GMAIL_FETCH_EMAILS → gmail); longest match wins (google_maps).
export function appOfAction(action, conns = []) {
  const low = String(action || "").toLowerCase();
  return [...new Set(conns.map((c) => c.app))].filter((s) => low.startsWith(`${s}_`)).sort((a, b) => b.length - a.length)[0] || low.split("_")[0];
}
// → { kind, app } for a guarded call, or null when it isn't a read this guard covers.
export function kindOf(name, a = {}, conns = []) {
  if (name === "gmail_search" || name === "gmail_read") return { kind: "email", app: "gmail" };
  if (name === "calendar_events") return { kind: "calendar", app: "googlecalendar" };
  if ((name === "app_run" && /^custom_/i.test(String(a.action || ""))) || (name === "app_proxy" && /^custom_/i.test(String(a.app || "")))) return null;   // custom MCP: one account per server, its tool names say nothing (perms.js asks)
  if (name === "app_proxy") {   // the app's own API (stage 3): a GET is a read like app_run's; the app is named
    if (String(a.method || "GET").toUpperCase() !== "GET") return null;
    const app = String(a.app || "").toLowerCase().replace(/[^a-z0-9_]/g, ""); if (!app) return null;
    if (EMAIL_APPS.has(app) && (app !== "googlesuper" || MAILISH.test(String(a.path || "").toUpperCase()))) return { kind: "email", app };
    if (CALENDAR_APPS.has(app)) return { kind: "calendar", app };
    return { kind: app, app };
  }
  if (name !== "app_run") return null;
  const act = String(a.action || "").toUpperCase(); if (!READ_ACTION.test(act)) return null;
  const app = appOfAction(act, conns);
  if (EMAIL_APPS.has(app) && MAILISH.test(act)) return { kind: "email", app };
  if (CALENDAR_APPS.has(app) && CALISH.test(act)) return { kind: "calendar", app };
  return { kind: app, app };
}
const inKind = (kind, app) => kind === "email" ? EMAIL_APPS.has(app) : kind === "calendar" ? CALENDAR_APPS.has(app) : app === kind;
// Every connected account of that kind, oldest first. Names/labels are not identity: two people can share them.
// Identity is app-scoped, except the retired Google Super connection covering the same Gmail/Calendar account.
export function accountsOf(conns = [], kind) {
  const seen = new Set(), out = [];
  for (const c of conns.filter((x) => x.status === "connected" && inKind(kind, x.app)).sort((x, y) => String(x.since).localeCompare(String(y.since)))) {
    const email = String(c.email || "").trim().toLowerCase();
    const hasEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const google = kind === "email" && ["gmail", "googlesuper"].includes(c.app)
      || kind === "calendar" && ["googlecalendar", "googlesuper"].includes(c.app);
    // A sign-in email can name the same person in different Slack/Notion workspaces.
    // Only the resolver's explicitly verified provider identity may merge those rows.
    const identity = c.identityKey || "";
    const keys = [c.id && `connection:${c.app}:${c.id}`,
      identity && `identity:${c.app}:${identity}`,
      google && hasEmail && `google:${kind}:${email}`].filter(Boolean);
    if (keys.some((k) => seen.has(k))) continue;
    for (const k of keys) seen.add(k);
    out.push(c);
  }
  return out;
}
const labelOf = (c) => c.label || c.email || c.id;
const listText = (accts) => accts.map((c) => `${labelOf(c)}${accts.some((x) => x.app !== c.app) ? ` (${c.name || c.app})` : ""}${c.memo ? ` (note: "${c.memo}")` : ""}`).join(", ");

// ---- account notes (10-06): the person's own note on an account ("my work email; use for anything Tennis Channel") says which one ----
// A note matches when one of its telling words is in what they said in this task ("work stuff" → the account noted as work email).
// Telling = not a filler word and not in every account's note. Exactly one account matching = that one; none or several = ask as before.
const NOTE_STOP = new Set(("the and for use this that with from all any anything everything stuff things thing only also just mine my our your their its " +
  "account accounts email emails mail mails inbox gmail outlook calendar calendars events event app main check send read find look please here there " +
  "one ones what when where which who about into onto over under not but are was were has have had will can should would them they him her his").split(" "));
const stem = (w) => w.replace(/'s$/, "").replace(/(ies)$/, "y").replace(/(?<=[a-z]{3})s$/, "");
const wordsOf = (s) => new Set(String(s || "").toLowerCase().match(/[a-z0-9][a-z0-9'.-]*[a-z0-9]|[a-z0-9]/g)?.map((w) => stem(w.replace(/[.-]+$/, ""))).filter((w) => w.length >= 3 && !NOTE_STOP.has(w)) || []);
export function noteHits(accts, said) {
  const noted = accts.filter((c) => c.memo); if (!noted.length) return [];
  const sets = new Map(noted.map((c) => [c, wordsOf(c.memo)])), heard = wordsOf(said);
  const common = noted.length > 1 ? [...sets.get(noted[0])].filter((w) => noted.every((c) => sets.get(c).has(w))) : [];
  return noted.filter((c) => [...sets.get(c)].some((w) => !common.includes(w) && heard.has(w)));
}
export const noteMatch = (accts, said) => { const h = noteHits(accts, said); return h.length === 1 ? h[0] : null; };

// ---- what the person said in this task, and what memory holds ----
const ALL_RE = /\b(all|every|each|both)\b/i;
const NOT_ALL = /\b(that'?s all|all (set|good|right|done|clear|for now|the best|day|night|week|along|over|in all)|at all|after all|once and for all|all i (need|want)|is that all)\b/gi;
export const saysAll = (s) => ALL_RE.test(String(s || "").replace(NOT_ALL, " "));
const KIND_WORDS = { email: /e-?mails?|inbox(es)?|mail|accounts?|gmail|outlook/i, calendar: /calendars?|schedules?|accounts?/i };
// A memory line that says "all accounts" for this kind ("Trip stuff: check all their email accounts").
export function memorySaysAll(text, kind) {
  const w = KIND_WORDS[kind] || new RegExp(`${kind}|accounts?`, "i");
  return String(text || "").split(/\n|(?<=[.!?])\s+/).some((l) => saysAll(l) && w.test(l));
}
export function personWords(res, ctx = {}) {
  const out = [];
  if (!ctx.handoff && ctx.userText) out.push(String(ctx.userText));
  const p = ctx.pend; if (p && Array.isArray(p.items)) for (const x of p.items) if (x?.type === "msg" && x.text && x.via !== "plan") out.push(String(x.text));
  if (ctx.session) {
    try { for (const r of res.sql.exec("SELECT e.text FROM card_events e JOIN cards c ON c.id=e.card WHERE c.session=? AND e.type='msg' AND (e.via IS NULL OR e.via IN ('app','text')) ORDER BY e.at DESC LIMIT 30", ctx.session).toArray()) if (r.text) out.push(String(r.text)); } catch {}
    try { const o = res.sql.exec("SELECT answers FROM plan_origin WHERE session=?", ctx.session).toArray()[0]; for (const x of JSON.parse(o?.answers || "[]")) if (x?.a) out.push(`${x.q}: ${x.a}`); } catch {}
  }
  return out.join("\n");
}
// What the helper sees of memory this turn: the pinned notes in its instructions plus this message's Memory recall (topic-matched).
export const memoryText = (res, ctx = {}) => `${res._pinned || ""}\n${ctx.memNote || ""}`;

// ---- the per-task record ----
export function scopeOf(sql, session, kind) { init(sql); const r = sql.exec("SELECT * FROM ask_scope WHERE session=? AND kind=?", String(session), kind).toArray()[0]; if (!r) return null; let s = null; try { s = JSON.parse(r.scope); } catch {} return { ...r, scope: s }; }
function setScope(sql, session, kind, scope, source) {
  init(sql);
  sql.exec("INSERT INTO ask_scope (session,kind,scope,source,asked,at) VALUES (?,?,?,?,NULL,?) ON CONFLICT(session,kind) DO UPDATE SET scope=excluded.scope, source=excluded.source, asked=NULL, at=excluded.at", String(session), kind, JSON.stringify(scope), source, Date.now());
}
function markAsked(sql, session, kind) {
  init(sql);
  sql.exec("INSERT INTO ask_scope (session,kind,scope,source,asked,at) VALUES (?,?,NULL,NULL,?,?) ON CONFLICT(session,kind) DO UPDATE SET asked=excluded.asked, at=excluded.at", String(session), kind, Date.now(), Date.now());
}

// Did the person send anything in this task after time t (their answer to a question)?
function spokeSince(sql, ctx, t) {
  const p = ctx.pend; if (p && Array.isArray(p.items) && p.items.some((x) => x?.type === "msg" && x.via !== "plan" && (x.at || 0) > t)) return true;
  try { return sql.exec("SELECT 1 FROM card_events e JOIN cards c ON c.id=e.card WHERE c.session=? AND e.type='msg' AND (e.via IS NULL OR e.via IN ('app','text')) AND e.at>? LIMIT 1", String(ctx.session), t).toArray().length > 0; } catch { return false; }
}

// ---- the texts the model sees ----
const ANSWER = (word) => `When they answer, call again with account set to their pick: one label, several labels separated by commas, or "all". Their answer is saved to the Notebook for this kind of thing, so next time you won't need to ask. If they say it's always the same (e.g. "trips are in my personal email"), save that with remember.`;
export function askText(kind, accts, why = "new") {
  const word = WORD[kind] || (accts[0]?.name || kind), n = accts.length;
  const lead = why === "all" ? `they haven't said to check every ${word} account, so nothing was searched`
    : why === "more" ? `this task already used a different ${word} account and they haven't asked you to check others, so nothing was searched`
    : why === "wait" ? `you already asked which ${word} account to check and they haven't answered yet, so nothing was searched`
    : `neither memory nor their words say which ${word} account to check for this, so nothing was searched`;
  if (why === "wait") return `ASK FIRST: ${lead}. End your turn now and wait for their answer (they see your question in this task). ${ANSWER(word)}`;
  const noted = accts.some((c) => c.memo);
  return `ASK FIRST: ${lead}. They have ${n} ${word} accounts connected: ${listText(accts)}. If memory${noted ? ", their words or an account's note" : " or their words"} already say which (a Notebook note, a recurring thing you've done before${noted ? ", a note like \"use for anything work\" that fits this request" : ""}), call again with that account instead of asking. Otherwise don't pick one yourself and don't go through them one by one: ask which ${word} to check, as one tappable choice listing each account by its label${noted ? " with its note under it (an Option whose title is the label and whose detail is the note)" : ""} plus "All of them", then end your turn and wait for their answer. ${ANSWER(word)}`;
}

// ---- the guard ----
// want: the `account` the model passed. → { run: [labels] | null (= as asked, one call) , fixed?: "single"|"multi", note? } or { ask: text }.
export function parseWant(want) {
  const w = String(want ?? "").trim(); if (!w) return { none: true };
  if (/^(all|every|everything|all of them|all accounts|both)$/i.test(w)) return { all: true };
  return { list: w.split(/\s*[,;]\s*|\s+and\s+/).map((x) => x.trim()).filter(Boolean) };
}
const match = (accts, w) => { const p = pickAccount(accts.map((c) => ({ ...c, app: "x", status: "connected" })), "x", w); return p.error || !p.acct ? null : accts.find((c) => c.id === p.acct.id) || null; };
export async function askGuard(res, ctx = {}, name, a = {}, conns = []) {
  if (ctx.kind !== "chat" || !ctx.session) return { run: null };   // scheduled runs and helpers: nobody to ask
  const k = kindOf(name, a, conns); if (!k) return { run: null };
  const accts = accountsOf(conns, k.kind); if (accts.length < 2) return { run: null };   // one account: never ask which
  const sql = res.sql, sc = scopeOf(sql, ctx.session, k.kind), want = parseWant(a.account), read = name === "gmail_read";
  let pick = null, byNote = null;   // the accounts this call may use (objects), or null; the account an account note picked
  const said = () => personWords(res, ctx), mem = () => memoryText(res, ctx);
  // A question is open in this task: with a message from them since, this call carries their answer; with none, it's still open.
  const open = !!sc?.asked, answered = open && spokeSince(sql, ctx, sc.asked);
  if (open && !answered) { ctx.asked = k.kind; return { ask: askText(k.kind, accts, "wait") }; }
  const choose = async (scope, source, list) => {
    setScope(sql, ctx.session, k.kind, scope, source);
    if (answered && source === "person") await rememberChoice(res, ctx, k.kind, scope === "all" ? "all" : list.map(labelOf));
  };
  if (want.all || (want.list && want.list.length >= accts.length && want.list.every((w) => match(accts, w)))) {
    if (sc?.scope === "all") pick = accts;
    else if (saysAll(said())) { await choose("all", "person", accts); pick = accts; }
    else if (memorySaysAll(mem(), k.kind)) { await choose("all", "memory", accts); pick = accts; }
    else { markAsked(sql, ctx.session, k.kind); ctx.asked = k.kind; return { ask: askText(k.kind, accts, "all") }; }
  } else if (want.list) {
    const hit = want.list.map((w) => match(accts, w));
    if (hit.some((x) => !x)) return { run: null };   // a name that matches nothing: the tool itself lists the choices
    const mine = Array.isArray(sc?.scope) ? sc.scope : null;
    if (sc?.scope === "all" || (mine && hit.every((c) => mine.includes(labelOf(c))))) pick = hit;
    else if (!mine || answered) { await choose(hit.map(labelOf), answered ? "person" : "helper", hit); pick = hit; }
    else {
      // A different account than this task already used: fine when they named it; going through inboxes one by one is not.
      const words = said().toLowerCase(), byNote = noteHits(accts, words);
      const named = hit.filter((c) => !mine.includes(labelOf(c))).every((c) => words.includes(labelOf(c).toLowerCase()) || words.includes(labelOf(c).toLowerCase().split("@")[0]) || byNote.includes(c));
      if (named) { setScope(sql, ctx.session, k.kind, [...new Set([...mine, ...hit.map(labelOf)])], "person"); pick = hit; }
      else if (read) pick = hit;   // reading one message found by an earlier search is never a new search
      else { markAsked(sql, ctx.session, k.kind); ctx.asked = k.kind; return { ask: askText(k.kind, accts, "more") }; }
    }
  } else {   // no account given
    if (sc?.scope === "all") pick = accts;
    else if (Array.isArray(sc?.scope)) pick = sc.scope.map((l) => accts.find((c) => labelOf(c) === l)).filter(Boolean);
    else if (saysAll(said())) { await choose("all", "person", accts); pick = accts; }
    else if (memorySaysAll(mem(), k.kind)) { await choose("all", "memory", accts); pick = accts; }
    else if ((byNote = noteMatch(accts, said()))) { setScope(sql, ctx.session, k.kind, [labelOf(byNote)], "note"); pick = [byNote]; }   // their note on an account says it's the one
    else if (read) return { run: null };   // reading by id: the default, as before
    else { markAsked(sql, ctx.session, k.kind); ctx.asked = k.kind; return { ask: askText(k.kind, accts, "new") }; }
    if (!pick.length) return { run: null };
  }
  // Only this tool's app's accounts can run here (gmail_search covers Gmail; Outlook goes through app_run): the rest is a note.
  const here = pick.filter((c) => c.app === k.app || (SUPER_COVERS.has(k.app) && c.app === "googlesuper")), other = pick.filter((c) => !here.includes(c));
  const note = (byNote ? ` (Used ${labelOf(byNote)}: their note on it says "${byNote.memo}". Say which account you checked; if they meant another, they'll say.)` : "")
    + (other.length ? ` (Also chosen, in another app: ${other.map((c) => `${labelOf(c)} in ${c.name || c.app}`).join(", ")}; use app_actions/app_run for ${other.length === 1 ? "it" : "those"} with account set.)` : "");
  if (!here.length) return { run: null, note };   // all chosen accounts live in another app: run as asked, with the note
  return { run: here.map(labelOf), note, kind: k.kind };
}

// Their answer to "which account?" goes into the Notebook, tied to this task's topic, so next time memory answers it.
async function rememberChoice(res, ctx, kind, labels) {
  try {
    const title = res.session?.(ctx.session)?.title || "this", word = WORD[kind] || kind;
    const what = labels === "all" ? `all of their ${word} accounts` : labels.length === 1 ? `their ${labels[0]} ${word} account` : `these ${word} accounts: ${labels.join(", ")}`;
    const fact = `For "${title}", check ${what} (their answer when asked which ${word} to check).`;
    const note = await res.rememberLocal("them", fact, ctx.session ? `task ${String(ctx.session).slice(0, 8)}` : "", "how");
    if (note?.sec) ctx.emit?.({ t: "note", note });
    ctx.remembered = fact;
  } catch (e) { console.log("ask-first remember", e.message); }
}

// Runs a guarded read tool. runOne(args) is the plain tool (one account or the default). With several accounts chosen, it runs once
// per account and labels each answer; gmail_read with several chosen tries each until one has the message.
export async function guardedTool(res, ctx, name, a, conns, runOne) {
  const g = await askGuard(res, ctx, name, a, conns);
  if (g.ask) return g.ask;
  if (!g.run) return (await runOne(a)) + (g.note || "");
  if (g.run.length === 1) return (await runOne({ ...a, account: g.run[0] })) + (g.note || "");
  if (name === "gmail_read") {
    let last = ""; for (const l of g.run) { last = await runOne({ ...a, account: l }); if (!/^error/.test(last)) return last; } return last;
  }
  const outs = []; for (const l of g.run) outs.push(`[account: ${l}]\n${await runOne({ ...a, account: l })}`);
  return `Ran on ${g.run.length} accounts (${g.run.join(", ")}):\n${outs.join("\n\n")}${g.note || ""}`;
}

// ---- the task waits on the person ----
// A reply that asks the person something: a card with a choice/form/buttons, or text ending in a question.
export function asksSomething(reply) {
  const s = String(reply || "").trim(); if (!s) return false;
  if (/^root\s*=\s*Stack\(/m.test(s) && /\b(Options|Buttons|Form|Choice)\(/.test(s)) return true;
  return /\?\s*$/.test(s.replace(/[*_`)\]]+$/g, ""));
}

// After a chat turn: when the helper stopped to ask (the guard fired, or a task a plan started ended on a question), the task shows
// "Waiting on you" (sessions.waiting = 'question', cleared by their next message like every other wait). The push / text that
// tells them (with the question in it) is notify.js's, sent by the Resident after the turn (Settings → Notifications).
export async function afterTurn(res, tc, r) {
  if (tc.kind !== "chat" || !tc.session || !r || r.error) return false;
  const sql = res.sql; let origin = null;
  try { origin = sql.exec("SELECT plan, title FROM plan_origin WHERE session=?", tc.session).toArray()[0] || null; } catch {}
  if (!tc.asked && !(origin && asksSomething(r.reply))) return false;
  sql.exec("UPDATE sessions SET waiting='question' WHERE id=? AND waiting IS NULL", tc.session);
  return true;
}
