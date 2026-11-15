-- push_subs: tie each device sign-up to the session that made it, and remember when the device was last seen.
-- session_hash: sha256 of the session cookie that was presented at sign-up (the same hash as sessions.token_hash), so logging that
--   session out, or signing it out from another device, can delete the sign-up. NULL on older rows (they show a generic name and are removed by hand).
-- seen_at: the last time the device told the server it is there (the Mac app's heartbeat). NULL for Web Push and phone rows.
-- Both columns are nullable and additive: old code ignores them.
ALTER TABLE push_subs ADD COLUMN session_hash TEXT;
ALTER TABLE push_subs ADD COLUMN seen_at INTEGER;
CREATE INDEX IF NOT EXISTS push_subs_session ON push_subs (session_hash);
