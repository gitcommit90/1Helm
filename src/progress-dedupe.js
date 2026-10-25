// Progress-line dedupe for one turn's reply (Captain 10-10, "reply-dupes"). Each model step's pre-tool text is saved as its own part;
// the model often says the same thing again on the next tool step ("Let me pull that up." ... "Let me pull that up."). The person
// should see each progress thought once and the final answer untouched.
//
// dedupeProgress(parts) -> parts, where parts are one turn's step texts in order and the LAST one is the final answer.
//  - The last part is never dropped or changed. Only earlier (progress) parts can be dropped; no part is ever edited.
//  - A part holding a code fence or a card (genui) is protected: never dropped, never used to drop another.
//  - A later progress part that matches an earlier one is dropped (the first is kept): same words after normalising case, whitespace,
//    punctuation and dashes, or the same words with token similarity >= SIM (Jaccard over word sets, both >= 4 words).
//  - An earlier progress part whose content is subsumed by the next kept part (or the final) is dropped: its normalised text is
//    a prefix/substring of the later one, or its content words (filler dropped, progress verbs folded) are all in the later one's
//    and it has at least 3 of them.
// Pure and dependency free; the app (design-sandbox src/progress-dedupe.ts) carries the same rules for live and reload rendering.
export const SIM = 0.8;
const FILLER = new Set("a an the i ill im ive we let lets me my your you youre it its this that those these to for of on in at and or so now just then ok okay got sure yes right alright going gonna will can about up out over into from with is are be do did get take have has had real actual actually quickly first next also again there here some any".split(" "));
const VERB = { check: "find", search: "find", look: "find", pull: "find", find: "find", fetch: "find", grab: "find", open: "find", read: "find", load: "find", lookup: "find", checking: "find", searching: "find", looking: "find", pulling: "find", finding: "find", fetching: "find", grabbing: "find", reading: "find", loading: "find", opening: "find" };
export const norm = (s) => String(s || "").normalize("NFKC").toLowerCase().replace(/['’‘`]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const words = (s) => norm(s).split(" ").filter(Boolean);
const content = (s) => { const out = new Set(); for (const w of words(s)) { if (FILLER.has(w)) continue; out.add(VERB[w] || w); } return out; };
const protectedPart = (s) => /```|~~~/.test(s) || /^\s*\w+\s*=\s*[A-Z]\w*\(/m.test(s);
function jaccard(a, b) { const A = new Set(a), B = new Set(b); let i = 0; for (const x of A) if (B.has(x)) i++; return i / (A.size + B.size - i || 1); }
function same(a, b) {   // a and b read as the same progress thought
  const na = norm(a), nb = norm(b); if (!na || !nb) return false;
  if (na === nb) return true;
  const wa = na.split(" "), wb = nb.split(" ");
  return wa.length >= 4 && wb.length >= 4 && jaccard(wa, wb) >= SIM;
}
function subsumed(a, b) {   // a (earlier) is contained in b (later)
  const na = norm(a), nb = norm(b); if (!na) return false;
  if (na.length >= 12 && nb.includes(na)) return true;
  const ca = content(a), cb = content(b); if (ca.size < 3) return false;
  for (const w of ca) if (!cb.has(w)) return false;
  return true;
}
export function progressKeep(parts) {
  const xs = (parts || []).map((x) => String(x ?? "")); const n = xs.length; if (n < 2) return xs.map(() => true);
  const keep = xs.map(() => true), last = n - 1, ok = (i) => keep[i] && !protectedPart(xs[i]) && xs[i].trim();
  // 1) a later progress part repeating an earlier one goes (the first stays)
  for (let j = 1; j < last; j++) { if (!ok(j)) continue; for (let i = 0; i < j; i++) if (ok(i) && same(xs[i], xs[j])) { keep[j] = false; break; } }
  // 2) the final answer is never dropped: an earlier part that repeats it, or is subsumed by the next kept part, goes
  for (let i = 0; i < last; i++) {
    if (!ok(i)) continue;
    if (!protectedPart(xs[last]) && same(xs[i], xs[last])) { keep[i] = false; continue; }
    let k = i + 1; while (k < last && !keep[k]) k++;
    if (!protectedPart(xs[k]) && xs[k].trim() && subsumed(xs[i], xs[k]) && (k === last || xs[k].length >= xs[i].length)) keep[i] = false;
  }
  return keep;
}
export function dedupeProgress(parts) { const xs = (parts || []).map((x) => String(x ?? "")), k = progressKeep(xs); return xs.filter((_, i) => k[i]); }

// ---- progress vs answer (Captain 10-10, second step) ----
// Text a model writes before a tool call is progress, not the answer. The answer is the text after the last tool call; if the model
// writes its answer and then calls only bookkeeping tools (or the closing text is trivial), that text is still the answer.
// splitProgress(said, meta) -> [{ text, progress }] (deduped; order kept). meta[i] = { calls: names of the tool calls in the step that
// wrote said[i], later: names of calls in the following steps that wrote no text } or null/absent when unknown. Unsure => not progress.
// meta.ack === true marks a promise-only line the loop kept after a nudge (ack-stall.js): progress even though no call came with it.
// A part with a question, a card, a file link or code is never progress: it is something to act on or keep.
export const BOOKKEEPING = new Set(["remember", "react", "note_account", "save_run_notes", "update_todos", "rename_task", "mark_task_done", "set_workflow_status", "set_workflow_gate", "share_file", "share_file_link", "publish_page", "offer_connect", "pomodoro", "show_deck_styles"]);
const bk = (m) => !!m && [...(m.calls || []), ...(m.later || [])].every((n) => BOOKKEEPING.has(n));
export const mustShow = (s) => protectedPart(s) || /\?/.test(s) || /\]\(\s*(?:https?:|\/)/.test(s) || /\bhttps?:\/\/\S+/.test(s);
const trivial = (s) => String(s).trim().length < 20 && !mustShow(s);
const sameText = (a, b) => { a = String(a).trim(); b = String(b).trim(); return a === b || a.startsWith(b) || b.startsWith(a); };
function classified(said, meta, dedupe) {
  const xs = (said || []).map((x) => String(x ?? "")), keep = dedupe ? progressKeep(xs) : xs.map(() => true);
  const idx = xs.map((_, i) => i).filter((i) => keep[i] && xs[i].trim());
  const ms = idx.map((i) => (meta?.[i] && sameText(meta[i].text ?? xs[i], xs[i]) ? meta[i] : null));
  const n = idx.length; if (!n) return [];
  let a = n - 1;   // answer index among kept parts
  if (trivial(xs[idx[a]])) for (let k = n - 2; k >= 0; k--) {
    if (trivial(xs[idx[k]]) || !ms[k]) continue;
    let ok = true; for (let j = k; j < n; j++) if (ms[j] ? !bk(ms[j]) : j !== n - 1) ok = false;   // a trailing unknown (closing text) is fine
    if (ok) a = k; break;
  }
  return idx.map((i, j) => ({ index: i, text: xs[i], progress: j < a && !!ms[j] && (ms[j].calls.length > 0 || ms[j].ack === true) && !mustShow(xs[i]) }));
}
export function splitProgress(said, meta = []) { return classified(said, meta, true).map(({text, progress}) => ({text, progress})); }
// Retention needs classification before display dedupe, by position rather than
// text identity. Unknown/misaligned metadata cannot authorize discarding words.
export function progressEntries(said, meta = []) {
  const valid = said.map((s, i) => { const m = meta[i]; return m?.text === s && Array.isArray(m.calls) && Array.isArray(m.later) && [...m.calls,...m.later].every(x => typeof x === 'string') ? m : null; });
  return classified(said, valid, false);
}
export const answerText = (sp) => sp.filter((x) => !x.progress).map((x) => x.text).join("\n\n");
