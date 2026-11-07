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

// ---- Open to-do items when a chat turn ends on an explanation (Live, 2026-11-06, #publicbytes, channel josephs1, ChatGPT plan) ----
// The person asked for research and said twice to use the X API from the computer. Both turns ended on a reply that explained a failed call
// ("X returned an unauthorized response ...") while the task's to-do list still had a todo and a doing item. The reply answered the person's
// criticism and the research stopped. Prompt text did not change it, so this guard uses only app facts: the to-do list, the turn's tool calls,
// what is running or waiting on the person, and whether the reply asks the person something. It shares tc.ackNudged, so a turn gets at most
// one nudge of any kind.

export function openTodoNudgeText(items) {
  const list = items.slice(0, 10).map((x) => `- [${x.status}] ${String(x.text || "").slice(0, 160)}`).join("\n");
  return `(Context note, not from the person: your to-do list still has unfinished items, and you ended your turn on a reply with no tool call.\n${list}\nThe person still wants the original result of this task. Continue the work now with your tools, and if a path failed, take the next real path. Mark each item done with update_todos as you finish it. If you are truly blocked, say exactly what you need from the person.)`;
}

const WAITING_TOOLS = new Set(["ask_user", "request_input", "interview", "send_poll", "propose_plan", "offer_connect", "request_saved_login", "request_purchase"]);

// App facts for one chat turn: { open: [unfinished to-do items], running: [...], setUp: [...], waiting: [what the person must answer] }.
export function openWorkFacts(sql, { session, turn, since = 0 } = {}) {
  const all = (q, ...a) => { try { return sql.exec(q, ...a).toArray(); } catch { return []; } };
  const sid = String(session ?? "");
  let items = []; try { items = JSON.parse(all("SELECT items FROM todos WHERE session=?", sid)[0]?.items || "[]"); } catch {}
  const open = items.filter((x) => x && x.status !== "done");
  const running = [
    ...all("SELECT id FROM browser_jobs WHERE session=? AND status IN ('queued','running','stopping')", sid).map((r) => ({ kind: "browser job", id: r.id })),
    ...all("SELECT id FROM helpers WHERE session=? AND status IN ('running','waiting_input')", sid).map((r) => ({ kind: "helper", id: r.id })),
  ];
  const setUp = all("SELECT id FROM workflows WHERE session=? AND created>=? AND status='active'", sid, since);
  const waiting = [
    ...all("SELECT id FROM approvals WHERE session=? AND status='pending'", sid).map(() => "approval"),
    ...all("SELECT id FROM connect_offers WHERE session=? AND status='pending'", sid).map(() => "connect offer"),
    ...all("SELECT id FROM user_questions WHERE session=? AND status='pending'", sid).map(() => "question"),
    ...all("SELECT id FROM chat_interviews WHERE session=? AND status='open'", sid).map(() => "interview"),
    ...all("SELECT id FROM plans WHERE session=? AND status='pending'", sid).map(() => "plan"),
    ...all("SELECT tool FROM card_events WHERE card=? AND type='step'", String(turn ?? "")).filter((e) => WAITING_TOOLS.has(e.tool)).map((e) => e.tool),
  ];
  return { open, running, setUp, waiting };
}

// reply: the text this step would end the turn with. facts: () => openWorkFacts(...), read only after the cheap checks pass.
export function openTodoNudge(tc, stats, reply, facts) {
  if (!tc || tc.kind !== "chat" || tc.ackNudged || tc.pause || tc.stall || tc.abort) return null;
  if ((stats?.tool_calls || 0) < 1 || stats?.promise_resent || stats?.ack_nudge || stats?.work_nudge) return null;
  if (sentences(reply).slice(-2).some((x) => /\?/.test(x) || ASK.test(x))) return null;
  let f; try { f = facts?.() || {}; } catch { return null; }
  if (!(f.open || []).length || (f.running || []).length || (f.setUp || []).length || (f.waiting || []).length) return null;
  tc.ackNudged = true;
  return openTodoNudgeText(f.open);
}

// ---- A closing promise of work the helper does itself (Live, 2026-11-04, #videos "A Game of Horse", classic engine, BYOK) ----
// The ack guard above needs NO tool in the turn and a reply that is only a short promise. Real replies that ended a turn with nothing running were
// "...I'm creating the visual references and working on the commercial now." (after tools ran), "...The next step is to check the Comfy account's access to that
// image model." (after tools ran) and "...I'll continue checking the Comfy setup and tell you if I need you to sign in or make a decision." (no tool).
// The promise check in promise-check.js asks a decision model and never runs on a person's own AI key, so this is the deterministic guard beside it.
//
// It fires ONCE (it shares tc.ackNudged with the ack guard, and skips a turn the promise check already sent back) when ALL hold: (1) a closing sentence (the
// last two) commits the helper to do work itself now or next, built from a known shape ("I'll continue ...", "I'm creating ... now", "The next step is to ...",
// "Next, I'll ..."); (2) the closing sentences hold no question and no ask of the person ("let me know", "if you want", "once you ...", "please", "can you");
// (3) nothing the promise could refer to is going: no running helper or browser job, nothing set up this turn (schedule, watcher, workflow), no pause, stall or stop.
// A tool earlier in the turn does NOT exempt it. A promise that waits on a time or a condition ("tomorrow", "once it finishes", "if ...") never fires.
// A trailing "and tell you if I need you to sign in" is dropped before the ask check, because the work itself is still the helper's.

export const WORK_NUDGE = "(You said you'd keep working, but you ended your turn and nothing is running. Do the step you just promised now, using your tools. If you truly can't, say plainly and exactly what you need from the person, and ask for it. Don't repeat the promise.)";

const ASK = /\b(?:let me know|tell me|if you(?:'d| would)? (?:like|want|prefer|need|wish)|if you(?:'re| are) (?:ok|okay|happy|interested)|would you|could you|can you|do you|should i|shall i|want me to|like me to|please|once you|when you|after you|until you|need you to|you(?:'ll| will)? need to|you can|you could|you may|up to you|your call|your choice)\b/;
const LATER = /\b(?:tomorrow|tonight|later|today at|this (?:morning|afternoon|evening|week)|next (?:week|month|time|session)|in (?:a|an|\d+|about|a few) (?:minutes?|hours?|days?|moments?)|on (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|once|whenever|as soon as|unless|if|when|after|until|every|daily|weekly|hourly|eventually|at some point)\b/;
const LEADS = "(?:(?:got it|understood|sure|yes|of course|noted|now|then|next|so|and|but|ok|okay|alright|meanwhile|therefore|also|just|right now|for now) )*";
const WORK = "(?:continue|keep (?:going|working|checking|trying|looking|investigating)|proceed|go ahead|retry|re ?run|try|investigate|check|create|generate|build|run|fix|resolve|set up|finish|complete|look into|look at|dig into|work on|start|begin|prepare|pull|fetch|figure out)";
const GERUND = "(?:creating|generating|working|building|running|checking|investigating|fixing|writing|preparing|retrying|trying|continuing|finishing|setting up|looking|digging|starting|beginning|resolving|fetching|pulling)";
const COMMIT = [
  new RegExp(`^${LEADS}(?:i'll|i will|i'm going to|i am going to|i'm gonna|let me) (?:now |then |just |also |go ahead and )?${WORK}\\b`),
  new RegExp(`^${LEADS}(?:i'm|i am) (?:now |currently |still )?${GERUND}\\b`),
  new RegExp(`^${LEADS}(?:the )?next step is to\\b`),
];
const sentences = (text) => normalize(String(text || "").replace(/```[\s\S]*?```/g, " ")).split(/(?<=[.!?])\s+|\s*\n+\s*/).map((s) => s.replace(/^(?:[-*•]|\d+[.)])\s+/, "").trim()).filter(Boolean);

// reply: the final reply text the turn would end with. True when its closing sentences are a forward promise of the helper's own work.
export function isClosingPromise(reply) {
  const ss = sentences(reply).slice(-2); if (!ss.length) return false;
  const kept = ss.map((s) => s.replace(/\s*(?:and |then )?(?:i'll |i will |will )?(?:tell|let) you(?: know)?(?: if| when| what| how| once)\b.*$/, "").replace(/[.!]+$/, "").trim());
  if (kept.some((s) => /\?/.test(s) || ASK.test(s))) return false;
  return kept.some((s) => !LATER.test(s) && COMMIT.some((re) => re.test(s)));
}

// → the nudge text (once per turn), or null. reply: this step's text; facts: () => { running, setUp } (promise-check.js turnFacts), read only after the reply matched.
export function workNudge(tc, stats, reply, facts) {
  if (!tc || tc.kind !== "chat" || tc.ackNudged || tc.pause || tc.stall || tc.abort || stats?.promise_resent || stats?.ack_nudge) return null;
  if (!isClosingPromise(reply)) return null;
  let f; try { f = facts?.() || {}; } catch { return null; }
  if ((f.running || []).length || (f.setUp || []).length) return null;
  tc.ackNudged = true;
  return WORK_NUDGE;
}
