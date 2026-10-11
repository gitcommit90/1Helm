-- Account-owned setting, independent of HTTP approval_policy and perm_allow.
-- Missing rows (including every existing account) are Deny.
CREATE TABLE IF NOT EXISTS direct_network_permissions (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  ssh_mode TEXT NOT NULL DEFAULT 'deny' CHECK (ssh_mode IN ('deny','ask')),
  generation INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
