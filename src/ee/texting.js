// "Text with your helper" on Cloud: setup state machine, inbound webhook, and delivery for text_person.
// Each workspace connects its OWN free Photon project (BYOP). Order (Captain, 10-01): number → Photon sign-up → "Text <code> to <number>".
import * as P from "./photon.js";
import { sealSecret, openSecret } from "../sentinel.js";
import { cardsToText } from "../genui.js";
import { PAUSED_TEXT, INACTIVE_TEXT } from "./readonly.js";
import { boundedText, BodyTooLargeError } from "../bounded-body.js";

const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const now = () => Date.now();
const hookUrl = (env, id) => `https://${env.GATEWAY_HOST}/hooks/photon/${id}`;
const CODE_TTL = 30 * 60e3;
// Android (Captain 10-06: "I have an Android, let's test"). Photon's Free plan includes "RCS and SMS fallback" (photon.codes/pricing;
// docs: best-practices/imessage-deliverability "SMS and RCS fallback"), so an Android phone texts the same number and gets plain
// text messages back. We learn the service per phone (P.phoneService) and keep sends to what SMS/RCS can carry: no app cards (the
// card's text form + its link), no tapbacks, no message effects, no typing. Attachments (the welcome vCard) go as MMS.
// TEXTING_ANDROID = "off" (env) turns Android away instead: the page says "iPhone only" up front and setup stops for a number
// that isn't on iMessage. Default: on.
export const androidOn = (env) => String(env?.TEXTING_ANDROID || "").toLowerCase() !== "off";
export const IPHONE_ONLY = "Texting works with iPhone (iMessage) right now, and this number isn't on iMessage. You can still talk to your helper in the 1Helm app anytime. On an iPhone? Check that iMessage is on (Settings → Messages), then try again.";
// Unknown (never checked, or both lookups failed) counts as iMessage: the app card falls back to text by itself on an error.
export const isIMessage = (r) => !r?.service || r.service === "imessage";
const SERVICE_RECHECK = 24 * 3600e3, SERVICE_RETRY = 10 * 60e3;

async function row(env, tenantId) { return env.DB.prepare("SELECT * FROM texting WHERE tenant_id=?").bind(tenantId).first(); }
async function patch(env, tenantId, f) {
  const k = Object.keys(f); if (!k.length) return;
  await env.DB.prepare(`UPDATE texting SET ${k.map((x) => `${x}=?`).join(",")},updated_at=? WHERE tenant_id=?`).bind(...k.map((x) => f[x]), now(), tenantId).run();
}
function view(r) {
  if (!r) return { status: "new" };
  return { status: r.status, phone: r.phone, assigned: r.assigned || null, code: r.status === "awaiting_code" ? r.code : null,
    verify_url: r.status === "signup" ? r.verify_url : null, user_code: r.status === "signup" ? r.user_code : null, error: r.error || null,
    service: r.service || null };
}
// android: the setup page's up-front note (iPhone + Android, or iPhone only).
export async function textingStatus(env, tenantId) { return { ...view(await row(env, tenantId)), android: androidOn(env) }; }

// Look up and remember which service the person's phone is on. Best effort, never throws; a no-op on a database without the
// service columns (migrations_024_texting_service.sql). Returns the service (or the old one when the lookup told us nothing).
export async function refreshService(env, tenantId, { tok, r, timeoutMs = 6000 } = {}) {
  r = r || await row(env, tenantId);
  if (!r || !("service_at" in r) || !r.project_id) return r?.service || null;
  try {
    const got = await P.phoneService(tok || await token(env, r), r.phone, { timeoutMs });
    // A chat-based answer is the truth; an Apple "no" never overrides a chat that already said iMessage/SMS/RCS.
    const svc = got.service && !(got.service === "not_imessage" && r.service && r.service !== "not_imessage") ? got.service : r.service || null;
    if (svc !== (r.service || null)) console.log(`texting service ${r.service || "unknown"} → ${svc || "unknown"} (via ${got.via || "none"})`);
    await patch(env, tenantId, { service: svc, service_at: now() });
    return svc;
  } catch (e) { console.log("texting service check", String(e.message || e).slice(0, 160)); return r.service || null; }
}
async function saveService(env, tenantId, r, svc, via) {
  if (!svc || !("service_at" in r) || svc === r.service) return;
  console.log(`texting service ${r.service || "unknown"} → ${svc} (via ${via})`);
  try { await patch(env, tenantId, { service: svc, service_at: now() }); } catch {}
}

// Step 1 → 2. If this workspace already has its Photon project (re-setup, new number), skip the sign-up.
export async function textingStart(env, t, rawPhone) {
  const { phone, error } = P.checkPhone(rawPhone);
  if (!phone) return { error };
  let r = await row(env, t.id);
  if (!r) {
    await env.DB.prepare("INSERT INTO texting (tenant_id,hook_id,phone,status,updated_at) VALUES (?,?,?,?,?)").bind(t.id, crypto.randomUUID().replace(/-/g, ""), phone, "signup", now()).run();
    r = await row(env, t.id);
  } else await patch(env, t.id, { phone, error: null, code: null, ...("service_at" in r ? { service: null, service_at: null } : {}) });
  if (r.project_id && r.project_secret_sealed) return finishSetup(env, t.id);
  const d = await P.deviceStart();
  await patch(env, t.id, { status: "signup", device_code_sealed: await sealSecret(env, d.device_code), user_code: d.user_code, verify_url: d.url, device_expires: d.expires_at });
  return view(await row(env, t.id));
}

// Polled by the setup page. During sign-up it checks Photon once; on approval it provisions everything.
export async function textingPoll(env, t) {
  const r = await row(env, t.id); if (!r) return { status: "new" };
  if (r.status !== "signup") return view(r);
  if (now() > Number(r.device_expires || 0)) { await patch(env, t.id, { status: "new", error: "That sign-in timed out. Tap Confirm to try again." }); return view(await row(env, t.id)); }
  const p = await P.devicePoll(await openSecret(env, r.device_code_sealed));
  if (p.pending) return view(r);
  if (p.error) { await patch(env, t.id, { status: "new", error: "Photon didn't finish the sign-in. Tap Confirm to try again." }); return view(await row(env, t.id)); }
  try {
    // One Photon project PER 1Helm workspace. Reusing one project would rotate its secret and break the other workspace
    // (seen 10-01: two workspaces signed in with the same Photon account).
    const proj = await P.provisionProject(p.token, `1Helm · ${t.slug}`);
    await patch(env, t.id, { project_id: proj.project_id, project_secret_sealed: await sealSecret(env, proj.project_secret), device_code_sealed: null });
  } catch (e) { console.log("texting provision", e.message); await patch(env, t.id, { status: "new", error: "Photon signed you in, but we couldn't finish setting up texting. Try again in a minute." }); return view(await row(env, t.id)); }
  return finishSetup(env, t.id);
}

async function creds(env, r) { return { pid: r.project_id, sec: await openSecret(env, r.project_secret_sealed) }; }

// Register the person's phone (Photon hands back the number they'll text), point Photon's webhook at us, issue a code.
async function finishSetup(env, tenantId) {
  const r = await row(env, tenantId), { pid, sec } = await creds(env, r);
  try {
    const u = await P.registerPhone(pid, sec, r.phone);
    const w = await P.registerWebhook(pid, sec, hookUrl(env, r.hook_id));
    await patch(env, tenantId, { assigned: u.assigned, webhook_id: w.webhook_id, webhook_secret_sealed: await sealSecret(env, w.signing_secret), code: P.newCode(), code_expires: now() + CODE_TTL, status: "awaiting_code", error: null, inbound_count: 0 });
  } catch (e) {
    console.log("texting finish", e.message);
    await patch(env, tenantId, { status: "new", error: e.message === P.US_ONLY ? P.US_ONLY : "We couldn't add that number to texting. Check it and try again." });
    return view(await row(env, tenantId));
  }
  // iPhone or not, before they text: the code step tells an Android phone what to expect (or, with Android off, stops here).
  const svc = await refreshService(env, tenantId, { timeoutMs: 4000 });
  if (svc && !isIMessage({ service: svc }) && !androidOn(env)) await patch(env, tenantId, { status: "new", code: null, error: IPHONE_ONLY });
  return view(await row(env, tenantId));
}

export async function textingNewCode(env, t) {
  const r = await row(env, t.id); if (!r || r.status !== "awaiting_code") return view(r);
  await patch(env, t.id, { code: P.newCode(), code_expires: now() + CODE_TTL, error: null });
  return view(await row(env, t.id));
}
export async function textingOff(env, t) {
  const r = await row(env, t.id); if (!r) return { status: "new" };
  try { if (r.webhook_id && r.project_id) { const { pid, sec } = await creds(env, r); await fetch(`https://spectrum.photon.codes/projects/${pid}/webhooks/${r.webhook_id}`, { method: "DELETE", headers: { authorization: "Basic " + btoa(`${pid}:${sec}`) } }); } } catch {}
  await patch(env, t.id, { status: "off", code: null, webhook_id: null, webhook_secret_sealed: null, error: null });
  return view(await row(env, t.id));
}

// ---- outbound (also used by the resident's text_person tool) ----
const tokCache = new Map();
async function token(env, r) {
  const { pid, sec } = await creds(env, r);
  return P.imsgToken(pid, sec, { get: () => tokCache.get(pid), set: (v) => tokCache.set(pid, v) });
}
const sleep = (ms) => new Promise((z) => setTimeout(z, ms));
async function withRetry(fn) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) { if (i >= 2 || !P.isNewContactLimit(e)) throw e; await sleep(4000 * (i + 1)); }
  }
}
export async function deliverText(env, tenantId, message, opts = {}) {
  const r = await row(env, tenantId);
  if (!r || r.status !== "connected") return { ok: false, reason: "not_connected" };
  const tok = await token(env, r);
  const o = isIMessage(r) ? opts : { ...opts, effect: undefined };                           // SMS/RCS: no message effects
  const id = await withRetry(() => P.sendText(tok, r.phone, cardsToText(message), o));      // never send card code to a phone
  return { ok: true, id };
}
// A card reply by text: an iMessage live app card that opens the hosted card page (/c/<token>). If the card can't be sent
// (new-contact limit / "Target not allowed", or any error), the same reply goes as plain text followed by the link, which
// iMessage unfurls as a preview on every plan. Returns { ok, via: "app" | "text", id }.
// fallback: the whole text to send instead of "<text form>\n\n<link>" (e.g. a permission request's own wording).
export async function deliverCard(env, tenantId, { url, layout, text, fallback }) {
  const r = await row(env, tenantId);
  if (!r || r.status !== "connected") return { ok: false, reason: "not_connected" };
  const tok = await token(env, r);
  if (isIMessage(r)) {
    try { return { ok: true, via: "app", id: await P.sendApp(tok, r.phone, url, { layout, live: true }) }; }
    catch (e) { console.log("texting app card failed, sending text", P.isNewContactLimit(e) ? "new-contact limit" : String(e.message || e).slice(0, 160)); }
  } else console.log(`texting card as text (${r.service})`);   // Android (SMS/RCS): no app cards there, so the text form + link
  const id = await withRetry(() => P.sendText(tok, r.phone, fallback || `${cardsToText(text || "").trim()}\n\n${url}`.trim()));
  return { ok: true, via: "text", id };
}
// A tapback on one of the person's texts (messageId = its webhook message.id). One try, no retry and no fallback text:
// the caller logs a failure and nothing else happens. Returns { ok, id } | { ok: false, reason }.
export async function deliverReaction(env, tenantId, messageId, kind) {
  const r = await row(env, tenantId);
  if (!r || r.status !== "connected") return { ok: false, reason: "not_connected" };
  if (!isIMessage(r)) return { ok: false, reason: "not_imessage" };                         // no tapbacks over SMS/RCS
  return { ok: true, id: await P.sendReaction(await token(env, r), r.phone, messageId, kind) };
}
export async function textTyping(env, tenantId, on = true) {
  const r = await row(env, tenantId); if (!r || r.status !== "connected" || !isIMessage(r)) return;
  try { await P.setTyping(await token(env, r), r.phone, on); } catch {}
}

// The first exchange: confetti hello, the helper's contact card (saves it, so no "Report Junk"), and a question
// so they text back (Apple trusts a conversation after 3 texts from the person; until then we may send ≤10).
// Android (SMS/RCS, learned from their code text's chat): no confetti; the vCard still goes (as MMS).
async function welcome(env, t, r) {
  const helper = t.helper_name || "your helper", first = t.first_name ? ` ${t.first_name}` : "";
  const tok = await token(env, r);
  const svc = await refreshService(env, t.id, { tok, r });
  const im = isIMessage({ service: svc });
  console.log(`texting connected (service ${svc || "unknown"})`);
  await withRetry(() => P.sendText(tok, r.phone, `Hey${first}, it's ${helper}! 🎉 We're connected. Text me anytime, like you'd text a friend.`, im ? { effect: "com.apple.messages.effect.CKConfettiEffect" } : {}));
  await sleep(1500);
  try { await withRetry(() => P.sendContact(tok, r.phone, P.vcard({ name: helper, phone: r.assigned, url: `https://${env.GATEWAY_HOST}/w/${t.slug}/app` }), `${helper.replace(/[^A-Za-z0-9]/g, "") || "Helper"}.vcf`)); } catch (e) { console.log("texting contact", e.message); }
  await sleep(1500);
  await withRetry(() => P.sendText(tok, r.phone, im ? `Tap my card above and Save, so my texts never land in spam. What's one thing I can take off your plate today?`
    : `Save my contact card above, so my texts never land in spam. What's one thing I can take off your plate today?`));
}

// ---- inbound: Photon's signed webhook for one workspace ----
export async function textingWebhook(req, env, ctx, hookId) {
  let raw;
  try { raw = await boundedText(req, 1_000_000); }
  catch (e) { return new Response(e instanceof BodyTooLargeError ? "too large" : "bad body", { status: e instanceof BodyTooLargeError ? 413 : 400 }); }
  const r = await env.DB.prepare("SELECT * FROM texting WHERE hook_id=?").bind(hookId).first();
  if (!r || !r.webhook_secret_sealed) return new Response("gone", { status: 410 });
  const ok = await P.verifyWebhook(await openSecret(env, r.webhook_secret_sealed), req.headers.get("x-spectrum-timestamp"), req.headers.get("x-spectrum-signature"), raw);
  if (!ok) return new Response("bad signature", { status: 401 });
  let ev; try { ev = JSON.parse(raw); } catch { return new Response("ok"); }
  const m = ev?.message; if (ev?.event !== "messages" || !m?.id) return new Response("ok");
  // Dedupe per workspace: one Photon project can serve several 1Helm workspaces (e.g. the same person's two phones), and
  // Photon delivers the SAME message.id to every webhook on the project.
  const seenId = `${r.tenant_id}:${m.id}`, pendingAt = -now();
  let fresh = await env.DB.prepare("INSERT OR IGNORE INTO texting_seen (msg_id,tenant_id,at) VALUES (?,?,?)").bind(seenId, r.tenant_id, pendingAt).run();
  if (!fresh.meta?.changes) {
    const seen = await env.DB.prepare("SELECT at FROM texting_seen WHERE msg_id=?").bind(seenId).first();
    if (seen?.at >= 0) return new Response("ok");                               // already admitted
    // A Worker can disappear between reserving and admitting a text. Let a later delivery reclaim that reservation.
    if (seen && -Number(seen.at) < now() - 120_000) {
      await env.DB.prepare("DELETE FROM texting_seen WHERE msg_id=? AND at=?").bind(seenId, seen.at).run();
      fresh = await env.DB.prepare("INSERT OR IGNORE INTO texting_seen (msg_id,tenant_id,at) VALUES (?,?,?)").bind(seenId, r.tenant_id, pendingAt).run();
    }
    if (!fresh.meta?.changes) return new Response("retry", { status: 503 });   // another delivery is still being admitted
  }
  const accepted = async () => {
    await env.DB.prepare("UPDATE texting_seen SET at=? WHERE msg_id=? AND at=?").bind(now(), seenId, pendingAt).run();
    return new Response("ok");
  };
  const from = P.normPhone(m.sender?.id || ""), c = m.content || {};
  if (from !== r.phone) { console.log("texting: ignored sender"); return accepted(); }   // only the person's own phone
  await env.DB.prepare("UPDATE texting SET inbound_count=inbound_count+1,last_inbound_id=?,updated_at=? WHERE tenant_id=?").bind(m.id, now(), r.tenant_id).run();
  const t = await env.DB.prepare("SELECT * FROM tenants WHERE id=?").bind(r.tenant_id).first();
  if (!t) return accepted();
  const said = P.senderService(m.sender);                                       // only if Photon ever includes it
  if (r.status === "awaiting_code") {
    const text = String(c.text || "");
    console.log(`texting code text: type=${c.type} platform=${m.platform || "?"} sender.service=${m.sender?.service || "none"} match=${text.includes(r.code)}`);
    if (c.type !== "text" || !text.includes(r.code) || now() > Number(r.code_expires || 0)) return accepted();   // wrong/old code: silence
    await patch(env, t.id, { status: "connected", code: null, connected_at: now() });
    if (said) await saveService(env, t.id, r, said, "webhook");
    ctx.waitUntil(welcome(env, t, { ...r, status: "connected", service: said || r.service }).catch((e) => console.log("texting welcome", e.message)));
    return accepted();
  }
  if (r.status !== "connected") return accepted();
  // Phones change (iPhone ↔ Android): the webhook's word if it has one, else a fresh lookup once a day (every 10 min while unknown).
  if (said) await saveService(env, t.id, r, said, "webhook");
  else if ("service_at" in r && now() - Number(r.service_at || 0) > (r.service ? SERVICE_RECHECK : SERVICE_RETRY)) ctx.waitUntil(refreshService(env, t.id, { r }));
  if (c.type === "reaction" || c.type === "read" || c.type === "typing") return accepted();
  const { text, files } = inboundParts(c);
  if (!text && !files.length) return accepted();
  // Read-only (a failed payment, or the plan ended): a fixed reply, never a model call, and nothing they sent is stored (pastdue.js).
  if (t.status !== "active") { if (t.status === "past_due" || t.status === "suspended") ctx.waitUntil(pausedReply(env, t).catch((e) => console.log("texting paused reply", e.message))); return accepted(); }
  // Texts land in General, in one "Texts" task, and run on the resident like any message (the resident replies by text).
  // Photos, videos and documents are downloaded there and attached exactly like an app upload; a caption or more photos sent
  // a moment later join the same turn (Resident.textInbound).
  const R = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${t.id}:main`));
  // m.id (spc-msg-…) is kept with the turn: a helper tapback (react tool) lands on this exact text.
  try {
    const admitted = await R.textInbound(t.id, "main", "1", { id: m.id, text, files });
    if (admitted?.ok !== true) throw new Error("Resident did not admit text");
  } catch (e) {
    await env.DB.prepare("DELETE FROM texting_seen WHERE msg_id=? AND at=?").bind(seenId, pendingAt).run().catch((x) => console.log("texting retry release", x.message));
    console.log("texting turn", e.message);
    return new Response("retry", { status: 503 });
  }
  return accepted();
}
// The fixed reply while read-only. A photo and its caption arrive as two messages a moment apart: one reply per minute is enough.
const pausedAt = new Map();
export async function pausedReply(env, t, at = Date.now()) {
  if (at - (pausedAt.get(t.id) || 0) < 60e3) return { ok: false, reason: "just replied" };
  pausedAt.set(t.id, at);
  const hold = t.status === "past_due" || !!(await env.DB.prepare("SELECT 1 x FROM payment_holds WHERE tenant_id=? AND state='unpaid'").bind(t.id).first().catch(() => null));
  return deliverText(env, t.id, (hold ? PAUSED_TEXT : INACTIVE_TEXT)(appLink(env, t.slug)));
}
// One webhook message → { text, files: [{ guid, name, mime, size }] }. An album arrives as one "group" message with an item
// per photo. Content Photon documents but we can't open becomes a note for the helper.
export function inboundParts(c) {
  const items = c?.type === "group" && Array.isArray(c.items) ? c.items.map((i) => i?.content || {}) : [c || {}];
  const texts = [], files = [];
  for (const x of items) {
    if (x.type === "text") texts.push(String(x.text || "").trim());
    else if (x.type === "attachment") files.push({ guid: String(x.id || ""), name: String(x.name || ""), mime: String(x.mimeType || ""), size: x.size == null ? null : Number(x.size) });
    else if (x.type === "richlink" && x.url) texts.push(String(x.url));
    else if (x.type === "poll_vote" || x.type === "pollVote") texts.push(`(voted in a poll: ${JSON.stringify(x).slice(0, 300)})`);
    else if (x.type) texts.push(`(sent a ${x.type} by text; you can't open it yet, so ask them to describe it or send it in the app)`);
  }
  return { text: texts.filter(Boolean).join("\n").slice(0, 20000), files: files.slice(0, 20) };
}

// The bytes of a file the person texted (the webhook only names it). Retries while Photon's Mac is still receiving it
// ("not completed yet" / not ready) and on network blips; never past maxBytes (throws P.AttachmentTooBig).
export async function fetchTextedFile(env, tenantId, guid, maxBytes, { tries = 4, wait = 2000 } = {}) {
  const r = await row(env, tenantId);
  if (!r || r.status !== "connected") throw new Error("texting is not connected");
  for (let i = 0; ; i++) {
    try { return await P.downloadAttachment(await token(env, r), guid, { maxBytes }); }
    catch (e) {
      if (e instanceof P.AttachmentTooBig || i >= tries - 1 || ["3", "5", "7", "16"].includes(String(e.code))) throw e;   // bad id / gone / denied / auth: no retry
      await sleep(wait * (i + 1));
    }
  }
}
// The helper's own texting line in the per-person prompt block (prompt/index.js channelBlock). Stable: it changes only when
// texting does. The helper's number is the one Photon assigned to THIS workspace (each person can have their own line); the
// person's phone shows only its last 4 digits (they know their own number; the full one never needs to be in a prompt).
export const fmtNum = (e) => { const m = String(e || "").match(/^\+1(\d{3})(\d{3})(\d{4})$/); return m ? `+1 ${m[1]}-${m[2]}-${m[3]}` : String(e || ""); };
export function textingPromptLine(r) {
  if (r?.status === "connected") {
    const last4 = String(r.phone || "").replace(/\D/g, "").slice(-4);
    const from = last4 ? `their phone ending in ${last4}` : "their own phone";
    return r.assigned
      ? `Texting is set up: the person texts you at ${fmtNum(r.assigned)} from ${from}. If they ask for your number, give them that number. Only that phone can text you, and you text only them.`
      : `Texting is set up: the person texts you from ${from} (your texting number is shown in Settings → Texting). Only that phone can text you, and you text only them.`;
  }
  if (r?.status === "signup" || r?.status === "awaiting_code") return "Texting setup was started but isn't finished; if asked, guide them: Settings → Texting to finish it (US numbers).";
  return "Texting isn't set up; if asked, guide them: Settings → Texting → Set up (US numbers).";
}
// Reads the texting row; a connected row without its helper number (set up before it was stored) is backfilled once from Photon.
export async function textingLine(env, tenantId) {
  let r = null;
  try { r = await row(env, tenantId); } catch { return textingPromptLine(null); }   // no texting table (tests, a bare database)
  if (r?.status === "connected" && !r.assigned && r.project_id && r.project_secret_sealed) {
    try { const { pid, sec } = await creds(env, r), u = await P.registerPhone(pid, sec, r.phone);
      if (u?.assigned) { await patch(env, tenantId, { assigned: u.assigned }); r = { ...r, assigned: u.assigned }; } }
    catch (e) { console.log("texting assigned backfill", String(e.message || e).slice(0, 160)); }
  }
  return textingPromptLine(r);
}
export const appLink = (env, slug) => `https://${env.GATEWAY_HOST || env.APP_HOST}/w/${slug}/app`;

// TEST_MODE only: attach an existing Photon project (skips the device sign-in), then continue like normal setup.
export async function textingUseProject(env, t, pid, sec, rawPhone) {
  const phone = P.normPhone(rawPhone); if (!pid || !sec || !phone) return { error: "project_id, project_secret, phone required" };
  const r = await row(env, t.id);
  if (!r) await env.DB.prepare("INSERT INTO texting (tenant_id,hook_id,phone,status,updated_at) VALUES (?,?,?,?,?)").bind(t.id, crypto.randomUUID().replace(/-/g, ""), phone, "signup", now()).run();
  await patch(env, t.id, { phone, project_id: pid, project_secret_sealed: await sealSecret(env, sec), error: null });
  return finishSetup(env, t.id);
}

// TEST_MODE only: what Photon thinks this workspace's texting looks like (webhooks, users).
export async function textingDebug(env, t) {
  const r = await row(env, t.id); if (!r?.project_id) return { error: "no project" };
  const { pid, sec } = await creds(env, r), A = { authorization: "Basic " + btoa(`${pid}:${sec}`) };
  const g = async (u) => { const x = await fetch(u, { headers: A }); return { status: x.status, body: await x.json().catch(() => null) }; };
  const wh = await g(`https://spectrum.photon.codes/projects/${pid}/webhooks/`), us = await g(`https://spectrum.photon.codes/projects/${pid}/users/`), im = await g(`https://spectrum.photon.codes/projects/${pid}/imessage/`);
  let recent = null; try { recent = await P.recentInChat(await token(env, r), r.phone); } catch (e) { recent = `error: ${e.message}`; }
  let lookup = null; try { lookup = await P.phoneService(await token(env, r), r.phone, { timeoutMs: 6000 }); } catch (e) { lookup = `error: ${e.message}`; }
  return { hook_expected: hookUrl(env, r.hook_id), webhooks: wh, users: us, imessage: im, project_id: pid, recent, service: r.service ?? null, service_at: r.service_at ?? null, lookup };
}
