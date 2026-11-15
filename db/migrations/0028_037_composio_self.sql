-- Managed vs Self-managed apps (10-06, composio-upgrade part 2; src/composio-self.js). Purely additive: three new tables.
-- The choice itself lives in tenant_flags (k='apps_mode' = 'self'; no row = managed; consent time in k='apps_consent').
-- composio_self: one row per Self-managed workspace: its tokens for the person's own Composio account (AES-GCM sealed with VAULT_KEY),
--   who signed in (email), status ok | ended, the Connect MCP session id, and a short lease so one refresher runs at a time.
CREATE TABLE IF NOT EXISTS composio_self (tenant_id TEXT PRIMARY KEY, sealed TEXT NOT NULL, who TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'ok', mcp_sid TEXT, lease INTEGER, connected_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
-- composio_self_pkce: a sign-in in progress (15 minutes, one use): the state, the PKCE verifier (sealed), where to go back to.
CREATE TABLE IF NOT EXISTS composio_self_pkce (state TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, verifier TEXT NOT NULL, back TEXT NOT NULL DEFAULT '', then_mode TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
-- composio_self_apps: toolkits this workspace connected or used on its own Composio account (Connect MCP lists connections per toolkit).
CREATE TABLE IF NOT EXISTS composio_self_apps (tenant_id TEXT NOT NULL, toolkit TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (tenant_id, toolkit));
