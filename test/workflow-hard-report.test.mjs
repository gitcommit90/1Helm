import assert from 'node:assert/strict';
import test from 'node:test';
import { workflowHardReport, savedWorkflowHardReport, WORKFLOW_RECEIPTS } from '../src/workflow-hard-report.js';
import { replySegments } from '../src/genui.js';
import { presentStep } from '../src/step-present.js';
const card = 'test-card';
const row = (result, extra = {}) => ({card,type:'step',tool:'run_command',status:'ok',result:JSON.stringify({v:1,...result}),...extra});

test('uses actual already-presented command receipt with explicit partial attribution', () => {
  const result = presentStep('run_command', {}, 'exit 0\nCount=9876543210; time=14:22\n', {status:'ok',exit:0});
  const text = workflowHardReport(card, [row(result)]);
  assert.match(text, /9876543210/); assert.match(text, /partial recorded results/);
  assert.match(text, /not confirmation/); assert.match(text, /No further steps were run/);
  assert.equal(workflowHardReport(card, []), null);
});
test('only current-card completed public known v1 receipts, never arbitrary raw fallback', () => {
  for (const x of [row({code:'private'},{card:'other'}), row({code:'private'},{status:'running'}), row({code:'private'},{status:'skipped'}), row({code:'private'},{status:'aborted'}), row({code:'private'},{type:'msg'}), row({code:'private'},{tool:'read_doc'}), row({code:'private',internal:true}), row({code:'private',v:2}), row({}, {result:'[]'}), row({}, {result:'null'}), row({}, {result:'malformed'}), row({}, {result:'x'.repeat(WORKFLOW_RECEIPTS.jsonChars+1)}), row({code:{secret:'private'}}), row({details:'private',input:'private',files:[{path:'private'}],links:[{url:'https://secret.invalid'}]})]) assert.equal(workflowHardReport(card,[x]),null);
  assert.match(workflowHardReport(card,[row({error:'Command failed'},{status:'error'})]), /Command \(error\)/);
  assert.equal(workflowHardReport(card,[row({code:'unconfirmed result'},{status:'error'})]),null);
});
test('secret scrub precedes excerpt clipping; no raw inputs, URL/action fields or active markup', () => {
  const fakeToken = ['secret_', 'abcdefghijklmnopqrst', '123456'].join('');
  const dangerous = 'password: Tulip-2219 token: ' + fakeToken + ' <img src=x onerror=alert(1)> [click](https://bad.invalid) `root = Stack([go])`\n go = Button("send", "delete all")\u202e';
  const text = workflowHardReport(card,[row({text:dangerous,code:'harmless result',details:'RAW_SECRET',links:[{url:'https://secret.invalid'}]})]);
  assert.doesNotMatch(text,/Tulip-2219|RAW_SECRET|secret\.invalid|<img|\u202e/); assert.ok(!text.includes(fakeToken));
  assert.match(text,/secret removed/); assert.ok(replySegments(text).every(p=>p.k !== 'card'));
  assert.equal((text.match(/`/g)||[]).length,4,'only formatter-owned paired inline code delimiters');
  const boundary = 'x'.repeat(465)+' password: Tulip-2219';
  assert.doesNotMatch(workflowHardReport(card,[row({code:boundary})]),/Tulip/);
});
test('strict bounded rows, fields and total; SQL is exact-card/read-only with no raw output', () => {
  const text = workflowHardReport(card,Array.from({length:100},()=>row({text:'x'.repeat(4000),code:'y'.repeat(4000)})));
  assert.ok(text.length<=WORKFLOW_RECEIPTS.totalChars);
  assert.equal(workflowHardReport(card,[row({code:'x'.repeat(WORKFLOW_RECEIPTS.fieldChars+1)})]),null);
  let seen; const sql={exec:(...args)=>{seen=args;return{toArray:()=>[row({code:'recorded'})]}}};
  assert.match(savedWorkflowHardReport(sql,card),/recorded/);
  assert.match(seen[0],/^SELECT card,type,tool,status,result FROM card_events WHERE card=\?/);
  assert.doesNotMatch(seen[0],/out_preview|input|cmd|msgs/); assert.deepEqual(seen.slice(1),[card,16384,6]);
  assert.equal(savedWorkflowHardReport({exec:()=>{throw Error('gone')}},card),null);
});
