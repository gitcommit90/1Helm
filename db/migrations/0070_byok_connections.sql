-- Several AI service connections on one account (src/ee/byok-connections.js). Purely additive: two new tables, nothing existing changes.
-- byok_connections: one row per connected AI service. kind: plain (any OpenAI-compatible address and key) | openrouter | chatgpt | opencode | claudecode.
--   An account has any number of plain ones and at most one of each other kind (their id is the kind). The key is sealed with VAULT_KEY and never returned;
--   chatgpt has no key here (its sign-in stays in byok_chatgpt). Models are named per connection everywhere as <id>:<model id>.
CREATE TABLE IF NOT EXISTS byok_connections (
  tenant_id TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', base_url TEXT NOT NULL DEFAULT '',
  key_sealed TEXT NOT NULL DEFAULT '', key_last4 TEXT NOT NULL DEFAULT '', test_json TEXT NOT NULL DEFAULT '', tested_at INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (tenant_id, id));
-- byok_multi: an account whose single saved key (and ChatGPT sign-in) was turned into connections. One row, written last, so the upgrade runs once.
CREATE TABLE IF NOT EXISTS byok_multi (tenant_id TEXT PRIMARY KEY, upgraded_at INTEGER NOT NULL);
