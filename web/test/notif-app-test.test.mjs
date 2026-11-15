// Send a test on the Android app: the test push (recognised by ?notif_test= in its url) is posted as a system notification by the app's
// own plugin; every other push, and an app without the method, keeps the in-app note.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const b=await build({entryPoints:['src/notif.ts'],bundle:true,format:'esm',write:false});
const code='data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64');
const listeners={},notes=[],posted=[],ls=new Map();let gateway={showNotification:async a=>{posted.push(a);}};
Object.assign(globalThis,{
  window:{Capacitor:{isNativePlatform:()=>true,getPlatform:()=>'android',Plugins:{
    get InstanceGateway(){return gateway;},
    PushNotifications:{addListener:(n,f)=>{listeners[n]=f;},checkPermissions:async()=>({receive:'granted'}),requestPermissions:async()=>({receive:'granted'}),register:async()=>{}}}}},
  localStorage:{getItem:k=>ls.get(k)??null,setItem:(k,v)=>ls.set(k,String(v)),removeItem:k=>ls.delete(k)},
  matchMedia:()=>({matches:false}),
  document:{addEventListener(){},visibilityState:'visible',hasFocus:()=>true},
  location:{hash:'',href:'https://x/w/s/app',origin:'https://x',pathname:'/w/s/app'},
  addEventListener(){},removeEventListener(){},
  fetch:async()=>({ok:true,json:async()=>({prefs:{needs:true,finished:true,sound:true,needs_text:true,meetings:true},push:{key:'AQAB',devices:0},endpoint:'e'})}),
});
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:'Android 1HelmMobile',platform:'Linux',maxTouchPoints:5}});
const M=await import(code);
// recognising the test
assert.equal(M.appTestPush({url:'https://x/w/s/app?notif_test=1700000000000'}),true);
assert.equal(M.appTestPush({url:'https://x/w/s/app#/main/s/abc'}),false);
assert.equal(M.appTestPush({}),false, 'no marker and no test pressed: not a test');
M.nfInit({live:{api:'/api',slug:'s'},repaint(){},note:(...a)=>notes.push(a),srow:()=>'',helper:()=>'H'});
await new Promise(r=>setTimeout(r,30));
assert.ok(listeners.pushNotificationReceived,'foreground listener registered');
const recv=listeners.pushNotificationReceived;
// a normal task push in the foreground stays an in-app note
recv({title:'Finished: A',body:'b',data:{url:'https://x/w/s/app#/main/s/zzz'}});
assert.equal(posted.length,0); assert.equal(notes.length,1);
// the test push posts a system notification with the title, body and url as received, and no in-app note
recv({title:'Notifications are on',body:'This is how H will reach you',data:{url:'https://x/w/s/app?notif_test=1700000000000'}});
assert.equal(posted.length,1); assert.equal(notes.length,1);
assert.equal(posted[0].title,'Notifications are on'); assert.equal(posted[0].body,'This is how H will reach you');
assert.equal(posted[0].url,'https://x/w/s/app?notif_test=1700000000000'); assert.match(posted[0].tag,/^test-/);
// an app without the method: the call fails, and the in-app note shows instead
gateway={showNotification:async()=>{throw new Error('not implemented');}};
recv({title:'T',body:'B',data:{url:'https://x/w/s/app?notif_test=1'}});
await new Promise(r=>setTimeout(r,10)); assert.equal(notes.length,2);
// an app whose plugin has no such function at all
gateway={};
recv({title:'T2',body:'B2',data:{url:'https://x/w/s/app?notif_test=2'}});
assert.equal(notes.length,3);
console.log('ok');
