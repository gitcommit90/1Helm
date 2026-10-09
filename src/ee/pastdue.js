import { boundedJson } from "../bounded-body.js";
// When a payment fails (the Captain, 10-06, final): "i am not covering or footing the bill at any point for any reason for anyone.
// If payment fails, instantly it becomes readonly until its fixed. Storage wise - they have until the end of their payment period to
// settle up and this is the ONLY time I will allow a 7 day grace period is if payment fails, instant read only, storage is fine until
// the end of their paid for subscription month, THEN if payment still isn't working, after 7 days their storage will permanently be
// deleted."
//
// One unpaid episode is a "hold" (D1 payment_holds, one row per account):
//  1. The plan's payment fails (invoice.payment_failed on its subscription, or Stripe says the subscription is past_due / unpaid /
//     ended for non-payment): the account is read-only AT ONCE. index.js accessOf: anything but status 'active' is read-only, so no
//     model calls, tasks, helpers, scheduled runs, texting replies, computer or purchases; they can open the app, read everything,
//     download their files and fix payment. Included usage is only ever granted by a paid invoice, so none is granted while unpaid.
//     An email and (texting on) a text say so. A text to the helper gets PAUSED_TEXT back, never a model call (texting.js).
//  2. Their data is kept until the end of the period they last paid for (paid_through: the latest period end of a paid plan
//     invoice, billing_paid). A renewal that fails means that's now. Then a 7-day final window:
//     delete_at = max(paid_through, failed_at) + 7 days. Reminder emails at the start of the window (folded into the first email when
//     the window starts at once) and 1 day before, in the person's daytime. Each notice is claimed before it's sent: never twice.
//  3. Paid at any point before deletion starts (invoice.paid, or Stripe says the subscription is active again): full access at once,
//     the hold is resolved and nothing is deleted.
//  4. delete_at reached and still unpaid (Stripe is asked first): deleteAccount(env, tenantId, { reason: "unpaid" }) from deletion.js,
//     the same full deletion as Delete account and the end of a cancelled plan ("delete = delete"): every channel, chat, file, computer
//     checkpoint, share and published page, memory, contacts, texting, connected apps, the Stripe customer (so nothing is charged
//     again) and the login. Then a final "deleted" email, and the address and slug on the hold row are blanked.
// The hold rows (no user content: ids, dates, state) outlive the account, like plan_cancellations is meant to, so the final email and
// the double-fire guard work after deletion (deletion.js leaves payment_holds / payment_hold_notices alone).
// index.js hooks in: holdOf() for accessOf, holdFromFailure() / notePaid() / pastdueSync() in the Stripe webhook and the hourly
// reconcile, pastdueCron() on the hourly cron, pastdueApi() for TEST_MODE checks. Tables: migrations_033_pastdue.sql.
import { DAY, HOUR, support, fmtDate, fmtTime, okTz, localHour, mailBody, isTestAddr, sendMail, loadDeleteAccount } from "./cancel.js";
import { deliverText } from "./texting.js";
import { PAY_MSG, PAUSED_TEXT } from "./readonly.js";

export const FINAL_WINDOW = 7 * DAY;
export { PAY_MSG, PAUSED_TEXT } from "./readonly.js";
const STALE_DELETING = 30 * 60e3;
const SCRUB_AFTER = 3 * DAY;
const log = (...a) => console.log("pastdue:", ...a);

// ---- D1 (created on first use too, so a missed migration never breaks billing) ----
let ready = false;
export async function ensurePastdueTables(env) {
  if (ready) return;
  for (const q of [
    "CREATE TABLE IF NOT EXISTS billing_paid (tenant_id TEXT PRIMARY KEY, paid_through INTEGER NOT NULL, invoice TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS payment_holds (tenant_id TEXT PRIMARY KEY, sub_id TEXT NOT NULL DEFAULT '', slug TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', tz TEXT NOT NULL DEFAULT '', failed_at INTEGER NOT NULL, paid_through INTEGER NOT NULL, delete_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'unpaid', resolved_at INTEGER, started_at INTEGER, deleted_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL)",
    "CREATE INDEX IF NOT EXISTS payment_holds_state ON payment_holds(state, delete_at)",
    "CREATE TABLE IF NOT EXISTS payment_hold_notices (tenant_id TEXT NOT NULL, kind TEXT NOT NULL, failed_at INTEGER NOT NULL, sent_at INTEGER NOT NULL, delivered INTEGER NOT NULL DEFAULT 1, subject TEXT NOT NULL DEFAULT '', PRIMARY KEY (tenant_id, kind, failed_at))",
  ]) await env.DB.prepare(q).run();
  ready = true;
}
export const _resetReady = () => { ready = false; };   // tests: a fresh database

const holdRow = (env, tid) => env.DB.prepare("SELECT * FROM payment_holds WHERE tenant_id=?").bind(tid).first();
const tenantRow = (env, tid) => env.DB.prepare("SELECT * FROM tenants WHERE id=?").bind(tid).first();
const ownerEmail = async (env, t) => t?.owner_user_id ? (await env.DB.prepare("SELECT email FROM users WHERE id=?").bind(t.owner_user_id).first().catch(() => null))?.email || "" : "";
const appUrl = (env, slug) => `https://${env.APP_HOST || env.GATEWAY_HOST}/w/${slug}/app`;
// The person's time zone for dates in emails: the one the app last reported while on hold, else General's (the Resident keeps it).
async function tzOf(env, tid) {
  try { const z = await env.RESIDENT.get(env.RESIDENT.idFromName(`res:${tid}:main`)).tz(); return okTz(typeof z === "string" ? z : ""); } catch { return ""; }
}

// The open hold (for the banner and accessOf), or null. Never throws: billing reads must not break the app.
export async function holdOf(env, tid) {
  try { await ensurePastdueTables(env); const h = await holdRow(env, tid); return h && h.state === "unpaid" ? h : null; } catch (e) { log("holdOf", e.message); return null; }
}
// What the app shows: { reason: "payment_failed", message, paid_through, delete_at }.
export const holdView = (h) => h ? { reason: "payment_failed", message: PAY_MSG, paid_through: Number(h.paid_through), delete_at: Number(h.delete_at) } : null;
// The app reports its time zone on load: used for the dates in the reminder emails.
export async function pastdueSeen(env, tid, tz) {
  const z = okTz(tz); if (!z) return;
  await env.DB.prepare("UPDATE payment_holds SET tz=? WHERE tenant_id=? AND state='unpaid' AND tz<>?").bind(z, tid, z).run().catch(() => {});
}

// ---- paid: remember how far they've paid, and end any hold ----
// Invoice lines carry the period they pay for; a paid invoice moves paid_through to its latest period end (never backwards).
export const paidThroughOf = (inv) => Math.max(0, ...((inv?.lines?.data || []).map((l) => 1000 * Number(l?.period?.end || 0))));
export async function notePaid(env, tid, inv, at = Date.now()) {
  await ensurePastdueTables(env);
  const pt = paidThroughOf(inv);
  if (pt > 0) await env.DB.prepare(`INSERT INTO billing_paid (tenant_id,paid_through,invoice,updated_at) VALUES (?,?,?,?)
    ON CONFLICT(tenant_id) DO UPDATE SET paid_through=MAX(billing_paid.paid_through, excluded.paid_through), invoice=excluded.invoice, updated_at=excluded.updated_at`).bind(tid, pt, String(inv?.id || ""), at).run();
  return resolveHold(env, tid, "paid", at);
}
// Paid before deletion started: nothing is deleted. (A hold already deleting or deleted stays as it is.)
async function resolveHold(env, tid, why, at = Date.now()) {
  const r = await env.DB.prepare("UPDATE payment_holds SET state='paid', resolved_at=?, error='', updated_at=? WHERE tenant_id=? AND state='unpaid'").bind(at, at, tid).run();
  if (r.meta?.changes) log("resolved", tid, why);
  return !!r.meta?.changes;
}

// ---- a payment failed: start the hold (once per episode; Stripe's retries change nothing) ----
// hint: when the unpaid period starts (a failed renewal: its start = the end of the last paid period), if we have no paid record.
export async function holdStart(env, t, { hint = 0, subId = "", source = "webhook" } = {}, d = {}, at = Date.now()) {
  if (!t || !["past_due", "suspended"].includes(t.status)) return null;   // only a read-only account: never a signup still paying, an active plan or one being deleted
  await ensurePastdueTables(env);
  const cur = await holdRow(env, t.id);
  if (cur && cur.state !== "paid") return cur;   // already on hold (or being/been deleted): keep its dates, send nothing new
  const paid = await env.DB.prepare("SELECT paid_through FROM billing_paid WHERE tenant_id=?").bind(t.id).first();
  const pt = Number(paid?.paid_through || 0) || Number(hint || 0) || at, deleteAt = Math.max(pt, at) + FINAL_WINDOW;
  const email = await ownerEmail(env, t), tz = await tzOf(env, t.id);
  await env.DB.prepare(`INSERT INTO payment_holds (tenant_id,sub_id,slug,email,tz,failed_at,paid_through,delete_at,state,resolved_at,started_at,deleted_at,attempts,error,updated_at)
    VALUES (?,?,?,?,?,?,?,?,'unpaid',NULL,NULL,NULL,0,'',?)
    ON CONFLICT(tenant_id) DO UPDATE SET sub_id=excluded.sub_id, slug=excluded.slug, email=excluded.email, tz=CASE WHEN excluded.tz<>'' THEN excluded.tz ELSE payment_holds.tz END,
      failed_at=excluded.failed_at, paid_through=excluded.paid_through, delete_at=excluded.delete_at, state='unpaid', resolved_at=NULL, started_at=NULL, deleted_at=NULL,
      attempts=0, error='', updated_at=excluded.updated_at WHERE payment_holds.state='paid'`).bind(t.id, subId || t.stripe_subscription || "", t.slug || "", email, tz, at, pt, deleteAt, at).run();
  const h = await holdRow(env, t.id);
  if (h?.state !== "unpaid" || h.failed_at !== at) return h;   // another delivery won the race
  log("hold started", t.id, source, new Date(deleteAt).toISOString());
  await notifyFailed(env, h, d, at);
  return h;
}
// From the webhook: the subscription whose plan payment failed (index.js already set the account past_due).
export async function holdFromFailure(env, subId, inv, d = {}, at = Date.now()) {
  const t = await env.DB.prepare("SELECT * FROM tenants WHERE stripe_subscription=?").bind(subId).first(); if (!t) return null;
  // A failed renewal pays for the period starting now; that start is where the paid period ended.
  const hint = inv?.billing_reason === "subscription_cycle" ? Math.min(...(inv.lines?.data || []).map((l) => 1000 * Number(l?.period?.start || 0)).filter((x) => x > 0), Infinity) : 0;
  return holdStart(env, t, { hint: Number.isFinite(hint) ? hint : 0, subId, source: "payment_failed" }, d, at);
}
const periodStartOf = (s) => 1000 * Number(s?.current_period_start || s?.items?.data?.[0]?.current_period_start || 0);
export const unpaidSub = (s) => !!s && (s.status === "past_due" || s.status === "unpaid" || (s.status === "canceled" && s.cancellation_details?.reason === "payment_failed"));
// Bring the hold in line with Stripe's subscription (webhook subscription events, the hourly reconcile). t = the tenant row as it is
// now (after index.js applied the subscription's status).
export async function pastdueSync(env, t, sub, d = {}, at = Date.now()) {
  if (!t || !sub) return null;
  if (unpaidSub(sub) && t.status !== "active") return holdStart(env, t, { hint: periodStartOf(sub), subId: sub.id, source: "sync" }, d, at);
  if (sub.status !== "active" && sub.status !== "trialing") return null;
  await ensurePastdueTables(env);
  if (t.status === "active") return resolveHold(env, t.id, "stripe active", at);
  // Read-only here, on hold, but Stripe says it's paid (every webhook about it was missed): full access again.
  if ((t.status === "past_due" || t.status === "suspended") && (await holdRow(env, t.id))?.state === "unpaid") {
    await env.DB.prepare("UPDATE tenants SET status='active', past_due_since=NULL, sub_status=?, updated_at=? WHERE id=?").bind(sub.status, at, t.id).run();
    return resolveHold(env, t.id, "stripe active (missed webhooks)", at);
  }
  return null;
}

// ---- notices ----
export function holdEmail(kind, h, env, at = Date.now()) {
  const app = appUrl(env, h.slug), when = (ms) => `${fmtDate(ms, h.tz)} at ${fmtTime(ms, h.tz)}`;
  const gone = "your account and everything in it will be permanently deleted: your chats, tasks, files, notes and connected apps. We don't keep a copy of your data, so once it's deleted it can't be recovered.";
  const fix = "Open 1Helm and choose Fix payment to update your card. Everything works again as soon as the payment goes through.";
  const help = `Questions? Write to ${support(env)}.`, button = { label: "Fix payment", url: app };
  const later = Number(h.paid_through) > Number(h.failed_at) + HOUR;
  if (kind === "failed") return mailBody(env, { subject: "Your 1Helm payment didn't go through", button, paras: [
    "Your payment for 1Helm didn't go through, so 1Helm is read-only until you update your card. You can still open the app, read everything and download your files, but your helper is paused: no new tasks, scheduled runs or texts.",
    later ? `Your data is kept until the end of the period you paid for, ${when(h.paid_through)}. If the payment still isn't fixed by then, you have 7 more days: on ${when(h.delete_at)}, ${gone}`
      : `If the payment isn't fixed by ${when(h.delete_at)}, ${gone}`,
    fix, help] });
  if (kind === "window") return mailBody(env, { subject: `Your 1Helm account will be deleted on ${fmtDate(h.delete_at, h.tz, false)}`, button, paras: [
    `Your payment for 1Helm still hasn't gone through, and the period you paid for ended on ${fmtDate(h.paid_through, h.tz)}. 1Helm is read-only.`,
    `On ${when(h.delete_at)}, 7 days from now, ${gone}`, "Want to keep it? " + fix, help] });
  if (kind === "d1") return mailBody(env, { subject: `Last day: your 1Helm account will be deleted on ${fmtDate(h.delete_at, h.tz, false)}`, button, paras: [
    `Your payment for 1Helm still hasn't gone through. On ${when(h.delete_at)}, ${Number(h.delete_at) - at > 0 ? "less than a day from now" : "today"}, ${gone}`, "Want to keep it? " + fix, help] });
  const host = env.APP_HOST || env.GATEWAY_HOST;
  return mailBody(env, { subject: "Your 1Helm account has been deleted", paras: [
    `Your payment for 1Helm didn't go through and wasn't fixed by ${fmtDate(h.delete_at, h.tz)}, so your account and everything in it have now been permanently deleted. We don't keep a copy, so it can't be recovered.`,
    "You won't be charged again.", `If you ever want to come back, you're welcome to start fresh at https://${host}.`, help] });
}
const claim = (env, h, kind, at, delivered, subject) => env.DB.prepare("INSERT OR IGNORE INTO payment_hold_notices (tenant_id,kind,failed_at,sent_at,delivered,subject) VALUES (?,?,?,?,?,?)")
  .bind(h.tenant_id, kind, h.failed_at, at, delivered, subject).run();
const unclaim = (env, h, kind) => env.DB.prepare("DELETE FROM payment_hold_notices WHERE tenant_id=? AND kind=? AND failed_at=?").bind(h.tenant_id, kind, h.failed_at).run();
// Claim, then send; a failed send gives the claim back so the hourly cron retries it. Test addresses (@example.com in TEST_MODE) are
// never emailed; the notice is still recorded (delivered=0).
export async function sendHoldEmail(env, h, kind, d = {}, at = Date.now()) {
  const m = holdEmail(kind, h, env, at), test = isTestAddr(env, h.email);
  if (!(await claim(env, h, kind, at, test || !h.email ? 0 : 1, m.subject)).meta.changes) return false;
  if (!h.email) { log("no email address", h.tenant_id, kind); return false; }
  if (test) return true;
  try { await (d.send || sendMail)(env, { to: h.email, ...m }); }
  catch (e) { await unclaim(env, h, kind); throw e; }
  return true;
}
// The text at failure (texting on): the same words a text to the helper gets back.
async function sendHoldText(env, h, d = {}, at = Date.now()) {
  const body = PAUSED_TEXT(appUrl(env, h.slug));
  if (!(await claim(env, h, "text", at, 1, body)).meta.changes) return false;
  try {
    const r = await (d.text || deliverText)(env, h.tenant_id, body);
    if (!r?.ok) await env.DB.prepare("UPDATE payment_hold_notices SET delivered=0 WHERE tenant_id=? AND kind='text' AND failed_at=?").bind(h.tenant_id, h.failed_at).run();
    return !!r?.ok;
  } catch (e) { await unclaim(env, h, "text"); throw e; }
}
// The first email and text. When the 7-day window starts at once (a failed renewal), the first email already gives the date, so the
// "window" reminder is recorded as covered; inside the last day the "1 day" one is too.
export async function notifyFailed(env, h, d = {}, at = Date.now()) {
  const sent = await sendHoldEmail(env, h, "failed", d, at).catch((e) => { log("failed email", h.tenant_id, e.message); return false; });
  await sendHoldText(env, h, d, at).catch((e) => log("failed text", h.tenant_id, e.message));
  if (sent || isTestAddr(env, h.email)) {
    if (Number(h.paid_through) <= Number(h.failed_at) + HOUR) await claim(env, h, "window", at, 0, "covered by the first email");
    if (Number(h.delete_at) - at <= DAY) await claim(env, h, "d1", at, 0, "covered by the first email");
  }
  return sent;
}
// Which reminder is due: "window" from the end of the paid period, "d1" in the last day. Daytime only (8 AM to 9 PM where they
// are) unless less than 12 hours are left.
export function holdReminderDue(h, at) {
  const left = Number(h.delete_at) - at;
  if (left <= 0) return null;
  if (left <= DAY) return "d1";
  return at >= Number(h.paid_through) ? "window" : null;
}
export async function holdRemind(env, h, d = {}, at = Date.now(), anyHour = false) {
  const kind = holdReminderDue(h, at); if (!kind) return null;
  const hr = localHour(at, h.tz);
  if (!anyHour && (hr < 8 || hr >= 21) && Number(h.delete_at) - at > 12 * HOUR) return null;
  return (await sendHoldEmail(env, h, kind, d, at)) ? kind : null;
}

// ---- the end of the final window ----
export async function endOfHold(env, tid, d = {}, at = Date.now()) {
  const h = await holdRow(env, tid);
  if (!h || (h.state !== "unpaid" && h.state !== "deleting")) return { skipped: h?.state || "none" };
  if (h.state === "deleting" && Number(h.started_at || 0) > at - STALE_DELETING) return { skipped: "in progress" };
  if (Number(h.delete_at) > at) return { skipped: "not yet" };
  const t = await tenantRow(env, tid);
  if (!t) { await missing(env, h, d, at); return { gone: true }; }
  if (t.status === "active") { await resolveHold(env, tid, "active at the end", at); return { paid: true }; }
  // Ask Stripe first: a payment whose webhook we missed is never deleted.
  if (t.stripe_subscription && d.stripe) {
    const sub = await d.stripe(env, `subscriptions/${t.stripe_subscription}`, {}, "GET").catch((e) => /No such subscription/i.test(e?.message || "") ? null : undefined);
    if (sub === undefined) return { skipped: "stripe unreachable" };
    if (sub && (sub.status === "active" || sub.status === "trialing")) {
      await env.DB.prepare("UPDATE tenants SET status='active', past_due_since=NULL, sub_status=?, updated_at=? WHERE id=?").bind(sub.status, at, tid).run();
      await resolveHold(env, tid, "stripe active at the end", at); return { paid: true };
    }
  }
  const del = "deleteAccount" in d ? d.deleteAccount : await loadDeleteAccount();
  if (typeof del !== "function") { await env.DB.prepare("UPDATE payment_holds SET error=?, updated_at=? WHERE tenant_id=?").bind("deleteAccount not available", at, tid).run(); return { waiting: "deleteAccount" }; }
  const c = await env.DB.prepare("UPDATE payment_holds SET state='deleting', started_at=?, attempts=attempts+1, updated_at=? WHERE tenant_id=? AND (state='unpaid' OR (state='deleting' AND started_at<?))")
    .bind(at, at, tid, at - STALE_DELETING).run();
  if (!c.meta.changes) return { skipped: "claimed elsewhere" };
  const email = (await ownerEmail(env, t)) || h.email;
  try { await del(env, tid, { reason: "unpaid" }); }
  catch (e) {
    await env.DB.prepare("UPDATE payment_holds SET state='unpaid', error=?, updated_at=? WHERE tenant_id=?").bind(String(e?.message || e).slice(0, 300), at, tid).run();
    log("delete failed; will retry", tid, e?.message); return { error: String(e?.message || e) };
  }
  await env.DB.prepare("UPDATE payment_holds SET state='deleted', deleted_at=?, email=?, error='', updated_at=? WHERE tenant_id=?").bind(at, email, at, tid).run();
  log("deleted", tid);
  await finalEmail(env, { ...h, email, state: "deleted", deleted_at: at }, d, at);
  return { deleted: true };
}
// "Your account has been deleted", then the address and slug are blanked: after this the row holds only ids and dates.
async function finalEmail(env, h, d, at) {
  let sent = false;
  try { await sendHoldEmail(env, h, "deleted", d, at); sent = true; } catch (e) { log("final email failed; will retry", h.tenant_id, e.message); }
  if (sent || Number(h.deleted_at || at) < at - SCRUB_AFTER) await env.DB.prepare("UPDATE payment_holds SET email='', slug='', updated_at=? WHERE tenant_id=?").bind(at, h.tenant_id).run();
}
// The account row is gone. Past the deletion date: our own deletion, finished by deletion.js's resume after an error here, so the
// final email still goes. Before it: they deleted it themselves (deletion.js normally ends the hold then): no emails, nothing kept.
async function missing(env, h, d, at) {
  if (Number(h.delete_at) > at) return gone(env, h, at);
  await env.DB.prepare("UPDATE payment_holds SET state='deleted', deleted_at=COALESCE(deleted_at,?), updated_at=? WHERE tenant_id=?").bind(at, at, h.tenant_id).run();
  await finalEmail(env, { ...h, state: "deleted", deleted_at: at }, d, at);
}
async function gone(env, h, at) {
  await env.DB.prepare("UPDATE payment_holds SET state='deleted', deleted_at=COALESCE(deleted_at,?), email='', slug='', updated_at=? WHERE tenant_id=?").bind(at, at, h.tenant_id).run();
}

// ---- hourly cron: first notices not yet sent, reminders, deletion, final-email retries ----
export async function pastdueCron(env, d = {}) {
  const at = (d.now || Date.now)(), out = { reminders: 0, deleted: 0, resolved: 0, waiting: 0, errors: 0 };
  await ensurePastdueTables(env);
  const rows = (await env.DB.prepare("SELECT * FROM payment_holds WHERE state IN ('unpaid','deleting') OR (state='deleted' AND email<>'')").all()).results || [];
  for (const h of rows) {
    try {
      if (h.state === "deleted") { await finalEmail(env, h, d, at); continue; }
      const t = await tenantRow(env, h.tenant_id);
      // Gone already: our own deletion, finished by deletion.js's resume after an error here (→ the final email), or they deleted it.
      if (!t) { await missing(env, h, d, at); continue; }
      if (t.status === "deleting") continue;   // they're deleting it themselves right now
      if (t.status === "active" && h.state === "unpaid") { if (await resolveHold(env, h.tenant_id, "active", at)) out.resolved++; continue; }
      if (Number(h.delete_at) <= at) { const x = await endOfHold(env, h.tenant_id, d, at); if (x.deleted) out.deleted++; if (x.paid) out.resolved++; if (x.waiting || x.error) out.waiting++; continue; }
      if (h.state !== "unpaid") continue;
      await notifyFailed(env, h, d, at);   // no-op once sent; a send that failed is retried here
      if (await holdRemind(env, h, d, at)) out.reminders++;
    } catch (e) { out.errors++; log("cron", h.tenant_id, e.message); }
  }
  return { checked: rows.length, ...out };
}

// ---- TEST_MODE only (dev checks; test accounts only, so a real person's account is never switched) ----
//   GET  /api/test/pastdue                  the hold and its notices
//   POST /api/test/pastdue  {op:"fail"}     as if the plan's renewal just failed (read-only now, deletion in 7 days)
//   POST /api/test/pastdue  {op:"pay"}      as if it was paid (full access again)
//   POST /api/test/pastdue  {op:"tick", at} run this account's reminders as if it were `at` (never deletes)
export async function pastdueApi(req, env, t, user, d) {
  const json = d.json, at = (d.now || Date.now)();
  if (env.TEST_MODE !== "1") return json({ error: "unknown" }, 404);
  await ensurePastdueTables(env);
  if (req.method === "GET") return json({ hold: await holdRow(env, t.id), notices: (await env.DB.prepare("SELECT kind, failed_at, sent_at, delivered, subject FROM payment_hold_notices WHERE tenant_id=? ORDER BY sent_at").bind(t.id).all()).results });
  if (!isTestAddr(env, user?.email)) return json({ error: "test accounts only" }, 403);
  const b = await boundedJson(req);
  if (b.op === "fail") {
    await env.DB.prepare("UPDATE tenants SET status='past_due', past_due_since=COALESCE(past_due_since,?), updated_at=? WHERE id=? AND status='active'").bind(at, at, t.id).run();
    return json({ hold: await holdStart(env, await tenantRow(env, t.id), { hint: at, source: "test" }, d, at) });
  }
  if (b.op === "pay") {
    await env.DB.prepare("UPDATE tenants SET status='active', past_due_since=NULL, updated_at=? WHERE id=?").bind(at, t.id).run();
    return json({ resolved: await resolveHold(env, t.id, "test", at) });
  }
  if (b.op === "tick") {
    const h = await holdRow(env, t.id); if (!h || h.state !== "unpaid") return json({ error: "not on hold" }, 409);
    const when = Number(b.at) || at; if (when >= Number(h.delete_at)) return json({ error: "at must be before the deletion date" }, 400);
    return json({ sent: await holdRemind(env, h, d, when, true) });
  }
  return json({ error: "op?" }, 400);
}
