-- 10-05 Several accounts per app: which connected account (Composio id) is the app's default for this workspace. No row = the first
-- one connected. Purely additive.
CREATE TABLE IF NOT EXISTS app_default (tenant_id TEXT NOT NULL, app TEXT NOT NULL, account_id TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (tenant_id, app));
