-- Storage per account (src/storage.js). Purely additive: two new tables, nothing existing changes.
-- Both have tenant_id, so account deletion (deletion.js: every table with a tenant_id) removes them too.
-- Running counter of R2 bytes under t/<tenant>/, per kind (files | computer | pages | other). Kept by the stPut/stDelete helpers,
-- set to the real numbers by the recount (cron + on demand).
CREATE TABLE IF NOT EXISTS storage_usage (
  tenant_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0,
  objects INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, kind)
);
-- Extra 100 GB blocks bought (mirrors the quantity of the storage item on the plan's Stripe subscription), the last full recount,
-- and the app's one-time 80% / full notice.
CREATE TABLE IF NOT EXISTS storage_plan (
  tenant_id TEXT PRIMARY KEY,
  blocks INTEGER NOT NULL DEFAULT 0,
  stripe_item TEXT,
  counted_at INTEGER,
  notice_seen INTEGER NOT NULL DEFAULT 0,   -- 0 | 80 | 100: the highest notice the person has seen
  refused_at INTEGER,                       -- the last write refused for lack of room (a computer save, a file)
  refused_what TEXT,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS storage_plan_counted ON storage_plan(counted_at);
