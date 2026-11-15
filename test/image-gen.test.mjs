// node --import ./test/stubs/register.mjs test/image-gen.test.mjs
// Image generation, server side (src/image-gen.js). OpenRouter and the models are stubbed; nothing here calls a network or a paid model.
import assert from "node:assert/strict";
import "../src/resident.js";   // first: resume.js and resident.js import each other
import { DatabaseSync } from "node:sqlite";
import { SEED, withSettings } from "./helpers/seed-settings.mjs";
import { JOBS, JOB_KINDS, MODEL_PAGE_JOBS } from "../src/ee/model-jobs.js";
import { SEED_FACTS } from "../src/ee/model-seed.js";
import { validateModelSettings } from "../src/ee/model-settings.js";
import { plan } from "../src/ee/model-plan.js";
import { assessImageCatalog } from "../src/ee/model-catalog.js";
import { userInputInit, createQuestion, pendingInputs, questionForTurn } from "../src/user-input.js";
import { routingToolsAllowed } from "../src/ee/orchestrator.js";
import { EAGER_TOOLS } from "../src/context.js";
import { toolClass } from "../src/resume.js";
import {
  imageAllowed, imageModeOf, setImageMode, applyOfferAnswer, offerAnswer, imageToolNames, imageToolDefs, runImageIntent, imageIntentAsk, runImageTool, prepareImageSend, cleanAnnotations,
  referenceRows, dismissOnSend, isAnnotation, ANNOTATION_TAG, IMAGE_TOOL_NAMES, INTENT_QUESTIONS, REF_CAP, MAX_N,
} from "../src/ee/image-gen.js";
import { imageRoute } from "../src/ee/image-routes.js";

const clone = (x) => JSON.parse(JSON.stringify(x));
let n = 0; const test = async (name, fn) => { await fn(); console.log(`ok ${++n} - ${name}`); };
const SEEDREAM = "bytedance-seed/seedream-5-0-flash", HY = "tencent/hy-image-v3.5-preview";
const PNG = "iVBORw0KGgo=";

// ---- a small Resident: real tables in memory, fake storage, ledger and dispatcher transport ----
function sqlOf() {
  const db = new DatabaseSync(":memory:");
  const sql = { exec(q, ...a) { if (!a.length && /;\s*\S/.test(q)) { db.exec(q); return { toArray: () => [], one: () => null }; } const s = db.prepare(q), rows = /^\s*(SELECT|PRAGMA)|RETURNING/i.test(q) ? s.all(...a) : (s.run(...a), []); return { toArray: () => rows, one: () => rows[0] }; } };
  sql.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT, waiting TEXT, image_mode TEXT)");
  sql.exec("CREATE TABLE files (id TEXT PRIMARY KEY, at INTEGER, name TEXT, mime TEXT, bytes INTEGER, r2key TEXT, view_key TEXT, source TEXT, session TEXT, turn TEXT, synced INTEGER DEFAULT 0, deleted INTEGER DEFAULT 0, pending INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0, src_path TEXT, tags TEXT)");
  userInputInit(sql);
  return sql;
}
function world({ plan: planName = "plus", settings = SEED, fetchImpl = null, credits = true } = {}) {
  const sql = sqlOf(), events = [], ledger = { reserved: [], settled: [], released: [] }, puts = new Map(), wire = [];
  const planRow = { plan: planName };
  const env = { ONEHELM_EE: "1hc", ...withSettings({ OPENROUTER_API_KEY: "k", PROMPT_CACHE: "off" }, settings),
    DB: { prepare: (q) => { const o = { bind: () => o, first: async () => (/FROM tenants/.test(q) ? planRow : null), run: async () => ({}), all: async () => ({ results: [] }) }; return o; } },
    WS: { get: async (k) => puts.has(k) ? { arrayBuffer: async () => puts.get(k).buffer } : null, put: async (k, b) => { puts.set(k, new Uint8Array(b)); return { size: b.byteLength }; }, head: async () => null } };
  globalThis.fetch = fetchImpl || (async (url, init = {}) => {
    const body = init.body ? JSON.parse(typeof init.body === "string" ? init.body : await new Response(init.body).text()) : null; wire.push({ url: String(url), body });
    return Response.json({ created: 1, data: [{ b64_json: PNG, media_type: "image/png" }], usage: { cost: 0.018 } });
  });
  const R = { env, sql, wire, events, ledger, puts, tenant: "t1",
    get: (k) => ({ tenant: "t1", channel: "ch" })[k], ledger_: null,
    ledger() { return { reserve: async (id, nano) => { ledger.reserved.push({ id, nano }); return credits ? { ok: true } : { ok: false, reason: "out_of_credits" }; }, settle: async (id, nano) => { ledger.settled.push({ id, nano }); return {}; } }; },
    resOpen() {}, resClose() {}, journalDelegation() {},
    libFile(s) { return sql.exec("SELECT * FROM files WHERE deleted=0 AND pending=0 AND (id=? OR lower(name)=lower(?)) LIMIT 1", String(s), String(s)).toArray()[0] || null; },
    addFileRow(f) { sql.exec("INSERT INTO files (id,at,name,mime,bytes,r2key,source,session,turn) VALUES (?,?,?,?,?,?,?,?,?)", f.id, Date.now() + R.seq++, f.name, f.mime, f.bytes, f.r2key, f.source, f.session, f.turn); return { id: f.id, name: f.name, mime: f.mime, source: f.source, image: /^image\//.test(f.mime) }; },
    seq: 0, shared: [], recordShare(f, turn) { R.shared.push({ id: f.id, turn }); },
    async imageDataUrl(r) { return `data:${r.mime};base64,view-${r.id}`; } };
  sql.exec("INSERT INTO sessions (id,title) VALUES ('s1','task')");
  const upload = (id, name, extra = {}) => { puts.set(`t/t1/files/ch/${id}`, new Uint8Array([1, 2, 3])); sql.exec("INSERT INTO files (id,at,name,mime,bytes,r2key,source,session) VALUES (?,?,?,?,?,?,?,?)", id, Date.now() + R.seq++, name, extra.mime || "image/png", 3, `t/t1/files/ch/${id}`, extra.source || "upload", extra.session === undefined ? "s1" : extra.session); return id; };
  const tc = (over = {}) => ({ kind: "chat", session: "s1", turn: "turn1", orchestration: null, emit: (e) => events.push(e), callId: "c1", extraCharge: 0, ...over });
  return { R, env, sql, events, ledger, puts, wire, upload, tc, setPlan: (p) => { planRow.plan = p; } };
}

await test("the jobs: both show on the Models page, the image job starts on Seedream with Hy Image behind it", () => {
  assert.ok(MODEL_PAGE_JOBS.some((j) => j.id === "image_gen") && MODEL_PAGE_JOBS.some((j) => j.id === "image_intent"));
  const def = JOBS.find((j) => j.id === "image_gen"); assert.equal(def.kind, "image"); assert.equal(JOB_KINDS.image.noOutput, true); assert.equal(JOB_KINDS.image.zdr, true);
  assert.equal(JOBS.find((j) => j.id === "image_intent").kind, "decider");
  assert.equal(SEED.jobs.image_gen.model, SEEDREAM); assert.deepEqual(SEED.jobs.image_gen.fallbacks.map((f) => f.model), [HY]);
  assert.ok(SEED.catalog[SEEDREAM].image.refs === 14 && SEED.catalog[HY].image.refs === 20);
  assert.ok(SEED.jobs.image_intent.model && SEED.catalog[SEED.jobs.image_intent.model].kinds.includes("decider"));
  // customer text never says customers choose models
  assert.ok(!/customer|you can choose|pick a model/i.test(def.description + JOBS.find((j) => j.id === "image_intent").description));
});

await test("the fallback is optional: a chain of one model is valid, two is valid, three is refused", () => {
  const one = clone(SEED); one.jobs.image_gen.fallbacks = []; assert.deepEqual(validateModelSettings(one).jobs.image_gen.fallbacks, []);
  const two = clone(SEED); assert.equal(validateModelSettings(two).jobs.image_gen.fallbacks.length, 1);
  const three = clone(SEED); three.jobs.image_gen.fallbacks = [{ model: HY, effort: null }, { model: HY, effort: null }, { model: HY, effort: null }]; assert.throws(() => validateModelSettings(three), /at most 2 fallback/);
  const p = plan(one, "image_gen", { level: "zdr" }); assert.deepEqual(p.steps.map((s) => s.model), [SEEDREAM]); assert.equal(p.steps[0].adapter, "image"); assert.equal(p.steps[0].provider.zdr, true);
  for (const k of ["order", "only", "ignore"]) assert.ok(!(k in p.steps[0].provider));
});

await test("the admin picks the primary model from OpenRouter's image-output models; a chat model is refused", () => {
  const listed = assessImageCatalog([{ id: "acme/pic-1", name: "Pic 1", architecture: { input_modalities: ["text", "image"], output_modalities: ["image"] }, supported_parameters: { input_references: { type: "range", min: 0, max: 8 }, aspect_ratio: { type: "enum" }, seed: { type: "boolean" } } },
    { id: "acme/chat-1", architecture: { output_modalities: ["text"] } }], [{ model_id: "acme/pic-1", tag: "acme-host", status: 0 }]);
  assert.equal(listed.length, 1); const m = listed[0]; assert.deepEqual([m.kinds, m.eligible, m.image.refs, m.image.params], [["image"], true, 8, ["aspect_ratio"]]);
  const s = clone(SEED); s.catalog[m.id] = m; s.jobs.image_gen = { model: m.id, effort: null, fallbacks: [] };
  assert.equal(validateModelSettings(s).jobs.image_gen.model, "acme/pic-1");
  const bad = clone(SEED); bad.jobs.image_gen = { model: SEED.jobs.label.model, effort: null, fallbacks: [] }; assert.throws(() => validateModelSettings(bad), /can't be used for Image generation/);
  const noZdr = assessImageCatalog([{ id: "acme/pic-2", architecture: { output_modalities: ["image"] } }], []); assert.equal(noZdr[0].eligible, false);
});

await test("the dispatcher's image adapter: one image per call, references cut to the model's own number, only the listed fields, zdr provider, falls back", async () => {
  const w = world(); const { dispatch } = await import("../src/ee/model-dispatch.js");
  const refs = Array.from({ length: 16 }, (_, i) => `data:image/png;base64,r${i}`);
  const r = await dispatch(w.env, "image_gen", { prompt: "a boat", references: refs, aspect_ratio: "16:9", resolution: "2K", size: "1024x1024" }, { meta: { tenant: "t1" } });
  const b = w.wire.at(-1).body; assert.match(w.wire.at(-1).url, /\/images$/); assert.equal(b.model, SEEDREAM); assert.equal(b.input_references.length, 14); assert.equal(b.input_references[0].image_url.url, refs[0]);
  assert.deepEqual([b.aspect_ratio, b.resolution, b.size], ["16:9", "2K", undefined]); assert.equal(b.provider.zdr, true); assert.equal(b.n, undefined); assert.equal((await r.json()).data.length, 1);
  // first model fails, second answers
  let calls = 0; const w2 = world({ fetchImpl: async (u, init) => { const body = JSON.parse(init.body); calls++; return body.model === SEEDREAM ? Response.json({ error: { message: "down" } }, { status: 502 }) : Response.json({ data: [{ b64_json: PNG }], usage: { cost: 0.01 } }); } });
  const r2 = await dispatch(w2.env, "image_gen", { prompt: "x", size: "1024x1024" }, { meta: { tenant: "t1" } }); assert.equal(r2.requested, HY); assert.equal(calls, 2);
});

await test("tools are present only in the right modes, never on the BYOK plan", async () => {
  assert.deepEqual(imageToolNames(true, null), ["offer_image_generation"]); assert.deepEqual(imageToolNames(true, "on"), ["image_generate", "image_edit"]);
  assert.deepEqual(imageToolNames(true, "dismissed"), []); assert.deepEqual(imageToolNames(false, "on"), []); assert.deepEqual(imageToolNames(false, null), []);
  assert.deepEqual(imageToolDefs(true, "on").map((t) => t.function.name), ["image_generate", "image_edit"]);
  for (const name of IMAGE_TOOL_NAMES) assert.ok(EAGER_TOOLS.has(name), `${name} is loaded in full`);
  assert.equal(toolClass("image_generate"), "write"); assert.equal(toolClass("image_edit"), "write"); assert.equal(toolClass("offer_image_generation"), "local");
  assert.equal(routingToolsAllowed({ orchestration: { requiredDelegation: true } }, "image_generate"), true); assert.equal(routingToolsAllowed({ orchestration: { review: 1 } }, "image_edit"), false);
  const w = world(); assert.equal(await imageAllowed(w.env, "t1"), true); w.setPlan("byok"); assert.equal(await imageAllowed(w.env, "t1"), false);
  // licensed: a public install (no ONEHELM_EE) never offers image generation, on any plan
  w.setPlan("plus"); assert.equal(await imageAllowed({ ...w.env, ONEHELM_EE: undefined }, "t1"), false);
});

await test("the one rule is the plan: a full plan whose chat runs on its own AI services still has the tools, the classifier, the routes and the image job (billed from the plan)", async () => {
  const w = world(); const own = Object.create(w.env, { BYOK: { value: { host: "own.example" } } }); w.R.env = own;
  assert.equal(await imageAllowed(own, "t1"), true);
  // the tool lists a turn offers (Resident.availableTools reads the same fields the turn sets from imageAllowed)
  const { Resident } = await import("../src/resident.js"), fake = { env: own, tools: () => [], get: () => "ch" };
  const names = (mode) => Resident.prototype.availableTools.call(fake, { kind: "chat", imageOk: true, imageMode: mode }).map((t) => t.function.name).filter((x) => IMAGE_TOOL_NAMES.has(x));
  assert.deepEqual(names("on"), ["image_generate", "image_edit"]); assert.deepEqual(names(null), ["offer_image_generation"]); assert.deepEqual(names("dismissed"), []);
  assert.deepEqual(Resident.prototype.availableTools.call(fake, { kind: "chat", imageOk: false, imageMode: "on" }).filter((t) => IMAGE_TOOL_NAMES.has(t.function.name)), []);
  // the classifier and the generation both work on that turn, and the hold and charge go to the plan's Ledger
  assert.deepEqual(await imageIntentAsk(own, { allowed: await imageAllowed(own, "t1"), text: "draw a fox", ledger: () => w.R.ledger(), deps: { ask: async () => ({ answers: { image: { choice: "yes" } }, nano: 0 }), timeoutFor: async () => 100 } }), { ask: true });
  setImageMode(w.sql, "s1", "on"); const tc = w.tc(); assert.match(await runImageTool(w.R, "image_generate", { prompt: "a fox" }, tc), /Made 1 of 1/);
  assert.equal(w.ledger.reserved.at(-1).id.startsWith("img:"), true); assert.ok(w.ledger.settled.at(-1).nano > 0); assert.match(w.wire.at(-1).url, /\/images$/);
  assert.match(JSON.stringify(w.wire.at(-1).body.provider), /"zdr":true/);
  // the same account on the byok plan has none of it
  w.setPlan("byok"); assert.equal(await imageAllowed(own, "t1"), false);
});

await test("a picture made here is described by its prompt: no description job runs, the prompt (and the edit instruction) is stored as the file's description for search and memory", async () => {
  const w = world(); setImageMode(w.sql, "s1", "on"); const added = [], add = w.R.addFileRow; w.R.addFileRow = (f) => { added.push(f); return add(f); };
  await runImageTool(w.R, "image_generate", { prompt: "A red boat on the sea" }, w.tc());
  await runImageTool(w.R, "image_edit", { prompt: "make the boat blue" }, w.tc({ turn: "turn2" }));
  assert.equal(added[0].description, "A red boat on the sea"); assert.equal(added[1].description, `make the boat blue (an edit of "${added[0].name}")`);
  // the prep job is told the description, and with it makes the text with no model call
  const { Resident } = await import("../src/resident.js"), started = [];
  const fake = { get: (k) => ({ tenant: "t1", channel: "ch" })[k], env: { FILE_PREP: { idFromName: (x) => x, get: () => ({ prepStart: async (job) => { started.push(job); } }) } }, ctx: { waitUntil() {} } };
  Resident.prototype.scStart.call(fake, { id: "f1", r2key: "t/t1/files/ch/f1", name: "boat.png", mime: "image/png", bytes: 3, source: "image_gen", description: "A red boat on the sea" }); await Promise.all(fake._scStarts);
  Resident.prototype.scStart.call(fake, { id: "f2", r2key: "t/t1/files/ch/f2", name: "mine.png", mime: "image/png", bytes: 3, source: "upload", description: "ignored" }); await Promise.all(fake._scStarts);
  assert.equal(started[0].described, "A red boat on the sea"); assert.equal(started[1].described, undefined, "an uploaded picture is still described by the model");
  const { prepText } = await import("../src/sidecar.js"); const calls = []; const real = globalThis.fetch; globalThis.fetch = async (u) => { calls.push(String(u)); throw new Error("no model call"); };
  try {
    const P = { env: { WS: { get: async () => ({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }) } }, get: () => null, put() {}, paid: async () => { throw new Error("no paid call"); } };
    const r = await prepText(P, { name: "boat.png", mime: "image/png", bytes: 3, r2key: "t/t1/files/ch/f1", described: "A red boat on the sea" });
    assert.match(r.md, /^# Picture: boat\.png\n\nA red boat on the sea/); assert.equal(r.kind, "image"); assert.equal(r.extra.picture, true); assert.deepEqual(calls, []);
  } finally { globalThis.fetch = real; }
});

await test("image mode on a task: set, read, refuse bad values; the offer answers", () => {
  const { sql } = world(); assert.equal(imageModeOf(sql, "s1"), null);
  assert.equal(setImageMode(sql, "s1", "on"), true); assert.equal(imageModeOf(sql, "s1"), "on"); assert.equal(setImageMode(sql, "s1", "bogus"), false); assert.equal(setImageMode(sql, "nope", "on"), false);
  setImageMode(sql, "s1", null); assert.equal(applyOfferAnswer(sql, "s1", { action: "no" }, "No"), "no"); assert.equal(imageModeOf(sql, "s1"), null);
  assert.equal(applyOfferAnswer(sql, "s1", { action: "dismiss" }, "Don't ask again"), "dismiss"); assert.equal(imageModeOf(sql, "s1"), "dismissed");
  assert.equal(applyOfferAnswer(sql, "s1", {}, "Yes"), "yes"); assert.equal(imageModeOf(sql, "s1"), "on"); assert.equal(offerAnswer({}, "whatever"), null);
});

await test("the classifier: yes asks, no does not, every failure is no, nothing is sent for BYOK or a decided task, the hold is settled", async () => {
  const w = world(), L = () => w.R.ledger(), ask = (choice, extra = {}) => async () => ({ answers: { image: { choice } }, nano: 1000, ...extra });
  const run = (deps, o = {}) => imageIntentAsk(w.env, { allowed: true, mode: null, text: "draw me a cat", ledger: L, deps: { ask: deps, timeoutFor: async () => 2500 }, ...o });
  assert.deepEqual(await run(ask("yes")), { ask: true }); assert.deepEqual(await run(ask("no")), { ask: false });
  assert.deepEqual(await run(async () => ({ error: "timeout after 3 s", nano: 0 })), { ask: false }); assert.deepEqual(await run(async () => { throw new Error("boom"); }), { ask: false });
  assert.deepEqual(await run(async () => ({ answers: { image: { choice: "maybe" } }, nano: 0 })), { ask: false });
  let called = 0; const spy = async () => { called++; return { answers: { image: { choice: "yes" } }, nano: 1 }; };
  assert.deepEqual(await run(spy, { allowed: false }), { ask: false }); assert.deepEqual(await run(spy, { mode: "on" }), { ask: false }); assert.deepEqual(await run(spy, { mode: "dismissed" }), { ask: false }); assert.deepEqual(await run(spy, { text: "hi" }), { ask: false }); assert.equal(called, 0);
  const before = w.ledger.reserved.length; await run(ask("yes")); assert.equal(w.ledger.reserved.length, before + 1); assert.equal(w.ledger.settled.at(-1).nano, Math.ceil(1000 * 1.15));
  const broke = world({ credits: false }); assert.deepEqual(await imageIntentAsk(broke.env, { allowed: true, text: "draw a cat", ledger: () => broke.R.ledger(), deps: { ask: spy, timeoutFor: async () => 1 } }), { ask: false }); assert.equal(called, 0);
  assert.equal(INTENT_QUESTIONS.image.type, "choice"); assert.deepEqual(Object.keys(INTENT_QUESTIONS.image.criteria), ["yes", "no"]);
});

await test("the routes: image-intent is always 200 with ask, image-mode sets and reads, 400 on BYOK", async () => {
  const w = world(), mk = (path, body, headers = {}) => new Request(`https://x.test/w/a${path}`, { method: "POST", headers: { origin: "https://x.test", "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const R = Object.assign(w.R, { bind: async () => {}, imageModeGet: async (s) => imageModeOf(w.sql, s), imageModeSet: async (s, m) => (!setImageMode(w.sql, s, m) ? { error: "No such task in this channel.", status: 404 } : { ok: true, image_mode: m }) });
  const env = { ...w.env, RESIDENT: { idFromName: (x) => x, get: () => R } }, archive = () => ({ channels: async () => [{ id: "1", slug: "ch" }] });
  const t = { id: "t1", plan: "plus" }, ledger = () => ({ reserve: async () => ({ ok: true }), settle: async () => ({}) });
  const call = (sub, body, tt = t, headers) => imageRoute({ req: mk(sub, body, headers), env, t: tt, sub, access: { mode: "active" }, archive, ledger, deps: { ask: async () => ({ answers: { image: { choice: "yes" } }, nano: 0 }), timeoutFor: async () => 100 } });
  let r = await call("/api/image-intent", { channel: "ch", session: null, text: "make a logo" }); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ask: true });
  r = await call("/api/image-intent", { channel: "ch", session: "s1", text: "make a logo" }); assert.deepEqual(await r.json(), { ask: true });
  r = await call("/api/res/ch/sessions/00000000-0000-4000-8000-000000000001/image-mode", { mode: "on" }); assert.equal(r.status, 404);
  w.sql.exec("INSERT INTO sessions (id,title) VALUES ('00000000-0000-4000-8000-000000000001','x')");
  r = await call("/api/res/ch/sessions/00000000-0000-4000-8000-000000000001/image-mode", { mode: "on" }); assert.deepEqual(await r.json(), { ok: true, image_mode: "on" });
  r = await call("/api/res/ch/sessions/00000000-0000-4000-8000-000000000001/image-mode", { mode: "weird" }); assert.equal(r.status, 400);
  setImageMode(w.sql, "s1", "on"); r = await call("/api/image-intent", { channel: "ch", session: "s1", text: "make a logo" }); assert.deepEqual(await r.json(), { ask: false });
  r = await call("/api/image-intent", { channel: "ch", session: null, text: "make a logo" }, { id: "t1", plan: "byok" }); assert.deepEqual(await r.json(), { ask: false });
  r = await call("/api/image-intent", { channel: "ch", session: null, text: "make a logo" }, t, { origin: "https://evil.test" }); assert.deepEqual(await r.json(), { ask: false });
  r = await call("/api/res/ch/sessions/00000000-0000-4000-8000-000000000001/image-mode", { mode: "on" }, { id: "t1", plan: "byok" }); assert.equal(r.status, 400);
  assert.equal(await imageRoute({ req: mk("/api/other", {}), env, t, sub: "/api/other", access: {}, archive, ledger }), null);
});

await test("image_generate: n is capped at 3, one call each, files saved and attached, card events, hold reserved and settled at the reported cost", async () => {
  const w = world(); setImageMode(w.sql, "s1", "on"); const tc = w.tc();
  const out = await runImageTool(w.R, "image_generate", { prompt: "A red boat on the sea", n: 9 }, tc);
  assert.match(out, /Made 3 of 3 pictures/); assert.equal(w.wire.length, 3);
  const files = w.sql.exec("SELECT * FROM files WHERE source='image_gen'").toArray(); assert.equal(files.length, 3); assert.ok(files.every((f) => f.session === "s1" && f.turn === "turn1" && f.mime === "image/png" && w.puts.has(f.r2key)));
  assert.equal(w.R.shared.length, 3); assert.equal(w.events.filter((e) => e.t === "file").length, 3);
  const cards = w.events.filter((e) => e.t === "image_gen").map((e) => e.card); assert.equal(cards[0].status, "working"); assert.deepEqual(cards[0].files, []); assert.equal(cards.at(-1).status, "done"); assert.equal(cards.at(-1).files.length, 3); assert.equal(cards.at(-1).kind, "image_gen"); assert.equal(cards.at(-1).n, 3);
  assert.equal(w.ledger.reserved.length, 1); assert.equal(w.ledger.reserved[0].nano, Math.ceil(3 * 30000000 * 1.15)); assert.equal(w.ledger.settled.length, 1); assert.equal(w.ledger.settled[0].id, w.ledger.reserved[0].id); assert.equal(w.ledger.settled[0].nano, Math.ceil(3 * 0.018 * 1e9 * 1.15)); assert.equal(tc.extraCharge, w.ledger.settled[0].nano);
  const one = await runImageTool(w.R, "image_generate", { prompt: "x" }, w.tc({ turn: "turn2" })); assert.match(one, /Made 1 of 1 picture:/); assert.equal(w.wire.length, 4);
  assert.match(await runImageTool(w.R, "image_generate", { prompt: "" }, w.tc()), /prompt is required/);
});

await test("references: the person's attached pictures go along, newest first, never more than 5", async () => {
  const w = world(); setImageMode(w.sql, "s1", "on");
  for (let i = 1; i <= 8; i++) w.upload(`u${i}`, `photo${i}.png`);
  w.upload("doc", "notes.pdf", { mime: "application/pdf" }); w.upload("other", "elsewhere.png", { session: "s2" });
  await runImageTool(w.R, "image_generate", { prompt: "like these" }, w.tc());
  const sent = w.wire.at(-1).body.input_references.map((r) => r.image_url.url); assert.equal(sent.length, REF_CAP); assert.ok(sent[0].includes("AQID"), "the stored bytes are sent as a data url");
  const rows = referenceRows(w.R, w.tc({ attachedIds: ["u1"] }), { cap: 5 }); assert.deepEqual(rows.map((r) => r.id), ["u1", "u8", "u7", "u6", "u5"]);
  assert.deepEqual(referenceRows(w.R, w.tc(), { references: ["photo2.png", "u3", "notes.pdf", "missing"], cap: 5 }).map((r) => r.id), ["u2", "u3"]);
  assert.deepEqual(referenceRows(w.R, w.tc(), { cap: 2 }).map((r) => r.id), ["u8", "u7"]);
  // a model that takes fewer than 5 lowers the cap
  const s = clone(SEED); s.catalog[SEEDREAM].image.refs = 2; s.catalog[HY].image.refs = 3; const w2 = world({ settings: validateModelSettings(s) }); setImageMode(w2.sql, "s1", "on"); for (let i = 1; i <= 6; i++) w2.upload(`u${i}`, `p${i}.png`);
  await runImageTool(w2.R, "image_generate", { prompt: "x" }, w2.tc()); assert.equal(w2.wire.at(-1).body.input_references.length, 2);
});

await test("image_edit sends the source first (the latest picture made by default), then the marked copy, then the others, and a follow-up resends the generated image", async () => {
  const w = world(); setImageMode(w.sql, "s1", "on"); w.upload("att1", "mine.png");
  await runImageTool(w.R, "image_generate", { prompt: "a cat" }, w.tc());
  const made = w.sql.exec("SELECT * FROM files WHERE source='image_gen'").toArray()[0];
  const out = await runImageTool(w.R, "image_edit", { prompt: "make the cat blue" }, w.tc({ turn: "turn2" }));
  assert.match(out, /Edited and made 1 of 1/); const refs = w.wire.at(-1).body.input_references.map((r) => r.image_url.url);
  assert.ok(refs[0].includes(PNG) && refs[1].includes("AQID") && refs.length === 2, "the generated picture first, then the attached one"); assert.equal(w.wire.at(-1).body.prompt, "make the cat blue");
  const rows = referenceRows(w.R, w.tc(), { source: made, cap: 5 }); assert.deepEqual(rows.map((r) => r.id), [made.id, "att1"]);
  // an edit from the editor: source, marked copy, then the rest
  w.upload("marked1", "marked.png"); const tc = w.tc({ turn: "turn3", imageEdit: { source: made.id, marked: "marked1", marks: [] } });
  assert.deepEqual(referenceRows(w.R, tc, { source: made, cap: 5 }).map((r) => r.id), [made.id, "marked1", "att1"]);
  await runImageTool(w.R, "image_edit", { prompt: "do marks" }, tc); assert.equal(w.wire.at(-1).body.input_references.length, 3);
  assert.match(await runImageTool(w.R, "image_edit", { prompt: "x", source: "nope.png" }, w.tc()), /no picture "nope.png"/);
  const empty = world(); setImageMode(empty.sql, "s1", "on"); assert.match(await runImageTool(empty.R, "image_edit", { prompt: "x" }, empty.tc()), /no picture in this task/);
});

await test("the offer tool ends the turn with an image_offer input request; other tools refuse outside their mode; BYOK refuses everything", async () => {
  const w = world(), tc = w.tc();
  const out = JSON.parse(await runImageTool(w.R, "offer_image_generation", {}, tc)); assert.equal(out.status, "waiting");
  assert.equal(tc.inputRequest.kind, "image_offer"); assert.equal(tc.orchestration.waitingInput, true); assert.equal(w.events.at(-1).t, "user_input"); assert.equal(w.events.at(-1).input.kind, "image_offer");
  assert.equal(pendingInputs(w.sql, "s1")[0].kind, "image_offer"); assert.equal(questionForTurn(w.sql, "turn1").question, "Do you want to generate an image?");
  assert.match(await runImageTool(w.R, "image_generate", { prompt: "x" }, w.tc({ turn: "t9" })), /not on in this task/); assert.equal(w.wire.length, 0);
  setImageMode(w.sql, "s1", "dismissed"); assert.match(await runImageTool(w.R, "offer_image_generation", {}, w.tc({ turn: "t8" })), /not to be asked again/);
  setImageMode(w.sql, "s1", "on"); assert.match(await runImageTool(w.R, "offer_image_generation", {}, w.tc({ turn: "t7" })), /already on/);
  w.setPlan("byok"); for (const name of IMAGE_TOOL_NAMES) assert.match(await runImageTool(w.R, name, { prompt: "x" }, w.tc({ turn: `b${name}` })), /isn't available here/);
  assert.match(await runImageTool(w.R, "image_generate", { prompt: "x" }, w.tc({ helper: { id: 1 } })), /isn't available here/); assert.equal(w.wire.length, 0); assert.equal(w.ledger.reserved.length, 0);
});

await test("no credits: nothing is generated; a failed generation settles at zero and reports the failure", async () => {
  const broke = world({ credits: false }); setImageMode(broke.sql, "s1", "on");
  assert.match(await runImageTool(broke.R, "image_generate", { prompt: "x" }, broke.tc()), /out of credits/); assert.equal(broke.wire.length, 0);
  const bad = world({ fetchImpl: async () => Response.json({ error: { message: "nope" } }, { status: 400 }) }); setImageMode(bad.sql, "s1", "on"); const tc = bad.tc();
  const out = await runImageTool(bad.R, "image_generate", { prompt: "x", n: 2 }, tc); assert.match(out, /^error: no picture was made/); assert.equal(bad.ledger.settled.at(-1).nano, 0); assert.equal(tc.extraCharge, 0);
  assert.equal(bad.events.filter((e) => e.t === "image_gen").at(-1).card.status, "failed");
});

await test("a send with image: true or annotations sets the mode on; annotations become a note and the marked picture rides along", () => {
  const w = world(); w.upload("src1", "made.png", { source: "image_gen" }); w.upload("mk1", "marked.png");
  let r = prepareImageSend(w.R, "s1", { files: ["f1"] }); assert.equal(imageModeOf(w.sql, "s1"), "on"); assert.deepEqual(r.opts.files, ["f1"]);
  setImageMode(w.sql, "s1", null);
  r = prepareImageSend(w.R, "s1", { files: [], annotations: { source: "src1", marked: "mk1", marks: [{ n: 1, color: "red", note: "darker sky" }, { n: 2, color: "blue", note: "" }] } });
  assert.equal(imageModeOf(w.sql, "s1"), "on"); assert.deepEqual(r.opts.files, ["mk1"]); assert.match(r.opts.note, /1 \(red\): darker sky/); assert.match(r.opts.note, /\n2 \(blue\)(?!:)/); assert.deepEqual([r.opts.imageEdit.source, r.opts.imageEdit.marked], ["src1", "mk1"]);
  assert.equal(prepareImageSend(w.R, "s1", { annotations: { source: "gone", marked: "mk1", marks: [] } }).status, 404);
  assert.deepEqual(cleanAnnotations({ source: "00000000-0000-4000-8000-000000000001", marked: "00000000-0000-4000-8000-000000000002", marks: [{ n: 1, color: "red" }] }).marks, [{ n: 1, color: "red", note: "" }]);
  assert.equal(cleanAnnotations(undefined), undefined); assert.equal(cleanAnnotations({ source: "x", marked: "y", marks: [] }), null); assert.equal(cleanAnnotations("no"), null);
  assert.equal(MAX_N, 3);
});

await test("the editor's marked copy is tagged and never an automatic reference later; it stays the explicit marked reference of its own send", async () => {
  const w = world(); setImageMode(w.sql, "s1", "on"); w.upload("att1", "mine.png"); w.upload("src1", "made.png", { source: "image_gen" }); w.upload("mk1", "marked.png");
  const r = prepareImageSend(w.R, "s1", { files: [], annotations: { source: "src1", marked: "mk1", marks: [{ n: 1, color: "#d6293e", note: "x" }] } });
  assert.deepEqual(JSON.parse(w.sql.exec("SELECT tags FROM files WHERE id='mk1'").toArray()[0].tags), [ANNOTATION_TAG]); assert.equal(isAnnotation(w.sql.exec("SELECT * FROM files WHERE id='mk1'").toArray()[0]), true);
  prepareImageSend(w.R, "s1", { annotations: { source: "src1", marked: "mk1", marks: [] } }); assert.deepEqual(JSON.parse(w.sql.exec("SELECT tags FROM files WHERE id='mk1'").toArray()[0].tags), [ANNOTATION_TAG], "tagging twice adds nothing");
  // the same turn: the edit sends source, then the marked copy
  const src = w.sql.exec("SELECT * FROM files WHERE id='src1'").toArray()[0];
  assert.deepEqual(referenceRows(w.R, w.tc({ imageEdit: r.opts.imageEdit, attachedIds: ["mk1"] }), { source: src, cap: 5 }).map((x) => x.id), ["src1", "mk1", "att1"]);
  // a later, unrelated generation: only the person's own attachment goes, not the marked copy (not by the task's uploads, not by the turn's attachments)
  assert.deepEqual(referenceRows(w.R, w.tc({ turn: "later" }), { cap: 5 }).map((x) => x.id), ["att1"]);
  assert.deepEqual(referenceRows(w.R, w.tc({ turn: "later", attachedIds: ["mk1"] }), { cap: 5 }).map((x) => x.id), ["att1"]);
  await runImageTool(w.R, "image_generate", { prompt: "a lighthouse" }, w.tc({ turn: "later" })); const sent = w.wire.at(-1).body.input_references; assert.equal(sent.length, 1); assert.ok(sent[0].image_url.url.includes("AQID"));
});

await test("Don't ask again before the task existed: the send's image_mode dismissed makes the new task dismissed; the helper then has no offer tool, and an earlier decision is never overridden", async () => {
  const w = world(); assert.equal(imageModeOf(w.sql, "s1"), null); dismissOnSend(w.sql, "s1"); assert.equal(imageModeOf(w.sql, "s1"), "dismissed");
  setImageMode(w.sql, "s1", "on"); dismissOnSend(w.sql, "s1"); assert.equal(imageModeOf(w.sql, "s1"), "on", "a task already in image mode stays on");
  assert.deepEqual(imageToolNames(true, "dismissed"), []);
  // a task made before the choice has the offer tool in its frozen list: the turn drops it, and a call is refused
  const { Resident } = await import("../src/resident.js"), offer = imageToolDefs(true, null)[0], plain = { type: "function", function: { name: "web_search", description: "x", parameters: { type: "object", properties: {} } } };
  const fake = { env: w.env, modelToolsBase: Resident.prototype.modelToolsBase, availableTools: () => [] };
  const names = (mode) => Resident.prototype.modelTools.call(fake, { kind: "chat", imageOk: true, imageMode: mode, appendTools: [plain, offer] }).map((t) => t.function.name);
  assert.deepEqual(names(null), ["web_search", "offer_image_generation"]); assert.deepEqual(names("dismissed"), ["web_search"]); assert.deepEqual(names("on"), ["web_search", "image_generate", "image_edit"]);
  setImageMode(w.sql, "s1", "dismissed"); assert.match(await runImageTool(w.R, "offer_image_generation", {}, w.tc()), /not to be asked again/);
  // the route and the resident take the field
  const fs = await import("node:fs"), idx = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8"), res = fs.readFileSync(new URL("../src/resident.js", import.meta.url), "utf8");
  assert.match(idx, /imageModeIn !== "dismissed"\) return json\(\{ error: "Invalid image mode\." \}, 400\)/); assert.match(idx, /imageModeIn === "dismissed" \? \{ image_mode: "dismissed" \}/);
  assert.match(res, /opts\.image_mode === "dismissed" && await imageAllowed\(this\.env, tenant\)\) dismissOnSend/);
});

console.log(`image-gen: ${n} checks passed`);
