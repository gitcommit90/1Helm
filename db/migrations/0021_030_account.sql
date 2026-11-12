-- Settings → General → Your account (src/account.js). Purely additive.
-- sessions: where and when each sign-in happened, so the person can see their signed-in devices and sign the others out.
--   Rows made before this have created_at NULL (the app shows expires_at - 30 days) and an empty device/place.
ALTER TABLE sessions ADD COLUMN created_at INTEGER;
ALTER TABLE sessions ADD COLUMN ua TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN place TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
-- Changing the sign-in email: a one-time link goes to the NEW address; the switch happens only when it's used.
--   used: 0 pending · 1 used · 2 replaced by a newer request or cancelled.
CREATE TABLE IF NOT EXISTS email_changes (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, old_email TEXT NOT NULL, new_email TEXT NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS email_changes_user ON email_changes (user_id, created_at);
CREATE INDEX IF NOT EXISTS email_changes_new ON email_changes (new_email, created_at);
-- Saved logins: an optional note per login (Add a login / Edit), sealed with VAULT_KEY like the password. '' = no note.
ALTER TABLE logins ADD COLUMN note TEXT NOT NULL DEFAULT '';
