// Settings → Notifications → Devices signed up: the list (names, This device, last notification), Remove, the Mac app registering itself,
// and the browser cancelling its own sign-up before logout (nfBeforeLogout).
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundled=await build({entryPoints:['src/notif.ts'],bundle:true,format:'esm',write:false});
const code='data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64');
const tick=()=>new Promise(r=>setTimeout(r,5));
let n=0;
const CHROME_MAC='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const MACAPP=CHROME_MAC+' 1HelmDesktop/1.6.6';
const NOW=Date.now(), DAY=864e5;
const LIST=[
  {id:'d1',kind:'desktop',name:'Mac app',created_at:NOW-40*DAY,last_at:null,seen_at:NOW-1000,this_device:false},
  {id:'b1',kind:'browser',name:'Chrome on Mac',created_at:NOW-90*DAY,last_at:NOW-2*DAY,seen_at:null,this_device:false},
  {id:'p1',kind:'phone',name:'Android app',created_at:NOW-12*DAY,last_at:null,seen_at:null,this_device:false}];
async function scenario({ua,list=LIST,store={},unsubbed}){
  const calls=[],notes=[],docH={},ls=new Map(Object.entries(store)); let devices=list.map(x=>({...x}));
  const N=function(){};N.permission='granted';N.requestPermission=async()=>'granted';
  const sub={endpoint:'https://fcm.googleapis.com/fcm/send/abc',unsubscribe:async()=>{unsubbed?.push(1);return true;}};
  Object.assign(globalThis,{window:{PushManager:{},Notification:N},Notification:N,
    localStorage:{getItem:k=>ls.has(k)?ls.get(k):null,setItem:(k,v)=>ls.set(k,String(v)),removeItem:k=>ls.delete(k)},
    matchMedia:()=>({matches:false}),document:{addEventListener(t,f){(docH[t]??=[]).push(f);}},addEventListener(){},removeEventListener(){},
    fetch:async(u,o={})=>{
      const body=o.body?JSON.parse(o.body):null;calls.push({u:String(u),method:o.method||'GET',body});
      let out={ok:true};
      if(/\/notif\/devices/.test(u)) out={devices};
      else if(/\/notif\/device\/remove/.test(u)){devices=devices.filter(x=>x.id!==body.id);out={ok:true,removed:1};}
      else if(/\/notif(\?|$)/.test(u)&&!body) out={prefs:{needs:true,finished:true,sound:true,needs_text:true,meetings:true},push:{key:'AQAB',devices:devices.length,this_device:true},texting:false};
      return {ok:true,json:async()=>out};}});
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:ua,platform:'MacIntel',maxTouchPoints:0,serviceWorker:{getRegistration:async()=>({pushManager:{getSubscription:async()=>sub}}),addEventListener(){}}}});
  const M=await import(code+`#${n++}`), repaints=[];
  M.nfInit({live:{api:'/api',slug:'x'},repaint:()=>repaints.push(1),note:(...a)=>notes.push(a),srow:(i,t,s,r)=>`<ROW>${t}|${s}|${r}</ROW>`,helper:()=>'Helper'});
  for(let i=0;i<6;i++)await tick();
  const clickRm=async(id)=>{const el={dataset:{nfrm:id},disabled:false};for(const f of docH.click||[])f({target:{closest:sel=>sel==='[data-nfrm]'?el:null},preventDefault(){}});for(let i=0;i<6;i++)await tick();};
  return {M,calls,notes,repaints,ls,clickRm};
}
// The list: every device with its name, when it signed up and the last one delivered; a Remove button each.
{ const t=await scenario({ua:CHROME_MAC}); const html=t.M.nfHtml();
  assert.match(html,/Devices signed up/); assert.match(html,/Mac app\|Signed up [^|]*· Last opened today/); assert.match(html,/Chrome on Mac\|Signed up [^|]*· Last notification /);
  assert.match(html,/Android app\|[^|]*· No notification delivered yet/); assert.equal((html.match(/data-nfrm=/g)||[]).length,3);
  assert.match(html,/Mac app and a browser on a Mac are both listed/,'hint when both Mac app and a browser on Mac are listed'); }
{ const t=await scenario({ua:CHROME_MAC,list:LIST.filter(x=>x.id!=='b1')}); assert.doesNotMatch(t.M.nfHtml(),/both listed/,'no hint without a browser on Mac'); }
{ const t=await scenario({ua:CHROME_MAC,list:[]}); assert.doesNotMatch(t.M.nfHtml(),/Devices signed up/,'no list while nothing is signed up'); }
// Remove another device: asks the server by id, drops the row, tells the person.
{ const t=await scenario({ua:CHROME_MAC}); await t.clickRm('b1');
  const r=t.calls.find(c=>/device\/remove/.test(c.u)); assert.equal(r.method,'POST'); assert.deepEqual(r.body,{id:'b1'});
  const html=t.M.nfHtml(); assert.doesNotMatch(html,/Chrome on Mac\|Signed up/); assert.match(html,/Mac app/); assert.equal(t.notes.at(-1)[0],'Removed'); assert.doesNotMatch(html,/both listed/); }
// Removing this device is the same as turning it off: its own browser sign-up is cancelled too.
{ const un=[]; const t=await scenario({ua:CHROME_MAC,unsubbed:un,list:[{...LIST[1],this_device:true}]}); await t.clickRm('b1');
  assert.equal(un.length,1,'the browser unsubscribed'); assert.ok(t.calls.some(c=>/notif\/unsub/.test(c.u)&&c.body.endpoint==='https://fcm.googleapis.com/fcm/send/abc')); assert.equal(t.ls.get('1hc.nf.off'),'1'); }
// The Mac app lists itself (a stable id) and a heartbeat goes each time Settings loads; switching it off removes the row.
{ const t=await scenario({ua:MACAPP,store:{'1hc.nf.desktop':'1'}}); const reg=t.calls.filter(c=>/notif\/desktop$/.test(c.u));
  assert.ok(reg.length>=1); assert.match(reg[0].body.id,/^[A-Za-z0-9-]{16,64}$/); assert.equal(t.ls.get('1hc.nf.desktop.id'),reg[0].body.id);
  assert.ok(t.calls.some(c=>/notif\/devices\?endpoint=desktop%3A/.test(c.u)),'the list marks this Mac app by its desktop endpoint'); }
// Before logout: a browser cancels its sign-up (server row, then the push subscription); the Mac app removes its row; a phone app does nothing here.
{ const un=[]; const t=await scenario({ua:CHROME_MAC,unsubbed:un}); t.calls.length=0; await t.M.nfBeforeLogout();
  assert.ok(t.calls.some(c=>/notif\/unsub/.test(c.u))); assert.equal(un.length,1); }
{ const t=await scenario({ua:MACAPP,store:{'1hc.nf.desktop':'1'}}); t.calls.length=0; await t.M.nfBeforeLogout(); assert.ok(t.calls.some(c=>/notif\/desktop\/off$/.test(c.u)&&c.body.id)); }
console.log('notif-devices: all ok');
