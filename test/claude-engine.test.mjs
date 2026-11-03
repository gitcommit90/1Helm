import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

// Runs the real ClaudeEngine methods against SQLite and a fake container. The fake container answers the shell snippets the engine sends
// (it recognizes them by their text), keeps files in memory and plays the CLI's output. These are control-plane tests: they prove the
// engine's states, sealing, stream plumbing, idle sleep and metering, not the Claude CLI itself (checked by hand against the built image).
class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }
const aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
const sealSecret = async (_, s) => { const iv = crypto.getRandomValues(new Uint8Array(12)), ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, new TextEncoder().encode(s)); return Buffer.from(iv).toString('base64') + '.' + Buffer.from(ct).toString('base64'); };
const openSecret = async (_, s) => { const [iv, ct] = s.split('.').map((x) => Buffer.from(x, 'base64')); return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aes, ct)); };
import { parseClaudeHeaders, parseClaudeUsage } from '../src/ee/byok-usage.js';
globalThis.__ceTest = { parseClaudeHeaders, parseClaudeUsage, DurableObject, tolerantEnv: (e) => e, sealSecret, openSecret, isCapacityError: (e) => /no container instance/i.test(String(e?.message ?? e)), computerBusyError: () => Object.assign(new Error('All computers are busy right now. Try again in a minute.'), { status: 503 }), CAPACITY_RETRY_MS: 30 };
let source = await readFile(new URL('../src/ee/claude-engine.js', import.meta.url), 'utf8');
source = source.replace(/^import .*;\n/gm, '');
const M = await import('data:text/javascript;base64,' + Buffer.from('const {parseClaudeHeaders,parseClaudeUsage,DurableObject,tolerantEnv,sealSecret,openSecret,isCapacityError,computerBusyError,CAPACITY_RETRY_MS}=globalThis.__ceTest;\n' + source).toString('base64'));
const { ClaudeEngine, runArgs, mcpConfig, runnerScript, tailScript, sessionUuid, loginReason, RATE_NANO_PER_SEC, IDLE_MS, MCP_SERVER_NAME } = M;
const enc = new TextEncoder(), dec = new TextDecoder();
const stream = (chunks) => new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(enc.encode(x)); c.close(); } });
const readAll = async (s) => { const r = s.getReader(); let out = ''; for (;;) { const { value, done } = await r.read(); if (done) return out; out += dec.decode(value); } };
const bodyText = async (b) => (b ? await readAll(b) : '');

function setup({ usageOut = '', completeLines = [], completeHang = false, capacityFails = 0, loginExit = 0, loginErr = '', runLines = [], runExit = 0, runErr = '' } = {}) {
  const db = new DatabaseSync(':memory:'); let alarm = null;
  const sql = { exec(q, ...a) { const st = db.prepare(q); if (/^\s*SELECT/i.test(q)) { const rows = st.all(...a); return { toArray: () => rows, one: () => rows[0] }; } if (/;\s*\S/.test(q.trim())) { db.exec(q); return { toArray: () => [], one: () => undefined }; } st.run(...a); return { toArray: () => [], one: () => undefined }; } };
  const fs = new Map(), calls = [], f = { starts: 0, destroyed: 0, killed: [], loginSent: [], fifo: false, loginDone: false, runDirs: new Set(), tailFrom: [] };
  const container = {
    running: false, monitor: () => new Promise(() => {}),
    start() { f.starts++; if (f.starts <= capacityFails) throw new Error('no container instance available'); container.running = true; },
    destroy: async () => { f.destroyed++; container.running = false; fs.clear(); },
    exec: async (argv, o = {}) => {
      const stdin = o.stdin && o.stdin !== 'ignore' ? await bodyText(o.stdin) : '';
      const done = (code, out = '') => ({ stdout: stream([out]), exitCode: Promise.resolve(code), kill: () => f.killed.push(argv.join(' ').slice(0, 40)) });
      if (argv[0] === 'true') return done(0);
      if (argv[0] === 'claude') return done(0, '2.1.316 (Claude Code)\n');
      if (argv[0] === 'node') { f.completeArgv = argv; f.completePayload = JSON.parse(stdin); f.completeCalls = (f.completeCalls || 0) + 1; return { stdout: completeHang ? new ReadableStream({ start() {} }) : stream(completeLines.map((l) => JSON.stringify(l) + '\n')), exitCode: Promise.resolve(0), kill: (sig) => f.killed.push('complete:' + sig) }; }
      if (argv[0] === 'setsid') { f.runner = { argv, env: o.env, stdin: o.stdin }; return done(0); }
      const script = argv[2] || '', args = argv.slice(4); calls.push(script.slice(0, 60));
      if (script.includes('cat > "$1"')) { fs.set(args[0], stdin); return done(0); }
      if (script.startsWith('cat "$1" 2>/dev/null') && args[0].endsWith('credentials.json')) return fs.has(args[0]) ? done(0, fs.get(args[0])) : done(1);
      if (script.startsWith('cat "$1" 2>/dev/null') && args[0].endsWith('.claude.json')) return fs.has(args[0]) ? done(0, fs.get(args[0])) : done(1);
      if (script.includes('mkfifo')) { f.fifo = true; f.loginDone = false; f.loginSent = []; return done(0, 'started\n'); }
      if (script.includes('cat "$1/out"')) return done(0, f.fifo ? 'Opening browser to sign in…\nIf the browser didn\'t open, visit: https://claude.com/cai/oauth/authorize?code=true&state=abc\nPaste code here if prompted > ' : '');
      if (script.includes('[ -p "$1/in" ]')) return done(0, f.fifo && !f.loginDone ? 'yes' : 'no');
      if (script.startsWith('printf')) { f.loginSent.push(args[1]); f.loginDone = true; if (loginExit === 0) { fs.set('/home/node/.claude/.credentials.json', '{"claudeAiOauth":{"accessToken":"AT1","refreshToken":"RT1"}}'); fs.set('/home/node/.claude.json', '{"oauthAccount":{"emailAddress":"p@example.com"}}'); } return done(0); }
      if (script.includes('[ -f "$1/code" ] && cat "$1/code"')) return done(0, f.loginDone ? String(loginExit) : '');
      if (script.includes('cat "$1/err"')) return done(0, loginErr);
      if (script.startsWith('node "$1"')) { f.usageRuns = (f.usageRuns || 0) + 1; f.usageArgs = args; return done(0, usageOut); }
      if (script.startsWith('claude auth status')) return done(0, JSON.stringify({ loggedIn: !!fs.has('/home/node/.claude/.credentials.json'), email: 'p@example.com', subscriptionType: 'max' }));
      if (script.startsWith('claude auth logout')) { fs.delete(args[0]); fs.delete(args[1]); return done(0); }
      if (script.startsWith('find "$2"')) { f.runDirs.add(args[0]); return done(0); }
      if (script.includes('[ -d "$1" ]')) return done(0, f.runDirs.has(args[0]) ? 'yes' : 'no');
      if (script.includes('[ -f "$1/code" ] && echo done')) return done(0, f.runEnded ? 'done' : 'running');
      if (script.includes('kill -9')) { f.cancelled = args[0]; return done(0); }
      if (script.startsWith('tail -c 2000')) return done(0, runErr);
      if (script.startsWith('rm -rf "$1"')) { f.runDirs.delete(args[0]); return done(0); }
      if (script.startsWith('D="$1"; P="$2"')) { f.tailFrom.push(Number(args[1])); const all = runLines.join(''); return { stdout: stream([all.slice(Number(args[1]) - 1)]), exitCode: Promise.resolve(runExit), kill() {} }; }
      return done(0);
    },
  };
  const rows = new Map(), ledger = { reserved: 0, granted: 0, ok: true, grants: [] };
  const env = { DB: { prepare: (q) => ({ bind: (...a) => ({ first: async () => (rows.get(a[0]) ? { ...rows.get(a[0]) } : null), run: async () => {
    if (/^INSERT INTO claude_engine_logins/.test(q)) rows.set(a[0], { sealed: a[1], account_json: a[2], saved_at: a[3] });
    else if (/^UPDATE claude_engine_logins/.test(q)) { const r = rows.get(a[2]); if (r) { r.sealed = a[0]; r.saved_at = a[1]; } }
    else if (/^DELETE FROM claude_engine_logins/.test(q)) rows.delete(a[0]);
    return {}; } }) }) },
    LEDGER: { idFromName: (s) => s, get: () => ({ reserve: async () => (ledger.ok ? (ledger.reserved++, { ok: true }) : { ok: false, reason: 'insufficient' }), settle: async () => {}, grant: async (_id, nano, why) => { ledger.granted += nano; ledger.grants.push(why); } }) } };
  const ctx = { id: { name: 'tenant-a', toString: () => 'tenant-a' }, storage: { sql, getAlarm: async () => alarm, setAlarm: async (t) => { alarm = t; }, deleteAlarm: async () => { alarm = null; } }, container, waitUntil: () => {}, get alarmAt() { return alarm; } };
  return { e: new ClaudeEngine(ctx, env), ctx, env, rows, fs, f, ledger, container, calls, db };
}
const MCP = { url: 'https://dev.example/mcp/t1', token: 'tok-1' };
const signIn = async (x) => { await x.e.loginStart(); return x.e.loginFinish('abc123#state'); };

test('the CLI flags: subscription login, no built-in tools, only the 1Helm MCP server, effort and model passed', () => {
  const a = runArgs({ model: 'claude-sonnet-5-5', effort: 'high', dir: '/tmp/1hc-run/x' });
  assert.deepEqual(a.slice(0, 5), ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages']);
  assert.equal(a[a.indexOf('--tools') + 1], '');
  assert.equal(a[a.indexOf('--permission-mode') + 1], 'dontAsk');
  assert.equal(a[a.indexOf('--allowedTools') + 1], `mcp__${MCP_SERVER_NAME}`);
  assert.ok(a.includes('--strict-mcp-config'));
  assert.equal(a[a.indexOf('--mcp-config') + 1], '/tmp/1hc-run/x/mcp.json');
  assert.equal(a[a.indexOf('--append-system-prompt-file') + 1], '/tmp/1hc-run/x/system.txt');
  assert.equal(a[a.indexOf('--model') + 1], 'claude-sonnet-5-5'); assert.equal(a[a.indexOf('--effort') + 1], 'high');
  assert.ok(!runArgs({ dir: '/d' }).includes('--model') && !runArgs({ dir: '/d' }).includes('--effort'));
  for (const bad of ['--bare', '--dangerously-skip-permissions', '--api-key']) assert.ok(!a.includes(bad), `${bad} would drop the subscription login or the tool limits`);
  assert.deepEqual(JSON.parse(mcpConfig(MCP)), { mcpServers: { onehc: { type: 'http', url: MCP.url, headers: { Authorization: 'Bearer tok-1' } } } });
  assert.match(runnerScript(), /--resume \$SID/); assert.match(runnerScript(), /--session-id \$SID/);
  assert.match(tailScript(), /exit "\$\(cat "\$D\/code"\)"/);
});
test('a session id becomes the same uuid every time', async () => {
  const u = await sessionUuid('chan:main:task1');
  assert.match(u, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/); assert.equal(u, await sessionUuid('chan:main:task1')); assert.notEqual(u, await sessionUuid('chan:main:task2'));
  assert.equal(loginReason('Login failed: That code wasn\'t accepted.\n'), 'That code wasn\'t accepted.');
});

test('login: start returns Anthropic\'s address, finish saves the account and a sealed login', async () => {
  const x = setup();
  assert.equal((await x.e.status()).signedIn, false);
  const s = await x.e.loginStart(); assert.equal(s.url, 'https://claude.com/cai/oauth/authorize?code=true&state=abc'); assert.equal(x.f.starts, 1);
  assert.equal(x.ledger.reserved, 1, 'starting the container prepays a minute');
  const r = await x.e.loginFinish('  abc123#state '); assert.deepEqual(r, { ok: true, account: { email: 'p@example.com', plan: 'max' } });
  assert.deepEqual(x.f.loginSent, ['abc123#state']);
  const row = x.rows.get('tenant-a'); assert.ok(row);
  assert.ok(!row.sealed.includes('AT1') && !row.sealed.includes('RT1'), 'the stored login is sealed');
  assert.deepEqual(JSON.parse(await openSecret(null, row.sealed)), { v: 1, credentials: '{"claudeAiOauth":{"accessToken":"AT1","refreshToken":"RT1"}}', claudeJson: '{"oauthAccount":{"emailAddress":"p@example.com"}}' });
  const st = await x.e.status(); assert.deepEqual({ signedIn: st.signedIn, account: st.account, version: st.version }, { signedIn: true, account: { email: 'p@example.com', plan: 'max' }, version: '2.1.316' });
  assert.ok(!JSON.stringify(st).includes('AT1'));
});
test('login: a wrong code gives the CLI\'s plain reason and saves nothing', async () => {
  const x = setup({ loginExit: 1, loginErr: 'Login failed: That code wasn\'t accepted. It may be expired.\n' });
  await x.e.loginStart(); const r = await x.e.loginFinish('badcode1234');
  assert.deepEqual(r, { error: 'That code wasn\'t accepted. It may be expired.' }); assert.equal(x.rows.size, 0);
  assert.deepEqual(await x.e.loginFinish('<script>'), { error: 'That doesn\'t look like the code Anthropic showed. Copy all of it and paste it again.' });
});
test('login: finishing with no waiting sign-in says it expired', async () => {
  const x = setup(); assert.match((await x.e.loginFinish('abc12345')).error, /expired/);
  await x.e.warm(); assert.match((await x.e.loginFinish('abc12345')).error, /expired/);
});
test('login: outliving a reset of this object still works (the sign-in lives in the container)', async () => {
  const x = setup(); await x.e.loginStart();
  const again = new ClaudeEngine(x.ctx, x.env);   // a deploy reset the object; the container kept running
  assert.equal((await again.loginFinish('abc123#state')).ok, true);
});

test('saved login is written back at every start and saved again when the CLI refreshed it', async () => {
  const x = setup(); await signIn(x);
  await x.e.stop('idle', { cancellable: false }); assert.equal(x.container.running, false); assert.equal(x.fs.size, 0, 'a new container has no login');
  const w = await x.e.warm(); assert.equal(w.ok, true); assert.equal(typeof w.ms, 'number');
  assert.equal(x.fs.get('/home/node/.claude/.credentials.json'), '{"claudeAiOauth":{"accessToken":"AT1","refreshToken":"RT1"}}');
  const before = x.rows.get('tenant-a').sealed;
  assert.equal(await x.e.saveLogin(), false, 'unchanged login is not saved again'); assert.equal(x.rows.get('tenant-a').sealed, before);
  x.fs.set('/home/node/.claude/.credentials.json', '{"claudeAiOauth":{"accessToken":"AT2","refreshToken":"RT2"}}');   // the CLI refreshed its tokens
  assert.equal(await x.e.saveLogin(), true);
  assert.match(await openSecret(null, x.rows.get('tenant-a').sealed), /RT2/);
  assert.equal(JSON.parse(x.rows.get('tenant-a').account_json).email, 'p@example.com', 'a refresh keeps the account');
});
test('sign out: the CLI logs out, files and the saved row are gone, and a late save cannot bring it back', async () => {
  const x = setup(); await signIn(x); assert.ok(x.rows.has('tenant-a'));
  assert.deepEqual(await x.e.signOut(), { ok: true }); assert.equal(x.rows.size, 0); assert.ok(!x.fs.has('/home/node/.claude/.credentials.json'));
  x.fs.set('/home/node/.claude/.credentials.json', '{"x":1}'); await x.e.saveLogin(); assert.equal(x.rows.size, 0);
  assert.equal((await x.e.status()).signedIn, false);
});

test('run: refused when not signed in, with no container started', async () => {
  const x = setup(); await assert.rejects(() => x.e.run({ prompt: 'hi', session: 's1', mcp: MCP }), (e) => e.status === 401 && e.code === 'not_signed_in'); assert.equal(x.f.starts, 0);
});
test('run: validates its input', async () => {
  const x = setup(); await signIn(x);
  for (const bad of [{ session: 'a b' }, { prompt: '' }, { model: 'x;rm -rf /' }, { effort: 'ultra' }, { mcp: { url: 'http://insecure', token: 't' } }, { mcp: { url: MCP.url } }])
    await assert.rejects(() => x.e.run({ prompt: 'hi', session: 's1', mcp: MCP, ...bad }), (e) => e.status === 400, JSON.stringify(bad));
});
test('run: streams whole NDJSON lines, passes files and flags, saves the login after, cleans up', async () => {
  const lines = ['{"type":"system","subtype":"init","session_id":"u"}\n', '{"type":"assistant","message":"hel', 'lo"}\n', '{"type":"result","subtype":"success","is_error":false}\n'];
  const x = setup({ runLines: lines }); await signIn(x);
  x.fs.set('/home/node/.claude/.credentials.json', '{"claudeAiOauth":{"accessToken":"AT9","refreshToken":"RT9"}}');
  const s = await x.e.run({ prompt: 'say hello', systemAppend: 'Be brief.', model: 'sonnet', effort: 'low', mcp: MCP, session: 'chan:main:t1', cwd: '/work/notes' });
  const out = await readAll(s); assert.equal(out, lines.join('')); assert.deepEqual(x.f.tailFrom, [1]);
  assert.equal([...x.fs.keys()].filter((k) => k.endsWith('prompt.txt')).length, 1);
  const files = Object.fromEntries([...x.fs].filter(([k]) => k.includes('/tmp/1hc-run/')).map(([k, v]) => [k.split('/').pop(), v]));
  assert.equal(files['prompt.txt'], 'say hello'); assert.equal(files['system.txt'], 'Be brief.'); assert.equal(JSON.parse(files['mcp.json']).mcpServers.onehc.headers.Authorization, 'Bearer tok-1');
  const argv = x.f.runner.argv; assert.equal(argv[0], 'setsid'); assert.equal(argv[6], '/work/notes');   // after the script and _: dir, cwd, uuid, seconds, then the CLI flags
  assert.equal(argv[7], await sessionUuid('chan:main:t1')); assert.ok(argv.includes('--model') && argv.includes('sonnet'));
  assert.ok(!argv.join(' ').includes('tok-1') && !argv.join(' ').includes('say hello'), 'the token and prompt stay in 0600 files, not the command line');
  assert.match(await openSecret(null, x.rows.get('tenant-a').sealed), /RT9/, 'the refreshed login is saved after the run');
  assert.equal(x.f.runDirs.size, 0); assert.equal(x.e.inflight, 0); assert.deepEqual(await x.e.debug().then((d) => d.runs), []);
});
test('run: a failed CLI with no result line of its own ends the stream with a result line that says why', async () => {
  const x = setup({ runLines: ['{"type":"system","subtype":"init"}\n'], runExit: 1, runErr: 'boom\nNot logged in\n' }); await signIn(x);
  const out = (await readAll(await x.e.run({ prompt: 'hi', mcp: MCP, session: 's1' }))).trim().split('\n');
  assert.equal(out.length, 2); const last = JSON.parse(out[1]); assert.equal(last.type, 'result'); assert.equal(last.is_error, true); assert.equal(last.result, 'Not logged in'); assert.equal(last.exit_code, 1);
  const y = setup({ runLines: ['{"type":"result","is_error":true}\n'], runExit: 1 }); await signIn(y);
  assert.equal((await readAll(await y.e.run({ prompt: 'hi', mcp: MCP, session: 's1' }))).trim().split('\n').length, 1, 'no second result line');
  const t = setup({ runLines: [], runExit: 124 }); await signIn(t);
  assert.match(JSON.parse((await readAll(await t.e.run({ prompt: 'hi', mcp: MCP, session: 's1' }))).trim()).result, /too long/);
});
test('run: the container stays awake while a run streams, and cancel stops the CLI', async () => {
  const x = setup({ runLines: ['{"type":"system"}\n'] }); await signIn(x);
  const s = await x.e.run({ prompt: 'hi', mcp: MCP, session: 's1' });
  assert.equal(x.e.inflight, 1); assert.equal(x.e.activeRuns().length, 1);
  x.e.put('last_activity', 0); assert.equal((await x.e.stop('idle')).deferred, true, 'no idle sleep during a run'); assert.equal(x.container.running, true);
  assert.deepEqual(await x.e.cancel('s1'), { ok: true }); assert.ok(x.f.cancelled.endsWith(await (await import('node:crypto')).createHash('sha256').update('run:s1').digest('hex').slice(0, 24)));
  await readAll(s); assert.equal(x.e.inflight, 0);
});
test('run: a stream the consumer drops leaves the run going, and attach carries on from a byte offset', async () => {
  const lines = ['{"a":1}\n', '{"b":2}\n'];
  const x = setup({ runLines: lines }); await signIn(x);
  const s = await x.e.run({ prompt: 'hi', mcp: MCP, session: 's1' }); const r = s.getReader(); const first = await r.read(); await r.cancel();
  assert.equal(dec.decode(first.value), lines[0]); assert.equal(x.e.inflight, 0);
  assert.equal(x.e.activeRuns().length, 1, 'the run is still marked running');
  const again = new ClaudeEngine(x.ctx, x.env);
  const rest = await readAll(await again.attach('s1', first.value.byteLength + 1)); assert.equal(rest, lines[1]); assert.equal(x.f.tailFrom.at(-1), 9);
  await assert.rejects(() => again.attach('nope', 1), (e) => e.code === 'run_gone');
});
test('run: at most three at once, and a second run for one session replaces the first', async () => {
  const x = setup({ runLines: ['{"a":1}\n'] }); await signIn(x);
  for (const n of ['a', 'b', 'c']) await x.e.run({ prompt: 'hi', mcp: MCP, session: n });
  await assert.rejects(() => x.e.run({ prompt: 'hi', mcp: MCP, session: 'd' }), (e) => e.code === 'engine_busy');
  await x.e.run({ prompt: 'again', mcp: MCP, session: 'a' }); assert.ok(x.f.cancelled);
});

test('idle: the alarm sleeps the container after the idle time, saves the login first and refunds unused prepaid time', async () => {
  const x = setup(); await signIn(x);
  assert.equal(IDLE_MS, 5 * 60e3);
  x.e.put('last_activity', Date.now() - IDLE_MS + 60e3); await x.e.alarm(); assert.equal(x.container.running, true, 'not idle long enough');
  x.fs.set('/home/node/.claude/.credentials.json', '{"claudeAiOauth":{"accessToken":"AT3","refreshToken":"RT3"}}');
  x.e.put('last_activity', Date.now() - IDLE_MS - 1000); await x.e.alarm();
  assert.equal(x.container.running, false); assert.equal(x.f.destroyed, 1); assert.match(await openSecret(null, x.rows.get('tenant-a').sealed), /RT3/);
  assert.ok(x.ledger.granted > 0 && x.ledger.grants.every((g) => g === 'computer_refund'), 'unused prepaid time goes back'); assert.ok(x.ledger.granted < RATE_NANO_PER_SEC * 60);
  assert.equal((await x.e.status()).running, false);
});
test('idle: a start right after a deploy reset notices a container that exited, and reattaches one that runs', async () => {
  const x = setup(); await x.e.warm(); x.container.running = false;
  const again = new ClaudeEngine(x.ctx, x.env); assert.equal(again.get('ready'), '0');
  const y = setup(); await y.e.warm(); const re = new ClaudeEngine(y.ctx, y.env); assert.equal(re.get('ready'), '1');
});

test('metering: a start prepays a minute through the ledger at the basic rate, and out of credits refuses the start', async () => {
  assert.equal(RATE_NANO_PER_SEC, Math.ceil((1 * 0.0000025 + 0.25 * 0.000020 + 4 * 0.00000007) * 1e9 * 1.15));
  const x = setup(); await x.e.warm(); assert.equal(x.ledger.reserved, 1); await x.e.warm(); assert.equal(x.ledger.reserved, 1, 'a running container is not paid for twice');
  x.e.put('paid_until', Date.now() + 10e3); await x.e.alarm(); assert.equal(x.ledger.reserved, 2, 'the alarm prepays the next minute');
  const y = setup(); y.ledger.ok = false; const w = await y.e.warm(); assert.deepEqual({ ok: w.ok, error: w.error, status: w.status }, { ok: false, error: 'out_of_credits', status: 402 }); assert.equal(y.f.starts, 0);
  y.e.put('last_activity', Date.now()); const z = setup(); await z.e.warm(); z.ledger.ok = false; z.e.put('paid_until', 0); await z.e.alarm(); assert.equal(z.container.running, false, 'out of credits during idle stops the container');
});
test('start: a capacity refusal is retried briefly, then reported in plain words', async () => {
  const ok = setup({ capacityFails: 1 }); assert.equal((await ok.e.warm()).ok, true); assert.ok(ok.f.starts >= 2);
  const bad = setup({ capacityFails: 1e6 }); const w = await bad.e.warm(); assert.equal(w.ok, false); assert.match(w.error, /computers are busy/); assert.ok(bad.ledger.granted > 0, 'the prepaid minute is refunded');
});
test('nothing secret reaches the event log or status', async () => {
  const x = setup(); await signIn(x); await readAll(await x.e.run({ prompt: 'secret prompt', mcp: MCP, session: 's1' }));
  const log = JSON.stringify((await x.e.debug()).events) + JSON.stringify(await x.e.status());
  for (const s of ['AT1', 'RT1', 'tok-1', 'secret prompt']) assert.ok(!log.includes(s), s);
});

// ---- complete(): one model call for 1Helm's helper loop ----
const CHUNK1 = { id: 'claude-native', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: 'Hel' }, finish_reason: null }] };
const CHUNK2 = { id: 'claude-native', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: null, tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'web_search', arguments: '{}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } };
const RESPONSE = { id: 'msg_1', object: 'chat.completion', choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'web_search', arguments: '{}' } }], reasoning_details: [{ type: 'x' }] } }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } };
const REQ = { messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'hi' }], tools: [{ type: 'function', function: { name: 'web_search', parameters: { type: 'object' } } }] };
test('complete: returns the chat.completion, sends the request to the relay on stdin, saves a refreshed login', async () => {
  const x = setup({ completeLines: [{ t: 'chunk', chunk: CHUNK1 }, { t: 'chunk', chunk: CHUNK2 }, { t: 'final', response: RESPONSE }] }); await signIn(x);
  x.fs.set('/home/node/.claude/.credentials.json', '{"claudeAiOauth":{"accessToken":"AT7","refreshToken":"RT7"}}');
  const r = await x.e.complete({ body: REQ, model: 'sonnet', effort: 'high', session: 'chan:main:t1' });
  assert.deepEqual(r, RESPONSE); assert.deepEqual(x.f.completeArgv, ['node', '/opt/1hc/relay/complete.mjs']);
  assert.deepEqual(x.f.completePayload, { body: REQ, model: 'sonnet', effort: 'high' });
  assert.match(await openSecret(null, x.rows.get('tenant-a').sealed), /RT7/); assert.equal(x.e.inflight, 0); assert.equal(x.e.calls.size, 0);
  assert.ok(!JSON.stringify(x.f.completeArgv).includes('hi'), 'the request is not on a command line');
});
test('complete: with stream it returns Server-Sent Events ending in [DONE]', async () => {
  const x = setup({ completeLines: [{ t: 'chunk', chunk: CHUNK1 }, { t: 'chunk', chunk: CHUNK2 }, { t: 'final', response: RESPONSE }] }); await signIn(x);
  const text = await readAll(await x.e.complete({ body: REQ, stream: true }));
  assert.equal(text, `data: ${JSON.stringify(CHUNK1)}\n\ndata: ${JSON.stringify(CHUNK2)}\n\ndata: [DONE]\n\n`);
  assert.equal(x.e.inflight, 0);
});
test('complete: errors keep the status and a code the caller can act on', async () => {
  const err = { t: 'error', error: { message: 'Claude is signed out on this account.', status: 401, code: 'not_signed_in' } };
  const x = setup({ completeLines: [err] }); await signIn(x);
  await assert.rejects(() => x.e.complete({ body: REQ }), (e) => e.status === 401 && e.code === 'not_signed_in' && /signed out/.test(e.message)); assert.equal(x.e.inflight, 0);
  const y = setup({ completeLines: [{ t: 'chunk', chunk: CHUNK1 }, err] }); await signIn(y);
  const s = (await y.e.complete({ body: REQ, stream: true })).getReader(); await s.read();
  const ev = dec.decode((await s.read()).value); assert.match(ev, /"code":"not_signed_in"/); await assert.rejects(() => s.read(), (e) => e.status === 401); assert.equal(y.e.inflight, 0);
  const z = setup({ completeLines: [{ t: 'chunk', chunk: CHUNK1 }] }); await signIn(z);
  await assert.rejects(() => z.e.complete({ body: REQ }), (e) => e.status === 503 && /stopped before it finished/.test(e.message));
});
test('complete: refused when not signed in or the input is bad, and a busy container says so', async () => {
  const x = setup(); await assert.rejects(() => x.e.complete({ body: REQ }), (e) => e.status === 401 && e.code === 'not_signed_in'); assert.equal(x.f.starts, 0);
  await signIn(x);
  for (const bad of [{ body: null }, { body: { messages: [] } }, { body: REQ, model: 'a;b' }, { body: REQ, effort: 'ultra' }, { body: REQ, session: 'a b' }]) await assert.rejects(() => x.e.complete(bad), (e) => e.status === 400, JSON.stringify(bad));
  const h = setup({ completeHang: true }); await signIn(h);
  const held = []; for (let i = 0; i < 4; i++) held.push(h.e.complete({ body: REQ, session: 's' + i }));
  await new Promise((r) => setTimeout(r, 20)); await assert.rejects(() => h.e.complete({ body: REQ, session: 'x' }), (e) => e.code === 'engine_busy');
});
test('complete: the container stays awake during a call, cancel stops it, and dropping a stream stops it', async () => {
  const h = setup({ completeHang: true }); await signIn(h);
  const p = h.e.complete({ body: REQ, session: 's1' }); p.catch(() => {}); await new Promise((r) => setTimeout(r, 20));
  assert.equal(h.e.inflight, 1); h.e.put('last_activity', 0); assert.equal((await h.e.stop('idle')).deferred, true);
  assert.deepEqual(await h.e.cancel('s1'), { ok: true }); assert.ok(h.f.killed.includes('complete:15'));
  const s = setup({ completeHang: true }); await signIn(s);
  const st = await s.e.complete({ body: REQ, stream: true, session: 's2' }); assert.equal(s.e.inflight, 1); await st.cancel(); assert.equal(s.e.inflight, 0); assert.ok(s.f.killed.includes('complete:15'));
});

// ---- plan usage (task usage-bars) ----
const LIM = { 'anthropic-ratelimit-unified-status': 'allowed', 'anthropic-ratelimit-unified-5h-utilization': '0.42', 'anthropic-ratelimit-unified-5h-reset': '4102444800', 'anthropic-ratelimit-unified-7d-utilization': '0.1', 'anthropic-ratelimit-unified-7d-reset': '4103000000' };
test('usage: the rate limit headers of a call are kept per account and turned into two windows; the header names go to the event log once', async () => {
  const x = setup({ completeLines: [{ t: 'limits', headers: LIM, status: 200 }, { t: 'final', response: { choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }] } }] }); await signIn(x);
  assert.equal((await x.e.usage()).none, true, 'no headers yet and the container says nothing: no numbers');
  const r = await x.e.complete({ body: { messages: [{ role: 'user', content: 'hi' }] }, model: 'sonnet' });
  assert.equal(r.choices[0].message.content, 'hi', 'the limits line is not part of the answer');
  const u = await x.e.usage(); assert.equal(u.source, 'headers');
  assert.deepEqual(u.windows.map((w) => [w.id, w.label, w.used, w.resets_at]), [['session', '5 hours', 42, 4102444800000], ['weekly', 'This week', 10, 4103000000000]]);
  await x.e.complete({ body: { messages: [{ role: 'user', content: 'again' }] }, model: 'sonnet' });
  const names = (await x.e.debug()).events.filter((ev) => /rate limit headers/.test(ev.what)); assert.equal(names.length, 1); assert.match(names[0].what, /anthropic-ratelimit-unified-5h-utilization/);
});
test('usage: a streamed call keeps the headers too, and a call that fails still records them', async () => {
  const x = setup({ completeLines: [{ t: 'limits', headers: LIM, status: 429 }, { t: 'error', error: { message: 'usage limit reached', status: 429 } }] }); await signIn(x);
  await assert.rejects(() => x.e.complete({ body: { messages: [{ role: 'user', content: 'hi' }] }, model: 'sonnet' }), /usage limit reached/);
  assert.equal((await x.e.usage()).windows.length, 2);
});
test('usage: with no headers, the CLI token is used inside the running container, at most every 5 minutes, and nothing secret is returned', async () => {
  const out = JSON.stringify({ ok: true, data: { five_hour: { utilization: 30, resets_at: '2099-01-01T00:00:00Z' }, seven_day: { utilization: 55, resets_at: '2099-01-05T00:00:00Z' } } }) + '\n';
  const x = setup({ usageOut: out }); await signIn(x);
  const u = await x.e.usage(); assert.equal(u.source, 'oauth'); assert.deepEqual(u.windows.map((w) => [w.id, w.used]), [['session', 30], ['weekly', 55]]);
  assert.equal(x.f.usageRuns, 1); assert.equal(x.f.usageArgs[0], '/opt/1hc/relay/usage.mjs');
  await x.e.usage(); assert.equal(x.f.usageRuns, 1, 'throttled');
  assert.ok(!JSON.stringify(u).includes('AT1'));
});
test('usage: it never starts the container, a refused call is remembered, and signing out forgets the numbers', async () => {
  const y = setup({ usageOut: JSON.stringify({ ok: false, status: 401, why: 'http_401' }) + '\n' }); await signIn(y);
  const u = await y.e.usage(); assert.deepEqual(u, { none: true, why: 'http_401' }); assert.deepEqual(await y.e.usage(), { none: true, why: 'http_401' }); assert.equal(y.f.usageRuns, 1);
  const z = setup(); await z.e.init('tenant-a'); const starts = z.f.starts; assert.deepEqual(await z.e.usage(), { none: true, why: 'asleep' }); assert.equal(z.f.starts, starts, 'asleep: no start');
  const w = setup({ completeLines: [{ t: 'limits', headers: LIM, status: 200 }, { t: 'final', response: { choices: [] } }] }); await signIn(w); await w.e.complete({ body: { messages: [{ role: 'user', content: 'x' }] }, model: 'sonnet' });
  assert.equal((await w.e.usage()).source, 'headers'); await w.e.signOut(); assert.equal((await w.e.usage()).source, undefined);
});
