// node --import ./test/stubs/register.mjs test/byok-chatgpt-retry.test.mjs
// ChatGPT call retries (src/byok-chatgpt.js chatgptChat): a transient failure before any output is retried twice after 5000 ms, with a fake fetch and a fake sleep (no real waiting, no real calls).
import assert from "node:assert/strict"; import { DatabaseSync } from "node:sqlite";
import { chatgptChat, chatgptRetryable, CG_RETRIES, CG_RETRY_WAIT_MS, CG_USE_SCOPE, CG_TOKEN_URL, cgDdl } from "../src/ee/byok-chatgpt.js";
import { sealSecret } from "../src/sentinel.js";
import { ByokError } from "../src/byok.js";

const d1 = new DatabaseSync(":memory:");
const D1 = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }),
  run: async () => { const r = st.run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; }, exec: async (q) => d1.exec(q), batch: async (l) => { for (const x of l) await x.run(); } };
const env = { DB: D1, VAULT_KEY: Buffer.from(new Uint8Array(32).map((_, i) => i * 7 + 1)).toString("base64") };
await cgDdl(env);
const rec = { client_id: "oaiapp_x", access_token: "tok-1", refresh_token: "r", expires_at: Date.now() + 3600e3 };
d1.prepare("INSERT INTO byok_chatgpt (tenant_id,client_id,subject,email,record_sealed,expires_at,ver,updated_at) VALUES ('t1','oaiapp_x','s','a@b.c',?,?,1,1)").run(await sealSecret(env, JSON.stringify(rec)), rec.expires_at);
const cfg = { provider: "chatgpt", base: "https://api.openai.com/v1", key: "", model: "m", chatgptHandle: { env, tid: "t1" } };
const uses = () => d1.prepare("SELECT COALESCE(SUM(calls),0) AS c, COALESCE(SUM(tokens),0) AS t FROM byok_chatgpt_use").get();

const sse = (events) => new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
const okEvents = [{ type: "response.output_text.delta", delta: "Hello" }, { type: "response.completed", response: { usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 } } }];
const noStatusFail = () => sse([{ type: "response.failed", response: { error: {} } }]);
const script = (steps) => { const calls = []; const f = async (url, init) => { calls.push(url); if (init?.signal?.aborted) throw init.signal.reason; const s = steps[Math.min(calls.length - 1, steps.length - 1)]; if (typeof s === "function") return s(); return s; }; f.calls = calls; return f; };
const run = async (fetchImpl, { stream = true, signal = null } = {}) => {
  const waits = []; const sleep = async (ms, sg) => { waits.push(ms); if (sg?.aborted) throw sg.reason; };
  let reply = "", err = null;
  try { const r = await chatgptChat(cfg, { messages: [{ role: "user", content: "hi" }], stream }, { fetchImpl, model: "m", signal, sleep }); if (stream) reply = await r.text(); else reply = JSON.stringify(await r.json()); }
  catch (e) { err = e; }
  return { reply, err, waits };
};
const errResp = (status, code, msg = "x") => new Response(JSON.stringify({ error: { code, message: msg } }), { status, headers: { "content-type": "application/json" } });
let n = 0; const ok = (m) => { n++; console.log(`ok ${n} - ${m}`); };
const reset = () => d1.exec("DELETE FROM byok_chatgpt_use");

assert.equal(CG_RETRIES, 2); assert.equal(CG_RETRY_WAIT_MS, 5000);

// fails twice, then succeeds
{ reset(); const f = script([noStatusFail, noStatusFail, sse(okEvents)]); const r = await run(f);
  assert.equal(r.err, null); assert.equal(f.calls.length, 3); assert.deepEqual(r.waits, [5000, 5000]);
  assert.equal((r.reply.match(/Hello/g) || []).length, 1); assert.deepEqual({ ...uses() }, { c: 1, t: 5 }); ok("fails twice then succeeds: one reply, two waits of 5000 ms, usage recorded once"); }
// non-streaming call retries too
{ reset(); const f = script([noStatusFail, sse(okEvents)]); const r = await run(f, { stream: false });
  assert.equal(r.err, null); assert.equal(f.calls.length, 2); assert.match(r.reply, /Hello/); assert.deepEqual({ ...uses() }, { c: 1, t: 5 }); ok("a call that does not stream retries the same way"); }
// fails three times
{ reset(); const f = script([noStatusFail]); const r = await run(f);
  assert.ok(r.err instanceof ByokError); assert.match(r.err.message, /Your AI service \(.+\) didn.t work \(error 0\)/); assert.equal(f.calls.length, 3); assert.deepEqual(r.waits, [5000, 5000]); assert.equal(uses().c, 0); ok("fails three times: the failure is thrown once, after three tries, no usage"); }
// HTTP transient statuses
for (const [st, code] of [[500, ""], [503, ""], [408, ""], [429, "rate_limited"]]) {
  reset(); const f = script([() => errResp(st, code), sse(okEvents)]); const r = await run(f);
  assert.equal(r.err, null); assert.equal(f.calls.length, 2, `status ${st}`); assert.deepEqual(r.waits, [5000]);
}
ok("HTTP 500, 503, 408 and 429 (not the usage limit) retry");
// network error and no first byte
{ const f = script([() => { throw new TypeError("fetch failed"); }, sse(okEvents)]); const r = await run(f); assert.equal(r.err, null); assert.equal(f.calls.length, 2); ok("a network error retries"); }
{ const stuck = () => new Response(new ReadableStream({ start() {} }), { status: 200 });
  const f = script([stuck, sse(okEvents)]); const waits = [];
  const r = await chatgptChat(cfg, { messages: [{ role: "user", content: "hi" }], stream: true }, { fetchImpl: async (u, i) => (f.calls.length === 0 ? (f.calls.push(u), new Promise((_, no) => i.signal.addEventListener("abort", () => no(i.signal.reason)))) : f(u, i)), model: "m", timeouts: { first: 20 }, sleep: async (ms) => { waits.push(ms); } });
  assert.match(await r.text(), /Hello/); assert.deepEqual(waits, [5000]); ok("no first byte in time retries"); }
// no retry cases
for (const [name, mk, http, detail] of [
  ["invalid user", () => errResp(403, "subscription_sharing_invalid_user"), 403],
  ["usage limit", () => errResp(429, "subscription_sharing_usage_limit_exceeded"), 429],
  ["unsupported capability", () => errResp(400, "subscription_sharing_unsupported_capability"), 400],
  ["route not supported", () => errResp(400, "subscription_sharing_route_not_supported"), 400],
  ["403", () => errResp(403, ""), 403],
  ["400", () => errResp(400, "bad"), 400],
  ["stream usage limit", () => sse([{ type: "error", code: "subscription_sharing_usage_limit_exceeded", status: 429 }])],
  ["stream unsupported capability", () => sse([{ type: "error", code: "subscription_sharing_unsupported_capability" }])],
  ["stream 401", () => sse([{ type: "error", status: 401, message: "no" }])],
]) {
  reset(); const f = script([mk, sse(okEvents)]); const r = await run(f);
  assert.ok(r.err instanceof ByokError, name); assert.equal(f.calls.length, 1, name); assert.deepEqual(r.waits, [], name);
}
ok("sign-in 401, usage limit, 400 refusals and 403 fail at once with no retry");
// a 401 refreshes the token once (as before) and a second 401 is the sign-in problem: no retry wait
{ reset(); const calls = []; const f = async (u) => { calls.push(String(u)); return String(u) === CG_TOKEN_URL ? new Response(JSON.stringify({ access_token: "tok-2", refresh_token: "r2", scope: CG_USE_SCOPE, expires_in: 3600 }), { status: 200, headers: { "content-type": "application/json" } }) : errResp(401, ""); };
  const r = await run(f); assert.ok(r.err instanceof ByokError); assert.equal(r.err.http, 401); assert.deepEqual(r.waits, []); assert.equal(calls.filter((u) => u !== CG_TOKEN_URL).length, 2); ok("a 401 refreshes the token once and is not retried"); }
{ const f = async (u) => (String(u) === CG_TOKEN_URL ? new Response(JSON.stringify({ error: "invalid_request" }), { status: 400, headers: { "content-type": "application/json" } }) : errResp(401, ""));
  const r = await run(f); assert.ok(r.err instanceof ByokError); assert.deepEqual(r.waits, []); ok("a refresh ChatGPT refuses is not retried"); }
// the 401 token refresh path stays as before: a ended sign-in is not retried
{ d1.prepare("UPDATE byok_chatgpt SET broken=1, record_sealed='' WHERE tenant_id='t1'").run(); const f = script([sse(okEvents)]); const r = await run(f);
  assert.ok(r.err instanceof ByokError); assert.equal(r.err.http, 401); assert.equal(f.calls.length, 0); assert.deepEqual(r.waits, []);
  d1.prepare("UPDATE byok_chatgpt SET broken=0, record_sealed=? WHERE tenant_id='t1'").run(await sealSecret(env, JSON.stringify(rec))); ok("an ended sign-in is not retried"); }
// failure after the first text chunk
{ reset(); const f = script([() => sse([{ type: "response.output_text.delta", delta: "Part" }, { type: "response.failed", response: { error: {} } }]), sse(okEvents)]);
  const waits = []; const r = await chatgptChat(cfg, { messages: [{ role: "user", content: "hi" }], stream: true }, { fetchImpl: f, model: "m", sleep: async (ms) => { waits.push(ms); } });
  let got = "", threw = null; try { got = await r.text(); } catch (e) { threw = e; }
  assert.equal(f.calls.length, 1); assert.deepEqual(waits, []); assert.ok(threw instanceof ByokError || /Part/.test(got)); assert.equal(uses().c, 0); ok("a failure after the first text chunk is not retried"); }
// abort during the wait
{ const ac = new AbortController(); const f = script([noStatusFail, sse(okEvents)]); let slept = false;
  const sleep = (ms, sg) => new Promise((_, no) => { slept = true; ac.abort(new Error("stopped")); sg.aborted ? no(sg.reason) : sg.addEventListener("abort", () => no(sg.reason)); });
  let err = null; try { await chatgptChat(cfg, { messages: [{ role: "user", content: "hi" }], stream: true }, { fetchImpl: f, model: "m", signal: ac.signal, sleep }); } catch (e) { err = e; }
  assert.ok(slept); assert.equal(err?.message, "stopped"); assert.equal(f.calls.length, 1); ok("an abort during the wait stops at once"); }
// the real wait is abortable and short-circuits
{ const ac = new AbortController(); const f = script([noStatusFail, sse(okEvents)]); const t0 = Date.now();
  const p = chatgptChat(cfg, { messages: [{ role: "user", content: "hi" }], stream: true }, { fetchImpl: f, model: "m", signal: ac.signal }).catch((e) => e);
  setTimeout(() => ac.abort(new Error("stopped")), 30); const e = await p;
  assert.equal(e.message, "stopped"); assert.ok(Date.now() - t0 < 1500); assert.equal(f.calls.length, 1); ok("the default wait ends at once on abort"); }
// classifier
assert.equal(chatgptRetryable(new Error("x")), false); assert.equal(chatgptRetryable(new ByokError("m", 0, "")), false); assert.equal(chatgptRetryable(new ByokError("m", 302, "error 302")), false);
ok("only call failures with words and a transient status retry");
console.log(`# ${n} passed`);
