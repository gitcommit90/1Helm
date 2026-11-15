-- 10-07 Settings → Ambient → Bee, §10 steps 1 + 2 (src/bee.js). Purely additive: three new tables.
-- bee_pairing: the one pairing in progress per workspace (Connect sheet). secret_sealed = the tweetnacl box secret key, sealed with
--   VAULT_KEY; the row (and so the secret) is deleted as soon as the token is decrypted, on Cancel, and replaced on renewal.
--   next_poll_at throttles the re-POST to Bee (2 s; backoff on 5xx/network, fails = consecutive failures) and is also the claim
--   that keeps two tabs from polling at once.
CREATE TABLE IF NOT EXISTS bee_pairing (tenant_id TEXT PRIMARY KEY, request_id TEXT NOT NULL, public_key TEXT NOT NULL, secret_sealed TEXT NOT NULL,
  expires_at INTEGER NOT NULL, next_poll_at INTEGER NOT NULL, fails INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
-- bee_accounts: the connection. token_sealed = the Bee developer token sealed with VAULT_KEY (never logged, returned or given to the
--   helper). status: verifying (token saved, /v1/me not answered yet) | connected | needs_reconnect (Bee said 401).
CREATE TABLE IF NOT EXISTS bee_accounts (tenant_id TEXT PRIMARY KEY, token_sealed TEXT NOT NULL, status TEXT NOT NULL, bee_user_id INTEGER,
  first_name TEXT, last_name TEXT, connected_at INTEGER NOT NULL, checked_at INTEGER, check_next_at INTEGER NOT NULL DEFAULT 0, last_error TEXT);
-- bee_events: what happened, for /_ops/bee (dev) and the live check. Plain words, never a token or key. Last 100 per workspace.
CREATE TABLE IF NOT EXISTS bee_events (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, at INTEGER NOT NULL, what TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS bee_events_tenant ON bee_events(tenant_id, id);
