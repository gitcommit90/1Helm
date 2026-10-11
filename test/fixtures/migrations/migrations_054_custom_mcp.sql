-- Custom MCP connections (Settings -> Advanced). Purely additive: two new tables.
-- The per-workspace on/off switch is tenant_flags k='custom_mcp' (v='on'; no row = off).
-- custom_mcp_server: one row per user-owned registration. `slug` is the generated, non-PII Composio toolkit (CUSTOM_HC_...), unique per row;
-- secrets are never stored here (API keys go straight to Composio's credential store). status/step persist setup progress so a failed or
-- repeated create can be resumed or cleaned up; status='removing' keeps a row (unusable) until the upstream toolkit is really deleted.
CREATE TABLE IF NOT EXISTS custom_mcp_server (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, request_id TEXT NOT NULL,
  name TEXT NOT NULL, endpoint TEXT NOT NULL, auth TEXT NOT NULL, header TEXT, discovery_url TEXT,
  slug TEXT NOT NULL UNIQUE, auth_config_id TEXT, account_id TEXT,
  status TEXT NOT NULL, step TEXT NOT NULL,
  tool_count INTEGER NOT NULL DEFAULT 0, tools TEXT, tool_version TEXT,
  last_synced_at INTEGER, sync_started_at INTEGER, sync_attempts INTEGER NOT NULL DEFAULT 0, checked_at INTEGER NOT NULL DEFAULT 0,
  lock_until INTEGER NOT NULL DEFAULT 0, error_code TEXT, error_message TEXT, cleanup_attempts INTEGER NOT NULL DEFAULT 0, cleanup_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE (tenant_id, request_id)
);
CREATE INDEX IF NOT EXISTS custom_mcp_server_tenant ON custom_mcp_server (tenant_id, created_at);
-- OAuth state: only the SHA-256 of the random state is stored; bound to the initiating user, workspace and server; expires; single use.
CREATE TABLE IF NOT EXISTS custom_mcp_state (
  state_hash TEXT PRIMARY KEY, server_id TEXT NOT NULL, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL,
  pending_account_id TEXT, expires_at INTEGER NOT NULL, used_at INTEGER
);
