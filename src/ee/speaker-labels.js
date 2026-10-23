// Speaker labels (who spoke when) for Live notes from the microphone and for audio and video files (the Captain, 2026-10-22).
//
// The model that labels speakers is the saved job "speaker_labels" (Models page, kind diarize). Its first-run model runs in 1Helm's own container
// (selfhost-models.js: selfDiarize for a whole recording, selfSessionAppend and selfSessionDiarize for a meeting that is still going), and the container
// reports the container time it used, which is what is charged (the usual reserve, then settle, with the 1.15 markup). Nothing here names a model.
//
// Live notes from the microphone (live-notes.js, live-mic.js):
//  - Each chunk the device sends is a 16 kHz mono WAV. After it is transcribed it is also written to R2 at t/<tenant>/live-audio/<channel>/<task>/s<n>/<seq>.wav
//    and appended to the container's speech session (key <tenant>:<channel>:<task>:s<n>), at its position in the meeting (at_ms, milliseconds from the start of
//    the session). The container rebuilds a session from these files after a restart, so they stay until the session's final pass.
//  - Every SPEAKER_EVERY_MS during the meeting, and once more at the end (the final pass), the whole session is labelled: the container answers turns
//    [{ start_ms, end_ms, speaker }] with the same speaker ids on every call, and each utterance gets the speaker whose turns overlap its words the most
//    (assignSpeakers). A later pass may change an earlier utterance's speaker, and the utterance is relabelled.
//  - Retention: the chunk audio is deleted right after the session's final pass (and with the meeting notes when they are deleted), and the container's session
//    is ended. Nothing keeps the audio longer.
//  - Speaker ids are S1, S2, ... in the order the speakers were first heard in the session. A person names a speaker per session ({ name, contact_id }), and the
//    name shows everywhere the label did (the view, the transcript file, the note-taker's lines, the final pass, the memory text).
//
// Files (sidecar.js): the whole file goes to the same job once (selfDiarize), and each transcript line gets the speaker of the turn it overlaps.
import { stepsOf, dispatchMedia } from "./media-job.js";
import { factsOf } from "./model-jobs.js";
import { stPut, stDeleteListed } from "../storage.js";
import { speechFn } from "../speech-impl.js";   // selfSessionAppend and selfSessionEnd (the container session), looked up there so a build without them fails soft

export * from "./speaker-labels-core.js";
import { SPEAKER_JOB, SPEAKER_UNKNOWN_SEC_NANO, SPEAKER_MARKUP, SPEAKER_SLACK_SEC, normalizeTurns, audioKey, audioPrefix, sessionKey } from "./speaker-labels-core.js";
// ---- the saved job ----
// Nano dollars of container time per audio second: the saved facts of the first model of the job (a reservation only; the charge is the container's own usage).
export async function speakerRate(env) {
  try { const { env: e, steps } = await stepsOf(env, SPEAKER_JOB, { level: "unrestricted" }); return Math.max(...steps.map((s) => Number(factsOf(e.MODEL_SETTINGS, s.model)?.sec_nano) || SPEAKER_UNKNOWN_SEC_NANO), 0) || SPEAKER_UNKNOWN_SEC_NANO; }
  catch { return SPEAKER_UNKNOWN_SEC_NANO; }
}
// Is a model of the job allowed to run (any privacy level: it is 1Helm's own container)? false → no labels, nothing sent.
export async function speakerJobReady(env) {
  try { return (await stepsOf(env, SPEAKER_JOB, { level: "unrestricted" })).steps.length > 0; } catch { return false; }
}
// One call of the job. request: { audio, format, num_speakers? } or { session }. → { model, turns (ms), nano (charge before the markup), seconds }. Throws when the job failed.
export async function diarize(env, request, { meta = {}, signal = null } = {}) {
  const j = await speakerLabels(env, request, { meta: { ...meta, kind: meta.kind || "speaker-labels" }, signal });
  const rate = await speakerRate(env), sec = Number(j?.usage?.audio_s ?? j?.usage?.seconds ?? j?.usage?.audio_seconds) || 0;
  const cost = Math.ceil(Number(j?.usage?.cost || 0) * 1e9);
  return { model: j?.model || null, turns: normalizeTurns(j?.turns), nano: cost || Math.ceil(sec * rate), seconds: sec };
}

// ---- the chunk audio in R2 ----
export async function putChunkAudio(env, key, bytes, atMs = null) {
  await stPut(env, key, bytes, { httpMetadata: { contentType: "audio/wav" }, ...(Number.isFinite(atMs) ? { customMetadata: { at_ms: String(Math.max(0, Math.round(atMs))) } } : {}) }, { replace: true });
}
// Every object under a prefix: the chunk audio of one session (audioPrefix) or of a whole task (taskAudioPrefix). → how many were deleted.
export async function deleteAudio(env, prefix) {
  let n = 0, cursor;
  for (let i = 0; i < 200; i++) {
    const l = await env.WS.list({ prefix, cursor, limit: 1000 });
    const objs = l.objects || []; if (objs.length) n += await stDeleteListed(env, objs);
    if (!l.truncated) break; cursor = l.cursor;
  }
  return n;
}

// ---- the container's session ----
const need = speechFn;
// One chunk: the WAV goes to R2 first with its place in the meeting (the container rebuilds a session from these files, and its diarize call uploads any chunk it does not
// hold), then it is appended to the container's session. R2 is the source of truth, so an append that fails (the container is still starting, or restarted) is only logged; a
// failed R2 write throws, and the caller counts it.
export async function appendChunk(env, { tenant, channel, task, n, seq, atMs, audio }) {
  const key = audioKey(tenant, channel, task, n, seq);
  await putChunkAudio(env, key, audio, atMs);
  try { await need("selfSessionAppend")(env, sessionKey(tenant, channel, task, n), { seq, at_ms: Math.max(0, Math.round(atMs)), audio, format: "wav" }); }
  catch (e) { console.log("speech session append", String(e?.message || e).slice(0, 120), e?.warming ? "(warming)" : ""); }
  return key;
}
// The session is over: its container state and every chunk of audio go. Never throws (a failure of one part does not keep the other); → { deleted, error? }.
export async function endSession(env, { tenant, channel, task, n }) {
  const out = { deleted: 0 };
  try { out.deleted = await deleteAudio(env, audioPrefix(tenant, channel, task, n)); } catch (e) { out.error = String(e?.message || e).slice(0, 160); }
  try { await need("selfSessionEnd")(env, sessionKey(tenant, channel, task, n)); } catch (e) { out.end_error = String(e?.message || e).slice(0, 160); }
  return out;
}

// The one call site of the job in Lane 1's build (kept so its tests and sample find it): dispatches "speaker_labels" and returns { model, turns, usage }.
export async function speakerLabels(env, request, { meta = {}, signal = null } = {}) {
  const r = await dispatchMedia(env, "speaker_labels", request, { meta: { kind: "speaker-labels", ...meta }, signal });
  return r.json();
}
