// Sentinel request rewriting: swaps saved-key stand-ins for real values and re-signs signed requests. Pure code (no Workers imports) so it is unit tested.
// A real value is only ever inserted for a request to one of that key's own hosts. Nothing here logs or returns a real value.
//   1. Plain text: the URL, every header, and Basic credentials (the base64 is decoded, swapped and encoded again).
//   2. Request bodies: form, JSON, XML, text and the text parts of multipart, for bodies up to BODY_SCAN_MAX bytes. The value is encoded for the body type.
//   3. Signed requests: OAuth 1.0a (HMAC-SHA1, HMAC-SHA256, PLAINTEXT) and AWS SigV4 headers are signed again with the real secrets, because the
//      computer signed with stand-ins. No pairing is saved: the saved keys for the request host are tried as the secrets until one reproduces
//      the signature the computer sent (see "Signed requests" below). Key names do not matter.
export const STANDIN_RE = /1hs_[A-Za-z0-9]{32}/g;
const HAS = /1hs_[A-Za-z0-9]{32}/;
export const BODY_SCAN_MAX = 1048576; // 1 MiB: larger bodies go out untouched (stand-ins in them stay stand-ins)
// Outer whitespace a paste can carry (spaces, tabs, line breaks, no-break space, zero-width space, byte order mark). Inner content is kept (PEM keys have line breaks).
export const trimKey = (v) => String(v ?? "").replace(/^[\s\u200B\uFEFF\u00A0]+|[\s\u200B\uFEFF\u00A0]+$/g, "");
export const hostMatch = (host, pats) => pats.some((p) => p === host || (p.startsWith("*.") && (host === p.slice(2) || host.endsWith(p.slice(1)))));

const enc = new TextEncoder(), dec = new TextDecoder();
const toBin = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return s; };
const fromBin = (s) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
const utf8bin = (s) => toBin(enc.encode(s));
const b64decode = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64encode = (u8) => btoa(toBin(u8));
const hex = (u8) => [...new Uint8Array(u8)].map((x) => x.toString(16).padStart(2, "0")).join("");
export const pct = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const dq = (s) => { try { return decodeURIComponent(s.replace(/\+/g, " ")); } catch { return s; } };
const xmlEsc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const sha256 = async (u8) => new Uint8Array(await crypto.subtle.digest("SHA-256", u8));
async function hmac(hash, key, data) {
  const k = await crypto.subtle.importKey("raw", typeof key === "string" ? enc.encode(key) : key, { name: "HMAC", hash }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, typeof data === "string" ? enc.encode(data) : data));
}

export function bodyKind(headers) {
  const ct = String(headers.get("content-type") || "").toLowerCase(), ce = String(headers.get("content-encoding") || "").toLowerCase();
  if (ce && ce !== "identity") return null;
  if (ct.startsWith("application/x-www-form-urlencoded")) return "form";
  if (ct.startsWith("multipart/form-data")) return "multipart";
  if (/^application\/(.+\+)?json\b/.test(ct)) return "json";
  if (/^(application|text)\/(.+\+)?xml\b/.test(ct)) return "xml";
  if (ct.startsWith("text/")) return "text";
  return null;
}
const encFor = (kind) => kind === "json" ? (v) => JSON.stringify(v).slice(1, -1) : kind === "form" ? encodeURIComponent : kind === "xml" ? xmlEsc : (v) => v;

// Read a request body up to `cap` bytes. Over the cap: { stream } hands back the same bytes as a stream, unchanged.
export async function readCapped(stream, cap = BODY_SCAN_MAX) {
  const reader = stream.getReader(), chunks = []; let n = 0;
  for (;;) {
    const r = await reader.read(); if (r.done) break;
    chunks.push(r.value); n += r.value.length;
    if (n > cap) {
      return { stream: new ReadableStream({
        async pull(c) { if (chunks.length) return c.enqueue(chunks.shift()); const x = await reader.read(); if (x.done) c.close(); else c.enqueue(x.value); },
        cancel: (why) => reader.cancel(why) }) };
    }
  }
  const out = new Uint8Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return { bytes: out };
}

function basicParts(v) { // "Basic xxx" -> decoded text, or null
  const m = /^Basic\s+([A-Za-z0-9+/=_-]+)$/i.exec(v); if (!m) return null;
  try { return dec.decode(b64decode(m[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch { return null; }
}
const scheme = (v) => (/^([A-Za-z0-9-]+)\s/.exec(v) || [])[1]?.toLowerCase() || "";
const stand = (s) => s.match(STANDIN_RE) || [];

// Every stand-in the request carries in its URL, headers (also inside Basic credentials) and scanned body.
export function findStandins({ url, headers, bodyBin = "" }) {
  const found = new Set(stand(url));
  for (const [, v] of headers) { stand(v).forEach((x) => found.add(x)); const b = basicParts(v); if (b) stand(b).forEach((x) => found.add(x)); }
  stand(bodyBin).forEach((x) => found.add(x));
  return found;
}

function multipartSwap(bin, contentType, sub) {
  const b = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType); if (!b) return bin;
  const marker = "--" + utf8bin(b[1] || b[2]), parts = bin.split(marker);
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].startsWith("--")) break;
    const cut = parts[i].indexOf("\r\n\r\n"); if (cut < 0) continue;
    const head = parts[i].slice(0, cut), type = /content-type:\s*([^\r\n;]+)/i.exec(head)?.[1]?.toLowerCase();
    if (/filename\s*=/i.test(head) || (type && !/^text\/|json|xml/.test(type))) continue;
    parts[i] = head + parts[i].slice(cut).replace(STANDIN_RE, (m) => sub(m, (x) => x));
  }
  return parts.join(marker);
}

// Params of a query string or form body: [[name, value], ...] decoded.
const pairs = (s) => String(s || "").split("&").filter(Boolean).map((p) => { const i = p.indexOf("="); return i < 0 ? [dq(p), ""] : [dq(p.slice(0, i)), dq(p.slice(i + 1))]; });
const sortEnc = (list) => list.map(([k, v]) => [pct(k), pct(v)]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);

// ---- OAuth 1.0a ----
const OAUTH_PARAM = /([^=,\s]+)\s*=\s*"([^"]*)"/g;
export async function oauthSignature({ method, url, params, consumerSecret = "", tokenSecret = "", sigMethod }) {
  const u = new URL(url), base = `${u.protocol}//${u.host}${u.pathname}`;
  const key = pct(consumerSecret) + "&" + pct(tokenSecret);
  if (sigMethod === "PLAINTEXT") return key;
  const all = sortEnc([...params, ...pairs(u.search.slice(1))]).map(([k, v]) => k + "=" + v).join("&");
  const text = [method.toUpperCase(), pct(base), pct(all)].join("&");
  return b64encode(await hmac(sigMethod === "HMAC-SHA256" ? "SHA-256" : "SHA-1", key, text));
}

// ---- AWS SigV4 ----
const awsPath = (p, s3) => s3 ? (p || "/") : (p || "/").split("/").map(pct).join("/");
export async function sigv4Signature({ method, url, headers, payloadHash, secret, date, region, service, signedHeaders }) {
  const u = new URL(url);
  const canonHeaders = signedHeaders.map((h) => {
    let v = headers.get(h); if (v == null && h === "host") v = u.host;
    return h + ":" + String(v ?? "").trim().replace(/\s+/g, " ") + "\n";
  }).join("");
  const query = sortEnc(pairs(u.search.slice(1))).map(([k, v]) => k + "=" + v).join("&");
  const canon = [method.toUpperCase(), awsPath(u.pathname, service === "s3"), query, canonHeaders, signedHeaders.join(";"), payloadHash].join("\n");
  const scope = `${date.slice(0, 8)}/${region}/${service}/aws4_request`;
  const sts = ["AWS4-HMAC-SHA256", date, scope, hex(await sha256(enc.encode(canon)))].join("\n");
  let k = await hmac("SHA-256", "AWS4" + secret, date.slice(0, 8));
  for (const part of [region, service, "aws4_request"]) k = await hmac("SHA-256", k, part);
  return hex(await hmac("SHA-256", k, sts));
}

export const SECRET_CANDIDATES_MAX = 30; // saved keys for the request host that are tried as signing secrets

// rewriteRequest: { host, method, url, headers (Headers), bodyBytes (Uint8Array | null),
//   lookup(standins) -> rows { name, standin, hosts(JSON), sealed } of this account,
//   lookupHostKeys() -> every saved key row of this account (the sentinel keeps those bound to the host),
//   open(row) -> real value }
// -> { url, headers, bodyBytes, swapped: [key names], refused: [key names], resigned: "oauth1" | "sigv4" | "" }
export async function rewriteRequest({ host, method, url, headers, bodyBytes, lookup, lookupHostKeys, open }) {
  headers = new Headers(headers); const url0 = url, bodyBytes0 = bodyBytes, headers0 = new Headers(headers); const swapped = [], refused = []; let resigned = "", bodyChanged = false;
  const kind = bodyBytes ? bodyKind(headers) : null;
  let bodyBin = bodyBytes && kind ? toBin(bodyBytes) : "";
  const found = findStandins({ url, headers, bodyBin });
  const auth0 = headers.get("authorization") || "";
  if (!found.size) return { url, headers, bodyBytes, swapped, refused, resigned };

  const rows = await lookup([...found]), real = new Map(), realBody = new Map(), used = new Map();
  for (const r of rows) {
    if (!hostMatch(host, JSON.parse(r.hosts))) { refused.push(r.name); continue; }
    // URL, headers and signing secrets get the value without outer whitespace. A body gets the stored value when it has inner line breaks (PEM), else the trimmed one.
    const stored = await open(r), t = trimKey(stored);
    real.set(r.standin, t); realBody.set(r.standin, /[\r\n]/.test(t) ? stored : t); used.set(r.standin, r); swapped.push(r.name);
  }
  const sub = (m, f) => real.has(m) ? f(real.get(m)) : m;
  const subBody = (m, f) => realBody.has(m) ? f(realBody.get(m)) : m;

  // The signing parameters have to be read before the swap: they name the stand-ins that the secrets are paired with.
  const oauth = /^OAuth\s/i.test(auth0) ? [...auth0.matchAll(OAUTH_PARAM)].map((m) => [m[1], m[2]]) : null;
  const aws = /^AWS4-HMAC-SHA256\s/.test(auth0) ? { cred: /Credential=([^,\s]+)/.exec(auth0)?.[1] || "", signed: /SignedHeaders=([^,\s]+)/.exec(auth0)?.[1] || "" } : null;

  if (real.size) {
    // URL: encoded for a URL.
    url = url.replace(STANDIN_RE, (m) => sub(m, encodeURIComponent));
    // Headers: Basic is decoded and encoded again, OAuth values are percent-encoded, the rest is inserted as is.
    for (const [k, v] of [...headers]) {
      if (/^(proxy-)?authorization$/i.test(k)) {
        const b = scheme(v) === "basic" ? basicParts(v) : null;
        if (b != null) { if (HAS.test(b)) headers.set(k, "Basic " + b64encode(enc.encode(b.replace(STANDIN_RE, (m) => sub(m, (x) => x))))); continue; }
        if (scheme(v) === "oauth") { headers.set(k, v.replace(STANDIN_RE, (m) => sub(m, pct))); continue; }
      }
      if (HAS.test(v)) headers.set(k, v.replace(STANDIN_RE, (m) => sub(m, (x) => x)));
    }
    // Body.
    if (kind && HAS.test(bodyBin)) {
      if (kind === "multipart") bodyBin = multipartSwap(bodyBin, headers.get("content-type") || "", (m, f) => subBody(m, (x) => utf8bin(f(x))));
      else { const e = encFor(kind); bodyBin = bodyBin.replace(STANDIN_RE, (m) => subBody(m, (x) => utf8bin(e(x)))); }
      const next = fromBin(bodyBin);
      if (toBin(bodyBytes) !== bodyBin) { bodyBytes = next; bodyChanged = true; headers.delete("content-length"); headers.delete("transfer-encoding"); }
    }
  }

  // Signed requests. The computer signed with stand-ins. Nothing says which saved key is the secret, so the sentinel tries the account's saved keys
  // that are bound to this host (at most SECRET_CANDIDATES_MAX, by name) until one reproduces the signature the computer sent. Then it signs the
  // request again with the real values. The secrets are used only inside the signature. No match: the request goes out as the swap left it.
  const cands = async () => {
    const all = ((await lookupHostKeys().catch(() => [])) || []).filter((r) => hostMatch(host, JSON.parse(r.hosts))).sort((a, b) => a.name < b.name ? -1 : 1);
    return all.slice(0, SECRET_CANDIDATES_MAX);
  };
  const useRow = async (r) => { if (!swapped.includes(r.name)) swapped.push(r.name); return trimKey(await open(r)); };
  if (oauth && /^OAuth\s/i.test(auth0)) {
    const get = (n) => oauth.find(([k]) => k === n)?.[1], sigMethod = dq(get("oauth_signature_method") || ""), got = dq(get("oauth_signature") || "");
    if (got && ["HMAC-SHA1", "HMAC-SHA256", "PLAINTEXT"].includes(sigMethod) && (used.has(get("oauth_consumer_key")) || used.has(get("oauth_token")))) {
      const sentParams = oauth.filter(([k]) => k !== "oauth_signature" && k !== "realm").map(([k, v]) => [dq(k), dq(v)]);
      const sentForm = kind === "form" && bodyBytes0 ? pairs(dec.decode(bodyBytes0)) : [];
      const list = await cands(); let hit = null;
      for (const a of [null, ...list]) for (const b of [null, ...list]) {
        if ((!a && !b) || (a && a === b)) continue;
        const sig = await oauthSignature({ method, url: url0, params: [...sentParams, ...sentForm], consumerSecret: a?.standin || "", tokenSecret: b?.standin || "", sigMethod });
        if (sig === got) { hit = [a, b]; break; }
      }
      if (hit) {
        const cs = hit[0] ? await useRow(hit[0]) : "", ts = hit[1] ? await useRow(hit[1]) : "";
        const cur = headers.get("authorization") || auth0;
        const params = [...cur.matchAll(OAUTH_PARAM)].filter((m) => m[1] !== "oauth_signature" && m[1] !== "realm").map((m) => [dq(m[1]), dq(m[2])]);
        const form = kind === "form" && bodyBytes ? pairs(dec.decode(bodyBytes)) : [];
        const sig = await oauthSignature({ method, url, params: [...params, ...form], consumerSecret: cs, tokenSecret: ts, sigMethod });
        headers.set("authorization", cur.replace(/(oauth_signature\s*=\s*")[^"]*(")/, (_, a, b) => a + pct(sig) + b)); resigned = "oauth1";
      }
    }
  } else if (aws) {
    const [akid, d, region, service] = aws.cred.split("/"), cur = headers.get("authorization") || auth0, pub = used.get(akid) || null;
    const amzDate = headers.get("x-amz-date") || "", signed = aws.signed.split(";"), got = /Signature=([0-9a-f]+)/.exec(auth0)?.[1];
    const empty = ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
    const hashOf = async (hdrs, b) => { const h = hdrs.get("x-amz-content-sha256"); if (h != null && !(b && /^[0-9a-f]{64}$/.test(h))) return h; const body = b ?? (empty ? new Uint8Array(0) : null); return body ? hex(await sha256(body)) : null; };
    if (pub && got && amzDate && service && region) {
      const sentHash = await hashOf(headers0, bodyBytes0);
      if (sentHash) for (const c of await cands()) {
        if (await sigv4Signature({ method, url: url0, headers: headers0, payloadHash: sentHash, secret: c.standin, date: amzDate, region, service, signedHeaders: signed }) !== got) continue;
        const secret = await useRow(c);
        // A body that was swapped changes a hash the computer worked out, so the header that carries it is recomputed too.
        let finalHash = sentHash; const hdr = headers.get("x-amz-content-sha256");
        if (bodyChanged && (hdr == null || /^[0-9a-f]{64}$/.test(hdr))) { finalHash = hex(await sha256(bodyBytes)); if (hdr != null) headers.set("x-amz-content-sha256", finalHash); }
        const sig = await sigv4Signature({ method, url, headers, payloadHash: finalHash, secret, date: amzDate, region, service, signedHeaders: signed });
        headers.set("authorization", cur.replace(/Signature=[0-9a-f]+/, "Signature=" + sig)); resigned = "sigv4"; break;
      }
    }
  }
  return { url, headers, bodyBytes, swapped, refused, resigned };
}
