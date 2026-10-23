// Pure helpers of speaker labels (no imports, so live-notes.js can load them anywhere). The saved job, R2 and the container are in speaker-labels.js.
export const SPEAKER_JOB = "speaker_labels";
export const SPEAKER_EVERY_MS = 3 * 60e3;       // how often a running meeting is labelled again
export const SPEAKER_MIN_MS = 20e3;              // no pass before this much new audio came in
export const SPEAKER_FAILS = 3;                  // chunks that failed to reach the container in a row before the session stops trying
export const SPEAKER_NEAR_MS = 1500;             // an utterance that no turn overlaps takes the nearest turn within this long
export const SPEAKER_MARKUP = 1.15, SPEAKER_SLACK_SEC = 60;
export const SPEAKER_UNKNOWN_SEC_NANO = 61100;   // used only when the saved model has no price fact: one container second ($0.0000611) per audio second

export const sessionKey = (tenant, channel, task, n) => `${tenant}:${channel}:${task}:s${n}`;
export const audioPrefix = (tenant, channel, task, n) => `t/${tenant}/live-audio/${channel}/${task}/s${n}/`;
export const audioKey = (tenant, channel, task, n, seq) => `${audioPrefix(tenant, channel, task, n)}${seq}.wav`;
export const taskAudioPrefix = (tenant, channel, task) => `t/${tenant}/live-audio/${channel}/${task}/`;

// "S3" -> "Speaker 3". A speaker's label is the name a person gave it, else this.
export const defaultLabel = (id) => { const m = /^S(\d+)$/.exec(String(id || "")); return m ? `Speaker ${m[1]}` : String(id || "");
};
// The label shown for an utterance: a named speaker, else "You" for a meeting tab chunk only the microphone heard, else "Speaker N", else what the source gave
// (a tab chunk only the call's sound had is "Others"), else nothing. names: { S1: { name, contact_id } }.
export function labelOf(u, names = {}) {
  const sid = u?.sid || null, nm = sid && names?.[sid]?.name ? String(names[sid].name).trim() : "";
  if (nm) return nm;
  if (u?.speaker === "You") return "You";
  if (sid) return defaultLabel(sid);
  return u?.speaker || null;
}
// Rows of utterances (as LiveNotes stores them: sid, speaker) with `speaker` set to the label shown and `speaker_id` to the id.
export const labelled = (rows, names = {}) => rows.map((u) => ({ ...u, speaker: labelOf(u, names), speaker_id: u.sid || null }));
// The speakers of a session for the view: every id with how many lines and how long it spoke. rows: [{ sid, tm }].
export function speakersOf(rows, names = {}) {
  const by = new Map();
  for (const u of rows) {
    if (!u.sid) continue;
    const x = by.get(u.sid) || { id: u.sid, lines: 0, ms: 0 }; x.lines++;
    const t = typeof u.tm === "string" ? parseTm(u.tm) : u.tm; if (t) x.ms += Math.max(0, t.e - t.s);
    by.set(u.sid, x);
  }
  const num = (id) => Number(String(id).replace(/\D/g, "")) || 0;
  return [...by.values()].sort((a, b) => num(a.id) - num(b.id)).map((x) => ({ id: x.id, label: defaultLabel(x.id), name: names?.[x.id]?.name || null, contact_id: names?.[x.id]?.contact_id || null, lines: x.lines, ms: x.ms }));
}
export function parseTm(v) { try { const t = typeof v === "string" ? JSON.parse(v) : v; return t && Number.isFinite(t.s) && Number.isFinite(t.e) ? t : null; } catch { return null; } }

// ---- turns ----
// Turns from the container, in milliseconds on the session's clock: { start_ms, end_ms, speaker } (a session) or { s, e, speaker } in seconds (a recording).
export function normalizeTurns(turns) {
  const out = [];
  for (const t of Array.isArray(turns) ? turns : []) {
    const s = Number.isFinite(Number(t?.start_ms)) ? Number(t.start_ms) : Number.isFinite(Number(t?.s)) ? Math.round(Number(t.s) * 1000) : NaN;
    const e = Number.isFinite(Number(t?.end_ms)) ? Number(t.end_ms) : Number.isFinite(Number(t?.e)) ? Math.round(Number(t.e) * 1000) : NaN;
    if (!Number.isFinite(s) || !Number.isFinite(e) || e < s || t?.speaker == null || t.speaker === "") continue;
    out.push({ s, e, speaker: String(t.speaker) });
  }
  return out.sort((a, b) => a.s - b.s || a.e - b.e);
}
// The container's own ids → S1, S2, ... in the order they are first met. turns: already normalizeTurns (ms). map: { rawId: "S1" } (saved with the session, so ids stay the same across passes).
// → { turns (with speaker S<k>), map }.
export function mapSpeakerIds(turns, map = {}) {
  const m = { ...map }; let next = Object.keys(m).length;
  const out = (turns || []).map((t) => { if (!m[t.speaker]) m[t.speaker] = `S${++next}`; return { ...t, speaker: m[t.speaker] }; });
  return { turns: out, map: m };
}
// The speaker of one span (an utterance, or a transcript line): the one whose turns overlap its units most. units: [[s, e]] (its words, else the span). null: none within SPEAKER_NEAR_MS.
export function speakerForSpan(units, turns) {
  const tot = new Map();
  for (const [a, b] of units) for (const t of turns) { const o = Math.min(b, t.e) - Math.max(a, t.s); if (o > 0) tot.set(t.speaker, (tot.get(t.speaker) || 0) + o); }
  if (tot.size) return [...tot.entries()].sort((x, y) => y[1] - x[1])[0][0];
  const lo = Math.min(...units.map((u) => u[0])), hi = Math.max(...units.map((u) => u[1])), mid = (lo + hi) / 2;
  let best = null, gap = SPEAKER_NEAR_MS + 1;
  for (const t of turns) { const g = mid < t.s ? t.s - mid : mid > t.e ? mid - t.e : 0; if (g < gap) { gap = g; best = t.speaker; } }
  return best;
}
// rows: [{ rid, tm }] with tm = { s, e, w?: [[s, e], ...] } in milliseconds on the session's clock. → [{ rid, sid }] for the rows that got a speaker.
export function assignSpeakers(rows, turns) {
  const out = [];
  for (const r of rows) {
    const t = typeof r.tm === "string" ? parseTm(r.tm) : r.tm; if (!t) continue;
    const units = Array.isArray(t.w) && t.w.length ? t.w : [[t.s, Math.max(t.e, t.s + 1)]];
    const sid = speakerForSpan(units, turns); if (sid) out.push({ rid: r.rid, sid });
  }
  return out;
}


export const speakerReserve = (seconds, rate) => Math.ceil((Math.max(0, seconds) + SPEAKER_SLACK_SEC) * rate * SPEAKER_MARKUP);
