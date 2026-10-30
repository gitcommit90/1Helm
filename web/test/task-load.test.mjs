import assert from 'node:assert/strict';import {build} from 'esbuild';
const result=await build({entryPoints:['src/task-load.ts'],bundle:true,format:'esm',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
// A failed load is never "loaded": it is due again on open or return at once, and on a repaint after the pause.
const s={loaded:false,loading:false,loadFailAt:0};
assert.equal(m.loadDue(s,1000),true,'never tried: due');
s.loading=true;assert.equal(m.loadDue(s,1000,true),false,'already loading: not due');s.loading=false;
s.loadFailAt=5000;assert.equal(m.loadDue(s,6000),false,'repaint right after a failure waits');
assert.equal(m.loadDue(s,6000,true),true,'opening it again always tries');
assert.equal(m.loadDue(s,5000+m.LOAD_COOLDOWN),true,'a repaint after the pause tries');
s.loaded=true;assert.equal(m.loadDue(s,99999,true),false,'loaded: never due');
// The failure line shows only for a task with nothing to show, and only once the load stopped.
assert.equal(m.loadFailed({loaded:false,loading:false,loadFailAt:5,messages:[]},10),true);
assert.equal(m.loadFailed({loaded:false,loading:true,loadFailAt:5,messages:[]},10),false,'retrying: the quiet loading state');
assert.equal(m.loadFailed({loaded:false,loading:false,loadFailAt:5,messages:[{}]},10),false,'messages already shown are kept without a line');
// Retries are bounded and back off. A fake page clock drives the timers.
const mk=()=>{const timers=[];let t=0,hidden=false,pauseCb=[],visCb=[];return {timers,env:{now:()=>t,hidden:()=>hidden,setTimer:(fn,ms)=>{const x={fn,at:t+ms};timers.push(x);return x},clearTimer:x=>{const i=timers.indexOf(x);if(i>=0)timers.splice(i,1)},onPause:fn=>{pauseCb.push(fn);return()=>{pauseCb=pauseCb.filter(f=>f!==fn)}},whenVisible:()=>hidden?new Promise(ok=>visCb.push(ok)):Promise.resolve()},
 advance(ms){t+=ms;for(const x of [...timers])if(x.at<=t){timers.splice(timers.indexOf(x),1);x.fn()}},hide(){hidden=true;pauseCb.forEach(f=>f())},show(){hidden=false;visCb.splice(0).forEach(f=>f())}}};
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve()};
const failing=(env,waits,tries=3)=>m.withRetries(async()=>{throw new Error('x')},{env,sleep:async ms=>{waits.push(ms)},tries});
{const waits=[];await assert.rejects(failing(mk().env,waits),/x/);assert.deepEqual(waits,[1000,3000]);}
{let calls=0;assert.equal(await m.withRetries(async()=>{calls++;if(calls<2)throw new Error('x');return 'ok'},{env:mk().env,sleep:async()=>{}}),'ok');assert.equal(calls,2,'a failed try is retried');}
// A timeout that fires on a visible page aborts the request and counts as a failed try.
{const p=mk();let aborted=0,calls=0;const r=m.withRetries(sig=>{calls++;return new Promise((_,no)=>sig.addEventListener('abort',()=>{aborted++;no(new Error('signal timed out'))}))},{env:p.env,sleep:async()=>{},tries:2,timeoutMs:15000});
 await flush();p.advance(15000);await flush();p.advance(15000);await flush();await assert.rejects(r,/timed out/);assert.equal(calls,2);assert.equal(aborted,2);}
// The timer fires while the page is hidden: not a failure. The same try runs again when the page is visible, and it succeeds without an error.
{const p=mk();let calls=0;const r=m.withRetries(sig=>{calls++;if(calls>1)return Promise.resolve('loaded');return new Promise((_,no)=>sig.addEventListener('abort',()=>no(new Error('signal timed out'))))},{env:p.env,sleep:async()=>{},tries:1,timeoutMs:15000});
 await flush();p.hide();p.advance(15000);await flush();assert.equal(calls,1,'waits while hidden');p.show();assert.equal(await r,'loaded');assert.equal(calls,2,'tries 1 only: the hidden timeout was not counted');}
// A frozen page: the timer fires long after its time with no visibility event seen. Also not a failure.
{const p=mk();let calls=0;const r=m.withRetries(sig=>{calls++;if(calls>1)return Promise.resolve('loaded');return new Promise((_,no)=>sig.addEventListener('abort',()=>no(new Error('signal timed out'))))},{env:p.env,sleep:async()=>{},tries:1,timeoutMs:15000});
 await flush();p.advance(600000);await flush();assert.equal(await r,'loaded');assert.equal(calls,2);}
console.log('Task load: failed load stays not-loaded, open or return retries at once, repaint waits, messages kept, bounded backoff, hidden or frozen timeouts not counted passed.');
