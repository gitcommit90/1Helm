// A promise with no work behind it (Live, 10-18: a person attached a 22 KB runbook; the model made one step, zero tool
// calls, and replied only "Got it, thanks for sharing that guide, reading it now."). The loop took that as the final answer and closed the
// turn, so the person saw a promise of work and then nothing. The same model often writes such a line BEFORE its tool calls; sometimes it
// writes the line and stops.
//
// This is the light guard in code, both engines (like live-check.js): when a chat turn is about to end on a text-only step, no tool ran in
// the turn, and everything said so far is only a short stand-in that announces work about to happen, the model is nudged ONCE to do it now.
//
// Why it is narrow: a nudge costs one more model call, a false positive must be rare. It fires only when EVERY sentence is either filler
// ("got it", "thanks for sharing that guide") or a promise built from a known shape (a lead-in like "I'll" / "let me" / "I'm", a work verb
// like read / look / check / dig, then only a few plain words such as "it", "that", "the guide", "now"), and at least one sentence is a
// promise. A question, a link, code, a digit, a long reply, or any sentence with content it doesn't know is never a promise-only reply, so
// real answers, questions to the person, "Done." and "Yes, it's on Friday." all pass. Turns that end on purpose (waiting for a connect,
// permission or plan approval) ran a tool, so stats.tool_calls > 0 keeps them out; helpers and workflows are not chat turns.

export const ACK_NUDGE = "(You said you'd do it now, but you ended your turn without doing it. Do it now: answer from what you already have, or call the tool you need. Don't repeat the acknowledgment.)";
export const ACK_MAX_CHARS = 160, ACK_MAX_WORDS = 24;

const FILLER_LEAD = /^(?:(?:ok|okay|alright|all right|right|sure|sure thing|got it|gotcha|understood|noted|great|perfect|awesome|absolutely|certainly|of course|yes|yep|yeah|hi|hey|hello|will do|sounds good|sounds great|makes sense|good idea|good call)\b\s*)+/;
const THANKS = /^(?:thanks|thank you)(?: so much| very much)?(?: for (?:sharing|sending|passing|giving|providing|forwarding|the|your|that|this|these|those|all)(?: [a-z']+){0,6})?$/;
const FILLER_ONLY = /^(?:(?:ok|okay|alright|right|sure|got it|gotcha|understood|noted|great|perfect|awesome|absolutely|certainly|of course|yes|yep|yeah|hi|hey|hello|sounds good|makes sense|will do|good call)\s*)+$/;
// Short statements that are the whole promise.
const STANDALONE = /^(?:on it|working on it|working on that|looking into it|looking into that|looking now|reading it|reading it now|checking now|checking it now|starting now|starting on it|will do|one (?:moment|sec|second|min|minute)|just a (?:moment|sec|second|min|minute)|give me a (?:moment|sec|second|min|minute|bit)|hang on|hold on|bear with me|stand by|be right back|back in a (?:moment|sec|second|minute)|one moment please|please hold)(?: (?:please|now|right now|thanks|a bit))?$/;
// lead-in + work verb + a few plain words.
const LEAD = "(?:i'll|i will|ill|i'm going to|i am going to|i'm gonna|i'm about to|let me|lemme|i'm|i am|im|i can|i'll go ahead and|let me go ahead and|going to|now i'll|i'll now|i'll just|let me just|i'll start by|let me start by)";
const VERB = "(?:read|reading|look|looking|take a look|taking a look|have a look|having a look|check|checking|review|reviewing|dig|digging|dive|diving|go through|going through|go over|going over|work|working|pull|pulling|search|searching|open|opening|scan|scanning|parse|parsing|process|processing|start|starting|get started|getting started|get on|getting on|figure|figuring|see|seeing|take care of|taking care of|handle|handling|put together|putting together|build|building|set up|setting up|write|writing|draft|drafting|go ahead)";
const REST = new Set("it that this them those these the your you you're my a an all of in on at to into over through up out for with and then now right away shortly again first quickly real quick for carefully closely properly thoroughly momentarily straight immediately in a moment second sec bit guide file files doc docs document documents runbook info information details notes note attachment attached text steps instructions rest everything whole above below shared sent helpful setup message email thread link page answer summary reply response get back report let know come".split(" "));
const PROMISE_WITH_LEAD = new RegExp(`^${LEAD}\\s+${VERB}\\b(.*)$`), PROMISE_GERUND = new RegExp(`^(?:now )?(?:reading|looking|checking|reviewing|digging|diving|going through|going over|working|pulling|searching|scanning|processing|starting|taking a look|having a look)\\b(.*)$`);
const restOk = (rest) => { const ws = rest.split(" ").filter(Boolean); return ws.length <= 8 && ws.every((w) => REST.has(w)); };

const normalize = (s) => String(s).normalize("NFKC").toLowerCase().replace(/[‘’`]/g, "'").replace(/[—–]/g, " ").replace(/\.{2,}|…/g, ".")
  .replace(/[\p{Extended_Pictographic}‍️]/gu, "").replace(/[,:]/g, " ").replace(/[*_~]/g, "").replace(/\s+/g, " ").trim();

// → "promise" | "filler" | null for one normalized sentence.
function kind(s) {
  s = s.replace(/[.!]+$/, "").trim(); if (!s) return "filler";
  if (FILLER_ONLY.test(s + " ") || THANKS.test(s)) return "filler";
  for (let i = 0; i < 4; i++) {   // peel lead-ins: "got it thanks for sharing that guide reading it now"
    if (STANDALONE.test(s)) return "promise";
    let m = s.match(PROMISE_WITH_LEAD) || s.match(PROMISE_GERUND); if (m && restOk(m[1].trim())) return "promise";
    const t = s.replace(/^(?:(?:thanks|thank you)(?: so much| very much)?(?: for (?:sharing|sending|passing|giving|providing|forwarding)(?: (?:the|your|that|this|these|those|all|me))? (?:[a-z']+ ){0,3}?(?:guide|info|information|file|files|doc|docs|document|documents|runbook|notes|details|context|text|instructions|link|steps|message|email|thread|that|this|it|these|those))?)\s*/, "");
    const p = t !== s ? t : s.replace(FILLER_LEAD, ""); if (p === s || !p) return null; s = p.trim();
  }
  return null;
}

// text: the reply the turn would end with (everything said so far). True only for a short, promise-only stand-in.
export function isPromiseOnly(text) {
  const raw = String(text || "").trim(); if (!raw || raw.length > ACK_MAX_CHARS) return false;
  if (/[?]|https?:|www\.|[`#\[\]{}<>|\\/@]|\d/.test(raw) || raw.split("\n").length > 2) return false;
  const n = normalize(raw); if (!n || n.split(" ").length > ACK_MAX_WORDS) return false;
  const kinds = n.split(/(?<=[.!])\s+/).map(kind); if (kinds.includes(null)) return false;
  return kinds.includes("promise");
}

// → the nudge text (once per turn), or null. said: this turn's text parts so far; stats: the turn's stats (tool_calls).
export function ackNudge(tc, stats, said) {
  if (!tc || tc.kind !== "chat" || tc.ackNudged || (stats?.tool_calls || 0) > 0) return null;
  if (!isPromiseOnly((said || []).join("\n\n"))) return null;
  tc.ackNudged = true;
  return ACK_NUDGE;
}
