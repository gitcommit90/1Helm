-- Ownership and one-use submission state only. Never stores PayPal credentials.
CREATE TABLE IF NOT EXISTS paypal_setup (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'new',
  config_id TEXT,
  account_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS paypal_setup_owner ON paypal_setup(tenant_id, account_id);
