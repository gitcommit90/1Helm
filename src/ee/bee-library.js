// General's Library: the person's saved Bee conversations (Captain, 2026-10-27: "bee yes add it as a filter in the library and a separate section in the
// library so it does not muddy up the library"). Bee conversations only, not Live notes.
//
// What it reads: only the copies 1Helm keeps. The `convs` table of the BeeSync Durable Object (id, times, and the columns lines, summary and place added for
// this list), the raw conversation JSON in R2 (t/<tenant>/bee/conv/<id>.json), and the speaker links in the same object. It never calls the Bee API and never
// calls a model. An account that disconnected Bee and kept its transcripts still has all of it, so the list works without a Bee connection.
//
// Routes (owner only, always General's Library; the app sends them under /w/<slug>):
//   GET  /api/library/bee/conversations?cursor=&limit=        newest first, one page: { items, next, total, tz }
//   GET  /api/library/bee/conversations/<id>                  one transcript: { id, start, end, duration_ms, summary, place, tz, lines: [{ at, who, text }] }
//   GET  /api/library/bee/conversations/<id>/export?format=txt|md   the same as a download (the header, then "[time] Speaker: text" per line)
//   POST /api/library/bee/conversations/<id>/delete           removes every copy (R2, convs row, stored lines, memory document) and stops a later sync from importing it again
//
// An account that never connected Bee never wakes the BeeSync object (hasBeeData).
import { ambientLines } from "./ambient.js";
import { mapKey } from "./bee-speakers.js";
import { servedHeaders } from "../files.js";
import { DEFAULT_TZ, validTz } from "../schedule.js";

export const PAGE = 25, PAGE_MAX = 50;
const reply = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// ---------------------------------------------------------------- what a conversation shows ----------------------------------------------------------------
// The place: the provider's name for it when there is one, else the address. Both are text Bee sent, trimmed and capped.
export function placeOf(loc) {
  if (!loc || typeof loc !== "object" || Array.isArray(loc)) return null;
  for (const k of ["name", "address"]) { const s = typeof loc[k] === "string" ? loc[k].replace(/\s+/g, " ").trim() : ""; if (s) return s.slice(0, 200); }
  return null;
}
// The transcript lines of a saved conversation (the same lines memory was given). A paragraph that ambientLines cut at 3000 characters is joined again.
export function libLines(doc) {
  const out = [];
  for (const l of ambientLines(doc || {})) {
    if (l.offset > 0 && out.length) { out[out.length - 1].text += l.text; continue; }
    out.push({ at: l.at ?? null, speaker: l.speaker || null, speaker_id: l.speaker_id ?? null, is_user: !!l.is_user, text: l.text });
  }
  return out;
}
// What the list needs from one conversation, kept in the convs row so a page of the list reads no R2 object.
export function libMeta(doc) {
  const s = typeof doc?.short_summary === "string" ? doc.short_summary.replace(/\s+/g, " ").trim() : "";
  return { lines: libLines(doc).length, summary: s ? s.slice(0, 400) : null, place: placeOf(doc?.primary_location) };
}
// Who a line is from. A speaker the person linked to a contact in this recording (rows of `speakers`, state linked) shows the contact's name, and so does a
// label the account remembers (`speaker_map`). Anything else shows Bee's label as sent, and a line with no label shows "Unknown".
export function namer(links, map) {
  const byKey = new Map((links || []).map((r) => [String(r.spk), r.person_name || r.name]));
  const byLabel = new Map((map || []).map((r) => [r.k, r.person_name]));
  return (l) => {
    if (l.is_user) return { who: "You", linked: false };   // Bee's own marker for the wearer
    const k = l.speaker_id != null && l.speaker_id !== "" ? `id:${l.speaker_id}` : `label:${l.speaker}`;
    const linked = byKey.get(k) || (l.speaker ? byLabel.get(mapKey(l.speaker)) : null);
    return linked ? { who: String(linked), linked: true } : { who: l.speaker || "Unknown", linked: false };
  };
}

// ---------------------------------------------------------------- time and export ----------------------------------------------------------------
export const tzOf = (z) => (typeof z === "string" && validTz(z) ? z : DEFAULT_TZ);
const parts = (ms, tz, o) => new Intl.DateTimeFormat("en-US", { timeZone: tz, ...o }).format(ms);
export const stamp = (ms, tz) => parts(ms, tz, { weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
export const clock = (ms, tz) => parts(ms, tz, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
export function durationText(ms) {
  const s = Math.max(0, Math.round(Number(ms) / 1000)); if (!Number.isFinite(s)) return "";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h} hr${m ? ` ${m} min` : ""}` : m ? `${m} min` : `${r} sec`;
}
const day = (ms, tz) => { const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(ms), g = (t) => p.find((x) => x.type === t)?.value; return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}${g("minute")}`; };
// The file: a header (start and end in the person's time zone, duration, summary, place), then one line per utterance, "[time] Speaker: text".
// c: what libGet returns (start, end, duration_ms, summary, place, lines [{ at, who, text }]). format: "txt" or "md".
export function exportText(c, tz, format = "txt") {
  tz = tzOf(tz); const md = format === "md";
  const head = [];
  if (c.start != null) head.push(["Started", stamp(c.start, tz)]);
  if (c.end != null) head.push(["Ended", stamp(c.end, tz)]);
  if (c.duration_ms != null) head.push(["Duration", durationText(c.duration_ms)]);
  if (c.summary) head.push(["Summary", c.summary]);
  if (c.place) head.push(["Location", c.place]);
  const line = (l) => `[${l.at != null ? clock(l.at, tz) : "--:--:--"}] ${l.who}: ${String(l.text).replace(/\s*\n\s*/g, " ")}`;
  if (md) return `# Bee conversation\n\n${head.map(([k, v]) => `- ${k}: ${v}`).join("\n")}\n\n## Transcript\n\n${c.lines.map(line).join("\n\n")}\n`;
  return `Bee conversation\n${head.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\n${c.lines.map(line).join("\n")}\n`;
}
export const exportName = (c, tz, format) => `Bee conversation ${c.start != null ? day(c.start, tzOf(tz)) : c.id}.${format === "md" ? "md" : "txt"}`;

// ---------------------------------------------------------------- the routes ----------------------------------------------------------------
// Does this account have anything to list? It has (or had) a Bee connection: a bee_accounts row, or a bee_events row (the events are written from the first connection on, and the last 100 are always kept,
// so they stay after a disconnect that kept the transcripts). No Durable Object is woken, and no R2 list is made, to find out.
export async function hasBeeData(env, tid) {
  if (!env.BEE_SYNC) return false;
  for (const q of ["SELECT 1 x FROM bee_accounts WHERE tenant_id=?", "SELECT 1 x FROM bee_events WHERE tenant_id=? LIMIT 1"]) { try { if (await env.DB.prepare(q).bind(tid).first()) return true; } catch {} }
  return false;
}
const stubOf = (env, tid) => env.BEE_SYNC.get(env.BEE_SYNC.idFromName(tid));
// The person's time zone: the one the app saved in General (the same zone the helper uses), else the default.
async function personTz(env, tid) {
  try { const R = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${tid}:main`)); return tzOf(await R.tz()); } catch { return DEFAULT_TZ; }
}

export async function beeLibraryRoute({ req, env, t, user, sub, url }) {
  const m = /^\/api\/library\/bee\/conversations(?:\/(\d{1,15})(?:\/(export|delete))?)?$/.exec(sub); if (!m) return null;
  if (!user || !t || user.id !== t.owner_user_id) return reply({ error: "owner only" }, 403);
  const id = m[1] ? Number(m[1]) : null, act = m[2] || null;
  if (id == null) {
    if (req.method !== "GET") return reply({ error: "method" }, 405);
    if (!(await hasBeeData(env, t.id))) return reply({ items: [], next: null, total: 0, tz: await personTz(env, t.id) });
    const limit = Math.max(1, Math.min(PAGE_MAX, Number(url.searchParams.get("limit")) || PAGE)), cursor = /^\d{1,16}:\d{1,16}$/.test(url.searchParams.get("cursor") || "") ? url.searchParams.get("cursor") : null;
    const [d, tz] = await Promise.all([stubOf(env, t.id).libList({ cursor, limit }), personTz(env, t.id)]);
    return reply({ ...d, tz });
  }
  if (act === "delete") {
    if (req.method !== "POST") return reply({ error: "method" }, 405);
    if (!(await hasBeeData(env, t.id))) return reply({ error: "That conversation isn't here." }, 404);
    const d = await stubOf(env, t.id).libDelete(id);
    return reply(d, d.error ? 404 : 200);
  }
  if (req.method !== "GET") return reply({ error: "method" }, 405);
  if (!(await hasBeeData(env, t.id))) return reply({ error: "That conversation isn't here." }, 404);
  const [c, tz] = await Promise.all([stubOf(env, t.id).libGet(id), personTz(env, t.id)]);
  if (c.error) return reply(c, 404);
  if (act === "export") {
    const format = url.searchParams.get("format") === "md" ? "md" : "txt";
    return new Response(exportText(c, tz, format), { headers: { ...servedHeaders(format === "md" ? "text/markdown" : "text/plain", exportName(c, tz, format), true), "cache-control": "private, no-store" } });
  }
  return reply({ ...c, tz });
}
