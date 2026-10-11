import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import nacl from 'tweetnacl';

// Execute the actual DO methods against SQLite and test-only platform bindings.
// These are control-plane tests, not claimed as live Cloudflare/tailnet evidence.
class DurableObject { constructor(ctx,env){this.ctx=ctx;this.env=env} }
const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
const sealSecret=async(_,s)=>{const iv=crypto.getRandomValues(new Uint8Array(12)),ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(s));return Buffer.from(iv).toString('base64')+'.'+Buffer.from(ct).toString('base64')};
const openSecret=async(_,s)=>{const [iv,ct]=s.split('.').map(s=>Buffer.from(s,'base64'));return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv},key,ct))};
const installSnapshotRpc = () => {};
globalThis.__nativeTestDeps={installSnapshotRpc,DurableObject,WorkerEntrypoint:class{},nacl,sealSecret,openSecret};
let source=await readFile(new URL('../src/native-transport.js',import.meta.url),'utf8');
source=source.replace(/^import .*;\n/gm,'');
const {NativeTransport}=await import('data:text/javascript;base64,'+Buffer.from('const {installSnapshotRpc,DurableObject,WorkerEntrypoint,nacl,sealSecret,openSecret}=globalThis.__nativeTestDeps;\n'+source).toString('base64'));
function setup(){
 const db=new DatabaseSync(':memory:');const state={mode:'deny',generation:0,opens:0,destroyed:0};
 const sql={exec(query,...args){const st=db.prepare(query),rows=st.all(...args);return{toArray:()=>rows,one:()=>rows[0]}}};
 const ctx={id:{toString:()=> 'tenant-a:main'},storage:{sql,setAlarm:async()=>{},deleteAlarm:async()=>{}},container:{running:false,monitor:()=>Promise.resolve(),destroy:async()=>{state.destroyed++;ctx.container.running=false}},waitUntil:()=>{},exports:{}};
 const env={NATIVE_TRANSPORT:{idFromName:s=>({toString:()=>s})},DB:{prepare:()=>({bind:()=>({first:async()=>({ssh_mode:state.mode,ssh_trusted:state.trusted || 0,generation:state.generation})})})},LEDGER:{idFromName:s=>s,get:()=>({grant:async()=>{},reserve:async()=>({ok:true}),settle:async()=>{}})}};
 const b=new NativeTransport(ctx,env),own={tenant:'tenant-a',channel:'main'};b.owner(own);
 b.ensure=async()=>{ctx.container.running=true};b.stop=async()=>{ctx.container.running=false;b.put('sessions',[])};
 b.raw=async(op,q)=>{if(op==='open'){state.opens++;return {ok:true,session:'session-'+state.opens,fingerprint:'SHA256:fixture',expires_at:Date.now()+1800000}}return{ok:true}};
 const prepare={ok:true,host:'host.example',port:2222,user:'root',route:'public',address:'8.8.8.8',resolutionId:'resolve-a',expires:Date.now()+600000};b.put('resolution:resolve-a',prepare);
 const grant={...own,...prepare,task:'task-a',turn:'run-a',requestId:'grant-a',permissionGeneration:1};
 return {b,own,ctx,state,grant,db};
}
async function savedMember(x){x.b.put('tail_state',await x.b.sealed({_machinekey:btoa('existing-machine-key'),_1hc_authenticated_enrollment:btoa('authenticated')}));}
async function remember(x) {
 x.state.mode='ask';x.state.trusted=1;x.state.generation=1;
 const r=await x.b.openSsh({...x.grant,remember:true});assert.equal(r.trust_saved,true);
 return x.b.get('trusted_servers')[0];
}
const fresh = (x,patch={}) => ({...x.grant,requestId:crypto.randomUUID(),...patch});
test('explicit remembered approval survives sleep/restart and auto reconnect is fresh, task-bound and single-use',async()=>{
 const x=setup();const saved=await remember(x);await x.b.stop();
 const restarted=new NativeTransport(x.ctx,x.b.env);x.b.sql=restarted.sql;
 assert.equal((await restarted.trustedServers(x.own))[0].id,saved.id);
 const next=fresh(x,{task:'another-task',turn:'another-run'});
 const rs=await Promise.all([x.b.openTrustedSsh(next),x.b.openTrustedSsh(next)]);
 assert.equal(rs.filter(r=>r.ok).length,1);assert.equal(x.state.opens,2);
 const s=x.b.get('sessions')[0];assert.equal(s.task,'another-task');assert.equal(s.turn,'another-run');
 assert.equal(await x.b.session({...x.own,task:'task-a',turn:'run-a'},s.id),null);
 assert.equal((await x.b.openTrustedSsh(fresh(x))).ok,true);x.db.close();
});
test('one-off approvals and known-host keys never silently become remembered consent',async()=>{
 const x=setup();x.state.mode='ask';x.state.trusted=1;x.state.generation=1;
 await x.b.openSsh(x.grant);assert.deepEqual(x.b.get('trusted_servers',[]),[]);
 assert.equal((await x.b.openTrustedSsh(fresh(x))).state,'approval_required');assert.equal(x.state.opens,1);x.db.close();
});
test('remembered trust exact target blocks every substitution even with a valid fresh resolution',async()=>{
 const x=setup();await remember(x);
 for(const patch of [{host:'other.example'},{address:'1.1.1.1'},{port:22},{user:'other'},{route:'tailnet'},{peerId:'other'},{peerRoute:'10.0.0.0/8'},{tailnetEpoch:99}]) {
  const q=fresh(x,patch);x.b.put('resolution:resolve-a',q);
  assert.equal((await x.b.openTrustedSsh(q)).state,'approval_required',JSON.stringify(patch));
 }
 await assert.rejects(x.b.openTrustedSsh(fresh(x,{tenant:'other'})),/Wrong channel/);
 await assert.rejects(x.b.openTrustedSsh(fresh(x,{channel:'other'})),/Wrong channel/);
 assert.equal(x.state.opens,1);x.db.close();
});
test('Ask suspends remembered authority, Deny blocks it, restore trusted does not alter scope',async()=>{
 const x=setup();await remember(x);x.state.trusted=0;
 assert.equal((await x.b.openTrustedSsh(fresh(x))).ok,false);
 assert.equal((await x.b.openSsh(fresh(x,{remember:true}))).ok,false);
 x.state.mode='deny';x.state.trusted=1;assert.equal((await x.b.openTrustedSsh(fresh(x))).ok,false);
 x.state.mode='ask';assert.equal((await x.b.openTrustedSsh(fresh(x))).ok,true);assert.equal(x.b.get('trusted_servers').length,1);x.db.close();
});
test('changed host key uses remembered fingerprint, never a newer once-approved host cache',async()=>{
 const x=setup();const saved=await remember(x);
 x.b.put('host:'+JSON.stringify([x.grant.route,x.grant.host,x.grant.port]),'SHA256:once-new-key');
 x.b.raw=async(op,q)=>{assert.equal(q.fingerprint,saved.fingerprint);return{state:'host_key_confirmation_required',fingerprint:'SHA256:changed'}};
 const r=await x.b.openTrustedSsh(fresh(x));assert.equal(r.changed,true);assert.equal(r.previous_fingerprint,saved.fingerprint);
 assert.equal(x.b.get('trusted_servers')[0].fingerprint,saved.fingerprint);x.db.close();
});
test('revoke cancels stale trust approval and closes matching legacy/new sessions, preserving other servers',async()=>{
 const x=setup();const saved=await remember(x);const sessions=x.b.get('sessions');delete sessions[0].target;
 sessions.push({...sessions[0],id:'unrelated',destination:'other.example'});x.b.put('sessions',sessions);
 const r=await x.b.revokeTrust(x.own,saved.id);assert.deepEqual(r.closed_sessions,['session-1']);assert.deepEqual(x.b.get('sessions').map(s=>s.id),['unrelated']);
 assert.equal((await x.b.openSsh(fresh(x,{remember:true}))).ok,false,'prepared before revoke cannot restore authority');
 assert.equal((await x.b.openTrustedSsh(fresh(x))).state,'approval_required');assert.deepEqual(x.b.get('trusted_servers'),[]);x.db.close();
});
test('revoke racing cold startup and post-open permission lookup cannot resurrect saved authority or sessions',async()=>{
 for(const stage of ['ensure','permission']){
  const x=setup();const saved=await remember(x);let entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  if(stage==='ensure')x.b.ensure=async()=>{entered();await gate};
  else {const permission=x.b.permission.bind(x.b);let count=0;x.b.permission=async(...args)=>{count++;if(count===3){entered();await gate}return permission(...args)}}
  const pending=x.b.openSsh(fresh(x,{remember:true}));await started;await x.b.revokeTrust(x.own,saved.id);release();
  assert.equal((await pending).ok,false,stage);assert.deepEqual(x.b.get('trusted_servers'),[]);assert.deepEqual(x.b.get('sessions'),[]);x.db.close();
 }
});
test('revoke closure failure stays durable/retryable and late status cannot resurrect a closed session',async()=>{
 const x=setup();const saved=await remember(x);const original=x.b.raw,stop=x.b.stop;
 x.b.raw=async()=>({ok:false});x.b.stop=async()=>{throw new Error('controlled destroy failure')};
 await assert.rejects(x.b.revokeTrust(x.own,saved.id),/destroy failure/);assert.equal((await x.b.trustedServers(x.own))[0].state,'revocation_pending');
 assert.equal((await x.b.openTrustedSsh(fresh(x))).state,'approval_required');x.b.raw=original;x.b.stop=stop;
 await x.b.revokeTrust(x.own,saved.id);assert.deepEqual(await x.b.trustedServers(x.own),[]);
 x.ctx.container.running=true;x.b.raw=async()=>({ok:true,sessions:[{id:'session-1',task:'task-a',turn:'run-a'}],tailscale:{state:'disconnected'}});
 assert.deepEqual((await x.b.status(x.own)).sessions,[]);x.db.close();
});
test('rotation removes trust and explicit tailnet disconnect preserves only public-server trust',async()=>{
 const x=setup();await remember(x);x.b.put('trusted_servers',[...x.b.get('trusted_servers'),{...x.grant,route:'tailnet',id:'tail',fingerprint:'fp'}]);
 await x.b.tailscaleDisconnect(x.own);assert.equal(x.b.get('trusted_servers').length,1);assert.equal(x.b.get('trusted_servers')[0].route,'public');
 await x.b.rotateIdentity(x.own);assert.deepEqual(x.b.get('trusted_servers'),[]);x.db.close();
});
test('status awaiting tail-status encryption cannot resurrect revoked sessions',async()=>{
 const x=setup();const saved=await remember(x);let entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const prior=x.b.get('sessions');x.b.raw=async(op)=>op==='status'?{ok:true,sessions:prior,tailscale:{state:'disconnected'}}:{ok:true};
 x.b.saveTailStatus=async()=>{entered();await gate;return{state:'disconnected'}};
 const status=x.b.status(x.own);await started;await x.b.revokeTrust(x.own,saved.id);release();
 assert.deepEqual((await status).sessions,[]);assert.deepEqual(x.b.get('sessions'),[]);x.db.close();
});
test('new users deny and old absent permission cannot open; global HTTP approval is irrelevant',async()=>{const x=setup();x.b.env.ALWAYS_APPROVE='on';assert.equal((await x.b.openSsh(x.grant)).ok,false);assert.equal(x.state.opens,0);x.db.close()});
test('cold broker is unverified offline, not a false logout of saved enrollment',async()=>{
 const x=setup();x.ctx.container.running=true;x.b.put('tail_enabled',true);x.b.put('broker_tail_epoch',0);x.b.put('tail_status',{state:'connected',device_id:'saved-device'});
 x.b.raw=async()=>({ok:true,sessions:[],tailscale:{state:'disconnected'}});
 const result=await x.b.status(x.own);assert.equal(result.tailscale.state,'offline_reconnecting');assert.equal(result.tailscale.verified,false);assert.ok(result.tailscale.checked_at);
 assert.equal(x.b.get('tail_enabled'),true);assert.equal(x.state.opens,0);
 const verified=await x.b.saveTailStatus({state:'connected',device_id:'actual-device'});assert.equal(verified.verified,true);
 x.ctx.container.running=false;const asleep=await x.b.status(x.own);assert.equal(asleep.tailscale.verified,false);assert.equal(asleep.tailscale.device_id,'actual-device');
 x.b.put('tail_enabled',false);assert.equal((await x.b.status(x.own)).tailscale.state,'disconnected');x.db.close();
});
test('concurrent status refreshes share one existing enrollment verification',async()=>{
 const x=setup();await savedMember(x);x.b.put('tail_enabled',true);let release,started;const waiting=new Promise(r=>release=r),entered=new Promise(r=>started=r);let calls=0;
 x.b.raw=async op=>{assert.equal(op,'tailscale_connect');calls++;started();await waiting;return{state:'connected',device_id:'existing'}};
 const requests=[x.b.tailscaleStatus(x.own),x.b.tailscaleStatus(x.own),x.b.tailscaleStatus(x.own)];
 await entered;assert.equal(calls,1);release();
 const results=await Promise.all(requests);assert.ok(results.every(r=>r.state==='connected'&&r.verified));assert.equal(x.b._tailStatusRefresh,null);x.db.close();
});
test('a delayed status refresh cannot re-enable or contact enrollment after Disconnect',async()=>{
 const x=setup();await savedMember(x);x.b.put('tail_enabled',true);let release,started;const waiting=new Promise(r=>release=r),entered=new Promise(r=>started=r);let calls=0;
 x.b.ensure=async()=>{started();await waiting};x.b.raw=async()=>{calls++;return{state:'connected'}};
 const pending=x.b.tailscaleStatus(x.own);await entered;
 x.b.put('tail_enabled',false);x.b.put('tail_epoch',1);release();
 assert.equal((await pending).state,'disconnected');assert.equal(calls,0);assert.equal(x.b.get('tail_enabled'),false);x.db.close();
});
test('late status response from a disconnected epoch cannot resurrect connected state',async()=>{
 const x=setup();await savedMember(x);x.b.put('tail_enabled',true);let release,started;const waiting=new Promise(r=>release=r),entered=new Promise(r=>started=r);
 x.b.raw=async()=>{started();await waiting;return{state:'connected',device_id:'old'}};
 const pending=x.b.tailscaleStatus(x.own);await entered;x.b.put('tail_enabled',false);x.b.put('tail_epoch',1);release();
 assert.equal((await pending).state,'disconnected');assert.notEqual(x.b.get('tail_status')?.state,'connected');x.db.close();
});
test('failed coalesced refresh clears for bounded retry and cannot expose another owner',async()=>{
 const x=setup();await savedMember(x);x.b.put('tail_enabled',true);x.b.raw=async()=>{throw new Error('fixture status failure')};
 await assert.rejects(x.b.tailscaleStatus(x.own),/fixture/);assert.equal(x.b._tailStatusRefresh,null);
 x.b._tailStatusRefresh={epoch:0,promise:Promise.resolve({state:'connected',device_id:'private'})};
 await assert.rejects(x.b.tailscaleStatus({tenant:'other',channel:'main'}),/Wrong channel/);x.b._tailStatusRefresh=null;
 x.b.raw=async()=>({state:'connected',device_id:'same-enrollment'});assert.equal((await x.b.tailscaleStatus(x.own)).device_id,'same-enrollment');x.db.close();
});
test('status does not create login or keys when enabled enrollment state is absent or incomplete',async()=>{
 for(const state of [null,{}, {_machinekey:btoa('existing')}, {_1hc_authenticated_enrollment:btoa('authenticated')}, {_machinekey:btoa('existing'),_1hc_pending_enrollment:btoa('{}')}, {_machinekey:btoa('existing'),_1hc_pending_enrollment:btoa('corrupt')}]){
  const x=setup();x.b.put('tail_enabled',true);if(state)x.b.put('tail_state',await x.b.sealed(state));
  x.b.ensure=async()=>{throw new Error('must not start')};x.b.raw=async()=>{throw new Error('must not enroll')};
  const result=await x.b.tailscaleStatus(x.own);assert.equal(result.state,'error');assert.equal(result.verified,false);assert.match(result.error,/status did not start a new login/);assert.equal(x.ctx.container.running,false);x.db.close();
 }
});
test('status continues an existing pending login and authenticated sleep/wake identity without replacing state',async()=>{
 for(const registered of [false,true,'pending-approved']){
  const x=setup();x.b.put('tail_enabled',true);
  if(registered===true)await savedMember(x);else x.b.put('tail_state',await x.b.sealed({_machinekey:btoa('existing-machine'),_1hc_pending_enrollment:btoa(JSON.stringify({Persist:{PrivateNodeKey:'existing-node-key'},URL:registered?'':'https://login.tailscale.com/existing-flow',Registered:!!registered}))}));
  const before=x.b.get('tail_state');let calls=0;x.b.raw=async op=>{calls++;assert.equal(op,'tailscale_connect');return{state:registered?'connected':'awaiting_user_approval'}};
  const result=await x.b.tailscaleStatus(x.own);assert.equal(result.state,registered?'connected':'awaiting_user_approval');assert.equal(calls,1);assert.equal(x.b.get('tail_state'),before);x.db.close();
 }
});
test('status rechecks enrollment material after startup before sending login-capable RPC',async()=>{
 const x=setup();await savedMember(x);x.b.put('tail_enabled',true);x.b.ensure=async()=>{x.b.drop('tail_state')};let called=false;
 x.b.raw=async()=>{called=true;return{state:'connected'}};
 assert.equal((await x.b.tailscaleStatus(x.own)).state,'error');assert.equal(called,false);x.db.close();
});
test('dev enrollment diagnostic is redacted, read-only, owner scoped and cannot wake a computer', async()=>{
 const x=setup(); await assert.rejects(x.b.enrollmentDiagnostic(x.own), /Not available/); x.b.env.ENV_NAME='dev';
 const state={_machinekey:btoa('machine-secret'),_daemon:btoa(JSON.stringify({Config:{PrivateNodeKey:'node-secret',NodeID:'',UserProfile:{LoginName:'private@example.com'}}})),_1hc_authenticated_enrollment:btoa('authenticated')};
 x.b.put('tail_state',await x.b.sealed(state)); x.b.put('tail_status',{state:'expired_revoked',login_url:'private-url'});
 const before=x.db.prepare('SELECT * FROM native_kv ORDER BY k').all(); x.b.raw=async()=>{throw new Error('must not query broker')}; x.b.ensure=async()=>{throw new Error('must not wake')};
 const result=await x.b.enrollmentDiagnostic(x.own);
 assert.equal(result.legacy_node_key_present,true); assert.equal(result.legacy_node_id_present,false); assert.equal(result.legacy_login_present,true);
 assert.deepEqual(await x.b.enrollmentDiagnostic({...x.own,channel:'wrong'}),{initialized:false});
 for(const secret of ['machine-secret','node-secret','private@example.com','private-url']) assert.ok(!JSON.stringify(result).includes(secret));
 assert.deepEqual(x.db.prepare('SELECT * FROM native_kv ORDER BY k').all(),before); assert.equal(x.ctx.container.running,false); x.db.close();
});
test('one grant is atomic, owner/destination/user/port/route substitutions reject',async()=>{const x=setup();x.state.mode='ask';x.state.generation=1;for(const patch of [{address:'1.1.1.1'},{host:'other.example'},{user:'other'},{port:22},{route:'tailnet'}])assert.equal((await x.b.openSsh({...x.grant,...patch})).ok,false);await assert.rejects(x.b.openSsh({...x.grant,tenant:'other'}));await assert.rejects(x.b.openSsh({...x.grant,channel:'other'}));const rs=await Promise.all([x.b.openSsh(x.grant),x.b.openSsh(x.grant)]);assert.equal(rs.filter(r=>r.ok).length,1);assert.equal(x.state.opens,1);assert.equal((await x.b.openSsh(x.grant)).ok,false);x.db.close()});
test('Deny or expiry during cold start prevents socket dispatch',async()=>{for(const change of ['deny','expire']){const x=setup();x.state.mode='ask';x.state.generation=1;x.b.ensure=async()=>{if(change==='deny'){x.state.mode='deny';x.state.generation++}else{x.grant.expires=Date.now()-1}};assert.equal((await x.b.openSsh(x.grant)).ok,false);assert.equal(x.state.opens,0);x.db.close()}});
test('task cancellation during cold start prevents dispatch',async()=>{const x=setup();x.state.mode='ask';x.state.generation=1;x.b.ensure=async()=>x.b.cancelTask(x.own,{task:'task-a'});assert.equal((await x.b.openSsh(x.grant)).ok,false);assert.equal(x.state.opens,0);x.db.close()});
test('encrypted key stable and distinct; only public material returned',async()=>{const x=setup(),a=await x.b.identity(x.own),again=await x.b.identity(x.own);assert.deepEqual(a,again);assert.match(a.key.public_key,/^ssh-ed25519 /);const sealed=x.b.get('seed'),seed=await x.b.unseal(sealed);assert.ok(!sealed.includes(seed));assert.ok(!JSON.stringify(a).includes(seed));const y=setup();assert.notEqual((await y.b.identity(y.own)).key.public_key,a.key.public_key);const rotated=await x.b.rotateIdentity(x.own);assert.notEqual(rotated.key.public_key,a.key.public_key);x.db.close();y.db.close()});
test('disconnect epoch rejects delayed callbacks and stale snapshot after wipe',async()=>{const x=setup();x.b.put('tail_enabled',true);const inc=x.b.get('incarnation');assert.equal(await x.b.saveTailState(0,inc,{epoch:0,state:{machine:'c2VjcmV0'}}),true);assert.ok(!x.b.get('tail_state').includes('c2VjcmV0'));await x.b.tailscaleDisconnect(x.own);assert.equal(x.b.get('tail_state'),null);assert.equal(await x.b.saveTailState(0,inc,{epoch:0,state:{machine:'c2VjcmV0'}}),false);await x.b.wipe(x.own);x.b.put('tail_enabled',true);assert.equal(await x.b.saveTailState(0,inc,{epoch:0,state:{machine:'c2VjcmV0'}}),false);assert.ok(x.b.epoch()>0);x.db.close()});
test('close application failure destroys broker before acknowledging',async()=>{const x=setup();x.ctx.container.running=true;let stopped=false;x.b.raw=async()=>({ok:false,error:'fixture'});x.b.stop=async()=>{stopped=true;x.ctx.container.running=false};assert.equal((await x.b.closeAll(x.own)).ok,true);assert.equal(stopped,true);x.db.close()});
test('first-use host-key confirmation creates no session and consumed token cannot reopen',async()=>{const x=setup();x.state.mode='ask';x.state.generation=1;x.b.raw=async()=>({ok:false,state:'host_key_confirmation_required',fingerprint:'SHA256:new'});const r=await x.b.openSsh(x.grant);assert.equal(r.state,'host_key_confirmation_required');assert.deepEqual(x.b.get('sessions',[]),[]);assert.equal((await x.b.openSsh(x.grant)).ok,false);assert.ok(x.b.get('resolution:resolve-a'));x.db.close()});
test('rotation racing delayed configure destroys old signer before replacement is ready',async()=>{
 const x=setup();await x.b.identity(x.own);const old=x.b.get('public_key').public_key;
 let release,entered;const configuring=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 x.ctx.container.interceptOutboundHttp=async()=>{};x.ctx.exports.NativeTransportState=()=>({});x.b.start=async()=>{x.ctx.container.running=true};
 x.b.raw=async(op)=>{if(op==='configure'){entered();await gate}return{ok:true}};
 const boot=NativeTransport.prototype.ensure.call(x.b);await configuring;
 const rotated=x.b.rotateIdentity(x.own);release();await assert.rejects(boot,/identity changed/);await rotated;
 assert.notEqual(x.b.get('public_key').public_key,old);assert.equal(x.ctx.container.running,false);assert.equal(x.b.get('key_epoch'),1);x.db.close();
});
test('concurrent preparation cannot stop another approved connection in progress',async()=>{
 const x=setup();x.state.mode='ask';x.state.generation=1;let release,entered;const opening=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 x.b.raw=async(op)=>{if(op==='open'){entered();await gate;return{ok:true,session:'approved',fingerprint:'fp',expires_at:Date.now()+10000}}return{ok:true,host:'other'}};
 const connection=x.b.openSsh(x.grant);await opening;await x.b.prepareSsh({...x.own,host:'other',route:'public'});
 assert.equal(x.ctx.container.running,true);release();assert.equal((await connection).session,'approved');assert.equal(x.ctx.container.running,true);x.db.close();
});
test('disconnect prevents delayed login status encryption from restoring old approval URL',async()=>{
 const x=setup();x.b.put('tail_enabled',true);let release,entered;const encrypting=new Promise(r=>entered=r),gate=new Promise(r=>release=r),seal=x.b.sealed.bind(x.b);
 x.b.sealed=async v=>{entered();await gate;return seal(v)};const save=x.b.saveTailStatus({state:'awaiting_user_approval',login_url:'https://login.tailscale.com/a/test'},0);await encrypting;
 await x.b.tailscaleDisconnect(x.own);x.b.put('tail_enabled',true);release();await save;assert.equal(x.b.get('login_url'),null);assert.equal(x.b.get('tail_status').state,'disconnected');x.db.close();
});
test('coalesced lifecycle operations validate owner before sharing results',async()=>{
 const x=setup(),wrong={tenant:'tenant-b',channel:'main'};
 x.b._rotation=Promise.resolve({key:{public_key:'must-not-share'}});x.b._disconnecting=Promise.resolve({ok:true});
 for(const method of ['rotateIdentity','wipe','tailscaleDisconnect','tailscaleConnect'])await assert.rejects(x.b[method](wrong),/Wrong channel computer/);
 x.db.close();
});

test('restart after Disconnect tombstone closes surviving tail sessions before exec or SFTP, preserves public',async()=>{
 for(const op of ['execSsh','sftpSsh','status','alarm']) {
  const x=setup(); x.state.mode='ask'; x.state.generation=1; x.ctx.container.running=true;
  const base={task:'task-a',turn:'run-a',permissionGeneration:1,expires_at:Date.now()+60000};
  let live=[{...base,id:'tail',route:'tailnet',tailnetEpoch:0},{...base,id:'public',route:'public'}];
  x.b.put('sessions',live); x.b.put('tail_enabled',false); x.b.put('tail_epoch',1); x.b.put('tail_disconnect_pending',1);
  x.b.put('tail_status',{state:'connected'}); x.b.put('last_activity',Date.now());x.b.put('paid_until',Date.now()+60000);
  const calls=[]; x.b.raw=async(cmd)=>{calls.push(cmd);if(cmd==='tailscale_disconnect'){live=live.filter(s=>s.route!=='tailnet');return{ok:true}}if(cmd==='status')return{ok:true,sessions:live,tailscale:{state:'disconnected'}};return{ok:true}};
  const who={...x.own,task:'task-a',turn:'run-a'};
  if(op==='status') await x.b.status(x.own);
  else if(op==='alarm') await x.b.alarm();
  else assert.equal((await x.b[op](who,{session:'tail',command:'true',op:'stat'})).ok,false);
  assert.equal(calls.filter(c=>c==='tailscale_disconnect').length,1,op);
  assert.ok(!calls.includes('exec')&&!calls.includes('sftp'),op);
  assert.deepEqual(x.b.get('sessions').map(s=>s.id),['public']); assert.equal(x.ctx.container.running,true);
  assert.equal(x.b.get('tail_disconnect_pending'),null); assert.equal(x.b.get('tail_status').state,'disconnected');
  assert.equal((await x.b.execSsh(who,{session:'public',command:'true'})).ok,true); x.db.close();
 }
});
test('pre-marker crash tombstone, marker-before-epoch crash and cleanup failure all fail closed',async()=>{
 for(const kind of ['legacy-gap','marker-first','failed-close']) {
  const x=setup();x.ctx.container.running=true;x.b.put('sessions',[{id:'tail',route:'tailnet',tailnetEpoch:0}]);
  x.b.put('tail_enabled',kind==='marker-first');x.b.put('tail_epoch',kind==='marker-first'?0:1);
  if(kind!=='legacy-gap')x.b.put('tail_disconnect_pending',1);
  let closed=0;x.b.raw=async op=>{if(op==='tailscale_disconnect'){closed++;return{ok:kind!=='failed-close'}}return{ok:true}};
  await x.b.reconcileTailInvalidation(); assert.equal(closed,1);assert.equal(x.b.get('tail_enabled'),false);assert.equal(x.b.epoch(),1);assert.deepEqual(x.b.get('sessions'),[]);
  if(kind==='failed-close')assert.equal(x.ctx.container.running,false);
  x.db.close();
 }
});
test('current tail session works; wrong, absent or concurrently invalidated epoch cannot dispatch',async()=>{
 for(const kind of ['current','stale','missing','permission-race']){
  const x=setup();x.ctx.container.running=true;x.state.mode='ask';x.state.generation=1;x.b.put('tail_enabled',true);x.b.put('tail_epoch',2);
  const s={id:'tail',route:'tailnet',task:'task-a',turn:'run-a',permissionGeneration:1,expires_at:Date.now()+60000,...(kind==='missing'?{}:{tailnetEpoch:kind==='stale'?1:2})};x.b.put('sessions',[s]);
  const calls=[];x.b.raw=async(op,data)=>{calls.push({op,epoch:data?.epoch});return{ok:true}};
  if(kind==='permission-race')x.b.permission=async()=>{x.b.put('tail_enabled',false);x.b.put('tail_epoch',3);return true};
  const r=await x.b.execSsh({...x.own,task:'task-a',turn:'run-a'},{session:'tail',command:'true'});
  assert.equal(r.ok,kind==='current');assert.equal(calls.some(c=>c.op==='exec'),kind==='current');if(kind==='current')assert.equal(calls.find(c=>c.op==='exec').epoch,2);x.db.close();
 }
});
test('Connect awaits tombstone cleanup before it enables any new enrollment',async()=>{
 const x=setup();x.ctx.container.running=true;x.b.put('tail_epoch',1);x.b.put('tail_disconnect_pending',1);x.b.put('tail_enabled',false);
 const calls=[];x.b.raw=async(op)=>{calls.push([op,x.b.get('tail_enabled')]);return op==='tailscale_connect'?{state:'awaiting_user_approval'}:{ok:true}};
 await x.b.tailscaleConnect(x.own);assert.deepEqual(calls,[['tailscale_disconnect',false],['tailscale_connect',true]]);x.db.close();
});
test('unacknowledged close and failed destroy retain tombstone and block tail use and Connect',async()=>{
 const x=setup();x.ctx.container.running=true;x.b.put('tail_epoch',1);x.b.put('tail_disconnect_pending',1);x.b.put('tail_enabled',false);
 x.b.put('sessions',[{id:'tail',route:'tailnet',tailnetEpoch:0,task:'task-a',turn:'run-a',expires_at:Date.now()+60000}]);
 const calls=[];x.b.raw=async op=>{calls.push(op);return{ok:false}};x.b.stop=async()=>{throw new Error('destroy unavailable')};
 await assert.rejects(x.b.execSsh({...x.own,task:'task-a',turn:'run-a'},{session:'tail',command:'true'}),/destroy unavailable/);
 await assert.rejects(x.b.tailscaleConnect(x.own),/destroy unavailable/);
 assert.equal(x.b.get('tail_disconnect_pending'),1);assert.equal(x.b.get('tail_enabled'),false);
 assert.ok(calls.every(c=>c==='tailscale_disconnect'));x.db.close();
});
test('status and alarm close mismatched enrollment sessions even when the current enrollment is enabled',async()=>{
 for(const method of ['status','alarm']){
  const x=setup();x.ctx.container.running=true;x.state.mode='ask';x.state.generation=1;x.b.put('tail_enabled',true);x.b.put('tail_epoch',2);x.b.put('broker_tail_epoch',2);
  x.b.put('last_activity',Date.now());x.b.put('paid_until',Date.now()+60000);
  const live=[{id:'tail',route:'tailnet',tailnetEpoch:1,task:'task-a',turn:'run-a',permissionGeneration:1,expires_at:Date.now()+60000},{id:'public',route:'public',task:'task-a',turn:'run-a',permissionGeneration:1,expires_at:Date.now()+60000}];x.b.put('sessions',live);
  const calls=[];x.b.raw=async(op,a)=>{calls.push([op,a?.session]);return op==='status'?{ok:true,sessions:live,tailscale:{state:'connected'}}:{ok:true}};
  await x.b[method](x.own);assert.ok(calls.some(([op,id])=>op==='close'&&id==='tail'));assert.deepEqual(x.b.get('sessions').map(s=>s.id),['public']);x.db.close();
 }
});
