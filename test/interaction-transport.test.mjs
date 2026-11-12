// Only app-controlled transport behavior is asserted. No model or Photon connection is used.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {interviewInit,interviewOp,ivView,ivRow,interviewChatApi,ivCardRoute} from '../src/interview-chat.js';
const db=new DatabaseSync(':memory:');
const sql={exec(q,...args){const st=db.prepare(q);const rows=/^\s*(SELECT|PRAGMA)/i.test(q)?st.all(...args):(st.run(...args),[]);return {toArray:()=>rows};}};
interviewInit(sql);
const calls=[],receipts=new Map();let unavailable=false;
const R={sql,get:k=>({tenant:'tenant',channel:'main',channel_id:'1'})[k],env:{DB:{prepare:()=>({bind(){return this;},first:async()=>({status:'connected'})})}},
  inputSource:async(...args)=>{calls.push({source:args});return{ok:true,session:'original-task',input_request:{question_id:'saved-question'}};},
  inputReply:async(...args)=>{if(unavailable)throw Error('temporarily unavailable');const id=args[5].response_id;if(receipts.has(id))return{ok:true,duplicate:true};receipts.set(id,args);calls.push({reply:args});return{ok:true};},
  interviewView:async id=>ivView(ivRow(sql,id),sql),interviewOp:async(...args)=>interviewOp(R,...args),bind:async()=>{},};
const seed=(id,via='app')=>sql.exec("INSERT INTO chat_interviews(id,session,turn,at,title,purpose,questions,answers,step,status,via,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",id,'original-task','original-turn',1,'Saved form','Finish the task',JSON.stringify([{id:'choice',kind:'yesno',text:'Continue?',options:['Yes','No']}]),JSON.stringify({choice:{pick:'Yes'}}),1,'open',via,1);
seed('app-form');
const env={RESIDENT:{idFromName:n=>n,get:n=>{assert.equal(n,'res:tenant:main');return R;}}};
const json=(body,status=200)=>Response.json(body,{status});
const api=(body,access={mode:'full'})=>interviewChatApi(new Request('https://selfhost.example/test',{method:'POST',body:JSON.stringify(body)}),env,{id:'tenant'},['','main','app-form'],{json,access,archive:()=>({channels:async()=>[{slug:'main',id:'1'}]})});
assert.equal((await api({op:'send'},{mode:'read_only'})).status,402);
unavailable=true;
let response=await api({op:'send'});assert.equal(response.status,503);
let body=await response.json();assert.equal(body.interview.posted,false);assert.equal(body.interview.status,'sent');
assert.equal(ivView(ivRow(sql,'app-form')).posted,false,'reload retains an explicit unsent receipt');
unavailable=false;
response=await api({op:'send',input_reply:{source_turn:'forged',question_id:'forged'}});assert.equal(response.status,200);body=await response.json();assert.equal(body.posted,true);assert.equal(body.interview.posted,true);
const sent=calls.find(c=>c.reply).reply;
assert.deepEqual(sent.slice(0,4),['tenant','main','1','original-task']);
assert.deepEqual(sent[5],{source_turn:'original-turn',response_id:'interview:app-form',question_id:'saved-question'});
assert.deepEqual(sent[6],{viaText:false,origin:{surface:'interview'}});
response=await api({op:'send'});body=await response.json();assert.equal(body.duplicate,true);assert.equal(calls.filter(c=>c.reply).length,1);
assert.equal((await api({op:'answer',q:'choice',answer:{pick:'No'}})).status,409,'submitted answers cannot change');
seed('phone-form','text');
const card={body:JSON.stringify({interview:'phone-form'}),tenant_id:'tenant',channel:'main',sent_at:1};
response=await ivCardRoute(env,'/iv',card,{name:'Helper'},async()=>false,{op:'send'});
assert.equal(response.status,200);body=await response.json();assert.equal(body.posted,true);
assert.equal(calls.filter(c=>c.reply).at(-1).reply[6].viaText,true);
assert.equal(receipts.size,2,'app and phone each deliver one answer to Primary');
sql.exec('CREATE TABLE user_questions(source_turn TEXT,session TEXT,status TEXT,answer_text TEXT)');
seed('closed-form');sql.exec("INSERT INTO user_questions VALUES('original-turn','original-task','answered','My typed answer')");
let closed=ivView(ivRow(sql,'closed-form'),sql);assert.equal(closed.status,'closed');assert.equal(closed.closed_reason,'answered_elsewhere');assert.equal(closed.closed_note,'Answered in chat');
let rejected=await interviewOp(R,'closed-form',{op:'send'},{post:'app'});assert.equal(rejected.error,'question_closed');assert.equal(rejected.interview.status,'closed');
for(const status of ['cancelled','superseded']){
 sql.exec('UPDATE user_questions SET status=?',status);closed=ivView(ivRow(sql,'closed-form'),sql);assert.equal(closed.status,'closed');assert.equal(closed.closed_reason,status);assert.equal(closed.closed_note,'No longer needed');
}
assert.equal(ivView(ivRow(sql,'app-form'),sql).status,'sent','a delivered interview retains its receipt');
console.log('interaction transport ok');
