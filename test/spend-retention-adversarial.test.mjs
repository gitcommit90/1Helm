// Independent pure retention contract checks; no providers, DB or remote writes.
// node test/spend-retention-adversarial.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { RETAIN, trimTurnState, resumedReplyState, diagnosticTrace } from '../src/spend-retention.js';
const final = 'The complete answer is ready for the person to use.';
const unique = n => 'narration_' + createHash('sha256').update(String(n)).digest('hex');
const meta = (text, calls = ['web_search']) => ({ text, calls, later: [] });
const serial = x => JSON.parse(JSON.stringify(x));
const fixture = (n = 400) => {
  const said = Array.from({ length: n }, (_, i) => unique(i)); said.push(final);
  return { said, saidMeta: said.map((s, i) => meta(s, i === n ? [] : ['web_search'])), stats: { charge: 543210, in: 101010, out: 6060, steps: 444, tool_calls: 777, models: Array.from({ length: n }, (_, i) => 'model' + i) }, trace: Array.from({ length: n }, (_, i) => ({ step: i })), stepIn: Array.from({ length: n }, (_, i) => 10000 + i), wmLog: Array.from({ length: n }, (_, i) => ({ step: i })) };
};
let count = 0, failed = 0;
function test(name, fn) { try { fn(); console.log('ok', ++count, name); } catch (e) { failed++; console.error('FAIL', name, e.stack); } }
test('default/ON/nonboolean setting leaves all arrays and state untouched', () => {
  for (const setting of [undefined, true, null, 0, 'false']) {
    const state = fixture(), tc = { spendPauses: setting, contextSteps: Array.from({ length: 300 }, (_, i) => i) }, before = serial({ state, tc });
    assert.equal(trimTurnState(tc, state), 0); assert.deepEqual(serial({ state, tc }), before);
  }
});
test('OFF trims only known narration and diagnostic tails with cumulative accounting intact', () => {
  const state = fixture(), before = serial(state), tc = { spendPauses: false, contextSteps: [...state.trace] };
  assert.equal(trimTurnState(tc, state), 400 - RETAIN);
  assert.deepEqual(state.said, [...before.said.slice(400 - RETAIN, 400), final]);
  assert.deepEqual(state.saidMeta, before.saidMeta.slice(400 - RETAIN));
  for (const key of ['charge', 'in', 'out', 'steps', 'tool_calls']) assert.equal(state.stats[key], before.stats[key]);
  assert.deepEqual(state.trace, before.trace.slice(-RETAIN)); assert.deepEqual(tc.contextSteps, before.trace.slice(-RETAIN));
  assert.deepEqual(state.wmLog, before.wmLog.slice(-RETAIN));
  assert.deepEqual(state.stepIn, [before.stepIn[0], ...before.stepIn.slice(-(RETAIN - 1))]);
  assert.deepEqual(state.stats.models, [before.stats.models[0], ...before.stats.models.slice(-(RETAIN - 1))]);
  assert.equal(tc.progressOmitted, 272); assert.equal(trimTurnState(tc, state), 0); assert.equal(tc.progressOmitted, 272);
});
test('questions, links, code, cards, unknown and mismatched metadata never trimmed', () => {
  const state = fixture();
  const protectedParts = ['Which option?', '[Read this](/files/guide)', 'https://example.com/receipt', '```js\nconst x=1;\n```', 'root = Stack([a])\na = Say("Choose")', 'Unknown resumed text remains visible.', 'Metadata no longer matches this text.'];
  const protectedMeta = protectedParts.map((s, i) => i === 5 ? null : i === 6 ? meta('DIFFERENT TEXT') : meta(s));
  state.said.splice(0, 0, ...protectedParts); state.saidMeta.splice(0, 0, ...protectedMeta);
  const tc = { spendPauses: false }; trimTurnState(tc, state);
  assert.deepEqual(state.said.slice(0, protectedParts.length), protectedParts); assert.deepEqual(state.saidMeta.slice(0, protectedParts.length), protectedMeta);
  assert.equal(state.said.at(-1), final); assert.equal(state.saidMeta.length, state.said.length);
});
test('bookkeeping answer and current closing text survive narration trim', () => {
  const state = fixture(); state.said.pop(); state.saidMeta.pop();
  const answer = 'The actual answer was already supplied before saving this note.';
  state.said.push(answer, 'Done.'); state.saidMeta.push(meta(answer, ['remember']), meta('Done.', []));
  trimTurnState({ spendPauses: false }, state);
  assert.deepEqual(state.said.slice(-2), [answer, 'Done.']); assert.deepEqual(state.saidMeta.slice(-2).map(m => m.text), [answer, 'Done.']);
});
test('snapshot tail keeps current body/protected pre, reports omissions and copies arrays', () => {
  const state = fixture(), events = [], body = 'Partial answer still streaming', pre = ['Keep this question?'];
  const tc = { spendPauses: false, turn: 'fixture', replyState: { body, pre: [...pre], prog: state.said.slice(0, -1), held_progress: state.said.at(-2) }, emit: e => events.push(e) };
  trimTurnState(tc, state);
  assert.equal(tc.replyState.body, body); assert.deepEqual(tc.replyState.pre, pre); assert.equal(tc.replyState.held_progress, unique(399));
  assert.equal(tc.replyState.prog.length, RETAIN); assert.equal(tc.replyState.progress_omitted, 272);
  assert.equal(events.length, 1); assert.equal(events[0].t, 'snapshot'); assert.equal(events[0].reply_state.progress_omitted, 272);
  events[0].reply_state.prog.push('mutated consumer'); events[0].reply_state.pre.push('mutated consumer');
  assert.equal(tc.replyState.prog.length, RETAIN); assert.deepEqual(tc.replyState.pre, pre);
});
test('repeated compaction and JSON resume retain aligned metadata and cumulative omitted count', () => {
  const state = fixture(), tc = { spendPauses: false }; trimTurnState(tc, state);
  const resumed = serial(state), resumedTc = serial(tc), more = Array.from({ length: 200 }, (_, i) => unique(1000 + i));
  resumed.said.splice(-1, 0, ...more); resumed.saidMeta.splice(-1, 0, ...more.map(s => meta(s)));
  assert.equal(trimTurnState(resumedTc, resumed), 200); assert.equal(resumedTc.progressOmitted, 472);
  assert.equal(resumed.said.length, RETAIN + 1); assert.ok(resumed.saidMeta.every((m, i) => m.text === resumed.said[i]));
  assert.equal(resumed.stats.charge, state.stats.charge); assert.equal(resumed.stepIn[0], state.stepIn[0]);
});
test('near-duplicate narration cannot escape tail bound through canonical deduplication', () => {
  const state = fixture(); state.said = Array.from({ length: 400 }, (_, i) => `Checking fixture branch ${i} before proceeding with the remaining detailed research steps.`).concat(final); state.saidMeta = state.said.map((s, i) => meta(s, i === 400 ? [] : ['web_search']));
  trimTurnState({ spendPauses: false }, state);
  assert.ok(state.said.length <= RETAIN + 1, 'deduped narration must not accumulate unboundedly'); assert.equal(state.said.at(-1), final);
});
test('equal text is not proof that another index has known progress metadata', () => {
  const state = fixture(), duplicate = 'Checking the shared fixture branch.';
  state.said = Array.from({ length: 300 }, () => duplicate).concat(final);
  state.saidMeta = state.said.map((s, i) => i % 2 ? meta('Mismatched old metadata ' + i) : meta(s, i === 0 ? ['web_search'] : []));
  const nonprogress = state.saidMeta.slice(1, -1); trimTurnState({ spendPauses: false }, state);
  for (const m of nonprogress) assert.ok(state.saidMeta.includes(m), 'unknown/mismatched or no-call index must not inherit another identical text classification');
});
test('resumed view classifies exact known metadata only and retains old unknown journals', () => {
  const said = [unique(1), 'Keep this question?', unique(2), final];
  const known = said.map(s => meta(s)); known[2] = meta('Mismatched metadata');
  const restored = resumedReplyState(said, serial(known), 272);
  assert.deepEqual(restored.prog, [said[0]]); assert.deepEqual(restored.pre, said.slice(1));
  assert.equal(restored.body, ''); assert.equal(restored.progress_omitted, 272);
  assert.deepEqual(resumedReplyState(said, []).pre, said);
  assert.deepEqual(resumedReplyState(said, []).prog, []);
  for (const invalid of [{text:said[0],calls:['web_search']}, {text:said[0],calls:[null],later:[]}, {text:'',calls:['web_search'],later:[]}]) {
    assert.deepEqual(resumedReplyState(said, [invalid]).pre, said);
  }
});
test('persisted diagnostic previews remain valid JSON with durable omission count', () => {
  const trace = Array.from({length:128}, (_,i) => ({tool:'fixture',step:i,out:'x'.repeat(900)})), before = serial(trace);
  const encoded = diagnosticTrace(trace, 272), decoded = JSON.parse(encoded);
  assert.ok(encoded.length <= 60000); assert.deepEqual(decoded.at(-1), {tool:'progress_history',omitted:272});
  assert.ok(decoded.some(x => x.step === 127)); assert.deepEqual(trace, before);
  assert.deepEqual(JSON.parse(diagnosticTrace([], 272)), [{tool:'progress_history',omitted:272}]);
});
console.log(`${failed ? 'FAIL' : 'PASS'} spend retention adversarial: ${count} passed, ${failed} failed; pure functions only.`);
process.exitCode = failed ? 1 : 0;
