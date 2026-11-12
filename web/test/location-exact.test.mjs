// Exact location: the app asks the device for a precise fix (high accuracy, a recent one) and sends it unrounded with its accuracy in meters.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const out=(await build({entryPoints:['src/devperm.ts'],bundle:true,format:'esm',write:false})).outputFiles[0].text;
const mod='data:text/javascript;base64,'+Buffer.from(out).toString('base64');
const tick=()=>new Promise(r=>setTimeout(r,10));
const store=new Map(),posted=[],options=[];
globalThis.localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
globalThis.matchMedia=()=>({matches:false});
let click;
globalThis.document={addEventListener:(t,f)=>{if(t==='click')click=f},visibilityState:'visible',hasFocus:()=>true,activeElement:null,querySelectorAll:()=>[]};
globalThis.addEventListener=()=>{};
globalThis.performance??={now:()=>Date.now()};
// Made-up coordinates with many decimals.
const nav={permissions:{query:async()=>{throw Error('x')}},geolocation:{getCurrentPosition:(ok,_err,o)=>{options.push(o);ok({coords:{latitude:12.3456789,longitude:-98.7654321,accuracy:7.25}})}},mediaDevices:{getUserMedia:async()=>({getTracks:()=>[]})}};
Object.defineProperty(globalThis,'navigator',{value:nav,configurable:true});
globalThis.window=globalThis;
globalThis.fetch=async(url,init)=>{posted.push({url,body:JSON.parse(init.body)});return {ok:true,json:async()=>({location:{place:'1 Test St, Sampletown',at:1}})};};
const m=await import(mod);
m.dpInit({api:'/api',note(){},helper:()=>'H',repaint(){},shown:()=>false,look:false,nf:null});
click({target:{closest:()=>({dataset:{dp:'loc'}})},preventDefault(){}});
await tick();
assert.equal(options.length>=1,true,'the device was asked');
assert.equal(options[0].enableHighAccuracy,true,'a precise fix is requested');
assert.ok(options[0].maximumAge<=60e3,'a recent fix is used, not one from ten minutes ago');
assert.ok(posted.length>=1);for(const p of posted){assert.match(p.url,/\/location$/);assert.equal(p.body.lat,12.3456789,'latitude is sent unrounded');assert.equal(p.body.lng,-98.7654321,'longitude is sent unrounded');assert.equal(p.body.accuracy,7.25,'the accuracy in meters is sent');}
const l=m.dpLoc();
assert.deepEqual([l.lat,l.lng,l.accuracy],[12.3456789,-98.7654321,7.25],'each message carries the unrounded fix and its accuracy');
import {readFileSync} from 'node:fs';
const card=readFileSync('src/card.ts','utf8'),sf=card.slice(card.indexOf('function shareFix'),card.indexOf('wireCards({'));
assert.match(sf,/enableHighAccuracy: true/,'Share my location asks for a precise fix');assert.doesNotMatch(sf,/Math\.round|toFixed/,'Share my location does not round');assert.match(sf,/accuracy: p\.coords\.accuracy/,'Share my location sends the accuracy');
console.log('location-exact: precise request, unrounded fix with accuracy sent on start and with each message passed.');
process.exit(0);
