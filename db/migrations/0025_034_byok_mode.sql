-- Own AI key on a full plan (src/byok.js, Captain 10-06): what the saved key is for while the account is on Personal/Plus/Power/Max.
-- Purely additive: one new column, default '' (the key isn't used on a full plan until they choose).
--   'fallback': keep the plan; AI uses 1Helm credits first and goes to the key once they're used up (until a renewal or top-up refills them).
--   'switch':   the plan changes to the $10 Bring your own key plan at the end of this billing period (plan-change.js downgrade path).
-- On the byok plan the column is ignored: the key is simply their AI.
ALTER TABLE byok ADD COLUMN mode TEXT NOT NULL DEFAULT '';
