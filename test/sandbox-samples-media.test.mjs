// node --import ./test/stubs/register.mjs test/sandbox-samples-media.test.mjs
// The Models page sandbox samples of the media and memory jobs (src/sandbox-samples/media.js): one sample per assigned job, built with no network, the requests of our own code
// made by the real builder functions, every $file placeholder backed by a fixture on disk, and each request accepted by the real function the job calls (a faked OpenRouter and
// Workers AI answer at the edge, so nothing is sent anywhere).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { samples, HINDSIGHT_SNAPSHOT } from "../src/ee/sandbox-samples/media.js";
import { JOBS } from "../src/ee/model-jobs.js";
import { stt } from "../src/transcribe.js";
import { dispatch } from "../src/ee/model-dispatch.js";
import { LIVE_CHUNK_HEADERS } from "../src/transcribe-live-chunks.js";
import { embedRequest, chunkTexts, visionRequest, VISION_FORMAT, lookBodies } from "../src/sidecar.js";
import { chunksOf, sectionsOf } from "../src/sidecar-convert.js";
import { structuredBody } from "../src/structured-output.js";
import { searchRequest } from "../src/websearch.js";
import { cleanChatRequest } from "../src/ee/hindsight-llm.js";
import { plan } from "../src/ee/model-plan.js";
import { SEED, withSettings } from "./helpers/seed-settings.mjs";
import { VISION_SCHEMA } from "../src/sidecar.js";
import { checkGoldenShape } from "./helpers/golden-shape.mjs";
import { compareGolden } from "../app-assets/app-static/sandbox-golden.js";
// The public layout keeps the Cloud modules in src/ee, so a module named by its file is looked for there when it is not in src.
const srcPath = (f) => existsSync(new URL(`../src/${f}`, import.meta.url)) ? `../src/${f}` : `../src/ee/${f}`;

const ASSIGNED = ["stt", "stt_cloudflare", "live_dictation", "embed_files", "vision_files", "look", "web_search", "hs_retain", "hs_consolidation", "hs_reflect", "hs_refresh", "hs_rerank"];
const STATIC = new URL("../app-assets/app-static/sandbox/", import.meta.url);
const bytesOf = (name) => new Uint8Array(readFileSync(new URL(name, STATIC)));
const byJob = (id) => samples.find((s) => s.job === id);
const build = (s, env = {}) => s.build(env, { settings: SEED });
const noNetwork = () => { const real = globalThis.fetch; globalThis.fetch = async (url) => { throw new Error(`network call to ${url}`); }; return () => { globalThis.fetch = real; }; };

// Every { $file, as } in a request, in any depth.
function placeholders(x, out = []) {
  if (Array.isArray(x)) x.forEach((y) => placeholders(y, out));
  else if (x && typeof x === "object") { if (typeof x.$file === "string") out.push(x); else Object.values(x).forEach((y) => placeholders(y, out)); }
  return out;
}
const b64 = (u8) => Buffer.from(u8).toString("base64");
// What the page does before it sends: each placeholder becomes the file's content in the form named by "as".
function resolve(x, files) {
  if (Array.isArray(x)) return x.map((y) => resolve(y, files));
  if (!x || typeof x !== "object") return x;
  if (typeof x.$file === "string") {
    const f = files.find((y) => y.name === x.$file), u8 = bytesOf(f.name);
    return { base64: b64(u8), data_url: `data:${f.type};base64,${b64(u8)}`, bytes: u8, text: new TextDecoder().decode(u8) }[x.as];
  }
  return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, resolve(v, files)]));
}

test("exactly one sample for each assigned job, and each names a function that exists", async () => {
  assert.deepEqual(samples.map((s) => s.job).sort(), [...ASSIGNED].sort());
  for (const id of ASSIGNED) assert.ok(JOBS.some((j) => j.id === id), `${id} is a job`);
  for (const s of samples) {
    const [module, fn] = s.via.split("#");
    assert.match(s.via, /^[a-z-]+\.js#[A-Za-z]+$/, s.via);
    assert.equal(typeof (await import(srcPath(module)))[fn], "function", s.via);
  }
});

test("every sample builds with no network, and builds the same twice", async () => {
  const done = noNetwork();
  try {
    for (const s of samples) {
      const a = await build(s), b = await build(s);
      assert.deepEqual(a, b, `${s.job} builds the same each time`);
      assert.ok(a.request && typeof a.request === "object", s.job);
      assert.ok(Array.isArray(a.files), s.job);
      JSON.stringify(a.request);   // plain data: it has to be shown in a chat input
    }
  } finally { done(); }
});

test("every $file placeholder names a file the sample lists, and each fixture is on disk, small, and the kind its name says", async () => {
  for (const s of samples) {
    const { request, files } = await build(s);
    for (const p of placeholders(request)) {
      assert.ok(files.some((f) => f.name === p.$file), `${s.job} lists ${p.$file}`);
      assert.ok(["data_url", "base64", "bytes", "text"].includes(p.as), `${s.job}: ${p.as}`);
    }
    for (const f of files) {
      assert.ok(f.path.startsWith("/app-static/sandbox/") && f.path.endsWith(f.name), f.path);
      assert.ok(existsSync(new URL(f.name, STATIC)), `${f.name} exists`);
      assert.ok(statSync(new URL(f.name, STATIC)).size < 300 * 1024, `${f.name} is under 300 KB`);
    }
  }
  const head = (n, len) => Buffer.from(bytesOf(n).slice(0, len));
  assert.deepEqual([...head("sample-photo.jpg", 3)], [0xff, 0xd8, 0xff]);
  assert.equal(head("sample-page.png", 4).toString("latin1"), "\x89PNG");
  assert.equal(head("sample-doc.pdf", 5).toString("latin1"), "%PDF-");
  const wav = bytesOf("sample-speech.wav"), v = new DataView(wav.buffer);
  assert.equal(Buffer.from(wav.slice(0, 4)).toString(), "RIFF"); assert.equal(Buffer.from(wav.slice(8, 12)).toString(), "WAVE");
  assert.equal(v.getUint16(20, true), 1, "PCM"); assert.equal(v.getUint16(22, true), 1, "mono"); assert.equal(v.getUint32(24, true), 16000, "16 kHz"); assert.equal(v.getUint16(34, true), 16, "16 bit");
  const seconds = (wav.length - 44) / 32000; assert.ok(seconds >= 5 && seconds <= 10, `${seconds} seconds of speech`);
});

test("samples of our own code hold exactly what the real builders return", async () => {
  const audio = { $file: "sample-speech.wav", as: "bytes" };
  for (const job of ["stt", "stt_cloudflare", "live_dictation"]) {
    const r = (await build(byJob(job))).request;
    assert.equal(byJob(job).via, "transcribe.js#stt"); assert.deepEqual(r.src, { bytes: audio }); assert.equal(r.format, "wav"); assert.equal(r.job, job);
  }
  assert.deepEqual((await build(byJob("live_dictation"))).request.headers, LIVE_CHUNK_HEADERS);

  const photo = { $file: "sample-photo.jpg", as: "data_url" }, page = { $file: "sample-page.png", as: "data_url" };
  assert.deepEqual((await build(byJob("vision_files"))).request, structuredBody(visionRequest(photo), VISION_FORMAT.name, VISION_FORMAT.schema));
  assert.equal((await build(byJob("vision_files"))).request.response_format.json_schema.name, "image_description");
  const look = (await build(byJob("look"))).request;
  assert.deepEqual(look, lookBodies(page, { question: look.question }).answer); assert.equal(look.task, "query");
  const web = (await build(byJob("web_search"))).request;
  assert.deepEqual(web, searchRequest(web.query, web.limit)); assert.ok(web.query && web.limit > 0);
  const input = (await build(byJob("embed_files"))).request.input;
  assert.ok(Array.isArray(input) && input.length > 1 && input.every((t) => typeof t === "string" && t.length > 0 && t.length <= 6000));
  assert.deepEqual((await build(byJob("embed_files"))).request, embedRequest(input));
  const md = input.join("");
  assert.deepEqual(input, chunkTexts(md, chunksOf(md, sectionsOf(md))).length === input.length ? input : null, "the chunks come from the real chunker");
});

test("memory samples: a snapshot with a version and date, invented content only, and the shapes the server sends", async () => {
  assert.equal(HINDSIGHT_SNAPSHOT.version, "1.0.0"); assert.match(HINDSIGHT_SNAPSHOT.captured, /^\d{4}-\d{2}-\d{2}$/);
  for (const id of ["hs_retain", "hs_consolidation", "hs_reflect", "hs_refresh", "hs_rerank"]) {
    const { request, files } = await build(byJob(id));
    assert.equal(byJob(id).via, id === "hs_rerank" ? "model-dispatch.js#dispatch" : "hindsight-llm.js#cleanChatRequest"); assert.deepEqual(files, []);
    const text = JSON.stringify(request);
    assert.doesNotMatch(text, /Chk|example\.com|ckpool/, `${id} holds no account content`);
    assert.doesNotMatch(text, /dev-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-main(?<!00000000-0000-4000-8000-000000000000-main)/, `${id} names no real bank`);
    assert.deepEqual(placeholders(request), []);
  }
  const chat = (id) => build(byJob(id)).then((x) => x.request);
  const retain = await chat("hs_retain"), cons = await chat("hs_consolidation"), reflect = await chat("hs_reflect"), refresh = await chat("hs_refresh");
  assert.equal(retain.response_format.type, "json_schema"); assert.match(retain.messages[0].content[0].text, /^Extract SIGNIFICANT facts/);
  assert.match(retain.messages[1].content, /Extract facts from the following chunk\.\n\nChunk: 1\/1\nEvent Date: Monday, October 19, 2026/);
  assert.match(retain.messages[1].content, /Content:\n\[\{"speaker":"Sam \(user\)"/);
  assert.equal(cons.response_format.type, "json_object"); assert.equal(cons.temperature, 0); assert.match(cons.messages[1].content, /^Return valid json only\./);
  assert.ok(cons.messages[0].content[0].text.includes("_ConstrainedConsolidationBatchResponse") && cons.messages[1].content.includes("### New facts"));
  for (const r of [reflect, refresh]) { assert.equal(r.tools[0].function.name, "search_mental_models"); assert.equal(r.tool_choice, undefined, "the server's tool choice is not known, so none is sent"); assert.equal(r.tools.length, 1); assert.equal(r.messages.length, 2); assert.equal(r.temperature, 0.9); }
  assert.match(refresh.messages[1].content, /^Who are the people in Sam's life/, "the page question comes from the bank template");
  assert.match(refresh.messages[0].content[0].text, /document called "People"/);
  const rank = await chat("hs_rerank");
  assert.deepEqual(Object.keys(rank), ["state", "questions"]); assert.equal(rank.questions.rank.type, "choice");
  assert.deepEqual(Object.keys(rank.questions.rank.criteria), ["c0", "c1", "c2", "c3", "c4"]); assert.match(rank.state, /^Question: /);
});

// ---- each request through the real function the job calls, with the edges faked ----
const orReply = (path, body) => {
  if (path.endsWith("/audio/transcriptions")) return { text: "Hi Ollie.", duration: 7.8, segments: [{ start: 0, end: 7.8, text: "Hi Ollie." }], usage: { seconds: 7.8, cost: 0.0001 } };
  if (path.endsWith("/embeddings")) return { data: body.input.map((_, index) => ({ index, embedding: [0.1, 0.2] })), usage: { prompt_tokens: 10, cost: 0.00001 } };
  if (path.endsWith("/systemone")) return { model: "m", answers: { rank: { choice: "c2", probabilities: { c2: 1 } } }, usage: { cost: 0 } };
  return { model: "m", choices: [{ message: { role: "assistant", content: "{\"description\":\"d\",\"text\":\"t\"}" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2, cost: 0.001 } };
};
function fakeEdge() {
  const calls = [], real = globalThis.fetch, ai = [];
  globalThis.fetch = async (url, init = {}) => {
    const text = typeof init.body === "string" ? init.body : init.body ? await new Response(init.body).text() : "";
    calls.push({ url: String(url), body: text ? JSON.parse(text) : null });
    return new Response(JSON.stringify(orReply(String(url), text ? JSON.parse(text) : {})), { status: 200, headers: { "content-type": "application/json" } });
  };
  const env = withSettings({ ENV_NAME: "dev", OPENROUTER_API_KEY: "k", PROMPT_CACHE: "off", CF_ACCOUNT_ID: "acct", AIG_ID: "gw", AIG_TOKEN: "tok",
    AI: { run: async (model, input) => { ai.push({ model, input }); return { text: "ok", answer: "$545.60", caption: "c", transcription_info: { duration: 7.8 }, segments: [] }; },
      websearch: async (o) => { ai.push({ search: o }); return { ok: true, status: 200, items: [] }; } } });
  return { env, calls, ai, done: () => { globalThis.fetch = real; } };
}
// What the page does for each kind of via: stt takes the recording and its options, a chat body of the memory server is cleaned first, the rest go to the named function as they are.
async function callVia(s, env, sent, opts) {
  const [module, fn] = s.via.split("#"), f = (await import(srcPath(module)))[fn];
  if (fn === "stt") { const { src, ...o } = sent; return { ok: true, r: await f(env, src, { ...o, meta: opts.meta, models: opts.model ? [opts.model] : null }) }; }
  if (fn === "cleanChatRequest") return dispatch(env, s.job, f(sent, env.MODEL_SETTINGS, s.job), opts);
  return f(env, s.job, sent, opts);
}
const stepsOf = (env, job) => plan(env.MODEL_SETTINGS, job, { level: "zdr" }).steps;

test("each request is accepted by the function its sample names and reaches the model with its placeholders filled", async () => {
  const edge = fakeEdge();
  try {
    for (const s of samples) {
      const { request, files } = await build(s, edge.env);
      const sent = resolve(request, files), steps = stepsOf(edge.env, s.job), opts = { meta: { kind: s.meta.kind }, level: "zdr" };
      // A live dictation job may list a streaming model first: the sample is sent to the first model that takes a recording.
      const step = steps.find((x) => x.adapter !== "transcribe_live");
      const before = edge.calls.length + edge.ai.length;
      const r = await callVia(s, edge.env, sent, s.job === "live_dictation" ? { ...opts, model: step.model } : opts);
      assert.ok(r.ok !== false, `${s.job} answered`);
      assert.ok(edge.calls.length + edge.ai.length > before, `${s.job} reached a model`);
      const last = edge.calls.length > edge.ai.length ? edge.calls.at(-1) : null;
      if (s.job === "stt") assert.equal(last.body.input_audio.data, b64(bytesOf("sample-speech.wav")), "the audio is the fixture");
      if (s.job === "vision_files") assert.ok(JSON.stringify([edge.calls.at(-1), edge.ai.at(-1)]).includes(`data:image/jpeg;base64,${b64(bytesOf("sample-photo.jpg"))}`), "the picture is the fixture");
      if (s.job === "look") assert.equal(edge.ai.at(-1).input.image, `data:image/png;base64,${b64(bytesOf("sample-page.png"))}`);
      if (s.job === "stt_cloudflare") assert.equal(edge.ai.at(-1).input.audio, b64(bytesOf("sample-speech.wav")));
      if (s.job === "hs_rerank") assert.equal(last.body.state, request.state);
      if (s.job === "hs_retain") assert.deepEqual(last.body.messages.map((m) => m.role), ["system", "user"]);
    }
  } finally { edge.done(); }
});

test("the chat requests of the memory jobs keep their messages, tools and response format through the Worker's cleaning", async () => {
  for (const id of ["hs_retain", "hs_consolidation", "hs_reflect", "hs_refresh"]) {
    const { request } = await build(byJob(id)), kept = cleanChatRequest(request, SEED, id);
    for (const k of ["messages", "tools", "response_format"]) if (request[k] !== undefined) assert.deepEqual(kept[k], request[k], `${id} keeps ${k}`);
  }
});

test("each sample sends the gateway kind its call site sends", () => {
  const src = (f) => readFileSync(new URL(srcPath(f), import.meta.url), "utf8");
  const where = { stt: ["index.js", /kind: "transcribe"/], stt_cloudflare: ["index.js", /kind: "transcribe"/], live_dictation: ["transcribe-live.js", /kind: 'live-dictation'/],
    embed_files: ["sidecar.js", /kind: charge \? "sidecar-embed"/], vision_files: ["sidecar.js", /kind: `sidecar-vision-\$\{mode\}`/], look: ["sidecar.js", /kind: "browser-look"/], web_search: ["websearch.js", /kind: "web-search"/] };
  for (const [job, [file, re]] of Object.entries(where)) assert.match(src(file), re, `${job}: the call site in ${file}`);
  assert.equal(byJob("vision_files").meta.kind, "sidecar-vision-picture", "the picture mode");
  assert.match(src("sidecar.js"), /vision\(P\.env, meta, pic, "picture"\)/);
  const hs = src("hindsight-llm.js");
  assert.match(hs, /kind = `memory-\$\{rerank \? "rerank" : match\[1\] === "default" \? "check" : match\[1\]\}`/);
  const expected = { stt: "transcribe", stt_cloudflare: "transcribe", live_dictation: "live-dictation", embed_files: "sidecar-embed", vision_files: "sidecar-vision-picture", look: "browser-look", web_search: "web-search",
    hs_retain: "memory-retain", hs_consolidation: "memory-consolidation", hs_reflect: "memory-reflect", hs_refresh: "memory-refresh", hs_rerank: "memory-rerank" };
  for (const s of samples) assert.equal(s.meta?.kind, expected[s.job], s.job);
});

test("golden answers: well formed, only on jobs with a checkable answer, and each path or id is in the job's answer", async () => {
  for (const s of samples) {
    if (s.job === "embed_files") assert.equal(s.golden, undefined, "embed_files has no golden: a vector has no right value");
    else checkGoldenShape(s.job, s.golden);
  }
  const speech = ["stt", "stt_cloudflare", "live_dictation"].map((j) => byJob(j).golden);
  for (const g of speech) { assert.equal(g.type, "text"); assert.equal(g.field, null); assert.equal(g.value, speech[0].value); }
  assert.match(speech[0].value, /Maple Street Bakery invoice for four hundred and twelve dollars/);
  assert.ok(speech[0].max_wer > 0 && speech[0].max_wer <= 0.2);
  assert.equal(byJob("vision_files").golden.type, "contains"); assert.ok(byJob("vision_files").golden.field in VISION_SCHEMA.properties);
  assert.ok(byJob("vision_files").golden.value.includes("$72.88"));
  assert.deepEqual([byJob("look").golden.type, byJob("look").golden.field, byJob("look").golden.value], ["contains", null, ["545.60"]]);
  // Ranking: the golden is the reply's top candidate (c2), which shares fewer words with the question than another candidate.
  assert.deepEqual(byJob("hs_rerank").golden, { type: "choices", list: "", id: null, field: "top", value: { top: "c2" } });
  const rank = (await build(byJob("hs_rerank"))).request, crit = rank.questions.rank.criteria;
  const w = (t) => new Set(String(t).toLowerCase().match(/[a-z0-9']+/g)), q = w(rank.state.replace(/^Question: /, ""));
  const overlap = (id) => [...w(crit[id].replace(/^\[Date:[^\]]*\]\s*/, ""))].filter((x) => q.has(x)).length;
  const best = Math.max(...Object.keys(crit).map(overlap));
  assert.ok(overlap("c2") < best, "a candidate with more matching words is not the answer");
  // The memory and search goldens: what they expect is in the request the job sends, and their paths are in the reply shape the Sandbox shows.
  const asText = async (job) => JSON.stringify((await build(byJob(job))).request).toLowerCase();
  { const g = byJob("hs_retain").golden, t = await asText("hs_retain"); assert.equal(g.type, "contains"); assert.equal(g.field, null);
    for (const p of g.value) assert.ok(t.includes(p.toLowerCase()), `retain: ${p} is in the turn`); }
  { const g = byJob("hs_consolidation").golden, r = (await build(byJob("hs_consolidation"))).request, obs = JSON.parse(r.messages[1].content.split("### Existing observations")[1].trim());
    assert.deepEqual([g.type, g.list, g.match], ["items", "updates", ["observation_id"]]); assert.deepEqual(g.value, [{ observation_id: obs[0].id }], "the update names the existing observation");
    assert.match(JSON.stringify(r.messages[0]), /three arrays: `creates`, `updates`, `deletes`/, "the server prompt names the updates list"); assert.match(JSON.stringify(r.messages[1]), /pays the Maple Street Bakery invoice of \$412\.00 on Fridays/); }
  for (const job of ["hs_reflect", "hs_refresh"]) {
    const g = byJob(job).golden, names = (await build(byJob(job))).request.tools.map((t) => t.function.name);
    assert.deepEqual([g.type, g.list, g.match], ["items", "tool_calls", ["name"]]); assert.deepEqual(g.value, [{ name: "search_mental_models" }]); assert.equal(g.extras_fail, false, `${job}: repeat calls to the expected tool are fine`); assert.deepEqual(names, ["search_mental_models"], `${job}: the one tool offered`);
  }
  { const g = byJob("web_search").golden, q = (await build(byJob("web_search"))).request.query; assert.equal(g.type, "contains"); assert.equal(g.field, "results");
    assert.match(q, /python/i); assert.deepEqual(g.value, ["docs.python.org"]); }
  // End to end on the shapes: a stubbed reply of each job's kind is read and scored by the same code the Sandbox runs.
  const score = (job, view) => compareGolden(byJob(job).golden, view);
  assert.equal(score("hs_reflect", { type: "chat", text: "", tool_calls: [{ id: "1", name: "search_mental_models", arguments: { query: "allergies" } }] }).pass, true);
  assert.equal(score("hs_reflect", { type: "chat", text: "", tool_calls: [{ id: "1", name: "recall", arguments: {} }] }).pass, false);
  for (const job of ["hs_reflect", "hs_refresh"]) assert.equal(score(job, { type: "chat", text: "", tool_calls: [{ id: "1", name: "search_mental_models", arguments: { query: "a" } }, { id: "2", name: "search_mental_models", arguments: { query: "b" } }] }).pass, true, `${job}: two searches pass`);
  assert.equal(score("hs_rerank", { type: "ranking", order: null, answers: { rank: { probabilities: { c0: 0.2, c2: 0.8 }, choice: "c2" } } }).pass, true);
  assert.equal(score("hs_rerank", { type: "ranking", order: null, answers: { rank: { probabilities: { c0: 0.8, c2: 0.2 }, choice: "c0" } } }).pass, false);
  assert.equal(score("web_search", { type: "search", results: [{ title: "datetime", url: "https://docs.python.org/3/library/datetime.html", snippet: "" }] }).pass, true);
  assert.equal(score("web_search", { type: "search", results: [{ title: "x", url: "https://example.com/", snippet: "" }] }).pass, false);
  assert.equal(score("hs_consolidation", { type: "chat", text: JSON.stringify({ creates: [], updates: [{ observation_id: "3b6f9a14-52de-4c87-b0a3-91e7d2c48f65", source_fact_ids: [], text: "t", reason: "r" }], deletes: [] }), tool_calls: [] }).pass, true);
  assert.equal(score("hs_consolidation", { type: "chat", text: JSON.stringify({ creates: [{ text: "t" }], updates: [], deletes: [] }), tool_calls: [] }).pass, false);
  assert.equal(score("hs_retain", { type: "chat", text: JSON.stringify({ facts: [{ what: "Sam pays the Maple Street Bakery $412.00 invoice on Fridays; Priya is allergic to walnuts" }] }), tool_calls: [] }).pass, true);
});
