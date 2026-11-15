-- download_links: one-file, GET-only download addresses that expire in minutes, made for the 1Helm phone apps (src/download-links.js).
-- The apps' web view cannot save a file, so the page asks for one of these and opens it in the system browser sheet, which can.
-- sha256(token) -> tenant, user, file or temporary copy, expiry. The token itself is never stored (HMAC of id + salt with VAULT_KEY).
-- Purely additive. The code also creates this table when it is missing (CREATE TABLE IF NOT EXISTS), so it works before this is applied.
CREATE TABLE IF NOT EXISTS download_links (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, tenant_id TEXT NOT NULL, user_id TEXT, kind TEXT NOT NULL,
  channel TEXT, file_id TEXT, r2key TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, fetched INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS download_links_tenant ON download_links (tenant_id, created_at);
