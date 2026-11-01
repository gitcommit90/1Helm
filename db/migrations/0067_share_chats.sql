-- Shared chats (src/share.js, src/share-chat.js). Additive: one new table.
-- share_chats: one public link per chat (tenant, channel, session). The token itself is never stored (same scheme as share_links: HMAC of
-- id + salt with VAULT_KEY, sha256 of it is kept). prefix points at the live snapshot in R2 (t/<tenant>/chats/<id>/<version>); "Update link"
-- writes a new version and swaps the prefix, so the address stays the same.
CREATE TABLE IF NOT EXISTS share_chats (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, tenant_id TEXT NOT NULL, channel TEXT NOT NULL,
  session TEXT NOT NULL, title TEXT NOT NULL, prefix TEXT NOT NULL, messages INTEGER NOT NULL DEFAULT 0, pictures INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS share_chats_session ON share_chats (tenant_id, channel, session);
