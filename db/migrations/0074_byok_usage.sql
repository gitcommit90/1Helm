-- Plan usage bars under each connected AI service (src/ee/byok-usage.js). Purely additive: one new table (src/ee/byok-usage.js also creates it when missing).
-- state_json holds the last numbers read (percent used and reset time of up to two windows, never a token), fetched_at when, fail_at/fail_why the last failed read (so a page view never retries it),
-- limit_json the last usage limit a call ran into.
CREATE TABLE IF NOT EXISTS byok_usage (
  tenant_id TEXT NOT NULL,
  service TEXT NOT NULL,
  state_json TEXT NOT NULL DEFAULT '',
  fetched_at INTEGER NOT NULL DEFAULT 0,
  fail_at INTEGER NOT NULL DEFAULT 0,
  fail_why TEXT NOT NULL DEFAULT '',
  limit_json TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (tenant_id, service)
);
