import assert from "node:assert/strict";
import { serveLink, tokenHash } from "../src/share.js";

const token = "A".repeat(43), tenant = { id: "owner-a" };
const link = { id: "link-1", tenant_id: tenant.id, channel: "main", file_id: "file-1",
  token_hash: await tokenHash(token), r2key: "t/owner-a/files/main/old", name: "old.txt", mime: "text/plain", bytes: 3, expires_at: null };
let file = null;
const reads = [];
const objects = new Map([[link.r2key, "old"], ["t/owner-a/files/main/new", "new"]]);
const env = {
  DB: { prepare(q) { assert.match(q, /^SELECT \* FROM share_links/); return { bind(hash) {
    assert.equal(hash, link.token_hash); return { first: async () => link };
  } }; } },
  RESIDENT: { idFromName: (name) => name, get(name) {
    assert.equal(name, "res:owner-a:main"); return { fileRow: async (id) => { assert.equal(id, link.file_id); return file; } };
  } },
  WS: { async get(key) { reads.push(key); const value = objects.get(key); return value == null ? null : {
    size: value.length, httpEtag: '"test"', body: new Response(value).body,
  }; } },
};
const request = () => new Request(`https://example.com/s/owner/f/${token}/old.txt`);

assert.equal((await serveLink(request(), env, tenant, token)).status, 404,
  "a stale D1 link must not serve a deleted Library file");
assert.deepEqual(reads, [], "deleted files must stop before R2");

file = { id: link.file_id, r2key: "t/another-owner/files/main/foreign", name: "foreign.txt", mime: "text/plain", bytes: 7 };
assert.equal((await serveLink(request(), env, tenant, token)).status, 404, "a foreign R2 key is not a current file");
assert.deepEqual(reads, [], "foreign keys must stop before R2");

file = { id: link.file_id, r2key: "t/owner-a/files/main/new", name: "new.txt", mime: "text/plain", bytes: 3 };
const updated = await serveLink(request(), env, tenant, token);
assert.equal(updated.status, 200);
assert.equal(await updated.text(), "new", "an in-place update must serve current bytes even if the D1 link row is stale");
assert.deepEqual(reads, [file.r2key], "the stale R2 key must never be read");
assert.match(updated.headers.get("content-disposition"), /new\.txt/);
console.log("ok - public links check the current Library row before serving bytes");
