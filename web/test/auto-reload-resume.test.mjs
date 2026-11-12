// node test/auto-reload-resume.test.mjs: an open or resumed app learns about a new build right away, and reloads once it is safe.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const handlers = {}, docHandlers = {}; let hidden = false, reloads = 0, calls = [], appV = '276';
const store = new Map();
globalThis.sessionStorage = {getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v)};
globalThis.location = {reload: () => { reloads++; }};
globalThis.addEventListener = (e, f) => { (handlers[e] ||= []).push(f); };
globalThis.document = {get hidden() { return hidden; }, addEventListener: (e, f) => { (docHandlers[e] ||= []).push(f); }, querySelectorAll: () => [], querySelector: () => null};
globalThis.window = globalThis;
globalThis.fetch = async (url) => { calls.push(String(url)); return {headers: {get: h => h === 'x-app-v' ? appV : null}}; };
const {outputFiles} = await build({entryPoints: [new URL('../src/auto-reload.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'error'});
const A = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].contents).toString('base64'));
A.installAutoReload({api: '/w/x/api', loaded: '276', busy: () => false});
const fire = (e, d = docHandlers) => (d[e] || []).forEach(f => f());
const wait = ms => new Promise(z => setTimeout(z, ms));
// Same build: resuming asks once and does not reload.
hidden = true; fire('visibilitychange'); hidden = false; fire('visibilitychange'); await wait(20);
assert.deepEqual(calls, ['/w/x/api/permissions'], 'coming back to the app makes one API call'); assert.equal(reloads, 0);
// A new build is deployed while the app sat in the background: the next resume finds it and reloads without any other action.
appV = '277'; await wait(2100); hidden = true; fire('visibilitychange'); hidden = false; fire('pageshow', handlers); await wait(40);
assert.equal(calls.length, 2); await wait(20);
fire('focus', handlers); await wait(20);
// Not idle for 5 s yet (a tap just happened): it waits, then reloads on its own timer.
for (const f of handlers.pointerdown || []) f();
await wait(3200); assert.equal(reloads, 0, 'never reloads while the person is using the app');
await wait(4000); assert.equal(reloads, 1, 'reloads once after 5 quiet seconds'); assert.equal(store.get('1h-reload-v'), '277');
console.log('PASS auto reload: resuming the app checks the build at once and reloads once, when it is safe'); process.exit(0);
