-- Agent check-ins get an on/off switch, off by default. Additive only: a new nullable column, no backfill.
-- NULL means the row was saved before the switch existed. Those rows hold numbers the person chose, so the code reads NULL as on.
-- Accounts with no row are off (the new default). Apply it before deploying the code: the new code reads and writes this column.
ALTER TABLE agent_checkin_prefs ADD COLUMN enabled INTEGER CHECK (enabled IN (0, 1));
