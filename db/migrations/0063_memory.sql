-- Mem0 memory (docs/configuration.md, "Memory"). Additive: three new tables, nothing existing changes.
-- mem: one row per fact (and per Mem0 entity). payload is Mem0's JSON (data, doc, ts, source, category, createdAt, ...). ns is one channel's memory.
CREATE TABLE IF NOT EXISTS mem (
  ns TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,
  doc TEXT GENERATED ALWAYS AS (json_extract(payload, '$.doc')) VIRTUAL,
  PRIMARY KEY (ns, id)
);
CREATE INDEX IF NOT EXISTS mem_doc ON mem (ns, doc);
CREATE TABLE IF NOT EXISTS mem_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ns TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT,
  action TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT,
  is_deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS mem_history_memory ON mem_history (memory_id);
-- The keyword index. t is Mem0's lemmatized text; entity rows have none and are not indexed.
CREATE VIRTUAL TABLE IF NOT EXISTS mem_fts USING fts5 (ns, t);
CREATE TRIGGER IF NOT EXISTS mem_fts_insert AFTER INSERT ON mem WHEN json_extract(new.payload, '$.textLemmatized') IS NOT NULL BEGIN
  INSERT INTO mem_fts (rowid, ns, t) VALUES (new.rowid, new.ns, json_extract(new.payload, '$.textLemmatized'));
END;
CREATE TRIGGER IF NOT EXISTS mem_fts_update AFTER UPDATE OF payload ON mem WHEN json_extract(new.payload, '$.textLemmatized') IS NOT NULL BEGIN
  DELETE FROM mem_fts WHERE rowid = old.rowid;
  INSERT INTO mem_fts (rowid, ns, t) VALUES (new.rowid, new.ns, json_extract(new.payload, '$.textLemmatized'));
END;
CREATE TRIGGER IF NOT EXISTS mem_fts_delete AFTER DELETE ON mem BEGIN
  DELETE FROM mem_fts WHERE rowid = old.rowid;
END;
