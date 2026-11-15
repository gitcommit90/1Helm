import assert from 'node:assert/strict';import {build} from 'esbuild';
const r=await build({entryPoints:['src/recency.ts'],bundle:true,format:'esm',write:false});
const {byActivity,sortByActivity,sortRail,railSepBefore,chGroupOf}=await import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));
// Within a section: the later of the person's message and the helper's reply (both set `updated`) is first, whatever the state or unread flag.
const t=[{id:'a',updated:100,unread:true},{id:'b',updated:300},{id:'c',updated:200,state:'working'},{id:'d',updated:300}];
assert.deepEqual(sortByActivity(t).map(x=>x.id),['b','d','c','a']);
t.find(x=>x.id==='a').updated=400; // the helper replies in the task that was last
assert.deepEqual(sortByActivity(t).map(x=>x.id),['a','b','d','c']);
assert.deepEqual([...t].sort(byActivity)[0].id,'a');
// Rail: General, pinned (by pin time), unread by latest unread reply, then the rest by creation order.
const ch=(slug,o={})=>({slug,sessions:[],ord:0,...o});
const un=(updated,extra={})=>({unread:true,updated,...extra});
const L=[ch('z',{ord:5}),ch('u1',{ord:3,sessions:[un(10)]}),ch('p2',{pinned:20,ord:2}),ch('main',{ord:-1}),ch('u2',{ord:4,sessions:[un(50),{updated:99}]}),ch('p1',{pinned:10,ord:1}),ch('y',{ord:6,sessions:[un(70,{done:true})]}),ch('pu',{pinned:30,sessions:[un(999)]})];
sortRail(L);
assert.deepEqual(L.map(c=>c.slug),['main','p1','p2','pu','u2','u1','z','y']);
assert.deepEqual(L.map(chGroupOf),[0,1,1,1,2,2,3,3]);
assert.deepEqual(L.map((_,i)=>railSepBefore(L,i)),[false,true,false,false,true,false,true,false]);
// All read: the channel goes back to its normal place, and no extra lines appear.
L.find(c=>c.slug==='u2').sessions[0].unread=false;L.find(c=>c.slug==='u1').sessions[0].unread=false;sortRail(L);
assert.deepEqual(L.slice(4).map(c=>c.slug),['z','u1','u2','y'].sort((a,b)=>L.find(c=>c.slug===a).ord-L.find(c=>c.slug===b).ord));
// No pins and no unread: General then the rest with no line.
const M=[ch('main'),ch('a',{ord:1}),ch('b',{ord:2})];assert.deepEqual(M.map((_,i)=>railSepBefore(M,i)),[false,false,false]);
console.log('PASS recency');
