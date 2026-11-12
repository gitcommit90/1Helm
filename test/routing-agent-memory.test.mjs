// Raw agent records in the Mem0 memory (src/routing-agent-memory.js): stored as reference chunks with no model call, retried from a local queue, searched and read by channel.
import { memEnv, fakeExtraction } from './helpers/mem0-fakes.mjs';
import { forgetTenant, memoriesList } from '../src/mem0.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { agentBankId, agentRoundItems, retainAgentRound, retainAgentMessage, flushAgentMemory, agentMemoryNextWake, searchAgentBank, readAgentDocument, forgetAgentBank, agentSessionInventory, purgeAgentSession } from '../src/ee/routing-agent-memory.js';
const db=new DatabaseSync(':memory:');db.exec(`CREATE TABLE helpers(id INTEGER PRIMARY KEY,session TEXT,task TEXT,round INTEGER,dynamic_routing INTEGER,category TEXT,profile_json TEXT,history_json TEXT,round_started INTEGER,created INTEGER);CREATE TABLE helper_rounds(helper_id INTEGER,round INTEGER,request TEXT,started INTEGER,response TEXT,log TEXT,ended INTEGER,PRIMARY KEY(helper_id,round));CREATE TABLE helper_messages(id INTEGER PRIMARY KEY,helper_id INTEGER,text TEXT,status TEXT,queued_at INTEGER,presented_at INTEGER);`);
const sql={exec(q,...v){const stmt=db.prepare(q);if(/^\s*(SELECT|WITH)/i.test(q)) {const rows=stmt.all(...v);return {toArray:()=>rows,one:()=>rows[0]};}stmt.run(...v);return {toArray:()=>[]};}};
const TA='11111111-2222-3333-4444-555555555555';
const values=new Map([['tenant',TA],['channel','main']]);
const { env, d1 } = memEnv(); const x = fakeExtraction(() => []);
const R={env,sql,get:k=>values.get(k),put:(k,v)=>values.set(k,v)};
const h={id:1,session:'s',task:'Initial job',round:1,dynamic_routing:1,category:'finance',profile_json:JSON.stringify({requestedModel:'example/model'}),round_started:1000,created:1000,history_json:'[]'};
const record={helper_id:1,round:1,request:'Initial job',started:1000,response:'The response',log:'first\n'+('long system activity\n'.repeat(8000))+'my password is Abc-Secret-2398 report',ended:2000};
sql.exec('INSERT INTO helpers VALUES(?,?,?,?,?,?,?,?,?,?)',h.id,h.session,h.task,h.round,h.dynamic_routing,h.category,h.profile_json,h.history_json,h.round_started,h.created);
sql.exec('INSERT INTO helper_rounds VALUES(?,?,?,?,?,?,?)',1,1,record.request,record.started,record.response,record.log,record.ended);
const bank=await agentBankId(env,TA,'main');assert.notEqual(bank,await agentBankId(env,TA,'main-a2a'));assert.notEqual(bank,await agentBankId(env,'99999999-2222-3333-4444-555555555555','main'));assert.notEqual(bank,await agentBankId({...env,ENV_NAME:'live'},TA,'main'));
const built=agentRoundItems(h,record);assert.equal(built[0].content,record.log,'full stored logs have no app cap');assert.equal(built[1].content[0].speaker,'General');assert.ok(built.every(i=>i.strategy==='reference'&&i.tags.join()==='source:agent'));
let r=await retainAgentRound(R,h,record);assert.equal(r.documents.length,2);assert.equal(x.calls.length,0,'raw agent records need no model call');assert.equal(agentMemoryNextWake(R),null);assert.equal(agentSessionInventory(R,'s').documents.length,2);
const stored=(await memoriesList(env,bank,{doc:'sublog:s:1:1',limit:1000})).items.map(i=>i.text).join('');assert.ok(stored.length>100000&&!stored.includes('Abc-Secret-2398'),'the full log is stored and scrubbed');
// a failing write is queued locally with no copy of the log, then flushed on a later wake
const realIndex=env.MEMORY_INDEX.upsert;env.MEMORY_INDEX.upsert=async()=>{throw new Error('down');};
sql.exec('INSERT INTO helper_rounds VALUES(?,?,?,?,?,?,?)',1,2,'Round two',2500,'Done','log two',3000);r=await retainAgentRound(R,h,{...record,round:2,ended:3000});assert(r.pending);assert(agentMemoryNextWake(R)>Date.now());assert(!db.prepare('PRAGMA table_info(agent_memory_outbox)').all().map(c=>c.name).includes('content'));
env.MEMORY_INDEX.upsert=realIndex;sql.exec('UPDATE agent_memory_outbox SET due=0');assert.equal((await flushAgentMemory(R)).flushed,1);assert.equal(agentMemoryNextWake(R),null);
sql.exec('INSERT INTO helper_messages VALUES(?,?,?,?,?,?)',7,1,'Update the report','seen',1500,1600);await retainAgentMessage(R,h,'Update the report','steering',7);
assert.equal((await memoriesList(env,bank,{doc:'subconv:s:1:1:m7'})).items.length>0,true);assert.match(JSON.stringify((await memoriesList(env,bank,{doc:'subconv:s:1:1:m7'})).items),new RegExp(new Date(1500).toISOString()));
const search=await searchAgentBank(R,'report');assert.ok(search.results.length&&search.results.every(x=>/^(sublog|subconv):/.test(x.id)));
const document=await readAgentDocument(R,'sublog:s:1:1');assert(document.complete);assert(document.text.length>100000);assert(!document.text.includes('Abc-Secret-2398'));assert((await readAgentDocument(R,'../../../other')).error);
// another channel of the same account cannot read the records, and deleting the channel's agent bank removes them
values.set('channel','other');assert.ok((await readAgentDocument(R,'sublog:s:1:1')).error);values.set('channel','main');
await forgetAgentBank(env,TA,'main');assert.equal((await memoriesList(env,bank,{doc:'sublog:s:1:1'})).items.length,0);
await retainAgentRound(R,h,record);await forgetTenant(env,TA);assert.equal((await memoriesList(env,bank,{limit:10})).items.length,0,'account deletion covers agent banks');
purgeAgentSession(R,'s');assert.equal(db.prepare('SELECT COUNT(*) n FROM agent_memory_receipts').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM agent_memory_outbox').get().n,0);
values.delete('tenant');assert.ok((await searchAgentBank(R,'test')).error);
x.done();console.log('PASS raw agent memory: channel banks, full scrubbed logs, local retry queue, search and read, deletion');db.close();
