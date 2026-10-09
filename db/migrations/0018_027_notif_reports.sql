-- 10-06 Notifications + Report an issue (src/notify.js, src/webpush.js, src/reports.js). Purely additive: three new tables.
-- notif_prefs: one row per workspace (Settings → Notifications). No row = the defaults (everything on).
--   needs / finished / sound / needs_text: 1 on, 0 off. win_start / win_count: the per-workspace push cap (a rolling hour).
CREATE TABLE IF NOT EXISTS notif_prefs (tenant_id TEXT PRIMARY KEY, needs INTEGER NOT NULL DEFAULT 1, finished INTEGER NOT NULL DEFAULT 1,
  sound INTEGER NOT NULL DEFAULT 1, needs_text INTEGER NOT NULL DEFAULT 1, win_start INTEGER NOT NULL DEFAULT 0, win_count INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
-- push_subs: one row per device that turned on Web Push (the browser's PushSubscription). Gone (404/410 from the push service) = deleted.
CREATE TABLE IF NOT EXISTS push_subs (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, last_ok_at INTEGER, fails INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS push_subs_tenant ON push_subs (tenant_id);
-- issue_reports: Help & support → Report an issue. The screenshot (if any) is in R2 at shot_key (t/<tenant>/reports/<id>.<ext>).
CREATE TABLE IF NOT EXISTS issue_reports (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, slug TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL, route TEXT NOT NULL DEFAULT '', app_v TEXT NOT NULL DEFAULT '', client_v TEXT NOT NULL DEFAULT '', ua TEXT NOT NULL DEFAULT '',
  viewport TEXT NOT NULL DEFAULT '', logs TEXT NOT NULL DEFAULT '[]', shot_key TEXT, shot_type TEXT, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS issue_reports_at ON issue_reports (created_at);
