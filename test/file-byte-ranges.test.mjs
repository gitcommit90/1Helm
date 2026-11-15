// Stored file bytes answer byte ranges, so a video or audio file can be scrubbed on desktop Chrome.
// node --import ./test/stubs/register.mjs test/file-byte-ranges.test.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { serveStoredBytes, parseByteRange, servedHeaders } from '../src/files.js';

const bytes = new Uint8Array(1000).map((_, i) => i % 251), v2 = new Uint8Array(500).fill(7);
const store = new Map([['k/cur', { b: bytes, etag: '"e1"' }], ['k/cur.v2', { b: v2, etag: '"e2"' }]]);
const gets = [];
const WS = {
  async head(k) { const o = store.get(k); return o ? { size: o.b.length, httpEtag: o.etag } : null; },
  async get(k, opt = {}) {
    gets.push([k, opt]); const o = store.get(k); if (!o) return null;
    if (opt.onlyIf?.etagDoesNotMatch && opt.onlyIf.etagDoesNotMatch === o.etag.replace(/"/g, '')) return { size: o.b.length, httpEtag: o.etag };
    const r = opt.range, part = r ? o.b.slice(r.offset, r.offset + r.length) : o.b;
    return { size: o.b.length, httpEtag: o.etag, body: new Response(part).body };
  },
};
const env = { WS }, hd = servedHeaders('video/mp4', 'clip.mp4');
const ask = async (key, headers = {}) => serveStoredBytes(new Request('https://x.test/f', { headers }), env, key, hd);
const body = async (r) => new Uint8Array(await r.arrayBuffer());

// no Range: whole file, 200, advertises ranges
let r = await ask('k/cur');
assert.equal(r.status, 200); assert.equal(r.headers.get('accept-ranges'), 'bytes'); assert.equal(r.headers.get('content-length'), '1000'); assert.equal(r.headers.get('etag'), '"e1"');
assert.equal(r.headers.get('content-type'), 'video/mp4'); assert.equal((await body(r)).length, 1000);

// bytes=0-99
r = await ask('k/cur', { range: 'bytes=0-99' });
assert.equal(r.status, 206); assert.equal(r.headers.get('content-range'), 'bytes 0-99/1000'); assert.equal(r.headers.get('content-length'), '100'); assert.equal(r.headers.get('accept-ranges'), 'bytes');
assert.deepEqual([...await body(r)], [...bytes.slice(0, 100)]);
assert.deepEqual(gets.at(-1)[1].range, { offset: 0, length: 100 }, 'only that part is read from storage');

// open-ended, end past the file, suffix
r = await ask('k/cur', { range: 'bytes=900-' });
assert.equal(r.status, 206); assert.equal(r.headers.get('content-range'), 'bytes 900-999/1000'); assert.equal((await body(r)).length, 100);
r = await ask('k/cur', { range: 'bytes=990-5000' });
assert.equal(r.headers.get('content-range'), 'bytes 990-999/1000');
r = await ask('k/cur', { range: 'bytes=-200' });
assert.equal(r.status, 206); assert.equal(r.headers.get('content-range'), 'bytes 800-999/1000'); assert.deepEqual([...await body(r)], [...bytes.slice(800)]);
r = await ask('k/cur', { range: 'bytes=-5000' });
assert.equal(r.headers.get('content-range'), 'bytes 0-999/1000', 'a suffix longer than the file is the whole file');

// out of range: 416
for (const rg of ['bytes=1000-', 'bytes=2000-3000', 'bytes=-0']) {
  r = await ask('k/cur', { range: rg });
  assert.equal(r.status, 416, rg); assert.equal(r.headers.get('content-range'), 'bytes */1000');
}

// multi-range and malformed ranges are ignored: full 200
for (const rg of ['bytes=0-10,20-30', 'bytes=5-2', 'items=0-5', 'bytes=-']) {
  r = await ask('k/cur', { range: rg });
  assert.equal(r.status, 200, rg); assert.equal((await body(r)).length, 1000);
}

// If-None-Match: 304, with and without Range
r = await ask('k/cur', { 'if-none-match': '"e1"' });
assert.equal(r.status, 304); assert.equal(r.headers.get('etag'), '"e1"'); assert.equal(r.headers.get('accept-ranges'), 'bytes');
r = await ask('k/cur', { 'if-none-match': 'W/"e1"', range: 'bytes=0-9' });
assert.equal(r.status, 304);
r = await ask('k/cur', { 'if-none-match': '"old"' });
assert.equal(r.status, 200);

// If-Range: matching ETag gives the part, a stale one gives the whole file
r = await ask('k/cur', { range: 'bytes=0-9', 'if-range': '"e1"' }); assert.equal(r.status, 206);
r = await ask('k/cur', { range: 'bytes=0-9', 'if-range': '"stale"' }); assert.equal(r.status, 200); assert.equal((await body(r)).length, 1000);

// a version's key serves that version's bytes, with ranges
r = await ask('k/cur.v2', { range: 'bytes=10-19' });
assert.equal(r.status, 206); assert.equal(r.headers.get('content-range'), 'bytes 10-19/500'); assert.deepEqual([...await body(r)], new Array(10).fill(7));

// a missing object gives null (the route answers 404)
assert.equal(await ask('k/none'), null); assert.equal(await ask('k/none', { range: 'bytes=0-1' }), null);

// parseByteRange edge cases
assert.deepEqual(parseByteRange('bytes=0-0', 1), { offset: 0, length: 1 });
assert.equal(parseByteRange('bytes=0-0', 0), 'unsatisfiable');
assert.equal(parseByteRange(null, 10), null);

// the app's file route uses the helper, and keeps ?v=, ?dl=1 and the row lookup before it
const src = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const route = src.slice(src.indexOf('if (fm[2] && !fm[3] && req.method === "GET")'), src.indexOf('// file-preview.js: a deck'));
assert.ok(/serveStoredBytes\(req, env, vkey, hd\)/.test(route) && /fileVersionKey/.test(route) && /searchParams\.get\("dl"\)/.test(route) && /R\.fileRow/.test(route), 'file route wiring');
console.log('ok file byte ranges: 200 with Accept-Ranges, 206, 416, 304, If-Range, versions');
