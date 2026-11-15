import assert from 'node:assert/strict';import {build} from 'esbuild';
const result=await build({entryPoints:['src/computer-network.ts'],bundle:true,format:'esm',write:false});
globalThis.window={addEventListener(){}};globalThis.document={addEventListener(){},visibilityState:'visible',hasFocus:()=>true};
const mod=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout,timers=new Map();let next=0;
globalThis.setTimeout=(fn,delay)=>{const id=++next;timers.set(id,{fn,delay});return id};globalThis.clearTimeout=id=>timers.delete(id);
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve()};
const fire=async delay=>{const entry=[...timers].find(([,t])=>t.delay===delay);assert.ok(entry,'timer '+delay);timers.delete(entry[0]);entry[1].fn();await flush()};
const state=(tail='connected')=>({available:true,permission:'deny',key:null,sessions:[],client:{state:'sleeping'},tailscale:{state:tail}});
const requests=[];let html='',channel='main';
const render=()=>{mod.networkVisible(true);html=mod.networkHtml()};
mod.networkInit({api:(path,body,options)=>new Promise((resolve,reject)=>requests.push({path,body,signal:options?.signal,resolve,reject})),channels:()=>[{slug:'main',name:'General'},{slug:'other',name:'Other'}],current:()=>channel,render,note(){},ask:async()=>true,esc:String});
const click=op=>mod.networkClick({closest:selector=>selector==='[data-netop]'?{dataset:{netop:op},disabled:false}:null});
try{
 render();assert.equal(requests.length,1);assert.match(html,/Loading computer connections/);assert.match(html,/data-netop="cancel_status"/);
 await fire(8000);assert.match(html,/Still loading/);await fire(25000);assert.match(html,/within 25 seconds/);assert.doesNotMatch(html,/role="progressbar"/);assert.match(html,/data-netop="status">Refresh status/);assert.equal(requests[0].signal.aborted,true);
 for(let i=0;i<10;i++)render();assert.equal(requests.length,1,'repaints never retry a timed-out read');requests[0].resolve(state());await flush();assert.doesNotMatch(html,/network-settings/,'late timeout response cannot assert connected');
 click('status');requests[1].resolve(state());await flush();assert.match(html,/>Connected<\/b>/);
 click('status');click('cancel_status');await flush();assert.equal(requests[2].signal.aborted,true);assert.match(html,/Stopped waiting/);assert.match(html,/Last known status: Connected/);assert.doesNotMatch(html,/role="progressbar"/);requests[2].resolve(state('disconnected'));await flush();assert.match(html,/Last known status: Connected/);
 click('status');mod.networkChange({matches:()=>true,value:'other'});await flush();assert.equal(requests[3].signal.aborted,true);assert.equal(requests[4].path,'/res/other/network');requests[3].resolve(state());requests[4].resolve(state('disconnected'));await flush();assert.match(html,/>Disconnected<\/b>/);
 click('status');mod.networkVisible(false);assert.equal(requests[5].signal.aborted,true);mod.networkVisible(true);html=mod.networkHtml();assert.equal(requests.length,7,'reopening creates exactly one fresh read');requests[5].resolve(state());requests[6].reject(new TypeError('Failed to fetch'));await flush();assert.match(html,/Couldn't reach 1HC/);assert.doesNotMatch(html,/role="progressbar"/);render();assert.equal(requests.length,7);
 click('status');requests[7].resolve(state('disconnected'));await flush();click('key');await flush();assert.equal(requests[8].body.op,'key');assert.equal(requests[8].signal,undefined,'mutation is not aborted or replayed');assert.ok([...timers.values()].some(t=>t.delay===90000));await fire(90000);assert.match(html,/may still finish/);assert.equal(requests.length,9);assert.doesNotMatch(html,/role="progressbar"/);
 console.log('Computer connection loading: bounded 25s read, abort, explicit retry, cancellation, stale response/channel/reopen guards, preserved status and unchanged 90s mutation semantics passed.');
}finally{globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear}
