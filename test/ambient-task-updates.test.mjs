import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { AmbientStore, ambientLines, validateAmbient } from '../src/ee/ambient.js';
import { retainReview } from './ambient-review-stub.mjs';
import { speechActConversation } from './fixtures/ambient-speech-acts.mjs';

const prior={id:'prior-task',kind:'task',text:'Return the library books.',owner:'wearer',source_at:1000};
const update=(extra={},previous=[prior],quote='I returned the library books. That is done.')=>validateAmbient({items:[{kind:'decision',speech_act:'intention',line:0,quote,status:'completed',relation:'completion',supersedes:previous.map((_,i)=>`previous:${i}`),...extra}]},[{text:quote,speaker:'wearer',is_user:true,at:2000,offset:0}],previous)[0];
assert.equal(update().kind,'task');assert.equal(update().notification_status,undefined);
for(const [extra,previous,quote,kind] of [
  [{speech_act:'uncertain'},[prior],undefined,'idea'],
  [{speech_act:'tentative_intention'},[prior],undefined,'idea'],
  [{},[{...prior,owner:'guest'}],undefined,'decision'],
  [{},[prior,{...prior,id:'reminder',kind:'reminder'}],undefined,'decision'],
  [{},[{...prior,text:'Send the garden design drawings.'}],undefined,'decision'],
  [{status:'open',relation:'correction'},[prior],'Change the library books: make it a decision, not a task.','decision'],
]) assert.equal(update(extra,previous,quote).kind,kind);

const db=new DatabaseSync(':memory:'),kv=new Map([['tenant','test'],['status','active']]);
db.exec('CREATE TABLE convs(id INTEGER PRIMARY KEY,start_time INTEGER,r2_key TEXT)');
const sql={exec(q,...args){if(!args.length&&q.split(';').filter(x=>x.trim()).length>1){db.exec(q);return{toArray:()=>[]};}const s=db.prepare(q),rows=/^\s*(SELECT|WITH|PRAGMA)/i.test(q)?s.all(...args):(s.run(...args),[]);return{toArray:()=>rows};}};
const host={sql,gen:0,ctx:{storage:{transactionSync:fn=>fn()}},get:k=>kv.get(k),put:(k,v)=>kv.set(k,String(v)),tid:()=> 'test',arm:async()=>{},bump(){},ledger:()=>({settle:async()=>{}}),env:{OPENROUTER_API_KEY:'unit-no-network',WS:{get:async()=>null},DB:{prepare(){return{bind(){return this;},first:async()=>({status:'active',plan:'plus'})};}},RESIDENT:{idFromName:x=>x,get:()=>({ambientPrivacy:async ts=>({mode:'on',allowed:ts.map((_,i)=>i)})})}}};
const store=new AmbientStore(host);store.review=retainReview;let current;
store.extract=async(lines,previous)=>({items:[{...current,line:0,quote:lines[0].text,speech_act:'intention',supersedes:previous.map(p=>p.id)}]});
const T=Date.UTC(2026,9,11);
for(const[id,text,status,relation]of [
  [1,'I need to return the library books.','open',null],
  [2,'I returned the library books just now. That is done.','completed','completion'],
  [3,'I still need to return the library books again.','open','reopen'],
  [4,'Cancel returning the library books; no longer needed.','cancelled','cancellation'],
]){
  current={kind:id===1?'task':'decision',status,relation};
  await store.ingest('fixture',String(id),{id,start_time:T+id*1000,end_time:T+id*1000+500,transcriptions:[{realtime:false,utterances:[{id:`u${id}`,text,spoken_at:T+id*1000,speaker:{id:'owner',is_user:true}}]}]});await store.run(true);
  const selected=store.query({kind:'task',status});assert.equal(selected.items.length,1,`task/${status} includes current decision update`);assert.equal(selected.items[0].status,status);assert.equal(selected.items[0].kind,'task');assert.equal(selected.items[0].notification_status,undefined);
  for(const other of ['open','completed','cancelled'].filter(s=>s!==status))assert.equal(store.query({kind:'task',status:other}).items.length,0,`obsolete ${other} task hidden`);
  assert.equal(store.query({kind:'decision'}).items.length,0,'validated task update not stranded in decision filter');
}
// Preserve the exact full source of the deployed 2026-10-12 failure. These are
// deterministic consumer regressions, not proof of the model's classification.
const conversation=speechActConversation(),lines=ambientLines(conversation);
const openLine=lines.findIndex(l=>l.utterance_id==='completion-open');
const doneLine=lines.findIndex(l=>l.utterance_id==='completion-real');
assert.equal(lines.length,31);assert.equal(openLine,27);assert.equal(doneLine,29);
// The recorded Luna response put completion on the old quote with a self-link.
// It must remain safely unresolved even after the extraction prompt changes.
const collapsed={kind:'task',speech_act:'intention',line:openLine,quote:lines[openLine].text,status:'completed',due_text:'today',relation:'completion',supersedes:[`line:${openLine}`]};
const [unresolved]=validateAmbient({items:[collapsed]},lines);
assert.equal(unresolved.status,'open');assert.deepEqual(unresolved.supersedes,[]);
assert.equal(unresolved.relationship_unresolved,true);
assert.equal(unresolved.evidence[0].utterance_id,'completion-open');
// Separate exact evidence allows the same-batch relationship to survive the
// actual store, local-line-to-stable-id mapping, review and current-item query.
store.extract=async()=>({items:[
  {...collapsed,status:'open',relation:null,supersedes:[]},
  {kind:'task',speech_act:'intention',line:doneLine,quote:lines[doneLine].text,status:'completed',due_text:'',relation:'completion',supersedes:[`line:${openLine}`]},
]});
await store.ingest('fixture',String(conversation.id),conversation);await store.run(true);
const completed=store.query({source_id:String(conversation.id),kind:'task',status:'completed'});
assert.equal(completed.items.length,1);
assert.equal(completed.items[0].text,lines[doneLine].text);
assert.equal(completed.items[0].evidence[0].utterance_id,'completion-real');
assert.equal(completed.items[0].semantic_review.verdict,'retain');
assert.equal(completed.items[0].supersedes.length,1);
assert.match(completed.items[0].supersedes[0],/^ambient:/);
assert.equal(store.query({source_id:String(conversation.id),kind:'task',status:'open'}).items.length,0);
db.close();console.log('PASS validated task category continuity through real filtered queries, full-source same-batch completion, frozen self-linked failure remains unresolved, and uncertainty/owner/category guards');

