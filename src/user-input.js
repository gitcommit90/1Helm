import { originInput } from "./message-origin.js";
// Durable interaction identity. Content remains in the ordinary chat transcript;
// these records bind an answer to its question and preserve delivery receipts.
import { scrubSecrets } from './secrets-scrub.js';
export function userInputInit(sql) {
  sql.exec(`CREATE TABLE IF NOT EXISTS user_questions (id TEXT PRIMARY KEY, session TEXT NOT NULL, source_turn TEXT NOT NULL, helper_id INTEGER, round INTEGER, question TEXT NOT NULL, presentation TEXT, profile_json TEXT, status TEXT NOT NULL DEFAULT 'pending', created INTEGER NOT NULL, answer_text TEXT, answered INTEGER, answer_turn TEXT)`);
  for(const column of ["via TEXT NOT NULL DEFAULT 'app'","selection_json TEXT"]) {try {sql.exec(`ALTER TABLE user_questions ADD COLUMN ${column}`);}catch{}}
  sql.exec('CREATE UNIQUE INDEX IF NOT EXISTS user_questions_turn ON user_questions(source_turn)');
  sql.exec('CREATE INDEX IF NOT EXISTS user_questions_pending ON user_questions(session,status)');
  sql.exec(`CREATE TABLE IF NOT EXISTS user_input_receipts (response_id TEXT PRIMARY KEY, session TEXT NOT NULL, question_id TEXT, source_turn TEXT, answer_text TEXT NOT NULL, meta_json TEXT NOT NULL, opts_json TEXT NOT NULL, turn TEXT, created INTEGER NOT NULL)`);
}
export const inputView = q => q ? {question_id:q.id,session:q.session,source_turn:q.source_turn,helper_id:q.helper_id??null,round:q.round??null,question:q.question,presentation:q.presentation||null,status:q.status,via:q.via||"app",...(q.answer_text!=null?{answer_text:q.answer_text,answer_turn:q.answer_turn}: {})} : null;
export const questionForTurn = (sql,turn) => inputView(sql.exec('SELECT * FROM user_questions WHERE source_turn=?',String(turn)).toArray()[0]);
export const pendingInputs = (sql,session) => sql.exec("SELECT * FROM user_questions WHERE session=? AND status='pending' ORDER BY created,id",String(session)).toArray().map(inputView);
export function createQuestion(sql,tc,a={}) {
  const question=scrubSecrets(String(a.question||'').trim()).slice(0,12000), presentation=a.presentation ? scrubSecrets(String(a.presentation)).slice(0,60000):null;
  if(!question) return {error:'A question is required.',status:400};
  const existing=questionForTurn(sql,tc.turn); if(existing) return existing;
  const helperId=Number(a.id||tc.orchestration?.review||tc.orchestration?.steer||tc.orchestration?.started)||null;
  const helper=helperId?sql.exec('SELECT * FROM helpers WHERE id=? AND session=?',helperId,tc.session).toArray()[0]:null;
  if(helperId&&(!helper?.dynamic_routing||!['running','awaiting_review','waiting_input'].includes(helper.status))) return {error:'No matching open worker exists in this task.',status:409};
  const id=crypto.randomUUID(),profile=tc.taskProfile?JSON.stringify({...tc.taskProfile,dispatch:{...tc.orchestration}}):null;
  sql.exec('INSERT INTO user_questions (id,session,source_turn,helper_id,round,question,presentation,profile_json,created,via) VALUES (?,?,?,?,?,?,?,?,?,?)',id,tc.session,tc.turn,helperId,helper?.round??null,question,presentation,profile,Date.now(),tc.viaText?"text":"app");
  sql.exec("UPDATE sessions SET waiting='answer' WHERE id=?",tc.session);
  return questionForTurn(sql,tc.turn);
}
export function resolveInput(sql,session,meta={},text='',{typed=true}={}) {
  session=String(session||'');
  if(!sql.exec('SELECT id FROM sessions WHERE id=?',session).toArray().length) return {error:'No such task in this channel.',status:404};
  if(!meta||typeof meta!=='object'||Array.isArray(meta)) return {error:'Invalid answer identity.',status:400};
  const responseId=String(meta.response_id||'').slice(0,160);
  if(responseId) {
    const receipt=sql.exec('SELECT * FROM user_input_receipts WHERE response_id=?',responseId).toArray()[0];
    if(receipt) return receipt.session===session && receipt.answer_text===String(text) && (!meta.question_id||receipt.question_id===String(meta.question_id)) && (!meta.source_turn||receipt.source_turn===String(meta.source_turn)) ? {duplicate:true,receipt} : {error:'This response identity belongs to a different answer.',status:409};
  }
  let q=null;
  if(meta.question_id) q=sql.exec('SELECT * FROM user_questions WHERE id=? AND session=?',String(meta.question_id),session).toArray()[0];
  else if(meta.source_turn) q=sql.exec('SELECT * FROM user_questions WHERE source_turn=? AND session=?',String(meta.source_turn),session).toArray()[0];
  else if(typed) {
    const pending=sql.exec("SELECT * FROM user_questions WHERE session=? AND status='pending' ORDER BY created",session).toArray();
    if(pending.length>1) return {ambiguous:true,pending:pending.map(inputView),text:String(text)};
    q=pending[0]||null;
  }
  if(meta.question_id&&!q) return {error:'The question does not belong to this task.',status:404};
  if(meta.source_turn) {
    const source=sql.exec("SELECT id FROM cards WHERE id=? AND session=? AND kind<>'helper' AND hidden=0",String(meta.source_turn),session).toArray()[0];
    if(!source) return {error:'The card does not belong to this task.',status:404};
    if(q&&q.source_turn!==String(meta.source_turn)) return {error:'The card and question do not match.',status:409};
  }
  if(q) {
    if(q.status!=='pending') return q.status==='answered' && q.answer_text===String(text) ? {duplicate:true,question:q} : {error:'This question has already been answered or replaced.',status:409};
    if(meta.helper_id!=null&&Number(meta.helper_id)!==q.helper_id || meta.round!=null&&Number(meta.round)!==q.round) return {error:'The answer does not match the worker round.',status:409};
    if(q.helper_id) {
      const h=sql.exec('SELECT * FROM helpers WHERE id=? AND session=?',q.helper_id,session).toArray()[0];
      if(!h||!['running','awaiting_review','waiting_input'].includes(h.status)||Number(h.round)!==Number(q.round)) return {error:'The worker has moved on from this question.',status:409};
    }
  }
  return {question:q,response_id:responseId||crypto.randomUUID(),source_turn:q?.source_turn||String(meta.source_turn||'')||null,meta:{...meta},text:String(text)};
}
// Called in the same synchronous section as opening/journaling the answer turn.
// A recovery receipt has the complete original input and never guesses a worker.
export function acceptInput(sql,session,prepared,opts={}) {
  if(prepared.error||prepared.duplicate||prepared.ambiguous) return prepared;
  const checked=resolveInput(sql,session,{...prepared.meta,response_id:prepared.response_id,...(prepared.question?{question_id:prepared.question.id,source_turn:prepared.question.source_turn}:{})},prepared.text,{typed:!prepared.source_turn});
  if(checked.error||checked.duplicate||checked.ambiguous)return checked;
  if((checked.question?.id||null)!==(prepared.question?.id||null))return {error:'The pending question changed before the answer was saved.',status:409};
  const q=prepared.question, id=prepared.response_id;
  sql.exec('INSERT OR IGNORE INTO user_input_receipts (response_id,session,question_id,source_turn,answer_text,meta_json,opts_json,created) VALUES (?,?,?,?,?,?,?,?)',id,String(session),q?.id||null,prepared.source_turn,prepared.text,JSON.stringify({...prepared.meta,...(prepared.selection?{_selection:prepared.selection}:{})}),JSON.stringify(opts),Date.now());
  if(prepared.selection) sql.exec("UPDATE user_questions SET status='answered',answer_text=?,answered=? WHERE id=? AND status='pending'",prepared.selection.text,Date.now(),prepared.selection.id);
  if(q) sql.exec("UPDATE user_questions SET status='answered',answer_text=?,answered=? WHERE id=? AND status='pending'",prepared.text,Date.now(),q.id);
  return {...prepared,originOptions:originInput(opts),question:q?{...q,status:'answered',answer_text:prepared.text}:null};
}
export function attachInputTurn(sql,prepared,turn) {
  if(!prepared?.response_id)return;
  sql.exec('UPDATE user_input_receipts SET turn=? WHERE response_id=?',turn,prepared.response_id);
  if(prepared.selection)sql.exec("UPDATE user_questions SET answer_turn=? WHERE id=?",turn,prepared.selection.id);
  if(prepared.question)sql.exec('UPDATE user_questions SET answer_turn=? WHERE id=?',turn,prepared.question.id);
}
export function deleteInputs(sql,session) {
  sql.exec('DELETE FROM user_input_receipts WHERE session=?',String(session));
  sql.exec('DELETE FROM user_questions WHERE session=?',String(session));
}
export function inputContext(prepared) {
  const q=prepared?.question;
  if(prepared?.ambiguous) return `Several questions are waiting for answers. Ask which question the person is answering, and show the pending questions: ${JSON.stringify(prepared.pending)}. Do not send the answer to a worker until the person selects a question.`;
  if(!q)return prepared?.source_turn?`The person used a result card from turn ${prepared.source_turn}. Handle this as a new Primary request. A closed worker cannot be resumed.`:'';
  return `The person answered question ${q.id} from turn ${q.source_turn}. Question: ${q.question}\nAnswer: ${prepared.text}\n${q.helper_id?`The answer belongs to the same open worker #${q.helper_id}, round ${q.round}. Review the answer yourself. Send clarified instructions with message_subagent to continue that worker, or continue reviewing its returned work. Do not approve unfinished work.`:'Continue the original request with this answer.'}`;
}

export function replyView(prepared) {
  if(!prepared || prepared.ambiguous)return null;
  const q=prepared.question;
  return {source_turn:prepared.source_turn||q?.source_turn||null,response_id:prepared.response_id||null,...(q?{question_id:q.id,helper_id:q.helper_id,round:q.round}:{}),...(prepared.meta?.action?{action:String(prepared.meta.action)}:{})};
}
export function replyForTurn(sql,turn) {
  const receipt=sql.exec('SELECT * FROM user_input_receipts WHERE turn=? ORDER BY created LIMIT 1',String(turn)).toArray()[0];
  if(!receipt)return null;
  const question=receipt.question_id?sql.exec('SELECT * FROM user_questions WHERE id=?',receipt.question_id).toArray()[0]:null;
  return replyView({question,source_turn:receipt.source_turn,response_id:receipt.response_id,meta:JSON.parse(receipt.meta_json||'{}')});
}

// A numbered chooser resolves only IDs that were saved when ambiguity occurred.
// The original answer is delivered to the chosen question, never to an inferred worker.
export function chooseInput(sql,session,meta={},text='') {
  if(meta.response_id) {
    const receipt=sql.exec('SELECT * FROM user_input_receipts WHERE response_id=?',String(meta.response_id)).toArray()[0];
    if(receipt){const selected=JSON.parse(receipt.meta_json||'{}')._selection;if(selected){const chooser=sql.exec('SELECT source_turn FROM user_questions WHERE id=?',selected.id).toArray()[0];return selected.session===String(session)&&selected.text===String(text)&&(!meta.question_id||String(meta.question_id)===selected.id)&&(!meta.source_turn||String(meta.source_turn)===chooser?.source_turn)?{duplicate:true,receipt}:{error:'This response identity belongs to another selection.',status:409};}}
  }
  const explicit=meta?.question_id||meta?.source_turn;
  let chooser=explicit?sql.exec(`SELECT * FROM user_questions WHERE session=? AND selection_json IS NOT NULL AND ${meta.question_id?'id':'source_turn'}=?`,String(session),String(meta.question_id||meta.source_turn)).toArray()[0]:null;
  if(!chooser&&!explicit){const pending=sql.exec("SELECT * FROM user_questions WHERE session=? AND selection_json IS NOT NULL AND status='pending'",String(session)).toArray();if(pending.length===1)chooser=pending[0];}
  if(!chooser)return null;
  if(meta.source_turn&&String(meta.source_turn)!==chooser.source_turn)return {error:'The chooser does not belong to this card.',status:409};
  if(chooser.status!=='pending')return {error:'This question selection has already been answered.',status:409};
  const selection=JSON.parse(chooser.selection_json),action=String(meta.action||''),number=String(text).trim().match(/^([1-9][0-9]*)[.)]?$/);
  const id=action.startsWith('input_question:')?action.slice('input_question:'.length):number?selection.questions[Number(number[1])-1]:null;
  if(!id||!selection.questions.includes(id))return {error:'Choose one of the numbered questions, or type its number.',status:409};
  const target=sql.exec('SELECT * FROM user_questions WHERE id=?',id).toArray()[0];
  if(!target||target.selection_json||target.status!=='pending')return {error:'The selected question is no longer waiting for an answer.',status:409};
  const original = sql.exec("SELECT opts_json FROM user_input_receipts WHERE turn=? ORDER BY created LIMIT 1", chooser.source_turn).toArray()[0];
  const originOptions = originInput(original ? JSON.parse(original.opts_json) : {});
  return {originOptions,session:target.session,text:selection.answer,meta:{question_id:target.id,source_turn:target.source_turn,response_id:String(meta.response_id||crypto.randomUUID()),...(meta.action?{action:String(meta.action)}:{})},selection:{id:chooser.id,text:String(text),session:String(session),target:id}};
}
export function createInputChooser(sql,tc,prepared) {
  const questions=(prepared.pending||[]).filter(q=>sql.exec("SELECT 1 FROM user_questions WHERE id=? AND status='pending' AND selection_json IS NULL",q.question_id).toArray().length);
  if(!questions.length)return createQuestion(sql,tc,{question:'The earlier question is no longer open. How would you like to continue?'});
  const crossTask=new Set(questions.map(q=>q.session)).size>1;
  const label=q=>{const title=crossTask?String(sql.exec("SELECT title FROM sessions WHERE id=?",q.session).toArray()[0]?.title||"Task").slice(0,60):"";return `${title?`${title}: `:""}${q.question.slice(0,100)}`;};
  const buttons=questions.map((q,i)=>`Button(${JSON.stringify(`${i+1}. ${label(q)}`)}, ${JSON.stringify(`input_question:${q.question_id}`)}, "secondary")`).join(', ');
  const q=createQuestion(sql,tc,{question:'Which question does your answer belong to? Choose a question below, or type its number.',presentation:`root = Stack([Say("Which question does your answer belong to? Choose a question below, or type its number."), Buttons([${buttons}])])`});
  if(!q.error)sql.exec('UPDATE user_questions SET selection_json=? WHERE id=?',JSON.stringify({questions:questions.map(q=>q.question_id),answer:String(prepared.text||tc.userText||'')}),q.question_id);
  return q;
}
export function acceptAmbiguous(sql,session,prepared,opts={}) {
  const response_id=String(prepared.meta?.response_id||prepared.response_id||crypto.randomUUID()),text=String(prepared.text||'');
  const existing=sql.exec('SELECT * FROM user_input_receipts WHERE response_id=?',response_id).toArray()[0];
  if(existing)return existing.session===String(session)&&existing.answer_text===text?{duplicate:true,receipt:existing}:{error:'This response identity belongs to another answer.',status:409};
  const meta={...(prepared.meta||{}),_ambiguity:prepared.pending};
  sql.exec('INSERT INTO user_input_receipts (response_id,session,question_id,source_turn,answer_text,meta_json,opts_json,created) VALUES (?,?,NULL,NULL,?,?,?,?)',response_id,String(session),text,JSON.stringify(meta),JSON.stringify({...opts,_input:undefined}),Date.now());
  return {...prepared,response_id,text,meta};
}
