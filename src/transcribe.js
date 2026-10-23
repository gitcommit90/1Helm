// Speech to text, one path (stt) for all three uses: dictation (POST /api/transcribe, below), Live notes chunks from the device's
// microphone (live-mic.js) and audio/video file sidecars (sidecar.js). Live dictation in the composer is a fourth use with its own
// file (transcribe-live.js), which cuts the microphone's audio into short WAV chunks and sends each one through stt() as well.
//
// The order (an accuracy choice by the Captain, 2026-10-15; the saved "stt" job, model-seed.js), all through OpenRouter on ZDR endpoints
// only, so every one is allowed at every AI data privacy level (Unrestricted / No Training / ZDR; privacy.js registry, below):
//   1. assemblyai/universal-3-6-pro   AssemblyAI is its only host, $0.0000833/s ($0.30 per audio hour), 25x the price of Qwen. It takes
//                                     WAV only (16-bit PCM at any sample rate or channel count) and has no length limit up to 20 min / 38 MB
//                                     (checked 2026-10-15). Audio in any other format skips it (the model's saved "formats" fact), so
//                                     webm, m4a, mp4 and mp3 go to the next model until the device or a converter sends WAV. Live notes' microphone chunks from the app are
//                                     WAV (16 kHz, mono, 16-bit, 32 KB a second; design-sandbox src/pcm.ts), and live dictation sends the same PCM; only a browser
//                                     with no AudioWorklet still sends webm or mp4. Audio inside uploaded files (mp3, FLAC, Opus and Vorbis in ogg or webm, AAC-LC and ALAC in m4a, mp4 or mov)
//                                     is converted to 16 kHz mono WAV in the Worker when env.AUDIO_CONVERT is "on" (audio-convert.js, WebAssembly decoders, CPU
//                                     only, nothing billed for the conversion; sidecar.js transcribeFile); a file the converter doesn't read, or when it is off,
//                                     goes to Qwen3 as before.
//   2. qwen/qwen3-asr-0.6b            DeepInfra (ZDR), $0.012/h, the former default (STT_MODEL named it)
//   3. openai/whisper-large-v3-turbo  DeepInfra and Groq (ZDR), $0.012/h
//   4. Workers AI's Whisper (job stt_cloudflare), only when every OpenRouter model failed and the recording is <= 20 MB (a different
//      provider entirely, so dictation and Live notes keep working through an OpenRouter outage).
// A failure at any step (an error, a timeout, a file over a model's limit) sends the same audio to the next step.
// The saved settings are the one place the models are named; env.STT_MODEL, when set, replaces the first model in the first-run data only.
// AssemblyAI answers one segment for the whole recording, with no timestamps inside it and no word confidence: segsOf spreads a long
// one over sentences by their share of the text, so file transcripts keep a timestamp about every 30 s (approximate, content intact).
//
// Survey + bench (2026-10-08, local validation evidence: survey.json, results.json, bench.mjs). OpenRouter lists 26 transcription models;
// 20 have a ZDR endpoint. Our audio: the 36 s two-voice meeting as 7 pause-cut webm chunks (what Live notes sends) and as one file,
// the same with pink noise + babble, Spanish-accented English, UK/AU voices with noise, a Spanish meeting; 2.4 min and 30 min files.
// WER: chunks clean / chunks noisy / file noisy / accent+noise / Spanish; p50 per chunk; 30 min file: WER, wall time. $ per audio hour.
//   qwen/qwen3-asr-0.6b (DeepInfra, ZDR)            $0.012  3.5 / 4.7 / 4.7 / 9.3 / 0%    0.46 s   3.5%, 20 s    ← the default until 2026-10-15
//   openai/whisper-large-v3-turbo (DeepInfra, ZDR)  $0.012  5.8 / 11.6 / 8.1 / 5.8 / 0%   1.0-1.4 s 1.4%, 37 s
//   nvidia/nemotron-3.5-asr-streaming 0.6b (ZDR)    $0.012  4.7 / 19.8 / 19.8 / 22.1 / 0% 1.2 s
//   qwen/qwen3-asr-1.7b (ZDR)                       $0.027  2.3 / 4.7 / 3.5 / 8.1 / 0%    0.54 s   3.1%, 19 s
//   openai/whisper-large-v3 (ZDR)                   $0.027+ 3.5 / 3.5 / 2.3 / 12.8 / 0%   0.6 s
//   mistralai/voxtral-mini-3b (ZDR)                 $0.06   webm refused; files 1.2 / 5.8 noisy, Spanish answered in English
//   elevenlabs/scribe-v2 (ZDR; billed $0.11/h)      $0.11   0 / 3.5 / 0 / 2.3 / 0%        0.52 s   but 16% on 30 min (dropped passages), no timestamps
//   mistralai/voxtral-small-24b-stt (ZDR)           $0.18   webm refused; Spanish answered in English
//   deepgram/nova-3 (ZDR)                           $0.26   2.3 / 11.6 / 3.5 / 9.3 / 100% (English only by default)  0.34 s
//   fish-audio/transcribe-1 / -1-pro (ZDR)          $0.36   webm refused / 16-46% (speaker markup)
//   google/chirp-3 (ZDR)                            $0.96   2.3 / 18.6 / 7.0 / 5.8 / 0%   1.1 s
//   assemblyai/universal-3.5-pro (ZDR)              $0.45   WAV only, ≤ 120 s (3.6 Pro, checked 2026-10-15: no 120 s limit); nvidia/parakeet-tdt (Together, ZDR) down (404)
//   microsoft/mai-transcribe-1.5 / -2 (ZDR): listed at $0.36 / $0.10 per audio SECOND ($360+/h), not run
//   No ZDR endpoint (not usable at the strictest level): openai/gpt-4o(-mini)-transcribe, gpt-transcribe, whisper-1,
//   google/gemini-3.5-transcribe, x-ai/grok-stt-1.0, meta/muse-voice-transcribe-1.0, qwen/qwen3-asr-flash, voxtral-mini-transcribe (EU ZDR 404'd).
// Heavy (Spanish) accent: every model ≤ $0.03/h fails (64-91% WER); scribe-v2 5.8%, chirp-3 18.6%.
// → Qwen3-ASR 0.6B (the choice of 2026-10-08, second since 2026-10-15): the lowest price on OpenRouter (tied with whisper turbo, 2.5× under Workers AI's $0.031/h), the best WER of the
// cheap tier on live chunks and in noise, the fastest chunks (0.4-0.7 s), timed segments, webm/m4a/mp4/mp3/wav, 30 languages.
// Its quirks, handled here: it ignores prompt and language (measured), and on pure silence it makes words up ("Ahora.", "Hoy es el
// día de la Navidad.") with a low avg_logprob (-0.86 to -1.06; real speech, even badly accented, ≥ -0.75), and an odd off-language
// tail in babble ("你唔係。"). So segments under MIN_LOGPROB are dropped (this also drops Whisper's noise tails, "Am I right?" -1.02),
// and so are short Han/Kana/Hangul segments in a transcript that isn't in those scripts. Files over ~50 min: it answers 400 → Whisper.
import { cappedResponseJson } from "./bounded-response.js";
import { dispatch, stepsOf, jobModels, modelFacts } from "./ee/index.js";
import { privacyOf } from "./privacy.js";
import { isCloudflareModel } from "./cloudflare-models.js";
import { STT_NANO_PER_SEC, MARKUP } from "./stt-pricing.js";
export { STT_NANO_PER_SEC, MARKUP } from "./stt-pricing.js";
import { SPEECH_MAX_BYTES } from "./selfhost-speech.js";

// The models are saved settings (model-jobs.js): "stt" is the main speech to text model with its OpenRouter fallbacks, and "stt_cloudflare"
// is the Workers AI model used only when every OpenRouter model failed. Change them on the Models page.
// Privacy (privacy.js): the OpenRouter models are registered under ENDPOINTS.transcription with their ZDR hosts, and every request is
// checked by enforceRequest at "zdr", the strictest level, which every level allows (stricter is never a weaker route): the audio only
// ever reaches zero-data-retention endpoints, whatever the account chose. A saved model that isn't registered gets
// OpenRouter's strictest filter (zdr, data_collection deny). Workers AI (the last fallback) is Cloudflare's own inference, not OpenRouter.
export const WAI_NANO_PER_MIN = 513000;           // Workers AI whisper-large-v3-turbo: $0.000513 per audio minute (model page and model list API; the pricing page rounds it to $0.0005; 46.63 neurons x $0.011 per 1,000 neurons = $0.000513; checked 2026-10-15)
export const WAI_NANO_PER_NEURON = 11000;         // $0.011 per 1k neurons, if Whisper ever stops reporting the duration
export const WAI_MAX_BYTES = 20 * 1024 * 1024;    // Workers AI's input (base64 in JSON) stays under its request limit
export const MIN_LOGPROB = -0.8;
export const STT_MAX_BYTES = 25 * 1024 * 1024, STT_MAX_SEC = 300;
export const SLACK_SEC = 30;
export const reserveFor = (nanoPerSec) => Math.ceil((STT_MAX_SEC + SLACK_SEC) * nanoPerSec * MARKUP);
export const STT_RESERVE = reserveFor(STT_NANO_PER_SEC);
// The dearest price per audio second (nano-dollars) any saved speech model that takes this audio format may charge: a model's saved
// "formats" fact lists what it accepts (absent = anything) and "sec_nano" its price (absent = STT_NANO_PER_SEC). Reservations use it,
// so a WAV recording that AssemblyAI transcribes is reserved at AssemblyAI's price and a webm one at the cheaper models' price.
export async function sttRate(env, format) {
  let facts = {}; try { facts = await modelFacts(env); } catch {}
  let rate = STT_NANO_PER_SEC;
  for (const m of await sttModels(env)) { const f = facts[m]; if (!Array.isArray(f?.formats) || f.formats.includes(format)) rate = Math.max(rate, Number(f?.sec_nano) || 0); }
  return rate;
}
// One dictation attempt is limited by the saved timeout of the speech jobs (limits.js, 30 seconds to start with; a 5-minute clip takes ~2 s).
const HEARD_NOTHING = "Couldn't hear that, try again.";
const TOO_LONG = "That recording is too long. Keep it under 5 minutes.";
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export const AUDIO = /^(audio\/[a-z0-9.+-]+|video\/(webm|mp4|quicktime)|application\/octet-stream)$/;
export const sttModels = (env) => jobModels(env, "stt");

// The body, read with a hard cap (a lying or missing content-length can't make us buffer more than the limit).
export async function readCapped(req, max) {
  if (!req.body) return new Uint8Array(0);
  const rd = req.body.getReader(), parts = []; let n = 0;
  for (;;) {
    const { done, value } = await rd.read(); if (done) break;
    n += value.byteLength; if (n > max) { rd.cancel().catch(() => {}); return null; }
    parts.push(value);
  }
  const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.byteLength; } return out;
}
export function b64(u8) {
  let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
// What a Workers AI clip cost us: Whisper's own duration, else its neurons, else a guess from the size (~32 kbps), capped at 5 min.
export function waiCost(out, bytes) {
  const sec = Number(out?.transcription_info?.duration), neu = Number(out?.usage?.neurons);
  if (sec > 0) return Math.ceil(sec / 60 * WAI_NANO_PER_MIN);
  if (neu > 0) return Math.ceil(neu * WAI_NANO_PER_NEURON);
  return Math.ceil(Math.min(STT_MAX_SEC, bytes / 4000) / 60 * WAI_NANO_PER_MIN);
}
// A container's audio format name for OpenRouter's input_audio.format, from a MIME type or a file extension.
export function audioFormat(x) {
  const s = String(x || "").toLowerCase().split(";")[0].trim();
  if (/webm/.test(s)) return "webm";
  if (/ogg|opus/.test(s)) return "ogg";
  if (/wav/.test(s)) return "wav";
  if (/flac/.test(s)) return "flac";
  if (/mpeg|mp3/.test(s)) return "mp3";
  if (/m4a|aac|x-m4a/.test(s)) return "m4a";
  if (/mp4|quicktime|mov/.test(s)) return "mp4";
  return "webm";
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
// A JSON body {…, "input_audio": {"format", "data": <base64 of the bytes>}} as a stream: bytes in, base64 out, constant memory.
export function audioBody(prefix, suffix, size, open) {
  const enc = new TextEncoder(), length = prefix.length + 4 * Math.ceil(size / 3) + suffix.length;
  const make = () => {
    let src = null, carry = new Uint8Array(0), started = false;
    const b64 = (u) => { let o = ""; for (let i = 0; i + 2 < u.length; i += 3) { const n = (u[i] << 16) | (u[i + 1] << 8) | u[i + 2]; o += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63]; }
      const r = u.length % 3; if (r) { const n = (u[u.length - r] << 16) | (r === 2 ? u[u.length - 1] << 8 : 0); o += B64[n >> 18] + B64[(n >> 12) & 63] + (r === 2 ? B64[(n >> 6) & 63] : "=") + "="; } return o; };
    const rs = new ReadableStream({
      async pull(c) {
        if (!started) { started = true; src = (await open()).getReader(); c.enqueue(enc.encode(prefix)); return; }
        for (;;) {   // a pull must enqueue something (a read under 3 bytes yields no base64 yet)
          const { value, done } = await src.read();
          if (done) { if (carry.length) c.enqueue(enc.encode(b64(carry))); c.enqueue(enc.encode(suffix)); c.close(); return; }
          const all = new Uint8Array(carry.length + value.length); all.set(carry); all.set(value, carry.length);
          const cut = all.length - (all.length % 3); carry = all.slice(cut); if (cut) { c.enqueue(enc.encode(b64(all.subarray(0, cut)))); return; }
        }
      },
      cancel(x) { src?.cancel?.(x); },
    });
    if (typeof FixedLengthStream === "function") { const f = new FixedLengthStream(length); rs.pipeTo(f.writable).catch(() => {}); return { body: f.readable, length }; }
    return { body: rs, length };
  };
  return { make, length };
}

// Segments worth keeping: not a low-confidence guess (silence, noise tails), not a stray CJK filler in a transcript in another script.
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
export function keepSegs(segs) {
  const all = segs.map((x) => String(x.text || "")).join(" "), cjkShare = (all.match(new RegExp(CJK.source, "gu")) || []).length / Math.max(1, all.replace(/\s/g, "").length);
  return segs.filter((x) => {
    const t = String(x.text || "").trim(); if (!t) return false;
    if (Number.isFinite(Number(x.avg_logprob)) && Number(x.avg_logprob) < MIN_LOGPROB) return false;
    if (cjkShare < 0.5 && CJK.test(t) && t.replace(/[\s\p{P}]/gu, "").length <= 6) return false;
    if (/^[嗯啊呃哦唔]+[\s\p{P}]*$/u.test(t)) return false;   // a lone filler (Qwen on room tone: "嗯。")
    return true;
  });
}
// A long segment with no confidence value (AssemblyAI: one segment for the whole recording) → about one segment per 30 s, cut at
// sentence ends, each starting where its share of the characters puts it. The words are all kept; only the start times are estimates.
export const SPREAD_SEC = 30, SPREAD_MIN_SEC = 45;
export function spreadSegs(list) {
  return list.flatMap((x) => {
    const a = Number(x.start || 0), b = Number(x.end), t = String(x.text || "").trim();
    if (!(b - a > SPREAD_MIN_SEC) || Number.isFinite(Number(x.avg_logprob)) || !t) return [x];
    const per = t.length * SPREAD_SEC / (b - a), out = []; let cur = "", from = 0;
    for (const part of t.split(/(?<=[.!?。])\s+/)) {
      if (cur && cur.length + part.length > per * 1.5) { out.push({ start: a + (b - a) * from / t.length, text: cur }); from += cur.length + 1; cur = ""; }
      cur += (cur ? " " : "") + part;
      if (cur.length >= per) { out.push({ start: a + (b - a) * from / t.length, text: cur }); from += cur.length + 1; cur = ""; }
    }
    if (cur) out.push({ start: a + (b - a) * from / t.length, text: cur });
    return out;
  });
}
const segsOf = (list, text) => keepSegs(spreadSegs(Array.isArray(list) && list.length ? list : [{ start: 0, text: text || "" }]))
  .map((x) => ({ s: Math.max(0, Number(x.start || 0)), ...(Number.isFinite(Number(x.end)) && x.end != null ? { e: Number(x.end) } : {}), t: String(x.text || "").replace(/\s+/g, " ").trim() })).filter((x) => x.t);   // e: where the segment ends, when the model says (speaker labels match lines to turns by it)

// One recording (or one piece of one) → { segs: [{s: seconds from its start, t}], text, dur, nano (our cost, before the markup), model }.
// src: { size, open() → ReadableStream (or a promise of one) } and/or { bytes: Uint8Array } (needed for the Workers AI step).
// o: { format (audioFormat), meta (AI Gateway metadata), tryMs (per attempt; 0 = none), estSec (the audio's length, for what a
// timed-out attempt may still cost us), prompt (Workers AI only: the OpenRouter models ignore it, measured),
// models (try only these OpenRouter models, in this order, and never Workers AI: live dictation falls back to Deepgram instead),
// signal (abort every attempt), headers (extra AI Gateway headers) }.
// A model whose saved "formats" fact doesn't list the audio's format is skipped without a request (AssemblyAI takes WAV only).
// Throws when every step failed: err.nano = what timed-out attempts may cost, err.timeout = the last one timed out.
export async function stt(env, src, { format = "webm", meta = {}, tryMs = 0, estSec = 0, prompt = "", models = null, model = null, job = "stt", signal = null, headers = {}, fetchImpl = null } = {}) {
  const size = src.size ?? src.bytes?.byteLength ?? 0, open = src.open || (() => new Response(src.bytes).body);
  const errs = []; let lost = 0, timeout = false;
  let facts = {}; try { facts = await modelFacts(env); } catch {}
  const only = model || (models && models.length === 1 ? models[0] : null);   // run one entry of the job (a live dictation chunk)
  const rateOf = (m) => Number(facts[m]?.sec_nano) || STT_NANO_PER_SEC;
  // The plan lists the job's models in order, and dispatch runs one of them (model:), so the saved settings decide the model, the provider fields and
  // the transport, and this loop keeps the cost of an attempt that timed out. A model that can't take this audio is passed over without a request.
  const skip = (step) => {
    const f = facts[step.model];
    if (Array.isArray(f?.formats) && !f.formats.includes(format)) return `doesn't take ${format}`;
    if (step.source === "CF" && size > WAI_MAX_BYTES) return "The audio exceeds Cloudflare's supported size.";
    if (step.source === "SELF" && size > SPEECH_MAX_BYTES) return "The audio exceeds the speech container's supported size.";
    return null;
  };
  const request = { tryMs, headers,
    // A model of the 1Helm speech container takes the bytes in the call and converts any format itself. Its answer may carry word times (words), which stay with the result.
    self: async () => { const audio = src.bytes || await readCapped(new Response(await open()), SPEECH_MAX_BYTES); if (!audio) throw new Error("The audio exceeds the speech container's supported size."); return { audio, format }; },
    openrouter: ({ model: m, provider }) => audioBody(`{"model":${JSON.stringify(m)},"provider":${JSON.stringify(provider)},"response_format":"verbose_json","input_audio":{"format":${JSON.stringify(format)},"data":"`, `"}}`, size, open).make,
    cloudflare: async () => { const audio = src.bytes || await readCapped(new Response(await open()), WAI_MAX_BYTES); if (!audio) throw new Error("The audio exceeds Cloudflare's supported size.");
      return { audio: b64(audio), task: "transcribe", vad_filter: true, ...(prompt ? { initial_prompt: prompt.slice(-400) } : {}) }; } };
  const answer = async (jobId, one) => {
    const { env: e, steps } = await stepsOf(env, jobId, { level: await privacyOf(env, meta.tenant) });
    if (!steps.length) errs.push(`${jobId}: no model is allowed at this privacy level`);
    for (const step of steps) {
      if (one && step.model !== one) continue;
      const why = skip(step); if (why) { errs.push(`${step.model}: ${why}`); continue; }
      try { return { r: await dispatch(e, jobId, request, { meta, signal, model: step.model, ...(fetchImpl ? { fetch: fetchImpl } : {}) }), m: step.model }; }
      catch (err) {
        if (signal?.aborted) throw err;
        timeout = err?.name === "TimeoutError" || err?.name === "AbortError";
        if (timeout) lost += Math.ceil(estSec * rateOf(step.model));   // the provider may have done (and billed) the work
        errs.push(`${step.model}: ${timeout ? "timed out" : String(err?.message || err).slice(0, 160)}`);
      }
    }
    return {};
  };
  const done = async (res, m, jobId) => {
    const j = await cappedResponseJson(res, 8 << 20), rate = rateOf(m);
    if (isCloudflareModel(m)) {
      const segs = segsOf(j?.segments, j?.text), dur = Number(j?.transcription_info?.duration) || estSec;
      return { segs, text: segs.map(x => x.t).join(" "), dur, model: m, nano: lost + (jobId === "stt_cloudflare" ? waiCost(j, src.bytes?.byteLength || 0) : Math.ceil(dur * rate)) };
    }
    const dur = Number(j?.duration || j?.usage?.seconds) || 0, segs = segsOf(j?.segments, j?.text), words = Array.isArray(j?.words) && j.words.length ? { words: j.words } : {};
    return { segs, ...words, text: segs.map((x) => x.t).join(" "), dur, model: m, nano: lost + (Math.ceil(Number(j?.usage?.cost || 0) * 1e9) || Math.ceil((dur || estSec) * rate)) };
  };
  const first = await answer(job, only);
  if (first.r) return done(first.r, first.m, job);
  if (job !== "stt" || only || models || !env.AI || !src.bytes || src.bytes.byteLength > WAI_MAX_BYTES) throw Object.assign(new Error(`couldn't transcribe it (${errs.join("; ")})`), { nano: lost, timeout });
  // Every model of the job failed: the saved Workers AI job "stt_cloudflare" (a different provider, so dictation keeps working through an outage).
  console.log("stt: the speech models failed, using the Cloudflare speech job", errs.join("; ").slice(0, 300));
  const wai = await answer("stt_cloudflare", null);
  if (wai.r) return done(wai.r, wai.m, "stt_cloudflare");
  const to = timeout;
  throw Object.assign(new Error(`couldn't transcribe it (${errs.join("; ")})`), { nano: lost + (to ? waiCost({}, src.bytes.byteLength) : 0), timeout: to });
}

// L: this workspace's Ledger stub (reserve/settle). meta: AI Gateway metadata ({ tenant, kind }).
export async function transcribe(req, env, L, meta = {}) {
  if (req.method !== "POST") return json({ error: "POST the recording." }, 405);
  const type = String(req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!AUDIO.test(type)) return json({ error: "That isn't a recording we can read." }, 415);
  if (Number(req.headers.get("content-length")) > STT_MAX_BYTES) return json({ error: TOO_LONG }, 413);
  const said = Number(req.headers.get("x-audio-seconds"));
  if (said > STT_MAX_SEC + SLACK_SEC) return json({ error: TOO_LONG }, 413);
  const audio = await readCapped(req, STT_MAX_BYTES);
  if (!audio) return json({ error: TOO_LONG }, 413);
  if (audio.byteLength < 200) return json({ error: HEARD_NOTHING }, 400);

  const format = audioFormat(type), reserve = reserveFor(await sttRate(env, format));
  const rid = `stt:${crypto.randomUUID()}`, r = await L.reserve(rid, reserve);
  if (!r.ok) return r.reason === "day_limit" ? json({ error: "You've reached today's spending limit, so talking is paused until tomorrow.", reason: "day_limit" }, 429)
    : json({ error: "You're out of credits. Top up to keep talking to your helper.", reason: "out_of_credits" }, 402);
  let out;
  try { out = await stt(env, { bytes: audio }, { format, meta, estSec: said > 0 ? said : Math.min(STT_MAX_SEC, audio.byteLength / 4000) }); }
  catch (e) { await L.settle(rid, Math.min(reserve, Math.ceil((e?.nano || 0) * MARKUP))); console.log("transcribe failed", meta.tenant, String(e?.message || e).slice(0, 200)); return json({ error: HEARD_NOTHING }, 502); }
  const charge = Math.min(reserve, Math.ceil(out.nano * MARKUP));
  await L.settle(rid, charge);   // no transcript: dictation isn't a conversation, nothing goes into the ledger's history
  const text = out.text.replace(/\s+/g, " ").trim();
  if (!text) return json({ error: HEARD_NOTHING, charge_nano: charge }, 422);
  return json({ text, charge_nano: charge, seconds: out.dur || null });
}
