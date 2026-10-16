import { replyRef } from "../reply-to.js";
import { nativePollTarget } from "./native-polls.js";
// Provider IDs bind a phone reply to its original local card, never to the
// newest pending question. The map belongs to this channel's Resident.
export function photonReplyInit(sql) {sql.exec("CREATE TABLE IF NOT EXISTS photon_reply_sources (guid TEXT PRIMARY KEY,session TEXT NOT NULL,source_turn TEXT NOT NULL)");}
export function photonReplyOptions(m) {
  const target=m?.photon_target?.id?{id:String(m.photon_target.id).slice(0,1024),preview:String(m.photon_target.preview||"").slice(0,240)}:null;
  const reply=replyRef(m?.reply);
  return {reply,photon_target:target,...(target?{note:`Phone reply target data: ${JSON.stringify({...target,author:reply?.role||"unknown"})}`}:{})};
}
export async function photonReplySource(R,target) {
  if(!target?.id)return null;
  const row=R.sql.exec("SELECT session,source_turn FROM photon_reply_sources WHERE guid=?",target.id).toArray()[0];
  if(row)return {...row,channel:R.get("channel"),channel_id:R.get("channel_id")};
  // Existing explicit text_person deliveries already have an authoritative ID.
  const old=R.sql.exec("SELECT c.session,o.turn source_turn FROM outbox o JOIN cards c ON c.id=o.turn WHERE o.delivery=?",`sent:${target.id}`).toArray()[0];
  if(old)return {...old,channel:R.get("channel"),channel_id:R.get("channel_id")};
  const poll=await nativePollTarget(R.env,R.get("tenant"),target.id).catch(()=>null);
  return poll?{session:poll.session,source_turn:poll.source_turn,channel:poll.channel,channel_id:poll.channel_id}:null;
}
export function recordPhotonReplySource(R,turn,sent) {
  if(!turn||!sent?.ok||!sent.id)return sent;
  const card=R.sql.exec("SELECT session FROM cards WHERE id=?",turn).toArray()[0];
  const session=card?.session?R.session(card.session):null;
  if(session&&!session.done)R.sql.exec("INSERT OR REPLACE INTO photon_reply_sources(guid,session,source_turn) VALUES(?,?,?)",sent.id,card.session,turn);
  return sent;
}
// Message event input JSON also survives unread steering and object restarts.
// Keep the original quote target separate from the incoming message we answer.
export function photonMessage(input) {
  if(input?.via!=="text"||!input.photonMsg)return null;
  return {photonMsg:String(input.photonMsg).slice(0,256),...photonReplyOptions(input),note:String(input.note||"").slice(0,2000)};
}
export function photonAnswerOptions(R,turn) {
  if(!turn)return {};
  const event=R.sql.exec("SELECT input FROM card_events WHERE card=? AND type='msg' AND via='text' ORDER BY seq DESC LIMIT 1",turn).toArray()[0];
  let m=null;try {m=JSON.parse(event?.input||"null");}catch{}
  return m?.photon_target?.id&&m?.photonMsg?{replyTo:m.photonMsg}:{};
}
export function dropPhotonReplies(sql,session) {sql.exec("DELETE FROM photon_reply_sources WHERE session=?",String(session));}
// A reply to an answered question is a new request about its original card.
// Preserve that source without answering a different pending question.
export function photonSourceInput(R,text,opts) {
  const response_id=opts.photonMsg?`text:${opts.photonMsg}`:crypto.randomUUID();
  const meta={source_turn:opts.photon_source_turn,response_id};
  R.sql.exec("INSERT OR IGNORE INTO user_input_receipts(response_id,session,source_turn,answer_text,meta_json,opts_json,created) VALUES(?,?,?,?,?,?,?)",response_id,opts.session,opts.photon_source_turn,String(text),JSON.stringify(meta),JSON.stringify({...opts,viaText:true}),Date.now());
  return {session:opts.session,source_turn:opts.photon_source_turn,response_id,text:String(text),meta};
}
