// node --import ./test/stubs/register.mjs test/transcribe-live.test.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import worker, { Ledger } from '../src/index.js';
import { bridgeDictation, transcribeLive, boundedDictationLedger, LIVE_MODEL, LIVE_MINUTE_NANO, liveCharge, liveProviderRequest } from '../src/transcribe-live.js';
import { ENDPOINTS } from '../src/privacy.js';
const dbs = [];
function sqlDB() {
  const db = new DatabaseSync(':memory:'); dbs.push(db);
  const sql = { exec(q, ...a) {
    if (!a.length && q.split(';').filter(x => x.trim()).length > 1) { db.exec(q); return { toArray: () => [] }; }
    const st = db.prepare(q), rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []);
    return { toArray: () => rows, one: () => rows[0] };
  } }; return { db, sql };
}
function ledger() { const { db, sql } = sqlDB(), L = new Ledger({ storage: { sql } }, {}); L.sql.exec("INSERT INTO grants VALUES ('test',1000000000,'topup',?)", Date.now()); return { L, db }; }
class Socket extends EventTarget {
  sent = []; closed = false; accepted = false;
  accept() { this.accepted = true; this.binaryTypeAtAccept = this.binaryType; }
  send(data) { if (this.closed) throw Error('closed'); this.sent.push(data); }
  close() { if (!this.closed) { this.closed = true; this.dispatchEvent(new Event('close')); } }
  msg(data) { this.dispatchEvent(new MessageEvent('message', { data })); }
  json(data) { this.msg(JSON.stringify(data)); }
  events() { return this.sent.filter(x => typeof x === 'string').map(x => JSON.parse(x)); }
}
function clock() { let at = 1000, i = 0; const timers = new Map(); return { now: () => at, advance: ms => { at += ms; }, setInterval: fn => { timers.set(++i, fn); return i; }, setTimeout: fn => { timers.set(++i, fn); return i; }, clearInterval: id => timers.delete(id), clearTimeout: id => timers.delete(id), tick: async () => { for (const fn of [...timers.values()]) await fn(); }, timers }; }
async function harness(extra = {}) {
  const { L, db } = ledger(), c = new Socket(), p = new Socket(), time = clock(), id = crypto.randomUUID(), calls = [];
  await L.dictationLease(id); await L.reserve(`${id}:0`, LIVE_MINUTE_NANO);
  const proxy = { dictationLease: (...a) => L.dictationLease(...a), reserve: (...a) => { calls.push(['reserve', ...a]); return L.reserve(...a); }, settle: (...a) => { calls.push(['settle', ...a]); return L.settle(...a); } };
  const bridge = bridgeDictation(c, p, proxy, id, { ...time, ...extra });
  return { L, db, c, p, time, id, calls, bridge, async pcm(n = 3200) { time.advance(n / 32); c.msg(new ArrayBuffer(n)); await bridge.drain(); }, async stop() { c.json({ type: 'stop' }); await bridge.drain(); p.json({ type: 'Metadata' }); await bridge.drain(); } };
}
let checks = 0; const test = async (name, fn) => { await fn(); console.log(`ok ${++checks} - ${name}`); };
try {
  await test('real SQLite lease atomic/reload-safe, release only matching id, expired lease recoverable', async () => {
    const { L } = ledger(); assert.equal(L.dictationLease('a').ok, true); assert.equal(L.dictationLease('b').ok, false);
    L.dictationLease('b', true); assert.equal(L.dictationLease('b').ok, false);
    L.dictationLease('a', true); assert.equal(L.dictationLease('b').ok, true);
    L.sql.exec('UPDATE dictation_lease SET until=0'); assert.equal(L.dictationLease('c').ok, true);
  });
  await test('normalization: revised interim, shorter final, duplicate/older final ignored, empty final retains text', async () => {
    const h = await harness(), result = (start, text, is_final = false) => h.p.json({ type: 'Results', start, is_final, channel: { alternatives: [{ transcript: text }] } });
    result(0, 'one'); result(0, 'one two'); result(0, 'one', true); result(0, 'bad', true); result(0, 'older');
    result(1, 'two'); result(1, '', true); result(0.5, 'out of order');
    const events = h.c.events().filter(e => e.type === 'transcript');
    assert.deepEqual(events.map(e => [e.id, e.revision, e.text, e.final]), [['0:0', 1, 'one', false], ['0:0', 2, 'one two', false], ['0:0', 3, 'one', true], ['0:1', 4, 'two', false], ['0:1', 5, 'two', true]]);
    await h.stop(); assert.equal(h.c.events().at(-1).type, 'done');
  });
  await test('15 seconds silent PCM never ends mic; stop flushes trailing result; duplicate stop/close settles once, no history', async () => {
    const h = await harness(); for (let i = 0; i < 160; i++) await h.pcm();
    assert.equal(h.c.closed, false); assert.equal(h.p.sent.length, 160);
    h.c.json({ type: 'stop' }); h.c.json({ type: 'stop' }); await h.bridge.drain();
    h.p.json({ type: 'Results', start: 0, is_final: true, channel: { alternatives: [{ transcript: 'last words' }] } });
    h.p.json({ type: 'Metadata', duration: 999999 }); await h.bridge.drain(); h.c.close(); h.p.close(); await h.bridge.drain();
    assert.equal(h.calls.filter(x => x[0] === 'settle').length, 1);
    assert.equal(h.L.totals().spent_nano, liveCharge(160 * 3200)); assert.equal(h.L.totals().reserved_nano, 0);
    assert.deepEqual(await h.L.history(20), []); assert.equal(h.L.one('SELECT count(*) n FROM dictation_lease').n, 0);
    assert.equal(h.c.events().at(-2).text, 'last words'); assert.equal(h.c.events().at(-1).type, 'done');
  });
  await test('rolling window permits > five minutes without silence cutoff; audio-byte costs and reserves bounded', async () => {
    const h = await harness(); for (let i = 0; i < 3700; i++) { await h.pcm(); if (i % 150 === 0) { await h.time.tick(); await h.bridge.drain(); } }
    assert.equal(h.c.closed, false); assert.ok(h.calls.filter(x => x[0] === 'reserve').length >= 6);
    assert.ok(h.L.totals().reserved_nano <= LIVE_MINUTE_NANO); await h.stop();
    assert.ok(Math.abs(h.L.totals().spent_nano - liveCharge(3700 * 3200)) <= 8); assert.equal(h.L.totals().reserved_nano, 0);
  });
  await test('next-window refusal sends no uncovered audio and releases lease', async () => {
    const h = await harness(); h.L.sql.exec('DELETE FROM grants');
    for (let i = 0; i < 601; i++) await h.pcm();
    assert.equal(h.p.sent.filter(x => x instanceof ArrayBuffer).length, 600); assert.equal(h.c.events().at(-1).type, 'error');
    assert.equal(h.L.totals().spent_nano, LIVE_MINUTE_NANO); assert.equal(h.L.totals().reserved_nano, 0);
  });
  await test('oversized/odd frames, malformed controls, rate flood and slow provider fail boundedly', async () => {
    for (const bad of [new ArrayBuffer(16386), new ArrayBuffer(3), '{bad', JSON.stringify({ type: 'audio', seconds: 1 })]) {
      const h = await harness(); h.c.msg(bad); await h.bridge.drain(); assert.equal(h.c.events().at(-1).type, 'error'); assert.equal(h.L.totals().spent_nano, 0);
    }
    const h = await harness(); for (let i = 0; i < 2000; i++) h.c.msg(new ArrayBuffer(16000)); await h.bridge.drain();
    assert.ok(h.p.sent.length <= 4); assert.equal(h.c.events().at(-1).type, 'error');
    const slow = await harness(); slow.p.bufferedAmount = 300000; await slow.pcm(); assert.equal(slow.c.closed, true); assert.equal(slow.L.totals().spent_nano, 0);
  });
  await test('startup credit survives first frame, is spent only once, never refills beyond normal burst, exact byte billing', async () => {
    const h = await harness({ startupAudioBytes: 256000 });
    assert.deepEqual(h.c.events()[0], { type: 'ready', startup_audio_bytes: 256000 });
    for (let i = 0; i < 16; i++) { h.c.msg(new ArrayBuffer(16000)); await h.bridge.drain(); }
    assert.equal(h.c.closed, false); assert.equal(h.p.sent.length, 16, 'all eight seconds of startup audio reach provider');
    h.time.advance(10000);
    for (let i = 0; i < 4; i++) { h.c.msg(new ArrayBuffer(16000)); await h.bridge.drain(); }
    h.c.msg(new ArrayBuffer(2)); await h.bridge.drain();
    assert.match(h.c.events().at(-1).message, /too quickly/);
    assert.equal(h.p.sent.length, 20, 'subsequent idle time earns only ordinary two-second burst');
    assert.equal(h.L.totals().spent_nano, liveCharge(320000)); assert.equal(h.L.totals().reserved_nano, 0);
    const retained = await harness({ startupAudioBytes: 256000 });
    retained.c.msg(new ArrayBuffer(16000)); await retained.bridge.drain(); retained.time.advance(10000);
    for (let i = 0; i < 15; i++) { retained.c.msg(new ArrayBuffer(16000)); await retained.bridge.drain(); }
    retained.c.msg(new ArrayBuffer(2)); await retained.bridge.drain();
    assert.equal(retained.p.sent.length, 16, 'waiting while above ordinary bucket does not top up spent startup credit');
    const regular = await harness({ startupAudioBytes: 128000 });
    for (let i = 0; i < 8; i++) { regular.c.msg(new ArrayBuffer(16000)); await regular.bridge.drain(); }
    for (let i = 0; i < 30; i++) await regular.pcm();
    assert.equal(regular.c.closed, false, 'ordinary32KB/s continues after initial credit'); await regular.stop();
  });
  await test('disconnect and final-flush timeout clean up once; dead transport is distinct from silence', async () => {
    const h = await harness(); await h.pcm(); h.p.close(); await h.bridge.drain(); assert.equal(h.c.events().at(-1).type, 'error'); assert.equal(h.calls.filter(x => x[0] === 'settle').length, 1);
    const f = await harness(); await f.pcm(); f.c.json({ type: 'stop' }); await f.bridge.drain(); await f.time.tick(); await f.bridge.drain(); assert.equal(f.c.events().at(-1).type, 'error');
    const dead = await harness(); dead.time.advance(46000); await dead.time.tick(); await dead.bridge.drain(); assert.equal(dead.c.closed, true);
    const suspended = await harness(); suspended.L.sql.exec("UPDATE dictation_lease SET id='another-tab'"); suspended.time.advance(46000); await suspended.pcm();
    assert.equal(suspended.p.sent.length, 0, 'resumed audio cannot bypass a lease taken by another tab'); assert.equal(suspended.c.closed, true);
    assert.equal(suspended.L.one('SELECT id FROM dictation_lease').id, 'another-tab', 'old connection cannot delete the new lease');
    const invalid = await harness(); invalid.p.msg('null'); await invalid.bridge.drain(); assert.equal(invalid.c.events().at(-1).type, 'error');
  });
  await test('bounded accounting waits, late reservations cleaned, and disconnect settlement registered with waitUntil', async () => {
    let resolve, settled = [], kept = [];
    const L = boundedDictationLedger({ reserve: () => new Promise(r => { resolve = r; }), settle: async (...a) => settled.push(a) }, { rpcTimeoutMs: 10, waitUntil: p => kept.push(p) });
    await assert.rejects(L.reserve('late', 10), /timeout/); resolve({ ok: true }); await Promise.all(kept); assert.deepEqual(settled, [['late', 0]]);
    const { L: real } = ledger(), c = new Socket(), p = new Socket(), id = 'cleanup', time = clock(); kept = [];
    await real.reserve(id + ':0', LIVE_MINUTE_NANO);
    const b = bridgeDictation(c, p, real, id, { ...time, waitUntil: promise => kept.push(promise) });
    c.close(); await b.drain(); await Promise.all(kept); assert.ok(kept.length > 0); assert.equal(real.totals().reserved_nano, 0);
  });

  const base = 'https://owner.example.com', env = { AIG_TOKEN: 'dummy-secret', AIG_ID: '1hc-dev', CF_ACCOUNT_ID: 'account', AIG_LOG_PAYLOADS: '1' };
  const req = (headers = {}, method = 'GET') => new Request(base + '/w/ck1/api/transcribe/live', { method, headers: { Origin: base, Upgrade: 'websocket', ...headers } });
  await test('exact provider URL/privacy despite Dev payload logging; input gates before reserves; unavailable registry fails closed', async () => {
    const spec = liveProviderRequest(env), url = new URL(spec.url); assert.equal(url.searchParams.get('mip_opt_out'), 'true'); assert.equal(url.searchParams.get('interim_results'), 'true');
    for (const k of ['cf-aig-collect-log', 'cf-aig-collect-log-payload']) assert.equal(spec.headers[k], 'false'); assert.equal(spec.headers['cf-aig-skip-cache'], 'true');
    const L = { dictationLease() { throw Error('must not reserve'); } };
    assert.equal((await transcribeLive(req(), env, L, { look: true })).status, 403);
    assert.equal((await transcribeLive(req({}, 'POST'), env, L)).status, 405);
    for (const Origin of ['', 'null', 'https://evil.example']) assert.equal((await transcribeLive(req({ Origin }), env, L)).status, 403);
    assert.equal((await transcribeLive(req({ Upgrade: '' }), env, L)).status, 426);
    const ep = ENDPOINTS.transcription[LIVE_MODEL]; delete ENDPOINTS.transcription[LIVE_MODEL];
    try { assert.equal((await transcribeLive(req(), env, L)).status, 451); } finally { ENDPOINTS.transcription[LIVE_MODEL] = ep; }
  });
  await test('initial connect failures release money/lease, out of credits and concurrent start never contact provider', async () => {
    const { L } = ledger(); let fetched = 0; const deps = { fetch: async () => { fetched++; throw Error('secret provider details'); } };
    const response = await transcribeLive(req(), env, L, {}, deps); assert.equal(response.status, 503); assert.ok(!(await response.text()).includes('secret'));
    assert.equal(L.totals().reserved_nano, 0); assert.equal(L.totals().spent_nano, 0); assert.equal(L.one('SELECT count(*) n FROM dictation_lease').n, 0);
    L.dictationLease('other'); assert.equal((await transcribeLive(req(), env, L, {}, deps)).status, 409); L.dictationLease('other', true);
    L.sql.exec('DELETE FROM grants'); assert.equal((await transcribeLive(req(), env, L, {}, deps)).status, 402); assert.equal(fetched, 1);
    const committed = ledger().L;
    const broken = { dictationLease: (...a) => committed.dictationLease(...a), reserve: async (...a) => { await committed.reserve(...a); throw Error('lost ack'); }, settle: (...a) => committed.settle(...a) };
    assert.equal((await transcribeLive(req(), env, broken, {}, deps)).status, 503); assert.equal(committed.totals().reserved_nano, 0); assert.equal(committed.totals().spent_nano, 0); assert.equal(fetched, 1);
  });
  await test('successful handshake accepts sockets and emits ready; audio/credentials never persisted', async () => {
    const { L } = ledger(), sockets = [], upstream = new Socket(), time = clock();
    class Pair { constructor() { this[0] = new Socket(); this[1] = new Socket(); sockets.push(this[0], this[1]); } }
    class UpgradeResponse { constructor(_body, init) { Object.assign(this, init); } }
    const r = await transcribeLive(req(), env, L, {}, { ...time, WebSocketPair: Pair, Response: UpgradeResponse, fetch: async (_url, init) => { assert.equal(init.headers['cf-aig-collect-log-payload'], 'false'); return { status: 101, webSocket: upstream }; } });
    assert.equal(r.status, 101); assert.equal(sockets[1].accepted, true); assert.equal(upstream.accepted, true); assert.deepEqual(sockets[1].events(), [{ type: 'ready', startup_audio_bytes: 64000 }]);
    assert.equal(sockets[1].binaryTypeAtAccept, 'arraybuffer', 'Workers binary delivery selected before accept');
    sockets[1].close(); await new Promise(r => setImmediate(r)); assert.equal(L.totals().reserved_nano, 0); assert.deepEqual(await L.history(10), []);
  });
  await test('handshake grant uses measured server delay only, even-byte max8s, client supplied credit ignored', async () => {
    for (const [delay, grant] of [[0, 64000], [0.1, 64002], [3000, 160000], [20000, 256000], [-1000, 64000]]) {
      const { L } = ledger(), sockets = [], time = clock(), upstream = new Socket();
      class Pair { constructor() { this[0] = new Socket(); this[1] = new Socket(); sockets.push(this[0], this[1]); } }
      class UpgradeResponse { constructor(_body, init) { Object.assign(this, init); } }
      const response = await transcribeLive(req({ 'x-startup-audio-bytes': '999999999' }), env, L, {}, { ...time, startupAudioBytes: 999999999, WebSocketPair: Pair, Response: UpgradeResponse, fetch: async () => { time.advance(delay); return { status: 101, webSocket: upstream }; } });
      assert.equal(response.status, 101); assert.equal(sockets[1].events()[0].startup_audio_bytes, grant);
      let left = grant; while (left) { const n = Math.min(16000, left); sockets[1].msg(new ArrayBuffer(n)); left -= n; }
      await new Promise(r => setImmediate(r));
      assert.equal(upstream.sent.reduce((sum, data) => sum + (data.byteLength || 0), 0), grant);
      sockets[1].msg(new ArrayBuffer(2)); await new Promise(r => setImmediate(r));
      assert.match(sockets[1].events().at(-1).message, /too quickly/);
      assert.equal(L.totals().spent_nano, liveCharge(grant)); assert.equal(L.totals().reserved_nano, 0);
    }
  });
  await test('real Worker owner-only/tenant/paywall/view-as/Origin route boundary', async () => {
    const { db } = sqlDB(); db.exec("CREATE TABLE users(id TEXT,email TEXT); CREATE TABLE sessions(token_hash TEXT,user_id TEXT,expires_at INTEGER); CREATE TABLE tenants(id TEXT,slug TEXT,owner_user_id TEXT,status TEXT,onboarding_completed INTEGER,onboard_step TEXT,slug_chosen INTEGER,helper_name TEXT,first_name TEXT,plan TEXT); INSERT INTO users VALUES('u1','one@example.com'),('u2','two@example.com'),('u3','three@example.com'); INSERT INTO tenants VALUES('t1','ck1','u1','active',1,'',1,'Ollie','One','starter'),('t3','ck3','u3','suspended',1,'',1,'Ollie','Three','starter')");
    for (const [token, user] of [['aa11', 'u1'], ['bb22', 'u2'], ['cc33', 'u3'], ['a'.repeat(80), 'u1']]) db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'), user, Date.now() + 86400000);
    const DB = { prepare(q) { const s = db.prepare(q); let args = []; const o = { bind(...a) { args = a; return o; }, first: async () => s.get(...args) || null, all: async () => ({ results: s.all(...args) }) }; return o; } };
    const E = { ...env, DB, APP_HOST: 'owner.example.com', LEDGER: { idFromName: x => x, get: () => ({ dictationLease: () => ({ ok: false }) }) } };
    const call = (token, slug = 'ck1', origin = base) => worker.fetch(new Request(`${base}/w/${slug}/api/transcribe/live`, { headers: { ...(token ? { cookie: `hc_session=${token}` } : {}), origin, Upgrade: 'websocket' } }), E, { waitUntil() {} });
    assert.equal((await call('')).status, 302); assert.match(await (await call('bb22')).text(), /No 1Helm at this address/);
    assert.equal((await call('cc33', 'ck3')).status, 402); assert.equal((await call('aa11', 'ck1', 'https://evil.example')).status, 403);
    assert.equal((await call('a'.repeat(80))).status, 409) /* public build omits private view-as cookie semantics */; assert.equal((await call('aa11')).status, 409);
  });
  console.log(`PASS live dictation: ${checks} groups, mocked provider + real SQLite/Worker. No external requests.`);
} finally { for (const db of dbs) db.close(); }
