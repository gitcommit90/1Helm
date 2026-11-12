// Add credits: the saved card lookup and the confirmation token that /api/topup requires.
// The app asks POST /api/topup/confirm {pack} when the person taps an amount. The answer names the card (brand and last 4 only) and carries a
// token signed by the server for this tenant and this amount, valid for 2 minutes. POST /api/topup refuses to charge without a valid token,
// so a single request, an old open tab or a stray tap can never move money.
const te = new TextEncoder();
export const TOPUP_CENTS = { 10: 1000, 25: 2500, 50: 5000 };
export const CONFIRM_TTL_MS = 120e3;

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
async function macKey(env) {
  if (!env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY missing");
  const base = await crypto.subtle.importKey("raw", te.encode(env.STRIPE_SECRET_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const derived = await crypto.subtle.sign("HMAC", base, te.encode("1hc topup confirm v1"));   // never reuse the Stripe key itself
  return crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
const signed = (tenant, pack, exp) => te.encode(`${tenant}\n${pack}\n${exp}`);

export async function issueConfirm(env, tenant, pack, nowMs = Date.now()) {
  const exp = nowMs + CONFIRM_TTL_MS;
  return `${exp}.${hex(await crypto.subtle.sign("HMAC", await macKey(env), signed(tenant, pack, exp)))}`;
}
export async function checkConfirm(env, tenant, pack, token, nowMs = Date.now()) {
  const m = /^(\d{10,16})\.([0-9a-f]{64})$/.exec(typeof token === "string" ? token : "");
  if (!m || Number(m[1]) < nowMs || Number(m[1]) > nowMs + CONFIRM_TTL_MS) return false;
  const sig = Uint8Array.from(m[2].match(/../g), (h) => parseInt(h, 16));
  return crypto.subtle.verify("HMAC", await macKey(env), sig, signed(tenant, pack, Number(m[1])));
}

// The card /api/topup charges: the customer's default, else the subscription's, else the first saved card.
// Returns { id, brand, last4 } or null. `stripe` is the Worker's Stripe caller (path, params, method).
export async function savedCard(stripe, t, { details = true } = {}) {
  const cust = await stripe(`customers/${t.stripe_customer}`, {}, "GET");
  let pm = cust.invoice_settings?.default_payment_method;
  if (!pm && t.stripe_subscription) pm = (await stripe(`subscriptions/${t.stripe_subscription}`, {}, "GET")).default_payment_method;
  if (!pm) pm = (await stripe(`customers/${t.stripe_customer}/payment_methods?limit=1`, {}, "GET")).data?.[0]?.id;
  if (!pm) return null;
  const id = typeof pm === "string" ? pm : pm.id;
  if (!details) return { id };   // the charge only needs the id
  const card = typeof pm === "object" && pm.card ? pm : await stripe(`payment_methods/${id}`, {}, "GET");
  return { id, brand: card.card?.brand || "card", last4: card.card?.last4 || "" };
}
