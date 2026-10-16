import test from 'node:test';
import assert from 'node:assert/strict';
import { Resident } from '../src/resident.js';
import { REPEAT_FALLBACK, TOOL_BATCH } from '../src/repeat-guard.js';
import { SEED } from './helpers/seed-settings.mjs';

const encode = value => new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`);
function stream(mode, stats) {
  let index = 0;
  return new ReadableStream({
    pull(c) {
      stats.pulled++;
      if (mode === 'safe') { c.enqueue(encode({choices:[{delta:{content:'Safe report.'},finish_reason:'stop'}]}));c.close();return; }
      if (index === 32 && mode === 'normal') { c.enqueue(encode({choices:[{delta:{},finish_reason:'tool_calls'}]}));c.close();return; }
      const i = index++;
      c.enqueue(encode({choices:[{delta:{tool_calls:[{index:i,id:`distinct-${i}`,type:'function',function:{name:'web_search',arguments:JSON.stringify({query:mode==='repeat'?'same query':`query ${i}`,step_title:`Read ${i}`})}}]}}]}));
    },
    cancel() { stats.cancelled++; },
  });
}

test('actual public Resident parser bounds core BYOK and EE streams, preserving ordinary calls and own-key billing', async () => {
  const savedFetch=globalThis.fetch;
  try {
    for (const lane of ['core-byok','ee-byok','ee-workers']) {
      const ownKey=lane!=='ee-workers';
      let mode='repeat', stats, reserved=0, settled=0;
      const cfg={base:'https://provider.example.test/v1',key:'',model:'fixture-model'};
      const R={env:{...(lane.startsWith('ee')?{ONEHELM_EE:'1hc'}:{}),...(ownKey?{BYOK:cfg}:{MODEL_SETTINGS:SEED,AI:{run:async()=>stream(mode,stats)}})},
        ctx:{id:{toString:()=> 'fixture-resident'}},get:()=>null,modelTools:()=>[],cardCharge:()=>{},resOpen:()=>{},resClose:()=>{},
        ledger:()=>({reserve:async()=>{reserved++;return {ok:true};},settle:async()=>{settled++;return {ok:true};}})};
      globalThis.fetch=async(url,init)=>{assert.equal(String(url),cfg.base+'/chat/completions');assert.equal(JSON.parse(init.body).model,cfg.model);return new Response(stream(mode,stats));};
      for (mode of ['repeat','limit','normal']) {
        stats={pulled:0,cancelled:0};
        const result=await Resident.prototype.callModelOnce.call(R,[{role:'user',content:'Read only.'}],()=>{});
        // Cancellation propagates asynchronously through BYOK's stream wrappers.
        await new Promise(resolve=>setImmediate(resolve));
        if(mode==='normal') {assert.equal(result.calls.length,32);assert.equal(result.repeat,undefined);}
        else {assert.equal(result.calls.length,0);assert.equal(result.content,'');assert.equal(result.finish,'repeat');assert.equal(result.repeat.kind,mode==='repeat'?'batch-repeat':'batch-limit');assert.ok(stats.pulled<TOOL_BATCH.maxCalls+16);assert.ok(stats.cancelled>0);}
        if(ownKey) {assert.equal(result.charge,0);assert.equal(reserved,0);assert.equal(settled,0);}
      }
      if(!ownKey) {assert.equal(reserved,3);assert.equal(settled,3);}
    }
  } finally {globalThis.fetch=savedFetch;}
});

test('actual retry wrapper discards batches and retries once, including the append transcript seam', async () => {
  // Exercise the shared parser/retry methods directly. This is NOT full append
  // admission/persistence acceptance; those task-profile contracts run separately.
  const savedFetch=globalThis.fetch, savedLog=console.log; console.log=()=>{};
  try {
    for(const appendRuntime of [false,true]) for(const second of ['safe','repeat']) {
      let requests=0;const wire=[],saved=[];
      const R={env:{BYOK:{base:'https://provider.example.test/v1',key:'',model:'fixture-model'}},get:()=>null,modelTools:()=>[],cardCharge:()=>{},
        governTaskContext:async()=>{},sidecarAudioCurrent(){},save:(_turn,message)=>saved.push(message)};
      R.callModelStep=(...args)=>Resident.prototype.callModelOnce.call(R,...args);
      globalThis.fetch=async(_url,init)=>{wire.push(JSON.parse(init.body));return new Response(stream(requests++===0?'repeat':second,{pulled:0,cancelled:0}));};
      const messages=[{role:'user',content:'Read only.'}],tc=appendRuntime?{appendRuntime:true,turn:'fixture',transcript:{observe:()=>{}}}:null;
      const result=await Resident.prototype.callModel.call(R,messages,()=>{},null,2048,false,tc);
      assert.equal(requests,2);assert.deepEqual(result.calls,[]);assert.equal(result.content,second==='safe'?'Safe report.':REPEAT_FALLBACK);
      assert.ok(!JSON.stringify(wire[1].messages).includes('distinct-'));
      assert.ok(!saved.some(m=>m.tool_calls?.length));
      assert.equal(saved.length,appendRuntime?1:0);
    }
  } finally {globalThis.fetch=savedFetch;console.log=savedLog;}
});
