// Live notes from the device's microphone (live-notes.js is the pipeline; this is only a different input).
// The Captain (2026-10-08): "If the user has Bee → use Bee; if the user doesn't → use the device mic. Just a different input capture."
//  - Source (pickSource): Bee when it's connected, unless the person picked "Use this device's mic instead"; no Bee → the mic of the
//    device that started Live notes (its random mic id is the session's; chunks from any other id are refused).
//  - A meeting tab (2026-10-08): the same path; the device shares the tab's sound (desktop Chrome/Edge) mixed with the person's mic,
//    says so at start (via "tab" / "system"), and tags a chunk who=you (only the mic heard speech) or who=others (only the tab did).
//  - The device (design-sandbox src/livemic.ts) records short chunks, each a whole file, cut at a pause in speech (3-10 s), skips the
//    silent ones, and POSTs each to …/livenotes/audio?mic=&seq=&at=&ms=&voiced= in order, retrying until the server answers.
//  - Here (lnAudio): is this chunk wanted (LiveNotes.micCheck: the live session's mic, a seq not seen yet) → reserve the worst case
//    from the Ledger (refused → the session stops; never a negative balance) → transcribe.js stt (the same models and path as
//    dictation and file sidecars: the saved "stt" order, AssemblyAI Universal-3.6 Pro first for WAV chunks, then Qwen3-ASR 0.6B and
//    Whisper turbo through OpenRouter, ZDR; the app sends 16 kHz mono 16-bit WAV chunks (design-sandbox src/pcm.ts + livemic.ts, 32 KB a second, a 10 s chunk is 320 KB; a browser
//    with no AudioWorklet still sends webm or mp4, which AssemblyAI doesn't take, so those go to Qwen3-ASR); a WAV chunk is held and billed at AssemblyAI's price) → settle at the provider's real
//    cost × 1.15 → the segments, timed, into the SAME utterance table as Bee's lines (LiveNotes.micPush).
//    From there it's the one shared path: note-taker, caps, Stop, final pass, Library, Meetings.
//  - Deploy-safe: micCheck/micPush/micState are idempotent (keyed by seq), so the Worker's tolerant stubs retry them across a DO reset;
//    anything else (a 5xx, a timeout, no network) the device retries, and a seq the DO already has is answered "dup" without a second
//    transcription.
//  - Benchmarks (2026-10-08, the 36 s two-voice meeting as 7 pause-cut webm chunks, clean / with noise + babble; full table in
//    transcribe.js): qwen3-asr-0.6b WER 3.5% / 4.7%, p50 0.46 s per chunk, $0.012 per audio hour; OpenRouter whisper-large-v3-turbo
//    5.8% / 11.6%, 1.0-1.4 s, $0.012/h; Workers AI whisper-large-v3-turbo (what this used before) 2.4% clean, p50 1.9 s, $0.031/h.
//    The note-taker's cadence (first pass ~12 s, then every 40-60 s: live-notes.js noteDueAt) dominates the latency either way.
import { AUDIO, readCapped, stt, audioFormat, sttRate } from "../transcribe.js";
import { STT_NANO_PER_SEC, MARKUP } from "../stt-pricing.js";
import { appendChunk } from "./speaker-labels.js";

export const MIC_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
export const MIC_MAX_CHUNK_MS = 30e3, MIC_MAX_BYTES = 3 * 1024 * 1024, STT_TRY_MS = 8e3;   // one attempt ≤ 8 s (a chunk takes ~0.5 s): all three steps together stay under ~25 s
export const micReserveFor = (nanoPerSec) => Math.ceil((MIC_MAX_CHUNK_MS / 1000 + 30) * nanoPerSec * MARKUP);   // a full 30 s chunk + slack, at the dearest endpoint
export const MIC_RESERVE = micReserveFor(STT_NANO_PER_SEC);   // for audio that only the cheaper models take (webm, m4a: dearest is Groq turbo)
// Stock answers to near-silence (Whisper's; Qwen's "Ahora." and "嗯"); dropped only when the device heard (almost) no voice in that chunk.
const HALLU = /^(thank you\.?|thanks for watching!?|thank you for watching\.?|you|\.+|bye\.?|so\.?|okay\.?|ahora\.?|嗯[。.]?|\[(music|silence|blank_audio)\])$/i;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// Which input a new session uses. want: what the device asked for ("mic" | "bee"; an app from before mic support sends nothing and
// means Bee). bee: bee_accounts.status. → { source } | { error }.
export function pickSource({ bee = null, want = null } = {}) {
  if (want === "mic") return { source: "mic" };
  if (bee === "connected") return { source: "bee" };
  return { error: bee === "needs_reconnect" ? "Reconnect your Bee in Settings → Ambient first, or use this device's microphone." : "Connect your Bee in Settings → Ambient first, or use this device's microphone." };
}

// One chunk through transcribe.js stt. → { segs: [{off, text}], nano, ms } | throws (err.nano: what a timed-out attempt may cost).
export async function micTranscribe(env, audio, { type = "audio/webm", ms = 0, prompt = "", meta = {} } = {}) {
  const t0 = Date.now();
  const out = await stt(env, { bytes: audio }, { format: audioFormat(type), meta, tryMs: STT_TRY_MS, estSec: Math.min(ms, MIC_MAX_CHUNK_MS) / 1000 || audio.byteLength / 4000, prompt });
  // end and words (when the model gives them, in milliseconds from the start of the chunk) let speaker labels be matched to each line (speaker-labels.js).
  return { segs: out.segs.map((x) => ({ off: Math.round(x.s * 1000), text: x.t, ...(Number.isFinite(x.e) && x.e != null ? { end: Math.round(x.e * 1000) } : {}) })),
    words: (out.words || []).map((w) => ({ w: w.w, s: Math.round(w.s * 1000), e: Math.round(w.e * 1000) })), nano: out.nano, model: out.model, ms: Date.now() - t0 };
}

// POST …/livenotes/audio. o: { LN (the task's LiveNotes stub), L (the Ledger stub), meta, q (URLSearchParams) }.
export async function lnAudio(req, env, { LN, L, meta = {}, q }) {
  if (req.method !== "POST") return json({ error: "POST the recording." }, 405);
  const mic = String(q.get("mic") || ""), seq = Number(q.get("seq")), at = Number(q.get("at")), ms = Number(q.get("ms")), voiced = Number(q.get("voiced") || 0);
  const who = q.get("who") === "you" || q.get("who") === "others" ? q.get("who") : "";   // a meeting tab's chunk: who spoke (the device's two level meters)
  if (!MIC_ID_RE.test(mic) || !Number.isInteger(seq) || seq < 0 || seq > 1e7 || !(at > 0) || !(ms >= 0 && ms <= MIC_MAX_CHUNK_MS + 5e3)) return json({ error: "Bad chunk." }, 400);
  const type = String(req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!AUDIO.test(type)) return json({ error: "That isn't a recording we can read." }, 415);
  if (Number(req.headers.get("content-length")) > MIC_MAX_BYTES) return json({ error: "That chunk is too big." }, 413);
  const c = await LN.micCheck(mic, seq);
  if (c?.dup) return json({ ok: true, dup: true, status: c.status });
  if (!c?.go) return json({ error: c?.why || "Live notes aren't on.", stopped: true, status: c?.status || "idle" }, 409);
  const audio = await readCapped(req, MIC_MAX_BYTES);
  if (!audio) return json({ error: "That chunk is too big." }, 413);
  const chunk = { at, ms, voiced, bytes: audio.byteLength, segs: [], nano: 0, stt_ms: 0, ...(who ? { who } : {}) };
  if (audio.byteLength >= 200) {
    const rid = `ln-stt:${crypto.randomUUID()}`; let held = null;
    const reserve = micReserveFor(await sttRate(env, audioFormat(type)).catch(() => STT_NANO_PER_SEC));   // WAV chunks can go to AssemblyAI (dearer)
    try { held = await L.reserve(rid, reserve); } catch { held = { ok: false }; }
    if (!held?.ok) { const why = held?.reason === "day_limit" ? "day" : "credits"; await LN.stop(why).catch(() => {}); return json({ error: why === "day" ? "Today's spending limit was reached, so Live notes stopped." : "You're out of credits, so Live notes stopped.", stopped: true, reason: why }, 402); }
    let r;
    try { r = await micTranscribe(env, audio, { type, ms, prompt: c.prompt || "", meta }); }
    catch (e) {
      // A timed-out attempt may still be billed to us: charge what it may cost (the device retries this chunk). Any other failure: nothing.
      await L.settle(rid, Math.min(reserve, Math.ceil((e?.nano || 0) * MARKUP))).catch(() => {});
      console.log("live notes stt failed", meta.tenant, String(e?.message || e).slice(0, 160));
      return json({ error: "Couldn't transcribe that chunk; send it again.", retry: true }, 503);
    }
    chunk.nano = Math.min(reserve, Math.ceil(r.nano * MARKUP)); chunk.stt_ms = r.ms;
    await L.settle(rid, chunk.nano).catch(() => {});
    chunk.segs = voiced < 600 && r.segs.length && HALLU.test(r.segs.map((s) => s.text).join(" ").trim()) ? [] : r.segs;
    if (r.words?.length && chunk.segs.length) chunk.words = r.words;
  }
  // Speaker labels (speaker-labels.js): a WAV chunk with speech is also written to R2 and appended to the container's speech session. It never fails the chunk.
  if (c.labels && audioFormat(type) === "wav" && audio.byteLength >= 200 && chunk.segs.length) {
    try { await appendChunk(env, { tenant: meta.tenant, channel: c.channel, task: c.task, n: c.n, seq, atMs: at - c.started_at, audio }); chunk.audio = true; }
    catch (e) { chunk.audio = false; console.log("live notes speech session", meta.tenant, String(e?.message || e).slice(0, 160)); }
  }
  const p = await LN.micPush(mic, seq, chunk);
  if (!p?.ok) return json({ error: p?.why || "Live notes aren't on.", stopped: true, status: p?.status || "idle" }, 409);
  return json({ ok: true, added: p.added || 0, status: p.status, charge_nano: chunk.nano, stt_ms: chunk.stt_ms });
}
