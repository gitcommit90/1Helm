import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { Sentinel } from '../src/sentinel.js';
import { checkBase, byokChat } from '../src/byok.js';
import { HSTS, transportHeaders, httpsOrigin } from '../src/transport-security.js';

// Plaintext requests must never reach sign-in, database writes, or an email sender.
const forbidden = new Proxy({}, { get() { throw new Error('Unexpected backend access'); } });
for (const path of ['/health', '/onboard', '/auth/verify?token=synthetic', '/w/test/app']) {
  const r = await worker.route(new Request(`http://app.example.com${path}`), forbidden, {});
  assert.equal(r.status, 307);
  assert.equal(r.headers.get('location'), `https://app.example.com${path}`);
}
for (const path of ['/onboard/api/email', '/onboard/api/code', '/api/byok']) {
  const r = await worker.route(new Request(`http://app.example.com${path}`, { method: 'POST', body: '{}' }), forbidden, {});
  assert.equal(r.status, 426);
  assert.equal(r.headers.get('location'), null);
}
assert.equal(httpsOrigin('http://app.example.com/auth'), 'https://app.example.com');
const req = new Request('https://app.example.com/health');
const health = await worker.fetch(req, {}, {});
assert.equal(health.status, 200);
assert.equal(health.headers.get('strict-transport-security'), HSTS);
assert.deepEqual(await health.json(), { ok: true });
assert.doesNotMatch(HSTS, /includeSubDomains|preload/);
const stream = new Response('stream data', { headers: { 'content-type': 'text/event-stream' } });
assert.equal(await transportHeaders(req, stream).text(), 'stream data');
const upgrade = { status: 101, webSocket: {} };
assert.equal(transportHeaders(req, upgrade), upgrade, 'preserve WebSocket upgrade object');

// Every external HTTP request is rejected, including reads with innocently named
// user-data fields. No backend, secret lookup, approval or upstream access occurs.
const sentinel = new Sentinel({ props: {} }, forbidden);
const token = '1hs_' + 'a'.repeat(32);
const savedFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('Plaintext request reached the network'); };
try {
  for (const method of ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const url of [
      'http://example.com/',
      'http://example.com/private/synthetic-user-data',
      'http://example.com/?q=synthetic-private-note',
      'http://example.com:8080/?search=synthetic-private-note',
      'http://acct123.r2.cloudflarestorage.com/bucket/layer',
      'http://computer.internal.evil.example/manifest',
      'http://computer.internal./manifest',
    ]) {
      const r = await sentinel.fetch(new Request(url, { method, headers: { 'x-custom-data': 'synthetic-private-note' } }));
      assert.equal(r.status, 403, `${method} ${url}`);
      assert.equal(r.headers.get('x-1helm-sentinel'), 'blocked');
      assert.equal(r.headers.get('location'), null, 'no automatic plaintext redirect');
      assert.match(await r.text(), /HTTPS.*Nothing was sent/);
    }
  }
} finally { globalThis.fetch = savedFetch; }
for (let attempt = 0; attempt < 2; attempt++) {
  for (const [url, headers] of [
    [`http://example.com/?key=${token}`, {}],
    ['http://example.com/', { authorization: 'Bearer synthetic' }],
    ['http://example.com/', { cookie: 'session=synthetic' }],
    ['http://example.com/', { 'x-api-key': 'synthetic' }],
    ['http://example.com/', { 'x-custom-key': token }],
    ['http://example.com/?access_token=synthetic', {}],
  ]) assert.equal((await sentinel.fetch(new Request(url, { headers }))).status, 403);
  assert.equal((await sentinel.fetch(new Request('http://example.com/', { method: 'POST', body: 'password=synthetic' }))).status, 403);
}

// Preserve HTTPS reads and storage access, and the internal controller binding.
const upstream = [];
const C = { manifestText: async () => 'synthetic manifest', savePlan: async () => 'synthetic save plan', noteEgress: async () => ({ ok: true }) };
const env = {
  CHANNEL_COMPUTER: { idFromString: id => id, get: () => C },
  RESIDENT: { idFromName: id => id, get: () => ({ egressDecision() { throw new Error('Unexpected approval'); } }) },
  R2_ENDPOINT: 'https://acct123.r2.cloudflarestorage.com',
};
const secureSentinel = new Sentinel({ props: { id: 'test', tenant: 'test', channel: 'test' } }, env);
globalThis.fetch = async req => {
  assert.equal(new URL(req.url).protocol, 'https:');
  assert.equal(req.redirect, 'manual', 'upstream redirects must re-enter the transport check');
  upstream.push(req.url);
  if (new URL(req.url).pathname === '/downgrade') return new Response(null, { status: 302, headers: { location: 'http://example.com/?q=synthetic-private-note' } });
  return new Response('secure upstream');
};
try {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    assert.equal((await secureSentinel.fetch(new Request('https://example.com/read', { method }))).status, 200);
  }
  assert.equal(await (await secureSentinel.fetch(new Request('https://acct123.r2.cloudflarestorage.com/bucket/layer'))).text(), 'secure upstream');
  const beforeInternal = upstream.length;
  assert.equal(await (await secureSentinel.fetch(new Request('http://computer.internal/manifest'))).text(), 'synthetic manifest');
  assert.equal(await (await secureSentinel.fetch(new Request('http://computer.internal/save-plan?session=test'))).text(), 'synthetic save plan');
  assert.equal(upstream.length, beforeInternal, 'controller uses the binding, not network fetch');
  for (const url of ['https://example.com/downgrade', 'https://acct123.r2.cloudflarestorage.com/downgrade']) {
    const redirect = await secureSentinel.fetch(new Request(url));
    assert.equal(redirect.status, 302);
    const beforeFollow = upstream.length;
    assert.equal((await secureSentinel.fetch(new Request(redirect.headers.get('location')))).status, 403);
    assert.equal(upstream.length, beforeFollow, 'redirect cannot downgrade to plaintext');
  }
} finally { globalThis.fetch = savedFetch; }
for (const base of ['http://example.com/v1', 'http://127.0.0.1:11434/v1']) assert.match(checkBase(base).error, /HTTPS/);
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('HTTP endpoint must not be contacted'); };
try {
  await assert.rejects(byokChat({ base: 'http://example.com/v1', host: 'example.com', key: 'synthetic', model: 'm' }, { messages: [] }), /HTTPS/);
} finally { globalThis.fetch = originalFetch; }
console.log('Transport security: all external non-HTTPS requests blocked before lookup/approval/network; HTTPS, internal bindings, streams and HSTS preserved; redirect downgrade blocked.');
