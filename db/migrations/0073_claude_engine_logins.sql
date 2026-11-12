-- The Claude engine (src/ee/claude-engine.js): one saved Claude Code login per account, sealed with VAULT_KEY. Purely additive: one new table.
-- sealed holds the CLI's credentials file and account file; account_json holds the email and plan shown in Settings (never a secret).
CREATE TABLE IF NOT EXISTS claude_engine_logins (
  tenant_id TEXT PRIMARY KEY,
  sealed TEXT NOT NULL,
  account_json TEXT NOT NULL DEFAULT '{}',
  saved_at INTEGER NOT NULL
);
