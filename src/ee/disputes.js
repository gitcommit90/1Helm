// Refunds and disputes (charge.refunded, charge.dispute.created, charge.dispute.closed). The account is found from the charge (its customer, else the
// tenant in its metadata, else its invoice's subscription), and the credits the payment bought are found by their grant key (pi:<payment intent> for a
// top-up, invoice:<invoice> for a plan payment). Every step is safe to run twice: credits are taken back by the Ledger's reverse(), which remembers how
// much of each grant it has already handled, and the hold is a tenants.status of 'disputed' that only these functions and invoice/top-up payments lift.
import { mailBody, support, isTestAddr, sendMail } from "./cancel.js";
import { FINAL_WINDOW } from "./pastdue.js";

// Created when a dispute event arrives (like the past-due tables), so a missing migration never breaks billing. state: open (bank opened it), lost (credits taken back,
// read-only until the next payment), won (closed in the customer's favour), paid (a lost dispute's hold ended by a later payment). mailed: the one email was claimed.
const ensure = (env) => env.DB.prepare("CREATE TABLE IF NOT EXISTS payment_disputes (charge_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, state TEXT NOT NULL, mailed INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)").run();
const idOf = (o) => (typeof o === "string" ? o : o?.id || null);
// The account leaves the dispute hold once no dispute is open or lost: active after a paid plan invoice, else the status its subscription has. An account that lands
// unpaid gets a full new final window before deletion, with fresh reminders (the claims of the old window and last-day reminders are given back).
async function lift(env, tid, paid = 0) {
  const r = await env.DB.prepare(`UPDATE tenants SET status=CASE WHEN ? THEN 'active' WHEN sub_status='past_due' THEN 'past_due' WHEN sub_status IN ('unpaid','canceled','incomplete_expired','paused') THEN 'suspended' ELSE 'active' END, updated_at=?
    WHERE id=? AND status='disputed' AND NOT EXISTS (SELECT 1 FROM payment_disputes WHERE tenant_id=? AND state IN ('open','lost'))`).bind(paid, Date.now(), tid, tid).run();
  if (!r.meta.changes) return;
  const end = Date.now() + FINAL_WINDOW;
  if ((await env.DB.prepare("UPDATE payment_holds SET delete_at=?, updated_at=? WHERE tenant_id=? AND state='unpaid' AND delete_at<?").bind(end, Date.now(), tid, end).run()).meta.changes)
    await env.DB.prepare("DELETE FROM payment_hold_notices WHERE tenant_id=? AND kind IN ('window','d1')").bind(tid).run();
}
// A successful top-up, or a paid plan invoice (plan = 1), ends the hold of a lost dispute (never one still open).
// No table yet means no dispute ever happened for any account, so a payment has nothing to lift and must never fail because of it.
export async function disputePaid(env, tid, plan = 0) {
  try { await env.DB.prepare("UPDATE payment_disputes SET state='paid', updated_at=? WHERE tenant_id=? AND state='lost'").bind(Date.now(), tid).run(); }
  catch (e) { if (/no such table/i.test(e?.message)) return; throw e; }
  await lift(env, tid, plan);
}
// What blocks the account, for the read-only message: 'open', 'lost' (all closed, one lost and unpaid: paying is allowed) or null.
export async function disputeOf(env, tid) {
  try { return (await env.DB.prepare("SELECT state FROM payment_disputes WHERE tenant_id=? AND state IN ('open','lost') ORDER BY state='open' DESC LIMIT 1").bind(tid).first())?.state || null; } catch { return null; }
}
const email = (env) => mailBody(env, { subject: "Your bank opened a dispute on a 1Helm payment", paras: [
  "Your bank opened a dispute on a payment you made to 1Helm, so your account is read-only until the dispute is resolved.",
  "You can still open the app, read everything and download your files, but your helper is paused: no new tasks, scheduled runs or texts.", `Questions? Write to ${support(env)}.`] });

export async function disputeEvent(env, ev, { stripe, ledger }) {
  const o = ev.data.object, refund = ev.type === "charge.refunded";
  if (!refund && ev.type !== "charge.dispute.created" && ev.type !== "charge.dispute.closed") return;
  await ensure(env);
  const chargeId = refund ? o.id : idOf(o.charge), first = (q, ...a) => env.DB.prepare(q).bind(...a).first();
  // A charge or invoice Stripe says does not exist can never be found by a retry: it counts as an unknown account. Any other error throws so Stripe retries.
  const read = (path) => stripe(env, path, {}, "GET").catch((e) => { if (e?.status === 404) return null; throw e; });
  const c = refund && o.customer ? o : await read(`charges/${encodeURIComponent(chargeId)}`);   // a dispute carries no customer, so its charge is read
  if (!c) { console.error("disputes: account not found", ev.id); return; }
  let t = c.customer && await first("SELECT * FROM tenants WHERE stripe_customer=?", idOf(c.customer));
  if (!t && c.metadata?.tenant_id) t = await first("SELECT * FROM tenants WHERE id=?", c.metadata.tenant_id);
  if (!t && c.invoice) {
    const inv = await read(`invoices/${idOf(c.invoice)}`), sub = idOf(inv?.parent?.subscription_details?.subscription || inv?.subscription);
    if (sub) t = await first("SELECT * FROM tenants WHERE stripe_subscription=?", sub);
  }
  if (!t) { console.error("disputes: account not found", ev.id); return; }
  // Credits to take back: the refunded share of the payment, or all of it for a lost dispute.
  const takeBack = async (num, den) => {
    const keys = [c.payment_intent && `pi:${idOf(c.payment_intent)}`, c.invoice && `invoice:${idOf(c.invoice)}`].filter(Boolean);
    const r = keys.length && await ledger(env, t.id).reverse(keys, num, den);
    if (!r) console.error("disputes: no credits found for payment", ev.id);
  };
  const hold = (state) => env.DB.prepare("UPDATE tenants SET status='disputed', updated_at=? WHERE id=? AND status<>'deleting' AND EXISTS (SELECT 1 FROM payment_disputes WHERE charge_id=? AND state=?)").bind(Date.now(), t.id, chargeId, state).run();
  if (refund) return takeBack(Number(c.amount_refunded) || 0, Number(c.amount) || 1);
  if (ev.type === "charge.dispute.created") {
    // A closed event that arrived first already left its row, so a late created changes nothing.
    await env.DB.prepare("INSERT OR IGNORE INTO payment_disputes (charge_id,tenant_id,state,mailed,updated_at) VALUES (?,?,'open',0,?)").bind(chargeId, t.id, Date.now()).run();
    await hold("open");
    const m = (await env.DB.prepare("UPDATE payment_disputes SET mailed=1 WHERE charge_id=? AND state='open' AND mailed=0").bind(chargeId).run()).meta.changes;
    const to = m && t.owner_user_id ? (await first("SELECT email FROM users WHERE id=?", t.owner_user_id))?.email : "";
    if (to && !isTestAddr(env, to)) try { await sendMail(env, { to, ...email(env) }); }
    catch (e) { await env.DB.prepare("UPDATE payment_disputes SET mailed=0 WHERE charge_id=?").bind(chargeId).run(); throw e; }
    return;
  }
  const lost = o.status === "lost", state = lost ? "lost" : "won";
  await env.DB.prepare("INSERT INTO payment_disputes (charge_id,tenant_id,state,mailed,updated_at) VALUES (?,?,?,1,?) ON CONFLICT(charge_id) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at WHERE payment_disputes.state='open'").bind(chargeId, t.id, state, Date.now()).run();
  if (lost) { await takeBack(Number(o.amount) || Number(c.amount) || 1, Number(c.amount) || Number(o.amount) || 1); await hold("lost"); } else await lift(env, t.id);
}
