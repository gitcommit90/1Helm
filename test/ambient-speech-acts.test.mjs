// Tests enforcement of supplied labels, NOT model classification quality.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { speechActCases, speechActConversation } from './fixtures/ambient-speech-acts.mjs';
const { ambientLines, validateAmbient } = await import(process.env.AMBIENT_MODULE ? pathToFileURL(process.env.AMBIENT_MODULE) : '../src/ee/ambient.js');
const lines = ambientLines(speechActConversation());
const item = (i, extra = {}) => ({ kind: 'reminder', line: i, quote: lines[i].text, speech_act: speechActCases[i].act, status: 'open', ...extra });
for (let i = 0; i < lines.length; i++) {
  const c = speechActCases[i]; if (!c.act) continue;
  const result = validateAmbient({ items: [item(i)] }, lines);
  if (['example', 'quotation'].includes(c.act)) assert.deepEqual(result, [], `${c.id}: grounded nonpersonal speech is not a personal record`);
  else {
    assert.equal(result.length, 1, `${c.id}: do not keyword-filter real intentions`);
    assert.equal(result[0].evidence[0].quote, lines[i].text);
    if (c.act !== 'uncertain') assert.equal(result[0].notification_status, 'not_scheduled');
    else { assert.equal(result[0].kind, 'idea'); assert.equal(result[0].needs_review, true); assert.equal(result[0].notification_status, undefined); }
    if (c.act === 'tentative_intention') { assert.equal(result[0].needs_review, true); assert.equal(result[0].uncertainty, 'tentative'); }
    if (c.guest) { assert.equal(result[0].owner, 'Morgan'); assert.equal(result[0].attribution.is_user, false); }
  }
}
const mixed = validateAmbient({ items: [item(0), item(4), item(5), item(6)] }, lines);
assert.equal(mixed.length, 2, 'real requests alongside examples survive independently');
assert.ok(mixed.some(x => /hiking boots/.test(x.text)));
const prior = [{ id: 'previous-task', text: 'Send the violet folder to Ellis', owner: 'wearer', kind: 'task', source_at: 1 }];
const unsure = { text: 'I already sent the violet folder to Ellis.', speaker: 'wearer', is_user: true, at: 1000, offset: 0 };
const [review] = validateAmbient({ items: [{ kind: 'reminder', line: 0, quote: unsure.text, speech_act: 'uncertain', status: 'completed', relation: 'completion', supersedes: ['previous:0'] }] }, [unsure], prior);
assert.equal(review.kind, 'idea'); assert.equal(review.status, 'open'); assert.equal(review.needs_review, true);
assert.equal(review.uncertainty, 'speech_act_uncertain'); assert.equal(review.relation, null); assert.deepEqual(review.supersedes, []);
assert.equal(review.notification_status, undefined, 'uncertain speech cannot become a captured reminder');
assert.equal(validateAmbient({ items: [item(6), item(6, { kind: 'idea' })] }, lines).length, 1, 'one occurrence is not duplicated across task categories');
assert.deepEqual(validateAmbient({ items: [item(2)] }, lines.map(x => ({ ...x, intentional_capture: true }))), [], 'capture cue never overrides a demonstration label');
assert.equal(validateAmbient({ items: [item(0, { quote: 'An invented demonstration that was never spoken.' })] }, lines).length, 0, 'a nonpersonal label never yields a record, even for invented evidence');
console.log('PASS synthetic speech-act label enforcement, real mixed directives, conditional and tentative intentions, trailing cue context, uncertainty isolation, attribution and cross-kind duplicate prevention; model classification still requires live evaluation');
