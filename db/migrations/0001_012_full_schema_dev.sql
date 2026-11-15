CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS magic_links (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, owner_user_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending_payment', stripe_customer TEXT NOT NULL DEFAULT '', stripe_subscription TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, past_due_since INTEGER, sub_status TEXT NOT NULL DEFAULT '', first_name TEXT NOT NULL DEFAULT '', helper_name TEXT NOT NULL DEFAULT '', helper_avatar INTEGER NOT NULL DEFAULT 8, onboarding_completed INTEGER NOT NULL DEFAULT 0, provisioned_at INTEGER, plan TEXT NOT NULL DEFAULT 'plus', onboard_step TEXT NOT NULL DEFAULT '', helper_tone INTEGER NOT NULL DEFAULT 0, slug_chosen INTEGER NOT NULL DEFAULT 0, host_ready INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS stripe_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, received_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS resident_schedules (tenant_id TEXT NOT NULL, channel TEXT NOT NULL, channel_id TEXT, next_run INTEGER, updated_at INTEGER NOT NULL, PRIMARY KEY (tenant_id, channel));
CREATE TABLE IF NOT EXISTS vault (tenant_id TEXT NOT NULL, name TEXT NOT NULL, standin TEXT NOT NULL UNIQUE, hosts TEXT NOT NULL, sealed TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (tenant_id, name));
CREATE TABLE IF NOT EXISTS approval_policy (tenant_id TEXT NOT NULL, scope TEXT NOT NULL, scope_key TEXT NOT NULL DEFAULT '', mode TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (tenant_id, scope, scope_key));
CREATE TABLE IF NOT EXISTS link_accounts (tenant_id TEXT PRIMARY KEY, sealed TEXT NOT NULL, scope TEXT, access_expires_at INTEGER, connected_at INTEGER NOT NULL, email TEXT);
CREATE TABLE IF NOT EXISTS link_pending (tenant_id TEXT PRIMARY KEY, sealed_device_code TEXT NOT NULL, user_code TEXT NOT NULL, url TEXT NOT NULL, interval_s INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_poll INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS link_purchases (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, channel TEXT, amount INTEGER NOT NULL, currency TEXT NOT NULL, merchant_name TEXT, merchant_url TEXT, context TEXT, test INTEGER NOT NULL, status TEXT NOT NULL, approval_url TEXT, card_last4 TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS soon_taps (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, k TEXT NOT NULL, where_ TEXT, width INTEGER, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS texting (
  tenant_id TEXT PRIMARY KEY,
  hook_id TEXT NOT NULL UNIQUE,          
  phone TEXT NOT NULL,                   
  status TEXT NOT NULL,                  
  device_code_sealed TEXT, user_code TEXT, verify_url TEXT, device_expires INTEGER,
  project_id TEXT, project_secret_sealed TEXT, webhook_id TEXT, webhook_secret_sealed TEXT,
  assigned TEXT,                         
  code TEXT, code_expires INTEGER,
  inbound_count INTEGER NOT NULL DEFAULT 0,
  last_inbound_id TEXT,
  error TEXT,
  connected_at INTEGER, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS texting_seen (msg_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS resident_schedules_next ON resident_schedules(next_run);
CREATE INDEX IF NOT EXISTS soon_taps_tenant ON soon_taps(tenant_id, at);
CREATE TABLE IF NOT EXISTS releases (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', commit_sha TEXT NOT NULL DEFAULT '', dev_version TEXT NOT NULL DEFAULT '', live_version TEXT NOT NULL DEFAULT '', prev_live_version TEXT NOT NULL DEFAULT '', checks TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'ready', pushed_at INTEGER, rolled_back_at INTEGER);
