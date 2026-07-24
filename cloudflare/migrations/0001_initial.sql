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
