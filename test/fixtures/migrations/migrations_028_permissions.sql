-- Settings → Permissions (src/perms.js). Purely additive: two new tables, nothing existing changes.
-- No row = Standard (today's behavior). level: standard | careful | locked.
CREATE TABLE IF NOT EXISTS perm_prefs (
  tenant_id TEXT PRIMARY KEY,
  level TEXT NOT NULL DEFAULT 'standard',
  updated_at INTEGER NOT NULL
);
-- The kinds of action they tapped "Always allow" on (email, calendar, computer, browser…), across every channel.
CREATE TABLE IF NOT EXISTS perm_allow (
  tenant_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  at INTEGER NOT NULL,
  via TEXT NOT NULL DEFAULT 'card',   -- card (a permission card) | settings
  PRIMARY KEY (tenant_id, kind)
);
