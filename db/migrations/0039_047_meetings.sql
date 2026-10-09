-- Meeting reminders for notes (src/meetings.js). Additive only: a new column (default on) and two new tables.
-- notif_prefs.meetings: Settings → Notifications → "Meeting reminders for notes" (1 = on, the default).
ALTER TABLE notif_prefs ADD COLUMN meetings INTEGER NOT NULL DEFAULT 1;
-- meeting_watch: one row per workspace the minute cron looks at. next_poll_at: its next calendar look (every 10 min; set before the
-- look goes out). cals: its calendars [{app, account}] (re-read hourly, cals_at). tz: the app's time zone (for "2:00"). seen_at: the
-- app asked for reminders (it's open). polled_at / last_error: the last look.
CREATE TABLE IF NOT EXISTS meeting_watch (tenant_id TEXT PRIMARY KEY, next_poll_at INTEGER NOT NULL DEFAULT 0, cals TEXT NOT NULL DEFAULT '[]', cals_at INTEGER NOT NULL DEFAULT 0,
  tz TEXT NOT NULL DEFAULT '', seen_at INTEGER NOT NULL DEFAULT 0, polled_at INTEGER, last_error TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT 0);
-- meeting_alerts: one reminder per meeting start (id = hash of workspace, app, event id, start). state: due → sending (claimed_at) →
-- sent | off (the switch was off) | missed (too late) | dismissed (Not now) | taken (the task was made before the push went).
-- session/channel: the task its notes went into (taken_at: when a device started making it).
CREATE TABLE IF NOT EXISTS meeting_alerts (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, app TEXT NOT NULL, event_id TEXT NOT NULL, title TEXT NOT NULL, start_at INTEGER NOT NULL, end_at INTEGER,
  link TEXT NOT NULL DEFAULT '', alert_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'due', claimed_at INTEGER, sent_at INTEGER, push TEXT, session TEXT, channel TEXT, taken_at INTEGER,
  dismissed_at INTEGER, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS meeting_alerts_due ON meeting_alerts (alert_at, state);
CREATE INDEX IF NOT EXISTS meeting_alerts_tenant ON meeting_alerts (tenant_id, start_at);
