CREATE TABLE IF NOT EXISTS push_installations (
  installation_id TEXT PRIMARY KEY,
  management_secret_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS push_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  installation_id TEXT NOT NULL REFERENCES push_installations(installation_id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  token_cipher TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(installation_id,platform,token_hash)
);
CREATE INDEX IF NOT EXISTS idx_push_devices_recipient ON push_devices(installation_id,recipient_id);
CREATE TABLE IF NOT EXISTS push_deliveries (
  installation_id TEXT NOT NULL REFERENCES push_installations(installation_id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  delivered_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (installation_id,idempotency_key)
);
