// node --import ./test/stubs/register.mjs test/notify.test.mjs
// Settings → Notifications and Help & support → Report an issue, through the real Worker routes and the real
// Resident hooks (node:sqlite as D1 and as the channel's DO SQLite; the push service and Photon faked at fetch). Checks:
//   1. the switches persist per workspace (defaults on; unknown keys ignored; another workspace unaffected);
//   2. Web Push crypto: the aes128gcm body decrypts with the device's key (RFC 8291) and the VAPID JWT verifies (RFC 8292);
//   3. device subscriptions: only real push services, this_device, test push to that device only, unsubscribe;
//   4. a task that needs you / finishes → one push per task per state change; nothing when the switch is off; a new turn
//      re-arms it; a gone device is dropped; the hourly cap;
//   5. by text: "needs you" texts once when texting is connected and nobody is watching; the permission card obeys the switches;
//   6. reports: stored with the screenshot in R2, app version and logs; bad input refused; /reports admin-only;
//   7. the service worker is served at /w/<slug>/sw.js (push + notificationclick, no fetch handler).
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { createHash, webcrypto } from "node:crypto"; import { readFileSync } from "node:fs";
globalThis.HTMLRewriter ||= class { on() { return this; } transform(r) { return r; } };   // dev pages get a DEV strip; not needed here
const worker = (await import("../src/index.js")).default;
import { Resident } from "../src/resident.js";
import { encryptPayload, vapidAuth, vapidKeys, unb64u, b64u } from "../src/webpush.js";
import { notifyTask, PUSH_CAP } from "../src/notify.js";
import { swQuiet, SW_JS } from "../src/pwa.js";
import { sealSecret } from "../src/sentinel.js";
const ok = (n) => console.log("  ok", n);

// ---- D1 ----
const d1 = new DatabaseSync(":memory:");
d1.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT); CREATE TABLE sessions (token_hash TEXT, user_id TEXT, expires_at INTEGER);
  CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT, owner_user_id TEXT, status TEXT, onboarding_completed INTEGER, onboard_step TEXT, slug_chosen INTEGER, helper_name TEXT, helper_avatar INTEGER, first_name TEXT, plan TEXT, past_due_since INTEGER);
  CREATE TABLE texting (tenant_id TEXT PRIMARY KEY, status TEXT, phone TEXT, project_id TEXT, project_secret_sealed TEXT);
  INSERT INTO users VALUES ('u1','sam@example.com'),('u2','admin@example.test');
  INSERT INTO tenants VALUES ('t1','ck1','u1','active',1,'',1,'Ollie',3,'Sam','starter',NULL),('t2','ck2','u2','active',1,'',1,'Skipper',8,'Jo','starter',NULL);`);
d1.exec(readFileSync(new URL("../db/migrations/0018_027_notif_reports.sql", import.meta.url), "utf8")); d1.exec(readFileSync(new URL("../db/migrations/0084_push_devices.sql", import.meta.url), "utf8")); d1.exec(readFileSync(new URL("../db/migrations/0039_047_meetings.sql", import.meta.url), "utf8"));
for (const f of ["db/migrations/0006_017_cards.sql", "db/migrations/0007_018_card_kinds.sql"]) d1.exec(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
d1.exec("CREATE TABLE approval_policy (tenant_id TEXT NOT NULL, scope TEXT NOT NULL, scope_key TEXT NOT NULL DEFAULT '', mode TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (tenant_id, scope, scope_key))");
const hash = (s) => createHash("sha256").update(s).digest("hex");
d1.prepare("INSERT INTO sessions VALUES (?,?,?)").run(hash("aa11"), "u1", Date.now() + 864e5);
d1.prepare("INSERT INTO sessions VALUES (?,?,?)").run(hash("bb22"), "u2", Date.now() + 864e5);
for (const c of ["cc33", "dd44"]) d1.prepare("INSERT INTO sessions VALUES (?,?,?)").run(hash(c), "u1", Date.now() + 864e5);
const DB = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => ({ meta: { changes: Number(st.run(...a).changes) } }) }; return o; },
  batch: async (list) => { const out = []; for (const o of list) out.push(await o.run()); return out; } };
const r2 = new Map();
const WS = { put: async (k, v, o) => { r2.set(k, { bytes: Buffer.from(v), type: o?.httpMetadata?.contentType }); }, get: async (k) => r2.has(k) ? { body: r2.get(k).bytes } : null };
const keys = await vapidKeys();
const env = { DB, WS, TEST_MODE: "1", ENV_NAME: "dev", RELEASE_ADMINS: "admin@example.test", APP_HOST: "app.example.test", VAPID_PUBLIC: keys.publicKey, VAPID_PRIVATE: keys.privateKey,
  VAULT_KEY: Buffer.from(new Uint8Array(32).map((_, i) => i * 7 + 1)).toString("base64"),
  LEDGER: { idFromName: (x) => x, get: () => ({ state: async () => ({}) }) } };
const req = (path, { cookie = "hc_session=aa11", method = "GET", body } = {}) => worker.fetch(new Request(`https://app.example.test${path}`, { method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
const api = async (path, o) => { const r = await req(`/w/ck1/api${path}`, o); return { status: r.status, body: await r.json() }; };

// ---- a browser's push subscription (a real P-256 key + auth secret), and the push service faked at fetch ----
async function device(host = "fcm.googleapis.com") {
  const k = await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const pub = new Uint8Array(await webcrypto.subtle.exportKey("raw", k.publicKey)), auth = webcrypto.getRandomValues(new Uint8Array(16));
  return { key: k, sub: { endpoint: `https://${host}/fcm/send/${crypto.randomUUID()}`, keys: { p256dh: b64u(pub), auth: b64u(auth) } } };
}
// RFC 8291 decrypt (the browser's side), to prove what we send is readable by the device and only by it.
const hmac = async (k, d) => new Uint8Array(await webcrypto.subtle.sign("HMAC", await webcrypto.subtle.importKey("raw", k, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), d));
const cat = (...a) => Buffer.concat(a.map((x) => Buffer.from(x)));
async function decrypt(dev, body) {
  const b = new Uint8Array(body), salt = b.slice(0, 16), idlen = b[20], asPub = b.slice(21, 21 + idlen), ct = b.slice(21 + idlen);
  const uaPub = unb64u(dev.sub.keys.p256dh), auth = unb64u(dev.sub.keys.auth);
  const asKey = await webcrypto.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await webcrypto.subtle.deriveBits({ name: "ECDH", public: asKey }, dev.key.privateKey, 256));
  const ikm = (await hmac(await hmac(auth, ecdh), cat(Buffer.from("WebPush: info\0"), uaPub, asPub, [1]))).slice(0, 32);
  const prk = await hmac(salt, ikm), cek = (await hmac(prk, cat(Buffer.from("Content-Encoding: aes128gcm\0"), [1]))).slice(0, 16), nonce = (await hmac(prk, cat(Buffer.from("Content-Encoding: nonce\0"), [1]))).slice(0, 12);
  const pt = new Uint8Array(await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, await webcrypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]), ct));
  assert.equal(pt[pt.length - 1], 2); return JSON.parse(Buffer.from(pt.slice(0, -1)).toString());
}
const pushes = [], texts = [], relayCalls = []; let pushStatus = 201;
const devs = new Map();
globalThis.fetch = async (u, init = {}) => {
  u = String(u);
  if (/^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com)\//.test(u)) {
    const dev = devs.get(u); pushes.push({ endpoint: u, headers: init.headers, payload: dev ? await decrypt(dev, init.body) : null }); return new Response("", { status: pushStatus });
  }
  if (u.startsWith("https://relay.example.test/")) { relayCalls.push({ u, method: init.method, body: init.body ? JSON.parse(init.body) : null }); return new Response("{}", { status: 200 }); }
  if (u.includes("/imessage/tokens")) return new Response(JSON.stringify({ data: { token: "tok", expiresIn: 900 } }), { status: 200 });
  const m = u.match(/photon\.imessage\.v1\.MessageService\/(\w+)$/);
  if (m) { texts.push({ method: m[1], text: Buffer.from(init.body).toString("latin1") }); return new Response(`spc-msg-${crypto.randomUUID()}`, { status: 200, headers: { "grpc-status": "0" } }); }
  throw new Error(`unexpected fetch ${u}`);
};

// 1. The switches persist per workspace.
{
  let r = await api("/notif"); assert.equal(r.status, 200);
  assert.deepEqual(r.body.prefs, { needs: true, finished: true, sound: true, needs_text: true, meetings: true });
  assert.equal(r.body.push.key, keys.publicKey); assert.equal(r.body.push.devices, 0); assert.equal(r.body.push.this_device, false); assert.equal(r.body.texting, false);
  r = await api("/notif", { method: "POST", body: { finished: false, sound: false, daily: true, needs: "yes" } });
  assert.deepEqual(r.body.prefs, { needs: true, finished: false, sound: false, needs_text: true, meetings: true });
  assert.deepEqual((await api("/notif")).body.prefs, { needs: true, finished: false, sound: false, needs_text: true, meetings: true });
  const other = await req("/w/ck2/api/notif", { cookie: "hc_session=bb22" }); assert.deepEqual((await other.json()).prefs.finished, true);
  assert.match(await (await req("/w/ck1/api/notif", { cookie: "hc_session=bb22" })).text(), /No 1Helm at this address/);   // someone else's workspace
  await api("/notif", { method: "POST", body: { finished: true, sound: true } });
  ok("switches saved per workspace (defaults on, junk ignored, Morning summary gone, another workspace untouched)");
}

// 2. The crypto, on its own.
{
  const dev = await device(); devs.set(dev.sub.endpoint, dev);
  const body = await encryptPayload(dev.sub.keys.p256dh, dev.sub.keys.auth, JSON.stringify({ hi: "there" }));
  assert.equal(new DataView(body.buffer, body.byteOffset).getUint32(16), 4096); assert.equal(body[20], 65);
  assert.deepEqual(await decrypt(dev, body), { hi: "there" });
  const other = await device(); await assert.rejects(decrypt(other, body));   // another device can't read it
  const h = await vapidAuth(env, dev.sub.endpoint), [, jwt, k] = h.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, keys.publicKey);
  const [hh, pp, ss] = jwt.split("."), claims = JSON.parse(Buffer.from(unb64u(pp)).toString());
  assert.equal(claims.aud, "https://fcm.googleapis.com"); assert.ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 24 * 3600); assert.match(claims.sub, /^mailto:/);
  const pub = await webcrypto.subtle.importKey("raw", unb64u(keys.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  assert.ok(await webcrypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, unb64u(ss), Buffer.from(`${hh}.${pp}`)));
  ok("aes128gcm body decrypts with the device's key only; VAPID JWT verifies (aud = push service origin, exp ≤ 24 h)");
}

// 3. Devices.
const A = await device(), B = await device("updates.push.services.mozilla.com"); devs.set(A.sub.endpoint, A); devs.set(B.sub.endpoint, B);
{
  assert.equal((await api("/notif/sub", { method: "POST", body: { sub: { ...A.sub, endpoint: "https://evil.example.com/x" } } })).status, 400);
  assert.equal((await api("/notif/sub", { method: "POST", body: { sub: { ...A.sub, endpoint: "http://fcm.googleapis.com/x" } } })).status, 400);
  assert.equal((await api("/notif/sub", { method: "POST", body: { sub: { endpoint: A.sub.endpoint, keys: { p256dh: "x", auth: "y" } } } })).status, 400);
  assert.equal((await api("/notif/sub", { method: "POST", body: { sub: A.sub, label: "Chrome on Mac" } })).body.ok, true);
  assert.equal((await api("/notif/sub", { method: "POST", body: { sub: A.sub, label: "Chrome on Mac" } })).body.ok, true);   // again: still one row
  assert.equal((await api("/notif/sub", { method: "POST", body: { sub: B.sub, label: "Firefox on Linux" } })).body.ok, true);
  let r = await api(`/notif?endpoint=${encodeURIComponent(A.sub.endpoint)}`); assert.equal(r.body.push.devices, 2); assert.equal(r.body.push.this_device, true);
  pushes.length = 0;
  r = await api("/notif/test", { method: "POST", body: { endpoint: A.sub.endpoint } });
  assert.equal(r.body.ok, true); assert.equal(pushes.length, 1); assert.equal(pushes[0].endpoint, A.sub.endpoint);
  assert.equal(pushes[0].payload.test, true); assert.equal(pushes[0].payload.title, "Notifications are on"); assert.match(pushes[0].payload.tag, /^test-\d+$/);
  assert.match(pushes[0].payload.url, /\/app\?notif_test=\d+$/, "the test url carries the marker the Android app looks for"); assert.equal(pushes[0].payload.url.split("=").pop(), pushes[0].payload.tag.slice(5));
  assert.match(pushes[0].headers.authorization, /^vapid t=.+, k=/); assert.equal(pushes[0].headers["content-encoding"], "aes128gcm");
  assert.equal((await api("/notif/test", { method: "POST", body: { endpoint: "https://fcm.googleapis.com/fcm/send/unknown" } })).status, 404);
  // someone else's workspace can't test-push (or see) this device
  assert.equal((await req("/w/ck2/api/notif/test", { cookie: "hc_session=bb22", method: "POST", body: { endpoint: A.sub.endpoint } })).status, 404); assert.equal(pushes.length, 1);
  ok("devices: only real push services; one row per endpoint; this_device; a test goes to that device only, encrypted, with VAPID");
}


// 3b. The device list, removing a device, the Mac app's own row, and logout cancelling sign-ups.
{
  const subRow = (ep) => d1.prepare("SELECT * FROM push_subs WHERE endpoint=?").get(ep);
  assert.equal(subRow(A.sub.endpoint).session_hash, hash("aa11"), "a browser sign-up remembers the session that made it");
  let r = await api(`/notif/devices?endpoint=${encodeURIComponent(A.sub.endpoint)}`);
  assert.equal(r.status, 200); assert.equal(r.body.devices.length, 2);
  const a = r.body.devices.find((x) => x.name === "Chrome on Mac"), b = r.body.devices.find((x) => x.name === "Firefox on Linux");
  assert.equal(a.kind, "browser"); assert.equal(a.this_device, true); assert.equal(b.this_device, false); assert.ok(a.created_at > 0); assert.equal(typeof a.id, "string");
  assert.equal(JSON.stringify(r.body).includes("p256dh"), false); assert.equal(JSON.stringify(r.body).includes(A.sub.endpoint), false, "the list never exposes endpoints or keys");
  // an older row (no label, no session) gets a plain generic name from its push service
  const old = await device(); d1.prepare("INSERT INTO push_subs (id,tenant_id,endpoint,p256dh,auth,label,created_at) VALUES ('old1','t1',?,?,?, '', 1)").run(old.sub.endpoint, old.sub.keys.p256dh, old.sub.keys.auth);
  r = await api("/notif/devices"); assert.equal(r.body.devices.find((x) => x.id === "old1").name, "Chrome or another Chromium browser");
  assert.equal(r.body.devices.filter((x) => x.this_device).length, 0);
  // remove: by id, only inside the workspace, and the row is gone; the test button then says so
  assert.equal((await req("/w/ck2/api/notif/device/remove", { cookie: "hc_session=bb22", method: "POST", body: { id: "old1" } })).status, 200); assert.ok(subRow(old.sub.endpoint), "another workspace can't remove it");
  assert.equal((await api("/notif/device/remove", { method: "POST", body: { id: "old1" } })).body.removed, 1); assert.equal(subRow(old.sub.endpoint), undefined);
  assert.equal((await api("/notif/device/remove", { method: "POST", body: { id: "old1" } })).body.removed, 0);
  // a phone row: removed from this workspace (the push relay call is part of the licensed phone feature and is off in a public install)
  env.PUSH_RELAY = "0123456789abcdef:" + "s".repeat(32);
  const tok = "T".repeat(40); d1.prepare("INSERT INTO push_subs (id,tenant_id,endpoint,p256dh,auth,label,created_at) VALUES ('ph1','t1','native:android:abc','android',?,'Android app',2)").run(tok);
  relayCalls.length = 0; r = await api("/notif/devices"); assert.equal(r.body.devices.find((x) => x.id === "ph1").kind, "phone");
  await api("/notif/device/remove", { method: "POST", body: { id: "ph1" } });
  assert.equal(d1.prepare("SELECT 1 FROM push_subs WHERE id='ph1'").get(), undefined);
  delete env.PUSH_RELAY;
  // the Mac app lists itself, is never pushed to, and can leave
  assert.equal((await api("/notif/desktop", { method: "POST", body: { id: "short" } })).status, 400);
  const did = "0123456789abcdef-mac-app-1";
  assert.equal((await api("/notif/desktop", { method: "POST", body: { id: did } })).body.endpoint, `desktop:${did}`);
  await api("/notif/desktop", { method: "POST", body: { id: did } }); assert.equal(d1.prepare("SELECT COUNT(*) n FROM push_subs WHERE endpoint=?").get(`desktop:${did}`).n, 1);
  r = await api(`/notif/devices?endpoint=${encodeURIComponent(`desktop:${did}`)}`); const mac = r.body.devices.find((x) => x.kind === "desktop");
  assert.equal(mac.name, "Mac app"); assert.equal(mac.this_device, true); assert.ok(mac.seen_at > 0);
  pushes.length = 0; await api("/notif/test", { method: "POST", body: { endpoint: A.sub.endpoint } }); assert.equal(pushes.length, 1, "only the browser got the push");
  const pa = await (async () => { const { pushAll } = await import("../src/notify.js"); return pushAll(env, "t1", { title: "x", body: "y" }); })();
  assert.equal(pa.devices, 2); assert.ok(!pushes.some((p) => /desktop/.test(p.endpoint)));
  await api("/notif/desktop/off", { method: "POST", body: { id: did } }); assert.equal(subRow(`desktop:${did}`), undefined);
  // logout: the sign-ups made under that session go, the other session's stay
  const C = await device(); devs.set(C.sub.endpoint, C);
  await api("/notif/sub", { method: "POST", body: { sub: C.sub, label: "Chrome on Android" }, cookie: "hc_session=cc33" });
  assert.equal(subRow(C.sub.endpoint).session_hash, hash("cc33"));
  const lo = await req("/auth/logout", { cookie: "hc_session=cc33", method: "POST" }); assert.equal(lo.status, 204);
  assert.equal(subRow(C.sub.endpoint), undefined, "logout cancelled this browser's sign-up"); assert.ok(subRow(A.sub.endpoint), "another session's sign-up stays");
  assert.equal(d1.prepare("SELECT 1 FROM sessions WHERE token_hash=?").get(hash("cc33")), undefined);
  // signing another device out from Settings does the same
  const E = await device(); devs.set(E.sub.endpoint, E);
  await api("/notif/sub", { method: "POST", body: { sub: E.sub, label: "Edge on Windows" }, cookie: "hc_session=dd44" });
  const { sessionId } = await import("../src/account.js");
  const so = await api("/account/signout", { method: "POST", body: { id: await sessionId(hash("dd44")) } }); assert.equal(so.body.signed_out, 1);
  assert.equal(subRow(E.sub.endpoint), undefined, "signing the device out cancelled its sign-up");
  // the service worker's check route
  assert.deepEqual((await api("/notif/session")).body, { ok: true });
  assert.notEqual((await req("/w/ck1/api/notif/session", { cookie: "hc_session=zz99" })).status, 200, "no session: not 200");
  assert.notEqual((await req("/w/ck1/api/notif/session", { cookie: "" })).status, 200);
  ok("device list (names, this device, no keys), remove by id (phone also at the relay), Mac app row never pushed to, logout and sign-out cancel sign-ups, session check route");
}

// ---- the channel's Resident on node:sqlite ----
const dodb = new DatabaseSync(":memory:");
const sql = { exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { dodb.exec(q); return { toArray: () => [], one: () => undefined }; }
  const st = dodb.prepare(q); const r = /^\s*(SELECT|WITH)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } };
const src = readFileSync(new URL("../src/resident.js", import.meta.url), "utf8");
dodb.exec("CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT);" + src.match(/CREATE TABLE IF NOT EXISTS approvals[\s\S]*?approval_id INTEGER\);/)[0]
  + src.match(/CREATE TABLE IF NOT EXISTS sessions \([^"]*\)/)[0] + ";CREATE TABLE workflows (id INTEGER PRIMARY KEY, session TEXT, status TEXT);");
import { PERM_DDL } from "../src/perms.js";
import { userInputInit } from "../src/user-input.js";
userInputInit(sql);   // sessionView lists each task's pending questions (user_questions)
for (const q of [...PERM_DDL, "ALTER TABLE approvals ADD COLUMN ssh_data TEXT"]) { try { dodb.exec(q); } catch {} }   // columns the Resident adds to approvals at start (perms.js, native-network.js)
const R = Object.create(Resident.prototype);
const waits = [];
Object.assign(R, { sql, env, active: new Map(), ctx: { waitUntil: (p) => waits.push(p) }, archive: () => ({ channels: async () => [{ slug: "main", name: "General" }] }) });
R.helperCount = () => 0; R.pomoField = () => ({}); R.spendWaiting = () => false;   // sessionView reads these; the fixture has no spend_pauses table
R.put("tenant", "t1"); R.put("channel", "main");
env.RESIDENT = { idFromName: (n) => n, get: () => R };
const settle = async () => { while (waits.length) await waits.shift(); };
const task = (id, title) => dodb.prepare("INSERT INTO sessions (id,title,created,updated) VALUES (?,?,?,?)").run(id, title, Date.now(), Date.now());
const tc = (session, o = {}) => ({ kind: "chat", viaText: false, session, subs: new Set(), finished: true, ...o });
const S1 = "11111111-1111-4111-8111-111111111111", S2 = "22222222-2222-4222-8222-222222222222";
task(S1, "Find a plumber"); task(S2, "Plan the trip");

// 4. Pushes: one per task per state change.
{
  pushes.length = 0;
  dodb.prepare("UPDATE sessions SET waiting='question' WHERE id=?").run(S1);
  let r = await R.notifyAfterTurn(tc(S1), { reply: "Which day works for you?" });
  assert.equal(r.push.sent, 2); assert.equal(pushes.length, 2);
  const p = pushes[0].payload; assert.equal(p.kind, "needs"); assert.equal(p.title, "Ollie has a question for you"); assert.equal(p.body, "Find a plumber");
  assert.equal(p.url, `https://app.example.test/w/ck1/app#/main/s/${S1}`); assert.equal(p.session, String(S1)); assert.equal(swQuiet([{ url: p.url, visibilityState: "visible", focused: true }], p), true); assert.equal(pushes[0].headers.urgency, "high"); assert.ok(pushes[0].headers.topic.length <= 32);
  // the same state again (another turn ending on the same wait, a retry): nothing
  r = await R.notifyAfterTurn(tc(S1), { reply: "Which day works for you?" }); assert.equal(r.skipped, "same_state"); assert.equal(pushes.length, 2);
  // they answer → a new turn re-arms it; the turn ends done → one "finished" push per device
  R.sql.exec("UPDATE sessions SET waiting=NULL WHERE id=?", S1); (await import("../src/notify.js")).notifyReset(R, S1);
  r = await R.notifyAfterTurn(tc(S1), { reply: "Booked **Joe's Plumbing** for Tuesday 9am." });
  assert.equal(r.kind, "finished"); assert.equal(pushes.length, 4);
  assert.equal(pushes[2].payload.title, "Finished: Find a plumber"); assert.match(pushes[2].payload.body, /Booked/); assert.equal(pushes[2].headers.urgency, "normal");
  assert.equal((await R.notifyAfterTurn(tc(S1), { reply: "again" })).skipped, "same_state"); assert.equal(pushes.length, 4);
  // not for: texting turns, scheduled runs, errors, a Stop, a task still working
  for (const [t, res] of [[tc(S2, { viaText: true }), { reply: "x" }], [tc(S2, { kind: "workflow" }), { reply: "x" }], [tc(S2), { reply: "", error: "boom" }], [tc(S2, { abort: "hard" }), { reply: "x" }]])
    assert.equal(await R.notifyAfterTurn(t, res), null);
  assert.equal(pushes.length, 4);
  // a switch off → no push (but the state still counts, so turning it back on doesn't replay old news)
  await api("/notif", { method: "POST", body: { finished: false } });
  r = await R.notifyAfterTurn(tc(S2), { reply: "Here's the itinerary." }); assert.equal(r.skipped, "off"); assert.equal(pushes.length, 4);
  await api("/notif", { method: "POST", body: { finished: true } });
  assert.equal((await R.notifyAfterTurn(tc(S2), { reply: "x" })).skipped, "same_state");
  ok("needs you → one push per device (question wording, task link, urgency high); same state → none; re-armed by a new turn; finished → one; off → none");
}
{
  // Repeated finished turns in one task (the person keeps messaging, helpers keep returning): one finished push until the person opens the task.
  const S3 = "33333333-3333-4333-8333-333333333333"; task(S3, "Microworkers API overview");
  const { notifyReset } = await import("../src/notify.js"); pushes.length = 0;
  let r = await R.notifyAfterTurn(tc(S3), { reply: "Read the docs." }); assert.equal(r.kind, "finished"); assert.equal(pushes.length, 2);
  for (let i = 0; i < 5; i++) {   // five more turns, each started by a new message (notifyReset) and each ending finished
    notifyReset(R, S3);
    r = await R.notifyAfterTurn(tc(S3), { reply: `Answer ${i}` }); assert.equal(r.skipped, "same_state");
  }
  assert.equal(pushes.length, 2);
  // a finished turn the person is watching in the app sends nothing, and does not use up the next one
  const S4 = "44444444-4444-4444-8444-444444444444"; task(S4, "Watched task");
  r = await R.notifyAfterTurn(tc(S4, { subs: new Set([() => {}]) }), { reply: "x" }); assert.equal(r.skipped, "watched"); assert.equal(pushes.length, 2);
  r = await R.notifyAfterTurn(tc(S4), { reply: "y" }); assert.equal(r.kind, "finished"); assert.equal(pushes.length, 4);
  // a task that needed the person and then finished still notifies for each kind
  const S5 = "55555555-5555-4555-8555-555555555555"; task(S5, "Needs then done"); pushes.length = 0;
  dodb.prepare("UPDATE sessions SET waiting='question' WHERE id=?").run(S5);
  await R.notifyAfterTurn(tc(S5), { reply: "Which?" }); notifyReset(R, S5); dodb.prepare("UPDATE sessions SET waiting=NULL WHERE id=?").run(S5);
  await R.notifyAfterTurn(tc(S5), { reply: "done" }); assert.deepEqual(pushes.map((x) => x.payload.kind).filter((_, i) => i % 2 === 0), ["needs", "finished"]);
  // opening the task re-arms finished
  pushes.length = 0; dodb.prepare("UPDATE sessions SET seen_at=? WHERE id=?").run(Date.now() + 5, S3); notifyReset(R, S3);
  r = await R.notifyAfterTurn(tc(S3), { reply: "later" }); assert.equal(r.kind, "finished"); assert.equal(pushes.length, 2);
  ok("repeated finished turns send one push until the task is opened; a watched turn sends none; needs then finished still sends both");
}
{
  // A device the push service says is gone (410) is dropped; the rest still get it.
  pushes.length = 0; pushStatus = 410;
  dodb.prepare("UPDATE sessions SET seen_at=? WHERE id=?").run(Date.now() + 5, S2);   // the person opened the task since its last finished push, so the next one is new
  const r = await notifyTask(R, S2, "finished", { reply: "done" }); assert.equal(r.push.sent, 0); assert.equal(r.push.devices, 2);
  assert.equal(d1.prepare("SELECT COUNT(*) n FROM push_subs WHERE tenant_id='t1'").get().n, 0); pushStatus = 201;
  await api("/notif/sub", { method: "POST", body: { sub: A.sub } });
  // The cap: PUSH_CAP pushes an hour per workspace, then nothing until the hour is up.
  assert.equal(PUSH_CAP, 100);
  d1.prepare("UPDATE notif_prefs SET win_start=?, win_count=? WHERE tenant_id='t1'").run(Date.now(), PUSH_CAP);
  (await import("../src/notify.js")).notifyReset(R, S2);
  assert.deepEqual((await notifyTask(R, S2, "needs", { why: "plan" })).push, { capped: true });
  d1.prepare("UPDATE notif_prefs SET win_start=? WHERE tenant_id='t1'").run(Date.now() - 3601e3);
  (await import("../src/notify.js")).notifyReset(R, S2); pushes.length = 0;
  assert.equal((await notifyTask(R, S2, "needs", { why: "plan" })).push.sent, 1); assert.equal(pushes[0].payload.title, "Ollie has a plan for you to approve");
  ok("a gone device (410) is removed; the hourly cap holds and lifts after the hour");
}

// 4b. Events skipped for the hourly limit (app-events.js): one push per workflow per hour, no text, no task.
{
  pushes.length = 0; texts.length = 0; pushStatus = 201;
  const wf = { id: 7, name: "Save Dana's emails" }, devices = d1.prepare("SELECT COUNT(*) n FROM push_subs WHERE tenant_id='t1'").get().n;
  assert.ok(devices > 0);
  assert.equal(await R.evSkipNotice(wf), true); assert.equal(pushes.length, devices);
  const p = pushes[0].payload; assert.equal(p.kind, "events_skipped"); assert.equal(p.title, "Ollie skipped some events"); assert.equal(p.body, `"Save Dana's emails" runs at most 10 times an hour, so events past that were skipped.`); assert.equal(p.session, undefined);
  assert.equal(await R.evSkipNotice(wf), false, "a second drop in the same hour says nothing"); assert.equal(pushes.length, devices);
  assert.equal(await R.evSkipNotice({ id: 8, name: "Other" }), true, "another workflow has its own notice"); assert.equal(pushes.length, 2 * devices);
  R.sql.exec("UPDATE event_notice SET at=at-3601000 WHERE workflow_id=7");
  assert.equal(await R.evSkipNotice(wf), true, "an hour later it tells again"); assert.equal(pushes.length, 3 * devices);
  assert.equal(texts.length, 0, "never a text");
  await api("/notif", { method: "POST", body: { needs: false } }); R.sql.exec("UPDATE event_notice SET at=0");
  pushes.length = 0; await R.evSkipNotice(wf); assert.equal(pushes.length, 0, "off with the \"needs you\" switch"); await api("/notif", { method: "POST", body: { needs: true } });
  ok("events skipped for the hourly limit: one push per workflow per hour, no text, follows the needs-you switch");
}

// (the by-text group of the private test is not here: texting is a licensed feature and is off in a public install)

// (the Report an issue group of the private test is not here: the public reports page is its own)

// 7. The service worker.
{
  for (const host of ["app.example.test", "ck1.example.test"]) {
    const r = await worker.fetch(new Request(`https://${host}/w/ck1/sw.js`), env, { waitUntil() {} });
    assert.equal(r.status, 200); assert.match(r.headers.get("content-type"), /javascript/);
    const js = await r.text(); assert.match(js, /addEventListener\("push"/); assert.match(js, /addEventListener\("notificationclick"/); assert.doesNotMatch(js, /addEventListener\("fetch"/);
    assert.match(js, /visibilityState === "visible"/); assert.doesNotMatch(js, /focused === true/); assert.doesNotMatch(js, /"where"/);
  }
  ok("service worker served at /w/<slug>/sw.js without a cookie: push + notificationclick, no fetch handler");
  // The quiet rule (swQuiet): only a task event (finished or needs), and only when some app window is visible, on any screen or task.
  const W = (url, v = "visible", f = true) => ({ url: `https://app.example.test/w/ck1/app${url}`, visibilityState: v, focused: f });
  const ev = { kind: "finished", session: "42", url: "https://app.example.test/w/ck1/app#/main/s/42", tag: "task-42" };
  assert.equal(swQuiet([W("#/main/s/42")], ev), true);                                    // looking right at it
  assert.equal(swQuiet([W("#/main/s/7")], ev), true);                                     // another task on screen
  assert.equal(swQuiet([W("#/main")], ev), true); assert.equal(swQuiet([W("")], ev), true);   // any other screen
  assert.equal(swQuiet([W("#/main/s/42", "visible", false)], ev), true);                  // focused is not used (unreliable on Android PWAs)
  assert.equal(swQuiet([W("#/main/s/42", "visible", undefined)], { kind: "needs" }), true);   // a needs push with no task id
  assert.equal(swQuiet([W("#/main/s/42", "hidden", false)], ev), false);                  // app open only in a background tab
  assert.equal(swQuiet([W("#/main/s/42")], { kind: "test", test: true, url: "https://app.example.test/w/ck1/app#/main/s/42" }), false);   // a test: never quiet
  assert.equal(swQuiet([W("#/main/s/42")], { kind: "events_skipped" }), false);           // not a task event
  assert.equal(swQuiet([], ev), false); assert.equal(swQuiet(null, ev), false); assert.equal(swQuiet([W("")], null), false);
  assert.equal(swQuiet([W("#/main/s/7", "hidden", false), W("#/ops/s/42")], ev), true);   // any visible window
  ok("swQuiet: quiet for finished and needs while any app window is visible; tests, hidden windows and no window always notify");

  // The real service worker script, run against a fake worker scope: what it shows, what it records, what it tells the app.
  const runSw = async (wins, payload, { showFails = false, session = "in" } = {}) => {
    const shown = [], posted = [], logs = [], store = new Map(), handlers = {}, closed = [], unsubs = [], checks = [];
    const reg = { scope: "https://app.example.test/w/ck1/", showNotification: async (title, o) => { if (showFails) throw new Error("boom"); shown.push({ title, ...o, close() { closed.push(o.tag); } }); }, getNotifications: async ({ tag }) => shown.filter((n) => n.tag === tag), pushManager: { getSubscription: async () => ({ unsubscribe: async () => { unsubs.push(1); return true; } }) } };
    const clients = wins.map((w) => ({ ...w, postMessage: (m) => { posted.push(m); } }));
    const self = { registration: reg, clients: { matchAll: async () => clients, claim: async () => {} }, addEventListener: (k, f) => { handlers[k] = f; }, Notification: { permission: "granted" } };
    const caches = { open: async () => ({ put: async (k, r) => store.set(k, await r.json()) }) };
    const fetch = async (u, o) => {
      if (/\/api\/notif\/session$/.test(u)) { checks.push({ u, o }); if (session === "net") throw new Error("offline");
        return session === "in" ? new Response(JSON.stringify({ ok: true }), { status: 200 }) : session === "401" ? new Response("{}", { status: 401 }) : session === "redirect" ? new Response(null, { status: 302, headers: { location: "/onboard" } })
          : session === "html" ? new Response("<html>sign in</html>", { status: 200 }) : session === "500" ? new Response("x", { status: 500 }) : new Response("{}", { status: 404 }); }
      logs.push({ u, b: JSON.parse(o.body) }); return new Response(null, { status: 204 }); };
    new Function("self", "caches", "fetch", "Notification", "Response", SW_JS)(self, caches, fetch, self.Notification, Response);
    let wait; handlers.push({ data: payload === null ? { json: () => { throw new Error("bad"); }, text: () => "?" } : { json: () => payload }, waitUntil: (p) => { wait = p; } });
    await wait; return { shown, posted, logs, closed, unsubs, checks, rec: store.get("https://app.example.test/w/ck1/nf-last") };
  };
  const test1 = await runSw([W("#/main/s/42")], { kind: "test", test: true, title: "Notifications are on", body: "hi", tag: "test-1" });
  assert.equal(test1.shown.length, 1); assert.match(test1.shown[0].tag, /^test-\d+$/); assert.equal(test1.shown[0].renotify, false);
  assert.equal(test1.rec.shown, true); assert.equal(test1.rec.test, true); assert.equal(test1.rec.listed, true); assert.equal(test1.rec.perm, "granted");
  assert.ok(test1.posted.some((m) => m.t === "pushed" && m.rec.shown)); assert.equal(test1.logs.length, 1); assert.match(test1.logs[0].u, /\/w\/ck1\/api\/clientlog$/);
  const test2 = await runSw([W("#/main/s/42")], { kind: "test", test: true, title: "x", tag: "test-1" });
  await new Promise((z) => setTimeout(z, 3)); const test3 = await runSw([], { kind: "test", test: true, title: "x" });
  assert.notEqual(test2.shown[0].tag, test3.shown[0].tag);   // repeats never share a tag
  const onIt = await runSw([W("#/main/s/42")], ev);
  assert.equal(onIt.shown.length, 0); assert.equal(onIt.rec.quiet, true); assert.ok(onIt.posted.some((m) => m.t === "push" && m.d.kind === "finished")); assert.equal(onIt.logs.length, 0);
  const bg = await runSw([W("#/main/s/42", "hidden", false)], ev);
  assert.equal(bg.shown.length, 1); assert.equal(bg.shown[0].tag, "task-42"); assert.equal(bg.shown[0].renotify, true); assert.equal(bg.rec.quiet, false);
  const other = await runSw([W("#/main/s/7")], ev);
  assert.equal(other.shown.length, 0); assert.equal(other.rec.quiet, true); assert.ok(other.posted.some((m) => m.t === "push" && m.d.session === "42"));   // another task on screen: quiet too
  assert.equal((await runSw([W("#/main/s/42", "visible", false)], ev)).shown.length, 0);               // focused false (Android PWA): still quiet
  assert.equal((await runSw([W("#/main/s/42", "visible", false)], { ...ev, kind: "needs" })).shown.length, 0);
  assert.equal((await runSw([W("#/main/s/42", "visible", false)], { kind: "events_skipped", title: "x" })).shown.length, 1);
  const bad = await runSw([], null); assert.equal(bad.shown.length, 1); assert.match(bad.rec.err, /unreadable payload/); assert.equal(bad.logs.length, 1);
  const fail = await runSw([], ev, { showFails: true }); assert.equal(fail.rec.shown, false); assert.match(fail.rec.err, /show failed: boom/); assert.equal(fail.logs.length, 1);
  ok("service worker: a test shows even with the app focused (own tag each time), a task push stays quiet while any app window is visible (app chimes), a hidden window or no window notifies; every push recorded; errors logged");
  // Signed out of this workspace in this browser: nothing is shown for good (a notification is posted and closed at once, because Chrome
  // insists on one), the browser's push sign-up is cancelled, and the push is not passed to the app.
  for (const mode of ["401", "redirect", "html", "404"]) {
    const g = await runSw([W("#/main/s/42", "hidden", false)], ev, { session: mode });
    assert.equal(g.rec.dropped, true, mode); assert.equal(g.unsubs.length, 1, mode); assert.equal(g.rec.shown, false, mode);
    assert.deepEqual(g.shown.map((n) => n.tag), ["signed-out"], mode); assert.deepEqual(g.closed, ["signed-out"], mode); assert.equal(g.shown[0].silent, true);
    assert.equal(g.shown[0].body, "", mode); assert.ok(!g.posted.some((m) => m.t === "push"), mode);
  }
  // A bad moment proves nothing: offline or a server error still shows the real notification, and the sign-up stays.
  for (const mode of ["net", "500"]) { const g = await runSw([W("#/main/s/42", "hidden", false)], ev, { session: mode }); assert.equal(g.unsubs.length, 0, mode); assert.equal(g.rec.shown, true, mode); assert.equal(g.shown[0].tag, "task-42", mode); }
  const chk = await runSw([], ev); assert.match(chk.checks[0].u, /\/w\/ck1\/api\/notif\/session$/); assert.equal(chk.checks[0].o.credentials, "same-origin"); assert.equal(chk.unsubs.length, 0); assert.equal(chk.rec.dropped, false);
  ok("service worker: a push for a workspace this browser has no session for is dropped and the sign-up cancelled; network errors and 5xx still notify");
}
// 8. Wiring: every finished turn reaches notifyAfterTurn; a new chat turn re-arms the task; the question text moved here from ask-first.
{
  const run = src.slice(src.indexOf("  async runTurn("), src.indexOf("  async notifyAfterTurn("));
  assert.match(run, /this\.ctx\.waitUntil\?\.\(this\.notifyAfterTurn\(tc, r\)/); assert.match(run, /notifyReset\(this, session\)/);
  assert.doesNotMatch(readFileSync(new URL("../src/ask-first.js", import.meta.url), "utf8"), /deliverText/);
  ok("runTurn → notifyAfterTurn after every turn; a chat turn re-arms; ask-first no longer texts on its own (no duplicate)");
}
console.log("notify: all ok");
process.exit(0);
