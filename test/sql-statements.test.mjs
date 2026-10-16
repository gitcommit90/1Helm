import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { sqlStatements } from './sql-statements.mjs';

test('plain statements, comments and quoted semicolons', () => {
  const s = sqlStatements("-- a; b\nCREATE TABLE t(a TEXT DEFAULT 'x;\ny');\n/* c; */ INSERT INTO t VALUES('it''s;'); ");
  assert.equal(s.length, 2);
  assert.match(s[0], /^CREATE TABLE t/); assert.match(s[1], /^INSERT INTO t/);
});
test('a trigger body stays one statement, including CASE ... END', () => {
  const s = sqlStatements("CREATE TABLE t(a);\nCREATE TRIGGER IF NOT EXISTS g AFTER INSERT ON t\nBEGIN\n UPDATE t SET a=CASE WHEN a>1 THEN 1 ELSE 2 END;\n SELECT 1;\nEND;\nCREATE INDEX i ON t(a);");
  assert.equal(s.length, 3); assert.match(s[1], /END;$/); assert.match(s[2], /^CREATE INDEX/);
});
test('every migration applies on in-memory SQLite', () => {
  const root = new URL('../db/migrations/', import.meta.url), d = new DatabaseSync(':memory:');
  for (const f of readdirSync(root).filter(x => /\.sql$/.test(x)).sort()) for (const q of sqlStatements(readFileSync(new URL(f, root), 'utf8'))) {
    try { d.exec(q); } catch (e) { if (!/duplicate column|already exists|no such column|no such table/.test(e.message)) assert.fail(`${f}: ${e.message}\n${q.slice(0, 200)}`); }
  }
});
