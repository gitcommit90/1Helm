// node --import ./test/stubs/register.mjs test/transcribe-live-chunks.test.mjs
// Live dictation through AssemblyAI Universal-3.6 Pro (WAV chunks cut at pauses; transcribe-live-chunks.js) behind the same bridge as
// Deepgram: the pause cutter and WAV wrapper, in-order results, billing (usage.cost x 1.15 through the dictation ledger), the fallback to
// Deepgram when a chunk fails (the failed chunk and every later one are replayed, so no audio is lost), and which provider
// transcribeLive picks at each privacy level. Real SQLite Ledger, no network (stt and the Deepgram socket are fakes).
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Ledger } from '../src/index.js';
import { bridgeDictation, transcribeLive, LIVE_MINUTE_NANO, liveCharge } from '../src/transcribe-live.js';
import { ChunkProvider, PauseCutter, wavOf, BLOCK_SAMPLES, MAX_CHUNK_MS } from '../src/transcribe-live-chunks.js';
import { ENDPOINTS } from '../src/privacy.js';
import { ID, SEED, withSettings } from './helpers/seed-settings.mjs';

const dbs = [];
function ledger() {
  const db = new DatabaseSync(':memory:'); dbs.push(db);
  const sql = { exec(q, ...a) {
    if (!a.length && q.split(';').filter(x => x.trim()).length > 1) { db.exec(q); return { toArray: () => [] }; }
    const st = db.prepare(q), rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []);
    return { toArray: () => rows, one: () => rows[0] };
  } };
  const L = new Ledger({ storage: { sql } }, {}); L.sql.exec("INSERT INTO grants VALUES ('test',1000000000,'topup',?)", Date.now()); return L;
}
class Socket extends EventTarget {
  sent = []; closed = false; accepted = false;
  accept() { this.accepted = true; }
  send(d) { if (this.closed) throw Error('closed'); this.sent.push(d); }
  close() { if (!this.closed) { this.closed = true; this.dispatchEvent(new Event('close')); } }
  msg(d) { this.dispatchEvent(new MessageEvent('message', { data: d })); }
  json(d) { this.msg(JSON.stringify(d)); }
  events() { return this.sent.filter(x => typeof x === 'string').map(x => JSON.parse(x)); }
}
// 16 kHz mono PCM16: a loud tone for speech, faint noise for a pause.
const tone = (sec, amp = 6000) => { const n = Math.round(sec * 16000), b = new Int16Array(n); for (let i = 0; i < n; i++) b[i] = Math.round(amp * Math.sin(i * 0.2)); return new Uint8Array(b.buffer); };
const quiet = sec => { const n = Math.round(sec * 16000), b = new Int16Array(n); for (let i = 0; i < n; i++) b[i] = (i * 7919 % 41) - 20; return new Uint8Array(b.buffer); };
const cat = (...p) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let at = 0; for (const x of p) { o.set(x, at); at += x.length; } return o; };
const feedAll = (c, pcm) => { for (let o = 0; o < pcm.length; o += 3200) c.feed(pcm.subarray(o, Math.min(pcm.length, o + 3200))); };
const tick = () => new Promise(r => setImmediate(r));
const settle = async (fn, ms = 2000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw Error('timeout'); await tick(); } };
function clock() { let at = 1000, i = 0; const timers = new Map(); return { now: () => at, advance: ms => { at += ms; }, setInterval: fn => { timers.set(++i, fn); return i; }, setTimeout: fn => { timers.set(++i, fn); return i; }, clearInterval: id => timers.delete(id), clearTimeout: id => timers.delete(id) }; }
let checks = 0; const test = async (name, fn) => { await fn(); console.log(`ok ${++checks} - ${name}`); };

try {
  await test('wavOf: a 16 kHz mono 16-bit WAV header around the exact PCM bytes', () => {
    const pcm = tone(0.5), w = wavOf(pcm), v = new DataView(w.buffer);
    assert.equal(w.length, 44 + pcm.length); assert.equal(String.fromCharCode(...w.slice(0, 4)), 'RIFF'); assert.equal(String.fromCharCode(...w.slice(8, 16)), 'WAVEfmt ');
    assert.equal(v.getUint32(4, true), 36 + pcm.length); assert.equal(v.getUint16(20, true), 1); assert.equal(v.getUint16(22, true), 1); assert.equal(v.getUint32(24, true), 16000);
    assert.equal(v.getUint32(28, true), 32000); assert.equal(v.getUint16(34, true), 16); assert.equal(v.getUint32(40, true), pcm.length); assert.deepEqual(w.slice(44), pcm);
  });

  await test('pause cutter: cuts after a 0.5 s pause, keeps every sample of speech, drops a long silence, skips silent chunks, flushes the tail', () => {
    const got = [], c = new PauseCutter(x => got.push(x));
    const s1 = tone(2), s2 = tone(1.5), s3 = tone(0.8);
    feedAll(c, cat(quiet(3), s1, quiet(0.3), s2, quiet(0.8), s3));   // 3 s of nothing, a phrase, a 0.3 s gap (no cut), a phrase, a 0.8 s pause (cut), then a last phrase
    assert.equal(got.length, 1, 'only the 0.8 s pause cut a chunk; the 3 s of silence at the start sent nothing');
    assert.ok(Math.abs(got[0].start - 2.6) < 0.05, `the long silence before speech is dropped down to its last 400 ms (start ${got[0].start})`);
    const voiced = got[0].pcm; assert.ok(voiced.length >= (2 + 0.3 + 1.5) * 32000 - 640);
    const find = (buf, part) => { for (let i = 0; i + part.length <= buf.length; i += 2) { let k = 0; while (k < 64 && buf[i + k] === part[k]) k++; if (k === 64) return i; } return -1; };
    assert.ok(find(voiced, s1) >= 0 && find(voiced, s2.subarray(0, 1600)) >= 0, 'both phrases are inside the one chunk, whole');
    c.flush(); assert.equal(got.length, 2, 'flush sends the trailing speech'); assert.ok(got[1].start > got[0].start); assert.ok(got[1].pcm.length >= s3.length - 640);
    c.flush(); assert.equal(got.length, 2);
    const silent = [], d = new PauseCutter(x => silent.push(x)); feedAll(d, quiet(5)); d.flush(); assert.equal(silent.length, 0, 'pure silence never becomes a request');
  });

  await test('pause cutter: speech with no pause is cut at the quietest point after 8 s; no sample lost or repeated', () => {
    const got = [], c = new PauseCutter(x => got.push(x)), speech = cat(tone(5), quiet(0.12), tone(6), quiet(0.12), tone(5));   // 16 s with two 120 ms dips
    feedAll(c, speech); c.flush();
    assert.ok(got.length >= 2 && got.every(x => x.pcm.length <= MAX_CHUNK_MS / 1000 * 32000 + 640 * 8), `chunks stay near the 8 s cap (${got.map(x => (x.pcm.length / 32000).toFixed(1))})`);
    const all = cat(...got.map(x => x.pcm)); assert.equal(all.length, speech.length - (speech.length % (BLOCK_SAMPLES * 2)) + (speech.length % (BLOCK_SAMPLES * 2) ? 0 : 0), 'every sample is in some chunk');
    assert.deepEqual(all, speech.slice(0, all.length), 'the chunks are the audio in order, back to back');
    for (let i = 1; i < got.length; i++) assert.ok(Math.abs(got[i].start - (got[i - 1].start + got[i - 1].pcm.length / 32000)) < 0.001, 'each chunk starts where the previous ended');
    assert.ok(Math.abs(got[0].pcm.length / 32000 - 5.12) < 0.02, 'the first cut falls in the first dip');
  });

  // ---- the bridge with a ChunkProvider ----
  const COST = (sec) => sec * 0.0000833333;   // OpenRouter usage.cost, dollars
  async function harness({ fake, fallback = true, deps = {} } = {}) {
    const L = ledger(), c = new Socket(), id = crypto.randomUUID(), calls = [], dg = new Socket(), opened = [];
    await L.dictationLease(id); await L.reserve(`${id}:0`, LIVE_MINUTE_NANO);
    const stt = fake || (async (env, src, o) => { calls.push({ n: src.bytes.length, o }); const sec = (src.bytes.length - 44) / 32000; return { text: `chunk ${calls.length}`, nano: Math.ceil(COST(sec) * 1e9), segs: [], dur: sec, model: o.models[0] }; });
    const provider = new ChunkProvider({ model: ID.STT_BEST, env: {}, meta: { tenant: 't1' }, rate: 83334, liveCharge, stt, tryMs: 50, openFallback: fallback ? async () => { opened.push(1); return dg; } : null, ...deps });
    const proxy = { dictationLease: (...a) => L.dictationLease(...a), reserve: (...a) => L.reserve(...a), settle: (...a) => { calls.push(['settle', ...a]); return L.settle(...a); } };
    const time = clock(), bridge = bridgeDictation(c, provider, proxy, id, time);
    const pcm = async (buf) => { for (let o = 0; o < buf.length; o += 3200) { time.advance(100); c.msg(buf.slice(o, o + 3200).buffer); await bridge.drain(); } };
    return { L, c, dg, id, calls, provider, bridge, opened, pcm, texts: () => c.events().filter(e => e.type === 'transcript') };
  }
  await test('chunks in order as final results; each chunk is a WAV request through stt() for the one model; stop flushes the tail; settled at usage.cost x 1.15; nothing stored', async () => {
    const h = await harness(), audio = cat(tone(2), quiet(0.7), tone(1.5), quiet(0.7), tone(1));   // 1 s tail has no pause after it
    await h.pcm(audio); h.c.json({ type: 'stop' }); await h.bridge.drain(); await settle(() => h.c.events().at(-1)?.type === 'done');
    assert.deepEqual(h.texts().map(e => [e.text, e.final]), [['chunk 1', true], ['chunk 2', true], ['chunk 3', true]]);
    assert.ok(h.texts().every((e, i, a) => !i || (e.revision > a[i - 1].revision && e.id !== a[i - 1].id)));
    const reqs = h.calls.filter(x => !Array.isArray(x)); assert.equal(reqs.length, 3);
    for (const r of reqs) { assert.equal(r.o.format, 'wav'); assert.deepEqual(r.o.models, [ID.STT_BEST]); assert.equal(r.o.headers['cf-aig-collect-log'], 'false'); assert.deepEqual(r.o.meta, { tenant: 't1' }); }
    const secs = reqs.reduce((n, r) => n + (r.n - 44) / 32000, 0), want = Math.ceil(reqs.reduce((n, r) => n + Math.ceil(COST((r.n - 44) / 32000) * 1e9), 0) * 1.15);
    assert.equal(h.L.totals().spent_nano, want, 'settled at the answers\' real cost x 1.15'); assert.equal(h.L.totals().reserved_nano, 0);
    assert.ok(secs > 4 && want < LIVE_MINUTE_NANO / 2, 'about 4.9 s of audio cost well under the one-minute Deepgram hold');
    assert.deepEqual(await h.L.history(10), []); assert.equal(h.L.one('SELECT count(*) n FROM dictation_lease').n, 0);
  });

  await test('one minute of AssemblyAI audio never costs more than the hold the bridge reserved', () => {
    assert.ok(Math.ceil(60 * 83334 * 1.15) < LIVE_MINUTE_NANO, `${Math.ceil(60 * 83334 * 1.15)} < ${LIVE_MINUTE_NANO}`);
  });

  await test('a chunk fails once (error, not timeout) → retried at once, the session stays on AssemblyAI', async () => {
    let n = 0; const fake = async (e, src, o) => { n++; if (n === 1) throw Object.assign(new Error('502'), { nano: 0 }); return { text: 'second try', nano: 1000, segs: [], dur: 1, model: o.models[0] }; };
    const h = await harness({ fake }); await h.pcm(cat(tone(1), quiet(0.7))); await settle(() => h.texts().length === 1);
    assert.equal(h.texts()[0].text, 'second try'); assert.equal(h.opened.length, 0); assert.equal(n, 2);
    h.c.json({ type: 'stop' }); await settle(() => h.c.events().at(-1)?.type === 'done'); assert.equal(h.L.totals().spent_nano, Math.ceil(1000 * 1.15));
  });

  await test('a chunk times out → Deepgram takes over with the failed chunk and every later chunk replayed, results continue in order, billing adds both', async () => {
    const a1 = tone(1.2), a2 = tone(1.3), a3 = tone(1.1), a4 = tone(0.9);
    let n = 0; const fake = async (e, src, o) => { n++; if (n === 1) return { text: 'first', nano: 100000, segs: [], dur: 1.2, model: o.models[0] }; throw Object.assign(new Error('timed out'), { timeout: true, nano: 55000 }); };
    const h = await harness({ fake }); const gap = quiet(0.7);
    await h.pcm(cat(a1, gap)); await settle(() => h.texts().length === 1);
    await h.pcm(cat(a2, gap, a3, gap, a4)); await settle(() => h.opened.length === 1 && h.dg.sent.length > 0);   // chunk 2 failed, chunks 3 and 4 are in flight or waiting
    const replay = cat(...h.dg.sent.filter(x => typeof x !== 'string').map(x => new Uint8Array(x))); assert.ok(h.dg.sent.every(x => typeof x === 'string' || x.byteLength <= 16384));
    const expect = cat(gap.slice(16000), a2, gap, a3, gap, a4);   // the first chunk was cut 0.5 s into its pause; the last 0.2 s of that pause starts the next one
    const blocks = BLOCK_SAMPLES * 2;
    assert.deepEqual(replay.slice(0, expect.length - (expect.length % blocks)), expect.slice(0, expect.length - (expect.length % blocks)), 'the failed chunk and everything after it reach Deepgram, in order, none missing');
    // Deepgram answers (its clock starts at 0 on the new socket); the bridge sees them shifted to where the failed chunk began
    h.dg.json({ type: 'Results', start: 0, is_final: false, channel: { alternatives: [{ transcript: 'second chunk par' }] } });
    h.dg.json({ type: 'Results', start: 0, is_final: true, channel: { alternatives: [{ transcript: 'second chunk part' }] } });
    await settle(() => h.texts().length === 3);
    assert.deepEqual(h.texts().map(e => [e.text, e.final]), [['first', true], ['second chunk par', false], ['second chunk part', true]]);
    assert.ok(Number(h.texts()[1].id.split(':')[1]) > Number(h.texts()[0].id.split(':')[1]), 'a Deepgram result never has an earlier start than the AssemblyAI text before it');
    h.c.json({ type: 'stop' }); await h.bridge.drain(); await settle(() => h.dg.events().some(e => e.type === 'CloseStream')); h.dg.json({ type: 'Metadata' });
    await settle(() => h.c.events().at(-1)?.type === 'done');
    const dgBytes = replay.length; assert.ok(dgBytes > 0);
    assert.equal(h.L.totals().spent_nano, Math.min(LIVE_MINUTE_NANO, Math.ceil((100000 + 55000) * 1.15) + liveCharge(dgBytes)) , 'AssemblyAI answer + what the timed-out attempt may have cost, x 1.15, plus Deepgram\'s per-minute price for the replayed and later audio');
    assert.equal(h.L.totals().reserved_nano, 0);
  });

  await test('a chunk fails and there is no fallback (not allowed or not set up) → plain error, text so far stays, lease and hold released', async () => {
    let n = 0; const fake = async (e, src, o) => { n++; if (n === 1) return { text: 'kept', nano: 1000, segs: [], dur: 1, model: o.models[0] }; throw Object.assign(new Error('timed out'), { timeout: true, nano: 0 }); };
    const h = await harness({ fake, fallback: false }); await h.pcm(cat(tone(1), quiet(0.7), tone(1), quiet(0.7)));
    await settle(() => h.c.events().at(-1)?.type === 'error'); assert.equal(h.texts()[0].text, 'kept'); assert.match(h.c.events().at(-1).message, /speech service could not continue/);
    assert.equal(h.L.totals().reserved_nano, 0); assert.equal(h.L.one('SELECT count(*) n FROM dictation_lease').n, 0);
  });

  await test('the client closing mid-request counts the chunk that may have been billed, and aborts it', async () => {
    let signal; const fake = (e, src, o) => new Promise((_, no) => { signal = o.signal; o.signal.addEventListener('abort', () => no(Object.assign(new Error('aborted'), { name: 'AbortError', timeout: true, nano: 0 }))); });
    const h = await harness({ fake }); await h.pcm(cat(tone(2), quiet(0.7))); await settle(() => !!signal);
    h.c.close(); await h.bridge.drain(); await settle(() => h.L.totals().reserved_nano === 0 && h.L.totals().spent_nano > 0);
    assert.equal(signal.aborted, true);
    assert.ok(h.L.totals().spent_nano >= Math.ceil(2 * 83334 * 1.15), `at least the 2 s of speech at AssemblyAI's price (${h.L.totals().spent_nano})`);
  });

  // ---- which provider transcribeLive picks ----
  const base = 'https://selfhost.example', req = () => new Request(base + '/w/ck1/api/transcribe/live', { headers: { Origin: base, Upgrade: 'websocket' } });
  class Pair { constructor() { this[0] = new Socket(); this[1] = new Socket(); } }
  class UpgradeResponse { constructor(_b, init) { Object.assign(this, init); } }
  const dbFor = level => ({ prepare: () => ({ bind: () => ({ first: async () => ({ ai_privacy: level }) }) }) });
  async function route(envExtra, { level = 'zdr', dgFails = false } = {}) {
    const L = ledger(), seen = { gateway: 0 }, upstream = new Socket();
    const env = withSettings({ DB: dbFor(level), ...envExtra });
    const r = await transcribeLive(req(), env, L, { tenant: 't1' }, { WebSocketPair: Pair, Response: UpgradeResponse, fetch: async () => { seen.gateway++; return dgFails ? { status: 500 } : { status: 101, webSocket: upstream }; } });
    return { r, seen, L };
  }
  const GW = { AIG_TOKEN: 'x', AIG_ID: 'g', CF_ACCOUNT_ID: 'a' }, KEY = { OPENROUTER_API_KEY: 'or-test' };
  await test('live job order: AssemblyAI (chunks, no gateway socket) at every privacy level; Deepgram when AssemblyAI is not allowed or has no key', async () => {
    assert.deepEqual([SEED.jobs.live_dictation.model, SEED.jobs.live_dictation.fallbacks.map(f => f.model)], [ID.STT_BEST, [ID.LIVE]]);
    for (const level of ['unrestricted', 'no_training', 'zdr']) { const x = await route({ ...KEY, ...GW }, { level }); assert.equal(x.r.status, 101, level); assert.equal(x.seen.gateway, 0, `${level}: AssemblyAI needs no Deepgram socket`); }
    const noKey = await route({ ...GW }); assert.equal(noKey.r.status, 101); assert.equal(noKey.seen.gateway, 1, 'no OpenRouter key → Deepgram');
    const real = ENDPOINTS.transcription[ID.STT_BEST];
    try {
      ENDPOINTS.transcription[ID.STT_BEST] = { assemblyai: { zdr: false, training: false } };
      const z = await route({ ...KEY, ...GW }, { level: 'zdr' }); assert.equal(z.r.status, 101); assert.equal(z.seen.gateway, 1, 'a non-ZDR AssemblyAI is not used at the ZDR level: Deepgram answers');
      const u = await route({ ...KEY, ...GW }, { level: 'unrestricted' }); assert.equal(u.seen.gateway, 0, 'but a registry entry that is allowed at the level is used');
      ENDPOINTS.transcription[ID.STT_BEST] = { assemblyai: { zdr: false, training: true } };
      assert.equal((await route({ ...KEY, ...GW }, { level: 'no_training' })).seen.gateway, 1, 'a training endpoint is refused at No Training');
      delete ENDPOINTS.transcription[ID.STT_BEST];
      assert.equal((await route({ ...KEY, ...GW }, { level: 'unrestricted' })).seen.gateway, 1, 'an unregistered model is never used');
      const none = await route({ ...KEY }); assert.equal(none.r.status, 451, 'AssemblyAI blocked by privacy and Deepgram has no gateway → unavailable with your privacy setting');
    } finally { ENDPOINTS.transcription[ID.STT_BEST] = real; }
    const nothing = await route({}); assert.equal(nothing.r.status, 503); assert.equal((await route({ ...KEY, ...GW }, { level: 'zdr' })).r.status, 101);
  });
  await test('Deepgram-only sessions are unchanged: first model Deepgram → WebSocket through the gateway, same ready message', async () => {
    const s = JSON.parse(JSON.stringify(SEED)); s.jobs.live_dictation = { model: ID.LIVE, effort: null, fallbacks: [] };
    const L = ledger(), upstream = new Socket(), sockets = []; class P2 { constructor() { this[0] = new Socket(); this[1] = new Socket(); sockets.push(this[1]); } }
    const r = await transcribeLive(req(), withSettings({ DB: dbFor('zdr'), ...KEY, ...GW }, s), L, { tenant: 't1' }, { WebSocketPair: P2, Response: UpgradeResponse, fetch: async () => ({ status: 101, webSocket: upstream }) });
    assert.equal(r.status, 101); assert.equal(upstream.accepted, true); assert.equal(sockets[0].events()[0].type, 'ready');
  });
  console.log(`PASS live dictation chunks: ${checks} groups. No external requests.`);
} finally { for (const db of dbs) db.close(); }
