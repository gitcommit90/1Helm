// node --import ./test/stubs/register.mjs test/step-price.test.mjs
// A step with no reported cost is billed at the model's own saved price, never the reservation ceiling (r35-billing-ceiling).
// Reported case (2026-10-12 23:14 UTC): a step the repeat guard stopped, 74,097 estimated input tokens, 1,881 output
// tokens, no usage back: billed $0.2881 at the ceiling (3,000 / 15,000 nano per token plus 15%); the model's own price is about $0.008.
import assert from "node:assert";
import { savedModelPrice, estimateStepCost } from "../src/step-price.js";
import { OR_RESERVE_PRICE } from "../src/model.js";

const catalog = { "xiaomi/mimo-v2.6-flash": { pricing: { prompt: 0.09, completion: 0.29 } }, "bad/model": { pricing: { prompt: "x", completion: 1 } } };
const step = { inTok: 74097, cached: 0, cacheWrite: 0, outTok: 1881 };

// the ceiling charge the old code made
const old = Math.ceil((step.inTok * OR_RESERVE_PRICE.in + step.outTok * OR_RESERVE_PRICE.out) * 1.15);
assert.ok(Math.abs(old / 1e9 - 0.2881) < 0.0005, "the old formula reproduces the bad charge");

const p = savedModelPrice([catalog], [null, "xiaomi/mimo-v2.6-flash"]);
assert.deepEqual(p, { model: "xiaomi/mimo-v2.6-flash", in: 90, out: 290 }, "$ per million tokens becomes nano-dollars per token");
const e = estimateStepCost(step, p);
assert.equal(e.unknown, false);
assert.equal(e.nano, Math.ceil(74097 * 90 + 1881 * 290));
assert.ok(e.nano * 1.15 / 1e9 < 0.01, "about $0.008, not $0.288");
assert.ok(e.nano < old / 30);

// cached tokens are subtracted when usage reported them; cache writes cost the write multiplier
assert.equal(estimateStepCost({ inTok: 1000, cached: 400, cacheWrite: 0, outTok: 0 }, p).nano, 600 * 90);
assert.equal(estimateStepCost({ inTok: 1000, cached: 0, cacheWrite: 200, outTok: 0 }, p).nano, Math.ceil((1000 + 200 * 0.25) * 90));

// unknown or malformed price: ceiling, flagged
assert.equal(savedModelPrice([catalog], ["nope/model"]), null);
assert.equal(savedModelPrice([catalog], ["bad/model"]), null, "a non-numeric price is unknown, not zero");
assert.equal(savedModelPrice([undefined, null], ["xiaomi/mimo-v2.6-flash"]), null);
const u = estimateStepCost(step, null);
assert.equal(u.unknown, true); assert.equal(u.nano, Math.ceil(step.inTok * OR_RESERVE_PRICE.in + step.outTok * OR_RESERVE_PRICE.out));

// a task profile catalog record (one model) works too
assert.equal(savedModelPrice([{ id: "a/b", pricing: { prompt: 1, completion: 2 } }], ["a/b"]).out, 2000);
console.log("step-price: all ok");
