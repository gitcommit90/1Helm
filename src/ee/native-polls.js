import { messageOrigin, phoneOrigin } from "../message-origin.js";
// Native poll identities are transport state. The ordinary question/answer
// transcript and existing input receipts remain the source of task history.
import { createQuestion, questionForTurn } from "../user-input.js";
import { deliverPoll, deliverText } from "./texting.js";
import { scrubSecrets } from "../secrets-scrub.js";
import { recordPhotonReplySource } from "./photon-replies.js";

export const NATIVE_POLL_TOOL = {type:"function",function:{name:"send_poll",description:"Primary only. When the person explicitly asks for a poll in the current phone conversation, send a native iMessage poll with their choices. Ordinary questions, forms and surveys can still use GenUI/ask_user. Only the person's own connected iMessage phone is supported. An app-only conversation or unsupported phone gets an app question instead, without an unexpected phone send. This asks a question and waits; it leaves an associated worker open and unapproved.",parameters:{type:"object",properties:{question:{type:"string",minLength:1,maxLength:500},choices:{type:"array",minItems:2,maxItems:20,items:{type:"string",minLength:1,maxLength:120}},id:{type:"integer",description:"Optional open worker for this question; defaults to the current review."}},required:["question","choices"]}}};
export function nativePollInit(sql) {
  sql.exec("CREATE TABLE IF NOT EXISTS native_poll_sends (id TEXT PRIMARY KEY,session TEXT NOT NULL,source_turn TEXT NOT NULL UNIQUE,payload_json TEXT NOT NULL,state TEXT NOT NULL,due INTEGER NOT NULL,tries INTEGER NOT NULL DEFAULT 0,poll_guid TEXT,options_json TEXT,fallback_delivered INTEGER NOT NULL DEFAULT 0)");
  sql.exec("CREATE TABLE IF NOT EXISTS native_poll_events (id TEXT PRIMARY KEY,poll_id TEXT NOT NULL,session TEXT,event_json TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'queued',due INTEGER NOT NULL,created INTEGER NOT NULL,error TEXT)");
}
export async function nativePollTarget(env,tenant,guid) {
  return env.DB.prepare("SELECT * FROM native_text_polls WHERE tenant_id=? AND poll_guid=? AND state='sent'").bind(tenant,guid).first();
}
export async function dropNativePolls(R,session=null) {
  const tenant=R.get("tenant"),channel=R.get("channel");
  // Active sends stop at their next local fence. Let any already-issued D1
  // write settle before the final delete, so it cannot recreate the mapping.
  for(const tc of R.active?.values()||[])if(session==null||tc.session===session)tc.abort="hard";
  R.sql.exec(`UPDATE user_questions SET status='cancelled' WHERE status='pending' AND source_turn IN (SELECT source_turn FROM native_poll_sends${session==null?"":" WHERE session=?"})`,...(session==null?[]:[String(session)]));
  if(session==null)R.sql.exec("UPDATE native_poll_sends SET state='cancelled'");
  else R.sql.exec("UPDATE native_poll_sends SET state='cancelled' WHERE session=?",String(session));
  await Promise.allSettled([...(R._nativeSendRuns?.values()||[])].filter(x=>session==null||x.session===session).map(x=>x.promise));
  for(const table of ["native_poll_events","native_poll_sends"]) {
    if(session==null)R.sql.exec(`DELETE FROM ${table}`);
    else R.sql.exec(`DELETE FROM ${table} WHERE session=?`,String(session));
  }
  if(!tenant||!channel)return;
  if(!await R.env.DB.prepare("SELECT 1 x FROM sqlite_master WHERE name='native_text_polls'").first())return;
  const where=session==null?"":" AND session=?";
  await R.env.DB.prepare(`DELETE FROM native_text_polls WHERE tenant_id=? AND channel=?${where}`).bind(tenant,channel,...(session==null?[]:[String(session)])).run();
}
function pollCurrent(R,p,pending=false) {
  const row=R.sql.exec("SELECT state FROM native_poll_sends WHERE id=?",p.id).toArray()[0],q=questionForTurn(R.sql,p.source_turn),session=R.session(p.session);
  const card=R.sql.exec("SELECT status FROM cards WHERE id=? AND session=?",p.source_turn,p.session).toArray()[0];
  const active=[...(R.active?.values()||[])].find(t=>t.turn===p.source_turn);
  return !!(row&&row.state!=="cancelled"&&session&&!session.done&&q?.question_id===p.question_id&&!['cancelled','superseded'].includes(q.status)&&(!pending||q.status==='pending')&&card&&!['stopped','failed','interrupted'].includes(card.status)&&active?.abort!=="hard");
}
function nativeSendRun(R,row,fn) {
  R._nativeSendRuns ||= new Map();
  const existing=R._nativeSendRuns.get(row.id);if(existing)return existing.promise;
  const promise=Promise.resolve().then(fn).finally(()=>R._nativeSendRuns.delete(row.id));
  R._nativeSendRuns.set(row.id,{session:row.session,promise});return promise;
}
export async function sendNativePoll(R,a,tc) {
  if(tc.kind!=="chat"||tc.helper)return "error: only Primary can send a poll.";
  const question=scrubSecrets(String(a.question||"")).trim(),choices=Array.isArray(a.choices)?a.choices.map(x=>scrubSecrets(String(x)).trim()):[];
  if(!question||question.length>500||choices.length<2||choices.length>20||choices.some(x=>!x||x.length>120))return "error: give a question up to 500 characters and 2 to 20 choices up to 120 characters each.";
  const target=Number(a.id||tc.orchestration?.review||tc.orchestration?.steer||tc.orchestration?.started)||null;
  if(target&&R.sql.exec("SELECT status FROM helpers WHERE id=? AND session=?",target,tc.session).toArray()[0]?.status==="running")return "error: wait for this worker to return done or request_input before asking about its work.";
  const presentation=`root = Stack([Say(${JSON.stringify(question)}), Buttons([${choices.map(x=>`Button(${JSON.stringify(x)}, ${JSON.stringify(x)})`).join(", ")}])])`;
  const q=createQuestion(R.sql,tc,{question,presentation,id:a.id});
  if(q.error)return `error: ${q.error}`;
  tc.inputRequest=q;tc.orchestration ||= {};tc.orchestration.waitingInput=true;
  const phoneBound=!!(tc.viaText||tc.textSteered||tc.inputReply?.question?.via==="text");
  let outcome="The app question is shown. Wait for the person's answer.";
  if(phoneBound) {
    let row=R.sql.exec("SELECT * FROM native_poll_sends WHERE source_turn=?",tc.turn).toArray()[0];
    const body=JSON.stringify({question,choices});
    if(row&&JSON.parse(row.payload_json).body_json!==body)return "error: this turn already has a different saved poll. Its question and choices cannot be changed while sending.";
    if(!row) {
      const payload={id:crypto.randomUUID(),tenant_id:R.get("tenant"),channel:R.get("channel"),channel_id:String(R.get("channel_id")||"1"),session:tc.session,source_turn:tc.turn,question_id:q.question_id,call_id:String(tc.callId),client_message_id:crypto.randomUUID(),fallback_message_id:crypto.randomUUID(),body_json:body,created:Date.now()};
      R.sql.exec("INSERT INTO native_poll_sends(id,session,source_turn,payload_json,state,due) VALUES(?,?,?,?,'pending',?)",payload.id,tc.session,tc.turn,JSON.stringify(payload),Date.now());
      row=R.sql.exec("SELECT * FROM native_poll_sends WHERE id=?",payload.id).toArray()[0];
    }
    await R.arm();
    const state=await nativeSendRun(R,row,()=>attemptNativeSend(R,row));
    if(state==="cancelled"||tc.abort==="hard")return "The poll was cancelled.";
    outcome=state==="sent"?"The native iMessage poll is sent. Wait for the person's vote.":state==="pending"?"Native poll delivery is still being confirmed. The saved send will retry with the same identity. Wait for the person's answer.":"Native poll delivery could not be confirmed. The app question is available instead. Wait for the person's answer.";
  }
  tc.inputRequest=questionForTurn(R.sql,tc.turn);
  R.journalDelegation(tc,"send_poll",outcome);
  tc.emit?.({t:"user_input",input:tc.inputRequest});
  return outcome;
}
async function attemptNativeSend(R,row) {
  if(row.state!=="pending")return row.state;
  const p=JSON.parse(row.payload_json),body=JSON.parse(p.body_json),q=questionForTurn(R.sql,p.source_turn),session=R.session(p.session);
  if(!pollCurrent(R,p,true))return cancelNativeSend(R,p);
  const tries=row.tries+1;
  R.sql.exec("UPDATE native_poll_sends SET tries=?,due=? WHERE id=?",tries,Date.now()+60000,p.id);
  try {
    await R.env.DB.prepare("INSERT INTO native_text_polls(id,tenant_id,channel,channel_id,session,source_turn,question_id,call_id,client_message_id,body_json,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING").bind(p.id,p.tenant_id,p.channel,p.channel_id,p.session,p.source_turn,p.question_id,p.call_id,p.client_message_id,p.body_json,p.created,Date.now()).run();
    if(!pollCurrent(R,p,true))return cancelNativeSend(R,p);
    const sent=await deliverPoll(R.env,p.tenant_id,{...body,clientMessageId:p.client_message_id});
    if(!pollCurrent(R,p))return cancelNativeSend(R,p);
    if(!sent.ok)return nativeFallback(R,row,p);
    // Save provider identity locally before the D1 await. A reset can publish
    // the exact mapping without sending another poll.
    R.sql.exec("UPDATE native_poll_sends SET state='mapping',poll_guid=?,options_json=? WHERE id=?",sent.pollMessageGuid,JSON.stringify(sent.options),p.id);
    return await publishNativePoll(R,p.id);
  } catch(e) {
    const current=R.sql.exec("SELECT state FROM native_poll_sends WHERE id=?",p.id).toArray()[0];
    if(!current||current.state==="cancelled"||!pollCurrent(R,p))return "cancelled";
    if(current?.state==="mapping"||current?.state==="fallback_mapping"){R.sql.exec("UPDATE native_poll_sends SET due=? WHERE id=?",Date.now()+10000,p.id);R.arm().catch(()=>{});return "pending";}
    if(tries>=4)return nativeFallback(R,row,p);
    R.sql.exec("UPDATE native_poll_sends SET due=? WHERE id=?",Date.now()+10000*tries,p.id);
    R.arm().catch(()=>{});return "pending";
  }
}
async function publishNativePoll(R,id) {
  const row=R.sql.exec("SELECT * FROM native_poll_sends WHERE id=?",id).toArray()[0],p=JSON.parse(row.payload_json);
  if(!pollCurrent(R,p))return cancelNativeSend(R,p);
  await R.env.DB.prepare("UPDATE native_text_polls SET state='sent',poll_guid=?,options_json=?,updated=? WHERE id=? AND tenant_id=?").bind(row.poll_guid,row.options_json,Date.now(),id,p.tenant_id).run();
  if(!pollCurrent(R,p))return cancelNativeSend(R,p);
  R.sql.exec("UPDATE native_poll_sends SET state='sent' WHERE id=?",id);
  return "sent";
}
async function cancelNativeSend(R,p) {
  R.sql.exec("UPDATE native_poll_sends SET state='cancelled' WHERE id=?",p.id);
  await R.env.DB.prepare("DELETE FROM native_text_polls WHERE id=? AND tenant_id=?").bind(p.id,p.tenant_id).run();
  return "cancelled";
}
async function nativeFallback(R,row,p) {
  if(!pollCurrent(R,p))return cancelNativeSend(R,p);
  const q=questionForTurn(R.sql,p.source_turn);
  R.sql.exec("UPDATE native_poll_sends SET state='fallback_mapping' WHERE id=?",p.id);
  if(q?.status==="pending"&&!q.presentation.includes("I could not confirm delivery of a native poll."))R.sql.exec("UPDATE user_questions SET presentation=? WHERE id=?",`root = Stack([Say("I could not confirm delivery of a native poll. Please answer here."), ${q.presentation.replace(/^root = /,"")}])`,p.question_id);
  await R.env.DB.prepare("UPDATE native_text_polls SET state='fallback',updated=? WHERE id=? AND tenant_id=?").bind(Date.now(),p.id,p.tenant_id).run();
  if(!pollCurrent(R,p))return cancelNativeSend(R,p);
  R.sql.exec("UPDATE native_poll_sends SET state='fallback' WHERE id=?",p.id);
  return "fallback";
}
export function nativePollDelivered(R,turn) {
  if(!turn)return null;
  return R.sql.exec("SELECT poll_guid,state FROM native_poll_sends WHERE source_turn=? AND state IN ('pending','mapping','fallback_mapping','sent')",turn).toArray()[0]||null;
}
export async function recoverNativeSends(R) {
  for(const row of R.sql.exec("SELECT * FROM native_poll_sends WHERE state IN ('pending','mapping','fallback_mapping') AND due<=? ORDER BY due LIMIT 4",Date.now()).toArray()) {
    try {await nativeSendRun(R,row,()=>row.state==="mapping"?publishNativePoll(R,row.id):row.state==="fallback_mapping"?nativeFallback(R,row,JSON.parse(row.payload_json)):attemptNativeSend(R,row));}catch(e){R.sql.exec("UPDATE native_poll_sends SET due=? WHERE id=?",Date.now()+10000,row.id);}
  }
  for(const row of R.sql.exec("SELECT * FROM native_poll_sends WHERE state='fallback' AND fallback_delivered=0 AND due<=?",Date.now()).toArray())await deliverNativeFallback(R,row).catch(e=>console.log("native poll fallback",e.message));
}
export async function deliverNativeFallback(R,row) {
  return nativeSendRun(R,row,()=>deliverFallbackText(R,row));
}
async function deliverFallbackText(R,row) {
  const q=questionForTurn(R.sql,row.source_turn),p=JSON.parse(row.payload_json),body=JSON.parse(p.body_json);
  if(row.fallback_delivered||!pollCurrent(R,p,true)){R.sql.exec("UPDATE native_poll_sends SET fallback_delivered=1 WHERE id=?",row.id);return {ok:true,ignored:true};}
  R.sql.exec("UPDATE native_poll_sends SET due=? WHERE id=?",Date.now()+10000,row.id);
  const text=`I could not confirm delivery of a native poll. Please answer by text or in the app.\n${q.question}\n${body.choices.map((x,i)=>`${i+1}. ${x}`).join("\n")}`;
  const sent=await deliverText(R.env,R.get("tenant"),text,{clientMessageId:p.fallback_message_id});
  if(pollCurrent(R,p,true))recordPhotonReplySource(R,p.source_turn,sent);
  if(sent.ok||sent.reason==="not_connected")R.sql.exec("UPDATE native_poll_sends SET fallback_delivered=? WHERE id=?",sent.ok?1:-1,row.id);
  R.arm().catch(()=>{});return sent;
}
const responseId=async id=>"poll:"+[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(id)))].map(x=>x.toString(16).padStart(2,"0")).join("");
export async function receiveNativeVote(R,event) {
  let e={poll_id:String(event?.poll_id||""),message_id:String(event?.message_id||""),poll_message_guid:String(event?.poll_message_guid||""),option_identifier:String(event?.option_identifier||""),selected:event?.selected,origin:messageOrigin(event?.origin)||phoneOrigin(null,"poll_vote")};
  if(!e.message_id||!e.poll_message_guid||!e.option_identifier||typeof e.selected!=="boolean"||Object.values(e).some(v=>typeof v==="string"&&v.length>1024))return {error:"Invalid native poll vote.",status:400};
  const json=JSON.stringify(e),prior=R.sql.exec("SELECT * FROM native_poll_events WHERE id=?",e.message_id).toArray()[0];
  if(prior) {
    const saved=JSON.parse(prior.event_json);
    if(["poll_id","message_id","poll_message_guid","option_identifier","selected"].some(k=>saved[k]!==e[k]))return {error:"This poll event identity belongs to another vote.",status:409};
    e={...saved,origin:messageOrigin(saved.origin)||phoneOrigin(null,"poll_vote")};
  }
  if(prior?.state==="done")return {ok:true,duplicate:true};
  if(!prior)R.sql.exec("INSERT INTO native_poll_events(id,poll_id,event_json,due,created) VALUES(?,?,?,?,?)",e.message_id,e.poll_id,json,Date.now(),Date.now());
  await R.arm();
  R.ctx.waitUntil?.(processNativeVote(R,e).catch(err=>console.log("native poll vote",err.message)));
  return {ok:true,status:"queued"};
}
async function processNativeVote(R,e) {
  try {
    const p=await nativePollTarget(R.env,R.get("tenant"),e.poll_message_guid);
    if(!p) {
      const pending=await R.env.DB.prepare("SELECT 1 x FROM native_text_polls WHERE tenant_id=? AND state='pending' LIMIT 1").bind(R.get("tenant")).first();
      const received=R.sql.exec("SELECT created FROM native_poll_events WHERE id=?",e.message_id).toArray()[0];
      if(pending&&Date.now()-received.created<3600000){R.sql.exec("UPDATE native_poll_events SET due=? WHERE id=?",Date.now()+10000,e.message_id);R.arm().catch(()=>{});return {ok:true,status:"queued"};}
      R.sql.exec("DELETE FROM native_poll_events WHERE id=?",e.message_id);return {ok:true,ignored:true};
    }
    if(e.poll_id&&p.id!==e.poll_id)return finishVote(R,e,{ok:true,ignored:true});
    if(p.channel!==R.get("channel")) {
      const target=R.env.RESIDENT.get(R.env.RESIDENT.idFromName(`res:${R.get("tenant")}:${p.channel}`));
      const accepted=await target.nativePollVote(R.get("tenant"),p.channel,p.channel_id,{...e,poll_id:p.id});
      if(accepted.error)throw new Error("The poll's original task is unavailable.");
      R.sql.exec("DELETE FROM native_poll_events WHERE id=?",e.message_id);return accepted;
    }
    R.sql.exec("UPDATE native_poll_events SET session=? WHERE id=?",p.session,e.message_id);
    const session=R.session(p.session),q=R.sql.exec("SELECT * FROM user_questions WHERE id=? AND session=? AND source_turn=?",p.question_id,p.session,p.source_turn).toArray()[0];
    const card=R.sql.exec("SELECT status FROM cards WHERE id=? AND session=? AND kind<>'helper' AND hidden=0",p.source_turn,p.session).toArray()[0];
    const h=q?.helper_id?R.sql.exec("SELECT status,session FROM helpers WHERE id=?",q.helper_id).toArray()[0]:null;
    if(!session||session.done||!q||!card||["cancelled","superseded"].includes(q.status)||["stopped","failed","interrupted"].includes(card.status)||q.helper_id&&(!h||h.session!==p.session||["stopped","failed","interrupted"].includes(h.status)))return finishVote(R,e,{ok:true,ignored:true});
    const option=JSON.parse(p.options_json||"[]").find(o=>o.optionIdentifier===e.option_identifier);
    if(!option)return finishVote(R,e,{ok:true,ignored:true});
    if(!e.selected)return finishVote(R,e,{ok:true,deselected:true});
    const rid=await responseId(e.message_id),receipt=R.sql.exec("SELECT session,turn FROM user_input_receipts WHERE response_id=?",rid).toArray()[0];
    if(receipt)return finishVote(R,e,{ok:true,duplicate:true,session:receipt.session,turn:receipt.turn});
    const text=q.status==="pending"?`My vote for ${q.question}: ${option.text}`:`I changed my vote for ${q.question} to ${option.text}. Treat this as an update to the original task. Earlier work has not been undone.`;
    const meta={source_turn:p.source_turn,question_id:q.status==="pending"?q.id:undefined,response_id:rid,action:`poll_option:${e.option_identifier}`};
    let input=null;
    if(q.status!=="pending") {
      // A changed vote is a new Primary request in the same task. It does not
      // overwrite the first accepted answer or resume a closed worker.
      R.sql.exec("INSERT OR IGNORE INTO user_input_receipts(response_id,session,source_turn,answer_text,meta_json,opts_json,created) VALUES(?,?,?,?,?,?,?)",rid,p.session,p.source_turn,text,JSON.stringify(meta),JSON.stringify({viaText:true,origin:e.origin}),Date.now());
      input={session:p.session,source_turn:p.source_turn,response_id:rid,text,meta};
    }
    const accepted=await R.inputReply(R.get("tenant"),R.get("channel"),R.get("channel_id"),p.session,text,meta,{viaText:true,origin:e.origin,...(input?{_input:input}:{})});
    if(accepted.error)return finishVote(R,e,{ok:true,ignored:true,reason:accepted.error});
    return finishVote(R,e,accepted);
  } catch(err) {
    R.sql.exec("UPDATE native_poll_events SET due=?,error=? WHERE id=?",Date.now()+10000,String(err.message||err).slice(0,200),e.message_id);
    R.arm().catch(()=>{});throw err;
  }
}
function finishVote(R,e,result) {R.sql.exec("UPDATE native_poll_events SET state='done',error=NULL WHERE id=?",e.message_id);return result;}
export function nativeVoteNext(sql) {
  const times=[sql.exec("SELECT MIN(due) at FROM native_poll_events WHERE state='queued'").toArray()[0]?.at,sql.exec("SELECT MIN(due) at FROM native_poll_sends WHERE state IN ('pending','mapping','fallback_mapping') OR (state='fallback' AND fallback_delivered=0)").toArray()[0]?.at].filter(x=>x!=null);
  return times.length?Math.min(...times):null;
}
export async function recoverNativeVotes(R) {for(const row of R.sql.exec("SELECT event_json FROM native_poll_events WHERE state='queued' AND due<=? ORDER BY due LIMIT 4",Date.now()).toArray())await processNativeVote(R,JSON.parse(row.event_json)).catch(e=>console.log("native poll recovery",e.message));}
