-- mem: an index on id, so a lookup by id does not scan the table.
CREATE INDEX IF NOT EXISTS mem_id ON mem(id);
