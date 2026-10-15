// Pure helpers for ambient search: tolerant words, passage windows, vectors and rank fusion.
// Nothing here touches storage or a provider. Speech recognition (ASR) text is noisy, so a query
// matches by stems, small typos and split or joined words, ranks by any matching word instead of
// requiring all of them, and is fused with meaning based (vector) matches.
import { tokenize, foldToken, lev } from "./ambient-ground.js";

const STOP = new Set("a an and are as at be but by for from had has have he her his i if in is it its me my of on or our she so that the their them they this to was we were what when where which who will with you your do did does not no yes um uh er ah like just about into then than too very can could would should".split(" "));
export const stem = (w) => w.length > 4 ? w.replace(/(?:ing|ed|es|s)$/, "") : w;
// " a b c " form of text: every word is findable as " word " and phrases as " a b ".
export const normText = (s) => ` ${tokenize(s).map((x) => x.t).join(" ")} `;
export function queryTerms(query) {
  const all = [...new Set(tokenize(String(query || "").slice(0, 500)).map((x) => x.t))];
  const kept = all.filter((t) => !STOP.has(t) && (t.length > 1 || /\d/.test(t)));
  return (kept.length ? kept : all).slice(0, 12);
}
// For each query term, the strings that count as a match (a word, or a two word phrase) with a weight.
// Exact word 1, same stem 0.9, one typo 0.8, split word ("landlord" as "land lord") or joined words 0.8.
export function termVariants(query, vocab) {
  const terms = queryTerms(query), all = tokenize(String(query || "").slice(0, 500)).map((x) => x.t), groups = [];
  const words = vocab ? [...vocab] : [];
  for (const t of terms) {
    const v = new Map([[t, 1]]), st = stem(t);
    for (const w of words) {
      if (v.has(w) || Math.abs(w.length - t.length) > 2) continue;
      if (stem(w) === st && st.length >= 3) v.set(w, 0.9);
      else if ((t.length >= 5 || t.length === 4 && t[0] === w[0]) && w.length >= 4 && lev(t, w) <= (t.length >= 12 ? 3 : t.length >= 8 ? 2 : 1)) v.set(w, 0.8);
    }
    if (t.length >= 6) for (let i = 3; i <= t.length - 3; i++) { const p = `${t.slice(0, i)} ${t.slice(i)}`; v.set(p, 0.8); }
    groups.push({ term: t, variants: v });
  }
  // Two adjacent query words may be one word in the transcript ("land lord" is "landlord").
  for (let i = 0; i + 1 < all.length; i++) {
    const j = all[i] + all[i + 1]; if (j.length < 5 || STOP.has(all[i]) || STOP.has(all[i + 1])) continue;
    const g = groups.find((x) => x.term === all[i]) || groups.find((x) => x.term === all[i + 1]); if (g) g.variants.set(j, 0.8);
  }
  return groups;
}
// The best matching weight of a group in a normalized text, or 0.
export function groupHit(group, ntext) {
  let best = 0;
  for (const [v, w] of group.variants) if (w > best && ntext.includes(` ${v} `)) best = w;
  return best;
}
// BM25 style: each group counts once, weighted by how rare it is. df is the number of texts that hit the group.
export function lexicalScore(groups, ntext, idf, length, avg) {
  let s = 0, matched = [];
  groups.forEach((g, i) => { const h = groupHit(g, ntext); if (h) { s += h * idf[i] * 1.5 / (1 + 0.5 * (length / (avg || 1))); matched.push(g.term); } });
  return { score: s, matched };
}
export const idfOf = (n, df) => Math.log(1 + (n - df + 0.5) / (df + 0.5));

// Passages: windows of adjacent lines by the same speaker, about `target` characters, overlapping by one line.
export function passageWindows(lines, { target = 400, max = 1200, gapMs = 180000 } = {}) {
  const out = [], same = (a, b) => (a.speaker ?? null) === (b.speaker ?? null) && !!a.is_user === !!b.is_user && (!a.speaker_id || !b.speaker_id || a.speaker_id === b.speaker_id) && (a.at == null || b.at == null || Math.abs(b.at - a.at) <= gapMs);
  let run = [];
  const flush = () => {
    let i = 0;
    while (i < run.length) {
      let j = i, size = 0;
      while (j < run.length && (j === i || size + run[j].text.length < max) && (size < target || j === i)) { size += run[j].text.length + 1; j++; }
      const part = run.slice(i, j);
      out.push({ line_from: part[0].index, line_to: part.at(-1).index, at: part[0].at ?? null, until: part.at(-1).at ?? null, speaker: part[0].speaker ?? null, is_user: !!part[0].is_user, utterance_ids: [...new Set(part.map((l) => l.utterance_id).filter((x) => x != null))], text: part.map((l) => l.text).join(" ").slice(0, max) });
      if (j >= run.length) break;
      i = j > i + 1 ? j - 1 : j;
    }
    run = [];
  };
  lines.forEach((l, index) => { if (typeof l?.text !== "string" || !l.text.trim()) return; const x = { ...l, index }; if (run.length && !same(run.at(-1), x)) flush(); run.push(x); });
  flush();
  return out;
}

// int8 vectors with one scale each: 1 KB for a 1024 dimension vector.
export function quantize(vec) {
  let n = 0; for (const x of vec) n += x * x; n = Math.sqrt(n) || 1;
  let max = 0; for (const x of vec) max = Math.max(max, Math.abs(x / n));
  const scale = max / 127 || 1, q = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i++) q[i] = Math.round(vec[i] / n / scale);
  return { q, scale };
}
export function unitVector(vec) { let n = 0; for (const x of vec) n += x * x; n = Math.sqrt(n) || 1; return Float32Array.from(vec, (x) => x / n); }
export function cosineQ(query, buf, scale) {
  const q = new Int8Array(buf.buffer ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf);
  if (q.length !== query.length) return 0;
  let s = 0; for (let i = 0; i < q.length; i++) s += query[i] * q[i];
  return s * scale;
}
// Reciprocal rank fusion: each list contributes 1/(k+rank); ids in several lists rise.
export function fuse(lists, k = 60) {
  const m = new Map();
  for (const { name, ids } of lists) ids.forEach((id, r) => { const e = m.get(id) || { id, score: 0, via: [], ranks: {} }; e.score += 1 / (k + r + 1); e.via.push(name); e.ranks[name] = r + 1; m.set(id, e); });
  return [...m.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
export const SEMANTIC_MIN = 0.42;
export { foldToken };
