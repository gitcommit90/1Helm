// Speech to text, one model and one path (stt) for all three uses: dictation (POST /api/transcribe, below), Live notes chunks from
// the device's microphone (live-mic.js) and audio/video file sidecars (sidecar.js).
//
// The model: Qwen3-ASR 0.6B through OpenRouter, ZDR endpoints only (DeepInfra is its one ZDR host; privacy.js registry, below), so it
// is allowed at every AI data privacy level (Unrestricted / No Training / ZDR). STT_MODEL is the one place it's named; env.STT_MODEL overrides it.
// If it fails (an error, a timeout, a file over its ~50-minute limit), the same audio goes to Whisper large-v3-turbo through
// OpenRouter (ZDR on DeepInfra and Groq); only if OpenRouter itself fails does a recording ≤ 20 MB go to Workers AI's copy of
// Whisper (a different provider entirely, so dictation and Live notes keep working through an OpenRouter outage).
//
// Survey + bench (2026-10-08, /workspace/tmp-shots/stt: survey.json, results.json, bench.mjs). OpenRouter lists 26 transcription models;
// 20 have a ZDR endpoint. Our audio: the 36 s two-voice meeting as 7 pause-cut webm chunks (what Live notes sends) and as one file,
// the same with pink noise + babble, Spanish-accented English, UK/AU voices with noise, a Spanish meeting; 2.4 min and 30 min files.
// WER: chunks clean / chunks noisy / file noisy / accent+noise / Spanish; p50 per chunk; 30 min file: WER, wall time. $ per audio hour.
//   qwen/qwen3-asr-0.6b (DeepInfra, ZDR)            $0.012  3.5 / 4.7 / 4.7 / 9.3 / 0%    0.46 s   3.5%, 20 s    ← STT_MODEL
//   openai/whisper-large-v3-turbo (DeepInfra, ZDR)  $0.012  5.8 / 11.6 / 8.1 / 5.8 / 0%   1.0-1.4 s 1.4%, 37 s   ← fallback
//   nvidia/nemotron-3.5-asr-streaming 0.6b (ZDR)    $0.012  4.7 / 19.8 / 19.8 / 22.1 / 0% 1.2 s
//   qwen/qwen3-asr-1.7b (ZDR)                       $0.027  2.3 / 4.7 / 3.5 / 8.1 / 0%    0.54 s   3.1%, 19 s
//   openai/whisper-large-v3 (ZDR)                   $0.027+ 3.5 / 3.5 / 2.3 / 12.8 / 0%   0.6 s
//   mistralai/voxtral-mini-3b (ZDR)                 $0.06   webm refused; files 1.2 / 5.8 noisy, Spanish answered in English
//   elevenlabs/scribe-v2 (ZDR; billed $0.11/h)      $0.11   0 / 3.5 / 0 / 2.3 / 0%        0.52 s   but 16% on 30 min (dropped passages), no timestamps
//   mistralai/voxtral-small-24b-stt (ZDR)           $0.18   webm refused; Spanish answered in English
//   deepgram/nova-3 (ZDR)                           $0.26   2.3 / 11.6 / 3.5 / 9.3 / 100% (English only by default)  0.34 s
//   fish-audio/transcribe-1 / -1-pro (ZDR)          $0.36   webm refused / 16-46% (speaker markup)
//   google/chirp-3 (ZDR)                            $0.96   2.3 / 18.6 / 7.0 / 5.8 / 0%   1.1 s
//   assemblyai/universal-3.5-pro (ZDR)              $0.45   WAV only, ≤ 120 s; nvidia/parakeet-tdt (Together, ZDR) down (404)
//   microsoft/mai-transcribe-1.5 / -2 (ZDR): listed at $0.36 / $0.10 per audio SECOND ($360+/h), not run
//   No ZDR endpoint (not usable at the strictest level): openai/gpt-4o(-mini)-transcribe, gpt-transcribe, whisper-1,
//   google/gemini-3.5-transcribe, x-ai/grok-stt-1.0, meta/muse-voice-transcribe-1.0, qwen/qwen3-asr-flash, voxtral-mini-transcribe (EU ZDR 404'd).
// Heavy (Spanish) accent: every model ≤ $0.03/h fails (64-91% WER); scribe-v2 5.8%, chirp-3 18.6%.
// → Qwen3-ASR 0.6B: the lowest price on OpenRouter (tied with whisper turbo, 2.5× under Workers AI's $0.031/h), the best WER of the
// cheap tier on live chunks and in noise, the fastest chunks (0.4-0.7 s), timed segments, webm/m4a/mp4/mp3/wav, 30 languages.
// Its quirks, handled here: it ignores prompt and language (measured), and on pure silence it makes words up ("Ahora.", "Hoy es el
// día de la Navidad.") with a low avg_logprob (-0.86 to -1.06; real speech, even badly accented, ≥ -0.75), and an odd off-language
// tail in babble ("你唔係。"). So segments under MIN_LOGPROB are dropped (this also drops Whisper's noise tails, "Am I right?" -1.02),
// and so are short Han/Kana/Hangul segments in a transcript that isn't in those scripts. Files over ~50 min: it answers 400 → Whisper.
import { aiOpts, orFetchPath } from "./model.js";
import { cappedResponseJson } from "./bounded-response.js";
import { enforceRequest } from "./privacy.js";
import { STT_NANO_PER_SEC, MARKUP } from "./stt-pricing.js";
export { STT_NANO_PER_SEC, MARKUP } from "./stt-pricing.js";

export const STT_MODEL = "qwen/qwen3-asr-0.6b";                      // env.STT_MODEL overrides
export const STT_FALLBACK_MODEL = "openai/whisper-large-v3-turbo";   // OpenRouter, when STT_MODEL fails
export const STT_WAI_MODEL = "@cf/openai/whisper-large-v3-turbo";    // Workers AI, only when OpenRouter fails
// Privacy (privacy.js): both OpenRouter models are registered under ENDPOINTS.transcription with their ZDR hosts, and every request is
// checked by enforceRequest at "zdr", the strictest level, which every level allows (stricter is never a weaker route): the audio only
// ever reaches zero-data-retention endpoints, whatever the account chose. A model set by env.STT_MODEL that isn't registered gets
// OpenRouter's strictest filter (zdr, data_collection deny). Workers AI (the last fallback) is Cloudflare's own inference, not OpenRouter.
export const sttProvider = (model) => enforceRequest({ model, provider: { zdr: true } }, "zdr", { modality: "transcription" }).provider;
export const WAI_NANO_PER_MIN = 513000;           // Workers AI list: $0.000513 per audio minute
export const WAI_NANO_PER_NEURON = 11000;         // $0.011 per 1k neurons, if Whisper ever stops reporting the duration
export const WAI_MAX_BYTES = 20 * 1024 * 1024;    // Workers AI's input (base64 in JSON) stays under its request limit
export const MIN_LOGPROB = -0.8;
export const STT_MAX_BYTES = 25 * 1024 * 1024, STT_MAX_SEC = 300;
export const SLACK_SEC = 30;
export const STT_RESERVE = Math.ceil((STT_MAX_SEC + SLACK_SEC) * STT_NANO_PER_SEC * MARKUP);
export const DICTATE_TRY_MS = 30e3;               // one attempt at most this long (a 5-minute clip takes ~2 s)
const HEARD_NOTHING = "Couldn't hear that, try again.";
const TOO_LONG = "That recording is too long. Keep it under 5 minutes.";
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export const AUDIO = /^(audio\/[a-z0-9.+-]+|video\/(webm|mp4|quicktime)|application\/octet-stream)$/;
export const sttModels = (env) => [...new Set([String(env?.STT_MODEL || STT_MODEL).trim() || STT_MODEL, STT_FALLBACK_MODEL])];

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
const segsOf = (list, text) => keepSegs(Array.isArray(list) && list.length ? list : [{ start: 0, text: text || "" }])
  .map((x) => ({ s: Math.max(0, Number(x.start || 0)), t: String(x.text || "").replace(/\s+/g, " ").trim() })).filter((x) => x.t);

// One recording (or one piece of one) → { segs: [{s: seconds from its start, t}], text, dur, nano (our cost, before the markup), model }.
// src: { size, open() → ReadableStream (or a promise of one) } and/or { bytes: Uint8Array } (needed for the Workers AI step).
// o: { format (audioFormat), meta (AI Gateway metadata), tryMs (per attempt; 0 = none), estSec (the audio's length, for what a
// timed-out attempt may still cost us), prompt (Workers AI only: the OpenRouter models ignore it, measured) }.
// Throws when every step failed: err.nano = what timed-out attempts may cost, err.timeout = the last one timed out.
export async function stt(env, src, { format = "webm", meta = {}, tryMs = 0, estSec = 0, prompt = "" } = {}) {
  const size = src.size ?? src.bytes?.byteLength ?? 0, open = src.open || (() => new Response(src.bytes).body);
  const errs = []; let lost = 0, timeout = false;
  for (const model of sttModels(env)) {
    const prefix = `{"model":${JSON.stringify(model)},"provider":${JSON.stringify(sttProvider(model))},"response_format":"verbose_json","input_audio":{"format":${JSON.stringify(format)},"data":"`;
    try {
      const { make } = audioBody(prefix, `"}}`, size, open);
      const r = await orFetchPath(env, "audio/transcriptions", make, meta, {}, tryMs ? AbortSignal.timeout(tryMs) : null);
      const j = await cappedResponseJson(r, 8 << 20).catch(() => null);
      if (r.ok && j && !j.error) {
        const dur = Number(j.duration || j.usage?.seconds) || 0, segs = segsOf(j.segments, j.text);
        timeout = false;
        return { segs, text: segs.map((x) => x.t).join(" "), dur, model, nano: lost + (Math.ceil(Number(j.usage?.cost || 0) * 1e9) || Math.ceil((dur || estSec) * STT_NANO_PER_SEC)) };
      }
      errs.push(`${model} ${r.status}: ${JSON.stringify(j?.error || j || {}).slice(0, 160)}`); timeout = false;
    } catch (e) {
      timeout = e?.name === "TimeoutError" || e?.name === "AbortError";
      if (timeout) lost += Math.ceil(estSec * STT_NANO_PER_SEC);   // the provider may have done (and billed) the work
      errs.push(`${model}: ${timeout ? "timed out" : String(e?.message || e).slice(0, 160)}`);
    }
  }
  if (!env.AI || !src.bytes || src.bytes.byteLength > WAI_MAX_BYTES) throw Object.assign(new Error(`couldn't transcribe it (${errs.join("; ")})`), { nano: lost, timeout });
  console.log("stt: openrouter failed, using workers ai", errs.join("; ").slice(0, 300));
  let out;
  try {
    const run = env.AI.run(STT_WAI_MODEL, { audio: b64(src.bytes), task: "transcribe", vad_filter: true, ...(prompt ? { initial_prompt: prompt.slice(-400) } : {}) }, aiOpts(env, meta));
    let timer; out = await (tryMs ? Promise.race([run, new Promise((_, no) => { timer = setTimeout(() => no(Object.assign(new Error("timed out"), { name: "TimeoutError" })), tryMs); })]).finally(() => clearTimeout(timer)) : run);
  } catch (e) {
    const to = e?.name === "TimeoutError";
    throw Object.assign(new Error(`couldn't transcribe it (${errs.join("; ")}; workers ai: ${String(e?.message || e).slice(0, 160)})`), { nano: lost + (to ? waiCost({}, src.bytes.byteLength) : 0), timeout: to });
  }
  const segs = segsOf(out?.segments, out?.text);
  return { segs, text: segs.map((x) => x.t).join(" "), dur: Number(out?.transcription_info?.duration) || 0, model: STT_WAI_MODEL, nano: lost + waiCost(out, src.bytes.byteLength) };
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

  const rid = `stt:${crypto.randomUUID()}`, r = await L.reserve(rid, STT_RESERVE);
  if (!r.ok) return r.reason === "day_limit" ? json({ error: "You've reached today's spending limit, so talking is paused until tomorrow.", reason: "day_limit" }, 429)
    : json({ error: "You're out of credits. Top up to keep talking to your helper.", reason: "out_of_credits" }, 402);
  let out;
  try { out = await stt(env, { bytes: audio }, { format: audioFormat(type), meta, tryMs: DICTATE_TRY_MS, estSec: said > 0 ? said : Math.min(STT_MAX_SEC, audio.byteLength / 4000) }); }
  catch (e) { await L.settle(rid, Math.min(STT_RESERVE, Math.ceil((e?.nano || 0) * MARKUP))); console.log("transcribe failed", meta.tenant, String(e?.message || e).slice(0, 200)); return json({ error: HEARD_NOTHING }, 502); }
  const charge = Math.min(STT_RESERVE, Math.ceil(out.nano * MARKUP));
  await L.settle(rid, charge);   // no transcript: dictation isn't a conversation, nothing goes into the ledger's history
  const text = out.text.replace(/\s+/g, " ").trim();
  if (!text) return json({ error: HEARD_NOTHING, charge_nano: charge }, 422);
  return json({ text, charge_nano: charge, seconds: out.dur || null });
}
