-- Saved data of published pages: anyone with the page link can read and write it (like a Google Form). Keyed by the page's stable id
-- (published_pages.id survives a republish), so republishing keeps the data and unpublishing / deleting the channel or account removes it.
-- Purely additive: two new tables. src/page-data.js.
CREATE TABLE IF NOT EXISTS page_data (tenant_id TEXT NOT NULL, page_id TEXT NOT NULL, collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (tenant_id, page_id, collection, id));
CREATE INDEX IF NOT EXISTS page_data_order ON page_data (tenant_id, page_id, collection, created_at);
-- Write counts per visitor (hashed address) and minute, for the write rate limit. Old minutes are removed as new ones start.
CREATE TABLE IF NOT EXISTS page_data_rate (tenant_id TEXT NOT NULL, page_id TEXT NOT NULL, visitor TEXT NOT NULL, win INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, page_id, visitor, win));
