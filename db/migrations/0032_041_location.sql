-- 10-07 Location (src/location.js). Purely additive: one new table, ONE row per account, the last known coarse fix from the app
-- (lat/lng rounded to about 1 km) and its city-level place name. A new fix replaces it; no history is kept.
-- "Forget my location" deletes the row; deleting the account deletes it too (deletion.js: every table with tenant_id).
CREATE TABLE IF NOT EXISTS tenant_location (tenant_id TEXT PRIMARY KEY, lat REAL NOT NULL, lng REAL NOT NULL, place TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
