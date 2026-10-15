// Chat adapter (ENVELOPE.md): a chat turn's envelope. The place comes from location services: the account's one saved device fix
// (tenant_location, location.js), which the app sends with each message only when the person allowed location. 1HC keeps no location
// history, so a turn gets a place only when that fix is fresh at the moment of the turn; a turn without one simply has no place.
// The coordinates are the ones the app sent, exactly (tenant_location src_lat and src_lng; before migration 064 only the 2 decimal copy
// location.js keeps exists, and how says "device-rounded" then). The place name is location.js's city level OpenStreetMap lookup (derived).
import { makeEnvelope, placeText } from "../memory-envelope.js";

export const modality = "chat";
export const CHAT_PLACE_MS = 30 * 60e3;   // a fix taken within 30 minutes of the turn counts as where the turn happened

// row: the tenant_location row { lat, lng, place, at } or null. → a where, or null.
export function chatPlace(row, at) {
  const t = Number(row?.at), when = Number(at) || Date.now();
  if (!row || !Number.isFinite(t) || Math.abs(t - when) > CHAT_PLACE_MS) return null;
  if (!row.place && (row.lat == null || row.lng == null)) return null;
  const src = row.src_lat != null && row.src_lng != null;
  return { place: row.place || null, placeFrom: "geocoded", lat: src ? row.src_lat : row.lat, lng: src ? row.src_lng : row.lng, how: src ? "device" : "device-rounded" };
}

export function chatEnvelope({ at, endAt, tz, where, session, turn, kind = "chat" }) {
  return makeEnvelope({ kind, kind1hc: "message", modality: "text", when: { start: at, end: endAt || at, tz, tzSource: "account", how: "capture" }, where,
    links: { session, turn }, privacy: { location: where ? "on" : "off" }, id: { record: turn ? `turn:${turn}` : null },
    source: kind === "chat" ? "user" : "assistant" });   // a chat turn is the person's conversation (each entry names its speaker); a scheduled run is the helper's
}

// The place goes into the text as well: the person's own entry of the turn gets a "place" field, so the extraction model reads it next
// to what they said (it writes place names into fact text, per the bank's retain mission; its own "where" field is thrown away).
export function placeEntries(entries, e) {
  const p = placeText(e); if (!p || !entries?.length) return entries;
  return entries.map((x, i) => (i === 0 ? { ...x, place: p } : x));
}
