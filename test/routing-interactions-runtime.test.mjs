// Scripted model output drives real Resident tools; assertions concern app state only.
import {world,tick,assert,never} from './deploy-harness.mjs';
import {seedSettings,ID} from './helpers/seed-settings.mjs';
const settings=seedSettings(),ids=[ID.DEEPSEEK,ID.HAIKU,ID.SOL],choices=ids.map(model=>({model,effort:settings.catalog[model].efforts[0]}));
const chains=()=>Object.fromEntries(['unrestricted','no_training','zdr'].map(level=>[level,structuredClone(choices)]));
settings.version=3;settings.routing={categories:[{id:'general',title:'General',chains:chains()},{id:'finance',title:'Finance',chains:chains()}]};
const W=world({env:{ONEHELM_EE:'1hc',DYNAMIC_ROUTING:'on',APPEND_TASK_RUNTIME:'on',ROUTER_MODE:'two',MODEL_SETTINGS:settings,MODEL_SETTINGS_REVISION:1,OPENROUTER_API_KEY:'synthetic',GENUI:'on',RESUME_DELAY_MS:0,RESUME_WRITE_DELAY_MS:0,CODE_V:'input-v1',TASK_MODEL_CATALOG:Object.fromEntries(ids.map(id=>[id,{id,eligible:true,hosts:id.startsWith('anthropic')?['anthropic']:id.startsWith('deepseek')?['deepseek']:['azure'],efforts:settings.catalog[id].efforts,levels:['unrestricted','no_training','zdr'],context_length:200000,max_output:64000,input_modalities:['text'],tool_choice:['auto','none'],json:true,pricing:{prompt:.1,completion:.2}}]))}});
let holdAnswer=false,answerAttempted=false,decoderCategory='Finance',deciderCalls=0,callId=0,firstWorkerProfile=null,workerProfiles=[],sawBoundAnswer=false;
const oldFetch=globalThis.fetch;
globalThis.fetch=async (_url,init={})=>{const body=JSON.parse(init.body||'{}');if(body.questions){deciderCalls++;assert.deepEqual(Object.keys(body.questions),['is_task','category','unmet','steer']);}return Response.json({answers:{is_task:{noul:1},category:{choice:decoderCategory},unmet:{noul:0},steer:{choice:'none'}},usage:{cost:0}});};
const questionBody='root = Stack([Say("How many people should split the bill?"), Form("people", [Stepper("people", "People", 6, 1, 20)], "Use this number")])';
const finalBody='root = Stack([Big("$69.64", "Each person"), Rows([["Total with tip", "$417.86"]]), Buttons([Button("Change people", "change", "primary")])])';
function result(content='',calls=[]){return{content,calls:calls.map(([name,args])=>({id:`fixture_${++callId}`,type:'function',function:{name,arguments:JSON.stringify({step_title:'Recorded task step',...args})}})),inTok:50,outTok:10,cached:0,charge:0,model:ids[0],finish:calls.length?'tool_calls':'stop'};}
function attach(R){
  R.computer=()=>({...W.computer,readFile:async()=>({ok:true,bytes:new TextEncoder().encode('[]')})});
  R.callModel=async(messages,_warm,_text,_max,_off,tc)=>{
    const tools=R.modelTools(tc).map(t=>t.function.name);
    if(tc.kind==='helper'){
      workerProfiles.push(JSON.stringify(tc.taskProfile));
      assert(tools.includes('request_input'));assert(!tools.includes('interview'));assert(!tools.includes('ask_user'));
      if(tc.helper.round===1){firstWorkerProfile=tc.helper.profile_json;return result('',[['request_input',{question:'How many people are splitting the bill?'}]]);}
      R.helperAttachMessages(tc,messages);R.helperMessagesSeen(tc);
      assert(JSON.stringify(messages).includes('Six people'),'same worker receives clarified instructions and earlier history');
      return result('',[['done',{response:'Reviewed totals. '+finalBody}]]);
    }
    if(tc.userText==='Ask for typed answer')return result('',[['ask_user',{question:'A typed confirmation?'}]]);
    if(tc.inputReply?.question&&!tc.inputReply.question.helper_id)return result('Typed answer reached Primary.');
    if(tc.inputReply?.source_turn&&!tc.inputReply.question){assert(!tc.orchestration?.steer);return result('New Primary work from an approved result card.');}
    if(tc.orchestration?.approved)return result(finalBody);
    if(tc.orchestration?.review){
      assert(tools.includes('ask_user'));assert(tools.includes('interview'));
      if(tc.inputReply?.question){sawBoundAnswer=true;if(holdAnswer){answerAttempted=true;await never();}assert.equal(tc.orchestration.review,tc.inputReply.question.helper_id);return result('',[['message_subagent',{id:tc.orchestration.review,message:'Six people are splitting the bill. Finish the result.'}]]);}
      const h=R.sql.exec('SELECT status FROM helpers WHERE id=?',tc.orchestration.review).one();
      if(h.status==='waiting_input')return result('',[['ask_user',{question:'How many people should split the bill?',presentation:questionBody}]]);
      return result('',[['approve_subagent',{id:tc.orchestration.review,files:[]}]]);
    }
    if(tc.orchestration?.started)return result('The worker is on it.');   // General keeps working after a start (042f593): one worker per request, no second start
    return result('',[['start_helper',{name:'Bill calculation',task:'Calculate the bill and ask Primary if clarification is needed.'}]]);
  };
}
try{
  let R=W.R;attach(R);const session=R.newSession('Bill example');
  await R.chat('t1','main','1','Calculate the bill.',{session});await W.settle(R);
  const h=W.dodb.prepare('SELECT * FROM helpers WHERE session=?').get(session),q=W.dodb.prepare('SELECT * FROM user_questions WHERE session=?').get(session);
  assert.equal(h.status,'waiting_input');assert(q);assert.equal(q.status,'pending');assert.equal(q.helper_id,h.id);assert.equal(q.round,1);
  assert.equal(W.card(q.source_turn).kind,'handoff');assert.equal(R.inputSource('t1','main','bad',q.source_turn).session,session);
  assert.equal(R.sessionView(R.session(session)).state,'waiting');assert.equal(R.sessionView(R.session(session)).pending_inputs.length,1);
  assert.equal(W.turns().find(t=>t.id===q.source_turn).reply,questionBody);
  assert.equal(W.dodb.prepare('SELECT COUNT(*) n FROM routing_artifacts').get().n,0,'request_input never collects/publishes produced files');
  const before=callId;await R.helpersRecover();assert.equal(callId,before,'paused worker consumes no model calls');
  const history=h.history_json;W.kill();W.env.CODE_V='input-v2';R=W.boot();attach(R);await tick();await W.settle(R);
  assert.equal(W.dodb.prepare('SELECT status FROM helpers WHERE id=?').get(h.id).status,'waiting_input');assert.equal(callId,before,'restart leaves waiting worker paused');
  settings.routing.categories[1].chains.zdr.reverse();decoderCategory='General';
  holdAnswer=true;
  R.chat('t1','main','1','Six people',{session,input_reply:{question_id:q.id,source_turn:q.source_turn,response_id:'answer-six'}}).catch(()=>{});
  await W.until(()=>answerAttempted);
  const receiptBefore=W.dodb.prepare('SELECT * FROM user_input_receipts WHERE response_id=?').get('answer-six');
  assert(receiptBefore.turn);const journal=W.dodb.prepare('SELECT * FROM turn_runs WHERE card=?').get(receiptBefore.turn);assert(journal);assert.equal(JSON.parse(journal.opts)._input.question.id,q.id);
  W.kill();W.env.CODE_V='input-v3';holdAnswer=false;R=W.boot();attach(R);await R.alarm();await W.settle(R);
  const answer=W.dodb.prepare('SELECT * FROM turns WHERE id=?').get(receiptBefore.turn);
  assert.equal(answer.error,null);assert.equal(answer.resumes,1);assert.equal(W.dodb.prepare('SELECT COUNT(*) n FROM turns WHERE id=?').get(receiptBefore.turn).n,1,'accepted answer resumes in the same journaled Primary turn');assert(sawBoundAnswer);assert.equal(deciderCalls,2,'every person request, including answer, runs four decider questions');
  const finished=W.dodb.prepare('SELECT * FROM helpers WHERE id=?').get(h.id);
  assert.equal(finished.id,h.id);assert.equal(finished.round,2);assert.equal(finished.status,'approved');assert.equal(finished.profile_json,firstWorkerProfile,'settings edits never replace open worker chain');
  assert(JSON.parse(history).some(m=>m.role==='tool'&&String(m.content).includes('recorded for Primary')),'worker request remains in worker history');
  assert.equal(W.dodb.prepare('SELECT answer_text FROM user_questions WHERE id=?').get(q.id).answer_text,'Six people');
  assert.equal(W.dodb.prepare('SELECT COUNT(*) n FROM user_input_receipts WHERE response_id=?').get('answer-six').n,1);
  const beforeDuplicate=callId;const dup=await R.chat('t1','main','1','Six people',{session,input_reply:{question_id:q.id,source_turn:q.source_turn,response_id:'answer-six'}});assert(dup.duplicate);assert.equal(callId,beforeDuplicate);
  assert(W.turns().some(t=>t.reply===finalBody),'Primary renders final interactive GenUI after approval');
  const detail=await R.sessionDetail(session),storedAnswer=detail.turns.find(t=>t.id===receiptBefore.turn);
  assert.equal(storedAnswer.msgs[0].input_reply.question_id,q.id);assert.equal(storedAnswer.msgs[0].input_reply.source_turn,q.source_turn);
  const finalTurn=W.turns().find(t=>t.reply===finalBody),workerCount=W.dodb.prepare('SELECT COUNT(*) n FROM helpers').get().n;
  await R.chat('t1','main','1','Change people',{session,input_reply:{source_turn:finalTurn.id,response_id:'after-approval',action:'change'}});await W.settle(R);
  assert.equal(W.dodb.prepare('SELECT COUNT(*) n FROM helpers').get().n,workerCount);assert.equal(W.dodb.prepare('SELECT status FROM helpers WHERE id=?').get(h.id).status,'approved','later result card action returns to Primary and never resumes closed worker');
  await R.chat('t1','main','1','Ask for typed answer',{session});await W.settle(R);
  const typedQuestion=W.dodb.prepare("SELECT * FROM user_questions WHERE session=? AND status='pending'").get(session);assert(typedQuestion);
  const typedAnswer=await R.chat('t1','main','1','Yes',{session});await W.settle(R);assert.equal(typedAnswer.error,null);assert.equal(W.dodb.prepare('SELECT answer_text FROM user_questions WHERE id=?').get(typedQuestion.id).answer_text,'Yes');
  console.log('routing question lifecycle, restart pause, four decider questions, same worker/model/history, approval and GenUI continuity passed');
}finally{globalThis.fetch=oldFetch;}

process.exit(0); // The deliberately killed model call retains its old timer in this process.
