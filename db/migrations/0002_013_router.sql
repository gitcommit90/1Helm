-- 10-01 Own router (Jev's method, our pool). Nightly pool snapshots + per-message shadow decisions next to Jev's real pick.
CREATE TABLE IF NOT EXISTS router_pool (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, pairs TEXT NOT NULL, changes TEXT, info TEXT);
CREATE TABLE IF NOT EXISTS router_shadow (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, tenant_id TEXT, channel TEXT, session TEXT, turn TEXT, ours TEXT NOT NULL, jev TEXT, clef_nano INTEGER);
CREATE INDEX IF NOT EXISTS router_shadow_at ON router_shadow(at);
