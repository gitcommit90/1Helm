import assert from 'node:assert/strict';
import { build } from 'esbuild';
const code = (await build({entryPoints:['src/browser-card.ts'],bundle:true,write:false,format:'esm'})).outputFiles[0].text;
const { settleBrowserCards } = await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const using = () => ({ t:'browser', url:'https://x.com' }), handoff = () => ({ t:'browser', url:'https://x.com', text:'sign in' }), other = { t:'plan' };
const task = (o) => ({ streaming:false, state:'idle', srv:{ state:'idle' }, messages:[{ cards:[using(), other] }, { cards:[handoff()] }], ...o });
const left = (s) => s.messages.flatMap(m => m.cards || []).map(c => c.t + (c.text ? ':h' : ''));
// normal finish, error, timeout, cancel, lease expiry, resume ending: the task is idle, the card goes
let s = task(); assert.equal(settleBrowserCards(s), true); assert.deepEqual(left(s), ['plan']);
// a missed end event: still flagged streaming locally, then reconcile/attach clears streaming and the next paint removes it
s = task({ streaming:true, state:'working' }); assert.equal(settleBrowserCards(s), false); assert.deepEqual(left(s), ['browser','plan','browser:h']);
s.streaming = false; s.state = 'idle'; s.srv = { state:'idle' }; assert.equal(settleBrowserCards(s), true); assert.deepEqual(left(s), ['plan']);
// still running on the server (another tab drives it): cards stay
s = task({ srv:{ state:'working' } }); assert.equal(settleBrowserCards(s), false);
// waiting on the person in the browser: the hand-off card stays, the "using" card goes
s = task({ srv:{ state:'waiting', waiting:'browser' } }); settleBrowserCards(s); assert.deepEqual(left(s), ['plan','browser:h']);
// nothing to remove
s = task({ messages:[{ cards:[other] }, {}] }); assert.equal(settleBrowserCards(s), false);
console.log('PASS browser card settles on every end path');
