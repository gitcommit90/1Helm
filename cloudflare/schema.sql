CREATE TABLE IF NOT EXISTS workspaces (
  slug TEXT PRIMARY KEY,
  hostname TEXT NOT NULL UNIQUE,
  installation_id TEXT NOT NULL UNIQUE,
  workspace_name TEXT NOT NULL,
  management_secret_hash TEXT NOT NULL,
  tunnel_id TEXT NOT NULL DEFAULT '',
  connector_secret_cipher TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'provisioning',
  enabled INTEGER NOT NULL DEFAULT 1,
  error TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspaces_installation ON workspaces(installation_id);

CREATE TABLE IF NOT EXISTS feedback_reports (
  public_id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL,
  workspace_name TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL,
  diagnostics TEXT NOT NULL DEFAULT '{}',
  attachment_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_received ON feedback_reports(received_at DESC);

CREATE TABLE IF NOT EXISTS feedback_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id TEXT NOT NULL REFERENCES feedback_reports(public_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

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
