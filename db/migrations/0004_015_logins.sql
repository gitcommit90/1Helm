-- Saved logins (Settings → Passwords & keys): website + username + sealed password (AES-GCM, VAULT_KEY). One per site per tenant.
-- The password is never returned by the API and never shown to the model; browser_fill_login types it only on the login's own site.
CREATE TABLE IF NOT EXISTS logins (tenant_id TEXT NOT NULL, site TEXT NOT NULL, username TEXT NOT NULL DEFAULT '', sealed TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (tenant_id, site));
