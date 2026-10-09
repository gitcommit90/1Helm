-- Internal parity review records. Retained for schema compatibility.
CREATE TABLE IF NOT EXISTS parity_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, doc TEXT NOT NULL, side TEXT NOT NULL DEFAULT 'doc', quote TEXT NOT NULL DEFAULT '', text TEXT NOT NULL, author TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL, resolved INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS parity_notes_doc ON parity_notes(doc, at);
CREATE TABLE IF NOT EXISTS parity_status (doc TEXT PRIMARY KEY, status TEXT NOT NULL, at INTEGER NOT NULL);
