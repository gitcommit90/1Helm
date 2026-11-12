-- Main applies on dev immediately before the corrective deployment. Old
-- Resident objects may linger and read the raw value; remove that authority too.
-- No direct-network permissions, saved exceptions or other presets are changed.
UPDATE perm_prefs SET level='standard', updated_at=unixepoch()*1000 WHERE level='trusted';
