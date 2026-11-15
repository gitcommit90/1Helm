import test from 'node:test';
import assert from 'node:assert/strict';
import { world, tick } from './deploy-harness.mjs';
import { TURN_HARD } from '../src/spendguard.js';

test('actual classic workflow preserves recorded results without spending on a final report', async () => {
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>{throw Error('No network allowed in reporter fixture');};
  try {
    const W=world({engine:'classic'}), session=W.R.newSession('Budgeted workflow');
    W.brain=()=>({calls:[['run_command',{command:'compute the requested total',step_title:'Compute total'}]],usage:Math.ceil((2.2e8/1.15-5000)/150)});
    W.computer.onExec=async()=>({code:0,out:'Total=8675309; source count=12'});
    const result=await W.R.runTurn('t1','main','1','Compute a total then report it',null,{session,kind:'workflow'});
    assert.equal(result.error,null);
    assert.match(result.reply,/spending limit/);assert.match(result.reply,/partial recorded results/);
    assert.match(result.reply,/not confirmation that the whole task completed/);assert.match(result.reply,/8675309/);
    assert.doesNotMatch(result.reply,/Want me to keep going/);
    assert.equal(W.calls.filter(c=>c.who==='main').length,1,'no extra model/report call');
    assert.equal(W.execs.length,1,'no repeated completed operation');
    assert.ok(W.turns().at(-1).charge_nano<=TURN_HARD);assert.equal(W.ledger.open.size,0);
    assert.equal(W.turns().at(-1).reply,result.reply,'partial report persisted as actual turn result');
    const before=W.calls.length;await tick(30);assert.equal(W.calls.length,before);
  } finally {globalThis.fetch=originalFetch;}
});
