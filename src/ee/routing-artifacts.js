// A held Library snapshot has an opaque file ID and counted tenant storage, but
// no visible files row, download URL, conversation attachment or memory write.
// Approval uses the ordinary Library version resolver. No semantic index is made.
import { MAX_UPLOAD, MAX_VIEW, safeName, mimeOf, humanBytes, viewJpeg } from '../files.js';
import { stPut, stDelete } from '../storage.js';
import { identicalLibraryFile, adoptName, machineName } from '../library-dedupe.js';
import { prepText, untrustedFile } from '../sidecar.js';
import { kindOf, sectionsOf } from '../sidecar-convert.js';

const parse = (value, fallback = null) => { try { return value == null ? fallback : JSON.parse(value) ?? fallback; } catch { return fallback; } };
const quote = value => `'${String(value).replace(/'/g, "'\\''")}'`;
const scope = (R, h) => {
  if (!h?.dynamic_routing || !Number.isSafeInteger(Number(h.id)) || Number(h.id) < 1 || !h.session) throw new Error('A routed sub-agent is required.');
  return { helper: Number(h.id), round: Number(h.round) || 1, session: String(h.session), channel: String(R.get('channel') || ''), tenant: String(R.get('tenant') || '') };
};
const folder = h => `/workspace/workspace/helpers/${Number(h.id)}/`;
const allRows = (R, h) => { const s=scope(R,h);return R.sql.exec("SELECT * FROM routing_artifacts WHERE helper_id=? AND round=? AND session=? AND channel=? ORDER BY at,id",s.helper,s.round,s.session,s.channel).toArray(); };
const view = f => ({ id:f.id,name:f.name,mime:f.mime,bytes:Number(f.bytes)||0,path:f.path,held:f.state!=='attached',...(f.published_id?{library_id:f.published_id}:{}) });
export function initRoutingArtifacts(sql) {
  sql.exec("CREATE TABLE IF NOT EXISTS routing_artifacts (id TEXT PRIMARY KEY,helper_id INTEGER NOT NULL,round INTEGER NOT NULL,session TEXT NOT NULL,channel TEXT NOT NULL,path TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,bytes INTEGER NOT NULL DEFAULT 0,r2key TEXT,state TEXT NOT NULL DEFAULT 'staging',captured INTEGER NOT NULL DEFAULT 0,preview_key TEXT,retired_keys TEXT,published_id TEXT,target_id TEXT,copy_new INTEGER NOT NULL DEFAULT 0,at INTEGER NOT NULL,UNIQUE(helper_id,round,path))");
  try{sql.exec("ALTER TABLE routing_artifacts ADD COLUMN copy_new INTEGER NOT NULL DEFAULT 0");}catch{}
  sql.exec("CREATE TABLE IF NOT EXISTS routing_artifact_steps (file_id TEXT NOT NULL,step TEXT NOT NULL,value TEXT,PRIMARY KEY(file_id,step))");
  sql.exec("CREATE TABLE IF NOT EXISTS routing_artifact_rounds (helper_id INTEGER NOT NULL,round INTEGER NOT NULL,session TEXT NOT NULL,channel TEXT NOT NULL,manifest TEXT,state TEXT NOT NULL,PRIMARY KEY(helper_id,round))");
}
// Deletion inventory uses the same storage counter as ordinary Library files.
export function routingArtifactKeys(sql,session=null) {
  if(!sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='routing_artifacts'").toArray().length)return[];
  const rows=sql.exec('SELECT * FROM routing_artifacts'+(session==null?'':' WHERE session=?'),...(session==null?[]:[String(session)])).toArray();
  return [...new Map(rows.flatMap(f=>[...(f.state!=='attached'&&f.r2key?[{key:f.r2key,size:f.state==='held'?Number(f.bytes)||0:null}]:[]),...(f.preview_key?[{key:f.preview_key,size:null}]:[]),...parse(f.retired_keys,[]).map(k=>typeof k==='string'?{key:k,size:null}:k)]).map(item=>[item.key,item])).values()];
}
export function dropRoutingArtifacts(sql,session=null) {
  if(!sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='routing_artifacts'").toArray().length)return;
  const args=session==null?[]:[String(session)],where=session==null?'':' WHERE session=?';
  sql.exec('DELETE FROM routing_artifact_steps WHERE file_id IN (SELECT id FROM routing_artifacts'+where+')',...args);
  sql.exec('DELETE FROM routing_artifacts'+where,...args);
  sql.exec('DELETE FROM routing_artifact_rounds'+where,...args);
}
function normalizedPath(R,h,path) {
  let p=String(path||'');if(!p.startsWith('/'))p='/workspace/'+p.replace(/^\.\//,'');
  if((!p.startsWith(folder(h))&&!(p.startsWith('/workspace/files/')&&R.libFile?.(p)))||p.split('/').some(x=>x==='..'||x==='.')||/[\u0000-\u001f\u007f]/.test(p))throw new Error('Sub-agent files must be inside its own working folder or an existing Library copy in this channel.');
  return p;
}
async function cleanupRetired(R,f) {
  const keys=parse(f.retired_keys,[]);if(!keys.length)return;
  await stDelete(R.env,keys);R.sql.exec('UPDATE routing_artifacts SET retired_keys=NULL WHERE id=?',f.id);
}
export async function stageRoutingFile(R,h,{path,name,mime,bytes,r2key,captured=false,replace=null,copy=false}={}) {
  initRoutingArtifacts(R.sql);const s=scope(R,h);
  const isBytes=bytes instanceof Uint8Array||bytes instanceof ArrayBuffer;
  const sourcePath=path?normalizedPath(R,h,path):`${folder(h)}.app-output/${safeName(name||'file')}`;
  const fileName=safeName(name||sourcePath.split('/').pop()),type=mimeOf(fileName,mime);
  let row=R.sql.exec('SELECT * FROM routing_artifacts WHERE helper_id=? AND round=? AND path=? AND session=? AND channel=?',s.helper,s.round,sourcePath,s.session,s.channel).toArray()[0];
  if(row?.state==='attached'||row?.state==='deleted')throw new Error('This file version is already closed.');
  if(row?.captured&&captured){await cleanupRetired(R,row);return view(row);}
  const id=row?.id||crypto.randomUUID(),key=`t/${s.tenant}/files/${s.channel}/routing/${s.helper}/${s.round}/${id}/${crypto.randomUUID()}`;
  // Save the destination before copying. A stopped copy remains discoverable.
  if(!row)R.sql.exec('INSERT INTO routing_artifacts(id,helper_id,round,session,channel,path,name,mime,state,at) VALUES(?,?,?,?,?,?,?,?,?,?)',id,s.helper,s.round,s.session,s.channel,sourcePath,fileName,type,'staging',Date.now());
  const oldKeys=[...(parse(row?.retired_keys,[])),...(row?.r2key?[{key:row.r2key,size:row.state==='held'?Number(row.bytes)||0:null}]:[]),...(row?.preview_key?[row.preview_key]:[])];
  R.sql.exec('UPDATE routing_artifacts SET retired_keys=?,r2key=?,state=? WHERE id=?',JSON.stringify(oldKeys),key,'staging',id);
  let size;
  try {
    if(isBytes){const body=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);if(body.byteLength>MAX_UPLOAD)throw new Error('The file exceeds the Library file size limit.');size=body.byteLength;await stPut(R.env,key,body,{httpMetadata:{contentType:type}},{check:true,size});}
    else if(r2key){if(!String(r2key).startsWith(`t/${s.tenant}/files/${s.channel}/`))throw new Error('The source file is outside this channel.');const object=await R.env.WS.get(r2key);if(!object)throw new Error('The source file is missing.');size=Number(object.size);if(size>MAX_UPLOAD)throw new Error('The file exceeds the Library file size limit.');await stPut(R.env,key,object.body,{httpMetadata:{contentType:type}},{check:true,size});}
    else {const result=await R.computer().fileToR2(sourcePath.replace(/^\/workspace\//,''),key,MAX_UPLOAD);if(!result?.ok)throw new Error(result?.error||'The file could not be copied.');size=Number(result.bytes)||0;}
    const target=copy?null:replace?R.libFile?.(replace):sourcePath.startsWith('/workspace/files/')?R.libFile?.(sourcePath):null;if(replace&&!copy&&!target)throw new Error('The Library file to replace was not found in this channel.');
    R.sql.exec('UPDATE routing_artifacts SET name=?,mime=?,bytes=?,state=?,captured=?,preview_key=NULL,target_id=?,copy_new=? WHERE id=?',fileName,type,size,'held',captured?1:0,target?.id||row?.target_id||null,(copy||row?.copy_new)?1:0,id);
    R.sql.exec('DELETE FROM routing_artifact_steps WHERE file_id=?',id);
    row=R.sql.exec('SELECT * FROM routing_artifacts WHERE id=?',id).toArray()[0];await cleanupRetired(R,row);return view(row);
  }catch(error){throw new Error(`Could not hold "${fileName}" for review: ${String(error.message||error)}`);}
}
async function scanFiles(R,h) {
  const s=scope(R,h),saved=R.sql.exec('SELECT * FROM routing_artifact_rounds WHERE helper_id=? AND round=?',s.helper,s.round).toArray()[0];
  if(saved?.manifest)return parse(saved.manifest,[]);
  // Scan only when a recorded computer step could have produced a file.
  const used=h.card?R.sql.exec("SELECT 1 FROM card_events WHERE card=? AND type='step' AND (tool IN ('run_command','write_file','edit_file','share_file') OR tool LIKE 'browser_%') LIMIT 1",h.card).toArray().length:0;
  let manifest=[];
  if(used){
    const manifestPath=`/workspace/.routing-manifests/${s.helper}-${s.round}.json`;
    const library=R.sql.exec('SELECT f.* FROM files f JOIN file_uses u ON u.file_id=f.id WHERE u.session=? AND u.at>=? AND f.deleted=0 AND f.pending=0',s.session,Number(h.started)||0).toArray();
    const program=`import os,json,stat,hashlib\nroot=${JSON.stringify(folder(h))}\nout=[]\nfor parent,dirs,files in os.walk(root,followlinks=False):\n dirs[:]=sorted(d for d in dirs if not os.path.islink(os.path.join(parent,d)))\n for name in sorted(files):\n  path=os.path.join(parent,name)\n  st=os.lstat(path)\n  if stat.S_ISREG(st.st_mode): out.append({'path':path,'bytes':st.st_size})\nlibrary=json.loads(${JSON.stringify(JSON.stringify(library.map(f=>({id:f.id,path:'/workspace/files/'+f.name}))))})\nfor item in library:\n path=item['path']\n if os.path.isfile(path) and not os.path.islink(path):\n  with open(path,'rb') as f: digest=hashlib.file_digest(f,'sha256').hexdigest()\n  out.append({'path':path,'library_id':item['id'],'sha256':digest,'bytes':os.stat(path).st_size})\nos.makedirs('/workspace/.routing-manifests',exist_ok=True)\nwith open(${JSON.stringify(manifestPath)},'w') as f: json.dump(out,f)\n`;
    const result=await R.computer().exec(`python3 -c ${quote(program)}`,{save:'none',timeoutMs:20000});if(result?.code!==0)throw new Error('The sub-agent file list could not be read. Its file handoff is incomplete.');
    const read=await R.computer().readFile(manifestPath.replace(/^\/workspace\//,''),MAX_UPLOAD);if(!read?.ok)throw new Error('The complete sub-agent file list could not be read.');
    manifest=JSON.parse(new TextDecoder().decode(read.bytes));if(!Array.isArray(manifest))throw new Error('The sub-agent file list is invalid.');
    const different=[];for(const item of manifest){if(item.library_id){const original=library.find(f=>f.id===item.library_id),object=original&&await R.env.WS.get(original.r2key);if(object){const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await object.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');if(digest===item.sha256)continue;}}different.push(item);}manifest=different;
  }
  R.sql.exec('INSERT INTO routing_artifact_rounds(helper_id,round,session,channel,manifest,state) VALUES(?,?,?,?,?,?) ON CONFLICT(helper_id,round) DO UPDATE SET manifest=excluded.manifest',s.helper,s.round,s.session,s.channel,JSON.stringify(manifest),'collecting');return manifest;
}
// A deck is one set of files. The last successful make_deck run lists them in <deck folder>/.src/make_deck.json ("out"), and the
// folder holds every format the person asked for. Approval attaches all of them, so the .html never stays behind when only the
// .pptx or .pdf is named. Returns the ids of the held files that belong to a deck.
export async function deckOutputIds(R,rows) {
  const ids=new Set();
  for(const m of rows.filter(f=>['held','publishing','attached'].includes(f.state)&&f.r2key&&/\/\.src\/make_deck\.json$/.test(f.path))) {
    let made;try{made=JSON.parse(await (await R.env.WS.get(m.r2key))?.text());}catch{continue;}
    if(!made?.ok||typeof made.out!=='string')continue;
    const dir=m.path.slice(0,-'/.src/make_deck.json'.length);
    for(const path of made.out.split(' ')){
      if(!path.startsWith(dir+'/')||path.slice(dir.length+1).includes('/')||!/\.(html|pdf|pptx)$/i.test(path))continue;
      const f=rows.find(x=>x.path===path&&['held','publishing','attached'].includes(x.state));if(f)ids.add(f.id);
    }
  }
  return ids;
}
function preparation(R,h,f,tc) {
  const s=scope(R,h),get=key=>R.sql.exec('SELECT value FROM routing_artifact_steps WHERE file_id=? AND step=?',f.id,key).toArray()[0]?.value??null;
  const put=(key,value)=>R.sql.exec('INSERT INTO routing_artifact_steps(file_id,step,value) VALUES(?,?,?) ON CONFLICT(file_id,step) DO UPDATE SET value=excluded.value',f.id,key,typeof value==='string'?value:JSON.stringify(value));
  return {env:R.env,get,put,res:()=>({async sidecarOcrHint(){return{ok:true};}}),computerJob:()=>R.env.COMPUTER.get(R.env.COMPUTER.idFromName(`prepjob:${s.tenant}`)),async paid(job,step,reserve,fn,{keep=true}={}){
    const cached=get(`step:${step}`);if(cached)return parse(cached);
    const ledger=R.ledger(),rid=`routing-prep:${f.id}:${step}`;R.resOpen?.(rid,reserve,tc);let held;try{held=await ledger.reserve(rid,reserve);}catch(error){R.resClose?.(rid);throw error;}if(!held?.ok){R.resClose?.(rid);return{refused:held?.reason||'out_of_credits'};}
    let result;
    try{result=await fn();}catch(error){const nano=Math.max(0,Math.min(reserve,Math.ceil(error.nano||Number(error.usage?.cost||0)*1e9*1.15)));await ledger.settle(rid,nano);R.resClose?.(rid);if(tc)tc.extraCharge=(tc.extraCharge||0)+nano;throw error;}
    const nano=Math.max(0,Math.min(reserve,Math.ceil(result.nano||0)));await ledger.settle(rid,nano);R.resClose?.(rid);if(tc)tc.extraCharge=(tc.extraCharge||0)+nano;put('cost',String(Number(get('cost')||0)+nano));
    const value={value:result.value,nano};if(keep&&result.keep!==false)put(`step:${step}`,value);return value;
  }};
}
async function preparedDoc(R,h,f,tc,{describeImages=false}={}) {
  if(f.preview_key){const existing=await R.env.WS.get(f.preview_key);if(existing){const doc=parse(await existing.text());if(doc&&(!describeImages||doc.kind!=='image'||doc.md))return doc;}}
  const kind=kindOf(f.name,f.mime);let doc={kind,md:'',notes:[]};
  if(kind==='image'&&!describeImages)return doc;
  try{
    if(kind==='text'||/\.(csv|tsv)$/i.test(f.name)) {const object=await R.env.WS.get(f.r2key);if(!object)throw new Error('The file is missing from storage.');doc.md=new TextDecoder().decode(await object.arrayBuffer()).replace(/\r\n?/g,'\n');}
    else if(kind){const s=scope(R,h),result=await prepText(preparation(R,h,f,tc),{tenant:s.tenant,channel:s.channel,file_id:f.id,r2key:f.r2key,name:f.name,mime:f.mime,bytes:f.bytes});doc={...doc,...result};if(result.status)doc.notes=[...(result.notes||[]),`Conversion ${result.status}: ${result.error||'no text was returned'}.`];}
    else doc.notes=['This file type has no text preview. Only its name, type and size are shown.'];
  }catch(error){doc.notes=[`Conversion failed: ${String(error.message||error)}. The preview is incomplete.`];}
  doc.sections=sectionsOf(doc.md||'');doc.pages=[...(doc.md||'').matchAll(/^\[Page (\d+)\]\s*$/gm)].map(m=>({page:Number(m[1]),start:m.index}));
  const key=`${f.r2key}.routing-preview.json`,body=JSON.stringify(doc);await stPut(R.env,key,body,{httpMetadata:{contentType:'application/json'}},{check:true,size:new TextEncoder().encode(body).byteLength,replace:true});
  R.sql.exec('UPDATE routing_artifacts SET preview_key=? WHERE id=?',key,f.id);return doc;
}
const lineView=(f,doc,start=1,count=200,offset=0)=>{
  const lines=String(doc.md||'').split('\n'),from=Math.max(1,Number(start)||1),n=Math.max(1,Math.min(1000,Number(count)||200)),end=Math.min(lines.length,from+n-1),block=lines.slice(from-1,end).join('\n'),pos=Math.max(0,Number(offset)||0),body=block.slice(pos,pos+30000);
  const more=pos+body.length<block.length?` Only characters ${pos+1} to ${pos+body.length} of ${block.length} in this range are shown. read_lines ${JSON.stringify({file:f.id,start:from,count:n,offset:pos+body.length})} reads the next characters.`:end<lines.length?` read_lines ${JSON.stringify({file:f.id,start:end+1,count:200})} reads the next lines.`:'';
  const pageCount=doc.pages?.at(-1)?.page,pageNote=pageCount?` The prepared document contains ${pageCount} pages. read_pages ${JSON.stringify({file:f.id,start:1,end:pageCount})} selects document pages.`:['doc','deck'].includes(doc.kind)?' The converter did not supply a page count; line counts refer to its prepared text.':'';
  return `${f.name} (file ${f.id}). Lines ${from} to ${end} of ${lines.length}.${pageNote}${more}${doc.notes?.length?' Conversion notes: '+doc.notes.join(' '):''}\n${untrustedFile(f.name,body)}`;
};
async function imagePart(R,f){const object=await R.env.WS.get(f.r2key);if(!object)return null;let bytes=new Uint8Array(await object.arrayBuffer()),mime=f.mime;if(bytes.byteLength>MAX_VIEW||!/^image\/(png|jpeg|gif|webp)$/.test(mime)){const small=await viewJpeg(R.env,bytes).catch(()=>null);if(!small)return null;bytes=small;mime='image/jpeg';}let bin='';for(let i=0;i<bytes.length;i+=0x8000)bin+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return{type:'image_url',image_url:{url:`data:${mime};base64,${btoa(bin)}`}};}
export async function collectRoutingFiles(R,h,tc={}) {
  initRoutingArtifacts(R.sql);const s=scope(R,h),manifest=await scanFiles(R,h),notices=[];
  for(const item of manifest){try{await stageRoutingFile(R,h,{path:item.path,captured:true});}catch(error){notices.push(String(error.message||error));}}
  const files=[],manifestLines=[],previews=[],imageParts=[],profile=parse(h.primary_profile_json,{});
  // Provisional guard based on the Primary context, leaving room for prompt/logs.
  const contextChars=Math.max(0,(Number(profile.contextLength)||128000)-(Number(profile.maxOutput)||16000))*4;
  const previewBudget=Math.max(16000,Math.min(60000,Math.floor(contextChars*0.12)));let usedPreview=0;
  for(const f of allRows(R,h).filter(f=>f.state==='held')){
    files.push(view(f));const kind=kindOf(f.name,f.mime);
    manifestLines.push(`File ${f.id}: "${f.name}", ${f.mime}, ${humanBytes(f.bytes)}, source ${f.path}. Held in the Library for review; hidden from the person.`);
    const readCall=`file_text ${JSON.stringify({file:f.id})}`;
    if(kind==='image'){
      if(imageParts.length>=4||usedPreview+12000>previewBudget){previews.push(`Image preview omitted for "${f.name}" because the provisional review budget was reached. ${readCall} requests its text description.`);continue;}
      const image=await imagePart(R,f);if(image){imageParts.push(image);usedPreview+=12000;previews.push(`The original image "${f.name}" follows. If the API rejects it, the system retries with the saved vision job's description.`);continue;}
    }
    if(usedPreview>=previewBudget){previews.push(`Text preview omitted for "${f.name}" because the provisional review budget was reached. ${readCall} reads it; read_lines ${JSON.stringify({file:f.id,start:1,count:200})} reads a specific range.`);continue;}
    const doc=await preparedDoc(R,h,f,tc,{describeImages:kind==='image'}),preview=lineView(f,doc);
    if(usedPreview+preview.length>previewBudget){previews.push(`Text preview omitted for "${f.name}" because its ${preview.length} characters exceed the remaining provisional review budget. ${readCall} reads it; read_lines ${JSON.stringify({file:f.id,start:1,count:200})} reads a specific range.`);continue;}
    previews.push(preview);usedPreview+=preview.length;
  }
  const deckIds=await deckOutputIds(R,allRows(R,h));
  if(deckIds.size)manifestLines.push(`Deck: ${files.filter(f=>deckIds.has(f.id)).map(f=>JSON.stringify(f.name)).join(', ')} are one deck from the last make_deck run. Approving any file of the round attaches all of them, so the person always gets the .html together with any .pptx or .pdf.`);
  if(notices.length)previews.push('INCOMPLETE FILE HANDOFF. '+notices.join('\n'));
  R.sql.exec('UPDATE routing_artifact_rounds SET state=? WHERE helper_id=? AND round=?',notices.length?'incomplete':'collected',s.helper,s.round);
  return {files,preview:`All ${files.length} held files are listed below. Automatic text previews have a provisional ${previewBudget}-character budget; at most four images are attached. Omitted content is named with the exact read tool call.\n\n${manifestLines.join('\n')}\n\n${previews.join('\n\n')}`,imageParts,incomplete:notices.length>0};
}
export const isRoutingImageError=error=>[400,415,422].includes(Number(error?.status||error?.response?.status||String(error?.message||'').match(/\b(400|415|422)\b/)?.[1]))&&/image|vision|multimodal|image_url|unsupported.*(?:content|media)/i.test(String(error?.message||error?.body||''));
export async function routingImageFallback(R,h,tc={}){const parts=[];for(const f of allRows(R,h).filter(f=>f.state==='held'&&kindOf(f.name,f.mime)==='image'))parts.push(lineView(f,await preparedDoc(R,h,f,tc,{describeImages:true})));return{preview:'The Primary API rejected image input. The following are descriptions from the saved vision model, rather than the original images.\n\n'+parts.join('\n\n'),imageParts:[]};}
async function deleteHeld(R,f){if(f.state==='attached'||f.state==='deleted')return;R.sql.exec("UPDATE routing_artifacts SET state='deleting' WHERE id=?",f.id);await stDelete(R.env,[...(f.r2key?[{key:f.r2key,size:f.state==='held'?Number(f.bytes)||0:null}]:[]),f.preview_key,...parse(f.retired_keys,[])]);R.sql.exec("UPDATE routing_artifacts SET state='deleted',retired_keys=NULL WHERE id=?",f.id);R.sql.exec('DELETE FROM routing_artifact_steps WHERE file_id=?',f.id);}
export async function discardRoutingFiles(R,h){initRoutingArtifacts(R.sql);const removed=[];for(const f of allRows(R,h).filter(f=>f.state!=='attached'&&f.state!=='deleted')){await deleteHeld(R,f);removed.push(f.name);}return removed.length?`Deleted the earlier held files: ${removed.map(n=>JSON.stringify(n)).join(', ')}. They are no longer available for review. Files already attached to the person remain in the Library.`:'No earlier held files needed deletion.';}
function reviewer(R,h,tc){const s=scope(R,h);if(tc?.helper||Number(tc?.routingReviewHelper)!==s.helper||String(tc.session||'')!==s.session||h.status!=='awaiting_review')throw new Error('Only the Primary review turn for this sub-agent can read or approve its held files.');return s;}
const LIVE_STATES=['held','publishing','attached'];
// The held file list a failed approval prints, so the next call can name the right ones: ID, name and path, the person's files before .src internals.
const heldList=rows=>{const live=rows.filter(f=>LIVE_STATES.includes(f.state)),shown=[...live.filter(f=>!/\/\.src\//.test(f.path)),...live.filter(f=>/\/\.src\//.test(f.path))].slice(0,24);return shown.map(f=>`${f.id} "${f.name}" (${f.path})`).join('; ')+(live.length>shown.length?`; and ${live.length-shown.length} more`:'');};
// approve_subagent names files by held file ID, but a model often passes the name or the path it saw in the worker's response. Accept an ID, a unique ID
// prefix, an exact path, a path relative to the worker's folder, or a unique name; anything else is an error that lists the held files with their IDs.
export function resolveSelection(rows,refs) {
  const live=rows.filter(f=>LIVE_STATES.includes(f.state)),out=[];
  for(const raw of refs){
    const ref=String(raw).trim(),lower=ref.toLowerCase(),rel=ref.replace(/^\.?\/+/,'');
    let hit=live.filter(f=>f.id===ref);
    if(!hit.length&&ref.length>=8)hit=live.filter(f=>f.id.startsWith(ref));
    if(!hit.length)hit=live.filter(f=>f.path===ref||f.path===`/workspace/${rel}`);
    if(!hit.length&&rel)hit=live.filter(f=>f.path.endsWith('/'+rel));
    if(!hit.length)hit=live.filter(f=>f.name===ref);
    if(!hit.length)hit=live.filter(f=>f.name.toLowerCase()===lower);
    if(hit.length!==1)throw new Error(`${hit.length?`"${ref}" matches ${hit.length} held files, so say which one by its file ID`:`"${ref}" is not one of this round's held files`}. Call approve_subagent again with files set to the file IDs of the files the person should receive. ${hit.length>1?`Matches: ${hit.map(f=>`${f.id} (${f.path})`).join('; ')}. `:''}Held files: ${heldList(rows)}. If this is a deck, any one of its files attaches the whole deck. Nothing was attached or deleted.`);
    out.push(hit[0].id);
  }
  return out;
}
// A deck's own files are attached with any selected file. When the worker also copied a deck file under a new name and that copy is selected, the
// original is the same bytes, so it is not attached a second time. Returns the ids of the deck files to skip.
async function sameAsSelected(R,rows,wanted,extra) {
  const skip=new Set();
  for(const e of extra){
    const ext=e.name.slice(e.name.lastIndexOf('.'));
    for(const f of rows.filter(x=>wanted.has(x.id)&&x.bytes===e.bytes&&x.name.endsWith(ext)&&x.r2key&&e.r2key)){
      const [a,b]=await Promise.all([R.env.WS.get(f.r2key),R.env.WS.get(e.r2key)]);if(!a||!b)continue;
      const x=new Uint8Array(await a.arrayBuffer()),y=new Uint8Array(await b.arrayBuffer());
      if(x.length===y.length&&x.every((v,i)=>v===y[i])){skip.add(e.id);break;}
    }
  }
  return skip;
}
// A deck's file keeps the readable name when the worker also copied it under one ("2026 AI Impact Report.html" next to "northwind-ai-impact-2026.html")
// and that copy was not the one selected: the copy is deleted as unused, so the person gets the build's file under the copy's name. Returns id -> name.
async function readableTwinNames(R,rows,extra) {
  const names=new Map();
  for(const e of extra){
    if(!machineName(e.name)||!e.r2key)continue;
    const ext=e.name.slice(e.name.lastIndexOf('.')).toLowerCase();
    for(const f of rows.filter(x=>x.id!==e.id&&['held','publishing'].includes(x.state)&&!/\/\.src\//.test(x.path)&&x.bytes===e.bytes&&x.name.toLowerCase().endsWith(ext)&&!machineName(x.name)&&x.r2key)){
      const [a,b]=await Promise.all([R.env.WS.get(f.r2key),R.env.WS.get(e.r2key)]);if(!a||!b)continue;
      const x=new Uint8Array(await a.arrayBuffer()),y=new Uint8Array(await b.arrayBuffer());
      if(x.length===y.length&&x.every((v,i)=>v===y[i])){names.set(e.id,f.name);break;}
    }
  }
  return names;
}
export async function approveRoutingFiles(R,h,fileIds,tc={}) {
  initRoutingArtifacts(R.sql);reviewer(R,h,tc);if(fileIds!==undefined&&(!Array.isArray(fileIds)||fileIds.some(id=>typeof id!=='string')))throw new Error('Attach files by their held Library file IDs.');
  const current=scope(R,h),round=R.sql.exec('SELECT state FROM routing_artifact_rounds WHERE helper_id=? AND round=? AND session=? AND channel=?',current.helper,current.round,current.session,current.channel).toArray()[0];
  if(round?.state!=='collected')throw new Error('The file handoff is incomplete. Request a revision before approving this round.');
  const rows=allRows(R,h);
  // No "files" at all is not the same as an empty list: a round with held files and no deck attaches nothing only when the reviewer says so.
  if(fileIds===undefined){if(!(await deckOutputIds(R,rows)).size&&rows.some(f=>f.state==='held'&&!/\/\.src\//.test(f.path)))throw new Error(`approve_subagent needs "files": the file IDs the person should receive (an empty list attaches nothing and deletes the held files). Held files: ${heldList(rows)}.`);fileIds=[];}
  const wanted=new Set(resolveSelection(rows,fileIds));
  const deckIds=await deckOutputIds(R,rows),extra=rows.filter(f=>deckIds.has(f.id)&&!wanted.has(f.id)),skipped=await sameAsSelected(R,rows,wanted,extra);
  const kept=extra.filter(f=>!skipped.has(f.id)),nice=await readableTwinNames(R,rows,kept),added=kept.map(f=>nice.get(f.id)||f.name);for(const f of extra)if(!skipped.has(f.id))wanted.add(f.id);
  const attached=[],deleted=[];
  for(const f of rows){if(!wanted.has(f.id)){if(f.state!=='attached'&&f.state!=='deleted'){await deleteHeld(R,f);deleted.push(f.name);}continue;}
    if(f.state==='attached'){const visible=R.libFile?.(f.published_id);if(visible)attached.push(R.fileView(visible));continue;}
    const shown=nice.get(f.id)||f.name;
    let target=f.published_id?R.libFile?.(f.published_id):f.copy_new?null:f.target_id?R.libFile?.(f.target_id):R.resolveFile?.({path:f.path.replace(/^\/workspace\//,''),name:shown,session:h.session})?.file;
    const published=target?.id||f.id;R.sql.exec("UPDATE routing_artifacts SET state='publishing',published_id=? WHERE id=?",published,f.id);
    if(target){if(target.r2key!==f.r2key)await R.putVersion(target,{key:f.r2key,bytes:f.bytes,src_path:f.path,synced:0,session:h.session,turn:tc.turn});await R.fileUpdated?.(target,{r2key:f.r2key,bytes:f.bytes,path:f.path},tc,`Approved "${target.name}" as an update to its existing Library file.`);}
    else {
      // The same deck or document may already be in the Library (shared or saved earlier under another name): that file stays the one card.
      const twin=f.copy_new?null:await identicalLibraryFile(R,{key:f.r2key,bytes:f.bytes,name:shown});
      if(twin){const kept=adoptName(R,twin,shown,tc.emit);R.sql.exec("UPDATE routing_artifacts SET state='attached',published_id=? WHERE id=?",kept.id,f.id);const file=R.fileView(kept);attached.push(file);tc.emit?.({t:'file',file});await stDelete(R.env,[{key:f.r2key,size:Number(f.bytes)||0},...(f.preview_key?[f.preview_key]:[])]);R.sql.exec('UPDATE routing_artifacts SET preview_key=NULL WHERE id=?',f.id);continue;}
      R.sql.exec('INSERT OR IGNORE INTO files(id,at,name,mime,bytes,r2key,source,session,turn,synced,src_path) VALUES(?,?,?,?,?,?,?,?,?,?,?)',f.id,Date.now(),f.copy_new?R.uniqueName(f.name):shown,f.mime,f.bytes,f.r2key,'helper',h.session,tc.turn||null,0,f.path);}
    const visible=R.libFile?.(published);if(!visible)throw new Error('The approved Library file could not be registered.');R.sql.exec("UPDATE routing_artifacts SET state='attached' WHERE id=?",f.id);R.sidecarKick?.(visible);const file=R.fileView(visible);attached.push(file);tc.emit?.({t:'file',file});
    if(f.preview_key)await stDelete(R.env,[f.preview_key]);R.sql.exec('UPDATE routing_artifacts SET preview_key=NULL WHERE id=?',f.id);
  }
  return{attached,deleted,added,notice:(added.length?`The deck's other files were attached with it: ${added.map(n=>JSON.stringify(n)).join(', ')}. `:'')+(deleted.length?`Deleted unused held files: ${deleted.map(n=>JSON.stringify(n)).join(', ')}.`:'Every selected file is attached. No unused held files remain.')};
}
export async function routingFileTool(R,name,args={},tc={}) {
  if(!['file_text','read_lines','read_pages','read_sheet','search_file'].includes(name))return null;
  initRoutingArtifacts(R.sql);const ref=String(args.file||''),raw=R.sql.exec('SELECT * FROM routing_artifacts WHERE id=?',ref).toArray()[0];
  const h=tc.routingReviewHelper?R.sql.exec('SELECT * FROM helpers WHERE id=?',Number(tc.routingReviewHelper)).toArray()[0]:null;
  if(!h){return raw?'error: this file is available only to its Primary review turn.':null;}
  try{reviewer(R,h,tc);}catch(error){return 'error: '+error.message;}
  let f=raw,doc;if(f){if(f.helper_id!==Number(h.id)||f.round!==(Number(h.round)||1)||f.session!==tc.session||f.channel!==String(R.get('channel'))||f.state!=='held')return 'error: this held file is not part of the sub-agent round being reviewed.';doc=await preparedDoc(R,h,f,tc,{describeImages:kindOf(f.name,f.mime)==='image'});}
  else {f=R.libFile?.(ref);if(!f)return 'error: no Library file with that ID or name exists in this channel.';if(name==='file_text')return R.fileTextTool(args);const row=R.scRow?.(f.id);doc=await R.sidecarDoc?.(row);if(!doc)return 'error: this Library file has no prepared text yet. Use file_text when preparation finishes.';doc.pages=[...(doc.md||'').matchAll(/^\[Page (\d+)\]\s*$/gm)].map(m=>({page:Number(m[1]),start:m.index}));}
  const excerpt=(text,label,call)=>{const offset=Math.max(0,Number(args.offset)||0),body=text.slice(offset,offset+30000),more=offset+body.length<text.length?` Only characters ${offset+1} to ${offset+body.length} of ${text.length} are shown. ${name} ${JSON.stringify({...call,offset:offset+body.length})} reads the next part.`:'';return `${label}.${more}${doc.notes?.length?' Conversion notes: '+doc.notes.join(' '):''}\n${untrustedFile(f.name,body)}`;};
  if(name==='read_pages'){const pages=doc.pages||[],from=Math.max(1,Number(args.start||args.page)||1),to=Math.max(from,Number(args.end)||from),picked=pages.filter(p=>p.page>=from&&p.page<=to);if(!picked.length)return `error: no page in that range is present in the prepared text. ${doc.notes?.join(' ')||''}`;const start=picked[0].start,end=pages[pages.indexOf(picked.at(-1))+1]?.start??doc.md.length;return excerpt(doc.md.slice(start,end),`Pages ${from} to ${Math.min(to,pages.at(-1)?.page||to)} of ${pages.at(-1)?.page||pages.length}`,{file:f.id,start:from,end:to});}
  if(name==='read_sheet'){const sections=doc.sections||sectionsOf(doc.md),which=String(args.sheet||'1'),section=sections.find((s,i)=>String(i+1)===which||s.t.toLowerCase()===which.toLowerCase());if(!section)return 'error: no matching sheet or section. Available sections: '+sections.map((s,i)=>`${i+1}: ${s.t}`).join(', ');return excerpt(doc.md.slice(section.s,section.e),`Sheet or section ${section.t}, ${sections.length} available`,{file:f.id,sheet:which});}
  if(name==='search_file'||args.query){const query=String(args.query||'').toLowerCase();if(!query)return 'error: enter search text.';const lines=String(doc.md||'').split('\n'),matches=[];for(let i=0;i<lines.length;i++)if(lines[i].toLowerCase().includes(query))matches.push({line:i+1,text:lines[i]});const offset=Math.max(0,Number(args.offset)||0),selected=matches.slice(offset,offset+100);return `${matches.length} matching lines. Showing matches ${offset+1} to ${offset+selected.length}, as excerpts up to 30000 characters. ${selected.length?`read_lines ${JSON.stringify({file:f.id,start:selected[0].line,count:1})} reads a complete matching line and discloses any remaining characters.`:''} ${offset+selected.length<matches.length?`search_file ${JSON.stringify({file:f.id,query:args.query,offset:offset+selected.length})} reads more.`:''}\n`+untrustedFile(f.name,selected.map(m=>`${m.line}: ${m.text}`).join('\n').slice(0,30000));}
  return lineView(f,doc,args.start||1,args.count||200,args.offset||0);
}
const tool=(name,description,properties,required=['file'])=>({type:'function',function:{name,description,parameters:{type:'object',properties:{file:{type:'string',description:'Held Library file ID from the handoff, or a visible Library file ID or name.'},...properties},required}}});
export const ROUTING_FILE_TOOLS=[
  tool('read_lines','Read a range of lines from a Library file. Results disclose every omitted line and character.',{start:{type:'integer'},count:{type:'integer'},offset:{type:'integer',description:'Character offset inside the requested line range, when a long line was cut.'}}),
  tool('read_pages','Read pages from a PDF or document prepared by anydoc and pdf-inspector. Conversion notes disclose unread scanned pages.',{start:{type:'integer'},end:{type:'integer'},offset:{type:'integer'}}),
  tool('read_sheet','Read a spreadsheet sheet or named section from its prepared text.',{sheet:{type:'string'},offset:{type:'integer'}}),
  tool('search_file','Search a Library file by literal words. Read the matching lines with read_lines.',{query:{type:'string'},offset:{type:'integer'}},['file','query'])
];
