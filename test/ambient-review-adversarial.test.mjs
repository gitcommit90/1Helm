// Independent second-stage contract/state tests. Fake model decisions are NOT quality proof.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { Ledger } from '../src/index.js';
const modulePath=process.env.AMBIENT_MODULE||new URL('../src/ee/ambient.js',import.meta.url).pathname;
const {AmbientStore,validateAmbient}=await import(pathToFileURL(modulePath));
const {ambientReviewInput,applyAmbientReview}=await import(new URL('./ambient-review.js',pathToFileURL(modulePath)));
const T=Date.parse('2026-10-10T17:00:00Z');
const lines=['I need to renew the pottery permit.','I already renewed the pottery permit.','The tutorial used a pretend example.'].map((text,i)=>({text,at:T+i*1000,speaker:'wearer',is_user:true,utterance_id:`u${i}`,offset:0}));
const candidates=validateAmbient({items:[{kind:'task',line:0,quote:lines[0].text,status:'open',speech_act:'intention'},{kind:'task',line:1,quote:lines[1].text,status:'completed',speech_act:'intention',relation:'completion',supersedes:['line:0']}]},lines);
const input=ambientReviewInput(candidates,lines,[{...lines[2],utterance_id:'prefix'}],[{...lines[2],utterance_id:'suffix'}]);
const retain=c=>({id:c.id,verdict:'retain',reason:'direct_personal_intent',context:[c.line]});
const raw=()=>({items:input.candidates.map(retain)});
assert.equal(input.candidates.length,2);
assert.ok(input.context.some(x=>x.id==='before:0')&&input.context.some(x=>x.id==='after:0'));
for(const c of input.candidates)assert.deepEqual(Object.keys(c).sort(),['id','line','quote'],'second reviewer must not receive first-stage intention labels');
for(const response of [null,{}, {items:[]},{items:[...raw().items,raw().items[0]]},{items:[...raw().items,{id:'candidate:999',verdict:'retain',reason:'direct_personal_intent',context:['current:0']}]},
 {items:raw().items.map(x=>({...x,quote:'Invented instruction'}))},{items:raw().items.map(x=>({...x,context:['missing:0']}))},{items:raw().items.map(x=>({...x,context:['current:2']}))},
 {items:raw().items.map(x=>({...x,reason:'independent_personal_need'}))},{items:raw().items.map(x=>({...x,verdict:'execute'}))}]){
 const got=applyAmbientReview(candidates,input,response);
 for(const item of got.filter(x=>x.semantic_review?.verdict==='uncertain')){assert.equal(item.kind,'idea');assert.equal(item.status,'open');assert.equal(item.needs_review,true);assert.equal(item.relation,null);assert.deepEqual(item.supersedes,[]);assert.equal(item.notification_status,undefined);}
 assert.ok(got.some(x=>x.semantic_review?.verdict==='uncertain'),'malformed decision must not silently retain everything');
 assert.ok(got.every(x=>candidates.some(c=>c.text===x.text&&c.owner===x.owner)),'review cannot invent quotes/owners');
}
const reduced=applyAmbientReview(candidates,input,{items:[{...retain(input.candidates[0]),verdict:'drop',reason:'example_or_quotation'},retain(input.candidates[1])]});
assert.equal(reduced.length,1);assert.deepEqual(reduced[0].supersedes,[]);assert.equal(reduced[0].relation,null);assert.equal(reduced[0].relationship_unresolved,true);assert.equal(reduced[0].needs_review,true);
const down=applyAmbientReview(candidates,input,{items:[{...retain(input.candidates[0]),verdict:'uncertain',reason:'ambiguous_speech_act'},retain(input.candidates[1])]});
assert.equal(down[0].kind,'idea');assert.deepEqual(down[1].supersedes,[],'completion cannot resolve downgraded same-chunk item');
for(const verdict of ['drop','uncertain']){
 const mixed=structuredClone(candidates);mixed[1].supersedes.push('external-still-valid');
 const got=applyAmbientReview(mixed,ambientReviewInput(mixed,lines),{items:[{...retain(input.candidates[0]),verdict,reason:verdict==='drop'?'example_or_quotation':'ambiguous_speech_act'},retain(input.candidates[1])]});
 const update=got.at(-1);assert.deepEqual(update.supersedes,[],'invalidated local relationship cannot retain external hiding links');assert.equal(update.relation,null);assert.equal(update.relationship_unresolved,true);assert.equal(update.needs_review,true);
}
const kept=applyAmbientReview(candidates,input,raw());for(let i=0;i<kept.length;i++){const {semantic_review,...original}=kept[i];assert.deepEqual(original,candidates[i]);}
console.log('PASS closed review schema, no invented signal/ownership, before/after context and same-chunk link invalidation');
{
 const previous=[{id:'prior-reminder',kind:'reminder',text:'Remind me tomorrow to call Dr Avery about the kiln repair.',owner:'wearer',source_at:T-1000}];
 const quote='Change the call to Dr Avery about the kiln repair to Friday, not tomorrow.';
 const classify=(extra={},prior=previous)=>validateAmbient({items:[{kind:'decision',speech_act:'intention',status:'open',line:0,quote,relation:'correction',supersedes:['previous:0'],due_text:'Friday',...extra}]},[{text:quote,at:T,speaker:'wearer',is_user:true,offset:0}],prior)[0];
 const corrected=classify();assert.equal(corrected.kind,'reminder');assert.equal(corrected.notification_status,'not_scheduled');assert.equal(corrected.due_text,'Friday');assert.deepEqual(corrected.supersedes,['prior-reminder']);
 for(const prior of [[{...previous[0],owner:'guest'}],[{...previous[0],text:'Remind me to call Dr Rowan about the kiln repair.'}]]){const item=classify({},prior);assert.equal(item.kind,'decision');assert.equal(item.notification_status,undefined);}
 const mixed=classify({supersedes:['previous:0','previous:1']},[...previous,{...previous[0],id:'prior-task',kind:'task'}]);assert.equal(mixed.kind,'decision');
 const unsure=classify({speech_act:'uncertain'});assert.equal(unsure.kind,'idea');assert.deepEqual(unsure.supersedes,[]);
 const taskPrior=[{...previous[0],kind:'task'}];
 const completedQuote='I finished the call to Dr Avery about the kiln repair.';
 const completed=validateAmbient({items:[{kind:'decision',speech_act:'intention',line:0,quote:completedQuote,status:'completed',relation:'completion',supersedes:['previous:0']}]},[{text:completedQuote,at:T,speaker:'wearer',is_user:true,offset:0}],taskPrior)[0];
 assert.equal(completed.kind,'task');assert.equal(completed.status,'completed');assert.equal(completed.notification_status,undefined);assert.deepEqual(completed.supersedes,['prior-reminder']);
 console.log('PASS decision-like reminder correction inherits category only through validated same-owner same-person all-reminder links');
}

function fixture(){
 const db=new DatabaseSync(':memory:'),kv=new Map([['tenant','review-fixture'],['status','active']]);db.exec('CREATE TABLE convs(id INTEGER PRIMARY KEY,start_time INTEGER,r2_key TEXT)');
 const sql={exec(q,...args){if(!args.length&&q.split(';').filter(x=>x.trim()).length>1){db.exec(q);return{toArray:()=>[]};}const st=db.prepare(q),rows=/^\s*(SELECT|WITH|PRAGMA)/i.test(q)?st.all(...args):(st.run(...args),[]);return{toArray:()=>rows};}};
 const F={db,sql,kv,extractCalls:0,reviewCalls:0,mode:'on',forbidden:'',privacyCalls:0};
 const env={ONEHELM_EE:"1hc",OPENROUTER_API_KEY:'unit-no-network',WS:{get:async()=>null},DB:{prepare(){return{bind(){return this;},first:async()=>({status:'active',plan:'plus'})};}},RESIDENT:{idFromName:x=>x,get:()=>({ambientPrivacy:async texts=>{F.privacyCalls++;return{mode:F.mode,allowed:texts.flatMap((s,i)=>F.forbidden&&s.includes(F.forbidden)?[]:[i])};}})}};
 F.host={sql,env,gen:0,ctx:{storage:{transactionSync:fn=>{db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}}},tid:()=> 'review-fixture',get:k=>kv.get(k),put:(k,v)=>v==null?kv.delete(k):kv.set(k,String(v)),arm:async()=>{},bump(){},ledger:()=>({settle:async()=>{}})};
 F.install=()=>{F.store=new AmbientStore(F.host);F.store.extract=async ls=>{F.extractCalls++;return{items:ls.map((l,line)=>({kind:'task',quote:l.text,line,status:'open',speech_act:'intention'}))};};F.store.review=async info=>{F.reviewCalls++;return{items:info.candidates.map(retain)};};};F.install();
 F.conv=(text=lines[0].text)=>({id:91,state:'COMPLETED',start_time:T,end_time:T+1000,transcriptions:[{realtime:false,utterances:[{id:'r0',text,spoken_at:T,speaker:{id:'owner',is_user:true}}]}]});
 F.ready=()=>sql.exec('UPDATE ambient_chunks SET retry_at=0');F.items=()=>F.store.query().items;return F;
}
{
 const F=fixture();await F.store.ingest('fixture','91',F.conv());F.store.review=async()=>{F.reviewCalls++;throw Error('simulated reviewer network failure');};await F.store.run(true);
 assert.equal(F.items().length,0);assert.equal(F.store.query().coverage.failed,1);assert.ok(F.db.prepare('SELECT draft_json FROM ambient_chunks').get().draft_json);
 F.host.gen++;F.install();F.ready();await F.store.run(true);assert.equal(F.extractCalls,1,'restart/review retry reuses paid grounded draft');assert.equal(F.reviewCalls,2);assert.equal(F.items().length,1);assert.equal(F.db.prepare('SELECT draft_json FROM ambient_chunks').get().draft_json,null);
 console.log('PASS review failure never publishes and restart reuses matching grounded draft');
}
for(const mutation of ['privacy','repair','source']){
 const F=fixture();await F.store.ingest('fixture','91',F.conv());const normal=F.store.extract;
 F.store.extract=async(...args)=>{const value=await normal(...args);if(mutation==='privacy')F.mode='off';if(mutation==='repair')F.store.retrySource('fixture','91');if(mutation==='source')await F.store.ingest('fixture','91',F.conv('I need to deliver the replacement kiln shelf.'));return value;};
 await F.store.run(true);assert.equal(F.reviewCalls,0,mutation+' between stages cannot dispatch second model');assert.equal(F.items().length,0);F.db.close();
}
{
 const F=fixture();await F.store.ingest('fixture','91',F.conv());F.store.review=async info=>{F.reviewCalls++;F.forbidden='pottery permit';return{items:info.candidates.map(retain)};};await F.store.run(true);assert.equal(F.items().length,0,'forget during review prevents publish');assert.equal(F.store.query().coverage.failed,1);
 F.forbidden='';F.install();F.store.retrySource('fixture','91');F.ready();await F.store.run(true);assert.equal(F.extractCalls,2,'repair epoch invalidates previous paid draft');assert.equal(F.items().length,1);
 console.log('PASS memory off, source replacement, repair epoch and forget between stages fail closed');
}
// Forgotten topic lines cannot keep unrelated historical matches in the cache basis.
{
 const F=fixture(),conv=F.conv();conv.transcriptions[0].utterances.push({id:'hidden-topic',text:'This forgotten topic selected an old gardening memory.',spoken_at:T+1000,speaker:{id:'owner',is_user:true}});
 F.forbidden='forgotten topic';F.store.previous=ls=>ls.some(l=>l.text.includes('forgotten topic'))?[{id:'historical-match',text:'An archived gardening preference.',kind:'preference',owner:'wearer',source_at:T-1000}]:[];
 const original=F.store.extract;F.store.extract=async(ls,previous,...rest)=>{assert.equal(ls.length,1,'forgotten current line excluded');assert.deepEqual(previous,[],'historical matches selected only by forgotten topic must be recomputed');return original(ls,previous,...rest);};
 await F.store.ingest('fixture','91',conv);await F.store.run(true);assert.equal(F.items().length,1,'allowed task must not remain in perpetual context_changed retry');assert.equal(F.store.query().coverage.failed,0);assert.equal(F.extractCalls,1);assert.equal(F.reviewCalls,1);
 console.log('PASS privacy-filtered historical selection preserves allowed task without retry loop');
}
// Actual provider adapter and Ledger, synthetic HTTP only: interrupt specifically
// in the independently billed review stage after extraction has already settled.
{
 const F=fixture(),ledgerDb=new DatabaseSync(':memory:'),ledgerSql={exec(q,...args){if(!args.length&&q.split(';').filter(x=>x.trim()).length>1){ledgerDb.exec(q);return{toArray:()=>[]};}const st=ledgerDb.prepare(q),rows=/^\s*(SELECT|WITH|PRAGMA)/i.test(q)?st.all(...args):(st.run(...args),[]);return{toArray:()=>rows};}};
 const ledger=new Ledger({storage:{sql:ledgerSql,transactionSync:fn=>fn()}},{});await ledger.grant('test',1e12,'test');F.host.ledger=()=>ledger;F.host.env.PROMPT_CACHE='off';F.host.env.ROUTER_MODE='two';
 const installReal=()=>{F.store=new AmbientStore(F.host);};installReal();await F.store.ingest('fixture','91',F.conv());
 let extractionCalls=0,reviewCalls=0,finishOld;
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  assert.match(String(url),/^https:\/\/openrouter\.ai\//,'no real or unexpected network destination');
  const body=JSON.parse(options.body),input=JSON.parse(body.messages.at(-1).content),isReview=Array.isArray(input.candidates);
  const payload=isReview?{items:input.candidates.map(retain)}:{items:[{kind:'task',line:0,quote:input.lines[0].text,speech_act:'intention',status:'open',due_text:'',relation:null,supersedes:[]}]};
  const result=()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(payload)},finish_reason:'stop'}],usage:{cost:0.0004,prompt_tokens:200,completion_tokens:50}}),{headers:{'content-type':'application/json'}});
  if(!isReview){extractionCalls++;return result();}
  reviewCalls++;if(reviewCalls===1)return new Promise(resolve=>{finishOld=()=>resolve(result());});return result();
 };
 try{
  const running=F.store.run(true);for(let i=0;i<400&&!finishOld;i++)await new Promise(r=>setTimeout(r,5));assert.ok(finishOld,'first real review adapter reached');
  assert.equal(extractionCalls,1);assert.equal(F.items().length,0);assert.ok(ledger.totals().reserved_nano>0);assert.ok(ledger.totals().spent_nano>0);
  const draft=F.db.prepare('SELECT draft_json,reservation_id FROM ambient_chunks').get();assert.ok(draft.draft_json&&draft.reservation_id);
  const oldHost=F.host,oldGen=oldHost.gen;F.host={...oldHost,gen:0};assert.notEqual(F.host,oldHost);installReal();F.ready();await F.store.run(true);assert.equal(oldHost.gen,oldGen,'real replacement cannot mutate old in-memory generation');assert.equal(extractionCalls,1,'restart must not repay settled extraction');assert.equal(reviewCalls,2);assert.equal(F.items().length,1);assert.equal(ledger.totals().reserved_nano,0);
  const spent=ledger.totals().spent_nano,revision=F.kv.get('ambient_revision'),published=F.items();assert.equal(spent,920000,'exactly one settled extraction and one final review at marked-up fixture price');finishOld();await running;
  assert.equal(ledger.totals().spent_nano,spent,'late old review cannot charge released hold twice');assert.deepEqual(F.items(),published,'old host cannot replace committed items');assert.equal(F.kv.get('ambient_revision'),revision,'old host cannot publish a second revision');assert.equal(F.db.prepare('SELECT count(*) n FROM ambient_attempts').get().n,0);
  console.log('PASS actual review adapter crash recovery: grounded draft reused, holds released, once-only bill and no stale publish');
 }finally{globalThis.fetch=originalFetch;ledgerDb.close();F.db.close();}
}
