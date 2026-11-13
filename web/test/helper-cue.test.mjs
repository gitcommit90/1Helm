// node web/test/helper-cue.test.mjs: a running helper is visible in its own task, in the task list and on its channel, and the cue clears when it finishes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {build} from 'esbuild';
const load = async (entry, platform = 'neutral') => { const r = await build({entryPoints: [entry], bundle: true, write: false, format: 'esm', platform, logLevel: 'error', loader: {'.json': 'json'}}); return import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].contents).toString('base64')); };
const {helperRunning, channelHelperRunning} = await load(new URL('../src/helper-cue.ts', import.meta.url).pathname);
// The cue shows while the server counts a running helper, even though the Primary turn ended (state is not "working").
const ended = {done: false, state: 'idle', srv: {state: 'ready', helpers: 1}};
assert.equal(helperRunning(ended), true, 'turn ended, helper running: cue shows');
assert.equal(helperRunning({...ended, srv: {state: 'ready', helpers: 0}}), false, 'helper finished: cue clears');
assert.equal(helperRunning({...ended, done: true}), false, 'a task the person checked off never shows it');
assert.equal(helperRunning({done: false}), false, 'no server data (mock or not loaded): no cue');
// Another task or channel: the channel shows it when any of its tasks has a running helper.
assert.equal(channelHelperRunning([{srv: {helpers: 0}}, ended]), true);
assert.equal(channelHelperRunning([{srv: {helpers: 0}}, {srv: {}}]), false);
// v3.ts wiring: the task's state, the rail and the phone channel list read the same rule; the unread dot rule is unchanged.
const v3 = fs.readFileSync(new URL('../src/v3.ts', import.meta.url), 'utf8');
assert.match(v3, /const astate = \(x: Session\) => x\.state === "working" \|\| \(x\.status !== "waiting" && helperRunning\(x\)\) \? "working"/);
assert.match(v3, /const chWorking = .*channelHelperRunning\(c\.sessions\)/);
assert.match(v3, /const rowLit = \(x: Session\) => !x\.done && !!x\.unread;/, 'only an unseen reply lights the unread dot');
assert.equal((v3.match(/class="wpip"/g) || []).length, 2, 'rail tile and phone channel row both render the mark');
assert.equal((v3.match(/paintChannelDots\(document, chDotKind, chWorking, chActive\)/g) || []).length, 2, 'every repaint repaints the mark');
const css = fs.readFileSync(new URL('../src/v3.css', import.meta.url), 'utf8');
assert.match(css, /\.wpip\{position:absolute;bottom:3px;/, 'the mark sits at the lower corner, the unread dot at the upper one');
assert.match(css, /prefers-reduced-motion:reduce\)\{\.wpip\{animation:none/);
// Channel marks are added and cleared in place, never doubled.
{
  class El {constructor(c, a = {}) {this.className = c; this.attrs = a; this.children = []; this.parent = null; this.title = ''; this.dataset = {}; for (const [k, v] of Object.entries(a)) if (k.startsWith('data-')) this.dataset[k.slice(5)] = v;}
    get firstChild() {return this.children[0] ?? null;} get ownerDocument() {return {createElement: () => new El('')};}
    appendChild(c) {c.parent = this; this.children.push(c); return c;} insertBefore(c) {c.parent = this; this.children.unshift(c); return c;}
    remove() {this.parent.children = this.parent.children.filter(x => x !== this);} getAttribute(k) {return this.attrs[k] ?? null;} get classList(){const e=this;return{toggle:(c,on)=>{const s=new Set(e.className.split(' ').filter(Boolean));on?s.add(c):s.delete(c);e.className=[...s].join(' ');}}} has(c) {return this.className.split(' ').includes(c);}
    querySelector(s) {return this.querySelectorAll(s)[0] ?? null;}
    querySelectorAll(sel) {const out = [], m = (c, s) => s === '.tile' ? c.has('tile') : s === '.chtile' ? c.has('chtile') : s === '.pip' ? c.has('pip') : s === '.wpip' ? c.has('wpip') : s === ':scope > .udot' ? c.has('udot') && c.parent === this : s === '#rail .chs .ch[data-ch]' ? c.has('ch') && 'data-ch' in c.attrs : s === '#chlist a.chr[data-mch]' ? c.has('chr') : false;
      const walk = e => {for (const c of e.children) {if (m(c, sel)) out.push(c); walk(c);}}; walk(this); return out;}}
  const {paintChannelDots} = await load(new URL('../src/channel-dots.ts', import.meta.url).pathname, 'browser');
  const rail = new El('chs'), list = new El('chlist'), root = new El('root'); root.appendChild(rail); root.appendChild(list);
  const mk = slug => {const b = new El('ch', {'data-ch': slug}); b.appendChild(new El('tile')); rail.appendChild(b); const r = new El('chr', {href: '#/' + slug, 'data-mch': ''}); r.appendChild(new El('chtile')); list.appendChild(r); return [b, r];};
  const [a, ra] = mk('one'), [b, rb] = mk('two'); const n = (e, c) => e.querySelectorAll('.' + c).length;
  let on = {one: true, two: false};
  paintChannelDots(root, () => null, s => on[s]);
  assert.equal(n(a, 'wpip'), 1); assert.equal(n(ra, 'wpip'), 1); assert.equal(n(b, 'wpip'), 0); assert.equal(n(rb, 'wpip'), 0);
  paintChannelDots(root, () => null, s => on[s]); assert.equal(n(a, 'wpip'), 1, 'repaint never doubles the mark');
  assert.equal(n(a, 'pip'), 0, 'working is not the unread dot');
  on = {one: false, two: true}; paintChannelDots(root, () => 'New reply', s => on[s]);
  assert.equal(n(a, 'wpip'), 0, 'clears when the helper finishes'); assert.equal(n(ra, 'wpip'), 0); assert.equal(n(b, 'wpip'), 1); assert.equal(n(b, 'pip'), 1, 'both marks can show together');
  paintChannelDots(root, () => null); assert.equal(n(b, 'wpip'), 0, 'callers with no working rule keep the old behavior');
}
// The open task: the row keeps showing the helper after the reply, even when the helper belongs to an older turn, and stays quiet otherwise.
globalThis.window = {addEventListener() {}, matchMedia: () => ({matches: false, addEventListener() {}})};
globalThis.document = {addEventListener() {}, querySelectorAll: () => [], getElementById: () => null, querySelector: () => null, documentElement: {}, body: {classList: {contains: () => false}}};
globalThis.matchMedia = window.matchMedia; globalThis.HTMLElement = class {}; globalThis.innerWidth = 800; globalThis.addEventListener = () => {};
globalThis.MutationObserver = class {observe() {} disconnect() {}}; globalThis.IntersectionObserver = globalThis.ResizeObserver = globalThis.MutationObserver;
globalThis.customElements = {define() {}, get() {}}; globalThis.localStorage = {getItem: () => null, setItem() {}};
const T = await load(new URL('../src/tracker.ts', import.meta.url).pathname);
T.tkInit({current: () => '', repaint() {}, api: async () => ({}), working: () => false, phone: () => false, helper: () => 'Skipper', plain: s => s});
const row = primary => T.tkProgress('s', '1', 'Skipper', primary);
const card = (id, opened, status) => ({id, kind: 'chat', status, title: id, opened, closed: status === 'complete' ? opened + 1 : null});
T.tkEvent('s', '1', {t: 'card_open', card: card('turn1', 100, 'complete')});
assert.equal(row(''), '<div class="turn-progress" role="status"></div>', 'idle: nothing in the row');
T.tkEvent('s', '1', {t: 'helper', helper: {id: 1, name: 'Compare fares', status: 'running', started: 1, parent_card: 'turn1'}});
assert.match(row(''), /Compare fares[\s\S]*Subagent working/, 'reply finished, helper running: row shows it');
// A later turn replied and finished; the older helper still runs: it still shows when the Primary is idle.
T.tkEvent('s', '1', {t: 'card_open', card: card('turn2', 200, 'complete')});
assert.match(row(''), /Compare fares/, 'older turn helper still visible when nothing else works');
assert.equal((row('').match(/<activity-orb|tp-orb/g) || []).length >= 1, true);
assert.equal((row('').match(/class="tp-orb"/g) || []).length, 1, 'one orb');
// While the Primary works on the newer turn, the row is the Primary's, not the older helper's.
assert.doesNotMatch(row('Working'), /Compare fares/); assert.match(row('Working'), /<b>Skipper<\/b>/);
// A finished helper clears the row; one waiting on the person is not pulled in from an older turn.
T.tkEvent('s', '1', {t: 'helper', helper: {id: 1, name: 'Compare fares', status: 'done', started: 1, parent_card: 'turn1'}});
assert.equal(row(''), '<div class="turn-progress" role="status"></div>', 'finished: cue clears');
T.tkEvent('s', '1', {t: 'helper', helper: {id: 2, name: 'Old review', status: 'awaiting_review', started: 1, parent_card: 'turn1'}});
assert.equal(row(''), '<div class="turn-progress" role="status"></div>');
console.log('PASS helper cue: open task row, task state, channel mark, clears when the helper finishes');
process.exit(0);
