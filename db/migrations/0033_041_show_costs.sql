-- 10-07 Settings → General → Usage → "Show estimated costs" (src/account.js POST /api/account/prefs). Purely additive: one new
-- column. Off (0) by default, so every account, existing ones included, stops seeing "This task: about $…" until it turns it on.
ALTER TABLE tenants ADD COLUMN show_costs INTEGER NOT NULL DEFAULT 0;
