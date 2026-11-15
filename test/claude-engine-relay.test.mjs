import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as N from '../src/ee/claude-engine/relay/native.mjs';
import { complete, checkUpstream, Admission } from '../src/ee/claude-engine/relay/complete.mjs';

// The model-call relay of the Claude engine (image/claude-engine/relay/, ported from the Nous Research Hermes plugin). A stand-in claude binary
// (test/fixtures/fake-claude.mjs) and a local fake upstream replace Anthropic: no model call and no login.
const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const P = N.PREFIX;
const TOOLS = [{ type: 'function', function: { name: 'web_search', description: 'Search the web', parameters: { type: 'object', properties: { q: { anyOf: [{ type: 'string' }, { type: 'null' }] } }, required: ['q'] } } }];

function sse(events) { return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''); }
const textAnswer = (text, extra = {}) => [
  { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } }, { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'SIG' } }, { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
  ...text.split(' ').map((w, i) => ({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: (i ? ' ' : '') + w } })), { type: 'content_block_stop', index: 1 },
  { type: 'message_delta', delta: { stop_reason: extra.stop_reason || 'end_turn' }, usage: { output_tokens: 7, cache_read_input_tokens: 3 } }, { type: 'message_stop' }];
const toolAnswer = (input = '{"q":"cats"}') => [
  { type: 'message_start', message: { id: 'msg_2', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, usage: { input_tokens: 20, output_tokens: 1 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: P + 'web_search', input: {} } },
  { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: input.slice(0, 4) } }, { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: input.slice(4) } }, { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } }, { type: 'message_stop' }];

let upHeaders = {};   // extra response headers the fake upstream sends
async function upstream(events, status = 200) {
  const seen = [];
  const server = http.createServer(async (req, res) => { const chunks = []; for await (const c of req) chunks.push(c); seen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString()) });
    if (status !== 200) { res.writeHead(status, { 'content-type': 'application/json', ...upHeaders }).end(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'request-id': 'req_test', ...upHeaders }); res.end(sse(events)); });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return { seen, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((ok) => server.close(ok)) };
}
async function run(body, { events = textAnswer('Hello there'), mode = 'ok', status = 200, ...opts } = {}) {
  const up = await upstream(events, status), rec = path.join(tmpdir(), `fake-claude-${Math.random().toString(36).slice(2)}.json`);
  const out = []; let error = null;
  try { for await (const it of complete({ body, claudeCommand: [process.execPath, FAKE], upstream: up.url, allowLoopback: true, env: { PATH: process.env.PATH, FAKE_CLAUDE_MODE: mode, FAKE_CLAUDE_RECORD: rec, ANTHROPIC_API_KEY: 'sk-should-be-removed' }, timeoutMs: 15e3, ...opts })) out.push(it); } catch (e) { error = e; }
  await up.close();
  let record = null; try { record = JSON.parse(await readFile(rec, 'utf8')); } catch {}
  return { out, error, up, record, final: out.find((x) => x.t === 'final')?.response, chunks: out.filter((x) => x.t === 'chunk').map((x) => x.chunk) };
}
const BODY = { model: 'sonnet', messages: [{ role: 'system', content: 'You are the helper.' }, { role: 'user', content: 'Hi' }], tools: TOOLS };

test('request: tools get the onehc prefix, nullable unions lose null, long names are shortened, system text is separate', () => {
  const { encoded, manifest, names } = N.requestBody(N.toKwargs({ ...BODY, tools: [...TOOLS, { type: 'function', function: { name: 'x'.repeat(60), parameters: { oneOf: [{ type: 'object' }] } } }] }));
  const b = JSON.parse(encoded);
  assert.equal(b.tools[0].name, P + 'web_search'); assert.deepEqual(b.tools[0].input_schema.properties.q, { type: 'string' });
  assert.ok(names['x'.repeat(60)].length <= 50 && b.tools[1].name === P + names['x'.repeat(60)]);
  assert.equal(b.tools[1].input_schema.type, 'object'); assert.ok(!('oneOf' in b.tools[1].input_schema));
  assert.equal(manifest[0].name, 'web_search'); assert.equal(manifest[0].inputSchema.required[0], 'q');
  assert.throws(() => N.requestBody(N.toKwargs({ ...BODY, tools: [TOOLS[0], TOOLS[0]] })), /unique/);
  assert.throws(() => N.toKwargs({ ...BODY, tool_choice: 'required' }), /tool_choice/);
  assert.throws(() => N.requestBody(N.toKwargs({ ...BODY, tools: [{ type: 'function', function: { name: 'a', strict: true } }] })), /Strict/);
});
test('request: reasoning, structured output, token limits and stop', () => {
  const rb = (extra, o) => JSON.parse(N.requestBody(N.toKwargs({ ...BODY, ...extra }, o)).encoded);
  assert.deepEqual(rb({}, { effort: 'high', model: 'claude-opus-4-8' }).output_config, { effort: 'high' }); assert.equal(rb({}, { effort: 'high', model: 'claude-opus-4-8' }).thinking.type, 'adaptive');
  assert.equal(rb({}, { effort: 'high', model: 'claude-haiku-4-5' }).thinking, undefined, 'haiku 4.5 has no adaptive thinking');
  assert.deepEqual(rb({ reasoning: { enabled: false } }, { model: 'claude-opus-4-8' }).thinking, { type: 'disabled' });
  assert.deepEqual(rb({ reasoning: { enabled: false } }, { model: 'sonnet' }).output_config, { effort: 'low' }, 'thinking cannot be disabled on sonnet 5.5, so the lowest effort stands in');
  const j = rb({ response_format: { type: 'json_schema', json_schema: { schema: { type: 'object', properties: { n: { type: 'integer', minimum: 1 } } } } } });
  assert.deepEqual(j.output_config.format.schema.properties.n, { type: 'integer' });
  const m = rb({ max_completion_tokens: 50, stop: 'END', temperature: 0.5 }); assert.equal(m.max_tokens, 50); assert.deepEqual(m.stop_sequences, ['END']); assert.ok(!('temperature' in m));
  assert.throws(() => rb({ max_tokens: 5, max_completion_tokens: 6 }), /only one/); assert.throws(() => rb({ temperature: 2 }), /between zero and one/);
  assert.equal(N.nativeModel('sonnet'), 'claude-sonnet-5-5[1m]'); assert.equal(N.nativeModel('haiku-4.5'), 'claude-haiku-4-5-20251001'); assert.equal(N.nativeModel('claude-unknown-9'), 'claude-unknown-9');
});
test('history: roles, tool calls and results, images, and a user message after tool results merge into frames', () => {
  const { names } = N.requestBody(N.toKwargs(BODY));
  const { system, frames } = N.prepareHistory([
    { role: 'system', content: 'S1' }, { role: 'developer', content: 'S2' },
    { role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }, { type: 'image_url', image_url: { url: 'https://x.test/a.png' } }] },
    { role: 'assistant', content: 'ok', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'web_search', arguments: '{"q":"a"}' } }, { id: 'c2', type: 'function', function: { name: 'unknown_tool', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: 'r1' }, { role: 'tool', tool_call_id: 'c2', content: 'r2', is_error: true }, { role: 'user', content: 'thanks' }], names);
  assert.equal(system, 'S1\n\nS2'); assert.deepEqual(frames.map((f) => f.type), ['user', 'assistant', 'user']);
  assert.equal(frames[0].message.content[1].source.media_type, 'image/png'); assert.match(frames[0].message.content[2].text, /Image not attached/);
  assert.deepEqual(frames[1].message.content.slice(1).map((b) => b.name), [P + 'web_search', 'unknown_tool'], 'a tool outside the offered inventory replays as named');
  assert.deepEqual(frames[2].message.content.map((b) => b.type), ['tool_result', 'tool_result', 'text']); assert.equal(frames[2].message.content[1].is_error, true);
  assert.throws(() => N.prepareHistory([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }]), /must end/);
  assert.throws(() => N.prepareHistory([{ role: 'user', content: 'a' }, { role: 'system', content: 'late' }]), /precede/);
});
test('history: the assistant carrier restores native blocks exactly, and an edited message does not', () => {
  const native = { id: 'msg_1', role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm', signature: 'SIG' }, { type: 'text', text: 'Hello' }], usage: { input_tokens: 1 } };
  const message = { role: 'assistant', content: 'Hello', tool_calls: null };
  const carrier = { type: N.CARRIER, version: 1, messages: [native], projection: N.projection(message) };
  const f = N.prepareHistory([{ role: 'user', content: 'Hi' }, { ...message, reasoning_details: [carrier] }, { role: 'user', content: 'again' }]).frames;
  assert.equal(f[1].message.content[0].signature, 'SIG'); assert.ok(!('usage' in f[1].message), 'local usage metadata is not sent');
  const edited = N.prepareHistory([{ role: 'user', content: 'Hi' }, { ...message, content: 'Hello (edited)', reasoning_details: [carrier] }, { role: 'user', content: 'again' }]).frames;
  assert.deepEqual(edited[1].message.content, [{ type: 'text', text: 'Hello (edited)' }], 'stale signed blocks are never attached to rewritten text');
  assert.throws(() => N.prepareHistory([{ role: 'user', content: 'Hi' }, { ...message, reasoning_details: [{ ...carrier, version: 2 }] }, { role: 'user', content: 'x' }]), /carrier version/);
});

test('admission transforms: tool results restored, date line and breakpoints kept stable, tool streaming asked for', () => {
  const queried = [{ type: 'tool_result', tool_use_id: 't1', content: 'result text' }];
  const sent = { messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }, { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'x', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'result text' }, { type: 'text', text: '<system-reminder>native added this</system-reminder>' }], cache_control: { type: 'ephemeral' } }] }], tools: [{ name: 'a' }] };
  const r = JSON.parse(N.restoreQueriedTurn(JSON.stringify(sent), queried));
  assert.equal(r.messages[2].content[0].content, 'result text', 'the host\'s own form is restored and native\'s trailing reminder is dropped');
  assert.deepEqual(r.messages[2].content[0].cache_control, { type: 'ephemeral' }, 'a native cache marker is kept');
  assert.throws(() => N.restoreQueriedTurn(JSON.stringify(sent), [{ type: 'tool_result', tool_use_id: 'other', content: 'x' }]), N.QueriedTurnMismatch);
  assert.equal(JSON.parse(N.streamToolInput(JSON.stringify(sent))).tools[0].eager_input_streaming, true);
  const dated = { messages: [{ role: 'system', content: 'env' }, { role: 'user', content: [{ type: 'text', text: 'hi' }] }, { role: 'system', content: "Today's date is 2026-11-03." }] };
  const s = JSON.parse(N.stableRequestContext(JSON.stringify(dated), [{ type: 'text', text: 'hi' }])); assert.equal(s.messages.length, 2); assert.equal(s.messages[0].content, "env\n\nToday's date is 2026-11-03.");
  const plainPayload = JSON.stringify({ messages: [{ role: 'user', content: 'x' }] }); assert.equal(N.stableRequestContext(plainPayload, []), plainPayload);
  assert.equal(N.pinMessageBreakpoint('not json', [{ type: 'text', text: 'a' }]), 'not json');
  const marked = JSON.parse(N.dropMessageBreakpoints(JSON.stringify({ messages: [{ role: 'user', content: [{ type: 'text', text: 'a', cache_control: { type: 'ephemeral' } }] }] }))); assert.ok(!('cache_control' in marked.messages[0].content[0]));
  // a first turn: native's reminder text before the host's frame is dropped
  const first = JSON.stringify({ messages: [{ role: 'user', content: [{ type: 'text', text: '<system-reminder>acct</system-reminder>' }, { type: 'text', text: 'hello', cache_control: { type: 'ephemeral' } }] }] });
  const p = JSON.parse(N.pinMessageBreakpoint(first, [{ type: 'text', text: 'hello' }])); assert.equal(p.messages[0].content.length, 1); assert.equal(p.messages[0].content[0].text, 'hello');
});
test('single admission: the first request is let in, every later one and any after cancel is refused', () => {
  const g = new N.Gate(); assert.equal(g.admit(), true); assert.equal(g.admit(), false); assert.equal(g.admit(), false); assert.equal(g.denied, 2);
  const c = new N.Gate(); c.cancelled = true; assert.equal(c.admit(), false);
  assert.doesNotThrow(() => checkUpstream('https://api.anthropic.com'));
  for (const bad of ['https://evil.example', 'http://api.anthropic.com', 'https://api.anthropic.com:8443', 'http://127.0.0.1:9', 'https://user:pw@api.anthropic.com', 'https://api.anthropic.com?x=1']) assert.throws(() => checkUpstream(bad), undefined, bad);
  assert.doesNotThrow(() => checkUpstream('http://127.0.0.1:9', true));
});

test('capture and translation: text, thinking, usage and finish reasons', () => {
  const cap = new N.Capture(); cap.feed(sse(textAnswer('Hello there'))); assert.equal(cap.complete, true);
  const gate = new N.Gate(); gate.admit();
  const out = N.assemble({ model: 'sonnet', names: {}, gate, capture: cap, requestId: 'req_1', status: 200, assistants: [], results: [{ type: 'result', subtype: 'success' }], stopped: true, emitted: 'Hello', nativeError: null, fast: true, exitCode: null });
  assert.equal(out.chunks[0].choices[0].delta.content, ' there', 'the part of the text not yet streamed is sent before the last chunk');
  const r = out.response; assert.equal(r.choices[0].finish_reason, 'stop'); assert.equal(r.choices[0].message.content, 'Hello there'); assert.equal(r.choices[0].message.reasoning_content, 'hmm');
  assert.deepEqual({ p: r.usage.prompt_tokens, c: r.usage.completion_tokens, t: r.usage.total_tokens, cached: r.usage.prompt_tokens_details.cached_tokens }, { p: 13, c: 7, t: 20, cached: 3 });
  assert.equal(r.usage.native_admission.request_id, 'req_1');
  assert.equal(r.choices[0].message.reasoning_details[0].messages[0].content[0].signature, 'SIG');
  for (const [stop, want] of [['max_tokens', 'length'], ['refusal', 'content_filter']]) {
    const c = new N.Capture(); c.feed(sse(textAnswer('x', { stop_reason: stop }))); const g = new N.Gate(); g.admit();
    assert.equal(N.assemble({ model: 'm', names: {}, gate: g, capture: c, status: 200, assistants: [], results: [{ subtype: 'success' }], stopped: true, emitted: 'x', nativeError: null, fast: true }).response.choices[0].finish_reason, want);
  }
});
test('capture and translation: tool_use becomes tool_calls under the host\'s own names; a cut-off call is dropped and finish is length', () => {
  const cap = new N.Capture(); cap.feed(sse(toolAnswer())); const g = new N.Gate(); g.admit();
  const r = N.assemble({ model: 'm', names: { web_search: 'web_search' }, gate: g, capture: cap, status: 200, assistants: [], results: [{ subtype: 'error_max_turns' }], stopped: true, emitted: '', nativeError: null, fast: true }).response;
  assert.equal(r.choices[0].finish_reason, 'tool_calls'); assert.deepEqual(r.choices[0].message.tool_calls, [{ id: 'toolu_1', type: 'function', function: { name: 'web_search', arguments: '{"q":"cats"}' } }]);
  const broken = toolAnswer(); broken[2].delta.partial_json = '{"q":"ca'; broken[3].delta.partial_json = ''; const c2 = new N.Capture(); c2.feed(sse(broken)); assert.deepEqual(c2.unparsed, [0]); assert.equal(c2.message.content.length, 0);
  const g3 = new N.Gate(); g3.admit(); assert.throws(() => N.assemble({ model: 'm', names: {}, gate: g3, capture: new N.Capture(), status: 529, error: 'Overloaded', assistants: [], results: [], stopped: false, emitted: '', nativeError: null }), (e) => e.status === 529 && /Overloaded/.test(e.message));
});

test('round trip with a stand-in claude and a fake upstream: text answer, flags, env and the single admission', async () => {
  const r = await run(BODY);
  assert.equal(r.error, null); assert.equal(r.final.choices[0].message.content, 'Hello there'); assert.equal(r.final.choices[0].finish_reason, 'stop');
  assert.equal(r.up.seen.length, 1, 'exactly one request reached the upstream'); assert.equal(r.up.seen[0].auth, 'Bearer fake-token');
  assert.equal(r.up.seen[0].url, '/v1/messages'); assert.equal(r.up.seen[0].body.tools[0].eager_input_streaming, true);
  assert.equal(r.final.usage.native_admission.upstream_requests, 1); assert.equal(r.final.usage.native_admission.blocked_requests, 1, 'the retry was refused locally');
  assert.deepEqual(r.chunks.slice(0, -1).map((c) => c.choices[0].delta.content ?? c.choices[0].delta.reasoning_content), ['hmm', 'Hello', ' there']);
  const last = r.chunks.at(-1); assert.equal(last.choices[0].finish_reason, 'stop'); assert.ok(last.usage.total_tokens > 0);
  const a = r.record.argv, flag = (k) => a[a.indexOf(k) + 1];
  assert.equal(flag('--tools'), ''); assert.equal(flag('--permission-mode'), 'dontAsk'); assert.equal(flag('--setting-sources'), ''); assert.equal(flag('--max-turns'), '1'); assert.equal(flag('--model'), 'claude-sonnet-5-5[1m]');
  for (const f of ['--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence', '--include-partial-messages', '--verbose']) assert.ok(a.includes(f), f);
  assert.equal(flag('--input-format'), 'stream-json'); assert.equal(flag('--output-format'), 'stream-json');
  assert.match(flag('--session-id'), /^[0-9a-f-]{36}$/); assert.equal(r.record.system, 'You are the helper.');
  const mcp = JSON.parse(flag('--mcp-config')); assert.deepEqual(Object.keys(mcp.mcpServers), ['onehc']);
  assert.equal(JSON.parse(JSON.parse(r.record.settings.env.CLAUDE_CODE_EXTRA_BODY ? JSON.stringify(r.record.settings.env.CLAUDE_CODE_EXTRA_BODY) : '""')).tools[0].name, P + 'web_search');
  const env = r.record.env; assert.match(env.ANTHROPIC_BASE_URL, /^http:\/\/127\.0\.0\.1:\d+\/admit\/[0-9a-f]{48}$/); assert.ok(!('ANTHROPIC_API_KEY' in env), 'a conflicting API key is removed');
  for (const [k, v] of Object.entries({ CLAUDE_CODE_MAX_RETRIES: '0', DISABLE_AUTO_COMPACT: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', CLAUDE_CODE_TOTAL_TOKENS_REMINDER: 'off', ENABLE_TOOL_SEARCH: 'false', DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_ENTRYPOINT: '1helm-cloud', DISABLE_TELEMETRY: '1' })) assert.equal(env[k], v, k);
  assert.ok(!JSON.stringify(r.out).includes('fake-token'), 'the bearer never appears in output');
  assert.match(r.record.cwd, /claude-directsdk-cwd$/);
});
test('round trip: a tool call answer, and the next call replays history with the carrier', async () => {
  const r = await run(BODY, { events: toolAnswer() });
  assert.equal(r.final.choices[0].finish_reason, 'tool_calls'); assert.equal(r.final.choices[0].message.tool_calls[0].function.name, 'web_search');
  const assistant = r.final.choices[0].message;
  const r2 = await run({ ...BODY, messages: [...BODY.messages, assistant, { role: 'tool', tool_call_id: 'toolu_1', content: 'cats are great' }] }, { events: textAnswer('Cats are great') });
  assert.equal(r2.error, null); assert.equal(r2.final.choices[0].message.content, 'Cats are great');
  const sent = r2.up.seen[0].body.messages; assert.deepEqual(sent.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.equal(sent[1].content[0].name, P + 'web_search', 'native\'s own assistant message is replayed');
  assert.deepEqual(sent[2].content[0], { type: 'tool_result', tool_use_id: 'toolu_1', content: 'cats are great' });
});
test('round trip: upstream errors keep their status, a signed out CLI is a 401 with a plain reason, bad requests are 400', async () => {
  const e1 = await run(BODY, { status: 529 }); assert.equal(e1.error.status, 529); assert.match(e1.error.message, /Overloaded/);
  const e2 = await run(BODY, { mode: 'authfail' }); assert.equal(e2.error.status, 401); assert.equal(e2.error.code, 'not_signed_in'); assert.match(e2.error.message, /Sign in again/); assert.equal(e2.up.seen.length, 0);
  const e3 = await run({ ...BODY, n: 2 }); assert.equal(e3.error.status, 400);
  await assert.rejects(async () => { for await (const _ of complete({ body: BODY, upstream: 'https://evil.example', claudeCommand: [process.execPath, FAKE] })); }, /only forwards to api.anthropic.com/);
});
test('the relay itself: only its secret route works, and a second request is refused', async () => {
  const up = await upstream(textAnswer('x')), a = new Admission(up.url, { queried: [], timeoutMs: 5000, allowLoopback: true }), base = await a.listen();
  try {
    assert.equal((await fetch(base.replace(/\/admit.*/, '/admit/wrong/v1/messages'), { method: 'POST', body: '{}' })).status, 404);
    assert.equal((await fetch(base + '/v1/messages', { method: 'GET' })).status, 404);
    assert.equal((await fetch(base + '/v1/messages', { method: 'POST', headers: { origin: 'http://evil' }, body: '{}' })).status, 404);
    assert.equal(up.seen.length, 0);
    const ok = await fetch(base + '/v1/messages', { method: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'a' }] }) }); await ok.text();
    assert.equal(ok.status, 200); assert.equal(a.capture.complete, true);
    const again = await fetch(base + '/v1/messages', { method: 'POST', body: '{}' }); assert.equal(again.status, 400); assert.match(await again.text(), /ADMISSION_CONSUMED/);
    assert.equal(up.seen.length, 1); assert.equal(a.gate.denied, 1);
  } finally { await a.close(); await up.close(); }
});

test('rate limit headers: the anthropic-ratelimit-* headers of the answer come out as one limits line, before the answer, and nothing else does', async () => {
  upHeaders = { 'anthropic-ratelimit-unified-5h-utilization': '0.25', 'anthropic-ratelimit-unified-5h-reset': '4102444800', 'anthropic-ratelimit-unified-status': 'allowed', 'x-secret': 'nope', 'set-cookie': 'a=b' };
  try {
    const r = await run(BODY); assert.equal(r.error, null);
    const i = r.out.findIndex((x) => x.t === 'limits'), f = r.out.findIndex((x) => x.t === 'final'); assert.ok(i >= 0 && i < f, 'before the final answer');
    assert.deepEqual(r.out[i], { t: 'limits', status: 200, headers: { 'anthropic-ratelimit-unified-5h-utilization': '0.25', 'anthropic-ratelimit-unified-5h-reset': '4102444800', 'anthropic-ratelimit-unified-status': 'allowed' } });
    assert.ok(!JSON.stringify(r.out).includes('nope') && !JSON.stringify(r.out.filter((x) => x.t === 'limits')).includes('Bearer'));
    const e = await run(BODY, { status: 429 }); assert.equal(e.out.find((x) => x.t === 'limits')?.status, 429, 'a refused call still reports the headers');
  } finally { upHeaders = {}; }
  const none = await run(BODY); assert.ok(!none.out.some((x) => x.t === 'limits'), 'no headers, no line');
});

// Prompt caching marks that 1Helm's request carries (src/model.js withCacheBreakpoints) must reach Anthropic as at most four.
const CC = { type: 'ephemeral' };
const countMarks = (v) => JSON.stringify(v).split('"cache_control"').length - 1;
test('prompt cache marks: a mark on a tool message moves to its tool_result block, and the history keeps the marks of text blocks', () => {
  const { frames } = N.prepareHistory([{ role: 'system', content: [{ type: 'text', text: 'S', cache_control: CC }] }, { role: 'user', content: [{ type: 'text', text: 'one', cache_control: CC }] },
    { role: 'assistant', content: 'ok', tool_calls: [{ id: 't1', type: 'function', function: { name: 'x', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 't1', content: [{ type: 'text', text: 'result', cache_control: CC }] }, { role: 'user', content: 'next' }]);
  assert.deepEqual(frames[0].message.content[0].cache_control, CC, 'a user text mark is kept');
  const result = frames[2].message.content[0]; assert.equal(result.type, 'tool_result'); assert.deepEqual(result.cache_control, CC, 'the mark is on the tool_result');
  assert.ok(!result.content.some((b) => 'cache_control' in b), 'and not inside it');
});
test('prompt cache marks: the request leaves the relay with at most four, tools and system first, the latest message marks last', () => {
  const m = (text, mark) => ({ type: 'text', text, ...(mark ? { cache_control: CC } : {}) });
  const body = { tools: [{ name: 'a' }, { name: 'b', cache_control: CC }], system: [{ type: 'text', text: 'S', cache_control: CC }],
    messages: [{ role: 'user', content: [m('one', 1)] }, { role: 'assistant', content: [m('two', 1)] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'r', cache_control: CC }] }, { role: 'assistant', content: [m('three', 1)] }, { role: 'user', content: [m('four', 1)] }] };
  assert.equal(countMarks(body), 7);
  const out = JSON.parse(N.limitBreakpoints(JSON.stringify(body)));
  assert.equal(countMarks(out), 4); assert.ok(out.tools[1].cache_control && out.system[0].cache_control, 'tools and system keep theirs');
  assert.ok(out.messages[4].content[0].cache_control && out.messages[3].content[0].cache_control, 'the latest message marks stay'); assert.ok(!out.messages[0].content[0].cache_control && !out.messages[1].content[0].cache_control, 'the earliest are dropped');
  const few = JSON.stringify({ system: [{ type: 'text', text: 'S', cache_control: CC }], messages: [{ role: 'user', content: [m('a', 1)] }] }); assert.equal(N.limitBreakpoints(few), few, 'four or fewer: untouched');
  assert.equal(N.limitBreakpoints('not json'), 'not json');
  const t = N.transformAdmitted(JSON.stringify(body), { queried: [m('four')] }); assert.ok(countMarks(JSON.parse(t.payload)) <= 4, 'transformAdmitted ends with four or fewer');
});
test('prompt cache marks: a marked request run through the whole relay reaches the upstream with one to four marks', async () => {
  const { withCacheBreakpoints } = await import('../src/model.js');
  const body = withCacheBreakpoints({ model: 'sonnet', session_id: 's1', tools: TOOLS, messages: [{ role: 'system', content: 'You are the helper.' }, { role: 'user', content: 'one' }, { role: 'assistant', content: 'ok', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'web_search', arguments: '{}' } }] }, { role: 'tool', tool_call_id: 'c1', content: 'result' }, { role: 'user', content: 'next' }] });
  delete body.session_id; assert.ok(countMarks(body) >= 3);
  const r = await run(body); assert.equal(r.error, null); const sent = r.up.seen[0].body;
  assert.ok(countMarks(sent) >= 1 && countMarks(sent) <= 4, `marks upstream: ${countMarks(sent)}`);
  assert.ok(!('session_id' in sent) && !('prompt_cache_key' in sent));
});
test('cache writes and reads from the native usage reach prompt_tokens_details (the turn stats read cached_tokens and cache_write_tokens)', () => {
  const events = textAnswer('Hello there').map((e) => (e.type === 'message_delta' ? { ...e, usage: { output_tokens: 7, cache_read_input_tokens: 3, cache_creation_input_tokens: 21 } } : e));
  const cap = new N.Capture(); cap.feed(sse(events)); const gate = new N.Gate(); gate.admit();
  const r = N.assemble({ model: 'sonnet', names: {}, gate, capture: cap, requestId: 'req_2', status: 200, assistants: [], results: [{ type: 'result', subtype: 'success' }], stopped: true, emitted: 'Hello', nativeError: null, fast: true, exitCode: null }).response;
  assert.deepEqual(r.usage.prompt_tokens_details, { cached_tokens: 3, cache_write_tokens: 21 });
});

// Multi-turn histories that withCacheBreakpoints has marked (it turns a string content into an array of text parts, also on an assistant reply) go through the whole relay.
// The first message of a task has no assistant message to mark, so only turn 2 and later hit the shape "assistant content is an array": the bug that failed the second message of a Claude Code task.
async function markedHistory(turns, { session = true } = {}) {
  const { withCacheBreakpoints } = await import('../src/model.js');
  const messages = [{ role: 'system', content: 'You are the helper.' }];
  for (let t = 1; t <= turns; t++) {
    messages.push({ role: 'user', content: `question ${t}` });
    if (t < turns) {
      messages.push({ role: 'assistant', content: `answer ${t}`, tool_calls: t % 2 ? [{ id: `c${t}`, type: 'function', function: { name: 'web_search', arguments: '{"q":"a"}' } }] : null });
      if (t % 2) messages.push({ role: 'tool', tool_call_id: `c${t}`, content: `result ${t}` });
      if (t % 2) messages.push({ role: 'assistant', content: `after tool ${t}` });
    }
  }
  const body = withCacheBreakpoints({ model: 'sonnet', ...(session ? { session_id: 's1', tools: TOOLS } : {}), messages });
  delete body.session_id; return body;
}
const textOfFrame = (m) => JSON.stringify(m.content);
for (const [name, turns, session] of [['turn 1', 1, true], ['turn 2', 2, true], ['turn 5', 5, true], ['chore after history', 3, false]]) {
  test(`prompt cache marks through the relay: ${name} of a ${session ? 'task' : 'chore'} runs, keeps its text and sends at most four marks`, async () => {
    const body = await markedHistory(turns, { session });
    const r = await run(body); assert.equal(r.error, null, String(r.error?.message)); assert.equal(r.final.choices[0].message.content, 'Hello there');
    const sent = r.up.seen[0].body, all = JSON.stringify(sent.messages);
    assert.ok(all.includes(`question ${turns}`)); if (turns > 1) assert.ok(all.includes('answer 1'));
    assert.ok(countMarks(sent) <= (session ? 4 : 4) && (!session || countMarks(sent) >= 1), `marks upstream: ${countMarks(sent)}`);
    for (const m of sent.messages) assert.ok(typeof m.content === 'string' || Array.isArray(m.content), textOfFrame(m));
  });
}
test('prompt cache marks through the relay: a marked assistant reply with a native carrier is restored and keeps its mark on a block that can carry one', async () => {
  const first = await run(BODY, { events: toolAnswer() }), assistant = first.final.choices[0].message;
  const { withCacheBreakpoints } = await import('../src/model.js');
  const marked = withCacheBreakpoints({ model: 'sonnet', session_id: 's1', tools: TOOLS, messages: [...BODY.messages, assistant, { role: 'tool', tool_call_id: 'toolu_1', content: 'cats' }, { role: 'assistant', content: 'noted', reasoning_details: assistant.reasoning_details }, { role: 'user', content: 'next' }] });
  delete marked.session_id;
  const { frames } = N.prepareHistory([{ role: 'user', content: 'Hi' }, { ...assistant, content: [{ type: 'text', text: assistant.content || '', cache_control: CC }] }, { role: 'user', content: 'again' }].map((m) => m.role === 'assistant' && !m.content[0].text ? { ...m, content: [{ type: 'text', text: '', cache_control: CC }] } : m));
  assert.equal(frames[1].message.content[0].type, 'tool_use');
  const r = await run(marked); assert.equal(r.error, null, String(r.error?.message)); assert.ok(countMarks(r.up.seen[0].body) <= 4);
});
test('projection: assistant content as a string, as text parts with a mark, and null all read as the same visible text', () => {
  assert.equal(N.projection({ role: 'assistant', content: ' hi ' }).content, 'hi');
  assert.equal(N.projection({ role: 'assistant', content: [{ type: 'text', text: ' hi ', cache_control: CC }] }).content, 'hi');
  assert.equal(N.projection({ role: 'assistant', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }).content, 'ab');
  assert.equal(N.projection({ role: 'assistant', content: null }).content, '');
});
test('history: a marked assistant carrier message matches its carrier and a marked plain one becomes text blocks', () => {
  const native = { id: 'msg_1', role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm', signature: 'SIG' }, { type: 'text', text: 'Hello' }], usage: { input_tokens: 1 } };
  const carrier = { type: N.CARRIER, version: 1, messages: [native], projection: N.projection({ role: 'assistant', content: 'Hello' }) };
  const f = N.prepareHistory([{ role: 'user', content: 'Hi' }, { role: 'assistant', content: [{ type: 'text', text: 'Hello', cache_control: CC }], reasoning_details: [carrier] }, { role: 'user', content: 'again' }]).frames;
  assert.equal(f[1].message.content[0].signature, 'SIG', 'restored, not rewritten'); assert.ok(!('cache_control' in f[1].message.content[0]), 'never on the thinking block');
  assert.deepEqual(f[1].message.content[1].cache_control, CC); assert.ok(!('cache_control' in native.content[1]), 'the carrier itself is not changed');
  const g = N.prepareHistory([{ role: 'user', content: 'Hi' }, { role: 'assistant', content: [{ type: 'text', text: 'Hello', cache_control: CC }] }, { role: 'user', content: 'again' }]).frames;
  assert.deepEqual(g[1].message.content, [{ type: 'text', text: 'Hello', cache_control: CC }]);
});

// A long tool call: arguments arrive for minutes and nothing else goes out, so the Worker's idle guard (120 s with no data: event) would drop the stream.
const longCall = (cut = false) => {
  const full = JSON.stringify({ path: 'index.html', content: 'x'.repeat(5000) }), cutAt = full.length - 40, src = cut ? full.slice(0, cutAt) : full, parts = src.match(/.{1,100}/g);
  const ev = toolAnswer(); ev.splice(2, 2, ...parts.map((p) => ({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: p } })));
  if (cut) ev[ev.length - 2] = { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 9 } };
  return { ev, full, parts };
};
test('long tool call: progress chunks go out while arguments arrive (throttled), the guard sees data:, and the final call is unchanged', async () => {
  const { ev, full, parts } = longCall(); const { meaningfulDelta } = await import('../src/model-limits.js');
  const p = new N.Progress(), out = []; let now = 1_000_000;
  for (const e of ev) { if (e.type === 'stream_event') continue; const c = e.type === 'content_block_delta' ? p.chunk('m', e, now) : null; if (e.delta?.type === 'input_json_delta') now += 1000; if (c) out.push(c); }
  assert.equal(parts.length, 51); assert.equal(out.length, 17, 'one chunk every 3 seconds of a 51 second call');
  for (const c of out) { const d = c.choices[0].delta; assert.equal(meaningfulDelta(d), true); assert.equal(d.content, null); assert.equal(d.tool_calls, null); assert.equal(c.choices[0].finish_reason, null); assert.match('data: ' + JSON.stringify(c) + '\n\n', /(^|\n)[ \t]*data:/); }
  assert.equal(p.chunk('m', { delta: { type: 'text_delta', text: 'a' } }, now + 10_000), null, 'only tool argument deltas make progress chunks');
  const cap = new N.Capture(); cap.feed(sse(ev)); const g = new N.Gate(); g.admit();
  const r = N.assemble({ model: 'm', names: { web_search: 'web_search' }, gate: g, capture: cap, status: 200, assistants: [], results: [{ subtype: 'success' }], stopped: true, emitted: '', nativeError: null, fast: true });
  assert.equal(r.response.choices[0].message.tool_calls[0].function.arguments, JSON.stringify(JSON.parse(full)));
  assert.equal(r.chunks.at(-1).choices[0].delta.tool_calls[0].function.arguments, JSON.stringify(JSON.parse(full)));
});
test('long tool call: a call cut off at max_tokens is still dropped, and finish is length', () => {
  const { ev } = longCall(true), cap = new N.Capture(); cap.feed(sse(ev)); const g = new N.Gate(); g.admit();
  assert.deepEqual(cap.unparsed, [0]);
  const r = N.assemble({ model: 'm', names: { web_search: 'web_search' }, gate: g, capture: cap, status: 200, assistants: [], results: [{ subtype: 'success' }], stopped: true, emitted: '', nativeError: null, fast: true });
  assert.equal(r.response.choices[0].finish_reason, 'length'); assert.equal(r.response.choices[0].message.tool_calls, null); assert.equal(r.chunks.at(-1).choices[0].delta.tool_calls, null);
});
test('long tool call through the relay: at least one progress chunk is yielded before the final chunk, and the answer is the same', async () => {
  const { ev, full } = longCall(), r = await run(BODY, { events: ev });
  assert.equal(r.error, null); assert.equal(r.final.choices[0].message.tool_calls[0].function.arguments, JSON.stringify(JSON.parse(full)));
  const progress = r.chunks.filter((c) => c.choices[0].delta.reasoning_content === ' '); assert.ok(progress.length >= 1);
  assert.equal(r.chunks.filter((c) => c.choices[0].delta.tool_calls).length, 1, 'tool_calls come only in the last chunk');
});
