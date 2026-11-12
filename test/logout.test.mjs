// Run: node --import ./test/stubs/register.mjs test/logout.test.mjs
// Logging out revokes every session cookie the browser sends, so a second stale cookie cannot restore the sign-in,
// and it leaves other devices signed in. A storage failure is reported to the caller instead of being ignored.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { endSession } from '../src/account.js';

const sql = new DatabaseSync(':memory:');
sql.exec(`CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT, expires_at INTEGER);`);
const hash = token => createHash('sha256').update(token).digest('hex');
const add = token => sql.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(hash(token), 'owner', Date.now() + 60000);
const exists = token => !!sql.prepare('SELECT 1 FROM sessions WHERE token_hash=?').get(hash(token));
let failDelete = false;
const DB = {
  prepare(query) {
    let values = [];
    const run = () => { if (failDelete && query.startsWith('DELETE FROM sessions')) throw Error('simulated storage failure'); return sql.prepare(query).run(...values); };
    const statement = { bind(...args) { values = args; return statement; }, async run() { return run(); }, _run: run };
    return statement;
  },
  async batch(statements) {
    sql.exec('BEGIN');
    try { const results = statements.map(statement => statement._run()); sql.exec('COMMIT'); return results; }
    catch (error) { sql.exec('ROLLBACK'); throw error; }
  },
};
const env = { DB };
const request = cookie => new Request('https://example.test/auth/logout', { method: 'POST', headers: { cookie } });

sql.exec('DELETE FROM sessions'); add('aa11'); add('bb22'); add('cc33');
await endSession(env, request('hc_session=aa11; other=present; hc_session=bb22; hc_session=aa11'));
assert.equal(exists('aa11'), false, 'the first presented session is revoked');
assert.equal(exists('bb22'), false, 'a second cookie must not restore the sign-in');
assert.equal(exists('cc33'), true, 'another device stays signed in');

await endSession(env, request('hc_session=aa11'));
await endSession(env, request('other=present'));
assert.equal(exists('cc33'), true, 'logging out again, or with no session cookie, changes nothing');

add('dd44'); failDelete = true;
await assert.rejects(endSession(env, request('hc_session=dd44')), /simulated storage failure/);
assert.equal(exists('dd44'), true, 'a failed revoke does not look like a success');
console.log('logout revokes every presented session, keeps other devices, and reports storage failures');
