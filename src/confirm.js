// Server-checked confirm for payment and API-key actions (Captain 10-10). Before this, `person_confirmed` was a flag the model set
// itself and nothing checked it (an eval helper permanently deleted a Drive file without a real yes). Now the tool itself shows the person
// a CONFIRM CARD with the exact action and content ([Confirm] [Cancel]), and the action runs only after their tap:
//   - held: someone is watching the task in the app, or the card went to their phone by text (/c/<token>): the call waits (up to 2 min)
//     and runs right after Confirm, with exactly the payload the card showed (the row's hash is that payload's);
//   - later: the turn ends ("WAITING FOR CONFIRM"); a later Confirm issues a one-time token (random, only its SHA-256 is kept) bound to
//     the payload hash, the task and the account (each Resident is one account + channel; the hash covers tenant + task too), valid
//     30 minutes, and hands the task back to the helper with it. The helper calls the same tool again with the same inputs and
//     confirm_token: it runs only if the token is valid, unused, unexpired and the inputs hash the same. A changed payload → a new card.
//   The model can't confirm anything itself: `person_confirmed` from the model is stripped before every gated tool (resident.js
//   localTool) and ignored; a token is only ever made by a tap.
// Cancel → "NOT DONE". A card left undecided expires after 30 minutes.
// A catalog read-only hint never overrides an explicit payment/key classification.
// Generic execution is not a soundly classifiable payment boundary; prompt/task authorization still applies.
//
// app_run/app_proxy consult approval-scope.js on the resolved operation. Ordinary requested
// email, document, calendar and app writes are not re-confirmed. Explicit user-selected
// Careful/Locked permissions remain independent (perms.js).
// Not here (already behind their own cards, so never asked twice): purchases (buy_with_link → Link's approval, browser_fill_card),
// publish_page / share_file_link (their own delivery cards).
// Not gated: gmail_draft, remember (Notebook), text_person (only reaches the person), reading anything.
//
// Rows live in the Resident's `approvals` table (perm = "confirm"), so the app's permission-card plumbing carries them unchanged:
// the live `approval` / `approval_done` events, the task's waiting state, the texted card page and POST /approve {id, decision}.
// Decisions: once | confirm = Confirm, deny | cancel = Cancel (the app and the card page send once / deny).

import { protectedAppAction, needsActionConfirm } from "./approval-scope.js";
export const CONFIRM = "confirm";
export const CONFIRM_TTL = 30 * 60e3;          // an undecided card, and a token after the tap, last 30 minutes
const HOLD_MS = 120e3, TICK = 500;
export const CONFIRM_DDL = ["ALTER TABLE approvals ADD COLUMN chash TEXT", "ALTER TABLE approvals ADD COLUMN cview TEXT", "ALTER TABLE approvals ADD COLUMN ctok TEXT",
  "ALTER TABLE approvals ADD COLUMN cexp INTEGER", "ALTER TABLE approvals ADD COLUMN cused INTEGER"];
export function confirmInit(sql) { for (const q of CONFIRM_DDL) { try { sql.exec(q); } catch {} } }
// The tools that go through confirmGate. The model's own person_confirmed is stripped from these before they run (resident.js).
export const CONFIRM_TOOLS = new Set(["gmail_send", "calendar_add", "app_run", "app_proxy"]);

// ---- which actions ----
const GUEST_KEY = /^(attendees?|attendee_emails?|invitees?|guests?|required_attendees|optional_attendees|participants|invite)$/i;
const filled = (v) => Array.isArray(v) ? v.some(filled) : v && typeof v === "object" ? Object.values(v).some(filled) : String(v ?? "").trim() !== "";
export const hasGuests = (args = {}) => Object.entries(args || {}).some(([k, v]) => GUEST_KEY.test(k) && filled(v));
// Explicit payment/API-key operations, independently of catalog readOnlyHint.
export function appRunNeedsConfirm(slug, args = {}) {
  return protectedAppAction(slug, args);
}

// ---- the payload's fingerprint ----
const canon = (v) => Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, canon(v[k])])) : v;
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
export const sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s))));
export const payloadHash = (tenant, session, tool, payload) => sha256(JSON.stringify(canon({ v: 1, tenant: String(tenant || ""), session: String(session || ""), tool, payload })));
const newToken = () => { const b = crypto.getRandomValues(new Uint8Array(24)); return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };

// ---- the texts the helper sees ----
const waiting = (title, where) => `WAITING FOR CONFIRM: 1Helm showed the person a confirm card for this exact action (${title}) ${where}. Nothing was done yet. End your turn now with one short line, e.g. "It's ready: tap Confirm to send it." Don't ask again in your own words, don't repeat the content (the card shows it), and don't try another way. If they tap Confirm, you'll be told and given a confirm_token.`;
const cancelled = (title) => `NOT DONE: the person tapped Cancel on the confirm card (${title}), so nothing was done. Don't do it another way. Say in one short line that you didn't, and ask what they'd like to change if it isn't clear.`;
const BAD_TOKEN = { unknown: "That confirm_token isn't one 1Helm gave for this task", used: "That confirm_token was already used", expired: "That confirm_token expired (they last 30 minutes)", changed: "The inputs changed since the person confirmed (a confirm covers only the exact action they saw)", pending: "That card hasn't been confirmed" };
// The note that hands the task back after a later tap (the helper's turn had ended). Carries the token and the exact call to repeat.
export const resumeText = (title, tool, args, token) => `(Not from the person: they just tapped Confirm on the card "${title}". Call ${tool} again now with exactly these inputs and confirm_token "${token}" (one use, valid 30 minutes): ${JSON.stringify(args).slice(0, 6000)}. Change nothing; any change needs a new card. Then tell them in one short line what happened.)`;

// A held call runs only on this: the card's own row, decided Confirm (decideConfirm writes status approved + decision once), still
// a confirm card for exactly this payload, and not used before. Anything else (another card, a pause's Keep going, a resume) isn't a yes.
const confirmedHere = (row, hash) => !!row && row.perm === CONFIRM && row.status === "approved" && row.decision === "once" && row.chash === hash && !row.cused;
// ---- the gate (both engines: composio.js calls it through the ctx.confirm / opts.confirm hook the Resident passes) ----
// spec = { tool, payload (exactly what will run, resolved), args (the model's call, for the resume note), view, token }
// → null (go ahead: run exactly this payload) or the text the tool returns instead.
export async function confirmGate(res, tc, spec) {
  if (!needsActionConfirm(spec)) return null;
  const sql = res.sql, now = Date.now(), session = tc?.session || null, tenant = res.get("tenant");
  const hash = await payloadHash(tenant, session, spec.tool, spec.payload), title = spec.view?.title || "Confirm this?";
  let why = "";
  if (spec.token) {
    const row = sql.exec("SELECT * FROM approvals WHERE perm=? AND ctok=?", CONFIRM, await sha256(String(spec.token))).toArray()[0];
    const bad = !row || row.perm !== CONFIRM || (row.session || null) !== session ? "unknown" : row.cused ? "used" : row.status !== "approved" || row.decision !== "once" ? "pending" : Number(row.cexp) <= now ? "expired" : row.chash !== hash ? "changed" : "";
    // One use: the row was read after the last await, so nothing else can use it between that read and this write.
    if (!bad) { sql.exec("UPDATE approvals SET cused=? WHERE id=? AND cused IS NULL", now, row.id); return null; }
    why = ` (${BAD_TOKEN[bad || "used"]}, so it didn't count: this is a new card.)`;
  }
  // The same action still waiting on a card in this task (a retry): that card, not a second one.
  let a = sql.exec("SELECT * FROM approvals WHERE perm=? AND status='pending' AND chash=? AND COALESCE(session,'')=? AND at>? ORDER BY id DESC LIMIT 1", CONFIRM, hash, session || "", now - CONFIRM_TTL).toArray()[0];
  if (!a) {
    const view = { ...spec.view, call: { tool: spec.tool, args: spec.args ?? spec.payload } };
    sql.exec("INSERT INTO approvals (at,host,method,path,bytes,keys,turn,workflow_id,session,perm,what,chash,cview) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      now, "", "CONFIRM", "", 0, "[]", tc?.turn || null, tc?.workflow_id ?? null, session, CONFIRM, title, hash, JSON.stringify(view));
    a = sql.exec("SELECT * FROM approvals WHERE id=last_insert_rowid()").one();
  }
  const live = tc?.subs?.size > 0;
  const texted = live ? false : await res.textApproval(a).catch((e) => { console.log("confirm text", e.message); return false; });
  if (!live && !texted) return waiting(title, "in the app, on this task") + why;
  (res._confirmHeld ||= new Set()).add(a.id);
  try {
    tc?.emit?.({ t: "approval", approval: res.approvalView(a) });
    for (let i = 0; i < HOLD_MS / TICK; i++) {
      const cur = sql.exec("SELECT status, decision, cused, perm, chash FROM approvals WHERE id=?", a.id).one();
      if (!cur) break;
      if (cur.status !== "pending") {
        tc?.emit?.({ t: "approval_done", id: a.id, status: cur.status });
        // Fail closed: only Confirm on THIS card (this row, a confirm card, the payload hash it was made for, not used yet) lets it run.
        if (confirmedHere(cur, hash)) { sql.exec("UPDATE approvals SET cused=? WHERE id=? AND cused IS NULL", Date.now(), a.id); return null; }
        if (cur.status === "denied") return cancelled(title);
        return waiting(title, "in the app, on this task") + why;   // expired, or already used
      }
      if (tc?.abort === "hard") break;
      await new Promise((z) => setTimeout(z, TICK));
    }
  } finally { res._confirmHeld.delete(a.id); }
  return waiting(title, texted && !live ? "on their phone and in the app" : "in the app, on this task") + why;
}

// ---- deciding (Resident.decideApproval for a row with perm = "confirm") ----
const YES = new Set(["once", "confirm"]), NO = new Set(["deny", "cancel"]);
export async function decideConfirm(res, a, decision) {
  if (!YES.has(decision) && !NO.has(decision)) return { error: "decision must be confirm (once) or cancel (deny)" };
  const sql = res.sql, now = Date.now();
  if (a.status !== "pending") return { error: `already ${a.status}` };
  if (now - Number(a.at) > CONFIRM_TTL) { sql.exec("UPDATE approvals SET status='expired', decided_at=? WHERE id=? AND status='pending'", now, a.id); return { error: "expired", status: "expired" }; }
  if (NO.has(decision)) {
    sql.exec("UPDATE approvals SET status='denied', decision='deny', decided_at=? WHERE id=? AND status='pending'", now, a.id);
    return { ok: true, approval: res.approvalView(sql.exec("SELECT * FROM approvals WHERE id=?", a.id).one()) };
  }
  const held = !!res._confirmHeld?.has(a.id), token = held ? null : newToken();
  sql.exec("UPDATE approvals SET status='approved', decision='once', decided_at=?, ctok=?, cexp=? WHERE id=? AND status='pending'", now, token ? await sha256(token) : null, now + CONFIRM_TTL, a.id);
  // Nobody is holding the call (the turn ended): the task carries on with a one-time token for exactly this action.
  if (!held && a.session && res.session(a.session)) {
    const v = viewOf(a), call = v.call || {};
    try { res.handoff(a.session, { text: resumeText(v.title || a.what || "", call.tool, call.args || {}, token), from: { type: "confirm", id: a.id, title: `Confirmed: ${String(v.title || a.what || "").replace(/\?$/, "").slice(0, 80)}` } }); }
    catch (e) { console.log("confirm handoff", e.message); }
  }
  return { ok: true, approval: res.approvalView(sql.exec("SELECT * FROM approvals WHERE id=?", a.id).one()) };
}

// ---- what the app and the card page show ----
export const viewOf = (a) => { try { return JSON.parse(a.cview || "{}") || {}; } catch { return {}; } };
// The card's fields (approval.action): never the raw call or the token.
export function confirmView(a) {
  const { call, ...v } = viewOf(a);
  return { perm: CONFIRM, name: "Confirm", what: a.what || v.title || "", ask: v.title || a.what || "Confirm this?", always: "", action: v };
}
// Card status for the page: pending | once (confirmed) | deny (cancelled) | expired.
export function confirmStatus(a, now = Date.now()) {
  if (a.status === "pending") return now - Number(a.at) > CONFIRM_TTL ? "expired" : "pending";
  return a.status === "approved" ? "once" : a.status === "denied" ? "deny" : "expired";
}

// ---- the card's content, built from the exact payload (never from model-written summaries) ----
const clip = (x, n) => { const t = typeof x === "string" ? x : JSON.stringify(x); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const human = (k) => { const w = String(k).replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim().toLowerCase(); return w.charAt(0).toUpperCase() + w.slice(1); };
const IRREVERSIBLE = /(^|_)(DELETE|REMOVE|PURGE|EMPTY|DESTROY|ERASE)(_|$)/;
const many = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;
export function gmailSendView({ to, cc, subject, body, thread, account }) {
  const who = String(to || "").split(/[,;]\s*/).filter(Boolean);
  return { title: `${thread ? "Send this reply" : "Send this email"} to ${clip(who.join(", ") || "?", 80)}?`, app: "Gmail",
    lines: [["From", account], ["To", who.join(", ")], ...(cc ? [["Cc", String(cc)]] : []), ["Subject", subject || "(no subject)"], ...(thread ? [["In reply to", "the thread you were reading"]] : [])].filter((l) => l[1]).map(([k, v]) => [k, clip(String(v), 400)]),
    body: clip(String(body || ""), 4000) };
}
export function calendarInviteView({ title, start, end, tz, where, notes, guests, account }) {
  const g = guests || [];
  return { title: `Send this invite to ${many(g.length, "guest")}?`, app: "Google Calendar",
    lines: [["Calendar", account], ["Event", title], ["Starts", start], ["Ends", end], ["Time zone", tz], ["Where", where], ["Guests", g.join(", ")]].filter((l) => l[1]).map(([k, v]) => [k, clip(String(v), 400)]),
    ...(notes ? { body: clip(String(notes), 2000) } : {}), note: "Each guest gets an email invite." };
}
export function appRunView({ slug, appName, account, args }) {
  const app = String(slug || "").split("_")[0], act = String(slug || "").slice(app.length + 1) || String(slug || "");
  const what = human(act || slug);
  const lines = Object.entries(args || {}).filter(([, v]) => filled(v)).slice(0, 12).map(([k, v]) => [human(k), clip(v, 600)]);
  return { title: `${what} in ${appName}?`, app: appName, action: slug,
    lines: [...(account ? [["Account", String(account)]] : []), ...lines], ...(IRREVERSIBLE.test(String(slug).toUpperCase()) ? { note: "This can't be undone." } : {}) };
}
export function proxyView({ method, endpoint, appName, account, query, body }) {
  return { title: `${method === "DELETE" ? "Delete something" : "Change something"} in ${appName}?`, app: appName, action: `${method} ${endpoint}`,
    lines: [...(account ? [["Account", String(account)]] : []), ["Request", `${method} ${endpoint}`], ...(query && Object.keys(query).length ? [["Query", clip(query, 600)]] : [])],
    ...(body !== undefined && body !== null ? { body: clip(body, 3000) } : {}), ...(method === "DELETE" ? { note: "This can't be undone." } : {}) };
}
