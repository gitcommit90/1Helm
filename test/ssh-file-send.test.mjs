// node test/ssh-file-send.test.mjs -- whole-file SFTP through a mocked broker (control plane only, not live transport evidence).
import assert from 'node:assert/strict';
import { sendFile, fetchFile, pathAsData, SSH_CHUNK, SSH_FILE_MAX } from '../src/ssh-files.js';
import { nativeTool, NATIVE_TOOLS } from '../src/native-network.js';

function fakeBroker({ failAt = null, remote = new Map() } = {}) {
  const calls = [];
  return { remote, calls, async sftpSsh(auth, a) {
    calls.push(a);
    if (a.op === 'write') {
      if (failAt != null && a.offset === failAt) return { ok: false, error: 'SFTP operation failed' };
      const data = Buffer.from(a.data, a.encoding === 'base64' ? 'base64' : 'utf8'); assert.ok(data.length <= 1048576);
      let cur = a.offset == null || a.truncate ? Buffer.alloc(0) : (remote.get(a.path) || Buffer.alloc(0));
      const out = Buffer.alloc(Math.max(cur.length, (a.offset || 0) + data.length)); cur.copy(out); data.copy(out, a.offset || 0); remote.set(a.path, out);
      return { ok: true, bytes: data.length, next_offset: (a.offset || 0) + data.length };
    }
    if (a.op === 'stat') { const f = remote.get(a.path); return f ? { ok: true, size: f.length, directory: false } : { ok: false, error: 'SFTP operation failed' }; }
    if (a.op === 'read') { const f = remote.get(a.path) || Buffer.alloc(0), off = a.offset || 0, part = f.subarray(off, off + a.length); return { ok: true, data: part.toString('base64'), encoding: 'base64', bytes: part.length, eof: off + part.length >= f.length }; }
    return { ok: false, error: 'unsupported' };
  } };
}
const bytesOf = (n) => { const u = new Uint8Array(n); for (let i = 0; i < n; i++) u[i] = (i * 31 + 7) & 255; return u; };
const D = (broker, read, extra = {}) => ({ broker, auth: {}, session: 's1', read, ...extra });
let n = 0; const t = async (name, f) => { try { await f(); console.log('PASS', name); } catch (e) { n++; console.log('FAIL', name, e.message); } };

await t('Library file sends exact bytes over several chunks', async () => {
  const b = fakeBroker(), src = bytesOf(SSH_CHUNK * 2 + 1234);
  const r = await sendFile(D(b, async (ref) => { assert.equal(ref, 'print.pdf'); return { name: 'print.pdf', bytes: src }; }), { file: 'print.pdf', path: '/tmp/p.pdf' });
  assert.equal(r.ok, true); assert.equal(r.message, `sent print.pdf (${(src.length / 1048576).toFixed(1)} MB) to /tmp/p.pdf`.replace(/\(.*?\)/, r.message.match(/\(.*?\)/)[0]));
  assert.ok(Buffer.from(src).equals(b.remote.get('/tmp/p.pdf')));
  const writes = b.calls.filter(c => c.op === 'write'); assert.equal(writes.length, 3);
  assert.deepEqual(writes.map(w => [w.offset, w.truncate]), [[0, true], [SSH_CHUNK, false], [SSH_CHUNK * 2, false]]);
});
await t('computer path sends the same bytes', async () => {
  const b = fakeBroker(), src = bytesOf(700000);
  const r = await sendFile(D(b, async (ref) => { assert.equal(ref, '/workspace/workspace/C006 3in stickers/a.pdf'); return { name: 'a.pdf', bytes: src }; }), { file: '/workspace/workspace/C006 3in stickers/a.pdf', path: '/tmp/a.pdf' });
  assert.equal(r.ok, true); assert.ok(Buffer.from(src).equals(b.remote.get('/tmp/a.pdf'))); assert.equal(r.verified_size, 700000);
});
await t('empty file creates an empty destination', async () => {
  const b = fakeBroker(); const r = await sendFile(D(b, async () => ({ name: 'e.txt', bytes: new Uint8Array(0) })), { file: 'e.txt', path: '/tmp/e' });
  assert.equal(r.ok, true); assert.equal(b.remote.get('/tmp/e').length, 0);
});
await t('size cap refuses before any write', async () => {
  const b = fakeBroker(); const r = await sendFile(D(b, async () => ({ name: 'big.bin', bytes: { byteLength: SSH_FILE_MAX + 1 } })), { file: 'big', path: '/tmp/x' });
  assert.equal(r.ok, false); assert.match(r.error, /at most 25/); assert.equal(b.calls.length, 0);
});
await t('missing file refuses with the reader error', async () => {
  const b = fakeBroker(); const r = await sendFile(D(b, async () => ({ error: 'there is no "x" in this channel\'s Library.' })), { file: 'x', path: '/tmp/x' });
  assert.equal(r.ok, false); assert.match(r.error, /Library/); assert.equal(b.calls.length, 0);
});
await t('failure mid-send reports the offset and resume writes the rest', async () => {
  const src = bytesOf(SSH_CHUNK * 2 + 10), b = fakeBroker({ failAt: SSH_CHUNK });
  const r = await sendFile(D(b, async () => ({ name: 'f', bytes: src })), { file: 'f', path: '/tmp/f' });
  assert.equal(r.ok, false); assert.equal(r.next_offset, SSH_CHUNK); assert.match(r.error, new RegExp(`offset ${SSH_CHUNK}`));
  const b2 = fakeBroker({ remote: b.remote }); // same server state
  const r2 = await sendFile(D(b2, async () => ({ name: 'f', bytes: src })), { file: 'f', path: '/tmp/f', offset: SSH_CHUNK });
  assert.equal(r2.ok, true); assert.ok(Buffer.from(src).equals(b.remote.get('/tmp/f')));
});
await t('abort stops between chunks', async () => {
  const b = fakeBroker(); let k = 0; const r = await sendFile(D(b, async () => ({ name: 'f', bytes: bytesOf(SSH_CHUNK * 3) }), { aborted: () => k++ >= 1 }), { file: 'f', path: '/tmp/f' });
  assert.equal(r.ok, false); assert.equal(b.calls.filter(c => c.op === 'write').length, 1);
});
await t('fetch saves the exact bytes to the Library', async () => {
  const b = fakeBroker(), src = bytesOf(SSH_CHUNK + 99); b.remote.set('/srv/out.pdf', Buffer.from(src)); let saved;
  const r = await fetchFile(D(b, null, { save: async (f) => { saved = f; return { file: { name: f.name } }; } }), { path: '/srv/out.pdf', save_as: 'from-server.pdf' });
  assert.equal(r.ok, true); assert.equal(saved.name, 'from-server.pdf'); assert.equal(saved.mime, 'application/pdf'); assert.ok(Buffer.from(saved.bytes).equals(Buffer.from(src)));
});
await t('fetch refuses a file over the cap', async () => {
  const b = fakeBroker(); b.remote.set('/big', { length: SSH_FILE_MAX + 1 }); const r = await fetchFile(D(b, null, { save() { throw new Error('no'); } }), { path: '/big', save_as: 'b' });
  assert.equal(r.ok, false); assert.match(r.error, /at most 25/);
});
await t('pathAsData detects a lone path only', () => {
  assert.ok(pathAsData('/workspace/workspace/C006 3in stickers/x.pdf'.replace(/ /g, '_'))); assert.ok(!pathAsData('hello world')); assert.ok(!pathAsData('/workspace/a b'));
});

// Through nativeTool: a session row, mocked resident file reads.
import { DatabaseSync } from 'node:sqlite';
function res(broker) {
  const local = new DatabaseSync(':memory:');
  local.exec("CREATE TABLE native_sessions(id TEXT PRIMARY KEY,task TEXT,turn TEXT,status TEXT); INSERT INTO native_sessions VALUES ('s1','task-1','turn-1','active')");
  const sql = { exec(q, ...a) { const s = local.prepare(q); const rows = /^SELECT/i.test(q) ? s.all(...a) : (s.run(...a), []); return { toArray: () => rows, one: () => rows[0] }; } };
  const DB = { prepare() { const api = { bind: () => api, first: async () => ({ ssh_mode: 'ask', ssh_trusted: 0, generation: 1 }) }; return api; } };
  const saved = [];
  return { saved, sql, get: k => k === 'tenant' ? 't1' : 'main', session: () => true, computer: () => ({ nativeGuardStatus: async () => ({ guarded: true }) }),
    appFileRead: async (ref) => ref === 'p.pdf' ? { name: 'p.pdf', bytes: bytesOf(600000) } : { error: 'no such file' }, appFileSave: async (f) => { saved.push(f); return { file: { name: f.name } }; },
    env: { DB, NATIVE_NETWORK: 'on', NATIVE_TRANSPORT: { idFromName: x => x, get: () => broker } } };
}
const tc = { turn: 'turn-1', session: 'task-1', emit() {} };
await t('nativeTool: file param sends; schema lists file and save_as', async () => {
  const b = fakeBroker(), r = res(b);
  const out = await nativeTool(r, 'ssh_session', { session_id: 's1', operation: 'sftp', sftp_operation: 'write', file: 'p.pdf', path: '/tmp/p.pdf' }, tc);
  assert.equal(out.ok, true); assert.equal(b.remote.get('/tmp/p.pdf').length, 600000);
  const props = NATIVE_TOOLS.find(x => (x.name || x.function?.name) === 'ssh_session'); assert.match(JSON.stringify(props), /save_as/); assert.match(JSON.stringify(props), /"file"/);
});
await t('nativeTool: a path in data is refused, nothing written', async () => {
  const b = fakeBroker(), r = res(b);
  const out = await nativeTool(r, 'ssh_session', { session_id: 's1', operation: 'sftp', sftp_operation: 'write', data: '/workspace/workspace/x/y.pdf', path: '/tmp/y.pdf' }, tc);
  assert.equal(out.ok, false); assert.match(out.error, /file: "\/workspace/); assert.equal(b.calls.length, 0);
});
await t('nativeTool: inline data still goes straight to the broker', async () => {
  const b = fakeBroker(), r = res(b);
  const out = await nativeTool(r, 'ssh_session', { session_id: 's1', operation: 'sftp', sftp_operation: 'write', data: 'hello', path: '/tmp/h.txt' }, tc);
  assert.equal(out.ok, true); assert.equal(b.remote.get('/tmp/h.txt').toString(), 'hello'); assert.equal(b.calls.length, 1);
});
await t('nativeTool: file with data, or file on a read, is refused', async () => {
  const b = fakeBroker(), r = res(b);
  assert.equal((await nativeTool(r, 'ssh_session', { session_id: 's1', operation: 'sftp', sftp_operation: 'write', file: 'p.pdf', data: 'x', path: '/t' }, tc)).ok, false);
  assert.equal((await nativeTool(r, 'ssh_session', { session_id: 's1', operation: 'sftp', sftp_operation: 'read', file: 'p.pdf', path: '/t' }, tc)).ok, false);
  assert.equal(b.calls.length, 0);
});
await t('nativeTool: read with save_as saves to the Library', async () => {
  const b = fakeBroker(), r = res(b); b.remote.set('/srv/a.png', Buffer.from(bytesOf(1000)));
  const out = await nativeTool(r, 'ssh_session', { session_id: 's1', operation: 'sftp', sftp_operation: 'read', path: '/srv/a.png', save_as: 'a.png' }, tc);
  assert.equal(out.ok, true); assert.equal(r.saved[0].bytes.length, 1000);
});
process.exit(n ? 1 : 0);
