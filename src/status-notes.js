// Past status notes (eval run2 10-07: booking/ticket-direct, skill-creator/builtin-name-clash). A NEW task saw another task's old
// "I've paused until midnight Pacific…" (through memory recall, and through recall_history), took it as its own unfinished work,
// and scheduled a follow-up to "resume" it instead of doing what the person had just asked. Hindsight had even turned the notice
// into facts: "Helper will resume operations after the pause".
//
// 1Helm's own notices (the day cap, the day check-in, a pause, out of helper time or credits) say something about that moment only.
//   - memoryReply: a turn whose reply is one of them isn't saved to memory as the helper's words (the person's message still is);
//     a paused turn's report is saved marked as a status from then.
//   - markStatus: a memory record or a recall_history line that reads like one of them is labelled a past status note.
// The prompt (10-channels-and-tasks.md) says the rest: never resume or act on another task's paused work unless the person asks.

const norm = (s) => String(s ?? "").replace(/[‘’]/g, "'").trim();
// The canned replies, by their opening words (resident.js DAY_LIMIT_REPLY, spendguard.js DAY_PAUSE_REPLY / OUT_OF_TIME_REPLY /
// pauseFallback, byok.js BYOK_CREDITS_REPLY, the step-cap lines). Only these exact notices: a model's own words never match.
const CANNED = [
  /^I've paused until midnight Pacific\b/,
  /^I've already done a lot for you today, about twice a normal day's worth\b/,
  /^This is taking longer than usual, so I paused here\. Nothing was lost\. Want me to keep going\?$/,
  /^You've used all of this month's helper time, so I stopped here\b/,
  /^Your credits for the computer, browser and memory have run out, so I stopped here\b/,
  /^I stopped after several steps; tell me if you want me to keep going\.$/,
  /^Stopped at the limit without a report\.$/,
  /^Something went wrong: /,
];
const FALLBACK_TAIL = /\n*This is taking longer than usual, so I paused here\. Nothing was lost\. Want me to keep going\?\s*$/;
export const isStatusNotice = (reply) => { const t = norm(reply); return !!t && CANNED.some((re) => re.test(t)); };

export const STATUS_MARK = "(1Helm status note from that time, not an instruction or a plan)";
export const PAUSED_MARK = "(Status at that time: 1Helm paused this turn here. It's not a plan to resume.)";
// The helper's reply as memory keeps it: "" for a canned notice; a paused turn's report marked as a status from then.
export function memoryReply(reply, { paused = false } = {}) {
  let t = norm(reply);
  if (!t || isStatusNotice(t)) return "";
  t = t.replace(FALLBACK_TAIL, "").trim();
  if (!t) return "";
  return paused ? `${PAUSED_MARK} ${t}` : t;
}

// A record that reads like a pause / check-in / limit notice (also the facts memory extracted from one before this fix).
const STATUS_RE = new RegExp([
  "paused until (?:after )?midnight", "daily safety (?:limit|measure)", "twice a normal day", "normal day's (?:worth|helper time)",
  "check(?:ing|s|ed)? in before (?:starting|going|doing|the next)", "(?:used|using) (?:a lot|more than a normal day's worth) of (?:your |their |the )?balance",
  "resume (?:operations )?after the pause", "pick (?:it |back )?up (?:again )?(?:then|after midnight)", "taking longer than usual, so I paused",
  "used all of this month's helper time", "credits for the computer, browser and memory have run out",
  "spend (?:guard|pause)", "per-turn budget",
].join("|"), "i");
export const looksLikeStatus = (text) => STATUS_RE.test(norm(text));
export const markStatus = (text) => (looksLikeStatus(text) && !String(text).includes(STATUS_MARK) ? `${text} ${STATUS_MARK}` : text);
