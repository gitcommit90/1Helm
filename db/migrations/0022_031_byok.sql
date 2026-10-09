-- Bring your own AI key (src/byok.js). Purely additive: two new tables.
-- byok: one OpenAI-compatible endpoint per account. The key is sealed with VAULT_KEY (AES-GCM, like vault/logins) and never
-- returned; key_last4 is what the app shows. Used for AI calls only while tenants.plan = 'byok'.
CREATE TABLE IF NOT EXISTS byok (
  tenant_id TEXT PRIMARY KEY,
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  fast_model TEXT NOT NULL DEFAULT '',
  key_sealed TEXT NOT NULL,
  key_last4 TEXT NOT NULL DEFAULT '',
  test_json TEXT NOT NULL DEFAULT '',
  tested_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
-- Test connection rate limit: one row per test (or save, which tests first); rows older than an hour are pruned.
CREATE TABLE IF NOT EXISTS byok_tests (tenant_id TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS byok_tests_t ON byok_tests (tenant_id, at);
