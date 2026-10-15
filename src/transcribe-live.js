// Live composer dictation. Audio/transcripts live only in this socket, never storage or logs. The saved job "live_dictation" lists
// its models in order (AssemblyAI Universal-3.6 Pro, then Deepgram Nova 3, as chosen by the Captain on 2026-10-15). The first one the
// account's AI data privacy setting allows runs the session. AssemblyAI takes whole WAV files only, so it runs through
// transcribe-live-chunks.js (the audio cut at pauses into short chunks); Deepgram Nova 3 is a WebSocket that returns words while
// they are spoken, and it is the fallback when AssemblyAI isn't allowed, can't be used, or fails during the session.
import { ENDPOINTS, endpointOk, eligibleHosts, privacyOf } from './privacy.js';
// transcribe-live-chunks.js, transcribe.js and model-settings.js are imported only where they are used, so a Deepgram-only session loads none of them.
export const PCM_SECOND = 32000, WINDOW_BYTES = PCM_SECOND * 60;
const BURST_BYTES = PCM_SECOND * 2, STARTUP_BYTES_MAX = PCM_SECOND * 8;
// Workers AI Nova-3 realtime: $0.0092/audio minute, usual 15% markup (2026-10-11).
export const LIVE_MINUTE_NANO = 10580000;
export const liveCharge = bytes => Math.ceil(bytes / WINDOW_BYTES * LIVE_MINUTE_NANO);
const fail = (status, error) => Response.json({ error }, { status });
const boundedLedgers = new WeakSet();
// A stuck accounting RPC must not leave socket buffers/close handlers waiting forever.
// Late reserve/acquire acknowledgements are cleaned up by their unique id; persisted holds
// retain the Ledger's existing crash-expiry ceiling if the DO remains unavailable.
export function boundedDictationLedger(ledger, deps = {}) {
  if (boundedLedgers.has(ledger)) return ledger;
  const keep = promise => { const safe = promise.catch(() => {}); deps.waitUntil?.(safe); };
  const call = async (method, args) => {
    let timer, timedOut = false;
    const work = Promise.resolve().then(() => ledger[method](...args));
    keep(work.then(async () => {
      if (!timedOut) return;
      if (method === 'reserve') await ledger.settle(args[0], 0);
      if (method === 'dictationLease' && !args[1]) await ledger.dictationLease(args[0], true);
    }));
    try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; reject(new Error('accounting timeout')); }, deps.rpcTimeoutMs || 7000); })]); }
    finally { clearTimeout(timer); }
  };
  const bound = { reserve: (...a) => call('reserve', a), settle: (...a) => call('settle', a), dictationLease: (...a) => call('dictationLease', a) };
  boundedLedgers.add(bound); return bound;
}
export function liveProviderRequest(env, model) {
  const query = new URLSearchParams({ model, encoding: 'linear16', sample_rate: '16000', channels: '1', interim_results: 'true', punctuate: 'true', endpointing: '300', mip_opt_out: 'true' });
  return { url: `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.AIG_ID}/workers-ai?${query}`, headers: {
    Upgrade: 'websocket', 'cf-aig-authorization': `Bearer ${env.AIG_TOKEN}`,
    'cf-aig-collect-log': 'false', 'cf-aig-collect-log-payload': 'false', 'cf-aig-skip-cache': 'true',
  } };
}
// Additive Ledger RPC. Synchronous SQL makes acquisition atomic across tabs and isolates.
export const ledgerDictation = {
  dictationLease(id, release = false) {
    this.sql.exec('CREATE TABLE IF NOT EXISTS dictation_lease (slot INTEGER PRIMARY KEY, id TEXT NOT NULL, until INTEGER NOT NULL)');
    if (release) { this.sql.exec('DELETE FROM dictation_lease WHERE id=?', id); return { ok: true }; }
    const now = Date.now(), row = this.one('SELECT id,until FROM dictation_lease WHERE slot=1');
    if (row && row.id !== id && row.until > now) return { ok: false };
    this.sql.exec('INSERT INTO dictation_lease VALUES (1,?,?) ON CONFLICT(slot) DO UPDATE SET id=excluded.id,until=excluded.until', id, now + 45000);
    return { ok: true };
  },
};
export async function transcribeLive(req, env, ledger, { tenant, look = false } = {}, deps = {}) {
  const now = deps.now || Date.now, startedAt = now();
  if (look) return fail(403, 'Read-only view.');
  if (req.method !== 'GET') return fail(405, 'Use a WebSocket connection.');
  if (req.headers.get('Origin') !== new URL(req.url).origin) return fail(403, 'Open dictation from this app.');
  if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return fail(426, 'A WebSocket connection is required.');
  const settings = deps.liveModel ? null : await import('./ee/index.js');
  const models = deps.liveModel ? [deps.liveModel] : await settings.jobModels(env, 'live_dictation');   // the saved model of the job "live_dictation", then its fallback
  const level = await privacyOf(env, tenant), gatewayOk = !!(env.AIG_TOKEN && env.AIG_ID && env.CF_ACCOUNT_ID);
  const routes = []; let blocked = false;
  for (const model of models) {
    const cf = ENDPOINTS.transcription[model]?.['cloudflare-workers-ai'], deepgram = !!cf;   // a model registered on Workers AI is a streaming WebSocket; any other is a whole-recording model
    const allowed = deepgram ? endpointOk(cf, level) : eligibleHosts(model, level, { modality: 'transcription' }).length > 0;   // only a registered endpoint, never a guess
    if (!allowed) { blocked = true; continue; }
    if (deepgram ? gatewayOk : !!env.OPENROUTER_API_KEY) routes.push({ model, deepgram });
  }
  if (!routes.length) return blocked ? fail(451, 'Live dictation is unavailable with your privacy setting.') : fail(503, 'Live dictation is unavailable.');
  const primary = routes[0], fallbackRoute = primary.deepgram ? null : routes.find(r => r.deepgram) || null;
  const id = `dictation:${crypto.randomUUID()}`;
  ledger = boundedDictationLedger(ledger, deps);
  let acquired = false, reserveAttempted = false, upstream;
  // A WebSocket to Deepgram's Nova-3 through the AI gateway (accepted), or throws.
  const openDeepgram = async model => {
    const spec = liveProviderRequest(env, model), controller = new AbortController();
    // The fetch signal remains associated with its upgraded WebSocket. AbortSignal.timeout
    // would therefore kill healthy dictation at 15s; clear a connection-only timer on upgrade.
    const connectTimer = setTimeout(() => controller.abort(), 15000);
    let response;
    try { response = await (deps.fetch || fetch)(spec.url, { headers: spec.headers, signal: controller.signal }); }
    finally { clearTimeout(connectTimer); }
    const socket = response.webSocket;
    if (response.status !== 101 || !socket) { try { socket?.close(); } catch {} throw new Error('upgrade'); }
    socket.accept(); return socket;
  };
  try {
    acquired = true; // Clean up even if acquisition committed but its acknowledgement was lost.
    if (!(await ledger.dictationLease(id)).ok) return fail(409, 'Dictation is already open in another tab.');
    reserveAttempted = true;
    const hold = await ledger.reserve(`${id}:0`, LIVE_MINUTE_NANO);
    if (!hold.ok) { await ledger.dictationLease(id, true); return fail(402, 'Your usage allowance is unavailable.'); }
    if (primary.deepgram) {
      upstream = await openDeepgram(primary.model);
    } else {
      // Gateway payload logging is off for live dictation even on dev: audio and text stay in this socket.
      // The saved settings are read once here (a snapshot), so each chunk's call doesn't read them again.
      const { ChunkProvider } = await import('./transcribe-live-chunks.js'), { STT_NANO_PER_SEC } = await import('./transcribe.js');
      const snap = await (settings || await import('./ee/index.js')).modelSettingsEnv(env), quiet = Object.assign(Object.create(snap), { AIG_LOG_PAYLOADS: '0' }), facts = snap.MODEL_SETTINGS?.catalog?.[primary.model];
      upstream = new ChunkProvider({ model: primary.model, env: quiet, meta: { tenant, kind: 'live-dictation' }, rate: Number(facts?.sec_nano) || STT_NANO_PER_SEC, liveCharge, tryMs: deps.chunkTryMs,
        stt: deps.stt, openFallback: fallbackRoute ? () => openDeepgram(fallbackRoute.model) : null });
    }
    const [client, server] = Object.values(new (deps.WebSocketPair || WebSocketPair)());
    // Workers compatibility dates >=2026-03-17 default binary frames to Blob.
    // Set this before accept so byte caps/accounting see PCM ArrayBuffers from the first frame.
    server.binaryType = 'arraybuffer';
    if (primary.deepgram) upstream.accept(); server.accept();
    // Capture may begin while this authenticated handshake is in flight. Only
    // measured server setup time earns a bounded one-time catch-up allowance.
    const startupAudioBytes = Math.floor(Math.min(STARTUP_BYTES_MAX, BURST_BYTES + Math.max(0, now() - startedAt) * PCM_SECOND / 1000) / 2) * 2;
    bridgeDictation(server, upstream, ledger, id, { ...deps, startupAudioBytes });
    return new (deps.Response || Response)(null, { status: 101, webSocket: client });
  } catch {
    try { upstream?.close(); } catch {}
    if (reserveAttempted) await ledger.settle(`${id}:0`, 0).catch(() => {});
    if (acquired) await ledger.dictationLease(id, true).catch(() => {});
    return fail(503, 'Live dictation could not connect. Please try again.');
  }
}
export function bridgeDictation(client, provider, ledger, id, deps = {}) {
  ledger = boundedDictationLedger(ledger, deps);
  const now = deps.now || Date.now, every = deps.setInterval || setInterval, later = deps.setTimeout || setTimeout;
  const clearEvery = deps.clearInterval || clearInterval, clearLater = deps.clearTimeout || clearTimeout;
  const startupAudioBytes = Number.isFinite(deps.startupAudioBytes) ? Math.floor(Math.max(BURST_BYTES, Math.min(STARTUP_BYTES_MAX, deps.startupAudioBytes)) / 2) * 2 : BURST_BYTES;
  let seq = 0, bytes = 0, windowAt = now(), lastFrame = now(), bucketAt = now(), leaseAt = now(), tokens = startupAudioBytes;
  let queued = 0, chain = Promise.resolve(), closing = false, stopping = false, finished = null, timer, flushTimer;
  let segment = null, revision = 0, finalStart = -1;
  const send = event => { try { client.send(JSON.stringify(event)); } catch {} };
  // What to settle for this window's audio: Deepgram's per-minute rate, or (a chunked provider) the answers' real cost x 1.15.
  const charge = () => provider.takeCharge ? provider.takeCharge(LIVE_MINUTE_NANO) : liveCharge(bytes);
  const finish = (message = null) => {
    if (finished) return finished;
    closing = true; clearEvery(timer); clearLater(flushTimer);
    try { provider.close(1000, 'Done'); } catch {}
    finished = (async () => {
      try { await ledger.settle(`${id}:${seq}`, charge()); }
      finally { await ledger.dictationLease(id, true); }
    })().catch(() => { /* Existing reservation expiry covers a failed settlement; never log content. */ }).finally(() => {
      send(message ? { type: 'error', message } : { type: 'done' });
      try { client.close(1000, 'Done'); } catch {}
    });
    deps.waitUntil?.(finished);
    return finished;
  };
  const enqueue = fn => { chain = chain.then(fn).catch(() => finish('Dictation connection failed. Your text is still here.')); return chain; };
  const renewLease = async () => {
    if (now() - leaseAt < 15000) return true;
    if (!(await ledger.dictationLease(id)).ok) { await finish('Dictation is active in another tab.'); return false; }
    leaseAt = now(); return true;
  };
  const rotate = async () => {
    await ledger.settle(`${id}:${seq}`, charge());
    bytes = 0; seq++; windowAt = now();
    if (!(await ledger.reserve(`${id}:${seq}`, LIVE_MINUTE_NANO)).ok) { await finish('Your usage allowance is unavailable. Your text is still here.'); return false; }
    return true;
  };
  client.addEventListener('message', event => {
    if (closing || stopping) return;
    const data = event.data;
    if (typeof data === 'string') {
      let msg; try { msg = data.length <= 100 ? JSON.parse(data) : null; } catch {}
      if (msg?.type !== 'stop') { stopping = true; enqueue(() => finish('Invalid dictation message.')); return; }
      stopping = true;
      enqueue(() => { if (closing) return; provider.send(JSON.stringify({ type: 'CloseStream' })); flushTimer = later(() => enqueue(() => finish('Dictation stopped before its final words arrived. Your text is still here.')), 10000); });
      return;
    }
    const n = data?.byteLength;
    if (!Number.isInteger(n) || !n || n > 16384 || n % 2 || queued + n > 262144) { stopping = true; enqueue(() => finish('Dictation audio exceeded its connection limit.')); return; }
    const at = now();
    // Preserve unspent startup credit, but never replenish above the normal
    // two-second bucket: waiting cannot earn a second startup burst.
    if (tokens <= BURST_BYTES) tokens = Math.min(BURST_BYTES, tokens + Math.max(0, at - bucketAt) * PCM_SECOND / 1000);
    bucketAt = at;
    if (n > tokens) { stopping = true; enqueue(() => finish('Dictation audio arrived too quickly.')); return; }
    tokens -= n; lastFrame = at; queued += n;
    enqueue(async () => {
      try {
        if (closing) return;
        if (!(await renewLease())) return;
        if (bytes + n > WINDOW_BYTES && !(await rotate())) return;
        if (closing) return;
        if (Number(provider.bufferedAmount || 0) > 262144) return finish('The speech connection is too slow. Your text is still here.');
        provider.send(data); bytes += n;
      } finally { queued -= n; }
    });
  });
  provider.addEventListener('message', event => {
    if (closing) return;
    let msg; try { if (typeof event.data !== 'string' || event.data.length > 65536) throw 0; msg = JSON.parse(event.data); if (!msg || typeof msg !== 'object' || Array.isArray(msg)) throw 0; } catch { enqueue(() => finish('Dictation returned an invalid response.')); return; }
    if (msg.type === 'Metadata' && stopping) { enqueue(() => finish()); return; }
    if (msg.type === 'Error') { enqueue(() => finish('The speech service could not continue. Your text is still here.')); return; }
    if (msg.type !== 'Results' || !Number.isFinite(msg.start) || msg.start < 0 || msg.start <= finalStart) return;
    if (segment && msg.start < segment.start) return;
    const raw = msg.channel?.alternatives?.[0]?.transcript;
    if (typeof raw !== 'string' || raw.length > 20000) return;
    if (!segment || segment.start !== msg.start) segment = { start: msg.start, text: '' };
    const text = raw || (msg.is_final ? segment.text : '');
    if (!text) return;
    if (text !== segment.text || msg.is_final) { segment.text = text; send({ type: 'transcript', id: `0:${msg.start}`, revision: ++revision, text, final: !!msg.is_final }); }
    if (msg.is_final) finalStart = msg.start;
  });
  client.addEventListener('close', () => enqueue(() => finish()));
  client.addEventListener('error', () => enqueue(() => finish('Dictation connection failed. Your text is still here.')));
  provider.addEventListener('close', () => { if (!closing) enqueue(() => finish('The speech connection ended. Your text is still here.')); });
  provider.addEventListener('error', () => enqueue(() => finish('The speech connection failed. Your text is still here.')));
  timer = every(() => enqueue(async () => {
    if (closing || stopping) return;
    if (now() - lastFrame > 45000) return finish('The microphone connection stopped sending audio. Your text is still here.');
    if (!(await renewLease())) return;
    if (now() - windowAt >= 60000) await rotate();
  }), 15000);
  send({ type: 'ready', startup_audio_bytes: startupAudioBytes });
  return { drain: () => chain, finish };
}
