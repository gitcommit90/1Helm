import assert from 'node:assert/strict';
import test from 'node:test';
import { TOOL_BATCH, toolBatchWatch } from '../src/repeat-guard.js';
const delta = (index, name = 'run_command', args = { command: `echo ${index}` }) => ({ index, id: `distinct-${index}`, function: { name, arguments: JSON.stringify(args) } });

test('the maximum number of distinct calls is accepted; the next one rejects the entire step, including huge sparse indices', () => {
  const w = toolBatchWatch();
  for (let i = 0; i < TOOL_BATCH.maxCalls; i++) assert.equal(w.feed([delta(i)]), null);
  const hit = w.feed([delta(TOOL_BATCH.maxCalls)]); assert.equal(hit.kind, 'batch-limit'); assert.match(hit.calls, /run_commandx64 \(64 different of 64\)/); assert.equal(w.feed([]), hit);
  for (const index of [-1, 0.5, '1', 1e9, Infinity]) assert.equal(toolBatchWatch().feed([delta(index)]).kind, 'batch-limit');
});
test('frozen synthetic batch shape: distinct-ID short command/gatepairs caught far before506calls', () => {
  const w = toolBatchWatch(); let hit, consumed = 0;
  for (let i = 0; i < 506; i++) {
    hit = w.feed([i % 2 ? delta(i, 'set_workflow_gate', { workflow: '7', command: 'test -f reports/plan.md || exit 3; exit 0', step_title: `Gate ${i}` }) : delta(i, 'run_command', { command: 'ls -la reports/', step_title: `Check ${i}` })]);
    consumed++; if (hit) break;
  }
  assert.equal(hit.kind, 'batch-repeat'); assert.equal(hit.period, 2); assert.equal(consumed, 8);
});
test('single/two/four-call patterns use conservative cycle and minimumcall boundaries', () => {
  for (const period of [1, 2, 4]) {
    const w = toolBatchWatch(), n = period === 4 ? 12 : Math.max(8, period * 4);   // a cycle of 4 is caught at 12 by the low-variety rule
    for (let i = 0; i < n - 1; i++) assert.equal(w.feed([delta(i, 'run_command', { command: `echo ${i % period}` })]), null);
    assert.equal(w.feed([delta(n - 1, 'run_command', { command: `echo ${(n - 1) % period}` })]).kind, 'batch-repeat');
  }
});
test('fragmented args and repeated index metadata do not count extra calls', () => {
  const w = toolBatchWatch();
  for (let i = 0; i < 32; i++) {
    assert.equal(w.feed([{ index: i, id: `id${i}`, function: { name: 'run_' } }]), null);
    assert.equal(w.feed([{ index: i, id: `id${i}`, function: { name: 'command', arguments: '{"command":' } }]), null);
    assert.equal(w.feed([{ index: i, function: { arguments: JSON.stringify(`echo ${i}`) + '}' } }]), null);
  }
});
test('incomplete/invalid args and index gaps never count as completed repeatedpatterns', () => {
  const w = toolBatchWatch();
  for (let i = 0; i < 8; i++) assert.equal(w.feed([{ index: i, function: { name: 'run_command', arguments: '{"command":"x"' } }]), null);
  for (let i = 0; i < 7; i++) assert.equal(w.feed([{ index: i, function: { arguments: '}' } }]), null);
  assert.equal(w.feed([{ index: 7, function: { arguments: '}' } }]).kind, 'batch-repeat');
  const gap = toolBatchWatch();   // the same completed call 8 times counts wherever the copies sit, gaps in the numbering included
  for (let i = 0; i < 7; i++) assert.equal(gap.feed([delta(i * 2, 'run_command', { command: 'same' })]), null);
  assert.equal(gap.feed([delta(14, 'run_command', { command: 'same' })]).kind, 'batch-repeat');
});
test('canonical object key order/only top-leveltitle ignored; actual argument data retained', () => {
  const w = toolBatchWatch();
  for (let i = 0; i < 7; i++) assert.equal(w.feed([delta(i, 'run_command', i % 2 ? { timeout_minutes: 1, command: 'echo same', step_title: String(i) } : { command: 'echo same', step_title: String(i), timeout_minutes: 1 })]), null);
  assert.equal(w.feed([delta(7, 'run_command', { command: 'echo same', timeout_minutes: 1 })]).kind, 'batch-repeat');
  for (const factory of [i => ({ command: `echo ${i}` }), i => ({ command: 'same', data: { step_title: String(i) } }), i => ({ command: 'same', list: [i, 0] })]) {
    const distinct = toolBatchWatch(); for (let i = 0; i < 32; i++) assert.equal(distinct.feed([delta(i, 'run_command', factory(i))]), null);
  }
});
test('hostile nested/prototype args bounded and never mutate object prototypes', () => {
  const w = toolBatchWatch();
  for (let i = 0; i < 8; i++) assert.equal(w.feed([{ index: i, function: { name: 'run_command', arguments: '{"x":'.repeat(40) + '0' + '}'.repeat(40) } }]), null);
  const p = toolBatchWatch();
  p.feed([{ index: 0, function: { name: 'run_command', arguments: '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}' } }]);
  assert.equal({}.polluted, undefined);
  const large = toolBatchWatch(); for (let i = 0; i < TOOL_BATCH.maxCalls; i++) assert.equal(large.feed([delta(i, 'run_command', { command: 'x'.repeat(9000) })]), null);
  assert.equal(large.feed([delta(TOOL_BATCH.maxCalls)]).kind, 'batch-limit');
});

// ---- r35 ----
// The dev stops since 9e5e39c were real loops (fixture: a looping Makora step, test account). Wide fan-out of different calls is still allowed.
import { readFileSync } from 'node:fs';
const fx = JSON.parse(readFileSync(new URL('./fixtures/r35-tool-batches.json', import.meta.url), 'utf8'));
const feedAll = (calls) => { const w = toolBatchWatch(); let hit = null, fed = 0; for (const [name, args] of calls) { fed++; hit ||= w.feed([delta(fed - 1, name, typeof args === 'string' ? JSON.parse(args) : args)]); if (hit) break; } return { hit, fed }; };
test('r35 fixture: the looping step (same four files read again and again, a cycle of five) is stopped as a repeat before the limit', () => {
  const { hit, fed } = feedAll(fx.loop.map(c => [c.name, c.args]));
  assert.equal(hit?.kind, 'batch-repeat'); assert.ok(fed <= 40, `stopped at call ${fed}`); assert.ok(fed < TOOL_BATCH.maxCalls);
  assert.match(hit.calls, /read_filex/);
});
test('r35 fixture: ordinary one to five call batches from the same model never trip', () => {
  assert.ok(fx.normal.length >= 8);
  for (const batch of fx.normal) assert.equal(feedAll(batch.map(c => [c.name, c.args])).hit, null);
});
test('r35: 33 to 60 different read-only calls in one step (research, reading many files) are not stopped', () => {
  const research = Array.from({ length: 60 }, (_, i) => ['web_search', { step_title: `Look up item ${i}`, query: `Texas LLC ${['filing fee', 'registered agent', 'franchise tax', 'EIN', 'permits', 'sales tax'][i % 6]} ${2026 + (i % 3)} topic ${i}` }]);
  for (const n of [33, 40, 60]) assert.equal(feedAll(research.slice(0, n)).hit, null, `${n} different web searches`);
  const files = Array.from({ length: 60 }, (_, i) => ['read_file', { step_title: `Read menu file ${i}`, path: `/workspace/files/menu-${i}.md` }]);
  assert.equal(feedAll(files).hit, null, '60 different file reads');
  const mixed = Array.from({ length: 45 }, (_, i) => i % 3 === 0 ? ['read_skill', { step_title: 'Read skill', slug: `skill-${i}` }] : i % 3 === 1 ? ['fetch_url', { step_title: 'Open page', url: `https://example.com/p/${i}` }] : ['recall_memory', { step_title: 'Recall', query: `topic ${i}` }]);
  assert.equal(feedAll(mixed).hit, null, 'a mix of tools with different arguments');
  const nested = Array.from({ length: 50 }, (_, i) => ['update_todos', { step_title: 'Plan', items: [{ text: `task ${i}`, done: false }] }]);
  assert.equal(feedAll(nested).hit, null, 'arguments that differ only inside one nested value');
});
test('r35: the same call up to seven times in one batch is fine, the eighth stops the step, even with other calls between', () => {
  const calls = []; for (let i = 0; i < 7; i++) calls.push(['read_file', { step_title: `Read ${i}`, path: '/workspace/files/a.md' }], ['read_file', { path: `/workspace/files/other-${i}.md` }]);
  assert.equal(feedAll(calls).hit, null);
  const six = []; for (let i = 0; i < 8; i++) six.push(['read_file', { step_title: `Read ${i}`, path: '/workspace/files/a.md' }], ['read_file', { path: `/workspace/files/other-${i}.md` }]);
  const { hit, fed } = feedAll(six); assert.equal(hit.kind, 'batch-repeat'); assert.equal(fed, 15);
});
test('r35: a real loop is still stopped well before the limit when every call streams in pieces mixed together', () => {
  const w = toolBatchWatch(); let h = null;
  const text = JSON.stringify({ step_title: 'Read skill', slug: 'business-setup' });
  for (let i = 0; i < 20 && !h; i++) h = w.feed([{ index: i, id: `x${i}`, function: { name: 'read_skill', arguments: text.slice(0, 20) } }]);
  assert.equal(h, null, 'only half of each call has arrived, so none is complete and none is called a repeat yet');
  for (let i = 0; i < 20 && !h; i++) h = w.feed([{ index: i, function: { arguments: text.slice(20) } }]);
  assert.equal(h.kind, 'batch-repeat', 'once the calls are complete the repeat is caught');
});
test('r35: the retry note and the final message match the guard that fired', async () => {
  const { stepNote, stepFallback, REPEAT_NOTE, REPEAT_FALLBACK, BATCH_NOTE, BATCH_FALLBACK } = await import('../src/repeat-guard.js');
  for (const kind of ['batch-limit', 'batch-repeat']) assert.equal(stepNote({ kind }), BATCH_NOTE);
  assert.equal(stepFallback({ kind: 'batch-limit' }), BATCH_FALLBACK);
  for (const kind of ['exact', 'folded', undefined]) { assert.equal(stepNote({ kind }), REPEAT_NOTE); assert.equal(stepFallback({ kind }), REPEAT_FALLBACK); }
  assert.equal(stepFallback({ kind: 'batch-repeat' }), REPEAT_FALLBACK);
  assert.ok(!/repeat/i.test(BATCH_NOTE + BATCH_FALLBACK), 'too many calls is not described as repeating');
  assert.match(BATCH_FALLBACK, /Nothing from that step was run/);
});
test('r35 fixture: a loop spread over many calls (no call 8 times, fewer than half different) is stopped by the low-variety rule', () => {
  const { hit, fed } = feedAll(fx.lowdiv.map(c => [c.name, c.args]));
  assert.equal(hit?.kind, 'batch-repeat'); assert.ok(fed < TOOL_BATCH.maxCalls, `stopped at call ${fed}`);
  const half = Array.from({ length: 12 }, (_, i) => ['read_file', { path: `/workspace/files/f${i % 6}.md` }]);   // exactly half different: allowed
  assert.equal(feedAll(half).hit, null);
  assert.equal(feedAll([...half, ['read_file', { path: '/workspace/files/f1.md' }]]).hit?.kind, 'batch-repeat');
});
