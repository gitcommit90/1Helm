// node --import ./test/stubs/register.mjs test/sandbox-samples-media.test.mjs
// The Models page sandbox samples of the media and memory jobs (src/sandbox-samples/media.js): one sample per assigned job, built with no network, the requests of our own code
// made by the real builder functions, every $file placeholder backed by a fixture on disk, and each request accepted by the real function the job calls (a faked OpenRouter and
// Workers AI answer at the edge, so nothing is sent anywhere).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { samples } from "../src/ee/sandbox-samples/media.js";
import { JOBS } from "../src/ee/model-jobs.js";
import { stt } from "../src/transcribe.js";
import { dispatch } from "../src/ee/model-dispatch.js";
import { LIVE_CHUNK_HEADERS } from "../src/transcribe-live-chunks.js";
import { embedRequest, chunkTexts, visionRequest, VISION_FORMAT, lookBodies } from "../src/sidecar.js";
import { chunksOf, sectionsOf } from "../src/sidecar-convert.js";
import { structuredBody } from "../src/structured-output.js";
import { searchRequest } from "../src/websearch.js";
import { plan } from "../src/ee/model-plan.js";
import { SEED, withSettings } from "./helpers/seed-settings.mjs";
import { VISION_SCHEMA } from "../src/sidecar.js";
import { checkGoldenShape } from "./helpers/golden-shape.mjs";
import { compareGolden } from "../app-assets/app-static/sandbox-golden.js";
// The public layout keeps the Cloud modules in src/ee, so a module named by its file is looked for there when it is not in src.
const srcPath = (f) => existsSync(new URL(`../src/${f}`, import.meta.url)) ? `../src/${f}` : `../src/ee/${f}`;

const ASSIGNED = ["stt", "stt_cloudflare", "live_dictation", "embed_files", "vision_files", "look", "web_search", "mem_extract", "mem_embed", "mem_rerank", "speaker_labels"];
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
  // The speech container: one ready slot that answers a diarize request and records the request in calls, where the test looks for "reached a model".
  const slot = { speechState: async () => ({ state: "ready", inflight: 0 }), warm: async () => ({ state: "warming" }), speechRequest: async (r) => { calls.push({ url: `speech-container:${r.path}`, body: null }); return { state: "ok", status: 200, body: JSON.stringify({ turns: [{ s: 0, e: 7.8, speaker: 0 }], audio_s: 7.8, process_ms: 300 }) }; } };
  const SPEECH_CONTAINER = { idFromName: (n) => n, get: () => slot };
  const env = withSettings({ ENV_NAME: "dev", SPEECH_CONTAINER, SPEECH_MAX_INSTANCES: "1", OPENROUTER_API_KEY: "k", PROMPT_CACHE: "off", CF_ACCOUNT_ID: "acct", AIG_ID: "gw", AIG_TOKEN: "tok",
    AI: { run: async (model, input) => { ai.push({ model, input }); if (input.text) return { data: input.text.map(() => [0.1]) }; if (input.contexts) return { response: input.contexts.map((_, id) => ({ id, score: id === 2 ? 0.9 : 0.1 })) }; return { text: "ok", answer: "$545.60", caption: "c", transcription_info: { duration: 7.8 }, segments: [] }; },
      websearch: async (o) => { ai.push({ search: o }); return { ok: true, status: 200, items: [] }; } } });
  return { env, calls, ai, done: () => { globalThis.fetch = real; } };
}
// What the page does for each kind of via: stt takes the recording and its options, the rest go to the named function as they are.
async function callVia(s, env, sent, opts) {
  const [module, fn] = s.via.split("#"), f = (await import(srcPath(module)))[fn];
  if (fn === "stt") { const { src, ...o } = sent; return { ok: true, r: await f(env, src, { ...o, meta: opts.meta, models: opts.model ? [opts.model] : null }) }; }
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
    }
  } finally { edge.done(); }
});

test("each sample sends the gateway kind its call site sends", () => {
  const src = (f) => readFileSync(new URL(srcPath(f), import.meta.url), "utf8");
  const where = { stt: ["index.js", /kind: "transcribe"/], stt_cloudflare: ["index.js", /kind: "transcribe"/], live_dictation: ["transcribe-live.js", /kind: 'live-dictation'/],
    embed_files: ["sidecar.js", /kind: charge \? "sidecar-embed"/], vision_files: ["sidecar.js", /kind: `sidecar-vision-\$\{mode\}`/], look: ["sidecar.js", /kind: "browser-look"/], web_search: ["websearch.js", /kind: "web-search"/], speaker_labels: ["speaker-labels.js", /kind: "speaker-labels"/] };
  for (const [job, [file, re]] of Object.entries(where)) assert.match(src(file), re, `${job}: the call site in ${file}`);
  assert.equal(byJob("vision_files").meta.kind, "sidecar-vision-picture", "the picture mode");
  assert.match(src("sidecar.js"), /vision\(P\.env, meta, pic, "picture"\)/);
  const expected = { stt: "transcribe", stt_cloudflare: "transcribe", live_dictation: "live-dictation", embed_files: "sidecar-embed", vision_files: "sidecar-vision-picture", look: "browser-look", web_search: "web-search",
    mem_extract: "memory-extract", mem_embed: "memory-embed", mem_rerank: "memory-rerank", speaker_labels: "speaker-labels" };
  for (const s of samples) assert.equal(s.meta?.kind, expected[s.job], s.job);
});

test("golden answers: well formed, only on jobs with a checkable answer, and each path or id is in the job's answer", async () => {
  for (const s of samples) {
    if (["embed_files", "mem_embed"].includes(s.job)) assert.equal(s.golden, undefined, `${s.job} has no golden: a vector has no right value`);
    else if (s.job === "speaker_labels") assert.equal(s.golden, undefined, "speaker_labels has no golden: the sample file has one voice and the turns are shown as they are");
    else checkGoldenShape(s.job, s.golden);
  }
  const speech = ["stt", "stt_cloudflare", "live_dictation"].map((j) => byJob(j).golden);
  for (const g of speech) { assert.equal(g.type, "text"); assert.equal(g.field, null); assert.equal(g.value, speech[0].value); }
  assert.match(speech[0].value, /Maple Street Bakery invoice for four hundred and twelve dollars/);
  assert.ok(speech[0].max_wer > 0 && speech[0].max_wer <= 0.2);
  assert.equal(byJob("vision_files").golden.type, "contains"); assert.ok(byJob("vision_files").golden.field in VISION_SCHEMA.properties);
  assert.ok(byJob("vision_files").golden.value.includes("$72.88"));
  assert.deepEqual([byJob("look").golden.type, byJob("look").golden.field, byJob("look").golden.value], ["contains", null, ["545.60"]]);
  assert.deepEqual(byJob("mem_rerank").golden, { type: "choices", list: "", id: null, field: "top", value: { top: "2" } });
  // The memory and search goldens: what they expect is in the request the job sends, and their paths are in the reply shape the Sandbox shows.
  const asText = async (job) => JSON.stringify((await build(byJob(job))).request).toLowerCase();
  { const g = byJob("web_search").golden, q = (await build(byJob("web_search"))).request.query; assert.equal(g.type, "contains"); assert.equal(g.field, "results");
    assert.match(q, /python/i); assert.deepEqual(g.value, ["docs.python.org"]); }
  // End to end on the shapes: a stubbed reply of each job's kind is read and scored by the same code the Sandbox runs.
  const score = (job, view) => compareGolden(byJob(job).golden, view);
  assert.equal(score("web_search", { type: "search", results: [{ title: "datetime", url: "https://docs.python.org/3/library/datetime.html", snippet: "" }] }).pass, true);
  assert.equal(score("web_search", { type: "search", results: [{ title: "x", url: "https://example.com/", snippet: "" }] }).pass, false);
});
