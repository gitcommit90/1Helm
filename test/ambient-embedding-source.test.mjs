// Synthetic provider transport and saved index provenance. No model quality assertions.
import assert from 'node:assert/strict';
import { makeStore } from './helpers/search-store.mjs';
import { quantize, unitVector } from '../src/ee/ambient-search.js';

const old='@cf/baai/bge-m3', chosen='baai/bge-m3';
const F=makeStore({ai:false});
F.env.MODEL_SETTINGS=structuredClone(F.env.MODEL_SETTINGS);
F.env.ONEHELM_EE='1hc';F.env.ENV_NAME='dev';F.env.DYNAMIC_ROUTING='on';
F.env.MODEL_SETTINGS.jobs.embed_memory={model:chosen,effort:null,fallbacks:[]};
F.env.MODEL_SETTINGS.catalog[chosen]={id:chosen,source:'OR',kinds:['embedding_memory'],pricing:{prompt:.01,completion:0},hosts:['parasail','deepinfra/fp32'],embedding_dimensions:1024,embedding_equivalents:[old,chosen]};
const idx=F.store.index, vec=new Array(1024).fill(0);vec[0]=1;
await F.store.ingest('bee',1,F.conv(1,['call the landlord']));idx.build();
const id=F.store.rows('SELECT id FROM ambient_passages')[0].id;
const q=quantize(unitVector(vec));idx.store('passage',{id},idx.blob(q.q),q.scale,old);
assert(idx.available(),'OR embedding availability does not require native AI binding');
await idx.configuration();
assert.equal(idx.pending().passages,0,'verified equivalent vectors require no paid rebuild');
assert.equal(idx.nextWork(),null,'a complete index with an explicit current snapshot has no pending work');
const before=F.store.rows('SELECT model,hex(vec) bytes FROM ambient_passages WHERE id=?',id)[0];
let calls=0;
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,init)=>{calls++;const body=JSON.parse(init.body);assert(String(url).endsWith('/embeddings'));assert.equal(body.model,chosen);assert.equal(body.provider.zdr,true);assert.equal(body.provider.allow_fallbacks,true);assert.deepEqual(body.provider.only,['parasail','deepinfra/fp32']);return Response.json({data:body.input.map((_,index)=>({index,embedding:vec})),usage:{prompt_tokens:3,cost:.00000001}});};
try {
  const out=await idx.embed(['query']);assert.equal(out.model,chosen);assert.equal(F.settled.at(-1)[1],12,'actual reported OR cost is charged with markup');
  assert.equal(F.reserved.at(-1)[1],Math.ceil(('query'.length+4)*10*1.15),'reserve uses saved OR price');
  const query=await idx.queryVector('query');assert.equal(calls,2);
  const ranked=idx.rankPassages('',{},query);assert.deepEqual(ranked.map(x=>x.id),[id],'new OR query can search old CF vectors');
  assert.deepEqual(F.store.rows('SELECT model,hex(vec) bytes FROM ambient_passages WHERE id=?',id)[0],before,'source and vector bytes remain unchanged');
  await idx.queryVector('query');assert.equal(calls,2,'compatible query cache avoids another paid request');
  F.env.MODEL_SETTINGS.catalog[chosen].embedding_equivalents=[chosen];
  await idx.configuration();assert.equal(idx.pending().passages,1,'incompatible populated vectors count as pending');assert(idx.nextWork()!=null);
  await idx.run();assert.equal(F.store.rows('SELECT model FROM ambient_passages WHERE id=?',id)[0].model,chosen,'incompatible vectors use current saved choice');
  globalThis.fetch=async()=>Response.json({error:{message:'synthetic'}},{status:503});
  await assert.rejects(idx.embed(['outage']),/unavailable/);assert.equal(F.settled.at(-1)[1],0,'failed transport releases hold');
  F.env.MODEL_SETTINGS.catalog[chosen].embedding_dimensions=999;
  globalThis.fetch=async()=>Response.json({data:[{embedding:vec}],usage:{cost:0,prompt_tokens:1}});
  await assert.rejects(idx.embed(['bad dimensions']),/incomplete/,'wrong embedding dimensions never enter the index');
} finally { globalThis.fetch=originalFetch; }
console.log('PASS ambient source migration: saved compatibility, original provenance, OR connection, pricing, fallback policy, cache, scheduling, dimension validation');
