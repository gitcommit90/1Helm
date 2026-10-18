// node --import ./test/stubs/register.mjs test/hs-meter.test.mjs
// The Hindsight meter in src/byok.js, re-measured 2026-10-14 (the design notes). Pins the constants and the shape of
// hsRetainNano, hsRetainBatchNano and hsRecallNano, so a change to a price is a deliberate edit of this file too.
import assert from "node:assert/strict";
import { METER, hsRetainNano, hsRetainBatchNano, hsRecallNano, hsRawNano, HS_RECALL_TIERS, HS_CHUNK_CHARS, HS_REFRESH_WINDOW_MS, BYOK_MARKUP } from "../src/byok.js";

const COLD = 327_000, WARM = 126_000, CHAR = 65, WCHAR = 58, CONS = 292_000, REFRESH = 1_001_000;
assert.equal(METER.hs_retain_char, CHAR); assert.equal(METER.hs_retain_call, COLD); assert.equal(METER.hs_retain_char_warm, WCHAR); assert.equal(METER.hs_retain_call_warm, WARM);
assert.equal(METER.hs_consolidate_call, CONS); assert.equal(METER.hs_refresh_run, REFRESH); assert.equal(METER.hs_recall, 480_000);
assert.equal(HS_CHUNK_CHARS, 3000); assert.equal(HS_REFRESH_WINDOW_MS, 43200e3);   // = the 12 hours between the templates' two daily cron refreshes (test/hs-refresh-window.test.mjs)

// nothing extracted, nothing charged (not even a refresh)
for (const n of [0, -5, NaN, undefined, null, "x"]) assert.equal(hsRetainNano(n, 3), 0, `chars=${n}`);
assert.equal(hsRetainBatchNano([], 3), 0); assert.equal(hsRetainBatchNano([0, 0], 3), 0);
// one item sent alone: a cold extraction call, its characters, one consolidation call
assert.equal(hsRetainNano(1), COLD + CHAR + CONS);
assert.equal(hsRetainNano(1100), COLD + 1100 * CHAR + CONS);
assert.equal(hsRetainNano(3000), COLD + 3000 * CHAR + CONS);
// refresh runs are added per model, only when the caller says a window opens
assert.equal(hsRetainNano(1100, 3), COLD + 1100 * CHAR + CONS + 3 * REFRESH); assert.equal(hsRetainNano(1100, 2), COLD + 1100 * CHAR + CONS + 2 * REFRESH);
// a second chunk is a cached call
assert.equal(hsRetainNano(3001), COLD + WARM + 3001 * CHAR + CONS);
assert.equal(hsRetainNano(9000), COLD + 2 * WARM + 9000 * CHAR + CONS);
// a send of several items: the first call is cold and the rest cached, the characters of later items at the cached rate, and consolidation
// at 8 facts per call, 1.31 facts per extraction call
assert.equal(hsRetainBatchNano([1100, 400, 0, 3500]), COLD + 1100 * CHAR + 400 * WCHAR + 3500 * WCHAR + 3 * WARM + Math.ceil(4 * 1.31 / 8) * CONS);
// 20 items of 1,300 characters (a backfill send): 20 calls, 27 facts, 4 consolidation calls
assert.equal(hsRetainBatchNano(Array(20).fill(1300)), COLD + 19 * WARM + 1300 * CHAR + 19 * 1300 * WCHAR + 4 * CONS);
// the rebuild of the measured dev bank (2026-10-14 03:00: 861 calls, 1.30M characters, 43 sends of 20) is close to its measured cost, $0.23 to $0.25
{ const sends = 43, per = 20, chars = 1_300_000 / 861; let total = 0; for (let i = 0; i < sends; i++) total += hsRetainBatchNano(Array(per).fill(chars), i === 0 ? 3 : 0); total = (total / 1e9) * (861 / 860);
  assert.ok(total > 0.2 && total < 0.3, `rebuild ${total}`); }
// never cheaper for more text
let prev = 0; for (let n = 1; n <= 12_000; n += 37) { const c = hsRetainNano(n); assert.ok(c > prev, `monotonic at ${n}`); prev = c; }
// a typical saved turn (about 1,100 characters) with the 15% markup, inside a refresh window, is under a quarter of a cent and far above the old 120 nano per character
const turn = Math.ceil(hsRetainNano(1100) * BYOK_MARKUP); assert.ok(turn > 1100 * 120 * BYOK_MARKUP && turn < 2_500_000, String(turn));

// recall: priced by the bank's node count in four tiers, the top tier for a bank of unknown size
assert.deepEqual(HS_RECALL_TIERS.map((t) => t[1]), [33_000, 170_000, 312_000, 480_000]);
for (const [n, p] of [[0, 33_000], [25, 33_000], [26, 170_000], [100, 170_000], [101, 312_000], [250, 312_000], [251, 480_000], [300, 480_000], [100_000, 480_000]]) assert.equal(hsRecallNano(n), p, `nodes=${n}`);
for (const n of [null, undefined, "", NaN, -1, "x", Infinity]) assert.equal(hsRecallNano(n), METER.hs_recall, `unknown ${n}`);
let last = 0; for (let n = 0; n <= 400; n++) { const p = hsRecallNano(n); assert.ok(p >= last, `tiers never fall at ${n}`); last = p; }
console.log("ok: hs meter constants, hsRetainNano, hsRetainBatchNano and hsRecallNano shape");

// A Bee recording kept as raw chunks (chunks mode): no extraction call, so the price is its characters times METER.hs_raw_char, and nothing for no text.
for (const n of [0, -5, NaN, undefined, "x"]) assert.equal(hsRawNano(n), 0, `raw chars=${n}`);
assert.equal(hsRawNano(1), METER.hs_raw_char); assert.equal(hsRawNano(1000), 1000 * METER.hs_raw_char); assert.equal(METER.hs_raw_char, 83);
console.log("hs-meter: raw copy ok");
