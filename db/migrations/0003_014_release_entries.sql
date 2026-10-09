-- Releases v2: one open release collects every change (Added / Changed / Fixed) until the Captain says "let's release #N".
ALTER TABLE releases ADD COLUMN summary TEXT NOT NULL DEFAULT '';
ALTER TABLE releases ADD COLUMN tested_at INTEGER;
CREATE TABLE IF NOT EXISTS release_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, release_id INTEGER NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL, text TEXT NOT NULL, files TEXT NOT NULL DEFAULT '[]', commits TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS release_entries_rel ON release_entries(release_id, kind, at);
