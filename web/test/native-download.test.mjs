// Downloads in the phone apps (src/native-download.ts): which links are taken over, and that nothing changes outside a phone app.
import assert from 'node:assert/strict'; import { build } from 'esbuild'; import { readFileSync } from 'node:fs';
const out = await build({ entryPoints: ['src/native-download.ts'], bundle: true, format: 'esm', write: false });
const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const O = 'https://app.example.test', ID = '8ea1e297-9109-4441-bddb-e80c963633e3', P = `/w/ck1/api/res/main/files/${ID}`;
// which links
assert.deepEqual(M.classifyDownload(`${P}?dl=1&c=3`, O), { kind: 'file', channel: 'main', file: ID, name: '' });
assert.deepEqual(M.classifyDownload(`${O}${P}`, O, 'x.pptx'), { kind: 'file', channel: 'main', file: ID, name: 'x.pptx' });
assert.equal(M.classifyDownload(`${P}?dl=1&v=2`, O).kind, 'bytes', 'an older version is fetched, not linked by id');
assert.equal(M.classifyDownload(`${P}?kept=previous`, O).kind, 'bytes');
assert.equal(M.classifyDownload(`${P}?thumb=1`, O).kind, 'bytes');
assert.equal(M.classifyDownload('blob:https://app.example.test/abc', O, 'meeting-transcript.txt').kind, 'bytes');
assert.equal(M.classifyDownload('data:text/plain;base64,aGk=', O).kind, 'bytes');
assert.equal(M.classifyDownload('/w/ck1/api/bee/x/export?format=txt', O).kind, 'bytes');
assert.equal(M.classifyDownload('https://example.com/a.zip', O), null, 'another site is left alone');
assert.equal(M.classifyDownload('mailto:a@b.c', O), null); assert.equal(M.classifyDownload('http://[bad', O), null);
assert.equal(M.dispositionName(`attachment; filename*=UTF-8''my%20file.pdf`), 'my file.pdf'); assert.equal(M.dispositionName('attachment; filename="a b.txt"'), 'a b.txt'); assert.equal(M.dispositionName(null), '');
// where it runs
const cap = (platform, browser = true, native = true) => ({ Capacitor: { isNativePlatform: () => native, getPlatform: () => platform, Plugins: browser ? { Browser: { open: () => {} } } : {} } });
assert.equal(M.nativeDownloadsAvailable(cap('ios')), true); assert.equal(M.nativeDownloadsAvailable(cap('android')), true);
assert.equal(M.nativeDownloadsAvailable(cap('web', true, false)), false, 'a normal browser');
assert.equal(M.nativeDownloadsAvailable(cap('ios', false)), false, 'a phone app without the Browser plugin keeps the old behavior');
assert.equal(M.nativeDownloadsAvailable({}), false); assert.equal(M.nativeDownloadsAvailable({ Capacitor: { isNativePlatform: () => { throw new Error('x'); } } }), false);
assert.equal(M.initNativeDownloads('/w/ck1/api', () => {}, { location: { origin: O } }, {}), false, 'nothing is installed in a normal browser');
// the flow, with a fake page
const listeners = [], opened = [], notes = [], calls = [];
const A = function () {}; const origClick = () => 'native click'; A.prototype = { click: origClick };
const win = { location: { origin: O }, HTMLAnchorElement: A, Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: { Browser: { open: (o) => { opened.push(o.url); } } } } };
const doc = { addEventListener: (t, f, c) => listeners.push({ t, f, c }) };
globalThis.fetch = async (u, init = {}) => {
  calls.push({ u, init });
  if (String(u).endsWith('/download-link')) return new Response(JSON.stringify({ url: 'https://app.example.test/s/ck1/d/TOKEN/x.pptx' }), { status: 200 });
  if (String(u).endsWith('/download-link/blob')) return new Response(JSON.stringify({ url: 'https://app.example.test/s/ck1/d/BLOB/t.txt' }), { status: 200 });
  if (String(u).startsWith('blob:')) return new Response('hello', { headers: { 'content-type': 'text/plain' } });
  return new Response('{"error":"nope"}', { status: 500 });
};
assert.equal(M.initNativeDownloads('/w/ck1/api', (t, b) => notes.push([t, b]), win, doc), true);
assert.equal(listeners.length, 1); assert.equal(listeners[0].t, 'click'); assert.equal(listeners[0].c, true, 'listens before the page\'s own handlers');
const tick = () => new Promise((r) => setTimeout(r, 30));
const mkEvent = (a) => { const e = { target: { closest: (s) => (s === 'a[download]' ? a : null) }, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } }; return e; };
// a tap on a Library file link
const link = { href: `${O}${P}?dl=1`, getAttribute: (k) => (k === 'download' ? '' : null) };
let e = mkEvent(link); listeners[0].f(e); await tick();
assert.ok(e.prevented && e.stopped); assert.deepEqual(opened, ['https://app.example.test/s/ck1/d/TOKEN/x.pptx']);
assert.equal(calls[0].u, '/w/ck1/api/download-link'); assert.equal(calls[0].init.method, 'POST'); assert.equal(JSON.parse(calls[0].init.body).file, ID); assert.equal(JSON.parse(calls[0].init.body).channel, 'main');
// a click on something that is not a download link is not touched
e = mkEvent(null); listeners[0].f(e); assert.ok(!e.prevented);
e = mkEvent({ href: 'https://example.com/a.zip', getAttribute: () => '' }); listeners[0].f(e); assert.ok(!e.prevented, 'another site');
// a blob from the page's own code (.click() on a link that is not in the page)
await new Promise((r) => setTimeout(r, 700));
const blobLink = Object.assign(Object.create(A.prototype), { href: 'blob:https://app.example.test/abc', hasAttribute: (k) => k === 'download', getAttribute: () => 'meeting-transcript.txt' });
assert.equal(blobLink.click(), undefined); await tick();
assert.equal(opened.at(-1), 'https://app.example.test/s/ck1/d/BLOB/t.txt');
const up = calls.find((c) => c.u === '/w/ck1/api/download-link/blob'); assert.equal(up.init.headers['x-file-name'], 'meeting-transcript.txt'); assert.equal(up.init.headers['content-type'].startsWith('text/plain'), true);
// an ordinary link without a download attribute, or another site's, still clicks as before
const plain = Object.assign(Object.create(A.prototype), { href: `${O}/x`, hasAttribute: () => false, getAttribute: () => null });
assert.equal(plain.click(), 'native click');
const foreign = Object.assign(Object.create(A.prototype), { href: 'https://example.com/a.zip', hasAttribute: () => true, getAttribute: () => '' });
assert.equal(foreign.click(), 'native click');
// a failure says so and opens nothing
await new Promise((r) => setTimeout(r, 700)); const before = opened.length;
globalThis.fetch = async () => new Response('{"error":"Too many downloads this hour. Try again later."}', { status: 429 });
e = mkEvent(link); listeners[0].f(e); await tick();
assert.equal(opened.length, before); assert.deepEqual(notes.at(-1), ['Couldn\'t download', 'Too many downloads this hour. Try again later.']);
// wired into the page
const v3 = readFileSync('src/v3.ts', 'utf8'); assert.match(v3, /if \(LIVE\) initNativeDownloads\(LIVE\.api,/);
console.log('PASS native-download');
