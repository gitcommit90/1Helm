import assert from "node:assert/strict";
import { linkFetch } from "../src/channel-computer.js";

let manifest = 0, draining = 0;
let layerKeys = 0, roomChecks = 0;
const computer = {
  manifestText: async () => { manifest++; return "layer manifest\n"; },
  markDraining: async () => { draining++; return { ok: true }; },
  savePlan: async () => "delta",
  newLayerKey: async () => { layerKeys++; return "t/owner/c/main/layer.sqsh"; },
  saveRoom: async () => { roomChecks++; return { ok: false, error: "full" }; },
};
const env = { CHANNEL_COMPUTER: { idFromString: (id) => id, get: () => computer } };
const go = (path, init = {}) => linkFetch(env, "channel-one", new Request(`http://computer.internal${path}`, init));

for (const headers of [{ origin: "https://untrusted.example" }, { origin: "null" }, { "sec-fetch-mode": "navigate" }, { "sec-fetch-site": "cross-site" }]) {
  assert.equal((await go("/manifest", { headers })).status, 403);
  assert.equal((await go("/draining", { method: "POST", headers })).status, 403);
}
assert.equal(manifest, 0); assert.equal(draining, 0, "browser requests never reached the controller");
assert.equal((await go("/manifest", { method: "POST" })).status, 405);
assert.equal((await go("/save-plan?session=x", { method: "POST" })).status, 405);
assert.equal((await go("/draining")).status, 405);
assert.equal(manifest, 0); assert.equal(draining, 0, "wrong methods had no effect");
assert.equal((await (await go("/manifest")).text()), "layer manifest\n");
assert.equal((await (await go("/save-plan?session=x")).text()), "delta");
assert.equal((await go("/draining", { method: "POST" })).status, 200);
assert.equal(manifest, 1); assert.equal(draining, 1, "the curl-style init/save requests still work");
const putLayer = (headers) => go("/save", { method: "PUT", headers, body: "data" });
const valid = { "content-length": "4", "x-kind": "delta", "x-sha256": "a".repeat(64) };
for (const [headers, status] of [
  [{ ...valid, "content-length": undefined }, 411],
  [{ ...valid, "content-length": "-1" }, 400],
  [{ ...valid, "content-length": "0" }, 400],
  [{ ...valid, "content-length": "1.5" }, 400],
  [{ ...valid, "content-length": "9007199254740992" }, 400],
  [{ ...valid, "x-kind": "unknown" }, 400],
  [{ ...valid, "x-sha256": "bad" }, 400],
]) {
  const h = Object.fromEntries(Object.entries(headers).filter(([, v]) => v !== undefined));
  assert.equal((await putLayer(h)).status, status);
  assert.equal(layerKeys, 0, "invalid layer upload must not allocate a key");
  assert.equal(roomChecks, 0, "invalid layer upload must not reach the quota check");
}
assert.equal((await putLayer(valid)).status, 507, "a valid layer request still reaches the quota check");
assert.equal(layerKeys, 1); assert.equal(roomChecks, 1);
console.log("ok - browser requests cannot call the computer's internal controller");
