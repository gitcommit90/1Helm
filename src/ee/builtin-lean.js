// Per-toolkit trims for app_run results that are too big or too raw for the model (builtins audit, notes/2026-10-08-composio-builtins-audit.md).
// The generic trim (worklog.js leanJSON past 6k chars) keeps "key fields" by guesswork; these keep exactly what answers the question and
// say what was left out ("trimmed N items"), so the helper knows there's more and can ask for it.
//   AllTrails trails near a place (~20k chars for 20 trails) → name, miles, gain, difficulty, rating, link × 10
//   OSV vulnerability queries (30–60k) → id, aliases, summary, severity, affected package and the versions that fix it
//   GoDaddy availability (9k: 40 alternatives per name, Unicode look-alikes like gõogle.com among them) → the exact name asked for,
//     plus at most 3 plain-ASCII alternatives; look-alike / IDN names are never shown
//   OpenWeatherMap current weather (Kelvin, UTC epoch) → °C and °F, local time of the reading, sunrise and sunset
//   Trivago hotel search (24k, 25 hotels) → 8 hotels
// composio_search verticals (finance's 63k-char intraday graph…) are leaned by vertical-search.js leanFor.
const r1 = (n) => (Number.isFinite(Number(n)) ? Math.round(Number(n) * 10) / 10 : undefined);
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length)));
const cut = (s, n) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t || undefined; };
const kToC = (k) => (Number.isFinite(Number(k)) ? Math.round((Number(k) - 273.15) * 10) / 10 : undefined);
const kToF = (k) => (Number.isFinite(Number(k)) ? Math.round(((Number(k) - 273.15) * 9) / 5 + 32) : undefined);
// "2026-10-08 14:28" in the place's own time, from a UTC epoch and the place's offset in seconds.
const localAt = (epoch, offset) => (Number.isFinite(Number(epoch)) ? new Date((Number(epoch) + (Number(offset) || 0)) * 1000).toISOString().slice(0, 16).replace("T", " ") : undefined);
const ASCII_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

const TRIMS = {
  ALLTRAILS_MCP_FIND_TRAILS_NEAR_LOCATION: (d) => trails(d),
  ALLTRAILS_MCP_FIND_TRAILS_WITHIN_BOUNDS: (d) => trails(d),
  OSV_QUERY_VULNERABILITIES: (d) => vulns(d),
  OSV_GET_VULNERABILITY: (d) => vulns({ vulnerabilities: [d] }),
  GODADDY_MCP_DOMAINS_CHECK_AVAILABILITY: (d) => {
    const groups = d?.domainGroups || []; if (!groups.length) return null;
    let dropped = 0;
    const out = groups.map((g) => {
      const all = g.domains || [], want = String(g.searchedDomain || "").toLowerCase();
      const exact = all.find((x) => x.isExactMatch || String(x.name).toLowerCase() === want);
      const alts = all.filter((x) => x !== exact && x.available && ASCII_DOMAIN.test(String(x.name)) && !/^xn--|\.xn--/.test(String(x.name))).slice(0, 3);
      dropped += all.length - (exact ? 1 : 0) - alts.length;
      // GoDaddy lists only names that are available: the exact name missing from its list means it's taken.
      return clean({ domain: want || exact?.name, available: exact ? !!exact.available : false, ...(exact ? {} : { why: "not in GoDaddy's list of available names: taken" }), alternatives: alts.map((x) => x.name) });
    });
    return { data: { results: out, note: "Exact-match availability from GoDaddy (no prices). Alternatives are plain-letter names only; look-alike names are never offered." }, trimmed: dropped };
  },
  WEATHERMAP_WEATHER: (d) => {
    const w = d?.weather_info || d; if (!w?.main) return null;
    const tz = Number(w.timezone) || 0, h = Math.round(tz / 360) / 10;
    return { data: clean({ place: [w.name, w.sys?.country].filter(Boolean).join(", "), observed_local: localAt(w.dt, tz), utc_offset: `UTC${h >= 0 ? "+" : ""}${h}`,
      conditions: (w.weather || []).map((x) => x.description).join(", "), temp: `${kToC(w.main.temp)} °C / ${kToF(w.main.temp)} °F`, feels_like: `${kToC(w.main.feels_like)} °C / ${kToF(w.main.feels_like)} °F`,
      low_high_now: `${kToC(w.main.temp_min)}–${kToC(w.main.temp_max)} °C`, humidity: w.main.humidity != null ? `${w.main.humidity}%` : undefined,
      wind: w.wind?.speed != null ? `${r1(w.wind.speed * 3.6)} km/h (${r1(w.wind.speed * 2.237)} mph)` : undefined, sunrise_local: localAt(w.sys?.sunrise, tz)?.slice(11), sunset_local: localAt(w.sys?.sunset, tz)?.slice(11),
      note: "Current conditions only (OpenWeatherMap): no forecast." }), trimmed: 0 };
  },
  TRIVAGO_MCP_TRIVAGO_ACCOMMODATION_SEARCH: (d) => topList(d, 8),
  TRIVAGO_MCP_TRIVAGO_ACCOMMODATION_RADIUS_SEARCH: (d) => topList(d, 8),
};
function trails(d) {
  const all = d?.trails || []; if (!all.length) return null;
  const keep = all.slice(0, 10).map((t) => clean({ name: t.name, where: t.location_label, miles: r1(t.length_miles), gain_ft: t.elevation_gain_feet != null ? Math.round(t.elevation_gain_feet) : undefined,
    difficulty: t.difficulty, rating: t.avg_rating != null ? r1(t.avg_rating) : undefined, route: t.route_type, trailhead_miles_away: r1(t.trail_head_distance_miles), trail_id: t.id,
    link: String(t.alltrails_web_url || "").replace(/[?&]utm_[^&]+/g, "").replace(/\?$/, "") || undefined }));
  return { data: { trails: keep }, trimmed: all.length - keep.length };
}
function vulns(d) {
  const all = d?.vulnerabilities || []; if (!all.length) return null;
  const keep = all.slice(0, 10).map((v) => clean({ id: v.id, aliases: (v.aliases || []).slice(0, 3), summary: cut(v.summary || v.details, 200), severity: v.database_specific?.severity || v.severity?.[0]?.score,
    published: String(v.published || "").slice(0, 10) || undefined,
    affected: (v.affected || []).slice(0, 3).map((x) => clean({ package: x.package?.name, ecosystem: x.package?.ecosystem,
      fixed_in: [...new Set((x.ranges || []).flatMap((r) => (r.events || []).map((e) => e.fixed).filter(Boolean)))].slice(0, 4) })),
    link: `https://osv.dev/vulnerability/${v.id}` }));
  const extra = all.reduce((n, v) => n + Math.max(0, (v.references || []).length) + Math.max(0, (v.affected?.[0]?.versions || []).length), 0);
  return { data: { vulnerabilities: keep, ...(d.has_more ? { more: "more results exist: ask again with a narrower package or version" } : {}) }, trimmed: all.length - keep.length + extra };
}
function topList(d, n) {
  const list = Array.isArray(d?.accommodations) ? d.accommodations : Array.isArray(d?.results) ? d.results : Array.isArray(d) ? d : null; if (!list) return null;
  return { data: { ...(Array.isArray(d) ? {} : Object.fromEntries(Object.entries(d).filter(([k, v]) => !Array.isArray(v) && typeof v !== "object"))), results: list.slice(0, n) }, trimmed: Math.max(0, list.length - n) };
}
// → { data, trimmed } for an action this file knows, else null. Never throws.
export function trimFor(slug, data) {
  const f = TRIMS[String(slug || "").toUpperCase()]; if (!f || !data || typeof data !== "object") return null;
  try { return f(data) || null; } catch { return null; }
}
export const TRIMMED_SLUGS = Object.keys(TRIMS);
