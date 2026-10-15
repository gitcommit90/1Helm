-- Memory Overhaul phase 2: purely additive. hs_health = the latest daily Hindsight bank check per bank (hindsight-health.js), read by /_ops/hs-health.
-- It holds counts, ids and short error text only, never memory content. The code also creates it if missing.
CREATE TABLE IF NOT EXISTS hs_health (bank TEXT PRIMARY KEY, checked_at INTEGER NOT NULL, stats TEXT, problems TEXT NOT NULL DEFAULT '[]', detail TEXT, actions TEXT NOT NULL DEFAULT '[]');
