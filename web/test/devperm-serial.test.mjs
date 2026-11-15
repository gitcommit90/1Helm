// Android app (Capacitor): the permission asks from one tap run one at a time. Browser: all at once, as before.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const out=(await build({entryPoints:[process.env.DEVPERM_SRC||'src/devperm.ts'],bundle:true,format:'esm',write:false})).outputFiles[0].text;
const mod='data:text/javascript;base64,'+Buffer.from(out).toString('base64');
const tick=()=>new Promise(r=>setTimeout(r,5));
async function run(platform){
  const store=new Map(),log=[],pending={};
  const defer=name=>new Promise(res=>{log.push('start '+name);pending[name]=res;});
  globalThis.localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
  globalThis.matchMedia=()=>({matches:false});
  let click;
  globalThis.document={addEventListener:(t,f)=>{if(t==='click')click=f},visibilityState:'visible',hasFocus:()=>true,activeElement:null,querySelectorAll:()=>[]};
  globalThis.addEventListener=()=>{};
  globalThis.performance??={now:()=>Date.now()};
  const nav={permissions:{query:async()=>{throw Error('x')}},geolocation:{getCurrentPosition:(ok)=>{defer('loc').then(()=>ok({coords:{latitude:1,longitude:2}}))}},mediaDevices:{getUserMedia:()=>defer('mic').then(()=>({getTracks:()=>[]}))}};
  Object.defineProperty(globalThis,'navigator',{value:nav,configurable:true});
  globalThis.window=globalThis;
  globalThis.Capacitor=platform?{isNativePlatform:()=>true,getPlatform:()=>platform}:undefined;
  const notes=[];
  const m=await import(mod+'#'+platform);
  m.dpInit({api:null,note:(...n)=>notes.push(n),helper:()=>'H',repaint(){},shown:()=>false,look:false,nf:null});
  click({target:{closest:()=>({dataset:{dp:'both'}})},preventDefault(){}});
  await tick();
  return {log,pending,notes,tick};
}
// Browser: both prompts start at once.
let r=await run(null);
assert.deepEqual(r.log,['start mic','start loc'],'browser starts mic and location together');
// Android app: the second ask starts only after the first resolves.
r=await run('android');
assert.deepEqual(r.log,['start mic'],'android: only the microphone ask is open');
r.pending.mic();await r.tick();
assert.deepEqual(r.log,['start mic','start loc'],'android: location starts after the microphone resolves');
r.pending.loc();await r.tick();
console.log('devperm serial asks: Android app asks one at a time, browser asks together passed.');
process.exit(0);
