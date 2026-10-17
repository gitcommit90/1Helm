import assert from "node:assert/strict";
import { loadByok } from "../src/byok.js";
import { Resident } from "../src/resident.js";

const row = { plan: "plus", slug: "owner", helper_name: "Helper", base_url: null, model: null, fast_model: null, key_sealed: null, key_last4: null, mode: "" };
const DB = { prepare: () => ({ bind: () => ({ first: async () => row }) }) };
assert.deepEqual(await loadByok({ DB, APP_HOST: "example.workers.dev" }, "owner-id"), { missing: true, settings: "https://example.workers.dev/w/owner/app?settings=byok" });
assert.equal(await loadByok({ DB, ONEHELM_EE: "1hc" }, "owner-id"), null);
await assert.rejects(Resident.prototype.callModelOnce.call({ env: {} }, [], () => {}, null, true, null), /Set up your own AI key/);
