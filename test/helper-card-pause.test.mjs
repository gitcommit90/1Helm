// node --import ./test/stubs/register.mjs test/helper-card-pause.test.mjs
// A routed worker has every work tool Primary has (only circular ones are denied), and a tool of its own that needs the person shows its card in the task,
// pauses the worker, and the person's decision resumes the same worker. Deterministic app facts only: tool lists, SQLite rows and calls to fakes.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Resident } from '../src/resident.js';
import { helpersInit, helperAllowed, helperExclude, helperRow } from '../src/helpers.js';
import { userInputInit } from '../src/user-input.js';
import { initRoutingArtifacts } from '../src/ee/routing-artifacts.js';
import { WORKER_DENIED, WORKER_DENIED_REASONS, routingToolsAllowed, ORCHESTRATOR_NOTE, orchestrationPolicy } from '../src/ee/orchestrator.js';
import { nativeInit, nativeTool, decideSsh, NATIVE_TOOL_NAMES } from '../src/native-network.js';
import { permsInit } from '../src/perms.js';
import { secretUseBlock } from '../src/resident.js';
import { confirmInit, confirmGate, decideConfirm } from '../src/confirm.js';

// 1. The tool list.
const W = { dynamic_routing: 1, required_delegation: 1, role: 'worker' };
const WORK = ['native_network', 'ssh_connect', 'ssh_session', 'app_run', 'app_proxy', 'gmail_send', 'gmail_draft', 'calendar_add', 'browser_navigate', 'browser_snapshot', 'browser_act', 'browser_handoff',
  'browser_fill_login', 'buy_with_link', 'check_purchase', 'offer_connect', 'share_file', 'update_todos', 'remember', 'recall_history', 'schedule_workflow', 'schedule_followup', 'run_command', 'done', 'request_input'];
for (const n of WORK) { assert.equal(helperAllowed(n, W), true, `${n} is a worker tool`); assert.equal(routingToolsAllowed({ helper: W, kind: 'helper' }, n), true, `${n} is routed to a worker`); }
for (const n of NATIVE_TOOL_NAMES) assert.equal(helperAllowed(n, W), true);
assert.deepEqual([...WORKER_DENIED].sort(), Object.keys(WORKER_DENIED_REASONS).sort());
for (const [n, why] of Object.entries(WORKER_DENIED_REASONS)) { assert.equal(helperAllowed(n, W), false, `${n} is denied to a worker`); assert.ok(why.length > 20, `${n} has a reason`); assert.doesNotMatch(why, /safer/i); }
for (const n of ['start_helper', 'stop_helper', 'list_helpers', 'send_helper', 'approve_subagent', 'message_subagent', 'decide_worker_request']) assert.ok(WORKER_DENIED.has(n), n);
assert.deepEqual(helperExclude([...WORK, ...WORKER_DENIED], W).sort(), [...WORKER_DENIED].sort(), 'the exclude list is exactly the denied tools');
assert.equal(helperAllowed('ssh_connect', { dynamic_routing: 0 }), true, 'a non-routed helper has the same work tools');
assert.equal(helperAllowed('start_helper', { dynamic_routing: 0 }), false);
assert.equal(helperAllowed('start_helper', { role: 'coordinator' }, 'dispatch'), true, 'a coordinator starts its children in dispatch');
assert.equal(helperAllowed('start_helper', { role: 'coordinator' }, 'aggregate'), false);
assert.doesNotMatch(ORCHESTRATOR_NOTE, /do not start a worker|workers do not have/i);
assert.match(orchestrationPolicy({ orchestration: { requiredDelegation: true } }), /workers have the same work tools/);

// 2. A resident with a routed worker (#7) running in turn "hturn" of task "task-1".
const d1 = new DatabaseSync(':memory:');
d1.exec("CREATE TABLE tenants (id TEXT PRIMARY KEY); INSERT INTO tenants VALUES ('t1')");
for (const f of ['migrations_048_direct_network.sql', 'migrations_050_ssh_trusted.sql']) d1.exec(readFileSync(new URL('./fixtures/migrations/' + f, import.meta.url), 'utf8'));
const DB = { prepare(q) { const stmt = d1.prepare(q); let args = []; const api = { bind(...v) { args = v; return api; }, async first() { return stmt.get(...args); }, async all() { return { results: stmt.all(...args) }; }, async run() { return { meta: stmt.run(...args) }; } }; return api; } };
const setMode = (mode) => d1.prepare("INSERT INTO direct_network_permissions (tenant_id,ssh_mode,ssh_trusted,generation,updated_at) VALUES ('t1','ask',?,1,1) ON CONFLICT(tenant_id) DO UPDATE SET ssh_mode='ask',ssh_trusted=excluded.ssh_trusted").run(mode === 'trusted' ? 1 : 0);
function make(tsState = 'connected') {
  const local = new DatabaseSync(':memory:');
  local.exec("CREATE TABLE kv(k TEXT PRIMARY KEY,v TEXT); CREATE TABLE sessions(id TEXT PRIMARY KEY,updated INTEGER,waiting TEXT); INSERT INTO sessions(id,updated) VALUES ('task-1',0)");
  local.exec(readFileSync(new URL('../src/resident.js', import.meta.url), 'utf8').match(/CREATE TABLE IF NOT EXISTS approvals[\s\S]*?approval_id INTEGER\);/)[0]);
  const sql = { exec(q, ...a) { const s = local.prepare(q); const rows = /^\s*(SELECT|PRAGMA|WITH)|RETURNING/i.test(q) ? s.all(...a) : (s.run(...a), []); return { toArray: () => rows, one: () => rows[0] }; } };
  helpersInit(sql); userInputInit(sql); initRoutingArtifacts(sql); permsInit(sql); nativeInit(sql); confirmInit(sql);
  sql.exec("INSERT INTO helpers(id,session,name,task,status,started,deadline,dynamic_routing,required_delegation,round,handed,card) VALUES(7,'task-1','SSH job','list the files','running',1,9999999999999,1,1,1,0,'hturn')");
  const calls = [], runs = [];
  const broker = {
    async prepareSsh(d) { calls.push(['prepare']); return { address: '100.81.5.21' }; },
    async openSsh(d) { calls.push(['open']); return { ok: true, session_id: 'sess-1', trust_saved: false }; },
    async openTrustedSsh(d) { calls.push(['open-trusted']); return { ok: true, session: 'sess-trusted' }; },
    async closeSsh(d, a) { calls.push(['close', a.session]); return { ok: true }; },
    async status() { return { key: null, sessions: [], tailscale: { state: tsState, device_name: '1hc-x' } }; },
    async tailscaleStatus() { return { state: tsState, device_name: '1hc-x' }; },
    async identity() { return { key: { public_key: 'ssh-ed25519 KEY', fingerprint: 'SHA256:x' } }; },
  };
  const R = Object.create(Resident.prototype);
  Object.assign(R, { sql, calls, runs, broker, env: { DB, NATIVE_NETWORK: 'on', NATIVE_TRANSPORT: { idFromName: x => x, get: () => broker } }, active: new Map(), ctx: { waitUntil() {} },
    get: k => ({ tenant: 't1', channel: 'main' })[k], put() {}, session: s => s === 'task-1', computer: () => ({ nativeGuardStatus: async () => ({ guarded: true }) }),
    approvalView: a => ({ id: a.id, status: a.status }), hl: () => ({ deadlineMs: 600000 }), arm: async () => {}, touchSession() {}, textApproval: async () => false,
    helperRun: async (h) => { runs.push(h.id); }, handoff: (task, note) => { calls.push(['primary-handoff', task]); return { mode: 'open' }; } });
  return R;
}
const tc = (R) => ({ turn: 'hturn', session: 'task-1', kind: 'helper', helper: helperRow(R.sql, 7), emit() {}, subs: new Set() });
const args = { host: '100.81.5.21', username: 'root', route: 'tailnet' };
const pending = (R) => R.sql.exec("SELECT * FROM approvals WHERE status='pending'").toArray();

// 3. A trusted server connects for the worker with no card, and the session belongs to the worker.
{ setMode('trusted'); const R = make(), out = await nativeTool(R, 'ssh_connect', args, tc(R));
  assert.deepEqual(out, { ok: true, state: 'connected', session_id: 'sess-trusted', authorization: 'trusted_server' });
  assert.equal(pending(R).length, 0, 'no card');
  assert.equal(R.sql.exec('SELECT helper,turn,task FROM native_sessions').one().helper, 7);
  assert.equal(R.helperCardWait(tc(R)), null, 'nothing to wait for');
  // 6. Its sessions close when the worker ends.
  assert.deepEqual(await R.nativeCloseHelper(7), { ok: true, closed: 1 });
  assert.ok(R.calls.some(c => c[0] === 'close' && c[1] === 'sess-trusted'));
  assert.equal(R.sql.exec('SELECT status FROM native_sessions').one().status, 'closed'); }

// 4. A server that needs a card: the card is tied to the worker's run, the worker pauses, approval resumes the same worker.
{ setMode('ask'); const R = make(), t = tc(R), out = await nativeTool(R, 'ssh_connect', args, t);
  assert.equal(out.state, 'awaiting_approval'); assert.match(out.next, /Your worker pauses/);
  const rows = pending(R); assert.equal(rows.length, 1); assert.equal(rows[0].turn, 'hturn'); assert.equal(rows[0].session, 'task-1');
  const w = R.helperCardWait(t); assert.equal(w.cards[0].id, rows[0].id);
  R.workerPause(t, 'card', w.question, { detail: w.detail, job: 'list the files', params: { cards: w.cards } });
  assert.equal(t.helperInputQuestion, w.question);
  let h = helperRow(R.sql, 7); assert.equal(h.input_kind, 'card'); assert.equal(h.input_card, 'hturn');
  R.sql.exec("UPDATE helpers SET status='waiting_input' WHERE id=7");   // the round ended
  const done = await decideSsh(R, rows[0], 'once');
  assert.equal(done.state, 'connected');
  assert.deepEqual(R.runs, [7], 'the same worker ran again');
  h = helperRow(R.sql, 7); assert.equal(h.status, 'running'); assert.equal(h.round, 2); assert.equal(h.input_kind, null);
  const msg = R.sql.exec("SELECT text FROM helper_messages WHERE helper_id=7").one().text;
  assert.match(msg, /approved SSH to root@100\.81\.5\.21/); assert.match(msg, /ssh_session with this session_id/);
  assert.ok(!R.calls.some(c => c[0] === 'primary-handoff'), 'Primary was not handed the task');
  assert.equal(R.sql.exec('SELECT helper FROM native_sessions').one().helper, 7);
  assert.equal(R.sql.exec("SELECT status FROM helper_requests WHERE helper_id=7").one().status, 'closed'); }

// 5. Deny: the paused worker is told, and nothing connects.
{ setMode('ask'); const R = make(), t = tc(R); await nativeTool(R, 'ssh_connect', args, t);
  const row = pending(R)[0], w = R.helperCardWait(t); R.workerPause(t, 'card', w.question, { detail: w.detail });
  R.sql.exec("UPDATE helpers SET status='waiting_input' WHERE id=7");
  const out = await decideSsh(R, row, 'deny'); assert.equal(out.ok, true);
  assert.deepEqual(R.runs, [7]); assert.match(R.sql.exec("SELECT text FROM helper_messages WHERE helper_id=7").one().text, /person denied SSH/);
  assert.ok(!R.calls.some(c => c[0] === 'open')); }

// 5b. The person decides before the worker's round ended: the outcome is kept and the round end resumes the worker.
{ setMode('ask'); const R = make(), t = tc(R); await nativeTool(R, 'ssh_connect', args, t);
  const row = pending(R)[0], w = R.helperCardWait(t); R.workerPause(t, 'card', w.question, { detail: w.detail });
  await decideSsh(R, row, 'once'); assert.deepEqual(R.runs, [], 'still running its round');
  R.sql.exec("UPDATE helpers SET status='waiting_input' WHERE id=7");
  assert.equal(R.cardAnsweredEarly(helperRow(R.sql, 7)), true); assert.deepEqual(R.runs, [7]); }

// 7. Tailscale not joined: the worker gets the steps and is told to show them through request_input.
{ setMode('ask'); const R = make('disconnected'), out = await nativeTool(R, 'ssh_connect', args, tc(R));
  assert.equal(out.state, 'setup_needed'); assert.match(out.next, /request_input/); assert.ok(out.steps.length >= 1); assert.equal(out.settings_link, '#settings/computer-network');
  assert.equal(pending(R).length, 0);
  const p = make('disconnected'); const primary = await nativeTool(p, 'ssh_connect', args, { turn: 'pturn', session: 'task-1', emit() {} });
  assert.doesNotMatch(primary.next, /request_input/); }

// 8. An app confirm card: the card is tied to the worker's run, the worker pauses, the person's Confirm resumes it with the token.
{ setMode('ask'); const R = make(), t = tc(R);
  const spec = { tool: 'app_run', payload: { action: 'STRIPE_CREATE_CHARGE', arguments: { amount: 5 }, account: 'acct' }, args: { action: 'STRIPE_CREATE_CHARGE' }, view: { title: 'Charge $5?' } };
  const text = await confirmGate(R, t, spec); assert.match(text, /^WAITING FOR CONFIRM/);
  const row = pending(R)[0]; assert.equal(row.perm, 'confirm'); assert.equal(row.turn, 'hturn');
  const w = R.helperCardWait(t); assert.equal(w.cards[0].id, row.id);
  R.workerPause(t, 'card', w.question, { detail: w.detail }); R.sql.exec("UPDATE helpers SET status='waiting_input' WHERE id=7");
  const out = await decideConfirm(R, row, 'confirm'); assert.equal(out.ok, true);
  assert.deepEqual(R.runs, [7]); const msg = R.sql.exec("SELECT text FROM helper_messages WHERE helper_id=7").one().text;
  assert.match(msg, /Call app_run again now with exactly these inputs and confirm_token "/);
  assert.ok(!R.calls.some(c => c[0] === 'primary-handoff'));
  const token = msg.match(/confirm_token "([^"]+)"/)[1];
  assert.equal(await confirmGate(R, t, { ...spec, token }), null, 'the token lets the same worker run the confirmed action'); }

// 9. A card raised by Primary still hands the task back to Primary.
{ setMode('ask'); const R = make(); R.cardHandoff('task-1', 'pturn', { text: 'x' }); assert.ok(R.calls.some(c => c[0] === 'primary-handoff')); }
// 11. The person's saved login and card are never used by a helper without Primary's approval, whatever the helper kind.
for (const n of ['read_context', 'recall_memory', 'rename_task', 'create_task', 'start_task', 'create_channel', 'app_events']) assert.ok(WORKER_DENIED.has(n), `${n} always fails in a helper run`);
assert.match(WORKER_DENIED_REASONS.read_context, /a helper run has no task context; the brief carries what the job needs/);
{ const nonRouted = { kind: 'helper', helper: { id: 9, dynamic_routing: 0 } }, routed = { kind: 'helper', helper: { id: 7, dynamic_routing: 1 } };
  for (const n of ['browser_fill_login', 'browser_fill_card', 'buy_with_link', 'check_purchase']) assert.match(secretUseBlock(n, nonRouted), /without Primary's approval/, `${n} refused for a non-routed helper`);
  assert.equal(secretUseBlock('browser_fill_login', routed), null, 'a routed worker is checked against its grant instead');
  assert.match(secretUseBlock('buy_with_link', routed), /request_purchase/);
  assert.equal(secretUseBlock('browser_fill_login', { kind: 'chat' }), null);
  const R = make(); R.computer = () => ({ browser: async () => { throw new Error('the browser must not be touched'); } });
  const out = await R.browserToolInner('browser_fill_login', { site: 'example.com', username_ref: 'e1', password_ref: 'e2' }, nonRouted);
  assert.equal(out.code, 1); assert.match(out.out, /Nothing was filled or bought/);
  assert.match(await R.localToolInner('buy_with_link', { amount_cents: 100 }, { ...nonRouted, session: 'task-1', turn: 't' }), /^error: buy_with_link isn't available to this helper without Primary's approval/); }
console.log('helper card pause: ok');
// 10. The turn that resumes Primary after an SSH approval runs with requiredDelegation cleared (resident.js), so Primary handles it with its tools.
assert.match(orchestrationPolicy({ orchestration: { requiredDelegation: false } }), /Handle the person's current request as Primary/);
assert.equal(routingToolsAllowed({ orchestration: { requiredDelegation: false } }, 'ssh_session'), true);
