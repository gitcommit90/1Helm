// Signing with a saved private key (the sign_token tool). Some services (App Store Connect, Google service accounts, GitHub Apps) need a
// fresh signed token (a JWT) made with a private key, which a saved-key stand-in cannot do. The Worker signs here with WebCrypto and
// returns only the token: the helper never sees the private key.
//   Algorithms: ES256 (ECDSA P-256), RS256 (RSA PKCS#1 v1.5), PS256 (RSA-PSS), EdDSA (Ed25519) and HS256 (shared secret).
//   Keys: a PEM private key (PKCS#8 "BEGIN PRIVATE KEY", or the RSA "BEGIN RSA PRIVATE KEY" form GitHub gives out). HS256 uses the saved value as is.
//   Lifetime: a token lives at most MAX_LIFE_S seconds (60 minutes). A later exp is refused, and a missing exp becomes DEFAULT_LIFE_S.
//   Where it may be used: audience_host is optional. When it is given and the saved key has approved sites, it must match one of them. A key with no sites has no limit here
//   (the approval lock is applied when a request is sent, see key-use.js).
//   References: header and claims may hold $NAME or ${NAME} for any saved key; substituteRefs puts the real value in before signing (the tool does the lookup).
// Pure code (WebCrypto only), so it is unit tested.
import { hostMatch } from "./sentinel-swap.js";

// $NAME / ${NAME} in any string inside header or claims → the saved key's value. resolve(name) → value or undefined. → { value } or { error, missing: [names] }.
export const REF_RE = /\$\{([A-Z][A-Z0-9_]{1,40})\}|\$([A-Z][A-Z0-9_]{1,40})/g;
export function refNames(x, out = new Set(), depth = 0) {
  if (typeof x === "string") for (const m of x.matchAll(REF_RE)) out.add(m[1] || m[2]);
  else if (x && typeof x === "object" && depth < 20) for (const v of Object.values(x)) refNames(v, out, depth + 1);
  return out;
}
export function substituteRefs(x, values, depth = 0) {
  if (typeof x === "string") return x.replace(REF_RE, (m, a, b) => values.get(a || b) ?? m);
  if (Array.isArray(x)) return x.map((v) => substituteRefs(v, values, depth + 1));
  if (x && typeof x === "object" && depth < 20) return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, substituteRefs(v, values, depth + 1)]));
  return x;
}

export const MAX_LIFE_S = 3600, DEFAULT_LIFE_S = 600;
export const ALGS = ["ES256", "RS256", "PS256", "EdDSA", "HS256"];
const enc = new TextEncoder();
const b64u = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const b64uJson = (o) => b64u(enc.encode(JSON.stringify(o)));

// A PEM body as DER bytes. Accepts line breaks, a pasted key whose breaks were written as the two characters "\n", and stray spaces.
function pemBody(pem, label) {
  const text = String(pem || "").replace(/\\r\\n|\\n/g, "\n");
  const m = new RegExp(`-----BEGIN ${label}-----([\\s\\S]*?)-----END ${label}-----`).exec(text);
  if (!m) return null;
  try { const bin = atob(m[1].replace(/\s+/g, "")); return Uint8Array.from(bin, (c) => c.charCodeAt(0)); } catch { return null; }
}
const derLen = (n) => n < 128 ? [n] : n < 256 ? [0x81, n] : n < 65536 ? [0x82, n >> 8, n & 255] : [0x83, n >> 16, (n >> 8) & 255, n & 255];
const der = (tag, ...parts) => { const body = parts.flat(); return [tag, ...derLen(body.length), ...body]; };
// An RSA key in the older PKCS#1 form, wrapped as PKCS#8 (what WebCrypto imports): SEQUENCE { 0, SEQUENCE { rsaEncryption, NULL }, OCTET STRING { key } }.
const RSA_OID = [0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01];
const pkcs1ToPkcs8 = (k) => Uint8Array.from(der(0x30, der(0x02, 0), der(0x30, RSA_OID, [0x05, 0x00]), der(0x04, [...k])));

export function privateKeyDer(pem) {
  const p8 = pemBody(pem, "PRIVATE KEY"); if (p8) return p8;
  const p1 = pemBody(pem, "RSA PRIVATE KEY"); if (p1) return pkcs1ToPkcs8(p1);
  if (/BEGIN EC PRIVATE KEY/.test(String(pem))) throw new Error("That key is in the older EC format (BEGIN EC PRIVATE KEY). Ask the person for the PKCS#8 form (BEGIN PRIVATE KEY).");
  if (/BEGIN ENCRYPTED PRIVATE KEY/.test(String(pem))) throw new Error("That private key is password protected, so it can't be used here.");
  throw new Error("The saved value is not a PEM private key (it should start with -----BEGIN PRIVATE KEY-----).");
}

const IMPORT = {
  ES256: { name: "ECDSA", namedCurve: "P-256" },
  RS256: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
  PS256: { name: "RSA-PSS", hash: "SHA-256" },
  EdDSA: { name: "Ed25519" },
};
const SIGN = { ES256: { name: "ECDSA", hash: "SHA-256" }, RS256: { name: "RSASSA-PKCS1-v1_5" }, PS256: { name: "RSA-PSS", saltLength: 32 }, EdDSA: { name: "Ed25519" }, HS256: { name: "HMAC" } };

export async function importSigningKey(alg, value) {
  if (alg === "HS256") return crypto.subtle.importKey("raw", enc.encode(String(value)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  try { return await crypto.subtle.importKey("pkcs8", privateKeyDer(value), IMPORT[alg], false, ["sign"]); }
  catch (e) {
    if (/older EC format|password protected|not a PEM/.test(String(e.message))) throw e;
    throw new Error(`The saved private key doesn't work with ${alg}. Check that the algorithm matches the kind of key (ES256 needs an EC P-256 key, RS256 and PS256 need an RSA key, EdDSA needs an Ed25519 key).`);
  }
}

// → { exp, clamped } or { error }. claims.exp is seconds since 1970. Missing: DEFAULT_LIFE_S from now. Later than MAX_LIFE_S from now: refused.
export function checkLifetime(claims, now = Date.now()) {
  const nowS = Math.floor(now / 1000);
  if (claims.exp === undefined || claims.exp === null || claims.exp === "") return { exp: nowS + DEFAULT_LIFE_S, defaulted: true };
  const exp = Number(claims.exp);
  if (!Number.isInteger(exp)) return { error: "exp must be a whole number of seconds since 1970." };
  if (exp <= nowS) return { error: "exp is already in the past. Use a time up to 60 minutes from now." };
  if (exp > nowS + MAX_LIFE_S) return { error: `exp is more than ${MAX_LIFE_S / 60} minutes from now. Tokens made here last at most ${MAX_LIFE_S / 60} minutes (a service may allow less, e.g. App Store Connect allows 20).` };
  return { exp };
}

// Signs one token. key = { value (the saved secret), hosts (the saved key's sites) }. Never returns or logs the key.
// → { token, exp, alg, host } or { error } (plain words the helper can act on).
export async function signJwt({ alg, value, hosts, audience_host, header = {}, claims = {}, now = Date.now() }) {
  alg = String(alg || "");
  if (!ALGS.includes(alg)) return { error: `alg must be one of ${ALGS.join(", ")}.` };
  if (!header || typeof header !== "object" || Array.isArray(header)) return { error: "header must be an object (e.g. { \"kid\": \"ABC123\" })." };
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) return { error: "claims must be an object (e.g. { \"iss\": \"...\", \"aud\": \"...\" })." };
  const host = String(audience_host || "").trim().toLowerCase();
  let list = []; try { list = Array.isArray(hosts) ? hosts : JSON.parse(hosts || "[]"); } catch {}
  if (host && list.length && !hostMatch(host, list.map((h) => String(h).toLowerCase()))) return { error: `That saved key isn't approved for ${host}. It is approved for ${list.join(", ")}, so no token was made.` };
  const life = checkLifetime(claims, now); if (life.error) return { error: life.error };
  const h = { ...header, alg, typ: header.typ || "JWT" }, c = { ...claims, exp: life.exp };
  let key; try { key = await importSigningKey(alg, value); } catch (e) { return { error: e.message }; }
  const input = `${b64uJson(h)}.${b64uJson(c)}`;
  const sig = new Uint8Array(await crypto.subtle.sign(SIGN[alg], key, enc.encode(input)));   // ECDSA comes back as r||s, the form a JWT wants
  return { token: `${input}.${b64u(sig)}`, exp: life.exp, alg, host, defaulted: !!life.defaulted };
}
