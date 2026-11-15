-- Exact location: the device's accuracy in meters, and the spot and time the saved place name was looked up for
-- (so a new name is looked up only after a move of more than 150 m or when the name is a day old). Purely additive: new nullable columns.
-- src/location.js works without them (it falls back to the older columns).
ALTER TABLE tenant_location ADD COLUMN accuracy_m REAL;
ALTER TABLE tenant_location ADD COLUMN place_lat REAL;
ALTER TABLE tenant_location ADD COLUMN place_lng REAL;
ALTER TABLE tenant_location ADD COLUMN place_at INTEGER;
