// node --import ./test/stubs/register.mjs test/bee-stream.test.mjs
// Bee's /v1/stream (SSE) as hints for Live notes (src/bee-api.js sseFeed, liveCore, beeStreamOpener, beeLiveRun; 2026-10-08). Bee's documented frames
// (docs.bee.computer/docs/realtime; bee-cli commands/stream): "event: <type>\ndata: <json>\n\n", ":" pings, a "connected" event.
//  - SSE framing: split chunks, CRLF, pings, multi-line data, a frame too big;
//  - liveCore with a fake stream: an event wakes the loop (a GET at once, or the min gap after the last one; 2 s in this rig, 5 s live); new-conversation follows that id at once;
//    update-conversation (processed) on one we follow → read now → the GET (source of truth) reports COMPLETED; a summary event →
//    hints.summary; a DROPPED event → the 15 s safety GET still reports the end; stream closed → 5 s polling + reconnect with
//    backoff; 404 → no stream for the chunk; no event text leaves the job; the stream is closed when the chunk ends;
//  - beeLiveRun and beeStreamOpener over a real local HTTP stream (fetch rewritten from Bee's public endpoint to 127.0.0.1): exactly
//    GET /v1/stream?types=… with Accept text/event-stream and the Bearer token; the read allowlist still refuses /v1/stream; events drive
//    the reads; a stream that ends or answers an error reports it; the probe reports types / keys only.
import assert from "node:assert"; import http from "node:http";
import * as B from "../src/ee/bee.js";
import { API_ROOT, LIVE_ALLOW, beeStreamOpener, liveGetter } from "../src/ee/bee-api.js";

const ok = (name) => console.log("  ok", name);
const feed = B.sseFeed, liveCore = B.liveCore;
const flush = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

// ---- 1. SSE framing ----
{ const S = {}, got = [], on = (e, d) => got.push([e, d]);
  feed(S, ": ping\n\nevent: connected\ndata: {\"ok\":true}\n\nevent: new-utt", on); assert.deepEqual(got, [["connected", { ok: true }]]);
  feed(S, "erance\r\ndata: {\"utterance\":{\"text\":\"hi\",\"speaker\":\"s1\"},\r\ndata: \"conversation_uuid\":\"u1\"}\r\n\r\n", on);
  assert.deepEqual(got[1], ["new-utterance", { utterance: { text: "hi", speaker: "s1" }, conversation_uuid: "u1" }], "split chunk, CRLF, two data lines joined");
  feed(S, "data: {\"conversation_id\":5,\"short_summary\":\"x\"}\n\nevent: x\ndata: not json\n\n", on); assert.deepEqual(got[2], [null, { conversation_id: 5, short_summary: "x" }], "data-only frame");
  assert.deepEqual(got[3], ["x", null], "unreadable data → null, not a crash");
  assert.throws(() => feed(S, "data: " + "a".repeat(300000), on), /too big/); assert.equal(S.buf, "", "dropped"); }
ok("SSE framing: pings skipped, frames split across chunks, CRLF, multi-line data, data-only frames, bad JSON tolerated, a frame over 256 KB drops the stream");

// ---- 2. liveCore with a fake stream ----
let clock = 1.8e12; const realNow = Date.now; Date.now = () => clock;
function rig({ stream = true } = {}) {
  const R = { gets: [], out: [], sleeps: [], opened: 0, closed: 0, cb: null, alive: true, convs: new Map() };
  R.conv = (id, o = {}) => R.convs.set(id, { id, state: "CAPTURING", end_time: null, start_time: clock - 60e3, utts: [], ...o });
  R.say = (id, text) => { const c = R.convs.get(id); c.utts.push({ id: id * 1000 + c.utts.length, spoken_at: clock - 1000, text, speaker: "Ana", realtime: true }); };
  R.end = (id) => Object.assign(R.convs.get(id), { state: "COMPLETED", end_time: clock });
  const get = async (p) => { R.gets.push(p); let m;
    if (/^\/v1\/conversations\?limit=/.test(p)) return { status: 200, body: JSON.stringify({ conversations: [...R.convs.values()].map(({ utts, ...c }) => c) }) };
    if ((m = /^\/v1\/conversations\/(\d+)$/.exec(p))) { const c = R.convs.get(Number(m[1])); return c ? { status: 200, body: JSON.stringify({ conversation: { ...c, transcriptions: [{ realtime: true, utterances: c.utts }] } }) } : { status: 404, body: "{}" }; }
    return { status: 404, body: "{}" }; };
  const sleep = (ms) => new Promise((r) => R.sleeps.push({ ms, r }));
  const open = (onEv, onSt) => { R.opened++; R.cb = { onEv, onSt }; return { close: () => { R.closed++; } }; };
  R.ev = async (type, data) => { R.cb.onEv(type, data); await flush(); };
  R.st = async (st, info) => { R.cb.onSt(st, info); await flush(); };
  // let the loop's latest wait run out (earlier ones lost a race to an event and are stale)
  R.next = async () => { await flush(); const s = R.sleeps.pop(); R.sleeps.length = 0; clock += s.ms; s.r(); await flush(); return s.ms; };
  R.lastWait = () => R.sleeps.at(-1)?.ms;
  R.convGets = (id) => R.gets.filter((p) => p === `/v1/conversations/${id}`).length;
  R.run = (j = {}) => { R.done = liveCore({ since: clock - 60e3, convs: [501], every: 5000, list_every: 30000, safety_every: 15000, min_gap: 2000, stream, ...j },
    get, (o) => R.out.push(JSON.parse(JSON.stringify(o))), () => R.alive, sleep, open); return R; };
  return R;
}
{ const R = rig(); R.conv(501); R.say(501, "hello everyone"); R.run(); await flush();
  assert.equal(R.opened, 1, "the stream opens with the chunk"); assert.equal(R.out[0].stream, "opening"); assert.equal(R.out[0].utts[0].tx, "hello everyone"); assert.equal(R.lastWait(), 5000, "not open yet: 5 s polling");
  await R.st("open"); await R.next(); assert.equal(R.out.at(-1).stream, "open"); assert.equal(R.lastWait(), 15000, "open: a 15 s safety round");
  // an utterance event right after a read → the next read the min gap after it (not 15 s)
  let g = R.convGets(501); R.say(501, "we decided to ship"); await R.ev("new-utterance", { utterance: { text: "SECRET-EVENT-TEXT", speaker: "s1" }, conversation_uuid: "u-501" });
  assert.equal(R.lastWait(), 2000, "woken: the next read GAP after the last"); await R.next(); assert.equal(R.convGets(501), g + 1); assert.equal(R.out.at(-1).utts.at(-1).tx, "we decided to ship");
  assert.deepEqual(R.out.at(-1).ev, { "new-utterance": 1 }, "event counts only");
  // new-conversation → followed at once (no list needed); its utterances (via the uuid) wake reads
  R.conv(502); R.say(502, "second room"); clock += 10000; const o0 = R.out.length;
  await R.ev("new-conversation", { conversation: { id: 502, uuid: "u-502", state: "processing", title: "T" } }); assert.equal(R.out.length, o0 + 1, "10 s after the last read: read at once");
  assert.ok(R.out.at(-1).convs.some((c) => c.id === 502 && c.state === "CAPTURING")); assert.equal(R.out.at(-1).utts.at(-1).tx, "second room");
  // an event for a conversation that isn't ours: no wake, not followed
  const w0 = R.sleeps.length; await R.ev("update-conversation", { conversation: { id: 999, state: "processed" } }); assert.equal(R.lastWait(), 15000); assert.equal(R.sleeps.length, w0, "no wake");
  // ended: update-conversation processed → read now → the GET says COMPLETED (the source of truth) → reported once, then not read again
  R.end(501); await R.ev("update-conversation", { conversation: { id: 501, state: "processed", short_summary: "x" } }); assert.equal(R.lastWait(), 2000); await R.next();
  assert.deepEqual(R.out.at(-1).convs.find((c) => c.id === 501), { id: 501, state: "COMPLETED" }); g = R.convGets(501);
  await R.ev("update-conversation-summary", { conversation_id: 501, short_summary: "Planning" }); assert.equal(R.lastWait(), 15000, "a summary doesn't need a read");
  await R.next(); assert.deepEqual(R.out.at(-1).hints, { summary: [501] }, "summary hint (for the re-read of memory)"); assert.equal(R.convGets(501), g, "an ended conversation isn't read again");
  // DROPPED: 502 ends, Bee's event never comes → the 15 s safety round reports it anyway
  R.end(502); const waited = await R.next(); assert.equal(waited, 15000); assert.deepEqual(R.out.at(-1).convs.find((c) => c.id === 502), { id: 502, state: "COMPLETED" }, "found by the safety GET");
  // the stream drops → 5 s polling at once, a reconnect after 5 s (then 10 s …)
  await R.st("closed", {}); assert.equal(R.out.at(-1).stream, "closed", "a round at once"); assert.equal(R.lastWait(), 5000, "then 5 s polling"); assert.equal(R.opened, 1, "not before its retry time");
  await R.next(); assert.equal(R.opened, 2, "reconnected after 5 s"); await R.st("error", { status: 503, retry_ms: 20000 });
  for (let i = 0; i < 3; i++) await R.next(); assert.equal(R.opened, 2, "not before Retry-After"); await R.next(); assert.equal(R.opened, 3, "Retry-After honoured (20 s)");
  // the chunk ends → the stream is closed
  const c0 = R.closed; R.alive = false; await R.next(); const end = await R.done; assert.equal(end.t, "end"); assert.equal(R.closed, c0 + 1, "closed with the chunk");
  assert.ok(!JSON.stringify(R.out).includes("SECRET-EVENT-TEXT"), "no event text leaves the job"); }
ok("liveCore + stream: events wake a read (at once, or the min gap after the last); new-conversation followed at once; 'processed' → read now, the GET says COMPLETED; summary → hint; a DROPPED event → the 15 s safety GET still reports the end; stream drop → 5 s polling + backoff reconnect (Retry-After); closed with the chunk; no event text out");

{ const R = rig(); R.conv(501); R.run(); await flush(); await R.st("error", { status: 404 }); await R.next(); assert.equal(R.out.at(-1).stream, "dead");
  for (let i = 0; i < 3; i++) { assert.equal(await R.next(), 5000); } assert.equal(R.opened, 1, "404: no stream for this chunk"); R.alive = false; await R.next(); await R.done;
  const P = rig({ stream: false }); P.conv(501); P.run(); await flush(); assert.equal(P.opened, 0); assert.equal(P.out[0].stream, undefined, "no stream asked: lines as before"); assert.equal(await P.next(), 5000); P.alive = false; await P.next(); await P.done; }
ok("no stream (404, or not asked for): 5 s polling exactly as before");

// ---- 3. beeLiveRun over a real local HTTP stream ----
{
  Date.now = realNow;
  const seen = [], streams = [], T = realNow;
  const c701 = { id: 701, state: "CAPTURING", end_time: null, start_time: T() - 60e3, transcriptions: [{ realtime: true, utterances: [{ id: 1, spoken_at: T() - 5000, text: "kickoff", speaker: "Ana" }] }] };
  const srv = await new Promise((z) => { const s = http.createServer((req, res) => {
    seen.push({ path: req.url, auth: req.headers.authorization, accept: req.headers.accept, method: req.method });
    if (req.url.startsWith("/v1/stream")) { res.writeHead(200, { "content-type": "text/event-stream" }); streams.push(res); res.write(": hello\n\nevent: connected\ndata: {}\n\n"); return; }
    const send = (code, b) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(b)); };
    if (req.url === "/v1/conversations?limit=10") return send(200, { conversations: [{ id: 701, state: c701.state, end_time: c701.end_time, start_time: c701.start_time }] });
    if (req.url === "/v1/conversations/701") return send(200, { conversation: c701 });
    return send(404, {}); }).listen(0, "127.0.0.1", () => z(s)); });
  const local = { fetch: (u, init) => fetch(String(u).replace(API_ROOT, `http://127.0.0.1:${srv.address().port}`), init) };
  assert.ok(!LIVE_ALLOW.test("/v1/stream") && !LIVE_ALLOW.test(B.LIVE_STREAM_PATH), "the read helper can't open the stream");
  assert.deepEqual(await liveGetter("t", local)("/v1/stream?types=all"), { status: 0, error: "bad path" });
  assert.equal(B.LIVE_STREAM_PATH, "/v1/stream?types=new-utterance,new-conversation,update-conversation,update-conversation-summary,delete-conversation");
  try {
    const lines = [], ctl = {}, t0 = T();
    const p = B.beeLiveRun({ run: "r1", ln: "x", token: "tok-888", since: 0, convs: [701], every: 1000, list_every: 30000, safety_every: 4000, min_gap: 500, max_ms: 3500, stream: true },
      async (m) => { lines.push(m); return { go: true }; }, ctl, local);
    while (!streams.length && T() - t0 < 5000) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 1300));   // two 1 s polls before it's open, then the 4 s safety wait
    const before = seen.filter((s) => s.path === "/v1/conversations/701").length;
    c701.state = "COMPLETED"; c701.end_time = T(); streams[0].write("event: update-conversation\ndata: {\"conversation\":{\"id\":701,\"state\":\"processed\"}}\n\n");
    const r = await p, ln = lines.filter((l) => l.t === "poll");
    const st = seen.find((s) => s.path.startsWith("/v1/stream"));
    assert.deepEqual({ path: st.path, auth: st.auth, accept: st.accept, method: st.method }, { path: B.LIVE_STREAM_PATH, auth: "Bearer tok-888", accept: "text/event-stream", method: "GET" });
    assert.equal(seen.filter((s) => s.path.startsWith("/v1/stream")).length, 1, "one stream for the chunk");
    assert.ok(ln.some((l) => l.stream === "open"), "the stream opened");
    const done = ln.find((l) => (l.convs || []).some((c) => c.id === 701 && c.state === "COMPLETED"));
    assert.ok(done, "the end reported"); assert.ok(seen.filter((s) => s.path === "/v1/conversations/701").length === before + 1, "one read, right after the event (not at the 4 s safety round)");
    assert.deepEqual(done.ev, { "update-conversation": 1 });
    assert.equal(r.ok, true); assert.equal(r.why, "time"); assert.equal(r.lines, lines.length - 1, "every round was pushed, then the end"); assert.equal(lines.at(-1).t, "end"); assert.equal(lines.at(-1).why, "time"); assert.ok(seen.every((s) => s.auth === "Bearer tok-888"), "the token only in the Authorization header");
    assert.ok(!seen.some((x) => /transcript/.test(x.path)), "no transcript route called");
    // the push answers go:false → the chunk ends at once and says "stopped"; ctl.stop() ends it too
    streams.length = 0; let n = 0; const t1 = T();
    const r2 = await B.beeLiveRun({ run: "r2", token: "tok-888", since: 0, convs: [701], every: 1000, max_ms: 20e3, stream: false }, async () => ({ go: ++n < 2 }), {}, local);
    assert.equal(r2.why, "stopped"); assert.ok(T() - t1 < 4000, "ended without waiting out the chunk");
    const c3 = {}, p3 = B.beeLiveRun({ run: "r3", token: "tok-888", since: 0, convs: [701], every: 1000, max_ms: 20e3, stream: false }, async () => ({ go: true }), c3, local);
    await new Promise((z) => setTimeout(z, 300)); c3.stop(); const t2 = T(), r3 = await p3; assert.equal(r3.why, "stopped"); assert.ok(T() - t2 < 2000, "ctl.stop() cuts the wait");
    // the probe (/_ops/bee?live=probe): types, keys and states only, never text
    streams.length = 0; const pp = B.beeLiveProbe({}, "t1", "tok-888", local);
    while (!streams.length) await new Promise((r) => setTimeout(r, 30));
    streams[0].write("event: new-utterance\ndata: {\"utterance\":{\"text\":\"PRIVATE WORDS\",\"speaker\":\"s1\"},\"conversation_uuid\":\"u\"}\n\nevent: update-conversation\ndata: {\"conversation\":{\"id\":701,\"state\":\"processed\",\"title\":\"PRIVATE TITLE\"}}\n\n");
    const pr = await pp; assert.equal(pr.stream_probe.state, "open"); assert.deepEqual(pr.stream_probe.events, { connected: 1, "new-utterance": 1, "update-conversation": 1 });
    assert.deepEqual(pr.stream_probe.keys["new-utterance"], ["conversation_uuid", "utterance", "utterance.speaker", "utterance.text"]); assert.deepEqual(pr.stream_probe.states, ["update-conversation:processed"]);
    assert.ok(!JSON.stringify(pr).includes("PRIVATE"), "no text in the probe");
  } finally { srv.closeAllConnections?.(); srv.close(); }
}
ok("beeLiveRun over a real local stream: exactly GET /v1/stream?types=… (Bearer, text/event-stream), one per chunk; the read helper can't reach it; an event → the read right away and the end reported; go:false and stop() end the chunk; the probe shows event types / keys / states only");

// ---- 4. beeStreamOpener: parsing across chunks, a refused stream, a stream Bee ends, close() ----
{
  const enc = new TextEncoder(), mk = () => { let ctl; const body = new ReadableStream({ start(c) { ctl = c; } }); return { body, push: (t) => ctl.enqueue(enc.encode(t)), end: () => ctl.close() }; };
  const run = async (fetchFn) => { const ev = [], st = []; const h = beeStreamOpener("tok", { fetch: fetchFn })((e, d) => ev.push([e, d]), (s, i) => st.push([s, i])); await new Promise((r) => setTimeout(r, 30)); return { ev, st, h }; };
  const a = mk(); let init;
  let r = await run(async (u, i) => { init = { u, i }; return new Response(a.body, { status: 200 }); });
  a.push("event: new-utt"); a.push("erance\ndata: {\"utterance\":{\"text\":\"hi\"}}\n\n"); await new Promise((z) => setTimeout(z, 30));
  assert.deepEqual(r.st, [["open", {}]]); assert.deepEqual(r.ev, [["new-utterance", { utterance: { text: "hi" } }]], "an event split across network chunks");
  assert.equal(init.u, API_ROOT + B.LIVE_STREAM_PATH); assert.equal(init.i.headers.authorization, "Bearer tok"); assert.equal(init.i.headers.accept, "text/event-stream");
  a.end(); await new Promise((z) => setTimeout(z, 30)); assert.deepEqual(r.st.at(-1), ["closed", {}], "Bee ended the stream");
  r = await run(async () => new Response("no", { status: 503, headers: { "retry-after": "20" } })); assert.deepEqual(r.st, [["error", { status: 503, retry_ms: 20000 }]]);
  r = await run(async () => new Response("no", { status: 401 })); assert.deepEqual(r.st, [["error", { status: 401, retry_ms: null }]]);
  r = await run(async () => { throw new TypeError("fetch failed tok-secret-token-123456"); }); assert.equal(r.st[0][0], "error");
  const b = mk(); let signal; r = await run(async (u, i) => { signal = i.signal; return new Response(b.body, { status: 200 }); });
  r.h.close(); assert.equal(signal.aborted, true, "close() cancels the request"); assert.equal(r.st.length, 1, "no state after close");
  r = await run(async (u, i) => new Response(mk().body, { status: 200 })); r.h.close();
  const c = mk(); r = await run(async () => new Response(c.body, { status: 200 })); c.push("data: " + "a".repeat(300000)); await new Promise((z) => setTimeout(z, 30)); assert.equal(r.st.at(-1)[0], "closed", "a frame over 256 KB drops the stream");
}
ok("beeStreamOpener: events split across network chunks, Bee ending the stream, a refused stream (status and Retry-After), a network error, close() cancels, an oversized frame drops it");
process.exit(0);
