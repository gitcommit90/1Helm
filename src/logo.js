// Company and site logos from logo.dev, through one public route so <img> tags work everywhere (the app, the card page in
// Messages, <slug>.1helm.com) without the page knowing the key:
//   GET /logo/<domain>?size=64|128|256&theme=light|dark
// Budget (Community plan): 500,000 CDN requests a month, hard cap (past it logo.dev answers 429 and we show letter tiles,
// so nothing is ever billed). The Logo.dev API (secret key, 500 credits) is NOT used: every place we show a logo
// has a domain, and the CDN's own /name/<brand> lookup would cover a bare name. Attribution (Community plan, commercial):
// "Logos provided by Logo.dev" in the public sign-up page footer (app-assets/onboard/v1/index.html).
//
// LOGO_DEV_MODE picks how the image reaches the browser:
//   "redirect" (default): we check and normalize the request, then send a 302 to img.logo.dev with our publishable key.
//       The browser loads the image from logo.dev itself and keeps it 24 h (logo.dev's Cache-Control). This is what
//       logo.dev's fair-use terms ask for ("Load Logo.dev CDN images in your users' browsers", "Don't download from the CDN
//       to build your own copy", "an API that proxies Logo.dev requests" is not fair use). Junk (bad domain, odd size) never
//       reaches logo.dev; a domain logo.dev has no logo for answers 404 (fallback=404), and the app shows its letter tile and
//       remembers the miss in that browser for a week.
//   "proxy": fetch img.logo.dev once per (domain, size, theme), keep it in the Cache API (immutable, 1 year) and in R2
//       (logo/v1/…), negative-cache misses for 30 days, rate-limit cold misses per IP and cap upstream fetches per month
//       in D1 (logo_usage). Only switch this on with logo.dev's written OK: as is, it goes against their fair-use terms,
//       and every cold fetch would come from Cloudflare's IPs (Community plan per-IP limits).
//   "off": every logo request is a 404 (letter tiles everywhere). Also the mode when LOGO_DEV_PK is missing.

import { cappedResponseBytes } from "./bounded-response.js";

export const LOGO_SIZES = [64, 128, 256];
const THEMES = new Set(["light", "dark"]);
const UPSTREAM = "https://img.logo.dev";
const YEAR = 31536000, DAY = 86400;
export const NEG_TTL = 30 * DAY;                 // a "no logo" answer is kept this long (proxy mode)
const COLD_PER_MIN = 30;                         // cold misses one IP can cause per minute per isolate (proxy mode)
const DEFAULT_CAP = 400000;                      // upstream fetches per calendar month before we stop asking (proxy mode)
const LOGO_MAX_BYTES = 1_000_000;
// Names that can't be a public company site: never sent upstream.
const PRIVATE_TLD = new Set(["local", "localhost", "internal", "intranet", "lan", "home", "corp", "test", "example", "invalid", "arpa", "onion", "localdomain"]);

/** "https://WWW.Stripe.com:443/pricing?x" → "stripe.com"; anything that isn't a public hostname → "". */
export function logoDomain(input) {
  let s = String(input ?? "").trim().toLowerCase();
  if (!s || s.length > 300) return "";
  try { s = decodeURIComponent(s); } catch { return ""; }
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^[^/@?#]*@/, "").split(/[/?#\\]/)[0].replace(/:\d*$/, "").replace(/\.$/, "").replace(/^\*\./, "").replace(/^www\d?\./, "");
  if (s.length < 4 || s.length > 253) return "";
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(s)) return "";
  if (PRIVATE_TLD.has(s.slice(s.lastIndexOf(".") + 1))) return "";
  return s;
}

/** The query we accept: size from LOGO_SIZES (default 64), theme light|dark (default light). null = refuse. */
export function logoParams(url) {
  const sz = url.searchParams.get("size"), th = url.searchParams.get("theme");
  const size = sz == null || sz === "" ? 64 : Number(sz);
  if (!LOGO_SIZES.includes(size) || (sz != null && sz !== "" && String(size) !== sz)) return null;
  const theme = th == null || th === "" ? "light" : th;
  if (!THEMES.has(theme)) return null;
  return { size, theme };
}

export function logoMode(env) {
  if (!env.LOGO_DEV_PK) return "off";
  const m = String(env.LOGO_DEV_MODE || "redirect").toLowerCase();
  return m === "proxy" || m === "off" ? m : "redirect";
}

// The img.logo.dev URL for one variant. fallback=404: no generated monogram (we have our own letter tile).
// redirect=404: a domain that only reaches a brand by redirecting (a typo domain pointing at a real brand) gets no logo,
// so a look-alike host never borrows a real brand's logo (this matters on permission cards).
export function upstreamUrl(env, domain, { size, theme }) {
  const q = new URLSearchParams({ token: env.LOGO_DEV_PK, size: String(size), format: "webp", fallback: "404", redirect: "404" });
  if (theme === "dark") q.set("theme", "dark");
  return `${UPSTREAM}/${domain}?${q}`;
}

const none = (maxAge = DAY, why = "invalid") => new Response("No logo", { status: 404, headers: { "content-type": "text/plain;charset=utf-8", "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store", "x-logo": why, "access-control-allow-origin": "*" } });

/** Handles /logo/… (any host, no sign-in). Returns null for other paths. */
export async function logoRoute(req, env, ctx, url) {
  if (!url.pathname.startsWith("/logo/")) return null;
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  const raw = url.pathname.slice(6);                 // logoDomain decodes it ("https%3A%2F%2Fstripe.com" is fine)
  const domain = raw.includes("/") ? "" : logoDomain(raw), p = logoParams(url);
  if (!domain || !p) return none();
  const mode = logoMode(env);
  if (mode === "off") return none(300, "off");
  if (mode === "redirect") return new Response(null, { status: 302, headers: { location: upstreamUrl(env, domain, p), "cache-control": `public, max-age=${DAY}`, "x-logo": "redirect" } });
  return proxy(req, env, ctx, url, domain, p);
}

// ---------- proxy mode ----------
const RL = new Map();   // ip → { m: minute, n } (per isolate; a speed bump in front of the D1 monthly cap)
export function _resetLogoRateLimit() { RL.clear(); }
function coldAllowed(ip, t = Date.now()) {
  const m = Math.floor(t / 60000), r = RL.get(ip);
  if (!r || r.m !== m) { if (RL.size > 5000) RL.clear(); RL.set(ip, { m, n: 1 }); return true; }
  return ++r.n <= COLD_PER_MIN;
}
const month = (t = Date.now()) => new Date(t).toISOString().slice(0, 7);
// +1 upstream fetch this month; false (refuse) past LOGO_DEV_CDN_CAP or if the counter can't be read (fail closed).
async function spendCdn(env) {
  if (!env.DB) return false;
  const cap = Number(env.LOGO_DEV_CDN_CAP) || DEFAULT_CAP;
  try {
    const r = await env.DB.prepare("INSERT INTO logo_usage (k, n) VALUES (?, 1) ON CONFLICT(k) DO UPDATE SET n = n + 1 RETURNING n").bind(`cdn:${month()}`).first();
    return Number(r?.n) > 0 && Number(r.n) <= cap;
  } catch { return false; }
}

const imgHeaders = (type, src) => ({ "content-type": type, "cache-control": `public, max-age=${YEAR}, immutable`, "x-logo": src, "access-control-allow-origin": "*",
  "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" });

async function proxy(req, env, ctx, url, domain, p) {
  const cache = globalThis.caches?.default, key = new Request(`${url.origin}/logo/${domain}?size=${p.size}&theme=${p.theme}`);
  const keep = (res) => { if (cache) ctx.waitUntil(cache.put(key, res.clone()).catch(() => {})); return res; };
  if (cache) { const hit = await cache.match(key); if (hit) return hit; }
  const rkey = `logo/v1/${p.theme}/${p.size}/${domain}`;
  const obj = env.WS ? await env.WS.get(rkey).catch(() => null) : null;
  if (obj) {
    const meta = obj.customMetadata || {};
    if (meta.miss === "1") {
      const left = NEG_TTL - Math.floor((Date.now() - Number(meta.at || 0)) / 1000);
      if (left > 0) return keep(none(left, "miss"));
    } else return keep(new Response(obj.body, { headers: imgHeaders(obj.httpMetadata?.contentType || "image/webp", "r2") }));
  }
  const ip = req.headers.get("cf-connecting-ip") || "?";
  if (!coldAllowed(ip)) return none(0, "slow");
  if (!(await spendCdn(env))) return none(0, "cap");
  let up; try { up = await fetch(upstreamUrl(env, domain, p), { headers: { accept: "image/webp,image/*" } }); } catch { return none(0, "upstream"); }
  const type = up.headers.get("content-type") || "";
  if (up.status === 404) {
    if (env.WS) ctx.waitUntil(env.WS.put(rkey, "", { customMetadata: { miss: "1", at: String(Date.now()) } }).catch(() => {}));
    return keep(none(NEG_TTL, "miss"));
  }
  if ((up.status === 200 || up.status === 202) && type.startsWith("image/")) {
    const bytes = await cappedResponseBytes(up, LOGO_MAX_BYTES).catch(() => null);
    if (!bytes) return none(0, "upstream-too-large");
    // 202 = logo.dev is still fetching this brand: show the stand-in for 5 minutes, never store it.
    if (up.status === 202) return new Response(bytes, { headers: { ...imgHeaders(type, "pending"), "cache-control": "public, max-age=300" } });
    if (env.WS) ctx.waitUntil(env.WS.put(rkey, bytes, { httpMetadata: { contentType: type }, customMetadata: { at: String(Date.now()) } }).catch(() => {}));
    return keep(new Response(bytes, { headers: imgHeaders(type, "upstream") }));
  }
  // 401/403/429/5xx: don't store; the browser shows the letter tile and asks again later.
  return none(0, `upstream-${up.status}`);
}
