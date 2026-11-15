// The timing and stale-answer rules of the ranked task search (src/task-search.ts), with a stubbed search endpoint and a manual clock.
//   node test/task-search.test.mjs
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const code = (await build({ entryPoints: ['src/task-search.ts'], bundle: true, write: false, format: 'esm' })).outputFiles[0].text;
const { createRankedSearch, rankedRows } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

// A manual clock, and an endpoint whose answers the test releases by hand.
function rig({ delay = 300 } = {}) {
  let now = 0, timers = []; const asked = [], paints = [];
  const setTimer = (fn, ms) => { const t = { at: now + ms, fn }; timers.push(t); return t; }, clearTimer = (t) => { timers = timers.filter(x => x !== t); };
  const tick = async (ms) => { const end = now + ms; for (;;) { const next = timers.filter(t => t.at <= end).sort((a, b) => a.at - b.at)[0]; if (!next) break; now = next.at; timers = timers.filter(t => t !== next); next.fn(); } now = end; await Promise.resolve(); await Promise.resolve(); };
  const s = createRankedSearch({ delay, setTimer, clearTimer, onChange: () => paints.push(s.ranked(cur.ch, cur.q)),
    fetchRanked: (ch, q, signal) => new Promise((resolve, reject) => { const r = { ch, q, signal, resolve, reject }; asked.push(r); signal.addEventListener('abort', () => reject(new Error('aborted'))); }) });
  const cur = { ch: 'main', q: '' };
  const type = (q, ch = 'main') => { cur.ch = ch; cur.q = q; s.input(ch, q); };
  return { s, asked, paints, tick, type, cur };
}
const hit = (...ids) => ids.map((id, i) => ({ id, score: 1 - i / 10, snippet: null }));
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

{ // one request after a pause, none per keystroke, and the ranked ids are used only for exactly that query
  const r = rig(); r.type('p'); r.type('pl'); await r.tick(100); r.type('plu'); await r.tick(299);
  assert.equal(r.asked.length, 0, 'no request while the person is still typing');
  await r.tick(2); assert.equal(r.asked.length, 1, 'one request after 300 ms of quiet'); assert.equal(r.asked[0].q, 'plu');
  assert.equal(r.s.ranked('main', 'plu'), null, 'until the answer arrives the local filter shows');
  r.asked[0].resolve(hit('b', 'a', 'c')); await flush();
  assert.deepEqual(r.s.ranked('main', 'plu'), ['b', 'a', 'c']); assert.deepEqual(r.s.ranked('main', ' plu '), ['b', 'a', 'c'], 'spaces around the query do not matter');
  assert.equal(r.s.ranked('main', 'plum'), null, 'a ranked list belongs to its query'); assert.equal(r.s.ranked('other', 'plu'), null, 'and to its channel');
  assert.equal(r.paints.length, 1);
}
{ // the stale answer: an older request answers after a newer keystroke, and is ignored
  const r = rig(); r.type('inv'); await r.tick(301); assert.equal(r.asked.length, 1);
  r.type('invo'); assert.equal(r.asked[0].signal.aborted, true, 'the older request is cancelled when the person types again');
  r.asked[0].resolve(hit('old1', 'old2')); await flush();
  assert.equal(r.s.ranked('main', 'inv'), null); assert.equal(r.s.ranked('main', 'invo'), null); assert.equal(r.paints.length, 0, 'the stale answer paints nothing');
  await r.tick(301); assert.equal(r.asked.length, 2); r.asked[1].resolve(hit('new1')); await flush();
  assert.deepEqual(r.s.ranked('main', 'invo'), ['new1']); assert.equal(r.paints.length, 1);
}
{ // answers arriving out of order: the newer query's answer lands first, then the older one's must not replace it (even if the request could not be cancelled)
  const r = rig(); r.type('ab'); await r.tick(301); r.type('abc'); await r.tick(301); assert.equal(r.asked.length, 2);
  r.asked[1].resolve(hit('x', 'y')); await flush(); r.asked[0].resolve(hit('stale')); await flush();
  assert.deepEqual(r.s.ranked('main', 'abc'), ['x', 'y']); assert.equal(r.s.ranked('main', 'ab'), null);
}
{ // a failed request keeps the local result, silently
  const r = rig(); r.type('zz'); await r.tick(301); r.asked[0].reject(new Error('HTTP 500')); await flush();
  assert.equal(r.s.ranked('main', 'zz'), null); assert.equal(r.paints.length, 0);
  r.type('zzz'); await r.tick(301); assert.equal(r.asked.length, 2, 'the next pause tries again');
}
{ // an empty or one character query asks nothing and clears; clear() (Escape) forgets the list and drops a pending answer
  const r = rig(); r.type(''); r.type(' a '); await r.tick(1000); assert.equal(r.asked.length, 0);
  r.type('tax'); await r.tick(301); r.asked[0].resolve(hit('t1')); await flush(); assert.deepEqual(r.s.ranked('main', 'tax'), ['t1']);
  r.type(''); assert.equal(r.s.ranked('main', 'tax'), null, 'clearing the box shows the normal list again');
  r.type('tax2'); await r.tick(301); r.s.clear(); r.asked[1].resolve(hit('late')); await flush(); assert.equal(r.s.ranked('main', 'tax2'), null, 'Escape drops an answer still on its way');
}
{ // typing the same query again after its answer does not ask again
  const r = rig(); r.type('same'); await r.tick(301); r.asked[0].resolve(hit('a')); await flush(); r.type('same'); await r.tick(1000);
  assert.equal(r.asked.length, 1); assert.deepEqual(r.s.ranked('main', 'same'), ['a']);
}
{ // the rows: the channel's tasks in the server's order, unknown ids skipped
  const ss = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }];
  assert.deepEqual(rankedRows(ss, ['c', 'zz', 'a']).map(x => x.title), ['C', 'A']);
}
console.log('PASS ranked task search: one request after a pause, stale answers ignored, failures silent, rows in the server order');
