// node --import ./test/stubs/register.mjs test/hs-meter.test.mjs
// The memory meter in src/byok.js: a cold call then warm calls, one call per EXTRACT_CHARS characters, nothing for empty items, never cheaper for more text.
import assert from "node:assert/strict";
import { METER, hsRetainNano, hsRetainBatchNano, hsRecallNano, hsRawNano } from "../src/byok.js";
import { EXTRACT_CHARS } from "../src/mem0-store.js";

const COLD = METER.mem_extract_call, WARM = METER.mem_extract_call_warm, CHAR = METER.mem_extract_char;
assert.equal(EXTRACT_CHARS, 12000);
for (const n of [0, -5, NaN, undefined, null, "x"]) assert.equal(hsRetainNano(n), 0, `chars=${n}`);
assert.equal(hsRetainBatchNano([]), 0); assert.equal(hsRetainBatchNano([0, 0]), 0);
assert.equal(hsRetainNano(1100), COLD + 1100 * CHAR);
assert.equal(hsRetainNano(EXTRACT_CHARS), COLD + EXTRACT_CHARS * CHAR);
assert.equal(hsRetainNano(EXTRACT_CHARS + 1), COLD + WARM + (EXTRACT_CHARS + 1) * CHAR);
assert.equal(hsRetainNano(3 * EXTRACT_CHARS), COLD + 2 * WARM + 3 * EXTRACT_CHARS * CHAR);
// a send of several items: only the first call is cold, empty items add nothing
assert.equal(hsRetainBatchNano([1100, 0, 400, 2 * EXTRACT_CHARS]), COLD + 3 * WARM + (1100 + 400 + 2 * EXTRACT_CHARS) * CHAR);
let prev = 0; for (let n = 1; n <= 40_000; n += 97) { const c = hsRetainNano(n); assert.ok(c > prev, `monotonic at ${n}`); prev = c; }
// raw chunks have no extraction call, and a search is one constant price
for (const n of [0, -5, NaN, undefined, "x"]) assert.equal(hsRawNano(n), 0);
assert.equal(hsRawNano(1000), 1000 * METER.mem_raw_char);
assert.equal(hsRecallNano(), METER.mem_search);
console.log("ok: memory meter");
