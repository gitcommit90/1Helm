-- Self-attestation only, never a verified age or birth date. NULL means no recorded acknowledgement (legacy account/link).
ALTER TABLE users ADD COLUMN age_version TEXT;
ALTER TABLE users ADD COLUMN age_confirmed_at INTEGER;
ALTER TABLE magic_links ADD COLUMN age_version TEXT;
ALTER TABLE magic_links ADD COLUMN age_confirmed_at INTEGER;
