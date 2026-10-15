// The Notebook block in the per-person system prompt (resident.js systemPrompt → prompt/index.js channelBlock).
//
// Captain 10-08: the block listed notes oldest first and was cut at 3,000 characters, so a note he wrote that day ("Lives at …")
// never reached the model behind ~30 notes from Bee. Now the block is budgeted and chosen by priority:
//   1. the person's own notes (written in the Notebook, edited there, or told in Get to know you), newest first;
//   2. the "how" notes and notes another channel (General) saved here, newest first;
//   3. then every other note, newest first, until the first that doesn't fit.
// What doesn't fit is counted in one closing line, so the model knows to look (memory_explain). The choice depends on the notes alone
// (never the time, the message or the turn), so the block, and the cached prompt prefix it sits in, changes only when the notes change.

export const PINNED_BUDGET = 3000;   // characters (≈750 tokens), the same cut as before
export const ROW_MAX = 700;          // one note's longest text in the block

const at = (m) => Number(m.edited || m.created) || 0;
const byNewest = (a, b) => at(b) - at(a) || (String(a.id) < String(b.id) ? 1 : String(a.id) > String(b.id) ? -1 : 0);

// The person's own words: a Notebook note they wrote or edited, or an answer from Get to know you. A Bee note is theirs once edited.
export const ownNote = (m) => m.author_type === "human" && m.src !== "reflection" && (m.src !== "bee" || !!m.edited);
// A note another channel (General) saved into this channel's Notebook because the person asked for it there. The channel's next turn
// is not told to search for it, so it is pinned like a core fact (Release 36: General saved "gate code 4417" into #bench2, and bench2 answered "I have no record").
export const FROM_GENERAL = "general";
export const fromGeneral = (m) => m.src === FROM_GENERAL;
export const identityNote = (m) => m.sec === "how" || fromGeneral(m);
// The nightly reflection row ("How to work with you") written by the retired reflection job. It stays in the Notebook and is never pinned.
export const REFLECT_ID = "reflect-how";

// Bee notes reach the helper as ordinary memory (bee-sync.js §0): never named, tagged like anything else it remembers.
const tag = (m) => ownNote(m) ? "you" : m.kind === "preference" && m.author_type !== "human" ? "preference" : "remembered";
export const noteLine = (m, rowMax = ROW_MAX) => `- (${tag(m)}) ${String(m.content || "").replace(/\s+/g, " ").trim().slice(0, rowMax)}`;

// rows: the channel's Notebook rows already filtered to what may be pinned. → { text, shown: [rows], omitted: [rows] }
// rowMax: the longest text of one note (phase 4A keeps the person's own "how" notes word for word, so it passes a large one).
export function pinnedBlock(rows, { budget = PINNED_BUDGET, rowMax = ROW_MAX } = {}) {
  const pool = (rows || []).filter((m) => String(m?.content || "").trim()).slice().sort(byNewest);
  const own = pool.filter(ownNote), rest1 = pool.filter((m) => !ownNote(m));
  const ident = rest1.filter(identityNote), rest2 = rest1.filter((m) => !identityNote(m));
  const lines = [], shown = [], omitted = [];
  let used = 0;
  const room = Math.max(0, budget - moreLine(9999).length - 1);   // room kept for the "+N more" line
  // Their own notes and who-they-are facts: a long one that doesn't fit never blocks a shorter one after it.
  // The rest strictly newest first: the first that doesn't fit ends it (an old short note never jumps a newer one).
  let full = false; const coreSet = new Set([...own, ...ident]);
  for (const m of [...own, ...ident, ...rest2]) {
    const ln = noteLine(m, rowMax), core = coreSet.has(m);
    if ((core || !full) && used + ln.length + 1 <= room) { lines.push(ln); shown.push(m); used += ln.length + 1; }
    else { omitted.push(m); if (!core) full = true; }
  }
  // Nothing left out: the reserve isn't needed, so a last note that fits the full budget still goes in.
  if (omitted.length === 1 && used + noteLine(omitted[0], rowMax).length + 1 <= budget) { lines.push(noteLine(omitted[0], rowMax)); shown.push(omitted.pop()); }
  if (omitted.length) lines.push(moreLine(omitted.length));
  return { text: lines.join("\n"), shown, omitted };
}
export const moreLine = (n) => `(+${n} more note${n === 1 ? "" : "s"} in their Notebook, not listed here. Search them with memory_explain before you ask the person or say you don't know.)`;
