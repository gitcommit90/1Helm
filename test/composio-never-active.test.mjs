// node --import ./test/stubs/register.mjs test/composio-never-active.test.mjs
// 1. an EXPIRED account whose sign-in was never opened or never finished is not listed and is deleted; a revoked one still shows "expired".
// 2. an account that an app answered with a quota error is listed "limited", and the helper's status line says so.
import assert from "node:assert/strict";
import { listManagedConnections, noteLimit } from "../src/ee/composio.js";
import { statusFor } from "../src/ee/connect-offer.js";
const store = new Map();
globalThis.caches = { default: { match: async (r) => store.get(r.url), put: async (r, v) => { store.set(r.url, v); } } };
const mk = (id, status, status_reason) => ({ id, user_id: "1hc:t1", toolkit: { slug: "facebook" }, status, status_reason, created_at: "2026-10-01T00:00:00Z", state: { val: {} } });
let items = [mk("ca_never", "EXPIRED", "Connection expired before authorization was started"), mk("ca_half", "EXPIRED", "Authorization was started but not completed within 10 minutes"),
  mk("ca_revoked", "EXPIRED", "invalid_grant"), mk("ca_ok", "ACTIVE", "")];
const deleted = [];
globalThis.fetch = async (url, init = {}) => {
  const p = new URL(url).pathname, m = init.method || "GET";
  if (m === "DELETE") { deleted.push(p.split("/").pop()); return new Response("{}", { status: 200 }); }
  if (p.endsWith("/connected_accounts")) return new Response(JSON.stringify({ items }), { status: 200 });
  return new Response(JSON.stringify({ name: "Facebook" }), { status: 200 });
};
const env = { COMPOSIO_KEY: "k" };
let rows = await listManagedConnections(env, "t1", { names: false });
assert.deepEqual(rows.map((r) => [r.id, r.status]).sort(), [["ca_ok", "connected"], ["ca_revoked", "expired"]]);
assert.deepEqual(deleted.sort(), ["ca_half", "ca_never"]);
assert.equal(rows.some((r) => r.limited), false);
await noteLimit("t1", "ca_ok", new Error("error 403: The request cannot be completed because you have exceeded your quota."));
await noteLimit("t1", "ca_revoked", new Error("some other error"));
rows = await listManagedConnections(env, "t1", { names: false });
assert.deepEqual(rows.filter((r) => r.limited).map((r) => r.id), ["ca_ok"]);
assert.equal(statusFor("facebook", rows).limited, true);
console.log("composio-never-active ok");
