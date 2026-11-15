// Voice memos as the model reads them (src/voice-memo.js, attachmentNote in src/resident.js).
// Run: bash scripts/test.sh test/voice-memo-note.test.mjs
import assert from "node:assert/strict";
import { voiceMemoNum, orderVoiceMemos, voiceMemoNote } from "../src/voice-memo.js";
import { attachmentNote } from "../src/resident.js";
const f = (name, id = name) => ({ id, name, mime: name.endsWith(".wav") ? "audio/wav" : "application/pdf", bytes: 1000 });
assert.equal(voiceMemoNum("Voice memo 3.wav"), 3);
assert.equal(voiceMemoNum("Voice memo 12.wav"), 12);
assert.equal(voiceMemoNum("Voice memo 2 (2).wav"), 2, "a duplicate-name suffix still reads as memo 2");
assert.equal(voiceMemoNum("My voice memo 3.wav"), null);
assert.equal(voiceMemoNum("Voice memo.wav"), null);
// order: memos sorted by number, other files keep their places
const mixed = [f("Voice memo 3.wav"), f("plan.pdf"), f("Voice memo 1.wav"), f("Voice memo 2.wav"), f("notes.txt")];
assert.deepEqual(orderVoiceMemos(mixed).map((x) => x.name), ["Voice memo 1.wav", "plan.pdf", "Voice memo 2.wav", "Voice memo 3.wav", "notes.txt"]);
assert.deepEqual(orderVoiceMemos([f("a.pdf"), f("b.pdf")]).map((x) => x.name), ["a.pdf", "b.pdf"]);
assert.deepEqual(orderVoiceMemos([f("Voice memo 10.wav"), f("Voice memo 9.wav")]).map((x) => x.name), ["Voice memo 9.wav", "Voice memo 10.wav"], "numeric, not alphabetical");
assert.equal(voiceMemoNote([f("a.pdf")]), "");
// the note
const sc = { got: [], saved: "", body: "" };
const note = (att) => attachmentNote({ att, pics: [], sc, unseen: [], extra: 0 });
assert.doesNotMatch(note([f("a.pdf")]), /voice memo/i);
const two = note([f("Voice memo 2.wav"), f("Voice memo 1.wav")]);
assert.match(two, /spoken message/);
assert.ok(two.indexOf('"Voice memo 1.wav", "Voice memo 2.wav"') > 0, "listed in numeric order");
assert.match(two, /one after the other as one message/);
const one = note([f("Voice memo 1.wav")]);
assert.match(one, /"Voice memo 1.wav" is a voice memo/);
console.log("ok - voice memo note orders and labels memos");
