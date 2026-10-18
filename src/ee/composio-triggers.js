// "When <app event> happens" workflows (10-07, composio-upgrade stage 5): Composio triggers, workflow-only.
// Hard rule 3: the helper never messages the person on its own. A trigger exists only because the person asked for a workflow that runs
// when something happens in one of their apps ("when a new email from Dana arrives, summarize it into my notebook"), and its events wake
// THAT workflow only (app-events.js), never a chat, a task or anything else.
//
// This file is the Composio + webhook side:
//   app_events tool        what events an app has, with the settings each needs (GET /triggers_types)
//   createTrigger()        one trigger instance on the account 1Helm picked (POST /trigger_instances/{slug}/upsert)
//   setTriggerEnabled()    Pause / Resume (PATCH /trigger_instances/manage/{id})
//   deleteTrigger()        Stop (DELETE /trigger_instances/manage/{id})
//   dropTriggers()         an account disconnected / the workspace deleted: its triggers deleted at Composio (and their workflows told)
//   composioWebhook()      POST /composio/webhook: Standard-Webhooks signature (webhook-id / webhook-timestamp / webhook-signature, HMAC-SHA256
//                          over "<id>.<timestamp>.<raw body>" with COMPOSIO_WEBHOOK_SECRET, a Worker secret), 5-minute window, replays
//                          refused (D1 composio_webhook_seen), then routed by trigger_id (D1 composio_triggers) to its tenant's channel
//                          Resident + workflow (Resident.appEvent). An unknown trigger is ignored. On Live, events that aren't
//                          Live's are passed on to dev unchanged (one webhook, two servers: below).
// Self-managed (the person's own Composio through Connect MCP): Connect MCP has no triggers, so this says so plainly (SELF_NO_EVENTS)
// and never pretends.
import { composioRequest } from "./composio-api.js";
import { boundedText, BodyTooLargeError } from "../bounded-body.js";
import { slimInputs } from "./composio-schema.js";
import { appsMode } from "./composio-self.js";
import { isHiddenApp, HIDDEN_TEXT } from "./app-visibility.js";
import { pickAccount, toolkitInfo, notConnected, RETIRED_APPS, RETIRED_NOTE } from "./composio.js";   // a cycle on purpose: used only at call time

const uid = (tenantId) => `1hc:${tenantId}`;
export const SELF_NO_EVENTS = "NOT AVAILABLE: workflows that start when something happens in an app aren't available with a self-managed Composio account (Composio's Connect sign-in has no app events). Nothing was set up. Tell the person that plainly in one short sentence, and offer a scheduled check instead (schedule_workflow with a schedule or interval_seconds), e.g. checking their email every 30 minutes.";
// No webhook secret, no events (release #5, 10-08): until a server can verify the project webhook (COMPOSIO_WEBHOOK_SECRET set), it never
// makes a trigger: its events could never be checked or run. Once the secret is there this turns on by itself (the subscription points at
// Live, which passes dev's events on: composioWebhook below). app_events is hidden, and
// schedule_workflow on_event answers this instead. Managed apps, scheduled workflows and Self-managed are unaffected.
export const eventsReady = (env) => !!env?.COMPOSIO_WEBHOOK_SECRET;
export const EVENTS_OFF = "NOT AVAILABLE YET: workflows that start when something happens in an app aren't switched on yet. Nothing was set up. Tell the person that plainly in one short sentence, and offer a scheduled check instead (schedule_workflow with a schedule or interval_seconds), e.g. checking their email every 30 minutes.";
export const EVENT_TOLERANCE_S = 300;          // webhook-timestamp must be within 5 minutes of now (Composio's SDK default)
export const WEBHOOK_MAX_BYTES = 1_000_000;
export const EVENT_BODY_MAX = 12000;           // what of an event reaches the run (the rest is cut; the run can look things up)
export const TEST_TRIGGER = /^ti_test_[A-Za-z0-9_-]{6,40}$/;   // dev TEST_MODE live checks only: a made-up trigger id, never sent to Composio
const SLUG = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9_]/g, "");
const APP = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9_]/g, "");
const clip = (s, n) => { s = String(s ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

// ---------- the helper's tool ----------
export const APP_EVENTS_TOOL = { type: "function", function: { name: "app_events",
  description: "List the events one of the person's connected apps can start a workflow on (e.g. a new Gmail message, a new Slack message in a channel), with the settings each one takes (filters like a sender or a channel). Use it ONLY when the person asks for something to happen whenever something happens in one of their apps; then set that up with schedule_workflow's on_event. Never set one up on your own idea.",
  parameters: { type: "object", properties: { app: { type: "string", description: "app id, e.g. gmail, slack, github" }, want: { type: "string", description: "the kind of event in plain words, e.g. 'new email arrives'" } }, required: ["app"] } } };

async function typesOf(env, app) { return ((await composioRequest(env, `/triggers_types?toolkit_slugs=${app}&limit=50`)).items || []).filter((t) => APP(t.toolkit?.slug) === app); }
const howOf = (t) => (String(t.type || "").toLowerCase() === "poll" ? "checked every few minutes" : "right away");
const eventView = (t) => ({ event: t.slug, does: clip(`${t.name || t.slug}: ${t.description || ""}`, 260), when: howOf(t),
  settings: slimInputs(t.config), ...(t.instructions ? { tip: clip(t.instructions, 240) } : {}) });

// → text for the model.
export async function appEventsTool(env, tenantId, a = {}, conns = []) {
  try {
    if (!eventsReady(env)) return EVENTS_OFF;
    if ((await appsMode(env, tenantId)) === "self") return SELF_NO_EVENTS;
    const app = APP(a.app); if (!app) return "error: give the app id, e.g. gmail.";
    if (RETIRED_APPS.has(app)) return `error: ${RETIRED_NOTE}`;
    if (isHiddenApp(app)) return HIDDEN_TEXT(app);   // app-visibility.js
    const live = conns.filter((c) => c.app === app && c.status === "connected");   // not connected: said before asking Composio anything
    if (!live.length) return notConnected(conns.find((c) => c.app === app)?.name || app, app, { expired: conns.some((c) => c.app === app) });
    const tk = await toolkitInfo(env, app).catch(() => null);
    if (!tk) return `error: no app called "${app}". Use the app id (lowercase, e.g. gmail, slack, github).`;
    let types = await typesOf(env, app);
    if (!types.length) return `${tk.name} has no events a workflow can start on. A scheduled check works instead: schedule_workflow with a schedule or interval_seconds.`;
    const words = String(a.want || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    if (words.length) { const score = (t) => words.reduce((n, w) => n + (`${t.slug} ${t.name} ${t.description}`.toLowerCase().includes(w) ? 1 : 0), 0); types = types.map((t, i) => [score(t), i, t]).sort((x, y) => y[0] - x[0] || x[1] - y[1]).map((x) => x[2]); }
    return JSON.stringify({ app: tk.name, accounts: live.map((c) => ({ account: c.label, ...(live.length > 1 ? { default: c.default } : {}), ...(c.memo ? { note: c.memo } : {}) })),
      events: types.slice(0, 12).map(eventView),
      note: `* = required setting. Set one up only because the person asked: schedule_workflow with on_event { app: "${app}", event, settings${live.length > 1 ? ", account (which one to watch: ask them if their words and the account notes don't say)" : ""} }, the workflow's instructions in prompt, and person_asked (their own words asking for it). Each event then runs that workflow once with the event as its input.` });
  } catch (e) { return `error: ${clip(e.message || e, 300)}`; }
}

// The settings the person gave, checked against the event's own: unknown names refused, required ones (without a default) needed.
export function checkSettings(t, settings = {}) {
  const props = t?.config?.properties || {}, req = t?.config?.required || [];
  const cfg = settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
  const unknown = Object.keys(cfg).filter((k) => !Object.hasOwn(props, k));
  if (unknown.length) return { error: `error: ${t.slug} has no setting named ${unknown.map((k) => `"${k}"`).join(", ")}. Its settings (* = required): ${JSON.stringify(slimInputs(t.config))}. Nothing was set up.` };
  const missing = req.filter((k) => (cfg[k] == null || cfg[k] === "") && props[k]?.default === undefined);
  if (missing.length) return { error: `error: ${t.slug} needs ${missing.map((k) => `"${k}"`).join(", ")} (${missing.map((k) => clip(props[k]?.description || "", 120)).join("; ")}). Ask the person if you don't know it. Nothing was set up.` };
  return { cfg: Object.fromEntries(Object.entries(cfg).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 500) : v])) };
}
// Plain words for the Scheduled view and the helper: "Gmail: New Gmail Message (query: from:dana@x.com)".
export function eventLabel(appName, t, cfg = {}) {
  const props = t?.config?.properties || {};
  const set = Object.entries(cfg).filter(([k, v]) => v !== "" && v != null && JSON.stringify(v) !== JSON.stringify(props[k]?.default)).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  return clip(`${appName}: ${t?.name || t?.slug}${set.length ? ` (${set.join(", ")})` : ""}`, 160);
}

// One trigger instance for a workflow the person asked for. o = { app, event, settings, account }. → { trigger_id, slug, app, account_id,
// account_label, label, how } or { error } (a plain text for the helper). Nothing is created when any check fails.
export async function createTrigger(env, tenantId, o = {}, conns = []) {
  if (!eventsReady(env)) return { error: EVENTS_OFF };
  if ((await appsMode(env, tenantId)) === "self") return { error: SELF_NO_EVENTS };
  const slug = SLUG(o.event), app = APP(o.app) || slug.split("_")[0].toLowerCase();
  if (!slug) return { error: "error: on_event.event is required: an event id from app_events, e.g. GMAIL_NEW_GMAIL_MESSAGE. Nothing was set up." };
  if (!slug.toLowerCase().startsWith(`${app}_`)) return { error: `error: ${slug} isn't one of ${app}'s events. Call app_events for ${app}. Nothing was set up.` };
  if (RETIRED_APPS.has(app)) return { error: `error: ${RETIRED_NOTE}` };
  if (isHiddenApp(app)) return { error: HIDDEN_TEXT(app) };   // app-visibility.js
  const tk = await toolkitInfo(env, app).catch(() => null);
  if (!tk) return { error: `error: no app called "${app}". Nothing was set up.` };
  const p = pickAccount(conns, app, o.account);
  if (!p.mine.length || p.acct?.app !== app) return { error: notConnected(tk.name, app, { expired: p.expired }) };
  if (p.error) return { error: p.error.replace(/\.$/, ". Nothing was set up.") };
  if (p.several && !String(o.account || "").trim()) return { error: `error: they have ${p.mine.length} ${tk.name} accounts (${p.mine.map((c) => `${c.label}${c.memo ? ` (note: ${c.memo})` : ""}`).join(", ")}). Which one should this watch? Use what their words or the account notes say; otherwise ask them, then pass on_event.account. Nothing was set up.` };
  let t; try { t = await composioRequest(env, `/triggers_types/${slug}`); } catch { t = null; }
  if (!t?.slug || APP(t.toolkit?.slug) !== app) return { error: `error: ${tk.name} has no event ${slug}. Call app_events for ${app} and use one of its event ids. Nothing was set up.` };
  const c = checkSettings(t, o.settings); if (c.error) return c;
  const d = await composioRequest(env, `/trigger_instances/${slug}/upsert`, { method: "POST", body: JSON.stringify({ connected_account_id: p.acct.id, user_id: uid(tenantId), trigger_config: c.cfg }) });
  if (!d?.trigger_id) return { error: "error: Composio didn't set up the event. Nothing was set up." };
  return { trigger_id: String(d.trigger_id), slug, app, app_name: tk.name, account_id: p.acct.id, account_label: p.acct.label, label: eventLabel(tk.name, t, c.cfg), how: howOf(t) };
}

// ---------- D1: which workflow owns a trigger ----------
export async function mappingOf(env, triggerId) { return env?.DB ? env.DB.prepare("SELECT * FROM composio_triggers WHERE trigger_id=?").bind(String(triggerId || "")).first() : null; }
export async function saveMapping(env, r) {
  const now = Date.now();
  await env.DB.prepare("INSERT INTO composio_triggers (trigger_id,tenant_id,channel,workflow_id,slug,app,account_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .bind(r.trigger_id, r.tenant_id, r.channel, r.workflow_id, r.slug, r.app, r.account_id || null, "active", now, now).run();
}
const setMapping = (env, id, status) => env?.DB?.prepare("UPDATE composio_triggers SET status=?, updated_at=? WHERE trigger_id=?").bind(status, Date.now(), id).run().catch(() => null);
const dropMapping = (env, id) => env?.DB?.prepare("DELETE FROM composio_triggers WHERE trigger_id=?").bind(id).run().catch(() => null);

// Pause / Resume at Composio (a paused workflow's events would be dropped anyway; this stops Composio sending them).
export async function setTriggerEnabled(env, tenantId, triggerId, on) {
  if (!TEST_TRIGGER.test(triggerId)) await composioRequest(env, `/trigger_instances/manage/${encodeURIComponent(triggerId)}`, { method: "PATCH", retry: "read", body: JSON.stringify({ status: on ? "enable" : "disable", user_id: uid(tenantId) }) });
  await setMapping(env, triggerId, on ? "active" : "paused");
  return { ok: true };
}
// Stop: deleted at Composio, then the mapping goes. Composio already not knowing it counts as deleted. If Composio can't be reached the
// mapping stays as delete_pending: its next event, or the workspace's deletion, tries again; its events never run anything meanwhile.
export async function deleteTrigger(env, tenantId, triggerId) {
  if (!TEST_TRIGGER.test(triggerId)) {
    try { await composioRequest(env, `/trigger_instances/manage/${encodeURIComponent(triggerId)}`, { method: "DELETE" }); }
    catch (e) { if (!/not found|HTTP 404|does not exist|no trigger/i.test(e.message)) { await setMapping(env, triggerId, "delete_pending"); return { ok: false, error: clip(e.message, 200) }; } }
  }
  await dropMapping(env, triggerId);
  return { ok: true };
}
// An account disconnected ({ accountId }) or the whole workspace going (no accountId; deletion.js / Self-managed clearing old Managed apps):
// every trigger 1Helm made there is deleted at Composio (those Composio lists for this workspace too, in case a mapping was lost), and each
// workflow it belonged to is told (Resident.triggerGone: it stops, nothing is sent to the person). → how many were deleted.
export async function dropTriggers(env, tenantId, { accountId = "", why = "" } = {}) {
  if (!env?.COMPOSIO_KEY || !tenantId) return 0;
  const rows = env.DB ? ((await env.DB.prepare(`SELECT * FROM composio_triggers WHERE tenant_id=?${accountId ? " AND account_id=?" : ""}`).bind(...(accountId ? [tenantId, accountId] : [tenantId])).all().catch(() => ({ results: [] }))).results || []) : [];
  let n = 0; const done = new Set();
  for (const r of rows) {
    const d = await deleteTrigger(env, tenantId, r.trigger_id).catch((e) => ({ ok: false, error: e.message }));
    if (d.ok) { n++; done.add(r.trigger_id); }
    try { await env.RESIDENT?.get(env.RESIDENT.idFromName(`res:${tenantId}:${r.channel}`)).triggerGone(Number(r.workflow_id), why || (accountId ? "its account was disconnected" : "its app connections were removed")); } catch (e) { console.log("triggerGone", clip(e.message, 120)); }
  }
  try {
    const q = accountId ? `connected_account_ids=${encodeURIComponent(accountId)}` : `user_ids=${encodeURIComponent(uid(tenantId))}`;
    const d = await composioRequest(env, `/trigger_instances/active?${q}&show_disabled=true&limit=50`);
    for (const t of d.items || []) if (t.id && !done.has(t.id) && t.user_id === uid(tenantId)) { const x = await deleteTrigger(env, tenantId, t.id).catch(() => ({ ok: false })); if (x.ok) n++; }
  } catch (e) { console.log("composio triggers list", clip(e.message, 160)); }
  return n;
}

// ---------- the project webhook ----------
const enc = new TextEncoder();
const b64 = (buf) => { let s = ""; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b); return btoa(s); };
function sameString(a, b) { if (a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; }
export async function signBody(secret, id, ts, body) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(await crypto.subtle.sign("HMAC", key, enc.encode(`${id}.${ts}.${body}`)));
}
// h = a Headers (or { get }). → { ok: true, id } or { ok: false, why: "unsigned" | "stale" | "bad signature" }.
export async function verifySignature(secret, h, body, now = Date.now()) {
  const id = String(h.get("webhook-id") || ""), ts = String(h.get("webhook-timestamp") || ""), sig = String(h.get("webhook-signature") || "");
  if (!secret || !id || !ts || !sig || !body) return { ok: false, why: "unsigned" };
  if (!/^\d{9,11}$/.test(ts) || Math.abs(now - Number(ts) * 1000) > EVENT_TOLERANCE_S * 1000) return { ok: false, why: "stale" };
  const want = await signBody(secret, id, ts, body);
  const got = sig.split(" ").map((s) => s.split(",")).filter(([v, x]) => v === "v1" && x).map(([, x]) => x);
  return got.some((x) => sameString(x, want)) ? { ok: true, id } : { ok: false, why: "bad signature" };
}
// Which trigger instance an event is from, in any of Composio's payload versions (V3 metadata, V2 data, V1 top level).
export function eventOf(p = {}) {
  const meta = p.metadata || {}, data = p.data ?? p.payload ?? {};
  const triggerId = String(meta.trigger_id || (typeof data === "object" && data?.trigger_id) || p.trigger_id || (p.type === "composio.trigger.disabled" && /^ti_/.test(String(data?.id || "")) ? data.id : "") || "");
  return { type: String(p.type || "composio.trigger.message"), triggerId, slug: SLUG(meta.trigger_slug || p.trigger_name || p.type), userId: String(meta.user_id || data?.user_id || ""), data };
}
const J = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// ---------- one webhook, two servers (10-08) ----------
// Composio allows ONE webhook subscription per project, and dev and Live share one project. The subscription points at Live
// The configured app host receives the Composio webhook. Live verifies the signature, handles what's its own, and passes the rest to dev, untouched
// (the raw body and the three webhook-* headers, so dev checks the same signature with the same secret). Prod never depends on dev:
// the pass-on is fire-and-forget (ctx.waitUntil, a short timeout, never retried) and Live answers Composio before it happens.
// Who owns an event: user ids are "1hc:<tenant uuid>" on both servers (random UUIDs: no prefix tells them apart), so Live looks them up in
// its own D1: its trigger id in composio_triggers, or its user id in tenants. Anything else is not Live's: forwarded to dev (an event
// with neither a trigger id nor a user id is forwarded too, and logged). Only a server with COMPOSIO_WEBHOOK_FORWARD set (Live's
// wrangler.jsonc) ever forwards; dev has none. A forwarded event carries x-1hc-forwarded and is never forwarded again, and a server never
// forwards to its own host.
export const FORWARD_HEADER = "x-1hc-forwarded";
export const FORWARD_TIMEOUT_MS = 5000;
const SIGNED = ["webhook-id", "webhook-timestamp", "webhook-signature"];
// → the dev webhook URL to pass foreign events to, or "" (never: no setting, not https /composio/webhook, its own host, already forwarded).
export function forwardTarget(env, req) {
  const to = String(env?.COMPOSIO_WEBHOOK_FORWARD || "").trim(); if (!to || req.headers.get(FORWARD_HEADER)) return "";
  let u, me; try { u = new URL(to); me = new URL(req.url); } catch { return ""; }
  if (u.protocol !== "https:" || u.pathname !== "/composio/webhook" || u.search || u.host === me.host || (env.APP_HOST && u.host === env.APP_HOST)) return "";
  return u.href;
}
// → "own" (this server's trigger or workspace), "foreign" (a 1hc user this server doesn't have) or "unknown" (nothing to tell by).
export async function ownerOf(env, ev) {
  if (ev.triggerId && await mappingOf(env, ev.triggerId)) return "own";
  const m = /^1hc:([A-Za-z0-9-]{1,64})$/.exec(ev.userId || "");
  if (m) return (await env.DB.prepare("SELECT 1 AS x FROM tenants WHERE id=?").bind(m[1]).first()) ? "own" : "foreign";
  return "unknown";
}
// The raw body and the signature headers as they came, plus the forwarded mark. Once, no retry; a failure is only logged.
export async function forwardEvent(to, req, body) {
  const h = { "content-type": req.headers.get("content-type") || "application/json", [FORWARD_HEADER]: "1" };
  for (const k of SIGNED) h[k] = req.headers.get(k) || "";
  try {
    const r = await fetch(to, { method: "POST", headers: h, body, redirect: "manual", signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS) });
    if (!r.ok) console.log(`composio webhook: forward answered ${r.status}`);
    return r.status;
  } catch (e) { console.log("composio webhook: forward failed", clip(e.message || e, 120)); return 0; }
}

export async function composioWebhook(req, env, ctx) {
  if (req.method !== "POST") return J({ error: "POST only" }, 405);
  const secret = env.COMPOSIO_WEBHOOK_SECRET;
  if (!secret || !env.DB) { console.log("composio webhook: COMPOSIO_WEBHOOK_SECRET isn't set"); return J({ error: "not set up" }, 503); }
  let body;
  try { body = await boundedText(req, WEBHOOK_MAX_BYTES); }
  catch (e) { return J({ error: e instanceof BodyTooLargeError ? "too big" : "bad body" }, e instanceof BodyTooLargeError ? 413 : 400); }
  const v = await verifySignature(secret, req.headers, body);
  if (!v.ok) { console.log(`composio webhook refused: ${v.why}`); return J({ error: v.why }, 401); }
  // Replays: a webhook-id is accepted once (the 5-minute window above bounds how long one has to be remembered; a day is kept).
  const now = Date.now();
  const eventId = v.id.slice(0, 200);
  const fresh = Number((await env.DB.prepare("INSERT OR IGNORE INTO composio_webhook_seen (id, at) VALUES (?, ?)").bind(eventId, now).run()).meta?.changes || 0);
  if (!fresh) { console.log("composio webhook refused: replayed"); return J({ error: "replayed" }, 409); }
  if (Math.random() < 0.02) await env.DB.prepare("DELETE FROM composio_webhook_seen WHERE at<?").bind(now - 86400e3).run().catch(() => null);
  try {
    let p; try { p = JSON.parse(body); } catch { return J({ error: "bad json" }, 400); }
    const ev = eventOf(p);
    const to = forwardTarget(env, req);
    if (to) {
      const who = await ownerOf(env, ev);
      if (who !== "own") {
        if (who === "unknown") console.log(`composio webhook: owner unknown (${clip(ev.type, 60)}${ev.triggerId ? ` ${clip(ev.triggerId, 60)}` : ""}), forwarded to dev`);
        const f = forwardEvent(to, req, body);
        if (ctx?.waitUntil) ctx.waitUntil(f); else await f;
        return J({ ok: true, forwarded: who });
      }
    }
    if (!ev.triggerId || !/^composio\.trigger\.(message|disabled)$|^[a-z0-9_]+$/.test(ev.type)) return J({ ok: true, ignored: "not a trigger event" });
    const row = await mappingOf(env, ev.triggerId);
    if (!row) return J({ ok: true, ignored: "unknown trigger" });
    if (ev.userId && ev.userId !== uid(row.tenant_id)) { console.log("composio webhook: user mismatch for", ev.triggerId); return J({ ok: true, ignored: "user mismatch" }); }
    if (row.status === "delete_pending") { await deleteTrigger(env, row.tenant_id, row.trigger_id).catch(() => null); return J({ ok: true, ignored: "stopped" }); }
    const R = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${row.tenant_id}:${row.channel}`));
    if (ev.type === "composio.trigger.disabled") {
      await setMapping(env, row.trigger_id, "paused");
      const r = await R.triggerDisabled(Number(row.workflow_id), clip(ev.data?.reason || ev.data?.status_reason || "Composio turned the event off (its sign-in may have expired)", 200));
      if (r?.error) throw new Error(String(r.error));
      return J({ ok: true, ...r });
    }
    let data = ev.data; try { data = JSON.stringify(ev.data ?? {}); } catch { data = String(ev.data); }
    const r = await R.appEvent({ trigger_id: row.trigger_id, workflow_id: Number(row.workflow_id), event_id: eventId, slug: ev.slug || row.slug, body: data.length > EVENT_BODY_MAX ? data.slice(0, EVENT_BODY_MAX) + "…(cut)" : data, at: now });
    if (r?.error) throw new Error(String(r.error));
    if (r?.gone) await deleteTrigger(env, row.tenant_id, row.trigger_id).catch(() => null);   // its workflow (or channel) is gone: tidy up at Composio
    return J({ ok: true, ...(r || {}) });
  } catch (e) {
    // appEvent deduplicates by event_id in the Resident, so a retry is safe even
    // if it queued the event before a later failure. Keep only delivered IDs here.
    console.log("composio webhook: delivery failed", e?.name || "Error");
    await env.DB.prepare("DELETE FROM composio_webhook_seen WHERE id=?").bind(eventId).run().catch(() => null);
    return J({ error: "retry" }, 500);
  }
}
