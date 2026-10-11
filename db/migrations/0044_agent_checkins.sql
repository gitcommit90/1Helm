-- Existing accounts keep 15 silent calls / 20 calls in 60 seconds without needing a row.
CREATE TABLE IF NOT EXISTS agent_checkin_prefs (
  tenant_id TEXT PRIMARY KEY,
  silent INTEGER NOT NULL DEFAULT 15 CHECK (silent BETWEEN 1 AND 1000),
  fast INTEGER NOT NULL DEFAULT 20 CHECK (fast BETWEEN 1 AND 1000),
  updated_at INTEGER NOT NULL
);
