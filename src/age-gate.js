// Adult-only onboarding: self-attestation, not age verification. No DOB, identity document or email is collected here.
// The host-only cookie remembers this browser; verified sign-ins carry the original acknowledgement to the account.
export const AGE_VERSION = "1", AGE_COOKIE = "hc_age", AGE_TTL = 365 * 24 * 3600;
export const AGE_ERROR = { error: "Confirm that you are 18 or older before continuing.", kind: "age_confirmation_required", signed_in: false, next_url: "/onboard/age" };
const enc = new TextEncoder(), hex = (v) => [...new Uint8Array(v)].map((x) => x.toString(16).padStart(2, "0")).join("");
const escape = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
async function key(env) {
  const material = env.SIGNIN_CODE_KEY || env.VAULT_KEY;
  if (!material) throw new Error("Age acknowledgement signing key is unavailable");
  return crypto.subtle.importKey("raw", enc.encode(`1hc-age-ack|${material}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function ageCookie(env, at = Date.now()) {
  const value = `${AGE_VERSION}.${at}`;
  const sig = hex(await crypto.subtle.sign("HMAC", await key(env), enc.encode(value)));
  return `${AGE_COOKIE}=${value}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${AGE_TTL}`;
}
export async function ageOf(req, env, at = Date.now()) {
  const value = (req.headers.get("cookie") || "").match(/(?:^|;\s*)hc_age=([^;]+)(?:;|$)/)?.[1] || "";
  const m = value.match(/^(\d+)\.(\d{13})\.([a-f0-9]{64})$/);
  if (!m || m[1] !== AGE_VERSION || Number(m[2]) > at || at - Number(m[2]) > AGE_TTL * 1000) return null;
  const sig = Uint8Array.from(m[3].match(/../g), (s) => parseInt(s, 16));
  if (!await crypto.subtle.verify("HMAC", await key(env), sig, enc.encode(`${m[1]}.${m[2]}`))) return null;
  return { version: m[1], at: Number(m[2]) };
}
// The attestation can also arrive with the email submit itself (a checked "I am 18 or older" on the sign-in form): { adult: true | "yes", version }.
// It yields the same record as /onboard/age: an age object for the sign-in row and the same signed cookie. Anything else is no attestation.
export async function ageClaim(env, claim, at = Date.now()) {
  if (!claim || (claim.adult !== true && claim.adult !== "yes") || String(claim.version) !== AGE_VERSION) return null;
  return { age: { version: AGE_VERSION, at }, cookie: await ageCookie(env, at) };
}
export function ageNext(value = "/onboard") {
  // Never redirect to a supplied origin, arbitrary route, or a sign-in token.
  return /^\/(?:onboard)?(?:\?[^#\r\n]*)?$/.test(value) ? value : "/onboard";
}
export function agePage({ next = "/onboard", error = "", status = 200 } = {}) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex"><meta name="theme-color" content="#f3f2ef"><title>Before you continue · 1Helm</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f3f2ef;color:#1c1b19;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:500px;margin:10vh auto;padding:24px}a{color:inherit}.brand{display:flex;align-items:center;gap:10px;font-weight:700;text-decoration:none;margin-bottom:32px}.brand img{width:36px;height:36px;border-radius:9px}.card{padding:30px;background:#fff;border:1px solid #e5e2db;border-radius:22px}h1{font-size:28px;line-height:1.2;margin:0 0 14px}p{color:#66625a;margin:0 0 22px}.check{display:flex;align-items:center;gap:12px;min-height:52px;cursor:pointer;font-weight:600}.check input{width:22px;height:22px;flex:none;accent-color:#1c1b19}button{width:100%;margin-top:20px;border:0;border-radius:12px;padding:14px;background:#1c1b19;color:white;font:inherit;font-weight:600;line-height:1.4;cursor:pointer}button:disabled{opacity:.45;cursor:default}:focus-visible{outline:3px solid #587795;outline-offset:4px}.fine{font-size:13px;margin:18px 0 0}.error{color:#a12727}@media(max-width:380px){main{padding:18px}.card{padding:24px}}</style></head>
<body><main><a class="brand" href="https://1helm.com"><img src="/1helm-icon-64.png" alt="">1Helm</a><section class="card"><h1>Before you continue</h1><p>1Helm is for adults aged 18 and older. Please confirm before entering your email or setting up your account.</p>
${error ? `<p class="error" role="alert">${escape(error)}</p>` : ""}<form method="post" action="/onboard/age" id="age-form"><input type="hidden" name="version" value="${AGE_VERSION}"><input type="hidden" name="next" value="${escape(ageNext(next))}"><label class="check"><input type="checkbox" name="adult" value="yes" required id="adult"><span>I am 18 or older</span></label><button type="submit" id="age-continue">Continue</button></form>
<p class="fine">We’ll remember this confirmation in this browser. No date of birth or identity document is needed.</p><p class="fine"><a href="https://1helm.com/privacy" target="_blank" rel="noopener">Privacy</a> · <a href="https://1helm.com/terms" target="_blank" rel="noopener">Terms</a></p></section></main>
<script>(()=>{const box=document.getElementById('adult'),button=document.getElementById('age-continue');const sync=()=>button.disabled=!box.checked;box.addEventListener('change',sync);addEventListener('pageshow',sync);sync()})();</script></body></html>`, { status, headers: { "content-type": "text/html;charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "same-origin" } });
}
export async function recordAge(env, userId, age) {
  if (age?.version !== AGE_VERSION || !Number.isSafeInteger(age.at) || age.at <= 0) return;
  await env.DB.prepare("UPDATE users SET age_version=?,age_confirmed_at=? WHERE id=? AND (age_version IS NULL OR age_version<>?)")
    .bind(age.version, age.at, userId, age.version).run();
}
