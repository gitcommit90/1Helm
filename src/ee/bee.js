import { boundedJson, BodyTooLargeError } from "../bounded-body.js";
// Settings → Ambient → Bee (notes/2026-10-07-ambient-bee/SPEC.md §1–4, §10 steps 1 + 2).
// Pairing (§3) runs here in the Worker: auth.beeai-services.com has a public certificate.
//   1. tweetnacl box keypair. The secret key is sealed with VAULT_KEY in bee_pairing and deleted as soon as the token is decrypted.
//   2. POST /apps/pairing/request {app_id: BEE_APP_ID, publicKey} → pending {requestId, expiresAt}. The person scans the QR of
//      https://bee.computer/connect#<requestId> (rendered by the app, never linked) or pastes the ID in the Bee app.
//   3. While the Connect sheet is open the app calls /api/bee/poll every 2 s; we re-POST the same body at most every 2 s (backoff on
//      5xx and network errors) → pending | completed {result.encryptedToken} | expired (→ a new keypair and request, automatically).
//   4. encryptedToken = base64 [ver=1][nonce 24][ephemeral public key 32][box] → nacl.box.open → utf8, trimmed = the token.
//   5. The token is sealed with VAULT_KEY (bee_accounts) and checked with GET /v1/me → "Connected as <name>".
// The data API (§4) is called from the Worker with fetch (src/bee-api.js) at Bee's public endpoint https://api.developer.bee.amazon.dev
// (a public certificate; docs/api.md "Public endpoint"). It used to be short jobs on a container, because the private-CA host
// app-api-developer.ce.bee.amazon.dev can't be trusted by Workers fetch (526 on 2026-10-07); that hop, its certificate text and its container
// class are gone. A call's bearer token is opened at use, sent only to that host and never returned or logged.
// The token is never logged, never returned to the app, never put in the helper's context. bee_events holds plain-words events only.
import { hsEnvelope } from "../hs-flag.js";
import { beeData, beeLiveProbe } from "./bee-api.js";
import nacl from "tweetnacl";
import { sealSecret, openSecret } from "../sentinel.js";
import { hasSecret, SECRET_NOTE } from "../secrets-scrub.js";

export const AUTH_URL = "https://auth.beeai-services.com/apps/pairing/request";
export const POLL_MS = 2000, MAX_BACKOFF_MS = 30000, CHECK_EVERY_MS = 10 * 60e3;
export const connectUrl = (requestId) => `https://bee.computer/connect#${requestId}`;
const PAIR_VERSION = 1, NONCE = 24, PUB = 32;
const now = () => Date.now();
const b64 = (u8) => { let s = ""; for (const x of u8) s += String.fromCharCode(x); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
// The platform CSPRNG, in Workers and in Node alike (tweetnacl's own detection looks for `self` or require("crypto")).
nacl.setPRNG((x, n) => { const v = crypto.getRandomValues(new Uint8Array(n)); for (let i = 0; i < n; i++) x[i] = v[i]; v.fill(0); });

// ---- crypto (CLI utils/appPairingCrypto.ts) ----
export function newKeyPair() { const k = nacl.box.keyPair(); return { publicKey: b64(k.publicKey), secretKey: b64(k.secretKey) }; }
export function decryptToken(encryptedB64, secretKeyB64) {
  let packed; try { packed = unb64(String(encryptedB64)); } catch { throw new Error("Bee sent a pairing result we couldn't read."); }
  if (packed.length < 1 + NONCE + PUB + 16) throw new Error("Bee sent a pairing result we couldn't read.");
  if (packed[0] !== PAIR_VERSION) throw new Error("Bee sent a pairing result in a newer format.");
  const nonce = packed.subarray(1, 1 + NONCE), eph = packed.subarray(1 + NONCE, 1 + NONCE + PUB), ct = packed.subarray(1 + NONCE + PUB);
  const opened = nacl.box.open(ct, nonce, eph, unb64(secretKeyB64));
  if (!opened) throw new Error("Bee sent a pairing result we couldn't open.");
  const token = new TextDecoder().decode(opened).trim(); opened.fill(0);
  if (!token) throw new Error("Bee sent an empty pairing result.");
  return token;
}
// What the Bee app does (tests only): seal a token to our public key the way the pairing service hands it back.
export function encryptTokenForTest(token, publicKeyB64, version = PAIR_VERSION) {
  const eph = nacl.box.keyPair(), nonce = nacl.randomBytes(NONCE), box = nacl.box(new TextEncoder().encode(token), nonce, unb64(publicKeyB64), eph.secretKey);
  const out = new Uint8Array(1 + NONCE + PUB + box.length); out[0] = version; out.set(nonce, 1); out.set(eph.publicKey, 1 + NONCE); out.set(box, 1 + NONCE + PUB);
  return b64(out);
}

// ---- the pairing service (CLI commands/auth/appPairingRequest.ts) ----
// One POST. → { kind: "pending"|"completed"|"expired", ... } | { kind: "retry", why } (5xx, network, unreadable) | { kind: "fail", why } (4xx).
export async function pairingRequest(env, publicKey, fetchFn = fetch) {
  let r; try { r = await fetchFn(AUTH_URL, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ app_id: env.BEE_APP_ID, publicKey }) }); }
  catch (e) { return { kind: "retry", why: `network: ${String(e?.message || e).slice(0, 80)}` }; }
  let d = null; try { d = await r.json(); } catch {}
  if (r.status >= 500) return { kind: "retry", why: `Bee answered ${r.status}` };
  if (r.status === 429) return { kind: "retry", why: "Bee answered 429" };
  if (!r.ok) return { kind: "fail", why: `Bee answered ${r.status}${typeof d?.error === "string" ? `: ${d.error.slice(0, 80)}` : ""}` };
  if (d?.ok !== true || typeof d.requestId !== "string") return { kind: "retry", why: "Bee's answer was unreadable" };
  if (d.status === "pending" && typeof d.expiresAt === "string") return { kind: "pending", requestId: d.requestId, expiresAt: d.expiresAt };
  if (d.status === "completed" && typeof d.result?.encryptedToken === "string") return { kind: "completed", requestId: d.requestId, encryptedToken: d.result.encryptedToken };
  if (d.status === "expired") return { kind: "expired", requestId: d.requestId };
  return { kind: "retry", why: "Bee's answer was unreadable" };
}
export const backoffMs = (fails) => Math.min(POLL_MS * 2 ** Math.max(0, fails), MAX_BACKOFF_MS);

// ---- the data API: src/bee-api.js (Worker fetch to Bee's public endpoint) ----
export { API_ROOT, beeData, beeSyncJob, beeFactsJob, beeLiveRun, beeLiveProbe, syncCore, writeCore, liveCore, sseFeed, SYNC_KILL_MS, LIVE_STREAM_TYPES, LIVE_STREAM_PATH } from "./bee-api.js";

// ---- state ----
// sync(env, tid): this person's BeeSync DO (bee-sync.js), or null where it isn't bound.
const syncStub = (env, tid) => env.BEE_SYNC ? env.BEE_SYNC.get(env.BEE_SYNC.idFromName(tid)) : null;
const DEFAULT_DEPS = { fetch: (...a) => fetch(...a), data: beeData, sync: syncStub };
export const beeEvent = (env, tid, what) => ev(env, tid, what);
async function ev(env, tid, what) {
  await env.DB.prepare("INSERT INTO bee_events (tenant_id,at,what) VALUES (?,?,?)").bind(tid, now(), String(what).slice(0, 300)).run();
  await env.DB.prepare("DELETE FROM bee_events WHERE tenant_id=? AND id <= (SELECT id FROM bee_events WHERE tenant_id=? ORDER BY id DESC LIMIT 1 OFFSET 100)").bind(tid, tid).run();
}
const pairingRow = (env, tid) => env.DB.prepare("SELECT * FROM bee_pairing WHERE tenant_id=?").bind(tid).first();
const accountRow = (env, tid) => env.DB.prepare("SELECT * FROM bee_accounts WHERE tenant_id=?").bind(tid).first();
const nameOf = (a) => [a?.first_name, a?.last_name].filter(Boolean).join(" ");
// What the app sees. Never the token, the secret key or the sealed values.
export async function beeState(env, tid, extra = {}) {
  if (!env.BEE_APP_ID) return { state: "unavailable", ...extra };
  const [a, p] = await Promise.all([accountRow(env, tid), pairingRow(env, tid)]);
  const out = { state: "none" };
  if (a) Object.assign(out, { state: a.status === "verifying" ? "connecting" : a.status, name: nameOf(a) || null, connected_at: a.connected_at, checked_at: a.checked_at || null,
    sync: { at: a.synced_at ?? null, convs: Number(a.conv_count || 0), note: a.sync_note || null } });
  // Import past conversations (§6): the run's progress, the history lines, whether the offer was answered. A read of the DO only.
  // Changes owed to Bee (§7 write-back): {writes: {stuck, owed}} only when there are some; stuck ones show on the card with Retry.
  if (a && (a.status === "connected" || a.status === "needs_reconnect")) { const s = syncStub(env, tid); if (s) { try { Object.assign(out, await s.bfView(), await s.writesView()); } catch (e) { console.log("bee bfView", String(e?.message || e).slice(0, 120)); } } }
  if (p) {
    out.pairing = { request_id: p.request_id, url: connectUrl(p.request_id), expires_at: p.expires_at, expires_in: Math.max(0, p.expires_at - now()), waiting: p.fails > 0 };
    if (!a || a.status !== "connected") out.state = a?.status === "verifying" ? "connecting" : "pairing";
    if (a?.status === "needs_reconnect" || a?.status === "connected") out.reconnecting = true;
  }
  return { ...out, ...extra };
}

async function newPairing(env, tid, deps, why) {
  const kp = newKeyPair(), r = await pairingRequest(env, kp.publicKey, deps.fetch);
  if (r.kind === "retry" || r.kind === "fail") return { error: r.kind === "fail" ? "Bee didn't accept the connection request. Try again in a minute." : "Bee isn't answering right now. Try again in a minute.", why: r.why };
  if (r.kind === "expired") return { error: "Bee isn't answering right now. Try again in a minute.", why: "a new request came back expired" };
  if (r.kind === "completed") { await ev(env, tid, `pairing ${why}: completed at once`); return await finish(env, tid, deps, r.encryptedToken, kp.secretKey); }
  const exp = Date.parse(r.expiresAt); const expiresAt = Number.isFinite(exp) && exp > now() ? exp : now() + 5 * 60e3;
  await env.DB.prepare("INSERT INTO bee_pairing (tenant_id,request_id,public_key,secret_sealed,expires_at,next_poll_at,fails,created_at) VALUES (?,?,?,?,?,?,0,?) ON CONFLICT(tenant_id) DO UPDATE SET request_id=excluded.request_id,public_key=excluded.public_key,secret_sealed=excluded.secret_sealed,expires_at=excluded.expires_at,next_poll_at=excluded.next_poll_at,fails=0,created_at=excluded.created_at")
    .bind(tid, r.requestId, kp.publicKey, await sealSecret(env, kp.secretKey), expiresAt, now() + POLL_MS, now()).run();
  await ev(env, tid, `pairing ${why}: request ${r.requestId}, expires in ${Math.round((expiresAt - now()) / 1000)}s`);
  return null;
}
// The token is decrypted, the secret key deleted with the pairing row, the token sealed, then checked with /v1/me.
async function finish(env, tid, deps, encryptedToken, secretKeyB64) {
  let token;
  try { token = decryptToken(encryptedToken, secretKeyB64); }
  catch (e) { await env.DB.prepare("DELETE FROM bee_pairing WHERE tenant_id=?").bind(tid).run(); await ev(env, tid, `pairing completed but the token couldn't be opened (${e.message})`); return { error: "The connection didn't finish. Start again and connect once more in the Bee app." }; }
  await env.DB.prepare("DELETE FROM bee_pairing WHERE tenant_id=?").bind(tid).run();   // the secret key is gone from here on
  const before = await accountRow(env, tid);
  await env.DB.prepare("INSERT INTO bee_accounts (tenant_id,token_sealed,status,connected_at,check_next_at) VALUES (?,?,'verifying',?,0) ON CONFLICT(tenant_id) DO UPDATE SET token_sealed=excluded.token_sealed,status='verifying',connected_at=excluded.connected_at,check_next_at=0,last_error=NULL")
    .bind(tid, await sealSecret(env, token), now()).run();
  await ev(env, tid, `pairing completed: token sealed${before ? " (replaces the previous one)" : ""}; checking /v1/me`);
  token = null;
  await verify(env, tid, deps, before?.bee_user_id ?? null);
  return null;
}
// GET /v1/me with the sealed token. 200 → connected as <name>; 401 → needs_reconnect; anything else → try again later.
async function verify(env, tid, deps, prevUser = null) {
  const a = await accountRow(env, tid); if (!a) return;
  let r; try { r = await deps.data(env, tid, await openSecret(env, a.token_sealed), "GET", "/v1/me"); }
  catch (e) { r = { status: 0, error: String(e?.message || e).slice(0, 120) }; }
  const me = r.json, timing = r.ms != null ? ` in ${r.ms}ms` : "";
  if (r.status === 200 && typeof me?.id === "number" && typeof me?.first_name === "string") {
    await env.DB.prepare("UPDATE bee_accounts SET status='connected',bee_user_id=?,first_name=?,last_name=?,checked_at=?,check_next_at=?,last_error=NULL WHERE tenant_id=?")
      .bind(me.id, me.first_name.slice(0, 80), typeof me.last_name === "string" ? me.last_name.slice(0, 80) : null, now(), now() + CHECK_EVERY_MS, tid).run();
    await ev(env, tid, `/v1/me 200${timing}: connected as Bee user ${me.id}${prevUser != null && prevUser !== me.id ? ` (was ${prevUser}: a different Bee account)` : ""}`);
    try { await deps.sync?.(env, tid)?.start(tid, { beeUser: me.id }); } catch (e) { await ev(env, tid, `sync couldn't start: ${String(e?.message || e).slice(0, 120)}`); }   // step 3: BeeSync
    return;
  }
  if (r.status === 401) {
    await env.DB.prepare("UPDATE bee_accounts SET status='needs_reconnect',checked_at=?,last_error=? WHERE tenant_id=?").bind(now(), "Bee said 401", tid).run();
    await ev(env, tid, `/v1/me 401${timing}: needs reconnect`); return;
  }
  const why = r.status ? `Bee answered ${r.status}` : r.error || "no answer";
  await env.DB.prepare("UPDATE bee_accounts SET check_next_at=?,last_error=? WHERE tenant_id=?").bind(now() + (a.status === "verifying" ? 5e3 : CHECK_EVERY_MS), why, tid).run();
  await ev(env, tid, `/v1/me failed${timing}: ${why}`);
}

// POST /api/bee/connect: start (or keep) a pairing. Connected or not, a new pairing can always start (Reconnect / switch account).
export async function beeConnect(env, tid, deps = DEFAULT_DEPS) {
  if (!env.BEE_APP_ID) return beeState(env, tid);
  const p = await pairingRow(env, tid);
  if (p && p.expires_at - now() > 30e3) return beeState(env, tid);   // the code on screen is still good
  const err = await newPairing(env, tid, deps, p ? "renewed" : "started");
  if (err?.why) await ev(env, tid, `pairing couldn't start: ${err.why}`);
  return beeState(env, tid, err ? { error: err.error } : {});
}
// POST /api/bee/poll: one step of the state machine. Calls Bee at most every POLL_MS (more slowly after failures); the
// next_poll_at compare-and-set means only one caller (tab) does each step.
export async function beePoll(env, tid, deps = DEFAULT_DEPS) {
  if (!env.BEE_APP_ID) return beeState(env, tid);
  const p = await pairingRow(env, tid);
  if (!p) {
    const a = await accountRow(env, tid);
    if (a?.status === "verifying" && now() >= a.check_next_at && await claimCheck(env, tid, a)) await verify(env, tid, deps);
    return beeState(env, tid);
  }
  if (now() < p.next_poll_at) return beeState(env, tid);
  const claimed = await env.DB.prepare("UPDATE bee_pairing SET next_poll_at=? WHERE tenant_id=? AND next_poll_at=?").bind(now() + 60e3, tid, p.next_poll_at).run();
  if (!Number(claimed.meta?.changes)) return beeState(env, tid);
  if (now() >= p.expires_at) { const err = await newPairing(env, tid, deps, "renewed (expired)"); return beeState(env, tid, err ? await pollFailed(env, tid, p, err.why) : {}); }
  const r = await pairingRequest(env, p.public_key, deps.fetch);
  if (r.kind === "pending") {
    const exp = Date.parse(r.expiresAt);
    await env.DB.prepare("UPDATE bee_pairing SET next_poll_at=?,fails=0,expires_at=? WHERE tenant_id=?").bind(now() + POLL_MS, Number.isFinite(exp) ? exp : p.expires_at, tid).run();
    if (p.fails) await ev(env, tid, `Bee answering again after ${p.fails} failed poll${p.fails === 1 ? "" : "s"}`);
    return beeState(env, tid);
  }
  if (r.kind === "expired") { const err = await newPairing(env, tid, deps, "renewed (Bee said expired)"); return beeState(env, tid, err ? await pollFailed(env, tid, p, err.why) : {}); }
  if (r.kind === "completed") {
    let secret; try { secret = await openSecret(env, p.secret_sealed); } catch { await env.DB.prepare("DELETE FROM bee_pairing WHERE tenant_id=?").bind(tid).run(); return beeState(env, tid, { error: "The connection didn't finish. Start again." }); }
    const err = await finish(env, tid, deps, r.encryptedToken, secret); secret = null;
    return beeState(env, tid, err || {});
  }
  if (r.kind === "fail") {
    await env.DB.prepare("DELETE FROM bee_pairing WHERE tenant_id=?").bind(tid).run();
    await ev(env, tid, `pairing stopped: ${r.why}`);
    return beeState(env, tid, { error: "Bee stopped the connection request. Start again." });
  }
  return beeState(env, tid, await pollFailed(env, tid, p, r.why));
}
async function pollFailed(env, tid, p, why) {
  const fails = Number(p.fails || 0) + 1, wait = backoffMs(fails);
  await env.DB.prepare("UPDATE bee_pairing SET next_poll_at=?,fails=? WHERE tenant_id=?").bind(now() + wait, fails, tid).run();
  await ev(env, tid, `poll failed (${why}); next try in ${Math.round(wait / 1000)}s`);
  return {};
}
async function claimCheck(env, tid, a) {
  const c = await env.DB.prepare("UPDATE bee_accounts SET check_next_at=? WHERE tenant_id=? AND check_next_at=?").bind(now() + 60e3, tid, a.check_next_at).run();
  return !!Number(c.meta?.changes);
}
// POST /api/bee/check: re-check a connection (Settings → Ambient opens it). At most every CHECK_EVERY_MS. 401 → Needs reconnect.
export async function beeCheck(env, tid, deps = DEFAULT_DEPS) {
  const a = await accountRow(env, tid);
  if (a && a.status !== "needs_reconnect" && now() >= a.check_next_at && await claimCheck(env, tid, a)) await verify(env, tid, deps, a.bee_user_id);
  // Opening the card also syncs at once when the last check is over 5 min old (the sync slows to 30 min when quiet): in the
  // background, the card's line picks it up on its next read.
  if (a?.status === "connected") { try { await deps.sync?.(env, tid)?.cardOpen?.(tid); } catch (e) { console.log("bee card open", String(e?.message || e).slice(0, 120)); } }
  return beeState(env, tid);
}
// POST /api/bee/cancel: stop a pairing in progress (the secret key goes with it). A connection that exists stays.
export async function beeCancel(env, tid) {
  const r = await env.DB.prepare("DELETE FROM bee_pairing WHERE tenant_id=?").bind(tid).run();
  if (Number(r.meta?.changes)) await ev(env, tid, "pairing cancelled");
  return beeState(env, tid);
}
// POST /api/bee/disconnect {memories: "keep"|"remove"}. Forgets the token here; the Bee app keeps its "Bee CLI" entry until the
// person deletes it there (Developer → trash): Bee has no revoke call for apps. The sync stops first (a run in flight finishes
// without writing); "remove" deletes every bee:conv:<id> document in General's bank and the R2 transcripts (bee-sync.js stop).
export async function beeDisconnect(env, tid, memories = "keep", deps = DEFAULT_DEPS) {
  memories = memories === "remove" ? "remove" : "keep";
  let out = { memories: memories === "remove" ? "removed" : "kept", removed: 0 };
  const s = deps.sync?.(env, tid);
  if (s) out = { ...out, ...(await s.stop(memories)) };
  await env.DB.prepare("DELETE FROM bee_pairing WHERE tenant_id=?").bind(tid).run();
  const r = await env.DB.prepare("DELETE FROM bee_accounts WHERE tenant_id=?").bind(tid).run();
  if (Number(r.meta?.changes)) await ev(env, tid, `disconnected (memories: ${memories}${memories === "remove" ? `, ${out.removed || 0} conversation${out.removed === 1 ? "" : "s"} removed` : ""})`);
  return beeState(env, tid, out);
}
// POST /api/bee/sync: Sync now. Runs one sync at once (the BeeSync DO keeps it to one at a time) and answers with the card's state.
export async function beeSyncNow(env, tid, deps = DEFAULT_DEPS) {
  const a = await accountRow(env, tid), s = deps.sync?.(env, tid);
  if (!a || a.status !== "connected" || !s) return beeState(env, tid);
  const r = await s.syncNow(tid);
  if (r?.status === "off" || r?.status === "stopped") { await s.start(tid, { beeUser: a.bee_user_id }); await s.syncNow(tid); }   // connected before step 3 shipped
  return beeState(env, tid);
}

// Hourly safety net: a connected account whose sync hasn't succeeded in CRON_STALE_MS (never started: connected before step 3 shipped;
// or its alarm was lost) gets start() again. start() is idempotent; an account paused for credits / read-only just runs its cheap check.
// A quiet sync checks every 30 min (60 overnight) and a failing one backs off to 60 min, so 2 h without a sync means a lost alarm.
export const CRON_STALE_MS = 2 * 3600e3;
export async function beeCron(env, deps = DEFAULT_DEPS) {
  if (!env.BEE_SYNC) return { checked: 0, started: 0 };
  const rows = (await env.DB.prepare("SELECT tenant_id, bee_user_id FROM bee_accounts WHERE status='connected' AND COALESCE(synced_at,0) < ? AND tenant_id NOT IN (SELECT t.id FROM tenants t JOIN users u ON u.id=t.owner_user_id WHERE LOWER(u.email) LIKE '%@example.com') LIMIT 100").bind(now() - CRON_STALE_MS).all()).results || [];
  let started = 0;
  for (const r of rows) { try { await deps.sync(env, r.tenant_id).start(r.tenant_id, { beeUser: r.bee_user_id }); started++; } catch (e) { console.log("bee cron", String(e?.message || e).slice(0, 120)); } }
  return { checked: rows.length, started };
}

// /w/<slug>/api/bee[/op]. GET is read-only (no call to Bee, so a look-only view can show it); every step is a POST.
export async function beeRoute(req, env, t, sub, deps = DEFAULT_DEPS) {
  const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  if (sub === "/api/bee" && req.method === "GET") return J(await beeState(env, t.id));
  const op = sub.slice("/api/bee/".length);
  if (req.method !== "POST") return J({ error: "not found" }, 404);
  try {
    if (op === "connect") return J(await beeConnect(env, t.id, deps));
    if (op === "poll") return J(await beePoll(env, t.id, deps));
    if (op === "check") return J(await beeCheck(env, t.id, deps));
    if (op === "cancel") return J(await beeCancel(env, t.id));
    if (op === "sync") return J(await beeSyncNow(env, t.id, deps));
    // New from Bee (§7): {op: "approve"|"edit"|"deny", id, text?} on a pending fact. A secret in an edit is refused (nosecrets).
    if (op === "fact") {
      const b = await boundedJson(req), id = Number(b.id), act = String(b.op || ""), text = String(b.text || "").trim();
      if (!["approve", "edit", "deny"].includes(act) || !(id > 0)) return J({ error: "op must be approve, edit or deny, with the fact's id" }, 400);
      if (act === "edit" && !text) return J({ error: "text required" }, 400);
      if (act === "edit" && hasSecret(text)) return J({ error: SECRET_NOTE, secret: true }, 400);
      const a = await accountRow(env, t.id), s = deps.sync?.(env, t.id);
      if (!a || a.status !== "connected" || !s) return J({ error: a?.status === "needs_reconnect" ? "Reconnect your Bee in Settings → Ambient first." : "Bee isn't connected." }, 409);
      return J(await s.factAction(t.id, act, id, text.slice(0, 2000)));
    }
    // New speaker detected (bee-speakers.js, HS_ENVELOPE): {op: "list"} | {op: "edit", rec, spk, name} | {op: "accept", rec, spk} |
    // {op: "matches", rec, spk} | {op: "confirm", rec, spk, person}. Works from the saved recordings, so it needs no call to Bee.
    if (op === "speaker") {
      const b = await boundedJson(req), act = String(b.op || ""), name = String(b.name || "").trim();
      if (!["list", "edit", "accept", "matches", "confirm", "not_them"].includes(act)) return J({ error: "op must be list, edit, accept, matches, confirm or not_them" }, 400);
      const sid = String(b.sid ?? b.spk ?? "");
      if (act !== "list" && (b.rec == null || !sid)) return J({ error: "rec and spk required" }, 400);
      if (act === "edit" && !name) return J({ error: "name required" }, 400);
      if (act === "edit" && hasSecret(name)) return J({ error: SECRET_NOTE, secret: true }, 400);
      if (act === "confirm" && !b.person) return J({ error: "person required" }, 400);
      if (act === "not_them" && !b.contact) return J({ error: "contact required" }, 400);
      if (!hsEnvelope(env)) return J({ error: "not available" }, 404);
      const s = deps.sync?.(env, t.id); if (!s) return J({ error: "Bee isn't connected." }, 409);
      return J(await s.speakerAction(t.id, act, String(b.rec), sid, { name, person: b.person ? String(b.person) : "", contact: b.contact ? String(b.contact) : "" }));
    }
    // Changes that couldn't reach Bee (the card's quiet line): {op: "retry" | "dismiss"} → the card's state.
    if (op === "writes") {
      const b = await boundedJson(req), act = String(b.op || ""), s = deps.sync?.(env, t.id);
      if (!["retry", "dismiss"].includes(act)) return J({ error: "op must be retry or dismiss" }, 400);
      if (s) await s.writesOp(t.id, act);
      return J(await beeState(env, t.id));
    }
    // Import past conversations (§6): {op: "count", days: 0 (all) | 30 | 60 | 90} → the pre-count (list calls only), then start |
    // pause | resume | cancel | skip.
    if (op === "backfill") {
      const b = await boundedJson(req), act = String(b.op || ""), days = Number(b.days);
      if (!["count", "start", "pause", "resume", "cancel", "skip"].includes(act)) return J({ error: "op must be count, start, pause, resume, cancel or skip" }, 400);
      if (act === "count" && ![0, 30, 60, 90].includes(days)) return J({ error: "days must be 0 (all), 30, 60 or 90" }, 400);
      const a = await accountRow(env, t.id), s = deps.sync?.(env, t.id);
      if (!s || !a || (a.status !== "connected" && !["pause", "cancel"].includes(act))) return J(await beeState(env, t.id, { error: a?.status === "needs_reconnect" ? "Reconnect your Bee first." : "Bee isn't connected." }));
      const r = await s.backfill(t.id, act, days);
      return J(await beeState(env, t.id, r?.error ? { error: r.error } : {}));
    }
    if (op === "disconnect") { const b = await boundedJson(req); return J(await beeDisconnect(env, t.id, b.memories === "remove" ? "remove" : "keep", deps)); }
  } catch (e) { if (e instanceof BodyTooLargeError) throw e; console.log("bee", op, String(e?.message || e).slice(0, 200)); return J({ ...(await beeState(env, t.id).catch(() => ({ state: "none" }))), error: "Something went wrong. Try again in a minute." }); }
  return J({ error: "not found" }, 404);
}
// ---- Facts ↔ General's Notebook (§7): the Notebook route's hooks. Each is a no-op without a connected Bee. ----
const connectedSync = async (env, tid, deps = DEFAULT_DEPS) => { const a = await accountRow(env, tid); return a?.status === "connected" ? deps.sync?.(env, tid) ?? null : null; };
// GET /api/notebook/main: the facts waiting for review (confirmed: false in Bee), for the "New from Bee" block.
export async function beePendingFacts(env, tid, deps = DEFAULT_DEPS) {
  if (!env.BEE_SYNC && deps === DEFAULT_DEPS) return null;
  try { const s = await connectedSync(env, tid, deps); return s ? await s.pendingFacts() : null; } catch (e) { console.log("bee pending facts", String(e?.message || e).slice(0, 120)); return null; }
}
// GET /api/notebook/main: the speakers waiting for review ("New speaker detected", bee-speakers.js), with HS_ENVELOPE on.
export async function beePendingSpeakers(env, tid, deps = DEFAULT_DEPS) {
  if (!hsEnvelope(env) || (!env.BEE_SYNC && deps === DEFAULT_DEPS)) return null;
  try { const s = deps.sync?.(env, tid); return s ? await (s.pendingSpeakersWithMatches ? s.pendingSpeakersWithMatches() : s.pendingSpeakers()) : null; } catch (e) { console.log("bee pending speakers", String(e?.message || e).slice(0, 120)); return null; }
}
// A From-Bee note was edited / deleted in the Notebook → the same change in Bee (PUT with the fact's tags / DELETE). An undo of a
// deleted From-Bee note creates the fact again (POST) and links the new id. Each only changes the Notebook and queues the write: it is
// sent in the background (BeeSync alarm, retried with backoff), so these return at once.
export async function beeNoteEdited(env, tid, note, deps = DEFAULT_DEPS) {
  if (note?.bee_fact_id == null) return null; const s = deps.sync?.(env, tid); if (!s) return null;
  return s.factNoteEdited(tid, Number(note.bee_fact_id), String(note.id), String(note.content || "")).catch((e) => console.log("bee note edit", String(e?.message || e).slice(0, 120)));
}
export async function beeNoteDeleted(env, tid, note, deps = DEFAULT_DEPS) {
  if (note?.bee_fact_id == null) return null; const s = deps.sync?.(env, tid); if (!s) return null;
  return s.factNoteDeleted(tid, Number(note.bee_fact_id)).catch((e) => console.log("bee note delete", String(e?.message || e).slice(0, 120)));
}
export async function beeNoteRestored(env, tid, sec, text, deps = DEFAULT_DEPS) {
  const s = await connectedSync(env, tid, deps); if (!s) return null;
  return s.factRestore(tid, sec, text).catch((e) => { console.log("bee note restore", String(e?.message || e).slice(0, 120)); return null; });
}

// /_ops/bee (dev): the pairing and connection rows without any secret, and the last events. ?facts=count: one read-only job that
// lists the facts (GET only) and answers how many are confirmed / waiting for review; nothing is imported or written. ?speakers=1: the new speaker rows in every state (SELECT only).
// ?backfill=count&days=30: the Import pre-count (GET /v1/conversations pages only) with its estimate; nothing is stored or imported.
export async function beeOps(env, tid, deps = DEFAULT_DEPS, opts = {}) {
  if (opts.liveProbe) {   // one read-only round of the Live notes job against this person's Bee: shapes, counts and lag, never the text
    const a = await accountRow(env, tid); if (!a || a.status !== "connected") return { error: "Bee isn't connected" };
    let token = await openSecret(env, a.token_sealed), r; try { r = await (deps.liveProbe || beeLiveProbe)(env, tid, token); } catch (e) { r = { error: String(e?.message || e).slice(0, 160) }; } finally { token = null; }
    return { live_probe: r };
  }
  if (opts.backfillDays != null) { const s = deps.sync?.(env, tid); if (!s) return { error: "no BeeSync" }; return { backfill_count: await s.opsBackfillCount(tid, opts.backfillDays) }; }
  if (opts.factsCount) { const s = deps.sync?.(env, tid); if (!s) return { error: "no BeeSync" }; return { facts_count: await s.opsFactsCount(tid) }; }
  if (opts.speakers) { const s = deps.sync?.(env, tid); if (!s) return { error: "no BeeSync" }; return { speaker_rows: await s.opsSpeakers() }; }   // every speakers row in every state (GET only, bee-speakers.js)
  const p = await pairingRow(env, tid), a = await accountRow(env, tid);
  let sync = null; try { sync = await deps.sync?.(env, tid)?.opsView() ?? null; } catch (e) { sync = { error: String(e?.message || e).slice(0, 120) }; }
  const events = (await env.DB.prepare("SELECT at, what FROM bee_events WHERE tenant_id=? ORDER BY id DESC LIMIT 50").bind(tid).all()).results || [];
  return {
    state: await beeState(env, tid),
    pairing: p ? { request_id: p.request_id, expires_at: p.expires_at, expires_in_s: Math.round((p.expires_at - now()) / 1000), next_poll_at: p.next_poll_at, fails: p.fails, created_at: p.created_at, secret: p.secret_sealed ? "[sealed, deleted after pairing]" : null } : null,
    account: a ? { status: a.status, bee_user_id: a.bee_user_id, name: nameOf(a) || null, connected_at: a.connected_at, checked_at: a.checked_at, check_next_at: a.check_next_at, last_error: a.last_error, token: a.token_sealed ? "[sealed]" : null,
      synced_at: a.synced_at ?? null, conv_count: a.conv_count ?? 0, sync_note: a.sync_note ?? null } : null,
    sync,
    events: events.map((e) => ({ ...e, iso: new Date(e.at).toISOString() })),
  };
}
