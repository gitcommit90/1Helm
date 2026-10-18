// 1Helm Cloud prototype (Phase A, workers.dev, Stripe TEST mode). Path routing: /w/<slug>.
import { clientLog } from "./internal-shim.js";
import { Ledger } from "./ee/index.js";
import { UsageLedger } from "./usage-ledger.js";
import { installSnapshotRpc } from "./sqlite-snapshot.js";
import { backupControl, isBackupPath } from "./backup-control.js";
import { enabled as eeEnabled, features as eeFeatures, routeEnabled as eeRouteEnabled } from "./ee/index.js";
import { TOPUP_CENTS, issueConfirm, checkConfirm, savedCard } from "./topup.js";
import { tolerantEnv, DO_TRANSIENT_RE, RPC_SKEW_RE, rpcSkew, codeV, isResetErr } from "./do-stub.js";
import { opsRoute, viewAsGate, viewAsToken } from "./internal-shim.js";
import { ambientSettingsRoute, dailyBillingFlag, deciderModel, modelSettingsEnv } from "./ee/index.js";
import { SW_RE, swResponse } from "./pwa.js";   // Web Push service worker (notify.js)
import { notifApi } from "./notify.js";
import { meetingsApi, meetingsCron } from "./ee/index.js";   // Meeting reminders for notes (Google Calendar / Outlook → "Take notes?")
import { reportApi, reportsPage, reportShot } from "./reports.js";
import { MANIFEST_RE, PWA_ICON_RE, manifestResponse, pwaHead, iconName, DEV_ICON_V } from "./pwa.js";
import { versionedAsset as versionedAssetFor, withAppV } from "./asset-version.js";
import { cardRoute } from "./cards.js";
import { logoRoute } from "./logo.js";
import { appLogoRoute } from "./ee/index.js";
import { isPublicShare, servePublic, shareApi, attachOffers } from "./share.js";
import { safeName, mimeOf, servedHeaders, MAX_UPLOAD, MAX_VIEW, storeUpload, storeView } from "./files.js";
import { previewFileName } from "./file-preview.js";
import { stComplete, stDelete, room, fullMessage, noteRefused, storageOf, storageView, setBlocks, syncBlocks, recount, recountStale, noticeSeen, rearmNotice, RECOUNT_MS } from "./storage.js";
import { readImportManifest, readImportRows, validateImportManifest } from "./import-data.js";
import { verifyImportLayer } from "./import-tar.js";
import { boundedText, boundedJson, boundedForm, BodyTooLargeError, UnsupportedFormTypeError } from "./bounded-body.js";
import { appDetail } from "./ee/index.js";
import { transportFor } from "./ee/index.js";   // the Composio transport: connections, connect links, disconnect
import { composioWebhook } from "./ee/index.js";   // stage 5: signed app events → the workflow that owns the trigger
import { appsMode, selfStatus, selfAvailable, signInStart, signInFinish, isEnded, appsModeRoute, saveOnboardingChoice, composioDonePage } from "./ee/index.js";   // Managed vs Self-managed apps (part 2)
import { paypalSetupRoute } from "./ee/index.js";
import { createChannel, insertChannel, ChannelError } from "./channels.js";
import { transcribe } from "./transcribe.js";
import { lnAudio } from "./ee/index.js";   // Live notes from the device's microphone: one chunk → speech to text (transcribe.js) → the LiveNotes DO
import { transcribeLive, ledgerDictation } from "./transcribe-live.js";
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { deletionRoute, deletionCron, deleteNote } from "./deletion.js";
import { archiveDeletionMix, wipeMix } from "./deletion-do.js";
import { pomoGlobalMethods } from "./pomodoro.js";
export { PrepContainer } from "./prep-container.js";
export { BeeContainer } from "./ee/index.js";
export { ChannelComputer, ComputerLink } from "./channel-computer.js";
export { NativeTransport, NativeTransportState } from "./native-transport.js";
export { Resident } from "./resident.js";
export { UsageLedger };
export { Sentinel } from "./sentinel.js";
import { sealSecret, newStandin } from "./sentinel.js";
import { linkStartConnect, linkStatus, linkDisconnect, linkListPurchases, linkGetPurchase, linkApi } from "./ee/index.js";
import { beeRoute, beeJobOn, beeJobAlarm, beeLiveOn, beeLiveStopOn, beeOps, beeCron, beePendingFacts, beePendingSpeakers, beeNoteEdited, beeNoteDeleted, beeNoteRestored } from "./ee/index.js";   // Settings → Ambient → Bee: pairing, sealed token, /v1/me in a container job
export { BeeSync } from "./ee/index.js";
export { LiveNotes } from "./ee/index.js";
export { FilePrep } from "./sidecar.js";   // file sidecars: one object per file version prepares its text in the background
import { prepJobOn, prepJobAlarm } from "./sidecar.js";
import { lnName } from "./ee/index.js";   // Bee Live notes: one DO per task (SPEC §9): the polling job, the note-taker, the final pass, caps   // Bee live sync: one DO per person, a 5-min alarm, conversations → General's memory + R2 transcripts
import { listLogins, saveLogin, deleteLogin, importLogins, loginNote } from "./logins.js";
import { accountRoute, shortcutsView, emailChangeRoute, newSession, endSession } from "./account.js";
import { ownerAccount, ownerAllowsEmail } from "./single-owner.js";
import { landingPage, selfHostedSignInPage, checkEmailPage, expiredPage, onboardPage, textingPage, hostSignInPage } from "./onboarding.js";
import { createSignIn, decoyPending, verifyCode, pendingEmail, pendingCookie, clearPendingCookie, signInEmail, sweepCodeFails, RESEND_WAIT } from "./signin-code.js";
import { releasesPage, pushRelease, undoRelease, isReleaseAdmin } from "./internal-shim.js";
import { kanbanProxy } from "./internal-shim.js";
import { AGE_VERSION, AGE_ERROR, ageOf, ageCookie, agePage, ageNext, recordAge } from "./age-gate.js";
import { modelsRoute } from "./ee/index.js";
import { healthCron } from "./hindsight-health.js";
import { hindsightSelfTest, hsOn, sweepBanks, recall as hsRecall, bankId as hsBankId } from "./hindsight.js";
import { privacyBoot, privacyView, setPrivacy, isPrivacyLevel } from "./privacy.js";   // AI data privacy (onboarding step, boot)
import { askDecider, dispatch } from "./ee/index.js";
import { parityRoute } from "./internal-shim.js";
import { pageDialog } from "./page-dialog.js";
import { helperName, DEFAULT_HELPER } from "./helper-name.js";
import { interviewEnsure, interviewApi, bootView as interviewBoot, rowOf as interviewRow } from "./interview.js";
import { interviewChatApi } from "./interview-chat.js";
import { appsUsedApi } from "./ee/index.js";
import { googleStatus, googleDisconnect, listConnections, setDefaultAccount, setAccountNote, tidyAfterConnect, appName, disconnectAllManaged, managedCount, RETIRED_APPS, RETIRED_NOTE } from "./ee/index.js";
import { connectOfferApi, connectOfferDone, offerCallbackQuery, catalogFile, connectBlock } from "./ee/index.js";
import { visibleCatalog } from "./ee/index.js";
import { cancelApi, cancelWebhook, cancelSync, cancelCron } from "./ee/index.js";
import { holdOf, holdView, holdFromFailure, notePaid, pastdueSync, pastdueCron, pastdueApi, pastdueSeen } from "./ee/index.js";
import { PAY_MSG, INACTIVE_MSG } from "./ee/index.js";   // payment failed: read-only now, deleted after the paid period + 7 days
import { changePlan } from "./ee/index.js";
import { isTestAccount, usd as guardUsd } from "./spendguard.js";
import { ledgerGuard } from "./ee/index.js";   // paid-plan Ledger accounting and notices
import { textingStatus, textingStart, textingPoll, textingNewCode, textingOff, textingWebhook, textingUseProject, textingDebug } from "./ee/index.js";
import { customMcpRoute } from "./ee/index.js";

const NANO = 1e9;                         // balances in nano-dollars (integers)
import { PLANS } from "./plans-def.js";
import { byokApi, BYOK_PLAN, ledgerByok } from "./byok.js";
import { orStart, orFinish, orCookie, orCookieOf } from "./byok-openrouter.js";   // Sign in with OpenRouter (the BYOK panel's optional button)   // own AI key: the byok plan's settings + routing (+ a backup key on a full plan)
import { People, aliasesFor } from "./people.js";
import { seenAdd, seenSet, backfillSeen, seenBackfillAdmin, hsWalls } from "./walls.js";   // HS_WALLS: Contacts visibility per channel, General's front door
import { REFLECT_ID } from "./pinned-notes.js";
const REFLECT_MAX = 1500;   // the longest "How to work with you" row the retired nightly reflection wrote
import { pagesRoute, imageKind, PHOTO_MAX_BYTES } from "./notebook-pages.js";   // phase 6: the Notebook as pages
import { hsNoteNotify, hsContactNotify } from "./hindsight-writers.js";   // HS_WRITERS: Notebook notes and Contacts cards into the channel's bank
import { permsApi } from "./perms.js";   // Settings → Permissions: level + "Always allow" kinds and sites
import { nativeSameOrigin, SSH_PERMS } from './native-network.js';
import { transportGate, transportHeaders, httpsOrigin } from './transport-security.js';
import { importContacts, photoOf, IMPORT_BATCH_MAX } from "./contacts-import.js";
import { scrubSecrets, hasSecret, SECRET_NOTE } from "./secrets-scrub.js";   // nosecrets: no password, key, card number or code in the Notebook
import { locationRoute, saveLocation, rawFix } from "./location.js";   // where the person is: the app's coarse fix, the helper's place line
import { replyRef } from "./reply-to.js";   // Reply on a chat bubble: the quoted message rides with /stream and send-later
const MARKUP = 1.15;
import { isCapacityError, computerBusyError } from "./computer-capacity.js";
const RESERVED = new Set("admin api app assets auth billing blog cdn demo docs help mail provision security status support www 1helm cloudflare login signup static dev staging test internal captain root system cloud gateway portal account accounts dashboard console design models hooks onboard download downloads manual terms privacy legal pricing about home news careers jobs press email smtp imap ftp ns ns1 ns2 m mobile ios android".split(" "));
const slugValid = (s) => /^(?=.{3,48}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/.test(s) && !s.includes("--") && !/^\d+$/.test(s) && !RESERVED.has(s);
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
const rand = (n = 32) => hex(crypto.getRandomValues(new Uint8Array(n)));
const now = () => Date.now();
const json = (b, s = 200, h = {}) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store", ...h } });
const selfHostedPage = async (env, data = {}) => selfHostedSignInPage({ ...data, claimed: !!(await env.DB.prepare("SELECT user_id FROM single_owner WHERE id=1").first()) });
const scriptJson = (b) => JSON.stringify(b).replace(/</g, "\\u003c");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const usd = (nano) => "$" + (nano / NANO).toFixed(2);

function page(title, body) {
  return new Response(`<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><link rel="icon" type="image/png" href="/1helm-icon-64.png"><title>${esc(title)}</title>
<style>body{font:16px system-ui;max-width:760px;margin:40px auto;padding:0 16px;color:#111}input,button{font:inherit;padding:10px;border-radius:8px;border:1px solid #bbb}button{background:#111;color:#fff;cursor:pointer}
.pill{position:fixed;top:12px;right:12px;padding:6px 12px;border-radius:999px;background:#e8f5e9}.pill.warn{background:#fff3cd}.pill.low{background:#ffd7d7}
#log{border:1px solid #ddd;border-radius:10px;padding:12px;min-height:240px;white-space:pre-wrap}.me{color:#555}.cost{color:#888;font-size:12px}
#modal{display:none;position:fixed;inset:0;background:#0008}#modal>div{background:#fff;max-width:380px;margin:18vh auto;padding:20px;border-radius:12px}</style>${pageDialog("classic")}</head><body>${body}</body></html>`,
    { headers: { "content-type": "text/html;charset=utf-8", "cache-control": "no-store" } });
}

async function stripe(env, path, params = {}, method = "POST") {
  const body = new URLSearchParams();
  const add = (k, v) => { if (v !== undefined && v !== null) { if (typeof v === "object") for (const [kk, vv] of Object.entries(v)) add(`${k}[${kk}]`, vv); else body.append(k, String(v)); } };
  for (const [k, v] of Object.entries(params)) add(k, v);
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method, headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded" },
    body: method === "GET" ? undefined : body });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || `Stripe HTTP ${r.status}`);
  return d;
}

async function verifyStripe(env, raw, header) {
  const parts = (header || "").split(",").map((p) => p.trim());
  const times = parts.filter((p) => p.startsWith("t=")).map((p) => p.slice(2));
  const signatures = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (times.length !== 1 || !/^\d+$/.test(times[0]) || signatures.length < 1 || signatures.length > 16) return false;
  const t = times[0];
  if (!Number.isSafeInteger(Number(t)) || Math.abs(now() / 1000 - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(env.STRIPE_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = hex(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${raw}`)));
  return signatures.some((sig) => /^[a-f0-9]{64}$/i.test(sig) && (crypto.subtle.timingSafeEqual ? crypto.subtle.timingSafeEqual(enc.encode(mac), enc.encode(sig.toLowerCase())) : mac === sig.toLowerCase()));
}

async function currentUser(req, env) {
  const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)hc_session=([a-f0-9]+)/);
  if (!m) return null;
  return env.DB.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?").bind(await sha256(m[1]), now()).first();
}
const tenantOf = (env, userId) => env.DB.prepare("SELECT * FROM tenants WHERE owner_user_id=?").bind(userId).first();
const cleanName = (value, max) => String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
const onboarded = (t) => Number(t?.onboarding_completed || 0) === 1;
// v1 onboarding keeps going after payment (Ways to reach → Watch it work → First task). '' = accounts made before v1.
// v1 accounts (onboard_step set) must also have picked their own address; pre-v1 accounts ("") are left alone.
const onboardDone = (t) => !t?.onboard_step || (t.onboard_step === "done" && Number(t.slug_chosen) === 1);
const ONBOARD_V = "16";   // 16: adult acknowledgement before any new onboarding details/email
// Onboarding "Ways to reach": the Google apps offered one by one (Google Super is retired). { slug: { status, email } }.
const ONBOARD_APPS = ["gmail", "googlecalendar", "googledrive"];
async function onboardApps(env, tenantId) {
  const off = Object.fromEntries(ONBOARD_APPS.map((k) => [k, { status: "unavailable" }]));
  if (!env.COMPOSIO_KEY) return off;
  try {
    const list = await transportFor(env, tenantId).listConnections(), out = {};
    for (const k of ONBOARD_APPS) { const mine = list.filter((a) => a.app === k), on = mine.find((a) => a.status === "connected" && a.default) || mine.find((a) => a.status === "connected");
      out[k] = on ? { status: "connected", email: on.email || "" } : mine.length ? { status: "expired" } : { status: "none" }; }
    return out;
  } catch { return off; }
}
// The onboarding "how should I reach your apps?" step: the current side, whether Self-managed is offered here, and the Composio sign-in.
async function onboardAppsChoice(env, t) {
  const s = await selfStatus(env, t.id);
  return { mode: await appsMode(env, t.id), available: selfAvailable(env), signin: s.status, who: s.who, connect_url: `/w/${t.slug}/composio/connect?back=close` };
}
const onboardNext = (t) => !t ? "/onboard" : t.status !== "active" ? null : onboarded(t) ? `/w/${t.slug}/app` : t.first_name ? "/onboard/helper" : "/onboard/profile";
const APP_V = "276";
// Starts the first-screen data request while app.js downloads. The app takes this promise (window.__1HC_BOOT) instead of fetching again.
// Same URL, same cookie and same time zone as the app's own request, and a failed request resolves to an empty channel list as before.
const BOOT_EARLY = `try{var H=window.__1HC;window.__1HC_BOOT=fetch(H.api+"/app/boot?tz="+encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone||""),{credentials:"same-origin"}).then(function(r){return r.json()}).catch(function(){return{channels:[]}})}catch(e){}`;
// Static files requested with ?v= are cached for a year only when ?v= matches this Worker's own version (src/asset-version.js).
const versionedAsset = (url, r) => versionedAssetFor(url, r, { APP_V, ONBOARD_V, DEV_ICON_V });
const archive = (env, tenantId) => env.ARCHIVE.get(env.ARCHIVE.idFromName(`archive:${tenantId}`));
const IMPORT_PART = 50 * 1024 * 1024;
export async function handleImport(req, env, tenantId, importId, rest) {
  const A = archive(env, tenantId);
  const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!tok || !(await A.auth(importId, await sha256(tok)))) return json({ error: "import not authorized" }, 401);
  const m = rest.match(/^\/obj\/([a-z0-9._-]{1,80})(?:\/(part)\/(\d+)|\/(complete))?$/);
  if (rest === "/status" && req.method === "GET") return json({ objects: await A.listObjects(importId) });
  if (m && !m[2] && !m[4] && req.method === "POST") {
    const name = m[1], existing = await A.object(importId, name);
    if (existing) return json({ name, resumed: true, parts: JSON.parse(existing.parts).map((x) => x.partNumber) });
    const key = `t/${tenantId}/import/${importId}/${name}`, mpu = await env.WS.createMultipartUpload(key, { customMetadata: { app: "1hc-proto", import: importId } });
    await A.putObject(importId, name, key, mpu.uploadId); return json({ name, resumed: false, parts: [] });
  }
  if (m && m[2] && req.method === "PUT") {
    const partNumber = Number(m[3]);
    if (!Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > 10000) return json({ error: "part number must be 1 to 10000" }, 400);
    const o = await A.object(importId, m[1]); if (!o) return json({ error: "start the object first" }, 404);
    const rawLength = req.headers.get("content-length") || "", len = Number(rawLength);
    if (!req.body || !/^[0-9]+$/.test(rawLength) || !Number.isSafeInteger(len) || len < 1 || len > IMPORT_PART) return json({ error: "part needs content-length <= 50 MB" }, 400);
    const rm = await room(env, tenantId, len); if (!rm.ok) return json({ error: fullMessage(rm), storage_full: true }, 507);   // storage.js
    const up = await env.WS.resumeMultipartUpload(o.key, o.upload_id).uploadPart(partNumber, req.body.pipeThrough(new FixedLengthStream(len)));
    const n = await A.addPart(importId, m[1], { partNumber: up.partNumber, etag: up.etag, bytes: len }); return json({ part: partNumber, received: n });
  }
  if (m && m[4] && req.method === "POST") {
    const result = await A.completeImportObject(importId, m[1], tenantId);
    return json(result.body, result.status);
  }
  if (rest === "/finish" && req.method === "POST") {
    let manifest;
    try { manifest = await readImportManifest(req); }
    catch (e) { return json({ error: e.message }, e.message.includes("exceeds") ? 413 : 400); }
    return json(await finishImport(env, tenantId, importId, manifest));
  }
  return json({ error: "unknown import route" }, 404);
}
// Verify every uploaded object against the exporter's manifest, register the file layers with the computer,
// load the database rows, and compare every count. Nothing is marked done unless all checks pass.
export async function finishImport(env, tenantId, importId, manifest) {
  const invalid = validateImportManifest(manifest);
  if (invalid) return { ok: false, problems: [invalid] };
  const A = archive(env, tenantId), attempt = crypto.randomUUID();
  if (!(await A.beginImportFinish(importId, attempt))) return { ok: false, problems: ["import finish is already running or complete"] };
  try {
    const objs = Object.fromEntries((await A.listObjects(importId)).map((o) => [o.name, o]));
    const problems = [], layers = [];
    for (const [name, want] of Object.entries(manifest.objects)) {
      const o = objs[name]; if (!o || !o.done) { problems.push(`${name}: not uploaded`); continue; }
      const head = await env.WS.head(o.key);
      if (!head || head.size !== want.bytes) { problems.push(`${name}: size ${head?.size} != ${want.bytes}`); continue; }
      if (want.kind === "files") {
        // A matching R2 size cannot prove the computer layer is the tarball in
        // the manifest. Verify its bytes before any rows or layers are committed.
        let layer; try { layer = await env.WS.get(o.key); } catch { problems.push(`${name}: could not read file layer`); continue; }
        if (!layer?.body || layer.size !== want.bytes) { problems.push(`${name}: file layer missing or changed`); continue; }
        try {
          await A.renewImportFinish(importId, attempt);
          await verifyImportLayer(layer.body, want.sha256, () => A.renewImportFinish(importId, attempt));
        } catch (e) { problems.push(`${name}: ${String(e?.message || "could not verify file layer").slice(0, 100)}`); continue; }
        layers.push({ key: o.key, bytes: want.bytes, sha256: want.sha256, files: want.files });
      }
    }
    if (problems.length) return { ok: false, problems };
    // Stage rows until the whole gzip and every count have passed validation.
    const data = await env.WS.get(objs["data.jsonl.gz"].key);
    if (!data?.body) return { ok: false, problems: ["import data is missing"] };
    let loaded;
    try { loaded = await readImportRows(data.body, (batch) => A.stageImportRows(importId, attempt, batch), manifest.objects["data.jsonl.gz"].sha256); }
    catch (e) { return { ok: false, problems: [String(e?.message || e).slice(0, 160)] }; }
    const counts = await A.stagedCounts(importId, attempt), mismatches = [];
    for (const [tbl, n] of Object.entries(manifest.rows)) if ((counts[tbl] || 0) !== n) mismatches.push(`${tbl}: ${counts[tbl] || 0} != ${n}`);
    for (const tbl of Object.keys(counts)) if (!Object.hasOwn(manifest.rows, tbl)) mismatches.push(`${tbl}: unexpected table`);
    if (mismatches.length) return { ok: false, rows_loaded: loaded, counts, expected_rows: manifest.rows, mismatches };
    const C = env.COMPUTER.get(env.COMPUTER.idFromName(`computer:${tenantId}`));
    const reg = await C.importLayers(tenantId, layers);
    const report = { ok: true, rows_loaded: loaded, counts, expected_rows: manifest.rows, mismatches, layers: reg.layers, source: manifest.source, at: Date.now() };
    await A.commitImportRows(importId, attempt, report);
    return report;
  } finally { await A.releaseImportFinish(importId, attempt); }
}
async function importedHtml(env, t) {
  const A = archive(env, t.id), chans = await A.channels(), rep = await A.lastReport();
  if (!chans.length) return `<p>No imported data yet.</p>`;
  return `<p><a href="/w/${esc(t.slug)}/?classic=1">← back to workspace</a></p><h2>Imported from ${esc(rep?.source?.name || "self-hosted 1Helm")}</h2>
<p style="color:#666">Imported ${rep ? new Date(rep.at).toLocaleString() : ""}. Files are on the Linux computer under <code>/workspace/channels/&lt;channel&gt;/</code>.</p>
<table style="border-collapse:collapse;width:100%">${chans.map((c) => `<tr style="border-bottom:1px solid #eee"><td style="padding:6px"><a href="/w/${esc(t.slug)}/imported/${c.id}">#${esc(c.name)}</a></td><td>${c.messages} messages</td><td>${c.memory} memories</td><td>${c.workflows} workflows</td></tr>`).join("")}</table>`;
}
async function importedChannelHtml(env, t, cid) {
  const d = await archive(env, t.id).channel(cid);
  if (!d.channel) return `<p>Unknown channel.</p>`;
  const who = (m) => m.author || (m.bot_id ? "resident" : "you");
  return `<p><a href="/w/${esc(t.slug)}/imported">← all imported channels</a></p><h2>#${esc(d.channel.name)}</h2>
${d.memory.length ? `<details><summary>${d.memory.length} memories</summary><ul>${d.memory.map((m) => `<li>${esc(String(m.content).slice(0, 400))}</li>`).join("")}</ul></details>` : ""}
${d.workflows.length ? `<details><summary>${d.workflows.length} workflows</summary><ul>${d.workflows.map((w) => `<li><b>${esc(w.name)}</b> (${esc(w.status)}, every ${Math.round(w.interval_seconds / 3600)}h)</li>`).join("")}</ul></details>` : ""}
<p style="color:#666">Last ${d.messages.length} messages</p>
${d.messages.map((m) => `<div style="margin:10px 0;padding:8px;border-left:3px solid ${m.bot_id ? "#8ab" : "#ccc"}"><div style="color:#888;font-size:12px">${esc(who(m))} · ${new Date(m.created).toLocaleString()}${m.parent_id ? " · reply" : ""}</div><div style="white-space:pre-wrap">${esc(String(m.body || "").slice(0, 4000))}</div></div>`).join("")}`;
}
// Why a model call or computer minute was refused. The daily limit is a "skipped:" error so scheduled jobs don't count it as a failure.
const DAY_LIMIT_MSG = "skipped: daily safety limit reached";
const payError = (reason) => reason === "day_limit" ? Object.assign(new Error(DAY_LIMIT_MSG), { status: 429 }) : Object.assign(new Error("out_of_credits"), { status: 402 });
// 1HC plan ladder: src/plans-def.js (a leaf module the Durable Objects read too).
const planPrices = (env) => { try { return JSON.parse(env.PLAN_PRICES || "{}"); } catch { return {}; } };
const planKey = (k) => (PLANS[k] ? k : "plus");
const planOfPrice = (env, priceId) => Object.entries(planPrices(env)).find(([, id]) => id === priceId)?.[0] || null;
const ledger = (env, tenantId) => env.LEDGER.get(env.LEDGER.idFromName(`tenant:${tenantId}`));

// Full or read-only. Captain 10-06: "If payment fails, instantly it becomes readonly until its fixed." No grace period: anything but an
// active plan is read-only (they can open the app, read, download and fix payment; nothing that costs anything runs). An unpaid bill
// adds why and the dates (pastdue.js): data kept until the end of the paid period, then 7 more days, then permanently deleted.
function accessOf(t, env, hold = null) {
  if (t.status === "active") return { mode: "full", status: t.status };
  const a = { mode: "read_only", status: t.status };
  if (hold) Object.assign(a, holdView(hold));
  else if (t.status === "past_due") Object.assign(a, { reason: "payment_failed", message: PAY_MSG });
  return a;
}
// The plain refusal for anything that needs a working plan.
const payRequired = (access) => json({ error: "payment_required", message: access?.message || INACTIVE_MSG, access }, 402);
async function applySubStatus(env, subId, stripeStatus) {
  const status = { active: "active", trialing: "active", past_due: "past_due", unpaid: "suspended", canceled: "suspended", incomplete_expired: "suspended", paused: "suspended" }[stripeStatus];
  if (!status) return;
  await env.DB.prepare(`UPDATE tenants SET status=?, past_due_since=CASE WHEN ?='past_due' THEN COALESCE(past_due_since,?) WHEN ?='active' THEN NULL ELSE past_due_since END,
    sub_status=?, updated_at=? WHERE stripe_subscription=?`).bind(status, status, now(), status, stripeStatus, now(), subId).run();
}
// Where Stripe (and other outside pages) send people back: always the app, never the old classic page at /w/<slug>/.
// ?settings=usage opens Settings → Usage; the app also reads topup=1 / resubscribed=1 / plan=changed to say what happened.
const appUrl = (origin, t, q = "") => `${origin}/w/${t.slug}/app${q}`;
const USAGE = "?settings=usage";
// Every recovery path is self-serve: pay the open invoice (new card), or resubscribe if the subscription ended.
async function fixPayment(env, t, origin) {
  if (t.stripe_subscription) {
    const sub = await stripe(env, `subscriptions/${t.stripe_subscription}`, {}, "GET");
    if (sub.status !== "canceled" && sub.status !== "incomplete_expired") {
      const inv = sub.latest_invoice && await stripe(env, `invoices/${sub.latest_invoice}`, {}, "GET");
      if (inv && inv.status === "open" && inv.hosted_invoice_url) return { url: inv.hosted_invoice_url, kind: "pay_invoice" };
      const ps = await stripe(env, "billing_portal/sessions", { customer: t.stripe_customer, return_url: appUrl(origin, t, USAGE) });
      return { url: ps.url, kind: "portal" };
    }
  }
  const cs = await stripe(env, "checkout/sessions", { mode: "subscription", customer: t.stripe_customer || undefined, client_reference_id: t.id,
    "line_items[0][price]": planPrices(env)[planKey(t.plan)], "line_items[0][quantity]": 1, success_url: appUrl(origin, t, `${USAGE}&resubscribed=1`), cancel_url: appUrl(origin, t, USAGE),
    metadata: { app: "1hc-proto", tenant_id: t.id }, subscription_data: { metadata: { app: "1hc-proto", tenant_id: t.id } } });
  return { url: cs.url, kind: "resubscribe" };
}
const hsSweep = (env, o = {}) => sweepBanks(env, { ...o, channelsOf: (tid) => archive(env, tid).channels() });
// Hourly: heal missed or out-of-order webhooks by asking Stripe for the truth.
async function reconcile(env) {
  const rows = (await env.DB.prepare("SELECT id, stripe_subscription, status, sub_status FROM tenants WHERE stripe_subscription<>''").all()).results;
  let fixed = 0;
  for (const r of rows) {
    const sub = await stripe(env, `subscriptions/${r.stripe_subscription}`, {}, "GET").catch(() => null);
    if (!sub) continue;
    if (sub.status !== r.sub_status) { await applySubStatus(env, r.stripe_subscription, sub.status); fixed++; }
    // A payment failure (or a fix) whose webhook we missed: start or end the hold (pastdue.js).
    await pastdueSync(env, await env.DB.prepare("SELECT * FROM tenants WHERE id=?").bind(r.id).first(), sub, {}).catch((e) => console.log("pastdue sync", r.id, e.message));
    await syncBlocks(env, r.id, sub).catch((e) => console.log("storage blocks sync", r.id, e.message));   // storage.js: a missed subscription.updated
    await cancelSync(env, r.id, sub, { stripe }).catch((e) => console.log("cancel sync", r.id, e.message));   // a portal cancel/renew whose webhook we missed (src/cancel.js)
  }
  return { checked: rows.length, fixed };
}

// Watchdog: any resident whose schedule is overdue by >2 min gets poked (re-arms its alarm; the alarm itself runs the work).
async function scheduleWatchdog(env) {
  const rows = (await env.DB.prepare("SELECT tenant_id, channel, channel_id FROM resident_schedules WHERE next_run IS NOT NULL AND next_run < ?").bind(now() - 120e3).all()).results;
  for (const r of rows) { try { await env.RESIDENT.get(env.RESIDENT.idFromName(`res:${r.tenant_id}:${r.channel}`)).ensure(r.tenant_id, r.channel, r.channel_id); } catch (e) { console.log("watchdog", r.channel, e.message); } }
  return { overdue: rows.length };
}

// ---- Your own address: <slug>.1helm.com. Cloud and self-hosted 1Helm share the namespace (self-hosted rows live in the
// 1helm-workspaces D1, bound as SELFHOST), so a name is free only if neither has it.
async function slugCheck(env, slug, tenantId = null) {
  slug = String(slug || "").trim().toLowerCase();
  if (!slugValid(slug)) return { slug, available: false, reason: RESERVED.has(slug) ? "That address is reserved. Try another." : "Use 3–48 letters, numbers or single dashes." };
  const mine = await env.DB.prepare("SELECT id FROM tenants WHERE slug=?").bind(slug).first();
  if (mine && mine.id !== tenantId) return { slug, available: false, reason: "That address is taken. Try another." };
  if (env.SELFHOST) { const sh = await env.SELFHOST.prepare("SELECT 1 FROM workspaces WHERE slug=?").bind(slug).first().catch(() => null); if (sh) return { slug, available: false, reason: "That address is taken. Try another." }; }
  return { slug, available: true };
}
// Point a configured workspace subdomain at this Worker. Requires an API token with domain access.
async function claimHost(env, t, oldSlug = null) {
  if (env.ENV_NAME === "dev" || !eeEnabled(env)) return false;
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID || !env.CF_ZONE_ID || !env.PUBLIC_BASE_DOMAIN || !env.WORKER_SERVICE_NAME) { console.log("claimHost: custom domain not configured; address saved, host not created", t.slug); return false; }
  const H = { authorization: `Bearer ${env.CF_API_TOKEN}`, "content-type": "application/json" };
  const hostname = (slug) => `${slug}.${env.PUBLIC_BASE_DOMAIN}`;
  try {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/workers/domains`, { method: "PUT", headers: H, body: JSON.stringify({ hostname: hostname(t.slug), service: env.WORKER_SERVICE_NAME, zone_id: env.CF_ZONE_ID, environment: "production" }) });
    const d = await r.json().catch(() => ({}));
    if (!d.success) { console.log("claimHost failed", t.slug, JSON.stringify(d.errors || d).slice(0, 300)); return false; }
    await env.DB.prepare("UPDATE tenants SET host_ready=1,updated_at=? WHERE id=?").bind(now(), t.id).run();
    if (oldSlug && oldSlug !== t.slug) {
      const l = await (await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/workers/domains?hostname=${encodeURIComponent(hostname(oldSlug))}`, { headers: H })).json().catch(() => ({}));
      for (const x of l.result || []) if (x.hostname === hostname(oldSlug) && x.service === env.WORKER_SERVICE_NAME) await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/workers/domains/${x.id}`, { method: "DELETE", headers: H });
    }
    return true;
  } catch (e) { console.log("claimHost error", e.message); return false; }
}
// Where a finished account opens: its own address when that host is live (sign-in is handed over with a one-time token,
// so the session cookie never has to be shared with other hosts), else /w/<slug>/app.
const nativeMobile = (req) => /(?:^|\s)1HelmMobile(?:\s|$)/.test(req?.headers.get("user-agent") || "");
const homeUrl = (t, next = "", req = null) => Number(t.host_ready) === 1 && !nativeMobile(req) ? `/auth/to?next=${encodeURIComponent(next || `/w/${t.slug}/app`)}` : (next || `/w/${t.slug}/app`);

// ---- The approved onboarding (v1) on real data. Steps before payment run in the page and save here as they're chosen;
// payment is Stripe Checkout; after payment the account is provisioned and the person finishes Ways to reach → Watch it work → First task.
async function uniqueSlug(env, base) {
  let b = String(base || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
  if (b.length < 3 || /^\d+$/.test(b) || RESERVED.has(b)) b = `my-${b || "helm"}`.replace(/-+$/, "");
  for (let i = 0; i < 8; i++) {
    const cand = i === 0 ? b : `${b}-${100 + Math.floor(Math.random() * 900)}`;
    if ((await slugCheck(env, cand)).available) return cand;
  }
  return `helm-${rand(4)}`;
}
async function ensureTenant(env, user, first) {
  let t = await tenantOf(env, user.id); if (t) return t;
  const id = crypto.randomUUID(), slug = await uniqueSlug(env, first || user.email.split("@")[0]);
  await env.DB.prepare("INSERT OR IGNORE INTO tenants (id,slug,owner_user_id,created_at,updated_at) VALUES (?,?,?,?,?)").bind(id, slug, user.id, now(), now()).run();
  return tenantOf(env, user.id);
}
async function ensureSelfHostedTenant(env, user) {
  let t = await ensureTenant(env, user);
  if (t.status === "active" && onboarded(t)) return t;
  await archive(env, t.id).provisionFresh();
  const first = cleanName(user.email.split("@")[0].replace(/[._-]+/g, " "), 80) || "Owner";
  await env.DB.prepare("UPDATE tenants SET status='active',plan=?,first_name=CASE WHEN first_name='' THEN ? ELSE first_name END,helper_name=CASE WHEN helper_name='' THEN ? ELSE helper_name END,slug_chosen=1,onboarding_completed=1,onboard_step='done',provisioned_at=COALESCE(provisioned_at,?),updated_at=? WHERE id=?")
    .bind(BYOK_PLAN, first, DEFAULT_HELPER, now(), now(), t.id).run();
  return tenantOf(env, user.id);
}
// Check before reading a new email body. A pending pre-deploy sign-in can finish/resend its own email, never another address.
async function ageAccess(req, env, { allowPending = true } = {}) {
  const age = await ageOf(req, env);
  if (age) return { age, allowed: true };
  if (await currentUser(req, env)) return { allowed: true };
  if (!allowPending) return { allowed: false };
  const pending = await pendingEmail(env, req);
  return { allowed: !!pending, pending };
}
async function onboardApi(req, env, url, op) {
  const origin = httpsOrigin(url);
  let body = {};
  try {
    let access;
    if (req.method === "POST" && op !== "code") {
      const o = req.headers.get("origin"); if (o && o !== origin) return json({ error: "Not allowed." }, 403);
      access = eeEnabled(env) ? await ageAccess(req, env) : { allowed: true };
      if (!access.allowed) return json(AGE_ERROR, 403);
    }
    if (req.method === "POST") body = await boundedJson(req, 32_768);
    if (op === "email" && req.method === "POST") {
      const email = String(body.email || "").trim().toLowerCase();
      if (access.pending && access.pending !== email) return json(AGE_ERROR, 403);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter a valid email address." });
      if (!eeEnabled(env) && !(await ownerAllowsEmail(env, email))) return json({ error: "This server already has an owner." }, 403);
      const recent = await env.DB.prepare("SELECT COUNT(*) n FROM magic_links WHERE email=? AND expires_at>?").bind(email, now()).first();
      if (Number(recent?.n || 0) > 5) return json({ error: "We just sent you a few links. Check your inbox (and spam) for the newest one." });
      // One email, two ways in: the link and a 6-digit code (src/signin-code.js). The code works only in this browser (hc_signin cookie).
      const plan = PLANS[body.plan] ? body.plan : "", si = await createSignIn(env, email, { age: access.age });
      const link = `${origin}/auth/verify?token=${si.token}${plan ? `&plan=${plan}` : ""}`, ck = { "set-cookie": pendingCookie(si.pending) };
      if (eeEnabled(env) && env.TEST_MODE === "1" && /@example\.(com|org|net)$/.test(email)) return json({ ok: true, test_link: link, test_code: si.code, resend_wait: RESEND_WAIT }, 200, ck);
      try { await sendMagicLink(env, email, link, si.code); } catch (e) { console.error("magic link send failed", e?.code, e?.message); return json({ error: "We couldn't send your sign-in email just now. Try again in a minute." }); }
      return json({ ok: true, resend_wait: RESEND_WAIT }, 200, ck);
    }
    // The 6-digit code from the sign-in email, typed on this device. Same session as the link (newSession + hc_session).
    if (op === "code" && req.method === "POST") {
      const o = req.headers.get("origin"); if (o && o !== origin) return json({ error: "Not allowed." }, 403);
      const r = await verifyCode(env, req, body.code);
      if (!r.email) return json({ error: r.error, kind: r.kind });
      return signedIn(env, req, r.email, { json: { ok: true }, age: r.age });
    }
    const user = await currentUser(req, env);
    if (!user) {
      // Waiting on a code in this browser (a reload, or the installed app coming back from Mail): back to the code screen.
      const pe = op === "state" ? await pendingEmail(env, req) : "";
      if (eeEnabled(env) && op === "state" && !pe && !await ageOf(req, env)) return json(AGE_ERROR, 403);
      return json(pe ? { signed_in: false, step: "email", email: pe, pending: true, resend_wait: RESEND_WAIT } : { signed_in: false, step: "account" });
    }
    if (!eeEnabled(env)) {
      const t = await ensureSelfHostedTenant(env, user);
      return op === "state" ? json({ signed_in: true, next_url: homeUrl(t, "", req) }) : json({ error: "not found" }, 404);
    }
    let t = await tenantOf(env, user.id);
    if (op === "slug") return json(await slugCheck(env, url.searchParams.get("value"), t?.id || null));
    // The last step's Composio sign-in (GET, polled while the person signs in on Composio's page). It was below the POST-only line, so the
    // poll got a 404 and the step sat on "Opening Composio…" (Captain, 10-07).
    if (op === "apps-state") return t && t.status === "active" ? json(await onboardAppsChoice(env, t)) : json({ error: "Finish paying first." });
    if (op === "state") {
      if (t && t.status === "active" && !onboarded(t)) {
        await archive(env, t.id).provisionFresh();
        await env.DB.prepare("UPDATE tenants SET helper_name=CASE WHEN helper_name='' THEN ? ELSE helper_name END,onboarding_completed=1,onboard_step='reach',provisioned_at=COALESCE(provisioned_at,?),updated_at=? WHERE id=?").bind(DEFAULT_HELPER, now(), now(), t.id).run();
        t = await tenantOf(env, user.id);
        if (Number(t.slug_chosen) === 1 && Number(t.host_ready) !== 1) { await claimHost(env, t); t = await tenantOf(env, user.id); }
      }
      const profile = t ? { first: t.first_name || "", helperId: Number(t.helper_avatar || 8), helperName: t.helper_name || "", tone: Number(t.helper_tone || 0), plan: planKey(t.plan), slug: t.slug, slugChosen: Number(t.slug_chosen) === 1,
        privacy: privacyView(t).chosen ? privacyView(t).level : "" } : {};
      // AI data privacy (privacy.js): an explicit choice is required before payment (and before the first task); a paid account that
      // never chose (it paid before this step existed) is asked right after its address. Unset always resolves to ZDR on the server.
      const needPrivacy = t && !privacyView(t).chosen;
      if (t && t.status === "active" && onboarded(t)) {
        if (onboardDone(t)) return json({ signed_in: true, next_url: homeUrl(t, "", req) });
        return json({ signed_in: true, email: user.email, paid: true, step: Number(t.slug_chosen) === 1 ? (needPrivacy ? "privacy" : t.onboard_step || "reach") : "address", profile, tenant: { status: t.status, slug: t.slug, host_ready: Number(t.host_ready) === 1, finished: t.onboard_step === "done" },
          texting: await textingStatus(env, t.id), texting_url: `/w/${t.slug}/texting?from=onboard`,
          apps: await onboardApps(env, t.id), apps_api: `/w/${t.slug}/api/apps/connect`, apps_choice: await onboardAppsChoice(env, t) });
      }
      if (t && t.status !== "pending_payment" && t.status !== "active") return json({ signed_in: true, error: `There's a problem with this account's payment. Open Settings in your 1Helm or contact ${env.SUPPORT_EMAIL || env.EMAIL_FROM}.` });
      const step = !t || !t.first_name ? "hello" : !t.helper_name ? "pick" : Number(t.slug_chosen) !== 1 ? "address" : needPrivacy ? "privacy" : "plan";
      return json({ signed_in: true, email: user.email, paid: false, step, profile, tenant: t ? { status: t.status } : null });
    }
    if (req.method !== "POST") return json({ error: "unknown" }, 404);
    const locked = t && t.status === "active" && onboarded(t);
    if (op === "profile") {
      const first = cleanName(body.first, 80); if (!first) return json({ error: "Enter your first name." });
      if (locked) return json({ ok: true });
      t = await ensureTenant(env, user, first);
      await env.DB.prepare("UPDATE tenants SET first_name=?,updated_at=? WHERE id=?").bind(first, now(), t.id).run();
      return json({ ok: true });
    }
    if (op === "helper") {
      const name = cleanName(body.name, 40), avatar = Number(body.avatar), tone = Math.max(0, Math.min(2, Number(body.tone) || 0));
      if (!name || !Number.isInteger(avatar) || avatar < 1 || avatar > 9) return json({ error: "Choose a helper and give them a name." });
      if (locked) return json({ ok: true });
      t = await ensureTenant(env, user);
      await env.DB.prepare("UPDATE tenants SET helper_name=?,helper_avatar=?,helper_tone=?,updated_at=? WHERE id=?").bind(name, avatar, tone, now(), t.id).run();
      return json({ ok: true });
    }
    if (op === "address") {
      t = await ensureTenant(env, user);
      const c = await slugCheck(env, body.slug, t.id); if (!c.available) return json({ error: c.reason });
      const old = t.slug;
      if (old !== c.slug) {
        const r = await env.DB.prepare("UPDATE tenants SET slug=?,updated_at=? WHERE id=? AND NOT EXISTS (SELECT 1 FROM tenants WHERE slug=? AND id<>?)").bind(c.slug, now(), t.id, c.slug, t.id).run();
        if (!r.meta.changes) return json({ error: "That address was just taken. Try another." });
      }
      await env.DB.prepare("UPDATE tenants SET slug_chosen=1,host_ready=CASE WHEN ?=slug THEN host_ready ELSE 0 END,updated_at=? WHERE id=?").bind(old, now(), t.id).run();
      t = await tenantOf(env, user.id);
      // Paid accounts get their address right away; unpaid ones when payment confirms.
      if (t.status === "active") { await claimHost(env, t, old); t = await tenantOf(env, user.id); }
      return json({ ok: true, slug: t.slug, host_ready: Number(t.host_ready) === 1, ...(t.onboard_step === "done" ? { url: homeUrl(t, "", req) } : {}) });
    }
    // AI data privacy: one of the three levels, validated here (anything else refused, nothing stored). Before or after payment.
    if (op === "privacy") {
      const level = typeof body.level === "string" ? body.level : ""; if (!isPrivacyLevel(level)) return json({ error: "Choose one of the three options." });
      t = await ensureTenant(env, user);
      const r = await setPrivacy(env, t.id, level); return json({ ok: true, level: r.level });
    }
    if (op === "checkout") {
      if (locked) return json({ url: "/onboard" });
      const plan = PLANS[body.plan] ? body.plan : "plus", first = cleanName(body.first, 80), name = cleanName(body.name, 40) || DEFAULT_HELPER, avatar = Number(body.avatar) || 8, tone = Math.max(0, Math.min(2, Number(body.tone) || 0));
      t = await ensureTenant(env, user, first);
      if (!planPrices(env)[plan]) return json({ error: "That plan isn't available right now." });
      if (Number(t.slug_chosen) !== 1) return json({ error: "Pick your address first." });
      if (!privacyView(t).chosen) return json({ error: "Choose how AI providers may use your data first.", step: "privacy" });
      await env.DB.prepare("UPDATE tenants SET plan=?,first_name=CASE WHEN ?<>'' THEN ? ELSE first_name END,helper_name=?,helper_avatar=?,helper_tone=?,updated_at=? WHERE id=?").bind(plan, first, first, name, avatar, tone, now(), t.id).run();
      const cs = await stripe(env, "checkout/sessions", {
        mode: "subscription", customer_email: user.email, client_reference_id: t.id,
        "line_items[0][price]": planPrices(env)[plan], "line_items[0][quantity]": 1,
        success_url: `${origin}/onboard?paid=1`, cancel_url: `${origin}/onboard`,
        metadata: { app: "1hc-proto", tenant_id: t.id, plan }, subscription_data: { metadata: { app: "1hc-proto", tenant_id: t.id, plan } },
        payment_method_collection: "always" });
      return cs.url ? json({ url: cs.url }) : json({ error: "Checkout didn't open. Try again in a minute." });
    }
    if (!locked) return json({ error: "Finish paying first." });
    if (op === "step") {
      const step = String(body.step || ""); if (["reach", "device", "watch", "task", "know", "apps"].includes(step)) await env.DB.prepare("UPDATE tenants SET onboard_step=?,updated_at=? WHERE id=?").bind(step, now(), t.id).run();
      return json({ ok: true });
    }
    // The last step (Managed vs Self-managed): the box must be checked; Self-managed also needs the Composio sign-in done.
    if (op === "finish") {
      const task = String(body.task || "").trim().slice(0, 4000);
      if (body.apps) { const r = await saveOnboardingChoice(env, t.id, body.apps); if (r.error) return json(r); }
      await env.DB.prepare("UPDATE tenants SET onboard_step='done',updated_at=? WHERE id=?").bind(now(), t.id).run();
      // Get to know you: always offered as a task in General at the end of onboarding; "Start now" opens it, "Later" leaves it in the list.
      const iv = await interviewEnsure(env, t, String(body.tz || "")).catch((e) => { console.log("interview", e.message); return null; });
      const ivStart = body.interview === "start" && iv?.status === "open" && iv.session_id ? `#/main/s/${iv.session_id}` : "";
      if (!task) return json({ url: homeUrl(t, `/w/${t.slug}/app?welcome=1${ivStart}`, req) });
      // The first task starts on the real helper right now; the app opens on it. The turn keeps running if nobody watches.
      const R = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${t.id}:main`));
      const rd = (await R.chatStream(t.id, "main", "1", task, { session: "new" })).getReader();
      let buf = "", sid = null; const dec = new TextDecoder();
      for (let i = 0; i < 20 && !sid; i++) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); const m = buf.match(/"t":"session","session":\{"id":"([0-9a-f-]{36})"/); if (m) sid = m[1]; }
      rd.cancel().catch(() => {});
      return json({ url: homeUrl(t, `/w/${t.slug}/app?welcome=1${ivStart || (sid ? `#/main/s/${sid}` : "")}`, req) });
    }
    return json({ error: "unknown" }, 404);
  } catch (e) { if (e instanceof BodyTooLargeError || e instanceof UnsupportedFormTypeError) throw e; console.error("onboard api", op, e?.message); return json({ error: "Something went wrong on our side. Try again in a minute." }); }
}
export default {
  async scheduled(ev, env, ctx) {
    env = tolerantEnv(env);   // do-stub.js: every Durable Object call survives a deploy's skew/reset window
    if (env.ENV_NAME === "selfhost" && env.BACKUP_MAINTENANCE === "1") return;
    // Every minute: meeting reminders for notes only (src/meetings.js: D1 reads, and a few calendar looks when due). Nothing else runs on it.
    if (ev.cron === "* * * * *") { if (eeEnabled(env)) ctx.waitUntil(meetingsCron(env, { now: ev.scheduledTime || Date.now() }).then((r) => { if (r.due.sent || r.due.missed || r.polled.length) console.log("meetings cron", JSON.stringify(r).slice(0, 600)); }).catch((e) => console.log("meetings cron failed", e.message))); return; }
    if (ev.cron === "*/5 * * * *") ctx.waitUntil(deletionCron(env).then((r) => { if (r.resumed || r.errors || r.hs) console.log("deletion cron", JSON.stringify(r)); }).catch((e) => console.log("deletion cron failed", e.message)));
    ctx.waitUntil(scheduleWatchdog(env).then((r) => console.log("watchdog", JSON.stringify(r))));
    if (ev.cron === "17 * * * *") ctx.waitUntil(reconcile(env).then((r) => console.log("reconcile", JSON.stringify(r))));
    // Sign-in codes: forget wrong-code counts older than a day (src/signin-code.js).
    if (ev.cron === "17 * * * *") ctx.waitUntil(sweepCodeFails(env).catch((e) => console.log("code fails sweep failed", e.message)));
    // Bee: restart the sync of a connected account that hasn't synced in 30 min (src/bee.js beeCron; the BeeSync alarm does the work).
    if (ev.cron === "17 * * * *" && eeEnabled(env)) ctx.waitUntil(beeCron(env).then((r) => { if (r.checked) console.log("bee cron", JSON.stringify(r)); }).catch((e) => console.log("bee cron failed", e.message)));
    // Storage: recount the accounts not counted in a day (corrects any drift in the running counter). src/storage.js
    if (ev.cron === "17 * * * *") ctx.waitUntil(recountStale(env).then((r) => console.log("storage recount", JSON.stringify(r))).catch((e) => console.log("storage recount failed", e.message)));
    // Cancelled plans: reminders 7/3/1 days before the period ends, deletion at the end if the webhook missed it, final emails (src/cancel.js).
    if (ev.cron === "17 * * * *" && eeEnabled(env)) ctx.waitUntil(cancelCron(env, { stripe }).then((r) => console.log("cancel cron", JSON.stringify(r))).catch((e) => console.log("cancel cron failed", e.message)));
    // Unpaid plans: first notices, reminders (start of the final 7 days, 1 day before), deletion when the 7 days are up (src/pastdue.js).
    if (ev.cron === "17 * * * *" && eeEnabled(env)) ctx.waitUntil(pastdueCron(env, { stripe }).then((r) => console.log("pastdue cron", JSON.stringify(r))).catch((e) => console.log("pastdue cron failed", e.message)));
    // Own router pool: rebuilt nightly at 2:17 AM PT (09:17 UTC) when the own router is on (dev only for now).
    // Hindsight: delete banks whose account or channel no longer exists. Nightly at 3:17 AM PT (10:17 UTC).
    if (ev.cron === "17 * * * *" && hsOn(env) && new Date(ev.scheduledTime).getUTCHours() === 10) ctx.waitUntil(hsSweep(env).then((r) => console.log("hindsight sweep", JSON.stringify({ ...r, skipped: r.skipped.length }))).catch((e) => console.log("hindsight sweep failed", e.message)));
    // Billing flag (billing-flag.js): once a day, find price_unknown events and turns charged over 10x their list-price estimate. Read-only: no charge changes.
    if (ev.cron === "17 * * * *" && eeEnabled(env) && new Date(ev.scheduledTime).getUTCHours() === 10) ctx.waitUntil(dailyBillingFlag(env, { since: (ev.scheduledTime || Date.now()) - 864e5, residentOf: (tid, ch) => env.RESIDENT.get(env.RESIDENT.idFromName(`res:${tid}:${ch}`)), ledgerOf: (tid) => ledger(env, tid) }).catch((e) => console.log("billing flag failed", e.message)));
    // Hindsight bank health (hindsight-health.js, HS_FOUNDATIONS): about one check per bank per day, spread over the hourly runs. Results: /_ops/hs-health.
    if (ev.cron === "17 * * * *" && hsOn(env)) ctx.waitUntil(healthCron(env, { now: ev.scheduledTime }).then((r) => { if (r.checked || r.errors) console.log("hindsight health", JSON.stringify(r)); }).catch((e) => console.log("hindsight health failed", e.message)));
  },
  async fetch(req, env, ctx) {
    env = tolerantEnv(env);   // do-stub.js: every Durable Object call survives a deploy's skew/reset window
    const res = withAppV(new URL(req.url), transportHeaders(req, await this.route(req, env, ctx)), { APP_V });
    if (isPublicShare(env, new URL(req.url))) return res;   // share links and published pages are the person's content: never touched
    // Dev environment: a yellow DEV strip on every page, so dev can never be mistaken for Live.
    if (env.ENV_NAME === "dev" && (res.headers.get("content-type") || "").includes("text/html"))
      return new HTMLRewriter().on("body", { element(e) { e.prepend(`<div id="devstrip" style="position:fixed;z-index:2147483647;top:0;left:50%;transform:translateX(-50%);background:#f5bd3c;color:#1c1b19;font:600 11px/1 system-ui,sans-serif;letter-spacing:.08em;padding:4px 10px;border-radius:0 0 8px 8px;pointer-events:none">DEV · test data · nothing here is Live</div>`, { html: true }); } }).transform(res);
    return res;
  },
  async route(req, env, ctx) {
    const transport = transportGate(req); if (transport) return transport;
    const url = new URL(req.url), p = url.pathname, origin = httpsOrigin(url);
    try {
      if (isBackupPath(p)) return backupControl(req, env, p);
      if (env.ENV_NAME === "selfhost" && env.BACKUP_MAINTENANCE === "1")
        return p === "/health" ? json({ ok: true, maintenance: true }) : json({ error: "Backup maintenance is active." }, 503);
      if (!eeRouteEnabled(env, p)) return json({ error: "not found" }, 404);
      // These cookie and sign-in endpoints are reached from the server's own pages. Reject a supplied
      // sibling-site or sandboxed Origin before it can start or finish a sign-in or change onboarding state.
      if (req.method === "POST" && (p === "/auth/start" || p === "/auth/code" || p === "/auth/logout" || p === "/onboard" || p.startsWith("/onboard/"))) {
        const requestOrigin = req.headers.get("origin");
        if (requestOrigin && requestOrigin !== origin) return json({ error: "forbidden" }, 403);
      }
      // Release controls, parity notes and the Kanban proxy use the admin's session cookie on dev.
      // Require the exact page origin for writes, including requests from sibling 1Helm hosts.
      if (env.ENV_NAME === "dev" && !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
          (p === "/kanban" || p.startsWith("/kanban/") || p === "/parity" || p.startsWith("/parity/") || p === "/releases" || p.startsWith("/releases/")) &&
          req.headers.get("origin") !== origin) return json({ error: "forbidden" }, 403);
      if (p === "/health") return json({ ok: true });
      if (p === "/api/mobile/compatibility" && req.method === "GET") {
        const users = await env.DB.prepare("SELECT 1 FROM users LIMIT 1").first();
        const ready = await env.DB.prepare("SELECT 1 FROM tenants WHERE status='active' AND onboarding_completed=1 AND (COALESCE(onboard_step,'')='' OR (onboard_step='done' AND slug_chosen=1)) LIMIT 1").first();
        // The packaged mobile gateway runs at capacitor://localhost or https://localhost and checks
        // a selected remote server before navigating there. This public, cookie-free GET needs CORS.
        return json({ product: "1Helm", mobile_api: 1, version: APP_V, has_users: !!users, setup_complete: !!ready, requires_https: true }, 200, { "access-control-allow-origin": "*" });
      }
      // Explicit re-confirmation is reachable even while an older email/code is pending ("Use a different email").
      if (p === "/onboard/age" && req.method === "GET") return agePage({ next: `/onboard${url.search}` });
      if (p === "/auth/start" && req.method === "POST" && req.headers.get("origin") && req.headers.get("origin") !== origin) return new Response("Not allowed.", { status: 403 });
      // Only this explicit, same-origin acknowledgement sets the remembered browser proof. It receives no email or profile data.
      if (p === "/onboard/age" && req.method === "POST") {
        const o = req.headers.get("origin"), site = req.headers.get("sec-fetch-site");
        if ((o && o !== origin) || site === "cross-site") return new Response("Not allowed.", { status: 403 });
        const f = await boundedForm(req), next = ageNext(String(f.get("next") || "/onboard"));
        if (f.get("adult") !== "yes" || f.get("version") !== AGE_VERSION) return agePage({ next, error: AGE_ERROR.error, status: 400 });
        return new Response(null, { status: 303, headers: { location: next, "set-cookie": await ageCookie(env), "cache-control": "no-store" } });
      }
      // Company/site logos (logo.dev behind it): public on every host, so <img src="/logo/stripe.com"> works anywhere. src/logo.js
      if (p.startsWith("/logo/")) return await logoRoute(req, env, ctx, url);
      // Composio app logos (Connected accounts), cached in R2 + Cache API so a cold logos.composio.dev never leaves blank tiles. src/applogo.js
      if (p.startsWith("/applogo/")) return await appLogoRoute(req, env, ctx, url);
      // Share links (/f/<token>/<name>) and published pages (/p/<name>/) on the person's address, or /s/<slug>/… on the app host.
      // Public, before any sign-in gate; never reads the session cookie. src/share.js, src/publish.js
      if (isPublicShare(env, url)) { const sr = await servePublic(req, env, url); if (sr) return sr; }
      // Dev ops "view as" (src/ops-read.js): that sign-in can only look; every send, change, purchase or private read stops here.
      { const vg = viewAsGate(req, url); if (vg) return vg; }
      // The app's web app manifest (Add to Home Screen / Install app): public, no DB, same for any slug. src/pwa.js
      { const mf = p.match(MANIFEST_RE); if (mf && req.method === "GET") return manifestResponse(mf[1], env.ENV_NAME === "dev"); }
      // The Web Push service worker (scope /w/<slug>/): public and DB-free like the manifest. src/pwa.js
      if (SW_RE.test(p) && req.method === "GET") return swResponse();
      // A configured workspace subdomain: sign-in is handed over from the app host with a one-time token.
      { const domain = String(env.PUBLIC_BASE_DOMAIN || "").toLowerCase();
        const hm = domain && url.hostname.endsWith(`.${domain}`) ? [url.hostname, url.hostname.slice(0, -domain.length - 1)] : null;
        if (hm && url.hostname !== env.APP_HOST) {
          const ht = await env.DB.prepare("SELECT * FROM tenants WHERE slug=?").bind(hm[1]).first();
          if (!ht) return page("Not found", `<p>There's no 1Helm at ${esc(url.hostname)}.</p><p><a href="https://${env.APP_HOST || url.hostname}/">Start your own 1Helm →</a></p>`);
          if (p === "/auth/handoff") {
            if (req.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { allow: "GET" } });
            const tok = await sha256(url.searchParams.get("token") || ""), next = String(url.searchParams.get("next") || "");
            const ml = await env.DB.prepare("UPDATE magic_links SET used=1 WHERE token_hash=? AND used=0 AND expires_at>? RETURNING email").bind(tok, now()).first();
            const hu = ml && await env.DB.prepare("SELECT * FROM users WHERE email=?").bind(ml.email).first();
            if (!hu || hu.id !== ht.owner_user_id) return Response.redirect(`https://${env.APP_HOST || url.hostname}/`, 302);
            const sess = await newSession(env, req, hu.id);
            return new Response(null, { status: 302, headers: { location: next.startsWith(`/w/${ht.slug}/`) ? next : `/w/${ht.slug}/app`, "set-cookie": `hc_session=${sess}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000` } });
          }
          // Signed out (or someone else) at a person's own address → THEIR sign-in page, never the sign-up flow.
          const hu = await currentUser(req, env), owner = hu && hu.id === ht.owner_user_id;
          const hostInfo = { host: url.hostname, appHost: env.APP_HOST || url.hostname, helper: helperName(ht), avatar: Number(ht.helper_avatar || 8) };
          if (p === "/auth/start" && req.method === "POST") {
            // Real and decoy pending cookies must never change this page's appearance or reveal the owner's email.
            const access = await ageAccess(req, env, { allowPending: false });
            if (!access.allowed) return agePage({ next: "/", error: AGE_ERROR.error, status: 403 });
            const email = String((await boundedForm(req)).get("email") || "").trim().toLowerCase();
            if (access.pending && access.pending !== email) return agePage({ next: "/", error: AGE_ERROR.error, status: 403 });
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return hostSignInPage({ ...hostInfo, email, error: "Enter a valid email address." });
            const ou = await env.DB.prepare("SELECT email FROM users WHERE id=?").bind(ht.owner_user_id).first();
            let testLink = "", testCode = "", pending = decoyPending();
            // Only the owner's email gets a link and code; everyone sees the same "check your email" and gets a sign-in cookie
            // (a decoy that matches nothing for any other address), so there's no hint whose 1Helm this is.
            if (ou && ou.email === email) {
              const recent = await env.DB.prepare("SELECT COUNT(*) n FROM magic_links WHERE email=? AND expires_at>?").bind(email, now()).first();
              if (Number(recent?.n || 0) <= 5) {
                const si = await createSignIn(env, email, { age: access.age }); pending = si.pending;
                const link = `${origin}/auth/verify?token=${si.token}`;
                if (eeEnabled(env) && env.TEST_MODE === "1" && /@example\.(com|org|net)$/.test(email)) { testLink = link; testCode = si.code; }
                else { try { await sendMagicLink(env, email, link, si.code); } catch (e) { console.error("host magic link", e?.message); return hostSignInPage({ ...hostInfo, email, error: "We couldn't send the email just now. Try again in a minute." }); } }
              }
            }
            return withCookie(hostSignInPage({ ...hostInfo, email, sent: true, testLink, testCode, wait: RESEND_WAIT }), pendingCookie(pending));
          }
          // The code typed on the "Check your email" page at the person's own address.
          if (p === "/auth/code" && req.method === "POST") {
            const f = await boundedForm(req), email = String(f.get("email") || "").trim().toLowerCase().slice(0, 200);
            const r = await verifyCode(env, req, f.get("code"));
            if (!r.email) return hostSignInPage({ ...hostInfo, email, sent: true, codeError: r.error, codeKind: r.kind, wait: 0 });
            const cu = await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(r.email).first();
            if (!cu || cu.id !== ht.owner_user_id) return hostSignInPage({ ...hostInfo, email, sent: true, codeError: "That code isn't right. Check the newest email from 1Helm and try again.", codeKind: "wrong", wait: 0 });
            return signedIn(env, req, r.email, { location: `/w/${ht.slug}/app`, age: r.age });
          }
          if (!owner && (p === "/" || p === "/onboard") && !(await ageAccess(req, env, { allowPending: false })).allowed) return agePage({ next: "/" });
          if (p === "/" || p === "/onboard") return owner ? Response.redirect(`${origin}/w/${ht.slug}/app${url.search}`, 302) : hostSignInPage(hostInfo);
          const open = p === "/auth/verify" || p === "/auth/code" || p === "/auth/handoff" || p === "/auth/logout" || p === "/auth/email-change" || p === "/health" || p.startsWith("/hooks/") || p === "/stripe/webhook" ||
            p.startsWith("/app-static/") || p.startsWith("/onboard/") || p.startsWith("/fonts/") || p.startsWith("/av/") || p.startsWith("/c/") || /^\/1helm-(icon|sailboat)/.test(p);
          if (!owner && !open) {
            if (p.includes("/api/")) return json({ error: "signed_out" }, 401);
            if (!(await ageAccess(req, env, { allowPending: false })).allowed) return agePage({ next: "/" });
            return hostSignInPage(hostInfo);
          }
          if (p.startsWith("/w/") && !p.startsWith(`/w/${ht.slug}/`) && !p.startsWith(`/w/${ht.slug}`)) return Response.redirect(`https://${env.APP_HOST || url.hostname}${p}${url.search}`, 302);
        }
      }
      { const ph = p.match(/^\/hooks\/photon\/([0-9a-f]{32})$/); if (ph && req.method === "POST") return textingWebhook(req, env, ctx, ph[1]); }
      // Hosted card page (a card reply sent by text opens here inside Messages; no login, token-gated). See src/cards.js.
      if (p.startsWith("/c/")) { const cr = await cardRoute(req, env, ctx, url); if (cr) return cr; }
      // The app catalog for the Composio version this server uses (connect-offer.js catalogFile): same URL, the latest list when
      // COMPOSIO_TOOLKIT_VERSION="latest".
      // The Apps popup loads this list, so it is filtered here by the same rules as find_app (app-visibility.js): hidden apps never reach the app.
      if (env.ASSETS && (p === "/app-static/integrations.json" || p === "/app-static/integrations-latest.json")) {
        const u = new URL(req.url); if (p === "/app-static/integrations.json") u.pathname = `/app-static/${catalogFile(env)}`;
        const r = await env.ASSETS.fetch(new Request(u, req));
        if (!r.ok) return r;
        const h = new Headers(r.headers); h.delete("content-length"); h.delete("content-encoding"); h.delete("etag");
        return versionedAsset(url, new Response(JSON.stringify(visibleCatalog(await r.json())), { status: 200, headers: h }));
      }
      if ((p === "/onboard/v1/" || p === "/onboard/v1/index.html") && !(await ageAccess(req, env, { allowPending: false })).allowed) return agePage();
      if (env.ASSETS && (p.startsWith("/app-static/") || p.startsWith("/onboard-static/") || p.startsWith("/onboard/v1/") || p === "/onboard/kit.js" || p === "/onboard/kit.css" || p.startsWith("/fonts/") || p.startsWith("/av/") || p === "/1helm-sailboat.png" || PWA_ICON_RE.test(p))) return versionedAsset(url, await env.ASSETS.fetch(req));
      if (p === "/admin/reconcile") {
        if (req.method !== "POST" || env.ENV_NAME !== "dev" || env.TEST_MODE !== "1" || req.headers.get("origin") !== origin || !isReleaseAdmin(env, await currentUser(req, env)))
          return json({ error: "not found" }, 404);
        return json(await reconcile(env));
      }

      // Models have their own admin gate on both environments. Writes only touch this environment's D1.
      if (p === "/models" || p.startsWith("/models/")) return modelsRoute(req, env, await currentUser(req, env));

      // Hindsight private-link self-test (dev only; needs the Hindsight API key as a bearer token).
      if (env.ENV_NAME === "dev" && p === "/_ops/hindsight-selftest") {
        if (!env.HINDSIGHT_API_KEY || req.headers.get("authorization") !== `Bearer ${env.HINDSIGHT_API_KEY}`) return new Response("Not found", { status: 404 });
        if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
        try { return Response.json(await hindsightSelfTest(env)); } catch (e) { return Response.json({ error: e.message }, { status: 502 }); }
      }
      // Hindsight bank sweep, on demand (dev only; same bearer key). ?dry=1 reports what would be deleted.
      if (env.ENV_NAME === "dev" && p === "/_ops/hindsight-sweep" && req.method === "POST") {
        if (!env.HINDSIGHT_API_KEY || req.headers.get("authorization") !== `Bearer ${env.HINDSIGHT_API_KEY}`) return new Response("Not found", { status: 404 });
        try { return Response.json(await hsSweep(env, { dry: url.searchParams.get("dry") === "1", graceMs: url.searchParams.has("grace") ? Number(url.searchParams.get("grace")) : undefined })); } catch (e) { return Response.json({ error: e.message }, { status: 502 }); }
      }
      // Dev debugging (src/ops-read.js): read-only JSON on any dev account, and a look-only "view as". Dev + x-ops-key only; else 404.
      if (p.startsWith("/_ops/")) return opsRoute(req, env, url, { archive, ledger, storageOf, storageView, textingStatus, listConnections, holdOf, hsOn, hsRecall, bankId: hsBankId, beeOps });
      // Kanban board (dev only, release admins): Kan behind Workers VPC.
      if (env.ENV_NAME === "dev" && (p === "/kanban" || p.startsWith("/kanban/"))) {
        // Kan's public app shell files (no board data) load without our cookie: browsers fetch the manifest without credentials.
        if (/^\/kanban\/(manifest\.json|favicon\.ico|[\w-]+\.(?:png|svg)|_next\/static\/.+)$/.test(p)) return kanbanProxy(req, env, url, null);
        const u = await currentUser(req, env);
        if (!isReleaseAdmin(env, u)) return u ? page("Not found", "<p>Not found.</p>") : Response.redirect(`${origin}/onboard?next=/kanban/`, 302);
        return kanbanProxy(req, env, url, u);
      }
      // Muse ↔ 1HC review (dev only, release admins): side-by-side docs + the Captain's notes.
      if (env.ENV_NAME === "dev" && (p === "/parity" || p.startsWith("/parity/"))) {
        const u = await currentUser(req, env);
        if (!isReleaseAdmin(env, u)) return u ? page("Not found", "<p>Not found.</p>") : Response.redirect(`${origin}/onboard?next=/parity`, 302);
        return parityRoute(req, env, url, u);
      }
      // Releases + Push (dev only).
      if (env.ENV_NAME === "dev" && (p === "/releases" || p.startsWith("/releases/"))) {
        const u = await currentUser(req, env);
        if (!isReleaseAdmin(env, u)) return u ? page("Not found", "<p>Not found.</p>") : Response.redirect(`${origin}/onboard?next=/releases`, 302);
        const m = p.match(/^\/releases\/(\d+)\/(push|undo)$/);
        if (m && req.method === "POST") { let msg; try { msg = m[2] === "push" ? await pushRelease(env, Number(m[1])) : await undoRelease(env, Number(m[1])); } catch (e) { msg = "Didn't work: " + e.message; } return releasesPage(env, msg); }
        return releasesPage(env);
      }
      // Report an issue (src/reports.js): the admins' list and each screenshot. Same gate as /releases.
      if (env.ENV_NAME === "dev" && (p === "/reports" || p.startsWith("/reports/"))) {
        const u = await currentUser(req, env);
        if (!isReleaseAdmin(env, u)) return u ? page("Not found", "<p>Not found.</p>") : Response.redirect(`${origin}/onboard?next=/reports`, 302);
        const rm = p.match(/^\/reports\/([0-9a-f-]{36})\/shot$/); if (rm) return reportShot(env, rm[1]);
        return reportsPage(env);
      }
      if (p === "/" && req.method === "GET") {
        const u = await currentUser(req, env);
        if (u) {
          const t = await tenantOf(env, u.id);
          if (!t && env.ENV_NAME === "dev" && isReleaseAdmin(env, u)) return Response.redirect(`${origin}/releases`, 302);
          return Response.redirect(`${origin}${t && t.status === "active" && onboarded(t) && onboardDone(t) ? homeUrl(t, "", req) : "/onboard"}`, 302);
        }
        return Response.redirect(`${origin}/onboard${url.search}`, 302);
      }

      if (p === "/auth/start" && req.method === "POST") {
        const access = eeEnabled(env) ? await ageAccess(req, env) : { allowed: true };
        if (!access.allowed) return agePage({ error: AGE_ERROR.error, status: 403 });
        const email = String((await boundedForm(req)).get("email") || "").trim().toLowerCase();
        if (access.pending && access.pending !== email) return agePage({ error: AGE_ERROR.error, status: 403 });
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return eeEnabled(env) ? landingPage({ error: "Enter a valid email address.", email }) : await selfHostedPage(env, { error: "Enter a valid email address.", email });
        if (!eeEnabled(env) && !(await ownerAllowsEmail(env, email))) return page("Sign-in closed", "<p>This server already has an owner.</p>");
        // Real delivery via the configured Cloudflare Email Service. Reserved test addresses (@example.com) in TEST_MODE get an on-screen shortcut.
        const testAddr = eeEnabled(env) && env.TEST_MODE === "1" && /@example\.(com|org|net)$/.test(email);
        if (!testAddr) {
          const recent = await env.DB.prepare("SELECT COUNT(*) n FROM magic_links WHERE email=? AND expires_at>?").bind(email, now()).first();
          if (Number(recent?.n || 0) > 5) return checkEmailPage(email, "", false, { error: "We just sent you a few links. Check your inbox (and spam) for the newest one.", wait: 0, emailFrom: env.EMAIL_FROM });
        }
        const si = await createSignIn(env, email, { age: access.age }), link = `${origin}/auth/verify?token=${si.token}`;
        if (testAddr) return withCookie(checkEmailPage(email, link, true, { testCode: si.code, wait: RESEND_WAIT, emailFrom: env.EMAIL_FROM }), pendingCookie(si.pending));
        try { await sendMagicLink(env, email, link, si.code); }
        catch (e) { console.error("magic link send failed", e?.code, e?.message); return eeEnabled(env) ? landingPage({ error: "We couldn't send your sign-in email just now. Try again in a minute.", email }) : await selfHostedPage(env, { error: "We couldn't send your sign-in email just now. Try again in a minute.", email }); }
        return withCookie(checkEmailPage(email, "", false, { wait: RESEND_WAIT, emailFrom: env.EMAIL_FROM }), pendingCookie(si.pending));
      }
      // The code from the sign-in email, typed on the "Check your email" page (src/signin-code.js).
      if (p === "/auth/code" && req.method === "POST") {
        const f = await boundedForm(req), email = String(f.get("email") || "").trim().toLowerCase().slice(0, 200);
        const r = await verifyCode(env, req, f.get("code"));
        if (!r.email) return checkEmailPage(email, "", false, { codeError: r.error, codeKind: r.kind, wait: 0, emailFrom: env.EMAIL_FROM });
        return signedIn(env, req, r.email, { location: `${origin}/`, age: r.age });
      }

      if (p === "/auth/to" && req.method === "GET") {
        const u = await currentUser(req, env), t = u && await tenantOf(env, u.id), next = String(url.searchParams.get("next") || "");
        if (!u || !t) return Response.redirect(`${origin}/onboard`, 302);
        const path = next.startsWith(`/w/${t.slug}/`) ? next : `/w/${t.slug}/app`;
        if (Number(t.host_ready) !== 1 || !eeEnabled(env) || !env.PUBLIC_BASE_DOMAIN || url.hostname !== env.APP_HOST || nativeMobile(req)) return Response.redirect(`${origin}${path}`, 302);
        const tok = rand(); await env.DB.prepare("INSERT INTO magic_links (token_hash,email,expires_at) VALUES (?,?,?)").bind(await sha256(tok), u.email, now() + 60e3).run();
        return Response.redirect(`https://${t.slug}.${env.PUBLIC_BASE_DOMAIN}/auth/handoff?token=${tok}&next=${encodeURIComponent(path)}`, 302);
      }

      if (p === "/auth/logout" && req.method === "POST") {
        // A failed revoke must not look like a logout: the browser keeps its cookie and is told to try again.
        try { await endSession(env, req); }
        catch { return json({ error: "We couldn't log you out. Please try again." }, 503); }
        return new Response(null, { status: 204, headers: { "set-cookie": "hc_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0", "cache-control": "no-store" } });
      }

      // Changing the sign-in email: the one-time link sent to the new address (src/account.js). Works signed out, on any device.
      if (p === "/auth/email-change") return await emailChangeRoute(req, env, url, { stripe });

      if (p === "/auth/verify") {
        if (req.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { allow: "GET" } });
        const h = await sha256(url.searchParams.get("token") || "");
        const ml = await env.DB.prepare("UPDATE magic_links SET used=1 WHERE token_hash=? AND used=0 AND expires_at>? RETURNING email,age_version,age_confirmed_at").bind(h, now()).first();
        if (!ml) return expiredPage();
        const pl = url.searchParams.get("plan");
        return signedIn(env, req, ml.email, { location: eeEnabled(env) && PLANS[pl] ? `${origin}/onboard?plan=${pl}` : `${origin}/`, status: 302, age: ml.age_version ? { version: ml.age_version, at: ml.age_confirmed_at } : null });
      }

      // The approved onboarding is the sign-up page for everyone ("Sign up" / "Choose plan").
      if (p === "/onboard" && req.method === "GET") {
        const u = await currentUser(req, env), t = u && await tenantOf(env, u.id);
        if (!eeEnabled(env)) return u && t ? Response.redirect(`${origin}${homeUrl(t, "", req)}`, 302) : await selfHostedPage(env);
        if (t && t.status === "active" && onboarded(t) && onboardDone(t)) return Response.redirect(`${origin}${homeUrl(t, "", req)}`, 302);
        if (!u && !(await ageAccess(req, env)).allowed) return agePage({ next: `/onboard${url.search}` });
        const r = await env.ASSETS.fetch(new Request(`${origin}/onboard/v1/index.html`));
        return new Response((await r.text()).replaceAll("__V__", ONBOARD_V), { headers: { "content-type": "text/html;charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
      }
      if (p.startsWith("/onboard/api/")) return await onboardApi(req, env, url, p.slice("/onboard/api/".length));
      if (!eeEnabled(env) && (p === "/onboard" || p.startsWith("/onboard/"))) return json({ error: "not found" }, 404);

      const imp = p.match(/^\/import\/([0-9a-f-]{36})\.([0-9a-f]{16})(\/.*)$/);
      if (imp) return handleImport(req, env, imp[1], `${imp[1]}.${imp[2]}`, imp[3]);

      // Composio's project webhook (stage 5): app events for "when … happens" workflows. No cookie: the webhook signature is the check.
      if (p === "/composio/webhook") return composioWebhook(req, env, ctx);

      const user = await currentUser(req, env);
      if (!user && p !== "/stripe/webhook") return Response.redirect(`${origin}/`, 302);

      // Back from signing in to the person's own Composio account (Self-managed apps, composio-self.js). The state must match the cookie
      // this browser got when it started, and belong to the signed-in person's workspace.
      if (p === "/composio/callback" && req.method === "GET") {
        const t = await tenantOf(env, user.id), sp = url.searchParams;
        const cookieState = (req.headers.get("cookie") || "").match(/(?:^|;\s*)hc_cmp=([A-Za-z0-9_-]+)/)?.[1] || "";
        const r = await signInFinish(env, { code: sp.get("code") || "", state: sp.get("state") || "", error: sp.get("error") || "", cookieState, tenantId: t?.id || "" }).catch((e) => ({ error: "Composio didn't finish the sign-in. Try again.", why: e.message }));
        if (r.why) console.log("composio callback", String(r.why).slice(0, 160));
        const clear = { "set-cookie": "hc_cmp=; Path=/composio; HttpOnly; Secure; SameSite=Lax; Max-Age=0", "cache-control": "no-store" };
        const back = String(r.back || "");
        if (back === "close" || !t) return new Response(composioDonePage(r, ONBOARD_V), { headers: { "content-type": "text/html;charset=utf-8", ...clear } });
        const to = back === "/onboard" || back.startsWith(`/w/${t.slug}/`) ? back : `/w/${t.slug}/app?settings=accounts`;
        const q = r.ok ? "cmp=ok" : `cmp=failed&status=failed&cmperr=${encodeURIComponent(r.error || "")}`;
        return new Response(null, { status: 302, headers: { location: `${origin}${to}${to.includes("?") ? "&" : "?"}${q}`, ...clear } });
      }

      if (p === "/onboard/status" && req.method === "GET") {
        const t = await tenantOf(env, user.id), next = onboardNext(t);
        return json({ status: t?.status || "new", next });
      }

      if (p === "/onboard/slug" && req.method === "GET") {
        const slug = String(url.searchParams.get("value") || "").trim().toLowerCase();
        if (!slugValid(slug)) return json({ available: false, reason: "Use 3–48 lowercase letters, numbers, or single hyphens." });
        const t = await tenantOf(env, user.id), taken = await env.DB.prepare("SELECT owner_user_id FROM tenants WHERE slug=?").bind(slug).first();
        return json({ available: !taken || taken.owner_user_id === user.id, reason: taken && taken.owner_user_id !== user.id ? "That address is already taken." : null, current: t?.slug || null });
      }

      if ((p === "/onboard/profile" || p === "/onboard/helper" || p === "/onboard/plan") && req.method === "GET") return Response.redirect(`${origin}/onboard${url.search}`, 302);
      if (p === "/onboard/plan" && req.method === "GET") {
        const t = await tenantOf(env, user.id);
        if (!t) return Response.redirect(`${origin}/onboard`, 302);
        if (t.status === "active") return Response.redirect(`${origin}${onboardNext(t) || "/onboard"}`, 302);
        return onboardPage("plan", { slug: t.slug, domain: env.PUBLIC_BASE_DOMAIN, plan: planKey(t.plan), plans: PLANS, testMode: env.STRIPE_MODE !== "live" });
      }
      if (p === "/onboard/plan" && req.method === "POST") {
        const t = await tenantOf(env, user.id), plan = String((await boundedForm(req)).get("plan") || "");
        if (!t) return Response.redirect(`${origin}/onboard`, 303);
        if (t.status === "active") return Response.redirect(`${origin}${onboardNext(t) || "/onboard"}`, 303);
        if (!privacyView(t).chosen) return Response.redirect(`${origin}/onboard`, 303);   // the AI data privacy choice comes first (the v1 onboarding asks it)
        if (!PLANS[plan] || !planPrices(env)[plan]) return onboardPage("plan", { slug: t.slug, domain: env.PUBLIC_BASE_DOMAIN, plan: planKey(t.plan), plans: PLANS, testMode: env.STRIPE_MODE !== "live", error: "Choose one of the plans." });
        await env.DB.prepare("UPDATE tenants SET plan=?,updated_at=? WHERE id=?").bind(plan, now(), t.id).run();
        const cs = await stripe(env, "checkout/sessions", {
          mode: "subscription", customer_email: user.email, client_reference_id: t.id,
          "line_items[0][price]": planPrices(env)[plan], "line_items[0][quantity]": 1,
          success_url: `${origin}/onboard?paid=1`, cancel_url: `${origin}/onboard/plan`,
          metadata: { app: "1hc-proto", tenant_id: t.id, plan }, subscription_data: { metadata: { app: "1hc-proto", tenant_id: t.id, plan } },
          payment_method_collection: "always" });
        return Response.redirect(cs.url, 303);
      }
      if ((p === "/onboard" || p === "/onboard/profile" || p === "/onboard/helper") && req.method === "GET") {
        const t = await tenantOf(env, user.id);
        if (t && t.status === "active" && onboarded(t)) return Response.redirect(`${origin}/w/${t.slug}/app`, 302);
        if (p === "/onboard" && url.searchParams.get("paid") && t?.status !== "active") return onboardPage("waiting");
        if (!t || t.status !== "active") return onboardPage("address", { slug: t?.slug || "", plan: t?.plan || "plus", domain: env.PUBLIC_BASE_DOMAIN });
        if (p === "/onboard/helper" && t.first_name) return onboardPage("helper", { helperName: helperName(t), avatar: t.helper_avatar || 8 });
        if (t.first_name && p === "/onboard") return Response.redirect(`${origin}/onboard/helper`, 302);
        return onboardPage("profile", { firstName: t.first_name || "" });
      }

      if (p === "/onboard" && req.method === "POST") {
        const fd = await boundedForm(req), slug = String(fd.get("slug") || "").trim().toLowerCase(), plan = planKey(String(fd.get("plan") || "plus"));
        if (!slugValid(slug)) return onboardPage("address", { slug, plan, domain: env.PUBLIC_BASE_DOMAIN, error: "Use 3–48 lowercase letters, numbers, or single hyphens." });
        let t = await tenantOf(env, user.id);
        if (t?.status === "active") return Response.redirect(`${origin}${onboardNext(t) || "/onboard"}`, 303);
        if (!t) {
          const id = crypto.randomUUID();
          const r = await env.DB.prepare("INSERT INTO tenants (id,slug,owner_user_id,created_at,updated_at) SELECT ?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE slug=?)").bind(id, slug, user.id, now(), now(), slug).run();
          if (!r.meta.changes) return onboardPage("address", { slug, plan, domain: env.PUBLIC_BASE_DOMAIN, error: "That address is already taken." });
          t = { id, slug };
        } else if (t.slug !== slug) {
          const r = await env.DB.prepare("UPDATE tenants SET slug=?,updated_at=? WHERE id=? AND NOT EXISTS (SELECT 1 FROM tenants WHERE slug=?)").bind(slug, now(), t.id, slug).run();
          if (!r.meta.changes) return onboardPage("address", { slug, plan, domain: env.PUBLIC_BASE_DOMAIN, error: "That address is already taken." });
          t = { ...t, slug };
        }
        if (!fd.get("plan")) return Response.redirect(`${origin}/onboard/plan`, 303);
        await env.DB.prepare("UPDATE tenants SET plan=?,updated_at=? WHERE id=?").bind(plan, now(), t.id).run();
        const cs = await stripe(env, "checkout/sessions", {
          mode: "subscription", customer_email: user.email, client_reference_id: t.id,
          "line_items[0][price]": planPrices(env)[plan], "line_items[0][quantity]": 1,
          success_url: `${origin}/onboard?paid=1`, cancel_url: `${origin}/onboard`,
          metadata: { app: "1hc-proto", tenant_id: t.id, plan }, subscription_data: { metadata: { app: "1hc-proto", tenant_id: t.id, plan } },
          payment_method_collection: "always" });
        return Response.redirect(cs.url, 303);
      }

      if (p === "/onboard/profile" && req.method === "POST") {
        const t = await tenantOf(env, user.id);
        if (!t || t.status !== "active") return Response.redirect(`${origin}/onboard`, 303);
        if (onboarded(t)) return Response.redirect(`${origin}/w/${t.slug}/app`, 303);
        const firstName = cleanName((await boundedForm(req)).get("first_name"), 80);
        if (!firstName) return onboardPage("profile", { error: "Enter the name you want your helper to use." });
        await env.DB.prepare("UPDATE tenants SET first_name=?,updated_at=? WHERE id=?").bind(firstName, now(), t.id).run();
        return Response.redirect(`${origin}/onboard/helper`, 303);
      }

      if (p === "/onboard/helper" && req.method === "POST") {
        const t = await tenantOf(env, user.id);
        if (!t || t.status !== "active") return Response.redirect(`${origin}/onboard`, 303);
        if (onboarded(t)) return Response.redirect(`${origin}/w/${t.slug}/app`, 303);
        const f = await boundedForm(req), helperName = cleanName(f.get("helper_name"), 40), avatar = Number(f.get("helper_avatar"));
        if (!helperName || !Number.isInteger(avatar) || avatar < 1 || avatar > 9) return onboardPage("helper", { helperName, avatar: avatar || 8, error: "Choose a helper and give them a name." });
        await archive(env, t.id).provisionFresh();
        await env.DB.prepare("UPDATE tenants SET helper_name=?,helper_avatar=?,onboarding_completed=1,provisioned_at=COALESCE(provisioned_at,?),updated_at=? WHERE id=?").bind(helperName, avatar, now(), now(), t.id).run();
        return Response.redirect(`${origin}/w/${t.slug}/app?welcome=1`, 303);
      }

      if (p === "/stripe/webhook" && req.method === "POST") {
        let raw;
        try { raw = await boundedText(req, 1_000_000); }
        catch (e) { return json({ error: e instanceof BodyTooLargeError ? "too large" : "bad body" }, e instanceof BodyTooLargeError ? 413 : 400); }
        if (!(await verifyStripe(env, raw, req.headers.get("stripe-signature")))) return json({ error: "bad signature" }, 400);
        const ev = JSON.parse(raw);
        // A reserved ID is not delivered yet. A concurrent retry must not get a
        // success response until the handler finishes; an abandoned reservation
        // can be reclaimed after its lease so a crashed Worker cannot lose it.
        const started = now(), reservation = -started;
        const fresh = await env.DB.prepare("INSERT OR IGNORE INTO stripe_events (id,type,received_at) VALUES (?,?,?)").bind(ev.id, ev.type, reservation).run();
        if (!fresh.meta.changes) {
          const seen = await env.DB.prepare("SELECT received_at FROM stripe_events WHERE id=?").bind(ev.id).first();
          if (Number(seen?.received_at) > 0) return json({ duplicate: true });
          if (!seen || -Number(seen.received_at) > started - 2 * 60_000) return json({ error: "retry" }, 503);
          const reclaimed = await env.DB.prepare("UPDATE stripe_events SET received_at=? WHERE id=? AND received_at=?")
            .bind(reservation, ev.id, seen.received_at).run();
          if (!reclaimed.meta.changes) return json({ error: "retry" }, 503);
        }
        const o = ev.data.object;
        try {
        if (ev.type === "checkout.session.completed" && o.metadata?.app === "1hc-proto" && o.mode === "subscription") {
          await env.DB.prepare("UPDATE tenants SET stripe_customer=?,stripe_subscription=?,updated_at=? WHERE id=?").bind(o.customer, o.subscription, now(), o.metadata.tenant_id).run();
        }
        if (ev.type === "invoice.payment_failed") {
          let sub = o.parent?.subscription_details?.subscription || o.subscription;
          // A declined upgrade or storage add (pending_if_incomplete: plan-change.js, storage.js) changes nothing, so the account isn't past due
          // unless Stripe says the subscription itself is.
          if (sub && o.billing_reason === "subscription_update") { const so = await stripe(env, `subscriptions/${sub}`, {}, "GET").catch(() => null); if (so && !["past_due", "unpaid"].includes(so.status)) sub = null; }
          if (sub) await env.DB.prepare("UPDATE tenants SET status=CASE WHEN status='suspended' THEN status ELSE 'past_due' END, past_due_since=COALESCE(past_due_since,?), updated_at=? WHERE stripe_subscription=?").bind(now(), now(), sub).run();
          // Read-only from this moment; data kept to the end of the paid period, then 7 days, then deleted. Email + text (pastdue.js).
          if (sub) await holdFromFailure(env, sub, o, {});
        }
        if (ev.type === "invoice.paid") {
          const sub = o.parent?.subscription_details?.subscription || o.subscription;
          const tid = o.parent?.subscription_details?.metadata?.tenant_id || (sub && (await env.DB.prepare("SELECT id FROM tenants WHERE stripe_subscription=?").bind(sub).first())?.id);
          if (tid) {
            await env.DB.prepare("UPDATE tenants SET status='active',past_due_since=NULL,stripe_customer=?,stripe_subscription=?,updated_at=? WHERE id=?").bind(o.customer, sub || "", now(), tid).run();
            await notePaid(env, tid, o);   // pastdue.js: how far they've paid; a scheduled deletion for non-payment is cancelled
            // Which plan this invoice pays for: the regular line on create/renewal; on an upgrade (all proration lines) the positive line.
            // Only plan lines count here: extra storage (storage.js) is its own item on the same subscription and never buys usage.
            const lines = o.lines?.data || [], priceOf = (l) => l?.pricing?.price_details?.price || l?.price?.id;
            const isPro = (l) => !!(l.proration || l.parent?.subscription_item_details?.proration), planLines = lines.filter((l) => planOfPrice(env, priceOf(l)));
            const line = planLines.find((l) => !isPro(l)) || planLines.filter((l) => isPro(l) && l.amount > 0).sort((a, b) => b.amount - a.amount)[0];
            const paidPlan = planOfPrice(env, priceOf(line)) || planKey((await env.DB.prepare("SELECT plan FROM tenants WHERE id=?").bind(tid).first())?.plan);
            await env.DB.prepare("UPDATE tenants SET plan=? WHERE id=?").bind(paidPlan, tid).run();
            if (o.billing_reason === "subscription_update") {
              // Upgrade mid-month: every plan is usage + the same $10, so the prorated price difference IS the extra usage. Grant exactly what was paid (before tax); it expires with the period like the rest.
              const net = planLines.reduce((a, l) => a + Number(l.amount || 0), 0);   // before tax; storage lines left out
              if (net > 0) await ledger(env, tid).grant(`invoice:${o.id}`, net * 1e7, "included");
            } else if (o.amount_paid > 0 || o.billing_reason === "subscription_create") await ledger(env, tid).grantIncluded(`invoice:${o.id}`, PLANS[paidPlan].usage * 1e9);
          }
        }
        if (ev.type === "customer.subscription.updated" || ev.type === "customer.subscription.deleted") {
          const status = { active: "active", trialing: "active", past_due: "past_due", unpaid: "suspended", canceled: "suspended", incomplete_expired: "suspended" }[o.status];
          if (status && o.metadata?.app === "1hc-proto") await applySubStatus(env, o.id, ev.type === "customer.subscription.deleted" ? "canceled" : o.status);
          // Past due / unpaid / ended for non-payment with no hold yet (a missed invoice.payment_failed): start it. On Stripe's current state.
          if (o.metadata?.app === "1hc-proto" && (["past_due", "unpaid"].includes(o.status) || ev.type === "customer.subscription.deleted")) {
            const tt = await env.DB.prepare("SELECT * FROM tenants WHERE stripe_subscription=?").bind(o.id).first();
            if (tt) await pastdueSync(env, tt, ev.type === "customer.subscription.deleted" ? o : await stripe(env, `subscriptions/${o.id}`, {}, "GET").catch(() => o), {});
          }
        }
        // Extra storage blocks follow the storage item's quantity on the subscription (storage.js).
        if (ev.type === "customer.subscription.updated" && o.object === "subscription") {
          const tid = (await env.DB.prepare("SELECT id FROM tenants WHERE stripe_subscription=?").bind(o.id).first())?.id;
          if (tid) await syncBlocks(env, tid, await stripe(env, `subscriptions/${o.id}`, {}, "GET").catch(() => o)).catch((e) => console.log("storage blocks sync", tid, e.message));
        }
        if (ev.type === "payment_intent.succeeded" && o.metadata?.app === "1hc-proto" && o.metadata?.kind === "topup") {
          await ledger(env, o.metadata.tenant_id).grant(`pi:${o.id}`, o.amount * 1e7, "topup"); // cents → nano$
        }
        // Cancel at period end: a portal cancel/renew, and customer.subscription.deleted → delete the account once (src/cancel.js).
        await cancelWebhook(env, ev, { stripe });
        await env.DB.prepare("UPDATE stripe_events SET received_at=? WHERE id=? AND received_at=?").bind(now(), ev.id, reservation).run();
        } catch (e) {
          // Give the event id back so Stripe's retry is processed (every step above is safe to run twice), and tell Stripe to retry.
          console.error("stripe webhook", ev.type, ev.id, e?.message);
          await env.DB.prepare("DELETE FROM stripe_events WHERE id=? AND received_at=?").bind(ev.id, reservation).run().catch(() => {});
          return json({ error: "retry" }, 500);
        }
        return json({ ok: true });
      }

      const w = p.match(/^\/w\/([a-z0-9-]+)(\/.*)?$/);
      if (w) {
        const t = await env.DB.prepare("SELECT * FROM tenants WHERE slug=?").bind(w[1]).first();
        if (!t || t.owner_user_id !== user.id) return page("Not found", "<p>No 1Helm at this address for your account.</p>");
        if (t.status === "pending_payment" || !onboarded(t)) return Response.redirect(`${origin}/onboard`, 302);
        const access = accessOf(t, env, t.status === "active" ? null : await holdOf(env, t.id));
        const L = ledger(env, t.id), sub = w[2] || "/";
        if (!eeRouteEnabled(env, sub, "workspace")) return json({ error: "not found" }, 404);
        // Workspace API calls from another page origin cannot use the owner's cookie, including same-site sibling hosts
        // and sandboxed published pages (Origin: null). Native clients load the selected server as their page origin.
        const requestOrigin = req.headers.get("origin");
        if (sub.startsWith("/api/") && requestOrigin && requestOrigin !== origin) return json({ error: "forbidden" }, 403);

        // The old classic page (and its channel pages, below): nobody should land there, so they go to the app, query kept.
        // ?classic=1 still opens them (a debugging escape; nothing in the app or the tests needs them).
        const classic = eeEnabled(env) && url.searchParams.get("classic") === "1";
        if (sub === "/" ) return classic ? page(`${t.slug} · 1Helm`, workspaceHtml(t, env)) : Response.redirect(appUrl(origin, t, url.search), 302);
        // The v3 app on real data, pointed at this workspace's API.
        if (sub === "/app" || sub === "/app/") return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<link rel="icon" type="image/png" href="${iconName("/1helm-icon-64.png", env.ENV_NAME === "dev")}">${pwaHead(t.slug, env.ENV_NAME === "dev")}<title>1Helm</title><meta name="theme-color" content="#f3f2ef" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#121212" media="(prefers-color-scheme: dark)"><link rel="preload" href="/fonts/instrument-sans.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/fonts/instrument-serif.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="/app-static/style.css?v=${APP_V}"></head>
<body><nav id="rail"></nav><aside id="side"></aside><main id="stage"></main><div id="m"></div><div id="sheet"></div>
<script>window.__1HC=${scriptJson({ v: APP_V, api: `/w/${t.slug}/api`, slug: t.slug, classic: `/w/${t.slug}/?classic=1`, person: t.first_name || "", email: user.email, support: env.SUPPORT_EMAIL || env.EMAIL_FROM, helper: helperName(t), avatar: Number(t.helper_avatar || 8) })}</script><script>${BOOT_EARLY}</script><script type="module" src="/app-static/app.js?v=${APP_V}"></script></body></html>`, { headers: { "content-type": "text/html;charset=utf-8", "cache-control": "no-store" } });
        // Deleting a chat, a channel or the account (deletion.js). Before the access check: deleting always works, even unpaid.
        { const dr = await deletionRoute(req, env, t, url, sub); if (dr) return dr; }
        // Settings → General → Your account: name, sign-in email, signed-in devices (account.js). Also before the access check.
        { const ar = await accountRoute(req, env, t, user, url, sub, { stripe }); if (ar) return ar; }
        // Everything the app needs on load: channels (from the imported archive) + each channel's tasks, jobs and memory.
        // Global focus timer (pomodoro.js): /api/pomodoro/global (GET the timer · POST {action: start|pause|resume|skip|stop, replace?, work_min…}); not tied to any task or channel.
        if (sub === "/api/pomodoro/global") {
          if (req.method !== "GET" && req.method !== "POST") return json({ error: "method" }, 405);
          const b = req.method === "GET" ? { action: "get" } : await boundedJson(req); const d = await archive(env, t.id).pomoGlobalAction(b, "person");
          return json(d, d.error ? (d.code === "running" ? 409 : 400) : 200);
        }
        if (sub === "/api/app/boot") {
          const A = archive(env, t.id), light = url.searchParams.get("light") === "1";
          // The person's time zone, for calendar schedules: the app sends its own (Intl), else Cloudflare's guess from their network.
          // A dev ops "view as" only looks: it never sets their time zone, offers the interview or marks a notice seen.
          const look = !!viewAsToken(req), tzIn = look ? "" : String(url.searchParams.get("tz") || req.cf?.timezone || "").slice(0, 64);
          let chans = (await A.channels()).filter((c) => c.kind !== "dm");
          // Self-heal: an account that finished setup must always have General (accounts made before provisioning existed had none).
          if (!chans.length) { await A.provisionFresh(); chans = (await A.channels()).filter((c) => c.kind !== "dm"); }
          // Get to know you (interview.js): offered once per person as a task in General; never again once it exists.
          const iv = light ? null : look ? await interviewRow(env, t.id).catch(() => null) : await interviewEnsure(env, t, tzIn).catch((e) => { console.log("interview", e.message); return null; });
          const out = await Promise.all(chans.map(async (c) => {
            const slug = c.slug || c.name, R = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${t.id}:${slug}`));
            await R.bind(t.id, slug, String(c.id), tzIn);
            const [d, sessions, wfs, files, later] = await Promise.all([light ? null : A.channel(c.id, 1), R.listSessions(), R.listWorkflows(), R.listFiles(), R.laterList().catch(() => [])]);
            return { id: c.id, slug, name: c.name, purpose: c.purpose || c.topic || "", sessions, files, later,
              // Everything on a schedule (the app's one "Scheduled" view): repeating jobs (active or paused) and one-time follow-ups still to come.
              jobs: wfs.filter((w) => (w.kind === "workflow" && (w.status === "active" || w.status === "paused")) || (w.kind === "followup" && w.status === "active"))
                .map((w) => ({ id: w.id, kind: w.kind, name: w.name, every: w.interval_seconds, when: w.when || null, next: w.next_run, runs: w.run_count, status: w.status, session: w.session || null,
                  ...(w.event ? { on: w.event.label, account: w.event.account || null } : {}) })),   // runs when an app event happens (app-events.js)
              ...(light ? {} : { memory: (d.memory || []).filter((m) => m.status !== "superseded").map((m) => String(m.content)),
                notes: (d.memory || []).filter((m) => m.status !== "superseded").map((m) => ({ id: String(m.id), sec: m.sec || "", text: String(m.content), at: Number(m.edited || m.created) || 0, you: m.author_type === "human", ...(m.src ? { src: m.src } : {}) })) }) };
          }));
          const ls = await L.state(), used = Math.max(0, Number(ls.spent_nano || 0)), granted = Math.max(1, Number(ls.granted_nano || 0));
          const tryNull = async (f) => { try { return await f(); } catch { return null; } };
          const gi = await tryNull(() => L.guardInfo()), notice = await tryNull(() => L.noticePending());   // spendguard.js: this month's meter + a 50/80% notice not yet seen
          const month = gi?.allowance_nano ? { pct: gi.pct, used: guardUsd(gi.period_spent_nano), allowance: guardUsd(gi.allowance_nano) } : null;
          const contacts = light ? undefined : await A.peopleList().catch(() => []), contactDups = light ? undefined : await A.peopleDups().catch(() => []);
          const storage = await tryNull(async () => storageView(await storageOf(env, t)));   // storage.js: the meter + a one-time 80% / full notice
          const publicStorage = storage && { used: storage.used, limit: storage.limit, pct: storage.pct, full: storage.full, by: storage.by, labels: storage.labels,
            used_text: storage.used_text, limit_text: storage.limit_text, counted_at: storage.counted_at, notice: storage.notice };
          if (access.reason === "payment_failed" && !look) await pastdueSeen(env, t.id, tzIn);   // its reminder emails use their time zone
          const account = eeEnabled(env)
            ? { plan: PLANS[planKey(t.plan)].name, plan_key: planKey(t.plan), price: PLANS[planKey(t.plan)].price, ...(t.plan === BYOK_PLAN ? { byok: true } : {}), ...(storage ? { storage } : {}), balance: usd(ls.balance_nano), usagePercent: month ? month.pct : Math.min(100, Math.round(used / granted * 100)), ...(month ? { month } : {}), ...(notice ? { notice } : {}), spend_pauses: gi?.spend_pauses === true, shortcuts: shortcutsView(t), show_costs: Number(t.show_costs) === 1, ai_privacy: await privacyBoot(env, t) }
            : { plan: "Self-hosted", plan_key: "byok", price: 0, byok: true, ...(publicStorage ? { storage: publicStorage } : {}), today: ls.today, spend_pauses: gi?.spend_pauses !== false, shortcuts: shortcutsView(t), show_costs: Number(t.show_costs) === 1, ai_privacy: await privacyBoot(env, t) };
          return json({ tenant: t.slug, features: eeFeatures(env), access, flags: { notebook_pages: hsOn(env) }, contacts, contactDups, person: { name: t.first_name || "", email: user.email }, helper: { name: helperName(t), avatar: Number(t.helper_avatar || 8) }, account, ...(light ? {} : { interview: interviewBoot(iv) }), ...(look ? { look: true } : {}), channels: out, pomodoro_global: await A.pomoGlobalView().catch(() => null) });   // look: a dev "view as" (the app never asks it for location or the mic)
        }
        // Share links and published pages (src/share.js): the owner's list, create / revoke, publish / unpublish, offer taps.
        if (sub === "/api/share" || sub.startsWith("/api/share/")) return await shareApi(req, env, t, sub, access);
        // New channel (a project): the app's New channel sheet. channels.js does the work (shared with delegation from General).
        if (sub === "/api/channels" && req.method === "POST") {
          if (access.mode === "read_only") return payRequired(access);
          const b = await boundedJson(req);
          try { return json(await createChannel(env, t, { name: b.name, purpose: b.purpose, by: "person" })); }
          catch (e) { if (!(e instanceof ChannelError)) throw e; return json({ error: e.message, code: e.code, ...(e.existing ? { existing: e.existing } : {}), ...(e.max ? { max: e.max } : {}) }, e.status); }
        }
        // Text with your helper (BYOP Photon). Page + JSON API; setup is per person and needs nothing from 1Helm's side.
        if (sub === "/texting") { const st = await textingStatus(env, t.id); return textingPage({ ...st, helper: helperName(t), avatar: Number(t.helper_avatar || 8), api: `/w/${t.slug}/api`, back: url.searchParams.get("from") === "onboard" && !onboardDone(t) ? "/onboard" : `/w/${t.slug}/app?settings=texting` }); }
        // Connect Google (Composio). Start → Google's own sign-in → back here → wherever they came from (Settings or onboarding).
        if (sub === "/api/google" && req.method === "GET") { try { return json(await googleStatus(env, t.id)); } catch (e) { return json({ status: "unavailable", error: e.message }); } }
        // Google Super (googlesuper) is retired: no new connections, even from a stale cached page. Each Google app connects on its own.
        if (sub === "/api/google/connect" && req.method === "POST") return json({ error: RETIRED_NOTE, retired: true }, 410);
        if (sub === "/api/google/disconnect" && req.method === "POST") { try { return json(await googleDisconnect(env, t.id)); } catch (e) { return json({ error: e.message }); } }
        // Every app (Composio): list this workspace's connected accounts, start a sign-in on the app's own page (always a NEW account, so
        // "Add another" works; an app can hold several), disconnect one account, make one account the app's default.
        if (sub === "/api/apps" && req.method === "GET") {
          const mode = await appsMode(env, t.id);
          try { return json({ accounts: await transportFor(env, t.id).listConnections({ fresh: url.searchParams.get("fresh") === "1" }), mode }); }
          catch (e) { return isEnded(e) ? json({ accounts: [], mode, ended: true }) : json({ accounts: null, mode, error: e.message }); }
        }
        // Managed vs Self-managed (composio-self.js). GET → the side, the Composio sign-in, and (Self-managed) how many apps still sit on
        // 1Helm's account from before. POST { mode } switches (Self-managed without a sign-in → { need_signin, url }); { op: "clear_managed" }
        // deletes those leftover Managed apps at Composio.
        if (sub === "/api/apps/mode") { const r = await appsModeRoute(req, env, t, { readOnly: access.mode === "read_only" ? () => payRequired(access) : null, disconnectAllManaged, managedCount }); if (r) return r; }
        // Start the Composio sign-in (Self-managed): PKCE state in D1 + a cookie for this browser, then Composio's own sign-in page.
        // back: "close" (the onboarding tab), "/onboard", or a path in this workspace. then=self switches to Self-managed once signed in.
        if (sub === "/composio/connect" && req.method === "GET") {
          const raw = String(url.searchParams.get("back") || ""), back = raw === "close" || raw === "/onboard" || raw.startsWith(`/w/${t.slug}/`) ? raw : `/w/${t.slug}/app?settings=accounts`;
          try {
            const r = await signInStart(env, t.id, { back, then: url.searchParams.get("then") === "self" ? "self" : "" });
            return new Response(null, { status: 302, headers: { location: r.url, "set-cookie": `hc_cmp=${r.state}; Path=/composio; HttpOnly; Secure; SameSite=Lax; Max-Age=900`, "cache-control": "no-store" } });
          } catch (e) { return page("Composio", `<p>${esc(e.message)}</p>`); }
        }
        if (sub === "/apps/paypal/setup") {
          if (viewAsToken(req)) return json({ error: "Read-only view." }, 403);
          if (access.mode === "read_only") return payRequired(access);
          return paypalSetupRoute(req, env, t);
        }
        if (sub === "/api/apps/connect" && req.method === "POST") {
          const b = await boundedJson(req), app = String(b.app || "").toLowerCase().replace(/[^a-z0-9_]/g, ""), from = b.from === "apps" ? "apps" : b.from === "onboard" ? "onboard" : b.from === "offer" ? "offer" : "settings";
          if (!app) return json({ error: "Which app?" }, 400);
          if (RETIRED_APPS.has(app)) return json({ error: RETIRED_NOTE, retired: true }, 410);
          // The "Reconnect Composio" card (Self-managed sign-in ended): sign in again, then back into the task.
          // Hidden apps (Cloudflare toolkits other than Cloudflare MCP, the deny list) and Soon apps they aren't connected to can't be connected (app-visibility.js).
          if (app !== "composio") { const no = await connectBlock(env, t.id, app); if (no) return json({ error: no, unavailable: true }, 403); }
          if (app === "composio") return json({ url: `/w/${t.slug}/composio/connect?back=${encodeURIComponent(`/w/${t.slug}/apps/done?app=composio&from=${from}${from === "offer" ? offerCallbackQuery(b) : ""}`)}` });
          try { return json(await transportFor(env, t.id).connectLink(app, `${origin}/w/${t.slug}/apps/done?app=${app}&from=${from}${from === "offer" ? offerCallbackQuery(b) : ""}`, { another: b.another === true })); }
          catch (e) { console.log("app connect", app, e.message); return json({ error: `${e.message.includes("can't") || e.message.includes("doesn't") ? e.message : "That app isn't available right now. Try again in a minute."}` }); }
        }
        if (sub === "/api/apps/default" && req.method === "POST") {
          const b = await boundedJson(req);
          try { await setDefaultAccount(env, t.id, String(b.id || "")); return json({ ok: true, accounts: await transportFor(env, t.id).listConnections() }); } catch (e) { return json({ error: e.message }); }
        }
        // Account notes (composio.js): a short plain-text note on one account for the helper ("my work email"). Empty note = delete.
        if (sub === "/api/apps/note" && req.method === "POST") {
          const b = await boundedJson(req);
          if (typeof b.note !== "string" && b.note != null) return json({ error: "A note is plain text." }, 400);
          try { const r = await setAccountNote(env, t.id, String(b.id || ""), b.note || "", "person"); return json({ ok: true, note: r.note, accounts: await transportFor(env, t.id).listConnections() }); } catch (e) { return json({ error: e.message }); }
        }
        if (sub === "/api/apps/disconnect" && req.method === "POST") {
          const b = await boundedJson(req);
          try { const tr = transportFor(env, t.id); await tr.removeConnection(String(b.id || "")); return json({ ok: true, accounts: await tr.listConnections() }); } catch (e) { return json({ error: e.message }); }
        }
        // One app's page (App Store style): full description, how it connects, what the helper can do, and this workspace's connection.
        { const ad = req.method === "GET" && sub.match(/^\/api\/apps\/([a-z0-9_]{1,64})$/);
          if (ad) { try { return json(await appDetail(env, t.id, ad[1])); } catch (e) { if (!e.status) console.log("app detail", ad[1], e.message); return json({ error: e.status ? e.message : "Couldn't load this app right now. Try again in a minute." }, e.status || 502); } } }
        // Settings → Advanced → Custom MCP connections (custom-mcp.js): opt-in, per workspace; every route is scoped to this signed-in owner's workspace.
        { const cm = await customMcpRoute(req, env, { tenantId: t.id, userId: user.id, slug: t.slug, origin }, sub, { denyWrite: () => (access.mode === "read_only" ? payRequired(access) : null), look: !!viewAsToken(req) }); if (cm) return cm; }
        if (sub === "/api/clientlog") return clientLog(req, env, t);   // dev-only diagnostics (src/clientlog.js)
        // Settings → Notifications (src/notify.js) and Help & support → Report an issue (src/reports.js).
        if (sub === "/api/notif" || sub.startsWith("/api/notif/")) { const nr = await notifApi(req, env, t, sub, url); if (nr) return nr; }
        // Meeting reminders for notes (src/meetings.js): the app's banner, and Take notes (a task named after the meeting) / Not now.
        if (sub.startsWith("/api/meetings/")) {
          if (req.method === "POST" && sub.endsWith("/take") && access.mode === "read_only") return payRequired(access);
          const mr = await meetingsApi(req, env, t, sub, url, { mainResident: async (tt) => {
            const chans = await archive(env, tt.id).channels(), ch = chans.find((c) => (c.slug || c.name) === "main") || chans[0]; if (!ch) throw new Error("no General channel");
            const slug = ch.slug || ch.name, R = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${tt.id}:${slug}`)); await R.bind(tt.id, slug, String(ch.id)); return { R, channel: slug };
          } });
          if (mr) return mr;
        }
        if (sub === "/api/report") return reportApi(req, env, t, user, APP_V);
        // Connect offer cards in chat (connect-offer.js): Not now / "Don't suggest connecting apps", and back from a Connect tapped on one.
        if (sub === "/api/connect-offer" && (req.method === "POST" || req.method === "GET")) return connectOfferApi(req, env, t, async (c) => (await archive(env, t.id).channels()).some((x) => (x.slug || x.name) === c));
        if (sub === "/apps/done" && url.searchParams.get("from") === "offer") return connectOfferDone(env, t, origin, url, async (c) => (await archive(env, t.id).channels()).some((x) => (x.slug || x.name) === c));
        if (sub === "/apps/done") {
          const app = String(url.searchParams.get("app") || "").replace(/[^a-z0-9_]/g, ""), ok = url.searchParams.get("status") !== "failed";
          // Signed in to an account that was already connected (same email in the same app): keep one, and tell them.
          let already = false;
          if (ok && app && env.COMPOSIO_KEY) { try { already = (await tidyAfterConnect(env, t.id, app, String(url.searchParams.get("connected_account_id") || url.searchParams.get("connectedAccountId") || ""))).already; } catch (e) { console.log("tidy after connect", app, e.message); } }
          if (url.searchParams.get("from") === "onboard" && !onboardDone(t)) return Response.redirect(`${origin}/onboard?app=${app}&appst=${ok ? "connected" : "failed"}`, 302);
          return Response.redirect(`${origin}/w/${t.slug}/app?app=${app}&appst=${ok ? "connected" : "failed"}${already ? "&already=1" : ""}${url.searchParams.get("from") === "apps" ? "&from=apps" : ""}`, 302);
        }
        if (sub === "/google/done") {
          const from = url.searchParams.get("from"), ok = url.searchParams.get("status") !== "failed";
          const q = `google=${ok ? "connected" : "failed"}`;
          return Response.redirect(from === "onboard" && !onboardDone(t) ? `${origin}/onboard?${q}` : `${origin}/w/${t.slug}/app?${q}${from === "apps" ? "&from=apps" : ""}`, 302);
        }
        // Settings → Ambient → Bee (src/bee.js): pairing with the Bee app, the sealed token, "Connected as <name>". GET is read-only.
        if (sub === "/api/bee" || sub.startsWith("/api/bee/")) return await beeRoute(req, env, t, sub);
        if (sub === "/api/ambient/settings") return ambientSettingsRoute(req, env, t, user, { look: !!viewAsToken(req) });
        if (sub === "/api/texting" && req.method === "GET") return json(await textingStatus(env, t.id));
        if (sub.startsWith("/api/texting/") && req.method === "POST") {
          const op = sub.slice("/api/texting/".length), b = await boundedJson(req);
          try {
            if (op === "start") return json(await textingStart(env, t, String(b.phone || "")));
            if (op === "poll") return json(await textingPoll(env, t));
            if (op === "newcode") return json(await textingNewCode(env, t));
            if (op === "off") return json(await textingOff(env, t));
            if (op === "debug" && env.TEST_MODE === "1") return json(await textingDebug(env, t));
            if (op === "test-project" && env.TEST_MODE === "1") return json(await textingUseProject(env, t, String(b.project_id || ""), String(b.project_secret || ""), String(b.phone || "")));
          } catch (e) { console.log("texting", op, e.message); return json({ status: (await textingStatus(env, t.id)).status, error: "Texting setup hit a snag. Try again in a minute." }); }
          return json({ error: "unknown" }, 404);
        }
        if (sub === "/api/permissions" && (req.method === "GET" || req.method === "POST")) return await permsApi(req, env, t, { channels: () => archive(env, t.id).channels() });
        if (sub === "/api/soon" && req.method === "POST") { const b = await boundedJson(req); const k = String(b.k || "").slice(0, 40); if (/^[a-z-]+$/.test(k)) await env.DB.prepare("INSERT INTO soon_taps (tenant_id,k,where_,width,at) VALUES (?,?,?,?,?)").bind(t.id, k, String(b.where || "").slice(0, 200), Number(b.w) || null, Date.now()).run(); return json({ ok: true }); }
        if (sub === "/api/soon" && req.method === "GET") return json((await env.DB.prepare("SELECT k, COUNT(*) n, MAX(at) last FROM soon_taps WHERE tenant_id=? GROUP BY k ORDER BY n DESC").bind(t.id).all()).results);
        // Contacts = the workspace-shared people registry (people.js). Every channel's helper reads and writes the same list.
        if (sub === "/api/contacts" && req.method === "GET") { const A = archive(env, t.id); return json({ contacts: await A.peopleList(), dups: await A.peopleDups() }); }
        if (sub === "/api/contacts" && req.method === "POST") {
          const A = archive(env, t.id), b = await boundedJson(req);
          if (b.op === "save") { const c = b.contact || {}; const saved = await A.personUpsert({ id: c.id, create: !c.id, name: c.name, rel: c.rel, aka: Array.isArray(c.aka) ? c.aka : [], replaceAka: !!c.id, phone: c.phone, email: c.email,
            ...(Array.isArray(c.phones) ? { phones: c.phones.slice(0, 12) } : {}), ...(Array.isArray(c.emails) ? { emails: c.emails.slice(0, 12) } : {}), bday: c.bday, addr: c.addr, group: c.group }, "You added"); if (saved?.id) ctx?.waitUntil?.(hsContactNotify(env, t.id, [saved.id])); return json(saved); }
          // Merge two contacts (people.js mergePlan / merge): preview = the combined contact without saving anything.
          if (b.op === "merge") { const r = await A.personMerge(String(b.keep || ""), String(b.drop || ""), b.pick && typeof b.pick === "object" ? b.pick : {}, !!b.preview); if (!b.preview && !r?.error) ctx?.waitUntil?.(hsContactNotify(env, t.id, [String(b.keep || ""), String(b.drop || "")])); return r?.error ? json(r, 400) : json(r); }
          if (b.op === "notdup") return json(await A.personNotDup(String(b.a || ""), String(b.b || "")));
          if (b.op === "delete") { const r = await A.personRemove(String(b.id)); ctx?.waitUntil?.(hsContactNotify(env, t.id, [String(b.id)])); return json(r); }
          if (b.op === "fact") { const f = await A.personFact(String(b.id), String(b.text || "").trim(), "You added"); if (f) ctx?.waitUntil?.(hsContactNotify(env, t.id, [String(b.id)])); return f ? json(f) : json({ error: "no such contact" }, 404); }
          if (b.op === "dropfact") return json(await A.personFactDrop(String(b.id), String(b.fact)));
          // HS_WALLS: "Seen in" = the channels that see this contact (General always sees everyone). Replaces the list; only existing channels count.
          if (b.op === "seen" && hsWalls(env)) { const r = await A.personSeenSet(String(b.id || ""), Array.isArray(b.channels) ? b.channels.slice(0, 100) : []); return r?.error ? json(r, 404) : json(r); }
          return json({ error: "op must be save, delete, fact, dropfact, merge or notdup" }, 400);
        }
        // Contacts import (contacts-import.js): parsed contacts from the app, never a file. Batches of up to IMPORT_BATCH_MAX.
        if (sub === "/api/contacts/import" && req.method === "POST") {
          let b;
          try { b = JSON.parse(await boundedText(req, 8_000_000)); }
          catch (e) { if (e instanceof BodyTooLargeError) return json({ error: "Too much in one go. Import fewer contacts at a time." }, 413); b = null; }
          if (!b || !Array.isArray(b.contacts)) return json({ error: "contacts must be a list" }, 400);
          if (b.contacts.length > IMPORT_BATCH_MAX) return json({ error: `Send at most ${IMPORT_BATCH_MAX} contacts at a time` }, 400);
          const imported = await archive(env, t.id).peopleImport(b.contacts, String(b.source || "")); ctx?.waitUntil?.(hsContactNotify(env, t.id, null));   // the cards the import added, a batch at a time
          return json(imported);
        }
        { const ph = sub.match(/^\/api\/contacts\/photo\/([a-z0-9]{1,40})$/);
          if (ph && req.method === "GET") { const p = await archive(env, t.id).personPhoto(ph[1]); return p ? new Response(p.bytes, { headers: { "content-type": p.type, "cache-control": "private, max-age=86400" } }) : new Response("", { status: 404 }); } }
        if (sub === "/api/test/wsmem" && env.TEST_MODE === "1") { const A = archive(env, t.id); if (req.method === "POST") { const b = await boundedJson(req); return json(await A.wsRecall(String(b.q || ""))); } return json(await A.wsStats()); }
        // The person's own photo for the Notebook page (notebook-pages-do.js): GET the original bytes (view-as can read), POST a raw image body to set or replace it, POST /photo/delete to remove it.
        // The photo is the account's, kept with General, so every channel's URL answers with the same file.
        { const pm = sub.match(/^\/api\/notebook\/([a-z0-9][a-z0-9-]{0,62})\/photo(\/delete)?$/);
          if (pm) {
            const A = archive(env, t.id), chans = await A.channels(), ch = chans.find((c) => (c.slug || c.name) === pm[1]), main = chans.find((c) => (c.slug || c.name) === "main"); if (!ch || !main) return json({ error: "no such channel" }, 404);
            const R = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${t.id}:main`));
            if (req.method === "GET" && !pm[2]) {
              const ph = await R.nbPhotoGet(); if (!ph) return new Response("not found", { status: 404, headers: { "cache-control": "no-store" } });
              const inm = req.headers.get("if-none-match"), hd = servedHeaders(ph.mime, ph.name);
              const o = await env.WS.get(ph.r2key, inm ? { onlyIf: { etagDoesNotMatch: inm.replace(/^W\//, "").replace(/"/g, "") } } : {}); if (!o) return new Response("not found", { status: 404, headers: { "cache-control": "no-store" } });
              if (!("body" in o) || !o.body) return new Response(null, { status: 304, headers: { ...hd, etag: o.httpEtag } });
              return new Response(o.body, { headers: { ...hd, etag: o.httpEtag, "content-length": String(o.size) } });
            }
            if (req.method !== "POST") return json({ error: "method" }, 405);
            if (viewAsToken(req)) return json({ error: "view_as_read_only", message: "This is a read-only view." }, 403);
            if (access.mode === "read_only") return payRequired(access);
            await R.bind(t.id, "main", String(main.id));
            if (pm[2]) return json(await R.nbPhotoClear());
            const len = Number(req.headers.get("content-length") || -1);
            if (!req.body || len < 0) return json({ error: "Send the photo as the request body with a Content-Length." }, 411);
            if (len > PHOTO_MAX_BYTES) return json({ error: `That photo is ${Math.round(len / 1048576)} MB. The limit is ${PHOTO_MAX_BYTES / 1048576} MB.` }, 413);
            const bytes = new Uint8Array(await req.arrayBuffer()), mime = imageKind(bytes);
            if (!bytes.length || !mime) return json({ error: "Send a JPEG, PNG or WebP photo." }, 400);
            const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
            let f; try { f = await storeUpload(env, t.id, "main", { name: safeName(`Profile photo.${mime === "image/jpeg" ? "jpg" : mime.slice(6)}`), mime, len: bytes.length, body: bytes }); }
            catch (e) { if (e.code === "storage_full") return json({ error: e.message, storage_full: true, storage: storageView(e.storage) }, 507); throw e; }
            const r = await R.nbPhotoSet({ tenant: t.id, channel: "main", channelId: String(main.id), f, sha });
            return json({ ok: true, same: !!r.same, photo: `/w/${t.slug}/api/notebook/${pm[1]}/photo?v=${r.at}` });
          } }
        // The Notebook as pages (notebook-pages.js): the channel's mental models as Hindsight wrote them, and the person's edits saved as notes.
        { const pm = sub.match(/^\/api\/notebook\/([a-z0-9][a-z0-9-]{0,62})\/pages((?:\/[a-z0-9-]{1,40}){0,2})$/);
          if (pm) {
            const A = archive(env, t.id), ch = (await A.channels()).find((c) => (c.slug || c.name) === pm[1]); if (!ch) return json({ error: "no such channel" }, 404);
            const look = !!viewAsToken(req), write = req.method !== "GET";
            if (write && look) return json({ error: "view_as_read_only", message: "This is a read-only view." }, 403);
            const R = write ? env.RESIDENT.get(env.RESIDENT.idFromName(`res:${t.id}:${pm[1]}`)) : null; if (R) await R.bind(t.id, pm[1], String(ch.id));
            const interview = pm[1] === "main" && !write ? await env.DB.prepare("SELECT answers, known FROM interviews WHERE tenant_id=?").bind(t.id).first().catch(() => null) : null;
            return pagesRoute(req, env, t, pm[1], pm[2], { A, ch, look, R, interview, photo: async () => env.RESIDENT.get(env.RESIDENT.idFromName(`res:${t.id}:main`)).nbPhotoGet(), resident: async () => { const r = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${t.id}:${pm[1]}`)); await r.bind(t.id, pm[1], String(ch.id)); return r; } });
          } }
        { const nm = sub.match(/^\/api\/notebook\/([a-z0-9][a-z0-9-]{0,62})$/);
          // GET: this channel's Notebook rows, fresh (the boot copy goes stale when the helper saves something mid-visit).
          if (nm && req.method === "GET") {
            const A = archive(env, t.id), ch = (await A.channels()).find((c) => (c.slug || c.name) === nm[1]); if (!ch) return json({ error: "no such channel" }, 404);
            const R = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${t.id}:${nm[1]}`)); await R.bind(t.id, nm[1], String(ch.id));
            const d = await A.channel(ch.id, 1);
            // skills: this channel's own skills (skills/channel.js), saved at the person's ask, for a list the app can show.
            const skills = (await R.channelSkills().catch(() => [])).map((x) => ({ slug: x.slug, description: x.description, body: x.body, at: x.updated }));
            // General: the Bee facts waiting for review ("New from Bee", bee.js / bee-sync.js §7), when a Bee is connected.
            const bee = nm[1] === "main" ? await beePendingFacts(env, t.id) : null, speakers = nm[1] === "main" ? await beePendingSpeakers(env, t.id) : null;   // + New speaker detected (bee-speakers.js)
            return json({ notes: (d.memory || []).filter((m) => m.status !== "superseded").map((m) => ({ id: String(m.id), sec: m.sec || "", text: String(m.content), at: Number(m.edited || m.created) || 0, you: m.author_type === "human", ...(m.src ? { src: m.src } : {}) })), skills, ...(bee || speakers?.length ? { bee: { pending: bee || [], ...(speakers?.length ? { speakers } : {}) } } : {}) });
          }
          if (nm && req.method === "POST") {
            const A = archive(env, t.id), ch = (await A.channels()).find((c) => (c.slug || c.name) === nm[1]); if (!ch) return json({ error: "no such channel" }, 404);
            const b = await boundedJson(req), text = String(b.text || "").trim();
            // nosecrets: the Notebook is read every turn and copied into memory, so a secret is refused with where it belongs instead.
            if ((b.op === "add" || b.op === "edit") && hasSecret(text)) return json({ error: SECRET_NOTE, secret: true }, 400);
            // A From-Bee note (General) writes back to Bee: an edit → PUT with the fact's tags, a delete → DELETE, the Undo of a delete
            // (op add, bee: true) → the fact again (POST) and the note linked to it (bee.js).
            if (b.op === "add") { if (!text || !["ov", "about", "how", "people", "places", "now"].includes(b.sec)) return json({ error: "text and section required" }, 400);
              if (b.bee && nm[1] === "main") { const r = await beeNoteRestored(env, t.id, b.sec, text); if (r) return json(r); }
              const added = await A.noteAdd(ch.id, b.sec, text); ctx?.waitUntil?.(hsNoteNotify(env, t.id, nm[1], ch.id, added.id)); return json(added); }
            if (b.op === "edit") { if (!text) return json({ error: "text required" }, 400); const r = await A.noteEdit(ch.id, b.id, text); if (r) ctx?.waitUntil?.(hsNoteNotify(env, t.id, nm[1], ch.id, b.id)); if (r?.bee_fact_id != null) await beeNoteEdited(env, t.id, r); return json(r || { error: "no such note" }); }
            if (b.op === "delete") { const n = nm[1] === "main" ? ((await A.channel(ch.id, 1)).memory || []).find((m) => String(m.id) === String(b.id) && m.bee_fact_id != null) : null;
              const r = await deleteNote(env, t.id, nm[1], ch.id, String(b.id));   // the note AND its memory copies (deletion.js)
              if (n) await beeNoteDeleted(env, t.id, n);
              return json(r); }
            if (b.op === "skill_delete") { const R = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${t.id}:${nm[1]}`)); await R.bind(t.id, nm[1], String(ch.id)); return json({ ok: true, result: await R.channelSkillDelete(String(b.slug || "")) }); }   // one of this channel's own skills
            return json({ error: "op must be add, edit, delete or skill_delete" }, 400);
          } }
        // Where the person is (location.js): the app's coarse fix (about 1 km) + its place name, one row per account. GET / POST / POST …/forget.
        if (sub === "/api/location" || sub === "/api/location/forget") return locationRoute(req, env, t, { look: !!viewAsToken(req) });
        if (sub === "/api/interview") return interviewApi(req, env, t, url, { json, cf: req.cf || {}, look: !!viewAsToken(req) });
        if (sub === "/api/apps-used") return appsUsedApi(req, env, t, { json, look: !!viewAsToken(req) });   // App preferences collected in Get to know you and updated by the helper.
        if (sub === "/api/state") return json({ ...(await L.state()), access });
        if (sub === "/api/history") return json(await L.history(200));
        // Settings → Use my own AI key (src/byok.js): GET /api/byok, POST /api/byok/test|save|delete|mode. The key is sealed and never returned.
        if (sub.startsWith("/api/byok")) { const r = await byokApi(req, env, t, sub, { json, stripe, PLANS, planPrices, planOfPrice }); if (r) return r; }
        // Sign in with OpenRouter (src/byok-openrouter.js): start → OpenRouter's own page → callback → back to Settings → Use my own AI key.
        // A same-tab navigation from the app (works the same in a browser tab, on a phone and in the installed app). The state is bound to
        // this account (D1) and this browser (an HttpOnly cookie on this path); the code is exchanged here and the key sealed, never sent on.
        if (sub === "/byok/openrouter/start" && req.method === "GET") {
          if (req.headers.get("sec-fetch-site") === "cross-site") return Response.redirect(`${origin}/w/${t.slug}/app?settings=byok`, 302);   // only the app starts one
          const r = await orStart(env, t, origin);
          return new Response(null, { status: 302, headers: { location: r.url, "set-cookie": orCookie(t.slug, r.state), "cache-control": "no-store", "referrer-policy": "no-referrer" } });
        }
        if (sub === "/byok/openrouter/callback" && req.method === "GET") {
          const sp = url.searchParams;
          const r = await orFinish(env, { tenantId: t.id, code: sp.get("code") || "", state: sp.get("state") || "", cookieState: orCookieOf(req) }).catch((e) => { console.log("byok openrouter: callback", String(e?.message || e).slice(0, 80)); return { error: "network" }; });
          return new Response(null, { status: 302, headers: { location: `${origin}/w/${t.slug}/app?settings=byok&orauth=${r.ok ? "ok" : `err&orwhy=${r.error}`}`,
            "set-cookie": orCookie(t.slug, "", 0), "cache-control": "no-store", "referrer-policy": "no-referrer" } });
        }
        // Saved keys: the value is sealed here and never shown again by this API; Sentinel also scrubs literal upstream echoes.
        if (sub === "/api/vault" && req.method === "GET") return json((await env.DB.prepare("SELECT name, hosts, created_at FROM vault WHERE tenant_id=? ORDER BY name").bind(t.id).all()).results);
        if (sub === "/api/vault" && req.method === "POST") {
          const b = await boundedJson(req), name = String(b.name || "").toUpperCase(), hosts = (Array.isArray(b.hosts) ? b.hosts : String(b.hosts || "").split(/[\s,]+/)).map((h) => String(h).trim().toLowerCase()).filter(Boolean);
          if (!/^[A-Z][A-Z0-9_]{1,40}$/.test(name)) return json({ error: "name: letters, digits, underscore (e.g. OPENWEATHER_KEY)" }, 400);
          if (!hosts.length || hosts.some((h) => !/^(\*\.)?[a-z0-9.-]+\.[a-z]{2,}$/.test(h))) return json({ error: "hosts: the sites this key is for, e.g. api.openweathermap.org" }, 400);
          if (!b.value || String(b.value).length > 8000) return json({ error: "value required" }, 400);
          const sealed = await sealSecret(env, String(b.value)), standin = newStandin();
          await env.DB.prepare("INSERT INTO vault (tenant_id,name,standin,hosts,sealed,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(tenant_id,name) DO UPDATE SET standin=excluded.standin, hosts=excluded.hosts, sealed=excluded.sealed, created_at=excluded.created_at").bind(t.id, name, standin, JSON.stringify(hosts), sealed, Date.now()).run();
          return json({ ok: true, name, hosts });
        }
        // Saved logins: the password is sealed here and never returned; helpers use it only via browser_fill_login on the login's own site.
        if (sub === "/api/logins" && req.method === "GET") return json(await listLogins(env, t.id));
        if (sub === "/api/logins" && req.method === "POST") { const r = await saveLogin(env, t.id, await boundedJson(req)); return json(r, r.error ? 400 : 200); }
        if (sub === "/api/logins/note" && req.method === "GET") { const r = await loginNote(env, t.id, url.searchParams.get("site"), url.searchParams.get("username")); return json(r, r.error ? 404 : 200); }
        if (sub === "/api/logins/delete" && req.method === "POST") { const b = await boundedJson(req); return json(await deleteLogin(env, t.id, b.site, b.username)); }
        // Import from Chrome: the browser parses the exported CSV and sends only {site, username, password} rows. Counts back, never passwords.
        if (sub === "/api/logins/import" && req.method === "POST") { const b = await boundedJson(req); const r = await importLogins(env, t.id, b.logins); return json(r, r.error ? 400 : 200); }
        if (sub === "/api/vault/delete" && req.method === "POST") { const b = await boundedJson(req); await env.DB.prepare("DELETE FROM vault WHERE tenant_id=? AND name=?").bind(t.id, String(b.name || "").toUpperCase()).run(); return json({ ok: true }); }
        // Link Agent Wallet: the person connects their own Link wallet once; each purchase is approved in Link.
        if (sub === "/api/link/status") return json({ ...(await linkStatus(env, t.id)), purchases: await linkListPurchases(env, t.id) });
        if (sub === "/api/link/connect" && req.method === "POST") { try { return json(await linkStartConnect(env, t.id, `1Helm (${t.slug})`)); } catch (e) { return json({ error: e.message }, 502); } }
        // TEST_MODE only: what Link itself says about a purchase (card fields stripped), to prove it's a test request.
        if (sub === "/api/link/raw" && env.TEST_MODE === "1") { const own = await env.DB.prepare("SELECT id FROM link_purchases WHERE id=? AND tenant_id=?").bind(url.searchParams.get("id") || "", t.id).first(); if (!own) return json({ error: "no such purchase" }, 404);
          const sr = await linkApi(env, t.id, "GET", `/spend_requests/${encodeURIComponent(own.id)}`); if (sr) { delete sr.card; delete sr.shared_payment_token; delete sr.link_pay_token; } return json(sr); }
        if (sub === "/api/link/cancel" && req.method === "POST" && env.TEST_MODE === "1") { const b = await boundedJson(req); const own = await env.DB.prepare("SELECT id FROM link_purchases WHERE id=? AND tenant_id=?").bind(String(b.id || ""), t.id).first(); if (!own) return json({ error: "no such purchase" }, 404);
          try { const sr = await linkApi(env, t.id, "POST", `/spend_requests/${encodeURIComponent(own.id)}/cancel`); await env.DB.prepare("UPDATE link_purchases SET status=?, updated_at=? WHERE id=?").bind(sr?.status || "canceled", Date.now(), own.id).run(); return json({ id: own.id, status: sr?.status }); } catch (e) { return json({ error: e.message }, 502); } }
        // TEST_MODE only: facts about the issued card without revealing it.
        if (sub === "/api/link/cardcheck" && env.TEST_MODE === "1") { try { const g = await linkGetPurchase(env, t.id, url.searchParams.get("id") || "", true); const n = String(g.card?.number || "").replace(/\D/g, "");
          let sum = 0; for (let i = 0; i < n.length; i++) { let d = Number(n[n.length - 1 - i]); if (i % 2) { d *= 2; if (d > 9) d -= 9; } sum += d; }
          return json({ status: g.public.status, has_card: !!g.card, length: n.length, brand: g.card?.brand, last4: n.slice(-4), luhn_valid: n.length > 0 && sum % 10 === 0, is_documented_test_card: n === "4000009990001984", exp: g.card ? `${g.card.exp_month}/${g.card.exp_year}` : null, has_cvc: !!g.card?.cvc }); } catch (e) { return json({ error: e.message }, 400); } }
        if (sub === "/api/link/purchase") { try { return json(await linkGetPurchase(env, t.id, url.searchParams.get("id") || "")); } catch (e) { return json({ error: e.message }, 400); } }
        if (sub === "/api/link/disconnect" && req.method === "POST") return json(await linkDisconnect(env, t.id));
        // Cancel at period end / Keep my plan (src/cancel.js). No refunds, no trials.
        if (sub === "/api/plan/cancel" || sub === "/api/plan/keep" || sub === "/api/test/cancel-notices" || sub === "/api/test/cancel-tick") return cancelApi(req, env, t, user, sub, { stripe, json });
        if (sub === "/api/fix-payment" && req.method === "POST") return json(await fixPayment(env, t, origin));
        if (sub === "/api/test/pastdue") return pastdueApi(req, env, t, user, { json, stripe });
        if ((sub === "/api/topup" || sub === "/api/topup/confirm") && access.mode === "read_only")
          return payRequired(access);
        // TEST_MODE only, test accounts only: deploy measurements (e2e/dev/measure-deploy.mjs, notes/2026-10-08-deploy-safe-agents.md §6).
        //   GET ?c=<channel>: which code version the Worker and that channel's Resident run, its boots, released reservations and the
        //   alarm probe; POST {c, op:"alarm", sleep_ms}: arm the alarm probe (an alarm that sleeps, to see whether a deploy's cut-off retries it).
        //   GET ?ledger=1&since=<ms>: the Ledger's expired / late-settled reservations since then. GET ?card=<id> / ?workflow=<id>: that
        //   card with its steps / that workflow with its runs (the chaos checks). POST {op:"workflow", name, prompt}: a test workflow, run now.
        if (sub === "/api/test/deploy-probe" && env.TEST_MODE === "1") {
          if (!isTestAccount(user.email)) return json({ error: "Test accounts (@example.com) only." }, 403);
          const b = req.method === "POST" ? await boundedJson(req) : {}, c = String(b.c || url.searchParams.get("c") || "main");
          if (url.searchParams.get("ledger") === "1") return json({ worker: codeV(env), at: Date.now(), events: await L.resEvents(Number(url.searchParams.get("since")) || 0) });
          const R = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${t.id}:${c}`));
          const q = { ...b, card: b.card || url.searchParams.get("card") || null, workflow: b.workflow || url.searchParams.get("workflow") || null };
          return json({ worker: codeV(env), at: Date.now(), resident: await R.deployProbe(req.method === "POST" ? String(b.op || "") : "status", q) });
        }
        // TEST_MODE only: force the balance to a target so drain/overspend tests are cheap.
        if (sub === "/api/test/set-balance" && req.method === "POST" && env.TEST_MODE === "1") {
          const { balance_nano } = await boundedJson(req); return json(await L.setBalance(Math.round(balance_nano)));
        }

        // TEST_MODE only, @example.com test accounts only (dev evals): {cap_nano} sets today's hard cap (null = the account's own),
        // {checkin:false} turns off the "twice a normal day" check-in (true or null turns it back on). spendguard.js setCheckinTest.
        if (sub === "/api/test/day-cap" && req.method === "POST" && env.TEST_MODE === "1") {
          if (!isTestAccount(user.email)) return json({ error: "Test accounts (@example.com) only." }, 403);
          const b = await boundedJson(req);
          if ("checkin" in b) await L.setCheckinTest(b.checkin === false);
          const day = "cap_nano" in b ? await L.setDayCapTest(b.cap_nano == null ? null : Number(b.cap_nano)) : await L.dayInfo();
          return json({ ...day, checkin_off: !!(await L.guardInfo()).checkin_off });
        }

        // Voice dictation (the composer's mic): the recording in, { text } out, billed like a model call, never stored.
        if (sub === "/api/transcribe/live") return access.mode === "read_only" ? payRequired(access) : transcribeLive(req, env, L, { tenant: t.id, look: !!viewAsToken(req) }, { waitUntil: p => ctx.waitUntil(p) });
        if (sub === "/api/transcribe") return access.mode === "read_only" ? payRequired(access) : transcribe(req, env, L, { tenant: t.id, kind: "transcribe" });

        // Add credits step 1: the person tapped an amount. Answers with the saved card (brand and last 4 only, or null) and a short-lived
        // token for this amount; nothing is charged. Step 2 (/api/topup) needs the token.
        if (sub === "/api/topup/confirm" && req.method === "POST") {
          const { pack } = (await boundedJson(req, 4096).catch((e) => { if (e instanceof BodyTooLargeError) throw e; return null; })) || {};
          if (!TOPUP_CENTS[pack]) return json({ error: "Pick $10, $25 or $50." }, 400);
          const card = await savedCard((p, a, m) => stripe(env, p, a, m), t);
          return json({ pack, card: card ? { brand: card.brand, last4: card.last4 } : null, confirm: await issueConfirm(env, t.id, pack) });
        }
        if (sub === "/api/topup" && req.method === "POST") {
          const { pack, confirm } = (await boundedJson(req, 4096).catch((e) => { if (e instanceof BodyTooLargeError) throw e; return null; })) || {};
          const cents = TOPUP_CENTS[pack];
          if (!cents) return json({ error: "Pick $10, $25 or $50." }, 400);
          if (!(await checkConfirm(env, t.id, pack, confirm))) return json({ error: "Please confirm the amount again. Nothing was charged." }, 409);
          const pm = (await savedCard((p, a, m) => stripe(env, p, a, m), t, { details: false }))?.id;
          const md = { app: "1hc-proto", kind: "topup", tenant_id: t.id };
          try {
            if (!pm) throw new Error("no saved card");
            const pi = await stripe(env, "payment_intents", { amount: cents, currency: "usd", customer: t.stripe_customer, payment_method: pm, off_session: "true", confirm: "true", metadata: md, description: `1Helm credits $${pack}` });
            return json({ status: pi.status }); // credits post on payment_intent.succeeded webhook
          } catch (e) {
            const cs = await stripe(env, "checkout/sessions", { mode: "payment", customer: t.stripe_customer,
              "line_items[0][price_data][currency]": "usd", "line_items[0][price_data][unit_amount]": cents, "line_items[0][price_data][product_data][name]": `1Helm credits $${pack}`, "line_items[0][price_data][product_data][tax_code]": "txcd_10105001", "line_items[0][quantity]": 1,
              payment_intent_data: { metadata: md }, success_url: appUrl(origin, t, `${USAGE}&topup=1`), cancel_url: appUrl(origin, t, USAGE) });
            return json({ status: "needs_checkout", url: cs.url, reason: e.message });
          }
        }
        if (sub === "/api/import/start" && req.method === "POST") {
          const id = `${t.id}.${rand(8)}`, token = rand(32);
          await archive(env, t.id).createImport(id, await sha256(token));
          return json({ import_id: id, token, base: `${origin}/import/${id}`, part_size: IMPORT_PART });
        }
        // TEST_MODE only: one tiny call down each model path, reporting whether it went through the AI Gateway.
        if (sub === "/api/test/aig" && env.TEST_MODE === "1") {
          const out = { gateway: env.AIG_ID || null, tenant: t.id }, m = { tenant: t.id, kind: "aig-check" }, msg = [{ role: "user", content: "Say OK" }];
          try { const r = await dispatch(env, "label", { messages: msg }, { meta: m });
            const j = await r.json(); out.openrouter = { ok: true, via: r.headers.get("cf-aig-log-id") ? "gateway" : "direct", log: r.headers.get("cf-aig-log-id"), model: j.model, cost: j.usage?.cost }; } catch (e) { out.openrouter = { ok: false, error: String(e.message).slice(0, 200) }; }
          try { const r = await askDecider(env, { task: "say hi" }, { done: { type: "noul", instructions: "Is the task trivial?" } }, { meta: m, title: "1Helm aig-check" });
            out.decider_configured = deciderModel(await modelSettingsEnv(env)); out.decider = { ok: !r.error, model: r.model, ms: r.ms, nano: r.nano, error: r.error || undefined }; } catch (e) { out.decider = { ok: false, error: String(e.message).slice(0, 200) }; }
          return json(out);
        }
        if (sub === "/api/test/wf" && env.TEST_MODE === "1") { const d = await archive(env, t.id).channel(url.searchParams.get("c") || "7", 1); return json({ workflows: d.workflows, followups: d.followups }); }
        // TEST_MODE only: add a bench channel (bench1..bench9) so parallel e2e runs each get their own resident + computer.
        if (sub === "/api/test/channel" && req.method === "POST" && env.TEST_MODE === "1") { const b = await boundedJson(req); const slug = String(b.slug || "");
          if (!/^bench[1-9]$/.test(slug)) return json({ error: "slug must be bench1..bench9" }, 400); return json(await archive(env, t.id).addTestChannel(slug)); }
        if (sub === "/api/test/peek" && env.TEST_MODE === "1") { const d = await archive(env, t.id).channel(url.searchParams.get("c") || "7", 3); return json({ channel: d.channel, msg: d.messages.slice(-2), mem: d.memory.slice(0, 2), mem_n: d.memory.length }); }
        if (sub === "/imported") return page(`${t.slug} · imported`, await importedHtml(env, t));
        const ic = sub.match(/^\/imported\/(\d+)$/);
        if (ic) return page(`${t.slug} · imported`, await importedChannelHtml(env, t, ic[1]));
        // Channel residents (UI + API). Channel list comes from the imported archive.
        const cp = sub.match(/^\/c\/([a-z0-9][a-z0-9-]{0,62})$/);
        // Tracker cards + helpers (tracker.js / helpers.js): /sessions/<sid>/cards (GET ?n=&before=<opened>) · /cards/<id> · /cards/<id>/steps/<seq> (?dl=1 downloads
        //   the output) · /helpers (GET) · /helpers/<id>/stop (POST). A card of another task is 404. Helpers answer 404 "not available" until helpers.js is in.
        const tk = sub.match(/^\/api\/res\/([a-z0-9][a-z0-9-]{0,62})\/sessions\/([0-9a-f-]{36})\/(cards|helpers)(?:\/([0-9a-f-]{36}|\d+)(?:\/(steps\/(\d+)|stop))?)?$/);
        if (tk) {
          const chans = await archive(env, t.id).channels(), slugOf = (c) => c.slug || c.name, ch = chans.find((c) => slugOf(c) === tk[1]);
          if (!ch) return json({ error: "no such channel" }, 404);
          const R = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${t.id}:${slugOf(ch)}`));
          await R.bind(t.id, slugOf(ch), String(ch.id));
          if (tk[3] === "cards") {
            if (req.method !== "GET") return json({ error: "method" }, 405);
            if (tk[4] && !/^[0-9a-f-]{36}$/.test(tk[4]) || tk[5] === "stop") return json({ error: "not found" }, 404);
            if (!tk[4]) { const b = url.searchParams.get("before"); const d = await R.cardsList(tk[2], Number(url.searchParams.get("n")) || 50, b ? Number(b) : null); return json(d, d.error ? 404 : 200); }
            if (!tk[5]) { const d = await R.cardGet(tk[2], tk[4]); return json(d, d.error ? 404 : 200); }
            const d = await R.cardStep(tk[2], tk[4], Number(tk[6]));
            if (d.error) return json(d, 404);
            if (url.searchParams.get("dl") === "1") return new Response(d.step.output || "", { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store",
              "content-disposition": `attachment; filename="step-${d.step.seq}-${String(d.step.tool || "step").replace(/[^a-z0-9_-]/gi, "")}.txt"` } });
            return json(d);
          }
          if (tk[4] && !/^\d+$/.test(tk[4]) || tk[6]) return json({ error: "not found" }, 404);
          try {
            if (!tk[4]) { if (req.method !== "GET") return json({ error: "method" }, 405); const d = await R.helpersList(tk[2]); return json(Array.isArray(d) ? { helpers: d } : d, d?.error ? 404 : 200); }
            if (tk[5] !== "stop") return json({ error: "not found" }, 404);
            if (req.method !== "POST") return json({ error: "method" }, 405);
            if (access.mode === "read_only") return payRequired(access);
            const d = await R.helperStop(tk[2], Number(tk[4]), "person"); return json(d, d?.error ? 404 : 200);
          } catch (e) { return json({ error: "not available" }, 404); }
        }
        // Spend guard (spendguard.js): /api/res/<ch>/paused/<card>/stop (POST: Stop here on a paused card; Continue is /stream continue=<card>)
        //   · /api/usage/notice (POST: the 50% / 80% notice was seen). Signed-in owner only (this /w/<slug> block).
        const pz = sub.match(/^\/api\/res\/([a-z0-9][a-z0-9-]{0,62})\/paused\/([0-9a-f-]{36})\/stop$/);
        if (pz) {
          if (req.method !== "POST") return json({ error: "method" }, 405);
          const chans = await archive(env, t.id).channels(), slugOf = (c) => c.slug || c.name, ch = chans.find((c) => slugOf(c) === pz[1]);
          if (!ch) return json({ error: "no such channel" }, 404);
          const R = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${t.id}:${slugOf(ch)}`));
          await R.bind(t.id, slugOf(ch), String(ch.id));
          const d = await R.spendStopHere(pz[2]); return json(d, d.error ? d.status || 400 : 200);
        }
        if (sub === "/api/usage/notice" && req.method === "POST") return json(await L.noticeSeen());
        // Storage (src/storage.js): GET the meter, breakdown, blocks and each plan's storage (+ the pending plan change from Stripe);
        // POST /blocks {blocks} buys or removes 100 GB blocks; /recount counts again now; /notice marks the 80% / full notice seen.
        if (sub === "/api/storage" && req.method === "GET") {
          let s = await storageOf(env, t);
          if (!s.counted_at || Date.now() - s.counted_at > RECOUNT_MS) { await recount(env, t.id).catch((e) => console.log("storage recount", e.message)); s = await storageOf(env, t); }
          if (!eeEnabled(env)) {
            const v = storageView(s);
            return json({ used: v.used, limit: v.limit, pct: v.pct, full: v.full, by: v.by, labels: v.labels, used_text: v.used_text, limit_text: v.limit_text, counted_at: v.counted_at, notice: v.notice });
          }
          let next = null;
          if (t.stripe_subscription) try {
            const so = await stripe(env, `subscriptions/${t.stripe_subscription}`, {}, "GET"), it = (so.items?.data || []).find((i) => planOfPrice(env, i.price?.id));
            const np = it && planOfPrice(env, it.price.id); if (np && np !== planKey(t.plan)) next = { plan: np, name: PLANS[np].name, at: 1000 * Number(it.current_period_end || so.current_period_end || 0) || null };
          } catch (e) { console.log("storage: subscription", e.message); }
          return json({ ...storageView(s, Object.fromEntries(Object.entries(PLANS).filter(([k]) => planPrices(env)[k]))), plan: planKey(t.plan), next_plan: next });
        }
        if (sub === "/api/storage/blocks" && req.method === "POST") {
          if (access.mode === "read_only") return payRequired(access);
          const b = await boundedJson(req); const r = await setBlocks(env, t, b.blocks, { stripe });
          return json({ ...r, ...(r.storage ? { storage: storageView(r.storage) } : {}) }, r.error ? r.status || 400 : 200);
        }
        if (sub === "/api/storage/recount" && req.method === "POST") {
          const s0 = await storageOf(env, t); if (s0.counted_at && Date.now() - s0.counted_at < 60e3) return json(storageView(s0));
          await recount(env, t.id); return json(storageView(await rearmNotice(env, t)));
        }
        if (sub === "/api/storage/notice" && req.method === "POST") return json(await noticeSeen(env, t));
        // TEST_MODE: pretend the account uses this much (bytes per kind), to see the meter, the 80% notice and the full state on dev.
        if (sub === "/api/test/storage" && req.method === "POST" && env.TEST_MODE === "1") {
          const b = await boundedJson(req);
          for (const [k, v] of Object.entries(b.by || {})) if (["files", "computer", "pages", "other"].includes(k)) await env.DB.prepare("INSERT INTO storage_usage (tenant_id,kind,bytes,objects) VALUES (?,?,?,0) ON CONFLICT(tenant_id,kind) DO UPDATE SET bytes=excluded.bytes").bind(t.id, k, Math.max(0, Math.round(Number(v) || 0))).run();
          await env.DB.prepare("INSERT OR IGNORE INTO storage_plan (tenant_id, blocks, updated_at) VALUES (?,0,?)").bind(t.id, Date.now()).run();
          await env.DB.prepare("UPDATE storage_plan SET counted_at=?, notice_seen=CASE WHEN ? THEN 0 ELSE notice_seen END WHERE tenant_id=?").bind(Date.now(), b.rearm ? 1 : 0, t.id).run();   // counted now: no recount undoes it for a day
          return json(storageView(await storageOf(env, t)));
        }
        // Plans (plans.js): /api/res/<ch>/plans/<id> (GET) · /plans/<id>/approve (POST {items:[ticked item indexes], answers?:[{i, a}]}) · /plans/<id>/deny (POST).
        //   Signed-in owner only (this /w/<slug> block): no model or tool path can decide a plan. Approve creates and starts everything server-side.
        const pl = sub.match(/^\/api\/res\/([a-z0-9][a-z0-9-]{0,62})\/plans\/(\d{1,9})(?:\/(approve|deny))?$/);
        if (pl) {
          const chans = await archive(env, t.id).channels(), slugOf = (c) => c.slug || c.name, ch = chans.find((c) => slugOf(c) === pl[1]);
          if (!ch) return json({ error: "no such channel" }, 404);
          const R = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${t.id}:${slugOf(ch)}`));
          await R.bind(t.id, slugOf(ch), String(ch.id));
          if (!pl[3]) { if (req.method !== "GET") return json({ error: "method" }, 405); const d = await R.planCardData(Number(pl[2])); return json(d, d.plan ? 200 : 404); }
          if (req.method !== "POST") return json({ error: "method" }, 405);
          if (access.mode === "read_only") return payRequired(access);
          const b = await boundedJson(req);
          const picks = pl[3] === "approve" && Array.isArray(b.items) ? b.items.map(Number).filter(Number.isInteger).slice(0, 20) : null;
          const d = await R.planDecide(Number(pl[2]), pl[3], picks, pl[3] === "approve" ? (Array.isArray(b.answers) ? b.answers.slice(0, 8) : null) : null);
          return json(d, d.error ? d.status || 400 : 200);
        }
        // Stop (stop.js): /api/res/<ch>/sessions/<id>/stop (POST: the task's running turn ends at its next step, an in-flight model call and a
        //   running command are cut off, queued turns and unread steers drop, its helpers stop; → the stopped card) · /api/res/<ch>/stop-all (POST:
        //   every running turn and helper in the channel) · /api/stop-all (POST: every channel). Signed-in owner only (this /w/<slug> block);
        //   allowed when read-only too, since stopping never costs anything.
        const stm = sub.match(/^\/api\/res\/([a-z0-9][a-z0-9-]{0,62})\/(?:sessions\/([0-9a-f-]{36})\/stop|(stop-all))$/);
        if (stm || sub === "/api/stop-all") {
          if (req.method !== "POST") return json({ error: "method" }, 405);
          const chans = await archive(env, t.id).channels(), slugOf = (c) => c.slug || c.name;
          const resOf = async (ch) => { const R = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${t.id}:${slugOf(ch)}`)); await R.bind(t.id, slugOf(ch), String(ch.id)); return R; };
          if (!stm) {
            const rs = await Promise.all(chans.map(async (ch) => { try { return { slug: slugOf(ch), ...(await (await resOf(ch)).stopAll("person")) }; } catch (e) { return { slug: slugOf(ch), error: e.message }; } }));
            return json({ ok: true, stopped: rs.reduce((n, r) => n + (r.stopped || 0), 0), helpers: rs.reduce((n, r) => n + (r.helpers || 0), 0), channels: rs.filter((r) => r.stopped || r.helpers || r.error) });
          }
          const ch = chans.find((c) => slugOf(c) === stm[1]); if (!ch) return json({ error: "no such channel" }, 404);
          const R = await resOf(ch);
          if (stm[3]) return json({ slug: stm[1], ...(await R.stopAll("person")) });
          const d = await R.stopSession(stm[2], "person"); return json(d, d.error ? 404 : 200);
        }
        // Tasks: /api/res/<ch>/sessions (GET list, POST create) · /sessions/<id> (GET detail, POST {title,pinned,done,seen}) · /sessions/<id>/attach (NDJSON)
        //   · /sessions/<id>/todos (POST {id, status: "done"|"todo"}: the person ticks or unticks an item on the task's to-do list)
        //   · /sessions/<id>/pomodoro (GET the focus timer + offer prefs; POST {action: start|pause|resume|skip|stop|offer_accept|offer_decline|offers_on, ...}; pomodoro.js)
        const sp = sub.match(/^\/api\/res\/([a-z0-9][a-z0-9-]{0,62})\/sessions(?:\/([0-9a-f-]{36})(\/attach|\/todos|\/pomodoro)?)?$/);
        if (sp) {
          const chans = await archive(env, t.id).channels(), slugOf = (c) => c.slug || c.name, ch = chans.find((c) => slugOf(c) === sp[1]);
          if (!ch) return json({ error: "no such channel" }, 404);
          const R = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${t.id}:${slugOf(ch)}`));
          await R.bind(t.id, slugOf(ch), String(ch.id));
          if (!sp[2]) {
            if (req.method === "GET") return json({ sessions: await R.listSessions() });
            if (access.mode === "read_only") return payRequired(access);
            const b = await boundedJson(req); return json(await R.createSession(String(b.title || ""), String(b.text || "")));
          }
          if (sp[3] === "/todos") {
            if (req.method !== "POST") return json({ error: "method" }, 405);
            const b = await boundedJson(req); const d = await R.tickTodo(sp[2], String(b.id ?? ""), String(b.status || "")); return json(d, d.error ? 400 : 200);
          }
          if (sp[3] === "/pomodoro") {
            if (req.method !== "GET" && req.method !== "POST") return json({ error: "method" }, 405);
            const b = req.method === "GET" ? { action: "get" } : await boundedJson(req); const d = await R.pomoAction(sp[2], b, "person");
            return json(d, d.error ? (d.error.startsWith("No such task") ? 404 : 400) : 200);
          }
          if (sp[3]) return new Response(await R.attach(sp[2]), { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store", "x-accel-buffering": "no" } });
          if (req.method === "GET") { const d = await attachOffers(env, t, await R.sessionDetail(sp[2], Number(url.searchParams.get("n")) || 80)); return json(d, d.error ? 404 : 200); }
          if (req.method !== "POST") return json({ error: "method" }, 405);
          let b; try { b = JSON.parse(await boundedText(req, 8_000_000)); } catch (e) { if (e instanceof BodyTooLargeError) throw e; return json({ error: "Invalid task update." }, 400); }
          if (b && Object.prototype.hasOwnProperty.call(b, "title") && (!nativeSameOrigin(req) || !/^application\/json(?:\s*;|$)/i.test(req.headers.get("content-type") || ""))) return json({ error: "Task renames require a same-origin JSON request." }, 403);
          const d = await R.updateSession(sp[2], b); return json(d, d.error ? (d.status === 400 ? 400 : 404) : 200);
        }
        // Live notes (live-notes.js, SPEC §9): /api/res/<ch>/sessions/<id>/livenotes (GET the view + the meeting doc's text; POST {action:
        //   start (source: bee | mic, mic: the device's mic id, via: mic | tab | system) | stop (flushed) | continue | presence (view: bool) | mic (mic, state: live | paused, via)
        //   | apply | skip (n)}) · …/livenotes/transcript/<n> (GET a session's raw transcript) · …/livenotes/audio?mic=&seq=&at=&ms=&voiced=&who= (POST
        //   one chunk from the device's microphone, live-mic.js).
        const lnm = sub.match(/^\/api\/res\/([a-z0-9][a-z0-9-]{0,62})\/sessions\/([0-9a-f-]{36})\/livenotes(?:\/transcript\/(\d{1,4})|\/(audio))?$/);
        if (lnm) {
          if (!env.LIVE_NOTES) return json({ error: "not found" }, 404);
          const chans = await archive(env, t.id).channels(), slugOf = (c) => c.slug || c.name, ch = chans.find((c) => slugOf(c) === lnm[1]);
          if (!ch) return json({ error: "no such channel" }, 404);
          const R = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${t.id}:${slugOf(ch)}`)); await R.bind(t.id, slugOf(ch), String(ch.id));
          const row = await R.session(lnm[2]); if (!row) return json({ error: "No such task in this channel." }, 404);
          const LN = env.LIVE_NOTES.get(env.LIVE_NOTES.idFromName(lnName(t.id, slugOf(ch), lnm[2])));
          if (lnm[4]) { if (access.mode === "read_only") return payRequired(access); return lnAudio(req, env, { LN, L, q: url.searchParams, meta: { tenant: t.id, kind: "live-notes-stt" } }); }
          if (lnm[3]) {
            if (req.method !== "GET") return json({ error: "method" }, 405);
            const f = await LN.transcriptFile(Number(lnm[3])), o = f ? await env.WS.get(f.key) : null;
            if (!o) return new Response("not found", { status: 404, headers: { "cache-control": "no-store" } });
            return new Response(o.body, { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `inline; filename="live-notes-session-${lnm[3]}-transcript.json"`, "cache-control": "no-store" } });
          }
          if (req.method === "GET") {
            const v = await LN.state(); let doc = null;
            if (v.file && url.searchParams.get("doc") !== "0") { const d = await R.lnDocRead(v.file.id); if (d) { doc = d.text; v.file.version = d.version; } }
            return json({ ...v, doc });
          }
          if (req.method !== "POST") return json({ error: "method" }, 405);
          const b = await boundedJson(req), act = String(b.action || "");
          let v;
          if (act === "start") { if (access.mode === "read_only") return payRequired(access); v = await LN.start({ tenant: t.id, channel: slugOf(ch), channelId: String(ch.id), task: lnm[2], title: row.title, tz: await R.tz(), source: b.source === "mic" || b.source === "bee" ? b.source : null, mic: typeof b.mic === "string" ? b.mic.slice(0, 64) : null, via: typeof b.via === "string" ? b.via.slice(0, 8) : null }); }
          else if (act === "stop") v = await LN.stop("person", { flushed: !!b.flushed });
          else if (act === "mic") v = await LN.micState(String(b.mic || "").slice(0, 64), b.state === "paused" ? "paused" : "live", typeof b.via === "string" ? b.via.slice(0, 8) : null);
          else if (act === "continue") v = await LN.cont();
          else if (act === "presence") v = await LN.presence(!!b.view);
          else if (act === "apply" || act === "skip") v = await LN.refineAct(Number(b.n), act === "apply");
          else return json({ error: "action must be start, stop, continue, presence, mic, apply or skip" }, 400);
          return json(v, v?.error ? 409 : 200);
        }
        // Files: /api/res/<ch>/files (GET list, POST upload: raw body + x-file-name) · /files/<id> (GET bytes, ?dl=1 download) · /files/<id>/view (POST small JPEG for the model) · /files/<id>/delete
        const fm = sub.match(/^\/api\/res\/([a-z0-9][a-z0-9-]{0,62})\/files(?:\/([0-9a-f-]{36})(?:\/(view|delete|preview))?)?$/);
        if (fm) {
          const chans = await archive(env, t.id).channels(), slugOf = (c) => c.slug || c.name, ch = chans.find((c) => slugOf(c) === fm[1]);
          if (!ch) return json({ error: "no such channel" }, 404);
          const R = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${t.id}:${slugOf(ch)}`));
          if (!fm[2] && req.method === "GET") return json({ files: await R.listFiles() });
          if (fm[2] && !fm[3] && req.method === "GET") {
            const row = await R.fileRow(fm[2]); if (!row) return new Response("not found", { status: 404, headers: { "cache-control": "no-store" } });
            const hd = servedHeaders(row.mime, row.name, url.searchParams.get("dl") === "1"), inm = req.headers.get("if-none-match");
            const o = await env.WS.get(row.r2key, inm ? { onlyIf: { etagDoesNotMatch: inm.replace(/^W\//, "").replace(/"/g, "") } } : {}); if (!o) return new Response("not found", { status: 404, headers: { "cache-control": "no-store" } });
            if (!("body" in o) || !o.body) return new Response(null, { status: 304, headers: { ...hd, etag: o.httpEtag } });
            return new Response(o.body, { headers: { ...hd, etag: o.httpEtag, "content-length": String(o.size) } });
          }
          // file-preview.js: a deck or Word document as a PDF for the viewer, made on the computer on first open (then from R2).
          // View-as and read-only accounts only get one already made: nothing here wakes their computer.
          if (fm[3] === "preview" && req.method === "GET") {
            const d = await skewRetry(env, () => R.filePreview(fm[2], { make: !viewAsToken(req) && access.mode !== "read_only", retry: url.searchParams.get("retry") === "1" }));
            if (d.error) return json({ error: d.error }, d.status || 500);
            const inm = req.headers.get("if-none-match"), hd = { ...servedHeaders("application/pdf", previewFileName(d.name)), "x-preview-kind": d.kind, ...(d.pages ? { "x-preview-pages": String(d.pages) } : {}) };
            const o = await env.WS.get(d.key, inm ? { onlyIf: { etagDoesNotMatch: inm.replace(/^W\//, "").replace(/"/g, "") } } : {}); if (!o) { await skewRetry(env, () => R.dropPreview(fm[2])); return json({ error: "The preview went missing; open the file again to remake it." }, 404); }
            if (!("body" in o) || !o.body) return new Response(null, { status: 304, headers: { ...hd, etag: o.httpEtag } });
            return new Response(o.body, { headers: { ...hd, etag: o.httpEtag, "content-length": String(o.size) } });
          }
          if (req.method !== "POST") return json({ error: "method" }, 405);
          if (access.mode === "read_only") return payRequired(access);
          if (fm[3] === "delete") { const result = await R.deleteFile(fm[2]); return json(result, result?.status || 200); }
          const rawLength = req.headers.get("content-length");
          if (!req.body || rawLength === null) return json({ error: "Send the file as the request body with a Content-Length." }, 411);
          const len = Number(rawLength);
          if (!/^[0-9]+$/.test(rawLength) || !Number.isSafeInteger(len)) return json({ error: "Content-Length must be a nonnegative decimal integer." }, 400);
          if (fm[3] === "view") {
            if (len > MAX_VIEW) return json({ error: "too big" }, 413);
            const row = await R.fileRow(fm[2]); if (!row || !/^image\//.test(row.mime)) return json({ error: "no such image" }, 404);
            try { return json(await R.setFileView(row.id, await storeView(env, row.r2key, req.body.pipeThrough(new FixedLengthStream(len)), len))); }
            catch (e) { if (e.code === "storage_full") return json({ error: e.message, storage_full: true }, 507); throw e; }
          }
          if (fm[2]) return json({ error: "not found" }, 404);
          if (len > MAX_UPLOAD) return json({ error: `That file is ${Math.round(len / 1048576)} MB. The limit is ${MAX_UPLOAD / 1048576} MB per file.` }, 413);
          let name = "file"; try { name = decodeURIComponent(req.headers.get("x-file-name") || "file"); } catch {}
          name = safeName(name);
          const mime = mimeOf(name, req.headers.get("content-type") || "");
          let f; try { f = await storeUpload(env, t.id, slugOf(ch), { name, mime, len, body: len ? req.body.pipeThrough(new FixedLengthStream(len)) : null }); }
          catch (e) { if (e.code === "storage_full") return json({ error: e.message, storage_full: true, storage: storageView(e.storage) }, 507); throw e; }   // storage.js: full → refused, nothing deleted
          return json(await R.addUpload(t.id, slugOf(ch), String(ch.id), { ...f, pending: req.headers.get("x-draft") === "1" }));
        }
        // "Interview me" cards in chat (interview-chat.js): GET the card's view · POST {op: answer|skip|goto|send}.
        { const ivm = sub.match(/^\/api\/res\/([a-z0-9][a-z0-9-]{0,62})\/interviews\/([0-9a-f-]{36})$/); if (ivm) return interviewChatApi(req, env, t, ivm, { json, access, archive }); }
        // Send later (send-later.js): /api/res/<ch>/later (GET pending + failed, POST {session|"new", text, files, due, tz, cid} schedules)
        //   · /later/<id> (POST {due}: new time) · /later/<id>/send (POST: send now, or retry a failed one) · /later/<id>/cancel (POST)
        const slm = sub.match(/^\/api\/res\/([a-z0-9][a-z0-9-]{0,62})\/later(?:\/(\d{1,12})(?:\/(send|cancel))?)?$/);
        if (slm) {
          const chans = await archive(env, t.id).channels(), slugOf = (c) => c.slug || c.name, ch = chans.find((c) => slugOf(c) === slm[1]);
          if (!ch) return json({ error: "no such channel" }, 404);
          const R = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${t.id}:${slugOf(ch)}`));
          await R.bind(t.id, slugOf(ch), String(ch.id));
          if (!slm[2] && req.method === "GET") return json({ items: await R.laterList() });
          if (req.method !== "POST") return json({ error: "method" }, 405);
          const b = await boundedJson(req);
          if ((!slm[2] || slm[3] === "send") && access.mode === "read_only") return payRequired(access);
          const d = !slm[2] ? await R.laterAdd(t.id, slugOf(ch), String(ch.id), { session: b.session ? String(b.session) : "new", text: String(b.text ?? "").slice(0, 20001), files: Array.isArray(b.files) ? b.files.map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 10) : [], due: Number(b.due), tz: String(b.tz || "").slice(0, 64), cid: typeof b.cid === "string" ? b.cid.slice(0, 64) : null, reply: replyRef(b.reply) })
            : slm[3] === "send" ? await R.laterSend(Number(slm[2])) : slm[3] === "cancel" ? await R.laterCancel(Number(slm[2])) : await R.laterEdit(Number(slm[2]), Number(b.due));
          return json(d, d.error ? (d.status || 400) : 200);
        }
        // Screenshots the helper showed in chat. The Resident owns the id → R2 key mapping, so one channel can't read another's.
        const shm = sub.match(/^\/api\/res\/([a-z0-9][a-z0-9-]{0,62})\/shots\/([0-9a-f-]{36})\.jpg$/);
        if (shm) {
          const R = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${t.id}:${shm[1]}`)); const row = await R.shot(shm[2]);
          const o = row && await env.WS.get(row.r2key); if (!o) return new Response("not found", { status: 404 });
          return new Response(o.body, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=31536000, immutable" } });
        }
        const rp = sub.match(/^\/api\/res\/([a-z0-9][a-z0-9-]{0,62})\/(chat|stream|transcript|reset|workflows|runs|outbox|import-workflows|run-workflow|workflow-status|ensure|reschedule|gates|anatomy|memory|engine|browser-agent|browser-wait|browser-jobs-stop|turnstats|approvals|egress|approve|approval-policy|revoke-grant|sentinel|clef-doors|genui|event-log|event-workflow|network)$/);
        if (cp || rp) {
          const chans = await archive(env, t.id).channels();
          const slugOf = (c) => c.slug || c.name;
          const ch = chans.find((c) => slugOf(c) === (cp || rp)[1]);
          if (!ch) return cp ? page("Not found", "<p>No such channel.</p>") : json({ error: "no such channel" }, 404);
          if (cp) return classic ? page(`#${ch.name} · ${t.slug}`, channelHtml(t, chans, ch)) : Response.redirect(appUrl(origin, t, `#/${slugOf(ch)}`), 302);
          const R = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${t.id}:${slugOf(ch)}`));
          if (rp[2] === 'network') {
            await R.bind(t.id, slugOf(ch), String(ch.id));
            if (req.method === 'GET') return json(await R.nativeStatus(true));
            if (req.method !== 'POST') return json({ error: 'GET or POST only' }, 405);
            if (!nativeSameOrigin(req)) return json({ error: 'Native connection changes require a same-origin request.' }, 403);
            if (access.mode === 'read_only') return payRequired(access);
            return json(await R.nativeAct(await boundedJson(req)));
          }
          if (rp[2] === "transcript") return json(await R.transcript(60, url.searchParams.get("session")));
          if (rp[2] === "workflows") return json(await R.listWorkflows());
          if (rp[2] === "event-log") return json(await R.eventLog(url.searchParams.get("id") ? Number(url.searchParams.get("id")) : null, 50));   // app-events.js: verdicts only, never event bodies
          if (rp[2] === "event-workflow" && env.TEST_MODE === "1" && req.method === "POST") { await R.bind(t.id, slugOf(ch), String(ch.id)); return json(await R.testEventWorkflow(await boundedJson(req))); }   // dev live checks: a made-up trigger, never sent to Composio
          if (rp[2] === "runs") return json(await R.runs(Number(url.searchParams.get("n")) || 30));
          if (rp[2] === "browser-jobs-stop" && env.TEST_MODE === "1" && req.method === "POST") return json(await R.stopBrowserJobs());   // test only: stop any working browser job
          if (rp[2] === "browser-wait" && env.TEST_MODE === "1" && req.method === "POST") { const b = await boundedJson(req); return json(await R.setBrowserWait(b.ms)); }   // test only: how long browser_task waits ("" = default)
          if (rp[2] === "browser-agent" && env.TEST_MODE === "1" && req.method === "POST") { const b = await boundedJson(req); return json(await R.setBrowserAgent(String(b.mode ?? ""))); }
          if (rp[2] === "genui" && env.TEST_MODE === "1" && req.method === "POST") { const b = await boundedJson(req); return json(await R.setGenui(String(b.mode ?? ""))); }
          if (rp[2] === "engine" && env.TEST_MODE === "1" && req.method === "POST") { const b = await boundedJson(req); return json(await R.setEngine(String(b.engine))); }
          if (rp[2] === "turnstats" && env.TEST_MODE === "1") return json(await R.turnStats(Number(url.searchParams.get("n")) || 20));
          if (rp[2] === "anatomy" && env.TEST_MODE === "1") return json(await R.contextAnatomy());
          if (rp[2] === "memory" && env.TEST_MODE === "1") { if (req.method === "POST") { const b = await boundedJson(req); return json(b.workmem != null ? await R.setWorkmem(String(b.workmem)) : b.seed ? await R.rememberHere(String(b.seed.who || "them"), String(b.seed.fact || ""), "bench seed") : await R.setMemoryMode(String(b.mode ?? ""))); } return json(await R.memoryStats()); }
          if (rp[2] === "gates") return json(await R.gateRuns(Number(url.searchParams.get("n")) || 30));
          if (rp[2] === "approvals" && req.method === "GET") return json({ pending: await R.approvals(url.searchParams.get("all") === "1", url.searchParams.get("session")), policy: await R.approvalPolicy(url.searchParams.get("session")), grants: await R.listGrants() });
          if (rp[2] === "egress") return json(await R.egress(Number(url.searchParams.get("n")) || 50));
          if (rp[2] === "approve" && req.method === "POST") { const b = await boundedJson(req);
            if (!nativeSameOrigin(req) && SSH_PERMS.has((await R.approvalCardData(Number(b.id)))?.approval?.perm)) return json({ error: 'Native approval decisions require a same-origin request.' }, 403);
            // Read-only: "Don't allow" still works; allowing would let a waiting turn (or a purchase) carry on.
            if (access.mode === "read_only" && String(b.decision) !== "deny") return payRequired(access);
            // "Always allow this site" is permanent: require the explicit confirm step (the app's "Are you sure?"), like /c/<token>/decide.
            if (String(b.decision) === "channel" && b.confirm !== true) return json({ error: "confirmation_required" }, 400);
            return json(await R.decideApproval(Number(b.id), String(b.decision))); }
          if (rp[2] === "approval-policy" && req.method === "POST") { const b = await boundedJson(req); return json(await R.setApprovalPolicy(String(b.scope), String(b.mode), b.confirm === true, b.session ? String(b.session) : null)); }
          if (rp[2] === "revoke-grant" && req.method === "POST") { const b = await boundedJson(req); return json(await R.revokeGrant(Number(b.id))); }
          if (rp[2] === "sentinel" && env.TEST_MODE === "1" && req.method === "POST") { const b = await boundedJson(req); return json(await R.setSentinel(String(b.mode))); }
          if (rp[2] === "outbox") return json({ outbox: await R.outbox(), debug: await R.debug() });
          if (rp[2] === "ensure") return json(await R.ensure(t.id, slugOf(ch), String(ch.id)));
          if (req.method !== "POST") return json({ error: "POST only" }, 405);
          if (access.mode === "read_only") return payRequired(access);
          if (rp[2] === "reset" && env.TEST_MODE === "1") { const b = await boundedJson(req); return json(await R.reset(b.session ? String(b.session) : null)); }
          if (rp[2] === "import-workflows") { const b = await boundedJson(req); return json(await R.importWorkflows(t.id, slugOf(ch), String(ch.id), (b.activate || []).map(Number))); }
          if (rp[2] === "workflow-status") { const b = await boundedJson(req); return json(await R.setWorkflowStatus(Number(b.id), String(b.status))); }
          if (rp[2] === "reschedule" && env.TEST_MODE === "1") { const b = await boundedJson(req); return json(await R.reschedule(Number(b.id), Number(b.at))); }
          if (rp[2] === "run-workflow" && env.TEST_MODE === "1") { const b = await boundedJson(req); return json(await R.runNow(Number(b.id))); }
          if (rp[2] === "stream") {
            const { message, session, files, cid, continue: cont, loc, reply, input_reply } = await boundedJson(req, 64 * 1024);
            let inputMeta;
            if (input_reply != null) {
              if (typeof input_reply !== "object" || Array.isArray(input_reply)) return json({ error: "Invalid answer identity." }, 400);
              inputMeta = {};
              for (const [key, max] of [["question_id", 64], ["source_turn", 64], ["response_id", 160], ["action", 100]]) {
                if (input_reply[key] == null) continue;
                if (typeof input_reply[key] !== "string" || input_reply[key].length > max) return json({ error: "Invalid answer identity." }, 400);
                inputMeta[key] = input_reply[key];
              }
              for (const key of ["helper_id", "round"]) if (input_reply[key] != null) {
                if (!Number.isSafeInteger(input_reply[key]) || input_reply[key] < 0) return json({ error: "Invalid answer identity." }, 400);
                inputMeta[key] = input_reply[key];
              }
            }
            // The app's coarse fix rides with each message when location is on (location.js); saved before the turn reads it.
            if (rawFix(loc) && !viewAsToken(req)) await saveLocation(env, t.id, loc, Number(loc.at) || Date.now()).catch((e) => console.log("location", e.message));
            const fids = Array.isArray(files) ? files.map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 10) : [];
            if ((!message && !fids.length) || String(message || "").length > 20000) return json({ error: "Message required (max 20k chars)." }, 400);
            // cid: the app's own id for this message, so a retry joins as a dup instead of twice. A message sent while the helper works
            // steers that turn ({"t":"steered"} then the stream ends); too many on one turn → 429.
            const body = await R.chatStream(t.id, slugOf(ch), String(ch.id), String(message || ""), { session: session ? String(session) : null, files: fids, cid: typeof cid === "string" && cid ? cid.slice(0, 64) : null, ...(typeof cont === "string" && /^[0-9a-f-]{36}$/.test(cont) ? { continue: cont } : {}), ...(replyRef(reply) ? { reply: replyRef(reply) } : {}), ...(inputMeta ? { input_reply: inputMeta } : {}) });   // reply: the message it answers (reply-to.js)
            if (body && !(body instanceof ReadableStream) && body.error) return json({ error: body.error, ...(body.duplicate ? { duplicate: true } : {}) }, body.status || 400);
            return new Response(body, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store", "x-accel-buffering": "no" } });
          }
          if (rp[2] === "chat") {
            const { message, ctx, max_steps, engine, exclude_tools, session } = await boundedJson(req, 64 * 1024);
            if (!message || String(message).length > 20000) return json({ error: "Message required (max 20k chars)." }, 400);
            const r = await R.chat(t.id, slugOf(ch), String(ch.id), String(message), env.TEST_MODE === "1" ? { ...(ctx === "legacy" || ctx === "compact" ? { ctx } : {}), ...(max_steps ? { max_steps: Math.min(80, Number(max_steps)) } : {}), ...(engine === "pi" || engine === "classic" ? { engine } : {}), ...(Array.isArray(exclude_tools) ? { exclude_tools: exclude_tools.map(String).slice(0, 10) } : {}), session: session ? String(session) : null } : { session: session ? String(session) : null });
            return json({ ...r, state: await L.state() });
          }
        }
        // Per-channel computers: /w/<slug>/api/ch/<channel>/<op>
        const chm = sub.match(/^\/api\/ch\/([a-z0-9][a-z0-9-]{0,62})\/(.+)$/);
        if (chm) {
          const [, ch, op] = chm;
          const C = env.CHANNEL_COMPUTER.get(env.CHANNEL_COMPUTER.idFromName(`cc:${t.id}:${ch}`));
          const body = req.method === "POST" ? await boundedJson(req, 64 * 1024) : {};
          await C.init(t.id, ch);
          if (op === "status") return json(await C.status());
          // Live browser pane. The WebSocket goes Worker → this channel's controller → VNC inside the computer.
          if (op === "browser/live") {
            if (access.mode === "read_only") return new Response("payment required", { status: 402 });
            const mode = url.searchParams.get("mode") === "control" ? "control" : "view";
            if (mode === "control" && !(await C.leaseState()).controlled) return new Response("take control first", { status: 409 });
            return C.fetch(new Request(`http://cc/live?mode=${mode}`, req));
          }
          if (op.startsWith("browser/novnc/")) { try { return await C.novnc(op.slice(14)); } catch (e) { return new Response(`computer not ready: ${e.message}`, { status: 503, headers: { "cache-control": "no-store" } }); } }
          if (op === "browser/state") return json({ ...(await C.leaseState()), ...(await C.browser("status")) });
          if (op === "browser/sleep-state") return json(await C.sleepState());
          if (op === "browser/presence" && req.method === "POST") return json(await C.presence(Math.min(Number(body.hold_ms) || 0, 30 * 60e3)));
          if (op === "browser/control" && req.method === "POST") return json(await C.takeControl(user.id));
          if (op === "browser/release" && req.method === "POST") return json(await C.releaseControl());
          if (op === "browser/screenshot") { const r = await C.browser("screenshot"); if (!r.ok) return json(r, 500); return new Response(Uint8Array.from(atob(r.jpeg_base64), (c) => c.charCodeAt(0)), { headers: { "content-type": "image/jpeg", "cache-control": "no-store" } }); }
          if (op.startsWith("browser/op/") && req.method === "POST" && env.TEST_MODE === "1") return json(await C.browser(op.slice(11), body));
          if (access.mode === "read_only") return payRequired(access);
          try {
            if (op === "exec" && req.method === "POST") {
              if (!body.cmd || String(body.cmd).length > 8000) return json({ error: "cmd required" }, 400);
              const save = env.TEST_MODE === "1" && body.nosave ? "none" : body.save === "now" ? "now" : "defer";
              return json(await C.exec(String(body.cmd), { save }));
            }
            if (op === "save" && req.method === "POST") return json(await C.save("turn"));
            if (op === "sleep" && req.method === "POST") return json(await C.stop("user requested sleep"));
            if (env.TEST_MODE === "1" && req.method === "POST") {
              if (op === "test/import-base") return json(await C.importBase(t.id, ch, body));
              if (op === "test/idle") return json(await C.setIdle(Number(body.ms)));
              if (op === "test/presence") return json(await C.setPresence(Number(body.ms) || 0));
              if (op === "test/sigterm") return json(await C.testSigterm());
              if (op === "test/kill") return json(await C.kill());
              if (op === "test/idle-stop") return json(await C.testIdleStop());
              if (op === "test/stop-mode") return json(await C.setStopMode(String(body.mode)));
              if (op === "test/gap") return json(await C.setGap(Number(body.ms)));
              if (op === "test/clear-overrides") return json(await C.clearTestOverrides());
            }
          } catch (e) { return json({ error: e.message }, e.status || 500); }
          return json({ error: "unknown channel computer op" }, 404);
        }
        if (sub.startsWith("/api/computer/")) {
          const C = env.COMPUTER.get(env.COMPUTER.idFromName(`computer:${t.id}`)), op = sub.slice("/api/computer/".length);
          const body = req.method === "POST" ? await boundedJson(req, 64 * 1024) : {};
          if (op === "status") return json(await C.status());
          if (access.mode === "read_only") return payRequired(access);
          try {
            if (op === "exec" && req.method === "POST") {
              if (!body.cmd || String(body.cmd).length > 8000) return json({ error: "cmd required" }, 400);
              const save = env.TEST_MODE === "1" && body.nosave ? "none" : body.save === "now" ? "now" : "defer";
              return json(await C.exec(t.id, String(body.cmd), { save }));
            }
            if (op === "sleep" && req.method === "POST") return json(await C.stop("user requested sleep"));
            if (op === "end-turn" && req.method === "POST") return json(await C.endTurn());
            if (env.TEST_MODE === "1" && op === "test/idle" && req.method === "POST") return json(await C.setIdle(Number(body.ms)));
            if (env.TEST_MODE === "1" && op === "test/full-save" && req.method === "POST") return json(await C.checkpoint({ forceFull: true }));
            if (env.TEST_MODE === "1" && op === "test/crash-checkpoint" && req.method === "POST") return json(await C.checkpoint({ crashAfterParts: body.parts || 1 }));
            if (env.TEST_MODE === "1" && op === "test/kill" && req.method === "POST") return json(await C.kill());
            if (env.TEST_MODE === "1" && op === "test/sigterm" && req.method === "POST") return json(await C.testSigterm());
            if (env.TEST_MODE === "1" && op === "test/file-to-r2" && req.method === "POST") return json(await C.testFileToR2(String(body.path), String(body.key)));
            if (env.TEST_MODE === "1" && op === "test/r2-to-file" && req.method === "POST") return json(await C.testR2ToFile(String(body.key), String(body.path), Number(body.parts || 1)));
          } catch (e) { return json({ error: e.message }, e.status || 500); }
          return json({ error: "unknown computer op" }, 404);
        }
        if (sub === "/api/portal" && req.method === "POST") {
          const ps = await stripe(env, "billing_portal/sessions", { customer: t.stripe_customer, return_url: appUrl(origin, t, USAGE) });
          return json({ url: ps.url });
        }
        // Change plan: Stripe's portal, opened straight on the plan picker. Upgrades charge the prorated difference now; downgrades wait for the next bill.
        if (sub === "/api/plan/change" && req.method === "POST") {
          if (!t.stripe_customer || !t.stripe_subscription) return json({ error: "No active plan to change yet." }, 409);
          // In the app (src/plan-change.js): {plan}. Without one, Stripe's portal as before (it can't change a plan that also has extra storage).
          const pb = await boundedJson(req);
          if (pb.plan) { const r = await changePlan(env, t, String(pb.plan), { stripe, PLANS, planPrices, planOfPrice }); return json(r, r.error ? r.status || 400 : 200); }
          const ps = await stripe(env, "billing_portal/sessions", { customer: t.stripe_customer, return_url: appUrl(origin, t, `${USAGE}&plan=changed`),
            flow_data: { type: "subscription_update", subscription_update: { subscription: t.stripe_subscription }, after_completion: { type: "redirect", redirect: { return_url: appUrl(origin, t, `${USAGE}&plan=changed`) } } } });
          return json({ url: ps.url });
        }
      }
      return page("Not found", "<p>Not found.</p>");
    } catch (e) {
      if (e instanceof BodyTooLargeError) return /^\/w\/[^/]+\/api\//.test(p) || p.startsWith("/api/")
        ? json({ error: "too_large" }, 413) : new Response("Form is too large", { status: 413 });
      if (e instanceof UnsupportedFormTypeError) return new Response("Expected a URL-encoded form", { status: 415 });
      console.error(e);
      // An API call gets JSON, never the HTML error page (status 200): 503 + retryable when a Durable Object died under the request.
      if (/^\/w\/[^/]+\/api\//.test(p) || p.startsWith("/api/")) return apiError(e);
      return page("Something went wrong", `<p>Something went wrong: ${esc(e.message)}</p>`);
    }
  },
};
// Eval 10-07: six chat calls answered the HTML "Something went wrong" page with status 200. Each one lined up with a dev deploy
// (01:25:19, 01:31:09, 01:34:35 UTC): a new version resets every Durable Object, the Resident running that turn went away, R.chat
// threw, and the turn was left "interrupted". The same happens on Live at every release, and on an overloaded object. A caller can
// tell these apart and send again (the turn didn't finish): {error, retryable:true} with 503 (and Retry-After). Anything else: 500.
// The patterns, the namespace wrapper and its retry live in do-stub.js (re-exported here for the tests and older callers).
export { DO_TRANSIENT_RE, RPC_SKEW_RE, rpcSkew };
export async function skewRetry(env, fn) {
  try { return await fn(); } catch (e) {
    if (!rpcSkew(e)) throw e;
    await new Promise((z) => setTimeout(z, Number(env?.SKEW_WAIT_MS ?? 1500)));
    return await fn();
  }
}
export const transientError = (e) => !!(e?.retryable || e?.overloaded || DO_TRANSIENT_RE.test(String(e?.message || e || "")) || rpcSkew(e));
export function apiError(e) {
  const retryable = transientError(e), msg = String(e?.message || e || "error").slice(0, 300);
  // a deploy reset: plain words, never the platform's "Durable Object reset…" text (the turn itself carries on, resume.js)
  return new Response(JSON.stringify({ error: rpcSkew(e) ? "1Helm was just updated and this part hasn't caught up yet. Try again in a moment." : isResetErr(e) ? "1Helm was just updated mid-request. Send it again in a moment." : retryable ? `The helper was restarted mid-request (${msg}). Send it again.` : `Something went wrong: ${msg}`, retryable }),
    { status: retryable ? 503 : 500, headers: { "content-type": "application/json", "cache-control": "no-store", ...(retryable ? { "retry-after": "5" } : {}) } });
}

function channelHtml(t, chans, ch) {
  const slugOf = (c) => c.slug || c.name, base = `/w/${esc(t.slug)}`;
  const nav = chans.filter((c) => c.kind !== "dm").map((c) => `<a href="${base}/c/${esc(slugOf(c))}?classic=1" style="display:block;padding:6px 10px;border-radius:8px;text-decoration:none;color:#111;${c.id === ch.id ? "background:#eef" : ""}">#${esc(c.name)}</a>`).join("");
  return `<style>body{max-width:1100px}.wrap{display:flex;gap:20px}.side{width:200px;flex:none}.main{flex:1;min-width:0}#log{min-height:360px}.u{margin:10px 0;color:#333}.a{margin:10px 0;padding:10px;background:#f6f7fb;border-radius:10px;white-space:pre-wrap}.meta{color:#999;font-size:12px}</style>
<div id=pill class=pill>…</div>
<div class=wrap><div class=side><div style="font-weight:600;margin-bottom:8px">${esc(t.slug)}</div>${nav}<p style="margin-top:14px"><a href="${base}/?classic=1">Account</a></p></div>
<div class=main><h2 style="margin-top:0">#${esc(ch.name)}</h2><div style="color:#666;margin-top:-8px">${esc(ch.purpose || ch.topic || "")}</div>
<div id=pol class=meta style="margin:6px 0"></div><div id=pend></div>
<div id=log></div><form id=f style="margin-top:10px;display:flex;gap:8px"><input id=m style="flex:1" placeholder="Message #${esc(ch.name)}" autocomplete=off><button id=send>Send</button><button id=showpc type=button title="Show the browser">Browser</button></form></div>
<div id=pc class=pc><div class=pchead><b>Browser</b> <span id=pcurl class=meta></span><span style=flex:1></span><span id=pcmode class=meta>Watching</span> <button id=pctake type=button>Take control</button><button id=pcback type=button style=display:none>Done — hand back</button> <button id=pcclose type=button aria-label=Close>✕</button></div>
<div id=pcnote class=pcnote style=display:none></div><div id=screen class=screen></div></div></div>
<style>.wrap{max-width:none}.pc{display:none;width:560px;flex:none;border:1px solid #e3e3ea;border-radius:14px;overflow:hidden;background:#111;align-self:flex-start;position:sticky;top:12px}.pc.on{display:block}.pchead{display:flex;gap:6px;align-items:center;padding:8px 10px;background:#f6f7fb;font-size:13px}.pchead .meta{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pcnote{padding:10px;background:#fff8e6;border-bottom:1px solid #f0c36d;font-size:14px}.screen{width:100%;aspect-ratio:1280/800;background:#222}.pc.ctl{outline:3px solid #2f6fed}body{max-width:1300px!important}</style>
<script type=module>
const cbase=${JSON.stringify(`${base}/api/ch/${slugOf(ch)}/browser`)};
// noVNC loads only when the pane opens, so a chat-only visit never wakes the computer.
let RFB=null,rfb=null,mode='view';const $=(i)=>document.getElementById(i);
async function connect(m){if(!RFB)RFB=(await import(cbase+'/novnc/core/rfb.js')).default;mode=m;if(rfb){try{rfb.disconnect()}catch{}}$('screen').innerHTML='';
 const ws=(location.protocol==='https:'?'wss://':'ws://')+location.host+cbase+'/live?mode='+m;
 rfb=new RFB($('screen'),ws,{shared:true});rfb.viewOnly=m!=='control';rfb.scaleViewport=true;rfb.resizeSession=false;rfb.focusOnClick=true;
 rfb.addEventListener('disconnect',()=>{if(document.getElementById('pc').classList.contains('on'))setTimeout(()=>connect(mode),1500);});
 $('pc').classList.toggle('ctl',m==='control');$('pcmode').textContent=m==='control'?'You have control':'Watching';$('pctake').style.display=m==='control'?'none':'';$('pcback').style.display=m==='control'?'':'none';}
window.openPC=(note,url)=>{const pc=$('pc');if(note){$('pcnote').textContent=note;$('pcnote').style.display='';}if(url)$('pcurl').textContent=url;if(!pc.classList.contains('on')){pc.classList.add('on');connect('view');}};
$('showpc').onclick=()=>openPC();$('pcclose').onclick=async()=>{$('pc').classList.remove('on');if(mode==='control')await fetch(cbase+'/release',{method:'POST'});if(rfb)rfb.disconnect();rfb=null;};
$('pctake').onclick=async()=>{const r=await (await fetch(cbase+'/control',{method:'POST'})).json();if(!r.ok)return tell("Couldn't take control",r.error||"Try again in a moment.");connect('control');};
$('pcback').onclick=async()=>{await fetch(cbase+'/release',{method:'POST'});$('pcnote').style.display='none';connect('view');};
</script>
<style>.ap{border:1px solid #f0c36d;background:#fff8e6;border-radius:10px;padding:10px;margin:8px 0}.ap b{font-family:monospace}.ap button{margin:4px 4px 0 0}.pol select{font-size:12px}</style>
<script>const base=${JSON.stringify(`${base}/api`)},ch=${JSON.stringify(slugOf(ch))},$=(i)=>document.getElementById(i),usd=(n)=>'$'+(n/1e9).toFixed(2);
function add(cls,html){const d=document.createElement('div');d.className=cls;d.innerHTML=html;$('log').appendChild(d);d.scrollIntoView({block:'end'});return d;}
const esc=(s)=>String(s).replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const linkHref=(s)=>{try{const u=new URL(String(s));return u.protocol==='https:'?u.href:'';}catch{return '';}};
async function pill(){const s=await (await fetch(base+'/state')).json();$('pill').textContent=usd(s.balance_nano)+' left';}
async function load(){const tr=await (await fetch(base+'/res/'+ch+'/transcript')).json();for(const x of tr){add('u','<b>You</b> '+esc(x.user_text));add('a',esc(x.reply)+'<div class=meta>'+(x.tool_calls?x.tool_calls+' computer step(s) · ':'')+(x.total_ms/1000).toFixed(1)+' s · '+usd(x.charge_nano||0)+'</div>');}pill();}
// Approvals live here in the app, outside the chat: the resident can't click them, fake them or talk its way past them.
function apCard(a,after){if(document.getElementById('ap'+a.id))return;const d=document.createElement('div');d.className='ap';d.id='ap'+a.id;
 d.innerHTML='<div><b>'+esc(a.method)+' '+esc(a.host)+esc(a.path||'')+'</b></div><div class=meta>'+(a.workflow_id?'From scheduled job #'+a.workflow_id+' · ':'')+'Your '+(a.workflow_id?'job':'resident')+' wants to send data to this site'+(a.bytes?' ('+a.bytes+' bytes)':'')+(a.keys&&a.keys.length?', using your saved key '+a.keys.map(esc).join(', '):'')+'.</div>';
 for(const [k,l] of [['once','Allow once'],['session','Allow this site for this conversation'],['channel','Always allow this site in #'+ch],['deny','Deny']]){const b=document.createElement('button');b.textContent=l;b.onclick=async()=>{d.querySelectorAll('button').forEach(x=>x.disabled=true);await fetch(base+'/res/'+ch+'/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:a.id,decision:k})});d.remove();};d.append(b);}
 (after&&after.parentNode?after.parentNode.insertBefore(d,after.nextSibling):$('pend').append(d));}
const LBL={session:'This conversation',channel:'#'+ch,global:'All channels'};
async function pol(){const r=await (await fetch(base+'/res/'+ch+'/approvals')).json();for(const a of r.pending)apCard(a);
 const p=r.policy,el=$('pol');el.className='meta pol';el.innerHTML='Outgoing data: <b>'+(p.effective==='always'?'Always Approve':'Ask me')+'</b> (set by '+(p.from==='default'?'default':LBL[p.from])+') ';
 for(const sc of ['session','channel','global']){const sel=document.createElement('select');const cur=p.levels[sc]||(sc==='global'?'ask':'inherit');
  for(const [v,l] of (sc==='global'?[['ask','Ask me'],['always','Always Approve']]:[['inherit','Same as above'],['ask','Ask me'],['always','Always Approve']]))sel.add(new Option(LBL[sc]+': '+l,v,false,v===cur));
  sel.onchange=async()=>{let ok=false;if(sel.value==='always'){ok=await ask({title:"Always approve for "+(sc==='global'?"all channels":sc==='channel'?'#'+ch:"this conversation")+"?",body:"Your resident's computer will be able to send data to any website without asking you first. Saved keys still only work on their own sites.",confirm:"Always approve",danger:true});if(!ok){pol();return;}}
   const x=await (await fetch(base+'/res/'+ch+'/approval-policy',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scope:sc,mode:sel.value,confirm:ok})})).json();if(x.error)tell("Couldn't change that",x.error);pol();};
  el.append(sel,' ');}}
$('f').onsubmit=async(e)=>{e.preventDefault();const m=$('m').value.trim();if(!m)return;$('m').value='';$('send').disabled=true;add('u','<b>You</b> '+esc(m));
 const w=add('a',''),txt=document.createElement('span'),st=document.createElement('div');st.className='meta';st.textContent='working…';w.append(txt,st);let text='';
 try{const r=await fetch(base+'/res/'+ch+'/stream',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:m})});
  if(!r.ok||!r.body){const d=await r.json().catch(()=>({}));throw new Error(d.error||('HTTP '+r.status));}
  const rd=r.body.pipeThrough(new TextDecoderStream()).getReader();let buf='';
  for(;;){const {value,done}=await rd.read();if(done)break;buf+=value;let i;while((i=buf.indexOf('\\n'))>=0){const line=buf.slice(0,i);buf=buf.slice(i+1);if(!line.trim())continue;const ev=JSON.parse(line);
   if(ev.t==='text'){text+=ev.s;txt.textContent=text;st.textContent='';w.scrollIntoView({block:'end'});}
   else if(ev.t==='work'){st.textContent='working…';}
   else if(ev.t==='approval'){apCard(ev.approval,w);st.textContent='waiting for your approval…';}
   else if(ev.t==='browser'){window.openPC&&openPC(null,ev.url);}
   else if(ev.t==='link_purchase'){const p=ev.purchase,d=document.createElement('div'),href=linkHref(p.approval_url);d.className='ap';d.innerHTML='<div><b></b>'+(p.test?' <span class=meta>(test, no real charge)</span>':'')+'</div><div class=meta>Link is sending the approval to your phone. Nothing is charged unless you approve.</div>';d.querySelector('b').textContent='Approve in Link: '+(p.merchant_name||'')+' $'+(p.amount/100).toFixed(2);if(href){const a=document.createElement('a');a.href=href;a.target='_blank';a.rel='noopener';a.textContent='Open in Link';d.querySelector('.meta:last-child').append(' ',a);}w.parentNode.insertBefore(d,w.nextSibling);}
   else if(ev.t==='browser_handoff'){window.openPC&&openPC(ev.instructions,ev.url);}
   else if(ev.t==='approval_done'){const c=document.getElementById('ap'+ev.id);if(c)c.remove();st.textContent='working…';}
   else if(ev.t==='done'){if(ev.plain!=null)txt.textContent=ev.plain;else if(!text&&ev.reply)txt.textContent=ev.reply;st.textContent=(ev.tool_calls?ev.tool_calls+' computer step(s) · ':'')+((ev.total_ms||0)/1000).toFixed(1)+' s · '+usd(ev.charge||0);}}}
 }catch(err){st.textContent='Network error: '+err.message;}
 $('send').disabled=false;pill();pol();};load();pol();setInterval(pol,20000);</script>`;
}
function workspaceHtml(t, env) {
  return `<style>.banner{padding:10px 14px;border-radius:10px;margin:8px 0}.banner.warn{background:#fff3cd}.banner.low{background:#ffd7d7}</style><div id=pill class=pill>…</div><div id=banner style=display:none></div><h2>${esc(t.slug)}${env.PUBLIC_BASE_DOMAIN ? `.${esc(env.PUBLIC_BASE_DOMAIN)}` : ""} <small style="color:#c00">(prototype: /w/${esc(t.slug)})</small></h2>
<p style="font-size:18px"><a href="/w/${esc(t.slug)}/c/weather-tracking?classic=1"><b>Open your channels →</b></a></p>
<div id=log></div><form id=f style="margin-top:10px;display:flex;gap:8px"><input id=m style="flex:1" placeholder="Ask your resident anything"><button>Send</button></form>
<p style="margin-top:16px"><button id=b10 type=button>Add $10</button> <button id=b25 type=button>Add $25</button> <button id=portal type=button>Billing</button></p>
<div id=linkbox style="margin-top:16px;padding:12px 14px;border:1px solid #ddd;border-radius:12px"><b>Buying things</b> <span id=lkst class=cost></span>
<div id=lkbody style="margin-top:6px"></div></div>
<details style="margin-top:16px"><summary><b>Linux computer</b> <span id=cst style="color:#888"></span></summary>
<form id=cf style="display:flex;gap:8px;margin-top:8px"><input id=cmd style="flex:1;font-family:monospace" placeholder="ls -la   (runs in /workspace)"><button>Run</button></form>
<pre id=cout style="background:#111;color:#ddd;padding:10px;border-radius:8px;max-height:320px;overflow:auto;white-space:pre-wrap"></pre>
<button id=csleep type=button>Put computer to sleep</button></details>
<div id=modal><div><h3 id=mt>Out of credits</h3><p id=mb>Add credits to keep going. Your message will be sent automatically.</p>
<button data-p=10>Add $10</button> <button data-p=25>Add $25</button> <button data-p=50>Add $50</button> <p><a href=# id=close>Not now</a></p></div></div>
<script>
const $=s=>document.querySelector(s), base=location.pathname.replace(/\\/$/,''); let pending=null, last=null;
const linkHref=(s)=>{try{const u=new URL(String(s));return u.protocol==='https:'?u.href:'';}catch{return '';}};
// Link: connect once (a phrase you confirm in Link), then every purchase is approved by you in Link.
async function linkPaint(){const r=await (await fetch(base+'/api/link/status')).json();const b=$('#lkbody');
 if(r.connected&&!r.pending){$('#lkst').textContent='Link connected'+(r.email?' ('+r.email+')':'');
  b.innerHTML='Your resident can ask to buy things for you. You approve each purchase in Link on your phone; stores get a one-time card, never your real one. <button id=lkoff type=button>Disconnect</button>';
  if(r.purchases&&r.purchases.length){const list=document.createElement('div');list.className='cost';list.style.marginTop='6px';for(const p of r.purchases.slice(0,5)){const row=document.createElement('div');row.textContent=(p.merchant_name||'')+' $'+(p.amount/100).toFixed(2)+' · '+p.status+(p.test?' · test':'');list.append(row);}b.append(list);}
  $('#lkoff').onclick=async()=>{if(!(await ask({title:"Disconnect Link?",body:"Your resident won't be able to ask to buy things anymore.",confirm:"Disconnect",danger:true})))return;await fetch(base+'/api/link/disconnect',{method:'POST'});linkPaint();};return;}
 if(r.pending){$('#lkst').textContent='waiting for you in Link…';const href=linkHref(r.url);b.replaceChildren();if(href){const a=document.createElement('a');a.href=href;a.target='_blank';a.rel='noopener';a.textContent=href.replace(/^https:\\/\\//,'').split('?')[0];b.append('Open ',a,', sign in, and check the phrase is ');}else b.append('Check the phrase in Link: ');const phrase=document.createElement('b');phrase.textContent=r.phrase;b.append(phrase,'.');setTimeout(linkPaint,5000);return;}
 $('#lkst').textContent=r.error||(r.expired?'That sign-in expired.':'');
 b.innerHTML='Let your resident buy things for you with Link. You approve every purchase on your phone. <button id=lkon type=button>Connect Link</button>';
 $('#lkon').onclick=async()=>{const x=await (await fetch(base+'/api/link/connect',{method:'POST'})).json();if(x.error){tell("Couldn't connect Link",x.error);return;}const href=linkHref(x.url);if(href)window.open(href,'_blank','noopener');linkPaint();};}
linkPaint();
const usd=n=>'$'+(n/1e9).toFixed(2);
function paint(s){last=s;const a=s.access||{},bn=$('#banner');
 if(a.mode==='read_only'){const pd=a.reason==='payment_failed';bn.style.display='block';bn.className='banner low';bn.innerHTML=(pd?'Your payment didn\\'t go through. 1Helm is read-only until you update your card. ':'Your subscription ended, so your 1Helm is read-only. ')+(pd&&a.delete_at?'If it isn\\'t fixed by '+new Date(a.delete_at).toLocaleDateString()+', everything is permanently deleted. ':'')+'<button id=fix>'+(pd?'Fix payment':'Reactivate')+'</button>';$('#m').disabled=true;}
 else {bn.style.display='none';$('#m').disabled=false;}
 const fx=$('#fix'); if(fx) fx.onclick=async()=>{location.href=(await (await fetch(base+'/api/fix-payment',{method:'POST'})).json()).url;};const left=s.balance_nano, used=s.included_nano?1-left/Math.max(s.granted_nano,1):0;
 const p=$('#pill');p.textContent=usd(left)+' left';p.className='pill'+(used>=.9?' low':used>=.75?' warn':'');}
async function state(){paint(await (await fetch(base+'/api/state')).json());}
function add(who,t,c){const d=document.createElement('div');d.className=who;d.textContent=(who==='me'?'You: ':'Resident: ')+t;$('#log').append(d);if(c){const x=document.createElement('div');x.className='cost';x.textContent=c;$('#log').append(x);}}
async function send(msg){const r=await fetch(base+'/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:msg})});const d=await r.json();
 if(r.status===402){pending=msg;$('#modal').style.display='block';return;} if(!r.ok){add('bot','⚠ '+d.error);return;}
 add('bot',d.reply,'cost '+usd(d.charge_nano)+' · '+d.usage.in+' in / '+d.usage.out+' out');paint(d.state);}
$('#f').onsubmit=e=>{e.preventDefault();const m=$('#m').value.trim();if(!m)return;$('#m').value='';add('me',m);send(m);};
async function topup(p){const j=b=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});const c=await (await fetch(base+'/api/topup/confirm',j({pack:p}))).json();if(!c.confirm)return;
 if(!await ask({title:c.card?'Charge $'+p+' to '+c.card.brand+' ending '+c.card.last4+'?':'Add $'+p+' in credits?',body:c.card?'':'No card is saved, so the payment page opens.',confirm:c.card?'Confirm':'Continue'}))return;
 const r=await (await fetch(base+'/api/topup',j({pack:p,confirm:c.confirm}))).json();
 if(r.url){location.href=r.url;return;} $('#mt').textContent='Adding credits…';
 const before=last?.balance_nano||0; for(let i=0;i<20;i++){await new Promise(z=>setTimeout(z,1500));await state();if(last.balance_nano>before)break;}
 $('#modal').style.display='none';$('#mt').textContent='Out of credits';if(pending){const m=pending;pending=null;send(m);}}
document.querySelectorAll('[data-p]').forEach(b=>b.onclick=()=>topup(+b.dataset.p));$('#b10').onclick=()=>topup(10);$('#b25').onclick=()=>topup(25);
$('#close').onclick=e=>{e.preventDefault();$('#modal').style.display='none';};
$('#portal').onclick=async()=>{location.href=(await (await fetch(base+'/api/portal',{method:'POST'})).json()).url;};
(async()=>{for(const m of await (await fetch(base+'/api/history')).json())add(m.role==='user'?'me':'bot',m.content);})();
async function cstat(){const s=await (await fetch(base+'/api/computer/status')).json();$('#cst').textContent=s.running?'· awake':'· asleep'+(s.current_checkpoint?' (saved '+Math.round(s.current_checkpoint.bytes/1024)+' KB)':'');}
$('#cf').onsubmit=async e=>{e.preventDefault();const c=$('#cmd').value.trim();if(!c)return;$('#cout').textContent+='$ '+c+'\\n'+( $('#cst').textContent.includes('asleep')?'(waking computer…)\\n':'');
 const r=await fetch(base+'/api/computer/exec',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({cmd:c})});const d=await r.json();
 if(r.status===402){$('#modal').style.display='block';return;} $('#cout').textContent+=(d.out??('⚠ '+d.error))+(d.checkpoint?.ok?'[saved]\\n':'')+'\\n';$('#cout').scrollTop=1e9;cstat();state();};
$('#csleep').onclick=async()=>{await fetch(base+'/api/computer/sleep',{method:'POST'});cstat();};cstat();
state();setInterval(state,15000);
</script>`;
}

export { Ledger };   // Cloud-only billing DO; private 1HC configs bind it.
Object.assign(Ledger.prototype, ledgerGuard, ledgerByok, ledgerDictation);
Object.assign(UsageLedger.prototype, ledgerDictation);

// ---------------------------------------------------------------------------
// Linux computer: one Cloudflare Container per workspace.
// Disk is ephemeral, so /workspace is checkpointed to R2 as a tar.gz and restored on wake.
// A checkpoint only becomes "current" after the upload completes and its size+SHA-256 are recorded,
// so a save that dies halfway can never replace the last good copy.
const PART = 10 * 1024 * 1024;              // R2 multipart: equal-size parts except the last
const COMPUTER_NANO_PER_SEC = Math.ceil((1 * 0.0000025 + 0.25 * 0.000020 + 4 * 0.00000007) * 1e9 * MARKUP); // "basic" instance, cost+15%
const IDLE_MS = 3 * 60e3;
const EXCLUDES = ["./node_modules", "*/node_modules", "./.cache", "./.npm", "./.venv", "*/__pycache__", "./.home/.cache", "./.home/.npm"];
const dec = new TextDecoder();
const SAVE_DEBOUNCE_MS = 20e3;
// PID 1 inside the container. Cloudflare stops a container (idle, rollout, host restart) by sending SIGTERM to PID 1,
// then SIGKILL after up to 15 min. `sleep infinity` ignored SIGTERM: no final save, and a billed 15-min hang.
// This init asks its own Durable Object to save (via the computer.internal virtual host, handled outside the VM),
// then exits so the platform can stop the machine immediately.
const INIT_SH = `on_term() { echo "[init] SIGTERM: asking controller to save"; curl -sS -m 600 -X POST http://computer.internal/sigterm; echo; echo "[init] exiting"; exit 0; }
trap on_term TERM INT
echo "[init] up"
while true; do sleep 3600 & wait $!; done`;
function restoreDeletionPaths(raw) {
  let paths;
  try { paths = JSON.parse(raw || "[]"); } catch { throw new Error("invalid restore deletion list"); }
  if (!Array.isArray(paths)) throw new Error("invalid restore deletion list");
  for (const path of paths) {
    if (typeof path !== "string" || !path || path.length > 4096 || path.startsWith("/") || path.includes("\0") ||
        path.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("invalid restore deletion path");
  }
  return paths;
}
const SNAP_AGENT = "// Runs inside the container. Diffs /workspace against the last committed state and lists what a save must include.\n// usage: node snap.js scan  -> writes /tmp/1hc/changed (NUL list), /tmp/1hc/next.json; prints {changed,deleted,bytes}\n//        node snap.js commit -> next.json becomes the committed baseline\n//        node snap.js baseline -> record current tree as committed (after restore)\nconst fs = require(\"fs\"), path = require(\"path\");\nconst ROOT = \"/workspace\", DIR = \"/tmp/1hc\";\nconst SKIP = new Set([\"node_modules\", \".cache\", \".npm\", \".venv\", \"__pycache__\"]);\nconst SKIP_PATHS = new Set([\".home/.cache\", \".home/.npm\"]);\nfs.mkdirSync(DIR, { recursive: true });\nfunction walk(rel, out) {\n  const abs = path.join(ROOT, rel);\n  let ents; try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }\n  for (const e of ents) {\n    const r = rel ? `${rel}/${e.name}` : e.name;\n    if (SKIP.has(e.name) || SKIP_PATHS.has(r)) continue;\n    let st; try { st = fs.lstatSync(path.join(ROOT, r)); } catch { continue; }\n    const kind = st.isDirectory() ? \"d\" : st.isSymbolicLink() ? \"l\" : st.isFile() ? \"f\" : null;\n    if (!kind) continue;\n    out[r] = [kind, kind === \"d\" ? 0 : st.size, Math.floor(st.mtimeMs), Math.floor(st.ctimeMs), st.mode];\n    if (kind === \"d\") walk(r, out);\n  }\n}\nconst cmd = process.argv[2];\nconst now = {}; walk(\"\", now);\nif (cmd === \"baseline\") { fs.writeFileSync(`${DIR}/prev.json`, JSON.stringify(now)); console.log(JSON.stringify({ entries: Object.keys(now).length })); process.exit(0); }\nif (cmd === \"commit\") { fs.renameSync(`${DIR}/next.json`, `${DIR}/prev.json`); console.log(\"{}\"); process.exit(0); }\nlet prev = {}; try { prev = JSON.parse(fs.readFileSync(`${DIR}/prev.json`, \"utf8\")); } catch {}\nconst changed = [], deleted = []; let bytes = 0;\nfor (const [r, v] of Object.entries(now)) {\n  const p = prev[r];\n  if (!p || p[0] !== v[0] || p[1] !== v[1] || p[2] !== v[2] || p[3] !== v[3] || p[4] !== v[4]) { changed.push(r); if (v[0] === \"f\") bytes += v[1]; }\n}\nfor (const r of Object.keys(prev)) if (!(r in now)) deleted.push(r);\nfs.writeFileSync(`${DIR}/changed`, changed.map((r) => r + \"\\0\").join(\"\"));\nfs.writeFileSync(`${DIR}/next.json`, JSON.stringify(now));\nconsole.log(JSON.stringify({ changed: changed.length, deleted, bytes, full: Object.keys(prev).length === 0 }));\n";

// Handles http://computer.internal/* requests made from inside one container. The interception is installed per
// container with that container's own DO id in props, so a container can only ever reach its own controller.
export class ComputerControl extends WorkerEntrypoint {
  async fetch(req) {
    const u = new URL(req.url);
    const C = this.env.COMPUTER.get(this.env.COMPUTER.idFromString(this.ctx.props.id));
    if (u.pathname === "/sigterm" && req.method === "POST") return Response.json(await C.onSigterm());
    return new Response("not found", { status: 404 });
  }
}

export class Computer extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env); this.env = tolerantEnv(env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS ckpt (seq INTEGER PRIMARY KEY, key TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, what TEXT NOT NULL);`);
    const cols = this.sql.exec("PRAGMA table_info(ckpt)").toArray().map((c) => c.name);
    if (!cols.includes("kind")) {
      this.sql.exec("ALTER TABLE ckpt ADD COLUMN kind TEXT NOT NULL DEFAULT 'full'");
      this.sql.exec("ALTER TABLE ckpt ADD COLUMN deleted TEXT NOT NULL DEFAULT '[]'");
      this.sql.exec("ALTER TABLE ckpt ADD COLUMN files INTEGER NOT NULL DEFAULT 0");
    }
  }
  get(k) { return this.sql.exec("SELECT v FROM kv WHERE k=?", k).toArray()[0]?.v; }
  put(k, v) { this.sql.exec("INSERT INTO kv VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", k, String(v)); }
  log(what) { this.sql.exec("INSERT INTO events (at,what) VALUES (?,?)", Date.now(), what); }
  current() { return this.sql.exec("SELECT * FROM ckpt ORDER BY seq DESC LIMIT 1").toArray()[0]; }

  async sh(cmd, { timeoutMs = 120e3, stdin } = {}) {
    // HOME lives inside /workspace so dotfiles (git identity, shell history, tool configs) are saved too.
    const p = await this.ctx.container.exec(["bash", "-lc", `mkdir -p /workspace/.home && ${cmd}`], { cwd: "/", stderr: "combined", env: { HOME: "/workspace/.home" }, ...(stdin ? { stdin } : {}) });
    const t = setTimeout(() => { try { p.kill(9); } catch {} }, timeoutMs);
    const out = await p.output(); clearTimeout(t);
    return { code: out.exitCode, out: dec.decode(out.stdout) };
  }

  // Prepay one minute at a time from the tenant balance. If the balance can't cover the next minute, the computer stops.
  async prepayMinute() {
    const L = this.env.LEDGER.get(this.env.LEDGER.idFromName(`tenant:${this.get("tenant")}`));
    const id = `computer:${crypto.randomUUID()}`, nano = COMPUTER_NANO_PER_SEC * 60;
    const r = await L.reserve(id, nano);
    if (!r.ok) { this._payFail = r.reason; return false; }
    await L.settle(id, nano);
    this.put("paid_until", Math.max(Number(this.get("paid_until") || 0), Date.now()) + 60e3);
    this.put("billed_nano", Number(this.get("billed_nano") || 0) + nano);
    return true;
  }

  async ensureRunning(tenant) {
    if (tenant) this.put("tenant", tenant);
    if (this.ctx.container.running && this.get("ready") === "1") return { cold: false };
    const t0 = Date.now();
    if (!(await this.prepayMinute())) throw payError(this._payFail);
    // A container that got SIGTERM is saving and about to exit; wait for it instead of reusing it.
    for (let i = 0; i < 120 && this.ctx.container.running && this.get("draining") === "1"; i++) await new Promise((z) => setTimeout(z, 500));
    this.put("ready", "0"); this.put("draining", "0");
    await this.ctx.container.interceptOutboundHttp("computer.internal", this.ctx.exports.ComputerControl({ props: { id: this.ctx.id.toString() } }));
    let startErr = "";   // the platform's refusal when the class is at max_instances (computer-capacity.js)
    if (!this.ctx.container.running) { try { this.ctx.container.start({ entrypoint: ["bash", "-c", INIT_SH], enableInternet: true }); } catch (e) { if (!isCapacityError(e)) throw e; startErr = String(e?.message || e); } }
    this.ctx.container.monitor?.().then(() => { this.put("ready", "0"); this.put("draining", "0"); this.log("container exited"); }).catch((e) => { startErr = String(e?.message || e); this.put("ready", "0"); this.put("draining", "0"); this.log(`container exited: ${e?.message || e}`); });
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      try { up = (await this.sh("true", { timeoutMs: 5e3 })).code === 0; } catch { await new Promise((z) => setTimeout(z, 500)); }
      if (!up && i >= 4 && isCapacityError(startErr)) throw computerBusyError();   // refused: stop after ~2 s, not 30 s
    }
    if (!up && isCapacityError(startErr)) throw computerBusyError();
    if (!up) throw new Error("computer did not start within 30s");
    const bootMs = Date.now() - t0;
    const restore = await this.restore();
    this.put("ready", "1"); this.put("last_activity", Date.now()); this.put("started_at", Date.now());
    await this.ctx.storage.setAlarm(Date.now() + 30e3);
    this.log(`started: boot ${bootMs}ms, restore ${JSON.stringify(restore)}`);
    return { cold: true, boot_ms: bootMs, restore };
  }

  async restore() {
    await this.sh("mkdir -p /workspace");
    await this.installAgent();
    const chain = this.chain();
    if (!chain.length) { await this.sh("node /tmp/1hc/snap.js baseline"); return { from: null }; }
    // These paths become rm arguments inside the container. Validate every
    // checkpoint before applying a layer so a bad list cannot leave a partial restore.
    const deletions = chain.map((c) => restoreDeletionPaths(c.deleted));
    const t0 = Date.now(); let bytes = 0;
    for (const [index, c] of chain.entries()) {
      const obj = await this.env.WS.get(c.key);
      if (!obj) throw new Error(`save ${c.key} missing from storage`);
      const [forTar, forHash] = obj.body.tee();
      const digest = new crypto.DigestStream("SHA-256"); const hashing = forHash.pipeTo(digest);
      const p = await this.ctx.container.exec(["tar", "-xzf", "-", "-C", "/workspace"], { stdin: forTar, stderr: "combined" });
      const out = await p.output(); await hashing;
      const sha = hex(await digest.digest);
      if (out.exitCode !== 0 || sha !== c.sha256) throw new Error(`restore failed at ${c.seq}: tar ${out.exitCode} sha ${sha === c.sha256 ? "ok" : "MISMATCH"}`);
      const del = deletions[index];
      if (del.length) {
        const list = new Blob([del.map((d) => d + "\0").join("")]).stream();
        const rm = await this.ctx.container.exec(["bash", "-c", "cd /workspace && xargs -0 -r rm -rf --"], { stdin: list, stderr: "combined" });
        if ((await rm.output()).exitCode !== 0) throw new Error(`restore deletion failed at ${c.seq}`);
      }
      bytes += c.bytes;
    }
    await this.sh("node /tmp/1hc/snap.js baseline");
    return { layers: chain.length, kinds: chain.map((c) => c.kind[0]).join(""), bytes, sha_ok: true, ms: Date.now() - t0 };
  }

  // Incremental saves. A save is a "layer": a tar of only the files that changed since the last committed save,
  // plus the paths deleted since then. Restore = apply layers in order. A layer counts only after its upload is
  // complete and verified, so a save that dies halfway is ignored and its changes roll into the next save.
  // When the chain gets long, the next save is a full one (compaction) and older layers are deleted.
  async installAgent() {
    const body = new Blob([SNAP_AGENT]).stream();
    const p = await this.ctx.container.exec(["bash", "-c", "mkdir -p /tmp/1hc && cat > /tmp/1hc/snap.js"], { stdin: body, stderr: "combined" });
    const o = await p.output(); if (o.exitCode !== 0) throw new Error("agent install failed: " + dec.decode(o.stdout));
  }
  // The current state = the latest base (one full save, or the set of imported layers) plus the deltas after it.
  chain() {
    return this.sql.exec(`SELECT * FROM ckpt WHERE seq >= COALESCE((SELECT MAX(seq) FROM ckpt WHERE kind='full'), (SELECT MIN(seq) FROM ckpt WHERE kind='import'), 0) ORDER BY seq`).toArray();
  }
  // Migration: register uploaded, verified tarballs as the workspace's base layers. Only allowed on an empty computer.
  async importLayers(tenant, layers) {
    if (tenant) this.put("tenant", tenant);
    if (this.ctx.container.running) throw new Error("computer is awake; import needs it asleep");
    const existing = this.sql.exec("SELECT key,bytes,sha256,kind FROM ckpt ORDER BY seq").toArray();
    if (existing.length) {
      if (existing.length === layers.length && existing.every((x, i) => x.kind === "import" && x.key === layers[i].key && x.bytes === layers[i].bytes && x.sha256 === layers[i].sha256))
        return { layers: existing.length };   // retry after an archive commit failed
      throw new Error("computer already has saved files; import only into a fresh workspace");
    }
    let seq = Date.now();
    this.ctx.storage.transactionSync(() => { for (const l of layers) this.sql.exec("INSERT INTO ckpt (seq,key,bytes,sha256,at,kind,deleted,files) VALUES (?,?,?,?,?,?,?,?)", seq++, l.key, l.bytes, l.sha256, Date.now(), "import", "[]", l.files || 0); });
    this.log(`imported ${layers.length} layers, ${layers.reduce((a, l) => a + l.bytes, 0)} bytes`);
    return { layers: layers.length };
  }

  async checkpoint({ crashAfterParts, forceFull } = {}) {
    const seq = Date.now(), t0 = Date.now();
    const chain = this.chain();
    const deltas = chain.filter((c) => c.kind === "delta"), deltaBytes = deltas.reduce((a, c) => a + c.bytes, 0);
    const baseBytes = chain.filter((c) => c.kind !== "delta").reduce((a, c) => a + c.bytes, 0);
    const full = forceFull || !baseBytes || deltas.length >= 12 || deltaBytes > baseBytes * 0.5;
    if (full) await this.sh("rm -f /tmp/1hc/prev.json");
    const scan = await this.sh("node /tmp/1hc/snap.js scan", { timeoutMs: 110e3 });
    if (scan.code !== 0) return { ok: false, error: "scan failed: " + scan.out.slice(0, 300) };
    const diff = JSON.parse(scan.out.trim().split("\n").pop());
    if (!full && diff.changed === 0 && diff.deleted.length === 0) return { ok: true, skipped: true, reason: "no changes", ms: Date.now() - t0 };
    const kind = full ? "full" : "delta", key = `t/${this.get("tenant")}/ckpt/${seq}-${kind}.tar.gz`;
    const p = await this.ctx.container.exec(["bash", "-c", "cd /workspace && tar --null --no-recursion -T /tmp/1hc/changed --warning=no-file-changed --ignore-failed-read -czf - "], { stderr: "ignore" });
    const mpu = await this.env.WS.createMultipartUpload(key, { customMetadata: { app: "1hc-proto", seq: String(seq), kind } });
    const digest = new crypto.DigestStream("SHA-256"), dw = digest.getWriter();
    const parts = []; let buf = new Uint8Array(PART), fill = 0, total = 0;
    const flush = async (n) => { parts.push(await mpu.uploadPart(parts.length + 1, buf.slice(0, n))); fill = 0; };
    try {
      const reader = p.stdout.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        await dw.write(value); total += value.byteLength;
        let off = 0;
        while (off < value.byteLength) {
          const n = Math.min(PART - fill, value.byteLength - off);
          buf.set(value.subarray(off, off + n), fill); fill += n; off += n;
          if (fill === PART) { await flush(PART); if (crashAfterParts && parts.length >= crashAfterParts) throw new Error("SIMULATED CRASH mid-checkpoint"); }
        }
      }
      const code = await p.exitCode;
      if (code !== 0 && code !== 1) throw new Error(`tar exited ${code}`);
      if (fill > 0 || parts.length === 0) await flush(fill);
      if (crashAfterParts) throw new Error("SIMULATED CRASH mid-checkpoint");
      // storage.js: a save that would grow the account past its limit is never completed; the previous save stays current.
      const grows = total - (full ? Number(this.sql.exec("SELECT COALESCE(SUM(bytes),0) b FROM ckpt").one().b) : 0), rm = grows > 0 ? await room(this.env, this.get("tenant"), grows) : { ok: true };
      if (!rm.ok) { await noteRefused(this.env, this.get("tenant"), "computer save"); throw Object.assign(new Error(fullMessage(rm)), { storage_full: true }); }
      await stComplete(this.env, key, mpu, parts); await dw.close();
      const sha = hex(await digest.digest);
      const head = await this.env.WS.head(key);
      if (!head || head.size !== total) throw new Error(`size check failed ${head?.size} vs ${total}`);
      this.sql.exec("INSERT INTO ckpt (seq,key,bytes,sha256,at,kind,deleted,files) VALUES (?,?,?,?,?,?,?,?)", seq, key, total, sha, Date.now(), kind, JSON.stringify(diff.deleted), diff.changed);
      await this.sh("node /tmp/1hc/snap.js commit");
      if (full) for (const old of this.sql.exec("SELECT seq,key,bytes FROM ckpt WHERE seq < ?", seq).toArray()) { await stDelete(this.env, [{ key: old.key, size: old.bytes }]); this.sql.exec("DELETE FROM ckpt WHERE seq=?", old.seq); }
      this.put("dirty", "0");
      this.log(`save ${kind} ${seq}: ${diff.changed} entries, ${diff.deleted.length} deleted, ${total} bytes, ${Date.now() - t0}ms`);
      return { ok: true, kind, seq, files: diff.changed, deleted: diff.deleted.length, bytes: total, parts: parts.length, chain: this.chain().length, ms: Date.now() - t0 };
    } catch (e) {
      try { p.kill(9); } catch {}
      await mpu.abort().catch(() => {});
      this.log(`save ${seq} FAILED: ${e.message}`);
      return { ok: false, error: e.message, current: this.current()?.seq ?? null, ...(e.storage_full ? { storage_full: true } : {}) };
    }
  }

  async stop(reason) {
    let ck = null;
    if (this.ctx.container.running && this.get("ready") === "1") ck = await this.checkpoint();
    if (ck && !ck.ok) return { stopped: false, reason, checkpoint: ck };
    this.put("ready", "0");
    if (this.ctx.container.running) await this.ctx.container.destroy(reason);
    this.log(`stopped: ${reason}`);
    return { stopped: true, reason, checkpoint: ck };
  }
  // Called (through ComputerControl) by the container's init when the platform sends SIGTERM.
  async onSigterm() {
    const t0 = Date.now();
    if (this.get("draining") === "1") return { ok: true, duplicate: true };
    this.put("draining", "1"); this.log("SIGTERM from platform: final save");
    let ck = null;
    if (this.get("ready") === "1") { try { ck = await this.checkpoint(); } catch (e) { ck = { ok: false, error: e.message }; } }
    this.put("ready", "0");
    this.log(`SIGTERM save ${ck ? (ck.ok ? (ck.skipped ? "not needed" : `${ck.kind} ${ck.files} files`) : "FAILED " + ck.error) : "skipped (not ready)"}, ${Date.now() - t0}ms`);
    return { ok: !ck || ck.ok, checkpoint: ck, ms: Date.now() - t0 };
  }
  // TEST ONLY: deliver SIGTERM exactly as the platform does, and time how long the machine takes to stop.
  async testSigterm() {
    if (!this.ctx.container.running) return { error: "not running" };
    const t0 = Date.now();
    this.ctx.container.signal(15);
    for (let i = 0; i < 240 && this.ctx.container.running; i++) await new Promise((z) => setTimeout(z, 500));
    return { exited: !this.ctx.container.running, ms: Date.now() - t0, events: this.sql.exec("SELECT at,what FROM events ORDER BY seq DESC LIMIT 4").toArray() };
  }
  // TEST ONLY (storage experiments): stream a container file to R2, and R2 back into a container file (optionally N ranged parts in parallel).
  async testFileToR2(path, key) {
    if (!key.startsWith(`t/${this.get("tenant")}/exp/`)) return { error: "key must be under t/<tenant>/exp/" };
    const t0 = Date.now();
    const p = await this.ctx.container.exec(["cat", path], { stderr: "ignore" });
    const mpu = await this.env.WS.createMultipartUpload(key);
    const parts = []; let buf = new Uint8Array(PART), fill = 0, total = 0;
    const reader = p.stdout.getReader();
    for (;;) { const { value, done } = await reader.read(); if (done) break; total += value.byteLength; let off = 0;
      while (off < value.byteLength) { const n = Math.min(PART - fill, value.byteLength - off); buf.set(value.subarray(off, off + n), fill); fill += n; off += n;
        if (fill === PART) { parts.push(await mpu.uploadPart(parts.length + 1, buf.slice(0, PART))); fill = 0; } } }
    if (fill > 0 || !parts.length) parts.push(await mpu.uploadPart(parts.length + 1, buf.slice(0, fill)));
    await stComplete(this.env, key, mpu, parts);
    return { key, bytes: total, ms: Date.now() - t0 };
  }
  async testR2ToFile(key, path, parts) {
    const tenant = this.get("tenant");
    if (!tenant || !String(key).startsWith(`t/${tenant}/`)) return { error: "key must be under this tenant" };
    if (!Number.isSafeInteger(parts) || parts < 1 || parts > 64) return { error: "parts must be from 1 to 64" };
    const t0 = Date.now();
    const head = await this.env.WS.head(key); if (!head) return { error: "missing" };
    const size = head.size, per = Math.ceil(size / parts);
    // A test route still takes a caller-controlled path; pass it as an argv item, never shell source.
    for (const argv of [["rm", "-f", "--", path], ["truncate", "-s", String(size), "--", path]]) {
      const p = await this.ctx.container.exec(argv, { stderr: "combined" }), o = await p.output();
      if (o.exitCode !== 0) throw new Error(`file preparation failed: ${argv[0]}`);
    }
    await Promise.all(Array.from({ length: parts }, async (_, i) => {
      const off = i * per, len = Math.min(per, size - off); if (len <= 0) return;
      const obj = await this.env.WS.get(key, { range: { offset: off, length: len } });
      const p = await this.ctx.container.exec(["dd", `of=${path}`, "bs=1M", `seek=${off}`, "oflag=seek_bytes", "conv=notrunc", "status=none"], { stdin: obj.body, stderr: "combined" });
      const o = await p.output(); if (o.exitCode !== 0) throw new Error("dd failed " + dec.decode(o.stdout));
    }));
    return { key, bytes: size, parts, ms: Date.now() - t0 };
  }
  // TEST ONLY: kill the machine with no final save, like a host failure.
  async kill() { this.put("ready", "0"); if (this.ctx.container.running) await this.ctx.container.destroy("simulated host failure"); this.log("killed without save"); return { killed: true }; }

  // save: "now" (end of turn) | "defer" (mark dirty; saved 20s after the last command, or at sleep/idle) | "none" (test)
  async exec(tenant, cmd, { save = "defer" } = {}) {
    const boot = await this.ensureRunning(tenant);
    this.put("last_activity", Date.now());
    const t0 = Date.now();
    const r = await this.sh(`cd /workspace && ${cmd}`, { timeoutMs: 110e3 });
    this.put("last_activity", Date.now());
    let ck = null;
    if (save === "now") ck = await this.checkpoint();
    else if (save === "defer") { this.put("dirty", "1"); this.put("save_due", Date.now() + SAVE_DEBOUNCE_MS); await this.armAlarm(Date.now() + SAVE_DEBOUNCE_MS); }
    return { ...r, out: r.out.slice(-20000), ms: Date.now() - t0, boot, checkpoint: ck, pending_save: this.get("dirty") === "1" };
  }
  async endTurn() { return this.get("dirty") === "1" && this.ctx.container.running ? await this.checkpoint() : { ok: true, skipped: true, reason: "nothing to save" }; }
  async armAlarm(at) { const cur = await this.ctx.storage.getAlarm(); if (!cur || at < cur) await this.ctx.storage.setAlarm(at); }

  // Bee data API jobs (src/bee.js) run on this class under their own name "beejob:<tenant>": no workspace, no restore, no saves.
  async beeJob(input) { return beeJobOn(this, input); }
  // File sidecars (sidecar.js) under "prepjob:<tenant>": anydoc / pdf-inspector natively (scanned-page OCR, files too big for the Worker).
  async prepJob(input) { return prepJobOn(this, input); }
  async beeLive(input) { return beeLiveOn(this, input); }   // Live notes: one chunk of the polling job (bee.js LIVE_JS), lines → the LiveNotes DO
  async beeLiveStop(run) { return beeLiveStopOn(this, run); }
  async alarm() {
    if (this.env.ENV_NAME === "selfhost" && this.env.BACKUP_MAINTENANCE === "1") { await this.ctx.storage.setAlarm(Date.now() + 60e3); return; }
    if (this.get("role") === "bee") return beeJobAlarm(this);
    if (this.get("role") === "prep") return prepJobAlarm(this);
    if (!this.ctx.container.running || this.get("ready") !== "1") return;
    const idleMs = Number(this.get("idle_ms") || IDLE_MS);
    if (Date.now() - Number(this.get("last_activity") || 0) > idleMs) { await this.stop("idle"); return; }
    if (Number(this.get("paid_until") || 0) - Date.now() < 30e3 && !(await this.prepayMinute())) { await this.stop("out of credits"); return; }
    if (this.get("dirty") === "1" && Date.now() >= Number(this.get("save_due") || 0)) await this.checkpoint();
    let next = Date.now() + 30e3;
    if (this.get("dirty") === "1") next = Math.min(next, Number(this.get("save_due")));
    await this.ctx.storage.setAlarm(Math.max(next, Date.now() + 1000));
  }
  async snapshotPrepare() {
    if (this.env.ENV_NAME !== "selfhost" || this.env.BACKUP_MAINTENANCE !== "1") throw new Error("snapshot unavailable");
    if (!this.ctx.container) {
      if (this.get("ready") === "1" || this.get("dirty") === "1") throw new Error("computer binding unavailable during backup");
      return { ready: true };
    }
    const result = await this.stop("backup");
    if (!result.stopped || (result.checkpoint && !result.checkpoint.ok)) throw new Error("computer checkpoint did not complete");
    return { ready: true };
  }
  async setIdle(ms) { this.put("idle_ms", ms); return { idle_ms: ms }; }

  async status() {
    return { running: this.ctx.container.running, ready: this.get("ready") === "1", current_checkpoint: this.current() || null,
      checkpoints: this.sql.exec("SELECT seq,kind,files,bytes FROM ckpt ORDER BY seq DESC").toArray(), dirty: this.get("dirty") === "1",
      billed_nano: Number(this.get("billed_nano") || 0), rate_nano_per_sec: COMPUTER_NANO_PER_SEC,
      events: this.sql.exec("SELECT at,what FROM events ORDER BY seq DESC LIMIT 12").toArray() };
  }
}

// Imported 1Helm data (channels, threads, messages, memory, follow-ups, workflows, skills) + upload bookkeeping.
export class Archive extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env); this.env = tolerantEnv(env); this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS rows (tbl TEXT NOT NULL, id TEXT NOT NULL, channel_id TEXT, data TEXT NOT NULL, PRIMARY KEY (tbl, id));
      CREATE INDEX IF NOT EXISTS rows_ch ON rows(tbl, channel_id);
      CREATE TABLE IF NOT EXISTS imports (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, status TEXT NOT NULL, report TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS objects (import_id TEXT NOT NULL, name TEXT NOT NULL, key TEXT NOT NULL, upload_id TEXT NOT NULL, parts TEXT NOT NULL DEFAULT '[]', done INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (import_id, name));
      CREATE TABLE IF NOT EXISTS import_rows (import_id TEXT NOT NULL, tbl TEXT NOT NULL, id TEXT NOT NULL, channel_id TEXT, data TEXT NOT NULL, PRIMARY KEY (import_id, tbl, id));
      CREATE TABLE IF NOT EXISTS import_finishes (id TEXT PRIMARY KEY, attempt TEXT NOT NULL, expires INTEGER NOT NULL);`);
  }
  async createImport(id, tokenHash) { this.sql.exec("INSERT INTO imports VALUES (?,?,?,?,?)", id, tokenHash, "uploading", "", Date.now()); return { id }; }
  async auth(id, tokenHash) { const r = this.sql.exec("SELECT token_hash, status FROM imports WHERE id=?", id).toArray()[0]; return !!r && r.token_hash === tokenHash && r.status !== "done"; }
  async object(id, name) { return this.sql.exec("SELECT * FROM objects WHERE import_id=? AND name=?", id, name).toArray()[0] || null; }
  async putObject(id, name, key, uploadId) { this.sql.exec("INSERT OR IGNORE INTO objects (import_id,name,key,upload_id) VALUES (?,?,?,?)", id, name, key, uploadId); return this.object(id, name); }
  async addPart(id, name, part) {
    return this.ctx.storage.transactionSync(() => {
      const o = this.sql.exec("SELECT parts,done FROM objects WHERE import_id=? AND name=?", id, name).one();
      if (!o || o.done) throw new Error("import object is not accepting parts");
      const parts = JSON.parse(o.parts).filter((p) => p.partNumber !== part.partNumber); parts.push(part);
      this.sql.exec("UPDATE objects SET parts=? WHERE import_id=? AND name=?", JSON.stringify(parts), id, name);
      return parts.length;
    });
  }
  async markDone(id, name) { this.sql.exec("UPDATE objects SET done=1 WHERE import_id=? AND name=?", id, name); }
  async completeImportObject(id, name, tenantId) {
    // All imports for a tenant share this Archive. Keep the quota read, R2 complete,
    // and counter update in one queue so separate objects cannot spend the same room.
    const finish = async () => {
      const o = await this.object(id, name);
      if (!o) return { status: 404, body: { error: "unknown object" } };
      if (!o.done) {
        const recorded = JSON.parse(o.parts).sort((a, b) => a.partNumber - b.partNumber);
        if (recorded.some((p) => !Number.isSafeInteger(p.bytes) || p.bytes < 1 || p.bytes > IMPORT_PART))
          return { status: 409, body: { error: "re-upload the object's parts before completing it" } };
        const bytes = recorded.reduce((n, p) => n + p.bytes, 0);
        const rm = await room(this.env, tenantId, bytes);
        if (!rm.ok) { await noteRefused(this.env, tenantId, "import"); return { status: 507, body: { error: fullMessage(rm), storage_full: true } }; }
        await stComplete(this.env, o.key, this.env.WS.resumeMultipartUpload(o.key, o.upload_id), recorded.map(({ partNumber, etag }) => ({ partNumber, etag })));
        await this.markDone(id, name);
      }
      const head = await this.env.WS.head(o.key);
      return { status: 200, body: { name, bytes: head?.size ?? null } };
    };
    const current = (this.importCompletion || Promise.resolve()).then(finish);
    this.importCompletion = current.catch(() => {});
    return current;
  }
  async listObjects(id) { return this.sql.exec("SELECT name,key,done,parts FROM objects WHERE import_id=?", id).toArray().map((o) => ({ ...o, parts: JSON.parse(o.parts).map((p) => p.partNumber).sort((a, b) => a - b) })); }
  async ingest(batch) {
    this.ctx.storage.transactionSync(() => { for (const r of batch) this.sql.exec("INSERT OR REPLACE INTO rows VALUES (?,?,?,?)", r.t, String(r.r.id ?? (r.t === "agent_skills" ? `${r.r.agent_id}:${r.r.skill_id}` : r.r.agent_id)), r.r.channel_id == null ? null : String(r.r.channel_id), JSON.stringify(r.r)); });
    return batch.length;
  }
  async beginImportFinish(importId, attempt) {
    return this.ctx.storage.transactionSync(() => {
      if (this.sql.exec("SELECT status FROM imports WHERE id=?", importId).one()?.status !== "uploading") return false;
      const old = this.sql.exec("SELECT attempt,expires FROM import_finishes WHERE id=?", importId).one();
      if (old && old.expires > Date.now()) return false;
      if (old) this.sql.exec("DELETE FROM import_rows WHERE import_id=?", old.attempt);
      this.sql.exec("INSERT OR REPLACE INTO import_finishes VALUES (?,?,?)", importId, attempt, Date.now() + 300000);
      return true;
    });
  }
  async releaseImportFinish(importId, attempt) {
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM import_rows WHERE import_id=?", attempt);
      this.sql.exec("DELETE FROM import_finishes WHERE id=? AND attempt=?", importId, attempt);
    });
  }
  async renewImportFinish(importId, attempt) {
    this.ctx.storage.transactionSync(() => {
      this.assertImportFinish(importId, attempt);
      this.sql.exec("UPDATE import_finishes SET expires=? WHERE id=? AND attempt=?", Date.now() + 300000, importId, attempt);
    });
  }
  assertImportFinish(importId, attempt) {
    const lease = this.sql.exec("SELECT attempt,expires FROM import_finishes WHERE id=?", importId).one();
    if (lease?.attempt !== attempt || lease.expires <= Date.now()) throw new Error("import finish lease expired");
  }
  async stageImportRows(importId, attempt, batch) {
    this.ctx.storage.transactionSync(() => {
      this.assertImportFinish(importId, attempt);
      this.sql.exec("UPDATE import_finishes SET expires=? WHERE id=? AND attempt=?", Date.now() + 300000, importId, attempt);
      for (const r of batch) this.sql.exec("INSERT OR REPLACE INTO import_rows VALUES (?,?,?,?,?)", attempt, r.t, String(r.r.id ?? (r.t === "agent_skills" ? `${r.r.agent_id}:${r.r.skill_id}` : r.r.agent_id)), r.r.channel_id == null ? null : String(r.r.channel_id), JSON.stringify(r.r));
    });
    return batch.length;
  }
  async stagedCounts(importId, attempt) { this.assertImportFinish(importId, attempt); return Object.fromEntries(this.sql.exec("SELECT tbl, COUNT(*) n FROM import_rows WHERE import_id=? GROUP BY tbl", attempt).toArray().map((r) => [r.tbl, r.n])); }
  async commitImportRows(importId, attempt, report) {
    this.ctx.storage.transactionSync(() => {
      this.assertImportFinish(importId, attempt);
      if (this.sql.exec("SELECT status FROM imports WHERE id=?", importId).one()?.status !== "uploading") throw new Error("import already complete");
      this.sql.exec("INSERT OR REPLACE INTO rows SELECT tbl,id,channel_id,data FROM import_rows WHERE import_id=?", attempt);
      this.sql.exec("UPDATE imports SET status='done', report=? WHERE id=?", JSON.stringify(report), importId);
      this.sql.exec("DELETE FROM import_rows WHERE import_id=?", attempt);
      this.sql.exec("DELETE FROM import_finishes WHERE id=? AND attempt=?", importId, attempt);
    });
  }
  async counts() { return Object.fromEntries(this.sql.exec("SELECT tbl, COUNT(*) n FROM rows GROUP BY tbl").toArray().map((r) => [r.tbl, r.n])); }
  async finish(id, report) { this.sql.exec("UPDATE imports SET status='done', report=? WHERE id=?", JSON.stringify(report), id); }
  async lastReport() { const r = this.sql.exec("SELECT report FROM imports WHERE status='done' ORDER BY created DESC LIMIT 1").toArray()[0]; return r ? JSON.parse(r.report) : null; }
  async provisionFresh() {
    const existing = this.sql.exec("SELECT COUNT(*) n FROM rows WHERE tbl='channels'").one().n;
    if (existing) return { created: false, channels: existing };
    const channel = { id: 1, slug: "main", name: "General", kind: "channel", purpose: "For anything that doesn't have its own channel yet.", topic: "For anything that doesn't have its own channel yet.", created: Date.now(), updated: Date.now() };
    this.sql.exec("INSERT OR IGNORE INTO rows (tbl,id,channel_id,data) VALUES ('channels','1',NULL,?)", JSON.stringify(channel));
    return { created: true, channels: 1 };
  }
  async addTestChannel(slug) {
    const have = this.sql.exec("SELECT data FROM rows WHERE tbl='channels'").toArray().map((r) => JSON.parse(r.data));
    const ex = have.find((c) => (c.slug || c.name) === slug); if (ex) return { created: false, id: ex.id, slug };
    const id = 9000 + Number(slug.slice(5)), now = Date.now();
    this.sql.exec("INSERT OR IGNORE INTO rows (tbl,id,channel_id,data) VALUES ('channels',?,NULL,?)", String(id), JSON.stringify({ id, slug, name: slug, kind: "channel", purpose: "Browser bench (test only).", topic: "Browser bench (test only).", created: now, updated: now, test: true }));
    return { created: true, id, slug };
  }
  // A new channel row (channels.js createChannel). Atomic: the duplicate and limit checks run with the insert, no await between.
  async addChannel(o) { return insertChannel(this.sql, o); }
  async channels() {
    return this.sql.exec(`SELECT c.data d, (SELECT COUNT(*) FROM rows m WHERE m.tbl='messages' AND m.channel_id=c.id) msgs,
      (SELECT COUNT(*) FROM rows m WHERE m.tbl='memory_items' AND m.channel_id=c.id) mem,
      (SELECT COUNT(*) FROM rows m WHERE m.tbl='agent_workflows' AND m.channel_id=c.id) wf FROM rows c WHERE c.tbl='channels' ORDER BY CAST(c.id AS INTEGER)`).toArray()
      .map((r) => ({ ...JSON.parse(r.d), messages: r.msgs, memory: r.mem, workflows: r.wf })).filter((c) => !c.deleting);   // a channel being deleted is gone at once (deletion.js)
  }
  // Notebook: a person's own notes are memory_items rows too, so the helper reads them every turn (the system prompt loads memory).
  async noteAdd(cid, sec, text, author = "human", extra = {}) {
    // Unique even when many notes land in the same millisecond (a Bee import adds dozens at once).
    let id = `n${Date.now()}${Math.floor(Math.random() * 1000)}`;
    for (let i = 0; i < 50 && this.sql.exec("SELECT 1 FROM rows WHERE tbl='memory_items' AND id=?", id).toArray().length; i++) id = `n${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    const row = { ...(extra.src ? { src: String(extra.src).slice(0, 40), q: String(extra.q || "").slice(0, 40) } : {}), ...(Number(extra.bee_fact_id) > 0 ? { bee_fact_id: Number(extra.bee_fact_id) } : {}), ...(extra.page ? { page: extra.page } : {}), id, channel_id: String(cid), kind: sec === "ov" ? "summary" : author === "human" ? "preference" : sec === "how" ? "preference" : "fact", content: scrubSecrets(String(text)), sec, author_type: author === "human" ? "human" : "agent", scope: "channel", status: "current", created: Date.now() };
    this.sql.exec("INSERT INTO rows (tbl,id,channel_id,data) VALUES ('memory_items',?,?,?)", id, String(cid), JSON.stringify(row)); return row;
  }
  // Bee (bee-sync.js): link an existing From-Bee note to its fact (a note written without the link is matched back by its text).
  async noteLinkBee(cid, id, factId) {
    const r = this.sql.exec("SELECT data FROM rows WHERE tbl='memory_items' AND id=? AND channel_id=?", String(id), String(cid)).toArray()[0]; if (!r || !(Number(factId) > 0)) return null;
    const row = { ...JSON.parse(r.data), src: "bee", bee_fact_id: Number(factId) };
    this.sql.exec("UPDATE rows SET data=? WHERE tbl='memory_items' AND id=?", JSON.stringify(row), String(id)); return row;
  }
  // HS_WRITERS (hindsight-writers.js): one Notebook row, and a channel's rows oldest first (the rebuild reads them in pages).
  async noteRow(cid, id) { const r = this.sql.exec("SELECT data FROM rows WHERE tbl='memory_items' AND id=? AND channel_id=?", String(id), String(cid)).toArray()[0]; return r ? JSON.parse(r.data) : null; }
  async noteRows(cid, after = "", limit = 50, upTo = Infinity) {
    const all = this.sql.exec("SELECT data FROM rows WHERE tbl='memory_items' AND channel_id=?", String(cid)).toArray().map((r) => JSON.parse(r.data)).filter((m) => m.status !== "superseded" && m.src !== "reflection" && Number(m.created || 0) <= upTo)
      .sort((a, b) => (Number(a.created) || 0) - (Number(b.created) || 0) || String(a.id).localeCompare(String(b.id))), key = (m) => `${String(Number(m.created) || 0).padStart(15, "0")}|${m.id}`;
    const rows = all.filter((m) => !after || key(m) > after).slice(0, limit); return { rows, next: rows.length ? key(rows[rows.length - 1]) : null, done: rows.length < limit };
  }
  async noteEdit(cid, id, text) {
    const r = this.sql.exec("SELECT data FROM rows WHERE tbl='memory_items' AND id=? AND channel_id=?", String(id), String(cid)).toArray()[0]; if (!r) return null;
    const row = { ...JSON.parse(r.data), content: scrubSecrets(String(text)), author_type: "human", edited: Date.now() };
    this.sql.exec("UPDATE rows SET data=? WHERE tbl='memory_items' AND id=?", JSON.stringify(row), String(id)); return row;
  }
  // Workspace-shared memory: people (= Contacts) + workspace facts, one registry for every channel (people.js).
  get people() { return (this._people ||= new People(this.sql, this.env)); }
  async peopleList() { return this.people.list(); }
  async personGet(id) { return this.people.get(id); }
  // channels (optional, HS_WALLS): the channel or channels the person came up in, recorded in people_seen. The Contacts screen passes none.
  async personUpsert(o, origin = "", channels = null) { return this.people.upsert(o || {}, origin, channels); }
  // HS_WALLS (walls.js): the Contacts screen's "Seen in" edit and the helper's save into another channel; the one time backfill (dry unless apply).
  async personSeenAdd(id, channels) { return { ok: true, added: seenAdd(this.sql, String(id), channels) }; }
  async personSeenSet(id, channels) {
    if (!this.people.get(id)) return { error: "no such contact" };
    const known = new Set(this.sql.exec("SELECT data FROM rows WHERE tbl='channels'").toArray().map((r) => { try { return JSON.parse(r.data); } catch { return {}; } }).filter((c) => c.kind !== "dm" && !c.deleting).map((c) => c.slug || c.name));
    const want = (Array.isArray(channels) ? channels : []).map((c) => String(c)).filter((c) => known.has(c));
    return { ok: true, seen: seenSet(this.sql, String(id), want) };
  }
  async peopleSeenBackfill(apply = false) { void this.people; return this.ctx.storage.transactionSync(() => backfillSeen(this.sql, { dry: !apply, aliasesFor })); }
  async personRemove(id) { return this.people.remove(id); }
  async personMerge(keep, drop, pick = {}, preview = false) {
    const P = this.people; if (preview) { const m = P.mergePlan(keep, drop, pick); if (m.error) return m; const { _, ...plan } = m; return plan; }
    const r = this.ctx.storage.transactionSync(() => P.merge(keep, drop, pick)); return r; }
  async personNotDup(a, b) { return this.people.notDup(a, b); }
  async peopleDups() { return this.people.duplicates(); }
  async peopleImport(list, source = "") { const P = this.people; return this.ctx.storage.transactionSync(() => importContacts(P, list, source)); }
  async personPhoto(id) { return photoOf(this.sql, id); }
  async personFact(personId, text, src = "", replaces = null, extra = null) { return this.people.addFact(personId, text, src, replaces, extra); }
  // The nightly reflection (retired, nothing calls this now): ONE Notebook row in General (id REFLECT_ID), "How to work with <first name>", replaced each
  // night (never appended). Pinned (kind preference) and read by every channel's prompt. If the person edited it themself (it's
  // then theirs: author_type human), the job leaves it as they wrote it until they delete it.
  async reflectionSet(text, meta = {}) {
    const ch = this.sql.exec("SELECT id, data FROM rows WHERE tbl='channels'").toArray().map((r) => JSON.parse(r.data)).find((c) => (c.slug || c.name) === "main");
    if (!ch) return { error: "no General channel" };
    const cur = this.sql.exec("SELECT data FROM rows WHERE tbl='memory_items' AND id=?", REFLECT_ID).toArray()[0], old = cur ? JSON.parse(cur.data) : null;
    if (old && old.author_type === "human") return { kept: true };
    const row = { id: REFLECT_ID, channel_id: String(ch.id), kind: "preference", sec: "how", content: String(text).slice(0, REFLECT_MAX), author_type: "agent", src: "reflection", scope: "channel", status: "current",
      created: old?.created || Date.now(), updated: Date.now(), run: meta.run || null, cites: (meta.cites || []).slice(0, 10) };
    this.sql.exec("INSERT OR REPLACE INTO rows (tbl,id,channel_id,data) VALUES ('memory_items',?,?,?)", REFLECT_ID, String(ch.id), JSON.stringify(row));
    return { replaced: !!old, row };
  }
  async reflectionNote() { const r = this.sql.exec("SELECT data FROM rows WHERE tbl='memory_items' AND id=?", REFLECT_ID).toArray()[0]; return r ? JSON.parse(r.data) : null; }
  // The home note and its supersede lived here (regular expressions over the Notebook). Where the person lives comes from Hindsight now.
  // These two stay as empty answers so an older object that still calls them during a deploy gets a reply. Nothing calls them any more.
  async homeNote() { return ""; }
  async noteSupersedeHome() { return []; }
  async personFactDrop(personId, factId) { return this.people.dropFact(personId, factId); }
  // forget (forget.js): a Contacts fact really deleted (row + its search copy), with the versions it replaced or that replaced it.
  async personFactForget(personId, factId) { return this.people.forgetFact(personId, factId); }
  async wsNote(text, src = "") { return this.people.addNote(text, src); }
  async wsRecall(q, o = {}) { return this.people.recall(String(q || ""), o); }
  async wsStats() { return { people: this.people.list().length }; }
  async noteDelete(cid, id) { const n = this.sql.exec("SELECT COUNT(*) n FROM rows WHERE tbl='memory_items' AND id=? AND channel_id=?", String(id), String(cid)).one().n; this.sql.exec("DELETE FROM rows WHERE tbl='memory_items' AND id=? AND channel_id=?", String(id), String(cid)); return { ok: true, deleted: Number(n) || 0 }; }
  async channel(cid, limit = 400) {
    const q = (t, extra = "") => this.sql.exec(`SELECT data FROM rows WHERE tbl=? AND channel_id=? ${extra}`, t, String(cid)).toArray().map((r) => JSON.parse(r.data));
    return { channel: JSON.parse(this.sql.exec("SELECT data FROM rows WHERE tbl='channels' AND id=?", String(cid)).toArray()[0]?.data || "null"),
      messages: q("messages", `ORDER BY CAST(id AS INTEGER) DESC LIMIT ${Number(limit)}`).reverse(), memory: q("memory_items"), workflows: q("agent_workflows"), followups: q("agent_followups") };
  }
}

async function sendMagicLink(env, email, link, code) {
  const m = signInEmail(env, link, code);   // the link and the 6-digit code (src/signin-code.js)
  return env.EMAIL.send({ to: email, from: { email: env.EMAIL_FROM, name: "1Helm" }, subject: m.subject, html: m.html, text: m.text });
}
// A code typed on this device signs in exactly like the link: the user (made on first sign-in), newSession, the hc_session cookie.
// The pending-sign-in cookie goes; the row was already marked used by verifyCode.
async function signedIn(env, req, email, { json: body, location, status = 303, age } = {}) {
  let u;
  if (eeEnabled(env)) {
    u = await env.DB.prepare("SELECT * FROM users WHERE email=?").bind(email).first();
    if (!u) { u = { id: crypto.randomUUID(), email }; await env.DB.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").bind(u.id, u.email, now()).run(); }
  } else {
    u = await ownerAccount(env, email);
    if (!u) return body ? json({ error: "This server already has an owner." }, 403) : page("Sign-in closed", "<p>This server already has an owner.</p>");
    await ensureSelfHostedTenant(env, u);
  }
  await recordAge(env, u.id, age);
  const s = await newSession(env, req, u.id), h = new Headers({ "cache-control": "no-store" });
  h.append("set-cookie", `hc_session=${s}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`); h.append("set-cookie", clearPendingCookie());
  if (body) { h.set("content-type", "application/json"); return new Response(JSON.stringify(body), { status: 200, headers: h }); }
  h.set("location", location); return new Response(null, { status, headers: h });
}
const withCookie = (res, cookie) => { res.headers.append("set-cookie", cookie); return res; };
// Deletion (deletion-do.js): channel rows / the whole Archive, and wipe() on the Ledger and the legacy computer.
archiveDeletionMix(Archive); wipeMix(Ledger); wipeMix(UsageLedger); wipeMix(Computer);
installSnapshotRpc(Archive, "Archive");
installSnapshotRpc(Computer, "Computer", (self) => !!self.ctx.container?.running);
for (const [k, v] of Object.entries(pomoGlobalMethods)) Archive.prototype[k] = v;
