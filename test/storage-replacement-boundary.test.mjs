import assert from "node:assert/strict";
import { GB, stPut } from "../src/storage.js";

let oldSize = GB, writes = 0, delta = null, objects = null, bumps = 0;
const DB = { prepare(query) {
  let args = [];
  return {
    bind(...values) { args = values; return this; },
    first: async () => query.includes("FROM tenants") ? { id: "owner", plan: "byok" } : { blocks: 0 },
    all: async () => ({ results: [{ kind: "files", bytes: GB }] }),
    run: async () => { if (query.includes("INSERT INTO storage_usage")) { delta = args[4]; objects = args[5]; bumps++; } return { meta: { changes: 1 } }; },
  };
} };
const WS = {
  head: async () => oldSize == null ? null : { size: oldSize },
  put: async (_key, bytes) => { writes++; return { size: bytes.byteLength }; },
};
const env = { DB, WS, SELFHOST_STORAGE_GB: "1" };
const key = "t/owner/files/versioned";
const replace = (n) => stPut(env, key, new Uint8Array(n), {}, { check: true, replace: true });

await replace(8);
assert.equal(writes, 1, "replacing a large object with a smaller one works at the limit");
assert.equal(delta, 8 - GB, "the storage counter records the net change");
assert.equal(objects, 0, "replacing an object does not add to the object count");

oldSize = 8;
await replace(8);
assert.equal(writes, 2);
assert.equal(bumps, 1, "an equal-size replacement leaves the counter unchanged");

await assert.rejects(replace(9), (e) => e.code === "storage_full");
assert.equal(writes, 2, "a growing replacement cannot exceed the limit");

oldSize = 0;
await replace(0);
assert.equal(bumps, 1, "replacing a zero-byte object does not add to the object count");
assert.equal(writes, 3);

oldSize = null;
await assert.rejects(replace(1), (e) => e.code === "storage_full");
assert.equal(writes, 3, "new bytes cannot be added above the limit");
console.log("ok - replacement storage checks use net growth");
