// node --import ./test/stubs/register.mjs test/embedding-fallback.test.mjs
// The file search index job (embed_files): a fallback only when it is an equivalent of the main model, no latest-version alias, the equivalence check
// in embedTexts, the transport of a model that 1Helm runs in its own container (src/selfhost-models.js), and the container job's input checks.
// Tests judge app facts only: which model was asked, what was refused and why, what was sent to the container, what was charged. Never a model's wording.
import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { SEED, withSettings, ID } from "./helpers/seed-settings.mjs";
import { SEED_FACTS, seedFresh } from "../src/ee/model-seed.js";
import { JOB_KINDS } from "../src/ee/model-jobs.js";
import { validateModelSettings, embeddingProblem, isAliasId, readModelSettings, saveModelSettings, saveFullModelSettings, modelSettingsOptions } from "../src/ee/model-settings.js";
import { plan } from "../src/ee/model-plan.js";
import { dispatch } from "../src/ee/model-dispatch.js";
import { embedTexts, sameIndexModel, embedInputOk, prepJobOn, PREP_MARK, PREP_JS } from "../src/sidecar.js";
import vm from "node:vm";
import { createRequire } from "node:module";
const require_ = createRequire(import.meta.url);
import { isSelfHostedModel, weightsOf, SELF_WEIGHTS, embedSetup, EMBED_REQS, EMBED_PY, embedGroups, selfHostedEmbeddings, dollarsPerSecond, EMBED_INSTANCE, EMBED_JOB_CHARS, EMBED_JOB_TEXTS, SELF_CALL_SECONDS, selfCallReserveNano } from "../src/selfhost-models.js";

const clone = (x) => JSON.parse(JSON.stringify(x));
const PPLX = "perplexity/pplx-embed-v1-0.6b", SELF = "@1hc/perplexity-ai/pplx-embed-v1-0.6b", OTHER = "mistralai/mistral-embed-2312";
const withFacts = (c, id) => { if (!c.catalog[id]) c.catalog[id] = SEED_FACTS[id] ? { id, ...clone(SEED_FACTS[id]) } : { id, name: id, kinds: ["embedding_files"], efforts: [] }; return c; };
const embedJob = (main, fallbacks = []) => { const c = clone(SEED); withFacts(c, main); fallbacks.forEach((m) => withFacts(c, m)); c.jobs.embed_files = { model: main, effort: null, fallbacks: fallbacks.map((model) => ({ model, effort: null })) }; return c; };

test("first-run data: the self-hosted model is the fallback, and each model lists the other as equivalent", () => {
  const s = validateModelSettings(seedFresh({}));
  assert.equal(s.jobs.embed_files.model, PPLX); assert.deepEqual(s.jobs.embed_files.fallbacks.map((f) => f.model), [SELF]);
  assert.deepEqual(s.catalog[PPLX].embedding_equivalents, [SELF]); assert.deepEqual(s.catalog[SELF].embedding_equivalents, [PPLX]);
  assert.equal(JOB_KINDS.embedding_files.fallbacks, 2); assert.equal(JOB_KINDS.embedding_files.equivalentOnly, true);
  assert.equal(embeddingProblem(s), null);
  assert.ok(s.catalog[SELF].pricing.prompt > 0, "a price for reservations");
});

test("a fallback must be an equivalent of the main model, and the refusal says why", () => {
  assert.equal(embeddingProblem(embedJob(PPLX, [SELF])), null);
  const bad = embeddingProblem(embedJob(PPLX, [OTHER]));
  assert.match(bad, /File search index: mistralai\/mistral-embed-2312 can't be a fallback, because Perplexity Embed 0\.6B doesn't list it as equivalent\./); assert.match(bad, /Choose a model listed as equivalent, or leave the fallbacks empty\./);
  // the main model has no equivalents at all
  const alone = embedJob(OTHER, [SELF]); assert.match(embeddingProblem(alone), /can't be a fallback/);
  // a main model with no fallback is always fine
  assert.equal(embeddingProblem(embedJob(OTHER, [])), null);
  // two fallbacks are allowed by the cap, three are not
  const three = embedJob(PPLX, [SELF, OTHER, "x/y"]); assert.throws(() => validateModelSettings(three), /at most 2 fallback/);
});

test("a latest-version alias is refused as the main model and as a fallback", () => {
  assert.equal(isAliasId("~perplexity/pplx-embed-latest"), true); assert.equal(isAliasId("perplexity/pplx-embed-latest"), true); assert.equal(isAliasId(PPLX), false); assert.equal(isAliasId(SELF), false);
  for (const id of ["~perplexity/pplx-embed-latest", "perplexity/pplx-embed-latest"]) {
    assert.match(embeddingProblem(embedJob(id, [])), /is a latest-version alias, which can switch to a different model without anyone saving a change\. Choose a specific model\./);
    const f = embedJob(PPLX, [SELF]); f.jobs.embed_files.fallbacks = [{ model: id, effort: null }]; f.catalog[id] = { id, name: id, kinds: ["embedding_files"], efforts: [] };
    assert.match(embeddingProblem(f), /latest-version alias/);
  }
});

// ---- the save paths: the Models page, an admin script, and a push from dev ----
const mkEnv = (name = "dev") => {
  const sql = new DatabaseSync(":memory:"); sql.exec(readFileSync(new URL("../db/migrations/0050_model_job_settings.sql", import.meta.url), "utf8"));
  const DB = { withSession() { return this; }, prepare(q) { const s = sql.prepare(q); let a = []; const o = { bind(...x) { a = x; return o; }, first: async () => s.get(...a) || null, all: async () => ({ results: s.all(...a) }), run: async () => ({ meta: { changes: Number(s.run(...a).changes) } }) }; return o; } };
  return { ONEHELM_EE: "1hc", ENV_NAME: name, DB, ROUTER_MODE: "two", AI: {}, OPENROUTER_API_KEY: "k" };
};
const quiet = async (fn) => { const l = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = l; } };
// settings the way an environment saved before this release has them: the Perplexity record has no embedding_equivalents and the job no fallback
const older = (config) => { const c = clone(config); delete c.catalog[PPLX].embedding_equivalents; delete c.catalog[SELF]; c.jobs.embed_files.fallbacks = []; return c; };

test("saving from the Models page: an older saved record gets its equivalents, an equivalent fallback is saved, any other is refused with the reason", async () => {
  const env = mkEnv(), first = await quiet(() => readModelSettings(env));
  await quiet(() => saveFullModelSettings(env, { revision: first.revision, config: older(first.config) }, "admin@example.com", "test"));
  const cur = await quiet(() => readModelSettings(env)); assert.equal(cur.config.catalog[PPLX].embedding_equivalents, undefined); assert.deepEqual(cur.config.jobs.embed_files.fallbacks, []);
  const good = clone(cur.config); good.jobs.embed_files.fallbacks = [{ model: SELF, effort: null }];
  const view = await quiet(() => saveModelSettings(env, { revision: cur.revision, config: good }, "admin@example.com"));
  assert.deepEqual(view.config.jobs.embed_files.fallbacks.map((f) => f.model), [SELF]); assert.deepEqual(view.config.catalog[PPLX].embedding_equivalents, [SELF]); assert.deepEqual(view.config.catalog[SELF].embedding_equivalents, [PPLX]);
  // a model that is not equivalent
  const bad = clone(view.config); bad.jobs.embed_files.fallbacks = [{ model: OTHER, effort: null }];
  await assert.rejects(() => quiet(() => saveModelSettings(env, { revision: view.revision, config: bad }, "admin@example.com")), (e) => e.status === 400 && /can't be a fallback, because Perplexity Embed 0\.6B doesn't list it as equivalent/.test(e.message));
  // an alias as the main model (the picker path refuses it for any non-chat job)
  const alias = clone(view.config); alias.jobs.embed_files = { model: "~perplexity/pplx-embed-latest", effort: null, fallbacks: [] };
  await assert.rejects(() => quiet(() => saveModelSettings(env, { revision: view.revision, config: alias }, "admin@example.com")), (e) => e.status === 400 && /latest/.test(e.message));
  assert.equal((await quiet(() => readModelSettings(env))).revision, view.revision, "nothing was saved by the refused saves");
});

test("a full save goes through the same check", async () => {
  const env = mkEnv("live"), first = await quiet(() => readModelSettings(env));
  const bad = clone(first.config); withFacts(bad, OTHER); bad.jobs.embed_files.fallbacks = [{ model: OTHER, effort: null }];
  await assert.rejects(() => quiet(() => saveFullModelSettings(env, { revision: first.revision, config: bad }, "admin@example.com", "push")), /can't be a fallback/);
  const alias = clone(first.config); alias.catalog["x/embed-latest"] = { id: "x/embed-latest", name: "x", kinds: ["embedding_files"], efforts: [] }; alias.jobs.embed_files = { model: "x/embed-latest", effort: null, fallbacks: [] };
  await assert.rejects(() => quiet(() => saveFullModelSettings(env, { revision: first.revision, config: alias }, "admin@example.com", "push")), /latest-version alias/);
  // and a version that was saved earlier is always readable: the check runs on a save, never on a read
  assert.doesNotThrow(() => validateModelSettings(alias));
});

test("the picker offers only equivalent models as fallbacks", () => {
  const choices = modelSettingsOptions(SEED).choices.embedding_files;
  assert.equal(choices.find((c) => c.id === SELF).main_equivalent, true); assert.equal(choices.find((c) => c.id === PPLX).main_equivalent, false);
  assert.ok(choices.every((c) => typeof c.main_equivalent === "boolean")); assert.equal(choices.find((c) => c.id === SELF).source, "SELF");
});

// ---- the plan and the dispatcher ----
test("the plan sends an @1hc/ model to the container: source SELF, no OpenRouter provider fields", () => {
  assert.equal(isSelfHostedModel(SELF), true); for (const id of [PPLX, "@cf/a/b", "@1hc/x", "@1hc/A/b", "@1hc/a/b/c", "1hc/a/b"]) assert.equal(isSelfHostedModel(id), false, id);
  const steps = plan(SEED, "embed_files", { level: "zdr" }).steps;
  assert.deepEqual(steps.map((s) => [s.model, s.source, s.adapter]), [[PPLX, "OR", "embeddings"], [SELF, "SELF", "embeddings"]]); assert.equal(steps[1].provider, null); assert.ok(steps[0].provider.zdr);
});

// ---- the weights and the container setup ----
test("the weights are pinned by revision and SHA-256, the wheels by hash, and nothing is fetched without a check", () => {
  const w = weightsOf(SELF); assert.equal(w, SELF_WEIGHTS["perplexity-ai/pplx-embed-v1-0.6b"]); assert.equal(weightsOf(PPLX), null); assert.match(w.rev, /^[0-9a-f]{40}$/);
  const setup = embedSetup();
  for (const [name, f] of Object.entries(w.files)) { assert.match(f.sha, /^[0-9a-f]{64}$/); assert.ok(setup.includes(f.sha), `${name} is checked against its SHA-256`); assert.ok(setup.includes(f.path), `${name} is fetched from its path`); }
  assert.ok(setup.includes(`resolve/${w.rev}/`), "every file comes from the pinned revision"); assert.ok(!/resolve\/main|resolve\/HEAD/.test(setup));
  assert.match(setup, /sha256sum -c/); assert.match(setup, /--require-hashes --only-binary :all: --no-deps/); assert.match(setup, /\[ "\$1" = embed \]/);
  for (const l of EMBED_REQS.split("\n")) assert.match(l, /^[a-z0-9-]+==[\d.]+( --hash=sha256:[0-9a-f]{64})+$/);
  assert.deepEqual(EMBED_REQS.split("\n").map((l) => l.split("==")[0]), ["flatbuffers", "numpy", "onnxruntime", "packaging", "protobuf", "tokenizers"]);
  assert.match(EMBED_PY, /pooler_output_int8/); assert.doesNotMatch(setup, /(?<!uv )pip install|npm i /);
  assert.equal(embedSetup(), embedSetup(), "the setup text is the same every time, so the template version is stable");
});

test("texts are split into container jobs that stay inside the job limits, in order, and each text is cut at the limit", () => {
  const texts = Array.from({ length: 50 }, (_, i) => `${i}:`.padEnd(1500, "x")), groups = embedGroups(texts);
  assert.deepEqual(groups.flat().map((t) => t.slice(0, 3)), texts.map((t) => t.slice(0, 3)));
  for (const g of groups) { assert.ok(g.length <= EMBED_JOB_TEXTS); assert.ok(g.reduce((n, t) => n + t.length, 0) <= EMBED_JOB_CHARS); }
  assert.equal(embedGroups(["a".repeat(20000)])[0][0].length, 6000); assert.deepEqual(embedGroups([]), []);
  assert.ok(selfCallReserveNano(texts) > selfCallReserveNano(texts.slice(0, 1)), "more jobs, a bigger hold");
  assert.equal(selfCallReserveNano(["q"]), Math.ceil(SELF_CALL_SECONDS * dollarsPerSecond(EMBED_INSTANCE) * 1e9));
});

// ---- the transport, with the container faked at its edge ----
const int8 = (n, dims, seed) => { const a = new Int8Array(n * dims); for (let i = 0; i < a.length; i++) a[i] = ((i * 7 + seed) % 255) - 127; let s = ""; for (const v of a) s += String.fromCharCode(v & 255); return btoa(s); };
function fakeContainers({ snapshots = true, fail = null } = {}) {
  const calls = [], names = [];
  const stub = { prepJob: async (x) => { calls.push(x); if (fail) return { error: fail }; return { dims: 1024, n: x.texts.length, tokens: x.texts.length * 10, vec: int8(x.texts.length, 1024, calls.length), ms: 2000 }; } };
  const ns = { idFromName: (n) => { names.push(n); return n; }, get: () => stub };
  return { env: snapshots ? { PREP_CONTAINER: ns } : { COMPUTER: ns }, calls, names };
}
test("selfHostedEmbeddings: one prep job per group, int8 vectors back in order, the cost is the container's measured time", async () => {
  const c = fakeContainers(), texts = Array.from({ length: 40 }, (_, i) => `text ${i} `.padEnd(1000, "y"));
  const r = await selfHostedEmbeddings(c.env, SELF, texts, { tenant: "t1" }), j = await r.data;
  assert.equal(c.names[0], "prepjob:t1"); assert.ok(c.calls.length > 1, "40 texts of 1000 characters need more than one job");
  for (const x of c.calls) { assert.equal(x.op, "embed"); assert.equal(x.ext, "json"); assert.equal(x.template, "embed"); assert.ok(embedInputOk(x.texts)); assert.equal(x.threads, 2, "the 2 vCPU instance runs two threads"); }
  assert.equal(r.data.length, 40); assert.deepEqual(r.data.map((d) => d.index), texts.map((_, i) => i)); assert.equal(r.data[0].embedding.length, 1024);
  assert.ok(r.data[0].embedding.every((v) => Number.isInteger(v) && v >= -128 && v <= 127));
  assert.equal(r.usage.prompt_tokens, 400); assert.equal(r.usage.container_ms, 2000 * c.calls.length); assert.equal(r.usage.instance, EMBED_INSTANCE);
  assert.ok(Math.abs(r.usage.cost - (2 * c.calls.length) * dollarsPerSecond(EMBED_INSTANCE)) < 1e-12, "cost = seconds in the container × the instance's published rate");
  void j;
});
test("selfHostedEmbeddings: the Computer class is used without snapshots, a failed job throws, and an unknown model never reaches a container", async () => {
  const c = fakeContainers({ snapshots: false }); const r = await selfHostedEmbeddings(c.env, SELF, ["a", "b"], {});
  assert.equal(c.names[0], "prepjob:platform"); assert.equal(r.usage.instance, "basic"); assert.equal(c.calls[0].threads, 1);
  await assert.rejects(() => selfHostedEmbeddings(fakeContainers({ fail: "the embedding stopped without an answer" }).env, SELF, ["a"], {}), /the embedding job failed \(the embedding stopped without an answer\)/);
  const n = fakeContainers(); await assert.rejects(() => selfHostedEmbeddings(n.env, "@1hc/nobody/nothing", ["a"], {}), /no weights this server can run/); assert.equal(n.calls.length, 0);
  await assert.rejects(() => selfHostedEmbeddings({}, SELF, ["a"], {}), /No container is available/);
});
test("dispatch sends an embeddings step for an @1hc/ model to the container, and records it as served by 1Helm's container", async () => {
  const c = fakeContainers(); const e = withSettings({ ...c.env }, embedJob(SELF, [PPLX]));
  const r = await dispatch(e, "embed_files", { input: ["hello"] }, { meta: { tenant: "t9" } }), j = await r.json();
  assert.equal(j.model, SELF); assert.equal(j.data.length, 1); assert.equal(r.requested, SELF); assert.equal(c.names[0], "prepjob:t9");
});

// ---- embedTexts: which models may answer for an index ----
const fakeOpenRouter = ({ down = false } = {}) => { const sent = []; const original = globalThis.fetch;
  globalThis.fetch = async (u, init) => { const b = JSON.parse(init.body); sent.push(b.model); if (down) return new Response(JSON.stringify({ error: { message: "down" } }), { status: 503 }); return Response.json({ model: b.model, data: b.input.map((_, index) => ({ index, embedding: [index + 1, 2, 3] })), usage: { prompt_tokens: 3, cost: 0.000001 } }); };
  return { sent, restore: () => { globalThis.fetch = original; } }; };
test("embedTexts: an index of the saved model or an equivalent is searched, any other index throws modelChanged and nothing is sent", async () => {
  const or = fakeOpenRouter(), c = fakeContainers();
  try {
    const e = withSettings({ OPENROUTER_API_KEY: "k", ...c.env }, embedJob(PPLX, [SELF]));
    assert.equal((await embedTexts(e, ["q"], {}, PPLX)).model, PPLX);
    assert.equal((await embedTexts(e, ["q"], {}, SELF)).model, PPLX, "an index made by the equivalent model is searched with the saved model");
    assert.equal((await embedTexts(e, ["q"], {}, null)).model, PPLX);
    const n = or.sent.length;
    await assert.rejects(() => embedTexts(e, ["q"], {}, OTHER), (err) => err.modelChanged === true && /the file index was made with mistralai\/mistral-embed-2312, and the saved model is perplexity\/pplx-embed-v1-0\.6b/.test(err.message));
    assert.equal(or.sent.length, n, "nothing was sent"); assert.equal(c.calls.length, 0);
    // the saved model changed to the self-hosted one: the old Perplexity index is still the same index
    const e2 = withSettings({ OPENROUTER_API_KEY: "k", ...c.env }, embedJob(SELF, [PPLX]));
    const r = await embedTexts(e2, ["q"], {}, PPLX); assert.equal(r.model, SELF); assert.equal(c.calls.length, 1);
  } finally { or.restore(); }
});
test("embedTexts: when the main model is down the equivalent fallback answers, charged at the container's measured cost", async () => {
  const or = fakeOpenRouter({ down: true }), c = fakeContainers();
  try {
    const e = withSettings({ OPENROUTER_API_KEY: "k", ...c.env }, embedJob(PPLX, [SELF]));
    const r = await embedTexts(e, ["q1", "q2"], { tenant: "t1" }, PPLX);
    assert.equal(r.model, SELF); assert.equal(r.vectors.length, 2); assert.deepEqual(or.sent, [PPLX]); assert.equal(c.calls.length, 1);
    assert.equal(r.nano, Math.ceil(Math.ceil((2 * dollarsPerSecond(EMBED_INSTANCE)) * 1e9) * 1.15), "the charge is the container seconds at the published rate, plus the usual 15 percent");
  } finally { or.restore(); }
});
test("embedTexts: a step that is not equivalent to the index is never asked, even if it is saved as a fallback", async () => {
  const or = fakeOpenRouter({ down: true }), c = fakeContainers();
  try {
    // a version saved by an older release or by hand: a fallback the catalog does not list as equivalent (the save check would refuse it now)
    const bad = embedJob(PPLX, [SELF]); bad.jobs.embed_files.fallbacks = [{ model: OTHER, effort: null }, { model: SELF, effort: null }]; withFacts(bad, OTHER);
    const e = withSettings({ OPENROUTER_API_KEY: "k", ...c.env }, bad);
    const r = await embedTexts(e, ["q"], {}, PPLX); assert.equal(r.model, SELF); assert.deepEqual(or.sent, [PPLX], "the unlisted model was never called");
  } finally { or.restore(); }
});
test("sameIndexModel: the same model, or an equivalent listed by either one", () => {
  const s = SEED; assert.equal(sameIndexModel(s, PPLX, PPLX), true); assert.equal(sameIndexModel(s, PPLX, SELF), true); assert.equal(sameIndexModel(s, SELF, PPLX), true);
  assert.equal(sameIndexModel(s, PPLX, OTHER), false); assert.equal(sameIndexModel(s, null, PPLX), true, "an index with no recorded model is not blocked here"); assert.equal(sameIndexModel(null, PPLX, SELF), false);
});

// ---- the container job's input ----
test("the embed job takes only a bounded list of texts and nothing from R2", async () => {
  assert.equal(embedInputOk(["a"]), true); assert.equal(embedInputOk([]), false); assert.equal(embedInputOk("a"), false); assert.equal(embedInputOk([1]), false); assert.equal(embedInputOk(Array(EMBED_JOB_TEXTS + 1).fill("a")), false);
  assert.equal(embedInputOk(["a".repeat(EMBED_JOB_CHARS + 6000 * 2 + 1)]), false);
  const execs = [], kv = new Map(); let running = false;
  const out = (s) => ({ exitCode: 0, stdout: new TextEncoder().encode(s) });
  const dobj = { env: {}, get: (k) => kv.get(k), put: (k, v) => kv.set(k, v), ctx: { storage: { setAlarm: async () => {} }, container: { get running() { return running; }, start: () => { running = true; }, destroy: async () => { running = false; },
    exec: async (cmd, o = {}) => { execs.push({ cmd, stdin: o.stdin ? await new Response(o.stdin).text() : null }); return { output: async () => cmd[0] === "node" ? out(`noise\n${PREP_MARK}${JSON.stringify({ dims: 1024, n: 1, tokens: 3, vec: "AA==" })}\n`) : out(""), kill: () => {} }; } } } };
  assert.deepEqual(await prepJobOn(dobj, { op: "embed", ext: "json", texts: [] }), { error: "bad job" });
  assert.deepEqual(await prepJobOn(dobj, { op: "embed", ext: "pdf", texts: ["a"] }), { error: "bad job" });
  assert.deepEqual(await prepJobOn(dobj, { op: "embed", ext: "json", r2key: "t/t1/files/x", texts: "a" }), { error: "bad job" });
  const r = await prepJobOn(dobj, { op: "embed", ext: "json", texts: ["hello"], threads: 9 });
  assert.equal(r.vec, "AA=="); assert.equal(execs.find((e) => e.stdin != null).stdin, JSON.stringify({ texts: ["hello"] }), "the texts go in on stdin");
  const setup = execs.find((e) => e.cmd[2] === embedSetup()); assert.equal(setup.cmd[4], "embed", "the embed setup runs, not the document setup");
  const run = execs.find((e) => e.cmd[0] === "node"); assert.equal(run.cmd[6], "embed"); assert.equal(run.cmd[7], "4", "at most four threads");
  assert.equal(ID.EMBED_FILES ?? PPLX, PPLX);
});

test("the node program of the container job is valid JavaScript, and an embed run reaches its Python call and prints one marked JSON line", () => {
  // The script text is built inside a template literal, where "\\n" must be written twice. A single backslash put a raw newline in a string and node exited 1 before the job did anything (dev, 2026-10-18).
  assert.doesNotThrow(() => new vm.Script(`(async()=>{${PREP_JS}})`), "PREP_JS compiles");
  const { spawnSync } = require_("node:child_process");
  const fake = `const cp=require("child_process");cp.spawnSync=()=>({status:0,stdout:'noise\\n{"dims":2,"n":1,"tokens":3,"vec":"AAE="}\\n',stderr:""});`;
  const r = spawnSync("node", ["-e", fake + PREP_JS, "_", "/tmp/none", "json", "embed", "2"], { encoding: "utf8" });
  const line = r.stdout.split("\n").find((l) => l.startsWith(PREP_MARK));
  assert.ok(line, `no marked line: exit ${r.status} ${r.stderr.slice(0, 200)}`); assert.deepEqual(JSON.parse(line.slice(PREP_MARK.length)), { dims: 2, n: 1, tokens: 3, vec: "AAE=" });
  const bad = spawnSync("node", ["-e", fake.replace('stdout:\'', 'stdout:\'') + PREP_JS, "_", "/tmp/none", "json", "ocr", "1"], { encoding: "utf8" }); void bad;
});
