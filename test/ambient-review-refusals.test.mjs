import assert from 'node:assert/strict';
import { AMBIENT_REVIEW_SYSTEM, assertAmbientReview } from '../src/ee/ambient-review.js';

// The refused answer shapes seen on dev (release 62): the candidate is line current:17, and each context line carries both an id and an utterance_id.
const context = [...Array.from({ length: 4 }, (_, i) => `before:${i}`), ...Array.from({ length: 43 }, (_, i) => `current:${i}`), ...Array.from({ length: 4 }, (_, i) => `after:${i}`)]
  .map(id => ({ id, utterance_id: id === 'current:17' ? '910011-731' : `910011-${id}`, text: 'x' }));
const input = { context, candidates: [{ id: 'candidate:0', line: 'current:17', quote: 'Still need to return those library books.', meaning: 'Return the library books.' }] };
const answer = (reason, ctx, verdict = 'retain') => ({ items: [{ id: 'candidate:0', verdict, reason, context: ctx }] });

// An utterance id is not a context id: still refused, and the reason names the id field.
assert.throws(() => assertAmbientReview(answer('explicit_personal_update', ['910011-731']), input), /references.*"id" values.*not 910011-731/);
assert.throws(() => assertAmbientReview(answer('explicit_personal_update', ['910011-376', '910011-377']), input), /references.*"id" values/);
// Only the candidate's own line with independent_personal_need is still refused, and the reason points to direct_personal_intent.
assert.throws(() => assertAmbientReview(answer('independent_personal_need', ['current:17']), input), /direct_personal_intent/);
// Context that leaves out the candidate's own line, a reason of another verdict and a repeated id stay refused.
assert.throws(() => assertAmbientReview(answer('direct_personal_intent', ['current:16']), input), /own line current:17/);
assert.throws(() => assertAmbientReview(answer('background_media', ['current:17']), input), /does not belong to verdict retain/);
assert.throws(() => assertAmbientReview(answer('direct_personal_intent', ['current:17', 'current:17']), input), /must not repeat/);
// Accepted: real lines by id, and the intent reason on the line alone.
assertAmbientReview(answer('direct_personal_intent', ['current:17']), input);
assertAmbientReview(answer('independent_personal_need', ['before:16'.replace('16', '3'), 'current:17']), input);
// The prompt tells the model which id to cite and when each retain reason applies.
assert.match(AMBIENT_REVIEW_SYSTEM, /never by their utterance_id/);
assert.match(AMBIENT_REVIEW_SYSTEM, /still needs to do, is direct_personal_intent, even when it says "need"/);
console.log('ambient-review-refusals ok');
