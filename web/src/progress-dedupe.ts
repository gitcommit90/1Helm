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
// Port of 1helm-cloud/proto src/progress-dedupe.js: keep the two identical. The app applies it when it paints, so a live reply, a reload
// and old saved turns all read the same.
export const SIM = 0.8;
const FILLER = new Set<string>("a an the i ill im ive we let lets me my your you youre it its this that those these to for of on in at and or so now just then ok okay got sure yes right alright going gonna will can about up out over into from with is are be do did get take have has had real actual actually quickly first next also again there here some any".split(" "));
const VERB: Record<string, string> = { check: "find", search: "find", look: "find", pull: "find", find: "find", fetch: "find", grab: "find", open: "find", read: "find", load: "find", lookup: "find", checking: "find", searching: "find", looking: "find", pulling: "find", finding: "find", fetching: "find", grabbing: "find", reading: "find", loading: "find", opening: "find" };
export const norm = (s: any) => String(s || "").normalize("NFKC").toLowerCase().replace(/['’‘`]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const words = (s: any) => norm(s).split(" ").filter(Boolean);
const content = (s: any) => { const out = new Set<string>(); for (const w of words(s)) { if (FILLER.has(w)) continue; out.add(VERB[w] || w); } return out; };
const protectedPart = (s: any) => /```|~~~/.test(s) || /^\s*\w+\s*=\s*[A-Z]\w*\(/m.test(s);
function jaccard(a: string[], b: string[]) { const A = new Set(a), B = new Set(b); let i = 0; for (const x of A) if (B.has(x)) i++; return i / (A.size + B.size - i || 1); }
function same(a: string, b: string) {   // a and b read as the same progress thought
  const na = norm(a), nb = norm(b); if (!na || !nb) return false;
  if (na === nb) return true;
  const wa = na.split(" "), wb = nb.split(" ");
  return wa.length >= 4 && wb.length >= 4 && jaccard(wa, wb) >= SIM;
}
function subsumed(a: string, b: string) {   // a (earlier) is contained in b (later)
  const na = norm(a), nb = norm(b); if (!na) return false;
  if (na.length >= 12 && nb.includes(na)) return true;
  const ca = content(a), cb = content(b); if (ca.size < 3) return false;
  for (const w of ca) if (!cb.has(w)) return false;
  return true;
}
export function progressKeep(parts: any[]): boolean[] {
  const xs = (parts || []).map((x: any) => String(x ?? "")); const n = xs.length; if (n < 2) return xs.map(() => true);
  const keep = xs.map(() => true), last = n - 1, ok = (i: number) => keep[i] && !protectedPart(xs[i]) && xs[i].trim();
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
export function dedupeProgress(parts: any[]): string[] { const xs = (parts || []).map((x: any) => String(x ?? "")), k = progressKeep(xs); return xs.filter((_, i) => k[i]); }

// One agent message's text: its earlier progress parts and its body (the last part), deduped and joined as paragraphs. Consecutive
// text becomes ONE bubble; a card in any part still splits the bubble where it sits (the renderer splits on cards). Tool steps never do.
export const joinedReply = (pre: string[] | undefined, body: string | undefined): string => {
  const b = String(body ?? ""), ps = (pre || []).map((x) => String(x ?? "").trim()).filter(Boolean);
  return dedupeProgress(b.trim() ? [...ps, b.trim()] : ps).join("\n\n");
};

// ---- progress vs answer (port of the proto side: src/progress-dedupe.js) ----
// A part with a question, a card, a link or code is never progress: it is something to act on, so it stays in the reply.
export const mustShow = (s: string): boolean => protectedPart(s) || /\?/.test(s) || /\]\(\s*(?:https?:|\/)/.test(s) || /\bhttps?:\/\/\S+/.test(s);
// One turn's saved parts -> { prog: narration before tool calls (steps area), answer: the reply bubble }, duplicates dropped.
// flags: indexes the server marked as progress (newer turns). Without them (old saved turns) the same rule is applied from what is
// known: every part but the last is progress unless it must be shown. Unsure keeps a part in the reply.
export function splitParts(parts: any[], flags?: number[] | null): { prog: string[]; answer: string[] } {
  const xs = (parts || []).map((x: any) => String(x ?? "")), keep = progressKeep(xs), prog: string[] = [], answer: string[] = [];
  const last = xs.map((x, i) => (keep[i] && x.trim() ? i : -1)).filter((i) => i >= 0).pop() ?? -1;
  xs.forEach((x, i) => {
    if (!keep[i] || !x.trim()) return;
    const isProg = Array.isArray(flags) ? flags.includes(i) && i !== last : i !== last && !mustShow(x);
    (isProg ? prog : answer).push(x.trim());
  });
  return { prog, answer };
}

// Live side, the same split a reload makes. A reply under construction: body = the text streaming now, pre = earlier text that must be
// read (stays in the bubble), prog = narration folded into steps.
export type LiveReply = { body: string; pre?: string[]; prog?: string[]; snap?: number };
// A tool call starts: the text so far is narration (steps area), unless it must be shown.
export function workStep(r: LiveReply): boolean {
  const b = r.body.trim(); if (!b) return false;
  (mustShow(b) ? (r.pre ??= []) : (r.prog ??= [])).push(b); r.body = ""; return true;
}
// The turn is done: the server's saved reply (the answer) replaces what streamed; narration not part of it stays in steps.
export function finishReply(r: LiveReply, serverReply: unknown, error?: unknown) {
  const R = typeof serverReply === "string" ? serverReply.trim() : "";
  if (R && !error && (r.prog?.length || r.pre?.length || r.snap)) {
    const all = [...(r.prog || []), ...(r.pre || []), r.body.trim()].filter(Boolean);
    r.prog = dedupeProgress(all.filter((x) => !R.includes(x.trim()))); r.pre = []; r.body = R;
  }
}
