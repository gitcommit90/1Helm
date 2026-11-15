-- Dev debugging (src/ops-read.js). DEV D1 ONLY (1hc-dev-control); Live never gets these. Purely additive.
-- ops_view_as: every dev ops "view as" (a 1-hour, look-only sign-in to an account's app), logged before the session exists.
CREATE TABLE IF NOT EXISTS ops_view_as (id INTEGER PRIMARY KEY AUTOINCREMENT, token_hash TEXT NOT NULL UNIQUE, tenant_id TEXT NOT NULL, slug TEXT NOT NULL,
  at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ops_view_as_tenant ON ops_view_as (tenant_id, at);
-- ops_clientlog: the app's dev diagnostics (POST /api/clientlog), last 500 per account, read back by /_ops/clientlog.
CREATE TABLE IF NOT EXISTS ops_clientlog (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, at INTEGER NOT NULL, body TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ops_clientlog_tenant ON ops_clientlog (tenant_id, id);
