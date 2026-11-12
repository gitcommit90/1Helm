// Change plan in the app (Settings → Usage → Change plan → pick a plan). Needed because extra storage is a second item on the plan's
// subscription (storage.js), and Stripe's portal refuses to update a subscription with more than one item ("cannot update subscription
// … because it has multiple items", checked in test mode 10-06). Same rules the portal had (1HC.md 09-29):
//   - Upgrade: the prorated price difference is charged now (always_invoice) and the change only happens if that payment succeeds
//     (pending_if_incomplete). The invoice.paid webhook grants the extra usage and sets the plan.
//   - Downgrade: waits for the next bill. The plan item's price changes with no proration, so nothing is charged or refunded now; the
//     account keeps what it paid for (tenants.plan, its usage and storage) until the renewal invoice, which is for the new plan.
//   - Undoing a pending downgrade (back to the plan already paid for) costs nothing.
//   - A downgrade whose storage (included + extra blocks) would be below what the account already uses is refused, in plain words
//     (with storage: { used, limit, need } so the app can offer Add storage first).
//   - nextPlan(): the plan the subscription will bill next, when it isn't the one paid for (a pending downgrade), from Stripe.
import { includedGb, storageOf, fmtBytes, fmtGb, GB, BLOCK_GB } from "../storage.js";

// deps: { stripe, PLANS, planPrices(env), planOfPrice(env, priceId) }
export async function changePlan(env, t, target, d) {
  const { stripe, PLANS } = d, prices = d.planPrices(env);
  if (!PLANS[target] || !prices[target]) return { error: "Choose one of the plans.", status: 400 };
  if (!t.stripe_subscription) return { error: "No active plan to change yet.", status: 409 };
  const sub = await stripe(env, `subscriptions/${t.stripe_subscription}`, {}, "GET");
  if (!["active", "trialing"].includes(sub.status)) return { error: sub.status === "past_due" ? "Your last payment didn't go through. Fix your payment first, then change plans." : "Your plan isn't active, so it can't be changed right now.", status: 409 };
  if (sub.cancel_at_period_end || sub.cancel_at) return { error: "Your plan is set to end. Tap Keep my plan first, then change plans.", status: 409 };
  const item = (sub.items?.data || []).find((i) => d.planOfPrice(env, i.price?.id));
  if (!item) return { error: `Couldn't find your plan on your subscription. Contact ${env.SUPPORT_EMAIL || env.EMAIL_FROM} and we'll fix it.`, status: 409 };
  const cur = d.planOfPrice(env, item.price.id), paid = PLANS[t.plan] ? t.plan : cur;
  if (target === cur && target === paid) return { ok: true, plan: target, unchanged: true };
  if (PLANS[target].price > PLANS[paid].price) {
    // Upgrade from what was paid for. A pending downgrade is undone first so Stripe prorates from the paid plan, not the cheaper one.
    if (cur !== paid) await stripe(env, `subscription_items/${item.id}`, { price: prices[paid], proration_behavior: "none" });
    await stripe(env, `subscription_items/${item.id}`, { price: prices[target], proration_behavior: "always_invoice", payment_behavior: "pending_if_incomplete" });
    const after = await stripe(env, `subscriptions/${t.stripe_subscription}`, {}, "GET");
    const now = (after.items?.data || []).find((i) => d.planOfPrice(env, i.price?.id));
    if (d.planOfPrice(env, now?.price?.id) !== target) return { error: "Your card didn't go through, so your plan didn't change. Update your card in Manage billing and try again.", status: 402 };
    await env.DB.prepare("UPDATE tenants SET plan=?, updated_at=? WHERE id=?").bind(target, Date.now(), t.id).run();   // the webhook confirms it and grants the usage
    return { ok: true, plan: target, upgraded: true };
  }
  // Downgrade (or back to the plan already paid for): from the next bill. Check the storage first.
  const s = await storageOf(env, t), limitAfter = (includedGb(target) + s.blocks * BLOCK_GB) * GB;
  if (target !== paid && limitAfter < s.used) {
    const need = Math.ceil((s.used - limitAfter) / (BLOCK_GB * GB));
    return { error: `You're using ${fmtBytes(s.used)}, and ${PLANS[target].name} includes ${fmtGb(includedGb(target))}${s.blocks ? ` (${fmtBytes(limitAfter)} with your extra storage)` : ""}. Delete files you don't need, or add ${need} block${need === 1 ? "" : "s"} of extra storage first.`, status: 409,
      storage: { used: s.used, limit: limitAfter, need, block_gb: BLOCK_GB } };
  }
  await stripe(env, `subscription_items/${item.id}`, { price: prices[target], proration_behavior: "none" });
  const end = 1000 * Number(item.current_period_end || sub.current_period_end || 0) || null;
  return { ok: true, plan: target, ...(target === paid ? { kept: true } : { scheduled: true, from: end }) };
}

// The plan the next bill is for, when it differs from the one paid for (tenants.plan): { plan, name, at (ms) }, else null.
// deps as changePlan's. Throws when Stripe can't be read.
export async function nextPlan(env, t, d) {
  if (!t.stripe_subscription) return null;
  const sub = await d.stripe(env, `subscriptions/${t.stripe_subscription}`, {}, "GET");
  const item = (sub.items?.data || []).find((i) => d.planOfPrice(env, i.price?.id)), np = item && d.planOfPrice(env, item.price.id);
  if (!np || np === t.plan) return null;
  return { plan: np, name: d.PLANS[np]?.name || np, at: 1000 * Number(item.current_period_end || sub.current_period_end || 0) || null };
}
