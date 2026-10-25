// Scripted model output drives real Resident tools; assertions concern app state only.
import {world,tick,assert,never} from './deploy-harness.mjs';
import {seedSettings,ID} from './helpers/seed-settings.mjs';
const settings=seedSettings(),ids=[ID.DEEPSEEK,ID.HAIKU,ID.SOL],choices=ids.map(model=>({model,effort:settings.catalog[model].efforts[0]}));
const chains=()=>Object.fromEntries(['unrestricted','no_training','zdr'].map(level=>[level,structuredClone(choices)]));
settings.version=3;settings.routing={categories:[{id:'general',title:'General',chains:chains()},{id:'finance',title:'Finance',chains:chains()}]};
const W=world({env:{DYNAMIC_ROUTING:'on',APPEND_TASK_RUNTIME:'on',ROUTER_MODE:'two',MODEL_SETTINGS:settings,MODEL_SETTINGS_REVISION:1,OPENROUTER_API_KEY:'synthetic',GENUI:'on',RESUME_DELAY_MS:0,RESUME_WRITE_DELAY_MS:0,CODE_V:'input-v1',TASK_MODEL_CATALOG:Object.fromEntries(ids.map(id=>[id,{id,eligible:true,hosts:id.startsWith('anthropic')?['anthropic']:id.startsWith('deepseek')?['deepseek']:['azure'],efforts:settings.catalog[id].efforts,levels:['unrestricted','no_training','zdr'],context_length:200000,max_output:64000,input_modalities:['text'],tool_choice:['auto','none'],json:true,pricing:{prompt:.1,completion:.2}}]))}});
// A turn the person did not start (a worker's returned result) never posts a fixed acknowledgement ("Got it.", the job-started lines).
// Scripted models drive the real Resident; assertions concern app state only, never wording the model chose.
import {Resident} from '../src/resident.js';
import {PERSON_FACING_ACKS,ACK_UPDATE_SENT,ACK_JOB_NOT_STARTED,ackFor} from '../src/plain-ack.js';
let steerTo='none',callId=0,workerRounds=0,hold=false,presented='Here is the finished result for you.';
const oldFetch=globalThis.fetch;
globalThis.fetch=async()=>Response.json({answers:{is_task:{noul:1},category:{choice:'General'},unmet:{noul:0},steer:{choice:steerTo}},usage:{cost:0}});
const result=(content='',calls=[])=>({content,calls:calls.map(([name,args])=>({id:`q_${++callId}`,type:'function',function:{name,arguments:JSON.stringify({step_title:'Recorded task step',...args})}})),inTok:50,outTok:10,cached:0,charge:0,model:ids[0],finish:calls.length?'tool_calls':'stop'});
const questionBody='root = Stack([Say("How many slides do you want?"), Form("n", [Stepper("n", "Slides", 6, 1, 20)], "Use this number")])';
function attach(R){
  R.computer=()=>({...W.computer,readFile:async()=>({ok:true,bytes:new TextEncoder().encode('[]')})});
  R.callModel=async(messages,_w,_t,_o,tc)=>{
    if(tc.kind==='helper'){
      const task=tc.helper.task;
      if(/Ask me/.test(task)){if(tc.helper.round===1)return result('',[['request_input',{question:'How many slides?'}]]);R.helperAttachMessages(tc,messages);R.helperMessagesSeen(tc);return result('',[['done',{response:'Six slides.'}]]);}
      if(/Hold/.test(task)){await never();}
      workerRounds++;if(tc.helper.round>1){R.helperAttachMessages(tc,messages);R.helperMessagesSeen(tc);}
      return result('',[['done',{response:'Draft round '+tc.helper.round}]]);
    }
    const f=tc.orchestration||{};
    if(f.approved)return result(presented);
    if(f.review){
      const h=R.sql.exec('SELECT status,round,task FROM helpers WHERE id=?',f.review).one();
      if(h.status==='waiting_input')return result('',[['ask_user',{question:'How many slides do you want?',presentation:questionBody}]]);
      if(tc.handoff&&h.round===1)return result('',[['message_subagent',{id:f.review,message:'Fix the title slide and finish.'}]]);
      if(tc.handoff&&h.round>1)return result('',[['approve_subagent',{id:f.review,files:[]}]]);
      return result('',[['message_subagent',{id:f.review,message:'Also add a chart.'}]]);   // the person's own update
    }
    if(f.steer)return result('',[['message_subagent',{id:f.steer,message:'Also add a chart.'}]]);
    if(f.started)return result('The worker is on it.');
    return result('',[['start_helper',{name:'Slides',task:/Ask me/.test(tc.userText)?'Ask me about slides.':/Hold/.test(tc.userText)?'Hold: make slides.':'Make slides.'}]]);
  };
}
const quietTurns=()=>W.dodb.prepare("SELECT t.id,t.reply,t.error FROM turns t JOIN cards c ON c.id=t.id WHERE c.kind='handoff' AND t.kind='chat' ORDER BY t.at").all();
try{
  const R=W.R;attach(R);
  // 1: the worker returns, the main helper sends a correction (no reply), the worker returns again, the main helper presents the result (reply)
  const s1=R.newSession('Slides');
  const first=await R.chat('t1','main','1','Make slides in PowerPoint.',{session:s1});await W.settle(R);
  const reviews=quietTurns();assert.equal(reviews.length,2,'one review turn per returned result');
  assert.equal(reviews[0].reply,'','the review that only sent a correction made no reply');assert.equal(reviews[0].error,null);
  assert.equal(reviews[1].reply,presented,'the review that presents the result shows it');
  assert(!W.turns().some(t=>t.reply===ACK_UPDATE_SENT),'no "Got it." anywhere in the task');
  const d1=await R.sessionDetail(s1);
  assert(!d1.turns.some(t=>t.id===reviews[0].id),'history leaves out a review turn with no reply');
  assert(d1.turns.some(t=>t.id===reviews[1].id&&t.reply===presented),'history keeps the presented result');
  assert.equal(workerRounds,2);
  // the done event of the quiet turn says so, so the app draws nothing (and nothing is texted)
  assert.equal((await Resident.prototype.deliverTextReply.call(R,'t1','main',{quiet:true,reply:'',turn:reviews[0].id})).via,'quiet');
  // 3: a worker's question is shown to the person
  const s3=R.newSession('Ask');
  await R.chat('t1','main','1','Ask me about slides in PowerPoint.',{session:s3});await W.settle(R);
  const q=W.dodb.prepare("SELECT * FROM user_questions WHERE session=? AND status='pending'").get(s3);assert(q,'the question is pending');
  assert.equal(W.turns().find(t=>t.id===q.source_turn).reply,questionBody,'the pause turn shows the question');
  const d3=await R.sessionDetail(s3);assert(d3.turns.some(t=>t.id===q.source_turn&&t.reply===questionBody),'history keeps the question');
  // 2: the person's own update still gets "Got it."
  const s2=R.newSession('Hold');
  await R.chat('t1','main','1','Hold on slides in PowerPoint.',{session:s2});await W.until(()=>W.dodb.prepare("SELECT 1 FROM helpers WHERE session=? AND status='running'").get(s2));
  const h2=W.dodb.prepare('SELECT id FROM helpers WHERE session=?').get(s2);steerTo=String(h2.id);
  const upd=await R.chat('t1','main','1','Also add a chart.',{session:s2});
  assert.equal(upd.reply,ACK_UPDATE_SENT,'the person sent an update and it was passed on');assert(!upd.quiet);
  steerTo='none';
  // the rule itself
  for(const line of PERSON_FACING_ACKS)assert.equal(ackFor(false,line),line,'the person started it: every line stays');
  for(const line of [...PERSON_FACING_ACKS])assert(ackFor(true,line)===''||/correction/.test(ackFor(true,line))||line===ACK_JOB_NOT_STARTED,'internal turn: silent, or a failure in fitting words');
  assert.equal(ackFor(true,questionBody),questionBody);assert.equal(ackFor(true,presented),presented);
  console.log('quiet review ack: no fixed line on a turn the person did not start; their own update, a result and a question still show');
}finally{globalThis.fetch=oldFetch;}
process.exit(0);
