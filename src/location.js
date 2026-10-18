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
// - Every turn's message carries one line (placeLine): the device fix when there is one, else the region of their time zone, stated as an assumption.
//   Where they live comes from memory (Hindsight's profile and recall), not from this line.
//   Never in the system prompt (it changes), never saved with the message.
export const LOC_FRESH_MS = 15 * 60e3;           // the app refreshes a fix older than this (on focus, before sending)
export const LOC_USE_MS = 7 * 24 * 3600e3;        // older than a week: not used at all (they've likely moved on)
export const LOC_NOW_MS = 6 * 3600e3;             // up to 6 h: "near X"; older: "last known near X"
const geoAgent = (contact) => `1Helm/1.0 (self-hosted${contact ? `; contact: ${contact}` : ""})`;

export const coarse = (x) => Math.round(Number(x) * 100) / 100;
// A fix exactly as the app sent it: any pair of finite numbers, kept even when it is 0,0 or off the globe (Captain 2026-10-14: stored
// data stays as it arrived). Anything that is not two numbers → null (there is nothing to store).
export function rawFix(b) {
  if (!b || typeof b !== "object") return null;
  const lat = Number(b.lat), lng = Number(b.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}
// A fix the place name and the prompt's location line can use: { lat, lng } numbers in range → rounded; 0,0 or off the globe → null.
// It is stored either way (saveLocation); only these derived uses skip it.
export const usableFix = (row) => !!row && cleanFix(row) != null;
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

// src_lat and src_lng (migrations_064_location_source.sql) are the fix exactly as the app sent it, kept beside the rounded copy for memory
// (the memory envelope stores coordinates as the source gave them). Before that migration the columns are missing and only lat and lng come back.
export async function locationOf(env, tid) {
  try { return await env.DB.prepare("SELECT lat, lng, place, at, src_lat, src_lng FROM tenant_location WHERE tenant_id=?").bind(String(tid)).first() || null; } catch {}
  try { return await env.DB.prepare("SELECT lat, lng, place, at FROM tenant_location WHERE tenant_id=?").bind(String(tid)).first() || null; } catch { return null; }
}
async function srcSave(env, tid, fix) {   // no columns yet: skipped
  try { await env.DB.prepare("UPDATE tenant_location SET src_lat=?, src_lng=? WHERE tenant_id=?").bind(Number(fix.lat), Number(fix.lng), String(tid)).run(); } catch {}
}
// Save the account's last known fix. Same rounded spot as before: only its time moves (no lookup). A new spot: look up its name.
export async function saveLocation(env, tid, fix, at = Date.now(), geo = reverseGeocode) {
  const raw = rawFix(fix); if (!raw) return { error: "bad_location" };
  const c = cleanFix(fix), when = Math.min(Number(at) || Date.now(), Date.now());
  if (!c) {   // 0,0 or off the globe: kept as sent, with no place name; the prompt's location line skips it (usableFix)
    await env.DB.prepare(`INSERT INTO tenant_location (tenant_id, lat, lng, place, at, updated_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(tenant_id) DO UPDATE SET lat=excluded.lat, lng=excluded.lng, place=excluded.place, at=excluded.at, updated_at=excluded.updated_at`).bind(String(tid), coarse(raw.lat), coarse(raw.lng), "", when, Date.now()).run();
    await srcSave(env, tid, fix);
    return { lat: coarse(raw.lat), lng: coarse(raw.lng), place: "", at: when, usable: false };
  }
  const old = await locationOf(env, tid);
  if (old && old.lat === c.lat && old.lng === c.lng && old.place) {
    if (when > Number(old.at)) { await env.DB.prepare("UPDATE tenant_location SET at=?, updated_at=? WHERE tenant_id=?").bind(when, Date.now(), String(tid)).run(); await srcSave(env, tid, fix); }
    return { lat: c.lat, lng: c.lng, place: old.place, at: Math.max(when, Number(old.at)) };
  }
  const place = await geo(c.lat, c.lng, fetch, env.SUPPORT_EMAIL || env.EMAIL_FROM).catch(() => "") || "";
  await env.DB.prepare(`INSERT INTO tenant_location (tenant_id, lat, lng, place, at, updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(tenant_id) DO UPDATE SET lat=excluded.lat, lng=excluded.lng, place=excluded.place, at=excluded.at, updated_at=excluded.updated_at`).bind(String(tid), c.lat, c.lng, place, when, Date.now()).run();
  await srcSave(env, tid, fix);
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
    const where = d.place || `${d.lat}, ${d.lng}`, as = whenLabel(Number(d.at), now, tz);
    const near = `${now - Number(d.at) <= LOC_NOW_MS ? "near" : "last known near"} ${where}`;
    return { src: "device", line: `(Where they are: the person is ${near} (as of ${as}, from their device, rounded to about 1 km). Use it silently for anything that depends on where they are, without asking. Don't open a reply with the area or mention it in a reply that doesn't depend on where they are; when the answer is local (places nearby, weather, local times or events), you may name the area once, inside the answer, if that helps. ${WINS})` };
  }
  const city = o.tzKnown ? tzCity(tz) : "";
  if (o.tzKnown && tz) return { src: "timezone", line: `(Where they are: no device location. Their time zone is ${tz}${o.tzLabel ? ` (${o.tzLabel})` : ""}, a wide region${city ? ` around ${city}` : ""}. For anything that depends on where they are, assume that region instead of asking, and use it silently. Don't open a reply with the region or mention it in a reply that doesn't depend on where they are; when the answer is local and depends on the assumption, say once, inside the answer, that you're assuming the region${city ? ` around ${city}` : ""}, so they can correct you. ${SHARE})` };
  return { src: "none", line: `(Where they are: unknown, no device location or time zone. ${o.cards === false ? "If what they want depends on where they are, ask in one short line which area to use." : "If what they want depends on where they are, offer the one-tap Share my location button instead of asking in prose."})` };
}
