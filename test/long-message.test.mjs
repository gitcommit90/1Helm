import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { splitLongMessage, LONG_MESSAGE, LONG_NAME } from '../src/long-message.js';

const humanBytes = (b) => `${b} B`;
const world = (maxBytes = 50 * 1048576) => { const saved = []; return { saved, o: { maxBytes, humanBytes, save: async (bytes, name) => { const f = { id: `f${saved.length + 1}`, name, bytes }; saved.push({ ...f, text: new TextDecoder().decode(bytes) }); return f; } } }; };

test('20,001 to 100,000 characters stay as message text', async () => {
  for (const n of [20001, 50000, LONG_MESSAGE]) { const w = world(), t = 'a'.repeat(n), r = await splitLongMessage(t, ['x'], w.o);
    assert.equal(r.text, t); assert.deepEqual(r.files, ['x']); assert.equal(w.saved.length, 0); }
});
test('100,001 characters become an attached .md file with the exact text and an empty message', async () => {
  const w = world(), t = ('line é 😀\n  keep spaces  \n').repeat(5000) + 'x'.repeat(10), r = await splitLongMessage('  ' + t + '  ', ['a'], w.o);
  assert.ok(('  ' + t + '  ').length > LONG_MESSAGE);
  assert.equal(r.text, ''); assert.deepEqual(r.files, ['a', 'f1']); assert.equal(w.saved.length, 1);
  assert.equal(w.saved[0].name, LONG_NAME); assert.ok(/\.md$/.test(LONG_NAME)); assert.equal(w.saved[0].text, '  ' + t + '  '); assert.ok(r.title.length <= 300);
});
test('a long message with the maximum number of files is refused with a plain error and saves nothing', async () => {
  const w = world(), r = await splitLongMessage('a'.repeat(LONG_MESSAGE + 1), Array.from({ length: 10 }, (_, i) => `f${i}`), w.o);
  assert.equal(r.status, 400); assert.match(r.error, /at most 10 files/); assert.equal(w.saved.length, 0);
  const ok = await splitLongMessage('a'.repeat(LONG_MESSAGE + 1), Array.from({ length: 9 }, (_, i) => `f${i}`), w.o); assert.equal(ok.files.length, 10);
});
test('text over the per-file limit gets the real limit error', async () => {
  const w = world(100000), r = await splitLongMessage('a'.repeat(LONG_MESSAGE + 1), [], w.o);
  assert.equal(r.status, 413); assert.equal(r.error, 'That text is 100001 B. The limit is 100000 B per file.'); assert.equal(w.saved.length, 0);
  const bytes = await splitLongMessage('é'.repeat(LONG_MESSAGE + 1), [], world(100000).o); assert.equal(bytes.status, 413);   // counted in bytes, not characters
});
test('storage full and an answer to a question are reported, not converted', async () => {
  const o = { maxBytes: 1e9, humanBytes, save: async () => { throw Object.assign(new Error('Storage is full.'), { code: 'storage_full' }); } };
  assert.deepEqual(await splitLongMessage('a'.repeat(LONG_MESSAGE + 1), [], o), { error: 'Storage is full.', status: 507, storage_full: true });
  assert.equal((await splitLongMessage('a'.repeat(LONG_MESSAGE + 1), [], { ...world().o, answer: true })).status, 400);
});
test('routes and send-later no longer cap at 20,000 and use the shared splitter', () => {
  const idx = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8'), res = readFileSync(new URL('../src/resident.js', import.meta.url), 'utf8'), later = readFileSync(new URL('../src/send-later.js', import.meta.url), 'utf8');
  assert.ok(!/length > 20000\) return json/.test(idx)); assert.ok(!/20,000 characters/.test(later) && !/20001/.test(idx));
  assert.match(idx, /String\(message\)\.length > LONG_MESSAGE/); assert.match(res, /async chatStream[\s\S]{0,400}splitLong\(/); assert.match(later, /splitLong\(/);
});
