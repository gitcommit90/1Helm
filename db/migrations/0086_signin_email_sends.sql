-- Sign-in emails sent, for the per-network (hourly, daily) and service-wide (hourly) send limits. ip is a hash, never the address. Old rows are swept hourly.
CREATE TABLE IF NOT EXISTS signin_email_sends (ip TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS signin_email_sends_ip ON signin_email_sends (ip, at);
CREATE INDEX IF NOT EXISTS signin_email_sends_at ON signin_email_sends (at);
