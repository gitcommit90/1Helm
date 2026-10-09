// A report may include a screenshot, so the whole JSON body needs a real byte
// limit even when a client supplies a false Content-Length.
import assert from "node:assert/strict";
import { reportApi, MAX_BODY } from "../src/reports.js";

let queries = 0;
const env = { DB: { prepare() { queries++; return {
  bind() { return this; },
  async first() { return { n: 0 }; },
  async run() { return { success: true }; },
}; } } };
const tenant = { id: "tenant", slug: "owner" }, user = { email: "owner@example.com" };
const url = "https://owner.example.com/w/owner/api/report";
const post = (body, headers = {}) => new Request(url, { method: "POST", body, headers });

const oversized = await reportApi(post("x".repeat(MAX_BODY + 1), { "content-length": "1" }), env, tenant, user, "test");
assert.equal(oversized.status, 413);
assert.equal(queries, 0, "oversized body stops before database work");
const malformed = await reportApi(post("{broken"), env, tenant, user, "test");
assert.equal(malformed.status, 400);
assert.equal(queries, 0);
const normal = await reportApi(post(JSON.stringify({ text: "Something happened" })), env, tenant, user, "test");
assert.equal(normal.status, 200);
assert.equal((await normal.json()).ok, true);
assert.equal(queries, 2);
console.log("ok - issue report JSON stops at the streaming byte limit");
