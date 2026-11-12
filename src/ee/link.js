// Link Agent Wallet (Stripe). The person connects their own Link wallet once (device sign-in); every purchase is a
// spend request they approve in Link on their phone; Link then issues a one-time card locked to that store and amount.
// Everything here runs in the Worker/DOs. Tokens are sealed with VAULT_KEY; card numbers never enter model context,
// logs or chat: browser_fill_card types them straight into the checkout form and the outline shows "•••• (filled)".
// Prototype: link-cli's public client id (Stripe's own device-flow app). Before launch: register 1Helm's own client.
import { sealSecret, openSecret } from "../sentinel.js";
import { purchaseOutcome } from "./purchase-state.js";

const AUTH = "https://login.link.com", API = "https://api.link.com";
const CLIENT_ID = "lwlpk_U7Qy7ThG69STZk";
const SCOPE = "userinfo:read payment_methods.agentic";
const UA = { "User-Agent": "1helm-cloud-proto/0.1 (link-cli-compatible)" };
const form = (o) => new URLSearchParams(o).toString();
const now = () => Date.now();

async function postForm(url, o) {
  const r = await fetch(url, { method: "POST", headers: { ...UA, "content-type": "application/x-www-form-urlencoded" }, body: form(o) });
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch {}
  return { status: r.status, data: d, raw: t };
}
const oauthErr = (d) => d?.error?.code || d?.error || d?.code || "";

// ---- connection (device sign-in, like pairing a TV) ----
export async function linkStartConnect(env, tenantId, label) {
  const r = await postForm(`${AUTH}/device/code`, { client_id: CLIENT_ID, scope: SCOPE, connection_label: label, client_hint: "1Helm" });
  if (r.status < 200 || r.status >= 300) throw new Error(`Link sign-in could not start (${r.status}): ${r.raw.slice(0, 200)}`);
  const d = r.data;
  await env.DB.prepare("INSERT INTO link_pending (tenant_id,sealed_device_code,user_code,url,interval_s,expires_at,last_poll) VALUES (?,?,?,?,?,?,0) ON CONFLICT(tenant_id) DO UPDATE SET sealed_device_code=excluded.sealed_device_code,user_code=excluded.user_code,url=excluded.url,interval_s=excluded.interval_s,expires_at=excluded.expires_at,last_poll=0")
    .bind(tenantId, await sealSecret(env, d.device_code), d.user_code, d.verification_uri_complete || d.verification_uri, Number(d.interval) || 5, now() + (Number(d.expires_in) || 600) * 1000).run();
  return { phrase: d.user_code, url: d.verification_uri_complete || d.verification_uri, expires_in: d.expires_in };
}
async function saveTokens(env, tenantId, t) {
  const sealed = await sealSecret(env, JSON.stringify({ access_token: t.access_token, refresh_token: t.refresh_token }));
  await env.DB.prepare("INSERT INTO link_accounts (tenant_id,sealed,scope,access_expires_at,connected_at) VALUES (?,?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET sealed=excluded.sealed,scope=excluded.scope,access_expires_at=excluded.access_expires_at")
    .bind(tenantId, sealed, t.scope || SCOPE, now() + (Number(t.expires_in) || 3600) * 1000, now()).run();
}
// Called by the account page every few seconds while a sign-in is pending. Polls Link at most at its interval.
export async function linkStatus(env, tenantId) {
  const acct = await env.DB.prepare("SELECT connected_at, email FROM link_accounts WHERE tenant_id=?").bind(tenantId).first();
  const p = await env.DB.prepare("SELECT * FROM link_pending WHERE tenant_id=?").bind(tenantId).first();
  if (!p) return acct ? { connected: true, connected_at: acct.connected_at, email: acct.email } : { connected: false };
  if (now() > p.expires_at) { await env.DB.prepare("DELETE FROM link_pending WHERE tenant_id=?").bind(tenantId).run(); return { connected: !!acct, pending: false, expired: true }; }
  if (now() - p.last_poll < p.interval_s * 1000) return { connected: !!acct, pending: true, phrase: p.user_code, url: p.url };
  await env.DB.prepare("UPDATE link_pending SET last_poll=? WHERE tenant_id=?").bind(now(), tenantId).run();
  const r = await postForm(`${AUTH}/device/token`, { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: await openSecret(env, p.sealed_device_code), client_id: CLIENT_ID });
  if (r.status >= 200 && r.status < 300) {
    await saveTokens(env, tenantId, r.data);
    await env.DB.prepare("DELETE FROM link_pending WHERE tenant_id=?").bind(tenantId).run();
    let email = null; try { email = (await linkApi(env, tenantId, "GET", "/userinfo")).email || null; } catch {}
    if (email) await env.DB.prepare("UPDATE link_accounts SET email=? WHERE tenant_id=?").bind(email, tenantId).run();
    return { connected: true, just_connected: true, email };
  }
  const code = oauthErr(r.data);
  if (code === "authorization_pending" || code === "slow_down") return { connected: !!acct, pending: true, phrase: p.user_code, url: p.url };
  await env.DB.prepare("DELETE FROM link_pending WHERE tenant_id=?").bind(tenantId).run();
  return { connected: !!acct, pending: false, error: code === "access_denied" ? "You declined the connection in Link." : `Link said: ${code || r.status}` };
}
export async function linkDisconnect(env, tenantId) {
  const a = await env.DB.prepare("SELECT sealed FROM link_accounts WHERE tenant_id=?").bind(tenantId).first();
  if (a) { try { const t = JSON.parse(await openSecret(env, a.sealed)); await postForm(`${AUTH}/device/revoke`, { client_id: CLIENT_ID, token: t.refresh_token || t.access_token }); } catch {} }
  await env.DB.prepare("DELETE FROM link_accounts WHERE tenant_id=?").bind(tenantId).run();
  await env.DB.prepare("DELETE FROM link_pending WHERE tenant_id=?").bind(tenantId).run();
  return { ok: true };
}

// ---- authenticated API with refresh ----
async function accessToken(env, tenantId, force = false) {
  const a = await env.DB.prepare("SELECT sealed, access_expires_at FROM link_accounts WHERE tenant_id=?").bind(tenantId).first();
  if (!a) throw Object.assign(new Error("Link isn't connected. The person can connect it in Account → Link."), { code: "not_connected" });
  const t = JSON.parse(await openSecret(env, a.sealed));
  if (!force && now() < a.access_expires_at - 60e3) return t.access_token;
  const r = await postForm(`${AUTH}/device/token`, { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: CLIENT_ID });
  if (r.status < 200 || r.status >= 300) throw Object.assign(new Error("The Link connection expired. The person needs to reconnect Link in Account."), { code: "reauth" });
  await saveTokens(env, tenantId, { ...r.data, refresh_token: r.data.refresh_token || t.refresh_token });
  return r.data.access_token;
}
export async function linkApi(env, tenantId, method, path, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const tok = await accessToken(env, tenantId, attempt > 0);
    const r = await fetch(`${API}${path}`, { method, headers: { ...UA, authorization: `Bearer ${tok}`, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (r.status === 401 && attempt === 0) continue;
    const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch {}
    if (r.status === 404) return null;
    if (r.status < 200 || r.status >= 300) throw Object.assign(new Error(d?.error?.message || d?.message || `Link API ${r.status}: ${t.slice(0, 200)}`), { status: r.status, details: d });
    return d;
  }
}

// ---- purchases ----
const pub = (s) => s && ({ id: s.id, status: s.status, amount: s.amount, currency: s.currency, merchant_name: s.merchant_name, merchant_url: s.merchant_url, card_last4: s.card_last4 || s.card?.number?.slice(-4) || null, approval_url: s.approval_url || null, next_action: s.status_details?.requires_action?.next_action?.display_message || null, test: !!s.test });
export async function linkCreatePurchase(env, tenantId, channel, a) {
  const amount = Math.round(Number(a.amount_cents)); if (!(amount > 0)) throw new Error("amount_cents must be a positive whole number of cents");
  if (amount > 50000) throw new Error("Link agent purchases are capped at $500 each");
  const context = String(a.context || ""); if (context.length < 100) throw new Error("context must be at least 100 characters: what is being bought, from where, the total including shipping/tax, and why. The person reads this in Link before approving.");
  let mu; try { mu = new URL(String(a.merchant_url)); } catch { throw new Error("merchant_url must be the store's full https URL"); }
  const test = env.LINK_REAL !== "1" ? true : !!a.test;   // no real Link charge until LINK_REAL=1 is set on purpose (independent of TEST_MODE)
  const methods = (await linkApi(env, tenantId, "GET", "/payment-details"))?.payment_details || [];
  const pm = methods.find((m) => m.is_default) || methods[0];
  if (!pm) throw new Error("There's no card in the person's Link wallet. They can add one at app.link.com.");
  const sr = await linkApi(env, tenantId, "POST", "/spend_requests", { payment_details: pm.id, credential_type: "card", amount, currency: String(a.currency || "usd").toLowerCase(),
    merchant_name: String(a.merchant_name || mu.host).slice(0, 100), merchant_url: mu.origin + mu.pathname, context, request_approval: true, ...(test ? { test: true } : {}) });
  let approval = sr.approval_url;
  if (!approval && (sr.status === "created" || sr.status === "pending_approval")) { try { approval = (await linkApi(env, tenantId, "POST", `/spend_requests/${sr.id}/request_approval`))?.approval_url; } catch {} }
  await env.DB.prepare("INSERT INTO link_purchases (id,tenant_id,channel,amount,currency,merchant_name,merchant_url,context,test,status,approval_url,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(sr.id, tenantId, channel, amount, sr.currency || "usd", sr.merchant_name || null, sr.merchant_url || null, context, test ? 1 : 0, sr.status, approval || null, now(), now()).run();
  return { ...pub(sr), approval_url: approval || null, test };
}
export async function linkGetPurchase(env, tenantId, id, withCard = false) {
  const own = await env.DB.prepare("SELECT * FROM link_purchases WHERE id=? AND tenant_id=?").bind(String(id), tenantId).first();
  if (!own) throw new Error("no such purchase in this account");
  const sr = await linkApi(env, tenantId, "GET", `/spend_requests/${encodeURIComponent(own.id)}${withCard ? "?include=card" : ""}`);
  if (!sr) throw new Error("Link no longer has that purchase");
  await env.DB.prepare("UPDATE link_purchases SET status=?, card_last4=COALESCE(?,card_last4), updated_at=? WHERE id=?").bind(sr.status, sr.card_last4 || sr.card?.number?.slice(-4) || null, now(), own.id).run();
  const fresh = await env.DB.prepare("SELECT * FROM link_purchases WHERE id=?").bind(own.id).first().catch(() => null) || own;
  const outcome = purchaseOutcome({ ...fresh, status: sr.status });
  return withCard ? { public: { ...pub(sr), test: !!own.test }, card: sr.card || null } : { ...pub(sr), test: !!own.test, approval_url: own.approval_url, outcome };
}
export async function linkListPurchases(env, tenantId) {
  const rows = (await env.DB.prepare("SELECT id,channel,amount,currency,merchant_name,merchant_url,status,card_last4,test,created_at,card_filled_at,card_filled_host,fill_failed_at,fill_failed_why,handoff_at FROM link_purchases WHERE tenant_id=? ORDER BY created_at DESC LIMIT 20").bind(tenantId).all()).results;
  return rows.map((r) => ({ id: r.id, channel: r.channel, amount: r.amount, currency: r.currency, merchant_name: r.merchant_name, merchant_url: r.merchant_url, status: r.status, card_last4: r.card_last4, test: r.test, created_at: r.created_at, outcome: purchaseOutcome(r) }));
}
// Facts 1Helm records as they happen. Never any card data: only the site host and a short plain reason.
// Each write is stamped strictly later than every fact already on the row (a tie in the same millisecond would hide which came last).
const LATER = "MAX(?, COALESCE(card_filled_at,0)+1, COALESCE(fill_failed_at,0)+1, COALESCE(handoff_at,0)+1)";
export async function linkNoteFill(env, tenantId, id, { ok, host, why }) {
  const at = now();
  try {
    if (ok) await env.DB.prepare(`UPDATE link_purchases SET card_filled_at=${LATER}, card_filled_host=? WHERE id=? AND tenant_id=?`).bind(at, String(host || "").slice(0, 100) || null, String(id), tenantId).run();
    else await env.DB.prepare(`UPDATE link_purchases SET fill_failed_at=${LATER}, fill_failed_why=? WHERE id=? AND tenant_id=?`).bind(at, String(why || "").slice(0, 200) || null, String(id), tenantId).run();
  } catch {}
}
// The channel's newest approved purchase that no one has handed off yet (a handoff is not tied to a purchase id).
export async function linkNoteHandoff(env, tenantId, channel) {
  try {
    const at = now();
    await env.DB.prepare(`UPDATE link_purchases SET handoff_at=${LATER} WHERE id=(SELECT id FROM link_purchases WHERE tenant_id=? AND channel=? AND status='approved' AND updated_at>? ORDER BY created_at DESC LIMIT 1)`).bind(at, tenantId, channel, at - 6 * 3600e3).run();
  } catch {}
}
