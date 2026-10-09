import assert from "node:assert/strict";
import { fullMessage, fullToolNote, noticeOf, storageOf, storageView, GB } from "../src/storage.js";

const DB = { prepare(query) { return {
  bind() { return this; },
  all: async () => ({ results: [{ kind: "files", bytes: 85 * GB }] }),
  first: async () => query.includes("storage_plan") ? { blocks: 7, counted_at: Date.now(), notice_seen: 0 } : null,
}; } };
const tenant = { id: "owner", plan: "plus" };
const basic = await storageOf({ DB }, tenant);
assert.equal(basic.limit, 100 * GB);
assert.equal(basic.blocks, 0);
assert.equal(noticeOf(basic)?.level, 80);
assert.doesNotMatch(noticeOf(basic)?.text || "", /\$|buy|add storage|plan/i);
const view = storageView(basic);
assert.deepEqual(Object.keys(view).sort(), ["by", "counted_at", "full", "labels", "limit", "limit_text", "notice", "pct", "used", "used_text"].sort());

const raised = await storageOf({ DB, SELFHOST_STORAGE_GB: "500" }, tenant);
assert.equal(raised.limit, 500 * GB);
assert.equal(noticeOf(raised), null);
const full = { ...basic, used: 100 * GB, full: true, pct: 100 };
assert.match(fullMessage(full), /server's storage limit/);
assert.match(fullToolNote(full), /server's storage limit/);
assert.doesNotMatch(fullMessage(full), /Add storage|\$|plan/);
