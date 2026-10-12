import assert from 'node:assert/strict';
import test from 'node:test';
import { TOOL_BATCH, toolBatchWatch } from '../src/repeat-guard.js';
const delta = (index, name = 'run_command', args = { command: `echo ${index}` }) => ({ index, id: `distinct-${index}`, function: { name, arguments: JSON.stringify(args) } });

test('32 distinct calls accepted; entire step rejected on33, including huge sparse indices', () => {
  const w = toolBatchWatch();
  for (let i = 0; i < TOOL_BATCH.maxCalls; i++) assert.equal(w.feed([delta(i)]), null);
  const hit = w.feed([delta(32)]); assert.equal(hit.kind, 'batch-limit'); assert.equal(w.feed([]), hit);
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
    const w = toolBatchWatch(), n = Math.max(8, period * 4);
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
  const gap = toolBatchWatch();
  for (let i = 0; i < 8; i++) assert.equal(gap.feed([delta(i * 2, 'run_command', { command: 'same' })]), null);
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
  const large = toolBatchWatch(); for (let i = 0; i < 32; i++) assert.equal(large.feed([delta(i, 'run_command', { command: 'x'.repeat(9000) })]), null);
  assert.equal(large.feed([delta(32)]).kind, 'batch-limit');
});
