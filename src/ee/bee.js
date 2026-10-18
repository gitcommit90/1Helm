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
// The data API (§4) has a PRIVATE CA ("BeeCertificateAuthority"). Workers fetch can't trust it (measured 10-07 from a Workers preview:
// GET https://app-api-developer.ce.bee.amazon.dev/v1/me → 526 "Invalid SSL certificate"), and a channel computer's HTTPS goes through
// the Sentinel, i.e. the same Workers fetch. So data calls are short jobs on the Computer container class (node:22, direct internet),
// under their own DO name "beejob:<tenant>" (no workspace, no restore): Node https with ONLY the Bee CA trusted, the token passed on
// stdin (never argv/env), the host fixed in the job. The container stops ~30 s after its last job (Computer.alarm).
// The token is never logged, never returned to the app, never put in the helper's context. bee_events holds plain-words events only.
import { hsEnvelope } from "../hs-flag.js";
import nacl from "tweetnacl";
import { sealSecret, openSecret } from "../sentinel.js";
import { hasSecret, SECRET_NOTE } from "../secrets-scrub.js";

export const AUTH_URL = "https://auth.beeai-services.com/apps/pairing/request";
export const API_HOST = "app-api-developer.ce.bee.amazon.dev";
export const POLL_MS = 2000, MAX_BACKOFF_MS = 30000, CHECK_EVERY_MS = 10 * 60e3, JOB_IDLE_MS = 30e3;
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

// ---- the data API, as a short container job ----
// Runs inside the container: one HTTPS request to the Bee data API with only the Bee CA trusted. Input on stdin as JSON
// {token, method, path, body?, tries?}; prints one line "@@BEE@@{status, body}" (or {status: 0, error}). Retries 429/5xx/network
// with backoff. The host is fixed here, so the token can only ever go to Bee.
export const PROD_ROOT_CA = `-----BEGIN CERTIFICATE-----
MIIDfzCCAmegAwIBAgIRANp9rGecKAk6t6XGd3GWVHkwDQYJKoZIhvcNAQELBQAw
WTELMAkGA1UEBhMCVVMxDDAKBgNVBAoMA0JlZTEaMBgGA1UECwwRVHJ1c3QgYW5k
IFByaXZhY3kxIDAeBgNVBAMMF0JlZUNlcnRpZmljYXRlQXV0aG9yaXR5MB4XDTI1
MDgyMTE5MjUyNloXDTM1MDgyMTIwMjUyNlowWTELMAkGA1UEBhMCVVMxDDAKBgNV
BAoMA0JlZTEaMBgGA1UECwwRVHJ1c3QgYW5kIFByaXZhY3kxIDAeBgNVBAMMF0Jl
ZUNlcnRpZmljYXRlQXV0aG9yaXR5MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIB
CgKCAQEA7a4dWfEBlstJGQWx2MG9fInEWw4v5e2Sasiw8D09fW77VbSskLEectYl
t8XgM8a2O9JAPkCQ3vNJmIO+6etyPj/DEtjwllSPR5/1qcZXGFMbjRGzmDz2Y6Mr
uPlrGYZZQgSNrnuSSndADCrqSEGLdBzkjXqkuXLXDqdLLTzseNQVfCiN2LDCwFRD
Ugjw4KuiJzSBZ1CQEdug4qauitcif6NOFEiTViAOkXjSmjAdTjN0GDKQdTmDtQYg
NfLuhhfmEB9mdiEm3++AUURQ2Cn+MfP2YAy/5gr3t+ydPRx361mbA1UiWnx7lmLU
xRmZhzeaDmO8vUxxM1jHSXLNxMPMUwIDAQABo0IwQDAPBgNVHRMBAf8EBTADAQH/
MB0GA1UdDgQWBBRAKKN5ASGNfQOKcsdpaFwNki78xzAOBgNVHQ8BAf8EBAMCAYYw
DQYJKoZIhvcNAQELBQADggEBADXy/YcenRwuAbCH57sFcwe/akWsdh7bs9ZNb7dq
g6qzDpitO8yhpEK1DSW2Nmbtxd59rhV5jmnAfFHLEoeOlsSeBLADH3/3uRLV1kIR
M3kUPKOv1FJq7UkK2VzgabpehyeJ4lfozfT983b3AoDvI6quf3Dl2NrCmmUUewrZ
6g+RSR6n6Q/PalGUPtoV+W4OT5j9hS1d0PSNO6QbRRFzW+NZ+aQdLwHQPzwjofSh
vM1JjV7Hz2KOPJwmqHQbCiaayGq5lZIVI3UrqnTIqB/hySEBIJNeyHN3ggORH2JJ
wzMF+xiaNYUCir9ZzsgYiEsuaxEyiS96ydDImWJboALiWmE=
-----END CERTIFICATE-----
`;
export const JOB_MARK = "@@BEE@@";
export const JOB_JS = `const https=require("https"),HOST=${JSON.stringify(API_HOST)},CA=${JSON.stringify(PROD_ROOT_CA)},MARK=${JSON.stringify(JOB_MARK)};
const out=(o)=>{process.stdout.write("\\n"+MARK+JSON.stringify(o)+"\\n");process.exit(0)};let s="";process.stdin.setEncoding("utf8");
process.stdin.on("data",(d)=>{s+=d}).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return out({status:0,error:"bad input"})}s="";
if(typeof j.path!=="string"||!/^\\/v1\\//.test(j.path))return out({status:0,error:"bad path"});
const tries=Math.min(5,j.tries||3),body=j.body==null?null:JSON.stringify(j.body);let n=0;
const again=(why)=>{if(n<tries){setTimeout(go,1000*2**(n-1));return true}return false};
const go=()=>{n++;const req=https.request({host:HOST,servername:HOST,port:443,path:j.path,method:j.method||"GET",ca:[CA],timeout:20000,
headers:{authorization:"Bearer "+j.token,accept:"application/json",...(body?{"content-type":"application/json","content-length":Buffer.byteLength(body)}:{})}},(res)=>{
let b="";res.setEncoding("utf8");res.on("data",(c)=>{b+=c});res.on("end",()=>{if((res.statusCode>=500||res.statusCode===429)&&again())return;out({status:res.statusCode,body:b,tries:n})})});
req.on("timeout",()=>req.destroy(new Error("timeout")));req.on("error",(e)=>{if(again())return;out({status:0,error:String(e&&(e.code||e.message)||e).slice(0,120),tries:n})});
if(body)req.write(body);req.end()};go()});`;
// Retry-After (seconds or an HTTP date) → ms, or null. Shared by the container jobs.
export const RETRY_AFTER_JS = `const retryAfter=(v)=>{if(v==null||v==="")return null;const s=Number(v);if(Number.isFinite(s)&&s>=0)return Math.round(s*1000);const t=Date.parse(String(v));return Number.isFinite(t)?Math.max(0,t-Date.now()):null};`;
// ---- the sync job (§5, step 3): ONE container run per sync, so a run pays for one start, not one per call ----
// SYNC_CORE is plain JS text (never a function's toString(): wrangler bundles with keep_names, whose __name() wrappers would break
// it inside the container). It runs in the container with get(path) → {status, body|error}, and in the tests with a fake Bee.
// Input {cursor, ids, max}:
//   GET /v1/changes[?cursor=]. Bee's raw answer lists changed ids ({conversations:[id], facts:[id], …, since, until, next_cursor},
//   CLI commands/sync); the CLI's `changed --json` (and SPEC §5 / bee-data-shapes.json "changed") has meta{} and full objects.
//   Both are read. A cursor Bee refuses (4xx other than 401/429: cursor_too_old / invalid_cursor) → once more without one (≈ 24 h),
//   plus, when j.cursor_at is given, the catch-up walk below from that time.
//   Catch-up (the CLI's fallback full crawl, bee-cli commands/sync): j.catchup = ms → GET /v1/conversations?limit=50 page by page
//   from that time (the same walk as only:"list"), the FINISHED conversations only → catchup {from, items [{id, start_time}],
//   complete, pages} (or {from, status, error} when the walk failed). The DO queues the ones it hasn't ingested.
//   Rate limits: after a 429 no other call is made this run (each answers {status: 429, error: "not tried"}); any 429/5xx is
//   reported as slow {status, retry_ms} so the DO waits at least that long before the next run.
//   Then GET /v1/conversations/{id} (4 at a time) for each changed id + the retry ids, at most `max`; the rest come back in `more`.
//   Any 401 → {status: 401} at once. Facts / todos / dailies / journals are only counted (facts are step 4).
//   Facts (§7, step 4): j.facts "all" lists every fact (GET /v1/facts?confirmed=true|false&limit=50, every page); "changed" lists
//   them only when the change feed names any. j.only "facts" lists them and nothing else (/_ops/bee?facts=count, read-only).
//   → facts {status, list [{id, text, tags, confirmed, created_at}], complete}: complete = every page of both lists was read.
export const SYNC_CORE = `async function syncCore(j, get0) {
  var slow = null;
  var get = async function (p) {
    if (slow && slow.status === 429) return { status: 429, error: "not tried: Bee asked to wait" };
    var r = await get0(p);
    if (r && (r.status === 429 || r.status >= 500)) { var w = typeof r.retry_ms === "number" && r.retry_ms >= 0 ? r.retry_ms : null;
      slow = { status: slow && slow.status === 429 ? 429 : r.status, retry_ms: slow && slow.retry_ms != null ? (w == null ? slow.retry_ms : Math.max(slow.retry_ms, w)) : w }; }
    return r;
  };
  var res = await (async function () {
  var listFacts = async function () {
    var all = [], seen = {}, complete = true, confs = ["true", "false"];
    for (var k = 0; k < confs.length && complete; k++) {
      var cur = null;
      for (var pg = 0; ; pg++) {
        if (pg >= 40) { complete = false; break; }
        var g = await get("/v1/facts?confirmed=" + confs[k] + "&limit=50" + (cur ? "&cursor=" + encodeURIComponent(cur) : ""));
        if (g.status === 401) return { status: 401 };
        if (g.status !== 200) { complete = false; break; }
        var b = null; try { b = JSON.parse(g.body); } catch (e) {}
        if (!b || !Array.isArray(b.facts)) { complete = false; break; }
        for (var f of b.facts) if (f && typeof f.id === "number" && f.id > 0 && typeof f.text === "string" && !seen[f.id]) { seen[f.id] = 1;
          all.push({ id: f.id, text: f.text, tags: Array.isArray(f.tags) ? f.tags.filter(function (t) { return typeof t === "string"; }) : null, confirmed: typeof f.confirmed === "boolean" ? f.confirmed : confs[k] === "true", created_at: typeof f.created_at === "number" ? f.created_at : null }); }
        cur = typeof b.next_cursor === "string" && b.next_cursor ? b.next_cursor : null;
        if (!cur || !b.facts.length) break;
      }
    }
    return { status: 200, list: all, complete: complete };
  };
  if (j.only === "facts") { var lf = await listFacts(); return lf.status === 401 ? { status: 401 } : { status: 200, facts: lf }; }
  var ids = [], inline = {}, convs = [];
  var add = function (id) { if (typeof id === "number" && id > 0 && Number.isSafeInteger(id) && ids.indexOf(id) < 0) ids.push(id); };
  var one = async function (id) {
    if (inline[id]) return { id: id, status: 200, conv: inline[id] };
    var g = await get("/v1/conversations/" + id), b = null;
    if (g.status !== 200) return { id: id, status: g.status, error: g.error || String(g.body || "").slice(0, 120) };
    try { b = JSON.parse(g.body); } catch (e) {}
    var conv = b && typeof b.conversation === "object" && b.conversation ? b.conversation : b;
    if (!conv || conv.id !== id) return { id: id, status: 0, error: "unreadable conversation" };
    if (!conv.timezone && b && typeof b.timezone === "string") conv.timezone = b.timezone;
    return { id: id, status: 200, conv: conv };
  };
  var getAll = async function (take) {
    for (var i = 0; i < take.length; i += 4) {
      var part = await Promise.all(take.slice(i, i + 4).map(one));
      for (var p of part) { if (p.status === 401) return false; convs.push(p); }
    }
    return true;
  };
  var ms = function (v) { return typeof v === "number" && isFinite(v) ? (v > 1e12 ? v : v * 1000) : null; };
  // Backfill (§6) pre-count: list calls only. GET /v1/conversations?limit=50[&cursor=] page by page; every conversation that started
  // at or after j.from. Bee lists newest first: a page wholly older than j.from ends the walk (if a page comes oldest first, every
  // page is read instead). → list {items [{id, start_time, end_time, state, updated_at}], complete, pages}.
  var walk = async function (from) {
    var items = [], cur = null, complete = true, pages = 0;
    for (;;) {
      if (pages >= 400) { complete = false; break; }
      var g = await get("/v1/conversations?limit=50" + (cur ? "&cursor=" + encodeURIComponent(cur) : "")); pages++;
      if (g.status === 401) return { status: 401 };
      if (g.status !== 200) return { status: g.status, error: g.error || String(g.body || "").slice(0, 160) };
      var b = null; try { b = JSON.parse(g.body); } catch (e) {}
      if (!b || !Array.isArray(b.conversations)) return { status: 0, error: "Bee's conversation list was unreadable" };
      var older = 0, list = b.conversations, desc = list.length > 1 && ms(list[0].start_time) >= ms(list[list.length - 1].start_time);
      for (var c of list) { var st = ms(c && c.start_time); if (!c || typeof c.id !== "number") continue;
        if (st != null && st < from) { older++; continue; }
        items.push({ id: c.id, start_time: st, end_time: ms(c.end_time), state: typeof c.state === "string" ? c.state : null, updated_at: typeof c.updated_at === "number" ? c.updated_at : null }); }
      cur = typeof b.next_cursor === "string" && b.next_cursor ? b.next_cursor : null;
      if (!cur || !list.length || (from && older && (desc || list.length === 1) && older === list.length)) break;
    }
    return { status: 200, list: { items: items, complete: complete, pages: pages } };
  };
  if (j.only === "list") return walk(Number(j.from) || 0);
  // Backfill run: the full conversations for j.ids (4 at a time), nothing else.
  if (j.only === "convs") { for (var x of (j.ids || []).slice(0, 100)) add(x); if (!(await getAll(ids))) return { status: 401 }; return { status: 200, convs: convs, more: [] }; }
  var path = function (c) { return "/v1/changes" + (c ? "?cursor=" + encodeURIComponent(c) : ""); };
  var reset = false, r = await get(path(j.cursor));
  if (j.cursor && r.status >= 400 && r.status < 500 && r.status !== 401 && r.status !== 429) { reset = true; r = await get(path(null)); }
  if (r.status !== 200) return { status: r.status, reset: reset, error: r.error || String(r.body || "").slice(0, 200) };
  // The catch-up walk (asked for, or the cursor was just refused): finished conversations since that time, ids + start only.
  var cfrom = typeof j.catchup === "number" ? j.catchup : reset && typeof j.cursor_at === "number" ? j.cursor_at : null, catchup = null;
  if (cfrom != null) { var wk = await walk(Math.max(0, cfrom));
    if (wk.status === 401) return { status: 401, reset: reset };
    catchup = wk.status === 200 ? { from: cfrom, complete: wk.list.complete, pages: wk.list.pages, items: wk.list.items.filter(function (c) { return c.end_time != null || c.state === "COMPLETED"; }).map(function (c) { return { id: c.id, start_time: c.start_time }; }) }
      : { from: cfrom, status: wk.status, error: wk.error || null }; }
  var ch; try { ch = JSON.parse(r.body); } catch (e) { ch = null; }
  if (!ch || typeof ch !== "object") return { status: 0, reset: reset, error: "Bee's changes answer was unreadable" };
  var meta = ch.meta && typeof ch.meta === "object" ? ch.meta : ch, list = Array.isArray(ch.conversations) ? ch.conversations : [];
  for (var c of list) { var id = typeof c === "number" ? c : c && c.id; add(id); if (c && typeof c === "object" && Array.isArray(c.transcriptions)) inline[id] = c; }
  for (var x of (j.ids || [])) add(x);
  var max = Math.max(1, Math.min(100, j.max || 25)), take = ids.slice(0, max), more = ids.slice(max);
  if (!(await getAll(take))) return { status: 401, reset: reset };
  var n = function (k) { return Array.isArray(ch[k]) ? ch[k].length : 0; }, facts = null;
  if (j.facts === "all" || (j.facts === "changed" && n("facts") > 0)) { facts = await listFacts(); if (facts.status === 401) return { status: 401, reset: reset }; }
  return { status: 200, reset: reset, convs: convs, more: more, facts: facts, ...(catchup ? { catchup: catchup } : {}), changes: { next_cursor: typeof meta.next_cursor === "string" ? meta.next_cursor : null,
    since: typeof meta.since === "number" ? meta.since : null, until: typeof meta.until === "number" ? meta.until : null, updated: meta.updated === true,
    timezone: typeof meta.timezone === "string" ? meta.timezone : null, conversations: list.length, facts: n("facts"), todos: n("todos"), dailies: n("dailies"), journals: n("journals") } };
  })();
  if (slow && res && typeof res === "object") res.slow = slow;
  return res;
}`;
// The container side of a sync: Node https with only the Bee CA trusted (like JOB_JS), GET only, /v1/ paths only. A network error
// is tried again (3 tries, 1 s then 2 s). A 429/5xx is tried again only when Bee's Retry-After is at most SYNC_RETRY_MAX_MS (and
// after exactly that wait); otherwise it comes back with retry_ms and the BeeSync DO waits (5 min or more, at least Retry-After).
// Token on stdin, the host fixed here.
export const SYNC_RETRY_MAX_MS = 10e3;
export const SYNC_JS = `const https=require("https"),HOST=${JSON.stringify(API_HOST)},CA=${JSON.stringify(PROD_ROOT_CA)},MARK=${JSON.stringify(JOB_MARK)};
const out=(o)=>{process.stdout.write("\\n"+MARK+JSON.stringify(o)+"\\n",()=>process.exit(0))};
${RETRY_AFTER_JS}
${SYNC_CORE}
let s="";process.stdin.setEncoding("utf8");process.stdin.on("data",(d)=>{s+=d}).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return out({status:0,error:"bad input"})}s="";
const tok=String(j.token||"");delete j.token;
const get=(path)=>new Promise((done)=>{if(typeof path!=="string"||!/^\\/v1\\//.test(path))return done({status:0,error:"bad path"});let n=0;
const again=()=>{if(n<3){setTimeout(go,1000*2**(n-1));return true}return false};
const go=()=>{n++;const req=https.request({host:HOST,servername:HOST,port:443,path,method:"GET",ca:[CA],timeout:20000,headers:{authorization:"Bearer "+tok,accept:"application/json"}},(res)=>{
let b="";res.setEncoding("utf8");res.on("data",(c)=>{b+=c});res.on("end",()=>{if(res.statusCode>=500||res.statusCode===429){const w=retryAfter(res.headers["retry-after"]);
if(w!=null&&w<=${SYNC_RETRY_MAX_MS}&&n<3){setTimeout(go,w);return}return done({status:res.statusCode,body:b,retry_ms:w})}done({status:res.statusCode,body:b})})});
req.on("timeout",()=>req.destroy(new Error("timeout")));req.on("error",(e)=>{if(again())return;done({status:0,error:String(e&&(e.code||e.message)||e).slice(0,120)})});req.end()};go()});
syncCore(j,get).then(out,(e)=>out({status:0,error:String(e&&e.message||e).slice(0,120)}))});`;
// ---- fact writes (§7, step 4): the ONLY writes the job makes ----
// WRITE_CORE is plain JS text like SYNC_CORE. Input {ops: [{op: "put", id, body: {text, tags, confirmed}} | {op: "delete", id} |
// {op: "post", body: {text}}]} (at most 20). Allowed: PUT /v1/facts/<id>, DELETE /v1/facts/<id>, POST /v1/facts, nothing else.
// HARD (SPEC §7): every PUT carries the fact's existing tags. A text-only PUT made Bee re-tag the fact with junk categories, so a PUT
// without a tags array first reads the fact (GET /v1/facts/<id>) and sends its tags; if that read fails, nothing is written.
export const WRITE_CORE = `async function writeCore(j, req) {
  var out = [], ops = Array.isArray(j.ops) ? j.ops.slice(0, 20) : [];
  var okId = function (x) { return typeof x === "number" && Number.isSafeInteger(x) && x > 0; };
  for (var o of ops) {
    var id = o && o.id, b = (o && o.body) || {}, method = null, path = null, body = null;
    if (o && o.op === "put" && okId(id) && typeof b.text === "string" && b.text.trim() && typeof b.confirmed === "boolean") {
      var tags = Array.isArray(b.tags) && b.tags.every(function (t) { return typeof t === "string"; }) ? b.tags : null;
      if (!tags) {
        var g = await req("GET", "/v1/facts/" + id, null), cur = null;
        if (g.status === 401) return { status: 401, results: out };
        try { cur = JSON.parse(g.body); cur = cur && (cur.fact || cur); } catch (e) {}
        if (g.status !== 200 || !cur || !Array.isArray(cur.tags)) { out.push({ op: "put", id: id, status: g.status === 404 ? 404 : 0, error: "couldn't read the fact's tags" }); continue; }
        tags = cur.tags;
      }
      method = "PUT"; path = "/v1/facts/" + id; body = { text: b.text, tags: tags, confirmed: b.confirmed };
    }
    else if (o && o.op === "delete" && okId(id)) { method = "DELETE"; path = "/v1/facts/" + id; }
    else if (o && o.op === "post" && typeof b.text === "string" && b.text.trim()) { method = "POST"; path = "/v1/facts"; body = { text: b.text }; }
    else { out.push({ op: o && o.op, id: okId(id) ? id : null, status: 0, error: "not allowed" }); continue; }
    var r = await req(method, path, body);
    if (r.status === 401) return { status: 401, results: out };
    var d = null; try { d = r.body ? JSON.parse(r.body) : null; } catch (e) {}
    var f = d && typeof d === "object" ? (d.fact || d) : null;
    out.push({ op: o.op, id: okId(id) ? id : null, status: r.status, sent_tags: body && body.tags ? body.tags : null,
      fact: f && typeof f.id === "number" ? { id: f.id, text: typeof f.text === "string" ? f.text : null, tags: Array.isArray(f.tags) ? f.tags : null, confirmed: typeof f.confirmed === "boolean" ? f.confirmed : null } : null,
      error: r.status >= 200 && r.status < 300 ? null : (r.error || String(r.body || "").slice(0, 160)) });
  }
  return { status: 200, results: out };
}`;
// The container side: Node https with only the Bee CA trusted, the host fixed, and only GET /v1/facts/<id> (for tags), PUT and
// DELETE /v1/facts/<id> and POST /v1/facts. 429/5xx/network retried for GET/PUT/DELETE; a POST is never sent twice.
export const WRITE_JS = `const https=require("https"),HOST=${JSON.stringify(API_HOST)},CA=${JSON.stringify(PROD_ROOT_CA)},MARK=${JSON.stringify(JOB_MARK)};
const out=(o)=>{process.stdout.write("\\n"+MARK+JSON.stringify(o)+"\\n",()=>process.exit(0))};
${WRITE_CORE}
let s="";process.stdin.setEncoding("utf8");process.stdin.on("data",(d)=>{s+=d}).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return out({status:0,error:"bad input"})}s="";
const tok=String(j.token||"");delete j.token;
const ALLOW={GET:/^\\/v1\\/facts\\/\\d+$/,PUT:/^\\/v1\\/facts\\/\\d+$/,DELETE:/^\\/v1\\/facts\\/\\d+$/,POST:/^\\/v1\\/facts$/};
const req=(method,path,body)=>new Promise((done)=>{if(!ALLOW[method]||!ALLOW[method].test(path))return done({status:0,error:"not allowed"});
const data=body==null?null:JSON.stringify(body),tries=method==="POST"?1:3;let n=0;
const again=()=>{if(n<tries){setTimeout(go,1000*2**(n-1));return true}return false};
const go=()=>{n++;const r=https.request({host:HOST,servername:HOST,port:443,path,method,ca:[CA],timeout:20000,headers:{authorization:"Bearer "+tok,accept:"application/json",...(data?{"content-type":"application/json","content-length":Buffer.byteLength(data)}:{})}},(res)=>{
let b="";res.setEncoding("utf8");res.on("data",(c)=>{b+=c});res.on("end",()=>{if((res.statusCode>=500||res.statusCode===429)&&again())return;done({status:res.statusCode,body:b})})});
r.on("timeout",()=>r.destroy(new Error("timeout")));r.on("error",(e)=>{if(again())return;done({status:0,error:String(e&&(e.code||e.message)||e).slice(0,120)})});if(data)r.write(data);r.end()};go()});
writeCore(j,req).then(out,(e)=>out({status:0,error:String(e&&e.message||e).slice(0,120)}))});`;
// beejob DO side: called from Computer.beeJob (index.js). `dobj` is the Computer instance (ctx.container, get/put, alarms).
// Jobs on one DO run one at a time; the container starts on demand and Computer.alarm stops it JOB_IDLE_MS after the last job.
// input.kind "sync" runs SYNC_JS (else JOB_JS, one request). input.stop: destroy the container as soon as this job is done and
// nothing else is queued, so a 5-minute sync bills its own seconds only, not a 30 s idle tail.
// The container up (started on demand, "bee" role so Computer.alarm stops it when idle). → cold: it had to start.
async function beeUp(dobj, what = "the Bee job's container") {
  const ctx = dobj.ctx; let cold = false;
  dobj.put("role", "bee");
  if (!ctx.container.running) {
    // BeeContainer (bee-container.js) supplies its own start, which restores a snapshot under the durable_object policy.
    if (typeof dobj.beeStart === "function") await dobj.beeStart();
    else ctx.container.start({ entrypoint: ["bash", "-c", "trap 'exit 0' TERM INT; while true; do sleep 3600 & wait $!; done"], enableInternet: true });
    cold = true;
  }
  let up = false;
  for (let i = 0; i < 80 && !up; i++) { try { up = (await (await ctx.container.exec(["true"], { stderr: "combined" })).output()).exitCode === 0; } catch { await new Promise((z) => setTimeout(z, 250)); } }
  if (!up) throw new Error(`${what} didn't start`);
  return cold;
}
// Which Durable Object class runs Bee jobs. BEE_SNAPSHOTS unset or "off" = the Computer class (today's behavior). "on" = BeeContainer
// (durable_object scheduling policy, restores a snapshot), only where that binding exists (dev).
export const beeSnapshotsOn = (env) => env?.BEE_SNAPSHOTS === "on" && !!env?.BEE_CONTAINER;
export const beeBinding = (env) => beeSnapshotsOn(env) ? env.BEE_CONTAINER : env.COMPUTER;
export const beeJobStub = (env, tenantId) => { const b = beeBinding(env); return b.get(b.idFromName(`beejob:${tenantId}`)); };
// When the container stops after a job. BEE_IDLE unset or "tail" = today's behavior (a JOB_IDLE_MS tail, and an immediate stop only
// when the job says stop). "queue" = stop as soon as no job is queued and no Live chunk runs. "queue:<seconds>" = the same after that grace.
export function beeIdlePolicy(value) {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "queue") return { mode: "queue", graceMs: 0 };
  const m = /^queue:(\d{1,3})$/.exec(v);
  if (m) return { mode: "queue", graceMs: Number(m[1]) * 1000 };
  return { mode: "tail", graceMs: JOB_IDLE_MS };
}
const idleOf = (dobj) => beeIdlePolicy(typeof dobj.beeIdleValue === "function" ? dobj.beeIdleValue() : dobj.env?.BEE_IDLE);
const liveBusy = (dobj) => !!(dobj._live && !dobj._live.done);
export function beeJobOn(dobj, input) {
  dobj._beeN = (dobj._beeN || 0) + 1;
  const run = async () => {
    const ctx = dobj.ctx, t0 = now();
    const cold = await beeUp(dobj);
    const sync = input?.kind === "sync", facts = input?.kind === "facts", probe = input?.kind === "liveprobe", { kind: _k, stop: _s, bench: _b, ...job } = input || {};
    // Container benchmark only (dev with TEST_MODE): the script's stdin is the given text, so a script can be run on input it rejects before any network call.
    const raw = typeof input?.bench?.stdin === "string" && dobj.env?.ENV_NAME === "dev" && String(dobj.env?.TEST_MODE) === "1" ? input.bench.stdin.slice(0, 1024) : null;
    const p = await ctx.container.exec(["node", "-e", sync ? SYNC_JS : facts ? WRITE_JS : probe ? LIVE_JS : JOB_JS], { stdin: new Response(raw ?? JSON.stringify(probe ? { ...job, probe: true } : job)).body, stderr: "combined" });
    const kill = setTimeout(() => { try { p.kill(9); } catch {} }, sync ? SYNC_KILL_MS : 90e3);
    const o = await p.output(); clearTimeout(kill);
    const ms = now() - t0;
    let stopped = false;
    const idle = idleOf(dobj), alone = dobj._beeN <= 1 && !liveBusy(dobj);   // a queued job or a Live notes job keeps it up
    if (alone && (input?.stop || (idle.mode === "queue" && idle.graceMs === 0))) { try { await ctx.container.destroy("bee sync done"); stopped = true; } catch {} }
    if (!stopped) { dobj.put("bee_last", now()); await ctx.storage.setAlarm(now() + idle.graceMs); }
    const line = new TextDecoder().decode(o.stdout).split("\n").find((l) => l.startsWith(JOB_MARK));
    let r; try { r = JSON.parse(line.slice(JOB_MARK.length)); } catch { r = { status: 0, error: `job exited ${o.exitCode} without an answer` }; }
    return { ...r, ms, cold, stopped };
  };
  const done = (x) => { dobj._beeN--; return x; }, fail = (e) => { dobj._beeN--; throw e; };
  dobj._beeQ = (dobj._beeQ || Promise.resolve()).catch(() => {}).then(run).then(done, fail);
  return dobj._beeQ;
}
export const SYNC_KILL_MS = 120e3;
// Computer.alarm for the beejob role: stop the container once it has been idle JOB_IDLE_MS.
export async function beeJobAlarm(dobj) {
  const last = Number(dobj.get("bee_last") || 0);
  if (!dobj.ctx.container.running) return;
  const idle = idleOf(dobj);
  if (liveBusy(dobj) || (idle.mode === "queue" && dobj._beeN > 0)) { await dobj.ctx.storage.setAlarm(now() + Math.max(idle.graceMs, 1000)); return; }   // Live notes is polling (or, under the queue policy, a job is queued): not idle
  if (now() - last >= idle.graceMs - 1000) { await dobj.ctx.container.destroy("bee job idle"); return; }
  await dobj.ctx.storage.setAlarm(last + idle.graceMs);
}
// ---- Live notes (SPEC §9.2-9.3): the polling job ----
// LIVE_CORE is plain JS text like SYNC_CORE (runs in the container, and in the tests against a fake Bee). One job = one chunk of at
// most max_ms (3 min): every `every` ms (5 s) it reads each followed conversation, and every `list_every` ms (30 s)
// GET /v1/conversations?limit=10 to find CAPTURING ones (a new conversation Bee starts mid-session is followed too). Each round
// prints ONE line {t:"poll", v, n, convs:[{id,state}], utts:[{c,id,at,sp,tx,rt}], errs, hold_until?, held?}, which the Computer DO
// hands to the LiveNotes DO (livePush); its answer {go:false} kills the job. 401 → {t:"auth"} and the job ends.
// The transcript read is GET /v1/conversations/{id}, filtered here, exactly like the official CLI's `conversations transcript
// --since` (bee-cli resources/conversations: it GETs the conversation and filters the utterances itself). Bee has no
// /v1/conversations/{id}/transcript route (DOCS-REVIEW 2026-10-07). Late lines: an utterance can arrive after a newer one, so the
// filter is spoken_at >= (newest seen − LIVE_LATE_MS); ids already seen are dropped (and the LiveNotes DO's UNIQUE(n, conv, uid)
// drops the re-reads of a new chunk).
// Rate limits (none documented): a 429/5xx → no more calls this round, and none until Retry-After (clamped to 1 s…5 min) or, without
// one, LIVE_HOLD_MS (30 s). While held, each round is only a heartbeat line {held: true, hold_until} (keeps the watchdog quiet); the
// LiveNotes DO hands hold_until to the next chunk. j.probe: one round, no text out (/_ops/bee?live=probe, dev): shapes, counts, lag.
// The SSE feed (2026-10-08, DOCS-REVIEW finding 1; docs.bee.computer/docs/realtime, bee-cli commands/stream): with j.stream and an
// openStream(onEvent, onState) the chunk also holds GET /v1/stream?types=… (LIVE_STREAM_PATH, the only stream path allowed) for its
// own lifetime. Bee's frames are "event: <type>\ndata: <json>\n\n" (":" lines are pings; a "connected" event first):
//   new-utterance {utterance{text,speaker}, conversation_uuid} · new-conversation {conversation{id,uuid,state:"processing",title}}
//   update-conversation {conversation{id,state:"processed",title,short_summary}} · update-conversation-summary {conversation_id,
//   short_summary} · delete-conversation {conversation{id,title}}. Delivery is at-most-once, so events are only HINTS:
//   - any event for us wakes the loop: the next round (the same full GET, still the source of truth) runs at once, or LIVE_MIN_GAP_MS
//     (5 s) after the last one if that was sooner, so a quiet stretch costs no reads and talking costs no more than before; new-conversation (and an utterance whose conversation_uuid a new-conversation mapped) follows
//     that conversation at once;
//   - while the stream is open the GETs fall back to a safety round every LIVE_SAFETY_MS (15 s), so a dropped event costs at most
//     that; while it's closed (error, Bee ended it, idle LIVE_STREAM_IDLE_MS) the job polls every 5 s as before and reconnects
//     (Retry-After, else 5 s doubling to 60 s); 401/403/404 → no stream for the rest of the chunk (the GETs carry on);
//   - update-conversation with a finished state on one still CAPTURING here → a GET right away; the GET says whether it ended.
//     update-conversation-summary → hints.summary [ids] (Bee's summary is in: the LiveNotes DO asks BeeSync for a re-read).
//   No event text leaves the job (only ids, states and counts).
export const LIVE_V = "ln3";
export const LIVE_LATE_MS = 30e3, LIVE_HOLD_MS = 30e3, LIVE_HOLD_MAX_MS = 5 * 60e3;
export const LIVE_SAFETY_MS = 15e3, LIVE_MIN_GAP_MS = 5e3, LIVE_STREAM_IDLE_MS = 75e3, LIVE_STREAM_RETRY_MAX_MS = 60e3;
export const LIVE_STREAM_TYPES = ["new-utterance", "new-conversation", "update-conversation", "update-conversation-summary", "delete-conversation"];
export const LIVE_STREAM_PATH = `/v1/stream?types=${LIVE_STREAM_TYPES.join(",")}`;
// SSE framing (plain JS text, like SYNC_CORE): feed(state, chunk, onEvent). state {buf, ev, data}. Bounded: a frame over 256 KB → throws.
export const SSE_CORE = `function sseFeed(S, chunk, onEv) {
  S.buf = (S.buf || "") + chunk; if (!S.data) S.data = [];
  if (S.buf.length > 262144) { S.buf = ""; S.ev = null; S.data = []; throw new Error("event too big"); }
  var i;
  while ((i = S.buf.indexOf("\\n")) >= 0) {
    var l = S.buf.slice(0, i).replace(/\\r$/, ""); S.buf = S.buf.slice(i + 1);
    if (l === "") { if (S.data.length) { var d = null; try { d = JSON.parse(S.data.join("\\n")); } catch (e) {} try { onEv(S.ev || null, d); } catch (e) {} } S.ev = null; S.data = []; continue; }
    if (l[0] === ":") continue;
    var k = l.indexOf(":"), f = k < 0 ? l : l.slice(0, k), v = k < 0 ? "" : l.slice(k + 1).replace(/^ /, "");
    if (f === "event") S.ev = v; else if (f === "data") S.data.push(v);
  }
}`;
export const LIVE_CORE = `async function liveCore(j, get, emit, alive, sleep, openStream) {
  var V = j.v || null, every = Math.max(1000, j.every || 5000), listEvery = Math.max(every, j.list_every || 30000), since0 = Number(j.since) || 0;
  var LATE = ${LIVE_LATE_MS}, HOLD = ${LIVE_HOLD_MS}, HOLD_MAX = ${LIVE_HOLD_MAX_MS}, SAFETY = Math.max(every, j.safety_every || ${LIVE_SAFETY_MS}), GAP = Math.max(500, j.min_gap || ${LIVE_MIN_GAP_MS}), RETRY_MAX = ${LIVE_STREAM_RETRY_MAX_MS};
  var follow = {}, order = [], lastList = -1e15, n = 0, hold = Number(j.hold_until) || 0;
  var addF = function (id, st) { if (typeof id !== "number" || !(id > 0) || follow[id]) return; follow[id] = { state: st || "CAPTURING", at: Number((j.cursors || {})[id]) || since0, seen: {}, done: false }; order.push(id); };
  // ---- the stream (hints only) ----
  var SX = { on: !!(j.stream && typeof openStream === "function"), st: "off", h: null, retry_at: 0, fails: 0, opens: 0, why: null, ev: {}, uuids: {}, hot: false, summary: [], keys: {}, states: {} };
  var wakeR = null;
  var wake = function () { SX.hot = true; if (wakeR) { var r = wakeR; wakeR = null; r(); } };
  var nap = function (ms) { if (SX.hot) return Promise.resolve(); return Promise.race([sleep(ms), new Promise(function (r) { wakeR = r; })]); };
  var kind = function (ev, d) { if (ev) return ev; if (!d || typeof d !== "object") return null; if (d.utterance) return "new-utterance"; if (d.conversation) return d.conversation.uuid ? "new-conversation" : "update-conversation"; if (d.conversation_id != null && "short_summary" in d) return "update-conversation-summary"; return null; };
  var onEv = function (ev0, d) {
    var ev = kind(ev0, d); if (!ev) return; SX.ev[ev] = (SX.ev[ev] || 0) + 1;
    if (j.probe) { var ks = Object.keys(d || {}).sort(); if (d && d.conversation) ks = ks.concat(Object.keys(d.conversation).sort().map(function (x) { return "conversation." + x; })); if (d && d.utterance) ks = ks.concat(Object.keys(d.utterance).sort().map(function (x) { return "utterance." + x; })); SX.keys[ev] = ks; if (d && d.conversation && typeof d.conversation.state === "string") SX.states[ev + ":" + d.conversation.state] = 1; return; }
    if (ev === "connected") return;
    var c = d && d.conversation && typeof d.conversation === "object" ? d.conversation : null, id = c && typeof c.id === "number" ? c.id : d && typeof d.conversation_id === "number" ? d.conversation_id : null;
    if (ev === "new-conversation") { if (id) { if (typeof c.uuid === "string") SX.uuids[c.uuid] = id; addF(id, "CAPTURING"); } wake(); return; }
    if (ev === "new-utterance") { var mid = d && typeof d.conversation_uuid === "string" ? SX.uuids[d.conversation_uuid] : null; if (mid) addF(mid, "CAPTURING"); wake(); return; }
    if (!id || !follow[id]) return;   // not one of ours
    if (ev === "update-conversation-summary") { if (SX.summary.indexOf(id) < 0) SX.summary.push(id); return; }
    if (!follow[id].done) wake();      // update / delete of one we still follow: read it now
  };
  var openS = function () {
    if (!SX.on || SX.st === "open" || SX.st === "opening" || SX.st === "dead" || Date.now() < SX.retry_at || Date.now() < hold) return;
    SX.st = "opening"; SX.opens++;
    var mine = {};
    try { SX.h = openStream(function (ev, d) { if (SX.cur === mine) onEv(ev, d); }, function (st, info) {
      if (SX.cur !== mine) return;
      if (st === "open") { SX.st = "open"; SX.fails = 0; SX.why = null; return; }
      SX.h = null; SX.cur = null; var code = info && info.status;
      if (code === 401 || code === 403 || code === 404) { SX.st = "dead"; SX.why = code; }
      else { SX.fails++; SX.st = "closed"; SX.why = code || (info && info.error) || st; var w = info && info.retry_ms != null && isFinite(Number(info.retry_ms)) ? Math.max(1000, Math.min(HOLD_MAX, Number(info.retry_ms))) : Math.min(RETRY_MAX, 5000 * Math.pow(2, SX.fails - 1)); SX.retry_at = Date.now() + w; }
      wake();   // back to 5 s polling now
    }); SX.cur = mine; } catch (e) { SX.st = "closed"; SX.fails++; SX.why = String(e && e.message || e).slice(0, 60); SX.retry_at = Date.now() + RETRY_MAX; }
  };
  var closeS = function () { var h = SX.h; SX.h = null; SX.cur = null; if (SX.st !== "dead") SX.st = "off"; try { h && h.close(); } catch (e) {} };
  (j.convs || []).forEach(function (id) { addF(Number(id)); });
  var ms = function (v) { return typeof v === "number" && isFinite(v) ? (v > 1e12 ? v : v * 1000) : null; };
  var flat = function (conv) { var out = []; (Array.isArray(conv && conv.transcriptions) ? conv.transcriptions : []).forEach(function (t) { (Array.isArray(t && t.utterances) ? t.utterances : []).forEach(function (u) { out.push(u); }); }); return out; };
  var shape = function (u, c) { var at = ms(u && u.spoken_at); return at == null || typeof u.text !== "string" || !u.text.trim() ? null : { c: c, id: typeof u.id === "number" ? u.id : null, at: at, sp: typeof u.speaker === "string" ? u.speaker : null, tx: u.text, rt: u.realtime === false ? 0 : 1 }; };
  var busy = function (r) { return r.status === 429 || r.status >= 500; };
  var holdFor = function (r) { var w = Number(r.retry_ms); w = r.retry_ms != null && isFinite(w) && w >= 0 ? Math.min(HOLD_MAX, Math.max(1000, w)) : HOLD; hold = Math.max(hold, Date.now() + w); return w; };
  var once = async function () {
    var out = { t: "poll", v: V, n: n, convs: [], utts: [], errs: [] }, now = Date.now();
    if (now < hold) { out.held = true; out.hold_until = hold; return out; }
    if (now - lastList >= listEvery) { lastList = now;
      var g = await get("/v1/conversations?limit=10");
      if (g.status === 401) return { t: "auth", v: V };
      if (g.status === 200) { var b = null; try { b = JSON.parse(g.body); } catch (e) {}
        var list = b && Array.isArray(b.conversations) ? b.conversations : [];
        for (var c of list) { if (!c || typeof c.id !== "number") continue; var live = c.state === "CAPTURING" || (c.end_time == null && c.state !== "COMPLETED");
          if (live) addF(c.id, "CAPTURING"); if (follow[c.id] && !follow[c.id].done) follow[c.id].state = live ? "CAPTURING" : (typeof c.state === "string" ? c.state : "COMPLETED"); }
        if (j.probe) out.list = list.slice(0, 10).map(function (c) { return { id: c.id, state: c.state, start_time: c.start_time, end_time: c.end_time, updated_at: c.updated_at, utterances_count: c.utterances_count, keys: Object.keys(c || {}).sort() }; });
      } else { var e1 = { what: "list", status: g.status, error: g.error || null }; if (busy(g)) { e1.wait_ms = holdFor(g); out.errs.push(e1); out.hold_until = hold; n++; return out; } out.errs.push(e1); }
    }
    for (var id of order) { var f = follow[id]; if (f.done) continue;
      var utts = null, st = null;
      var g2 = await get("/v1/conversations/" + id);
      if (g2.status === 401) return { t: "auth", v: V };
      if (g2.status === 404) { f.done = true; st = "GONE"; }
      else if (g2.status === 200) { var cb = null; try { cb = JSON.parse(g2.body); } catch (e) {} var conv = cb && typeof cb.conversation === "object" && cb.conversation ? cb.conversation : cb;
        if (conv && conv.id === id) { var from = f.at - LATE; utts = flat(conv).filter(function (u) { var a = ms(u && u.spoken_at); return a != null && a >= from; }); st = conv.state === "CAPTURING" || conv.end_time == null ? "CAPTURING" : (conv.state || "COMPLETED");
          if (j.probe) out.probe_conv = { keys: Object.keys(conv).sort(), state: conv.state, end_time: conv.end_time, transcriptions: (conv.transcriptions || []).map(function (t) { return { realtime: t.realtime, utterances: (t.utterances || []).length }; }) }; } }
      else { var e2 = { what: "conversation", id: id, status: g2.status, error: g2.error || null }; if (busy(g2)) { e2.wait_ms = holdFor(g2); out.errs.push(e2); out.hold_until = hold; break; } out.errs.push(e2); }
      if (st) f.state = st;
      var mx = 0;
      for (var u of utts || []) { var x = shape(u, id); if (!x) continue; var k = x.id != null ? "i" + x.id : "t" + x.at + ":" + x.tx.slice(0, 40); if (f.seen[k]) continue; f.seen[k] = 1; out.utts.push(x); if (x.at > mx) mx = x.at; }
      if (mx) f.at = Math.max(f.at, mx);
      if (f.state !== "CAPTURING") f.done = true;
      out.convs.push({ id: id, state: f.state });
    }
    n++; return out;
  };
  var hints = function (o) {
    if (!SX.on || o.t !== "poll") return o;
    o.stream = SX.st; var k = Object.keys(SX.ev); if (k.length) { o.ev = SX.ev; SX.ev = {}; }
    if (SX.summary.length) { o.hints = { summary: SX.summary }; SX.summary = []; }
    return o;
  };
  if (j.probe && SX.on) {   // /_ops/bee?live=probe: hold the stream a few seconds too; event types, keys and states only
    openS(); var o0; try { o0 = await once(); } catch (e) { o0 = { t: "poll", errs: [{ what: "job", error: String(e && e.message || e).slice(0, 120) }] }; }
    var until = Date.now() + Math.min(30000, Math.max(1000, j.probe_stream_ms || 10000));
    while (Date.now() < until && SX.st !== "dead") { SX.hot = false; await nap(until - Date.now()); }
    o0.stream_probe = { state: SX.st, why: SX.why, opens: SX.opens, events: SX.ev, keys: SX.keys, states: Object.keys(SX.states) }; closeS(); return o0;
  }
  try {
    for (;;) {
      if (!alive()) return { t: "end", v: V, why: "time" };
      openS(); SX.hot = false;
      var o; try { o = await once(); } catch (e) { o = { t: "poll", v: V, n: n, convs: [], utts: [], errs: [{ what: "job", error: String(e && e.message || e).slice(0, 120) }] }; }
      if (j.probe) return o;
      emit(hints(o)); if (o.t === "auth") return { t: "end", v: V, why: "auth" };
      if (SX.st !== "open") { await sleep(every); continue; }
      var t1 = Date.now(); await nap(SAFETY);   // the stream is open: a round when an event says so (≥ GAP apart), else every SAFETY
      if (SX.hot && SX.st === "open") { var w = GAP - (Date.now() - t1); if (w > 0) await sleep(w); }
    }
  } finally { closeS(); }
}`;
// The container side: Node https with only the Bee CA trusted, the host fixed, GET only and only these paths (the list and one
// conversation). Token on stdin. 429/5xx are never retried here (LIVE_CORE holds); a network error is tried once more after 0.5 s.
export const LIVE_ALLOW = /^\/v1\/conversations(\?limit=\d{1,2}|\/\d{1,15})$/;
// The stream: exactly GET LIVE_STREAM_PATH (nothing else can be opened as a stream; get() can't reach /v1/stream), the Bee CA only,
// Accept text/event-stream. Bounded: it lives inside the chunk (closed when liveCore returns; the process exits right after, and
// beeLiveOn kills it at max_ms + 30 s), the connect has 15 s, an open stream silent for LIVE_STREAM_IDLE_MS is dropped (reconnects),
// and one frame over 256 KB drops it.
export const LIVE_JS = `const https=require("https"),HOST=${JSON.stringify(API_HOST)},CA=${JSON.stringify(PROD_ROOT_CA)},MARK=${JSON.stringify(JOB_MARK)},ALLOW=${LIVE_ALLOW.toString()},STREAM_PATH=${JSON.stringify(LIVE_STREAM_PATH)};
const line=(o)=>new Promise((ok)=>process.stdout.write("\\n"+MARK+JSON.stringify(o)+"\\n",ok));
${RETRY_AFTER_JS}
${SSE_CORE}
${LIVE_CORE}
let s="";process.stdin.setEncoding("utf8");process.stdin.on("data",(d)=>{s+=d}).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return line({t:"end",why:"bad input"}).then(()=>process.exit(0))}s="";
const tok=String(j.token||"");delete j.token;const t0=Date.now(),max=Math.min(15*60e3,Number(j.max_ms)||180e3);
const get=(path)=>new Promise((done)=>{if(typeof path!=="string"||!ALLOW.test(path))return done({status:0,error:"bad path"});let n=0;
const again=()=>{if(n<2){setTimeout(go,500*n);return true}return false};
const go=()=>{n++;const req=https.request({host:HOST,servername:HOST,port:443,path,method:"GET",ca:[CA],timeout:8000,headers:{authorization:"Bearer "+tok,accept:"application/json"}},(res)=>{
let b="";res.setEncoding("utf8");res.on("data",(c)=>{b+=c});res.on("end",()=>{const o={status:res.statusCode,body:b};if(res.statusCode===429||res.statusCode>=500)o.retry_ms=retryAfter(res.headers["retry-after"]);done(o)})});
req.on("timeout",()=>req.destroy(new Error("timeout")));req.on("error",(e)=>{if(again())return;done({status:0,error:String(e&&(e.code||e.message)||e).slice(0,120)})});req.end()};go()});
const openStream=(onEv,onSt)=>{let fin=false,idle=null;const end=(st,info)=>{if(fin)return;fin=true;clearTimeout(idle);onSt(st,info||{})};
const req=https.request({host:HOST,servername:HOST,port:443,path:STREAM_PATH,method:"GET",ca:[CA],timeout:15000,headers:{authorization:"Bearer "+tok,accept:"text/event-stream","cache-control":"no-cache"}},(res)=>{
if(res.statusCode!==200){res.resume();return end("error",{status:res.statusCode,retry_ms:retryAfter(res.headers["retry-after"])})}
req.setTimeout(0);onSt("open",{});res.setEncoding("utf8");const S={};
const bump=()=>{clearTimeout(idle);idle=setTimeout(()=>req.destroy(new Error("idle")),${LIVE_STREAM_IDLE_MS})};bump();
res.on("data",(c)=>{bump();try{sseFeed(S,c,onEv)}catch(e){req.destroy(e)}});res.on("end",()=>end("closed",{}));res.on("error",(e)=>end("closed",{error:String(e&&(e.code||e.message)||e).slice(0,80)}))});
req.on("timeout",()=>req.destroy(new Error("timeout")));req.on("error",(e)=>end("error",{error:String(e&&(e.code||e.message)||e).slice(0,80)}));req.end();
return{close:()=>{fin=true;clearTimeout(idle);try{req.destroy()}catch{}}}};
const strip=(o)=>{if(!o||!Array.isArray(o.utts))return o;const u=o.utts,mx=u.reduce((m,x)=>Math.max(m,x.at),0);o.utts={count:u.length,realtime:u.filter((x)=>x.rt).length,speakers:[...new Set(u.map((x)=>x.sp))].length,newest_lag_ms:mx?Date.now()-mx:null};return o};
liveCore(j,get,(o)=>{process.stdout.write("\\n"+MARK+JSON.stringify(o)+"\\n")},()=>Date.now()-t0<max,(ms)=>new Promise((r)=>setTimeout(r,ms)),openStream)
.then((o)=>line(j.probe?strip(o):o),(e)=>line({t:"end",v:j.v,why:"error",error:String(e&&e.message||e).slice(0,120)})).then(()=>process.exit(0))});`;
export const LIVE_GRACE_MS = 30e3;
// Computer.beeLive (the beejob DO): runs ONE chunk of the polling job and hands every line to the LiveNotes DO named input.ln;
// the RPC returns when the chunk ends ({ok, ms, why, lines}). A second call for the same run while it runs is a no-op; a new run
// replaces an old one. Jobs (sync, facts) keep running beside it; the container isn't stopped while a chunk runs.
export async function beeLiveOn(dobj, input, deps = {}) {
  const cur = dobj._live;
  if (cur && !cur.done && cur.run === input?.run) return { ok: true, already: true, v: LIVE_V };
  if (cur && !cur.done) { cur.replaced = true; try { cur.p?.kill(9); } catch {} }
  const L = { run: input?.run, ln: input?.ln, done: false, p: null, t0: now(), lines: 0 }; dobj._live = L;
  const env = dobj.env, ln = deps.ln || ((name) => env.LIVE_NOTES.get(env.LIVE_NOTES.idFromName(name)));
  let why = "ended", ms = 0;
  try {
    await beeUp(dobj, "the Live notes job's container");
    if (L.replaced) return { ok: false, why: "replaced" };
    const { kind: _k, ln: name, run, ...job } = input || {};
    const p = await dobj.ctx.container.exec(["node", "-e", LIVE_JS, "bee-live"], { stdin: new Response(JSON.stringify(job)).body, stderr: "combined" }); L.p = p;
    const kill = setTimeout(() => { try { p.kill(9); } catch {} }, Math.min(15 * 60e3, Number(job.max_ms) || 180e3) + LIVE_GRACE_MS);
    const stub = ln(name), reader = p.stdout.getReader(), dec = new TextDecoder(); let buf = "", stop = false;
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true }); let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const l = buf.slice(0, i); buf = buf.slice(i + 1); if (!l.startsWith(JOB_MARK) || stop) continue;
        let m; try { m = JSON.parse(l.slice(JOB_MARK.length)); } catch { continue; }
        if (m.t === "end") { why = m.why || why; continue; }
        L.lines++; let r = null; try { r = await stub.livePush(run, m); } catch (e) { r = { go: false, error: String(e?.message || e).slice(0, 120) }; }
        if (!r?.go) { stop = true; why = r?.error ? "push failed" : "stopped"; try { p.kill(9); } catch {} }
      }
    }
    clearTimeout(kill); ms = now() - L.t0;
    if (!L.replaced) { try { await stub.livePush(run, { t: "end", v: LIVE_V, why, ms }); } catch {} }
    return { ok: true, ms, why, lines: L.lines, v: LIVE_V };
  } finally {
    L.done = true; if (dobj._live === L) dobj._live = null;
    try {
      // Live notes keeps its container between chunks under every policy: the next chunk follows at once.
      dobj.put("bee_last", now()); await dobj.ctx.storage.setAlarm(now() + Math.max(idleOf(dobj).graceMs, JOB_IDLE_MS));
    } catch {}
  }
}
// Computer.beeLiveStop: the person stopped (or a cap): kill that run's job now.
export function beeLiveStopOn(dobj, run) {
  const L = dobj._live; if (!L || L.done || (run && L.run !== run)) return { stopped: false };
  L.replaced = true; try { L.p?.kill(9); } catch {} return { stopped: true };
}
// Worker side: /_ops/bee?live=probe (dev, read-only): ONE round of the job, the shapes only (no transcript text).
export async function beeLiveProbe(env, tenantId, token) {
  return beeJobStub(env, tenantId).beeJob({ kind: "liveprobe", stop: true, token, v: LIVE_V, since: now() - 10 * 60e3, every: 1000, list_every: 1000, max_ms: 60e3, stream: true, probe_stream_ms: 10e3 });
}
const PATH_RE = /^\/v1\/[A-Za-z0-9_\-/]*(\?[A-Za-z0-9_=&%.\-]*)?$/;
// Worker side: one Bee data API call for this workspace → { status, json, ms, cold } (status 0 = never reached Bee).
export async function beeData(env, tenantId, token, method, path, body) {
  if (!PATH_RE.test(path)) throw new Error("not a Bee API path");
  const r = await beeJobStub(env, tenantId).beeJob({ token, method, path, ...(body != null ? { body } : {}) });
  let json = null; try { json = r.body ? JSON.parse(r.body) : null; } catch {}
  return { status: Number(r.status) || 0, json, ms: r.ms, cold: !!r.cold, ...(r.error ? { error: r.error } : {}) };
}

// Worker side of one sync run: → the SYNC_CORE answer + { ms, cold, stopped } (status 0 = never reached Bee).
export async function beeSyncJob(env, tenantId, token, { cursor = null, ids = [], max = 25, facts = null, only = null, from = null, catchup = null, cursor_at = null, stop = true } = {}) {
  return beeJobStub(env, tenantId).beeJob({ kind: "sync", stop, token, cursor, ids, max, ...(facts ? { facts } : {}), ...(only ? { only } : {}), ...(from != null ? { from } : {}),
    ...(catchup != null ? { catchup } : {}), ...(cursor_at != null ? { cursor_at } : {}) });
}
// Worker side of fact writes (WRITE_CORE): → {status, results[]} + {ms, cold, stopped}.
export async function beeFactsJob(env, tenantId, token, ops) {
  return beeJobStub(env, tenantId).beeJob({ kind: "facts", stop: true, token, ops });
}

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
  const me = r.json, timing = r.ms != null ? ` in ${r.ms}ms${r.cold ? " (cold start)" : ""}` : "";
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
// lists the facts (GET only) and answers how many are confirmed / waiting for review; nothing is imported or written.
// ?backfill=count&days=30: the Import pre-count (GET /v1/conversations pages only) with its estimate; nothing is stored or imported.
export async function beeOps(env, tid, deps = DEFAULT_DEPS, opts = {}) {
  if (opts.liveProbe) {   // one read-only round of the Live notes job against this person's Bee: shapes, counts and lag, never the text
    const a = await accountRow(env, tid); if (!a || a.status !== "connected") return { error: "Bee isn't connected" };
    let token = await openSecret(env, a.token_sealed), r; try { r = await (deps.liveProbe || beeLiveProbe)(env, tid, token); } catch (e) { r = { error: String(e?.message || e).slice(0, 160) }; } finally { token = null; }
    return { live_probe: r };
  }
  if (opts.backfillDays != null) { const s = deps.sync?.(env, tid); if (!s) return { error: "no BeeSync" }; return { backfill_count: await s.opsBackfillCount(tid, opts.backfillDays) }; }
  if (opts.factsCount) { const s = deps.sync?.(env, tid); if (!s) return { error: "no BeeSync" }; return { facts_count: await s.opsFactsCount(tid) }; }
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
