-- app_file_links: short-lived read-only links that hand one of the person's own files to a connected app (src/app-file-links.js).
-- sha256(token) → tenant, file, R2 key, expiry. The token itself is never stored (HMAC of id + salt with VAULT_KEY). The row is also the
-- record of the link: who (tenant, channel, session), which file, when, how long, which app action got it, and how often it was fetched.
-- Purely additive. The code also creates this table when it is missing (CREATE TABLE IF NOT EXISTS), so it works before this is applied.
CREATE TABLE IF NOT EXISTS app_file_links (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, tenant_id TEXT NOT NULL, channel TEXT NOT NULL, session TEXT,
  file_id TEXT NOT NULL, r2key TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL DEFAULT 0, app TEXT, action TEXT, via TEXT,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, fetched INTEGER NOT NULL DEFAULT 0, last_fetch_at INTEGER);
CREATE INDEX IF NOT EXISTS app_file_links_tenant ON app_file_links (tenant_id, created_at);
