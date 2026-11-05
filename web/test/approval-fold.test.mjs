// Settled permission cards older than 15 minutes fold to one line (web/src/approval-card.ts apFoldInfo). Renderer-only test, no browser, network or models.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
// The card module pulls in browser-only helpers (logo loading), so give it a minimal window and document.
globalThis.window = globalThis; globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
globalThis.document = { addEventListener() {} }; globalThis.HTMLImageElement = class {};
const out = await build({ entryPoints: [new URL('../src/approval-card.ts', import.meta.url).pathname], bundle: true, format: 'esm', write: false });
const { apFoldInfo, approvalHtml, AP_FOLD_MS } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const NOW = Date.now(), MIN = 60000;
const o = (extra = {}) => ({ helper: 'Ollie', channel: 'general', attr: k => 'data-choice="' + k + '"', id: 'ap-1', fold: { now: NOW, ...extra } });
const ssh = (extra = {}) => ({ id: 1, at: NOW, host: '', perm: 'ssh', action: { lines: [['Server', 'root@100.81.5.21:22'], ['Server fingerprint', 'SHA256:abc']], note: 'n' }, ...extra });
const site = { id: 3, at: NOW, host: 'api.example.com' }, perm = { id: 4, at: NOW, host: '', perm: 'email', name: 'read your email', ask: 'OK to read your email?' };
const v = (status, ageMin, extra = {}) => ({ status, settledAt: NOW - ageMin * MIN, ...extra });
assert.equal(AP_FOLD_MS, 15 * MIN);
// settled and older than 15 minutes: folds
for (const [a, st] of [[ssh(), 'once'], [ssh(), 'deny'], [ssh(), 'cancelled'], [ssh(), 'expired'], [site, 'once'], [site, 'deny'], [perm, 'deny']]) assert.ok(apFoldInfo(a, v(st, 30), o()), `${a.perm || 'site'} ${st} old folds`);
// newer than 15 minutes, or no fold option: never folds
assert.equal(apFoldInfo(ssh(), v('once', 5), o()), null);
assert.equal(apFoldInfo(ssh(), v('once', 30), { ...o(), fold: undefined }), null);
// still waiting, failed, in progress, busy or with an unreplaced host key check: never folds
for (const st of ['pending', 'consumed', 'failed', 'host_key_required']) assert.equal(apFoldInfo(ssh(), v(st, 30), o()), null, st);
assert.equal(apFoldInfo(site, v('pending', 30), o()), null);
for (const p of ['connecting', 'resuming', 'running', 'failed']) assert.equal(apFoldInfo(ssh({ native_progress: p }), v('once', 30), o()), null, p);
assert.equal(apFoldInfo(ssh(), v('once', 30, { busy: 'once' }), o()), null);
// a replaced host key check folds, and a changed key warning never does
assert.ok(apFoldInfo(ssh({ perm: 'ssh_hostkey' }), v('host_key_required', 30), o({ superseded: true })));
assert.equal(apFoldInfo(ssh({ perm: 'ssh_hostkey', action: { lines: [['Server', 'h'], ['Previous fingerprint', 'SHA256:old']] } }), v('once', 30), o()), null);
// the drawn card holds the one line and the full card
const html = approvalHtml(site, v('once', 30), o());
assert.match(html, /data-apfoldbtn/); assert.match(html, /gu-apfold-full/);
assert.doesNotMatch(approvalHtml(site, v('once', 5), o()), /data-apfoldbtn/);
console.log('approval-fold OK');
