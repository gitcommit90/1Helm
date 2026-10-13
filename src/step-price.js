// What a model step costs when OpenRouter did not report usage.cost (a step stopped mid-stream by the repeat guard, or a reply
// that came back without a cost). The reservation price ceiling (model.js OR_RESERVE_PRICE) is only a hold on the balance; a
// settled charge uses the model's own saved per-token price, never the ceiling. Prices are the saved catalog's pricing, in
// US dollars per million tokens (model-catalog.js), which is 1,000 nano-dollars per token for each dollar.
import { OR_RESERVE_PRICE, CACHE_WRITE_MULT } from "./model.js";

const num = (n) => (Number.isFinite(Number(n)) && Number(n) >= 0 ? Number(n) : null);

// The saved price of the first model in `models` that has one: { model, in, out } in nano-dollars per token, or null.
export function savedModelPrice(catalogs, models) {
  for (const m of models) {
    if (!m) continue;
    for (const cat of catalogs) {
      const p = cat?.[m]?.pricing || (cat && cat.id === m ? cat.pricing : null), i = num(p?.prompt), o = num(p?.completion);
      if (i != null && o != null) return { model: m, in: i * 1000, out: o * 1000 };
    }
  }
  return null;
}

// Nano-dollars before markup. With a known price, input is billed in full at the model's own input price (no cache discount is
// assumed, because no usage came back to say what was cached) and output at its output price. Without a price the cost is the
// ceiling and `unknown` is true, so the caller records a "price unknown" event instead of charging the ceiling silently.
export function estimateStepCost({ inTok, cached = 0, cacheWrite = 0, outTok }, price) {
  const fresh = Math.max(0, inTok - cached);
  if (price) return { nano: Math.ceil((fresh + cacheWrite * (CACHE_WRITE_MULT - 1)) * price.in + outTok * price.out), unknown: false, model: price.model };
  return { nano: Math.ceil((fresh + cacheWrite * (CACHE_WRITE_MULT - 1)) * OR_RESERVE_PRICE.in + outTok * OR_RESERVE_PRICE.out), unknown: true, model: null };
}
