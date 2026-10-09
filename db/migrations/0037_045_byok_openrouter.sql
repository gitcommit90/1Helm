-- Sign in with OpenRouter (src/byok-openrouter.js, Captain 10-08). Purely additive: two new tables and one new column.
-- byok_or_pkce: a sign-in in progress (OAuth PKCE). state = the random value OpenRouter sends back; verifier sealed with VAULT_KEY.
--   One use (deleted on the callback), 10 minutes (OpenRouter's codes expire then too).
CREATE TABLE IF NOT EXISTS byok_or_pkce (state TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, verifier TEXT NOT NULL, created_at INTEGER NOT NULL);
-- byok_or_key: the key OpenRouter gave after the sign-in, sealed, waiting for the person to pick a model (Save moves it into byok).
CREATE TABLE IF NOT EXISTS byok_or_key (tenant_id TEXT PRIMARY KEY, key_sealed TEXT NOT NULL, key_last4 TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
-- byok.source: 'openrouter' when the saved key came from Sign in with OpenRouter, '' when it was pasted.
ALTER TABLE byok ADD COLUMN source TEXT NOT NULL DEFAULT '';
