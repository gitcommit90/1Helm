// node --import ./test/stubs/register.mjs test/native-push.test.mjs
// Phone-app notifications through the push relay (src/native-push.js, src/notify.js): the relay is faked at fetch. Checks:
//   1. /api/notif/app signs a phone up: the relay installation is created once, the device goes to the relay under the workspace's
//      recipient, and push_subs gets a "native:" row (counted, this_device by its endpoint); bad tokens and a missing relay are refused;
//   2. pushAll sends one relay delivery for all of a workspace's phones, next to Web Push, and the test button reaches a phone;
//   3. /api/notif/app/off removes it from the relay and from push_subs; another workspace's phones are never addressed.
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
import { notifApi, pushAll } from "../src/notify.js";
import { recipientFor, _resetRelay, nativeReady } from "../src/ee/native-push.js";
const ok = (n) => console.log("  ok", n);

const d1 = new DatabaseSync(":memory:");
d1.exec(readFileSync(new URL("../db/migrations/0018_027_notif_reports.sql", import.meta.url), "utf8"));
d1.exec("CREATE TABLE IF NOT EXISTS texting (tenant_id TEXT PRIMARY KEY, status TEXT)");
const DB = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => { const r = st.run(...a); return { meta: { changes: r.changes } }; } }; return o; } };
const calls = [];
let deliveryReply = { delivered: 1, devices: 1 };
globalThis.fetch = async (url, init = {}) => {
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ url: String(url), method: init.method, auth: init.headers?.authorization || "", body });
  if (String(url).endsWith("/deliveries")) return new Response(JSON.stringify(deliveryReply), { status: 200 });
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
const SECRET = "s".repeat(40), ID = "0123456789abcdef";
const env = { ONEHELM_EE: "1hc", DB, PUSH_RELAY: `${ID}:${SECRET}`, APP_HOST: "app.example.test" };
const t1 = { id: "t1", slug: "ck1", helper_name: "Ollie" }, t2 = { id: "t2", slug: "ck2", helper_name: "Skipper" };
const api = async (e, t, sub, body, q = "") => {
  const req = new Request(`https://app.example.test/w/${t.slug}${sub}${q}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const r = await notifApi(req, e, t, sub, new URL(req.url)); return { status: r.status, body: await r.json() };
};
const TOKEN = "f".repeat(64), FCM = "dGVzdA:APA91b" + "x".repeat(140);

// 1. sign-up
assert.equal((await api(env, t1, "/api/notif/app", { platform: "ios", token: "short" })).status, 400);
assert.equal((await api(env, t1, "/api/notif/app", { platform: "web", token: TOKEN })).status, 400);
assert.equal((await api({ DB }, t1, "/api/notif/app", { platform: "ios", token: TOKEN })).status, 503);
assert.equal(calls.length, 0, "nothing reaches the relay for refused sign-ups");
_resetRelay();
const a = await api(env, t1, "/api/notif/app", { platform: "ios", token: TOKEN, label: "iPhone app" });
assert.equal(a.status, 200); assert.match(a.body.endpoint, /^native:ios:[a-f0-9]{32}$/);
assert.equal(calls[0].url, "https://provision.1helm.com/v1/push/installations"); assert.deepEqual(calls[0].body, { installation_id: ID, management_secret: SECRET });
assert.equal(calls[1].url, "https://provision.1helm.com/v1/push/devices"); assert.equal(calls[1].method, "POST"); assert.equal(calls[1].auth, `Bearer ${SECRET}`);
assert.deepEqual(calls[1].body, { installation_id: ID, recipient_id: await recipientFor("t1"), platform: "ios", token: TOKEN });
await api(env, t1, "/api/notif/app", { platform: "android", token: FCM, label: "Android app" });
assert.equal(calls.filter((c) => c.url.endsWith("/installations")).length, 1, "installation created once per isolate");
const g = await api(env, t1, "/api/notif", undefined, `?endpoint=${encodeURIComponent(a.body.endpoint)}`);
assert.equal(g.body.push.devices, 2); assert.equal(g.body.push.this_device, true); assert.equal(g.body.push.app, true);
ok("sign-up: refused without a valid token or relay; installation once; device under the workspace's recipient; counted, this_device");

// 2. sending: one delivery for all phones of the workspace; Web Push isn't needed for it
calls.length = 0;
const r = await pushAll(env, "t1", { kind: "finished", title: "Finished: trip", body: "Done.", url: "https://app.example.test/w/ck1/app" });
const del = calls.filter((c) => c.url.endsWith("/deliveries"));
assert.equal(del.length, 1); assert.equal(del[0].body.recipient_id, await recipientFor("t1")); assert.equal(del[0].body.title, "Finished: trip"); assert.equal(del[0].body.url, "https://app.example.test/w/ck1/app");
assert.ok(del[0].body.idempotency_key); assert.equal(r.devices, 2); assert.equal(r.sent, 1);
calls.length = 0;
const tr = await api(env, t1, "/api/notif/test", { endpoint: a.body.endpoint });
assert.equal(tr.status, 200); assert.equal(calls.filter((c) => c.url.endsWith("/deliveries")).length, 1);
calls.length = 0; await pushAll(env, "t2", { title: "x" });
assert.equal(calls.length, 0, "a workspace without phones sends nothing to the relay");
deliveryReply = { error: "BadDeviceToken" };
const f = await pushAll(env, "t1", { title: "x" }); assert.equal(f.sent, 0);
deliveryReply = { delivered: 1, devices: 1 };
ok("pushAll: one relay delivery per workspace with the title, body and link; test button reaches the phone; nothing for a workspace without phones");

// 3. off
calls.length = 0;
assert.equal((await api(env, t1, "/api/notif/app/off", { platform: "ios", token: TOKEN })).status, 200);
assert.equal(calls[0].method, "DELETE"); assert.deepEqual(calls[0].body, { installation_id: ID, recipient_id: await recipientFor("t1"), platform: "ios", token: TOKEN });
assert.equal((await api(env, t1, "/api/notif", undefined, `?endpoint=${encodeURIComponent(a.body.endpoint)}`)).body.push.this_device, false);
ok("off: removed from the relay and from this workspace's devices");
// licensed: a public install (no ONEHELM_EE) has no relay, whatever PUSH_RELAY holds, so the phone routes answer as if it were not set up
assert.equal(nativeReady({ ...env, ONEHELM_EE: undefined }), false); assert.equal(nativeReady(env), true);
ok("a public install has no phone relay");
console.log("native-push: all ok");
