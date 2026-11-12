-- Focus timer offer preferences, per tenant (pomodoro.js). Purely additive.
-- offers: '' = on, 'off' = the person tapped "Don't suggest again". streak/last_decline: No thanks in a row; two within 14 days
-- set suppressed_until = +30 days (offers paused unless the person brings timers up themselves).
CREATE TABLE IF NOT EXISTS pomodoro_prefs (
  tenant_id TEXT PRIMARY KEY,
  offers TEXT NOT NULL DEFAULT '',
  streak INTEGER NOT NULL DEFAULT 0,
  last_decline INTEGER NOT NULL DEFAULT 0,
  suppressed_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
