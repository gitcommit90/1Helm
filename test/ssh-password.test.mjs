// node test/ssh-password.test.mjs -- Worker control-plane tests for SSH password login with a saved key.
// The broker is a local fake. Nothing here connects to a real host.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { nativeInit, nativeMix, nativeTool, decideSsh, setSshPermission, sshApprovalView, NATIVE_TOOLS } from '../src/native-network.js';
import { sealSecret } from '../src/vault-seal.js';

const db = new DatabaseSync(':memory:');
db.exec("CREATE TABLE tenants (id TEXT PRIMARY KEY); INSERT INTO tenants VALUES ('t1'),('t2')");
db.exec(readFileSync(new URL('../db/migrations/0041_direct_network.sql', import.meta.url), 'utf8'));
db.exec(readFileSync(new URL('../db/migrations/0043_ssh_trusted.sql', import.meta.url), 'utf8'));
db.exec('CREATE TABLE vault (tenant_id TEXT NOT NULL, name TEXT NOT NULL, standin TEXT NOT NULL UNIQUE, hosts TEXT NOT NULL, sealed TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (tenant_id, name))');
const DB = { prepare(q) { const stmt = db.prepare(q); let args = []; const api = { bind(...v) { args = v; return api; }, async first() { return stmt.get(...args); }, async all() { return { results: stmt.all(...args) }; }, async run() { return { meta: stmt.run(...args) }; } }; return api; } };
const VAULT_KEY = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const SECRET = 'Correct-Horse-Battery-9!', OTHER_TENANT_SECRET = 'tenant-two-secret-77';
async function saveKey(tenant, name, value) { db.prepare('INSERT OR REPLACE INTO vault (tenant_id,name,standin,hosts,sealed,created_at) VALUES (?,?,?,?,?,1)').run(tenant, name, `standin-${tenant}-${name}`, '[]', await sealSecret({ VAULT_KEY }, value)); }
await saveKey('t1', 'MY_WORK_LAPTOP', SECRET);
await saveKey('t1', 'OTHER_KEY', 'another-secret-value');
await saveKey('t2', 'THEIR_KEY', OTHER_TENANT_SECRET);
function resident(channel = 'main', tenant = 't1') {
  const local = new DatabaseSync(':memory:');
  local.exec("CREATE TABLE approvals(id INTEGER PRIMARY KEY AUTOINCREMENT,at INTEGER,host TEXT,method TEXT,path TEXT,bytes INTEGER,keys TEXT,turn TEXT,session TEXT,perm TEXT,what TEXT,status TEXT DEFAULT 'pending',decision TEXT,decided_at INTEGER)");
  local.exec("CREATE TABLE sessions(id TEXT PRIMARY KEY,updated INTEGER); INSERT INTO sessions VALUES ('task-1',0),('task-2',0)");
  const sql = { exec(q, ...args) { const s = local.prepare(q); const rows = /^(SELECT|PRAGMA)|RETURNING/i.test(q) ? s.all(...args) : (s.run(...args), []); return { toArray: () => rows, one: () => rows[0] }; } };
  nativeInit(sql);
  const calls = [], tasks = new Set(['task-1','task-2']);
  const broker = {
    async prepareSsh(d) { calls.push(['prepare', d]); return { address: '203.0.113.5' }; },
    async openSsh(d, pw) { calls.push(['open', d, pw]); return { ok: true, session_id: `ssh-${calls.length}` }; },
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
    env: { DB, VAULT_KEY, NATIVE_NETWORK: 'on', NATIVE_TRANSPORT: { idFromName: x => x, get: id => { assert.equal(id, `${tenant}:${channel}`); return broker; } } } });
  return r;
}
const tc = (task = 'task-1', turn = 'turn-1') => ({ turn, session: task, emit() {} });
const args = { host: 'server.example', port: 22, username: 'demo', route: 'public' };
const ask = async () => db.prepare("INSERT INTO direct_network_permissions (tenant_id,ssh_mode,generation,updated_at) VALUES ('t1','ask',1,1) ON CONFLICT(tenant_id) DO UPDATE SET ssh_mode='ask',ssh_trusted=0,generation=generation+1").run();
const row = (r, id) => r.sql.exec('SELECT * FROM approvals WHERE id=?', id).one();
const allRows = (r) => JSON.stringify(r.sql.exec('SELECT * FROM approvals').toArray());
await ask();

// The tool description tells the model about password_key and forbids installing keys.
{
  const t = NATIVE_TOOLS.find(x => x.function.name === 'ssh_connect').function;
  assert.ok(t.parameters.properties.password_key);
  assert.match(t.description, /password_key/);
  assert.match(t.description, /Never install keys, edit authorized_keys or change the server's SSH settings/);
  assert.ok(!t.parameters.required.includes('password_key'));
}
// Without password_key nothing changes: no password is passed.
{
  const r = resident(); const req = await nativeTool(r, 'ssh_connect', args, tc());
  assert.equal(req.state, 'awaiting_approval');
  const view = r.approvalView(row(r, req.approval_id));
  assert.equal(view.ssh.password_key, null);
  assert.ok(!view.action.lines.some(l => l[0] === 'Login'));
  assert.equal((await decideSsh(r, row(r, req.approval_id), 'once')).state, 'connected');
  const open = r.calls.find(c => c[0] === 'open'); assert.equal(open[2], '');
  assert.equal(open[1].passwordKey, undefined);
}
// An unknown key, another tenant's key and a bad name give a clear error, add no card and open nothing.
for (const [name, re] of [['NO_SUCH_KEY', /no saved key named NO_SUCH_KEY/], ['THEIR_KEY', /no saved key named THEIR_KEY/], ['my key', /variable name of a saved key/]]) {
  const r = resident(); const out = await nativeTool(r, 'ssh_connect', { ...args, password_key: name }, tc());
  assert.equal(out.ok, false); assert.match(out.error, re);
  assert.equal(r.sql.exec('SELECT * FROM approvals').toArray().length, 0);
  assert.equal(r.calls.filter(c => ['prepare', 'open'].includes(c[0])).length, 0);
  assert.ok(!JSON.stringify(out).includes(OTHER_TENANT_SECRET));
}
// With a saved key: the card names it, the password is opened only at approval and reaches the broker only as its own argument.
{
  const r = resident(); const req = await nativeTool(r, 'ssh_connect', { ...args, password_key: 'MY_WORK_LAPTOP' }, tc());
  assert.equal(req.state, 'awaiting_approval');
  const view = r.approvalView(row(r, req.approval_id));
  assert.equal(view.ssh.password_key, 'MY_WORK_LAPTOP');
  assert.ok(view.action.lines.some(l => l[0] === 'Login' && l[1].includes('MY_WORK_LAPTOP')));
  assert.equal(r.calls.filter(c => c[0] === 'open').length, 0);
  // A second call for the same server with a different key is a separate card.
  const other = await nativeTool(r, 'ssh_connect', { ...args, password_key: 'OTHER_KEY' }, tc());
  assert.notEqual(other.approval_id, req.approval_id);
  // The same key reuses the open request.
  assert.equal((await nativeTool(r, 'ssh_connect', { ...args, password_key: 'MY_WORK_LAPTOP' }, tc())).approval_id, req.approval_id);
  // Prepare never receives a password.
  assert.ok(!JSON.stringify(r.calls.filter(c => c[0] === 'prepare')).includes(SECRET));
  const done = await decideSsh(r, row(r, req.approval_id), 'once');
  assert.equal(done.state, 'connected');
  const open = r.calls.find(c => c[0] === 'open');
  assert.equal(open[2], SECRET); assert.equal(open[1].passwordKey, 'MY_WORK_LAPTOP');
  assert.ok(!JSON.stringify(open[1]).includes(SECRET), 'request object never carries the password');
  // Nothing stored or returned holds the password.
  assert.ok(!allRows(r).includes(SECRET));
  assert.ok(!JSON.stringify(done).includes(SECRET));
  assert.ok(!JSON.stringify(req).includes(SECRET));
  assert.ok(!JSON.stringify(r.calls.filter(c => c[0] !== 'open')).includes(SECRET), 'handoff notes and other calls do not hold it');
  assert.ok(JSON.stringify(r.calls.filter(c => c[0] === 'handoff')).includes('MY_WORK_LAPTOP'));
  assert.ok(!r.sql.exec('SELECT * FROM native_sessions').toArray().some(s => JSON.stringify(s).includes(SECRET)));
}
// A broker error that echoes the password is scrubbed everywhere.
{
  const r = resident(); r.broker.openSsh = async () => ({ ok: false, state: 'error', error: `auth failed for ${SECRET}` });
  const req = await nativeTool(r, 'ssh_connect', { ...args, password_key: 'MY_WORK_LAPTOP' }, tc());
  const out = await decideSsh(r, row(r, req.approval_id), 'once');
  assert.equal(out.ok, false); assert.ok(!JSON.stringify(out).includes(SECRET)); assert.ok(!allRows(r).includes(SECRET));
}
// A key deleted between the card and the decision fails clearly and sends nothing.
{
  const r = resident(); await saveKey('t1', 'SHORT_LIVED', 'temp-secret-value');
  const req = await nativeTool(r, 'ssh_connect', { ...args, password_key: 'SHORT_LIVED' }, tc());
  db.prepare("DELETE FROM vault WHERE tenant_id='t1' AND name='SHORT_LIVED'").run();
  const out = await decideSsh(r, row(r, req.approval_id), 'once');
  assert.match(out.error, /no saved key named SHORT_LIVED/); assert.equal(r.calls.filter(c => c[0] === 'open').length, 0);
  assert.equal(row(r, req.approval_id).status, 'pending');
}
// Another tenant's resident cannot use t1's key, and t1's own secret is never opened for t2.
{
  await db.prepare("INSERT INTO direct_network_permissions (tenant_id,ssh_mode,generation,updated_at) VALUES ('t2','ask',1,1)").run();
  const r = resident('main', 't2'); const out = await nativeTool(r, 'ssh_connect', { ...args, password_key: 'MY_WORK_LAPTOP' }, tc());
  assert.equal(out.ok, false); assert.match(out.error, /no saved key named MY_WORK_LAPTOP/);
  const own = await nativeTool(r, 'ssh_connect', { ...args, password_key: 'THEIR_KEY' }, tc());
  assert.equal(own.state, 'awaiting_approval');
  await decideSsh(r, row(r, own.approval_id), 'once');
  assert.equal(r.calls.find(c => c[0] === 'open')[2], OTHER_TENANT_SECRET);
}
// Trusted mode: the remembered record carries the key name and a trusted reconnect passes the password in memory only.
{
  await ask(); const r = resident(); await setSshPermission(r.env, 't1', 'trusted', async () => []);
  r.broker.openTrustedSsh = async (d, pw) => { r.calls.push(['auto-open', d, pw]); return { ok: false, state: 'approval_required' }; };
  const first = await nativeTool(r, 'ssh_connect', { ...args, password_key: 'MY_WORK_LAPTOP' }, tc());
  assert.equal(first.state, 'awaiting_approval');
  const auto = r.calls.find(c => c[0] === 'auto-open'); assert.equal(auto[2], SECRET); assert.equal(auto[1].passwordKey, 'MY_WORK_LAPTOP');
  assert.ok(!JSON.stringify(auto[1]).includes(SECRET)); assert.ok(!allRows(r).includes(SECRET));
  r.broker.openSsh = async (d, pw) => { r.calls.push(['remember-open', d, pw]); return d.fingerprint ? { ok: true, session: 'remembered', trust_saved: true } : { state: 'host_key_confirmation_required', fingerprint: 'SHA256:fixture' }; };
  const hostkey = await decideSsh(r, row(r, first.approval_id), 'trust');
  assert.equal(hostkey.approval.ssh.password_key, 'MY_WORK_LAPTOP');
  assert.ok(hostkey.approval.action.lines.some(l => l[0] === 'Login' && l[1].includes('MY_WORK_LAPTOP')));
  const opened = await decideSsh(r, row(r, hostkey.approval.id), 'once'); assert.equal(opened.state, 'connected');
  assert.ok(r.calls.filter(c => c[0] === 'remember-open').every(c => c[2] === SECRET && c[1].passwordKey === 'MY_WORK_LAPTOP' && c[1].remember));
  assert.ok(!allRows(r).includes(SECRET));
  // A key that was deleted makes a trusted reconnect fail clearly before any broker call.
  db.prepare("DELETE FROM vault WHERE tenant_id='t1' AND name='OTHER_KEY'").run();
  const before = r.calls.filter(c => c[0] === 'auto-open').length;
  const gone = await nativeTool(r, 'ssh_connect', { ...args, password_key: 'OTHER_KEY' }, tc('task-2', 'turn-2'));
  assert.match(gone.error, /no saved key named OTHER_KEY/); assert.equal(r.calls.filter(c => c[0] === 'auto-open').length, before);
}
// The card view for the key line also works from the stored row alone (history after a restart).
{
  const view = sshApprovalView({ perm: 'ssh', what: 'demo@server.example:22', ssh_data: JSON.stringify({ host: 'server.example', user: 'demo', port: 22, route: 'public', passwordKey: 'MY_WORK_LAPTOP', requestId: 'x' }) });
  assert.ok(view.action.lines.some(l => l[0] === 'Login' && l[1].includes('MY_WORK_LAPTOP')));
}
console.log('ssh-password: ok');
