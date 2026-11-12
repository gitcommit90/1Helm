import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import nacl from 'tweetnacl';
import {cleanExitSetting,exitView,exitEnableProblem} from '../src/browser-exit.js';
import {ExitStreams} from '../src/exit-stream.js';

// The Browser exit node setting inside the NativeTransport object, run against the real methods with SQLite and a fake broker.
// Judged on app facts only: the stored setting, what the broker was told, and what the browser's proxy entry answers.
class DurableObject { constructor(ctx,env){this.ctx=ctx;this.env=env} }
class WorkerEntrypoint {}
globalThis.__deps={installSnapshotRpc:()=>{},DurableObject,WorkerEntrypoint,nacl,sealSecret:async(_,s)=>s,openSecret:async(_,s)=>s,cleanExitSetting,exitView,exitEnableProblem,ExitStreams};
let source=await readFile(new URL('../src/native-transport.js',import.meta.url),'utf8');
source=source.replace(/^import .*;\n/gm,'');
const {NativeTransport,TsProxyLink}=await import('data:text/javascript;base64,'+Buffer.from('const {installSnapshotRpc,DurableObject,WorkerEntrypoint,nacl,sealSecret,openSecret,cleanExitSetting,exitView,exitEnableProblem,ExitStreams}=globalThis.__deps;\n'+source).toString('base64'));

function setup({connected=true}={}){
 const db=new DatabaseSync(':memory:'),log={raw:[],proxied:0,ensured:0};
 const sql={exec(query,...args){const rows=db.prepare(query).all(...args);return{toArray:()=>rows,one:()=>rows[0]}}};
 const ctx={id:{toString:()=>'tenant-a:main'},storage:{sql,setAlarm:async()=>{},deleteAlarm:async()=>{}},container:{running:false,monitor:()=>Promise.resolve(),destroy:async()=>{ctx.container.running=false},getTcpPort:()=>({fetch:async(url,req)=>{log.proxied++;return new Response('proxied',{status:200})}})},waitUntil:()=>{},exports:{}};
 const env={NATIVE_TRANSPORT:{idFromName:s=>({toString:()=>s})},LEDGER:{idFromName:s=>s,get:()=>({grant:async()=>{},reserve:async()=>({ok:true}),settle:async()=>{}})}};
 const b=new NativeTransport(ctx,env),own={tenant:'tenant-a',channel:'main'};b.owner(own);
 const broker={nodes:[{id:'n-home',name:'home',online:true},{id:'n-nas',name:'nas',online:true}],check:{ok:true}};
 b.ensure=async()=>{log.ensured++;ctx.container.running=true};b.stop=async()=>{ctx.container.running=false};
 b.raw=async(op,q)=>{log.raw.push([op,q]);if(op==='exit_nodes')return{ok:true,nodes:broker.nodes};if(op==='exit_check')return broker.check;return{ok:true}};
 if(connected){b.put('tail_enabled',true);b.put('tail_status',{state:'connected'})}
 return {b,own,ctx,log,broker,db};
}
const proxyReq=(path,open)=>new Request('http://tsproxy.internal'+path,{...(open?{method:'POST',body:JSON.stringify({host:'example.org',port:443})}:{}),headers:{'x-1hc-tenant':'tenant-a','x-1hc-channel':'main'}});

test('the setting is off by default and cannot be turned on without Tailscale',async()=>{
 const x=setup({connected:false});
 const v=await x.b.browserExit(x.own);assert.equal(v.setting,'off');assert.equal(v.tailscale,'not_connected');assert.equal(v.can_enable,false);
 const r=await x.b.setBrowserExit(x.own,{enabled:true,node_id:'n-home'});
 assert.equal(r.ok,false);assert.match(r.error,/Connect Tailscale/);assert.equal(r.setting,'off');assert.equal(x.log.raw.length,0,'no broker call was made');x.db.close();
});
test('enabling needs one exit node that the tailnet offers, and the broker is told which',async()=>{
 const x=setup();
 let r=await x.b.setBrowserExit(x.own,{enabled:true});assert.equal(r.ok,false);assert.match(r.error,/Choose one of your exit nodes/);
 r=await x.b.setBrowserExit(x.own,{enabled:true,node_id:'n-laptop'});assert.equal(r.ok,false);assert.match(r.error,/not an approved exit node/);assert.equal(r.setting,'off');
 r=await x.b.setBrowserExit(x.own,{enabled:true,node_id:'n-home'});
 assert.equal(r.ok,true);assert.equal(r.setting,'on');assert.equal(r.exit_node.name,'home');assert.equal(r.state,'ready');assert.match(r.line,/leaves through home/);
 assert.ok(x.log.raw.some(([op,q])=>op==='exit_config'&&q.exitNode==='n-home'),'the chosen node reached the broker');x.db.close();
});
test('turning it off keeps the pick, clears the broker and the status says off',async()=>{
 const x=setup();await x.b.setBrowserExit(x.own,{enabled:true,node_id:'n-nas'});x.ctx.container.running=true;
 const r=await x.b.setBrowserExit(x.own,{enabled:false});
 assert.equal(r.setting,'off');assert.equal(r.exit_node.id,'n-nas');assert.match(r.line,/^Off\./);
 const last=x.log.raw.filter(([op])=>op==='exit_config').at(-1);assert.equal(last[1].exitNode,'');x.db.close();
});
test('exit node offline: the status says so and the browser proxy entry fails closed',async()=>{
 const x=setup();x.broker.check={ok:false,reason:'The exit node home is offline.'};
 const r=await x.b.setBrowserExit(x.own,{enabled:true,node_id:'n-home'});
 assert.equal(r.setting,'on');assert.equal(r.state,'unreachable');assert.match(r.line,/^On, but the exit node home is offline\./);assert.match(r.line,/Nothing goes out directly/);
 const s=await x.b.fetch(proxyReq('/status'));const sb=await s.json();assert.equal(sb.ok,false);assert.match(sb.reason,/offline/);
 // A connection attempt while the broker refuses never reaches a public network: the broker's own proxy is the only path.
 x.log.proxied=0;const c=await x.b.fetch(proxyReq('/s/open',true));assert.equal(c.status,503,'the broker gave no WebSocket, so the connection is refused with a reason');const cb=await c.json();assert.equal(cb.ok,false);assert.equal(x.log.proxied,1,JSON.stringify(cb));
 x.db.close();
});
test('setting off or Tailscale gone: the proxy entry refuses before touching the broker',async()=>{
 const x=setup();
 let r=await x.b.fetch(proxyReq('/status'));assert.equal(r.status,503);assert.match((await r.json()).reason,/setting is off/);
 await x.b.setBrowserExit(x.own,{enabled:true,node_id:'n-home'});x.log.proxied=0;
 x.b.put('tail_enabled',false);
 r=await x.b.fetch(proxyReq('/s/open',true));assert.equal(r.status,503);assert.match((await r.json()).reason,/Tailscale is not connected/);assert.equal(x.log.proxied,0);
 x.db.close();
});
test('the proxy entry is bound to its own channel computer',async()=>{
 const x=setup();
 await assert.rejects(x.b.fetch(new Request('http://tsproxy.internal/status',{headers:{'x-1hc-tenant':'tenant-b','x-1hc-channel':'main'}})),/Wrong channel computer/);
 x.db.close();
});
test('disconnecting Tailscale switches the setting off and remembers nothing that could route traffic',async()=>{
 const x=setup();await x.b.setBrowserExit(x.own,{enabled:true,node_id:'n-home'});
 x.b.put('tail_state','x');x.b.put('seed','s');
 await x.b.tailscaleDisconnectInner(x.own);
 const v=await x.b.browserExit(x.own);assert.equal(v.setting,'off');assert.equal(v.tailscale,'not_connected');x.db.close();
});
test('TsProxyLink only forwards tsproxy.internal for its own channel computer',async()=>{
 const seen=[];const env={NATIVE_TRANSPORT:{idFromName:s=>s,get:id=>({fetch:async r=>{seen.push([id,r.headers.get('x-1hc-tenant'),r.headers.get('x-1hc-channel'),new URL(r.url).pathname]);return new Response('ok')}})}};
 const link=new TsProxyLink();link.env=env;link.ctx={props:{tenant:'t1',channel:'c1'}};
 assert.equal((await link.fetch(new Request('http://tsproxy.internal/status'))).status,200);
 assert.deepEqual(seen[0],['t1:c1','t1','c1','/status']);
 assert.equal((await link.fetch(new Request('http://example.com/status'))).status,404);
 // A client cannot choose another owner by sending its own headers.
 await link.fetch(new Request('http://tsproxy.internal/status',{headers:{'x-1hc-tenant':'evil','x-1hc-channel':'evil'}}));assert.deepEqual(seen[1].slice(1,3),['t1','c1']);
});
