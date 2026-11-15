// Owner-only JSON routes still need streaming limits: a false Content-Length
// must not make them buffer an arbitrarily large request before database work.
import assert from "node:assert/strict";
import { boundedJson, BodyTooLargeError } from "../src/bounded-body.js";
import { accountRoute } from "../src/account.js";
import { shareApi } from "../src/share.js";
import { deletionRoute } from "../src/deletion.js";
import { permsApi } from "../src/perms.js";

const url = new URL("https://owner.example.com/w/owner/api/account/name");
const body = "x".repeat(70_000);
const request = (path) => new Request(new URL(path, url), { method: "POST", headers: {
  "content-type": "application/json", "content-length": "1", origin: url.origin,
}, body });
let queries = 0;
const env = { APP_HOST: url.host, DB: { prepare() { queries++; throw new Error("oversized body reached database"); } } };
const tenant = { id: "tenant", slug: "owner" }, user = { id: "user", email: "owner@example.com" };
const cases = [
  ["account", accountRoute(request("/w/owner/api/account/name"), env, tenant, user, url, "/api/account/name")],
  ["sharing", shareApi(request("/w/owner/api/share/links"), env, tenant, "/api/share/links", { mode: "full" })],
  ["deletion", deletionRoute(request("/w/owner/api/account/delete"), env, tenant, url, "/api/account/delete")],
  ["permissions", permsApi(request("/w/owner/api/permissions"), env, tenant, { channels: async () => [] })],
];
for (const [name, promise] of cases) {
  const response = await promise;
  assert.equal(response.status, 413, `${name} rejects an oversized stream`);
  assert.equal((await response.json()).error, "too_large");
}
assert.equal(queries, 0);
assert.deepEqual(await boundedJson(new Request(url, { method: "POST", body: '{"name":"Ada"}' }), 8192), { name: "Ada" });
assert.deepEqual(await boundedJson(new Request(url, { method: "POST", body: "null" }), 8192), {});
await assert.rejects(boundedJson(new Request(url, { method: "POST", headers: { "content-length": "1" }, body: "x".repeat(8_000_001) })), BodyTooLargeError);
console.log("ok - small owner JSON routes reject oversized streams before database work");
