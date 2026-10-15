// Realistic speech recognition noise for the ambient grounding tests. Each case is one
// extractor item as a model plausibly returns it: tidied quote, normalized punctuation,
// a typo "fixed", or a thought joined across two lines. Nothing here calls a model.
export const T = Date.UTC(2026, 9, 13, 15);
const wearer = { speaker: "wearer", is_user: true, speaker_id: "me" };
const speech = [
  "so um i gotta call the landlord about the leak in the bathroom you know",                  // 0
  "Remind me to pick up Sarah's prescripshun tomorrow around five",                           // 1 ASR typo
  "I think we should, um, repaint the",                                                       // 2 thought split by ASR
  "kitchen before summer.",                                                                   // 3
  "Don't forget to renew the car registration, it's due Friday.",                             // 4
  "Yeah, I already sent the invoice to Dana.",                                                // 5
  "Maybe I could learn the cello someday",                                                    // 6
  "buy oat milk",                                                                             // 7 repeated phrase
  "The meeting is about the quarterly numbers",                                               // 8 chatter
  "buy oat milk",                                                                             // 9 repeated phrase
  "so, like, I need to, uh, email the accountant about the tax form",                         // 10 filler words
  "Okay never mind the dentist appointment, I'm not going anymore.",                          // 11
];
export const lines = speech.map((text, i) => ({ text, at: T + i * 5000, utterance_id: `u${i}`, offset: 0, ...wearer }));
export const previous = [
  { id: "ambient:invoice", kind: "task", owner: "wearer", text: "Send the invoice to Dana", evidence: [{ quote: "I need to send the invoice to Dana", at: T - 864e5 }], source_at: T - 864e5 },
  { id: "ambient:dentist", kind: "task", owner: "wearer", text: "Go to the dentist appointment on Tuesday", evidence: [{ quote: "I have the dentist appointment on Tuesday", at: T - 864e5 }], source_at: T - 864e5 },
];
const item = (kind, quote, line, text, extra = {}) => ({ kind, speech_act: "intention", text, quote, line, status: "open", due_text: "", relation: null, supersedes: [], ...extra });
// expect: the grounding state a correct implementation should report.
export const cases = [
  { id: "case-and-punctuation", expect: "located", raw: item("task", "I gotta call the landlord about the leak in the bathroom.", 0, "Call the landlord about the leak in the bathroom") },
  { id: "reworded-contraction", expect: "approximate", raw: item("task", "I've got to call the landlord about the leak in the bathroom.", 0, "Call the landlord about the leak in the bathroom") },
  { id: "typo-the-model-fixed", expect: "located", raw: item("reminder", "Remind me to pick up Sarah's prescription tomorrow around five.", 1, "Pick up Sarah's prescription tomorrow around 5", { due_text: "tomorrow around five" }) },
  { id: "thought-split-across-lines", expect: "located", raw: item("task", "I think we should repaint the kitchen before summer", 2, "Repaint the kitchen before summer") },
  { id: "filler-words", expect: "located", raw: item("task", "I need to email the accountant about the tax form", 10, "Email the accountant about the tax form") },
  { id: "near-paraphrase", expect: "approximate", raw: item("idea", "Maybe I could learn to play the cello.", 6, "Maybe learn the cello", { speech_act: "tentative_intention" }) },
  { id: "far-paraphrase", expect: "unlocated", raw: item("idea", "I want to take up a stringed instrument", 6, "Take up a stringed instrument", { speech_act: "tentative_intention" }) },
  { id: "fully-hallucinated", expect: "unlocated", raw: item("task", "Book a flight to Lisbon for the conference", 8, "Book a flight to Lisbon") },
  { id: "repeat-settled-by-line-hint", expect: "located", raw: item("task", "buy oat milk", 9, "Buy oat milk") },
  { id: "repeat-with-wrong-hint", expect: "approximate", raw: item("task", "Buy oat milk.", 40, "Buy oat milk") },
  { id: "exact-control", expect: "located", raw: item("task", "Don't forget to renew the car registration, it's due Friday.", 4, "Renew the car registration", { due_text: "Friday" }) },
  { id: "exact-control-two", expect: "located", raw: item("decision", "I'm not going anymore.", 11, "Cancel the dentist appointment", { status: "cancelled", relation: "cancellation", supersedes: ["previous:1"] }) },
  { id: "completion-in-located-speech", expect: "located", raw: item("task", "I sent the invoice to Dana.", 5, "Sent the invoice to Dana", { status: "completed", relation: "completion", supersedes: ["previous:0"] }) },
  { id: "completion-in-unlocated-speech", expect: "unlocated", raw: item("task", "I paid the invoice from Dana yesterday", 5, "Paid the invoice from Dana", { status: "completed", relation: "completion", supersedes: ["previous:0"] }) },
];
// The old gate (src/ambient.js before grounding): an item survived only when its quote was an exact,
// case-sensitive substring of one line, found by the model's line number or one unique match elsewhere.
export function legacyKept(raw, lines) {
  const quote = typeof raw.quote === "string" ? raw.quote.trim() : "";
  let index = Number.isInteger(raw.line) ? raw.line : -1;
  if (quote && !lines[index]?.text?.includes(quote)) { const matches = lines.flatMap((l, i) => l.text.includes(quote) ? [i] : []); index = matches.length === 1 ? matches[0] : -1; }
  return !!(quote && lines[index] && quote.length >= 4 && quote.length <= 1500 && lines[index].text.includes(quote));
}
