// Notifications are on by default: a device that hasn't decided gets the browser's own permission request, with no text of ours.
// Chrome and Edge: as soon as the settings have loaded. Safari, Firefox and iPhone/iPad: on the first tap or Enter/Space key.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundled=await build({entryPoints:['src/notif.ts'],bundle:true,format:'esm',write:false});
const code='data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64');
const tick=()=>new Promise(r=>setTimeout(r,5));
let n=0;
async function scenario({ua,platform='Linux x86_64',touch=0,permission='default',prefs={needs:true,finished:true,sound:true,needs_text:true,meetings:true},store={},look=false,blocked=false,key='AQAB'}){
  const handlers={click:[],keydown:[]},asks=[],notes=[],repaints=[];
  const ls=new Map(Object.entries(store));
  const N=function(){};N.permission=permission;N.requestPermission=async()=>{asks.push(1);return 'denied';};
  Object.assign(globalThis,{
    window:{PushManager:{},Notification:N,AudioContext:undefined},Notification:N,
    localStorage:{getItem:k=>ls.has(k)?ls.get(k):null,setItem:(k,v)=>ls.set(k,String(v)),removeItem:k=>ls.delete(k)},
    matchMedia:()=>({matches:false}),
    document:{addEventListener(){}},
    addEventListener:(t,f)=>{(handlers[t]??=[]).push(f);},removeEventListener:(t,f)=>{handlers[t]=(handlers[t]||[]).filter(x=>x!==f);},
    fetch:async()=>({ok:true,json:async()=>({prefs,push:{key,devices:0,this_device:false},texting:false})}),
  });
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:ua,platform,maxTouchPoints:touch,serviceWorker:{getRegistration:async()=>null,addEventListener(){}}}});
  const M=await import(code+`#${n++}`);
  M.nfInit({live:{api:'/api',slug:'x'},look,blocked:()=>blocked,repaint:()=>repaints.push(1),note:(...a)=>notes.push(a),srow:()=>'',helper:()=>'Helper'});
  await tick();await tick();
  return {asks,notes,handlers,ls,tap:async(type='click',init={})=>{for(const f of [...(handlers[type]||[])])f({type,...init});await tick();}};
}
const CHROME='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const SAFARI='Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const FIREFOX='Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0';
const IPHONE='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
// Chrome: asks on its own once, with no toast.
{ const t=await scenario({ua:CHROME}); assert.equal(t.asks.length,1,'Chrome asks as soon as the page has loaded'); assert.equal(t.notes.length,0,'no text of our own'); assert.equal(t.ls.get('1hc.nf.asked'),'1'); }
// Already decided: never asks.
for(const permission of ['granted','denied']){ const t=await scenario({ua:CHROME,permission}); assert.equal(t.asks.length,0,permission); }
// Notifications switched off in Settings (all three switches): no ask. One switch on: ask.
{ const t=await scenario({ua:CHROME,prefs:{needs:false,finished:false,sound:true,needs_text:true,meetings:false}}); assert.equal(t.asks.length,0,'every notification switch is off'); }
{ const t=await scenario({ua:CHROME,prefs:{needs:false,finished:false,sound:false,needs_text:false,meetings:true}}); assert.equal(t.asks.length,1,'meeting reminders alone count as on'); }
// Asked before on this device, or "This device" switched off by hand: no repeat.
{ const t=await scenario({ua:CHROME,store:{'1hc.nf.asked':'1'}}); assert.equal(t.asks.length,0,'a dismissed request is not repeated'); }
{ const t=await scenario({ua:CHROME,store:{'1hc.nf.off':'1'}}); assert.equal(t.asks.length,0,'turned off by hand'); }
// A dev view-as never asks. No push key from the server: no ask.
{ const t=await scenario({ua:CHROME,look:true}); assert.equal(t.asks.length,0,'view as'); }
{ const t=await scenario({ua:CHROME,key:null}); assert.equal(t.asks.length,0,'push not available'); }
// Safari, Firefox, iPhone: nothing until a tap; the tap asks once; the location and mic sheet being open defers it.
for(const [name,opts] of [['Safari',{ua:SAFARI,platform:'MacIntel'}],['Firefox',{ua:FIREFOX}],['iPhone',{ua:IPHONE,platform:'iPhone',touch:5}]]){
  if(name==='iPhone') continue;   // iPhone and iPad can only do web push from the home-screen app, which this fake page is not
  const t=await scenario(opts); assert.equal(t.asks.length,0,`${name}: nothing before a tap`);
  await t.tap('keydown',{key:'a'}); assert.equal(t.asks.length,0,`${name}: an ordinary key is not a request gesture`);
  await t.tap('click'); assert.equal(t.asks.length,1,`${name}: the first tap asks`); assert.equal(t.notes.length,0);
  await t.tap('click'); assert.equal(t.asks.length,1,`${name}: only once`);
}
{ const t=await scenario({ua:SAFARI,platform:'MacIntel',blocked:true}); await t.tap('click'); assert.equal(t.asks.length,0,'the permission sheet is open, so it waits'); }
{ const t=await scenario({ua:SAFARI,platform:'MacIntel'}); await t.tap('keydown',{key:'Enter'}); assert.equal(t.asks.length,1,'Enter counts as a gesture'); }
console.log('Notifications auto-ask: browsers that allow it ask at load, Safari and Firefox on the first tap, never when decided, switched off, dismissed or in view-as.');
