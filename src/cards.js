// Hosted card page: a card reply or a permission request sent by text opens here, inside Messages (iMessage live app card), with no login.
//   GET  /c/<token>        HTML shell (OG tags: helper name + Say text / the question) loading /app-static/card.js + card.css (design-sandbox card.ts)
// kind "card" (a card reply):
//   GET  /c/<token>/data   { kind: "card", body, answered, picked, helper: { name, avatar }, sentAt }
//   POST /c/<token>/act    { text, loc? } → (loc: Share my location, a coarse { lat, lng }, saved first) the person's next message in the same texting conversation, exactly as if they had texted it
// kind "approval" (a Sentinel permission request, see Resident.egressDecision):
//   GET  /c/<token>/data   { kind: "approval", approval: { id, host, bytes?, keys?, status }, helper, channel: { name }, sentAt }
//                          status: pending | once | session | channel | deny | expired (live from the Resident, so app decisions show too)
//   POST /c/<token>/decide { decision: once|session|channel|deny, confirm? } → Resident.decideApproval, the same path as the app's /approve.
//                          "channel" (always, in this channel) needs confirm: true. Works once. A token only works on its own kind's route.
//   A request for a KIND of action (perms.js: Settings → Permissions is stricter than Standard) is the same card kind with
//   approval: { id, host: "", perm, name, what, status }; its decisions are once | always (saved for that kind) | deny.
//   A confirm card (confirm.js: a send, delete, share… shown with its exact content) is approval: { id, host: "", perm: "confirm",
//   ask, action: { title, app, lines: [[label, value]], body?, note? } }; decisions once (= Confirm) | deny (= Cancel); status
//   pending | once | deny | expired (an undecided card expires after 30 minutes).
// kind "plan" (a propose_plan card proposed in a texting turn, plans.js; approval_id holds the plan's id):
//   GET  /c/<token>/data   { kind: "plan", plan: PlanView, status, helper, channel: { name }, sentAt }   (live from the Resident)
//   POST /c/<token>/decide { decision: approve|deny|talk, items?, answers? } → Resident.planDecide (the same path as the app's /plans/<id>/approve),
//                          talk = the person's "Let's talk about the plan", exactly as if they had texted it.
// kind "interview" (an interview card from a texting turn, interview-chat.js):
//   GET  /c/<token>/data   { kind: "interview", interview: view, helper, sentAt }   (live from the Resident: answers saved as they go)
//   POST /c/<token>/iv     { op: answer|skip|goto|send, … } → { interview[, message] }. send posts the answers as the person's next text.
// token = HMAC-SHA256 (key derived from VAULT_KEY) over tenant + channel + message id, base64url, 32 chars. It is only a lookup
// key: nothing about the person is in it. Bad or unknown token → 404. One action per card; act attempts are rate-limited.
import { cleanFix, saveLocation } from "./location.js";   // a card's Share my location button (texting)
import { cardsTree, firstSay } from "./genui.js";
import { ivCardRoute } from "./interview-chat.js";
import { permQuestion } from "./perms.js";
import { helperName } from "./helper-name.js";
import { boundedText, BodyTooLargeError } from "./bounded-body.js";

const te = new TextEncoder();
const TOKEN = /^[A-Za-z0-9_-]{32}$/;
const MAX_ACTS = 5, ACT_WINDOW = 60e3;   // at most 5 act attempts per card per minute (one can succeed)
let _key = null, _keyFor = null;
async function tokenKey(env) {
  if (_key && _keyFor === env.VAULT_KEY) return _key;
  if (!env.VAULT_KEY) throw new Error("VAULT_KEY missing");
  const raw = Uint8Array.from(atob(env.VAULT_KEY), (c) => c.charCodeAt(0));
  const base = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const derived = await crypto.subtle.sign("HMAC", base, te.encode("1hc card token v1"));   // never reuse the vault key itself
  _key = await crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); _keyFor = env.VAULT_KEY;
  return _key;
}
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export async function cardToken(env, tenant, channel, msgId) {
  return b64url(await crypto.subtle.sign("HMAC", await tokenKey(env), te.encode(`${tenant}\n${channel}\n${msgId}`))).slice(0, 32);
}
export const cardUrl = (env, token) => `https://${env.APP_HOST || env.GATEWAY_HOST}/c/${token}`;

// Save a card reply and return where it lives. body = the card code only (prose said before it is sent as its own text).
export async function saveCard(env, { tenant, channel, msgId, body }) {
  const token = await cardToken(env, tenant, channel, msgId), say = firstSay(cardsTree(body).root) || "";
  await env.DB.prepare("INSERT OR REPLACE INTO cards (token,tenant_id,channel,msg_id,body,say,sent_at) VALUES (?,?,?,?,?,?,?)")
    .bind(token, tenant, channel, String(msgId), String(body), say.slice(0, 2000), Date.now()).run();
  return { token, url: cardUrl(env, token), say };
}
// A permission request's card. Deterministic token per approval (tenant + channel + "approval:<id>:<at>"); the unique index makes
// a second call for the same approval a no-op (fresh: false), so one request is texted once.
export async function saveApprovalCard(env, { tenant, channel, approval, channelName }) {
  const msgId = `approval:${approval.id}:${approval.at}`, token = await cardToken(env, tenant, channel, msgId);
  const r = await env.DB.prepare("INSERT OR IGNORE INTO cards (token,tenant_id,channel,msg_id,body,say,sent_at,kind,approval_id,channel_name) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .bind(token, tenant, channel, msgId, "", approval.perm === "confirm" ? String(approval.what || "Confirm this?") : approval.perm ? permQuestion(approval.perm, approval.what) : approvalQuestion(approval.host), Date.now(), "approval", approval.id, channelName || channel).run();
  return { token, url: cardUrl(env, token), fresh: !!r.meta?.changes };
}
// A plan card (plans.js). Deterministic token per plan (tenant + channel + "plan:<id>:<created>"): a second call is a no-op (fresh: false).
export async function savePlanCard(env, { tenant, channel, plan, channelName }) {
  const msgId = `plan:${plan.id}:${plan.created}`, token = await cardToken(env, tenant, channel, msgId);
  const r = await env.DB.prepare("INSERT OR IGNORE INTO cards (token,tenant_id,channel,msg_id,body,say,sent_at,kind,approval_id,channel_name) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .bind(token, tenant, channel, msgId, "", PLAN_QUESTION, Date.now(), "plan", plan.id, channelName || channel).run();
  return { token, url: cardUrl(env, token), fresh: !!r.meta?.changes };
}
export const PLAN_QUESTION = "Start these for you?";
export const planLayout = (n, helperName) => ({ caption: PLAN_QUESTION, subcaption: String(helperName || "Your helper").slice(0, 60), summary: `${String(helperName || "Your helper").slice(0, 40)}'s plan: ${n} ${n === 1 ? "thing" : "things"} to start` });
export const approvalQuestion = (host) => `OK to send this to ${host}?`;
// A confirm card (confirm.js): the question is the action itself ("Send this email to sam@x.com?").
export const confirmLayout = (title, helperName) => ({ caption: String(title || "Confirm this?").slice(0, 120), subcaption: String(helperName || "Your helper").slice(0, 60), summary: String(title || "Confirm this?").slice(0, 120) });
// A permission request for a kind of action (perms.js): "OK to read your email?".
export const permLayout = (kind, helperName, what = "") => ({ caption: permQuestion(kind, what), subcaption: String(helperName || "Your helper").slice(0, 60), summary: permQuestion(kind, what) });
export const approvalLayout = (host, helperName) => ({ caption: approvalQuestion(host), subcaption: String(helperName || "Your helper").slice(0, 60), summary: approvalQuestion(host) });
// iMessage card layout from the reply: caption = the first sentence of its Say text, subcaption = the helper's name.
export function cardLayout(say, helperName) {
  const s = String(say || "").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\s+/g, " ").trim();
  let first = (s.match(/^.+?[.!?](?=\s|$)/)?.[0] || s).trim(); if (first.length > 120) first = first.slice(0, 117).replace(/\s+\S*$/, "") + "…";
  const caption = first || "Tap to open";
  return { caption, subcaption: String(helperName || "Your helper").slice(0, 60), summary: caption };
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const NOSTORE = { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", ...NOSTORE } });
const notFound = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain", ...NOSTORE } });

async function load(env, token) {
  if (!TOKEN.test(token)) return null;
  const c = await env.DB.prepare("SELECT * FROM cards WHERE token=?").bind(token).first();
  if (!c || (await cardToken(env, c.tenant_id, c.channel, c.msg_id)) !== token) return null;   // the row must match its own token
  const t = await env.DB.prepare("SELECT id, helper_name, helper_avatar FROM tenants WHERE id=?").bind(c.tenant_id).first();
  return t ? { c, t } : null;
}
const helperOf = (t) => ({ name: helperName(t), avatar: Number(t.helper_avatar || 8) });

// Returns a Response for /c/… paths, or null for anything else.
export async function cardRoute(req, env, ctx, url) {
  const m = url.pathname.match(/^\/c\/([^/]+)(\/data|\/act|\/decide|\/iv)?\/?$/); if (!m) return null;
  const [, token, sub] = m;
  if (!sub && req.method !== "GET" && req.method !== "HEAD") return notFound();
  if (sub === "/data" && req.method !== "GET") return notFound();
  if ((sub === "/act" || sub === "/decide" || sub === "/iv") && req.method !== "POST") return notFound();
  const got = await load(env, token); if (!got) return notFound();
  const { c, t } = got, helper = helperOf(t), kind = c.kind || "card";
  if ((sub === "/act" && kind !== "card") || (sub === "/decide" && kind !== "approval" && kind !== "plan") || (sub === "/iv" && kind !== "interview")) return notFound();   // a token works only on its own kind
  let input = null;
  if (sub === "/act" || sub === "/decide" || sub === "/iv") {
    let raw;
    try { raw = await boundedText(req, 65536); }
    catch (e) { return json({ error: e instanceof BodyTooLargeError ? "too_large" : "bad_request" }, e instanceof BodyTooLargeError ? 413 : 400); }
    try { input = JSON.parse(raw); } catch {}
  }
  // Read-only (a failed payment, or the plan ended: pastdue.js): a tap that would set the helper working is refused; "Don't allow" works.
  if ((sub === "/act" || sub === "/decide" || sub === "/iv") && await readOnly(env, c.tenant_id)) {
    const d = String(input?.decision || "");
    if (!(sub === "/decide" && d === "deny")) return json({ error: "payment_required", message: "1Helm is read-only until the payment is fixed. Open the app to fix it." }, 402);
  }
  if (kind === "approval" && sub) return approvalRoute(env, sub, c, helper, token, input);
  if (kind === "plan" && sub) return planRoute(env, ctx, sub, c, helper, token, input);
  if (kind === "interview" && sub) return ivCardRoute(env, sub, c, helper, () => limited(env, c, token, Date.now()), input);
  if (!sub) {
    const desc = cardLayout(c.say, helper.name).caption, origin = `https://${url.host}`;
    return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(helper.name)}</title><meta property="og:title" content="${esc(helper.name)}"><meta property="og:description" content="${esc(c.say || desc)}"><meta property="og:site_name" content="1Helm">
<meta property="og:image" content="${origin}/av/${helper.avatar}.png"><meta name="description" content="${esc(c.say || desc)}"><meta name="robots" content="noindex">
<link rel="stylesheet" href="/app-static/card.css"></head><body><script type="module" src="/app-static/card.js"></script></body></html>`,
      { headers: { "content-type": "text/html; charset=utf-8", ...NOSTORE } });
  }
  if (sub === "/data") return json({ kind: "card", body: c.body, answered: !!c.answered, picked: c.picked ?? null, helper, sentAt: Number(c.sent_at) });
  // POST /act
  const now = Date.now();
  if (await limited(env, c, token, now)) return json({ error: "slow_down" }, 429);
  const b = input;
  const text = typeof b?.text === "string" ? b.text.replace(/\r\n/g, "\n").trim() : "";
  if (!text || text.length > 4000) return json({ error: "text required" }, 400);
  if (c.answered) return json({ error: "already_answered", picked: c.picked }, 409);
  const tx = await env.DB.prepare("SELECT status FROM texting WHERE tenant_id=?").bind(c.tenant_id).first();
  if (!tx || tx.status !== "connected") return json({ error: "texting_off" }, 409);
  // One action per card: only the first act flips answered.
  const w = await env.DB.prepare("UPDATE cards SET answered=1, picked=?, answered_at=? WHERE token=? AND answered=0").bind(text, now, token).run();
  if (!w.meta?.changes) { const again = await env.DB.prepare("SELECT picked FROM cards WHERE token=?").bind(token).first(); return json({ error: "already_answered", picked: again?.picked ?? null }, 409); }
  // "Share my location" tapped on the card page (Button action share_location): its coarse fix is saved first, so the turn has it.
  if (cleanFix(b?.loc)) await saveLocation(env, c.tenant_id, b.loc).catch((e) => console.log("card location", e.message));
  // Same path as a verified inbound text (textingWebhook): General's resident, its "Texts" task; the reply goes back by text.
  const R = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${c.tenant_id}:${c.channel}`));
  const run = R.textTurn(c.tenant_id, c.channel, "1", text).catch((e) => console.log("card act turn", e.message));
  ctx?.waitUntil ? ctx.waitUntil(run) : await run;
  return json({ ok: true });
}

async function readOnly(env, tid) {
  try { const r = await env.DB.prepare("SELECT status FROM tenants WHERE id=?").bind(tid).first(); return !!r && r.status != null && r.status !== "active"; } catch { return false; }
}
// Rate limit shared by /act and /decide: at most MAX_ACTS attempts per card per minute.
async function limited(env, c, token, now) {
  if (Number(c.acts) >= MAX_ACTS && now - Number(c.last_act_at || 0) < ACT_WINDOW) return true;
  await env.DB.prepare("UPDATE cards SET acts=CASE WHEN ?-COALESCE(last_act_at,0)>=? THEN 1 ELSE acts+1 END, last_act_at=? WHERE token=?").bind(now, ACT_WINDOW, now, token).run();
  return false;
}
const DECISIONS = ["once", "session", "channel", "always", "deny"];   // always = a kind of action (perms.js); the Resident checks which fit
async function approvalRoute(env, sub, c, helper, token, b) {
  const R = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${c.tenant_id}:${c.channel}`));
  if (sub === "/data") {
    const a = await R.approvalCardData(Number(c.approval_id));
    return json({ kind: "approval", approval: { id: Number(c.approval_id), ...(a.approval || {}), status: a.status }, helper, channel: { name: c.channel_name || c.channel }, sentAt: Number(c.sent_at) });
  }
  // POST /decide
  if (await limited(env, c, token, Date.now())) return json({ error: "slow_down" }, 429);
  const decision = String(b?.decision || "");
  if (!DECISIONS.includes(decision)) return json({ error: "decision must be once, session, channel, always or deny" }, 400);
  if (decision === "channel" && b?.confirm !== true) return json({ error: "confirmation_required" }, 400);
  const id = Number(c.approval_id), cur = await R.approvalCardData(id);
  if (cur.status === "expired") return json({ error: "expired", status: "expired" }, 410);
  if (cur.status !== "pending") return json({ ok: true, status: cur.status, already: true });
  const r = await R.decideApproval(id, decision);          // the same path as the app's POST /api/res/<ch>/approve
  if (r?.error) { const now = await R.approvalCardData(id); return now.status !== "pending" ? json({ ok: true, status: now.status, already: true }) : json({ error: r.error }, 409); }
  return json({ ok: true, status: decision });
}

// A plan card: the person ticks items and taps Approve / Deny / Let's talk inside Messages. Same Resident path as the app.
const PLAN_DECISIONS = ["approve", "deny", "talk"];
async function planRoute(env, ctx, sub, c, helper, token, b) {
  const R = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${c.tenant_id}:${c.channel}`)), id = Number(c.approval_id);
  if (sub === "/data") { const d = await R.planCardData(id); return json({ kind: "plan", status: d.status, plan: d.plan || null, helper, channel: { name: c.channel_name || c.channel }, sentAt: Number(c.sent_at) }); }
  if (await limited(env, c, token, Date.now())) return json({ error: "slow_down" }, 429);
  const decision = String(b?.decision || "");
  if (!PLAN_DECISIONS.includes(decision)) return json({ error: "decision must be approve, deny or talk" }, 400);
  const cur = await R.planCardData(id);
  if (!cur.plan) return json({ error: "expired", status: "expired" }, 410);
  if (cur.status !== "pending") return json({ ok: true, status: cur.status, plan: cur.plan, already: true });
  if (decision === "talk") {
    const tx = await env.DB.prepare("SELECT status FROM texting WHERE tenant_id=?").bind(c.tenant_id).first();
    if (!tx || tx.status !== "connected") return json({ error: "texting_off" }, 409);
    const run = R.textTurn(c.tenant_id, c.channel, "1", "Let's talk about the plan").catch((e) => console.log("plan card talk", e.message));
    ctx?.waitUntil ? ctx.waitUntil(run) : await run;
    return json({ ok: true, status: "pending", talked: true, plan: cur.plan });
  }
  const items = decision === "approve" && Array.isArray(b?.items) ? b.items.map(Number).filter(Number.isInteger).slice(0, 20) : null;
  const answers = decision === "approve" && Array.isArray(b?.answers) ? b.answers.slice(0, 8) : null;   // "Questions first" (decidePlan cleans them)
  const r = await R.planDecide(id, decision, items, answers);
  if (r?.error) return r.plan && r.plan.status !== "pending" ? json({ ok: true, status: r.plan.status, plan: r.plan, already: true }) : json({ error: r.error }, r.status || 409);
  return json({ ok: true, status: r.plan.status, plan: r.plan });
}
