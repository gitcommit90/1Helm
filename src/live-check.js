// Live status needs a lookup in this turn (eval run2 10-07, flight-status/predicted-landing: "When is United 4 actually going to
// land?" got "United 4 already landed at 6:07 p.m., gate E7" in one step with no tool at all, from an earlier lookup in memory).
// Flights, prices, availability, scores, delays and opening hours change by the minute: memory and earlier lookups are old.
//
// The rule is in the prompt (03-contextual-awareness.md) and the flight-status skill. This is the light guard in code, both engines:
// when a chat turn's answer states live status about something the person asked about live, and no tool that reads the world ran
// in this turn, the model is nudged ONCE to look it up (or say it'd need to check) before the answer goes out.

// The person asked about something live (their message in this turn).
const FLIGHT_CODE = /\b(?:[A-Z]{2}|[A-Z]\d|\d[A-Z])\s?\d{1,4}\b/;   // UA 4, B6 123 (capitals only: "at 5" isn't a flight)
const FLIGHT_NO = /\b(?:united|delta|american|southwest|jetblue|alaska|spirit|frontier|hawaiian|air canada|british airways|lufthansa|air france|klm|emirates|qantas|ryanair|easyjet)\s+(?:flight\s+)?\d{1,4}\b/i;
const LIVE_ASK = /\b(land(?:s|ing|ed)?|arriv(?:e|es|al|ing)|depart(?:s|ure|ing)?|take ?off|tak(?:es|ing) off|delay(?:s|ed)?|on time|gate|flight status|cancel(?:l)?ed|in stock|availab(?:le|ility)|sold out|seats? left|tickets? left|price|prices|cost|how much|score|winning|who won|open (?:now|today|tonight)|wait time|traffic|weather)\b/i;
export const asksLive = (words = []) => words.some((w) => { const s = String(w || ""); return FLIGHT_CODE.test(s) || FLIGHT_NO.test(s) || LIVE_ASK.test(s); });

// The answer states live status as fact.
const STATES = /\b(already landed|has landed|landed (?:at|in)|touched down|has departed|departed (?:at|from)|took off|is (?:running )?(?:late|early|delayed|on time|cancel(?:l)?ed|diverted|boarding)|was (?:delayed|cancel(?:l)?ed|diverted)|(?:is|are) in the air|en route|(?:arrives|lands|landing|arriving|departs|leaves) (?:at|around) \d|gate [A-Z]?\d{1,3}\b|in stock|out of stock|sold out|(?:is|are) available (?:now|today|tonight|for)|seats? (?:left|available)|currently (?:costs?|priced|selling|at|\$)|(?:now|today) (?:costs?|is|at) \$\d|(?:leads?|leading|won|beat|trail(?:s|ing)?) \d+\s?[-–]\s?\d+|final score|is open (?:now|until))\b/i;
// Already hedged: it says it would need to look, or that it couldn't.
const HEDGED = /\b(I'?d (?:need|have) to check|I (?:haven'?t|have not|couldn'?t|could not|can'?t|cannot) (?:checked|check|look(?:ed)? (?:it )?up|confirmed|confirm\b|verif(?:y|ied))|want me to (?:check|look)|shall I (?:check|look)|let me (?:check|look))\b/i;
export const statesLive = (reply) => { const s = String(reply || "").replace(/[‘’]/g, "'"); return STATES.test(s) && !HEDGED.test(s); };

// Tools that read the world now (a lookup in this turn). Memory, work_log and bring_back are old by definition.
const LOOKUP = new Set(["web_search", "fetch_url", "run_command", "app_run", "app_proxy", "gmail_search", "gmail_read", "calendar_events", "start_helper", "browser_task"]);
export const isLookup = (name) => LOOKUP.has(String(name)) || /^browser_/.test(String(name));
export const noteRan = (tc, name) => { if (tc) (tc.ranTools ||= new Set()).add(String(name)); };
export const lookedUp = (tc) => [...(tc?.ranTools || [])].some(isLookup);

export const LIVE_NUDGE = "(Before this goes out: your answer states live status (a flight's times, landed, delayed or its gate; a price; availability; a score) but nothing in this turn looked it up. Memory, earlier lookups and what you already know are old for this. Look it up now (web_search / fetch_url, or the browser) and answer from that, saying where it came from; an estimate is labelled as an estimate. If you can't check it, say you'd need to check instead of stating it.)";
// → the nudge text (once per turn), or null. words: the person's words in this turn (person-asked.js personWords).
export function liveNudge(tc, words, reply) {
  if (!tc || tc.kind !== "chat" || tc.liveNudged) return null;
  if (lookedUp(tc) || !statesLive(reply) || !asksLive(words)) return null;
  tc.liveNudged = true;
  return LIVE_NUDGE;
}
