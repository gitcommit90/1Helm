-- Share links and published pages (src/share.js, src/publish.js). Additive: three new tables.
-- share_links: sha256(token) → tenant, file, R2 key, expiry. The token itself is never stored (HMAC of id + salt with VAULT_KEY).
CREATE TABLE IF NOT EXISTS share_links (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, tenant_id TEXT NOT NULL, channel TEXT NOT NULL,
  file_id TEXT NOT NULL, r2key TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, expires_at INTEGER);
CREATE INDEX IF NOT EXISTS share_links_file ON share_links (tenant_id, file_id);
-- published_pages: (tenant, name) → the live version's R2 prefix t/<tenant>/pages/<version>.
CREATE TABLE IF NOT EXISTS published_pages (tenant_id TEXT NOT NULL, name TEXT NOT NULL, id TEXT NOT NULL, title TEXT, prefix TEXT NOT NULL, files INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0, channel TEXT, source TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (tenant_id, name));
-- share_offers: what the helper prepared (publish_page / share_file_link); pending until the person taps.
CREATE TABLE IF NOT EXISTS share_offers (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, channel TEXT NOT NULL, session TEXT, turn TEXT, kind TEXT NOT NULL, name TEXT, title TEXT,
  file_id TEXT, source TEXT, prefix TEXT, files INTEGER, bytes INTEGER, status TEXT NOT NULL DEFAULT 'pending', result TEXT, created_at INTEGER NOT NULL, decided_at INTEGER);
CREATE INDEX IF NOT EXISTS share_offers_session ON share_offers (tenant_id, session);
