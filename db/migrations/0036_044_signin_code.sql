-- Email sign-in code (src/signin-code.js). Purely additive. The sign-in email now carries a 6-digit code beside the link; both live
-- on the same magic_links row, so using either one consumes the sign-in (used=1).
--   code_hash:    HMAC-SHA256 (server key) over this row + email + code. Never the code itself. NULL for rows with no code (handoff tokens).
--   code_tries:   wrong or right guesses made against this row; at 5 the code is dead (the link still works).
--   pending_hash: SHA-256 of the random id in the requesting browser's hc_signin cookie. The code only works in that browser.
ALTER TABLE magic_links ADD COLUMN code_hash TEXT;
ALTER TABLE magic_links ADD COLUMN code_tries INTEGER NOT NULL DEFAULT 0;
ALTER TABLE magic_links ADD COLUMN pending_hash TEXT;
CREATE INDEX IF NOT EXISTS magic_links_pending ON magic_links (pending_hash);
-- Wrong codes, for the per-email (24 h) and per-network (15 min) limits. ip is a hash, never the address. Old rows are swept hourly.
CREATE TABLE IF NOT EXISTS signin_code_fails (email TEXT NOT NULL, ip TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS signin_code_fails_email ON signin_code_fails (email, at);
CREATE INDEX IF NOT EXISTS signin_code_fails_ip ON signin_code_fails (ip, at);
