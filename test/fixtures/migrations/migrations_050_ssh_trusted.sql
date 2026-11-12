-- Additive: older Workers continue treating opted-in accounts as Ask.
-- Existing/new accounts remain Deny (or their explicitly selected Ask).
ALTER TABLE direct_network_permissions ADD COLUMN ssh_trusted INTEGER NOT NULL DEFAULT 0 CHECK (ssh_trusted IN (0,1));
