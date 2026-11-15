import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { b64u, sendPush, vapidKeys } from "../src/webpush.js";
import { okEndpoint } from "../src/notify.js";

const keys = await vapidKeys();
const device = await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const endpoint = "https://fcm.googleapis.com/fcm/send/fixture";
const sub = { endpoint, p256dh: b64u(await webcrypto.subtle.exportKey("raw", device.publicKey)), auth: b64u(webcrypto.getRandomValues(new Uint8Array(16))) };
const env = { ...{ VAPID_PUBLIC: keys.publicKey, VAPID_PRIVATE: keys.privateKey }, EMAIL_FROM: "owner@example.com" };
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), redirect: init.redirect, authorization: init.headers?.authorization });
  return new Response(null, { status: 307, headers: { location: "https://evil.example/collect" } });
};

for (const bad of ["https://evil.example/collect", "http://fcm.googleapis.com/fcm/send/fixture", "https://user:password@fcm.googleapis.com/fcm/send/fixture"]) {
  assert.equal(okEndpoint(bad), false, `registration must refuse ${bad}`);
  const result = await sendPush(env, { ...sub, endpoint: bad }, { title: "private task" });
  assert.equal(result.ok, false);
  assert.equal(result.gone, true, "an invalid saved endpoint should be removed from subscriptions");
  assert.equal(calls.length, 0, "a saved invalid endpoint must be refused before any fetch");
}

const result = await sendPush(env, sub, { title: "private task" });
assert.equal(result.ok, false);
assert.equal(result.status, 307, "a push-service redirect is a failed send");
assert.deepEqual(calls.map((x) => x.url), [endpoint]);
assert.equal(calls[0].redirect, "manual", "the runtime must not follow the redirect with push headers and payload");
assert.match(calls[0].authorization, /^vapid t=/);
console.log("ok - Web Push validates saved endpoints at send time and never follows a push-service redirect");
