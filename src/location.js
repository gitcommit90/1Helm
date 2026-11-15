import { boundedJson } from "./bounded-body.js";
// Where the person is, so the helper never has to ask "where are you?" mid-task (a request like "coffee recs" shouldn't stall
// on a location question).
// - The app asks for location (and the microphone) once, up front: at sign-in on each device and in onboarding (the web app source
//   devperm.ts). With location allowed, it sends the precise fix the phone gives (lat/lng exactly as the device reports them, plus the
//   accuracy in meters) when it starts, when it comes back into focus with a fix older than 15 minutes, and with each message.
// - Kept per account: ONE row, the last known fix and its place name (tenant_location). No history: a new fix replaces it.
//   "Forget my location" (Settings → Location & mic) deletes it; deleting the account deletes it (deletion.js: every tenant_id table).
// - The place name ("1200 Broadway, Oakland, California") comes from OpenStreetMap's free Nominatim service at street level. Nominatim's
//   policy allows 1 request per second, so a lookup is not made for every fix: only when the person has moved more than
//   PLACE_MOVE_M from the spot the name was looked up for, or when the saved name is older than PLACE_MAX_AGE_MS, and never twice in
//   the same second. Only the coordinates are sent; no account, name or IP of theirs.
// - Every turn's message carries one line (placeLine): the device fix when there is one, else the region of their time zone, stated as an assumption.
//   Where they live comes from memory (Hindsight's profile and recall), not from this line.
//   Never in the system prompt (it changes), never saved with the message.
export const LOC_FRESH_MS = 15 * 60e3;           // the app refreshes a fix older than this (on focus, before sending)
export const LOC_USE_MS = 7 * 24 * 3600e3;        // older than a week: not used at all (they've likely moved on)
export const LOC_NOW_MS = 6 * 3600e3;             // up to 6 h: "near X"; older: "last known near X"
const geoAgent = (contact) => `1Helm/1.0 (self-hosted${contact ? `; contact: ${contact}` : ""})`;

export const PLACE_MOVE_M = 150;                  // look the name up again only after the person moved more than this (Nominatim asks for few requests; GPS jitter is under this)
export const PLACE_MAX_AGE_MS = 24 * 3600e3;      // or when the saved name is older than this
export const PLACE_RETRY_MS = 5 * 60e3;           // a lookup that gave no name is tried again after this
const GEO_GAP_MS = 1100;                          // Nominatim: at most 1 request per second (per Worker instance)
let lastGeoAt = 0;

const num = (x) => (x === null || x === undefined || x === "" ? NaN : Number(x));
// A fix exactly as the app sent it: any pair of finite numbers, kept even when it is 0,0 or off the globe (stored
// data stays as it arrived). accuracy is the device's accuracy in meters when it sent one (finite, not negative), else null.
// Anything that is not two numbers is null (there is nothing to store).
export function rawFix(b) {
  if (!b || typeof b !== "object") return null;
  const lat = num(b.lat), lng = num(b.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const acc = num(b.accuracy ?? b.accuracy_m);
  return { lat, lng, accuracy: Number.isFinite(acc) && acc >= 0 ? acc : null };
}
// A fix the place name and the prompt's location line can use: numbers in range; 0,0 or off the globe is null.
// It is stored either way (saveLocation); only these derived uses skip it.
export const usableFix = (row) => !!row && cleanFix(row) != null;
export function cleanFix(b) {
  const r = rawFix(b); if (!r) return null;
  if (Math.abs(r.lat) > 90 || Math.abs(r.lng) > 180) return null;
  if (r.lat === 0 && r.lng === 0) return null;   // "null island": a broken fix, not a place
  return r;
}
// Meters between two fixes (haversine).
export function metersBetween(a, b) {
  const p = Math.PI / 180, dl = (b.lat - a.lat) * p, dn = (b.lng - a.lng) * p;
  const h = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(dn / 2) ** 2;
  return 6371e3 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
// Coordinates for the helper: 6 decimals at most (about 10 cm), without trailing zeros.
export const coordText = (x) => String(Number(Number(x).toFixed(6)));

// Nominatim's answer at city level → "Oakland, California" (US) or "Lyon, France" (elsewhere). Used by the memory place cache.
export function placeLabel(j) {
  const a = j?.address || {}; if (!a || typeof a !== "object") return "";
  const city = a.city || a.town || a.village || a.municipality || a.hamlet || a.suburb || a.city_district || a.county || "";
  const region = a.state || a.region || a.province || a.state_district || "";
  const cc = String(a.country_code || "").toUpperCase();
  const parts = [city, region && region !== city ? region : "", cc && cc !== "US" ? a.country || cc : ""].filter(Boolean);
  return parts.join(", ").replace(/\s+/g, " ").slice(0, 120);
}
// Nominatim's answer at street level → "1200 Broadway, Oakland, California". Falls back to the city label when there is no road.
export function streetLabel(j) {
  const a = j?.address || {}; if (!a || typeof a !== "object") return "";
  const road = a.road || a.pedestrian || a.footway || a.path || a.cycleway || "";
  const street = [a.house_number, road].filter(Boolean).join(" ");
  const city = placeLabel(j);
  return [street || a.amenity || a.building || "", city].filter(Boolean).join(", ").replace(/\s+/g, " ").slice(0, 160);
}
async function nominatim(lat, lng, zoom, label, f, contact = "") {
  const u = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=${zoom}&addressdetails=1&accept-language=en&lat=${lat}&lon=${lng}`;
  try {
    const r = await f(u, { headers: { "user-agent": geoAgent(contact), accept: "application/json" }, signal: AbortSignal.timeout(2500) });
    return r.ok ? label(await r.json()) : "";
  } catch { return ""; }
}
export const reverseGeocode = (lat, lng, f = fetch, contact = "") => nominatim(lat, lng, 10, placeLabel, f, contact);   // city level (memory places)
export const reverseStreet = (lat, lng, f = fetch, contact = "") => nominatim(lat, lng, 18, streetLabel, f, contact);   // street level (the helper's location line)

// lat and lng are the fix exactly as the app sent it. src_lat and src_lng (migration 064) hold the same numbers (the memory envelope reads
// them). accuracy_m (migration 103) is the device's accuracy in meters. place_lat, place_lng and place_at (migration 103) are the spot
// and time the saved place name was looked up for. Before migration 103 those columns are missing and only the older ones come back.
export async function locationOf(env, tid) {
  for (const cols of ["lat, lng, place, at, src_lat, src_lng, accuracy_m, place_lat, place_lng, place_at", "lat, lng, place, at, src_lat, src_lng", "lat, lng, place, at"]) {
    try { return await env.DB.prepare(`SELECT ${cols} FROM tenant_location WHERE tenant_id=?`).bind(String(tid)).first() || null; } catch {}
  }
  return null;
}
// Save the account's last known fix, exactly as sent. A new name is looked up only after a move of more than PLACE_MOVE_M, when the saved
// name is older than PLACE_MAX_AGE_MS, when there is no name yet (retried after PLACE_RETRY_MS), and never twice in the same second.
export async function saveLocation(env, tid, fix, at = Date.now(), geo = reverseStreet) {
  const raw = rawFix(fix); if (!raw) return { error: "bad_location" };
  const c = cleanFix(fix), now = Date.now(), when = Math.min(Number(at) || now, now);
  const upsert = async (v) => {
    try {
      await env.DB.prepare(`INSERT INTO tenant_location (tenant_id, lat, lng, place, at, updated_at, src_lat, src_lng, accuracy_m, place_lat, place_lng, place_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(tenant_id) DO UPDATE SET lat=excluded.lat, lng=excluded.lng, place=excluded.place, at=excluded.at, updated_at=excluded.updated_at, src_lat=excluded.src_lat, src_lng=excluded.src_lng, accuracy_m=excluded.accuracy_m, place_lat=excluded.place_lat, place_lng=excluded.place_lng, place_at=excluded.place_at`)
        .bind(String(tid), v.lat, v.lng, v.place, v.at, now, v.lat, v.lng, ("acc" in v ? v.acc : raw.accuracy), v.pl ?? null, v.pn ?? null, v.pa ?? null).run();
    } catch {   // migration 103 not applied yet: the columns of migration 064, then the basic ones
      try {
        await env.DB.prepare(`INSERT INTO tenant_location (tenant_id, lat, lng, place, at, updated_at, src_lat, src_lng) VALUES (?,?,?,?,?,?,?,?)
          ON CONFLICT(tenant_id) DO UPDATE SET lat=excluded.lat, lng=excluded.lng, place=excluded.place, at=excluded.at, updated_at=excluded.updated_at, src_lat=excluded.src_lat, src_lng=excluded.src_lng`).bind(String(tid), v.lat, v.lng, v.place, v.at, now, v.lat, v.lng).run();
        return;
      } catch {}
      await env.DB.prepare(`INSERT INTO tenant_location (tenant_id, lat, lng, place, at, updated_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(tenant_id) DO UPDATE SET lat=excluded.lat, lng=excluded.lng, place=excluded.place, at=excluded.at, updated_at=excluded.updated_at`).bind(String(tid), v.lat, v.lng, v.place, v.at, now).run();
    }
  };
  if (!c) {   // 0,0 or off the globe: kept as sent, with no place name; the prompt's location line skips it (usableFix)
    await upsert({ lat: raw.lat, lng: raw.lng, place: "", at: when });
    return { lat: raw.lat, lng: raw.lng, accuracy: raw.accuracy, place: "", at: when, usable: false };
  }
  const old = await locationOf(env, tid);
  const spot = old && old.place_lat != null && old.place_lng != null ? { lat: Number(old.place_lat), lng: Number(old.place_lng) } : old && cleanFix(old) ? { lat: old.lat, lng: old.lng } : null;
  const nameAt = old ? Number(old.place_at) || 0 : 0;   // rows saved before migration 103 have none: their city name is looked up again once, at street level
  const hasName = !!(old && old.place && spot);
  const moved = hasName && metersBetween(spot, c) > PLACE_MOVE_M;
  const wantLookup = hasName ? moved || now - nameAt > PLACE_MAX_AGE_MS : !old || now - nameAt > PLACE_RETRY_MS;
  let place = hasName ? old.place : "", pl = hasName ? spot.lat : null, pn = hasName ? spot.lng : null, pa = old ? nameAt || null : null;
  if (wantLookup && now - lastGeoAt >= GEO_GAP_MS) {   // too soon after another lookup: keep what we have, a later fix tries again
    lastGeoAt = now;
    const name = await geo(c.lat, c.lng, fetch, env.SUPPORT_EMAIL || env.EMAIL_FROM).catch(() => "") || "";
    if (name) { place = name; pl = c.lat; pn = c.lng; pa = now; }
    else if (!hasName) pa = now;   // remember the failed try so it is not repeated for every fix
  }
  if (hasName && place === old.place && metersBetween(spot, c) > 1000) { place = ""; pl = null; pn = null; }   // far from where the name was looked up and no new name: no name beats a wrong one
  const newest = !old || when >= Number(old.at);   // an older fix never replaces a newer one
  if (newest) await upsert({ lat: c.lat, lng: c.lng, place, at: when, pl, pn, pa });
  else await upsert({ lat: old.lat, lng: old.lng, place, at: Number(old.at), pl, pn, pa, acc: old.accuracy_m ?? null });
  return { lat: c.lat, lng: c.lng, accuracy: c.accuracy, place, at: Math.max(when, Number(old?.at) || 0) };
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

// The one line each message carries (placeLine): where the device is now (up to a week old). No device: the region of their time zone
// (an assumption, said so) → nothing known.
// o: { device: {place, lat, lng, at}|null, tz, tzKnown, tzLabel, now, cards } (cards false: the app can't draw the
// Share my location button, so a short question is the fallback). Returns { line, src }, src "device" | "timezone" | "none".
export function placeLine(o = {}) {
  const now = Number(o.now) || Date.now(), tz = o.tz || "UTC", d = o.device;
  const SHARE = o.cards === false ? "If what they want depends on exactly where they are and this isn't enough, ask in one short line which area to use."
    : "If what they want depends on exactly where they are and this isn't enough, don't ask in prose: offer the one-tap Share my location button.";
  const WINS = "Where they say they are in this conversation wins.";
  if (d && Number(d.at) && now - Number(d.at) <= LOC_USE_MS) {
    const coords = `${coordText(d.lat)}, ${coordText(d.lng)}`, acc = Number(d.accuracy_m ?? d.accuracy);
    const where = d.place ? `${d.place} (${coords})` : coords, as = whenLabel(Number(d.at), now, tz);
    const accText = d.accuracy_m != null && Number.isFinite(acc) ? `accurate to about ${Math.max(1, Math.round(acc))} m` : "accuracy not reported";
    const near = `${now - Number(d.at) <= LOC_NOW_MS ? "near" : "last known near"} ${where}`;
    return { src: "device", line: `(Where they are: the person is ${near}, ${accText}, as of ${as}, from their device's precise location. Use it silently for anything that depends on where they are, without asking. Don't open a reply with the area or mention it in a reply that doesn't depend on where they are; when the answer is local (places nearby, weather, local times or events), you may name the area once, inside the answer, if that helps. ${WINS})` };
  }
  const city = o.tzKnown ? tzCity(tz) : "";
  if (o.tzKnown && tz) return { src: "timezone", line: `(Where they are: no device location. Their time zone is ${tz}${o.tzLabel ? ` (${o.tzLabel})` : ""}, a wide region${city ? ` around ${city}` : ""}. For anything that depends on where they are, assume that region instead of asking, and use it silently. Don't open a reply with the region or mention it in a reply that doesn't depend on where they are; when the answer is local and depends on the assumption, say once, inside the answer, that you're assuming the region${city ? ` around ${city}` : ""}, so they can correct you. ${SHARE})` };
  return { src: "none", line: `(Where they are: unknown, no device location or time zone. ${o.cards === false ? "If what they want depends on where they are, ask in one short line which area to use." : "If what they want depends on where they are, offer the one-tap Share my location button instead of asking in prose."})` };
}
