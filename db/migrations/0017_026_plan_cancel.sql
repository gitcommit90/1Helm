-- Cancel at period end (src/cancel.js). Purely additive: two new tables, nothing existing changes.
-- One row per account that asked to cancel. It outlives the account so the final "deleted" email and the
-- webhook/cron double-fire guard work after deletion; the email address and slug are blanked once that email is sent.
CREATE TABLE IF NOT EXISTS plan_cancellations (
  tenant_id TEXT PRIMARY KEY,
  sub_id TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  tz TEXT NOT NULL DEFAULT '',
  period_end INTEGER NOT NULL,             -- ms: when the paid period ends and the account is deleted
  requested_at INTEGER NOT NULL,
  via TEXT NOT NULL DEFAULT 'app',         -- app | portal | sync
  state TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | kept | deleting | deleted
  started_at INTEGER,
  deleted_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS plan_cancellations_state ON plan_cancellations(state, period_end);
-- Every cancellation email, claimed before it's sent so none repeats: cancelled | d7 | d3 | d1 | deleted.
-- delivered=0: not emailed (a test address, or covered by the cancellation email).
CREATE TABLE IF NOT EXISTS plan_cancel_notices (
  tenant_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  period_end INTEGER NOT NULL,
  sent_at INTEGER NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 1,
  subject TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (tenant_id, kind, period_end)
);
