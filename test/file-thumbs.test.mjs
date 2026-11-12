// Tiles ask for a small WebP (GET /files/<id>?thumb=1&c=<version>) instead of the original photo.
// node --import ./test/stubs/register.mjs test/file-thumbs.test.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { serveThumb, THUMB_PX } from '../src/files.js';

const orig = new Uint8Array(3_000_000).fill(1), small = new Uint8Array(1200).fill(9), view = new Uint8Array(200_000).fill(2);
const gets = [], transforms = [];
const env = (extra = {}) => ({
  WS: { async get(k) { gets.push(k); const b = k.endsWith('.view.jpg') ? view : orig; return { body: new Response(b).body, size: b.length }; } },
  IMAGES: { input(body) { return { transform(o) { transforms.push(o); return { output: async (f) => ({ response: () => new Response(small, { headers: { 'content-type': f.format } }) }) }; } }; } },
  ...extra });
const row = (o = {}) => ({ id: 'f1', mime: 'image/jpeg', version: 3, r2key: 't/x/files/main/f1', view_key: null, ...o });
const rq = (h = {}) => new Request('https://x/files/f1?thumb=1', { headers: h });
// The Worker cache is not in node: a tiny stand-in
const store = new Map();
globalThis.caches = { default: { async match(r) { const v = store.get(r.url); return v ? new Response(v, { headers: { 'content-length': String(v.length) } }) : undefined; }, async put(r, res) { assert.match(res.headers.get('cache-control'), /^public/, 'the Worker cache only keeps shareable responses'); store.set(r.url, new Uint8Array(await res.arrayBuffer())); } } };

// 1. current version named: a small WebP that the browser may keep for a year (private: only this account's browser, never a shared cache)
let r = await serveThumb(rq(), env(), row(), '3');
assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/webp');
assert.equal(r.headers.get('cache-control'), 'private, max-age=31536000, immutable');
assert.ok((await r.arrayBuffer()).byteLength < 10_000, 'a tile is a few KB, not the 3 MB original');
assert.deepEqual(transforms[0], { width: THUMB_PX, height: THUMB_PX, fit: 'scale-down' });
assert.ok(r.headers.get('etag'));

// 2. second request: from the cache, the image is not decoded again
const before = transforms.length; gets.length = 0;
r = await serveThumb(rq(), env(), row(), '3'); assert.equal(r.status, 200); assert.equal(transforms.length, before); assert.equal(gets.length, 0, 'no R2 read either');

// 3. a stale or missing version only revalidates (the address does not change with the file, so a year of caching would show an old picture)
for (const c of [null, '2', 'x', '4']) { r = await serveThumb(rq(), env(), row(), c); assert.equal(r.headers.get('cache-control'), 'private, no-cache', `c=${c}`); }

// 4. If-None-Match gives 304 with no work
const et = r.headers.get('etag'); gets.length = 0;
r = await serveThumb(rq({ 'if-none-match': et }), env(), row(), '3'); assert.equal(r.status, 304); assert.equal(gets.length, 0);

// 5. a new version is a new cache entry
const t0 = transforms.length; r = await serveThumb(rq(), env(), row({ version: 4, r2key: 't/x/files/main/f1.v4' }), '4'); assert.equal(r.status, 200); assert.equal(transforms.length, t0 + 1);

// 6. the model's smaller copy is the source when the file has one
store.clear(); gets.length = 0; await serveThumb(rq(), env(), row({ view_key: 't/x/files/main/f1.view.jpg' }), '3'); assert.deepEqual(gets, ['t/x/files/main/f1.view.jpg']);

// 7. what can't be made gives null, so the route sends the original as before
assert.equal(await serveThumb(rq(), env(), row({ mime: 'image/svg+xml' }), '3'), null);
assert.equal(await serveThumb(rq(), env(), row({ mime: 'application/pdf' }), '3'), null);
store.clear(); assert.equal(await serveThumb(rq(), env({ IMAGES: undefined }), row(), '3'), null);
store.clear(); assert.equal(await serveThumb(rq(), env({ IMAGES: { input() { throw new Error('bad image'); } } }), row(), '3'), null);

// 8. the route calls it after its own checks (account, channel, file row) and only for the current version
const idx = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const i = idx.indexOf('serveThumb(req, env, row'), j = idx.indexOf('const row = await R.fileRow(fm[2])');
assert.ok(i > j && j > 0, 'the thumbnail is served after the file row is found in the channel');
assert.match(idx.slice(i - 260, i), /!kk && vq == null/, 'never for a kept or older version');
console.log('file-thumbs: ok');
