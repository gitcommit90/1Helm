-- Memory envelope (the design notes, flag HS_ENVELOPE). Purely additive: new tables only.
-- src/memory-sources.js creates the same tables on first use, so applying this file is optional; it is here so the schema is written down.
CREATE TABLE IF NOT EXISTS memory_sources (tenant_id TEXT NOT NULL, source_key TEXT NOT NULL, channel TEXT NOT NULL, kind TEXT NOT NULL, label TEXT,
  consent_at INTEGER, consent_scope TEXT, status TEXT NOT NULL DEFAULT 'active', items INTEGER NOT NULL DEFAULT 0, last_import_at INTEGER, created_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, source_key));
CREATE TABLE IF NOT EXISTS memory_dedupe (tenant_id TEXT NOT NULL, channel TEXT NOT NULL, dedupe_key TEXT NOT NULL, doc TEXT NOT NULL, source_key TEXT,
  seen INTEGER NOT NULL DEFAULT 1, sources TEXT, at INTEGER NOT NULL, PRIMARY KEY (tenant_id, channel, dedupe_key));
CREATE TABLE IF NOT EXISTS memory_places (tenant_id TEXT NOT NULL, place_id TEXT NOT NULL, label TEXT, place TEXT, lat REAL, lng REAL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, place_id));
CREATE TABLE IF NOT EXISTS geocode_cache (k TEXT PRIMARY KEY, place TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS memory_tombstones (tenant_id TEXT NOT NULL, channel TEXT NOT NULL, doc TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (tenant_id, channel, doc));
