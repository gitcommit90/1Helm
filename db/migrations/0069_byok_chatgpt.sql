-- Sign in with ChatGPT (src/ee/byok-chatgpt.js). Additive: three new tables, no change to an existing one.
-- byok_chatgpt_host: the workspace's own stable host ID (ext_agent_host_id), made once and kept even after sign out.
-- byok_chatgpt_pkce: a sign-in that was started and not finished (verifier sealed with VAULT_KEY).
-- byok_chatgpt: the signed-in credential record, sealed with VAULT_KEY; the other columns hold no secret. ver and lock_* make a refresh safe when several channels need a new token at once.
CREATE TABLE IF NOT EXISTS byok_chatgpt_host (tenant_id TEXT PRIMARY KEY, host_id TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS byok_chatgpt_pkce (state TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, verifier TEXT NOT NULL, nonce TEXT NOT NULL, client_id TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS byok_chatgpt (tenant_id TEXT PRIMARY KEY, client_id TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', record_sealed TEXT NOT NULL DEFAULT '',
  expires_at INTEGER NOT NULL DEFAULT 0, ver INTEGER NOT NULL DEFAULT 0, lock_id TEXT NOT NULL DEFAULT '', lock_until INTEGER NOT NULL DEFAULT 0, broken INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
