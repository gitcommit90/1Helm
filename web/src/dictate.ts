// Streaming composer dictation. Typing is authoritative; nothing is auto-sent.
import { DictationBuffer, type Transcript } from './dictation-buffer';
import { DictationAudio } from './dictation-audio';
type Deps = { api: string; note: (title: string, sub: string) => void };
type Key = 'box' | 'nbox';
type Session = {
  generation: number; phase: 'starting' | 'rec' | 'finishing'; key: Key; hash: string;
  textarea: HTMLTextAreaElement; buffer: DictationBuffer; composing: boolean; pending: Transcript[];
  selection: [number, number]; writing: boolean;
  stream?: MediaStream; ctx: AudioContext; source?: MediaStreamAudioSourceNode; node?: AudioWorkletNode;
  ws?: WebSocket; timer?: number; timeout?: number; start: number; level: number; flushed: boolean; done?: boolean;
  audio: DictationAudio; pump?: number; stopTimer?: number; stopSent?: boolean;
};
let D: Deps | null = null, active: Session | null = null, history: Session | null = null, generation = 0, icon = '';
const LABEL = 'Talk instead of typing';
const STOP = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="1" y="1" width="10" height="10" rx="2.5" fill="currentColor"/></svg>';
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const current = (s: Session) => active === s && s.generation === generation && location.hash === s.hash && s.textarea.isConnected && document.getElementById(s.key) === s.textarea;
export function dictBtn(key: Key, svg: string) { icon = svg; return `<button type="button" class="cbtn mic dict" data-dict="${key}" title="${LABEL}" aria-label="${LABEL}">${svg}</button>`; }
function paint() {
  const s = active;
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-dict]')) {
    const on = s && b.dataset.dict === s.key && b.closest('form') === s.textarea.closest('form');
    b.classList.toggle('on', !!on); b.classList.toggle('rec', !!on && s.phase === 'rec'); b.classList.toggle('busy', !!on && s.phase !== 'rec');
    b.disabled = !!on && s.phase === 'finishing'; b.setAttribute('aria-pressed', String(!!on));
    const label = !on ? LABEL : s.phase === 'rec' ? 'Stop dictation' : s.phase === 'starting' ? 'Cancel microphone startup' : 'Finishing dictation';
    b.setAttribute('aria-label', label); b.title = label;
    const view = !on ? 'idle' : s.phase === 'rec' ? 'rec' : 'spin';
    if (b.dataset.view !== view) { b.innerHTML = view === 'idle' ? icon : view === 'rec' ? `${STOP}<span class="dtime"></span>` : '<span class="dspin"></span>'; b.dataset.view = view; }
    const tm = b.querySelector('.dtime'); if (tm && s) { const time = fmt((performance.now() - s.start) / 1000); if (tm.textContent !== time) tm.textContent = time; }
    b.style.setProperty('--lvl', String(on ? s.level : 0));
  }
  for (const f of document.querySelectorAll<HTMLElement>('form.dicting')) if (!s || f !== s.textarea.closest('form')) { f.classList.remove('dicting', 'dbusy'); f.querySelector('.dictst')?.remove(); }
  const form = s?.textarea.closest('form'); if (!s || !form) return;
  form.classList.add('dicting'); form.classList.toggle('dbusy', s.phase === 'finishing');
  let status = form.querySelector<HTMLElement>('.dictst');
  if (!status) { status = document.createElement('div'); status.className = 'dictst'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); form.append(status); }
  const words = s.phase === 'starting' ? 'Opening microphone…' : s.phase === 'finishing' ? 'Finishing… Your edits are kept.' : s.audio.ready ? 'Listening — keep talking or edit. Tap stop when done.' : 'Listening — connecting transcription. Your audio is being kept.';
  if (status.textContent !== words) status.textContent = words;
}
function releaseMic(s: Session) {
  s.stream?.getTracks().forEach(t => t.stop()); s.source?.disconnect(); s.node?.disconnect(); s.ctx.close().catch(() => {});
  s.stream = undefined; s.source = undefined; s.node = undefined;
}
function end(s: Session) {
  if (active !== s) return;
  clearTimeout(s.timeout); clearTimeout(s.stopTimer); clearInterval(s.timer); clearInterval(s.pump); s.audio.clear(); releaseMic(s); active = null; generation++;
  history = s.textarea.isConnected && location.hash === s.hash ? s : null;
  s.ws?.close(1000, 'Dictation ended'); paint();
}
export function cancel() { if (active) end(active); }
function fail(s: Session, message: string) { if (active !== s) return; end(s); D?.note('Dictation stopped', message + ' Your text is still here.'); }
function cursor(s: Session, force = false) {
  if (s.writing || s.composing) return;
  const t = s.textarea, next: [number, number] = [t.selectionStart, t.selectionEnd];
  if (force || next[0] !== s.selection[0] || next[1] !== s.selection[1]) s.buffer.move(...next);
  s.selection = next;
}
function write(s: Session, value: string, a: number, z = a, direction: 'forward' | 'backward' | 'none' = 'none') {
  s.writing = true;
  try { s.textarea.value = value; s.textarea.setSelectionRange(a, z, direction); s.selection = [a, z]; s.textarea.dispatchEvent(new Event('input', { bubbles: true })); }
  finally { s.writing = false; }
}
function apply(s: Session, event: Transcript) {
  if (!current(s)) { if (active === s) end(s); return; }
  if (s.composing) { if (s.pending.length < 200) s.pending.push(event); else fail(s, 'Too many pending results. Finish typing and try again.'); return; }
  cursor(s);
  const t = s.textarea, scroll = t.scrollTop, selection = [t.selectionStart, t.selectionEnd] as const, direction = t.selectionDirection;
  s.buffer.edit(t.value);
  const restore = s.buffer.selection(...selection);
  if (!s.buffer.apply(event)) return;
  const value = s.buffer.value; if (value === t.value) return;
  const [a, z] = s.buffer.inserted ? [s.buffer.cursor, s.buffer.cursor] : restore();
  write(s, value, a, z, direction); t.scrollTop = scroll;
}
// Worklet keeps audio independent of painting/typing. Real mono PCM16 frames,
// downsampled continuously to16kHz and emitted every100ms (not blob batches).
const PROCESSOR = `class DictationPCM extends AudioWorkletProcessor {
  constructor(){super();this.sum=0;this.count=0;this.phase=0;this.chunk=[];this.stopped=false;
    this.port.onmessage=e=>{if(e.data==='stop'){this.stopped=true;this.flush();this.port.postMessage({type:'flushed'});}};}
  flush(){if(!this.chunk.length)return;const pcm=new Int16Array(this.chunk);this.chunk=[];this.port.postMessage({type:'audio',pcm:pcm.buffer},[pcm.buffer]);}
  process(inputs){if(this.stopped)return false;const data=inputs[0]?.[0];if(!data)return true;let peak=0;
    for(const v of data){peak=Math.max(peak,Math.abs(v));this.sum+=v;this.count++;this.phase+=16000;
      if(this.phase>=sampleRate){this.phase-=sampleRate;const x=Math.max(-1,Math.min(1,this.sum/this.count));this.chunk.push(Math.round(x*(x<0?32768:32767)));this.sum=0;this.count=0;if(this.chunk.length>=1600)this.flush();}}
    this.port.postMessage({type:'level',value:peak});return true;}
}registerProcessor('dictation-pcm',DictationPCM);`;
async function start(key: Key) {
  const textarea = document.getElementById(key) as HTMLTextAreaElement | null;
  if (!textarea || !D) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) { D.note('Live dictation unavailable', 'Use a current Chrome, Safari or Edge browser, or type instead.'); return; }
  let ctx: AudioContext;
  try { ctx = new (window.AudioContext || (window as any).webkitAudioContext)(); }
  catch { D.note('Microphone unavailable', 'This browser could not start live audio. You can keep typing.'); return; }
  const s: Session = { generation: ++generation, phase: 'starting', key, hash: location.hash, textarea,
    buffer: new DictationBuffer(textarea.value, textarea.selectionStart, textarea.selectionEnd), selection: [textarea.selectionStart, textarea.selectionEnd], writing: false, composing: false, pending: [], ctx, start: performance.now(), level: 0, flushed: false, audio: new DictationAudio() };
  active = s; paint();
  s.timeout = window.setTimeout(() => fail(s, 'Could not connect. Try the microphone again.'), 20000);
  try {
    // All work starts only after the explicit click, but provider latency must not
    // delay capture. Cleanup the permission promise even if another startup fails.
    const media = navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).then(stream => {
      if (!current(s)) { stream.getTracks().forEach(t => t.stop()); return null; }
      s.stream = stream; return stream;
    });
    const url = URL.createObjectURL(new Blob([PROCESSOR], { type: 'text/javascript' }));
    const module = ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
    // Observe failures immediately, including when WebSocket construction throws.
    const capture = Promise.all([media, module, ctx.resume()]); capture.catch(() => {});
    const endpoint = new URL(`${D.api}/transcribe/live`, location.href); endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = s.ws = new WebSocket(endpoint);
    ws.onmessage = e => {
      if (!current(s)) { if (active === s) end(s); return; }
      let msg: any; try { msg = JSON.parse(e.data); if (!msg || typeof msg !== 'object') throw new Error(); } catch { fail(s, 'Received an unreadable transcription response.'); return; }
      if (msg.type === 'ready' && !s.audio.ready) {
        s.audio.connected(performance.now(), msg.startup_audio_bytes);
        if (s.phase === 'rec') clearTimeout(s.timeout);
        pumpAudio(s); paint();
      } else if (msg.type === 'transcript') apply(s, msg);
      else if (msg.type === 'done') {
        if (s.phase !== 'finishing') { fail(s, 'The transcription connection ended. Tap the microphone to continue.'); return; }
        s.done = true; clearTimeout(s.timeout);
        if (s.composing) { s.pending.push({ id: '__done', revision: 0, text: '', final: true }); return; }
        end(s);
      } else if (msg.type === 'error') fail(s, typeof msg.message === 'string' ? msg.message : 'Live transcription is unavailable.');
    };
    ws.onerror = () => fail(s, 'Could not connect to live transcription. Try again.');
    ws.onclose = () => { if (active === s && !s.done) fail(s, 'The live connection closed. Tap the microphone to continue.'); };
    s.pump = window.setInterval(() => pumpAudio(s), 20);
    const [stream] = await capture;
    if (!stream || !current(s)) { if (active === s) end(s); return; }
    if (ctx.state !== 'running') { fail(s, 'The browser could not start audio capture. Try the microphone again.'); return; }
    stream.getAudioTracks().forEach(t => t.addEventListener('ended', () => { if (active === s && s.phase === 'rec') fail(s, 'The microphone disconnected.'); }));
    const node = s.node = new AudioWorkletNode(ctx, 'dictation-pcm');
    node.port.onmessage = e => {
      if (!current(s)) { if (active === s) end(s); return; }
      if (e.data.type === 'level') { s.level = Math.min(1, e.data.value * 4); return; }
      if (e.data.type === 'audio' && !s.flushed) {
        try { s.audio.push(e.data.pcm); } catch (err: any) { fail(s, err.message); return; }
        pumpAudio(s);
      }
      if (e.data.type === 'flushed') flushStop(s);
    };
    s.source = ctx.createMediaStreamSource(stream); s.source.connect(node);
    const mute = ctx.createGain(); mute.gain.value = 0; node.connect(mute); mute.connect(ctx.destination);
    s.phase = 'rec'; s.start = performance.now(); if (s.audio.ready) clearTimeout(s.timeout);
    s.timer = window.setInterval(() => { if (!current(s)) end(s); else paint(); }, 250);
    paint();
  } catch (e: any) {
    if (active !== s) return;
    fail(s, e?.name === 'NotAllowedError' ? 'Allow microphone access for this site and try again.' : 'Could not start the microphone. Check your audio device and try again.');
  }
}
function pumpAudio(s: Session) {
  if (!current(s)) { if (active === s) end(s); return; }
  const ws = s.ws;
  if (!s.audio.ready || ws?.readyState !== WebSocket.OPEN || s.stopSent) return;
  if (ws.bufferedAmount > 256000) { fail(s, 'The connection could not keep up with live audio.'); return; }
  if (ws.bufferedAmount > 32000) return;
  try {
    for (const frame of s.audio.take(performance.now())) ws.send(frame);
    if (s.flushed && !s.audio.bytes) { s.stopSent = true; ws.send(JSON.stringify({ type: 'stop' })); }
  } catch { fail(s, 'Could not send audio to live transcription. Try again.'); }
}
function flushStop(s: Session) {
  if (active !== s || s.flushed) return; s.flushed = true;
  clearTimeout(s.stopTimer);
  releaseMic(s);
  pumpAudio(s);
}
function stop(s: Session) {
  if (s.phase !== 'rec') { if (s.phase === 'starting') end(s); return; }
  s.phase = 'finishing'; s.level = 0; paint(); s.stream?.getTracks().forEach(t => t.stop()); s.node?.port.postMessage('stop');
  s.stopTimer = window.setTimeout(() => fail(s, 'The microphone could not finish its last audio. Please try again.'), 1200);
  clearTimeout(s.timeout);
  s.timeout = window.setTimeout(() => fail(s, 'Timed out waiting for the last words.'), 12000);
}
export function dictInit(deps: Deps) {
  D = deps;
  window.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest?.<HTMLButtonElement>('[data-dict]'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    if (!active) void start(b.dataset.dict as Key); else if (active.key === b.dataset.dict) stop(active);
  });
  const editor = () => { const s = active ?? history; return s && s.textarea.isConnected && location.hash === s.hash && document.getElementById(s.key) === s.textarea ? s : null; };
  window.addEventListener('input', e => { const s = editor(); if (s && !s.writing && e.target === s.textarea) { s.buffer.edit(s.textarea.value); cursor(s, true); } }, true);
  document.addEventListener('selectionchange', () => { if (active) cursor(active); });
  window.addEventListener('select', e => { if (active && e.target === active.textarea) cursor(active); }, true);
  window.addEventListener('pointerup', e => { if (active && e.target === active.textarea) cursor(active); }, true);
  window.addEventListener('keyup', e => { if (active && e.target === active.textarea) cursor(active); }, true);
  const undo = (redo: boolean) => {
    const s = editor(); if (!s || s.composing) return;
    s.buffer.edit(s.textarea.value); const at = s.buffer.undo(redo); if (at === null) return;
    s.buffer.move(at); write(s, s.buffer.value, at);
  };
  window.addEventListener('beforeinput', e => {
    const input = e as InputEvent;
    const s = editor();
    if (s && e.target === s.textarea && !s.composing && ['historyUndo', 'historyRedo'].includes(input.inputType)) {
      e.preventDefault(); e.stopImmediatePropagation(); undo(input.inputType === 'historyRedo');
    }
  }, true);
  window.addEventListener('compositionstart', e => { if (active && e.target === active.textarea) active.composing = true; }, true);
  window.addEventListener('compositionend', e => {
    const s = active; if (!s || e.target !== s.textarea) return;
    s.composing = false; s.buffer.edit(s.textarea.value); cursor(s, true);
    for (const event of s.pending.splice(0)) { if (event.id === '__done') end(s); else apply(s, event); }
  }, true);
  window.addEventListener('keydown', e => {
    const s = editor();
    if (s && (e.ctrlKey || e.metaKey) && !e.altKey && e.target === s.textarea && !e.isComposing && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
      e.preventDefault(); e.stopImmediatePropagation(); undo(e.shiftKey || e.key.toLowerCase() === 'y'); return;
    }
    if (!active) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancel(); }
    if (e.key === 'Enter' && !e.shiftKey && e.target === active?.textarea && !e.isComposing) { e.preventDefault(); e.stopImmediatePropagation(); D?.note('Stop dictation first', 'Tap the red stop button, then review and send your message.'); }
  }, true);
  window.addEventListener('submit', e => { if (active && e.target === active.textarea.closest('form')) { e.preventDefault(); e.stopImmediatePropagation(); D?.note('Stop dictation first', 'Your words stay in the composer until you choose to send.'); } }, true);
  window.addEventListener('hashchange', cancel); window.addEventListener('pagehide', cancel);
  new MutationObserver(() => { if (active && !current(active)) end(active); }).observe(document.body, { childList: true, subtree: true });
}
