// node test/progress-turn.test.mjs: a turn's progress row shows only that turn's own helper, never an older turn's open helper.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
globalThis.window = {addEventListener() {}, matchMedia: () => ({matches: false, addEventListener() {}})};
globalThis.document = {addEventListener() {}, querySelectorAll: () => [], getElementById: () => null, querySelector: () => null, documentElement: {}, body: {classList: {contains: () => false}}};
globalThis.matchMedia = window.matchMedia;
globalThis.HTMLElement = class {};
globalThis.innerWidth = 800;
globalThis.addEventListener = () => {};
globalThis.MutationObserver = class { observe() {} disconnect() {} };
globalThis.IntersectionObserver = globalThis.ResizeObserver = globalThis.MutationObserver;
globalThis.customElements = {define() {}, get() {}};
globalThis.localStorage = {getItem: () => null, setItem() {}};
const {outputFiles} = await build({entryPoints: ['src/tracker.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'error', loader: {'.json': 'json'}});
const T = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].contents).toString('base64'));
T.tkInit({current: () => '', repaint() {}, api: async () => ({}), working: () => false, phone: () => false, helper: () => 'Skipper', plain: s => s});
const row = primary => T.tkProgress('s', '1', 'Skipper', primary);
const card = (id, opened, status) => ({id, kind: 'chat', status, title: id, opened, closed: status === 'complete' ? opened + 1 : null});
const helper = (id, name, status, parent_card) => ({t: 'helper', helper: {id, name, status, started: 1, parent_card}});
T.tkEvent('s', '1', {t: 'card_open', card: card('turn1', 100, 'complete')});
T.tkEvent('s', '1', helper(1, 'Fix events page design', 'awaiting_review', 'turn1'));
// Turn 1 just replied and its helper is open: the row shows it.
assert.match(row(''), /Fix events page design/); assert.match(row(''), /Ready for review/); assert.match(row(''), /data-tkhelper="1"/);
// Turn 2 starts: the older open helper must not take over the row.
T.tkEvent('s', '1', {t: 'card_open', card: card('turn2', 200, 'working')});
let r = row('Working');
assert.doesNotMatch(r, /Fix events page design|Ready for review|data-tkhelper/); assert.match(r, /<b>Skipper<\/b><span>Working<\/span>/);
assert.equal((r.match(/<span class="tp-orb">/g) || []).length, 1); assert.equal((r.match(/<b>/g) || []).length, 1);
assert.equal(row(''), '<div class="turn-progress" role="status"></div>');   // no own work and no primary line: the row stays empty, as before
// Turn 2 starts its own helper: that helper shows, the older one still does not.
T.tkEvent('s', '1', helper(2, 'Draft the summary', 'running', 'turn2'));
r = row(''); assert.match(r, /Draft the summary/); assert.match(r, /data-tkhelper="2"/); assert.doesNotMatch(r, /Fix events page design/);
// A helper whose result card is this turn's card also counts.
T.tkEvent('s', '1', {t: 'helper', helper: {id: 3, name: 'Review pass', status: 'waiting_input', started: 1, parent_card: 'turn1', result_card: 'turn2'}});
assert.equal(T.turnHelpers('s|1').map(h => h.id).sort().join(), '2,3');
// A paused worker's row names only what the person can do on screen: never "Needs your answer" with nothing to answer.
const waiting = (kind, q) => T.progressStatus({id: 9, name: 'w', status: 'waiting_input', started: 1, input_kind: kind}, q);
assert.equal(waiting('browser', false), 'Waiting on you in the browser');
assert.equal(waiting('purchase_wait', false), 'Waiting on you to approve in Link');
assert.equal(waiting('login', false), 'Subagent working'); assert.equal(waiting('purchase', true) === 'Needs your answer', true);
assert.equal(waiting(null, false), 'Subagent working'); assert.equal(waiting(null, true), 'Needs your answer');
console.log('PASS progress turn: the row shows only the current turn\'s helper; an older open helper stays out of it');
process.exit(0);
