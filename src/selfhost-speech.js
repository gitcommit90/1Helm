// Speech models that 1Helm runs itself, in the speech container (speech-container.js). The IDs follow selfhost-models.js: "@1hc/" and the Hugging Face repository.
//   @1hc/Qwen/Qwen3-ASR-1.7B                          speech        Apache-2.0, GGUF Q8_0 on llama.cpp. WER 1.2 percent on the noisy test file, 0.3 percent on 144 s. No word times.
//   @1hc/nvidia/nemotron-3.5-asr-streaming-0.6b       speech, speech_live   OpenMDW-1.1, transformers on the CPU. Faster (real time factor 0.16 to 0.23), gives word times.
//   @1hc/nvidia/Nemotron-3-Diarization                diarize       OpenMDW-1.1, transformers on the CPU, offline mode (real time factor 0.04). Says who spoke when.
// Measured 2026-10-22 on Cloudflare standard-4 (tmp-shots/stt-cf, and the proof run in tmp-shots/speech-selfhost/lane1). Nothing here chooses a model: the saved
// settings do (the Models page), and model-dispatch.js calls these functions for a step whose model ID starts with "@1hc/".
//
// A call does not wait for a cold container, unless it is the last model of its job's chain (or the only one) and the job's time limit leaves room for a
// cold start (speechWaitMs below). Otherwise, when no container of the pool is ready, the call starts one in the background and throws an error with
// warming set to true within about a second, so the job's next model (a fallback) answers. Cost is the container's measured compute seconds at Cloudflare's
// published rates (selfhost-models.js dollarsPerSecond), with no markup: the caller adds the usual markup, as it does for the embedding model.
import { dollarsPerSecond } from "./selfhost-models.js";
import { SPEECH_INSTANCE, SPEECH_MAX_INFLIGHT } from "./speech-setup.js";

export const SPEECH_MODELS = { qwen: "@1hc/Qwen/Qwen3-ASR-1.7B", nemotron: "@1hc/nvidia/nemotron-3.5-asr-streaming-0.6b", diar: "@1hc/nvidia/Nemotron-3-Diarization" };
const KIND_OF = Object.fromEntries(Object.entries(SPEECH_MODELS).map(([k, id]) => [id, k]));
export const isSpeechModel = (id) => Object.hasOwn(KIND_OF, id);
// Reservation sizing: the real time factor to plan for (the measured worst case plus room), in container seconds per audio second.
// Measured 2026-10-22: Qwen 0.37 to 0.48, Nemotron 0.16 to 0.23 (0.3 for a 5 s chunk), diarization 0.04 (0.13 end to end for a 36 s file).
export const SPEECH_PLAN_RTF = { qwen: 0.7, nemotron: 0.45, diar: 0.15 };
export const speechSecNano = (kind) => Math.ceil(SPEECH_PLAN_RTF[kind] * dollarsPerSecond(SPEECH_INSTANCE) * 1e9);
export const SPEECH_MAX_BYTES = 25 * 1024 * 1024;
export const SPEECH_FORMATS = ["wav", "webm", "mp4", "m4a", "mp3", "ogg", "flac"];

export class SpeechWarmingError extends Error {
  constructor(message = "The speech container is starting. Try again in a minute.") { super(message); this.name = "SpeechWarmingError"; this.warming = true; }
}
export const isSpeechWarming = (e) => !!e?.warming;

// ---- waiting for a cold container ----
// A cold start from the template took 34 to 92 seconds, about 55 typically (docs/MODELS.md). The last model of a chain has no next model to fall back to, so it
// waits for the pool when the job's limit for one attempt leaves room: the wait is at most SPEECH_WAIT_MAX_MS and ends SPEECH_WAIT_MARGIN_MS before the limit, and a
// limit that leaves less than SPEECH_WAIT_MIN_MS gets no wait at all. No limit (null or 0) means the full SPEECH_WAIT_MAX_MS.
export const SPEECH_WAIT_MAX_MS = 90e3, SPEECH_WAIT_MIN_MS = 60e3, SPEECH_WAIT_MARGIN_MS = 10e3;
export const SPEECH_WAIT_TIMING = { pollMs: 2000 };   // a test shortens it
export function speechWaitMs({ last = false, limitMs = 0 } = {}) {
  if (!last) return 0;
  const limit = Number(limitMs) > 0 ? Number(limitMs) : Infinity;
  const ms = Math.min(SPEECH_WAIT_MAX_MS, limit - SPEECH_WAIT_MARGIN_MS);
  return ms >= SPEECH_WAIT_MIN_MS ? ms : 0;
}
// Runs fn; while it throws the warming error and waitMs has not passed, tries again every pollMs (each try also nudges the pool to start, as pickSlot does).
// After waitMs, or when the caller's signal aborts, the warming error goes out as it did before.
async function whileWarming(fn, { waitMs = 0, signal = null } = {}) {
  const until = Date.now() + (Number(waitMs) > 0 ? Number(waitMs) : 0);
  for (;;) {
    try { return await fn(); }
    catch (e) {
      if (!isSpeechWarming(e) || Date.now() + SPEECH_WAIT_TIMING.pollMs >= until || signal?.aborted) throw e;
      await new Promise((r) => setTimeout(r, SPEECH_WAIT_TIMING.pollMs));
    }
  }
}

// ---- the pool ----
const binding = (env) => { if (!env?.SPEECH_CONTAINER) throw new Error("No speech container is available on this server."); return env.SPEECH_CONTAINER; };
export const speechSlots = (env) => Math.min(64, Math.max(1, Math.floor(Number(env?.SPEECH_MAX_INSTANCES)) || 1));
const slotStub = (env, i) => binding(env).get(binding(env).idFromName(`speech:${i}`));
const coordinator = (env) => binding(env).get(binding(env).idFromName("speech:coordinator"));
const hash32 = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };
// Picks the slot for a call and returns its stub. Ready slots take the work: the preferred slot first (a session's own), else the least busy one, lowest number
// first so a small load stays on few containers. When every ready slot already has SPEECH_MAX_INFLIGHT requests, one more slot is started in the background.
// When no slot is ready, one is started (if none is starting) and the call throws the warming error.
export async function pickSlot(env, { prefer = null } = {}) {
  const n = speechSlots(env);
  const states = await Promise.all(Array.from({ length: n }, (_, i) => slotStub(env, i).speechState().then((s) => ({ i, ...s }), () => ({ i, state: "cold", inflight: 0 }))));
  // A slot reported as warming with no start in progress (booting false) is not warming: it gets a start like a cold one.
  for (const s of states) if (s.state === "warming" && s.booting === false) { await slotStub(env, s.i).warm().catch(() => {}); s.booting = true; }
  const ready = states.filter((s) => s.state === "ready");
  const cold = states.find((s) => s.state === "cold" && (prefer == null || s.i === prefer)) || states.find((s) => s.state === "cold");
  if (!ready.length) {
    if (!states.some((s) => s.state === "warming") && cold) await slotStub(env, cold.i).warm().catch(() => {});
    throw new SpeechWarmingError();
  }
  const pick = ready.find((s) => s.i === prefer && s.inflight < SPEECH_MAX_INFLIGHT) || [...ready].sort((a, b) => a.inflight - b.inflight || a.i - b.i)[0];
  if (ready.every((s) => s.inflight >= SPEECH_MAX_INFLIGHT) && cold && !states.some((s) => s.state === "warming")) await slotStub(env, cold.i).warm().catch(() => {});
  return slotStub(env, pick.i);
}
// One HTTP request to the chosen slot. A container that stopped between the check and the call is the same as a cold one.
async function callSlot(stub, { method = "POST", path, body = null }) {
  const r = await stub.speechRequest({ method, path, body });
  if (r.state !== "ok") { await stub.warm().catch(() => {}); throw new SpeechWarmingError(); }   // warm() joins a start that runs, or starts one
  let j = null; try { j = JSON.parse(r.body); } catch {}
  if (r.status === 503 && j?.error === "loading") throw new SpeechWarmingError();
  if (r.status < 200 || r.status >= 300) throw new Error(`the speech container failed (${r.status}${j?.error ? `: ${String(j.error).slice(0, 160)}` : ""})`);
  return j || {};
}

const toBuffer = (audio) => {
  const u = audio instanceof ArrayBuffer ? new Uint8Array(audio) : ArrayBuffer.isView(audio) ? new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength) : null;
  if (!u || !u.byteLength) throw new Error("there is no audio to read");
  if (u.byteLength > SPEECH_MAX_BYTES) throw new Error("the audio is too large for the speech container");
  return u.byteLength === u.buffer.byteLength ? u.buffer : u.slice().buffer;
};
const formatOf = (f) => { const x = String(f || "wav").toLowerCase(); if (!SPEECH_FORMATS.includes(x)) throw new Error(`the speech container does not read ${x} audio`); return x; };
export function usageOf(j) {
  const ms = Math.max(0, Math.round(Number(j?.process_ms) || 0));
  return { cost: (ms / 1000) * dollarsPerSecond(SPEECH_INSTANCE), container_ms: ms, audio_s: Number(j?.audio_s) || 0, instance: SPEECH_INSTANCE };
}

// ---- the contract (shared with the live notes and the transcription code) ----
export async function selfTranscribe(env, model, { audio, format = "wav", language = "" } = {}, meta = {}, wait = {}) {
  const kind = KIND_OF[model];
  if (kind !== "qwen" && kind !== "nemotron") throw new Error(`${model} cannot transcribe`);
  const body = toBuffer(audio), fmt = formatOf(format);
  const j = await whileWarming(async () => callSlot(await pickSlot(env), { path: `/transcribe?model=${kind}&format=${fmt}${language ? `&lang=${encodeURIComponent(String(language).slice(0, 12))}` : ""}`, body }), wait);
  return { model, segs: Array.isArray(j.segs) ? j.segs : [], words: Array.isArray(j.words) ? j.words : [], usage: usageOf(j) };
}
export async function selfDiarize(env, model, { audio, format = "wav", num_speakers = 0 } = {}, meta = {}, wait = {}) {
  if (KIND_OF[model] !== "diar") throw new Error(`${model} cannot label speakers`);
  const body = toBuffer(audio), fmt = formatOf(format), n = Math.floor(Number(num_speakers)) || 0;
  const j = await whileWarming(async () => callSlot(await pickSlot(env), { path: `/diarize?format=${fmt}${n > 0 ? `&num_speakers=${Math.min(n, 16)}` : ""}`, body }), wait);
  return { model, turns: Array.isArray(j.turns) ? j.turns : [], usage: usageOf(j) };
}

// ---- live sessions ----
// sessionKey = <tenant>:<channel>:<task>:s<n>. The chunks are in R2 at t/<tenant>/live-audio/<channel>/<task>/s<n>/<seq>.wav (written and deleted by the live notes
// code, with the R2 custom metadata at_ms), so a container that restarted can be given them again.
const PART = /^[A-Za-z0-9._-]{1,128}$/;
export function sessionParts(key) {
  const p = String(key || "").split(":");
  if (p.length !== 4 || !p.slice(0, 3).every((x) => PART.test(x)) || !/^s\d{1,9}$/.test(p[3])) throw new Error("bad session key");
  return { tenant: p[0], channel: p[1], task: p[2], run: p[3] };
}
export const sessionPrefix = (key) => { const s = sessionParts(key); return `t/${s.tenant}/live-audio/${s.channel}/${s.task}/${s.run}/`; };
const sessionPath = (key, tail) => `/session/${encodeURIComponent(key)}${tail}`;
const sessionSlot = (env, key) => hash32(key) % speechSlots(env);

export async function selfSessionAppend(env, sessionKey, { seq, at_ms, audio, format = "wav" } = {}) {
  sessionParts(sessionKey);
  const q = Math.floor(Number(seq)); if (!(q >= 0)) throw new Error("bad chunk number");
  const j = await callSlot(await pickSlot(env, { prefer: sessionSlot(env, sessionKey) }), { path: sessionPath(sessionKey, `/chunk?seq=${q}&at_ms=${Math.floor(Number(at_ms)) >= 0 ? Math.floor(Number(at_ms)) : -1}&format=${formatOf(format)}`), body: toBuffer(audio) });
  return { ok: true, chunks: Number(j.chunks) || 0 };
}
// Gives the container every chunk it does not hold, from R2 (a container that restarted, or another one of the pool than the one that took the appends).
async function syncSession(env, stub, sessionKey) {
  if (!env?.WS?.list) return 0;
  const prefix = sessionPrefix(sessionKey), have = new Set((await callSlot(stub, { method: "GET", path: sessionPath(sessionKey, "") })).seqs || []);
  const found = []; let cursor;
  for (let page = 0; page < 20; page++) {
    const l = await env.WS.list({ prefix, ...(cursor ? { cursor } : {}) });
    for (const o of l.objects || []) { const m = /\/(\d+)\.wav$/.exec(o.key); if (m && !have.has(Number(m[1]))) found.push({ key: o.key, seq: Number(m[1]) }); }
    if (!l.truncated) break; cursor = l.cursor;
  }
  found.sort((a, b) => a.seq - b.seq);
  for (const f of found) {
    const o = await env.WS.get(f.key); if (!o) continue;
    const at = Number(o.customMetadata?.at_ms);
    await callSlot(stub, { path: sessionPath(sessionKey, `/chunk?seq=${f.seq}&at_ms=${Number.isFinite(at) && at >= 0 ? Math.floor(at) : -1}&format=wav`), body: await o.arrayBuffer() });
  }
  return found.length;
}
export async function selfSessionDiarize(env, sessionKey, model = SPEECH_MODELS.diar, meta = {}, wait = {}) {
  sessionParts(sessionKey);
  if (KIND_OF[model] !== "diar") throw new Error(`${model} cannot label speakers`);
  const j = await whileWarming(async () => {
    const stub = await pickSlot(env, { prefer: sessionSlot(env, sessionKey) });
    await syncSession(env, stub, sessionKey);
    return callSlot(stub, { path: sessionPath(sessionKey, "/diarize") });
  }, wait);
  const co = coordinator(env), prev = await co.sessionGet(sessionKey).catch(() => null);
  const turns = stabilizeSpeakers(prev, Array.isArray(j.turns) ? j.turns : []);
  await co.sessionPut(sessionKey, turns).catch(() => {});
  return { turns, usage: usageOf(j) };
}
export async function selfSessionEnd(env, sessionKey) {
  sessionParts(sessionKey);
  await coordinator(env).sessionDrop(sessionKey).catch(() => {});
  const n = speechSlots(env);
  await Promise.all(Array.from({ length: n }, async (_, i) => {   // best effort: only ready slots can hold the chunks
    try { const s = slotStub(env, i); if ((await s.speechState()).state === "ready") await s.speechRequest({ method: "DELETE", path: sessionPath(sessionKey, "") }); } catch {}
  }));
  return { ok: true };
}

// The diarizer numbers speakers from 0 in order of first appearance on each run, so the same voice can get another number on the next run. This renames the new
// turns so that each speaker takes the earlier number it overlaps most in time (each earlier number is used once); a speaker with no overlap gets a new number.
export function stabilizeSpeakers(prev, next) {
  const turns = (next || []).map((t) => ({ start_ms: Number(t.start_ms), end_ms: Number(t.end_ms), speaker: Number(t.speaker) }));
  if (!Array.isArray(prev) || !prev.length || !turns.length) return turns;
  const pairs = new Map();
  for (const a of turns) for (const b of prev) {
    const o = Math.min(a.end_ms, b.end_ms) - Math.max(a.start_ms, b.start_ms);
    if (o > 0) { const k = `${a.speaker}:${b.speaker}`; pairs.set(k, (pairs.get(k) || 0) + o); }
  }
  const map = new Map(), used = new Set();
  for (const [k, o] of [...pairs].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))) {
    const [a, b] = k.split(":").map(Number); if (map.has(a) || used.has(b)) continue; map.set(a, b); used.add(b);
  }
  let top = Math.max(-1, ...prev.map((t) => Number(t.speaker) || 0), ...map.values());
  for (const t of turns) { if (!map.has(t.speaker)) map.set(t.speaker, ++top); }
  return turns.map((t) => ({ ...t, speaker: map.get(t.speaker) }));
}
