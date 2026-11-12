// A watcher that attaches to a running turn after share_file ran gets the shared files in the snapshot and in the open task's live part.
// node --import ./test/stubs/register.mjs test/live-shared-files.test.mjs
import { world, tick, assert } from './deploy-harness.mjs';

const W = world(), R = W.R, sid = R.newSession('Shared file fixture'), events = [];
let tc, finish, arrived;
const ready = new Promise(r => { arrived = r; });
R.runTurnInner = async (_t, _ch, _cid, _text, current) => { tc = current; arrived(); return await new Promise(r => { finish = () => r({ reply: 'Done.', error: null, charge: 0, turn: tc.turn }); }); };
const run = R.runTurn('t1', 'main', '1', 'Synthetic question', e => events.push(e), { session: sid });
await ready;
const readers = [];
async function snapshot() { const rd = (await R.attach(sid)).getReader(); readers.push(rd); return JSON.parse(new TextDecoder().decode((await rd.read()).value).trim()); }
try {
  assert.equal('shared' in await snapshot(), false, 'nothing shared yet, nothing added to the snapshot');
  const mine = R.addFileRow({ id: 'f-helper', name: 'Draft.pdf', mime: 'application/pdf', bytes: 10, r2key: 'k1', source: 'helper', session: sid, turn: tc.turn, synced: 0 });
  R.addFileRow({ id: 'f-upload', name: 'Upload.txt', mime: 'text/plain', bytes: 1, r2key: 'k2', source: 'upload', session: sid, turn: tc.turn, synced: 0 });
  R.addFileRow({ id: 'f-other', name: 'Other.pdf', mime: 'application/pdf', bytes: 1, r2key: 'k3', source: 'helper', session: sid, turn: 'another-turn', synced: 0 });
  const snap = await snapshot();
  assert.deepEqual(snap.shared.map(f => f.id), ['f-helper'], 'only the helper files of this turn, as the reload lists them');
  const live = (await R.sessionDetail(sid)).live;
  assert.deepEqual(live.shared.map(f => f.id), ['f-helper']);
  R.sql.exec("INSERT INTO shots (id, turn, url, caption, at, r2key) VALUES ('s1', ?, '/x.png', 'Chart', 1, 'k9')", tc.turn);
  assert.deepEqual((await snapshot()).images.map(i => i.id), ['s1']);
} finally {
  const drained = readers.map(async rd => { while (!(await rd.read()).done) {} }); finish(); await run; await Promise.all(drained); await W.settle();
  W.d1.close(); W.dodb.close();
}
console.log('ok live shared files: the attach snapshot and the live part carry what was already shared');
