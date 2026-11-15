// Web Push from a Worker, WebCrypto only (no library): VAPID (RFC 8292) + aes128gcm payload encryption (RFC 8291 / RFC 8188).
// Keys: VAPID_PUBLIC = the raw P-256 public key (65 bytes, base64url), VAPID_PRIVATE = its private scalar d (32 bytes, base64url).
// sendPush(env, sub, payload) → { ok, status, gone } — gone = the push service says this subscription no longer exists (404/410).
const enc = new TextEncoder();
export const b64u = (buf) => { const b = new Uint8Array(buf); let s = ""; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
export const unb64u = (s) => { s = String(s || "").replace(/-/g, "+").replace(/_/g, "/"); s += "=".repeat((4 - (s.length % 4)) % 4); const r = atob(s), o = new Uint8Array(r.length); for (let i = 0; i < r.length; i++) o[i] = r.charCodeAt(i); return o; };
const cat = (...a) => { const n = a.reduce((x, y) => x + y.length, 0), o = new Uint8Array(n); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const hmac = async (key, data) => new Uint8Array(await crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), data));

export const vapidReady = (env) => !!(env.VAPID_PUBLIC && env.VAPID_PRIVATE);

const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
export function okPushEndpoint(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" && !url.username && !url.password && String(value).length <= 1024 && PUSH_HOSTS.some((re) => re.test(url.hostname));
  } catch { return false; }
}

// A fresh VAPID key pair (setup only: node -e or a test).
export async function vapidKeys() {
  const k = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", k.publicKey)), jwk = await crypto.subtle.exportKey("jwk", k.privateKey);
  return { publicKey: b64u(pub), privateKey: jwk.d };
}

const keyCache = new Map();
async function signingKey(env) {
  const id = env.VAPID_PUBLIC; if (keyCache.has(id)) return keyCache.get(id);
  const pub = unb64u(env.VAPID_PUBLIC);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID_PUBLIC must be a raw uncompressed P-256 key");
  const k = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: env.VAPID_PRIVATE, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  keyCache.set(id, k); return k;
}
// The Authorization header for one push service (aud = its origin), good for 12 hours.
export async function vapidAuth(env, endpoint, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const h = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" }))), p = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: `mailto:${env.VAPID_SUBJECT || env.SUPPORT_EMAIL || env.EMAIL_FROM}` })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await signingKey(env), enc.encode(`${h}.${p}`));   // WebCrypto gives raw r||s (JWS form)
  return `vapid t=${h}.${p}.${b64u(sig)}, k=${env.VAPID_PUBLIC}`;
}

// RFC 8291: encrypt one message for one subscription. Returns the full aes128gcm body (header + one record).
export async function encryptPayload(p256dh, auth, plaintext, { salt = crypto.getRandomValues(new Uint8Array(16)), local = null } = {}) {
  const uaPub = typeof p256dh === "string" ? unb64u(p256dh) : p256dh, secret = typeof auth === "string" ? unb64u(auth) : auth;
  const as = local || await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const prkKey = await hmac(secret, ecdh);
  const ikm = (await hmac(prkKey, cat(enc.encode("WebPush: info\0"), uaPub, asPub, new Uint8Array([1])))).slice(0, 32);
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, cat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
  const body = cat(typeof plaintext === "string" ? enc.encode(plaintext) : plaintext, new Uint8Array([2]));   // 0x02: the last (only) record
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]), body));
  const rs = 4096, head = new Uint8Array(21); head.set(salt, 0); new DataView(head.buffer).setUint32(16, rs); head[20] = asPub.length;
  return cat(head, asPub, ct);
}

// One push. payload: a small object (the service worker shows it). urgency: "high" for "needs you".
export async function sendPush(env, sub, payload, { ttl = 24 * 3600, urgency = "normal", topic = "" } = {}) {
  // Validate again when sending: older database rows may predate the signup check.
  if (!okPushEndpoint(sub?.endpoint)) return { ok: false, status: 0, gone: true, error: "invalid push endpoint" };
  const body = await encryptPayload(sub.p256dh, sub.auth, JSON.stringify(payload));
  const headers = { authorization: await vapidAuth(env, sub.endpoint), "content-encoding": "aes128gcm", "content-type": "application/octet-stream", ttl: String(ttl), urgency };
  if (topic) headers.topic = topic.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);   // a newer push with the same topic replaces one still waiting
  let r; try { r = await fetch(sub.endpoint, { method: "POST", headers, body, redirect: "manual" }); } catch (e) { return { ok: false, status: 0, gone: false, error: String(e.message || e) }; }
  return { ok: r.status >= 200 && r.status < 300, status: r.status, gone: r.status === 404 || r.status === 410 };
}
