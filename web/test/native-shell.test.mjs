// The phone apps' sign-in helpers (src/native-shell.ts): which platform, and how an outside sign-in page is opened and the sheet closed.
import assert from 'node:assert/strict'; import { build } from 'esbuild';
const out = await build({ entryPoints: ['src/native-shell.ts'], bundle: true, format: 'esm', write: false });
const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const cap = (platform, Browser, native = true) => ({ Capacitor: { isNativePlatform: () => native, getPlatform: () => platform, Plugins: Browser ? { Browser } : {} }, location: { assign(u) { this.last = u; } } });
assert.equal(M.nativePlatform({}), '', 'a browser');
assert.equal(M.nativePlatform(cap('web', null, false)), '');
assert.equal(M.nativePlatform(cap('android')), 'android'); assert.equal(M.nativePlatform(cap('ios')), 'ios');
assert.equal(M.nativePlatform(cap('electron')), '', 'the Mac app keeps the normal return address');
// Android: the web view hands an outside address to the phone browser itself, so the page just goes there.
let w = cap('android', { open() { throw new Error('not used'); } }); M.openOutside('https://c.test/x', w); assert.equal(w.location.last, 'https://c.test/x');
// iOS: a script navigation to an outside page opens nothing, so the Safari sheet (Capacitor Browser) is used; without the plugin it falls back.
let opened = null, closed = 0; w = cap('ios', { open: (o) => { opened = o.url; }, close: () => { closed++; return Promise.resolve(); } });
M.openOutside('https://c.test/y', w); assert.equal(opened, 'https://c.test/y'); assert.equal(w.location.last, undefined);
M.closeOutside(w); assert.equal(closed, 1); M.closeOutside(cap('android', { close() { closed++; } })); assert.equal(closed, 1, 'no sheet on Android');
w = cap('ios', null); M.openOutside('https://c.test/z', w); assert.equal(w.location.last, 'https://c.test/z');
w = { location: { assign(u) { this.last = u; } } }; M.openOutside('https://c.test/b', w); assert.equal(w.location.last, 'https://c.test/b'); M.closeOutside(w);
console.log('ok native-shell');
