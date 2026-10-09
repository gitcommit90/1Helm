// Settings → General → Your account: your name, your sign-in email, and the devices you're signed in on.
// 1Helm has no passwords: you sign in with a one-time link emailed to you (index.js /auth/start → /auth/verify), and a
// session is a random cookie whose sha256 is a row in D1 `sessions` (30 days).
//
// Owner API (inside the signed-in /w/<slug> block; JSON POSTs only, same origin only):
//   GET  /api/account                  → { name, email, pending: { email, expires } | null, sessions: [{ id, current, device, place, created, expires }] }
//   POST /api/account/name   { name }  → { ok, name }                      (tenants.first_name: what the helper calls you)
//   POST /api/account/email  { email } → { ok, sent_to, expires[, test_link] }   a one-time link goes to the NEW address
//   POST /api/account/email/cancel     → { ok }
//   POST /api/account/signout { id } | { others: true } → { ok, signed_out }
//   POST /api/account/privacy { level } → { ok, ai_privacy: { level, chosen, version, at } }   (AI data privacy, privacy.js; validated
//        server-side: unrestricted | no_training | zdr; any other value is refused, never stored. The /w/<slug> block already checked
//        that the signed-in user owns this tenant; the next model dispatch, background jobs included, reads the new level.)
// Public (the link in the email; works signed out, on any device):
//   GET  /auth/email-change?token=…    → a page with one button (a link scanner fetching the link can't switch anything)
//   POST /auth/email-change  token=…   → switches users.email, emails the OLD address that it changed
//
// Safety: the new address must not belong to any other account (checked when asked AND when switching; users.email is UNIQUE);
// links are one-time, expire in an hour, are stored hashed, and a newer request replaces the older one; at most 3 requests per
// person per hour (refused ones count too, so this can't be used to probe which emails have accounts) and 3 links per new
// address per hour (so it can't be used to flood someone's inbox). Sign-in links still outstanding for the old or new address
// stop working at the switch.
import { emailChangePage } from "./onboarding.js";
import { boundedForm, boundedJson, BodyTooLargeError } from "./bounded-body.js";
import { privacyView, setPrivacy, isPrivacyLevel } from "./privacy.js";   // Settings → General → AI data privacy

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
const rand = (n = 32) => hex(crypto.getRandomValues(new Uint8Array(n)));
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const HOUR = 3600e3, SESSION_MS = 30 * 86400e3;
export const CHANGE_TTL = HOUR;
export const LIMITS = { perUser: 3, perAddress: 3 };
export const EMAIL_RE = /^[^@\s<>"',;]+@[^@\s<>"',;]+\.[^@\s<>"',;]+$/;
const TEST_ADDR = /@example\.(com|org|net)$/;
const isTestAddr = (env, email) => env.TEST_MODE === "1" && TEST_ADDR.test(email || "");
const cleanName = (v, max) => String(v || "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
const cookieToken = (req) => (req.headers.get("cookie") || "").match(/(?:^|;\s*)hc_session=([a-f0-9]+)/)?.[1] || "";
export const sessionId = async (tokenHash) => (await sha256(`1hc-session:${tokenHash}`)).slice(0, 20);

// Every sign-in makes its session here, with the device and rough place it came from (so "Signed-in devices" can say which is which).
export async function newSession(env, req, userId) {
  const s = rand(), cf = req.cf || {}, at = Date.now();
  const ua = String(req.headers.get("user-agent") || "").slice(0, 400);
  const place = [cf.city, cf.country === "US" ? cf.region : "", cf.country].filter(Boolean).map((x) => cleanName(x, 60)).join(", ").slice(0, 160);
  await env.DB.prepare("INSERT INTO sessions (token_hash,user_id,expires_at,created_at,ua,place) VALUES (?,?,?,?,?,?)").bind(await sha256(s), userId, at + SESSION_MS, at, ua, place).run();
  return s;
}
// Log out: the session row goes too, so a copied cookie stops working and the device leaves the list.
export async function endSession(env, req) {
  const tok = cookieToken(req); if (!tok) return;
  await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha256(tok)).run().catch(() => {});
}

// "Chrome on Mac", "Safari on iPhone".
export function deviceOf(ua) {
  ua = String(ua || ""); if (!ua) return "";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? (/Mobile/.test(ua) ? "Android phone" : "Android tablet")
    : /CrOS/.test(ua) ? "Chromebook" : /Macintosh|Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  const br = /Edg[A-Z]?\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\/|FxiOS\//.test(ua) ? "Firefox" : /CriOS\/|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return br && os ? `${br} on ${os}` : br || os || "";
}
const mask = (email) => { const [u, d] = String(email).split("@"); return d ? `${u.slice(0, Math.min(2, Math.max(1, u.length - 1)))}•••@${d}` : email; };

async function listSessions(env, req, userId) {
  const cur = await sha256(cookieToken(req) || "-");
  const rows = (await env.DB.prepare("SELECT token_hash, expires_at, created_at, ua, place FROM sessions WHERE user_id=? AND expires_at>? ORDER BY COALESCE(created_at, expires_at - ?) DESC LIMIT 100")
    .bind(userId, Date.now(), SESSION_MS).all()).results || [];
  const out = [];
  for (const r of rows) out.push({ id: await sessionId(r.token_hash), current: r.token_hash === cur, device: deviceOf(r.ua), place: r.place || "",
    created: Number(r.created_at) || Number(r.expires_at) - SESSION_MS, expires: Number(r.expires_at) });
  return out.sort((a, b) => Number(b.current) - Number(a.current) || b.created - a.created);
}
async function pendingChange(env, userId) {
  const r = await env.DB.prepare("SELECT new_email, expires_at FROM email_changes WHERE user_id=? AND used=0 AND expires_at>? ORDER BY created_at DESC LIMIT 1").bind(userId, Date.now()).first();
  return r ? { email: r.new_email, expires: Number(r.expires_at) } : null;
}

// ---------------------------------------------------------------- owner API ----------------------------------------------------------------
export async function accountRoute(req, env, t, user, url, sub, deps = {}) {
  if (sub !== "/api/account" && !sub.startsWith("/api/account/")) return null;
  if (req.method === "GET" && sub === "/api/account")
    return json({ name: t.first_name || "", email: user.email, pending: await pendingChange(env, user.id), sessions: await listSessions(env, req, user.id), passwordless: true, show_costs: Number(t.show_costs) === 1, ai_privacy: privacyView(t) });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  // CSRF: the session cookie is SameSite=Lax already; on top of that only same-origin JSON is accepted (a cross-site form can't send JSON).
  const origin = req.headers.get("origin");
  if ((origin && origin !== url.origin) || !/^application\/json\b/i.test(req.headers.get("content-type") || "")) return json({ error: "forbidden" }, 403);
  let b;
  try { b = await boundedJson(req, 8192); }
  catch (e) { return json({ error: e instanceof BodyTooLargeError ? "too_large" : "bad_request" }, e instanceof BodyTooLargeError ? 413 : 400); }
  const at = Date.now();

  if (sub === "/api/account/name") {
    const name = cleanName(b.name, 80);
    if (!name) return json({ error: "Type the name you want to go by." }, 400);
    await env.DB.prepare("UPDATE tenants SET first_name=?,updated_at=? WHERE id=?").bind(name, at, t.id).run();
    return json({ ok: true, name });
  }

  // Display preferences, per account so they hold on every device. show_costs: the "This task: about $…" estimates (off by default).
  if (sub === "/api/account/prefs") {
    if (typeof b.show_costs !== "boolean") return json({ error: "Nothing to change." }, 400);
    await env.DB.prepare("UPDATE tenants SET show_costs=?,updated_at=? WHERE id=?").bind(b.show_costs ? 1 : 0, at, t.id).run();
    return json({ ok: true, show_costs: b.show_costs });
  }

  if (sub === "/api/account/privacy") {
    const level = typeof b.level === "string" ? b.level : "";   // exactly one of the three strings; nothing coerced
    if (!isPrivacyLevel(level)) return json({ error: "Choose one of the three options." }, 400);
    const r = await setPrivacy(env, t.id, level, at);
    return json({ ok: true, ai_privacy: { level: r.level, chosen: true, version: r.version, at: r.at } });
  }

  if (sub === "/api/account/email") {
    const email = String(b.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: "Enter a valid email address." }, 400);
    if (email === String(user.email).toLowerCase()) return json({ error: "That's already your sign-in email." }, 400);
    const mine = await env.DB.prepare("SELECT COUNT(*) n FROM email_changes WHERE user_id=? AND created_at>?").bind(user.id, at - HOUR).first();
    if (Number(mine?.n || 0) >= LIMITS.perUser) return json({ error: "You've asked for a few changes in the last hour. Try again in an hour." }, 429);
    const taken = await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first();
    if (taken) {   // recorded (used=3) so refused tries count toward the hourly limit
      await env.DB.prepare("INSERT INTO email_changes (token_hash,user_id,old_email,new_email,created_at,expires_at,used) VALUES (?,?,?,?,?,?,3)").bind(await sha256(rand()), user.id, user.email, email, at, at).run();
      return json({ error: "That email already belongs to another 1Helm account. Use a different address." }, 409);
    }
    const theirs = await env.DB.prepare("SELECT COUNT(*) n FROM email_changes WHERE new_email=? AND created_at>? AND used<>3").bind(email, at - HOUR).first();
    if (Number(theirs?.n || 0) >= LIMITS.perAddress) return json({ error: "We just sent a few links to that address. Check its inbox (and spam), or try again in an hour." }, 429);
    const token = rand(), hash = await sha256(token), link = `${url.origin}/auth/email-change?token=${token}`;
    await env.DB.prepare("UPDATE email_changes SET used=2 WHERE user_id=? AND used=0").bind(user.id).run();
    await env.DB.prepare("INSERT INTO email_changes (token_hash,user_id,old_email,new_email,created_at,expires_at) VALUES (?,?,?,?,?,?)").bind(hash, user.id, user.email, email, at, at + CHANGE_TTL).run();
    if (isTestAddr(env, email)) return json({ ok: true, sent_to: email, expires: at + CHANGE_TTL, test_link: link });
    try { await (deps.send || sendMail)(env, { to: email, ...confirmEmail(env, link, user.email, email) }); }
    catch (e) { console.error("email change send failed", e?.code, e?.message); await env.DB.prepare("UPDATE email_changes SET used=2 WHERE token_hash=?").bind(hash).run(); return json({ error: "We couldn't send the email just now. Try again in a minute." }, 502); }
    return json({ ok: true, sent_to: email, expires: at + CHANGE_TTL });
  }
  if (sub === "/api/account/email/cancel") {
    await env.DB.prepare("UPDATE email_changes SET used=2 WHERE user_id=? AND used=0").bind(user.id).run();
    return json({ ok: true });
  }

  if (sub === "/api/account/signout") {
    const cur = await sha256(cookieToken(req) || "-");
    const rows = (await env.DB.prepare("SELECT token_hash FROM sessions WHERE user_id=?").bind(user.id).all()).results || [];
    let gone = [];
    if (b.others === true) gone = rows.filter((r) => r.token_hash !== cur);
    else {
      const id = String(b.id || ""); if (!/^[0-9a-f]{20}$/.test(id)) return json({ error: "Which device?" }, 400);
      for (const r of rows) if ((await sessionId(r.token_hash)) === id) gone.push(r);
      if (gone.some((r) => r.token_hash === cur)) return json({ error: "That's this device. Use Log out to sign out here." }, 400);
      if (!gone.length) return json({ ok: true, signed_out: 0 });
    }
    for (const r of gone) await env.DB.prepare("DELETE FROM sessions WHERE token_hash=? AND user_id=?").bind(r.token_hash, user.id).run();
    return json({ ok: true, signed_out: gone.length });
  }
  return json({ error: "not found" }, 404);
}

// ---------------------------------------------------------------- the link in the email ----------------------------------------------------------------
export async function emailChangeRoute(req, env, url, deps = {}) {
  const at = Date.now();
  if (req.method === "GET") {
    const r = await env.DB.prepare("SELECT old_email, new_email FROM email_changes WHERE token_hash=? AND used=0 AND expires_at>?").bind(await sha256(url.searchParams.get("token") || ""), at).first();
    if (!r) return emailChangePage("expired");
    return emailChangePage("confirm", { token: url.searchParams.get("token"), from: mask(r.old_email), to: r.new_email });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const origin = req.headers.get("origin"); if (origin && origin !== "null" && origin !== url.origin) return new Response("Forbidden", { status: 403 });
  const token = String((await boundedForm(req)).get("token") || "");
  // One-time: claimed atomically, so two clicks can't both switch.
  const r = await env.DB.prepare("UPDATE email_changes SET used=1 WHERE token_hash=? AND used=0 AND expires_at>? RETURNING user_id, old_email, new_email").bind(await sha256(token), at).first();
  if (!r) return emailChangePage("expired");
  const u = await env.DB.prepare("SELECT id, email FROM users WHERE id=?").bind(r.user_id).first();
  if (!u || u.email !== r.old_email) return emailChangePage("stale");
  const other = await env.DB.prepare("SELECT id FROM users WHERE email=? AND id<>?").bind(r.new_email, u.id).first();
  if (other) return emailChangePage("taken", { to: r.new_email });
  let changed = 0;
  try { changed = (await env.DB.prepare("UPDATE users SET email=? WHERE id=? AND email=?").bind(r.new_email, u.id, r.old_email).run()).meta?.changes || 0; }
  catch (e) { if (/UNIQUE/i.test(e?.message || "")) return emailChangePage("taken", { to: r.new_email }); throw e; }
  if (!changed) return emailChangePage("stale");
  // Sign-in links already sent to either address stop working; any other pending change for this person is void.
  await env.DB.prepare("UPDATE magic_links SET used=1 WHERE email IN (?,?) AND used=0").bind(r.old_email, r.new_email).run();
  await env.DB.prepare("UPDATE email_changes SET used=2 WHERE user_id=? AND used=0").bind(u.id).run();
  const t = await env.DB.prepare("SELECT id, slug, stripe_customer FROM tenants WHERE owner_user_id=?").bind(u.id).first();
  if (t) try { await env.DB.prepare("UPDATE plan_cancellations SET email=? WHERE tenant_id=?").bind(r.new_email, t.id).run(); } catch {}   // no cancellation pending: no table/row
  // Receipts follow the new address (best effort: the switch has happened either way).
  if (t?.stripe_customer && deps.stripe) await deps.stripe(env, `customers/${t.stripe_customer}`, { email: r.new_email }).catch((e) => console.error("stripe email update", e?.message));
  if (!isTestAddr(env, r.old_email)) {
    try { await (deps.send || sendMail)(env, { to: r.old_email, ...changedEmail(env, r.old_email, r.new_email) }); }
    catch (e) { console.error("email changed notice failed", e?.code, e?.message); }
  }
  return emailChangePage("done", { to: r.new_email, app: t ? `/w/${t.slug}/app?settings=account` : "/" });
}

// ---------------------------------------------------------------- the emails ----------------------------------------------------------------
const sendMail = (env, m) => env.EMAIL.send({ to: m.to, from: { email: env.EMAIL_FROM, name: "1Helm" }, subject: m.subject, html: m.html, text: m.text });
const h = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const wrap = (env, inner) => `<!doctype html><html><body style="margin:0;background:#f3f2ef;font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:#1c1b19"><div style="max-width:480px;margin:40px auto;background:#fff;border-radius:18px;padding:36px 32px"><img src="https://${env.GATEWAY_HOST}/1helm-icon-64.png" width="40" height="40" alt="1Helm" style="border-radius:10px">${inner}</div></body></html>`;
export function confirmEmail(env, link, from, to) {
  return { subject: "Confirm your new 1Helm sign-in email",
    html: wrap(env, `<h1 style="font-size:22px;margin:22px 0 8px">Use this email for 1Helm?</h1><p style="margin:0 0 24px;color:#55524c">Someone signed in to 1Helm asked to switch their sign-in email from ${h(mask(from))} to <b>${h(to)}</b>. Tap the button to confirm. The link works once and expires in an hour.</p><a href="${h(link)}" style="display:inline-block;background:#1c1b19;color:#fff;text-decoration:none;padding:13px 22px;border-radius:12px;font-weight:600">Confirm new email</a><p style="margin:28px 0 0;font-size:13px;color:#8a867e">If this wasn't you, ignore this email. Nothing changes unless the button is tapped.</p>`),
    text: `Use this email for 1Helm?\n\nSomeone signed in to 1Helm asked to switch their sign-in email from ${mask(from)} to ${to}. Open this link to confirm. It works once and expires in an hour:\n${link}\n\nIf this wasn't you, ignore this email. Nothing changes unless the link is opened.` };
}
export function changedEmail(env, from, to) {
  const support = h(env.SUPPORT_EMAIL || env.EMAIL_FROM);
  return { subject: "Your 1Helm sign-in email was changed",
    html: wrap(env, `<h1 style="font-size:22px;margin:22px 0 8px">Your sign-in email changed</h1><p style="margin:0 0 16px;color:#55524c">Your 1Helm account now signs in with <b>${h(to)}</b> instead of ${h(from)}. Sign-in links will go to the new address from now on.</p><p style="margin:0;color:#55524c">If you didn't do this, contact <a href="mailto:${support}">${support}</a> right away and we'll help you get it back.</p>`),
    text: `Your sign-in email changed\n\nYour 1Helm account now signs in with ${to} instead of ${from}. Sign-in links will go to the new address from now on.\n\nIf you didn't do this, contact ${env.SUPPORT_EMAIL || env.EMAIL_FROM} right away and we'll help you get it back.` };
}
