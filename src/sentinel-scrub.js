// Sentinel response scrubbing. Pure code (no Workers imports) so it is unit tested.
// The Sentinel puts real saved-key values into outbound requests. An API on the key's own host can echo the request (headers, URL or body)
// back, and the computer must never see the real value. hideEchoedKeys puts the stand-in back wherever a real value comes back, in the
// response headers, status text and body (as a stream, so the body size is not limited).
// A real value can come back in these forms, and every one is covered: raw text, URL-encoded (encodeURIComponent with upper and lower case hex,
// the stricter pct form that also encodes !'()*, and the form variant with "+" for a space), percent-encoded twice (an OAuth PLAINTEXT
// signature is a percent-encoded value inside a percent-encoded header), JSON-escaped (standard, escaped again for JSON inside a JSON string such as an echoed "data" field, with "\/", with \uXXXX escapes), XML/HTML-escaped,
// and the base64 text of a Basic credential (see basicEchoPairs).
// Not covered: a service that transforms a key in some other way (hash, other encoding, split across lines).
const enc = new TextEncoder();
const pct = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const lowerHex = (s) => s.replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase());
const uEsc = (s, upper) => s.split("").map((c) => { if (/[A-Za-z0-9]/.test(c)) return c; const h = c.charCodeAt(0).toString(16).padStart(4, "0"); return "\\u" + (upper ? h.toUpperCase() : h); }).join("");
const xml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

// Every text form in which one real value can show up in a response.
export function echoForms(real) {
  const out = new Set(); if (!real) return out;
  const json = JSON.stringify(real).slice(1, -1), url = encodeURIComponent(real), strict = pct(real);
  for (const u of [url, strict]) { out.add(u); out.add(lowerHex(u)); out.add(u.replace(/%20/gi, "+")); out.add(lowerHex(u.replace(/%20/gi, "+"))); }
  for (const u of [pct(strict), pct(url)]) { out.add(u); out.add(lowerHex(u)); }
  out.add(real); out.add(json); out.add(JSON.stringify(json).slice(1, -1)); out.add(json.replace(/\//g, "\\/")); out.add(uEsc(real, false)); out.add(uEsc(real, true)); out.add(xml(real));
  out.delete(""); return out;
}

// The base64 of a Basic credential: the real value inside it is not visible in base64, so the whole credential text is replaced by the one the
// computer sent. Compares the request headers before and after the swap; returns { real, standin } pairs for every Basic header that changed.
export function basicEchoPairs(before, after) {
  const pairs = [], tok = (v) => /^Basic\s+([A-Za-z0-9+/=_-]+)$/i.exec(v || "")?.[1];
  for (const [k, v] of before) {
    const a = tok(v), b = tok(after.get(k)); if (!a || !b || a === b) continue;
    const forms = (t) => { const std = t.replace(/-/g, "+").replace(/_/g, "/"), plain = std.replace(/=+$/, ""); return [std, plain, std.replace(/\+/g, "-").replace(/\//g, "_"), plain.replace(/\+/g, "-").replace(/\//g, "_")]; };
    const fa = forms(a), fb = forms(b);
    fb.forEach((real, i) => pairs.push({ real, standin: fa[i] }));
  }
  return pairs;
}

// secrets: [{ real, standin }]. Returns a Response with every echoed real value replaced by its stand-in.
export function hideEchoedKeys(res, secrets) {
  const reps = [], seen = new Set();
  for (const { real, standin } of secrets) for (const value of echoForms(real)) {
    if (seen.has(value)) continue; seen.add(value);
    reps.push({ value, needle: enc.encode(value), standin, standinBytes: enc.encode(standin) });
  }
  reps.sort((a, b) => b.needle.length - a.needle.length);
  const scrub = (s) => reps.reduce((t, p) => t.split(p.value).join(p.standin), s);
  const headers = new Headers();
  for (const [name, value] of res.headers) headers.append(scrub(name), scrub(value));
  // The body may change length, so validators, digests and an upstream byte count would be false.
  for (const name of ["content-length", "content-range", "accept-ranges", "etag", "content-md5", "digest"]) headers.delete(name);
  const statusText = scrub(res.statusText || "");
  if (!res.body) return new Response(null, { status: res.status, statusText, headers });
  const byFirst = new Map(); for (const p of reps) { const l = byFirst.get(p.needle[0]) || []; l.push(p); byFirst.set(p.needle[0], l); }
  const keep = Math.max(0, ...reps.map((p) => p.needle.length - 1));
  let pending = new Uint8Array(0);
  const write = (data, end, controller) => {
    const limit = end ? data.length : Math.max(0, data.length - keep), parts = []; let i = 0, from = 0;
    while (i < limit) {
      const hit = (byFirst.get(data[i]) || []).find(({ needle }) => needle.length <= data.length - i && needle.every((b, j) => b === data[i + j]));
      if (hit) { if (i > from) parts.push(data.subarray(from, i)); parts.push(hit.standinBytes); i += hit.needle.length; from = i; } else i++;
    }
    if (limit > from) parts.push(data.subarray(from, limit));
    pending = data.slice(Math.max(i, limit));
    if (!parts.length) return;
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    controller.enqueue(out);
  };
  const body = res.body.pipeThrough(new TransformStream({
    transform(chunk, controller) { const d = new Uint8Array(pending.length + chunk.length); d.set(pending); d.set(chunk, pending.length); write(d, false, controller); },
    flush(controller) { write(pending, true, controller); },
  }));
  return new Response(body, { status: res.status, statusText, headers });
}

// True when a response cannot be scanned as bytes (the body is still compressed or otherwise encoded).
export const encodedResponse = (res) => { const ce = res.headers.get("content-encoding"); return !!ce && ce.trim().toLowerCase() !== "identity"; };
