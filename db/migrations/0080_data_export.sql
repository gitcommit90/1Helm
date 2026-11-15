-- Export my data (src/data-export.js). Purely additive: two new tables. The code also creates them when they are missing (CREATE TABLE IF NOT EXISTS),
-- so it works before this is applied.
-- data_exports: one row per export, with its status and times and no user content. At most one running export per account (the partial unique index).
--   status: pending | running | done | failed | canceled | expired | deleted.  seq: the last saved checkpoint (the progress itself is in R2 under exports/<tenant>/).
--   lease_until: the time until which a running job belongs to the process that is working on it. notified: 1 once the download email was sent.
-- data_export_codes: the 6-digit code emailed before an export may start (same code lifetime, hashing and wrong-guess limits as sign-in codes).
CREATE TABLE IF NOT EXISTS data_exports (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT, status TEXT NOT NULL, requested_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER,
  bytes INTEGER NOT NULL DEFAULT 0, expires_at INTEGER, seq INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0,
  notified INTEGER NOT NULL DEFAULT 0, error TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS data_exports_one ON data_exports (tenant_id) WHERE status IN ('pending','running');
CREATE INDEX IF NOT EXISTS data_exports_tenant ON data_exports (tenant_id, requested_at);
CREATE TABLE IF NOT EXISTS data_export_codes (tenant_id TEXT PRIMARY KEY, nonce TEXT NOT NULL, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0,
  sends INTEGER NOT NULL DEFAULT 1, window_at INTEGER NOT NULL, sent_at INTEGER NOT NULL);
