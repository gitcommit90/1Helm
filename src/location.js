import { boundedJson } from "./bounded-body.js";
// Where the person is, so the helper never has to ask "where are you?" mid-task (Captain 10-07: "coffee recs" shouldn't stall
// on a location question).
// - The app asks for location (and the microphone) once, up front: at sign-in on each device and in onboarding (design-sandbox
//   devperm.ts). With location allowed, it sends a coarse fix (lat/lng rounded to 2 decimals, about 1 km) when it starts, when it
//   comes back into focus with a fix older than 15 minutes, and with each message.
// - Kept per account: ONE row, the last known fix and its place name (tenant_location). No history: a new fix replaces it.
//   "Forget my location" (Settings → Location & mic) deletes it; deleting the account deletes it (deletion.js: every tenant_id table).
// - The place name ("Oakland, California") comes from OpenStreetMap's free Nominatim service, at city level, only when the
//   rounded spot changes (so a phone sitting at home looks it up once). Only the rounded spot is sent; no account, name or IP of theirs.
// - Every turn's message carries one line (placeLine): their home from the Notebook AND the device fix when both are known (home
//   for home things, the device for "near me"), else whichever one is, else the region of their time zone, stated as an assumption.
//   Never in the system prompt (it changes), never saved with the message.
export const LOC_FRESH_MS = 15 * 60e3;           // the app refreshes a fix older than this (on focus, before sending)
export const LOC_USE_MS = 7 * 24 * 3600e3;        // older than a week: not used at all (they've likely moved on)
export const LOC_NOW_MS = 6 * 3600e3;             // up to 6 h: "near X"; older: "last known near X"
const geoAgent = (contact) => `1Helm/1.0 (self-hosted${contact ? `; contact: ${contact}` : ""})`;

export const coarse = (x) => Math.round(Number(x) * 100) / 100;
// A fix from the app: { lat, lng } numbers in range → rounded; anything else → null.
export function cleanFix(b) {
  if (!b || typeof b !== "object") return null;
  const lat = Number(b.lat), lng = Number(b.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;   // "null island": a broken fix, not a place
  return { lat: coarse(lat), lng: coarse(lng) };
}

// Nominatim's answer → "Oakland, California" (US) or "Lyon, France" (elsewhere). City-level only, never a street.
export function placeLabel(j) {
  const a = j?.address || {}; if (!a || typeof a !== "object") return "";
  const city = a.city || a.town || a.village || a.municipality || a.hamlet || a.suburb || a.city_district || a.county || "";
  const region = a.state || a.region || a.province || a.state_district || "";
  const cc = String(a.country_code || "").toUpperCase();
  const parts = [city, region && region !== city ? region : "", cc && cc !== "US" ? a.country || cc : ""].filter(Boolean);
  return parts.join(", ").replace(/\s+/g, " ").slice(0, 120);
}
export async function reverseGeocode(lat, lng, f = fetch, contact = "") {
  const u = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&addressdetails=1&accept-language=en&lat=${lat}&lon=${lng}`;
  try {
    const r = await f(u, { headers: { "user-agent": geoAgent(contact), accept: "application/json" }, signal: AbortSignal.timeout(2500) });
    return r.ok ? placeLabel(await r.json()) : "";
  } catch { return ""; }
}

export async function locationOf(env, tid) {
  try { return await env.DB.prepare("SELECT lat, lng, place, at FROM tenant_location WHERE tenant_id=?").bind(String(tid)).first() || null; } catch { return null; }
}
// Save the account's last known fix. Same rounded spot as before: only its time moves (no lookup). A new spot: look up its name.
export async function saveLocation(env, tid, fix, at = Date.now(), geo = reverseGeocode) {
  const c = cleanFix(fix); if (!c) return { error: "bad_location" };
  const when = Math.min(Number(at) || Date.now(), Date.now());
  const old = await locationOf(env, tid);
  if (old && old.lat === c.lat && old.lng === c.lng && old.place) {
    if (when > Number(old.at)) await env.DB.prepare("UPDATE tenant_location SET at=?, updated_at=? WHERE tenant_id=?").bind(when, Date.now(), String(tid)).run();
    return { lat: c.lat, lng: c.lng, place: old.place, at: Math.max(when, Number(old.at)) };
  }
  const place = await geo(c.lat, c.lng, fetch, env.SUPPORT_EMAIL || env.EMAIL_FROM).catch(() => "") || "";
  await env.DB.prepare(`INSERT INTO tenant_location (tenant_id, lat, lng, place, at, updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(tenant_id) DO UPDATE SET lat=excluded.lat, lng=excluded.lng, place=excluded.place, at=excluded.at, updated_at=excluded.updated_at`).bind(String(tid), c.lat, c.lng, place, when, Date.now()).run();
  return { lat: c.lat, lng: c.lng, place, at: when };
}
export async function forgetLocation(env, tid) {
  const r = await env.DB.prepare("DELETE FROM tenant_location WHERE tenant_id=?").bind(String(tid)).run();
  return { ok: true, deleted: Number(r.meta?.changes || 0) };
}
// GET / POST / DELETE /api/location (index.js). POST { lat, lng, at? } → the saved fix with its place name.
export async function locationRoute(req, env, t, { look = false } = {}) {
  if (req.method === "GET") { const l = await locationOf(env, t.id); return Response.json({ location: l ? { place: l.place || "", at: Number(l.at) } : null }); }
  if (look) return Response.json({ error: "look_only" }, { status: 403 });
  if (req.method === "DELETE" || (req.method === "POST" && new URL(req.url).pathname.endsWith("/forget"))) return Response.json(await forgetLocation(env, t.id));
  if (req.method !== "POST") return Response.json({ error: "POST only" }, { status: 405 });
  const b = await boundedJson(req);
  const r = await saveLocation(env, t.id, b, Number(b.at) || Date.now());
  return r.error ? Response.json(r, { status: 400 }) : Response.json({ location: { place: r.place, at: r.at } });
}

// ---- Home from the Notebook: "Lives at 2968 S Robertson Blvd …" (typed in), "Lives in or near Austin, TX." (the interview),
// "Home address: …", "My address is …", "I live in …", "Home is in Rockridge" — never "Dana lives in Denver" (not theirs) or "Lives with
// a partner" (no place). Returns the place as written ("2968 S Robertson Blvd Los Angeles CA 90034"), its first sentence only.
// Several: the most specific (a street address over a postcode over a city), the most recent among equals; but a newer note naming
// another city means they've moved, so the newest wins then. Their own words (author human) break a tie.
const HOME_LEADS = [
  /^(?:i\s+)?(?:currently\s+)?(?:live|lives|living|reside|resides|residing)\s+(?:in or near|in or around|at|in|on|near|around|outside(?: of)?)\s+(.+)/i,
  /^(?:i\s+am\s+|i'm\s+|is\s+)?based\s+(?:in|out of|at|near)\s+(.+)/i,
  /^(?:(?:my|their|his|her)\s+)?(?:home|house|apartment|flat|place)\s+is\s+(?:at|in|on|near)\s+(.+)/i,
  /^(?:(?:my|their|his|her)\s+)?(?:(?:home|street|mailing|house|apartment)\s+)?address(?:\s+is\s+|\s*[:\-–]\s*)(.+)/i,
  /^(?:home|house)\s*[:\-–]\s*(.+)/i,
];
const NOT_PLACE = /^(?:a\s+)?(?:budget|shoestring|tight|the\s+edge|his\s+own|her\s+own|their\s+own)\b/i;
const ABBR = /(?:^|\s)(?:st|ave|blvd|rd|dr|ln|ct|pl|apt|ste|mt|ft|no|n|s|e|w|ne|nw|se|sw|u\.s|d\.c)$/i;
const STREET = /\b\d{1,6}[a-z]?(?:\s+\d\/\d)?\s+(?:[A-Za-z0-9.'’-]+\s+){0,4}(?:st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|way|ct|court|pl|place|ter|terrace|pkwy|parkway|hwy|highway|cir|circle|sq|square|trl|trail|loop|row|walk|close|crescent|cres)\b/i;
const POSTCODE = /\b\d{5}(?:-\d{4})?\b|\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b|\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/;
export const homeTier = (p) => (STREET.test(p) ? 2 : POSTCODE.test(p) ? 1 : 0);
// "or near Los Angeles, California. Pacific Time (…)." → "Los Angeles, California" (first sentence; "S. Robertson Blvd." stays whole).
function firstSentence(t) {
  let s = String(t).replace(/\s+/g, " ").trim().replace(/^(?:or\s+(?:near|around)\s+)/i, "");
  const re = /\.\s+(?=[A-Z(])/g; let m;
  while ((m = re.exec(s))) if (!ABBR.test(s.slice(0, m.index))) { s = s.slice(0, m.index); break; }
  return s.replace(/[.;,\s]+$/, "").slice(0, 200);
}
export function homeFrom(content, firstName = "") {
  let s = String(content || "").replace(/\s+/g, " ").trim(); if (!s) return "";
  const fn = String(firstName || "").trim().toLowerCase();
  if (fn && new RegExp(`^${fn.replace(/[^a-z0-9]/g, ".")}(?:'s|’s)?\\s`, "i").test(s)) s = s.replace(/^\S+\s+/, "");
  s = s.replace(/^(?:the person|they|the user)(?:'s|’s)?\s+/i, "");
  for (const re of HOME_LEADS) { const m = s.match(re); if (m && m[1] && !NOT_PLACE.test(m[1].trim())) { const p = firstSentence(m[1]); if (p) return p; } }
  return "";
}
const cityKey = (p) => String(p).split(",")[0].toLowerCase().replace(/^(?:the\s+)/, "").replace(/[^a-z0-9 ]/g, "").trim();
export function pickHome(rows = [], firstName = "") {
  const c = [];
  for (const m of rows) {
    if (!m || m.status === "superseded" || m.superseded_by) continue;
    const place = homeFrom(m.content, firstName); if (!place) continue;
    c.push({ place, tier: homeTier(place), at: Number(m.edited || m.updated || m.created) || 0, own: m.author_type === "human" ? 1 : 0 });
  }
  if (!c.length) return "";
  const newest = [...c].sort((x, y) => y.at - x.at || y.own - x.own || y.tier - x.tier)[0];
  const specific = [...c].sort((x, y) => y.tier - x.tier || y.at - x.at || y.own - x.own)[0];
  const k = cityKey(newest.place), same = !k || specific.place.toLowerCase().replace(/[^a-z0-9 ]/g, "").includes(k);
  return (same ? specific : newest).place;
}

// "as of 3:12 PM" today in their zone, else "as of Mon, Oct 6, 3:12 PM".
export function whenLabel(at, now, tz) {
  const o = { timeZone: tz }, day = (x) => new Intl.DateTimeFormat("en-CA", { ...o, year: "numeric", month: "2-digit", day: "2-digit" }).format(x);
  const time = new Intl.DateTimeFormat("en-US", { ...o, hour: "numeric", minute: "2-digit" }).format(at);
  return day(at) === day(now) ? time : `${new Intl.DateTimeFormat("en-US", { ...o, weekday: "short", month: "short", day: "numeric" }).format(at)}, ${time}`;
}
// "Pacific Time" for America/Los_Angeles ("" when Intl has no name for it).
export function tzLabel(tz) {
  try { const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longGeneric" }).formatToParts(new Date()).find((x) => x.type === "timeZoneName"); return p?.value && !/^GMT/.test(p.value) ? p.value : ""; } catch { return ""; }
}
// "America/Los_Angeles" → "Los Angeles"; "Etc/UTC" or junk → "".
export function tzCity(tz) {
  const s = String(tz || ""); if (!/^[A-Za-z]+\/[A-Za-z_\-\/]+$/.test(s) || /^Etc\//.test(s)) return "";
  return s.split("/").pop().replace(/_/g, " ");
}

// The one line each message carries (placeLine). Both places when both are known, so the helper picks per request (Captain 10-08:
// "my house cleaned" was priced where his phone happened to be): their home from the Notebook (as written) and where the device is
// now (up to a week old). Neither: the region of their time zone (an assumption, said so) → nothing known.
// o: { device: {place, lat, lng, at}|null, home: string, tz, tzKnown, tzLabel, now, cards } (cards false: the app can't draw the
// Share my location button, so a short question is the fallback). Returns { line, src }, src "both" | "device" | "home" | "timezone" | "none".
export function placeLine(o = {}) {
  const now = Number(o.now) || Date.now(), tz = o.tz || "UTC", d = o.device;
  const home = String(o.home || "").replace(/\s+/g, " ").trim().slice(0, 200);
  const SHARE = o.cards === false ? "If what they want depends on exactly where they are and this isn't enough, ask in one short line which area to use."
    : "If what they want depends on exactly where they are and this isn't enough, don't ask in prose: offer the one-tap Share my location button.";
  const WINS = "Where they say they are in this conversation wins.";
  if (d && Number(d.at) && now - Number(d.at) <= LOC_USE_MS) {
    const where = d.place || `${d.lat}, ${d.lng}`, as = whenLabel(Number(d.at), now, tz);
    const near = `${now - Number(d.at) <= LOC_NOW_MS ? "near" : "last known near"} ${where}`;
    if (home) return { src: "both", line: `(Where they are: Home (from the Notebook): ${home} · Right now: ${near} (device, as of ${as}, about 1 km). Home is for anything about or done at their home: "my house/home/place/apartment", cleaning, repairs, deliveries to them, home services, commute from home, "near my house". Right now is for "near me", "nearby", "here", "where I am", or when they're clearly out ("I'm at …"). Unclear and the two are far apart: home for home services; otherwise pick one and say it in a short line ("For your home in …: …" / "Near ${where}: …"). Don't ask. ${WINS})` };
    return { src: "device", line: `(Where they are: the person is ${near} (as of ${as}, from their device, rounded to about 1 km). No home in the Notebook. Use it for anything that depends on where they are, without asking; say the area in a short line ("Near ${where}: …"). ${WINS})` };
  }
  if (home) return { src: "home", line: `(Where they are: Home (from the Notebook): ${home} · Right now: no device location. Use home for anything that depends on where they are, without asking, and say so in a short line ("Near home in …: …"). ${WINS} ${SHARE})` };
  const city = o.tzKnown ? tzCity(tz) : "";
  if (o.tzKnown && tz) return { src: "timezone", line: `(Where they are: no device location and no home in the Notebook. Their time zone is ${tz}${o.tzLabel ? ` (${o.tzLabel})` : ""}, a wide region${city ? ` around ${city}` : ""}. For anything that depends on where they are, assume that region and say the assumption in a short line ("Assuming you're around ${city || "there"}: …") instead of asking. ${SHARE})` };
  return { src: "none", line: `(Where they are: unknown, no device location, home or time zone. ${o.cards === false ? "If what they want depends on where they are, ask in one short line which area to use." : "If what they want depends on where they are, offer the one-tap Share my location button instead of asking in prose."})` };
}
