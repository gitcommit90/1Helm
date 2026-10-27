// Read-only place recall. 1Helm retains only its latest coarse fix; Bee's
// conversation location is separate evidence, never a continuous GPS trail.
import { ambientQuery, addLocalTimes, tzOf } from "./ee/index.js";
import { cleanFix } from "./location.js";
import { scrubSecrets } from "./secrets-scrub.js";

export const LOCATION_QUERY_TOOL = { type: "function", function: {
  name: "location_query",
  description: "Times come as raw milliseconds plus a field ending in _local (e.g. at_local) that is already in the person's time zone, so do not convert them. Find recorded evidence for where the person was at a time, or where a Bee conversation happened. Checks 1Helm's saved device sample first, then Bee locations; no transcript required for time lookup. 1Helm keeps only the latest rough fix, not history. Returns source times, coverage and uncertainty; never infers presence from a place mentioned in speech. General only, read-only; no GPS collection.",
  parameters: { type: "object", properties: {
    at: { type: "string", description: "Requested instant, ISO-8601 with explicit time zone. Searches 15 minutes either side, labelled with actual sample times; not exact-time proof. Do not combine with from/to." },
    from: { type: "string", description: "Inclusive requested time range start, ISO-8601 with explicit time zone." },
    to: { type: "string", description: "Inclusive requested time range end, ISO-8601 with explicit time zone." },
    query: { type: "string", maxLength: 500, description: "Optional conversation topic/person words or place; omit for time-only recall. Inspect linked raw transcript for who/what was said." },
    source_id: { type: "string", maxLength: 250, description: "Exact Bee source_id from an earlier result." },
    limit: { type: "integer", minimum: 1, maximum: 50 },
    cursor: { type: "string", maxLength: 8192, description: "Exact next_cursor for the next Bee page; preserve all filters." },
  }, additionalProperties: false },
} };

export const LOCATION_PROMPT = `For historical place questions ("where was I at 3pm?", "where was I yesterday?", "where did I talk to Sam about the garden?"), use location_query before asking the person. Time-only lookup does not need a transcript. Use their time zone and requested dates; at is a labelled 15-minute-nearby sample search, not exact-time proof. The tool checks 1Helm's actual saved device sample first, then Bee's recorded conversation locations to corroborate or fill gaps. 1Helm currently keeps only its latest rough device sample, not a location history: an out-of-window sample cannot answer an earlier-time question. Do not substitute today's location, Notebook home or time-zone assumptions for historical evidence.
For a conversation question, use ambient_query mode transcript to find the conversation and its actual utterance time/source_id, then location_query for that source and time. If they cannot remember keywords, broaden the transcript review before asking them to repeat it. Follow next_cursor for all relevant candidates. A Bee primary location is associated with a conversation, possibly a long/live recording; without a timed sample it does not prove where any particular utterance occurred or continuous presence. A place mentioned in speech is not a recorded location. Give the source, actual sample time or conversation interval and rough precision. When evidence differs, show both with their times and uncertainty instead of silently choosing one. Say when no matching sample/history was retained; never invent an exact venue or movement trail. Location sharing off/forget removes the saved 1Helm sample; Bee location is separate retained integration data subject to memory privacy. These tools only read existing records, never enable tracking.`;

const fail = (status, error) => ({ status, error, device_locations: [], bee_locations: [], coverage: { incomplete: true, searched: false } });
const iso = (x) => typeof x === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(x) && Number.isFinite(Date.parse(x));
const nearMs = 15 * 60e3;
async function deviceRead(res, tenant) {
  // Distinguish unavailable storage from an absent fix for truthful coverage.
  try { return { ok: true, row: await res.env.DB.prepare("SELECT lat, lng, place, at FROM tenant_location WHERE tenant_id=?").bind(String(tenant)).first() }; }
  catch { return { ok: false, row: null }; }
}
const distance = (a, b) => {
  const p = Math.PI / 180, dlat = (b.latitude - a.latitude) * p, dlon = (b.longitude - a.longitude) * p;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.latitude * p) * Math.cos(b.latitude * p) * Math.sin(dlon / 2) ** 2;
  return Math.round(6371e3 * 2 * Math.asin(Math.sqrt(Math.min(1, h))));
};

export async function locationQuery(res, args = {}, ctx = {}) {
  if (res.get("channel") !== "main") return fail("unavailable_scope", "Location recall is available only to the person's helper in General.");
  if (res.memoryMode && res.memoryMode() !== "on") return fail("memory_disabled", "Personal memory is not enabled; saved location evidence was not searched.");
  const tenant = res.get("tenant");
  if (!tenant) return fail("unavailable", "The account's location evidence cannot be checked here.");
  if (!args || typeof args !== "object" || Array.isArray(args)) return fail("invalid_query", "Pass a location query object.");
  for (const k of ["at", "from", "to"]) if (args[k] != null && !iso(args[k])) return fail("invalid_query", `${k} must be an ISO-8601 timestamp with an explicit time zone.`);
  if (args.at != null && (args.from != null || args.to != null)) return fail("invalid_query", "Use at or from/to, not both.");
  const request = { mode: "locations" };
  for (const [key, max] of [["query", 500], ["source_id", 250], ["cursor", 8192]]) {
    if (args[key] == null) continue;
    if (typeof args[key] !== "string" || args[key].length > max) return fail("invalid_query", `${key} must be a string of at most ${max} characters.`);
    if (args[key].trim()) request[key] = key === "query" ? args[key].trim() : args[key];
  }
  if (args.limit != null) {
    if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 50) return fail("invalid_query", "limit must be an integer from 1 to 50.");
    request.limit = args.limit;
  }
  const at = args.at != null ? Date.parse(args.at) : null;
  const from = at != null ? at - nearMs : args.from != null ? Date.parse(args.from) : null;
  const to = at != null ? at + nearMs : args.to != null ? Date.parse(args.to) : null;
  if (from != null && to != null && from > to) return fail("invalid_query", "from must not be later than to.");
  if (from != null) request.from = new Date(from).toISOString();
  if (to != null) request.to = new Date(to).toISOString();
  const first = await deviceRead(res, tenant);
  const bee = await ambientQuery(res, request, ctx);
  const current = await deviceRead(res, tenant); // Settings off/forget can happen during Bee RPC.
  if (res.memoryMode && res.memoryMode() !== "on") return fail("memory_disabled", "Personal memory was disabled during lookup; no location evidence was returned.");
  const forgotten = (value) => !!res.forgottenNow?.(JSON.stringify(value));
  const beeLocations = (bee.locations || []).filter((x) => !forgotten(x));
  const row = first.ok && current.ok && first.row && current.row && JSON.stringify(first.row) === JSON.stringify(current.row) ? current.row : null;
  const sample = row && cleanFix(row), when = row ? Number(row.at) : NaN;
  const deviceCoverage = { history_retained: false, searched: first.ok && current.ok, status: "not_saved", note: "1Helm keeps only the latest rough device location, not earlier location history. No new device location was requested." };
  let device = null;
  if (!first.ok || !current.ok) deviceCoverage.status = "unavailable";
  else if (row && forgotten(row)) deviceCoverage.status = "withheld_by_memory_preferences";
  else if (sample && Number.isFinite(when) && when > 0) {
    deviceCoverage.latest_sample_at = when;
    const inRange = (from == null || when >= from) && (to == null || when <= to);
    // Explicit utterance time is sufficient to check the device sample even if
    // Bee supplied no location for that source. Without a time, require a source
    // interval; never attach today's sample to an unrelated topic match.
    const tied = from != null || to != null || !request.query && !request.source_id || beeLocations.some((x) => Number.isFinite(x.conversation_from) && when >= x.conversation_from && when <= (x.conversation_to ?? x.conversation_from));
    deviceCoverage.status = !inRange ? "outside_requested_time" : !tied ? "not_linked_to_matching_conversation" : "sample_available";
    if (inRange && tied) device = { id: `device:${when}`, source: "1helm_device_fix", kind: "last_saved_coarse_fix", latitude: sample.lat, longitude: sample.lng, address: scrubSecrets(String(row.place || "")), recorded_at: when, time_basis: "device_sample", precision: "rounded_to_0.01_degrees_about_1km", accuracy_m: null, ...(at != null ? { offset_from_requested_ms: when - at } : {}), caveat: "A single coarse device sample at this time, not proof of continuous presence or an exact venue." };
  } else if (first.row && !row) deviceCoverage.status = "changed_during_lookup";
  const comparisons = device ? beeLocations.filter((b) => Number.isFinite(b.latitude) && Number.isFinite(b.longitude)).map((b) => {
    const timed = b.time_basis === "provider_observed_at" && Number.isFinite(b.observed_at), contemporaneous = timed && Math.abs(b.observed_at - when) <= nearMs;
    const meters = distance(device, b);
    return { device_id: device.id, bee_id: b.id, separation_m: meters, status: contemporaneous ? meters > 2000 + Math.max(0, Number(b.accuracy_m) || 0) ? "possible_disagreement" : "nearby_samples" : "timing_unverified", caveat: "Compare the source times and precision; a conversation location or nearby sample cannot establish exact-time presence." };
  }) : [];
  const answer = { device_locations: device ? [device] : [], bee_locations: beeLocations, comparisons, requested: { at, from, to, ...(at != null ? { tolerance_ms: nearMs } : {}) }, coverage: { incomplete: true, device: deviceCoverage, bee: bee.coverage, ...(bee.error ? { bee_error: bee.error, bee_status: bee.status } : {}), note: "Available evidence is not a complete location history. Bee conversation intervals are not continuous location observations." }, next_cursor: bee.next_cursor ?? null };
  const zone = tzOf(res);
  return zone ? addLocalTimes(answer, zone) : answer;
}
