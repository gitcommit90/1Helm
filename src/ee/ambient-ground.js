// Tolerant evidence location for noisy ASR transcripts.
//
// A model's quote is only a POINTER to where a thought came from. ASR text is
// unreliable (case, punctuation, typos, filler words, a thought split across two
// lines), and models routinely normalize it. This module finds the real source
// span with a token-level approximate alignment and returns offsets, so callers
// copy the evidence from the transcript themselves. It never decides whether an
// item is kept: an item that cannot be located is kept as "unlocated".
//
// Thresholds (similarity = 1 - alignment cost / quote tokens):
//   >= LOCATED_MIN (0.90): same words after normalizing case, punctuation, quote
//     styles and spacing, allowing filler words and about one small typo per ten
//     words. State "located".
//   >= APPROXIMATE_MIN (0.70), at least 3 quote tokens: most words in order,
//     e.g. a model that joined or lightly reworded the speech. A 10 word quote
//     may miss 3 words. State "approximate", reviewed by a person or the agent.
//   below that, or a 1 or 2 word quote that is not an exact normalized match:
//     "unlocated". Short quotes get no fuzziness because a single changed word
//     is a different statement.
export const LOCATED_MIN = 0.9, APPROXIMATE_MIN = 0.7, MIN_FUZZY_TOKENS = 3;
const TIE_EPSILON = 0.05; // candidates this close in similarity are "equally good"
const MAX_QUOTE_TOKENS = 120;
const TOKEN = /[\p{L}\p{N}]+(?:['’‘`][\p{L}\p{N}]+)*/gu;
// Cheap to skip when the model dropped them or ASR inserted them.
const FILLERS = new Set(["um", "umm", "uh", "uhh", "er", "erm", "ah", "hmm", "hm", "mm", "mhm", "like", "so", "well", "yeah", "yep", "okay", "ok", "oh", "basically", "literally"]);

// Small words models often drop or add when they tidy speech.
const FUNCTION_WORDS = new Set(["the", "a", "an", "to", "of", "and", "i", "that", "my", "we", "it", "is", "in", "on", "for", "at", "be", "just", "about", "with", "from", "by", "up", "out", "me", "you", "do", "so"]);
const gap = (tok) => FILLERS.has(tok) ? 0.1 : FUNCTION_WORDS.has(tok) ? 0.3 : 1;
export const foldToken = (s) => s.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/['’‘`]/g, "");
export function tokenize(text) {
  const out = [];
  for (const m of String(text || "").matchAll(TOKEN)) out.push({ t: foldToken(m[0]), s: m.index, e: m.index + m[0].length });
  return out;
}
// Case, punctuation, quote style and spacing insensitive form for comparisons.
export const foldText = (s) => tokenize(s).map((x) => x.t).join(" ");

const levCache = new Map();
export function lev(a, b) {
  const key = a < b ? `${a}|${b}` : `${b}|${a}`; if (levCache.has(key)) return levCache.get(key);
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  if (levCache.size > 20000) levCache.clear();
  levCache.set(key, prev[b.length]); return prev[b.length];
}
// 0 for the same word; a fraction for a likely typo or ASR mishearing; 1 otherwise.
export function tokenCost(a, b) {
  if (a === b) return 0;
  const longest = Math.max(a.length, b.length);
  if (Math.min(a.length, b.length) < 3 || Math.abs(a.length - b.length) > 0.34 * longest) return 1;
  const d = lev(a, b) / longest; return d <= 0.34 ? d : 1;
}
const sameSpeaker = (a, b) => (a.speaker_id && b.speaker_id ? a.speaker_id === b.speaker_id : true) && (a.speaker ?? null) === (b.speaker ?? null) && !!a.is_user === !!b.is_user;

// Best alignments of the quote tokens inside one run of text tokens.
function align(q, t, runId, out) {
  const m = q.length, n = t.length; if (!n) return;
  let D = new Float32Array(n + 1), S = new Int32Array(n + 1);
  for (let j = 0; j <= n; j++) { D[j] = 0; S[j] = j; }
  for (let i = 1; i <= m; i++) {
    const ND = new Float32Array(n + 1), NS = new Int32Array(n + 1);
    ND[0] = D[0] + 1; NS[0] = S[0];
    for (let j = 1; j <= n; j++) {
      let best = D[j - 1] + tokenCost(q[i - 1], t[j - 1].t), start = S[j - 1];
      const del = D[j] + gap(q[i - 1]); if (del < best) { best = del; start = S[j]; }
      const skip = ND[j - 1] + gap(t[j - 1].t); if (skip < best) { best = skip; start = NS[j - 1]; }
      ND[j] = best; NS[j] = start;
    }
    D = ND; S = NS;
  }
  for (let j = 1; j <= n; j++) if (j > S[j]) out.push({ cost: D[j], run: runId, from: S[j], to: j });
}

// lines: [{text, speaker, is_user, speaker_id, offset}] (ambientLines output).
// hint: the model's line index (advisory only). Returns an object describing
// the best span and how sure we are; never throws and never drops anything.
export function locateEvidence(quote, lines, hint = -1) {
  const q = tokenize(quote).slice(0, MAX_QUOTE_TOKENS).map((x) => x.t), m = q.length;
  const none = { state: "unlocated", confidence: 0, similarity: 0, method: null, spans: [], ambiguity: null };
  if (!m || !Array.isArray(lines) || !lines.length) return none;
  // Adjacent lines by the same speaker form one run, so a thought that ASR split
  // across two lines can be matched, but speech never joins across speakers.
  const runs = []; let current = null;
  lines.forEach((line, index) => {
    const toks = tokenize(line?.text).map((x) => ({ ...x, line: index }));
    if (current && sameSpeaker(lines[current.last], line || {})) { current.tokens.push(...toks); current.last = index; }
    else { current = { tokens: toks, last: index }; runs.push(current); }
  });
  const found = [];
  runs.forEach((run, id) => align(q, run.tokens, id, found));
  if (!found.length) return none;
  found.sort((a, b) => a.cost - b.cost || a.run - b.run || a.from - b.from);
  const accepted = [];
  for (const c of found) if (!accepted.some((a) => a.run === c.run && c.from < a.to && a.from < c.to)) accepted.push(c);
  const best = accepted[0], similarity = Math.max(0, 1 - best.cost / m);
  const minimum = m >= MIN_FUZZY_TOKENS ? APPROXIMATE_MIN : 1;
  if (similarity + 1e-9 < minimum) return { ...none, similarity: round(similarity), confidence: round(Math.min(0.3, similarity)) };
  const tolerance = TIE_EPSILON * m, tied = accepted.filter((c) => c.cost <= best.cost + tolerance + 1e-9 && 1 - c.cost / m + 1e-9 >= minimum);
  const spanLines = (c) => [...new Set(runs[c.run].tokens.slice(c.from, c.to).map((x) => x.line))];
  let chosen = best, ambiguity = null;
  if (tied.length > 1) {
    const valid = Number.isInteger(hint) && hint >= 0 && hint < lines.length;
    const rank = (c) => { const ls = spanLines(c); return [valid ? (ls.includes(hint) ? 0 : 1) : 0, valid ? Math.min(...ls.map((l) => Math.abs(l - hint))) : 0, ls[0], c.cost]; };
    tied.sort((a, b) => { const x = rank(a), y = rank(b); for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; });
    chosen = tied[0];
    const ls = spanLines(chosen);
    ambiguity = { candidates: tied.length, resolved_by: valid && ls.includes(hint) ? "line_hint" : valid ? "nearest_line" : "earliest" };
  }
  const tokens = runs[chosen.run].tokens.slice(chosen.from, chosen.to), spans = [];
  for (const tok of tokens) {
    const last = spans.at(-1);
    if (last && last.index === tok.line) last.end = tok.e; else spans.push({ index: tok.line, start: tok.s, end: tok.e });
  }
  const sim = Math.max(0, 1 - chosen.cost / m);
  // Matching only small words in the same order is not a match. The quote's
  // content words must mostly appear (allowing typos) somewhere in the span.
  const content = q.filter((w) => !FUNCTION_WORDS.has(w) && !FILLERS.has(w));
  const covered = content.length ? content.filter((w) => tokens.some((x) => tokenCost(w, x.t) < 1)).length / content.length : 1;
  if (covered < 0.6) return { ...none, similarity: round(sim), confidence: round(Math.min(0.3, sim)) };
  const sourceExact = tokens.length === m && tokens.every((x, i) => x.t === q[i]);
  const rawExact = spans.length === 1 && String(lines[spans[0].index]?.text || "").includes(String(quote).trim());
  let state = sim + 1e-9 >= LOCATED_MIN && covered >= 0.8 ? "located" : "approximate", confidence = round(sim);
  // Equally good repeats that the model's line hint did not settle are a guess about which one was meant.
  if (ambiguity && ambiguity.resolved_by !== "line_hint") { state = "approximate"; confidence = round(Math.min(confidence, 0.6)); }
  return { state, confidence, similarity: round(sim), method: rawExact ? "exact" : sourceExact ? "normalized" : "fuzzy", spans, ambiguity };
}
const round = (x) => Math.round(x * 100) / 100;

// Find a phrase (a due date wording, a cue phrase) in text tolerant of case,
// punctuation and spacing; with fuzzy, one small typo per long word.
// Returns {start,end,fuzzy} in original text offsets, or null.
export function findPhrase(text, phrase, { fuzzy = false } = {}) {
  const q = tokenize(phrase).map((x) => x.t), t = tokenize(text); if (!q.length) return null;
  for (let i = 0; i + q.length <= t.length; i++) {
    let exact = true, ok = true;
    for (let k = 0; k < q.length && ok; k++) {
      const a = q[k], b = t[i + k].t;
      if (a === b) continue; exact = false;
      ok = fuzzy && Math.min(a.length, b.length) >= 4 && Math.max(a.length, b.length) >= 5 && lev(a, b) <= 1;
    }
    const start = t[i].s, end = t[i + q.length - 1].e;
    if (ok && text[start - 1] !== "_" && text[end] !== "_") return { start, end, fuzzy: !exact };
  }
  return null;
}
