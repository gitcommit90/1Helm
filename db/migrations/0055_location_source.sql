-- Memory envelope (the design notes): the location fix exactly as the app sent it, beside the rounded copy location.js keeps.
-- Purely additive: two new nullable columns. src/location.js works without them (it skips writing them and reads only lat and lng).
ALTER TABLE tenant_location ADD COLUMN src_lat REAL;
ALTER TABLE tenant_location ADD COLUMN src_lng REAL;
