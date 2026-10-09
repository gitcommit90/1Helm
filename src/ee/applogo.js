// Composio app logos through 1HC, so Settings → Connected accounts never waits on a slow logo host:
//   GET /applogo/<app>   (<app> = a Composio toolkit slug: gmail, googlecalendar, slack…)
// logos.composio.dev sits on Vercel and a cold logo can take 10+ s (Captain, 10-07: "a bunch of blank company logos"). We fetch
// each logo once, keep it in R2 (applogo/v1/<app>, refreshed after 30 days) and in the Cache API, and answer with a week of
// browser cache. Public and free like the logos themselves: no sign-in, no key, no paid logo API.
// Safety: only [a-z0-9_-] slugs, only image/* answers up to 256 KB, and an SVG opened on its own runs no script
// (CSP sandbox + nosniff); inside an <img> it never could. A logo host that's slow or down gives a 404 that isn't stored,
// and the app keeps showing the app's letter tile.
import { stPut } from "../storage.js";
import { cappedResponseBytes } from "../bounded-response.js";

const UP = "https://logos.composio.dev/api/";
const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const DAY = 86400, WEEK = 7 * DAY, REFRESH = 30 * DAY, MAX = 256 * 1024, WAIT = 20000, COLD_PER_MIN = 60;
const RL = new Map();   // ip → { m, n }: cold (not cached anywhere) fetches per minute, per isolate
export function _resetAppLogo() { RL.clear(); }
function coldOk(ip, t = Date.now()) {
  const m = Math.floor(t / 60000), r = RL.get(ip);
  if (!r || r.m !== m) { if (RL.size > 5000) RL.clear(); RL.set(ip, { m, n: 1 }); return true; }
  return ++r.n <= COLD_PER_MIN;
}
const headers = (type, src) => ({ "content-type": type, "cache-control": `public, max-age=${WEEK}, stale-while-revalidate=${WEEK}`, "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox", "access-control-allow-origin": "*", "x-applogo": src });
const none = (why, maxAge = 0) => new Response("No logo", { status: 404, headers: { "content-type": "text/plain;charset=utf-8", "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store", "x-applogo": why } });

/** Handles /applogo/<app> (any host, no sign-in). null for other paths. */
export async function appLogoRoute(req, env, ctx, url) {
  if (!url.pathname.startsWith("/applogo/")) return null;
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  const slug = url.pathname.slice(9).toLowerCase();
  if (!SLUG.test(slug)) return none("invalid", DAY);
  const cache = globalThis.caches?.default, key = new Request(`${url.origin}/applogo/${slug}`);
  const keep = (res) => { if (cache) ctx.waitUntil(cache.put(key, res.clone()).catch(() => {})); return res; };
  if (cache) { const hit = await cache.match(key).catch(() => null); if (hit) return hit; }
  const rkey = `applogo/v1/${slug}`;
  const obj = env.WS ? await env.WS.get(rkey).catch(() => null) : null;
  const fresh = obj && Date.now() - Number(obj.customMetadata?.at || 0) < REFRESH * 1000;
  if (obj && fresh) return keep(new Response(obj.body, { headers: headers(obj.httpMetadata?.contentType || "image/svg+xml", "r2") }));
  if (!obj && !coldOk(req.headers.get("cf-connecting-ip") || "?")) return none("slow");
  let up = null;
  try { up = await fetch(UP + slug, { headers: { accept: "image/svg+xml,image/*" }, signal: AbortSignal.timeout(WAIT) }); } catch {}
  const type = (up?.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const bytes = up?.ok && type.startsWith("image/") ? await cappedResponseBytes(up, MAX).catch(() => null) : null;
  if (bytes && bytes.byteLength && bytes.byteLength <= MAX) {
    if (env.WS) ctx.waitUntil(stPut(env, rkey, bytes, { httpMetadata: { contentType: type }, customMetadata: { at: String(Date.now()) } }).catch(() => {}));   // not an account's key: never counted
    return keep(new Response(bytes, { headers: headers(type, "upstream") }));
  }
  // Upstream failed: an older copy beats no logo (served, not re-cached, so the next view tries again).
  if (obj) return new Response(obj.body, { headers: { ...headers(obj.httpMetadata?.contentType || "image/svg+xml", "r2-stale"), "cache-control": "public, max-age=3600" } });
  return none(up ? `upstream-${up.status}` : "upstream");
}
