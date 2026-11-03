// A replaced file: the old reply keeps v1 and the new reply gets v2; both versions are served by number, and deleting the file drops every version.
// node --import ./test/stubs/register.mjs test/file-versions-served.test.mjs
import { world, assert } from './deploy-harness.mjs';

const W = world(), R = W.R, sid = R.newSession('Versions fixture');
const M = new Map();
R.env.WS = { async put(k, v) { M.set(k, v); }, async head(k) { return M.has(k) ? { size: M.get(k).length } : null; }, async get(k) { return M.has(k) ? { arrayBuffer: async () => M.get(k).buffer } : null; }, async delete(ks) { for (const k of [].concat(ks)) M.delete(k); } };
try {
  const put = (key, text) => R.env.WS.put(key, new TextEncoder().encode(text));
  const turn = (id, at) => R.sql.exec("INSERT INTO turns (id, session, at, kind, user_text, reply) VALUES (?,?,?,?,?,?)", id, sid, at, 'chat', 'q', 'a');
  turn('turn-1', 1); turn('turn-2', 2);
  await put('t/t1/files/main/f-img', 'v1-bytes');
  const f = R.addFileRow({ id: 'f-img', name: 'character-reference.png', mime: 'image/png', bytes: 8, r2key: 't/t1/files/main/f-img', source: 'helper', session: sid, turn: 'turn-1', synced: 0 });
  R.recordShare(f, 'turn-1');
  await put('t/t1/files/main/f-img.v2', 'v2-bytes');
  const target = R.sql.exec("SELECT * FROM files WHERE id='f-img'").one();
  await R.putVersion(target, { key: 't/t1/files/main/f-img.v2', bytes: 8, session: sid, turn: 'turn-2' });
  R.recordShare(target, 'turn-2');
  const t1 = R.sharedForTurn('turn-1'), t2 = R.sharedForTurn('turn-2');
  assert.deepEqual(t1.map((x) => [x.id, x.version]), [['f-img', 1]], 'the old reply still lists the file at v1');
  assert.deepEqual(t2.map((x) => [x.id, x.version]), [['f-img', 2]], 'the new reply lists the same file at v2');
  assert.equal(R.sql.exec("SELECT turn FROM files WHERE id='f-img'").one().turn, 'turn-2', 'the file row itself moved to the newer turn');
  const text = async (k) => new TextDecoder().decode(await (await R.env.WS.get(k)).arrayBuffer());
  assert.equal(await text(R.fvVersionKey('f-img', 1).key), 'v1-bytes', 'version 1 is still stored and served');
  assert.equal(await text(R.fvVersionKey('f-img', 2).key), 'v2-bytes');
  assert.equal(await text(R.fvVersionKey('f-img', 9).key), 'v2-bytes', 'an unknown version gets the current bytes, as before');
  // a third edit does not delete v1 (a reply refers to it), and listing both replies still works
  await put('t/t1/files/main/f-img.v3', 'v3-bytes');
  await R.putVersion(R.sql.exec("SELECT * FROM files WHERE id='f-img'").one(), { key: 't/t1/files/main/f-img.v3', bytes: 8, session: sid, turn: 'turn-3' });
  assert.equal(await text(R.fvVersionKey('f-img', 1).key), 'v1-bytes', 'v1 survives later replacements while a reply refers to it');
  assert.equal(R.sharedForTurn('turn-1').length, 1); assert.equal(R.sharedForTurn('turn-2').length, 1, 'both replies keep their card');
  // a file with no saved version (an old message) is found by files.turn as before
  R.addFileRow({ id: 'f-old', name: 'old.txt', mime: 'text/plain', bytes: 1, r2key: 'k-old', source: 'helper', session: sid, turn: 'turn-1', synced: 0 });
  assert.deepEqual(R.sharedForTurn('turn-1').map((x) => x.id).sort(), ['f-img', 'f-old']);
  // deleting the file deletes every version
  await R.deleteFile('f-img');
  for (const k of ['t/t1/files/main/f-img', 't/t1/files/main/f-img.v2', 't/t1/files/main/f-img.v3']) assert.equal(await R.env.WS.get(k), null, k + ' is deleted');
  assert.equal(R.sql.exec("SELECT COUNT(*) n FROM file_shares WHERE file_id='f-img'").one().n, 0);
} finally { await W.settle(); W.d1.close(); W.dodb.close(); }
console.log('ok file versions: each reply keeps the version it shared, versions are served by number, delete removes all');
