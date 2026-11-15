// node --import ./test/stubs/register.mjs test/sandbox-golden.test.mjs
// Golden answers (app-assets/app-static/sandbox-golden.js): reading a reply, comparing it with each golden type, checking a saved golden, and the server's store and route.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { replyOf, rankingOf, searchOf, toolCallsOf, getPath, compareGolden, scoreLine, wordErrors, cleanGolden } from "../app-assets/app-static/sandbox-golden.js";
import { goldenFor, saveGolden } from "../src/ee/sandbox-goldens.js";
import { modelsRoute } from "../src/ee/models-console.js";
import { samples } from "../src/ee/sandbox-samples/chat.js";
import { withSettings } from "./helpers/seed-settings.mjs";

const chat = (o) => ({ type: "chat", text: typeof o === "string" ? o : JSON.stringify(o), tool_calls: [] });

test("replyOf parses JSON text, keeps plain text, and reads transcripts and answers", () => {
  assert.deepEqual(replyOf(chat({ a: 1 })).parsed, { a: 1 });
  assert.deepEqual(replyOf(chat("[1,2]")).parsed, [1, 2]);
  assert.equal(replyOf(chat("{broken")).parsed, null);
  assert.equal(replyOf(chat("plain words")).parsed, null, "no tool calls leaves the parsed reply alone");
  assert.equal(replyOf(chat("plain words")).text, "plain words");
  assert.equal(replyOf({ type: "transcript", text: "hi there" }).text, "hi there");
  assert.deepEqual(replyOf({ type: "answers", answers: { 1: "x" } }).parsed, { 1: "x" });
  assert.deepEqual(replyOf(null), { parsed: null, text: "" });
  assert.deepEqual(replyOf({ type: "embedding", size: 3, first: [1] }), { parsed: null, text: "" });
});

test("getPath follows dotted paths and returns undefined when a step is missing", () => {
  const v = { a: { b: [{ c: 5 }] } };
  assert.equal(getPath(v, "a.b.0.c"), 5); assert.equal(getPath(v, ""), v); assert.equal(getPath(v, null), v);
  assert.equal(getPath(v, "a.x.c"), undefined); assert.equal(getPath(v, "a.b.4"), undefined); assert.equal(getPath(null, "a"), undefined);
});

const CH = { type: "choices", list: "answers", id: "id", field: "pick", options: ["yes", "no"], value: { q1: "yes", q2: "no", q3: "yes" } };
test("choices: one match per id, trimmed and case-insensitive; missing ids and malformed replies are misses", () => {
  const c = compareGolden(CH, chat({ answers: [{ id: "q1", pick: " YES " }, { id: "q2", pick: "yes" }, { id: "zz", pick: "no" }] }));
  assert.equal(c.got, 1); assert.equal(c.total, 3); assert.equal(scoreLine(c), "1 of 3 golden");
  assert.deepEqual(c.rows.map((r) => [r.label, r.ok, r.got]), [["q1", true, " YES "], ["q2", false, "yes"], ["q3", false, ""]]);
  const bad = compareGolden(CH, chat("not json at all"));
  assert.equal(bad.got, 0); assert.ok(bad.problem);
  assert.equal(compareGolden(CH, chat({ other: [] })).got, 0);
  const keyed = compareGolden({ type: "choices", list: "", id: null, field: "v", value: { a: "1", b: "2" } }, chat({ a: { v: "1" }, b: { v: "3" } }));
  assert.equal(keyed.got, 1);
  const flat = compareGolden({ type: "choices", list: "r", id: null, field: null, value: { a: "x" } }, { type: "answers", answers: { r: { a: "X" } } });
  assert.equal(flat.got, 1);
  assert.equal(compareGolden({ ...CH, value: { q1: "", q2: "  " } }, chat({})), null, "blank expected values are not scored");
});

const IT = { type: "items", list: "items", match: ["name", "qty"], value: [{ name: "Milk", qty: 2 }, { name: "Eggs", qty: 12 }, { name: "Milk", qty: 2 }] };
test("items: each reply item is used once, numbers compare as numbers, unmatched reply items are extras", () => {
  const c = compareGolden(IT, chat({ items: [{ name: " milk ", qty: "2" }, { name: "Eggs", qty: 11 }, { name: "Bread", qty: 1 }] }));
  assert.deepEqual(c.rows.map((r) => r.ok), [true, false, false], "the second Milk finds no unused reply item");
  assert.equal(c.got, 1); assert.equal(c.total, 3); assert.deepEqual(c.extras, ["Eggs | 11", "Bread | 1"]);
  assert.equal(scoreLine(c), "1 of 3 golden, 2 extra"); assert.equal(c.pass, false);
  const dup = compareGolden(IT, chat({ items: [{ name: "Milk", qty: 2 }, { name: "Milk", qty: 2 }, { name: "Eggs", qty: 12 }] }));
  assert.equal(dup.got, 3); assert.equal(dup.pass, true);
  assert.equal(compareGolden(IT, chat("oops")).problem, "The reply has no list to compare.");
  assert.equal(compareGolden({ ...IT, value: [{ name: "", qty: "" }] }, chat({})), null);
  assert.equal(compareGolden(IT, chat({ items: ["x", null, 3] })).got, 0, "non-object reply items never match");
});

test("text: word error rate after lowercasing and stripping punctuation, with the differing words", () => {
  const G = { type: "text", field: null, max_wer: 0.25, value: "Hello, world! This is a test." };
  const ok = compareGolden(G, { type: "transcript", text: "hello world this is a test" });
  assert.equal(ok.wer, 0); assert.equal(ok.pass, true);
  const near = compareGolden(G, { type: "transcript", text: "hello word this is a test" });
  assert.equal(Math.round(near.wer * 100), 17); assert.equal(near.pass, true); assert.deepEqual(near.diffs, [{ op: "sub", expected: "world", got: "word" }]);
  const far = compareGolden(G, { type: "transcript", text: "hello world is a test extra again" });
  assert.equal(far.pass, false); assert.deepEqual(far.diffs.map((d) => d.op), ["del", "ins", "ins"]);
  assert.match(scoreLine(far), /over the 25% limit/);
  assert.equal(wordErrors("a b", "").wer, 1); assert.equal(wordErrors("", "").wer, 0);
  assert.equal(compareGolden({ ...G, value: " " }, chat("x")), null);
  const field = compareGolden({ type: "text", field: "a.summary", max_wer: 0.1, value: "all good" }, chat({ a: { summary: "All good." } }));
  assert.equal(field.pass, true);
  assert.equal(compareGolden({ type: "text", field: "nope", value: "x" }, chat({ a: 1 })).pass, false);
  assert.equal(compareGolden({ type: "text", field: "a", value: "x" }, chat("plain")).problem, "The reply has no such field.");
});

test("contains with no field also searches tool call names and arguments; an explicit field does not", () => {
  const view = { type: "chat", text: "", tool_calls: [{ name: "remember", arguments: JSON.stringify({ fact: "Receipt total $72.88" }) }, { name: "write_file", arguments: { path: "a.html", content: "<h1>Chore Tick</h1>" } }] };
  assert.equal(compareGolden({ type: "contains", field: null, value: ["72.88", "chore tick", "remember"] }, view).pass, true, "phrases only in tool arguments and names pass");
  assert.equal(compareGolden({ type: "contains", field: null, value: ["nowhere"] }, view).pass, false);
  assert.equal(compareGolden({ type: "contains", field: "tool_calls.0.arguments.fact", value: ["72.88"] }, view).pass, true);
  assert.equal(compareGolden({ type: "contains", field: "tool_calls.0.arguments.fact", value: ["Chore Tick"] }, view).pass, false, "an explicit field reads only that field");
  assert.equal(compareGolden({ type: "contains", field: "missing", value: ["72.88"] }, view).pass, false);
  assert.equal(compareGolden({ type: "contains", field: null, value: ["alpha"] }, { type: "chat", text: "Alpha", tool_calls: [] }).pass, true, "reply text still counts");
});

test("contains: each phrase must appear, case-insensitively, in the whole reply or one field", () => {
  const G = { type: "contains", field: null, value: ["Receipt", "reminder", "  ", "refund"] };
  const c = compareGolden(G, chat("The receipt was added and a Reminder was set."));
  assert.equal(c.total, 3); assert.equal(c.got, 2); assert.deepEqual(c.rows.map((r) => r.ok), [true, true, false]);
  const f = compareGolden({ type: "contains", field: "why.1", value: ["receipt"] }, chat({ why: { 1: "It has a receipt." } }));
  assert.equal(f.pass, true);
  assert.equal(compareGolden({ type: "contains", field: "why.9", value: ["receipt"] }, chat({ why: {} })).problem, "The reply has no such field.");
  assert.equal(compareGolden({ type: "contains", field: null, value: [] }, chat("x")), null);
});

test("compareGolden ignores a missing or unknown golden", () => {
  assert.equal(compareGolden(null, chat("x")), null); assert.equal(compareGolden({ type: "other" }, chat("x")), null);
});

test("cleanGolden keeps the sample's structure and takes only the person's values, within bounds", () => {
  assert.deepEqual(cleanGolden(CH, { type: "x", list: "evil", value: { q1: "no" } }), { ...CH, value: { q1: "no" } });
  assert.throws(() => cleanGolden(CH, { value: ["a"] })); assert.throws(() => cleanGolden(CH, null)); assert.throws(() => cleanGolden(null, {}));
  assert.deepEqual(cleanGolden(IT, { value: [{ name: "A", qty: 3, junk: "x" }] }).value, [{ name: "A", qty: 3 }]);
  assert.throws(() => cleanGolden(IT, { value: ["x"] })); assert.throws(() => cleanGolden(IT, { value: new Array(201).fill({}) }));
  assert.equal(cleanGolden(IT, { value: [] }).extras_fail, undefined, "no flag stays unset");
  assert.equal(cleanGolden(IT, { value: [], extras_fail: false }).extras_fail, false); assert.equal(cleanGolden(IT, { value: [], extras_fail: true }).extras_fail, true);
  assert.equal(cleanGolden({ ...IT, extras_fail: false }, { value: [] }).extras_fail, false, "the sample's own flag is kept when the input has none");
  assert.throws(() => cleanGolden(IT, { value: [], extras_fail: "no" })); assert.throws(() => cleanGolden(IT, { value: [], extras_fail: 0 }));
  assert.equal(cleanGolden({ type: "contains", field: null, value: ["a"] }, { value: ["a"], extras_fail: false }).extras_fail, undefined, "only items goldens carry the flag");
  const T = { type: "text", field: null, max_wer: 0.1, value: "a" };
  assert.equal(cleanGolden(T, { value: "b", max_wer: 0.3 }).max_wer, 0.3); assert.equal(cleanGolden(T, { value: "b" }).max_wer, 0.1);
  assert.throws(() => cleanGolden(T, { value: "b", max_wer: 2 })); assert.throws(() => cleanGolden(T, { value: "x".repeat(20001) }));
  const P = { type: "contains", field: null, value: ["a"] };
  assert.deepEqual(cleanGolden(P, { value: ["x".repeat(600)] }).value[0].length, 500); assert.throws(() => cleanGolden(P, { value: [1] }));
});

// ---- the store and the route ----
const db = new DatabaseSync(":memory:");
const DB = { prepare(q) { const st = db.prepare(q); let a = []; const s = { bind(...v) { a = v; return s; }, async first() { return st.get(...a) || null; }, async all() { return { results: st.all(...a) }; }, async run() { st.run(...a); return { meta: { changes: 1 } }; } }; return s; } };
const SAMPLE = { golden: { type: "contains", field: null, value: ["alpha"] } };
test("a saved golden replaces the sample's, Reset returns to it, and an outdated saved golden falls back", async () => {
  const env = { DB };
  assert.deepEqual(await goldenFor(env, "j1", SAMPLE), { golden: SAMPLE.golden, default: SAMPLE.golden, saved: false });
  assert.equal(await goldenFor(env, "j1", {}), null);
  const r = await saveGolden(env, "j1", SAMPLE, { value: ["beta", "gamma"] }, "a@example.com");
  assert.equal(r.saved, true); assert.deepEqual(r.golden.value, ["beta", "gamma"]);
  assert.deepEqual((await goldenFor(env, "j1", SAMPLE)).golden.value, ["beta", "gamma"]);
  assert.deepEqual((await goldenFor(env, "j2", SAMPLE)).golden.value, ["alpha"], "per job");
  assert.equal((await goldenFor(env, "j1", { golden: { type: "text", field: null, value: "x" } })).saved, false, "a saved golden of another type is ignored");
  await assert.rejects(() => saveGolden(env, "j1", SAMPLE, { value: "no" }, "a"), { status: 400 });
  await assert.rejects(() => saveGolden(env, "j1", {}, { value: [] }, "a"), { status: 404 });
  assert.equal((await saveGolden(env, "j1", SAMPLE, null, "a")).saved, false);
  assert.equal((await goldenFor(env, "j1", SAMPLE)).saved, false);
});

test("a saved items golden keeps the extras_fail flag, and Reset returns to the sample's own", async () => {
  const env = { DB }, S = { golden: { type: "items", list: "tool_calls", match: ["name"], extras_fail: false, value: [{ name: "a" }] } };
  assert.equal((await goldenFor(env, "j9", S)).golden.extras_fail, false);
  assert.equal((await saveGolden(env, "j9", S, { value: [{ name: "b" }], extras_fail: true }, "a@example.com")).golden.extras_fail, true);
  const again = await goldenFor(env, "j9", S); assert.equal(again.saved, true); assert.equal(again.golden.extras_fail, true); assert.deepEqual(again.golden.value, [{ name: "b" }]);
  await assert.rejects(() => saveGolden(env, "j9", S, { value: [], extras_fail: "yes" }, "a"), { status: 400 });
  assert.equal((await saveGolden(env, "j9", S, null, "a")).golden.extras_fail, false); assert.equal((await goldenFor(env, "j9", S)).golden.extras_fail, false);
});

test("the golden route needs an administrator, exact origin proof and a job with a golden; the sample route carries the golden", async () => {
  const GOLD = { type: "contains", field: null, value: ["alpha"] };
  const saved = samples.find((s) => s.job === "label"); const had = saved && saved.golden; if (saved) saved.golden = GOLD;
  try {
    const env = withSettings({ ENV_NAME: "dev", MODEL_ADMINS: "admin@example.com", DB, waitUntil() {} }), admin = { email: "admin@example.com" };
    const post = (body, hdr = {}) => modelsRoute(new Request("https://models.example.test/models/api/sandbox/golden", { method: "POST", headers: { origin: "https://models.example.test", "x-model-settings": "1", "content-type": "application/json", ...hdr }, body: JSON.stringify(body) }), env, admin);
    assert.equal((await modelsRoute(new Request("https://models.example.test/models/api/sandbox/golden", { method: "POST", headers: { origin: "https://models.example.test", "x-model-settings": "1", "content-type": "application/json" }, body: "{}" }), env, { email: "other@example.com" })).status, 403);
    assert.equal((await post({ job: "label", golden: { value: ["x"] } }, { origin: "https://evil.example" })).status, 403);
    assert.equal((await post({ job: "nope", golden: { value: ["x"] } })).status, 404);
    assert.equal((await post({ job: "label", golden: { value: "bad" } })).status, 400);
    const ok = await post({ job: "label", golden: { value: ["kept"] } }); assert.equal(ok.status, 200);
    const sample = await (await modelsRoute(new Request("https://models.example.test/models/api/sandbox/sample?job=label"), env, admin)).json();
    assert.equal(sample.golden.saved, true); assert.deepEqual(sample.golden.golden.value, ["kept"]); assert.deepEqual(sample.golden.default.value, ["alpha"]);
    const reset = await (await post({ job: "label", golden: null })).json(); assert.equal(reset.saved, false);
    // dev and Live behave the same
    const live = withSettings({ ENV_NAME: "live", MODEL_ADMINS: "admin@example.com", DB, waitUntil() {} });
    assert.equal((await modelsRoute(new Request("https://models.example.test/models/api/sandbox/golden", { method: "POST", headers: { origin: "https://models.example.test", "x-model-settings": "1", "content-type": "application/json" }, body: JSON.stringify({ job: "label", golden: { value: ["l"] } }) }), live, admin)).status, 200);
  } finally { if (saved) { if (had) saved.golden = had; else delete saved.golden; } }
});

test("tool calls are addressable as tool_calls, with arguments parsed as an object", () => {
  const view = { type: "chat", text: "", tool_calls: [{ id: "a", name: "remember", arguments: { fact: "x", about: "me" } }, { id: "b", name: "schedule_followup", arguments: "{\"delay_seconds\":60}" }, { id: "c", name: "broken", arguments: "{no" }] };
  assert.deepEqual(toolCallsOf(view), [{ name: "remember", arguments: { fact: "x", about: "me" } }, { name: "schedule_followup", arguments: { delay_seconds: 60 } }, { name: "broken", arguments: "{no" }]);
  assert.deepEqual(getPath(replyOf(view).parsed, "tool_calls.1.arguments.delay_seconds"), 60);
  // The reply's own JSON text stays addressable beside the calls, and the calls win over a key of the same name.
  assert.deepEqual(replyOf({ ...view, text: "{\"a\":1,\"tool_calls\":5}" }).parsed.a, 1);
  assert.equal(replyOf({ ...view, text: "{\"tool_calls\":5}" }).parsed.tool_calls.length, 3);
  // items on the tool names: all expected tools called is a pass, an extra call or a missing one is not.
  const G = { type: "items", list: "tool_calls", match: ["name"], value: [{ name: "remember" }, { name: "schedule_followup" }] };
  const two = { ...view, tool_calls: view.tool_calls.slice(0, 2) };
  assert.equal(compareGolden(G, two).pass, true); assert.equal(scoreLine(compareGolden(G, two)), "2 of 2 golden");
  const three = compareGolden(G, view); assert.equal(three.pass, false); assert.deepEqual(three.extras, ["broken"]);
  const one = compareGolden(G, { ...view, tool_calls: [view.tool_calls[0]] }); assert.equal(one.got, 1); assert.equal(one.pass, false);
  // extras_fail: false lists the extras but does not fail the result; a missing expected item still fails.
  const loose = { ...G, extras_fail: false }, looseThree = compareGolden(loose, view);
  assert.equal(looseThree.pass, true); assert.deepEqual(looseThree.extras, ["broken"]); assert.equal(scoreLine(looseThree), "2 of 2 golden, 1 extra (allowed)");
  assert.equal(compareGolden({ ...G, extras_fail: true }, view).pass, false); assert.equal(scoreLine(compareGolden({ ...G, extras_fail: true }, view)), "2 of 2 golden, 1 extra");
  assert.equal(compareGolden(loose, { ...view, tool_calls: [view.tool_calls[0], view.tool_calls[0]] }).pass, false, "a missing expected item still fails");
  const R = { type: "items", list: "tool_calls", match: ["name"], extras_fail: false, value: [{ name: "search" }] };
  const twice = compareGolden(R, { type: "chat", text: "", tool_calls: [{ name: "search", arguments: { q: "a" } }, { name: "search", arguments: { q: "b" } }] });
  assert.equal(twice.pass, true); assert.equal(scoreLine(twice), "1 of 1 golden, 1 extra (allowed)");
  const none = compareGolden(G, { type: "chat", text: "I did it.", tool_calls: [] }); assert.equal(none.got, 0); assert.equal(none.problem, "The reply has no list to compare.");
  // choices and contains can target an argument.
  const C = { type: "choices", list: "tool_calls.1.arguments", id: null, field: "value", value: { delay_seconds: "60" } };
  assert.equal(compareGolden(C, two).pass, true); assert.equal(compareGolden({ ...C, value: { delay_seconds: "90" } }, two).pass, false);
  assert.equal(compareGolden({ type: "contains", field: "tool_calls.0.arguments.fact", value: ["x"] }, two).pass, true);
  assert.equal(compareGolden({ type: "contains", field: "tool_calls.0.arguments.fact", value: ["y"] }, two).pass, false);
});

test("a ranking reply is { order, top }, from probabilities, a choice, scores or the Sandbox order", () => {
  const prob = { type: "ranking", order: null, answers: { rank: { probabilities: { c0: 0.1, c2: 0.7, c1: 0.2 }, choice: "c2" } } };
  assert.deepEqual(rankingOf(prob), { order: ["c2", "c1", "c0"], top: "c2" });
  assert.deepEqual(rankingOf({ type: "ranking", answers: { rank: { choice: "c3" } } }), { order: ["c3"], top: "c3" });
  assert.deepEqual(rankingOf({ type: "ranking", answers: { a: { score: 1 }, b: { score: 4 } }, order: [{ id: "b", score: 4 }, { id: "a", score: 1 }] }), { order: ["b", "a"], top: "b" });
  assert.deepEqual(rankingOf({ type: "ranking", answers: null, order: [{ id: "z", score: 2 }] }), { order: ["z"], top: "z" });
  assert.deepEqual(rankingOf({ type: "ranking", answers: null, order: null }), { order: [], top: null });
  assert.deepEqual(replyOf(prob).parsed, { order: ["c2", "c1", "c0"], top: "c2" });
  // A choices golden on the top candidate, and items on the order.
  const G = { type: "choices", list: "", id: null, field: "top", value: { top: "c2" } };
  assert.equal(compareGolden(G, prob).pass, true);
  assert.equal(compareGolden(G, { ...prob, answers: { rank: { probabilities: { c2: 0.2, c0: 0.8 } } } }).pass, false);
  assert.equal(compareGolden({ type: "contains", field: "order.0", value: ["c2"] }, prob).pass, true);
});

test("a search reply is { results: [{ title, url, domain }] } and a golden can look for a domain", () => {
  const view = { type: "search", results: [{ title: "datetime", url: "https://docs.python.org/3/library/datetime.html", snippet: "s" }, { title: "Blog", url: "https://www.Example.com/a?b=1", snippet: "" }, { title: "odd", url: "not a url" }] };
  assert.deepEqual(searchOf(view), { results: [{ title: "datetime", url: "https://docs.python.org/3/library/datetime.html", domain: "docs.python.org" }, { title: "Blog", url: "https://www.Example.com/a?b=1", domain: "example.com" }, { title: "odd", url: "not a url", domain: "" }] });
  assert.deepEqual(searchOf({ type: "search" }), { results: [] });
  assert.equal(getPath(replyOf(view).parsed, "results.1.domain"), "example.com");
  assert.equal(compareGolden({ type: "contains", field: "results", value: ["docs.python.org"] }, view).pass, true);
  assert.equal(compareGolden({ type: "contains", field: "results", value: ["python.org/missing"] }, view).pass, false);
  const items = compareGolden({ type: "items", list: "results", match: ["domain"], value: [{ domain: "docs.python.org" }, { domain: "example.com" }] }, view);
  assert.equal(items.got, 2); assert.deepEqual(items.extras, [""], "items also reports results nobody expected");
});
