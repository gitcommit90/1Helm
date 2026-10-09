// Live notes from this device's microphone (the server's live-mic.js). Same Live notes, a different input: when there's no Bee (or
// the person picks "Use this device's mic instead"), the device that started Live notes records and sends short chunks; the server
// transcribes them and feeds the one note-taker. livenotes.ts owns the UI; this file owns the microphone.
// - Chunks: one MediaRecorder per chunk, so every chunk is a whole file Whisper can read. Cut at a pause in speech (≥ 0.4 s of quiet
//   after ≥ 3 s), at the latest after 10 s: pause cuts don't split words (Whisper's error rate halves on them, see live-mic.js) and a
//   sentence goes out as soon as it ends. A chunk with no voice in it isn't sent (no cost, no "Thank you." hallucinations).
// - Sending: in order, one at a time, retried with backoff (1 → 15 s) until the server answers; each chunk is kept in IndexedDB
//   until it's acknowledged, so a deploy, a dropped network or a reload doesn't lose audio. A seq the server already has is "dup".
// - Keeping it alive: the Screen Wake Lock while recording; a heartbeat every 30 s (silent chunks aren't sent). iPhone/iPad stop
//   the mic in the background: the device says "paused" (the server keeps the gap), and on coming back it picks up by itself; if
//   the browser wants a tap first, the pane shows "Paused: keep 1Helm open to keep listening" with Resume. A muted or ended track
//   (another app took the mic) is a pause too.
// - The device's mic id (random, kept per task in localStorage with the next seq) is the session's: a reload on this device resumes
//   recording, another device never does (it shows the state). One tab records: a lock in localStorage, refreshed every 5 s.
// - A meeting tab (Captain 2026-10-08, desktop Chrome/Edge): the browser's share picker (getDisplayMedia, the least video it allows,
//   stopped at once) gives the tab's sound: the other people in a Meet / Zoom web / Teams web call. It's mixed with the person's mic
//   (optional; with Bluetooth headphones the mic hears only them) in an AudioContext, and the mix goes through the same chunks, queue
//   and server path. Windows / ChromeOS "Entire screen" + "Share system audio" works too (every app's sound: labelled as such). No
//   sound in the share (they forgot "Share tab audio") → a one-line fix and Try again, before anything starts. Sharing stopped
//   (the browser's bar, the tab closed, a reload) → paused, with Continue with the mic only / Share again / Stop and save.
//   Each chunk says who spoke when it's clear from the two level meters (whoOf: "you" = the mic only, "others" = the tab only).
// - The level loop and heartbeat tick from a tiny worker: the person sits in the meeting's tab, where Chrome slows a hidden page's timers.
// Pure parts (sourceChoice, sourceOptions, tabSupport, shareCheck, shareError, whoOf, shareEndedView, createCutter, createQueue,
// micStateOf) are tested in test/livemic.test.mjs.
import { streamNote } from "../clientlog";

export type Src = "bee" | "mic" | "tab";
export type MicState = "off" | "starting" | "live" | "paused";

// ---- which input (pure) ----
// Both: Bee by default, "Use this device's mic instead" offered. One of them: that one. Neither: no Live notes here.
export function sourceChoice(o: { bee: boolean; mic: boolean }): { def: Src | null; alt: Src | null } {
  if (o.bee) return { def: "bee", alt: o.mic ? "mic" : null };
  return { def: o.mic ? "mic" : null, alt: null };
}
export const micSupported = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

// ---- a meeting tab's sound (getDisplayMedia with audio), pure parts ----
// Chrome and Edge (and other Chromium browsers) on a computer can share a tab's sound; Windows and ChromeOS can also share the whole
// computer's sound with "Entire screen". Safari and Firefox share no tab sound, and phones and tablets can't share a screen at all.
// → "yes" | "browser" (a computer, but another browser: "Works in Chrome or Edge on a computer") | "device" (a phone or tablet: hidden).
export type TabSupport = "yes" | "browser" | "device";
export function tabSupport(o: { ua: string; touch?: number; gdm: boolean }): TabSupport {
  const ua = String(o.ua || "");
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua) || isIOS(ua, o.touch || 0)) return "device";
  return o.gdm && /Chrome\/\d+|Chromium\/\d+|Edg\/\d+/.test(ua) && !/Firefox\//.test(ua) ? "yes" : "browser";
}
export const osOf = (ua: string): "mac" | "win" | "cros" | "linux" | "other" => /Windows/.test(ua) ? "win" : /CrOS/.test(ua) ? "cros" : /Macintosh|Mac OS X/.test(ua) ? "mac" : /Linux/.test(ua) ? "linux" : "other";
// The start sheet's choices, in order: Bee (when connected), a meeting tab (computers only; off with a reason outside Chrome/Edge),
// this device's microphone. The default: what was picked last time when it's still there, else a meeting tab when a calendar
// meeting with a video link opened the sheet, else Bee, else the mic.
export type SrcOpt = { id: Src; ok: boolean; why?: string };
export function sourceOptions(o: { bee: boolean; mic: boolean; tab: TabSupport; last?: string | null; meeting?: boolean }): { list: SrcOpt[]; def: Src | null } {
  const list: SrcOpt[] = [];
  if (o.bee) list.push({ id: "bee", ok: true });
  if (o.tab !== "device" && o.mic) list.push(o.tab === "yes" ? { id: "tab", ok: true } : { id: "tab", ok: false, why: "Works in Chrome or Edge on a computer." });
  if (o.mic) list.push({ id: "mic", ok: true });
  const can = (id: any) => list.some((x) => x.id === id && x.ok);
  const def = can(o.last) ? (o.last as Src) : o.meeting && can("tab") ? "tab" : can("bee") ? "bee" : can("mic") ? "mic" : null;
  return { list, def };
}
// What came back from the browser's share picker. surface: the video track's displaySurface ("browser" a tab, "window", "monitor"
// the entire screen). Sound from a tab → "tab"; from the entire screen (Windows / ChromeOS "Share system audio") → "system", every
// app's sound. No audio track → the one-line fix for what they picked.
export type ShareCheck = { ok: true; kind: "tab" | "system" } | { ok: false; why: "no-audio"; fix: string };
export function shareCheck(o: { audio: number; surface: string; os: string }): ShareCheck {
  if (o.audio > 0) return { ok: true, kind: o.surface === "monitor" || o.surface === "window" ? "system" : "tab" };
  const fix = o.surface === "window" ? "A window can't share its sound. Pick the meeting's tab instead, with \u201cShare tab audio\u201d on."
    : o.surface === "monitor" ? (o.os === "win" || o.os === "cros" ? "No sound came with the screen. Turn on \u201cShare system audio\u201d, or pick the meeting's tab with \u201cShare tab audio\u201d on." : "This computer can't share the whole screen's sound. Pick the meeting's tab instead, with \u201cShare tab audio\u201d on.")
    : "No sound came with that tab. Turn on \u201cShare tab audio\u201d in the picker.";
  return { ok: false, why: "no-audio", fix };
}
// The picker itself failed: cancelled (NotAllowedError, also what Chrome says when the person closes it), or no screen sharing here.
export function shareError(name: string): { code: "cancelled" | "unsupported" | "error"; fix: string } {
  if (name === "NotAllowedError" || name === "AbortError") return { code: "cancelled", fix: "Nothing was shared. Pick the meeting's tab to start." };
  if (name === "NotSupportedError" || name === "TypeError" || name === "unsupported") return { code: "unsupported", fix: "This browser can't share a tab's sound. Use Chrome or Edge on a computer." };
  return { code: "error", fix: "The browser couldn't start sharing. Try again." };
}
// Who spoke in a chunk, from the two inputs' voiced time: only the person's mic → "you"; only the tab → "others"; both, or neither
// clearly → "" (no label; never guessed). With headphones the mic hears only the person, so the split is clean; without them the
// mic also hears the speakers, and those chunks stay unlabelled.
export function whoOf(o: { mic: number; tab: number }): "you" | "others" | "" {
  if (o.mic >= 400 && o.tab < Math.max(150, o.mic * 0.15)) return "you";
  if (o.tab >= 400 && o.mic < Math.max(150, o.tab * 0.15)) return "others";
  return "";
}
// Sharing stopped (the browser's "Stop sharing" bar, or the meeting tab closed): Live notes pause, and the pane offers what can go on.
export function shareEndedView(o: { mic: boolean; system: boolean }) {
  return { title: "Sharing stopped, so Live notes are paused.", body: o.mic ? "Go on with your microphone only (it hears you, not the others), share the meeting's tab again, or stop and save the notes." : "Share the meeting's tab again, or stop and save the notes.",
    acts: [...(o.mic ? [{ id: "mic", label: "Continue with the mic only" }] : []), { id: "again", label: o.system ? "Share again" : "Share the tab again" }, { id: "stop", label: "Stop and save" }] };
}

// ---- the chunk cutter (pure): one level sample at a time → cut now? ----
export type CutOpts = { minMs: number; maxMs: number; quietMs: number };
export const CUT: CutOpts = { minMs: 3000, maxMs: 10000, quietMs: 400 };
export function createCutter(o: CutOpts = CUT) {
  let t0 = 0, last = 0, voiced = 0, lastVoice = -1, heard = false, blind = false; const ring: number[] = [];
  return {
    reset(t: number) { t0 = t; last = t; voiced = 0; lastVoice = -1; heard = false; blind = false; },
    // rms: 0..1, or null when the level can't be read (an audio context the browser won't run): then cut on time and assume voice.
    feed(t: number, rms: number | null): boolean {
      const dt = Math.min(1000, Math.max(0, t - last)); last = t;
      const age = t - t0;
      if (rms == null) { blind = true; voiced += dt; return age >= o.maxMs; }
      // The room's noise: the quietest of the last 30 samples (~3 s; speech has gaps between words). Voice: well above it, and
      // anything above 0.06 always counts (a steady loud talker never becomes "quiet").
      ring.push(rms); if (ring.length > 30) ring.shift();
      const floor = Math.min(...ring), voice = rms > Math.max(0.012, Math.min(0.06, floor * 2));
      if (voice) { voiced += dt; lastVoice = t; heard = true; }
      if (age >= o.maxMs) return true;
      if (age >= o.minMs && !heard) return true;                                    // quiet so far: let it go (it won't be sent)
      return age >= o.minMs && t - lastVoice >= o.quietMs;                           // a pause after speech
    },
    voicedMs: () => voiced,
    blind: () => blind,
  };
}

// ---- the send queue (pure: send / sleep / keep injected) ----
export type Item = { k: string; mic: string; seq: number; blob: Blob; type: string; at: number; ms: number; voiced: number; who?: string };
export type Sent = "ok" | "dup" | "retry" | "stop" | "drop";
export function createQueue(d: { send: (it: Item) => Promise<Sent>; sleep: (ms: number) => Promise<void>; keep?: (it: Item, on: boolean) => void; onStop?: () => void; onChange?: () => void }) {
  const q: Item[] = []; let running = false, stopped = false, fails = 0, waiters: (() => void)[] = [];
  const idle = () => { const w = waiters; waiters = []; w.forEach((f) => f()); };
  async function loop() {
    if (running) return; running = true;
    try {
      while (q.length && !stopped) {
        const it = q[0]; let r: Sent;
        try { r = await d.send(it); } catch { r = "retry"; }
        if (stopped) break;
        if (r === "retry") { fails++; d.onChange?.(); await d.sleep(Math.min(15000, 1000 * 2 ** Math.min(4, fails - 1))); continue; }
        fails = 0; const i = q.indexOf(it); if (i >= 0) q.splice(i, 1); d.keep?.(it, false); d.onChange?.();   // by identity: an older chunk may have been put ahead of it
        if (r === "stop") { stopped = true; for (const x of q.splice(0)) d.keep?.(x, false); d.onStop?.(); }
      }
    } finally { running = false; if (!q.length || stopped) idle(); }
  }
  return {
    push(it: Item, kept = false) { if (stopped) return; if (q.some((x) => x.seq === it.seq && x.mic === it.mic)) return; q.push(it); q.sort((a, b) => a.seq - b.seq); if (!kept) d.keep?.(it, true); d.onChange?.(); void loop(); },
    size: () => q.length,
    failing: () => fails > 0,
    // Everything sent → true; still sending after ms → false (it keeps going).
    drain(ms: number) { if (!q.length && !running) return Promise.resolve(true); return new Promise<boolean>((z) => { const t = setTimeout(() => z(false), ms); waiters.push(() => { clearTimeout(t); z(true); }); }); },
    stop() { stopped = true; idle(); },
  };
}

// ---- live or paused (pure) ----
// ios: iPhone / iPad (iPadOS says "Macintosh" but has touch), whose browsers stop the mic when 1Helm goes to the background.
export const isIOS = (ua: string, touch = 0) => /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch > 1);
export function micStateOf(o: { visible: boolean; trackLive: boolean; muted: boolean; ios: boolean }): "live" | "paused" {
  if (!o.trackLive || o.muted) return "paused";
  return !o.visible && o.ios ? "paused" : "live";
}

// ================= the browser side =================
// The input: this device's mic, or a meeting tab's sound (kind "tab"; system: the entire screen's sound) mixed with the person's mic
// (optional) in one AudioContext → a MediaStreamDestination, which is what gets recorded. The video the picker insists on is stopped
// at once. Each source has its own level meter, so a chunk knows who spoke in it (whoOf).
export type Input = { kind: "mic" | "tab"; system: boolean; tab: MediaStream | null; mic: MediaStream | null };
type Run = { k: string; mic: string; base: string; path: string; now: () => number; onChange: () => void; onStopped: () => void; note: (t: string, s: string) => void };
type Meter = { an: AnalyserNode; buf: Float32Array };
const M = {
  run: null as Run | null, state: "off" as MicState, needTap: false, pausedAt: 0, why: "",
  input: null as Input | null, stream: null as MediaStream | null, rec: null as MediaRecorder | null, parts: [] as Blob[], type: "",
  ctx: null as AudioContext | null, meters: { all: null as Meter | null, mic: null as Meter | null, tab: null as Meter | null },
  cut: createCutter(), vMic: createCutter(), vTab: createCutter(), chunkAt: 0, chunkT: 0, untick: null as null | (() => void), unbeat: null as null | (() => void), pingAt: 0, wake: null as any,
  q: null as ReturnType<typeof createQueue> | null, tab: Math.random().toString(36).slice(2), sentAt: 0, shareErr: "",
  meta: { voiced: 0, blind: false, who: "" },   // the current chunk's voice count (and who spoke), taken when the chunk ends
};
const LS = { get(k: string) { try { return localStorage.getItem(k); } catch { return null; } }, set(k: string, v: string | null) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch {} } };
const ios = () => isIOS(navigator.userAgent, navigator.maxTouchPoints || 0);
export const tabSupported = (): TabSupport => typeof navigator === "undefined" ? "device" : tabSupport({ ua: navigator.userAgent, touch: navigator.maxTouchPoints || 0, gdm: !!navigator.mediaDevices?.getDisplayMedia });
// This device's mic for a task: {id, seq (the next chunk's number), kind ("tab" when it records a meeting tab: a reload can't pick a tab up by itself)}.
type Stored = { id: string; seq: number; kind?: "mic" | "tab" };
export const micStored = (k: string): Stored | null => { try { const x = JSON.parse(LS.get(`1h-ln-mic:${k}`) || "null"); return x?.id ? x : null; } catch { return null; } };
const store = (k: string, v: Stored | null) => LS.set(`1h-ln-mic:${k}`, v ? JSON.stringify(v) : null);
export function micNewId(k: string, kind: "mic" | "tab" = "mic") { const a = new Uint8Array(12); crypto.getRandomValues(a); const id = "m" + [...a].map((b) => b.toString(16).padStart(2, "0")).join(""); store(k, { id, seq: 0, kind }); return id; }
const setKind = (k: string, kind: "mic" | "tab") => { const st = micStored(k); if (st) store(k, { ...st, kind }); };
export const micForget = (k: string) => store(k, null);
// One tab records: a lock refreshed every 5 s; a lock older than 15 s is free.
const lockKey = (k: string) => `1h-ln-lock:${k}`;
export function micLockFree(k: string) { try { const x = JSON.parse(LS.get(lockKey(k)) || "null"); return !x || x.tab === M.tab || Date.now() - x.at > 15000; } catch { return true; } }
const lock = (k: string, on: boolean) => LS.set(lockKey(k), on ? JSON.stringify({ tab: M.tab, at: Date.now() }) : null);
const liveTrack = (s: MediaStream | null | undefined) => { const t = s?.getAudioTracks()[0]; return !!t && t.readyState === "live"; };
export const micInfo = () => ({ k: M.run?.k || "", state: M.state, needTap: M.needTap, why: M.why, queued: M.q?.size() || 0, failing: !!M.q?.failing(), pausedAt: M.pausedAt,
  kind: M.input?.kind || "mic", system: !!M.input?.system, micOn: M.input?.kind === "tab" ? (M.input.mic ? liveTrack(M.input.mic) : null) : true, canMic: micSupported(), shareErr: M.shareErr });
const diag = (r: Record<string, unknown>) => streamNote(M.run?.base, { ev: "livemic", ...r });
// A steady tick that a background tab doesn't slow down: the person is usually in the meeting's tab, and Chrome runs a hidden page's
// timers once a second at most (a dedicated worker's aren't). Falls back to setInterval.
function ticker(fn: () => void, ms: number): () => void {
  try {
    const u = URL.createObjectURL(new Blob([`setInterval(()=>postMessage(0),${ms})`], { type: "text/javascript" }));
    const w = new Worker(u); URL.revokeObjectURL(u); w.onmessage = () => fn(); return () => w.terminate();
  } catch { const t = setInterval(fn, ms); return () => clearInterval(t); }
}

// ---- IndexedDB: chunks not yet acknowledged ----
let dbp: Promise<IDBDatabase | null> | null = null;
function db() {
  return dbp ??= new Promise((z) => { try { const r = indexedDB.open("1h-livemic", 1); r.onupgradeneeded = () => r.result.createObjectStore("chunks", { keyPath: "key" }); r.onsuccess = () => z(r.result); r.onerror = () => z(null); } catch { z(null); } });
}
async function keep(it: Item, on: boolean) {
  const d = await db(); if (!d) return;
  try { const tx = d.transaction("chunks", "readwrite"), s = tx.objectStore("chunks"); if (on) s.put({ ...it, key: `${it.k}|${it.mic}|${it.seq}` }); else s.delete(`${it.k}|${it.mic}|${it.seq}`); } catch {}
}
async function kept(k: string, mic: string): Promise<Item[]> {
  const d = await db(); if (!d) return [];
  return new Promise((z) => { try { const r = d.transaction("chunks").objectStore("chunks").getAll(); r.onsuccess = () => z((r.result || []).filter((x: any) => x.k === k && x.mic === mic)); r.onerror = () => z([]); } catch { z([]); } });
}
// Chunks of a task's session that's over: nothing will take them.
export async function micDropKept(k: string) { const d = await db(); if (!d) return; try { const s = d.transaction("chunks", "readwrite").objectStore("chunks"), r = s.getAll(); r.onsuccess = () => (r.result || []).filter((x: any) => x.k === k).forEach((x: any) => s.delete(x.key)); } catch {} }

// ---- the microphone ----
const TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/ogg;codecs=opus"];
const pickType = () => typeof MediaRecorder.isTypeSupported === "function" ? TYPES.find((t) => MediaRecorder.isTypeSupported(t)) : undefined;
// The browser's microphone, asked inside the person's tap. Echo cancellation off: in a meeting, the laptop's speaker is people too.
// With a meeting tab (ec): on, so the call's sound from the speakers isn't recorded a second time through the mic.
export async function micAcquire(ec = false): Promise<{ ok: true; stream: MediaStream } | { ok: false; title: string; body: string; name: string }> {
  if (!micSupported()) return { ok: false, name: "unsupported", title: "This browser can't record", body: "Live notes need a browser that can use the microphone, like Chrome, Safari or Edge." };
  try { return { ok: true, stream: await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: ec, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }) }; }
  catch (e: any) {
    const n = e?.name || "";
    if (n === "NotAllowedError" || n === "SecurityError") return { ok: false, name: n, title: "The microphone is off for 1Helm", body: "To take Live notes with this device, allow the microphone for this site in your browser's settings (Settings → Location & mic shows how), then try again." };
    if (n === "NotFoundError" || n === "OverconstrainedError") return { ok: false, name: n, title: "No microphone found", body: "Plug in or turn on a microphone, then try again." };
    return { ok: false, name: n, title: "Couldn't start the microphone", body: "Another app may be using it. Close that app, then try again." };
  }
}
export const micRelease = (s: MediaStream | null | undefined) => s?.getTracks().forEach((t) => t.stop());
export const inputRelease = (i: Input | null | undefined) => { micRelease(i?.tab); micRelease(i?.mic); };

// A meeting tab's sound, asked inside the person's tap (the browser's own picker opens: that part can't be ours). The least video
// the browser allows, stopped at once. withMic: the person's microphone too (their side of the call), asked after the share; a mic
// that won't start doesn't stop the tab (micNote says so).
export type TabGot = { ok: true; input: Input; micNote: string } | { ok: false; code: "cancelled" | "unsupported" | "error" | "no-audio"; fix: string };
export async function tabAcquire(withMic: boolean): Promise<TabGot> {
  if (tabSupported() !== "yes") return { ok: false, ...shareError("unsupported") };
  let s: MediaStream;
  try {
    s = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "browser", width: { max: 320 }, height: { max: 240 }, frameRate: { max: 1 } } as any,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false } as any,
      preferCurrentTab: false, selfBrowserSurface: "exclude", systemAudio: "include", surfaceSwitching: "include", monitorTypeSurfaces: "include",
    } as any);
  } catch (e: any) { const r = shareError(e?.name || ""); diag({ what: "share failed", name: e?.name || "" }); return { ok: false, ...r }; }
  const v = s.getVideoTracks()[0], surface = String((v?.getSettings?.() as any)?.displaySurface || ""), audio = s.getAudioTracks();
  for (const t of s.getVideoTracks()) { t.stop(); s.removeTrack(t); }
  const c = shareCheck({ audio: audio.length, surface, os: osOf(navigator.userAgent) });
  diag({ what: "shared", surface, audio: audio.length });
  if (!c.ok) { micRelease(s); return { ok: false, code: "no-audio", fix: c.fix }; }
  let mic: MediaStream | null = null, micNote = "";
  if (withMic) { const g = await micAcquire(true); if (g.ok) mic = g.stream; else micNote = `${g.title}: only the others are in the notes. ${g.body}`; }
  return { ok: true, input: { kind: "tab", system: c.kind === "system", tab: new MediaStream(audio), mic }, micNote };
}

const lvl = (m: Meter | null) => { if (!m) return null; m.an.getFloatTimeDomainData(m.buf as any); let s = 0; for (const v of m.buf) s += v * v; return Math.sqrt(s / m.buf.length); };
function levelNow(): number | null { return M.ctx?.state !== "running" ? null : lvl(M.meters.all); }
function newRec() {
  if (!M.stream) return;
  const type = pickType(); let rec: MediaRecorder;
  try { rec = new MediaRecorder(M.stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined); } catch { pause("recorder"); return; }
  M.rec = rec; M.parts = []; M.type = (rec.mimeType || type || "audio/webm");
  const parts = M.parts, at = M.chunkAt = M.run!.now(), t = M.chunkT = performance.now(), meta = M.meta = { voiced: 0, blind: false, who: "" }; M.cut.reset(t); M.vMic.reset(t); M.vTab.reset(t);
  rec.ondataavailable = (e) => { if (e.data?.size) parts.push(e.data); };
  rec.onstop = () => finishChunk(parts, rec.mimeType || M.type, at, performance.now() - t, meta.voiced, meta.blind, meta.who);
  rec.onerror = () => { diag({ what: "recorder error" }); rotate(); };
  try { rec.start(); } catch { pause("recorder"); }
}
// The chunk is over: send it (unless nobody spoke), and the next one has already started.
function finishChunk(parts: Blob[], mime: string, at: number, ms: number, voiced: number, blind: boolean, who = "") {
  const r = M.run; if (!r || !parts.length) return;
  const blob = new Blob(parts, { type: mime.split(";")[0] });
  if (!blind && voiced < 250) return;                 // silence: nothing to send
  if (blob.size < 200) return;
  const st = micStored(r.k) || { id: r.mic, seq: 0 }; const seq = st.seq; store(r.k, { ...st, id: r.mic, seq: seq + 1 });
  M.q?.push({ k: r.k, mic: r.mic, seq, blob, type: mime, at: Math.round(at), ms: Math.round(ms), voiced: Math.round(voiced), ...(who ? { who } : {}) });
}
// End the current chunk (its voice count is taken now, before the next chunk resets the cutter) and start the next one if live.
// Who: both meters → whoOf; a meeting tab without the person's mic → everything heard is the others.
const seal = () => { M.meta.voiced = M.cut.voicedMs(); M.meta.blind = M.cut.blind();
  M.meta.who = M.input?.kind !== "tab" ? "" : M.meters.mic && M.meters.tab ? whoOf({ mic: M.vMic.voicedMs(), tab: M.vTab.voicedMs() }) : M.meta.voiced >= 400 && !M.meta.blind ? "others" : ""; };
function rotate() { const old = M.rec; M.rec = null; seal(); if (old && old.state !== "inactive") { try { old.stop(); } catch {} } if (M.state === "live") newRec(); }
function loop() {
  if (M.state !== "live" || !M.rec) return;
  const t = performance.now(), run = M.ctx?.state === "running";
  if (run && M.meters.mic && M.meters.tab) { M.vMic.feed(t, lvl(M.meters.mic)); M.vTab.feed(t, lvl(M.meters.tab)); }
  if (M.cut.feed(t, levelNow())) rotate();
}

async function send(it: Item): Promise<Sent> {
  const r0 = M.run; if (!r0) return "stop";
  const q = new URLSearchParams({ mic: it.mic, seq: String(it.seq), at: String(it.at), ms: String(it.ms), voiced: String(it.voiced), ...(it.who ? { who: it.who } : {}) }), t0 = performance.now();
  let r: Response;
  try { r = await fetch(`${r0.base}${r0.path}/audio?${q}`, { method: "POST", credentials: "same-origin", headers: { "content-type": it.type }, body: it.blob }); }
  catch { return "retry"; }
  const j = await r.json().catch(() => ({} as any));
  if (r.ok) { M.sentAt = Date.now(); if (it.seq % 10 === 0 || performance.now() - t0 > 4000) diag({ what: "chunk", seq: it.seq, ms: it.ms, up_ms: Math.round(performance.now() - t0), stt_ms: j.stt_ms, added: j.added, who: it.who || "" }); return j.dup ? "dup" : "ok"; }
  if (r.status === 409 || r.status === 402) { diag({ what: "refused", status: r.status, error: j.error }); return "stop"; }
  if (r.status === 400 || r.status === 413 || r.status === 415) { diag({ what: "dropped", status: r.status, seq: it.seq }); return "drop"; }
  return "retry";
}
const via = () => M.input?.kind === "tab" ? (M.input.system ? "system" : "tab") : "mic";
const post = (body: any) => { const r = M.run; if (!r) return; fetch(`${r.base}${r.path}`, { method: "POST", credentials: "same-origin", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => {}); };
async function wakeOn() { try { if (!M.wake && document.visibilityState === "visible" && (navigator as any).wakeLock) { M.wake = await (navigator as any).wakeLock.request("screen"); M.wake.addEventListener?.("release", () => { M.wake = null; }); } } catch { M.wake = null; } }
function wakeOff() { try { M.wake?.release?.(); } catch {} M.wake = null; }

const meter = (ctx: AudioContext, node: AudioNode): Meter => { const an = ctx.createAnalyser(); an.fftSize = 1024; node.connect(an); return { an, buf: new Float32Array(an.fftSize) }; };
// Take an input: a mic records as it is; a meeting tab is mixed with the mic (when there is one) into one recorded stream.
function useInput(input: Input) {
  M.input = input; M.meters = { all: null, mic: null, tab: null };
  for (const s of [input.tab, input.mic]) for (const tr of s?.getAudioTracks() || []) {
    tr.onmute = () => { if (M.input === input) check(); };
    tr.onunmute = () => { if (M.input === input) check(); };
    tr.onended = () => { if (M.input === input) check(); };
  }
  M.ctx?.close().catch(() => {}); M.ctx = null;
  try { M.ctx = new (window.AudioContext || (window as any).webkitAudioContext)(); M.ctx.resume().catch(() => {}); } catch { M.ctx = null; }
  const ctx = M.ctx;
  if (input.kind === "mic" || !input.tab) {
    M.stream = input.mic;
    try { if (ctx && input.mic) M.meters.all = meter(ctx, ctx.createMediaStreamSource(input.mic)); } catch {}
    return;
  }
  // A meeting tab: tab (+ mic) → one destination. Without an AudioContext nothing can be mixed: the tab's own sound is recorded.
  if (!ctx) { M.stream = input.tab; return; }
  try {
    const dest = ctx.createMediaStreamDestination(), sum = ctx.createGain();
    const ts = ctx.createMediaStreamSource(input.tab); ts.connect(dest); ts.connect(sum); M.meters.tab = meter(ctx, ts);
    if (input.mic && liveTrack(input.mic)) { const ms = ctx.createMediaStreamSource(input.mic); ms.connect(dest); ms.connect(sum); M.meters.mic = meter(ctx, ms); }
    M.meters.all = meter(ctx, sum); M.stream = dest.stream;
  } catch (e: any) { diag({ what: "mix failed", err: String(e?.message || e).slice(0, 120) }); M.stream = input.tab; M.meters = { all: null, mic: null, tab: null }; }
}
function goLive() {
  const was = M.state, at = M.pausedAt, why = M.why;
  M.state = "live"; M.needTap = false; M.why = ""; M.pausedAt = 0; M.shareErr = "";
  newRec(); wakeOn(); post({ action: "mic", mic: M.run!.mic, state: "live", via: via() });
  if (was === "paused" && at) { const m = Math.max(1, Math.round((Date.now() - at) / 60e3)); M.run!.note("Listening again", why === "share" ? `Live notes were paused for ${m} min while nothing was shared. That part isn't in the notes.` : `Live notes were paused for ${m} min while this device couldn't hear. That part isn't in the notes.`); diag({ what: "resumed", paused_s: Math.round((Date.now() - at) / 1000), via: via() }); }
  M.run!.onChange();
}
function pause(why: string) {
  if (!M.run || M.state === "paused" || M.state === "off") return;
  M.state = "paused"; M.why = why; M.pausedAt = Date.now();
  rotate();   // the audio so far goes out now (state isn't live: no new chunk starts)
  if (why === "background") { micRelease(M.input?.mic); M.input = null; M.stream = null; }   // the browser stops it anyway; a fresh one on return
  if (why === "share") { micRelease(M.input?.tab); }   // the person's mic stays open: "Continue with the mic only" uses it
  post({ action: "mic", mic: M.run.mic, state: "paused", via: via() }); diag({ what: "paused", why });
  M.run.onChange();
}
// What is the input doing? A meeting tab: its sound ended (Stop sharing, the tab closed) → paused until the person picks what's next;
// the mic ending there only drops their side. The mic: visible again after a pause → pick it up (a new stream if the old one is gone;
// a tap if the browser wants one).
async function check() {
  if (!M.run) return;
  if (M.input?.kind === "tab") {
    if (M.state === "live" && !liveTrack(M.input.tab)) pause("share");
    else if (M.state === "live" && M.meters.mic && !liveTrack(M.input.mic)) { diag({ what: "mic ended (tab goes on)" }); M.run.onChange(); }
    return;
  }
  if (M.state === "paused" && M.why === "share") return;   // waiting for the person's pick
  const tr = M.input?.mic?.getAudioTracks()[0], vis = document.visibilityState === "visible";
  const now = micStateOf({ visible: vis, trackLive: !!tr && tr.readyState === "live", muted: !!tr?.muted, ios: ios() });
  if (now === "paused" && M.state === "live") { pause(!vis ? "background" : tr?.muted ? "muted" : "ended"); return; }
  if (M.state === "paused" && vis && !M.needTap) {
    if (tr && tr.readyState === "live" && !tr.muted) { goLive(); return; }
    if (!tr || tr.readyState !== "live") {
      const g = await micAcquire(); if (!M.run || M.state !== "paused") { if (g.ok) micRelease(g.stream); return; }
      if (g.ok) { useInput({ kind: "mic", system: false, tab: null, mic: g.stream }); goLive(); } else { M.needTap = true; diag({ what: "resume needs a tap", name: g.name }); M.run.onChange(); }
    }
  }
}
// The pane's Resume button (inside the tap: the browser may want one).
export async function micResumeTap() {
  if (!M.run) return; M.needTap = false;
  const g = await micAcquire();
  if (!g.ok) { M.needTap = true; M.run.note(g.title, g.body); M.run.onChange(); return; }
  inputRelease(M.input); useInput({ kind: "mic", system: false, tab: null, mic: g.stream }); M.state = "paused"; goLive();
}
// After sharing stopped (shareEndedView's buttons, inside the tap): "mic" goes on with the person's mic only; "again" opens the
// browser's picker again (withMic: their mic too). → false when it didn't start (M.shareErr / a note says why).
export async function micShareAct(act: "mic" | "again", withMic = true): Promise<boolean> {
  const r = M.run; if (!r || M.state !== "paused") return false;
  if (act === "mic") {
    let mic = M.input?.mic && liveTrack(M.input.mic) ? M.input.mic : null;
    if (!mic) { const g = await micAcquire(); if (!g.ok) { r.note(g.title, g.body); return false; } mic = g.stream; }
    micRelease(M.input?.tab); useInput({ kind: "mic", system: false, tab: null, mic }); setKind(r.k, "mic"); goLive(); return true;
  }
  const keepMic = M.input?.mic && liveTrack(M.input.mic) ? M.input.mic : null;
  const g = await tabAcquire(withMic && !keepMic);
  if (!M.run || M.run !== r || M.state !== "paused") { if (g.ok) inputRelease(g.input); return false; }
  if (!g.ok) { M.shareErr = g.fix; r.onChange(); return false; }
  if (keepMic && withMic) g.input.mic = keepMic; else if (keepMic) micRelease(keepMic);
  if (g.micNote) r.note("Your microphone didn't start", g.micNote);
  useInput(g.input); setKind(r.k, "tab"); goLive(); return true;
}

// Start recording for task k (after the server said Live notes are on with this mic id). input: from micAcquire() (a stream) or
// tabAcquire() (an Input); null after a reload: the mic is asked again, and a meeting tab waits for the person (sharing can't restart by itself).
export async function micRun(o: Run, input: MediaStream | Input | null) {
  if (M.run && M.run.k !== o.k) await micEnd(false);
  const inp: Input | null = !input ? null : input instanceof MediaStream ? { kind: "mic", system: false, tab: null, mic: input } : input;
  if (M.run?.k === o.k && M.state !== "off") { inputRelease(inp); return; }
  M.run = o; M.state = "starting"; M.needTap = false; M.shareErr = ""; lock(o.k, true);
  M.q = createQueue({ send, sleep: (ms) => new Promise((z) => setTimeout(z, ms)), keep: (it, on) => { void keep(it, on); }, onStop: () => { const r = M.run; void micEnd(false).then(() => r?.onStopped()); }, onChange: () => M.run?.onChange() });
  for (const it of (await kept(o.k, o.mic)).sort((a, b) => a.seq - b.seq)) M.q.push(it, true);   // chunks a reload or a crash left unsent
  M.untick?.(); M.untick = ticker(loop, 100);
  M.unbeat?.(); M.unbeat = ticker(() => { if (!M.run) return; lock(M.run.k, true); if (M.state === "live") { void check(); if (Date.now() - Math.max(M.sentAt, M.pingAt) > 25e3) { M.pingAt = Date.now(); post({ action: "mic", mic: M.run.mic, state: "live", via: via() }); } } }, 5000);
  if (!inp && micStored(o.k)?.kind === "tab") {   // a reload while a meeting tab was shared
    M.input = { kind: "tab", system: false, tab: null, mic: null }; M.state = "paused"; M.why = "share"; M.pausedAt = Date.now();
    post({ action: "mic", mic: o.mic, state: "paused", via: "tab" }); o.onChange(); diag({ what: "reload: share gone" }); return;
  }
  let use = inp;
  if (!use) { const g = await micAcquire(); if (!g.ok) { M.state = "paused"; M.needTap = true; M.pausedAt = Date.now(); post({ action: "mic", mic: o.mic, state: "paused" }); o.onChange(); return; } use = { kind: "mic", system: false, tab: null, mic: g.stream }; }
  useInput(use); goLive();
  diag({ what: "started", type: M.type, ios: ios(), wake: !!(navigator as any).wakeLock, via: via(), mic: !!use.mic });
}
// Stop recording. flush: send the last chunk and wait for everything (up to 10 s) → true when all of it reached the server.
export async function micEnd(flush: boolean): Promise<boolean> {
  if (!M.run) return true;
  const r = M.run, q = M.q, old = M.rec;
  M.state = "off"; M.untick?.(); M.unbeat?.(); M.untick = M.unbeat = null; M.rec = null; seal();
  if (old && old.state !== "inactive") { await new Promise<void>((z) => { const prev = old.onstop as any; old.onstop = (e) => { try { prev?.call(old, e); } finally { z(); } }; try { old.stop(); } catch { z(); } }); }
  inputRelease(M.input); M.input = null; M.stream = null; M.ctx?.close().catch(() => {}); M.ctx = null; M.meters = { all: null, mic: null, tab: null }; wakeOff();
  const all = q ? await q.drain(flush ? 10000 : 15000) : true;
  if (M.run === r) { M.run = null; M.needTap = false; M.pausedAt = 0; M.shareErr = ""; }
  lock(r.k, false); diag({ what: "ended", flushed: all });
  r.onChange(); return all;
}
export function micInit() {
  document.addEventListener("visibilitychange", () => { if (!M.run) return; if (document.visibilityState === "visible") wakeOn(); void check(); });
  window.addEventListener("online", () => { if (M.run) M.run.onChange(); });
  window.addEventListener("pagehide", () => { if (M.run && M.state === "live") { rotate(); post({ action: "mic", mic: M.run.mic, state: "paused", via: via() }); } });
}
