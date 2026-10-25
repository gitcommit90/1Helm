import { boundedJson } from "./bounded-body.js";
// Settings → Notifications (Captain 10-06): "A task needs you" (a question, an approval, something to sign), "A task is finished",
// and "Sounds" (the app plays a soft sound itself). Saved per workspace in D1 (notif_prefs; no row = everything on).
// Delivery: in the app (task dots, the sound), Web Push to every device that turned it on (push_subs; the service worker in
// pwa.js shows it unless an app window that's visible and focused is showing that same task), and, for "needs you" with texting connected, one text (needs_text).
// No spam: one push (and at most one text) per task per state change. The state is remembered in the channel's Resident (its
// notif_state table: task → the last kind notified) and cleared when a new turn starts in that task (the person answered, or a plan started it). Plus a cap of
// PUSH_CAP pushes per workspace per rolling hour.
import { sendPush, vapidReady, okPushEndpoint as okEndpoint } from "./webpush.js";
import { textConnected, textSend } from "./ee/index.js";
import { recordTextAlert } from "./text-alerts.js";
import { cardsToText } from "./genui.js";
import { helperName } from "./helper-name.js";

// meetings: "Meeting reminders for notes" (meetings.js): a push / banner when a calendar meeting starts, to start Live notes.
export const PREF_KEYS = ["needs", "finished", "sound", "needs_text", "meetings"];
export const DEFAULT_PREFS = { needs: true, finished: true, sound: true, needs_text: true, meetings: true };
export const PUSH_CAP = 100;   // per workspace per hour (Captain 2026-10-17: 30 -> 100)
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
// Use the same endpoint check at registration and immediately before a send.
export { okEndpoint };

export async function getPrefs(env, tenantId) {
  let r = null; try { r = await env.DB.prepare("SELECT * FROM notif_prefs WHERE tenant_id=?").bind(tenantId).first(); } catch {}
  const out = { ...DEFAULT_PREFS }; if (r) for (const k of PREF_KEYS) out[k] = r[k] == null ? DEFAULT_PREFS[k] : Number(r[k]) === 1;
  return out;
}
export async function setPrefs(env, tenantId, patch) {
  const cur = await getPrefs(env, tenantId);
  for (const k of PREF_KEYS) if (typeof patch?.[k] === "boolean") cur[k] = patch[k];
  await env.DB.prepare(`INSERT INTO notif_prefs (tenant_id,needs,finished,sound,needs_text,meetings,updated_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(tenant_id) DO UPDATE SET needs=excluded.needs, finished=excluded.finished, sound=excluded.sound, needs_text=excluded.needs_text, meetings=excluded.meetings, updated_at=excluded.updated_at`)
    .bind(tenantId, ...PREF_KEYS.map((k) => (cur[k] ? 1 : 0)), Date.now()).run();
  return cur;
}
// One more push this hour? (rolling window per workspace, kept on the prefs row)
async function underCap(env, tenantId, now = Date.now()) {
  try {
    await env.DB.prepare("INSERT OR IGNORE INTO notif_prefs (tenant_id,updated_at) VALUES (?,?)").bind(tenantId, now).run();
    const r = await env.DB.prepare("SELECT win_start, win_count FROM notif_prefs WHERE tenant_id=?").bind(tenantId).first();
    if (!r || now - Number(r.win_start || 0) > 3600e3) { await env.DB.prepare("UPDATE notif_prefs SET win_start=?, win_count=1 WHERE tenant_id=?").bind(now, tenantId).run(); return true; }
    if (Number(r.win_count) >= PUSH_CAP) return false;
    await env.DB.prepare("UPDATE notif_prefs SET win_count=win_count+1 WHERE tenant_id=?").bind(tenantId).run(); return true;
  } catch { return true; }
}

// Push one message to every device of the workspace (or one device: endpoint). Drops subscriptions the push service says are gone.
export async function pushAll(env, tenantId, payload, { endpoint = null, urgency = "normal", topic = "" } = {}) {
  if (!vapidReady(env)) return { sent: 0, devices: 0, reason: "no_vapid" };
  let subs = [];
  try { subs = (await env.DB.prepare(`SELECT * FROM push_subs WHERE tenant_id=?${endpoint ? " AND endpoint=?" : ""}`).bind(...(endpoint ? [tenantId, endpoint] : [tenantId])).all()).results || []; } catch { return { sent: 0, devices: 0 }; }
  let sent = 0; const now = Date.now(), res = [];
  for (const s of subs) {
    const r = await sendPush(env, s, payload, { urgency, topic }).catch((e) => ({ ok: false, status: 0, error: e.message }));
    res.push(r.status);
    if (r.ok) { sent++; await env.DB.prepare("UPDATE push_subs SET last_ok_at=?, fails=0 WHERE id=?").bind(now, s.id).run().catch(() => {}); }
    else if (r.gone || Number(s.fails) >= 9) await env.DB.prepare("DELETE FROM push_subs WHERE id=?").bind(s.id).run().catch(() => {});
    else await env.DB.prepare("UPDATE push_subs SET fails=fails+1 WHERE id=?").bind(s.id).run().catch(() => {});
    if (!r.ok) console.log("push failed", r.status, r.error || "");
  }
  return { sent, devices: subs.length, statuses: res };
}

const WHY = { question: "has a question for you", approval: "needs your OK to go on", interview: "has a few questions for you", plan: "has a plan for you to approve",
  browser: "needs you in the browser", link: "needs you to approve a purchase in Link", sign: "needs your signature" };
const appUrl = (env, slug, channel, session) => `https://${env.APP_HOST || env.GATEWAY_HOST}/w/${slug}/app${channel && session ? `#/${channel}/s/${session}` : ""}`;

// The task changed state: kind "needs" (waiting on the person; why = sessions.waiting or "approval") or "finished".
// R = the channel's Resident. opts.noText: the caller already texted this (a permission card); opts.watched: the person is
// watching this turn in the app right now (no text; the push still goes and the service worker keeps it quiet only if a focused,
// visible app window is showing this task: swQuiet in pwa.js).
// Returns what happened (tests read it).
export async function notifyTask(R, session, kind, { why = "", reply = "", noText = false, watched = false } = {}) {
  const env = R.env, tenant = R.get("tenant"), channel = R.get("channel");
  if (!env?.DB || !tenant || (kind !== "needs" && kind !== "finished")) return { skipped: "bad" };
  const key = String(session || "_");
  stateTable(R);
  if (R.sql.exec("SELECT kind FROM notif_state WHERE session=?", key).toArray()[0]?.kind === kind) return { skipped: "same_state" };
  R.sql.exec("INSERT INTO notif_state (session,kind,at) VALUES (?,?,?) ON CONFLICT(session) DO UPDATE SET kind=excluded.kind, at=excluded.at", key, kind, Date.now());
  const prefs = await getPrefs(env, tenant);
  if (!prefs[kind]) return { skipped: "off" };
  const t = await env.DB.prepare("SELECT slug, helper_name FROM tenants WHERE id=?").bind(tenant).first().catch(() => null);
  const helper = helperName(t), row = session ? R.session?.(session) : null, title = row?.title || "your task";
  const url = appUrl(env, t?.slug || "", channel, session);
  const out = { kind, push: null, texted: false };
  const payload = kind === "needs"
    ? { kind, title: `${helper} ${WHY[why] || "needs you"}`, body: title, url, session: String(session || ""), tag: `task-${session || "x"}` }
    : { kind, title: `Finished: ${title}`.slice(0, 120), body: reply ? cardsToText(String(reply)).replace(/\s+/g, " ").trim().slice(0, 140) : `${helper} is done. Take a look.`, url, session: String(session || ""), tag: `task-${session || "x"}` };
  if (await underCap(env, tenant)) out.push = await pushAll(env, tenant, payload, { urgency: kind === "needs" ? "high" : "normal", topic: `t${String(session || "").replace(/-/g, "")}` }).catch((e) => ({ error: e.message }));
  else out.push = { capped: true };
  // By text: "needs you" only, when texting is connected and they aren't watching. Once per state change (the key above).
  if (kind === "needs" && prefs.needs_text && !noText && !watched) {
    if (await textConnected(env, tenant)) {
      const q = why === "question" ? (cardsToText(String(reply || "")).split("\n").map((l) => l.trim()).find((l) => /\?$/.test(l)) || "").slice(0, 300) : "";
      const msg = why === "question" ? `${helper} has a question before going on with "${title}"${q ? `: ${q}` : "."} Answer in the app: ${url}`
        : `${helper} ${WHY[why] || "needs you"} on "${title}". Open it in the app: ${url}`;
      const d = await textSend(env, tenant, msg).catch((e) => ({ ok: false, reason: e.message }));
      out.texted = !!d?.ok;
      // "Open it in the app" notices ask for nothing by text, so they are context for the Texts task only (expects stays false).
      if (d?.ok) recordTextAlert(R, { session, kind: why === "question" ? "question" : "needs", text: msg, guid: d.id });
    }
  }
  return out;
}
// A workflow that runs on an app event dropped events because of its hourly limit (app-events.js). One quiet push, no text, no task opened.
// The caller sends it at most once an hour per workflow. It follows the "A task needs you" setting, because the person has to decide whether the limit is right.
export async function notifyEventsSkipped(R, workflow, limit) {
  const env = R.env, tenant = R.get("tenant");
  if (!env?.DB || !tenant) return { skipped: "bad" };
  const prefs = await getPrefs(env, tenant);
  if (!prefs.needs) return { skipped: "off" };
  const t = await env.DB.prepare("SELECT slug, helper_name FROM tenants WHERE id=?").bind(tenant).first().catch(() => null);
  if (!(await underCap(env, tenant))) return { push: { capped: true } };
  const payload = { kind: "events_skipped", title: `${helperName(t)} skipped some events`, body: `"${String(workflow?.name || "A workflow").slice(0, 80)}" runs at most ${limit} times an hour, so events past that were skipped.`,
    url: appUrl(env, t?.slug || "", R.get("channel"), null), tag: `events-${workflow?.id ?? "x"}` };
  return { push: await pushAll(env, tenant, payload).catch((e) => ({ error: e.message })) };
}
// A new turn started in the task (the person answered, or it was started again): the next state change notifies again.
export function notifyReset(R, session) { try { stateTable(R); R.sql.exec("DELETE FROM notif_state WHERE session=?", String(session || "_")); } catch {} }
function stateTable(R) { if (R._notifTable) return; R.sql.exec("CREATE TABLE IF NOT EXISTS notif_state (session TEXT PRIMARY KEY, kind TEXT NOT NULL, at INTEGER NOT NULL)"); R._notifTable = true; }
// Whether a permission card may go by text (textApproval): "A task needs you" and "also by text" both on.
export async function textAllowed(env, tenantId) { const p = await getPrefs(env, tenantId); return p.needs && p.needs_text; }

// ---- /w/<slug>/api/notif… (index.js) ----
export async function notifApi(req, env, t, sub, url) {
  const body = req.method === "POST" ? await boundedJson(req) : {};
  if (sub === "/api/notif" && req.method === "GET") {
    const ep = url.searchParams.get("endpoint") || "";
    const n = await env.DB.prepare("SELECT COUNT(*) n FROM push_subs WHERE tenant_id=?").bind(t.id).first().catch(() => ({ n: 0 }));
    const mine = ep ? await env.DB.prepare("SELECT id FROM push_subs WHERE tenant_id=? AND endpoint=?").bind(t.id, ep).first().catch(() => null) : null;
    return json({ prefs: await getPrefs(env, t.id), push: { key: vapidReady(env) ? env.VAPID_PUBLIC : null, devices: Number(n?.n || 0), this_device: !!mine }, texting: await textConnected(env, t.id) });
  }
  if (sub === "/api/notif" && req.method === "POST") return json({ prefs: await setPrefs(env, t.id, body) });
  if (sub === "/api/notif/sub" && req.method === "POST") {
    const s = body.sub || {}, ep = String(s.endpoint || ""), p256dh = String(s.keys?.p256dh || ""), auth = String(s.keys?.auth || "");
    if (!okEndpoint(ep) || !/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(auth)) return json({ error: "That isn't a push subscription this app can use." }, 400);
    const label = String(body.label || "").slice(0, 80);
    // An endpoint belongs to one browser profile: re-subscribing (or another workspace on the same browser) moves it here.
    await env.DB.prepare(`INSERT INTO push_subs (id,tenant_id,endpoint,p256dh,auth,label,created_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(endpoint) DO UPDATE SET tenant_id=excluded.tenant_id, p256dh=excluded.p256dh, auth=excluded.auth, label=excluded.label, fails=0`)
      .bind(crypto.randomUUID(), t.id, ep, p256dh, auth, label, Date.now()).run();
    return json({ ok: true });
  }
  if (sub === "/api/notif/unsub" && req.method === "POST") {
    await env.DB.prepare("DELETE FROM push_subs WHERE tenant_id=? AND endpoint=?").bind(t.id, String(body.endpoint || "")).run();
    return json({ ok: true });
  }
  // A test always shows as a system notification, even with the app focused, under its own tag (pwa.js), so repeats aren't merged.
  if (sub === "/api/notif/test" && req.method === "POST") {
    const ep = String(body.endpoint || "");
    if (!ep) return json({ error: "Turn on notifications on this device first." }, 400);
    const r = await pushAll(env, t.id, { kind: "test", test: true, title: "Notifications are on", body: `This is how ${t.helper_name || "your helper"} will reach you on this device.`, url: appUrl(env, t.slug), tag: `test-${Date.now()}` }, { endpoint: ep });
    if (!r.devices) return json({ error: "This device isn't signed up for notifications. Turn it off and on again." }, 404);
    return json({ ok: r.sent > 0, ...r });
  }
  return null;
}
