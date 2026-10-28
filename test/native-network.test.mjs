// node test/native-network.test.mjs -- control-plane tests, NOT live transport evidence.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { nativeInit, nativeMix, nativeTool, decideSsh, sshPermission, setSshPermission, sshApprovalView, NATIVE_TOOLS, SSH_OPENING_TIMEOUT, nativeSameOrigin, nativeApprovalProgress } from '../src/native-network.js';
import { egressRule } from '../src/egress-policy.js';

const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE tenants (id TEXT PRIMARY KEY); INSERT INTO tenants VALUES (\'t1\'),(\'t2\')');
db.exec(readFileSync(new URL('fixtures/migrations/migrations_048_direct_network.sql', import.meta.url), 'utf8'));
db.exec(readFileSync(new URL('fixtures/migrations/migrations_050_ssh_trusted.sql', import.meta.url), 'utf8'));
const DB = { prepare(q) { const stmt = db.prepare(q); let args = []; const api = { bind(...v) { args = v; return api; }, async first() { return stmt.get(...args); }, async all() { return { results: stmt.all(...args) }; }, async run() { return { meta: stmt.run(...args) }; } }; return api; } };
function resident(channel = 'main', tenant = 't1') {
  const local = new DatabaseSync(':memory:');
  local.exec("CREATE TABLE approvals(id INTEGER PRIMARY KEY AUTOINCREMENT,at INTEGER,host TEXT,method TEXT,path TEXT,bytes INTEGER,keys TEXT,turn TEXT,session TEXT,perm TEXT,what TEXT,status TEXT DEFAULT 'pending',decision TEXT,decided_at INTEGER)");
  local.exec("CREATE TABLE sessions(id TEXT PRIMARY KEY,updated INTEGER); INSERT INTO sessions VALUES ('task-1',0),('task-2',0)");
  const sql = { exec(q, ...args) { const s = local.prepare(q); const rows = /^(SELECT|PRAGMA)|RETURNING/i.test(q) ? s.all(...args) : (s.run(...args), []); return { toArray: () => rows, one: () => rows[0] }; } };
  nativeInit(sql);
  const calls = [], tasks = new Set(['task-1','task-2']);
  const broker = {
    async prepareSsh(d) { calls.push(['prepare', d]); return { address: '203.0.113.5' }; },
    async openSsh(d) { calls.push(['open', d]); return { ok: true, session_id: `ssh-${calls.length}` }; },
    async closeAll(d) { calls.push(['closeAll', d]); return { ok: true }; },
    async closeSsh(d, a) { calls.push(['close', d, a]); return { ok: true }; },
    async cancelTask(d, a) { calls.push(['cancel', d, a]); return { ok: true }; },
    async execSsh(d, a) { calls.push(['exec', d, a]); return { ok: true, stdout: 'hello' }; },
    async sftpSsh(d, a) { calls.push(['sftp', d, a]); return { ok: true }; },
    async status() { return { key: null, sessions: [], tailscale: { state: 'awaiting_user_approval', login_url: 'https://login.tailscale.com/test-secret' } }; },
    async tailscaleConnect() { return { state: 'awaiting_user_approval', login_url: 'https://login.tailscale.com/test-secret' }; },
    async tailscaleStatus() { return { state: 'awaiting_user_approval', login_url: 'https://login.tailscale.com/test-secret' }; },
  };
  class R {}
  nativeMix(R);
  const r = Object.assign(new R(), { sql, calls, broker, tasks, get: k => k === 'tenant' ? tenant : channel, session: s => tasks.has(s), computer: () => ({ nativeGuardStatus: async () => ({ guarded: true }) }),
    bind: async(t,c)=>{r.get=k=>k==='tenant'?t:c;calls.push(['bind',t,c]);}, approvalView: a => ({ id: a.id, status: a.status, ...sshApprovalView(a) }), handoff: (task, note) => calls.push(['handoff', task, note]),
    env: { DB, NATIVE_NETWORK: 'on', NATIVE_TRANSPORT: { idFromName: x => x, get: id => { assert.equal(id, `${tenant}:${channel}`); return broker; } } } });
  return r;
}
const tc = (task = 'task-1', turn = 'turn-1') => ({ turn, session: task, emit() {} });
const args = { host: 'server.example', port: 2222, username: 'demo', route: 'public' };
const ask = async () => db.prepare("INSERT INTO direct_network_permissions (tenant_id,ssh_mode,generation,updated_at) VALUES ('t1','ask',1,1) ON CONFLICT(tenant_id) DO UPDATE SET ssh_mode='ask',ssh_trusted=0,generation=generation+1").run();
const row = (r,id) => r.sql.exec('SELECT * FROM approvals WHERE id=?',id).one();

async function trustedTests() {
 await ask();const r=resident();
 await setSshPermission(r.env,'t1','trusted',async()=>[]);
 assert.equal((await sshPermission(r.env,'t1')).mode,'trusted');
 const generation=(await sshPermission(r.env,'t1')).generation;
 await setSshPermission(r.env,'t1','trusted',async()=>[]);assert.equal((await sshPermission(r.env,'t1')).generation,generation);
 r.broker.openTrustedSsh=async()=>({ok:false,state:'approval_required'});
 const first=await nativeTool(r,'ssh_connect',args,tc());assert.equal(first.state,'awaiting_approval');
 assert.equal(r.approvalView(row(r,first.approval_id)).ssh.remember_allowed,true);
 r.broker.openSsh=async d=>{r.calls.push(['remember-open',d]);return d.fingerprint?{ok:true,session:'remembered',trust_saved:true}:{state:'host_key_confirmation_required',fingerprint:'SHA256:fixture'}};
 const hostkey=await decideSsh(r,row(r,first.approval_id),'trust');assert.equal(hostkey.approval.ssh.remember_requested,true);
 const opened=await decideSsh(r,row(r,hostkey.approval.id),'once');assert.equal(opened.state,'connected');assert.equal(opened.approval.ssh.trust_saved,true);
 assert.ok(r.calls.filter(c=>c[0]==='remember-open').every(c=>c[1].remember));
 const handoffs=r.calls.filter(c=>c[0]==='handoff').length;
 r.broker.openTrustedSsh=async d=>{r.calls.push(['auto-open',d]);return{ok:true,session:'auto-new-task'}};
 const auto=await nativeTool(r,'ssh_connect',{...args,host:'SERVER.EXAMPLE.'},tc('task-2','turn-2'));
 assert.deepEqual(auto,{ok:true,state:'connected',session_id:'auto-new-task',authorization:'trusted_server'});
 assert.equal(r.calls.filter(c=>c[0]==='handoff').length,handoffs,'auto connection returns directly to running tool call');
 assert.equal(r.nativeApprovalHistory('task-2').length,0,'no fabricated human approval receipt for auto connection');
 const sent=r.calls.find(c=>c[0]==='auto-open')[1];assert.equal(sent.host,'server.example');assert.equal(sent.task,'task-2');assert.equal(sent.turn,'turn-2');
 assert.equal((await nativeTool(r,'ssh_session',{session_id:auto.session_id,operation:'exec',command:'true'},tc())).ok,false);
 r.broker.openTrustedSsh=async d=>{await r.nativeCancel(d.task);return{ok:true,session:'late-auto'}};
 assert.match((await nativeTool(r,'ssh_connect',args,tc())).error,/cancelled/);
 assert.ok(r.calls.some(c=>c[0]==='close'&&c[2].session==='late-auto'));
 await ask();const s=resident();const req=await nativeTool(s,'ssh_connect',args,tc());
 assert.match((await decideSsh(s,row(s,req.approval_id),'trust')).error,/Allow trusted servers/);
 assert.equal(row(s,req.approval_id).status,'pending');
 const target={id:'saved',destination:args.host,port:args.port,username:args.username,route:args.route};
 s.broker.trustedServers=async()=>[target];s.broker.revokeTrust=async()=>({ok:true,closed_sessions:[]});
 assert.equal((await s.nativeAct({op:'revoke_trust',trust_id:'saved'})).ok,true);
 assert.equal(row(s,req.approval_id).status,'cancelled');
 assert.equal((await s.nativeAct({op:'revoke_trust',trust_id:'forged'})).ok,false);
}

async function progressTests() {
  await ask();
  const r=resident();r.sql.exec('CREATE TABLE cards(id TEXT PRIMARY KEY,session TEXT,status TEXT,closed INTEGER)');
  let finishOpen,started;const entered=new Promise(resolve=>started=resolve);
  r.broker.openSsh=async d=>{r.calls.push(['open',d]);started();return await new Promise(resolve=>finishOpen=resolve)};
  const req=await nativeTool(r,'ssh_connect',args,tc()),approval=decideSsh(r,row(r,req.approval_id),'once');await entered;
  assert.equal(r.nativeProgress('task-1').phase,'connecting');
  assert.equal(r.nativeApprovalHistory('task-1')[0].status,'consumed');
  assert.equal(r.nativeApprovalHistory('task-1')[0].native_progress,'connecting');
  assert.equal(r.nativeProgress('task-2'),null);
  assert.equal(nativeApprovalProgress(r,row(r,req.approval_id),Date.now()+SSH_OPENING_TIMEOUT+1).phase,'failed');
  r.handoff=()=>{r.sql.exec("INSERT INTO cards VALUES ('real-handoff','task-1','queued',NULL)");return{mode:'steer',card:{id:'real-handoff'}}};
  finishOpen({ok:true,session:'approved-session'});const result=await approval;
  assert.equal(result.approval.native_progress,'resuming');assert.equal(r.nativeProgress('task-1').phase,'resuming');
  // Persisted row + real card suffice after Worker reconstruction; no open replay.
  const persisted=row(r,req.approval_id);assert.equal(nativeApprovalProgress({sql:r.sql},persisted).phase,'resuming');
  r.sql.exec('CREATE TABLE turn_runs(card TEXT,session TEXT,status TEXT)');r.sql.exec("INSERT INTO turn_runs VALUES ('real-handoff','task-1','queued')");
  assert.equal(nativeApprovalProgress({sql:r.sql},persisted,Date.now()+SSH_OPENING_TIMEOUT+1).phase,'resuming','real persisted queued work does not falsely time out');
  r.sql.exec('DELETE FROM turn_runs');assert.equal(nativeApprovalProgress({sql:r.sql},persisted,Date.now()+SSH_OPENING_TIMEOUT+1).phase,'failed','lost continuation remains bounded');
  r.liveTurn=()=>({turn:'real-handoff',finished:false});assert.equal(r.nativeApprovalHistory('task-1')[0].native_progress,'running');assert.equal(r.nativeProgress('task-1'),null);
  r.liveTurn=()=>null;r.sql.exec("UPDATE cards SET status='complete',closed=? WHERE id='real-handoff'",Date.now());
  assert.equal(r.nativeApprovalHistory('task-1')[0].native_progress,'complete');assert.equal(r.nativeProgress('task-1'),null);
  r.sql.exec("UPDATE cards SET status='failed' WHERE id='real-handoff'");assert.equal(r.nativeApprovalHistory('task-1')[0].native_progress,'failed');
  assert.equal(r.calls.filter(c=>c[0]==='open').length,1,'projection/restart never reuses a consumed grant');
  const d=JSON.parse(persisted.ssh_data);delete d.resume_card;assert.equal(nativeApprovalProgress(r,{...persisted,ssh_data:JSON.stringify(d)}).phase,'complete','historical receipt never invents queued work');
  const h=resident();h.broker.openSsh=async()=>({state:'host_key_confirmation_required',fingerprint:'SHA256:test'});
  const first=await nativeTool(h,'ssh_connect',args,tc());const host=await decideSsh(h,row(h,first.approval_id),'once');
  assert.equal(host.approval.status,'pending');assert.equal(h.nativeProgress('task-1'),null,'host key confirmation returns to a real human wait');
}

assert.deepEqual(await sshPermission({ DB }, 't1'), { mode: 'deny', generation: 0 });
for (const origin of [null,'null','https://sibling.1helm.com','https://attacker.example']) assert.equal(nativeSameOrigin(new Request('https://owner.example.com/w/t/api/permissions',{method:'POST',headers:origin?{origin}:{}})),false);
assert.equal(nativeSameOrigin(new Request('https://owner.example.com/w/t/api/permissions',{method:'POST',headers:{origin:'https://owner.example.com'}})),true);
assert.deepEqual(await sshPermission({ DB }, 'existing-account-without-row'), { mode: 'deny', generation: 0 });
assert.equal((await sshPermission({ DB: { prepare() { throw new Error('migration missing'); } } }, 't1')).mode, 'deny');
{
  const r = resident(); r.approvalPolicy = async () => ({ effective: 'always' });
  const out = await nativeTool(r,'ssh_connect',args,tc());
  assert.equal(out.state, 'denied'); assert.equal(r.calls.length,0);
}
await ask();
{
  const r = resident(); const first = await nativeTool(r,'ssh_connect',args,tc());
  assert.equal(first.state,'awaiting_approval'); assert.equal(r.calls.filter(x => x[0] === 'open').length,0);
  const again = await nativeTool(r,'ssh_connect',args,tc()); assert.equal(first.approval_id,again.approval_id);
  for (const bad of ['always','session','channel','confirm']) assert.ok((await decideSsh(r,row(r,first.approval_id),bad)).error);
  const approved = await decideSsh(r,row(r,first.approval_id),'once'); assert.equal(approved.state,'connected');
  assert.ok((await decideSsh(r,row(r,first.approval_id),'once')).error);
  assert.equal(r.calls.filter(x => x[0] === 'open').length,1);
  const sent = r.calls.find(x => x[0] === 'open')[1];
  for (const [k,v] of Object.entries({ tenant:'t1',channel:'main',task:'task-1',turn:'turn-1',host:args.host,port:2222,user:'demo',route:'public',address:'203.0.113.5' })) assert.equal(sent[k],v,k);
  assert.equal((await nativeTool(r,'ssh_session',{ session_id:approved.session_id,operation:'exec',command:'true' },tc('task-2'))).ok,false);
  assert.equal((await nativeTool(r,'ssh_session',{ session_id:approved.session_id,operation:'exec',command:'true' },tc())).ok,true);
  const newReq = await nativeTool(r,'ssh_connect',args,tc()); assert.notEqual(newReq.approval_id,first.approval_id);
  assert.equal(r.calls.filter(x=>x[0]==='open').length,1);
}
for (const mode of ['deny','expired','changed-generation','deleted-task','wrong-tenant','wrong-channel','wrong-turn']) {
  const r = resident(); const req = await nativeTool(r,'ssh_connect',args,tc()); const a = row(r,req.approval_id), d = JSON.parse(a.ssh_data);
  if (mode === 'deny') await decideSsh(r,a,'deny');
  if (mode === 'expired') d.expires = Date.now()-1;
  if (mode === 'changed-generation') d.permissionGeneration++;
  if (mode === 'deleted-task') r.tasks.delete('task-1');
  if (mode === 'wrong-tenant') d.tenant='t2';
  if (mode === 'wrong-channel') d.channel='other';
  if (mode === 'wrong-turn') d.turn='forged';
  r.sql.exec('UPDATE approvals SET ssh_data=? WHERE id=?',JSON.stringify(d),a.id);
  assert.ok((await decideSsh(r,row(r,a.id),'once')).error,mode);
  assert.equal(r.calls.filter(x=>x[0]==='open').length,0,mode);
}
{
  const r = resident(); const req = await nativeTool(r,'ssh_connect',args,tc()); const a=row(r,req.approval_id);
  const results=await Promise.all([decideSsh(r,a,'once'),decideSsh(r,a,'once')]);
  assert.equal(results.filter(x=>x.state==='connected').length,1);
  assert.equal(r.calls.filter(x=>x[0]==='open').length,1,'concurrent approvals consume once');
}
{
  const r = resident(); const req = await nativeTool(r,'ssh_connect',args,tc());
  r.broker.openSsh = async d => { await r.nativeCancel('task-1'); return { ok:true,session_id:'late-session' }; };
  assert.match((await decideSsh(r,row(r,req.approval_id),'once')).error,/cancelled/);
  assert.ok(r.calls.some(x=>x[0]==='close'&&x[2].session==='late-session'));
}
{
  const r = resident(); const req = await nativeTool(r,'ssh_connect',args,tc());
  r.broker.openSsh = async d => d.fingerprint ? { ok:true,session_id:'verified' } : { state:'host_key_confirmation_required',fingerprint:'SHA256:test',changed:true,previous_fingerprint:'SHA256:old' };
  const hostkey=await decideSsh(r,row(r,req.approval_id),'once');
  assert.equal(hostkey.state,'host_key_confirmation_required'); assert.equal(hostkey.approval.perm,'ssh_hostkey');
  assert.match(hostkey.approval.action.note,/WARNING/); assert.equal(hostkey.approval.always,null);
  assert.ok(hostkey.approval.action.lines.every(x => Array.isArray(x) && x.length === 2),'UI card fields are label/value pairs');
  assert.deepEqual(hostkey.approval.action.lines.find(x=>x[0]==='Pinned address'),['Pinned address','203.0.113.5']);
  const approved=await decideSsh(r,row(r,hostkey.approval.id),'once'); assert.equal(approved.session_id,'verified');
}
{
  const r=resident(); const req=await nativeTool(r,'ssh_connect',args,tc());
  // Persisted SQL survives a fresh object; only a human deciding it opens a session.
  const restarted=Object.assign(Object.create(Object.getPrototypeOf(r)),r);
  assert.equal((await decideSsh(restarted,row(restarted,req.approval_id),'once')).state,'connected');
  assert.equal((await r.nativeStatus(false)).tailscale.login_url,undefined);
  assert.equal((await r.nativeStatus(true)).tailscale.login_url,'https://login.tailscale.com/test-secret');
  assert.ok(!JSON.stringify(await nativeTool(r,'native_network',{operation:'tailscale_connect'},tc())).includes('test-secret'));
  r.broker.status=async()=>({private_key:'SHOULD-NOT-LEAK',login_url:'SHOULD-NOT-LEAK',key:{public_key:'ssh-ed25519 public',fingerprint:'SHA256:public',seed:'SHOULD-NOT-LEAK'},tailscale:{state:'connected',raw_state:'SHOULD-NOT-LEAK'},sessions:[]});
  assert.ok(!JSON.stringify(await r.nativeStatus(false)).includes('SHOULD-NOT-LEAK'),'status uses an explicit public projection');
  let checks=0;r.broker.status=async()=>({client:{state:'verified_ready'},tailscale:{state:'offline_reconnecting',verified:false},sessions:[]});
  r.broker.tailscaleStatus=async()=>{checks++;return{state:'connected',device_id:'existing',verified:true,checked_at:12345,private_state:'SHOULD-NOT-LEAK'}};
  const verified=await r.nativeStatus(false);assert.equal(checks,1);assert.equal(verified.tailscale.state,'connected');assert.equal(verified.tailscale.verified,true);assert.equal(verified.tailscale.checked_at,12345);assert.ok(!JSON.stringify(verified).includes('SHOULD-NOT-LEAK'));
}
{
  const r=resident(); const req=await nativeTool(r,'ssh_connect',args,tc());
  r.env.RESIDENT={idFromName:x=>x,get:()=>r};
  const res=await setSshPermission(r.env,'t1','deny',async()=>[{slug:'main'}]); assert.equal(res.ok,true);
  assert.equal(row(r,req.approval_id).status,'cancelled'); assert.ok(r.calls.some(x=>x[0]==='closeAll'));
  assert.equal((await setSshPermission(r.env,'t1','always',async()=>[])).error,'Outbound SSH must be deny, ask or trusted.');
  await setSshPermission(r.env,'t1','ask',async()=>[{slug:'main'}]);
  const generation=(await sshPermission(r.env,'t1')).generation;
  await setSshPermission(r.env,'t1','ask',async()=>[{slug:'main'}]);
  assert.equal((await sshPermission(r.env,'t1')).generation,generation,'Ask to Ask does not invalidate existing grants');
}
assert.ok(NATIVE_TOOLS.every(t => !JSON.stringify(t).includes('confirm_token')));
{
  for (const outcome of ['failed','denied','cancelled','expired']) {
    const r=resident(); await ask(); const req=await nativeTool(r,'ssh_connect',args,tc());
    const before=r.sql.exec('SELECT updated FROM sessions WHERE id=?','task-1').one().updated;
    if(outcome==='failed'){r.broker.openSsh=async()=>({ok:false,error:'Controlled connection refusal'});await decideSsh(r,row(r,req.approval_id),'once');}
    if(outcome==='denied')await decideSsh(r,row(r,req.approval_id),'deny');
    if(outcome==='cancelled')await r.nativeCancel('task-1');
    if(outcome==='expired'){const d=JSON.parse(row(r,req.approval_id).ssh_data);r.sql.exec('UPDATE approvals SET ssh_data=? WHERE id=?',JSON.stringify({...d,expires:Date.now()-1}),req.approval_id);await r.nativeStatus();}
    assert.equal(row(r,req.approval_id).status,outcome);
    assert.ok(r.sql.exec('SELECT updated FROM sessions WHERE id=?','task-1').one().updated>before,`${outcome} must refresh the task card through normal polling`);
    assert.equal(r.calls.filter(x=>x[0]==='handoff').length,0,'status refresh never resumes or reconnects');
  }
}
{
  const r=resident();r.get=()=>null;r.env.RESIDENT={idFromName:x=>x,get:()=>r};
  const result=await setSshPermission(r.env,'t1','deny',async()=>[{id:1,slug:'main'}]);
  assert.equal(result.ok,true,'fresh Archive channel binds before policy invalidation');
  assert.deepEqual(r.calls.slice(0,2),[['bind','t1','main'],['closeAll',{tenant:'t1',channel:'main'}]]);
}
{
  const r=resident(); await ask();
  const req=await nativeTool(r,'ssh_connect',args,tc()); const opened=await decideSsh(r,row(r,req.approval_id),'once');
  r.broker.closeSsh=async()=>({ok:false,error:'controlled close failure'});
  assert.equal((await r.nativeAct({op:'terminate',session_id:opened.session_id})).ok,false);
  assert.equal((await nativeTool(r,'ssh_session',{operation:'close',session_id:opened.session_id},tc())).ok,false);
  assert.equal(r.sql.exec('SELECT status FROM native_sessions WHERE id=?',opened.session_id).one().status,'active','failed close retains retryable session');
  await assert.rejects(r.nativeCancel('task-1'),/termination/);
  r.broker.closeAll=async()=>({ok:false,error:'controlled close failure'});
  r.env.RESIDENT={idFromName:x=>x,get:()=>r};
  const deny=await setSshPermission(r.env,'t1','deny',async()=>[{slug:'main'}]);
  assert.equal(deny.ok,false); assert.deepEqual(deny.pending_channels,['main']);
  assert.equal((await sshPermission(r.env,'t1')).mode,'deny');
  assert.equal(r.sql.exec('SELECT status FROM native_sessions WHERE id=?',opened.session_id).one().status,'active');
}
{
  const r=resident(); await ask(); const req=await nativeTool(r,'ssh_connect',args,tc()); const d=JSON.parse(row(r,req.approval_id).ssh_data);
  r.sql.exec("UPDATE approvals SET status='consumed',decided_at=? WHERE id=?",Date.now(),req.approval_id);
  r.broker.status=async()=>({sessions:[{id:'orphan',requestId:d.requestId,task:d.task,turn:d.turn}],tailscale:{state:'disconnected'}});
  await r.nativeStatus(); assert.equal(row(r,req.approval_id).status,'consumed','status must not race a current opening');
  r.sql.exec('UPDATE approvals SET decided_at=? WHERE id=?',Date.now()-SSH_OPENING_TIMEOUT-1,req.approval_id);
  const close=r.broker.closeSsh;r.broker.closeSsh=async()=>({ok:false,error:'retry needed'});
  assert.equal((await r.nativeStatus()).available,false);
  assert.equal(JSON.parse(row(r,req.approval_id).ssh_data).closure_pending,true);
  r.broker.closeSsh=close;
  const recovered=await r.nativeStatus(); assert.equal(row(r,req.approval_id).status,'failed');
  assert.equal(JSON.parse(row(r,req.approval_id).ssh_data).closure_pending,false,'failed orphan closure retries');
  assert.match(recovered.setup_errors[0].error,/fresh connection/); assert.ok(r.calls.some(x=>x[0]==='close'&&x[2].session==='orphan'));
  assert.equal(r.calls.filter(x=>x[0]==='open').length,0,'orphan recovery never reconnects');
}
{
  const r=resident(); r.broker.status=async()=>({available:false,error:'broker down'});
  assert.equal((await r.nativeStatus()).available,false,'broker unavailability is not overwritten');
  r.broker.status=async()=>({available:true}); r.computer=()=>({nativeGuardStatus:async()=>({guarded:false})});
  assert.equal((await r.nativeStatus()).available,false,'old unrestricted computer is not ready');
}
for (const input of [{method:'CONNECT'}]) {
  assert.equal(egressRule({host:'relay.example',env:{NATIVE_NETWORK:'on'},...input}).rule,'direct-tunnel');
}
assert.equal(egressRule({host:'site.example',method:'GET',env:{NATIVE_NETWORK:'on'}}).verdict,'allow');
assert.equal(egressRule({host:'site.example',method:'GET',headers:{upgrade:'websocket'},env:{NATIVE_NETWORK:'on'}}).verdict,'allow','preserve existing browser WebSocket policy');
// This remaining allowance is documented, not evidence of universal relay prevention.
await progressTests();
await trustedTests();
console.log('Native SSH control plane: defaults, HTTP isolation, exact binding, human-only one-use, concurrency, expiry, cancellation, host verification, restart, durable native approval progress and URL redaction passed. Transport is mocked here.');

async function dedupeTests() {
  const count = r => r.sql.exec("SELECT COUNT(*) n FROM approvals").one().n;
  const expire = (r, id) => { const d = JSON.parse(row(r, id).ssh_data); r.sql.exec('UPDATE approvals SET ssh_data=? WHERE id=?', JSON.stringify({ ...d, expires: Date.now() - 1 }), id); };
  await ask();
  { // pending: same id, no new row, even from another turn of the same task
    const r = resident(), first = await nativeTool(r, 'ssh_connect', args, tc('task-1', 'turn-1'));
    const again = await nativeTool(r, 'ssh_connect', args, tc('task-1', 'turn-2'));
    assert.equal(again.state, 'awaiting_approval'); assert.equal(again.approval_id, first.approval_id); assert.match(again.next, /already waiting on approval 1/);
    assert.equal(count(r), 1);
    // different host and different task get their own cards; other route/port/user too
    assert.notEqual((await nativeTool(r, 'ssh_connect', { ...args, host: 'other.example' }, tc())).approval_id, first.approval_id);
    assert.notEqual((await nativeTool(r, 'ssh_connect', args, tc('task-2', 'turn-3'))).approval_id, first.approval_id);
    assert.notEqual((await nativeTool(r, 'ssh_connect', { ...args, username: 'root' }, tc())).approval_id, first.approval_id);
    assert.notEqual((await nativeTool(r, 'ssh_connect', { ...args, port: 22 }, tc())).approval_id, first.approval_id);
    assert.equal(count(r), 5);
  }
  { // connecting: the same call arrives while the approved request is being opened
    const r = resident(), first = await nativeTool(r, 'ssh_connect', args, tc());
    let during;
    r.broker.openSsh = async d => { during = await nativeTool(r, 'ssh_connect', args, tc()); return { ok: true, session_id: 's1' }; };
    assert.equal((await decideSsh(r, row(r, first.approval_id), 'once')).state, 'connected');
    assert.equal(during.state, 'connecting'); assert.equal(during.approval_id, first.approval_id); assert.equal(count(r), 1);
    // once connected, a new call is a new request
    assert.notEqual((await nativeTool(r, 'ssh_connect', args, tc())).approval_id, first.approval_id);
  }
  { // host key wait: one trust card, and trusting it finishes the original connection with no second connect card
    const r = resident(), first = await nativeTool(r, 'ssh_connect', args, tc());
    r.broker.openSsh = async d => d.fingerprint ? { ok: true, session_id: 'verified' } : { state: 'host_key_confirmation_required', fingerprint: 'SHA256:x' };
    const hk = await decideSsh(r, row(r, first.approval_id), 'once');
    assert.equal(row(r, first.approval_id).status, 'host_key_required');
    const again = await nativeTool(r, 'ssh_connect', args, tc());
    assert.equal(again.state, 'awaiting_host_key'); assert.equal(again.approval_id, hk.approval.id); assert.equal(count(r), 2);
    const done = await decideSsh(r, row(r, hk.approval.id), 'once');
    assert.equal(done.state, 'connected'); assert.equal(done.session_id, 'verified'); assert.equal(count(r), 2, 'no second connect card');
  }
  { // expired, denied and failed requests never block a new card
    const r = resident(), a = await nativeTool(r, 'ssh_connect', args, tc());
    expire(r, a.approval_id);
    const b = await nativeTool(r, 'ssh_connect', args, tc()); assert.notEqual(b.approval_id, a.approval_id);
    await decideSsh(r, row(r, b.approval_id), 'deny');
    const c = await nativeTool(r, 'ssh_connect', args, tc()); assert.notEqual(c.approval_id, b.approval_id);
    r.broker.openSsh = async () => ({ ok: false, error: 'refused' });
    await decideSsh(r, row(r, c.approval_id), 'once'); assert.equal(row(r, c.approval_id).status, 'failed');
    const d = await nativeTool(r, 'ssh_connect', args, tc()); assert.notEqual(d.approval_id, c.approval_id); assert.equal(d.state, 'awaiting_approval');
    // a stuck opening past the timeout no longer blocks
    r.sql.exec("UPDATE approvals SET status='consumed',decided_at=? WHERE id=?", Date.now() - SSH_OPENING_TIMEOUT - 1, d.approval_id);
    assert.notEqual((await nativeTool(r, 'ssh_connect', args, tc())).approval_id, d.approval_id);
  }
}
await dedupeTests();
