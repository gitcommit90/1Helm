-- 10-05 Per-workspace switches, one row per flag (connect-offer.js: k='connect_offers', v='off' = the person tapped
-- "Don't suggest connecting apps"; no row = on). Purely additive.
CREATE TABLE IF NOT EXISTS tenant_flags (tenant_id TEXT NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (tenant_id, k));
