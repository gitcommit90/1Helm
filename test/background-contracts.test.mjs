// node --import ./test/stubs/register.mjs test/background-contracts.test.mjs
// Offline boundary tests. No provider calls; real job, billing and state paths where applicable.
import assert from "node:assert/strict";
const J = JSON.stringify;
import { AMBIENT_EXTRACT_SCHEMA, AMBIENT_REVIEW_SCHEMA, NOTE_PATCH_SCHEMA, FINAL_NOTES_SCHEMA } from "../src/background-schemas.js";
import { structuredFormat, parseStructuredResponse } from "../src/structured-output.js";
import { LiveNotes, finalNotesSection, keepHuman, renderSection } from "../src/ee/live-notes.js";
import { AmbientStore } from "../src/ee/ambient.js";

const envelope = (data, finish = "stop") => ({ choices: [{ finish_reason: finish, message: { content: JSON.stringify(data) } }], usage: { cost: 0.0004 } });
const emptyFinal = { attendees: [], summary: [], topics: [], decisions: [], actions: [], questions: [], notes: [] };
const valid = [
  [AMBIENT_EXTRACT_SCHEMA, { items: [] }], [AMBIENT_REVIEW_SCHEMA, { items: [] }],
  [NOTE_PATCH_SCHEMA, { ops: [] }], [FINAL_NOTES_SCHEMA, emptyFinal],
];
for (const [schema, data] of valid) {
  assert.equal(structuredFormat("test", schema).json_schema.strict, true);
  assert.deepEqual(parseStructuredResponse(envelope(data), schema), data);
  assert.throws(() => parseStructuredResponse(envelope({ ...data, surprise: true }), schema), /unexpected field/);
  const missing = { ...data }; delete missing[Object.keys(missing)[0]];
  assert.throws(() => parseStructuredResponse(envelope(missing), schema), /missing/);
  for (const finish of ["length", "content_filter", "tool_calls", undefined]) {
    const r = envelope(data); r.choices[0].finish_reason = finish;
    assert.throws(() => parseStructuredResponse(r, schema), /incomplete/);
  }
  const refused = envelope(data); refused.choices[0].message.refusal = "No";
  assert.throws(() => parseStructuredResponse(refused, schema), /refused/);
}
assert.throws(() => parseStructuredResponse(envelope({ ops: [{ op: "delete_all", text: "x" }] }), NOTE_PATCH_SCHEMA));
assert.throws(() => parseStructuredResponse(envelope({ items: [{ id: "candidate:0", verdict: "sure", reason: "direct_personal_intent", context: ["current:0"] }] }), AMBIENT_REVIEW_SCHEMA));
console.log("PASS all four contracts: empty results, missing/extra fields, refusal and incomplete answers");

{
  const a = Object.create(AmbientStore.prototype); let attempts = 0;
  a.modelAttempt = async request => {
    attempts++; assert.equal(request.response_format.type, "json_schema"); assert.equal(request.response_format.json_schema.strict, true);
    return envelope(attempts === 1 ? { items: [], unexpected: true } : { items: [] });
  };
  assert.deepEqual(await a.modelRequest([], null, "ambient-extract", []), { items: [] }); assert.equal(attempts, 2);
  attempts = 0; a.modelAttempt = async () => { attempts++; return envelope({ items: [] }, "length"); };
  await assert.rejects(a.modelRequest([], null, "ambient-review", []), /incomplete/); assert.equal(attempts, 2);
  const input = { context: [{ id: "current:0", text: "Call school" }], candidates: [{ id: "candidate:0", line: "current:0", quote: "Call school" }] };
  const messages = [{ role: "user", content: J(input) }];
  attempts = 0; a.modelAttempt = async () => { attempts++; return envelope({ items: [] }); };
  await assert.rejects(a.modelRequest(messages, null, "ambient-review", []), /every candidate/); assert.equal(attempts, 2);
  attempts = 0; a.modelAttempt = async () => { attempts++; return envelope({ items: [{ id: "candidate:0", verdict: "retain", reason: "direct_personal_intent", context: ["foreign"] }] }); };
  await assert.rejects(a.modelRequest(messages, null, "ambient-review", []), /references/); assert.equal(attempts, 2);
  console.log("PASS ambient contract retry is bounded and requires a complete response");
}

{
  const p = finalNotesSection({ ...emptyFinal, summary: ["Ship on Friday."], actions: [{ text: "Send deck", owner: "Ana", due: "Thursday" }] }, "## Session 1 · Today");
  const human = [{ sec: "actions", line: "- [x] PERSON: Keep **this** exactly" }, { sec: "x:My notes", line: "A personal addition." }];
  keepHuman(p, human); const md = renderSection(p);
  assert.match(md, /- \[ \] Send deck — owner: Ana, due: Thursday/);
  for (const h of human) assert.ok(md.includes(h.line));
  assert.match(md, /### My notes\nA personal addition\./);
  assert.throws(() => finalNotesSection({ ...emptyFinal, actions: [{ text: "x", owner: false, due: "" }] }, "heading"));
  console.log("PASS structured final sections render deterministically and preserve exact human lines/custom sections");
}

{
  const ln = Object.create(LiveNotes.prototype), state = { n: 1, cost_nano: 0, model_nano: 0, tokens: 0, note_upto: 0, started_at: 1000 };
  let calls = 0, edits = 0, reserves = 0, settlements = 0;
  ln.s = () => ({ ...state }); ln.setS = (_n, patch) => Object.assign(state, patch);
  ln.ledger = () => ({ reserve: async () => { reserves++; return { ok: true }; }, settle: async (_id, n) => { settlements++; assert.equal(n, 123); } });
  ln.model = async () => { calls++; return { text: J({ ops: [] }), finish: "length", nano: 123, tokens: 7 }; };
  ln.sql = { exec: () => ({ toArray: () => [{ rid: 1, at: 1000, text: "Ship Friday", speaker: "Ana" }] }) };
  ln.readDoc = async () => ({ text: "## Session 1 · Today\n\n### Summary\nExisting valid summary.\n" });
  ln.ev = async () => {}; ln.editDoc = async () => { edits++; throw new Error("must not edit"); };
  await ln.notePass(1);
  assert.equal(calls, 2); assert.equal(reserves, 2); assert.equal(settlements, 2);
  assert.equal(state.cost_nano, 246); assert.equal(state.tokens, 14); assert.equal(state.note_upto, 0); assert.equal(edits, 0);
  console.log("PASS invalid live patches are billed per attempt, retry twice, leave text and transcript cursor unchanged");
}

