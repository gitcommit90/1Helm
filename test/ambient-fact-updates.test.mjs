// Offline replay of the exact synthetic deployed extractor mistake, plus guards.
// Optional AMBIENT_BEFORE_MODULE proves pending old-draft invalidation without paid calls.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { AmbientStore, ambientLines, validateAmbient } from '../src/ee/ambient.js';
import { ambientReviewInput, applyAmbientReview } from '../src/ee/ambient-review.js';
import { speechActConversation } from './fixtures/ambient-speech-acts.mjs';
import { retainReview } from './ambient-review-stub.mjs';

// Exact provider rows (not a guessed paraphrase) from the failed synthetic live
// run on 2026-10-11. Only the two ladder rows are needed to replay the taxonomy gap.
const raw = { items: [
  { kind: 'task', speech_act: 'intention', quote: 'I need to return the borrowed folding ladder to Theo today.', line: 27, status: 'open', due_text: 'today', relation: null, supersedes: [] },
  { kind: 'fact', speech_act: 'memory', quote: 'I returned the borrowed folding ladder to Theo just now.', line: 29, status: 'completed', due_text: '', relation: 'completion', supersedes: ['line:27'] },
] };
const lines = ambientLines(speechActConversation());
assert.ok(lines[29].text.includes(raw.items[1].quote));
const replay = validateAmbient(raw, lines);
assert.equal(replay[1].kind, 'task'); assert.equal(replay[1].status, 'completed'); assert.deepEqual(replay[1].supersedes, ['line:27']);
assert.equal(replay[1].text, raw.items[1].quote); assert.equal(replay[1].speech_act, 'memory'); assert.equal(replay[1].evidence[0].utterance_id, 'completion-real');
const reviewInput = ambientReviewInput(replay, lines);
const retained = applyAmbientReview(replay, reviewInput, await retainReview(reviewInput)); assert.equal(retained[1].kind, 'task');
for (const verdict of ['uncertain', 'drop']) {
  const reviewed = applyAmbientReview(replay, reviewInput, { items: reviewInput.candidates.map(c => ({ id: c.id, verdict, reason: verdict === 'drop' ? 'example_or_quotation' : 'ambiguous_speech_act', context: [c.line] })) });
  if (verdict === 'drop') assert.deepEqual(reviewed, []);
  else for (const item of reviewed) { assert.equal(item.kind, 'idea'); assert.equal(item.status, 'open'); assert.deepEqual(item.supersedes, []); }
}

const prior = { id: 'prior', kind: 'task', text: raw.items[0].quote, owner: 'wearer', source_at: 1000 };
const update = (extra = {}, previous = [prior], quote = raw.items[1].quote, speaker = 'wearer') => validateAmbient({ items: [{ ...raw.items[1], line: 0, quote, supersedes: previous.map((_, i) => `previous:${i}`), ...extra }] }, [{ text: quote, speaker, is_user: speaker === 'wearer', at: 2000, offset: 0 }], previous)[0];
for (const kind of ['task', 'reminder']) for (const [quote, status, relation] of [
  [raw.items[1].quote, 'completed', 'completion'],
  ['Actually change the borrowed folding ladder return to Friday.', 'open', 'correction'],
  ['Cancel returning the borrowed folding ladder to Theo.', 'cancelled', 'cancellation'],
  ['I still need to return the borrowed folding ladder again.', 'open', 'reopen'],
]) {
  const item = update({ status, relation }, [{ ...prior, kind }], quote);
  assert.equal(item.kind, kind); assert.equal(item.status, status); assert.deepEqual(item.supersedes, ['prior']);
  assert.equal(item.notification_status, kind === 'reminder' ? 'not_scheduled' : undefined); assert.equal(item.due_at, null);
}
for (const kind of ['task', 'reminder']) {
  const p = { ...prior, kind };
  assert.equal(update({ speech_act: 'uncertain' }, [p]).kind, 'idea');
  assert.equal(update({ speech_act: 'tentative_intention' }, [p]).kind, 'fact');
  assert.equal(update({}, [p], 'Maybe I returned the borrowed folding ladder.').kind, 'fact');
  assert.equal(update({ speech_act: 'example' }, [p]), undefined);
  assert.equal(update({ speech_act: 'quotation' }, [p]), undefined);
  assert.equal(update({ supersedes: [] }, [p]).kind, 'fact');
  assert.equal(update({ supersedes: ['previous:0', 'missing'] }, [p]).kind, 'fact');
  assert.equal(update({}, [p, { ...p, id: 'mixed', kind: 'idea' }]).kind, 'fact');
  assert.equal(update({}, [{ ...p, owner: 'guest' }]).kind, 'fact');
  assert.equal(update({}, [{ ...p, source_at: 3000 }]).kind, 'fact');
  assert.equal(update({}, [{ ...p, text: 'Buy ink cartridges for the printer.' }]).kind, 'fact');
  assert.equal(update({ status: 'open', relation: 'correction' }, [p], `Change the borrowed folding ladder return: make it a fact, not a ${kind}.`).kind, 'fact');
  assert.equal(update({ status: 'open', relation: 'correction' }, [p], 'Change the borrowed folding ladder return: make it a fact.').kind, 'fact');
}
assert.equal(update({}, [{ ...prior, kind: 'fact' }]).kind, 'fact', 'completed standalone facts never become tasks');
assert.equal(update({}, []).kind, 'fact');

function fixture(Store = AmbientStore) {
  const db = new DatabaseSync(':memory:'), kv = new Map([['tenant', 'fixture'], ['status', 'active']]);
  db.exec('CREATE TABLE convs(id INTEGER PRIMARY KEY,start_time INTEGER,r2_key TEXT)');
  const sql = { exec(q, ...args) { if (!args.length && q.split(';').filter(x => x.trim()).length > 1) { db.exec(q); return { toArray: () => [] }; } const st = db.prepare(q), rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...args) : (st.run(...args), []); return { toArray: () => rows }; } };
  const host = { sql, gen: 0, ctx: { storage: { transactionSync: f => f() } }, get: k => kv.get(k), put: (k, v) => v == null ? kv.delete(k) : kv.set(k, String(v)), tid: () => 'fixture', arm: async () => {}, bump() {}, ledger: () => ({ settle: async () => {} }), env: {
    OPENROUTER_API_KEY: 'unit-no-network', WS: { get: async () => null }, DB: { prepare() { return { bind() { return this; }, first: async () => ({ status: 'active', plan: 'plus' }) }; } },
    RESIDENT: { idFromName: x => x, get: () => ({ ambientPrivacy: async texts => ({ mode: 'on', allowed: texts.map((_, i) => i) }) }) },
  } };
  return { db, host, store: new Store(host) };
}
const conv = speechActConversation();
const F = fixture(); F.store.extract = async () => raw; F.store.review = retainReview;
await F.store.ingest('fixture', 'ladder', conv); await F.store.run(true);
const current = F.store.query({ kind: 'task', status: 'completed' }).items;
assert.equal(current.length, 1); assert.equal(current[0].text, raw.items[1].quote); assert.equal(current[0].semantic_review.verdict, 'retain');
assert.ok(current[0].earlier_evidence.some(e => e.quote === raw.items[0].quote));
assert.equal(F.store.query({ kind: 'task', status: 'open' }).items.length, 0); assert.equal(F.store.query({ kind: 'fact' }).items.length, 0);
F.store.extract = async () => assert.fail('done source must not re-extract'); assert.equal(await F.store.ingest('fixture', 'ladder', conv), false); await F.store.run(true); F.db.close();

if (process.env.AMBIENT_BEFORE_MODULE) {
  const before = await import(pathToFileURL(process.env.AMBIENT_BEFORE_MODULE));
  assert.equal(before.validateAmbient(raw, lines)[1].kind, 'fact', 'exact old code reproduces deployed mistake');
  const old = fixture(before.AmbientStore); let calls = 0;
  old.store.extract = async () => { calls++; return raw; }; old.store.review = async () => { throw Error('fixture review transient failure'); };
  await old.store.ingest('fixture', 'ladder', conv); await old.store.run(true);
  const cached = old.db.prepare('SELECT draft_key,draft_json,tries FROM ambient_chunks').get(); assert.equal(JSON.parse(cached.draft_json)[1].kind, 'fact'); assert.ok(cached.draft_key); assert.equal(calls, 1);
  old.db.prepare('UPDATE ambient_chunks SET retry_at=0').run();
  const fresh = new AmbientStore(old.host); fresh.extract = async () => { calls++; return raw; }; fresh.review = retainReview;
  await fresh.run(true); assert.equal(calls, 2, 'pending old draft invalidates once and re-extracts under new validator');
  assert.equal(fresh.query({ kind: 'task', status: 'completed' }).items.length, 1);
  const done = old.db.prepare('SELECT state,tries,draft_json FROM ambient_chunks').get(); assert.equal(done.state, 'done'); assert.equal(done.tries, cached.tries); assert.equal(done.draft_json, null);
  await fresh.run(true); assert.equal(calls, 2, 'done source does not replay'); old.db.close();
  console.log('PASS exact old-provider replay and old-code pending-draft retry transition without done-source reprocessing');
}
console.log('PASS fact-like task/reminder updates, all relation guards, reviewer ambiguity/demo authority, real filtered-query persistence');

