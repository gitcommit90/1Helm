-- 10-06 Payment failed (src/pastdue.js). Purely additive: three new tables, nothing existing changes. pastdue.js also creates them
-- on first use (CREATE TABLE IF NOT EXISTS), so this file only makes it explicit.
-- billing_paid: how far the account has paid (the latest period end of a paid plan invoice). Deleted with the account.
CREATE TABLE IF NOT EXISTS billing_paid (tenant_id TEXT PRIMARY KEY, paid_through INTEGER NOT NULL, invoice TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL);
-- payment_holds: one row per account whose plan payment failed. state: unpaid (read-only, deletion scheduled at delete_at =
-- max(paid_through, failed_at) + 7 days) | paid (fixed in time) | deleting | deleted. Outlives the account (deletion.js leaves it):
-- the final email and the double-fire guard need it; email and slug are blanked once that email is sent.
CREATE TABLE IF NOT EXISTS payment_holds (tenant_id TEXT PRIMARY KEY, sub_id TEXT NOT NULL DEFAULT '', slug TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', tz TEXT NOT NULL DEFAULT '', failed_at INTEGER NOT NULL, paid_through INTEGER NOT NULL, delete_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'unpaid', resolved_at INTEGER, started_at INTEGER, deleted_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS payment_holds_state ON payment_holds(state, delete_at);
-- Every notice of one episode (failed_at), claimed before it's sent so none repeats: failed | text | window | d1 | deleted.
-- delivered=0: not sent (a test address, texting off, or covered by the first email).
CREATE TABLE IF NOT EXISTS payment_hold_notices (tenant_id TEXT NOT NULL, kind TEXT NOT NULL, failed_at INTEGER NOT NULL, sent_at INTEGER NOT NULL, delivered INTEGER NOT NULL DEFAULT 1, subject TEXT NOT NULL DEFAULT '', PRIMARY KEY (tenant_id, kind, failed_at));
