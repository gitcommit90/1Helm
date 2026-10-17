// The actual Resident and ledger with a deliberately blocked optional labeller.
// Controlled model fixtures test app timing and persistence, never model quality.
import {world,tick,assert} from './deploy-harness.mjs';
const labelJSON=JSON.stringify({title:'Completed fixture task',result:'Fixture complete',summary:'Fixture result',why:{},chat_title:'Completed fixture chat'});
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
let checks=0;
function fixture(engine){
 const W=world({engine,openrouter:true,env:{RESUME_DELAY_MS:0,RESUME_WRITE_DELAY_MS:0}}),original=W.env.AI.run,gate=defer();
 W.labelCalls=0;
 W.env.AI.run=async(model,body)=>{
  if(String(body.messages[0]?.content).startsWith('You label one finished task')){
   W.labelCalls++;return {response:await gate.promise,usage:{prompt_tokens:500,completion_tokens:50}};
  }
  return original(model,body);
 };
 W.brain=()=> 'Completed fixture answer.';
 const session=W.R.resolveSession('new','Please check the fixture plan').id,events=[];
 const run=W.R.runTurn('t1','main','1','Please check the fixture plan',e=>events.push({...e,observedAt:performance.now()}),{session});
 return {W,R:W.R,gate,session,events,run};
}
async function doneWhileHeld(F){
 const {W,R,events}=F;
 try{await W.until(()=>W.labelCalls===1,1000);await W.until(()=>events.some(e=>e.t==='done'),1000);}catch(e){F.gate.resolve(labelJSON);await F.run;throw e;}
 assert.equal(W.labelCalls,1,'the labeller was started and is still held');
 const r=await F.run,done=events.find(e=>e.t==='done');
 assert.equal(r.error,null);assert.equal(W.card(r.turn).status,'complete');
 assert.equal(W.turns().find(t=>t.id===r.turn).reply,r.reply,'answer is persisted before done');
 assert.equal(W.turns().find(t=>t.id===r.turn).charge_nano,r.charge,'initial charge excludes pending enrichment');
 assert.equal(R.active.size,0,'active turn released');assert.equal(R.sessQ.size,0,'task queue released');
 assert.equal(R.sql.exec('SELECT 1 FROM turn_runs WHERE card=?',r.turn).toArray().length,0,'completion journal retired');
 assert.equal(events.filter(e=>e.t==='done').length,1);
 assert.ok(done.observedAt-events.filter(e=>e.t==='text').at(-1).observedAt<1000,'done follows the confirmed model end without labeller delay');
 return r;
}
for(const engine of ['classic','pi']){
 {
  const F=fixture(engine),{W,R,gate,session,events}=F,r=await doneWhileHeld(F);
  const next=await R.runTurn('t1','main','1','A new message after completion',null,{session});
  assert.notEqual(next.turn,r.turn);assert.equal(next.error,null,'new turn can finish while old labels are held');
  assert.equal(W.labelCalls,1,'first title was claimed only once');
  const before=W.turns().find(t=>t.id===next.turn).charge_nano;
  gate.resolve(labelJSON);await W.settle();
  const labelSettles=W.ledger.log.filter(([op,id])=>op==='settle'&&id.startsWith('sum:'));
  assert.equal(labelSettles.length,1);const billed=labelSettles[0][2];assert.ok(billed>0);
  const saved=W.turns().find(t=>t.id===r.turn);
  assert.equal(saved.charge_nano,r.charge+billed,'late charge is stored exactly once on the completed turn');
  assert.equal(W.turns().find(t=>t.id===next.turn).charge_nano,before,'late charge cannot attach to the next turn');
  assert.equal(W.card(r.turn).title,'Completed fixture task');assert.ok(W.card(r.turn).charge_nano>=billed);
  assert.equal(R.session(session).title,'Completed fixture chat');
  assert.equal(r.charge,saved.charge_nano-billed,'returned stats remain stable after late labels');
  assert.equal(events.filter(e=>e.t==='done').length,1,'late enrichment emits no second done');
  await W.settle();assert.equal(W.turns().find(t=>t.id===r.turn).charge_nano,saved.charge_nano);
  assert.equal(W.ledger.open.size,0);
  console.log(`PASS ${engine}: done, persistence and next turn precede held labels; labels and cost arrive once`);checks++;
 }
 {
  const F=fixture(engine),r=await doneWhileHeld(F);
  await F.R.updateSession(F.session,{title:'My chosen task name'});
  F.gate.resolve(labelJSON);await F.W.settle();
  assert.equal(F.R.session(F.session).title,'My chosen task name');assert.equal(F.W.card(r.turn).status,'complete');
  console.log(`PASS ${engine}: delayed labels respect manual rename`);checks++;
 }
 {
  const F=fixture(engine),r=await doneWhileHeld(F);
  F.gate.reject(new Error('fixture label provider unavailable'));await F.W.settle();
  assert.equal(F.W.turns().find(t=>t.id===r.turn).error,null);assert.equal(F.W.card(r.turn).status,'complete');
  assert.equal(F.events.filter(e=>e.t==='done').length,1);assert.equal(F.W.ledger.open.size,0);
  assert.equal(F.W.ledger.log.filter(([op,id])=>op==='settle'&&id.startsWith('sum:')).length,1);
  console.log(`PASS ${engine}: rejected labels cannot fail an already completed turn`);checks++;
 }
 {
  const F=fixture(engine);await doneWhileHeld(F);await F.R.reset(F.session);await F.R.removeSession(F.session);
  const cardsBefore=F.W.cards();F.gate.resolve(labelJSON);await F.W.settle();
  assert.equal(F.R.session(F.session),null);assert.equal(F.W.turns().length,0);assert.deepEqual(F.W.cards(),cardsBefore);
  console.log(`PASS ${engine}: delayed labels cannot recreate a deleted task or turn`);checks++;
 }
 {
  const F=fixture(engine),r=await doneWhileHeld(F),old=F.R;F.W.kill();F.W.boot();
  F.gate.resolve(labelJSON);await F.W.settle(old);await tick();
  assert.equal(F.W.turns().length,1);assert.equal(F.W.turns()[0].id,r.turn);assert.equal(F.W.cards().length,1);
  assert.equal(F.W.card(r.turn).status,'complete');assert.equal(F.events.filter(e=>e.t==='done').length,1);
  assert.equal(F.W.ledger.open.size,0);
  console.log(`PASS ${engine}: reset during late labels keeps the completed turn and emits no failure`);checks++;
 }
}
console.log(`PASS completion delay: ${checks} cases`);
