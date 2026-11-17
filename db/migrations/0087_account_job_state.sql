-- Per-account scheduled jobs (src/account-jobs.js): where the last listing of each job kind stopped (cursor), when the last listing ran and
-- how many messages it sent, and when the last complete pass over all accounts finished and how many messages it sent.
CREATE TABLE IF NOT EXISTS account_job_state (kind TEXT PRIMARY KEY, cursor TEXT NOT NULL DEFAULT '', run_at INTEGER NOT NULL DEFAULT 0, run_count INTEGER NOT NULL DEFAULT 0, done_at INTEGER NOT NULL DEFAULT 0, done_count INTEGER NOT NULL DEFAULT 0, pass_count INTEGER NOT NULL DEFAULT 0);
