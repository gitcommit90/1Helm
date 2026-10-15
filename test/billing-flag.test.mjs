// node --import ./test/stubs/register.mjs test/billing-flag.test.mjs
// Daily billing flag (src/billing-flag.js): finds price_unknown events and turns charged over 10x their list-price estimate; changes nothing.
import assert from "node:assert";
import { listPrice, flagTurns, scanBilling, dailyBillingFlag, flagLine } from "../src/ee/billing-flag.js";

const catalog = { "a/cheap": { pricing: { prompt: 0.09, completion: 0.29, input_cache_read: 0.025 } }, "a/dear": { pricing: { prompt: 3, completion: 15 } }, "bad/x": { pricing: { prompt: "x", completion: 1 } } };
assert.deepEqual(listPrice(catalog, "a/cheap [fast/main]"), { in: 90, out: 290, cacheRead: 25 }, "routing suffix is ignored; $/M becomes nano$/token");
assert.equal(listPrice(catalog, "a/dear").cacheRead, null); assert.equal(listPrice(catalog, "bad/x"), null); assert.equal(listPrice(catalog, "nope"), null);

// the dev case: 74,097 in, 1,881 out, charged at the ceiling ($0.2881); the saved price makes the estimate about $0.0092
const ceiling = Math.ceil((74097 * 3000 + 1881 * 15000) * 1.15);
const turn = (o) => ({ id: "t", at: 1, kind: "chat", models: JSON.stringify(["a/cheap"]), in_tok: 74097, cached_tok: 0, out_tok: 1881, charge_nano: ceiling, ...o });
let f = flagTurns([turn({ id: "bad" }), turn({ id: "ok", charge_nano: Math.ceil((74097 * 90 + 1881 * 290) * 1.15) })], catalog);
assert.deepEqual(f.map((x) => x.turn), ["bad"]); assert.ok(f[0].ratio > 25 && f[0].estimate_nano > 0);
// cache reads are priced at the saved cache-read price: a turn that is mostly cached and charged for it is not flagged
const cached = turn({ id: "cached", in_tok: 1e6, cached_tok: 990000, out_tok: 0, charge_nano: Math.ceil((10000 * 90 + 990000 * 25) * 1.15) });
assert.equal(flagTurns([cached], catalog).length, 0);
assert.equal(flagTurns([{ ...cached, id: "x", charge_nano: cached.charge_nano * 11 }], catalog).length, 1, "11x the estimate is flagged");
assert.equal(flagTurns([{ ...cached, charge_nano: cached.charge_nano * 9 }], catalog).length, 0, "9x is not");
// no saved price, a tiny charge, no tokens: skipped, never an error
assert.equal(flagTurns([turn({ models: JSON.stringify(["nope"]) }), turn({ charge_nano: 5e5 }), turn({ in_tok: 0, out_tok: 0 }), turn({ models: "not json" })], catalog).length, 0);
// a mixed turn is estimated at the dearest saved price, so it is not flagged for using a cheaper model too
assert.equal(flagTurns([turn({ models: JSON.stringify(["a/cheap", "a/dear"]), charge_nano: Math.ceil((74097 * 3000 + 1881 * 15000) * 1.15) })], catalog).length, 0);

// the scan: fake D1 / Durable Objects; nothing is written anywhere
const writes = [], D1 = { prepare: () => ({ bind: () => ({ all: async () => ({ results: [{ tenant_id: "t1", channel: "main", slug: "ck1" }, { tenant_id: "t2", channel: "main", slug: "ck2" }] }) }) }) };
const residentOf = (tid) => ({ billingFlags: async () => tid === "t1" ? flagTurns([turn({ id: "bad" })], catalog) : [] });
const ledgerOf = (tid) => ({ resEvents: async () => tid === "t2" ? [{ id: "res:1", kind: "price_unknown", nano: 5e8, at: 5 }, { id: "res:2", kind: "expired", nano: 1, at: 6 }] : [] });
const pushes = []; const realFetch = globalThis.fetch; globalThis.fetch = async (u) => { pushes.push(String(u)); return new Response("ok"); };
const log0 = console.log; console.log = () => {};
try {
  const r = await scanBilling({ DB: D1 }, { since: 0, residentOf, ledgerOf });
  assert.equal(r.flagged, 2); assert.equal(r.price_unknown[0].slug, "ck2"); assert.equal(r.over_estimate[0].slug, "ck1"); assert.equal(r.over_estimate[0].turn, "bad");
  assert.match(flagLine(r), /1 price_unknown, 1 over 10x estimate/);
  const d = await dailyBillingFlag({ DB: D1, BILLING_FLAG_PUSH: "https://uptime.example/api/push/abc" }, { since: 0, residentOf, ledgerOf });
  assert.equal(d.flagged, 2); assert.equal(pushes.length, 1); assert.match(pushes[0], /^https:\/\/uptime\.example\/api\/push\/abc\?status=down&msg=/);
  const none = await dailyBillingFlag({ DB: D1, BILLING_FLAG_PUSH: "https://uptime.example/api/push/abc" }, { since: 0, residentOf: () => ({ billingFlags: async () => [] }), ledgerOf: () => ({ resEvents: async () => [] }) });
  assert.equal(none.flagged, 0); assert.match(pushes[1], /status=up/);
  // a failing account is counted, not thrown
  const bad = await scanBilling({ DB: D1 }, { since: 0, residentOf: () => ({ billingFlags: async () => { throw new Error("x"); } }), ledgerOf });
  assert.equal(bad.errors, 2); assert.equal(bad.price_unknown.length, 1);
  assert.equal(bad.error_samples.length, 2); assert.match(bad.error_samples[0], /^ck\d+ main: x$/, "each error names its account, channel and message");
} finally { console.log = log0; globalThis.fetch = realFetch; }
console.log("billing-flag: all ok");
