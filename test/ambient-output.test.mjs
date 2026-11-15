import assert from "node:assert/strict";
import { parseAmbientOutput, ambientContextQuote } from "../src/ee/ambient-output.js";
import { validateAmbient } from "../src/ee/ambient.js";
const body = '{"items":[{"kind":"task","quote":"I returned the library books just now. That is done.","line":7,"status":"completed","relation":"completion","supersedes":[]}]}';
assert.deepEqual(parseAmbientOutput(`Analysis of the transcript:\nOnly one useful line.\n\n\u0060\u0060\u0060json\n${body}\n\u0060\u0060\u0060`), JSON.parse(body), "real live response prose/fence envelope");
for (const invalid of ['{"items":[]} {"items":[]}', '{"items":[}', '[{"items":[]}]', 'nothing', '{"other":1}', '{"items":[]} {']) assert.throws(() => parseAmbientOutput(invalid), SyntaxError);
assert.equal(parseAmbientOutput('{"items":[],"literal":"a } and { and \\\" brace"}').items.length, 0);
const lines = [{ text: "background noise", offset: 0 }, { text: "Actually cancel the seed swap idea. I do not have the bandwidth this month.", offset: 0, speaker: "wearer", is_user: true }];
assert.equal(validateAmbient({ items: [{ kind: "idea", quote: "cancel the seed swap idea", line: 21, status: "cancelled" }] }, lines)[0].evidence[0].quote, "Actually cancel the seed swap idea.", "wrong index remapped only by unique exact quote and subject retained");
{ const [dup] = validateAmbient({ items: [{ kind: "idea", quote: "cancel the seed swap idea", line: 21 }] }, [...lines, lines[1]]); assert.equal(dup.grounding.state, "approximate", "an ambiguous repeat the hint cannot settle is a guess"); assert.equal(dup.grounding.ambiguity.candidates, 2); assert.equal(dup.grounding.ambiguity.resolved_by, "earliest"); assert.equal(dup.evidence[0].line_ref, 1, "resolved deterministically to the earliest"); assert.equal(dup.needs_review, true); }
{ const [hinted] = validateAmbient({ items: [{ kind: "idea", quote: "cancel the seed swap idea", line: 2 }] }, [...lines, lines[1]]); assert.equal(hinted.grounding.state, "located"); assert.equal(hinted.evidence[0].line_ref, 2, "the model line hint settles a repeat"); assert.equal(hinted.grounding.ambiguity.resolved_by, "line_hint"); }
assert.equal(validateAmbient({ items: [{ kind: "idea", quote: "cancel our seed exchange", line: 1 }] }, lines)[0].grounding.state, "unlocated", "a paraphrase is kept but not located");
assert.equal(ambientContextQuote("We should try a seed swap. Or maybe not this month.", "We should try a seed swap"), "We should try a seed swap. Or maybe not this month.");
const tentative = validateAmbient({ items: [{ kind: "decision", quote: "Or maybe not this month", line: 0 }] }, [{ text: "We should try a seed swap. Or maybe not this month.", offset: 0, is_user: true }])[0];
assert.equal(tentative.kind, "idea"); assert.equal(tentative.uncertainty, "tentative"); assert.match(tentative.text, /seed swap/); assert.equal(tentative.needs_review, true);
assert.equal(validateAmbient({ items: [{ kind: "task", quote: "done with the books", line: 0, status: "completed" }] }, [{ text: "I am not done with the books.", offset: 0 }])[0].status, "open", "clipped completion cannot drop negation");
const previous = [{ id: "ambient:real-persistent-id", kind: "reminder", text: "Remind me tomorrow at nine in the morning to call Dr Rivera about the appointment.", owner: "wearer", source_at: 100 }];
const correctionLine = { text: "Change the call to Dr Rivera to tomorrow at ten, not nine.", speaker: "wearer", is_user: true, at: 200, offset: 0 };
const correction = { kind: "reminder", quote: correctionLine.text, line: 0, status: "open", due_text: "tomorrow at ten, not nine", relation: "correction", supersedes: ["ambient:8b0d4e5c1f0a9e2d3c4b5a6978e9f0a1b2c3d4e5f60718293a4b5c6d7e8f9a0b"] };
const invented = validateAmbient({ items: [correction] }, [correctionLine], previous)[0];
assert.equal(invented.relationship_unresolved, true); assert.equal(invented.needs_review, true); assert.deepEqual(invented.supersedes, [], "actual synthetic invented hash remains explicitly unresolved, not guessed");
const linked = validateAmbient({ items: [{ ...correction, supersedes: ["previous:0"] }] }, [correctionLine], previous)[0];
assert.deepEqual(linked.supersedes, [previous[0].id]); assert.equal(linked.relationship_unresolved, undefined);
{ const [hist] = validateAmbient({ items: [{ kind: "reminder", quote: previous[0].text, line: 0 }] }, [correctionLine], previous); assert.equal(hist.grounding.state, "unlocated", "historical-only copied output is never located evidence, even if previous contains the exact quote"); assert.equal(hist.kind, "reminder"); assert.equal(hist.status, "open"); assert.equal(hist.confidence, "unverified"); }
console.log("PASS actual ambient response envelope, strict JSON/ambiguity, explicit grounding remap and negation/qualifier context");
