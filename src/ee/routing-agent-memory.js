// Raw agent records belong to one separate memory namespace per channel (an a2a- bank id), kept as chunks with no model call.
// Raw agent records are the one exception to the main conversation memory, and they keep their own namespace.
import { hsOn, contentHash, retainV2, scrubContent, recall, documentText, listDocuments, forgetBank } from "../mem0.js";
import { scrubSecrets } from "../secrets-scrub.js";
const TABLE = "agent_memory_outbox";
const parse = (s, fallback = null) => { try { return typeof s === "string" ? JSON.parse(s) : s ?? fallback; } catch { return fallback; } };
const first = (R, q, ...args) => R.sql.exec(q, ...args).toArray()[0] || null;
const scope = R => { const tenant = String(R.get("tenant") || ""), channel = String(R.get("channel") || ""); if (!tenant || !channel) throw new Error("An agent memory operation needs the bound channel."); return { tenant, channel }; };
export const agentTenantPrefix = (env, tenant) => { if (!/^[a-zA-Z0-9_-]{1,80}$/.test(String(tenant))) throw new Error("Invalid agent bank owner."); return `a2a-${env.ENV_NAME || "dev"}-${tenant}-`; };
// Channel hashes prevent both truncation collisions and user-created channel names
// from colliding with a normal bank. Account deletion still has an exact prefix.
export async function agentBankId(env, tenant, channel) { return `${agentTenantPrefix(env, tenant)}${await contentHash(JSON.stringify(String(channel)))}`; }
const boundBank = async R => { const { tenant, channel } = scope(R); return agentBankId(R.env, tenant, channel); };
export const agentDocumentId = (kind, h, round = h.round || 1) => `${kind}:${String(h.session)}:${Number(h.id)}:${Number(round)}`;
const validDocument = id => /^(sublog|subconv):[^:\/\\]{1,160}:\d+:\d+(?::m[a-zA-Z0-9_-]{1,100})?$/.test(String(id));
function table(R) { R.sql.exec(`CREATE TABLE IF NOT EXISTS agent_memory_receipts (document_id TEXT PRIMARY KEY, helper_id INTEGER NOT NULL, session TEXT NOT NULL, operation_id TEXT NOT NULL)`); R.sql.exec(`CREATE TABLE IF NOT EXISTS ${TABLE} (id TEXT PRIMARY KEY, helper_id INTEGER NOT NULL, round INTEGER NOT NULL, kind TEXT NOT NULL, event_id TEXT, content_hash TEXT, at INTEGER NOT NULL, due INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, error TEXT)`); }
const rowHelper = (R, id) => first(R, "SELECT * FROM helpers WHERE id=?", Number(id));
const roundRow = (R, h, round) => first(R, "SELECT * FROM helper_rounds WHERE helper_id=? AND round=?", Number(h.id), Number(round));
const messages = (R, h) => { try { return R.sql.exec("SELECT * FROM helper_messages WHERE helper_id=? ORDER BY id", Number(h.id)).toArray(); } catch { return []; } };
function metadata(h, round, ended, started = null) { const p = parse(h.profile_json, {}); return { task: String(h.session), helper: String(h.id), round: String(round), category: String(h.category || "general"), model: String(p.servedModel || p.requestedModel || ""), source: "assistant", ended: String(h.status || "done"), start: String(started || h.round_started || h.started || h.created || ""), end: String(ended || "") }; }
export function agentRoundItems(h, record, generalMessages = []) {
  const round = Number(record.round || h.round || 1), at = Number(record.ended || h.ended || h.round_started) || Date.now(), meta = metadata(h, round, record.ended, record.started);
  const conversation = [{ speaker: "General", text: String(record.request || h.task || ""), time: new Date(Number(record.started || h.round_started || at)).toISOString() },
    ...generalMessages.map(m => ({ speaker: "General", text: String(m.text), time: new Date(Number(m.presented_at || m.queued_at || at)).toISOString() })),
    { speaker: `sub-agent ${h.id}`, text: String(record.response || ""), time: new Date(at).toISOString() }];
  const common = { at, context: "Raw conversation and system activity between General and its sub-agent. Neither speaker is the person.", metadata: meta, tags: ["source:agent"], update_mode: "replace", strategy: "reference" };
  return [{ ...common, document_id: agentDocumentId("sublog", h, round), content: String(record.log || "") }, { ...common, document_id: agentDocumentId("subconv", h, round), content: conversation }].filter(i => typeof i.content !== "string" || i.content.trim());
}
async function messageFromSource(R, h, wantedHash, round = h.round || 1, eventId = "") {
  let roundRequests=[];try{roundRequests=R.sql.exec("SELECT request,started FROM helper_rounds WHERE helper_id=? ORDER BY round",Number(h.id)).toArray().map(r=>({text:r.request,at:r.started}));}catch{}
  const savedMessages=messages(R,h), exact=savedMessages.filter(m=>String(m.id)===String(eventId));
  const candidates = [...exact.map(m=>({text:m.text,at:m.queued_at})),...roundRequests, { text: h.task, at: h.created || h.started || h.round_started }, ...savedMessages.map(m => ({ text: m.text, at: m.queued_at })),
    ...(parse(h.history_json, []) || []).filter(m => m.role === "user").map(m => ({ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content), at: h.round_started }))];
  for (const item of candidates) if (item.text && await contentHash(String(item.text)) === wantedHash) return item;
  return null;
}
async function itemsFor(R, pending) {
  const h = rowHelper(R, pending.helper_id); if (!h?.dynamic_routing) return null;
  if (pending.kind === "round") {
    const record = roundRow(R,h,pending.round); if (!record) throw new Error("The agent round is not yet stored.");
    const during = messages(R,h).filter(m => Number(m.queued_at) >= Number(record.started || h.round_started || 0) && Number(m.queued_at) <= Number(record.ended || Infinity) && m.status !== "not_seen");
    return agentRoundItems(h,record,during);
  }
  const found = await messageFromSource(R,h,pending.content_hash,pending.round,pending.event_id); if (!found) throw new Error("The original agent message is not available for retry.");
  return [{ document_id: `${agentDocumentId("subconv",h,pending.round)}:m${pending.event_id}`, content: [{ speaker: "General", text: found.text, kind: pending.kind, time: new Date(Number(found.at)||pending.at).toISOString() }], at: Number(found.at)||pending.at,
    context: "Raw job, follow-up or steering sent by General to a sub-agent, not words spoken by the person.", metadata: metadata(h,pending.round), tags: ["source:agent"], update_mode: "replace", strategy: "reference" }];
}
async function sendPending(R, pending) {
  const items = await itemsFor(R,pending); if (!items) { R.sql.exec(`DELETE FROM ${TABLE} WHERE id=?`,pending.id); return { removed: true }; }
  const bank = await boundBank(R), owner = rowHelper(R,pending.helper_id);
  await retainV2(R.env,bank,items);
  for(const item of items) R.sql.exec("INSERT INTO agent_memory_receipts(document_id,helper_id,session,operation_id) VALUES(?,?,?,?) ON CONFLICT(document_id) DO NOTHING",item.document_id,Number(pending.helper_id),String(owner.session),"");   // the receipt keeps the document in the session's inventory
  R.sql.exec(`DELETE FROM ${TABLE} WHERE id=?`,pending.id);
  return { bank, documents: items.map(i=>i.document_id) };
}
async function attempt(R, pending) {
  try { return await sendPending(R,pending); } catch (e) {
    const tries = Number(pending.tries || 0)+1, due = Date.now()+Math.min(3600e3,10000*2**Math.min(tries,8));
    // The queue stores source references and errors, never another full log copy.
    R.sql.exec(`UPDATE ${TABLE} SET tries=?,due=?,error=? WHERE id=?`,tries,due,scrubSecrets(String(e.message)).slice(0,300),pending.id);
    console.log("agent memory write pending", JSON.stringify({ helper: pending.helper_id, round: pending.round, tries }));
    return { pending: true, due, error: "The agent record is saved locally and will be retried." };
  }
}
export async function retainAgentRound(R,h,record) {
  if (!h?.dynamic_routing || !hsOn(R.env)) return { disabled:true };
  scope(R); table(R); const round=Number(record.round || h.round || 1), id=`round:${h.id}:${round}`, at=Number(record.ended)||Date.now();
  R.sql.exec(`INSERT OR IGNORE INTO ${TABLE}(id,helper_id,round,kind,at,due) VALUES(?,?,?,?,?,?)`,id,Number(h.id),round,"round",at,Date.now());
  return attempt(R,first(R,`SELECT * FROM ${TABLE} WHERE id=?`,id));
}
export async function retainAgentMessage(R,h,text,kind="job",eventId="") {
  if (!h?.dynamic_routing || !hsOn(R.env) || !String(text || "").trim()) return { disabled:true };
  scope(R);table(R); const hash=await contentHash(String(text)), event=String(eventId || hash).replace(/[^a-zA-Z0-9_-]/g,"_").slice(0,100), round=Number(h.round||1), id=`message:${h.id}:${round}:${event}`, at=Date.now();
  R.sql.exec(`INSERT OR IGNORE INTO ${TABLE}(id,helper_id,round,kind,event_id,content_hash,at,due) VALUES(?,?,?,?,?,?,?,?)`,id,Number(h.id),round,String(kind).slice(0,40),event,hash,at,Date.now());
  return attempt(R,first(R,`SELECT * FROM ${TABLE} WHERE id=?`,id));
}
export async function flushAgentMemory(R) {
  if (!hsOn(R.env)) return { flushed:0 };table(R);let flushed=0;
  for (const pending of R.sql.exec(`SELECT * FROM ${TABLE} WHERE due<=? ORDER BY due LIMIT 4`,Date.now()).toArray()) { const r=await attempt(R,pending);if(!r.pending)flushed++; }
  return {flushed};
}
export function agentMemoryNextWake(R) { table(R);const r=first(R,`SELECT MIN(due) due FROM ${TABLE}`);return Number(r?.due)||null; }
export async function searchAgentBank(R,query) {
  if (!hsOn(R.env)) return {error:"Agent records are unavailable."};
  if (typeof query!=="string" || !query.trim() || query.length>800) return {error:"Use a short search query of 800 characters or fewer."};
  try {
    const r=await recall(R.env,await boundBank(R),scrubSecrets(query.trim()),{topK:20});
    return {results:r.results.filter(x=>validDocument(x.document_id)).map(x=>({id:x.document_id,text:scrubContent(x.text),metadata:x.metadata,at:x.mentioned_at})),note:"Search returns excerpts. Use read_log with an id to read the complete stored document."};
  } catch(e) {return {error:"Agent record search is unavailable. Try again shortly."};}
}
export async function readAgentDocument(R,id) {
  if (!validDocument(id)) return {error:"Choose an agent document id returned by search_agent_bank."};
  if (!hsOn(R.env)) return {error:"Agent records are unavailable."};
  try {
    const text=await documentText(R.env,await boundBank(R),id);
    return text?{id,text:scrubContent(text),complete:true}:{error:"The agent document was not found in this channel."};
  } catch(e) {return {error:"The agent document is unavailable. Try again shortly."};}
}
export async function forgetAgentBank(env,tenant,channel) { const bank=await agentBankId(env,tenant,channel);return {...await forgetBank(env,bank),bank}; }
export async function agentSessionDocuments(env,tenant,channel,session) {
  const bank=await agentBankId(env,tenant,channel),out=[];
  for(const kind of ["sublog","subconv"]) out.push(...(await listDocuments(env,bank,{q:`${kind}:${session}:`,limit:100000})).map(x=>x.id));
  return {bank,documents:[...new Set(out)]};
}
export function agentSessionInventory(R,session) {
  table(R);const rows=R.sql.exec("SELECT * FROM agent_memory_receipts WHERE session=?",String(session)).toArray(), documents=new Set(rows.map(r=>r.document_id));
  try { for(const row of R.sql.exec("SELECT h.id,h.session,r.round FROM helpers h JOIN helper_rounds r ON r.helper_id=h.id WHERE h.session=? AND h.dynamic_routing=1",String(session)).toArray()) {documents.add(agentDocumentId("sublog",row,row.round));documents.add(agentDocumentId("subconv",row,row.round));} } catch {}
  return {documents:[...documents]};
}
export function purgeAgentSession(R,session) { table(R);R.sql.exec(`DELETE FROM ${TABLE} WHERE helper_id IN (SELECT id FROM helpers WHERE session=?)`,String(session));R.sql.exec("DELETE FROM agent_memory_receipts WHERE session=?",String(session)); }
export const SEARCH_AGENT_BANK_TOOL={type:"function",function:{name:"search_agent_bank",description:"Search raw jobs, steering, sub-agent responses and system activity logs in this channel. Results are excerpts. Use read_log with a returned document id to read more.",parameters:{type:"object",properties:{query:{type:"string",maxLength:800}},required:["query"],additionalProperties:false}}};
export const AGENT_MEMORY_TOOLS=[SEARCH_AGENT_BANK_TOOL];
