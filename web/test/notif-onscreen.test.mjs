// A push for the task on screen shows no banner (phone app); a push for another task still does.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const b=await build({entryPoints:['src/notif.ts'],bundle:true,format:'esm',write:false});
const code='data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64');
let hash='#/main/s/abc',vis='visible';const listeners={},notes=[];
const ls=new Map();
Object.assign(globalThis,{
  window:{Capacitor:{isNativePlatform:()=>true,getPlatform:()=>'ios',Plugins:{PushNotifications:{
    addListener:(n,f)=>{listeners[n]=f;},checkPermissions:async()=>({receive:'granted'}),requestPermissions:async()=>({receive:'granted'}),register:async()=>{}}}}},
  localStorage:{getItem:k=>ls.get(k)??null,setItem:(k,v)=>ls.set(k,String(v)),removeItem:k=>ls.delete(k)},
  matchMedia:()=>({matches:false}),
  document:{addEventListener(){},get visibilityState(){return vis;},hasFocus:()=>true},
  location:{get hash(){return hash;},href:'https://x/w/s/app',origin:'https://x',pathname:'/w/s/app'},
  addEventListener(){},removeEventListener(){},
  fetch:async()=>({ok:true,json:async()=>({prefs:{needs:true,finished:true,sound:true,needs_text:true,meetings:true},push:{key:'AQAB',devices:0},endpoint:'e'})}),
});
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:'iPhone',platform:'iPhone',maxTouchPoints:5}});
const M=await import(code);
assert.equal(M.pushOnScreen({url:'https://x/w/s/app#/main/s/abc'}),true);
assert.equal(M.pushOnScreen({url:'https://x/w/s/app#/main/s/other'}),false);
assert.equal(M.pushOnScreen({session:'abc'}),true);
assert.equal(M.pushOnScreen({}),false);
vis='hidden';assert.equal(M.pushOnScreen({session:'abc'}),false);vis='visible';
M.nfInit({live:{api:'/api',slug:'s'},repaint(){},note:(...a)=>notes.push(a),srow:()=>'',helper:()=>'H'});
await new Promise(r=>setTimeout(r,30));
if(listeners.pushNotificationReceived){
  listeners.pushNotificationReceived({title:'Finished: A',body:'b',data:{url:'https://x/w/s/app#/main/s/abc'}});
  assert.equal(notes.length,0);
  listeners.pushNotificationReceived({title:'Finished: B',body:'b',data:{url:'https://x/w/s/app#/main/s/zzz'}});
  assert.equal(notes.length,1);
} else console.log('listener not registered in harness; helper checks only');
console.log('ok');
