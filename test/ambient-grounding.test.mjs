// node --import ./test/stubs/register.mjs test/ambient-grounding.test.mjs
// Tolerant evidence location, clean item text, unlocated items and the pipeline around them.
import { SEED } from "./helpers/seed-settings.mjs";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { retainReview } from "./ambient-review-stub.mjs";
import { AmbientStore, validateAmbient } from "../src/ee/ambient.js";
import { locateEvidence, foldText, findPhrase } from "../src/ee/ambient-ground.js";
import { ambientReviewInput } from "../src/ee/ambient-review.js";
import { lines, cases, previous, legacyKept, T as FT } from "./fixtures/ambient-asr-noise.mjs";

// 1. The fixture: every noisy item is kept, and located wherever the speech is really there.
const results = new Map();
for (const c of cases) {
  const out = validateAmbient({ items: [c.raw] }, lines, previous);
  assert.equal(out.length, 1, `${c.id}: never dropped`);
  assert.equal(out[0].grounding.state, c.expect, `${c.id}: grounding state`);
  results.set(c.id, out[0]);
}
const legacy = cases.filter((c) => legacyKept(c.raw, lines)).length, kept = [...results.values()].length;
const counts = { located: 0, approximate: 0, unlocated: 0 }; for (const r of results.values()) counts[r.grounding.state]++;
assert.equal(kept, cases.length);
assert.ok(legacy < cases.length / 2, "the old exact-text gate drops most noisy items");
console.log(`FIXTURE kept/dropped: old gate kept ${legacy} of ${cases.length}, dropped ${cases.length - legacy}; new kept ${kept} of ${cases.length} (located ${counts.located}, approximate ${counts.approximate}, unlocated ${counts.unlocated}), dropped 0`);

// 2. Clean text is the item; evidence is copied from the transcript by code, not from the model.
const typo = results.get("typo-the-model-fixed");
assert.equal(typo.text, "Pick up Sarah's prescription tomorrow around 5", "item text is the model's clean statement");
assert.equal(typo.evidence[0].quote, "Remind me to pick up Sarah's prescripshun tomorrow around five", "evidence keeps the real ASR words, typo included");
assert.equal(typo.evidence[0].utterance_id, "u1"); assert.equal(typo.evidence[0].speaker, "wearer"); assert.equal(typo.evidence[0].at, FT + 5000); assert.equal(typo.evidence[0].offset, 0);
assert.equal(typo.due_text, "tomorrow around five", "due text is copied from the source words");
assert.equal(typo.kind, "reminder"); assert.equal(typo.notification_status, "not_scheduled");
assert.equal(results.get("case-and-punctuation").evidence[0].quote, lines[0].text);
assert.equal(results.get("case-and-punctuation").grounding.method, "normalized");
assert.ok(results.get("case-and-punctuation").search_text.includes("Call the landlord"), "clean text is indexed");

// 3. A thought split across two lines records every utterance.
const split = results.get("thought-split-across-lines");
assert.deepEqual(split.evidence.map((e) => e.utterance_id), ["u2", "u3"]); assert.deepEqual(split.evidence.map((e) => e.line_ref), [2, 3]);
assert.equal(split._line_ref, "line:2");
assert.equal(split.attribution.is_user, true);
// ...but never across different speakers.
const mixed = lines.map((l, i) => i === 3 ? { ...l, speaker: "Bob", is_user: false } : l);
assert.notEqual(validateAmbient({ items: [cases.find((c) => c.id === "thought-split-across-lines").raw] }, mixed)[0].grounding.state, "located", "speech does not join across speakers");

// 4. Repeated phrases are resolved deterministically and the ambiguity is recorded.
const hinted = results.get("repeat-settled-by-line-hint");
assert.equal(hinted.evidence[0].line_ref, 9); assert.equal(hinted.grounding.ambiguity.resolved_by, "line_hint"); assert.equal(hinted.grounding.ambiguity.candidates, 2);
const guessed = results.get("repeat-with-wrong-hint");
assert.equal(guessed.evidence[0].line_ref, 7, "wrong hint falls back to the earliest repeat"); assert.equal(guessed.grounding.ambiguity.resolved_by, "earliest"); assert.equal(guessed.needs_review, true); assert.ok(guessed.grounding.confidence <= 0.6);
assert.deepEqual(validateAmbient({ items: [cases.find((c) => c.id === "repeat-with-wrong-hint").raw] }, lines)[0].evidence, guessed.evidence, "deterministic");

// 5. A hallucinated item is kept but is not a confirmed commitment.
const ghost = results.get("fully-hallucinated");
assert.equal(ghost.kind, "task", "the claimed kind is kept"); assert.equal(ghost.unverified ?? ghost.grounding.unverified, true); assert.equal(ghost.confidence, "unverified"); assert.equal(ghost.needs_review, true);
assert.deepEqual(ghost.evidence, []); assert.equal(ghost.owner, "unknown"); assert.equal(ghost.attribution.is_user, false);
assert.equal(ghost.grounding.unverified_quote, "Book a flight to Lisbon for the conference"); assert.match(ghost.grounding.note, /No matching speech/);
assert.equal(ghost.grounding.window.from_at, FT);
// An unlocated idea or fact stays what it was; only commitments are downgraded.
assert.equal(validateAmbient({ items: [{ kind: "fact", speech_act: "memory", text: "Her sister lives in Oslo", quote: "my sister lives in Oslo", line: 0 }] }, lines)[0].kind, "fact");

// 6. Status and links need support in located source words; an unlocated item cannot change anything.
const lied = results.get("completion-in-unlocated-speech");
assert.equal(lied.status, "open"); assert.deepEqual(lied.supersedes, []); assert.equal(lied.relation, null); assert.equal(lied.relationship_unresolved, true); assert.equal(lied.grounding.claimed.status, "completed");
const done = results.get("completion-in-located-speech");
assert.equal(done.status, "completed"); assert.deepEqual(done.supersedes, ["ambient:invoice"]); assert.equal(done.relation, "completion");
assert.equal(results.get("exact-control-two").status, "cancelled"); assert.deepEqual(results.get("exact-control-two").supersedes, ["ambient:dentist"]);
// Completion wording must come from the source span, not only from the model's text.
const noSupport = validateAmbient({ items: [{ kind: "task", speech_act: "intention", text: "Sent the invoice to Dana", quote: "The meeting is about the quarterly numbers", line: 8, status: "completed", relation: "completion", supersedes: ["previous:0"] }] }, lines, previous)[0];
assert.equal(noSupport.status, "open", "a completion the located words do not support is not applied"); assert.deepEqual(noSupport.supersedes, []);
// Negation in the source blocks completion even when the model's clean text drops it.
const negated = validateAmbient({ items: [{ kind: "task", speech_act: "intention", text: "Finished the invoice for Dana", quote: "I haven't sent the invoice to Dana", line: 0, status: "completed", relation: "completion", supersedes: [] }] }, [{ text: "I havent sent the invoice to Dana yet", speaker: "wearer", is_user: true, offset: 0, at: FT }], previous)[0];
assert.equal(negated.status, "open", "ASR without the apostrophe still counts as negation");
// Unlocated items never link, and never become link targets for a later item.
const unlocatedTarget = validateAmbient({ items: [cases.find((c) => c.id === "fully-hallucinated").raw, { kind: "task", speech_act: "intention", text: "Call the landlord", quote: "i gotta call the landlord", line: 0, status: "open", relation: "repeat", supersedes: ["line:8"] }] }, lines);
assert.deepEqual(unlocatedTarget.find((x) => x.grounding.state !== "unlocated").supersedes, [], "line refs to an unlocated item are not honored");

// 7. Matching helpers.
assert.equal(foldText("Don’t FORGET, the  café!"), "dont forget the cafe");
assert.equal(locateEvidence("buy", lines, 7).state, "located"); // one exact word is still exact
assert.equal(locateEvidence("oat mlk", lines).state, "unlocated", "short quotes get no fuzziness");
assert.equal(locateEvidence("", lines).state, "unlocated");
assert.deepEqual(findPhrase("Hey, Pixie remember this", "hey pixie"), { start: 0, end: 10, fuzzy: false });
assert.equal(findPhrase("hey pixee do it", "Hey Pixie", { fuzzy: true }).fuzzy, true);
assert.equal(findPhrase("hey pixee do it", "Hey Pixie"), null);
// An item with no model text falls back to its source words (older extractor output).
assert.equal(validateAmbient({ items: [{ kind: "task", speech_act: "intention", quote: "buy oat milk", line: 7 }] }, lines)[0].text, "buy oat milk");
// Items that are not usable at all are counted, not silently lost.
const odd = validateAmbient({ items: [{ kind: "task", text: "ok", quote: "buy oat milk", line: 7, speech_act: "intention" }, { kind: "bogus", text: "x", quote: "y" }, { kind: "task", speech_act: "example", text: "Remind me", quote: "remind me" }] }, lines);
assert.equal(odd.stats.malformed, 1); assert.equal(odd.stats.filtered_nonpersonal, 1); assert.equal(odd.stats.located, 1);
assert.throws(() => validateAmbient({ items: [{ kind: "bogus", quote: "buy oat milk" }] }, lines), /grounded/, "a response with only unusable items is a model failure, retried");

// 8. The review stage sees the real source span and the clean meaning, and skips unlocated items.
const reviewed = validateAmbient({ items: [cases.find((c) => c.id === "typo-the-model-fixed").raw, cases.find((c) => c.id === "fully-hallucinated").raw] }, lines);
const input = ambientReviewInput(reviewed, lines);
assert.equal(input.candidates.length, 1); assert.equal(input.candidates[0].quote, "Remind me to pick up Sarah's prescripshun tomorrow around five"); assert.equal(input.candidates[0].meaning, "Pick up Sarah's prescription tomorrow around 5");

// 9. Pipeline: unlocated items are published and counted; the retry is bounded; old items still read.
const db = new DatabaseSync(":memory:"), kv = new Map([["tenant", "test"], ["status", "active"]]);
db.exec("CREATE TABLE convs(id INTEGER PRIMARY KEY,start_time INTEGER,r2_key TEXT)");
const sql = { exec(q, ...args) { if (!args.length && q.split(";").filter((s) => s.trim()).length > 1) { db.exec(q); return { toArray: () => [] }; } const s = db.prepare(q); const rows = /^\s*(SELECT|PRAGMA|WITH)/i.test(q) ? s.all(...args) : (s.run(...args), []); return { toArray: () => rows }; } };
const host = { sql, ctx: { storage: { transactionSync(fn) { db.exec("BEGIN"); try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } } } }, gen: 0,
  env: { MODEL_SETTINGS: SEED, MODEL_SETTINGS_REVISION: 1, OPENROUTER_API_KEY: "test", DB: { prepare() { return { bind() { return { first: async () => ({ status: "active", plan: "plus" }) }; } }; } },
    RESIDENT: { idFromName: (x) => x, get() { return { ambientPrivacy: async (texts) => ({ mode: "on", allowed: texts.map((_, i) => i) }) }; } }, WS: { get: async () => null } },
  get: (k) => kv.get(k), put: (k, v) => v == null ? kv.delete(k) : kv.set(k, String(v)), tid: () => kv.get("tenant"), arm: async () => {}, bump() {}, ledger: () => ({ reserve: async () => ({ ok: true }), settle: async () => {} }) };
const store = new AmbientStore(host); store.review = retainReview;
const T = Date.UTC(2026, 9, 11);
const conv = (id, texts) => ({ id, start_time: T - 864e5, end_time: T + 1000, updated_at: 1, transcriptions: [{ realtime: false, utterances: texts.map((text, i) => ({ id: `u${id}-${i}`, text, speaker: { name: "Ana", id: "s1", is_user: true }, spoken_at: T + i * 1000 })) }] });
let extractCalls = 0, response;
store.extract = async () => { extractCalls++; return response; };
// 9a. Partial grounding miss: the located item and the unlocated one are both kept, no retry.
response = { items: [{ kind: "task", speech_act: "intention", text: "Call the landlord about the leak", quote: "I gotta call the landlord about the leak.", line: 0, status: "open", due_text: "", relation: null, supersedes: [] }, { kind: "task", speech_act: "intention", text: "Book a flight to Lisbon", quote: "book a flight to lisbon", line: 1, status: "open", due_text: "", relation: null, supersedes: [] }] };
await store.ingest("bee", 1, conv(1, ["i gotta call the landlord about the leak", "the weather is nice"])); await store.run();
let q = store.query({ source_id: "1" });
assert.equal(extractCalls, 1); assert.equal(q.items.length, 2); assert.equal(q.coverage.failed, 0);
assert.deepEqual(q.items.map((x) => x.grounding.state).sort(), ["located", "unlocated"]);
assert.deepEqual({ l: q.coverage.grounding.located, a: q.coverage.grounding.approximate, u: q.coverage.grounding.unlocated }, { l: 1, a: 0, u: 1 }, "grounding counts are surfaced in coverage");
assert.equal(q.items.find((x) => x.grounding.state === "unlocated").kind, "task");
assert.ok(!("search_text" in q.items[0]), "internal index text is not returned");
assert.equal(store.query({ source_id: "1", query: "landlord" }).items.length, 1, "keyword search covers clean text");
assert.equal(store.query({ source_id: "1", query: "gotta" }).items.length, 1, "and the real transcript words");
// 9b. Nothing locates: one bounded retry, then the items are kept as unlocated.
response = { items: [{ kind: "task", speech_act: "intention", text: "Renew the passport", quote: "renew my passport before the trip", line: 0, status: "open", due_text: "", relation: null, supersedes: [] }] };
extractCalls = 0;
await store.ingest("bee", 2, conv(2, ["completely different speech about gardening"])); await store.run();
q = store.query({ source_id: "2" });
assert.equal(extractCalls, 1); assert.equal(q.items.length, 0); assert.equal(q.coverage.failed, 1, "first miss fails the attempt so it can retry once");
assert.equal(db.prepare("SELECT recovery_mode m FROM ambient_chunks WHERE source_id='2'").get().m, 1);
store.sql.exec("UPDATE ambient_chunks SET retry_at=0 WHERE source_id='2'");
response = { items: [] }; // the retry finds nothing, but the first attempt's item must not be lost
await store.run();
q = store.query({ source_id: "2" });
assert.equal(extractCalls, 2); assert.equal(q.coverage.failed, 0, "no endless retry"); assert.equal(q.items.length, 1); assert.equal(q.items[0].grounding.state, "unlocated"); assert.equal(q.items[0].text, "Renew the passport");
assert.equal(q.coverage.processing_complete, true);
// 9c. Old stored items (text is the raw quote, no grounding field) still read correctly.
const legacyItem = { id: `ambient:${"a".repeat(64)}`, kind: "task", text: "I need to return the library books", status: "open", owner: "Ana", due_at: null, due_text: null, confidence: "captured", needs_review: false, evidence: [{ quote: "I need to return the library books", speaker: "Ana", at: T, utterance_id: "old", offset: 0 }], supersedes: [], relation: null };
const hash = db.prepare("SELECT hash FROM ambient_chunks WHERE source_id='1'").get().hash;
db.prepare("INSERT INTO ambient_items VALUES(?,?,?,?,?,?)").run(legacyItem.id, "bee", "1", hash, T, JSON.stringify(legacyItem));
q = store.query({ source_id: "1", query: "library" });
assert.equal(q.items.length, 1); assert.equal(q.items[0].text, "I need to return the library books"); assert.equal(q.items[0].grounding.state, "legacy_quote");
assert.equal(store.query({ source_id: "1" }).coverage.grounding.chunks_without_counts, 0);
// 9d. Re-extracting the same speech with different clean wording keeps the same item id (links stay valid).
response = { items: [{ kind: "task", speech_act: "intention", text: "Phone the landlord about the leak", quote: "i gotta call the landlord about the leak", line: 0, status: "open", due_text: "", relation: null, supersedes: [] }] };
const idBefore = store.query({ source_id: "1", kind: "task" }).items.find((x) => /landlord/.test(x.text)).id;
store.retrySource("bee", "1"); await store.run();
assert.equal(store.query({ source_id: "1", kind: "task" }).items.find((x) => /landlord/.test(x.text)).id, idBefore, "item id comes from the source position, not the model's wording");
console.log("PASS ambient grounding: tolerant location, clean text, unlocated items kept, safety rules, bounded retry, coverage counts, legacy items");
