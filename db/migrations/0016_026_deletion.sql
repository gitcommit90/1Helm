-- 10-06 Deletion (src/deletion.js): purely additive. deletion_jobs = an in-progress marker per deletion (resumed by the 5-minute cron,
-- removed when it finishes); deletion_log = one completion record per deletion with no user content (tenant id hash, counts, times);
-- hs_forget = Hindsight documents to delete again after Hindsight's asynchronous retain could have landed.
CREATE TABLE IF NOT EXISTS deletion_jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, tenant_id TEXT NOT NULL, target TEXT NOT NULL DEFAULT '', meta TEXT NOT NULL DEFAULT '{}', reason TEXT, started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, error TEXT);
CREATE TABLE IF NOT EXISTS deletion_log (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, tenant_hash TEXT NOT NULL, target_hash TEXT, counts TEXT NOT NULL, reason TEXT, started_at INTEGER, finished_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS hs_forget (bank TEXT NOT NULL, doc TEXT NOT NULL, due INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (bank, doc));
