-- Environment-local, append-only snapshots. A conditional insert provides optimistic concurrency.
CREATE TABLE IF NOT EXISTS model_settings_versions (
  environment TEXT NOT NULL,
  revision INTEGER NOT NULL,
  config TEXT,
  at INTEGER NOT NULL,
  by TEXT NOT NULL,
  action TEXT NOT NULL,
  PRIMARY KEY (environment, revision)
);
