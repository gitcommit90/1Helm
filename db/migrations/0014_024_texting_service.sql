-- 10-06 Texting from Android: which service the person's phone is on, so sends suit it (purely additive).
-- service: imessage | sms | rcs | not_imessage (Apple's lookup said no) | NULL (not known yet). service_at: when it was last checked.
ALTER TABLE texting ADD COLUMN service TEXT;
ALTER TABLE texting ADD COLUMN service_at INTEGER;
