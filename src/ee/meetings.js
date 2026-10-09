// Meeting reminders for notes (Captain 2026-10-08): "Your meeting is starting, take notes?" for people with Google Calendar or Outlook
// connected. About a minute before a meeting that has a video link or other people in it, every device with notifications on gets a
// push ("Your 2:00 “Weekly sync” is starting" · "Take notes?"), and an open app shows the same as a banner. Tapping it opens Live
// notes in a new task named after the meeting, with the Start sheet ready to pick the input (a meeting tab by default).
// - An app notification the person opted into (Settings → Notifications → "Meeting reminders for notes", on by default; only devices
//   with notifications on, or an open app, get it). Not the helper: no model runs, nothing is written in a chat.
// - Cheap: the one-minute cron (index.js scheduled "* * * * *") only reads D1, except for at most POLL_BATCH workspaces a minute whose
//   next look is due. A workspace is looked at every POLL_MS (10 min) while it has a device with notifications on or the app was open
//   in the last 15 min; which calendars it has is re-read every CALS_MS (1 h). Each look is one Composio call per calendar for the next
//   WINDOW_MS (20 min). Nothing wakes the computer or a Resident (the time zone comes from the app, or the calendar itself).
// - Calendars: Google through 1Helm's own GOOGLECALENDAR_EVENTS_LIST (the default googlecalendar account, or a legacy googlesuper one);
//   Outlook (Microsoft 365 / Outlook.com; corporate America mostly) through Composio's OUTLOOK_GET_CALENDAR_VIEW on the default
//   outlook account. Managed or Self-managed apps alike (composio.js transport).
// - Deploy-safe like resume.js: every step is a D1 row change that can run twice. A look claims the workspace (next_poll_at moves on)
//   before it calls out, so a run killed by a deploy waits for the next slot instead of looping. A reminder is claimed (state sending)
//   before its push and marked sent after; a claim older than CLAIM_MS (a deploy in between) is sent again, which the device shows as
//   the same notification (same tag), never a second one. Past the meeting's start + LATE_MS nothing is sent.
import { pushAll, getPrefs } from "../notify.js";
import { listConnections, pickAccount, execTool, OWN_VERSIONS } from "./composio.js";
import { latestVersion } from "./composio-api.js";
import { DEFAULT_TZ, validTz } from "../schedule.js";

export const POLL_MS = 10 * 60e3, CALS_MS = 60 * 60e3, WINDOW_MS = 20 * 60e3, LEAD_MS = 60e3, LATE_MS = 5 * 60e3, CLAIM_MS = 90e3, SEEN_MS = 15 * 60e3, POLL_BATCH = 8, KEEP_MS = 2 * 864e5;
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// ---- which events (pure) ----
// A video link: Meet, Zoom, Teams, Webex, Whereby, GoTo, Chime, BlueJeans, Jitsi.
export const MEET_LINK_RE = /https?:\/\/(?:[\w-]+\.)*(?:meet\.google\.com|zoom\.us|zoomgov\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com|whereby\.com|gotomeeting\.com|meet\.goto\.com|app\.goto\.com|chime\.aws|bluejeans\.com|meet\.jit\.si)\/[^\s<>"')\]]+/i;
const linkIn = (...xs) => { for (const x of xs) { const m = String(x || "").match(MEET_LINK_RE); if (m) return m[0]; } return ""; };
const utcMs = (s) => { const x = String(s || ""); if (!x) return NaN; return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(x) ? x : `${x.replace(/\.\d+$/, "")}Z`); };
// One calendar event → { id, title, start, end, link, others } or null (all-day, cancelled, declined, not a meeting).
// app: "googlecalendar" (Google's event resource) | "outlook" (Microsoft Graph's, asked for in UTC).
export function meetingOf(app, e) {
  if (!e || !e.id) return null;
  if (app === "outlook") {
    if (e.isCancelled || e.isAllDay || e.responseStatus?.response === "declined") return null;
    const start = utcMs(e.start?.dateTime), end = utcMs(e.end?.dateTime); if (!Number.isFinite(start)) return null;
    const others = (e.attendees || []).filter((a) => a?.type !== "resource" && a?.status?.response !== "declined").length;
    const link = String(e.onlineMeeting?.joinUrl || e.onlineMeetingUrl || "") || linkIn(e.location?.displayName, e.bodyPreview);
    return { id: String(e.id), title: String(e.subject || "Meeting").trim() || "Meeting", start, end: Number.isFinite(end) ? end : null, link, others };
  }
  if (e.status === "cancelled" || !e.start?.dateTime) return null;   // all-day events have start.date only
  if (["workingLocation", "focusTime", "outOfOffice"].includes(e.eventType)) return null;
  const me = (e.attendees || []).find((a) => a?.self); if (me?.responseStatus === "declined") return null;
  const start = Date.parse(e.start.dateTime), end = Date.parse(e.end?.dateTime || ""); if (!Number.isFinite(start)) return null;
  const others = (e.attendees || []).filter((a) => a && !a.self && !a.resource && a.responseStatus !== "declined").length;
  const link = String(e.hangoutLink || (e.conferenceData?.entryPoints || []).find((p) => p?.entryPointType === "video")?.uri || "") || linkIn(e.location, e.description);
  return { id: String(e.id), title: String(e.summary || "Meeting").trim() || "Meeting", start, end: Number.isFinite(end) ? end : null, link, others };
}
// Worth asking about: a video link, or other people in it.
export const wantsNotes = (m) => !!m && (!!m.link || m.others > 0);
// "2:00" in their time zone (no AM/PM: it's about to start).
export function clockOf(ms, tz) { try { return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: validTz(tz) ? tz : DEFAULT_TZ }).format(ms).replace(/\s?[AP]M$/i, ""); } catch { return ""; } }
export function reminderText(title, start, tz) {
  const t = String(title || "Meeting").replace(/\s+/g, " ").trim().slice(0, 80);
  return { title: `Your ${clockOf(start, tz)} “${t}” is starting`, body: "Take notes? Tap to start Live notes." };
}
export async function alertId(tenantId, app, eventId, start) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${tenantId}|${app}|${eventId}|${start}`)));
  return "ma" + [...d.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const appUrl = (env, slug, hash = "") => `https://${env.APP_HOST || env.GATEWAY_HOST}/w/${slug}/app${hash}`;

// ---- calendars ----
export const CAL_APPS = ["googlecalendar", "outlook"];
const versionOf = (env, app) => (latestVersion(env) ? (OWN_VERSIONS[app] || undefined) : undefined);
// The workspace's calendars to look at: the default Google Calendar account (or a legacy Google Super one) and the default Outlook account.
export async function calendarsOf(env, tenantId) {
  const conns = await listConnections(env, tenantId, { names: false });
  const out = [];
  for (const app of CAL_APPS) { const { acct } = pickAccount(conns, app); if (acct) out.push({ app, account: acct.id, via: acct.app }); }
  return out;
}
// Events from `from` to `to` (ms) on one calendar → { meetings, tz }.
export async function eventsOf(env, tenantId, cal, from, to) {
  if (cal.app === "outlook") {
    const r = await execTool(env, tenantId, "OUTLOOK_GET_CALENDAR_VIEW", { start_datetime: new Date(from).toISOString(), end_datetime: new Date(to).toISOString(), timezone: "UTC", top: 25, orderby: "start/dateTime asc",
      select: ["id", "subject", "start", "end", "isAllDay", "isCancelled", "attendees", "onlineMeeting", "onlineMeetingUrl", "isOnlineMeeting", "location", "bodyPreview", "responseStatus"] }, cal.account, versionOf(env, "outlook"));
    return { meetings: (r?.value || r?.data?.value || []).map((e) => meetingOf("outlook", e)).filter(Boolean), tz: "" };
  }
  const r = await execTool(env, tenantId, "GOOGLECALENDAR_EVENTS_LIST", { calendarId: "primary", timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), singleEvents: true, orderBy: "startTime", maxResults: 25 }, cal.account, versionOf(env, "googlecalendar"));
  return { meetings: (r?.items || []).map((e) => meetingOf("googlecalendar", e)).filter(Boolean), tz: String(r?.timeZone || "") };
}

// ---- one workspace's look ----
async function watchRow(env, tenantId) { return env.DB.prepare("SELECT * FROM meeting_watch WHERE tenant_id=?").bind(tenantId).first().catch(() => null); }
export async function pollTenant(env, tenantId, now = Date.now(), deps = {}) {
  const cals0 = deps.calendarsOf || calendarsOf, events0 = deps.eventsOf || eventsOf;
  // claim: the next look is set before anything goes out (a run cut off by a deploy waits for its next slot)
  await env.DB.prepare("INSERT INTO meeting_watch (tenant_id,next_poll_at,updated_at) VALUES (?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET next_poll_at=excluded.next_poll_at, updated_at=excluded.updated_at")
    .bind(tenantId, now + POLL_MS, now).run();
  const w = await watchRow(env, tenantId) || {};
  let cals = []; try { cals = JSON.parse(w.cals || "[]"); } catch {}
  if (!w.cals_at || now - Number(w.cals_at) > CALS_MS) {
    try { cals = await cals0(env, tenantId); await env.DB.prepare("UPDATE meeting_watch SET cals=?, cals_at=?, last_error='' WHERE tenant_id=?").bind(JSON.stringify(cals), now, tenantId).run(); }
    catch (e) { await env.DB.prepare("UPDATE meeting_watch SET last_error=? WHERE tenant_id=?").bind(`calendars: ${String(e?.message || e).slice(0, 200)}`, tenantId).run().catch(() => {}); return { tenant: tenantId, error: "calendars" }; }
  }
  const out = { tenant: tenantId, cals: cals.length, found: 0, added: 0, gone: 0, errors: [] };
  const from = now - 2 * 60e3, to = now + WINDOW_MS;
  for (const cal of cals) {
    let got; try { got = await events0(env, tenantId, cal, from, to); } catch (e) { out.errors.push(`${cal.app}: ${String(e?.message || e).slice(0, 160)}`); continue; }
    if (got.tz && !w.tz && validTz(got.tz)) await env.DB.prepare("UPDATE meeting_watch SET tz=? WHERE tenant_id=? AND tz=''").bind(got.tz, tenantId).run().catch(() => {});
    const keep = [];
    for (const m of got.meetings) {
      if (!wantsNotes(m) || m.start < from || m.start > to) continue;
      out.found++;
      const id = await alertId(tenantId, cal.app, m.id, m.start); keep.push(id);
      const r = await env.DB.prepare(`INSERT INTO meeting_alerts (id,tenant_id,app,event_id,title,start_at,end_at,link,alert_at,state,created_at) VALUES (?,?,?,?,?,?,?,?,?,'due',?)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title, end_at=excluded.end_at, link=excluded.link`).bind(id, tenantId, cal.app, m.id, m.title.slice(0, 200), m.start, m.end, m.link.slice(0, 500), m.start - LEAD_MS, now).run();
      if (r?.meta?.changes) out.added++;
    }
    // Moved or cancelled since the last look: an unsent reminder in this window that isn't there any more goes.
    const stale = (await env.DB.prepare("SELECT id FROM meeting_alerts WHERE tenant_id=? AND app=? AND state='due' AND start_at>=? AND start_at<=?").bind(tenantId, cal.app, from, to).all()).results || [];
    for (const s of stale) if (!keep.includes(s.id)) { await env.DB.prepare("DELETE FROM meeting_alerts WHERE id=? AND state='due'").bind(s.id).run(); out.gone++; }
  }
  await env.DB.prepare("UPDATE meeting_watch SET polled_at=?, last_error=? WHERE tenant_id=?").bind(now, out.errors.join("; ").slice(0, 400), tenantId).run().catch(() => {});
  return out;
}

// ---- send what's due ----
export async function sendDue(env, now = Date.now()) {
  const out = { sent: 0, off: 0, missed: 0 };
  await env.DB.prepare("UPDATE meeting_alerts SET state='missed' WHERE state IN ('due','sending') AND start_at < ?").bind(now - LATE_MS).run().catch(() => {});
  const rows = (await env.DB.prepare(`SELECT a.*, t.slug, w.tz FROM meeting_alerts a JOIN tenants t ON t.id=a.tenant_id LEFT JOIN meeting_watch w ON w.tenant_id=a.tenant_id
    WHERE a.alert_at<=? AND a.start_at>=? AND (a.state='due' OR (a.state='sending' AND a.claimed_at<?)) ORDER BY a.alert_at LIMIT 50`).bind(now, now - LATE_MS, now - CLAIM_MS).all()).results || [];
  for (const a of rows) {
    const c = await env.DB.prepare("UPDATE meeting_alerts SET state='sending', claimed_at=? WHERE id=? AND (state='due' OR (state='sending' AND claimed_at<?))").bind(now, a.id, now - CLAIM_MS).run();
    if (!c?.meta?.changes) continue;   // another run has it
    const prefs = await getPrefs(env, a.tenant_id);
    if (!prefs.meetings) { await env.DB.prepare("UPDATE meeting_alerts SET state='off' WHERE id=?").bind(a.id).run(); out.off++; continue; }
    const txt = reminderText(a.title, Number(a.start_at), a.tz || DEFAULT_TZ);
    const r = await pushAll(env, a.tenant_id, { kind: "meeting", title: txt.title, body: txt.body, url: appUrl(env, a.slug, `#/meet/${a.id}`), tag: `meet-${a.id}` }, { urgency: "high", topic: `m${a.id.slice(2, 26)}` }).catch((e) => ({ error: String(e?.message || e).slice(0, 200) }));
    await env.DB.prepare("UPDATE meeting_alerts SET state='sent', sent_at=?, push=? WHERE id=? AND state='sending'").bind(Date.now(), JSON.stringify(r || {}).slice(0, 400), a.id).run();
    out.sent++;
  }
  return out;
}

// ---- the minute cron ----
// Workspaces whose next look is due: reminders on, active, and someone to tell (a device with notifications on, or the app open lately).
export async function meetingsCron(env, { now = Date.now(), deps = {} } = {}) {
  const out = { due: await sendDue(env, now), polled: [] };
  const ts = (await env.DB.prepare(`SELECT t.id FROM tenants t LEFT JOIN meeting_watch w ON w.tenant_id=t.id LEFT JOIN notif_prefs n ON n.tenant_id=t.id
    WHERE t.status='active' AND COALESCE(n.meetings,1)=1 AND COALESCE(w.next_poll_at,0)<=?
      AND (EXISTS (SELECT 1 FROM push_subs p WHERE p.tenant_id=t.id) OR COALESCE(w.seen_at,0)>?)
    ORDER BY COALESCE(w.next_poll_at,0) LIMIT ?`).bind(now, now - SEEN_MS, POLL_BATCH).all()).results || [];
  for (const t of ts) out.polled.push(await pollTenant(env, t.id, now, deps).catch((e) => ({ tenant: t.id, error: String(e?.message || e).slice(0, 160) })));
  if (out.polled.length) out.due2 = await sendDue(env, Date.now());   // a meeting found just now that starts within the minute
  if (new Date(now).getUTCMinutes() === 7) await env.DB.prepare("DELETE FROM meeting_alerts WHERE start_at<?").bind(now - KEEP_MS).run().catch(() => {});
  return out;
}

// ---- /w/<slug>/api/meetings… (index.js) ----
// GET  /api/meetings/soon?tz=   the app's banner: reminders from now to 15 min ahead that it may show (and the app counts as open)
// POST /api/meetings/<id>/take  → { channel, session, title }: the task for its notes (made once; a second device gets the same one)
// POST /api/meetings/<id>/dismiss  "Not now" (every device's banner goes)
// deps: { mainResident(t) → the General channel's Resident, bound }
export async function meetingsApi(req, env, t, sub, url, deps) {
  if (sub === "/api/meetings/soon" && req.method === "GET") {
    const now = Date.now(), tz = String(url.searchParams.get("tz") || "").slice(0, 64);
    await env.DB.prepare(`INSERT INTO meeting_watch (tenant_id,seen_at,tz,updated_at) VALUES (?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET seen_at=excluded.seen_at, tz=CASE WHEN excluded.tz<>'' THEN excluded.tz ELSE meeting_watch.tz END, updated_at=excluded.updated_at`)
      .bind(t.id, now, validTz(tz) ? tz : "", now).run().catch(() => {});
    const prefs = await getPrefs(env, t.id);
    if (!prefs.meetings) return json({ on: false, alerts: [] });
    const rows = (await env.DB.prepare("SELECT id,title,start_at,alert_at,link,app,state,session,channel FROM meeting_alerts WHERE tenant_id=? AND start_at>=? AND alert_at<=? AND state NOT IN ('dismissed','off') ORDER BY start_at LIMIT 10")
      .bind(t.id, now - LATE_MS, now + 15 * 60e3).all().catch(() => ({ results: [] }))).results || [];
    return json({ on: true, now, alerts: rows.map((a) => ({ ...reminderText(a.title, a.start_at, validTz(tz) ? tz : DEFAULT_TZ), id: a.id, name: a.title, start_at: a.start_at, alert_at: a.alert_at, link: a.link, app: a.app, taken: a.session && !/^pending:/.test(a.session) ? { channel: a.channel, session: a.session } : null })) });
  }
  const m = sub.match(/^\/api\/meetings\/(ma[0-9a-f]{24})\/(take|dismiss)$/);
  if (!m || req.method !== "POST") return json({ error: "not found" }, 404);
  const a = await env.DB.prepare("SELECT * FROM meeting_alerts WHERE id=? AND tenant_id=?").bind(m[1], t.id).first();
  if (!a) return json({ error: "That meeting reminder is gone." }, 404);
  if (m[2] === "dismiss") { await env.DB.prepare("UPDATE meeting_alerts SET state='dismissed', dismissed_at=? WHERE id=?").bind(Date.now(), a.id).run(); return json({ ok: true }); }
  // take: one task per reminder, whichever device taps first makes it
  const done = (x) => json({ channel: x.channel, session: x.session, title: x.title });
  if (a.session && !/^pending:/.test(a.session)) return done(a);
  const mine = `pending:${crypto.randomUUID()}`;
  const c = await env.DB.prepare("UPDATE meeting_alerts SET session=?, taken_at=? WHERE id=? AND (session IS NULL OR (session LIKE 'pending:%' AND COALESCE(taken_at,0)<?))").bind(mine, Date.now(), a.id, Date.now() - 30e3).run();
  if (!c?.meta?.changes) {   // another device is making it: wait for it (a few seconds at most)
    for (let i = 0; i < 20; i++) { await new Promise((z) => setTimeout(z, 250)); const x = await env.DB.prepare("SELECT * FROM meeting_alerts WHERE id=?").bind(a.id).first(); if (x?.session && !/^pending:/.test(x.session)) return done(x); }
    return json({ error: "Still opening it on another device. Try again in a moment." }, 409);
  }
  const { R, channel } = await deps.mainResident(t);
  const sid = await R.newSession(String(a.title || "Meeting").slice(0, 120));
  await env.DB.prepare("UPDATE meeting_alerts SET session=?, channel=?, state=CASE WHEN state IN ('due','sending') THEN 'taken' ELSE state END WHERE id=? AND session=?").bind(sid, channel, a.id, mine).run();
  return done({ channel, session: sid, title: a.title });
}
