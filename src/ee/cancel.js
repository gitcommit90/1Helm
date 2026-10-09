import { boundedJson } from "../bounded-body.js";
// Cancel at period end (Captain 10-06): "If a user cancels, cancel at the end of their paid period, with reminders leading up to it
// that their data will be fully deleted with no recovery option because we don't store your data. No refunds. No trials."
//
//  - Cancel (Settings → Usage → Cancel plan, after an ask() that names the date): Stripe cancel_at_period_end=true. Nothing is
//    prorated or refunded; the plan keeps working until the period ends. Keep my plan (banner or Settings) sets it back to false.
//    A cancel made in Stripe's own portal is picked up by the webhook (and the hourly reconcile) the same way.
//  - Email: a confirmation when they cancel, then reminders 7, 3 and 1 day before the end (only the ones that still fit), then a
//    final "deleted" email. Each is claimed in plan_cancel_notices before it's sent, so none ever repeats.
//  - At the end: customer.subscription.deleted (webhook) or the hourly cron fallback calls
//    deleteAccount(env, tenantId, { reason: "cancelled" }) from src/deletion.js, once: plan_cancellations.state is claimed
//    scheduled → deleting → deleted, so webhook + cron firing together delete once. The cron only deletes after Stripe confirms the
//    subscription really ended (a cancel undone in the portal with a missed webhook is never deleted).
// index.js only hooks in: cancelApi() for /api/plan/cancel|keep (+ TEST_MODE helpers), cancelWebhook() in the Stripe webhook,
// cancelSync() in the hourly reconcile, cancelCron() on the hourly cron. Tables: migrations_026_plan_cancel.sql.

export const DAY = 86400e3, HOUR = 3600e3;
export const REMIND_DAYS = [7, 3, 1];
export const support = (env) => env.SUPPORT_EMAIL || env.EMAIL_FROM;
const STALE_DELETING = 30 * 60e3;      // a "deleting" claim older than this was a crash: retry it
const EARLY_SLACK = HOUR;              // a subscription that ends earlier than the date we promised isn't deleted before that date
const SCRUB_AFTER = 3 * DAY;           // the final email gets 3 days of retries; then the address is blanked regardless
const TEST_ADDR = /@example\.(com|org|net)$/i;

// Load core account deletion when a paid subscription has ended.
let delCache;
export async function loadDeleteAccount() {
  if (delCache !== undefined) return delCache;
  try { const m = await import("../deletion.js"); delCache = typeof m.deleteAccount === "function" ? m.deleteAccount : null; }
  catch { delCache = null; }
  return delCache;
}
// Tests only: stand in for deletion.js (null = "not built yet").
export const _setDeleteAccount = (fn) => { delCache = fn; };

const live = (s) => !!s && s.status !== "canceled" && s.status !== "incomplete_expired";
const cancelling = (s) => live(s) && !!(s.cancel_at_period_end || s.cancel_at);
// Stripe moved current_period_end onto the subscription items (API 2025-03); cancel_at is set while cancelling.
export const periodEndOf = (s) => 1000 * Number(s?.cancel_at || s?.current_period_end || s?.items?.data?.[0]?.current_period_end || s?.ended_at || 0);

export const okTz = (tz) => { if (!tz) return ""; try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return String(tz).slice(0, 64); } catch { return ""; } };
export const fmtDate = (ms, tz, year = true) => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", ...(year ? { year: "numeric" } : {}), timeZone: okTz(tz) || "UTC" }).format(ms);
export const fmtTime = (ms, tz) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone: okTz(tz) || "UTC" }).format(ms);
export const localHour = (ms, tz) => Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: okTz(tz) || "UTC" }).format(ms));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---- the emails (plain words: what happens, the date, how to keep the plan, support) ----
export function cancelEmail(kind, r, env, at = Date.now()) {
  const host = env.APP_HOST || env.GATEWAY_HOST;
  const app = `https://${host}/w/${r.slug}/app`, when = `${fmtDate(r.period_end, r.tz)} at ${fmtTime(r.period_end, r.tz)}`;
  const gone = "your account and everything in it will be permanently deleted: your chats, tasks, files, notes and connected apps. We don't keep a copy of your data, so once it's deleted it can't be recovered.";
  const help = `Questions? Write to ${support(env)}.`;
  let subject, paras, button = { label: "Keep my plan", url: app };
  if (kind === "cancelled") {
    subject = `Your 1Helm plan ends on ${fmtDate(r.period_end, r.tz, false)}`;
    paras = [`You cancelled your 1Helm plan. Everything keeps working until ${when}.`,
      `Then ${gone} There are no refunds.`,
      "Changed your mind? Open 1Helm and choose Keep my plan any time before then.", help];
  } else if (kind === "deleted") {
    subject = "Your 1Helm account has been deleted";
    button = null;
    paras = [`Your 1Helm plan ended on ${fmtDate(r.period_end, r.tz)}, and your account and everything in it have now been permanently deleted. We don't keep a copy, so it can't be recovered.`,
      "You won't be charged again.", `If you ever want to come back, you're welcome to start fresh at https://${host}.`, help, "Thank you for using 1Helm."];
  } else {
    const n = Math.max(1, Math.ceil((r.period_end - at) / DAY));
    subject = `${n > 1 ? `${n} days left` : "Last day"}: your 1Helm account will be deleted on ${fmtDate(r.period_end, r.tz, false)}`;
    paras = [`Your 1Helm plan ends on ${when}. ${n > 1 ? `That's ${n} days from now.` : "That's less than a day from now."}`,
      `At that time ${gone}`,
      "Want to keep it? Open 1Helm and choose Keep my plan before then. Nothing changes and nothing is lost.", help];
  }
  return mailBody(env, { subject, paras, button, quietLast: kind !== "deleted" });
}
// The billing emails' one look (cancel.js and pastdue.js): plain paragraphs, the last one small and grey (the support line) unless
// quietLast is false, and one button. The text version ends with "<button label>: <url>".
export function mailBody(env, { subject, paras, button = null, quietLast = true }) {
  const host = env.APP_HOST || env.GATEWAY_HOST;
  const text = `${paras.join("\n\n")}${button ? `\n\n${button.label}: ${button.url}` : ""}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f3f2ef;font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:#1c1b19"><div style="max-width:480px;margin:40px auto;background:#fff;border-radius:18px;padding:36px 32px"><img src="https://${esc(env.GATEWAY_HOST || host)}/1helm-icon-64.png" width="40" height="40" alt="1Helm" style="border-radius:10px"><h1 style="font-size:22px;margin:22px 0 8px">${esc(subject)}</h1>${paras.map((p, i) => `<p style="margin:0 0 16px;color:${i === paras.length - 1 && quietLast ? "#8a867e;font-size:14px" : "#3a3833"}">${esc(p)}</p>`).join("")}${button ? `<a href="${esc(button.url)}" style="display:inline-block;margin-top:4px;background:#1c1b19;color:#fff;text-decoration:none;padding:13px 22px;border-radius:12px;font-weight:600">${esc(button.label)}</a>` : ""}</div></body></html>`;
  return { subject, text, html };
}

// ---- D1 ----
const rec = (env, tenantId) => env.DB.prepare("SELECT * FROM plan_cancellations WHERE tenant_id=?").bind(tenantId).first();
const ownerEmail = async (env, t) => t?.owner_user_id ? (await env.DB.prepare("SELECT email FROM users WHERE id=?").bind(t.owner_user_id).first())?.email || "" : "";
const log = (...a) => console.log("cancel:", ...a);

// Schedule (or re-schedule after Keep my plan). Never revives an account that's being or has been deleted.
// Returns the row and whether it just became scheduled (→ send the cancellation email).
export async function recordCancel(env, t, { periodEnd, subId, email, tz, via = "app" }, at = Date.now()) {
  const before = await rec(env, t.id);
  if (before && (before.state === "deleting" || before.state === "deleted")) return { row: before, fresh: false };
  await env.DB.prepare(`INSERT INTO plan_cancellations (tenant_id,sub_id,slug,email,tz,period_end,requested_at,via,state,updated_at) VALUES (?,?,?,?,?,?,?,?,'scheduled',?)
    ON CONFLICT(tenant_id) DO UPDATE SET sub_id=excluded.sub_id, slug=excluded.slug, email=CASE WHEN excluded.email<>'' THEN excluded.email ELSE plan_cancellations.email END,
      tz=CASE WHEN excluded.tz<>'' THEN excluded.tz ELSE plan_cancellations.tz END, period_end=excluded.period_end,
      requested_at=CASE WHEN plan_cancellations.state='scheduled' THEN plan_cancellations.requested_at ELSE excluded.requested_at END,
      via=CASE WHEN plan_cancellations.state='scheduled' THEN plan_cancellations.via ELSE excluded.via END, state='scheduled', error='', updated_at=excluded.updated_at
    WHERE plan_cancellations.state IN ('scheduled','kept')`).bind(t.id, subId || t.stripe_subscription || "", t.slug || "", email || "", okTz(tz), periodEnd, at, via, at).run();
  return { row: await rec(env, t.id), fresh: before?.state !== "scheduled" };
}
const markKept = (env, tenantId, at = Date.now()) => env.DB.prepare("UPDATE plan_cancellations SET state='kept', error='', updated_at=? WHERE tenant_id=? AND state='scheduled'").bind(at, tenantId).run();

export const isTestAddr = (env, email) => env.TEST_MODE === "1" && TEST_ADDR.test(email || "");
export const sendMail = (env, m) => env.EMAIL.send({ to: m.to, from: { email: env.EMAIL_FROM, name: "1Helm" }, subject: m.subject, html: m.html, text: m.text });

// Claim, then send. A failed send gives the claim back so the next cron tick retries it. Test addresses (@example.com in
// TEST_MODE) are never emailed; the notice is still recorded (delivered=0) so tests and dev checks can see what would have gone.
export async function sendNotice(env, r, kind, d = {}, at = Date.now()) {
  const m = cancelEmail(kind, r, env, at), test = isTestAddr(env, r.email);
  const claim = await env.DB.prepare("INSERT OR IGNORE INTO plan_cancel_notices (tenant_id,kind,period_end,sent_at,delivered,subject) VALUES (?,?,?,?,?,?)")
    .bind(r.tenant_id, kind, r.period_end, at, test || !r.email ? 0 : 1, m.subject).run();
  if (!claim.meta.changes) return false;
  if (!r.email) { log("no email address", r.tenant_id, kind); return false; }
  if (test) return true;
  try { await (d.send || sendMail)(env, { to: r.email, ...m }); }
  catch (e) { await env.DB.prepare("DELETE FROM plan_cancel_notices WHERE tenant_id=? AND kind=? AND period_end=?").bind(r.tenant_id, kind, r.period_end).run(); throw e; }
  return true;
}
// Which reminder is due now: the nearest of 7/3/1 days whose window we're in (a late cancel only gets the ones that still fit).
export const reminderDue = (periodEnd, at) => { const left = periodEnd - at; if (left <= 0) return null; const k = [...REMIND_DAYS].sort((a, b) => a - b).find((n) => left <= n * DAY); return k ? `d${k}` : null; };
// The cancellation email stands in for any reminder that's already due when they cancel (no two emails in one minute).
async function confirmCancel(env, r, d, at) {
  const sent = await sendNotice(env, r, "cancelled", d, at).catch((e) => { log("cancelled email failed", r.tenant_id, e.message); return false; });
  if (!sent) return false;
  const due = reminderDue(r.period_end, at), k = due ? Number(due.slice(1)) : 0;
  for (const n of REMIND_DAYS) if (k && n >= k) await env.DB.prepare("INSERT OR IGNORE INTO plan_cancel_notices (tenant_id,kind,period_end,sent_at,delivered,subject) VALUES (?,?,?,?,0,'covered by the cancellation email')").bind(r.tenant_id, `d${n}`, r.period_end, at).run();
  return true;
}
// Reminders go out in the daytime where the person is (8 AM to 9 PM), unless less than 12 hours are left.
export async function remind(env, r, d = {}, at = Date.now(), anyHour = false) {
  const kind = reminderDue(r.period_end, at); if (!kind) return null;
  const h = localHour(at, r.tz);
  if (!anyHour && (h < 8 || h >= 21) && r.period_end - at > 12 * HOUR) return null;
  return (await sendNotice(env, r, kind, d, at)) ? kind : null;
}

// The end of the paid period: delete the account once, then send the final email.
export async function endOfPeriod(env, tenantId, { sub = null, source = "cron" } = {}, d = {}, at = Date.now()) {
  const r = await rec(env, tenantId);
  if (!r || (r.state !== "scheduled" && r.state !== "deleting")) return { skipped: r?.state || "none" };
  if (r.state === "deleting" && Number(r.started_at || 0) > at - STALE_DELETING) return { skipped: "in progress" };
  if (r.period_end > at + EARLY_SLACK) return { skipped: "not yet" };
  if (!sub && r.sub_id && d.stripe) sub = await d.stripe(env, `subscriptions/${r.sub_id}`, {}, "GET").catch((e) => { log("stripe check failed", tenantId, e.message); return undefined; });
  if (sub === undefined) return { skipped: "stripe unreachable" };
  if (live(sub)) {
    if (!cancelling(sub)) { await markKept(env, tenantId, at); return { kept: true }; }
    return { skipped: "stripe has not ended it yet" };
  }
  const del = "deleteAccount" in d ? d.deleteAccount : await loadDeleteAccount();
  if (typeof del !== "function") {
    await env.DB.prepare("UPDATE plan_cancellations SET error=?, updated_at=? WHERE tenant_id=?").bind("deleteAccount not available yet (src/deletion.js)", at, tenantId).run();
    log("deleteAccount not available yet; will retry", tenantId);
    return { waiting: "deleteAccount" };
  }
  const claim = await env.DB.prepare("UPDATE plan_cancellations SET state='deleting', started_at=?, attempts=attempts+1, updated_at=? WHERE tenant_id=? AND (state='scheduled' OR (state='deleting' AND started_at<?))")
    .bind(at, at, tenantId, at - STALE_DELETING).run();
  if (!claim.meta.changes) return { skipped: "claimed elsewhere" };
  // The address they have right now (it may have changed since they cancelled), for the final email.
  const t = await env.DB.prepare("SELECT * FROM tenants WHERE id=?").bind(tenantId).first();
  const email = (await ownerEmail(env, t)) || r.email;
  if (email !== r.email) await env.DB.prepare("UPDATE plan_cancellations SET email=? WHERE tenant_id=?").bind(email, tenantId).run();
  try { await del(env, tenantId, { reason: "cancelled" }); }
  catch (e) {
    await env.DB.prepare("UPDATE plan_cancellations SET state='scheduled', error=?, updated_at=? WHERE tenant_id=?").bind(String(e?.message || e).slice(0, 300), at, tenantId).run();
    log("delete failed; will retry", tenantId, e?.message);
    return { error: String(e?.message || e) };
  }
  await env.DB.prepare("UPDATE plan_cancellations SET state='deleted', deleted_at=?, error='', updated_at=? WHERE tenant_id=?").bind(at, at, tenantId).run();
  log("deleted", tenantId, source);
  await finalEmail(env, { ...r, email, state: "deleted", deleted_at: at }, d, at);
  return { deleted: true, source };
}
// "Your account has been deleted", then the address and slug are blanked: after this we hold nothing but an account id.
async function finalEmail(env, r, d, at) {
  let sent = false;
  try { await sendNotice(env, r, "deleted", d, at); sent = true; } catch (e) { log("final email failed; will retry", r.tenant_id, e.message); }
  if (sent || Number(r.deleted_at || at) < at - SCRUB_AFTER) await env.DB.prepare("UPDATE plan_cancellations SET email='', slug='', updated_at=? WHERE tenant_id=?").bind(at, r.tenant_id).run();
}

// Bring our record in line with Stripe's subscription (portal cancels/renews, missed webhooks).
export async function syncFromSub(env, t, sub, via, d = {}, at = Date.now()) {
  if (cancelling(sub)) {
    const cur = await rec(env, t.id), end = periodEndOf(sub);
    if (cur?.state === "scheduled" && cur.period_end === end) return cur;
    const { row, fresh } = await recordCancel(env, t, { periodEnd: end, subId: sub.id, email: await ownerEmail(env, t), via }, at);
    if (fresh && row?.state === "scheduled") await confirmCancel(env, row, d, at);
    return row;
  }
  if (live(sub)) await markKept(env, t.id, at);
  return null;
}
// Hourly reconcile hook: one subscription it just fetched.
export async function cancelSync(env, tenantId, sub, d = {}) {
  if (!cancelling(sub)) { if (live(sub)) await markKept(env, tenantId); return; }
  const t = await env.DB.prepare("SELECT * FROM tenants WHERE id=?").bind(tenantId).first();
  if (t) await syncFromSub(env, t, sub, "sync", d);
}

// Stripe webhook hook (signature already verified and the event id de-duplicated by the caller).
export async function cancelWebhook(env, ev, d = {}) {
  const o = ev?.data?.object; if (!o || o.object !== "subscription") return null;
  const at = (d.now || Date.now)();
  if (ev.type === "customer.subscription.updated") {
    const prev = ev.data.previous_attributes || {};
    if (!("cancel_at_period_end" in prev) && !("cancel_at" in prev)) return null;
    const t = await env.DB.prepare("SELECT * FROM tenants WHERE stripe_subscription=?").bind(o.id).first(); if (!t) return null;
    // Events can arrive out of order: act on Stripe's current state, not the event's snapshot.
    const sub = d.stripe ? await d.stripe(env, `subscriptions/${o.id}`, {}, "GET").catch(() => o) : o;
    return syncFromSub(env, t, sub, "portal", d, at);
  }
  if (ev.type === "customer.subscription.deleted") {
    let r = await env.DB.prepare("SELECT * FROM plan_cancellations WHERE sub_id=?").bind(o.id).first();
    if (!r) {
      // A portal cancel at period end whose earlier events we never saw: they did cancel, and the period is over.
      const t = await env.DB.prepare("SELECT * FROM tenants WHERE stripe_subscription=?").bind(o.id).first();
      if (!t || !o.cancel_at_period_end) return null;   // ended for another reason (unpaid, removed by hand): no deletion
      r = (await recordCancel(env, t, { periodEnd: periodEndOf(o) || at, subId: o.id, email: await ownerEmail(env, t), via: "portal" }, at)).row;
    }
    return endOfPeriod(env, r.tenant_id, { sub: o, source: "webhook" }, d, at);
  }
  return null;
}

// Hourly cron: reminders, the deletion fallback, and final-email retries.
export async function cancelCron(env, d = {}) {
  const at = (d.now || Date.now)(), out = { reminders: 0, deleted: 0, waiting: 0, errors: 0 };
  const rows = (await env.DB.prepare("SELECT * FROM plan_cancellations WHERE state IN ('scheduled','deleting') OR (state='deleted' AND email<>'')").all()).results || [];
  for (const r of rows) {
    try {
      if (r.state === "deleted") { await finalEmail(env, r, d, at); continue; }
      if (r.period_end <= at) { const x = await endOfPeriod(env, r.tenant_id, {}, d, at); if (x.deleted) out.deleted++; if (x.waiting || x.error) out.waiting++; continue; }
      if (r.state === "scheduled" && await remind(env, r, d, at)) out.reminders++;
    } catch (e) { out.errors++; log("cron", r.tenant_id, e.message); }
  }
  return { checked: rows.length, ...out };
}

// ---- the app's API: /w/<slug>/api/plan/cancel (GET status, POST cancel), /api/plan/keep (POST) ----
export async function cancelApi(req, env, t, user, sub, d) {
  const json = d.json, at = (d.now || Date.now)();
  const body = req.method === "POST" ? await boundedJson(req) : {};
  const view = (r) => r?.state === "scheduled" ? { cancelling: true, ends_at: r.period_end } : { cancelling: false };
  const getSub = () => d.stripe(env, `subscriptions/${t.stripe_subscription}`, {}, "GET");
  try {
    if (sub === "/api/plan/cancel" && req.method === "GET") {
      const r = await rec(env, t.id);
      if (new URL(req.url).searchParams.get("fresh") !== "1" || !t.stripe_subscription) return json({ ...view(r), can_cancel: !!t.stripe_subscription });
      const s = await getSub(), row = await syncFromSub(env, t, s, "sync", d, at);
      return json({ ...view(row || await rec(env, t.id)), can_cancel: live(s), period_end: periodEndOf(s) });
    }
    if (sub === "/api/plan/cancel" && req.method === "POST") {
      if (!t.stripe_subscription) return json({ error: "There's no plan to cancel." }, 409);
      let s = await getSub();
      if (!live(s)) return json({ error: "Your plan has already ended." }, 409);
      // At period end only: no proration, no refund. (Never DELETE the subscription here: that would end it now.)
      if (!s.cancel_at_period_end) s = await d.stripe(env, `subscriptions/${t.stripe_subscription}`, { cancel_at_period_end: "true", proration_behavior: "none" });
      const { row, fresh } = await recordCancel(env, t, { periodEnd: periodEndOf(s), subId: s.id, email: user?.email || await ownerEmail(env, t), tz: body.tz, via: "app" }, at);
      if (fresh && row?.state === "scheduled") await confirmCancel(env, row, d, at);
      return json(view(row));
    }
    if (sub === "/api/plan/keep" && req.method === "POST") {
      if (!t.stripe_subscription) return json({ error: "There's no plan to keep." }, 409);
      const s = await getSub();
      if (!live(s)) return json({ error: `Your plan has already ended. Write to ${support(env)} if you need help.` }, 409);
      if (s.cancel_at_period_end) await d.stripe(env, `subscriptions/${t.stripe_subscription}`, { cancel_at_period_end: "false" });
      else if (s.cancel_at) await d.stripe(env, `subscriptions/${t.stripe_subscription}`, { cancel_at: "" });   // a cancel date set by hand: "" clears it
      await markKept(env, t.id, at);
      return json({ cancelling: false });
    }
    if (env.TEST_MODE === "1" && sub === "/api/test/cancel-notices") {
      const rows = (await env.DB.prepare("SELECT kind, period_end, sent_at, delivered, subject FROM plan_cancel_notices WHERE tenant_id=? ORDER BY sent_at").bind(t.id).all()).results;
      return json({ record: await rec(env, t.id), notices: rows });
    }
    // Dev check: run this account's reminders as if it were `at` (never deletes; deletion needs Stripe to say it ended).
    if (env.TEST_MODE === "1" && sub === "/api/test/cancel-tick" && req.method === "POST") {
      const r = await rec(env, t.id); if (!r || r.state !== "scheduled") return json({ error: "not cancelling" }, 409);
      const when = Number(body.at) || at; if (when >= r.period_end) return json({ error: "at must be before the period end" }, 400);
      return json({ sent: await remind(env, r, d, when, true) });
    }
  } catch (e) { console.error("cancel api", sub, e?.message); return json({ error: "Something went wrong on our side. Try again in a minute." }, 502); }
  return json({ error: "unknown" }, 404);
}
