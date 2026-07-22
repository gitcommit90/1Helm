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
