// The Notebook block in the per-person system prompt (resident.js systemPrompt → prompt/index.js channelBlock), and the
// Notebook notes that match one message (in that message, never the system prompt).
//
// Captain 10-08: the block listed notes oldest first and was cut at 3,000 characters, so a note he wrote that day ("Lives at …")
// never reached the model behind ~30 notes from Bee. Now the block is budgeted and chosen by priority:
//   1. the person's own notes (written in the Notebook, edited there, or told in Get to know you), newest first;
//   2. core facts about who they are: name, home, family, how they like things (any source), newest first;
//   3. then every other note, newest first, until the first that doesn't fit.
// What doesn't fit is counted in one closing line, so the model knows to look (memory_explain), and notes among those that share
// words with the person's message ride in that message (notebookMatches). The choice depends on the notes alone (never the
// time, the message or the turn), so the block, and the cached prompt prefix it sits in, changes only when the notes change.

export const PINNED_BUDGET = 3000;   // characters (≈750 tokens), the same cut as before
export const ROW_MAX = 700;          // one note's longest text in the block

// Who they are: name, home, family, how they like things. A whole-word match on the note's text.
const IDENTITY = /\b(name|named|called|call me|goes by|nickname|lives?|living|live in|home|address|moved to|wife|husband|partner|spouse|married|fiance|fiancee|son|daughter|kids?|children|child|baby|mother|father|mom|mum|dad|parents?|brother|sister|siblings?|family|grand(?:mother|father|ma|pa|parents?)|born|birthday|pronouns?)\b/i;

const at = (m) => Number(m.edited || m.created) || 0;
const byNewest = (a, b) => at(b) - at(a) || (String(a.id) < String(b.id) ? 1 : String(a.id) > String(b.id) ? -1 : 0);

// The person's own words: a Notebook note they wrote or edited, or an answer from Get to know you. A Bee note is theirs once edited.
export const ownNote = (m) => m.author_type === "human" && m.src !== "reflection" && (m.src !== "bee" || !!m.edited);
// A note another channel (General) saved into this channel's Notebook because the person asked for it there. The channel's next turn
// is not told to search for it, so it is pinned like a core fact (Release 36: General saved "gate code 4417" into #bench2, and bench2 answered "I have no record").
export const FROM_GENERAL = "general";
export const fromGeneral = (m) => m.src === FROM_GENERAL;
export const identityNote = (m) => m.sec === "how" || fromGeneral(m) || IDENTITY.test(String(m.content || ""));

// Bee notes reach the helper as ordinary memory (bee-sync.js §0): never named, tagged like anything else it remembers.
const tag = (m) => ownNote(m) ? "you" : m.kind === "preference" && m.author_type !== "human" ? "preference" : "remembered";
export const noteLine = (m) => `- (${tag(m)}) ${String(m.content || "").replace(/\s+/g, " ").trim().slice(0, ROW_MAX)}`;

// rows: the channel's Notebook rows already filtered to what may be pinned. → { text, shown: [rows], omitted: [rows] }
export function pinnedBlock(rows, { budget = PINNED_BUDGET, head = "" } = {}) {
  const pool = (rows || []).filter((m) => String(m?.content || "").trim()).slice().sort(byNewest);
  const own = pool.filter(ownNote), rest1 = pool.filter((m) => !ownNote(m));
  const ident = rest1.filter(identityNote), rest2 = rest1.filter((m) => !identityNote(m));
  const lines = head ? [head] : [], shown = [], omitted = [];
  let used = head ? head.length + 1 : 0;
  const room = Math.max(0, budget - moreLine(9999).length - 1);   // room kept for the "+N more" line
  // Their own notes and who-they-are facts: a long one that doesn't fit never blocks a shorter one after it.
  // The rest strictly newest first: the first that doesn't fit ends it (an old short note never jumps a newer one).
  let full = false; const coreSet = new Set([...own, ...ident]);
  for (const m of [...own, ...ident, ...rest2]) {
    const ln = noteLine(m), core = coreSet.has(m);
    if ((core || !full) && used + ln.length + 1 <= room) { lines.push(ln); shown.push(m); used += ln.length + 1; }
    else { omitted.push(m); if (!core) full = true; }
  }
  // Nothing left out: the reserve isn't needed, so a last note that fits the full budget still goes in.
  if (omitted.length === 1 && used + noteLine(omitted[0]).length + 1 <= budget) { lines.push(noteLine(omitted[0])); shown.push(omitted.pop()); }
  if (omitted.length) lines.push(moreLine(omitted.length));
  return { text: lines.join("\n"), shown, omitted };
}
export const moreLine = (n) => `(+${n} more note${n === 1 ? "" : "s"} in their Notebook, not listed here. Search them with memory_explain before you ask the person or say you don't know; ones that match a message come with it.)`;

// The person's message vs the notes left out of the block: simple word overlap, no model call. → "" or a short section for the message.
const STOP = new Set("the and for are but not you your yours with this that these those from have has had was were will would could should can what when where which who whom why how into onto about over under than then them they their there here his her hers him she he its our ours out off all any some just also very much more most less few lot lots get got make made want need like please thanks thank tell know think does did doing done one two way day today tomorrow yesterday time now new good find look help give take let lets i'm it's don't can't".split(" "));
const words = (s) => new Set(String(s || "").toLowerCase().replace(/[’']/g, "'").split(/[^a-z0-9'@.-]+/).map((w) => w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "").replace(/'s$/, ""))
  .filter((w) => w.length >= 3 && !STOP.has(w)).map((w) => w.length >= 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
export const NB_MATCH_HEADER = "(More from their Notebook that matches this message:)";
export function notebookMatches(omitted, text, { max = 4, chars = 900 } = {}) {
  const q = words(text); if (!q.size || !omitted?.length) return "";
  const scored = omitted.map((m) => { const w = words(m.content); let s = 0; for (const x of q) if (w.has(x)) s++; return { m, s }; })
    .filter((x) => x.s > 0).sort((a, b) => b.s - a.s || byNewest(a.m, b.m)).slice(0, max);
  const out = []; let used = 0;
  for (const { m } of scored) { const ln = noteLine(m); if (used + ln.length > chars) continue; out.push(ln); used += ln.length + 1; }
  return out.length ? `\n\n${NB_MATCH_HEADER}\n${out.join("\n")}` : "";
}
