// node --import ./test/stubs/register.mjs test/skipper-channels-doc.test.mjs
// The 1helm doc must not tell the helper that channels share one mind or that nothing else does work.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const md = readFileSync(new URL('../src/docs/1helm.md', import.meta.url), 'utf8');
const section = md.slice(md.indexOf('## One helper, channels, and tasks'), md.indexOf('## Your computers'));

assert.ok(section.length > 100, 'channels section found');
assert.doesNotMatch(section, /same you/i, 'channels text no longer says "same you"');
assert.doesNotMatch(section, /same name, personality, and relationship everywhere/i);
assert.match(section, /background helpers/i, 'mentions background helpers');
assert.match(section, /workers/i, 'mentions workers');
assert.match(section, /its own memory/i, 'channels keep separate memory');
assert.match(section, /Inspect other channels/, 'General exception is described');
assert.match(section, /no shared or group chats/i, 'still says there are no group chats');
console.log('PASS skipper-channels-doc');
