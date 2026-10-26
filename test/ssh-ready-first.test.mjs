// node test/ssh-ready-first.test.mjs -- SSH requests check native state first, and Primary keeps native tools under required delegation.
import assert from 'node:assert/strict';
import { routingToolsAllowed, orchestrationPolicy } from '../src/ee/orchestrator.js';
import { helperAllowed } from '../src/helpers.js';
import { nativeTool, nativeMix, nativeInit, setupNeeded, tailnetSetupSteps, COMPUTER_NETWORK_LINK, NATIVE_TOOL_NAMES } from '../src/native-network.js';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

// Routing: with a required hand-off, Primary may call the native tools before start_helper, workers never have them.
const NATIVE = ['native_network', 'ssh_connect', 'ssh_session'];
for (const n of NATIVE) {
  assert.ok(NATIVE_TOOL_NAMES.has(n));
  assert.equal(routingToolsAllowed({ orchestration: { requiredDelegation: true } }, n), true, `${n} allowed on Primary under required delegation`);
  assert.equal(routingToolsAllowed({ orchestration: { requiredDelegation: true, started: 5 } }, n), false, `${n} not allowed once a worker started`);
  assert.equal(routingToolsAllowed({ orchestration: { requiredDelegation: true, review: 5 } }, n), false);
  assert.equal(helperAllowed(n, { dynamic_routing: true, required_delegation: true }), false, `${n} is not a worker tool`);
  assert.equal(helperAllowed(n, null), false);
}
assert.equal(routingToolsAllowed({ orchestration: { requiredDelegation: true } }, 'start_helper'), true);
assert.equal(routingToolsAllowed({ orchestration: { requiredDelegation: true } }, 'run_command'), false);
assert.match(orchestrationPolicy({ orchestration: { requiredDelegation: true } }), /native_network/);

// Setup result shape.
const s = setupNeeded(['tailscale'], ['step']);
assert.equal(s.state, 'setup_needed'); assert.equal(s.settings_link, '#settings/computer-network'); assert.equal(COMPUTER_NETWORK_LINK, s.settings_link);
assert.match(tailnetSetupSteps({ state: 'awaiting_user_approval', device_name: '1hc-abc' })[0], /approve the device 1hc-abc/);
assert.match(tailnetSetupSteps({ state: 'disconnected' }, { public_key: 'ssh-ed25519 AAAA' })[1], /authorized_keys.*ssh-ed25519 AAAA/);

// ssh_connect checks the tailnet state before preparing anything.
const db = new DatabaseSync(':memory:');
db.exec("CREATE TABLE tenants (id TEXT PRIMARY KEY); INSERT INTO tenants VALUES ('t1')");
for (const f of ['db/migrations/0041_direct_network.sql', 'db/migrations/0043_ssh_trusted.sql']) db.exec(readFileSync(new URL('../' + f, import.meta.url), 'utf8'));
db.exec("INSERT INTO direct_network_permissions (tenant_id,ssh_mode,ssh_trusted,generation,updated_at) VALUES ('t1','ask',0,1,0) ON CONFLICT(tenant_id) DO UPDATE SET ssh_mode='ask'");
const DB = { prepare(q) { const stmt = db.prepare(q); let args = []; const api = { bind(...v) { args = v; return api; }, async first() { return stmt.get(...args); } }; return api; } };
function resident(tsState) {
  const local = new DatabaseSync(':memory:');
  local.exec("CREATE TABLE approvals(id INTEGER PRIMARY KEY AUTOINCREMENT,at INTEGER,host TEXT,method TEXT,path TEXT,bytes INTEGER,keys TEXT,turn TEXT,session TEXT,perm TEXT,what TEXT,status TEXT DEFAULT 'pending',decision TEXT,decided_at INTEGER);CREATE TABLE sessions(id TEXT PRIMARY KEY,updated INTEGER);INSERT INTO sessions VALUES ('task-1',0)");
  const sql = { exec(q, ...a) { const st = local.prepare(q); const rows = /^(SELECT|PRAGMA)|RETURNING/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => rows, one: () => rows[0] }; } };
  nativeInit(sql);
  const calls = [], broker = {
    async prepareSsh(d) { calls.push('prepare'); return { address: '100.81.5.21' }; },
    async status() { return { key: null, sessions: [], tailscale: { state: tsState, device_name: '1hc-x' } }; },
    async tailscaleStatus() { return { state: tsState, device_name: '1hc-x' }; },
    async identity() { return { key: { public_key: 'ssh-ed25519 KEY', fingerprint: 'SHA256:x' } }; },
  };
  class R {} nativeMix(R);
  return Object.assign(new R(), { sql, calls, get: k => k === 'tenant' ? 't1' : 'main', session: () => true, computer: () => ({ nativeGuardStatus: async () => ({ guarded: true }) }),
    approvalView: a => a, env: { DB, NATIVE_NETWORK: 'on', NATIVE_TRANSPORT: { idFromName: x => x, get: () => broker } } });
}
const args = { host: '100.81.5.21', username: 'root', route: 'tailnet' }, tc = { turn: 'turn-1', session: 'task-1', emit() {} };
for (const state of ['disconnected', 'awaiting_user_approval']) {
  const r = resident(state), out = await nativeTool(r, 'ssh_connect', args, tc);
  assert.equal(out.state, 'setup_needed', state); assert.equal(out.settings_link, '#settings/computer-network');
  assert.deepEqual(out.missing, ['tailscale']); assert.equal(out.key.public_key, 'ssh-ed25519 KEY');
  assert.deepEqual(r.calls, [], 'no connection was prepared'); assert.equal(r.sql.exec("SELECT * FROM approvals").toArray().length, 0, 'no approval card row');
}
{ const r = resident('connected'), out = await nativeTool(r, 'ssh_connect', args, tc);
  assert.notEqual(out.state, 'setup_needed'); assert.deepEqual(r.calls, ['prepare']); }
{ const r = resident('disconnected'), out = await nativeTool(r, 'ssh_connect', { ...args, route: 'public' }, tc);
  assert.notEqual(out.state, 'setup_needed', 'a public route does not need the tailnet'); }
console.log('ssh ready first: ok');
