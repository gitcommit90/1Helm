// Email sign-in code (Captain 10-08: "email sign in link is great, we also need to offer email sign in code").
// The one sign-in email carries a link AND a 6-digit code. Both live on the same magic_links row (migrations_044_signin_code.sql),
// so using either one consumes the sign-in. The code is for signing in right here, on THIS device and browser (the installed app,
// another computer), where opening the link would land in some other browser.
//
// Security:
//   - The code is random (crypto.getRandomValues, rejection-sampled so every code is equally likely).
//   - Only an HMAC-SHA256 is stored: key derived from SIGNIN_CODE_KEY (else VAULT_KEY), message = this row's token hash + email + code.
//     A copied database alone can't be brute-forced back to codes, and a code is bound to its email and its own sign-in.
//   - The code only works in the browser that asked for it: that browser gets a random id in an HttpOnly cookie (hc_signin) and the row
//     keeps only its SHA-256 (pending_hash). The cookie can't sign anyone in by itself; it only says which sign-in a code is for.
//   - Single use, 15 minutes (the link's own expiry). Using the link or the code marks the row used, which ends both.
//   - 5 guesses per sign-in, then the code is dead (the link still works). Plus 20 wrong codes per email per 24 h, and 20 per network
//     (hashed IP) per 15 minutes. Wrong codes are counted in signin_code_fails; the hourly cron sweeps rows older than a day.
//   - Hashes are compared in constant time. Codes are never logged, never returned (except test_code for @example.com in TEST_MODE).
const enc = new TextEncoder();
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(String(s))));
const rand = (n = 32) => hex(crypto.getRandomValues(new Uint8Array(n)));

export const CODE_TTL = 15 * 60e3, CODE_TRIES = 5, EMAIL_FAILS = 20, EMAIL_WINDOW = 24 * 3600e3, IP_FAILS = 20, IP_WINDOW = 15 * 60e3;
export const RESEND_WAIT = 30;   // seconds the "Send a new code" button waits (the server's own cap: 6 emails per address per 15 min)
export const PENDING_COOKIE = "hc_signin";

// Plain words for each outcome. kind goes to the page so it can offer the right next step ("Send a new code").
export const CODE_MSG = {
  format: "Enter the 6-digit code from the email.",
  wrong: "That code isn't right. Check the newest email from 1Helm and try again.",
  too_many: "Too many wrong tries, so this code no longer works. Send a new code, or tap the link in the email.",
  expired: "That code has expired. Send a new one.",
  used: "That code was already used. Send a new one.",
  locked: "Too many wrong codes for this email today. Tap the link in the email instead, or try again tomorrow.",
  locked_ip: "Too many wrong codes from this network. Wait 15 minutes, or tap the link in the email.",
};

// 000000–999999, uniform: draws at or above the largest multiple of 1e6 that fits in 32 bits are thrown away.
export function newCode() {
  const lim = Math.floor(2 ** 32 / 1e6) * 1e6, b = new Uint32Array(1);
  for (;;) { crypto.getRandomValues(b); if (b[0] < lim) return String(b[0] % 1e6).padStart(6, "0"); }
}
// Digits only, so "482 913", "482-913" or a paste with a stray space still work.
export const cleanCode = (v) => String(v ?? "").replace(/[\s -]/g, "");

let _key = null, _keyFor = null;
async function hmacKey(env) {
  const material = String(env.SIGNIN_CODE_KEY || env.VAULT_KEY || "");
  if (_key && _keyFor === material) return _key;
  if (!material) console.log("signin-code: no SIGNIN_CODE_KEY/VAULT_KEY; code hashes are salted per row only");
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(`1hc-signin-code|${material}`));
  _key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); _keyFor = material;
  return _key;
}
export async function codeHash(env, tokenHash, email, code) {
  return hex(await crypto.subtle.sign("HMAC", await hmacKey(env), enc.encode(`${tokenHash}|${String(email).toLowerCase()}|${code}`)));
}
export function sameHash(a, b) {
  a = String(a || ""); b = String(b || "");
  let d = a.length ^ b.length; const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0 && a.length > 0;
}

// One pending sign-in: the link token, the code, and the browser's pending id. Only hashes are stored.
export async function createSignIn(env, email, { ttl = CODE_TTL, at = Date.now(), age = null } = {}) {
  const token = rand(), code = newCode(), pending = rand(), th = await sha256(token);
  await env.DB.prepare("INSERT INTO magic_links (token_hash,email,expires_at,code_hash,pending_hash,age_version,age_confirmed_at) VALUES (?,?,?,?,?,?,?)")
    .bind(th, email, at + ttl, await codeHash(env, th, email, code), await sha256(`pending:${pending}`), age?.version || null, age?.at || null).run();
  return { token, code, pending, expires: at + ttl };
}
// A pending id that matches nothing (sign-in at someone's own address with an email that doesn't own it): same cookie, same page.
export const decoyPending = () => rand();

export const pendingCookie = (pending, maxAge = Math.round(CODE_TTL / 1000)) => `${PENDING_COOKIE}=${pending}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
export const clearPendingCookie = () => `${PENDING_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
export const pendingOf = (req) => (req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${PENDING_COOKIE}=([a-f0-9]{64})(?:;|$)`))?.[1] || "";
const ipHash = async (req) => (await sha256(`1hc-ip:${req.headers.get("cf-connecting-ip") || "?"}`)).slice(0, 32);

// The email this browser is waiting on (so a reload, or the installed app coming back from Mail, lands on the code screen again).
export async function pendingEmail(env, req, at = Date.now()) {
  const p = pendingOf(req); if (!p) return "";
  const r = await env.DB.prepare("SELECT email FROM magic_links WHERE pending_hash=? AND used=0 AND expires_at>? AND code_hash IS NOT NULL").bind(await sha256(`pending:${p}`), at).first();
  return r?.email || "";
}

// Check a typed code against this browser's pending sign-in. → { email } (the row is now used) or { kind, error }.
export async function verifyCode(env, req, typed, { at = Date.now() } = {}) {
  const DB = env.DB, code = cleanCode(typed), no = (kind) => ({ kind, error: CODE_MSG[kind] });
  if (!/^\d{6}$/.test(code)) return no("format");
  const p = pendingOf(req); if (!p) return no("expired");
  const ip = await ipHash(req);
  const ipFails = await DB.prepare("SELECT COUNT(*) n FROM signin_code_fails WHERE ip=? AND at>?").bind(ip, at - IP_WINDOW).first();
  if (Number(ipFails?.n || 0) >= IP_FAILS) return no("locked_ip");
  const fail = (email) => DB.prepare("INSERT INTO signin_code_fails (email,ip,at) VALUES (?,?,?)").bind(email, ip, at).run();
  const row = await DB.prepare("SELECT token_hash,email,expires_at,used,code_hash,code_tries FROM magic_links WHERE pending_hash=?").bind(await sha256(`pending:${p}`)).first();
  if (!row) { await fail(""); return no("wrong"); }   // a decoy (or swept) sign-in answers exactly like a wrong code
  if (Number(row.used)) return no("used");
  if (Number(row.expires_at) <= at || !row.code_hash) return no("expired");
  if (Number(row.code_tries) >= CODE_TRIES) return no("too_many");
  const emailFails = await DB.prepare("SELECT COUNT(*) n FROM signin_code_fails WHERE email=? AND at>?").bind(row.email, at - EMAIL_WINDOW).first();
  if (Number(emailFails?.n || 0) >= EMAIL_FAILS) return no("locked");
  // Count the guess first (atomic), so parallel guesses can't get past the limit.
  const n = await DB.prepare("UPDATE magic_links SET code_tries=code_tries+1 WHERE token_hash=? AND used=0 AND code_tries<? RETURNING code_tries").bind(row.token_hash, CODE_TRIES).first();
  if (!n) return no(Number(row.code_tries) + 1 >= CODE_TRIES ? "too_many" : "used");
  if (!sameHash(await codeHash(env, row.token_hash, row.email, code), row.code_hash)) {
    await fail(row.email);
    return no(Number(n.code_tries) >= CODE_TRIES ? "too_many" : "wrong");
  }
  const ml = await DB.prepare("UPDATE magic_links SET used=1 WHERE token_hash=? AND used=0 AND expires_at>? RETURNING email,age_version,age_confirmed_at").bind(row.token_hash, at).first();
  if (!ml) return no("used");
  return { email: ml.email, age: ml.age_version ? { version: ml.age_version, at: ml.age_confirmed_at } : null };
}

export async function sweepCodeFails(env, at = Date.now()) {
  return Number((await env.DB.prepare("DELETE FROM signin_code_fails WHERE at<?").bind(at - EMAIL_WINDOW).run()).meta?.changes || 0);
}

// The sign-in email: the code first (big, copyable as one run of digits), the link as the other way in.
export function signInEmail(env, link, code) {
  const html = `<!doctype html><html><body style="margin:0;background:#f3f2ef;font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:#1c1b19"><div style="max-width:480px;margin:40px auto;background:#fff;border-radius:18px;padding:36px 32px"><img src="https://${env.GATEWAY_HOST}/1helm-icon-64.png" width="40" height="40" alt="1Helm" style="border-radius:10px"><h1 style="font-size:22px;margin:22px 0 8px">Sign in to 1Helm</h1><p style="margin:0 0 14px;color:#55524c">Enter this code on the sign-in screen:</p><div style="margin:0 0 26px;padding:16px 0;border-radius:14px;background:#f3f2ef;text-align:center"><span style="font:600 34px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.22em;padding-left:.22em;color:#1c1b19">${code}</span></div><p style="margin:0 0 14px;color:#55524c">Or tap the button to sign in on the device you're reading this on.</p><a href="${link}" style="display:inline-block;background:#1c1b19;color:#fff;text-decoration:none;padding:13px 22px;border-radius:12px;font-weight:600">Sign in to 1Helm</a><p style="margin:24px 0 0;font-size:14px;color:#55524c">The code and the link work once and expire in 15 minutes. Using one ends the other.</p><p style="margin:20px 0 0;font-size:13px;color:#8a867e">If you didn't ask for this, you can ignore this email. Nobody can sign in without the code or the link. Never share them with anyone.</p></div></body></html>`;
  const text = `Sign in to 1Helm\n\nYour sign-in code: ${code}\nEnter it on the sign-in screen.\n\nOr open this link to sign in:\n${link}\n\nThe code and the link work once and expire in 15 minutes. Using one ends the other.\n\nIf you didn't ask for this, you can ignore this email. Never share the code or the link with anyone.`;
  return { subject: `Your 1Helm code: ${code}`, html, text };
}
