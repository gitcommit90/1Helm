-- Saved logins: several accounts per site (Import from Chrome brings many). The key becomes (tenant_id, site, username).
-- SQLite can't change a primary key in place: build the new table, copy every row, swap it in. Safe to run again
-- (a second run copies the already-migrated table into a fresh one). Deploy the code that upserts on
-- ON CONFLICT(tenant_id,site,username) right after this: older code's ON CONFLICT(tenant_id,site) fails on the new key.
DROP TABLE IF EXISTS logins_new;
CREATE TABLE logins_new (tenant_id TEXT NOT NULL, site TEXT NOT NULL, username TEXT NOT NULL DEFAULT '', sealed TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (tenant_id, site, username));
INSERT OR REPLACE INTO logins_new (tenant_id, site, username, sealed, created_at) SELECT tenant_id, site, username, sealed, created_at FROM logins;
DROP TABLE logins;
ALTER TABLE logins_new RENAME TO logins;
