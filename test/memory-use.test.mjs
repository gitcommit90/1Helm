// node --import ./test/stubs/register.mjs test/memory-use.test.mjs
// Memory Overhaul phase 4A (the design notes HS_USE). Checks, with fakes and a stateful fake Hindsight:
//  A. Pure parts: the flag, the profile cache (keyed by last_refreshed_at, last good copy on a failed refresh or a read error, never cut), the wrapped memory block and
//     stripping it, the template (no topic models, no language rule), the recall tool arguments, the arm helpers (query is the message alone, lines).
//  B. The arms with fakes: arm B's request (types, prefer_observations, budget mid, max_tokens 800, query_timestamp),
//     a timeout or an error leaves the turn without memory and says why.
//  C. The Resident: the profile in the standing context (cached prefix, "how" notes verbatim, nightly note and 3,000 character slice gone), flag off unchanged,
//     the recall tool's arguments on the wire and the exact date list, memory_explain history.
//  D. A real turn on both engines: arm B adds memory to the turn context (never the system prompt), the answer path is unchanged in arm A and in
//     shadow mode, the shadow row, the added memory is stripped before the turn is retained, the dev only test setting and the ops route.
//  The correct_memory tool and arm C (topic models) were removed on 2026-10-15: a correction is an ordinary turn that Hindsight refines from.
import assert from "node:assert/strict"; import { DatabaseSync } from "node:sqlite";
import { world, tick } from "./deploy-harness.mjs";
import { hsUse } from "../src/hs-flag.js";
import { wrapMemory, stripInjectedMemory, MEM_OPEN, MEM_CLOSE } from "../src/memory-block.js";
import { fillTemplate, templateKey, TEMPLATE_VERSION } from "../src/hindsight-template.js";
import { cachedModelText, modelKey, autoQuery, packInjected, runArmB, recallArgs, dayStart, armOf, ARM_DEADLINE_MS, B_HEADER } from "../src/memory-use.js";
import { recall, mentalModelContent, memoriesList, memoryHistory } from "../src/hindsight.js";
import { convEntries } from "../src/hindsight-writers.js";
import { speakerLabels } from "../src/hindsight-template.js";
import { Resident } from "../src/resident.js";
import { CONTEXT_TOOLS, CONTEXT_TOOLS_USE, contextReceipt } from "../src/context.js";
import { staticCore, channelBlock } from "../src/prompt/index.js";
import { channelLayers } from "../src/prompt/context-layers.js";
import { pinnedBlock, ownNote } from "../src/pinned-notes.js";

const log0 = console.log, LOGS = []; console.log = (...a) => { if (/^ {2}ok /.test(a.join(" "))) log0(...a); else LOGS.push(a.join(" ")); };
process.on("exit", (c) => { if (c) log0(LOGS.slice(-40).join("\n")); });
const ok = (name) => console.log("  ok", name);
const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
const sleep = (ms) => new Promise((z) => setTimeout(z, ms));
// Waits for a background effect (the retain write) instead of guessing a delay: a fixed sleep is too short when the full suite loads the host.
const until = async (fn, ms = 10000) => { const end = Date.now() + ms; while (!fn() && Date.now() < end) await sleep(10); };
const text = (m) => typeof m.content === "string" ? m.content : m.content?.filter((p) => p.type === "text").map((p) => p.text).join("");
const store = () => { const m = new Map(); return { get: (k) => m.get(k), put: (k, v) => m.set(k, String(v)), m }; };

// ================= A. pure parts =================
{
  assert.equal(hsUse({ HS_USE: "on", HS_FOUNDATIONS: "on" }), true);
  assert.equal(hsUse({ HS_USE: "on" }), false, "needs HS_FOUNDATIONS: the models live in the template");
  assert.equal(hsUse({ HS_USE: "off", HS_FOUNDATIONS: "on" }), false); assert.equal(hsUse({}), false); assert.equal(hsUse(undefined), false);
  assert.equal(armOf({ HS_USE: "on", HS_FOUNDATIONS: "on", ENV_NAME: "dev" }, "B"), "B");
  assert.equal(armOf({ HS_USE: "on", HS_FOUNDATIONS: "on", ENV_NAME: "dev" }, "C"), "B2", "arm C was removed, so its setting is unknown");
  assert.equal(armOf({ HS_USE: "on", HS_FOUNDATIONS: "on", ENV_NAME: "live" }, "B"), "B", "armOf does not look at the environment; only the dev ops route can store a setting");
  assert.equal(armOf({ HS_USE: "on", HS_FOUNDATIONS: "on", ENV_NAME: "live" }, ""), "B2"); assert.equal(armOf({ HS_USE: "on", HS_FOUNDATIONS: "on", ENV_NAME: "dev" }, ""), "B2", "B2 is the default for every channel");
  assert.equal(armOf({ HS_USE: "on", HS_FOUNDATIONS: "on", ENV_NAME: "dev" }, "A"), "A", "dev can override to A");
  assert.equal(armOf({ HS_USE: "off", HS_FOUNDATIONS: "on", ENV_NAME: "dev" }, "B"), "A", "flag off");
  assert.equal(armOf({ HS_USE: "on", HS_FOUNDATIONS: "on", ENV_NAME: "dev" }, "zzz"), "B2", "an unknown setting falls back to the default");
  ok("A1. the flag needs HS_FOUNDATIONS; the arm override is dev only");
}
{
  // the profile cache
  const st = store(), T0 = 1e12; let reads = 0, model = { content: "Sam lives in Austin.", last_refreshed_at: "2026-10-14T10:00:00Z", last_refresh_failed_at: null };
  const read = async () => { reads++; if (model instanceof Error) throw model; return model; };
  const get = (now) => cachedModelText({ id: "profile", read, store: st, now });
  let r = await get(T0); assert.equal(r.text, "Sam lives in Austin."); assert.equal(r.source, "model"); assert.equal(reads, 1);
  r = await get(T0 + 60e3); assert.equal(reads, 1, "within the check interval nothing is read"); assert.equal(r.text, "Sam lives in Austin."); assert.equal(r.source, "cache");
  model = { ...model }; r = await get(T0 + 130e3); assert.equal(reads, 2, "after the interval the model is read again"); assert.equal(r.text, "Sam lives in Austin.");
  const before = JSON.parse(st.get(modelKey("profile")));
  // the same last_refreshed_at keeps the same text even when the content differs (the prompt prefix changes only when the model refreshes)
  model = { ...model, content: "Different text, same refresh time." }; r = await get(T0 + 300e3); assert.equal(r.text, "Sam lives in Austin.", "keyed by last_refreshed_at"); assert.equal(JSON.parse(st.get(modelKey("profile"))).refreshed, before.refreshed);
  // a real refresh replaces it
  model = { content: "Sam lives in Denver.", last_refreshed_at: "2026-10-14T12:00:00Z", last_refresh_failed_at: null }; r = await get(T0 + 500e3); assert.equal(r.text, "Sam lives in Denver."); assert.equal(r.refreshed, "2026-10-14T12:00:00Z");
  // a failed refresh keeps the last good copy, even if the model's own content changed meanwhile
  model = { content: "BROKEN HALF WRITTEN", last_refreshed_at: "2026-10-14T12:00:00Z", last_refresh_failed_at: "2026-10-14T13:00:00Z" }; r = await get(T0 + 700e3);
  assert.equal(r.text, "Sam lives in Denver."); assert.equal(r.stale, true, "a failed refresh keeps the last good copy");
  // a read error keeps it too, and the next read comes soon
  model = new Error("hindsight down"); r = await get(T0 + 900e3); assert.equal(r.text, "Sam lives in Denver."); assert.match(r.error, /down/);
  const again = reads; await get(T0 + 900e3 + 5e3); assert.equal(reads, again, "not read again within the retry delay"); model = { content: "Sam lives in Boston.", last_refreshed_at: "2026-10-14T15:00:00Z" }; r = await get(T0 + 900e3 + 40e3); assert.equal(r.text, "Sam lives in Boston.");
  // empty model, no copy → ""
  const s2 = store(); model = { content: "", last_refreshed_at: null };
  r = await cachedModelText({ id: "p", read, store: s2, now: T0 }); assert.equal(r.text, ""); assert.equal(r.source, "none");
  model = null; r = await cachedModelText({ id: "q", read, store: store(), now: T0 }); assert.equal(r.text, "", "a missing model is empty too");
  // a long model is not cut: Hindsight's max_tokens in the template limits it
  model = { content: "x".repeat(9000), last_refreshed_at: "2026-10-14T16:00:00Z" }; r = await cachedModelText({ id: "long", read, store: store(), now: T0 }); assert.equal(r.text.length, 9000);
  // a secret in a model's text never reaches a prompt
  model = { content: "Sam's wifi password is hunter2-Zebra-4491 and he lives in Austin.", last_refreshed_at: "2026-10-14T16:30:00Z" }; r = await cachedModelText({ id: "sec", read, store: store(), now: T0 }); assert.ok(!/hunter2-Zebra-4491/.test(r.text) && /Austin/.test(r.text), "scrubbed");
  // a refresh that repeats its own question is used as Hindsight wrote it: nothing here judges the text of a mental model
  { const SQ = "Who is Sam: their family and where they live."; model = { content: "## Overview\n\nSam – who is it, family and where they live.", last_refreshed_at: "2026-10-14T11:00:00Z", source_query: SQ };
    r = await cachedModelText({ id: "e2", read, store: store(), now: T0 }); assert.match(r.text, /who is it, family/); }
  // a failed refresh and no copy: the model's own last content is still the best there is
  model = { content: "Old but real.", last_refreshed_at: "2026-10-14T10:00:00Z", last_refresh_failed_at: "2026-10-14T11:00:00Z" }; r = await cachedModelText({ id: "nf", read, store: store(), now: T0 }); assert.equal(r.text, "Old but real."); assert.equal(r.stale, true);
  ok("A2. profile cache: keyed by last_refreshed_at, used within the check interval, last good copy on a failed refresh, a read error or an empty model; never cut, never judged");
}
{
  // the wrapped block and stripping
  const w = wrapMemory("Sam is allergic to peanuts."); assert.ok(w.startsWith(MEM_OPEN) && w.endsWith(MEM_CLOSE));
  assert.equal(wrapMemory(""), ""); assert.equal(wrapMemory("  \n"), "");
  assert.equal(stripInjectedMemory(`Build me a website\n\n${w}`), "Build me a website");
  assert.equal(stripInjectedMemory(`${w}\nAnswer: done\n${w}`), "Answer: done");
  assert.equal(stripInjectedMemory(`Hello ${MEM_OPEN}\nunterminated block that goes on`), "Hello", "an opening tag with no end removes the rest");
  assert.equal(stripInjectedMemory("no block here\n\n\nkept as it is"), "no block here\n\n\nkept as it is", "text with no tags is returned untouched");
  assert.equal(stripInjectedMemory(null), ""); assert.equal(stripInjectedMemory(undefined), "");
  // the conversation writer's choke point: nothing injected reaches Hindsight, and ordinary text is as before
  const L = speakerLabels({ first: "Sam", helper: "Ollie" });
  const e = convEntries({ userText: `Plan dinner\n${w}`, reply: `${w}\nHow about pasta?`, notes: `- note\n${w}`, at: 1e12, labels: L, tz: "UTC" });
  assert.equal(e.length, 3); assert.equal(e[0].text, "Plan dinner"); assert.equal(e[1].text, "How about pasta?"); assert.equal(e[2].text, "- note");
  assert.ok(!JSON.stringify(e).includes("injected-memory") && !JSON.stringify(e).includes("peanuts"), "the writer strips the memory block");
  assert.equal(convEntries({ userText: "just words", reply: "ok", at: 1e12, labels: L, tz: "UTC" })[0].text, "just words");
  ok("A3. memory added to a turn is wrapped, stripped before retain (also unterminated), ordinary text untouched");
}
{
  // templates
  const V = { first: "Sam", helper: "Ollie", channel: "main", purpose: "" };
  for (const kind of ["general", "channel"]) {
    const t = fillTemplate(kind, V);
    assert.ok(!("use_models" in t), "the topic models are gone from the template");
    const ids = t.mental_models.map((m) => m.id); assert.ok(!ids.some((id) => /^topic-/.test(id)), "no topic models");
    assert.ok(!JSON.stringify(t).match(/\{(first|helper|channel|purpose)\}/), "no placeholder left");
    for (const m of t.mental_models) assert.ok(m.source_query && m.max_tokens && m.trigger?.mode === "full" && m.trigger.refresh_cron === "0 10,22 * * *" && !("refresh_after_consolidation" in m.trigger), m.id);
  }
  assert.deepEqual(fillTemplate("general", V).mental_models.map((m) => m.id), ["profile", "routines", "active-tasks", "people", "places"]); assert.deepEqual(fillTemplate("channel", V).mental_models.map((m) => m.id), ["brief", "active-tasks", "decisions"]);
  assert.equal(TEMPLATE_VERSION, "p10-4", "a template change bumps the key of every bank, so each imports the new settings once");
  assert.ok(templateKey("general", V).startsWith("p10-4|"));
  ok("A4. templates: no topic models, one version key");
}
{
  // recall tool arguments
  const tz = "America/Los_Angeles";
  assert.deepEqual(recallArgs({ query: "x" }, tz), { types: null, range: null });
  assert.deepEqual(recallArgs({ types: ["observation", "world", "world"] }, tz).types, ["observation", "world"]);
  assert.deepEqual(recallArgs({ types: [] }, tz).types, null);
  assert.match(recallArgs({ types: ["opinion"] }, tz).error, /types must be a list of/); assert.match(recallArgs({ types: "world" }, tz).error, /types must be a list of/);
  const r = recallArgs({ from: "2026-10-03", to: "2026-10-09" }, tz).range;
  assert.equal(r.from, Date.parse("2026-10-03T00:00:00-07:00"), "a date is that local midnight");
  assert.equal(r.to, Date.parse("2026-10-10T00:00:00-07:00"), "to is the last day included (the next midnight)");
  assert.match(r.label, /Oct 3, 2026 to .*Oct 9, 2026/);
  assert.equal(recallArgs({ from: "2026-11-01", to: "2026-11-02" }, tz).range.to - recallArgs({ from: "2026-11-01", to: "2026-11-02" }, tz).range.from, 49 * 3600e3, "a daylight saving change: Nov 1 (25 hours) and Nov 2 span 49 hours in LA");
  assert.equal(dayStart(2026, 11, 1, tz), Date.parse("2026-11-01T00:00:00-07:00")); assert.equal(dayStart(2026, 11, 2, tz), Date.parse("2026-11-02T00:00:00-08:00"));
  assert.equal(recallArgs({ from: "2026-10-03T09:30:00Z" }, tz).range.from, Date.parse("2026-10-03T09:30:00Z"), "a full ISO time is used as it is");
  assert.equal(recallArgs({ from: "2026-10-03" }, tz).range.to, null); assert.equal(recallArgs({ to: "2026-10-03" }, tz).range.from, null);
  assert.match(recallArgs({ from: "last week" }, tz).error, /dates like 2026-10-03/); assert.match(recallArgs({ from: "2026-10-09", to: "2026-10-03" }, tz).error, /after from/);
  // the tool schema: the old one with the flag off, optional arguments with it on
  const old = CONTEXT_TOOLS.find((t) => t.function.name === "recall_memory"), nu = CONTEXT_TOOLS_USE.find((t) => t.function.name === "recall_memory");
  assert.deepEqual(Object.keys(old.function.parameters.properties), ["query"], "flag off: the schema is unchanged");
  assert.deepEqual(Object.keys(nu.function.parameters.properties), ["query", "types", "from", "to"]); assert.deepEqual(nu.function.parameters.required, ["query"]);
  assert.deepEqual(nu.function.parameters.properties.types.items.enum, ["world", "experience", "observation"]);
  assert.equal(CONTEXT_TOOLS_USE.length, CONTEXT_TOOLS.length); assert.deepEqual(CONTEXT_TOOLS_USE.filter((t) => t.function.name !== "recall_memory"), CONTEXT_TOOLS.filter((t) => t.function.name !== "recall_memory"));
  ok("A5. recall tool arguments: types checked, dates are local days (also across a daylight saving change), to is inclusive, old schema with the flag off");
}
{
  // arm helpers
  assert.equal(autoQuery("Build me a website", null), "Build me a website");
  assert.equal(autoQuery("and her?", { user: "My sister Dana visits", reply: "Nice, when?" }), "and her?", "the query is the message alone: no previous turn is added");
  assert.ok(autoQuery("x".repeat(5000)).length <= 2000);
  const lines = packInjected([{ type: "observation", text: "Sam prefers HTML for sites.", mentioned_at: "2026-10-03T12:00:00Z" }, { type: "world", text: "Sam is allergic to peanuts.", occurred_start: "2026-10-01T12:00:00Z", mentioned_at: "2026-10-05T12:00:00Z", context: "1Helm chat in #x between Sam" }], { tz: "UTC" });
  assert.match(lines, /^- \[Sat, Oct 3, 2026 · summary\] Sam prefers HTML/); assert.match(lines, /\[Thu, Oct 1, 2026 · fact\] Sam is allergic/); assert.ok(!lines.includes("1Helm chat"), "the context string is left out");
  assert.equal(packInjected([{ type: "world", text: "a".repeat(400) }, { type: "world", text: "b".repeat(400) }], { maxChars: 500 }).split("\n").length, 1, "limited by characters");
  assert.ok(packInjected([{ type: "world", text: "password is hunter2 and my api key is sk-abcdefghijklmnopqrstuvwx1234" }]).includes("[secret removed]") || !/hunter2/.test(packInjected([{ type: "world", text: "my password is hunter2" }])), "secrets are scrubbed");
  ok("A6. arm helpers: the message alone as the query, injected lines without context");
}

// ================= B. the arms with fakes =================
{
  const calls = []; let out = { results: [{ id: "o1", type: "observation", text: "Sam prefers plain HTML for websites.", mentioned_at: "2026-10-03T12:00:00Z" }, { id: "w1", type: "world", text: "Sam is allergic to peanuts.", mentioned_at: "2026-10-04T12:00:00Z" }], ms: 321 };
  const recallFn = async (q, o) => { calls.push({ q, o }); if (out instanceof Error) throw out; return out; };
  const now = Date.UTC(2026, 9, 14, 17);
  let r = await runArmB({ recall: recallFn, text: "Build me a website", now, tz: "UTC" });
  assert.equal(calls[0].q, "Build me a website", "no previous turn in the query");
  assert.deepEqual(calls[0].o, { types: ["observation", "world", "experience"], preferObservations: true, budget: "mid", maxTokens: 800, now, timeoutMs: ARM_DEADLINE_MS });
  assert.ok(r.block.startsWith(MEM_OPEN) && r.block.includes(B_HEADER) && r.block.includes("plain HTML") && r.block.endsWith(MEM_CLOSE));
  assert.equal(r.n, 2); assert.deepEqual(r.ids, ["o1", "w1"]); assert.equal(r.hs_ms, 321); assert.ok(!r.error);
  out = { results: [] }; r = await runArmB({ recall: recallFn, text: "x", now, tz: "UTC" }); assert.equal(r.block, "", "nothing recalled adds nothing");
  out = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }); r = await runArmB({ recall: recallFn, text: "x", now, tz: "UTC", deadlineMs: 50 });
  assert.equal(r.block, ""); assert.equal(r.timedOut, true); assert.match(r.error, /timeout/); assert.equal(calls.at(-1).o.timeoutMs, 50, "the deadline is the recall timeout");
  out = new Error("hindsight POST -> 500"); r = await runArmB({ recall: recallFn, text: "x", now, tz: "UTC" }); assert.equal(r.block, ""); assert.ok(!r.timedOut); assert.match(r.error, /500/);
  r = await runArmB({ recall: recallFn, text: "x", now, tz: "UTC", types: ["observation"] }); assert.deepEqual(calls.at(-1).o.types, ["observation"], "B2 asks for observations only");
  ok("B1. arm B: types, prefer_observations, budget mid, 800 tokens, query_timestamp, the deadline as timeout; empty, timeout and error add nothing");
}
// ================= a stateful fake Hindsight for the Resident parts =================
function fakeHs(o = {}) {
  const banks = new Map(), calls = [], failNext = [];
  const bank = (b) => { if (!banks.has(b)) banks.set(b, { models: new Map(), mem: new Map(), docs: new Map(), recallResults: o.recall || [], retains: [], history: new Map(), lists: [] }); return banks.get(b); };
  const HINDSIGHT = { fetch: async (u, init = {}) => {
    const url = new URL(u), m = init.method || "GET", p = decodeURIComponent(url.pathname).replace("/v1/default", ""), body = init.body ? JSON.parse(init.body) : null, key = `${m} ${p}${url.search}`;
    calls.push({ m, p, q: url.search, body, key });
    if (failNext.length && failNext[0].re.test(key)) { const f = failNext.shift(); return J({ detail: f.detail || "boom" }, f.status || 500); }
    let r;
    if (o.delay) await sleep(o.delay);
    if ((r = p.match(/^\/banks\/([^/]+)$/))) { if (m === "PUT") { bank(r[1]); return J({ bank_id: r[1] }); } if (m === "DELETE") { banks.delete(r[1]); return J({ success: true }); } }
    if ((r = p.match(/^\/banks\/([^/]+)\/import$/)) && m === "POST") { const b = bank(r[1]); b.config = body; for (const mm of body.mental_models || []) if (!b.models.has(mm.id)) b.models.set(mm.id, { id: mm.id, content: "", last_refreshed_at: null, last_refresh_failed_at: null }); return J({ mental_models_created: (body.mental_models || []).length }); }
    if ((r = p.match(/^\/banks\/([^/]+)\/mental-models$/)) && m === "GET") { const b = bank(r[1]); return J({ items: [...b.models.values()].map((x) => ({ id: x.id })) }); }
    if ((r = p.match(/^\/banks\/([^/]+)\/mental-models\/([^/]+)\/refresh$/)) && m === "POST") { const b = bank(r[1]), x = b.models.get(r[2]); if (!x) return J({ detail: "nf" }, 404); b.refreshed = [...(b.refreshed || []), r[2]]; x.content = x.content || `Refreshed ${r[2]}.`; x.last_refreshed_at = new Date().toISOString(); return J({ operation_id: "op" }); }
    if ((r = p.match(/^\/banks\/([^/]+)\/mental-models\/([^/]+)$/)) && m === "GET") { const x = bank(r[1]).models.get(r[2]); if (!x) return J({ detail: "nf" }, 404); return J(x); }
    if ((r = p.match(/^\/banks\/([^/]+)\/memories\/recall$/)) && m === "POST") { const b = bank(r[1]); return J({ results: typeof b.recallResults === "function" ? b.recallResults(body) : b.recallResults, entities: o.entities || {} }); }
    if ((r = p.match(/^\/banks\/([^/]+)\/memories\/list$/)) && m === "GET") { const b = bank(r[1]); b.lists.push(url.searchParams.toString()); const tf = url.searchParams.get("time_field"); return J({ items: (o.list || {})[tf] || [], total: ((o.list || {})[tf] || []).length }); }
    if ((r = p.match(/^\/banks\/([^/]+)\/memories\/([^/]+)\/history$/)) && m === "GET") { return J(bank(r[1]).history.get(r[2]) || []); }
    if ((r = p.match(/^\/banks\/([^/]+)\/memories\/([^/]+)$/))) { const b = bank(r[1]), x = b.mem.get(r[2]);
      if (m === "GET") return x ? J(x) : J({ detail: "nf" }, 404);
      if (m === "PATCH") { if (!x) return J({ detail: "nf" }, 404); if (x.type === "observation") return J({ detail: "observations are derived" }, 400); if (body.state === "invalidated") { x.state = "invalidated"; x.invalidation_reason = body.reason; b.invalidated = [...(b.invalidated || []), { id: r[2], reason: body.reason }]; } return J({ id: r[2], state: x.state }); } }
    if ((r = p.match(/^\/banks\/([^/]+)\/memories$/)) && m === "POST") { const b = bank(r[1]); b.retains.push(body); for (const i of body.items || []) b.docs.set(i.document_id, i); return J({ success: true, async: true, operation_id: body.operation_id || "op", items_count: (body.items || []).length }); }
    if ((r = p.match(/^\/banks\/([^/]+)\/operations$/))) return J({ operations: [] });
    if ((r = p.match(/^\/banks\/([^/]+)\/stats/))) return J({ pending_operations: 0, failed_operations: 0, pending_consolidation: 0, failed_consolidation: 0 });
    return J({ detail: `unhandled ${key}` }, 500);
  } };
  return { HINDSIGHT, calls, bank, failNext, banks, env: (x = {}) => ({ HINDSIGHT, HINDSIGHT_API_KEY: "k", MEMORY_BACKEND: "hindsight", ENV_NAME: "dev", HS_FOUNDATIONS: "on", HS_USE: "on", ...x }) };
}

// ---- the client additions on the wire ----
{
  const f = fakeHs({ list: { mentioned_at: [{ id: "m1", text: "x", fact_type: "world" }], occurred_start: [] }, entities: { Dana: { entity_id: "e1" } } }), env = f.env(), b = "dev-t1-main"; f.bank(b);
  f.bank(b).recallResults = [{ id: "r1", type: "world", text: "t" }];
  let r = await recall(env, b, "q"); let c = f.calls.at(-1).body;
  assert.deepEqual(Object.keys(c).sort(), ["budget", "include", "max_tokens", "query", "query_timestamp"], "old callers send the same request as before"); assert.deepEqual(c.include, { entities: null }); assert.equal(c.max_tokens, 2500); assert.ok(!("entities" in r));
  r = await recall(env, b, "q", { types: ["observation", "world", "bogus"], preferObservations: true, entities: true, budget: "low", maxTokens: 800, now: Date.UTC(2026, 9, 14) }); c = f.calls.at(-1).body;
  assert.deepEqual(c.types, ["observation", "world"]); assert.equal(c.prefer_observations, true); assert.deepEqual(c.include, { entities: {} }); assert.equal(c.budget, "low"); assert.equal(c.max_tokens, 800); assert.equal(c.query_timestamp, "2026-10-14T00:00:00.000Z"); assert.deepEqual(r.entities, { Dana: { entity_id: "e1" } });
  const m = await mentalModelContent(env, b, "profile"); assert.equal(m, null, "a missing model is null");
  f.bank(b).models.set("profile", { id: "profile", content: "Hi", last_refreshed_at: "2026-10-14T10:00:00Z", last_refresh_failed_at: null });
  assert.deepEqual(await mentalModelContent(env, b, "profile"), { content: "Hi", last_refreshed_at: "2026-10-14T10:00:00Z", last_refresh_failed_at: null, source_query: "", id: "profile" }); assert.match(f.calls.at(-1).key, /mental-models\/profile\?detail=content$/);
  const l = await memoriesList(env, b, { start: Date.UTC(2026, 9, 3), end: Date.UTC(2026, 9, 10), timeField: "mentioned_at", type: "world", limit: 500 }); const qs = new URLSearchParams(f.calls.at(-1).q);
  assert.equal(qs.get("start_date"), "2026-10-03T00:00:00.000Z"); assert.equal(qs.get("end_date"), "2026-10-10T00:00:00.000Z"); assert.equal(qs.get("time_field"), "mentioned_at"); assert.equal(qs.get("type"), "world"); assert.equal(qs.get("limit"), "200"); assert.equal(qs.get("state"), "valid"); assert.equal(l.items.length, 1);
  f.bank(b).history.set("o1", [{ previous_text: "old", changed_at: "2026-10-01T00:00:00Z" }]); assert.equal((await memoryHistory(env, b, "o1")).length, 1); assert.deepEqual(await memoryHistory(env, b, "zzz"), []);
  ok("hindsight client: recall options only when asked, mental model content, exact list parameters, history");
}

// ================= C. the Resident: profile, tool arguments, cut, history =================
const T = Date.UTC(2026, 9, 14, 17, 0);
function mk({ flag = "on", engine = "classic", server, notes = [], channel = "main", extraEnv = {} } = {}) {
  const f = server || fakeHs();
  const W = world({ engine, env: { CONTEXT_LAYOUT: "v2", RESUME_DELAY_MS: 0, RESUME_WRITE_DELAY_MS: 0, GENUI: "on", MEMORY: "on", ...f.env({ HS_USE: flag, HS_WRITERS: "on" }), ...extraEnv } });
  W.d1.exec("ALTER TABLE tenants ADD COLUMN helper_tone INTEGER; CREATE TABLE vault (tenant_id TEXT,name TEXT,hosts TEXT); CREATE TABLE logins (tenant_id TEXT,site TEXT,username TEXT);");
  W.d1.exec("CREATE TABLE IF NOT EXISTS hs_forget (bank TEXT NOT NULL, doc TEXT NOT NULL, due INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (bank, doc)); CREATE TABLE IF NOT EXISTS hs_rebuild_runs (bank TEXT PRIMARY KEY, tenant TEXT, channel TEXT, status TEXT NOT NULL, phase TEXT, version INTEGER, started_at INTEGER, updated_at INTEGER NOT NULL, summary TEXT);");
  const rows = notes, arch = { channel: async () => ({ channel: { name: channel, purpose: "Home base" }, memory: rows, messages: [] }), channels: async () => [{ id: 1, name: channel, slug: channel }, { id: 2, name: "recipes", slug: "recipes" }],
    wsRecall: async () => ({ pack: "", ids: [], people: [] }), homeNote: async () => "", reflectionNote: async () => ({ id: "reflect-how", content: "NIGHTLY: prefers short emails." }), peopleList: async () => [], noteRow: async (c, id) => rows.find((x) => x.id === id) || null };
  W.env.ARCHIVE = { idFromName: (n) => n, get: () => arch };
  const attach = (R) => { R.systemPrompt = Resident.prototype.systemPrompt; R.conns = async () => [];
    R.put("channel", channel); R.put("tenant", "t1"); R.put("channel_id", "1"); R.archive = () => arch; return R; };
  const boot = W.boot; W.boot = () => attach(boot()); attach(W.R); W.f = f; W.arch = arch;
  return W;
}
const mine = (id, content, sec, at, x = {}) => ({ id, content, kind: "preference", sec, author_type: "human", status: "current", created: at, ...x });
const agentNote = (id, content, sec, at) => ({ id, content, kind: sec === "how" ? "preference" : "fact", sec, author_type: "agent", status: "current", created: at });
{
  // the profile in the standing context
  const notes = [mine("n1", "Always send me a plan before you start. No exceptions, even for small jobs, and keep every line of the plan short.", "how", T - 5e6), mine("n2", "My dentist is Dr. Okafor on Elm Street.", "about", T - 4e6), agentNote("n3", "Prefers aisle seats", "how", T - 3e6), { id: "reflect-how", content: "NIGHTLY: prefers short emails.", kind: "preference", sec: "how", author_type: "agent", src: "reflection", status: "current", created: T - 9e6 }, ...Array.from({ length: 40 }, (_, i) => mine(`b${i}`, `Note ${i} about the broadcast team and their streaming schedule that is long enough to fill the budget nicely.`, "about", T - 1e6 - i))];
  const f = fakeHs(); const b = "dev-t1-main"; f.bank(b).models.set("profile", { id: "profile", content: "Sam lives in Austin with his wife Lilly. He is allergic to peanuts.", last_refreshed_at: "2026-10-14T10:00:00Z", last_refresh_failed_at: null });
  const W = mk({ server: f, notes }), R = W.R; R.memoryMode = () => "on";
  const p1 = await R.systemPrompt(true, false, true), standing = p1.standing;
  assert.equal(standing.memory_profile, "Sam lives in Austin with his wife Lilly. He is allergic to peanuts.", "the profile is in the standing context");
  assert.match(p1.developer, /memory_profile is what you already know about the person/);
  assert.ok(standing.pinned_notes.includes("- (you) Always send me a plan before you start. No exceptions, even for small jobs, and keep every line of the plan short."), "their own how note is pinned word for word");
  assert.ok(!standing.pinned_notes.includes("dentist") && !standing.pinned_notes.includes("Note 3") && !standing.pinned_notes.includes("aisle") && !standing.pinned_notes.includes("NIGHTLY"), "the 3,000 character slice, other notes and the nightly note are gone from the prompt");
  assert.ok(!/\+\d+ more note/.test(standing.pinned_notes));
  assert.equal(R._pinned.includes("Austin"), true, "the ask first guard reads the profile too");
  const reads = () => f.calls.filter((c) => /mental-models\/profile\?detail=content/.test(c.key)).length;
  assert.equal(reads(), 1);
  const p2 = await R.systemPrompt(true, false, true); assert.equal(JSON.stringify(p2.standing), JSON.stringify(standing), "the standing context is the same between refreshes"); assert.equal(reads(), 1, "and the model is not read again within the check interval");
  // a project channel reads "brief"
  const f2 = fakeHs(); f2.bank("dev-t1-recipes").models.set("brief", { id: "brief", content: "Recipes for the Okafor family.", last_refreshed_at: "2026-10-14T10:00:00Z" }); f2.bank("dev-t1-recipes").models.set("profile", { id: "profile", content: "NOT THIS", last_refreshed_at: "2026-10-14T10:00:00Z" });
  const W2 = mk({ server: f2, channel: "recipes", notes: [] }); W2.R.memoryMode = () => "on"; const q2 = await W2.R.systemPrompt(true, false, true); assert.equal(q2.standing.memory_profile, "Recipes for the Okafor family.", "a project channel reads its brief");
  // flag off: the old layout exactly (slice, nightly note, no profile key, no profile read)
  const f3 = fakeHs(); f3.bank(b).models.set("profile", { id: "profile", content: "SHOULD NOT SHOW", last_refreshed_at: "2026-10-14T10:00:00Z" });
  const W3 = mk({ flag: "off", server: f3, notes }); W3.R.memoryMode = () => "on"; const p3 = await W3.R.systemPrompt(true, false, true);
  assert.ok(!("memory_profile" in p3.standing), "flag off: no profile key, the prompt is as before"); assert.ok(!p3.standing.pinned_notes.includes("NIGHTLY"), "flag off: the old nightly note is never pinned (that job is gone)"); assert.ok(p3.standing.pinned_notes.includes("dentist"));
  assert.equal(f3.calls.filter((c) => /mental-models/.test(c.key)).length, 0, "flag off: no mental model is read"); assert.ok(!/memory_profile/.test(p3.developer));
  assert.ok(p3.standing.pinned_notes.length <= 3000 + 1700 + 200, "flag off: the 3,000 character slice");
  // the classic (non layered) block carries it too, and nothing when empty
  assert.match(channelBlock({ firstName: "Sam", pinned: "- (you) x", memoryProfile: "Sam is vegetarian." }), /What you already know about them[^\n]*\nSam is vegetarian\./); assert.doesNotMatch(channelBlock({ firstName: "Sam", pinned: "x" }), /What you already know about them/);
  assert.equal("memory_profile" in channelLayers({ channel: "x" }).data, false, "no key when there is no profile"); assert.equal(channelLayers({ channel: "x", memoryProfile: "p" }).data.memory_profile, "p");
  // memory off: nothing is read
  const f4 = fakeHs(); f4.bank(b).models.set("profile", { id: "profile", content: "x", last_refreshed_at: "2026-10-14T10:00:00Z" }); const W4 = mk({ server: f4, notes }); W4.R.memoryMode = () => "off"; const p4 = await W4.R.systemPrompt(true, false, true); assert.ok(!("memory_profile" in p4.standing)); assert.equal(f4.calls.length, 0);
  // refresh: the prompt changes only then; a failed refresh keeps the copy
  f.bank(b).models.set("profile", { id: "profile", content: "Sam moved to Denver.", last_refreshed_at: "2026-10-14T12:00:00Z", last_refresh_failed_at: null }); R.sql.exec("DELETE FROM kv WHERE k LIKE 'mu_m:%'");
  assert.equal((await R.systemPrompt(true, false, true)).standing.memory_profile, "Sam moved to Denver.");
  f.bank(b).models.set("profile", { id: "profile", content: "half written", last_refreshed_at: "2026-10-14T12:00:00Z", last_refresh_failed_at: "2026-10-14T13:00:00Z" }); R.put("mu_m:profile", JSON.stringify({ ...JSON.parse(R.get("mu_m:profile")), checked: 0 }));
  assert.equal((await R.systemPrompt(true, false, true)).standing.memory_profile, "Sam moved to Denver.", "a failed refresh: the last good copy");
  f.failNext.push({ re: /mental-models\/profile/, status: 500 }); R.put("mu_m:profile", JSON.stringify({ ...JSON.parse(R.get("mu_m:profile")), checked: 0 }));
  assert.equal((await R.systemPrompt(true, false, true)).standing.memory_profile, "Sam moved to Denver.", "a failed read: the last good copy");
  ok("C1. profile in the standing context: cached by last_refreshed_at, how notes verbatim, slice and nightly note replaced, project channels read the brief, flag off keeps the slice, memory off reads nothing");
}
{
  // a warm channel never waits for Hindsight: an old copy is used at once and read again in the background
  const f = fakeHs(), b = "dev-t1-main"; f.bank(b).models.set("profile", { id: "profile", content: "Version one.", last_refreshed_at: "2026-10-14T10:00:00Z" });
  const W = mk({ server: f }), R = W.R; R.memoryMode = () => "on"; const bg = []; R.ctx.waitUntil = (p) => bg.push(p);
  assert.equal(await R.hsProfile(), "Version one.", "no copy: the read is waited for"); const reads = () => f.calls.filter((c) => /mental-models\/profile/.test(c.key)).length; assert.equal(reads(), 1);
  f.bank(b).models.set("profile", { id: "profile", content: "Version two.", last_refreshed_at: "2026-10-14T12:00:00Z" }); R.put("mu_m:profile", JSON.stringify({ ...JSON.parse(R.get("mu_m:profile")), checked: Date.now() - 5 * 60e3 }));
  f.delay = 0; const t0 = Date.now(); assert.equal(await R.hsProfile(), "Version one.", "a copy older than the check interval is used at once"); assert.equal(bg.length, 1, "and read again in the background");
  assert.equal(await R.hsProfile(), "Version one.", "one background read at a time"); assert.equal(bg.length, 1);
  await Promise.all(bg); assert.equal(await R.hsProfile(), "Version two.", "the next turn sees the refresh"); assert.equal(reads(), 2);
  ok("C1b. profile: a warm channel is served from its copy and the read runs in the background; the next turn sees a refresh");
}
{
  // the prompt rule and its flag
  const on = staticCore({ context_v2: true, recall: true, use: true }), off = staticCore({ context_v2: true, recall: true });
  assert.match(on, /Use what you know about the person without saying that you remember it/); assert.match(on, /The result may show the constraint as a property of what you offer/); assert.match(on, /The reply never explains or cites the remembered fact or the reason for the choice/); assert.match(on, /Good: "Here are three weekend trips[^\n]*Bad: "Since you have a dog/);
  assert.doesNotMatch(off, /without saying that you remember it/); assert.doesNotMatch(off, /correct_memory/); assert.doesNotMatch(on, /correct_memory/); assert.doesNotMatch(on + off, /rewritten each night/, "the nightly note job is gone"); assert.match(on, /The notes the person wrote themselves are pinned/);
  ok("C2. the silent memory rule is in the prompt only with the flag; no correct_memory, no nightly note");
}
{
  // recall_memory on the wire
  const f = fakeHs({ list: { mentioned_at: [{ id: "m1", fact_type: "experience", text: "Sam mentioned the Lisbon trip.", mentioned_at: "2026-10-04T12:00:00Z" }], occurred_start: [{ id: "m1", fact_type: "experience", text: "Sam mentioned the Lisbon trip.", mentioned_at: "2026-10-04T12:00:00Z", occurred_start: "2026-10-05T12:00:00Z" }, { id: "m2", fact_type: "world", text: "Wedding in Lisbon.", occurred_start: "2026-10-06T12:00:00Z", mentioned_at: "2026-09-01T00:00:00Z" }] }, entities: { Dana: {}, Lisbon: {} }, recall: [{ id: "o1", type: "observation", text: "Sam travels to Lisbon in October.", mentioned_at: "2026-10-04T12:00:00Z", scores: { final: 0.1 } }] });
  const W = mk({ server: f }), R = W.R; R.memoryMode = () => "on"; R.put("tz", "America/Los_Angeles");
  const ctx = { context: { version: 2 }, session: "s1", turn: "t-1" };
  const out = await R.localToolInner("recall_memory", { query: "Lisbon trip", types: ["observation", "experience"], from: "2026-10-03", to: "2026-10-09" }, ctx);
  const rc = f.calls.find((c) => /^POST \/banks\/dev-t1-main\/memories\/recall/.test(c.key)).body;
  assert.deepEqual(rc.types, ["observation", "experience"]); assert.equal(rc.prefer_observations, true); assert.deepEqual(rc.include, { entities: {} }); assert.ok(rc.query_timestamp);
  assert.equal(rc.temporal_window.start, "2026-10-03T07:00:00.000Z", "the range also ranks the search"); assert.equal(rc.temporal_window.end, "2026-10-10T07:00:00.000Z");
  const lists = f.calls.filter((c) => /memories\/list/.test(c.key)); assert.equal(lists.length, 2, "two exact lists: learned in the range and happened in the range"); assert.deepEqual(lists.map((c) => new URLSearchParams(c.q).get("time_field")).sort(), ["mentioned_at", "occurred_start"]);
  assert.equal(new URLSearchParams(lists[0].q).get("start_date"), "2026-10-03T07:00:00.000Z");
  const rangeBlock = out.split("(Records in the date range you asked for, the exact list from memory:)\n")[1].split("\n(")[0];
  assert.equal(rangeBlock.split("\n").length, 1, "a record in both lists is one line, and the world fact is left out by the types filter"); assert.match(rangeBlock, /learned in that range and happened in that range\] Sam mentioned the Lisbon trip\./); assert.ok(!/Wedding in Lisbon/.test(out));
  assert.match(out, /Names in these records: Dana, Lisbon/); assert.match(out, /Sam travels to Lisbon in October/, "no score cut: a result scored 0.1 is shown");
  // default: all three types, prefer observations, no list, no temporal window unless the question has one
  f.calls.length = 0; await R.localToolInner("recall_memory", { query: "what is my favorite color" }, ctx); const rd = f.calls.find((c) => /^POST \/banks\/dev-t1-main\/memories\/recall/.test(c.key)).body;
  assert.deepEqual(rd.types, ["observation", "world", "experience"]); assert.equal(rd.prefer_observations, true); assert.ok(!("temporal_window" in rd)); assert.equal(f.calls.filter((c) => /memories\/list/.test(c.key)).length, 0);
  assert.match(await R.localToolInner("recall_memory", { query: "x", types: ["bogus"] }, ctx), /^error: types must be a list of/); assert.match(await R.localToolInner("recall_memory", { query: "x", from: "yesterday" }, ctx), /^error: from and to must be dates/);
  // flag off: the old request, extra arguments ignored
  const f2 = fakeHs({ recall: [{ id: "o1", type: "observation", text: "S", mentioned_at: "2026-10-04T12:00:00Z" }] }), W2 = mk({ flag: "off", server: f2 }); W2.R.memoryMode = () => "on";
  await W2.R.localToolInner("recall_memory", { query: "Lisbon", types: ["world"], from: "2026-10-03" }, ctx); const ro = f2.calls.find((c) => /^POST \/banks\/dev-t1-main\/memories\/recall/.test(c.key)).body;
  assert.ok(!("types" in ro) && !("prefer_observations" in ro) && !("temporal_window" in ro) && ro.include.entities === null, "flag off: the request is as before"); assert.equal(f2.calls.filter((c) => /memories\/list/.test(c.key)).length, 0);
  ok("C3. recall_memory: types, prefer_observations, entities, a date range as ranking window and exact lists, no score cut, invalid arguments refused, flag off as before");
}
{
  // crossChannelRecall: no score cut, flag on or off
  const rec = [{ id: "a", type: "world", text: "Low scored fact", mentioned_at: "2026-10-04T12:00:00Z", scores: { final: 0.12 } }];
  for (const flag of ["on", "off"]) {
    const f = fakeHs({ recall: rec }); f.bank("dev-t1-recipes"); const W = mk({ flag, server: f }), R = W.R; R.memoryMode = () => "on";
    const x = await R.crossChannelRecall("pasta", null); assert.equal(x.ids.length, 1, `flag ${flag}: the low scored result is kept`);
  }
  ok("C4. crossChannelRecall: the scores.final cut is gone, with the flag on or off");
}
{
  // memory_explain: an observation's history and source ids
  const f = fakeHs(); const b = "dev-t1-main"; f.bank(b).mem.set("o1", { id: "o1", type: "observation", text: "Sam lives in Denver.", mentioned_at: "2026-10-12T12:00:00Z", document_id: null, source_memories: [{ id: "w9", text: "Sam moved to Denver.", type: "world", mentioned_at: "2026-10-11T12:00:00Z" }] });
  f.bank(b).history.set("o1", [{ previous_text: "Sam lives in Austin.", changed_at: "2026-10-11T12:00:00Z" }]);
  const W = mk({ server: f }), R = W.R; R.memoryMode = () => "on";
  const { memoryExplain } = await import("../src/memory-explain.js");
  const out = await memoryExplain(R, { id: "hs:o1", about: "where" }, { general: true });
  assert.match(out, /History: this summary changed 1 time\. Before .*it said "Sam lives in Austin\."/); assert.match(out, /\[id hs:w9\]/, "the facts it is built from are listed by id");
  const f2 = fakeHs(); f2.bank(b).mem.set("o1", f.bank(b).mem.get("o1")); f2.bank(b).history.set("o1", [{ previous_text: "x", changed_at: "2026-10-11T12:00:00Z" }]);
  const W2 = mk({ flag: "off", server: f2 }); W2.R.memoryMode = () => "on";
  const off = await memoryExplain(W2.R, { id: "hs:o1", about: "where" }, { general: true }); assert.ok(!/History:/.test(off) && !/\[id hs:w9\]/.test(off) && !/correct_memory/.test(off), "flag off: as before"); assert.equal(f2.calls.filter((c) => /history/.test(c.key)).length, 0);
  ok("C5. memory_explain reads an observation's history and shows its source ids (flag on), unchanged with the flag off");
}

// ================= D. a real turn: the arms =================
for (const engine of ["classic", "pi"]) {
  const f = fakeHs({ recall: [{ id: "o1", type: "observation", text: "Sam prefers plain HTML for websites.", mentioned_at: "2026-10-03T12:00:00Z", scores: { final: 0.9 } }] }), b = "dev-t1-main";
  for (const id of ["profile", "routines", "active-tasks"]) f.bank(b).models.set(id, { id, content: id === "profile" ? "Sam, Austin." : `Notes for ${id}.`, last_refreshed_at: "2026-10-14T10:00:00Z", last_refresh_failed_at: null });
  const W = mk({ server: f, engine }), R = W.R; R.memoryMode = () => "on"; R.put("tz", "UTC");
  const turn = async (msg, session) => { W.calls.length = 0; W.brain = () => "Built it with plain HTML."; const r = await R.runTurn("t1", "main", "1", msg, null, { session: session || R.newSession("T") }); assert.ok(!r.error, r.error); return { r, call: W.calls.find((c) => c.who === "main") }; };
  const turnCtx = (call) => call.messages.find((m) => /^\[BEGIN TURN CONTEXT\]/.test(text(m))); const all = (call) => JSON.stringify(call.messages);
  // the default arm is B2: observations only, the memory goes in the turn context
  let { call } = await turn("Build me a website"); assert.match(text(turnCtx(call)), /Sam prefers plain HTML for websites/, `${engine}: the default arm B2 adds the observation`);
  assert.deepEqual(f.calls.filter((c) => /memories\/recall/.test(c.key)).at(-1).body.types, ["observation"], "the default is observations only");
  assert.equal(JSON.parse(W.turns().at(-1).trace).find((t) => t.tool === "memory_arm").args, "B2");
  // arm A (dev override): nothing added
  assert.equal((await R.memArmAdmin({ arm: "A" })).effective, "A"); f.calls.length = 0; ({ call } = await turn("Build me a website")); assert.ok(!turnCtx(call).content.includes("injected_memory") && !all(call).includes("injected-memory"), `${engine}: arm A adds nothing`);
  assert.equal(f.calls.filter((c) => /memories\/recall/.test(c.key)).length, 0, "no recall without an arm");
  // the dev only setting
  assert.deepEqual((await R.memArmAdmin({ arm: "B2" })).effective, "B2"); await turn("Build me a website"); assert.deepEqual(f.calls.filter((c) => /memories\/recall/.test(c.key)).at(-1).body.types, ["observation"], "arm B2: observations only");
  assert.deepEqual((await R.memArmAdmin({ arm: "B" })).effective, "B"); assert.equal(R.get("mem_arm"), "B");
  ({ call } = await turn("Build me a website"));
  const tcx = text(turnCtx(call)); assert.match(tcx, /injected_memory/); assert.match(tcx, /Sam prefers plain HTML for websites/); assert.match(tcx, /<injected-memory>/);
  assert.ok(!text(call.messages[0]).includes("plain HTML for websites") && !text(call.messages[1]).includes("plain HTML for websites") && !text(call.messages[2]).includes("plain HTML for websites"), `${engine}: never in the system prompt, the developer text or the standing context`);
  assert.equal(text(call.messages.at(-1)), "Build me a website", "the person's own message is unchanged");
  const rc = f.calls.filter((c) => /memories\/recall/.test(c.key)).at(-1).body; assert.deepEqual(rc.types, ["observation", "world", "experience"]); assert.equal(rc.prefer_observations, true); assert.equal(rc.budget, "mid"); assert.equal(rc.max_tokens, 800); assert.ok(rc.query_timestamp); assert.equal(rc.query, "Build me a website");
  const trace = JSON.parse(W.turns().at(-1).trace); const arm = trace.find((t) => t.tool === "memory_arm"); assert.ok(arm && arm.args === "B" && /"n":1/.test(arm.out), "the turn trace records the arm and its time"); assert.ok(Number.isFinite(arm.ms));
  assert.equal(contextReceipt({ ...{ sections: [] }, turn: { injected_memory: "x" } }, [], []).automatic_recall, true); assert.equal(contextReceipt({ sections: [], turn: {} }, [], []).automatic_recall, false);
  // retain: the added memory is never retained (the Hindsight writer and the turn row)
  await tick(); await until(() => JSON.stringify(f.bank(b).retains).includes("Build me a website")); await sleep(30); const retained = JSON.stringify(f.bank(b).retains); assert.ok(retained.includes("Build me a website"), "the conversation is retained"); assert.ok(!retained.includes("injected-memory") && !retained.includes("plain HTML for websites"), `${engine}: the added memory is not retained`);
  assert.ok(!JSON.stringify(W.turns().at(-1)).includes("injected-memory"), "nor saved in the turn row");
  // a follow up sends its own words alone: the previous turn is not added to the query
  f.calls.length = 0; await turn("and for my sister?", R.get("default_session") || undefined); assert.equal(f.calls.filter((c) => /memories\/recall/.test(c.key)).at(-1).body.query, "and for my sister?");
  // arm C no longer exists: its setting is refused
  assert.match((await R.memArmAdmin({ arm: "C" })).error, /arm must be A, B, B2 or default/);
  // flag off: the setting is ignored
  const off = mk({ flag: "off", server: fakeHs({ recall: [{ id: "o1", type: "world", text: "X" }] }), engine }); off.R.memoryMode = () => "on"; off.R.put("mem_arm", "B"); off.W; off.brain = W.brain; off.W2;
  off.brain = () => "ok"; const ro = await off.R.runTurn("t1", "main", "1", "Build me a website", null, { session: off.R.newSession("T") }); assert.ok(!ro.error); assert.ok(!JSON.stringify(off.calls).includes("injected-memory")); assert.equal(off.f.calls.filter((c) => /recall/.test(c.key)).length, 0, "flag off: no arm runs");
  assert.match(JSON.stringify(await off.R.memArmAdmin({ arm: "B" })), /HS_USE is off/);
  ok(`D1. ${engine}: arm A adds nothing; arms B and B2 add memory to the turn context only, with the right request; the added memory is not retained; flag off ignores the setting`);
}
{
  // the append task runtime builds its request from the same turn context (contextMessages over tc.context), so the added memory is a turn context field there too
  const { contextMessages } = await import("../src/context.js");
  const ms = contextMessages([{ role: "system", content: "x" }, { role: "user", content: "Build me a website" }], { version: 2, core: "core", developer: "dev", standing: { memory_profile: "Sam, Austin." }, turn: { time: "now", injected_memory: wrapMemory("Prefers plain HTML.") }, userText: "Build me a website", modelUserText: "Build me a website" });
  assert.deepEqual(ms.map((m) => m.role), ["system", "developer", "user", "user", "user"]); assert.match(ms[2].content, /memory_profile/); assert.match(ms[3].content, /^\[BEGIN TURN CONTEXT\][\s\S]*injected_memory[\s\S]*Prefers plain HTML/); assert.ok(!ms[0].content.includes("HTML") && !ms[1].content.includes("HTML")); assert.equal(ms[4].content, "Build me a website");
  ok("D4. the turn context message carries injected_memory and the profile rides in the standing context (the append lane uses the same assembly)");
}
{
  // the turn never waits past the deadline, whatever the arm is still doing
  const f = fakeHs({ recall: [{ id: "o1", type: "observation", text: "Slow memory.", mentioned_at: "2026-10-03T12:00:00Z" }], delay: 500 });
  const W = mk({ server: f, extraEnv: { HS_USE_DEADLINE_MS: "150" } }), R = W.R; R.memoryMode = () => "on"; await R.memArmAdmin({ arm: "B" });
  const h = R.memUseStart("Dinner?", { session: "s", turn: "tt" }); assert.equal(h.deadline, 150); const t0 = Date.now(); const j = await R.memUseJoin(h, { session: "s", turn: "tt" }); const took = Date.now() - t0;
  assert.ok(took < 400, `the join returned at the deadline (${took} ms), not when the recall finished`); assert.equal(j.block, ""); assert.equal(j.info.error, "deadline"); assert.ok(j.info.waited_ms < 400);
  const { armDeadline } = await import("../src/memory-use.js"); assert.equal(armDeadline({}), 1500); assert.equal(armDeadline({ HS_USE_DEADLINE_MS: "50" }), 1500); assert.equal(armDeadline({ HS_USE_DEADLINE_MS: "900" }), 900);
  { const rc = R.mem.stats().receipts.find((x) => x.turn === "tt"); assert.ok(rc && /^on:hindsight/.test(rc.mode), "the arm leaves a receipt with the recall mode, even when it timed out"); }
  ok("D2b. the active arm never holds the turn past the deadline (HS_USE_DEADLINE_MS, default 1500 ms)");
}
{
  // no shadow: the active arm is the only memory call of a turn
  const f = fakeHs({ recall: [{ id: "o1", type: "observation", text: "Sam is allergic to peanuts.", mentioned_at: "2026-10-03T12:00:00Z" }] });
  const W = mk({ server: f }), R = W.R; R.memoryMode = () => "on";
  await R.memArmAdmin({ arm: "A" });   // the dev override: arm A adds nothing and makes no recall
  W.brain = () => "Try lemon chicken."; const r = await R.runTurn("t1", "main", "1", "Let's find a good recipe for dinner!", null, { session: R.newSession("T") }); assert.ok(!r.error);
  const call = W.calls.find((c) => c.who === "main"); assert.ok(!JSON.stringify(call.messages).includes("injected-memory") && !JSON.stringify(call.messages).includes("peanut"), "arm A does not change what the model sees");
  await tick(); await sleep(60); assert.equal(f.calls.filter((c) => /memories\/recall/.test(c.key)).length, 0, "arm A: no recall call");
  await R.memArmAdmin({ arm: "default" }); f.calls.length = 0; W.calls.length = 0; await R.runTurn("t1", "main", "1", "Fourth", null, { session: R.newSession("T4") }); await until(() => f.calls.some((c) => /memories\/recall/.test(c.key))); await sleep(80);
  const rcs = f.calls.filter((c) => /memories\/recall/.test(c.key)).map((c) => c.body.types.join(",")); assert.deepEqual(rcs, ["observation"], "the default arm B2 makes one recall, for observations");
  assert.match(JSON.stringify(W.calls.find((c) => c.who === "main").messages), /injected-memory/, "the default B2 memory is in the turn");
  assert.ok(!("shadow" in R.memArmState()), "the arm state has no shadow setting");
  // a BYOK account never runs the arms
  const W2 = mk({ server: fakeHs({ recall: [] }), extraEnv: { BYOK: { fallback: null } } }); W2.R.memoryMode = () => "on"; assert.equal(W2.R.memUseStart("hi", { session: "s" }), null, "own AI key: memory costs their credits, so no extra calls");
  assert.equal(R.memUseStart("hi", { session: "s" }, { kind: "workflow" }), null, "only chat turns"); assert.equal(R.memUseStart("hi", { session: "s" }, { resumed: true }), null, "a resumed turn keeps its saved context");
  ok("D2. no shadow: arm A makes no recall, the default B2 makes one, and an own key account makes none");
}
// ================= E. the correction tool is gone =================
{
  const W = mk({}), R = W.R; R.memoryMode = () => "on";
  assert.ok(!R.availableTools(null).some((t) => t.function.name === "correct_memory"), "correct_memory is not offered");
  assert.match(await R.localToolInner("correct_memory", { reason: "yes yes", about: "x" }, { session: "s1", context: { version: 2 } }), /unknown tool correct_memory/);
  ok("E1. correct_memory is removed: a correction is an ordinary turn that Hindsight refines from");
}
console.log("memory-use: all checks passed");
