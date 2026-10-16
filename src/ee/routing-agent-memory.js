// Raw agent records belong to one separate Hindsight bank per channel.
// Raw agent records are the one exception to the main conversation memory bank, and they keep their own banks.
import { hs, hsOn, bankPath, contentHash, retainV2, scrubContent, cancelOperation, deleteBank, listBanks, opUuid } from "../hindsight.js";
import { scrubSecrets } from "../secrets-scrub.js";
const VERSION = "agent-raw-v1";
export const AGENT_BANK_CONFIG = Object.freeze({ retain_extraction_mode: "chunks", enable_observations: false, enable_auto_consolidation: false, enable_reranking: false, store_document_text: true, audit_log_enabled: false });
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
async function ensureBare(env, bank, { create = false } = {}) {
  if (create) await hs(env, bankPath(bank), { method: "PUT", body: { retain_extraction_mode: "chunks", enable_observations: false } });
  let current; try { current = await hs(env, `${bankPath(bank)}/config`); } catch (e) { if (!create && e.status === 404) return false; throw e; }
  if (Object.entries(AGENT_BANK_CONFIG).some(([k,v]) => current?.config?.[k] !== v)) {
    await hs(env, `${bankPath(bank)}/config`, { method: "PATCH", body: { updates: AGENT_BANK_CONFIG } });
    current = await hs(env, `${bankPath(bank)}/config`);
    if (Object.entries(AGENT_BANK_CONFIG).some(([k,v]) => current?.config?.[k] !== v)) throw new Error("The agent bank's raw storage settings could not be verified.");
  }
  const models = await hs(env, `${bankPath(bank)}/mental-models?limit=100`);
  if ((models?.items || models?.mental_models || []).length) throw new Error("The agent bank has unexpected mental models. No agent text was sent.");
  return true;
}
function table(R) { R.sql.exec(`CREATE TABLE IF NOT EXISTS agent_memory_receipts (document_id TEXT PRIMARY KEY, helper_id INTEGER NOT NULL, session TEXT NOT NULL, operation_id TEXT NOT NULL)`); R.sql.exec(`CREATE TABLE IF NOT EXISTS ${TABLE} (id TEXT PRIMARY KEY, helper_id INTEGER NOT NULL, round INTEGER NOT NULL, kind TEXT NOT NULL, event_id TEXT, content_hash TEXT, at INTEGER NOT NULL, due INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, error TEXT)`); }
const rowHelper = (R, id) => first(R, "SELECT * FROM helpers WHERE id=?", Number(id));
const roundRow = (R, h, round) => first(R, "SELECT * FROM helper_rounds WHERE helper_id=? AND round=?", Number(h.id), Number(round));
const messages = (R, h) => { try { return R.sql.exec("SELECT * FROM helper_messages WHERE helper_id=? ORDER BY id", Number(h.id)).toArray(); } catch { return []; } };
function metadata(h, round, ended, started = null) { const p = parse(h.profile_json, {}); return { task: String(h.session), helper: String(h.id), round: String(round), category: String(h.category || "general"), model: String(p.servedModel || p.requestedModel || ""), source: "assistant", ended: String(h.status || "done"), start: String(started || h.round_started || h.started || h.created || ""), end: String(ended || "") }; }
export function agentRoundItems(h, record, generalMessages = []) {
  const round = Number(record.round || h.round || 1), at = Number(record.ended || h.ended || h.round_started) || Date.now(), meta = metadata(h, round, record.ended, record.started);
  const conversation = [{ speaker: "General", text: String(record.request || h.task || ""), timestamp: new Date(Number(record.started || h.round_started || at)).toISOString() },
    ...generalMessages.map(m => ({ speaker: "General", text: String(m.text), timestamp: new Date(Number(m.presented_at || m.queued_at || at)).toISOString() })),
    { speaker: `sub-agent ${h.id}`, text: String(record.response || ""), timestamp: new Date(at).toISOString() }];
  const common = { at, context: "Raw conversation and system activity between General and its sub-agent. Neither speaker is the person.", metadata: meta, tags: ["source:agent"], update_mode: "replace" };
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
  return [{ document_id: `${agentDocumentId("subconv",h,pending.round)}:m${pending.event_id}`, content: [{ speaker: "General", text: found.text, kind: pending.kind, timestamp: new Date(Number(found.at)||pending.at).toISOString() }], at: Number(found.at)||pending.at,
    context: "Raw job, follow-up or steering sent by General to a sub-agent, not words spoken by the person.", metadata: metadata(h,pending.round), tags: ["source:agent"], update_mode: "replace" }];
}
async function sendPending(R, pending) {
  const items = await itemsFor(R,pending); if (!items) { R.sql.exec(`DELETE FROM ${TABLE} WHERE id=?`,pending.id); return { removed: true }; }
  const bank = await boundBank(R); await ensureBare(R.env,bank,{create:true});
  const operationId = await opUuid(bank,VERSION,pending.id,...await Promise.all(items.map(i=>contentHash(scrubContent(i.content)))));
  const owner=rowHelper(R,pending.helper_id);
  for(const item of items) R.sql.exec("INSERT INTO agent_memory_receipts(document_id,helper_id,session,operation_id) VALUES(?,?,?,?) ON CONFLICT(document_id) DO UPDATE SET operation_id=excluded.operation_id",item.document_id,Number(pending.helper_id),String(owner.session),operationId);
  const retained = await retainV2(R.env,bank,items,{timeoutMs:30000,operationId});
  R.sql.exec(`DELETE FROM ${TABLE} WHERE id=?`,pending.id);
  return { bank, documents: items.map(i=>i.document_id), operation_ids: retained?.operation_ids || [] };
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
  const bank=await boundBank(R); try {
    if (!await ensureBare(R.env,bank)) return {results:[]};
    const r=await hs(R.env,`${bankPath(bank)}/memories/recall`,{method:"POST",body:{query:scrubSecrets(query.trim()),types:["world"],prefer_observations:false,budget:"mid",max_tokens:2500,query_timestamp:new Date().toISOString(),include:{entities:null}},timeoutMs:12000});
    return {results:(r?.results||[]).filter(x=>validDocument(x.document_id)).map(x=>({id:x.document_id,text:scrubContent(x.text),metadata:x.metadata,at:x.mentioned_at})),note:"Search returns excerpts. Use read_log with an id to read the complete stored document."};
  } catch(e) {if(e.status===404)return {results:[]};return {error:"Agent record search is unavailable. Try again shortly."};}
}
export async function readAgentDocument(R,id) {
  if (!validDocument(id)) return {error:"Choose an agent document id returned by search_agent_bank."};
  if (!hsOn(R.env)) return {error:"Agent records are unavailable."};
  const bank=await boundBank(R);try {
    const r=await hs(R.env,`${bankPath(bank)}/documents/${encodeURIComponent(id)}`,{timeoutMs:12000});
    return {id,text:scrubContent(r.original_text ?? r.document?.original_text ?? r.text ?? ""),metadata:r.document_metadata||r.metadata||{},complete:true};
  } catch(e) {return {error:e.status===404?"The agent document was not found in this channel.":"The agent document is unavailable. Try again shortly."};}
}
async function cancelAll(env,bank) {
  let count=0;const seen=new Set();
  for(const status of ["pending","processing"]) {
    // Always read the first page again, since cancellation removes matching rows.
    for(let page=0;page<10000;page++) {
      let r;try{r=await hs(env,`${bankPath(bank)}/operations?status=${status}&limit=100&offset=0`);}catch(e){if(e.status===404)return count;throw e;}
      const rows=r.operations||[];if(!rows.length)break;
      for(const row of rows){if(seen.has(row.id))throw new Error("An agent memory operation is still active after cancellation. Deletion will retry.");seen.add(row.id);await cancelOperation(env,bank,row.id);count++;}
          }
  }
  return count;
}
export async function forgetAgentBank(env,tenant,channel) {
  const bank=await agentBankId(env,tenant,channel);await cancelAll(env,bank);
  try{await deleteBank(env,bank);return {deleted:1,bank};}catch(e){if(e.status===404)return {deleted:0,bank};throw e;}
}
export async function forgetAgentTenant(env,tenant) {
  const prefix=agentTenantPrefix(env,tenant),banks=(await listBanks(env,prefix)).filter(b=>b.bank_id.startsWith(prefix));let deleted=0;
  for(const b of banks){await cancelAll(env,b.bank_id);try{await deleteBank(env,b.bank_id);deleted++;}catch(e){if(e.status!==404)throw e;}}
  return {deleted,banks:banks.map(b=>b.bank_id)};
}
export async function agentSessionDocuments(env,tenant,channel,session) {
  const bank=await agentBankId(env,tenant,channel),out=[];
  for(const kind of ["sublog","subconv"]) for(let offset=0;;offset+=100){let r;try{r=await hs(env,`${bankPath(bank)}/documents?q=${encodeURIComponent(`${kind}:${session}:`)}&limit=100&offset=${offset}`);}catch(e){if(e.status===404)break;throw e;}
    const rows=r.items||r.documents||[];out.push(...rows.map(x=>x.id||x.document_id).filter(id=>String(id).startsWith(`${kind}:${session}:`)));if(rows.length<100)break;}
  return {bank,documents:[...new Set(out)]};
}
export function agentSessionInventory(R,session) {
  table(R);const rows=R.sql.exec("SELECT * FROM agent_memory_receipts WHERE session=?",String(session)).toArray(), documents=new Set(rows.map(r=>r.document_id));
  try { for(const row of R.sql.exec("SELECT h.id,h.session,r.round FROM helpers h JOIN helper_rounds r ON r.helper_id=h.id WHERE h.session=? AND h.dynamic_routing=1",String(session)).toArray()) {documents.add(agentDocumentId("sublog",row,row.round));documents.add(agentDocumentId("subconv",row,row.round));} } catch {}
  return {documents:[...documents],operation_ids:[...new Set(rows.map(r=>r.operation_id))]};
}
export function purgeAgentSession(R,session) { table(R);R.sql.exec(`DELETE FROM ${TABLE} WHERE helper_id IN (SELECT id FROM helpers WHERE session=?)`,String(session));R.sql.exec("DELETE FROM agent_memory_receipts WHERE session=?",String(session)); }
export async function cancelAgentOperations(env,tenant,channel,ids=[]) { const bank=await agentBankId(env,tenant,channel);for(const id of new Set(ids))await cancelOperation(env,bank,id);return {bank,cancelled:new Set(ids).size}; }
export const SEARCH_AGENT_BANK_TOOL={type:"function",function:{name:"search_agent_bank",description:"Search raw jobs, steering, sub-agent responses and system activity logs in this channel. Results are excerpts. Use read_log with a returned document id to read more.",parameters:{type:"object",properties:{query:{type:"string",maxLength:800}},required:["query"],additionalProperties:false}}};
export const AGENT_MEMORY_TOOLS=[SEARCH_AGENT_BANK_TOOL];
