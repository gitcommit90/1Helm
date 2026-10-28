// node --import ./test/stubs/register.mjs test/turn-trace.test.mjs
// Langfuse turn traces (src/turn-trace.js): span building and nesting, the gateway headers, the privacy canary, a dead endpoint, and resume.
// The real Resident (node:sqlite) runs real turns with a scripted model (callModelOnceInner) and a scripted tool (localTool).
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite";
import { Resident } from "../src/resident.js";
import { TurnTrace, buildOtlp, modelsMark, ALLOWED_KEYS, GEN_KEYS, usageOf, toolVerdict, modelErrorCode, sendOtlp, newTraceId, newSpanId } from "../src/turn-trace.js";
import { orFetchPath } from "../src/model.js";

const CANARY = "CANARY-7f3a91-do-not-send";
const log0 = console.log; console.log = (...a) => { if (/^ {2}ok /.test(a.join(" "))) log0(...a); };
let n = 0; const ok = (name) => log0(`  ok ${++n} ${name}`);

// ---- pure span building ----
{
  const t = new TurnTrace({ name: "chat turn", tenant: "tenant-1", session: "1h-abcdef0123456789", channel: "main", task: "task-9", turnNo: 3, kind: "chat", start: 1000 });
  assert.match(t.traceId, /^[0-9a-f]{32}$/); assert.match(t.rootId, /^[0-9a-f]{16}$/);
  const s1 = t.stepOpen(); const h = t.headers(s1);
  assert.deepEqual(h, { "cf-aig-otel-trace-id": t.traceId, "cf-aig-otel-parent-span-id": s1.id });
  t.stepClose(s1, { model: "vendor/model-x [route/floor]", inTok: 100, cached: 40, cacheWrite: 10, outTok: 7, finish: "tool_calls", calls: [1], providerCost: 0.000525, firstTokenAt: Date.UTC(2026, 9, 20, 23, 28, 30, 123) });
  const tool = t.tool("web_search", Date.now(), toolVerdict("hello world"));
  const bad = t.tool("run_command", Date.now(), toolVerdict(`error: ${CANARY}`));
  const s2 = t.stepOpen("tools_off"); t.stepClose(s2, null, Object.assign(new Error(CANARY), { orStatus: 502 }));
  t.finish({ outcome: "replied", steps: 2, tools: 2, charge: 12345678 });
  { const r = new TurnTrace({ kind: "chat" }), a = r.stepOpen(); a.retry = true; r.stepClose(a, { inTok: 1 }); assert.equal(a.name, "chat-retry"); assert.equal(a.attrs.step, 1); }
  const body = t.drain(); const spans = body.resourceSpans[0].scopeSpans[0].spans;
  const by = Object.fromEntries(spans.map((s) => [s.spanId, s])); const root = spans.find((s) => !s.parentSpanId);
  assert.equal(spans.length, 5); assert.equal(root.name, "chat turn"); assert.equal(root.spanId, t.rootId);
  for (const s of spans) { assert.equal(s.traceId, t.traceId); if (s.parentSpanId) assert.ok(by[s.parentSpanId], "parent exists"); }
  assert.deepEqual(spans.map((x) => x.name).sort(), ["chat", "chat", "chat turn", "run_command", "web_search"]);
  const get = (s, k) => s.attributes.find((a) => a.key === k)?.value;
  const stepNo = (n) => spans.find((s) => s.name === "chat" && get(s, "langfuse.observation.metadata.step").intValue === String(n)), step1 = stepNo(1), step2 = stepNo(2);
  assert.equal(step1.parentSpanId, root.spanId); assert.equal(by[spans.find((s) => s.name === "web_search").parentSpanId].spanId, step1.spanId);
  assert.equal(spans.find((s) => s.name === "run_command").parentSpanId, s1.id, "tools run after the step's model call, so the last step is their parent");
  assert.equal(get(root, "langfuse.trace.name").stringValue, "chat turn"); assert.equal(get(root, "langfuse.user.id").stringValue, "tenant-1");
  assert.equal(get(root, "langfuse.session.id").stringValue, "1h-abcdef0123456789"); assert.equal(get(root, "langfuse.trace.metadata.outcome").stringValue, "replied");
  assert.equal(get(root, "langfuse.trace.metadata.steps").intValue, "2"); assert.equal(get(root, "langfuse.trace.metadata.tool_count").intValue, "2");
  assert.equal(get(root, "langfuse.trace.metadata.error_count").intValue, "2"); assert.equal(get(root, "langfuse.trace.metadata.charge_nano").intValue, "12345678");
  assert.equal(get(step1, "langfuse.observation.metadata.in_tok").intValue, "100"); assert.equal(get(step1, "langfuse.observation.metadata.model").stringValue, "vendor/model-x");
  const bs = spans.find((s) => s.name === "run_command"); assert.equal(get(bs, "langfuse.observation.level").stringValue, "ERROR"); assert.equal(get(bs, "langfuse.observation.status_message").stringValue, "tool_error");
  assert.equal(get(bs, "langfuse.observation.type").stringValue, "tool"); assert.equal(bs.status.code, 2);
  assert.equal(get(step2, "langfuse.observation.status_message").stringValue, "http_502");
  // tokens are metadata only: no usage field Langfuse would add up, and no key outside the allowlist
  const all = JSON.stringify(body);
  // usage and cost live only on generations: the step (and the routing call), never on the root, a tool or any other span; and never as gen_ai.*
  assert.ok(!/gen_ai\./.test(all)); const withUsage = spans.filter((x) => get(x, GEN_KEYS.usage) != null).map((x) => x.name); assert.deepEqual(withUsage, ["chat"], "step 2 failed and has no usage; no tool or root has usage");
  assert.equal(get(step1, "langfuse.observation.type").stringValue, "generation"); assert.equal(get(step1, GEN_KEYS.model).stringValue, "vendor/model-x");
  const u = JSON.parse(get(step1, GEN_KEYS.usage).stringValue); assert.deepEqual(u, { input: 50, cache_read_input_tokens: 40, cache_creation_input_tokens: 10, output: 7 }); assert.equal(u.input + u.cache_read_input_tokens + u.cache_creation_input_tokens, 100, "the input* keys add up to the prompt total");
  assert.deepEqual(JSON.parse(get(step1, GEN_KEYS.cost).stringValue), { total: 0.000525 }); assert.equal(get(step1, GEN_KEYS.firstToken).stringValue, "2026-10-20T23:28:30.123Z");
  assert.equal(get(step2, GEN_KEYS.cost), undefined); assert.equal(get(step2, GEN_KEYS.firstToken), undefined);
  for (const s of spans) for (const a of s.attributes) assert.ok(ALLOWED_KEYS.has(a.key) || a.key === "service.name", a.key);
  assert.ok(!all.includes(CANARY), "no canary");
  // the decider as a generation, and without usage or cost when the endpoint gave none
  const t2 = new TurnTrace({ kind: "chat", session: "x", start: 1 });
  t2.routing({ model: "vendor/decider-1", cost: 0.00002, ms: 321, usage: { prompt_tokens: 900, completion_tokens: 12 }, answers: { category: CANARY } }, Date.now() - 321);
  t2.routing({ model: null, cost: 0, ms: 5, error: `decider: ${CANARY}` }, Date.now()); t2.span("routing", Date.now());
  const r2 = t2.drain().resourceSpans[0].scopeSpans[0].spans, rg = r2[0];
  assert.equal(get(rg, "langfuse.observation.type").stringValue, "generation"); assert.equal(get(rg, GEN_KEYS.model).stringValue, "vendor/decider-1"); assert.deepEqual(JSON.parse(get(rg, GEN_KEYS.usage).stringValue), { input: 900, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output: 12 });
  assert.deepEqual(JSON.parse(get(rg, GEN_KEYS.cost).stringValue), { total: 0.00002 }); assert.equal(get(r2[1], "langfuse.observation.level").stringValue, "ERROR"); assert.equal(get(r2[1], GEN_KEYS.usage), undefined); assert.equal(get(r2[1], GEN_KEYS.cost), undefined);
  assert.equal(get(r2[2], "langfuse.observation.type").stringValue, "span"); assert.ok(!JSON.stringify(r2).includes(CANARY));
  assert.equal(usageOf({}), null); assert.equal(usageOf({ inTok: -5, outTok: NaN }), null);
  assert.equal(t.drain(), null, "drain empties the queue");
  ok("span shape, nesting, metadata-only tokens, allowlist");
  assert.deepEqual(toolVerdict("x"), { ok: true, bytes: 1 }); assert.equal(toolVerdict("exit 2\nfail").ok, false); assert.equal(toolVerdict(null, Object.assign(new Error("boom " + CANARY), { name: "TypeError" })).code, "TypeError");
  assert.equal(toolVerdict(null, new Error("x y z")).code, "Error"); assert.equal(modelErrorCode(new Error("context " + CANARY)), "model_error"); assert.equal(modelErrorCode({ objectReset: true }), "interrupted");
  assert.equal(new TurnTrace({ kind: "chat" }).tool("bad name with " + CANARY, 0, { ok: true }).name, "unknown_tool");
  ok("verdicts and codes never carry text");
}

// ---- the gateway headers ----
{
  const seen = []; const fake = async (u, init) => { seen.push({ u, h: init.headers }); return new Response("{}"); };
  const env = { AIG_ID: "g", AIG_TOKEN: "t", CF_ACCOUNT_ID: "a", OPENROUTER_API_KEY: "k" }, tid = newTraceId(), sid = newSpanId();
  await orFetchPath(env, "chat/completions", { m: 1 }, { tenant: "x", _otel: { trace: tid, parent: sid } }, {}, null, fake);
  assert.equal(seen[0].h["cf-aig-otel-trace-id"], tid); assert.equal(seen[0].h["cf-aig-otel-parent-span-id"], sid);
  assert.ok(!seen[0].h["cf-aig-metadata"].includes("_otel"), "internal keys never go in the metadata header");
  await orFetchPath(env, "chat/completions", { m: 1 }, { tenant: "x" }, {}, null, fake); assert.equal(seen[1].h["cf-aig-otel-trace-id"], undefined);
  await orFetchPath(env, "chat/completions", { m: 1 }, { _otel: { trace: "nope", parent: "no" } }, {}, null, fake); assert.equal(seen[2].h["cf-aig-otel-trace-id"], undefined);
  ok("gateway headers set from the step span, ignored when malformed");
}

// ---- a real Resident running real turns ----
const d1 = new DatabaseSync(":memory:");
d1.exec("CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT, helper_name TEXT, first_name TEXT); INSERT INTO tenants VALUES ('t1','ck1','Ollie','Sam');");
const D1 = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => { const r = st.run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; } };
const sent = []; let endpoint = "ok";
globalThis.fetch = async (u, init = {}) => {
  if (String(u).startsWith("https://otel.test/")) {
    if (endpoint === "down") throw new TypeError("fetch failed");
    if (endpoint === "hang") return new Promise(() => {});
    sent.push({ auth: init.headers.authorization, body: JSON.parse(init.body) }); return new Response("{}", { status: endpoint === "500" ? 500 : 200 });
  }
  throw new Error(`unexpected fetch ${u}`);
};
const env = { DB: D1, WS: { get: async () => null, put: async () => {}, delete: async () => {} }, GATEWAY_HOST: "selfhost.example", APP_HOST: "selfhost.example", MEMORY: "off", GENUI: "off", WORKMEM: "off",
  APP_OTEL_URL: "https://otel.test/app/dev/v1/traces", APP_OTEL_TOKEN: "secret-token" };
const dodb = new DatabaseSync(":memory:");
const sql = { exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { dodb.exec(q); return { toArray: () => [], one: () => undefined }; }
  const st = dodb.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } };
const waits = []; const ctx = { storage: { sql, getAlarm: async () => null, setAlarm: async () => {} }, waitUntil: (p) => waits.push(p), id: { toString: () => "0123456789abcdef0123456789abcdef" } };
const R = new Resident(ctx, env); R.put("engine", "classic");
let script = [], hdrs = [], toolResult = `file contents ${CANARY}`, gate = null;
R.systemPrompt = async () => "SYSTEM";
R.callModelOnceInner = async function (messages, _w, onText, noTools, tc) {
  hdrs.push(this.otelMeta(tc));
  if (noTools && String(messages.at(-1)?.content).startsWith("(Turn finished")) return { content: JSON.stringify({ completed: ["n"], changed_files: [], key_facts: [], open_items: [], decisions: [], next_steps: [] }), calls: [], inTok: 1, cached: 0, outTok: 1, charge: 0, finish: "stop" };
  if (gate) { const g = gate; gate = null; await g; }
  const s = script.shift() ?? "Done.";
  if (s?.throw) throw Object.assign(new Error(s.throw), s.props || {});
  if (typeof s === "string") { onText?.(s); return { content: s, calls: [], inTok: 10, cached: 4, outTok: 3, charge: 1000, finish: "stop", model: "vendor/model-x", providerCost: 0.0004, firstTokenAt: Date.now() }; }
  return { content: "", calls: s.calls.map(([name, args], i) => ({ id: `call_${name}_${i}`, type: "function", function: { name, arguments: JSON.stringify(args) } })), inTok: 20, cached: 0, outTok: 5, charge: 2000, finish: "tool_calls", model: "vendor/model-x", providerCost: 0.0005, firstTokenAt: Date.now() };
};
R.localTool = async (name) => { if (name === "web_search") return toolResult; return toolResult; };
const flush = async () => { await Promise.all(waits.splice(0)); };
const taskId = async (t) => (await R.createSession(t)).id;
const spansOf = (i) => sent[i].body.resourceSpans[0].scopeSpans[0].spans;
const val = (s, k) => { const v = s.attributes.find((a) => a.key === k)?.value; return v && (v.stringValue ?? v.intValue ?? v.doubleValue ?? v.boolValue); };

{
  const s = await taskId("Trace task"); sent.length = 0; hdrs = [];
  script = [{ calls: [["web_search", { query: `find ${CANARY}` }]] }, `Here you go ${CANARY}`];
  const r = await R.runTurn("t1", "main", "1", `please look up ${CANARY}`, null, { session: s });
  await flush();
  assert.equal(r.steps, 2); assert.equal(sent.length >= 1, true); assert.equal(sent[0].auth, "Bearer secret-token");
  const spans = sent.flatMap((_, i) => spansOf(i)); const raw = JSON.stringify(sent.map((x) => x.body));
  assert.ok(!raw.includes(CANARY), "the canary in the message, the tool arguments, the tool result and the reply is nowhere in the OTLP JSON");
  const root = spans.find((x) => !x.parentSpanId), steps = spans.filter((x) => x.name === "chat" || x.name === "chat-retry"), tool = spans.find((x) => x.name === "web_search");
  assert.equal(root.name, "chat turn"); assert.equal(val(root, "langfuse.trace.metadata.outcome"), "replied"); assert.equal(Number(val(root, "langfuse.trace.metadata.steps")), 2);
  assert.equal(Number(val(root, "langfuse.trace.metadata.tool_count")), 1); assert.equal(Number(val(root, "langfuse.trace.metadata.turn")), 1);
  assert.equal(val(root, "langfuse.user.id"), "t1"); assert.equal(val(root, "langfuse.trace.metadata.task"), s.replace(/[^\p{L}\p{N} _.\-]/gu, "").slice(0, 64));
  assert.equal(steps.length, 2); assert.ok(steps.every((x) => x.parentSpanId === root.spanId)); assert.equal(tool.parentSpanId, steps.find((x) => Number(val(x, "langfuse.observation.metadata.step")) === 1).spanId);
  assert.equal(val(tool, "langfuse.observation.type"), "tool"); assert.equal(val(tool, "langfuse.observation.metadata.ok"), true); assert.equal(val(tool, "langfuse.observation.metadata.result_bytes"), Buffer.byteLength(toolResult));
  assert.equal(Number(val(steps[0], "langfuse.observation.metadata.in_tok")) + Number(val(steps[1], "langfuse.observation.metadata.in_tok")), 30);
  assert.ok(hdrs.filter((h) => h._otel).length >= 2 && hdrs.every((h) => !h._otel || h._otel.trace === root.traceId), "every model call carries the turn's trace id and a step span id");
  assert.ok(steps.some((x) => x.spanId === hdrs.find((h) => h._otel)._otel.parent), "the span id passed to the gateway is a step span of the same trace");
  assert.equal(val(root, "langfuse.session.id").length > 0, true);
  // each model call is one generation with usage, cost and first-token time; nothing else carries usage, so totals count once
  assert.ok(steps.every((x) => val(x, "langfuse.observation.type") === "generation" && val(x, GEN_KEYS.model) === "vendor/model-x" && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(val(x, GEN_KEYS.firstToken))));
  const used = spans.filter((x) => val(x, GEN_KEYS.usage) != null); assert.equal(used.length, hdrs.filter((h) => h._otel).length, "one usage-bearing span per model call");
  assert.equal(used.reduce((n, x) => n + JSON.parse(val(x, GEN_KEYS.usage)).input + JSON.parse(val(x, GEN_KEYS.usage)).cache_read_input_tokens, 0), 30);
  assert.deepEqual(steps.map((x) => JSON.parse(val(x, GEN_KEYS.cost)).total).sort(), [0.0004, 0.0005]);
  assert.ok(!spans.some((x) => (x === root || x === tool) && (val(x, GEN_KEYS.usage) != null || val(x, GEN_KEYS.cost) != null)));
  ok("a real turn: one trace, steps, a TOOL under its step, canary absent");
}
{
  // a tool that fails, and a model step that fails with a message holding the canary
  const s = await taskId("Fail task"); sent.length = 0; toolResult = `error: it broke ${CANARY}`;
  script = [{ calls: [["web_search", { q: "x" }]] }, { throw: `provider said ${CANARY}`, props: { orStatus: 503 } }];
  const r = await R.runTurn("t1", "main", "1", "go", null, { session: s }).catch((e) => ({ error: e.message }));
  await flush(); toolResult = `file contents ${CANARY}`;
  const spans = sent.flatMap((_, i) => spansOf(i)), raw = JSON.stringify(sent.map((x) => x.body));
  assert.ok(!raw.includes(CANARY), "error text never leaves");
  const tool = spans.find((x) => x.name === "web_search"), root = spans.find((x) => !x.parentSpanId);
  assert.equal(val(tool, "langfuse.observation.level"), "ERROR"); assert.equal(val(tool, "langfuse.observation.metadata.error_code"), "tool_error");
  assert.ok(Number(val(root, "langfuse.trace.metadata.error_count")) >= 2, "the tool and the failed step are counted"); assert.equal(val(root, "langfuse.trace.metadata.outcome"), "error");
  assert.ok(spans.some((x) => x.name === "chat" || x.name === "chat-retry" && val(x, "langfuse.observation.level") === "ERROR"));
  ok("tool and model errors: level ERROR, a short code, no text");
}
for (const mode of ["down", "500", "hang"]) {
  const s = await taskId(`Down ${mode}`); sent.length = 0; endpoint = mode; script = [{ calls: [["web_search", {}]] }, "All good."];
  const t0 = Date.now(); const r = await R.runTurn("t1", "main", "1", "hello", null, { session: s });
  assert.equal(r.reply, "All good."); assert.ok(!r.error, "the turn is unaffected"); assert.ok(Date.now() - t0 < 3000, "the turn does not wait for the send");
  if (mode !== "hang") await flush(); endpoint = "ok"; waits.length = 0;
}
ok("endpoint down, failing or hanging: the turn replies normally and never waits");
{
  // no token: nothing is sent and nothing breaks
  const s = await taskId("No token"); sent.length = 0; const keep = env.APP_OTEL_TOKEN; delete env.APP_OTEL_TOKEN; script = ["fine"];
  const r = await R.runTurn("t1", "main", "1", "hello", null, { session: s }); await flush(); env.APP_OTEL_TOKEN = keep;
  assert.equal(r.reply, "fine"); assert.equal(sent.length, 0);
  assert.equal(await sendOtlp({}, { a: 1 }), false);
  ok("no secret set: no send");
}
{
  // resume: the journal holds the trace id; a resumed run reads it back and keeps the trace, and a turn that parks sends no root
  const s = await taskId("Resume task"); sent.length = 0; const g = Promise.withResolvers(); gate = g.promise; script = ["Resumed answer."];
  const p = R.runTurn("t1", "main", "1", "long job", null, { session: s });
  await new Promise((z) => setTimeout(z, 50));
  const row = dodb.prepare("SELECT card, extra, started FROM turn_runs WHERE session=?").get(s); assert.ok(row, "turn is journaled");
  const saved = JSON.parse(row.extra).otel; assert.match(saved.trace, /^[0-9a-f]{32}$/); assert.match(saved.root, /^[0-9a-f]{16}$/);
  g.resolve(); await p; await flush();
  const first = sent.flatMap((_, i) => spansOf(i)); assert.ok(first.every((x) => x.traceId === saved.trace)); assert.ok(first.some((x) => x.spanId === saved.root), "the finished turn's root has the saved id");
  const tt = R.otelStart({ session: s, kind: "chat", t0: 5 }, "t1", "main", { resume: { extra: JSON.stringify({ otel: { ...saved, steps: 3, tools: 2, errors: 1, resumes: 0 } }), started: 123 } });
  assert.equal(tt.traceId, saved.trace); assert.equal(tt.rootId, saved.root); assert.equal(tt.stepSeq, 3); assert.equal(tt.resumes, 1); assert.equal(tt.start, 123); const s4 = tt.stepOpen(); assert.equal(s4.attrs.step, 4); assert.equal(s4.name, "chat"); assert.equal(tt.stepOpen(null, true).name, "chat-retry");
  const old = R.otelStart({ session: s, kind: "chat", t0: 5 }, "t1", "main", { resume: { extra: "{}", started: 9 } });
  assert.notEqual(old.traceId, saved.trace); assert.equal(old.resumes, 1, "an old journal without a trace id starts a new trace, marked as resumed");
  // a parked turn (objectReset) sends finished spans but no root
  sent.length = 0; const tp = new TurnTrace({ kind: "chat", session: "x", start: 1 }); tp.tool("web_search", Date.now(), { ok: true });
  R.otelEnd({ otel: tp, objectReset: true }, undefined, null); await flush();
  assert.equal(sent.length, 1); assert.ok(spansOf(0).every((x) => x.parentSpanId), "no root from a parked turn"); assert.equal(tp.sentRoot, false);
  ok("resume: trace id saved with the journal, read back, counters continue; a parked turn sends no root");
}
{
  // the hook route2.js calls: a decider answer becomes a generation, a skipped decider a plain span, a missing trace changes nothing
  const tc = { otel: new TurnTrace({ kind: "chat", session: "x", start: 1 }) };
  R.otelRouting(tc, { model: "vendor/decider-1", cost: 0.00001, ms: 40 }, Date.now()); R.otelRouting(tc, null, Date.now()); R.otelRouting({}, { model: "m" }, 0); R.otelRouting(null, null, 0);
  const sp = tc.otel.drain().resourceSpans[0].scopeSpans[0].spans; assert.deepEqual(sp.map((x) => [x.name, val(x, "langfuse.observation.type")]), [["decider", "generation"], ["routing", "span"]]);
  ok("routing hook: generation with the decider's model and cost, or a span when it did not run");
}

// ---- Custom Model Selection marker: short ids only, on the step generation and the root, canary clean ----
{
  assert.deepEqual(modelsMark(null), {}); assert.deepEqual(modelsMark({ category: "general" }), { models_from: "ours", category: "general" });
  assert.deepEqual(modelsMark({ custom: true, category: "general", dispatch: { category: "c_ab12cd34" } }), { models_from: "custom", category: "c_ab12cd34" });
  assert.equal(modelsMark({ custom: true, dispatch: { category: `Coding ${CANARY}` } }).category, "unknown", "a title or any text is never sent");
  const t = new TurnTrace({ name: "chat turn", tenant: "tenant-1", session: "s", channel: "main", task: "t", turnNo: 1, kind: "chat", start: 1000 });
  const mark = modelsMark({ custom: true, dispatch: { category: "c_ab12cd34" } });
  const s1 = t.stepOpen(null, false, mark); t.stepClose(s1, { model: "vendor/model-x", inTok: 5, outTok: 1 });
  const s2 = t.stepOpen(null, false, mark); t.stepClose(s2, null, Object.assign(new Error(CANARY), { orStatus: 502 }));
  t.finish({ outcome: "replied", charge: 0, mark });
  const body = t.drain(), spans = body.resourceSpans[0].scopeSpans[0].spans, g = (x, k) => x.attributes.find((a) => a.key === k)?.value.stringValue;
  for (const x of spans) { assert.equal(g(x, "langfuse.observation.metadata.models_from"), x.name === "chat turn" || x.name === "chat" ? "custom" : undefined); }
  assert.equal(g(spans[0], "langfuse.observation.metadata.category"), "c_ab12cd34"); assert.equal(g(spans[1], "langfuse.observation.metadata.models_from"), "custom", "the failed step is marked too");
  const root = spans.find((x) => x.name === "chat turn"); assert.equal(g(root, "langfuse.trace.metadata.models_from"), "custom"); assert.equal(g(root, "langfuse.trace.metadata.category"), "c_ab12cd34");
  for (const x of spans) for (const a of x.attributes) assert.ok(ALLOWED_KEYS.has(a.key) || a.key === "service.name", a.key);
  assert.ok(!JSON.stringify(body).includes(CANARY), "no canary");
  const o = new TurnTrace({ name: "chat turn", tenant: "t", session: "s", kind: "chat" }), s3 = o.stepOpen(null, false, modelsMark({ category: "general" })); o.stepClose(s3, { model: "m", inTok: 1, outTok: 1 });
  assert.equal(g(o.drain().resourceSpans[0].scopeSpans[0].spans[0], "langfuse.observation.metadata.models_from"), "ours");
  ok("custom marker: models_from and category on the step and root, ids only");
}
console.log = log0; log0("turn-trace: all passed");
