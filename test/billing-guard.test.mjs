// node --import ./test/stubs/register.mjs test/billing-guard.test.mjs
// Billing guard: when the model's price is saved, no step is ever settled at the reservation ceiling (model.js OR_RESERVE_PRICE).
// The looping step (stopped by the repeat guard, so OpenRouter returns no usage.cost) is the case that used to be charged at the
// ceiling. Each scenario runs twice on the real Resident, with OpenRouter faked at fetch: once with no saved price (the control:
// it must settle at the ceiling and write price_unknown, which proves the scenario can see a ceiling charge) and once with the
// saved price (every settle must be far below the ceiling, and no price_unknown event is written). Scenarios: the main turn, a
// workflow turn, and a helper, whose counted charge (what its cost limit compares) must be the real charge, not a ceiling charge.
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
import { Resident } from "../src/resident.js";
import { HANDOFF_PREFIX, JEV_URL } from "../src/ee/route2.js";
import { HELPER_MAX_CHARGE } from "../src/helpers.js";
import { unmark } from "./cache-unmark.mjs";

const say = console.log;
const d1 = new DatabaseSync(":memory:");
d1.exec(readFileSync(new URL("./fixtures/migrations/migrations_009.sql", import.meta.url), "utf8"));
d1.exec("CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT, helper_name TEXT, first_name TEXT, status TEXT, past_due_since INTEGER); INSERT INTO tenants VALUES ('t1','ck1','Ollie','Sam','active',NULL);");
d1.exec("CREATE TABLE resident_schedules (tenant_id TEXT, channel TEXT, channel_id TEXT, next_run INTEGER, updated_at INTEGER, PRIMARY KEY (tenant_id, channel))");
const D1 = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }),
  run: async () => { const r = st.run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; } };
const settled = [], unknownEvents = [];
const ledger = { reserve: async () => ({ ok: true }), settle: async (id, n) => { settled.push(n); return { ok: true }; }, notePriceUnknown: async (id, n) => { unknownEvents.push(n); } };
const env = { ONEHELM_EE: "1hc", DB: D1, GATEWAY_HOST: "selfhost.example", APP_HOST: "selfhost.example", MEMORY: "off", GENUI: "off", WORKMEM: "off", CLEF_DOORS: "off", OPENROUTER_API_KEY: "k", ROUTER_MODE: "two",
  MODEL: "@cf/zai-org/glm-5.3-flash", LEDGER: { idFromName: (n) => n, get: () => ledger }, AI: { run: async () => { throw new Error("workers ai must not be called"); } } };
const dodb = new DatabaseSync(":memory:");
const sql = { exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { dodb.exec(q); return { toArray: () => [], one: () => undefined }; }
  const st = dodb.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } };
const waits = [];
const ctx = { storage: { sql, getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {} }, waitUntil: (p) => waits.push(p), id: { toString: () => "res-test-0000000000000000000000" } };
const R = new Resident(ctx, env);
R.systemPrompt = async () => "SYSTEM"; R.syncFiles = async () => {}; R.deliverTextReply = async () => ({ ok: true });
R.computer = () => ({ warm: async () => ({ ok: true }), exec: async () => ({ code: 0, out: "ok" }), save: async () => ({}), touch: async () => {}, stop: async () => {} });
let toolOut = "ok";   // what a run_command returns; the helper scenario makes it large so its next step has a large input
let outN = 0; R.execComputerTool = async () => ({ code: 0, out: toolOut === "ok" ? "ok" : `${++outN} ` + toolOut.replace(/x/g, () => "abcdefghij"[Math.floor(Math.random() * 10)]) });
R.put("tenant", "t1"); R.put("channel", "main"); R.put("channel_id", "1");
const tick = (ms = 5) => new Promise((z) => setTimeout(z, ms));
async function settleAll() { for (let i = 0; i < 400; i++) { const n = waits.length; await Promise.all([...waits, ...(R._helperRuns || []), R._lastHandoff].filter(Boolean).map((p) => p.catch?.(() => {}) ?? p)); await tick(2); if (waits.length === n && ![...R.active.values()].some((t) => !t.finished)) break; } }

const enc = new TextEncoder(), ev = (e) => enc.encode(`data: ${JSON.stringify(e)}\n\n`);
const sse = (events) => new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n", { status: 200 });
// A stream that never ends on its own: the repeat guard stops it, so no usage.cost comes back.
function loopStream(model) {
  let i = 0; const day0 = Date.UTC(2026, 0, 1);
  return new Response(new ReadableStream({
    pull(c) {
      if (i > 200000) { c.close(); return; }
      if (i === 0) c.enqueue(ev({ model, choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "run_command", arguments: '{"command":"for d in ' } }] } }] }));
      const chunk = Array.from({ length: 20 }, () => new Date(day0 + (i++) * 864e5).toISOString().slice(0, 10)).join(" ") + " ";
      c.enqueue(ev({ model, choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: chunk } }] } }] }));
    },
  }), { status: 200 });
}
const userText = (messages) => messages.filter((m) => m.role === "user").map((m) => typeof m.content === "string" ? m.content : m.content?.[0]?.text || "").join("\n");
const scripts = { main: [], helper: [] };
globalThis.fetch = async (u, init = {}) => {
  u = String(u); const body = init.body ? unmark(JSON.parse(init.body)) : {};
  if (u === JEV_URL) return new Response(JSON.stringify({ answers: { is_task: { type: "noul", noul: 0.96 }, is_hard: { type: "noul", noul: 0.05 } }, usage: { cost: 0.000017 } }), { status: 200 });
  if (!u.endsWith("/chat/completions")) throw new Error(`unexpected fetch ${u}`);
  const last = body.messages.at(-1);
  if (typeof last.content === "string" && last.content.startsWith(HANDOFF_PREFIX)) return sse([{ model: body.model, choices: [{ delta: { content: "- notes" }, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 5, cost: 0.00001 } }]);
  if (!body.stream) return new Response(JSON.stringify({ model: body.model, choices: [{ message: { content: '{"title":"T","result":"Done","summary":"Done.","why":{}}' } }], usage: { cost: 0.0001 } }), { status: 200 });
  const t = userText(body.messages), who = /\[Helper job #\d+/.test(t) ? "helper" : "main";
  const s = scripts[who].shift() ?? "Done.";
  if (s === "LOOP") return loopStream(body.model);
  if (s && s.call) return sse([{ model: body.model, choices: [{ delta: { tool_calls: [{ index: 0, id: "r1", type: "function", function: { name: "run_command", arguments: JSON.stringify({ step_title: "Read the file", command: "cat big" }) } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 100, completion_tokens: 5, cost: 0.0001 } }]);
  if (s && s.start) return sse([{ model: body.model, choices: [{ delta: { tool_calls: [{ index: 0, id: "h1", type: "function", function: { name: "start_helper", arguments: JSON.stringify({ step_title: "Started a helper: Big", name: "Big", task: "summarize the big file" }) } }] } }], usage: { prompt_tokens: 100, completion_tokens: 5, cost: 0.0001 } }]);
  return sse([{ model: body.model, choices: [{ delta: { content: String(s) }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 5, cost: 0.0001 } }]);
};

const BIG = "x ".repeat(230000);   // a large tool result: the helper's next (looped) step then has about 150,000 estimated input tokens, so a ceiling charge exceeds its $0.50 limit
const log0 = console.log; console.log = () => {};
let ceilingMax = 0;
// A saved catalog that has a price ($0.10 in / $0.40 out per million tokens) for every model name asked about.
const everyModel = new Proxy({}, { get: (_, k) => (typeof k === "string" ? { pricing: { prompt: 0.1, completion: 0.4 } } : undefined) });
// Runs one scenario with and without a saved price. `go` runs the work and returns the helper row or null.
async function both(name, engine, go) {
  R.put("engine", engine);
  const orig = R.savedCatalog, out = {};
  try {
    for (const known of [false, true]) {
      R.savedCatalog = known ? async () => everyModel : async () => null;
      settled.length = 0; unknownEvents.length = 0;
      const res = await go(known); await settleAll();
      out[known ? "known" : "unknown"] = { max: Math.max(0, ...settled), events: unknownEvents.length, res };
    }
  } finally { R.savedCatalog = orig; }
  const u = out.unknown, k = out.known;
  assert.ok(u.max > 1e6 && u.events > 0, `${engine} ${name}: control (no saved price) must settle at the ceiling and write price_unknown (max ${u.max}, events ${u.events})`);
  assert.equal(k.events, 0, `${engine} ${name}: a price_unknown event was written although the price is saved`);
  assert.ok(k.max > 0 && k.max < u.max / 10, `${engine} ${name}: a step was settled near the ceiling with a saved price (${k.max} vs ceiling ${u.max})`);
  log0("ok -", `${engine}: ${name}: ceiling ${u.max} nano without a saved price, ${k.max} with it`);
  return out;
}
try {
  for (const engine of ["classic", "pi"]) {
    // 1. main turn
    await both("main turn", engine, async () => { scripts.main = ["LOOP", "Short range."]; return R.runTurn("t1", "main", "1", "list every day from 2026 to 2052", () => {}, { session: R.newSession("m") }); });
    // 2. workflow turn
    await both("workflow turn", engine, async () => { scripts.main = ["LOOP", "Workflow done.", "Workflow done."]; return R.runTurn("t1", "main", "1", "Synthetic workflow.", null, { kind: "workflow", workflow_id: 43 }); });
    // 3. helper: its loop step is stopped; the helper's cost limit must count the real charge, so with a saved price it ends "done", not "cost limit"
    const out = await both("helper", engine, async () => {
      scripts.main = [{ start: 1 }, "A helper is on it."]; scripts.helper = [{ call: 1 }, { call: 1 }, { call: 1 }, { call: 1 }, { call: 1 }, { call: 1 }, "LOOP", "Report: summarized."]; toolOut = BIG;
      const s = R.newSession("h"); await R.runTurn("t1", "main", "1", "summarize the big file in the background", () => {}, { session: s }); await settleAll();
      toolOut = "ok"; return dodb.prepare("SELECT * FROM helpers ORDER BY id DESC").get();
    });
    const hu = out.unknown.res, hk = out.known.res;
    assert.ok(hu && hk, `${engine}: the helper started`);
    // The cost limit compares the helper's counted charge with HELPER_MAX_CHARGE. A helper's input is bounded (a 6,000 character snapshot, clipped tool
    // results), so one ceiling-priced step is about $0.14, under the $0.50 limit; the counted charge is what decides the limit, and it must be the real one.
    assert.ok(hu.charge_nano > hk.charge_nano * 10, `${engine}: control helper counts the ceiling charge (${hu.charge_nano} vs ${hk.charge_nano})`);
    assert.ok(hk.charge_nano < HELPER_MAX_CHARGE / 10, `${engine}: the helper's counted charge is the real one (${hk.charge_nano})`);
    assert.notEqual(hk.why, "cost limit", `${engine}: a ceiling charge stopped a helper that spent little`);
    const turnCharge = dodb.prepare("SELECT charge_nano FROM turns WHERE id=?").get(hk.card)?.charge_nano;
    assert.equal(hk.charge_nano, turnCharge, `${engine}: helper charge equals the helper turn's settled charge`);
    log0("ok -", `${engine}: the helper's cost limit counts the real charge (${hk.charge_nano} nano), not the ceiling (${hu.charge_nano})`);
  }
  // The daily flag (billing-flag.js) sees the ceiling-charged control turns and not the correctly priced ones, and writes nothing.
  R.savedCatalog = async () => everyModel;
  const before = dodb.prepare("SELECT COUNT(*) n, SUM(charge_nano) s FROM turns").get(), flagged = await R.billingFlags(0), after = dodb.prepare("SELECT COUNT(*) n, SUM(charge_nano) s FROM turns").get();
  const big = dodb.prepare("SELECT COUNT(*) n FROM turns WHERE charge_nano>=1000000").get().n;
  assert.ok(flagged.length >= 6 && flagged.length < big, `the flag finds the ceiling-charged turns only (${flagged.length} of ${big} charged turns)`);
  assert.deepEqual(after, before, "the flag changes no charge");
  log0("ok -", `daily flag: ${flagged.length} of ${big} charged turns flagged, all ceiling-charged; nothing changed`);
} finally { console.log = log0; }
console.log("billing-guard: all ok");
