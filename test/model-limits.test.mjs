// Actual Resident + managed fetch, both engines. No provider calls or credentials.
import {world,tick,assert} from './deploy-harness.mjs';
import {MODEL_LIMITS,meaningfulDelta} from '../src/model-limits.js';
const original={...MODEL_LIMITS};Object.assign(MODEL_LIMITS,{headersMs:150,idleMs:150,totalMs:550});
const enc=new TextEncoder(),event=x=>enc.encode(`data: ${JSON.stringify(x)}\n\n`);
const finish=(reason='stop',content='Done.',cost=.0001)=>new Response(new ReadableStream({start(c){
 c.enqueue(event({choices:[{delta:{content},finish_reason:reason}],usage:{prompt_tokens:100,completion_tokens:reason==='length'?50000:12,cost}}));c.enqueue(enc.encode('data: [DONE]\n\n'));c.close();
}}));
let scenarioFetch=null;
globalThis.fetch=async(url,init={})=>{
 const body=init.body?JSON.parse(init.body):{};
 if(String(url).endsWith('/systemone'))return new Response(JSON.stringify({answers:{is_task:{noul:1},category:{choice:'general'},unmet:{noul:0}},usage:{cost:0}}));
 if(String(url).endsWith('/chat/completions')){
  if(!body.stream)return new Response(JSON.stringify({choices:[{message:{content:'{"title":"Task","result":"Finished","summary":"Task result"}'}}],usage:{cost:0}}));
  return scenarioFetch(body,init.signal);
 }
 throw new Error('Unexpected fixture request');
};
let checks=0,lateCancelled=0;
const toolAnswer=(commands=['echo once'])=>new Response(new ReadableStream({start(c){c.enqueue(event({choices:[{delta:{tool_calls:commands.map((command,index)=>({index,id:`tool-${index}`,function:{name:'run_command',arguments:JSON.stringify({command,step_title:'Run fixture command'})}}))},finish_reason:'tool_calls'}],usage:{prompt_tokens:100,completion_tokens:12,cost:.001}}));c.enqueue(enc.encode('data: [DONE]\n\n'));c.close();}}));
async function scenario(name,fn){for(const engine of ['classic','pi']){
 const W=world({engine,env:{OPENROUTER_API_KEY:'synthetic-not-a-key',ROUTER_MODE:'classic'}});
 W.R.put('tenant','t1');const session=W.R.newSession(name),events=[],requests=[];
 fn.setup?.(W,engine);
 scenarioFetch=(body,signal)=>{requests.push({body,signal});return fn.fetch(body,signal,requests.length,W);};
 const started=Date.now();const run=W.R.runTurn('t1','main','1','Please do this task',e=>events.push(e),{session,...(typeof fn.opts==='function'?fn.opts(engine):fn.opts)});
 const r=await fn.run({W,session,events,requests,run,started});
 await W.settle();assert.equal(W.ledger.open.size,0,'all holds settled/released');
 if(r)assert.equal(W.card(r.turn).status,fn.status||'failed');
 checks++;console.log(`PASS [${engine}] ${name}`);
}}
try{
 await scenario('headers never resolve; upstream aborted, no tools, terminal result',{
  fetch:()=>new Promise(()=>{}),async run({run,requests,W,events}){const r=await run;assert.equal(r.error,'model_timeout');assert.equal(r.failure_phase,'headers');assert.equal(r.recoverable,true);assert.equal(requests.length,1);assert(requests[0].signal.aborted);assert.equal(W.sent.length,0);assert.equal(W.execs.length,0);assert(events.some(e=>e.t==='model_wait'&&e.phase==='waiting'));assert.equal(events.at(-1).t,'done');return r;}
 });
 await scenario('heartbeat-only SSE cannot keep model alive',{
  fetch:()=>{let timer;return new Response(new ReadableStream({start(c){timer=setInterval(()=>c.enqueue(enc.encode(': heartbeat\n\ndata: {"choices":[{"delta":{}}]}\n\n')),10);},cancel(){clearInterval(timer);}}));},
  async run({run,requests,events}){const r=await run;assert.equal(r.failure_phase,'idle');assert.equal(requests.length,1);assert(!events.some(e=>e.t==='model_wait'&&e.phase==='responding'));return r;}
 });
 await scenario('valid reasoning resets idle but absolute total still cancels',{
  fetch:()=>{let timer,n=0;return new Response(new ReadableStream({start(c){timer=setInterval(()=>c.enqueue(event({choices:[{delta:{reasoning_details:[{type:'reasoning.text',text:`consideration ${n++}`} ]}}]})),20);},cancel(){clearInterval(timer);}}));},
  async run({run,events}){const r=await run;assert.equal(r.failure_phase,'total');assert(events.some(e=>e.t==='model_wait'&&e.phase==='responding'));return r;}
 });
 await scenario('two capped no-tool calls stop, charge both, no reporting call',{
  fetch:()=>finish('length','',.001),async run({run,requests,W}){const r=await run;assert.equal(r.error,'model_output_limit');assert.equal(requests.length,2);assert.match(r.reply,/output limit twice/);assert.equal(r.tool_calls,0);assert.equal(r.out,100000);assert.equal(r.charge,2300000);assert.equal(W.ledger.spent(),r.charge);return r;}
 });
 await scenario('capped no-tool cost enters soft spend guard',{
  setup(W){const base=W.R.spendStart.bind(W.R);W.R.spendStart=async(tc,opts)=>{await base(tc,opts);tc.guard.soft=10000000;};},
  fetch:(_b,_s,n)=>n===1?finish('length','',.02):finish('stop','I stopped at the spending check.',.001),status:'paused',
  async run({run,requests}){const r=await run;assert.equal(requests.length,2);assert(!requests[1].body.tools||requests[1].body.tool_choice==='none','soft budget permits only a tools-off report: no tools, or the same tools with tool_choice none (r35-cache-fix)');assert.equal(r.error,null);assert.equal(r.hit_limit,1);return r;}
 });
 await scenario('usage before silent tail is billed exactly once',{
  fetch:()=>new Response(new ReadableStream({start(c){c.enqueue(event({choices:[{delta:{}}],usage:{prompt_tokens:321,completion_tokens:123,cost:.004}}));}})),
  async run({run,W}){const r=await run;assert.equal(r.error,'model_timeout');assert.equal(r.in,321);assert.equal(r.out,123);assert.equal(r.charge,4600000);assert.equal(W.ledger.spent(),4600000);assert.equal(W.ledger.log.filter(x=>x[0]==='settle'&&x[2]>0).length,1);return r;}
 });
 await scenario('partial valid tool call then silence never dispatches',{
  fetch:()=>new Response(new ReadableStream({start(c){c.enqueue(event({choices:[{delta:{tool_calls:[{index:0,id:'partial',function:{name:'run_command',arguments:'{"command":"echo must-not-run"}'}}]}}]}));}})),
  async run({run,W}){const r=await run;assert.equal(r.error,'model_timeout');assert.equal(W.execs.length,0);assert.equal(r.tool_calls,0);return r;}
 });
 await scenario('Stop wins over deadline and cancels pending provider',{
  fetch:()=>new Promise(()=>{}),status:'stopped',async run({run,W,requests}){await W.until(()=>requests.length===1);W.R.hardStop([...W.R.active.values()][0]);const r=await run;assert.equal(r.reply,'Stopped.');assert.equal(r.error,null);assert.equal(r.recoverable,undefined);assert(requests[0].signal.aborted);return r;}
 });
 await scenario('late ignored provider response is cancelled, no late tools or overwrite',{
  fetch:()=>new Promise(resolve=>setTimeout(()=>resolve(new Response(new ReadableStream({start(c){c.enqueue(event({choices:[{delta:{tool_calls:[{index:0,id:'late',function:{name:'run_command',arguments:'{"command":"echo late"}'}}]}}]}));},cancel(){lateCancelled++;}}))),250)),
  async run({run,W}){const r=await run;const saved=W.turns()[0].reply;await tick(180);assert(lateCancelled>0);assert.equal(W.execs.length,0);assert.equal(W.turns()[0].reply,saved);assert.equal(W.turns().length,1);return r;}
 });
 await scenario('[DONE] closes read even if provider keeps socket open',{
  fetch:()=>new Response(new ReadableStream({start(c){c.enqueue(event({choices:[{delta:{content:'Done.'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:5,cost:.001}}));c.enqueue(enc.encode('data: [DONE]\n\n'));}})),status:'complete',
  async run({run,requests}){const r=await run;assert.equal(r.error,null);assert.equal(r.reply,'Done.');assert.equal(requests.length,1);return r;}
 });
 await scenario('managed two-route stream aborts before first frame without fallback',{
  setup(W){W.env.ROUTER_MODE='two';},
  fetch:(_body,signal)=>new Response(new ReadableStream({start(c){signal.addEventListener('abort',()=>c.error(signal.reason),{once:true});}})),
  async run({run,requests}){const r=await run;assert.equal(r.error,'model_timeout');assert.equal(requests.length,1,'timeout does not move to another model');assert.equal(requests[0].body.max_tokens,undefined,'an empty saved max output sends no max_tokens');assert(requests[0].signal.aborted);return r;}
 });
 await scenario('completed external effect is not replayed after model timeout',{
  fetch:(_b,_s,n)=>n===1?toolAnswer():new Promise(()=>{}),
  async run({run,W,requests}){const r=await run;assert.equal(r.error,'model_timeout');assert.equal(W.execs.length,1);assert.equal(r.tool_calls,1);assert.equal(requests.length,2);return r;}
 });
 await scenario('step-limit reporting timeout gets truthful failure, including usage',{
  opts:engine=>({max_steps:engine==='pi'?2:1}),
  fetch:(_b,_s,n)=>n===1?toolAnswer():new Response(new ReadableStream({start(c){c.enqueue(event({choices:[{delta:{}}],usage:{prompt_tokens:32,completion_tokens:13,cost:.002}}));}})),
  async run({run,W}){const r=await run;assert.equal(r.error,'model_timeout');assert.match(r.reply,/stopped this attempt/);assert.equal(r.charge,3450000);assert.equal(r.out,25);assert.equal(W.execs.length,1);return r;}
 });
 await scenario('single output recovery allowance survives actual Resident rebuild',{
  setup(W){W.env.RESUME_DELAY_MS=0;W.env.RESUME_WRITE_DELAY_MS=0;},
  fetch:(_b,_s,n,W)=>{if(n===2)return new Promise(()=>{});if(n===3){const row=W.dodb.prepare('SELECT extra FROM turn_runs').get();assert.equal(JSON.parse(row.extra).outputLimitRetries,1,'journalInput did not reset the allowance');}return finish('length','',.001);},
  async run({W,session,requests,run}){
   await W.until(()=>requests.length===2);const old=W.R,tc=[...old.active.values()][0];
   const row=W.dodb.prepare('SELECT * FROM turn_runs').get();assert.equal(JSON.parse(row.extra).outputLimitRetries,1);
   W.kill();const R=W.boot();tc.ac.abort();run.catch(()=>{});await tick(5);await R.alarm();await W.settle(R);
   const saved=W.turns()[0];assert.equal(saved.error,'model_output_limit');assert.equal(saved.session,session);assert.equal(requests.length,3,'resumed retry cannot grant another attempt');assert.equal(W.cards().length,1);assert.equal(W.turns().length,1);return {turn:saved.id};
  }
 });
 await scenario('paid repetition attempt plus timed-out retry retains all usage',{
  fetch:(_b,_s,n)=>n===1?finish('stop','repeat this phrase forever '.repeat(400),.003):new Promise(()=>{}),
  async run({run,W,requests}){const r=await run;assert.equal(r.error,'model_timeout');assert.equal(requests.length,2);assert.equal(r.charge,3450000);assert.equal(r.in,100);assert.equal(r.out,12);assert.equal(W.ledger.spent(),r.charge);return r;}
 });
 await scenario('optional handoff timeout does not fail an already completed task',{
  fetch:(_b,_s,n)=>n===1?toolAnswer(['echo first','echo second','echo third']):n===2?finish('stop','Finished successfully.',.001):new Response(new ReadableStream({start(c){c.enqueue(event({choices:[{delta:{}}],usage:{prompt_tokens:32,completion_tokens:13,cost:.002}}));}})),status:'complete',
  async run({run,W,requests}){const r=await run;assert.equal(r.error,null);assert.equal(r.recoverable,undefined);assert.equal(r.reply,'Finished successfully.');assert.equal(requests.length,3);assert.equal(W.execs.length,3);assert.equal(r.charge,4600000);assert.equal(r.out,37);assert.equal(W.ledger.spent(),r.charge);return r;}
 });
 await scenario('late steer reporting timeout preserves the steer and truthful failure',{
  opts:{max_steps:2},
  fetch:(_b,_s,n,W)=>{if(n===2){const session=W.dodb.prepare('SELECT session FROM cards LIMIT 1').get().session;assert.equal(W.R.steerOrOpen(session,{type:'msg',text:'Also include my new request'}).mode,'steer');}return n<=2?toolAnswer():new Promise(()=>{});},
  async run({run,W,requests}){const r=await run;assert.equal(r.error,'model_timeout');assert.match(r.reply,/stopped this attempt/);assert.equal(requests.length,3);assert(!requests[2].body.tools||requests[2].body.tool_choice==='none');assert.match(JSON.stringify(requests[2].body.messages),/Also include my new request/);assert.equal(W.cards().length,1);return r;}
 });
 await scenario('failure-journal write error still releases the model hold',{
  setup(W){W.R.journalModelRecovery=()=>{throw new Error('fixture journal unavailable');};},
  fetch:()=>new Promise(()=>{}),
  async run({run,W}){const r=await run;assert.equal(r.error,'model_timeout');assert.equal(W.ledger.open.size,0);assert.equal(W.ledger.log.filter(x=>x[0]==='settle').length,1);return r;}
 });
 await scenario('late steer cannot reset output-limit recovery allowance',{
  fetch:(_b,_s,n,W)=>{const session=W.dodb.prepare('SELECT session FROM cards LIMIT 1').get().session;assert.equal(W.R.steerOrOpen(session,{type:'msg',text:`Additional request ${n}`}).mode,'steer');return finish('length','',.001);},
  async run({run,requests}){const r=await run;assert.equal(r.error,'model_output_limit');assert.equal(requests.length,2);return r;}
 });
 await scenario('Workers AI observed tokens on timeout are billed at existing token prices',{
  setup(W){delete W.env.OPENROUTER_API_KEY;W.env.AI.run=async()=>new ReadableStream({start(c){c.enqueue(event({choices:[{delta:{}}],usage:{prompt_tokens:1000,completion_tokens:100}}));}});},
  fetch:()=>{throw new Error('OpenRouter must not be used');},
  async run({run,W}){const r=await run;assert.equal(r.error,'model_timeout');assert.equal(r.in,1000);assert.equal(r.out,100);assert(r.charge>0);assert.equal(W.ledger.spent(),r.charge);return r;}
 });
 assert(meaningfulDelta({reasoning_details:[{text:'x'}]}));assert(!meaningfulDelta({}));
 console.log(`model-limits: ${checks} integration checks passed`);
}finally{Object.assign(MODEL_LIMITS,original);}
