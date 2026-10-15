-- Memory Overhaul phase 3: purely additive. hs_rebuild_runs = one row per channel bank with the state of its rebuild from source (hindsight-rebuild.js),
-- read by POST /_ops/hs-rebuild (dev only) to count how many banks rebuild at once. It holds counts and short error text only, never memory content.
-- The code also creates it if missing.
CREATE TABLE IF NOT EXISTS hs_rebuild_runs (bank TEXT PRIMARY KEY, tenant TEXT, channel TEXT, status TEXT NOT NULL, phase TEXT, version INTEGER, started_at INTEGER, updated_at INTEGER NOT NULL, summary TEXT);
