import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Resident } from '../src/resident.js';
import { fileVersionsMethods } from '../src/file-versions.js';
import { initRoutingArtifacts,stageRoutingFile,collectRoutingFiles,approveRoutingFiles,discardRoutingFiles,routingFileTool,isRoutingImageError,routingArtifactKeys,dropRoutingArtifacts,routingImageFallback } from '../src/ee/routing-artifacts.js';
import { stPut } from '../src/storage.js';
import { seedSettings } from './helpers/seed-settings.mjs';
// The call goes through dispatch, which checks the account level for a Workers AI model like every other call. A test account is at the strictest level,
// so the saved model gets a verified zero data retention route here.
import { ENDPOINTS } from "../src/privacy.js";
ENDPOINTS.transcription ||= {}; for (const m of ["@cf/google/gemma-4-26b-a4b-it"]) ENDPOINTS.transcription[m] = { "cloudflare-workers-ai": { zdr: true, training: false } };
const db=new DatabaseSync(':memory:'),d1=new DatabaseSync(':memory:');
d1.exec(readFileSync(new URL('../db/migrations/0020_029_storage.sql',import.meta.url),'utf8'));d1.exec("CREATE TABLE tenants(id TEXT PRIMARY KEY,slug TEXT,plan TEXT,status TEXT);INSERT INTO tenants VALUES('test-tenant','fixture','plus','active');CREATE TABLE share_links(tenant_id TEXT,file_id TEXT,r2key TEXT,bytes INTEGER)");
const DB={prepare(q){const st=d1.prepare(q);let a=[];const o={bind(...v){a=v;return o;},async first(){return st.get(...a)||null;},async all(){return{results:st.all(...a)};},async run(){return{meta:{changes:Number(st.run(...a).changes)}};}};return o;}};
const sql={exec(q,...a){const st=db.prepare(q);if(st.columns().length){const rows=st.all(...a);return{toArray:()=>rows,one:()=>{assert.equal(rows.length,1);return rows[0];}};}const r=st.run(...a);return{toArray:()=>[],rowsWritten:Number(r.changes)};}};
db.exec("CREATE TABLE files(id TEXT PRIMARY KEY,at INTEGER,name TEXT,mime TEXT,bytes INTEGER,r2key TEXT,view_key TEXT,source TEXT,session TEXT,turn TEXT,synced INTEGER DEFAULT 0,deleted INTEGER DEFAULT 0,pending INTEGER DEFAULT 0,src_path TEXT,tags TEXT,version INTEGER DEFAULT 1,prev_key TEXT,prev_bytes INTEGER);CREATE TABLE helpers(id INTEGER PRIMARY KEY,session TEXT,dynamic_routing INTEGER,round INTEGER,status TEXT);CREATE TABLE card_events(card TEXT,type TEXT,tool TEXT)");
const objects=new Map(),read=async b=>typeof b==='string'?new TextEncoder().encode(b):b instanceof Uint8Array?b:new Uint8Array(await new Response(b).arrayBuffer());
const WS={async put(k,b){const bytes=await read(b);objects.set(k,bytes);return{size:bytes.length};},async get(k){const bytes=objects.get(k);return bytes?{size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer,text:async()=>new TextDecoder().decode(bytes),body:new Response(bytes).body}:null;},async head(k){return objects.has(k)?{size:objects.get(k).length}:null;},async delete(ks){for(const k of [].concat(ks))objects.delete(k);}};
let channel='main',sidecars=0;const emitted=[],reserves=[],settled=[];
const R={sql,env:{DB,WS,MODEL_SETTINGS:seedSettings(),COMPUTER:{idFromName:n=>n,get:()=>({prepJob:async({op,pages})=>({pages:pages.map(page=>({page,md:'OCR page '+page})),ms:1000})})}},get(k){return{tenant:'test-tenant',channel}[k];},ledger(){return{reserve:async(id,n)=>{reserves.push(id);return{ok:true};},settle:async(id,n)=>{settled.push([id,n]);}};},ctx:{waitUntil(){}},sidecarKick(){sidecars++;},async republishPages(){return'';},...fileVersionsMethods};
for(const method of ['libFile','fileView','fileUpdated','uniqueName'])R[method]=Resident.prototype[method];R.fvInit();initRoutingArtifacts(sql);
const h={id:7,session:"task-d",round:1,status:"awaiting_review",dynamic_routing:1};sql.exec("INSERT INTO helpers VALUES(?,?,?,?,?)",7,h.session,1,1,h.status);
const tc={session:h.session,turn:'review-a',routingReviewHelper:7,emit:e=>emitted.push(e)};
// A deck folder in a background helper's work folder: the .html, .pdf, .pptx and make_deck.json written by the last make_deck run.
const dir='/workspace/workspace/helpers/7/ai-report',enc=s=>new TextEncoder().encode(s);
const html=await stageRoutingFile(R,h,{path:`${dir}/ai-report.html`,bytes:enc('<html>')});
const pdf=await stageRoutingFile(R,h,{path:`${dir}/ai-report.pdf`,bytes:enc('%PDF')});
const pptx=await stageRoutingFile(R,h,{path:`${dir}/ai-report.pptx`,bytes:enc('PK')});
const stale=await stageRoutingFile(R,h,{path:`${dir}/old.pdf`,bytes:enc('%PDF old')});
await stageRoutingFile(R,h,{path:`${dir}/.src/make_deck.json`,bytes:enc(JSON.stringify({ok:true,out:`${dir}/ai-report.html ${dir}/ai-report.pdf ${dir}/ai-report.pptx`}))});
const handoff=await collectRoutingFiles(R,h,tc);assert.match(handoff.preview,/Deck: .*ai-report\.html.*one deck/);
// The main helper names only the .pptx and the .pdf, as it did in the live run.
const done=await approveRoutingFiles(R,h,[pptx.id,pdf.id],tc);
assert.deepEqual(done.attached.map(f=>f.name).sort(),['ai-report.html','ai-report.pdf','ai-report.pptx']);
assert.deepEqual(done.added,['ai-report.html']);assert.match(done.notice,/other files were attached with it/);
assert.ok(done.deleted.includes('old.pdf'),'a file that is not part of the deck is still dropped when not named');
console.log('PASS deck files travel together');
