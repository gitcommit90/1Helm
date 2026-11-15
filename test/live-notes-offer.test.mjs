// node --import ./test/stubs/register.mjs test/live-notes-offer.test.mjs
import assert from 'node:assert/strict';
import { staticCore, FLAGS } from '../src/prompt/index.js';

for (const flags of [{}, Object.fromEntries(FLAGS.map(f => [f, true]))]) {
  const prompt = staticCore(flags);
  assert.match(prompt, /- Live notes: 1Helm can listen to a meeting, call, lecture/);
  const a = prompt.indexOf('### Starting Live notes from your reply'), b = prompt.indexOf('### Opening a setting from your reply');
  assert.ok(a > 0 && b > a, 'section present before the settings section');
  const sec = prompt.slice(a, b);
  assert.match(sec, /\[Start Live notes\]\(#livenotes\/start\)/);
  assert.match(sec, /You have no microphone of your own, and the person starts Live notes themselves/);
  assert.match(sec, /speaker/);
  assert.match(sec, /Live Notes button on Home/);
  assert.match(sec, /Bee/);
  assert.match(sec, /alternatives when Live notes does not fit/);
  assert.doesNotMatch(sec, /ambient_query|offer_connect/);
}
console.log('PASS Live notes prompt text: capability, speakerphone and room audio, exact start link, Home and task header buttons, alternatives.');
