// node --import ./test/stubs/register.mjs test/models-console.test.mjs
// Real Worker auth/CSRF boundary + real settings persistence on independent SQLite D1 fixtures.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { consoleHtml, consoleState, isModelAdmin } from "../src/ee/models-console.js";
import { mergeKnown } from "../app-assets/app-static/models-console-core.js";
import { JOB_IDS, JOBS } from "../src/ee/model-jobs.js";
import { ID } from "./helpers/seed-settings.mjs";
// The test never asks live OpenRouter: restoring an older version checks each model against its public list, so every fetch here fails
// (the check treats "could not read the list" as "nothing is gone") and a test that needs a list installs its own stub.
globalThis.fetch = async () => { throw new Error("offline: this test does not use the network"); };
globalThis.HTMLRewriter = class { on() { return this; } transform(r) { return r; } };

function environment(name) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT); CREATE TABLE sessions(token_hash TEXT,user_id TEXT,expires_at INTEGER);");
  db.exec(readFileSync(new URL("fixtures/migrations/migrations_055_model_settings.sql", import.meta.url), "utf8"));   // the earlier table (read once, if it has rows)
  db.exec(readFileSync(new URL("../db/migrations/0050_model_job_settings.sql", import.meta.url), "utf8"));
  const hash = (v) => createHash("sha256").update(v).digest("hex");
  for (const [id, email, token, expires] of [["admin", "admin@example.com", "aa11", Date.now() + 3600000], ["other", "other@example.com", "bb22", Date.now() + 3600000], ["expired", "admin@example.com", "cc33", 1]]) {
    db.prepare("INSERT INTO users VALUES (?,?)").run(id, email);
    db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(hash(token), id, expires);
  }
  const DB = { prepare(q) { const statement = db.prepare(q); let args = []; const stmt = { bind(...v) { args = v; return stmt; }, async first() { return statement.get(...args) || null; }, async all() { return { results: statement.all(...args) }; }, async run() { return { meta: { changes: Number(statement.run(...args).changes) } }; } }; return stmt; } };
  return { ONEHELM_EE: "1hc", ENV_NAME: name, APP_HOST: name === "dev" ? "owner.example.com" : "app.example.com", MODEL_ADMINS: " Admin@Example.com ", RELEASE_ADMINS: "other@example.com", DB, db };
}
const dev = environment("dev"), live = environment("live");
const call = (path, { env = dev, token = "aa11", method = "GET", body, headers = {} } = {}) => worker.fetch(new Request(`https://${env.APP_HOST}${path}`, {
  method, headers: { ...(token ? { cookie: `hc_session=${token}` } : {}), ...headers }, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
}), env, { waitUntil() {} });
const post = (path, body, options = {}) => call(path, { method: "POST", body, ...options, headers: { origin: `https://${options.env?.APP_HOST || dev.APP_HOST}`, "content-type": "application/json", "x-model-settings": "1", ...options.headers } });
const noStore = (r) => { assert.match(r.headers.get("cache-control"), /no-store/); assert.equal(r.headers.get("access-control-allow-origin"), null); };
let checks = 0;
const test = async (name, fn) => { await fn(); checks++; console.log(`ok ${checks} - ${name}`); };

await test("scoped allowlist does not inherit release/test permissions", async () => {
  assert.equal(isModelAdmin(dev, { email: "admin@example.com" }), true);
  assert.equal(isModelAdmin({ RELEASE_ADMINS: "admin@example.com", TEST_MODE: "1" }, { email: "admin@example.com" }), false);
  assert.equal(isModelAdmin({}, null), false);
  for (const env of [dev, live]) {
    for (const token of [null, "cc33", "aa99"]) {
      let r = await call("/models", { env, token }); assert.equal(r.status, 302); assert.equal(r.headers.get("location"), "/onboard?next=/models"); noStore(r);
      r = await call("/models/api", { env, token }); assert.equal(r.status, 401); noStore(r); assert.match((await r.json()).error, /Sign in/);
    }
    for (const path of ["/models", "/models/api", "/models/api/save"]) {
      const r = await call(path, { env, token: "bb22" }); assert.equal(r.status, 403); noStore(r); assert.doesNotMatch(await r.text(), /gpt-6|model_settings_versions|model_job_settings_versions/);
    }
  }
});

await test("page and API read only their environment with safe headers", async () => {
  for (const env of [dev, live]) {
    const r = await call("/models", { env }); assert.equal(r.status, 200); noStore(r); assert.match(r.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    const text = await r.text(); assert.match(text, /Models/); assert.doesNotMatch(text, /1helm\.com|data-e=|Push to prod|Differs from Live|payout/i);
    assert.match(text, /<link rel="stylesheet" href="\/app-static\/models-console\.css">/); assert.match(text, /<script type="module" src="\/app-static\/models-console\.js">/); assert.doesNotMatch(text, /<script>|<style|style="/, "no inline script or style, so the page's content security policy can forbid them");
    assert.match(r.headers.get("content-security-policy"), /script-src 'self'/);
    // the page has no built-in-default wording, no shared-slot wording and no reset to default
    for (const word of [/\bChanged\b/, /Reset to default/i, /replaces .* everywhere/i, /\bslot\b/i, /Restore defaults/, /Built-in/i]) assert.doesNotMatch(text, word, String(word));
    const api = await call("/models/api", { env }); const data = await api.json(); assert.equal(data.revision, 1, "the first read saves the first version"); assert.equal(data.environment, env.ENV_NAME);
    assert.deepEqual(Object.keys(data.config.jobs).sort(), [...JOB_IDS].sort(), "every job has its own saved setting"); assert.equal(data.jobs.length, JOB_IDS.length, "every job has a controls row");
    for (const j of Object.values(data.config.jobs)) assert.ok(j.model && Array.isArray(j.fallbacks));
    assert.equal(data.jobs.length, JOB_IDS.length); assert.equal(data.history[0].action, "seed");
    assert.ok(data.groups.some((g) => g.id === "other")); assert.ok(data.groups.some((g) => g.id === "other"));
    for (const id of ["workers_ai_chat", "look", "embed_files"]) {
      assert.ok(data.config.jobs[id], `${id} has a saved setting`);
      assert.ok(data.jobs.some((j) => j.id === id), `${id} is shown`);
    }
    assert.match(text, /Backup chat/); assert.match(text, /Other/);
    for (const j of data.jobs) { assert.ok(j.limits && "max_output" in j.limits && "sort" in j.limits && "max_price" in j.limits, `${j.id} shows its limits`); assert.deepEqual(Object.keys(j.main).filter((k) => /^(hosts|pin)$/.test(k)), []); }
    const head = await call("/models", { env, method: "HEAD" }); assert.equal(head.status, 200); assert.equal(await head.text(), "");
  }
});

await test("unknown paths and methods cannot mutate settings", async () => {
  assert.equal((await call("/models/unknown")).status, 404);
  assert.equal((await call("/models/api/save")).status, 405);
  assert.equal((await post("/models/api", {})).status, 405);
  assert.equal((await call("/models", { method: "DELETE" })).status, 405);
  assert.equal((await call("/models/api", { method: "OPTIONS" })).status, 405);
});

await test("every mutation rejects cross-origin and malformed CSRF requests", async () => {
  for (const path of ["/models/api/save", "/models/api/restore"]) {
    for (const headers of [{ origin: "https://evil.example" }, { origin: "https://app.example.com" }, { origin: "null" }, { origin: "" }, { "x-model-settings": "" }, { "x-model-settings": "0" }, { "content-type": "text/plain" }, { "content-type": "application/json-evil" }, { "sec-fetch-site": "cross-site" }]) {
      const r = await post(path, { revision: 0 }, { headers }); assert.equal(r.status, 403, JSON.stringify(headers)); noStore(r);
    }
    assert.equal((await post(path, { revision: 0 }, { token: null })).status, 401);
    assert.equal((await post(path, { revision: 0 }, { token: "bb22" })).status, 403);
  }
  assert.equal((await (await call("/models/api")).json()).revision, 1);
});
await test("the removed reset endpoint is gone", async () => { assert.equal((await post("/models/api/reset", { revision: 1 })).status, 404); });

await test("body validation and size limits reject bad input", async () => {
  for (const raw of ["{broken", "[]", "null", "1"]) assert.equal((await post("/models/api/save", raw)).status, 400);
  assert.equal((await post("/models/api/save", " ".repeat(131073))).status, 413);
  assert.equal((await post("/models/api/save", {}, { headers: { "content-length": "131073" } })).status, 413);
});

await test("save, stale conflict and restore are versioned and environment isolated", async () => {
  const original = await (await call("/models/api")).json();
  const config = structuredClone(original.config); config.jobs.label.effort = "medium";
  let r = await post("/models/api/save", { revision: 1, config }); assert.equal(r.status, 200); let value = await r.json(); assert.equal(value.revision, 2); assert.equal(value.config.jobs.label.effort, "medium"); assert.equal(value.history[0].by, "admin@example.com");
  r = await post("/models/api/save", { revision: 1, config }); assert.equal(r.status, 409);
  assert.equal((await (await call("/models/api", { env: live })).json()).revision, 1, "live has its own first version");
  r = await post("/models/api/restore", { revision: 2, restore_revision: 1 }); assert.equal(r.status, 200); value = await r.json(); assert.equal(value.revision, 3); assert.deepEqual(value.config, original.config);
  assert.ok(value.jobs.some((j) => j.group === "other"));
  r = await post("/models/api/restore", { revision: 3, restore_revision: 2 }); assert.equal(r.status, 200); value = await r.json(); assert.equal(value.revision, 4); assert.equal(value.config.jobs.label.effort, "medium");
  r = await post("/models/api/restore", { revision: 4, restore_revision: 987 }); assert.equal(r.status, 404);
  assert.equal((await (await call("/models/api", { env: live })).json()).revision, 1); assert.equal((await (await call("/models/api")).json()).revision, 4);
});

await test("invalid model settings do not create a version", async () => {
  const current = await (await call("/models/api")).json();
  current.config.jobs.label.effort = "not-an-effort";
  // The model list is a local stub that offers the job's own model with the reasoning levels low and high, so "not-an-effort" is refused by 1Helm's check.
  const originalFetch = globalThis.fetch, id = current.config.jobs.label.model;
  const candidate = { id, name: "Fixture", architecture: { input_modalities: ["text"], output_modalities: ["text"] }, reasoning: { mandatory: false, supported_efforts: ["low", "high"], default_effort: "low" } };
  const endpoint = { model_id: id, tag: "fixture-zdr", context_length: 131072, max_completion_tokens: 16384, pricing: { prompt: "0.000001", completion: "0.000002" }, supported_parameters: ["tools", "max_tokens", "reasoning", "response_format"], supports_tool_choice: { auto: true, none: true, required: true, function: true } };
  globalThis.fetch = async (url) => Response.json({ data: /\/models(\?|$)/.test(String(url)) ? [candidate] : String(url).endsWith("/endpoints/zdr") ? [endpoint] : { endpoints: [] } });
  try {
    const r = await post("/models/api/save", { revision: current.revision, config: current.config }); assert.equal(r.status, 400);
  } finally { globalThis.fetch = originalFetch; }
  assert.equal((await (await call("/models/api")).json()).revision, current.revision);
});

await test("view-as cannot read or write model controls", async () => {
  for (const path of ["/models", "/models/api"]) assert.equal((await call(path, { token: "a".repeat(80) })).status, path === "/models" ? 302 : 401);
  assert.equal((await post("/models/api/restore", { revision: 4, restore_revision: 1 }, { token: "a".repeat(80) })).status, 401);
});

await test("a corrupt saved version is reported, the last good copy keeps serving, and restoring an earlier version repairs it", async () => {
  dev.db.prepare("UPDATE model_job_settings_versions SET config=? WHERE environment='dev' AND revision=4").run('{"broken":true}');
  const r = await call("/models/api"); assert.equal(r.status, 200); const view = await r.json(); assert.equal(view.stale, true, "serving the last copy that was read, and the page says so"); assert.equal(view.revision, 4); assert.ok(view.history.length);
  assert.match(await (await call("/models")).text(), /last copy that was read/);
  const repaired = await post("/models/api/restore", { revision: 4, restore_revision: 3 }); assert.equal(repaired.status, 200); const fixed = await repaired.json(); assert.equal(fixed.stale, false); assert.equal(fixed.revision, 5);
});

await test("history actor markup cannot escape JSON script or create HTML", async () => {
  const current = await (await call("/models/api")).json();
  current.history.push({ revision: 50, at: Date.now(), by: '</script><img src=x onerror="alert(1)">\u2028\u2029', action: "save" });
  const result = consoleHtml(current);
  assert.doesNotMatch(result, /<img src=x/); assert.match(result, /\\u003c\/script>/); assert.match(result, /\\u2028\\u2029/);
  const data = result.match(/<script id="model-state" type="application\/json">([\s\S]*?)<\/script>/)[1];
  assert.equal(JSON.parse(data).history.at(-1).by, current.history.at(-1).by);
});

await test("catalog is admin-only, read-only, no-store and never forwards credentials or browser URLs", async () => {
  const originalFetch = globalThis.fetch, upstream = [];
  const candidate = { id: "fixture/replacement", name: "Fixture replacement <script>untrusted</script>", architecture: { input_modalities: ["text"], output_modalities: ["text"] }, reasoning: { mandatory: false, supported_efforts: ["low", "high"], default_effort: "low" } };
  const endpoint = { model_id: candidate.id, tag: "fixture-zdr", context_length: 131072, max_completion_tokens: 16384, pricing: { prompt: "0.000001", completion: "0.000002" }, supported_parameters: ["tools", "max_tokens", "reasoning", "response_format"], supports_tool_choice: { auto: true, none: true, required: true, function: true } };
  globalThis.fetch = async (url, init) => {
    upstream.push({ url: String(url), headers: new Headers(init.headers) });
    return Response.json({ data: /\/models(\?|$)/.test(String(url)) ? [candidate] : String(url).endsWith("/endpoints/zdr") ? [endpoint] : { endpoints: [] } });
  };
  try {
    for (const token of [null, "bb22"]) assert.equal((await call("/models/api/catalog?q=fixture", { token })).status, token ? 403 : 401);
    assert.equal(upstream.length, 0);
    const r = await call("/models/api/catalog?q=replacement", { env: { ...dev, OPENROUTER_KEY: "never-forward-this" } }); assert.equal(r.status, 200); noStore(r);
    const catalog = await r.json(); assert.equal(catalog.models.length, 1); assert.equal(catalog.models[0].id, candidate.id); assert.equal(catalog.models[0].eligible, true);
    assert.ok(upstream.every((r) => r.url.startsWith("https://openrouter.ai/api/v1/") && !r.headers.has("authorization") && !r.headers.has("cookie")));
    assert.equal((await post("/models/api/catalog", {})).status, 405);
    const none = await call("/models/api/catalog?q=https://evil.example/"); assert.deepEqual((await none.json()).models, []);
    const current = await (await call("/models/api")).json();
    current.config.jobs.label = { model: candidate.id, effort: "low", fallbacks: [current.config.jobs.label, ...current.config.jobs.label.fallbacks].map(({ fallbacks, ...e }) => e).slice(0, 2) };
    const saved = await post("/models/api/save", { revision: current.revision, config: { version: 3, jobs: current.config.jobs, routing: current.config.routing } }); assert.equal(saved.status, 200); const updated = await saved.json();
    assert.equal(updated.config.jobs.label.model, candidate.id); assert.equal(updated.config.catalog[candidate.id].name, candidate.name);
    assert.equal((await (await call("/models/api", { env: live })).json()).config.jobs.label.model, ID.HAIKU, "the other environment is untouched");
    globalThis.fetch = async () => { throw new Error("secret upstream failure"); };
    const failed = await call("/models/api/catalog"); assert.equal(failed.status, 503); noStore(failed); assert.match((await failed.json()).error, /catalog is unavailable/);
  } finally { globalThis.fetch = originalFetch; }
});

await test("storage errors are sanitized and never cached", async () => {
  const env = { ...dev, DB: { prepare(q) { if (/sessions/.test(q)) return dev.DB.prepare(q); throw new Error("secret connection details"); } } };
  for (const path of ["/models", "/models/api"]) {   // the last good copy this instance read keeps the page readable, and says so
    const r = await call(path, { env }); noStore(r); const text = await r.text(); assert.doesNotMatch(text, /secret connection details/);
  }
  const current = await (await call("/models/api")).json();
  const r = await post("/models/api/save", { revision: current.revision, config: { version: 3, jobs: current.config.jobs, routing: current.config.routing } }, { env }); assert.equal(r.status, 503); noStore(r); assert.doesNotMatch(await r.text(), /secret connection details/);
});

await test("the dashboard shows exactly what is saved for each job, and a change shows on the very next read", async () => {
  const { modelDashboard } = await import("../src/ee/model-dashboard.js");
  const view = await (await call("/models/api")).json(), rows = Object.fromEntries(view.jobs.map((j) => [j.id, j]));
  for (const def of JOBS) {
    const saved = view.config.jobs[def.id], row = rows[def.id];
    assert.equal(row.main.id, saved.model, def.id); assert.deepEqual(row.fallbacks.map((f) => f.id), saved.fallbacks.map((f) => f.model), def.id);
    if (row.has_effort) { assert.equal(row.main.effort, saved.effort); assert.deepEqual(row.fallbacks.map((f) => f.effort), saved.fallbacks.map((f) => f.effort)); } else assert.equal(row.main.effort, null);
  }
  // there is no chat job: General and the other categories carry the limits of their replies
  assert.ok(!rows.chat && !("chat" in view.config.jobs), "the chat job is gone from the page and from the saved jobs");
  // a limit saved on a category is stored on that category, comes back on the next read, and the other categories keep theirs
  const cfg = structuredClone(view.config); cfg.routing.categories[0].max_output = 4321; cfg.routing.categories[0].sort = "latency";
  const saved = await (await post("/models/api/save", { revision: view.revision, config: { version: 3, jobs: cfg.jobs, routing: cfg.routing } })).json();
  assert.equal(saved.config.routing.categories[0].max_output, 4321); assert.equal(saved.config.routing.categories[0].sort, "latency");
  assert.equal((await (await call("/models/api")).json()).config.routing.categories[0].max_output, 4321);
  // a limit that is not valid is refused
  const worse = structuredClone(saved.config); worse.routing.categories[0].max_output = 0;
  assert.equal((await post("/models/api/save", { revision: saved.revision, config: { version: 3, jobs: worse.jobs, routing: worse.routing } })).status, 400);
  assert.equal(modelDashboard(saved).jobs.length, JOB_IDS.length);
  // restore the version before the change, for the tests after this one
  assert.equal((await post("/models/api/restore", { revision: saved.revision, restore_revision: view.revision })).status, 200);
});

await test("a page change replaces one model of one category only, and the saved copy is the server's", async () => {
  const originalFetch = globalThis.fetch;
  const cand = { id: "fixture/dash-model", name: "Fixture Dash", architecture: { input_modalities: ["text"], output_modalities: ["text"] }, reasoning: { mandatory: false, supported_efforts: ["low", "high"], default_effort: "low" } };
  const ep = { model_id: cand.id, tag: "fixture-zdr", context_length: 131072, max_completion_tokens: 16384, pricing: { prompt: "0.000001", completion: "0.000002" }, supported_parameters: ["tools", "max_tokens", "reasoning", "response_format"], supports_tool_choice: { auto: true, none: true, required: true } };
  globalThis.fetch = async (url) => Response.json({ data: /\/models(\?|$)/.test(String(url)) ? [cand] : String(url).endsWith("/endpoints/zdr") ? [ep] : { endpoints: [] } });
  try {
    const view = await (await call("/models/api")).json(), cfg = structuredClone(view.config), before = structuredClone(view.config.jobs);
    cfg.routing.categories[0].chains.unrestricted[0] = { model: cand.id, effort: "low" };
    const saved = await (await post("/models/api/save", { revision: view.revision, config: { version: 3, jobs: cfg.jobs, routing: cfg.routing } })).json();
    assert.equal(saved.config.routing.categories[0].chains.unrestricted[0].model, cand.id); assert.equal(saved.config.catalog[cand.id].name, "Fixture Dash");
    for (const id of JOB_IDS) assert.deepEqual(saved.config.jobs[id], before[id], `${id} is untouched: no shared slot moved with it`);
  } finally { globalThis.fetch = originalFetch; }
});

await test("model order and reasoning of a category save like any other change", async () => {
  const view = await (await call("/models/api")).json(), cfg = structuredClone(view.config), chain = cfg.routing.categories[0].chains.zdr;
  const [a, b] = [chain[0], chain[1]]; chain[0] = b; chain[1] = a;
  const save = (c) => post("/models/api/save", { revision: c.revision, config: { version: 3, jobs: c.config.jobs, routing: c.config.routing } });
  let saved = await (await save({ revision: view.revision, config: cfg })).json();
  assert.deepEqual(saved.config.routing.categories[0].chains.zdr.slice(0, 2).map((e) => e.model), [b.model, a.model]);
  const dup = structuredClone(saved.config); dup.routing.categories[0].chains.zdr[1] = { ...dup.routing.categories[0].chains.zdr[0] };
  assert.equal((await save({ revision: saved.revision, config: dup })).status, 400, "a model can be listed once");
  const evil = structuredClone(saved.config); evil.jobs.evil = evil.jobs.handoff;
  assert.equal((await save({ revision: saved.revision, config: evil })).status, 400);
});

await test("search lists saved models with the live name, price and reasoning levels, not the saved copy", async () => {
  const saved = [{ id: "xiaomi/mimo-v2.6-flash", name: "Xiaomi: MiMo-V2.6-Flash (old)", efforts: ["low"] }, { id: "@cf/old/model", name: "Old model", efforts: [] }];
  const fresh = [{ id: "xiaomi/mimo-v2.6-flash", name: "Xiaomi: MiMo-V2.6-Flash", efforts: ["none", "low"], default_effort: "low", pricing: { prompt: 0.14, completion: 0.28 } }];
  const out = mergeKnown(saved, fresh, "mimo");
  assert.equal(out.length, 1); assert.equal(out[0].name, "Xiaomi: MiMo-V2.6-Flash"); assert.deepEqual(out[0].pricing, { prompt: 0.14, completion: 0.28 }); assert.deepEqual(out[0].efforts, ["none", "low"]);
  assert.deepEqual(mergeKnown(saved, fresh, "").map((m) => m.id), ["xiaomi/mimo-v2.6-flash", "@cf/old/model"], "saved models missing from the live catalog stay listed");
});

await test("the push, receive, live and payout routes do not exist, and the page and assets name no private host", async () => {
  for (const path of ["/models/api/live", "/models/api/push-prod", "/models/api/receive", "/models/api/payout-switch", "/models/api/report"]) {
    for (const method of ["GET", "POST"]) { const r = await (method === "POST" ? post(path, {}) : call(path)); assert.equal(r.status, 404, `${method} ${path}`); }
  }
  const files = ["models-console-core.js", "models-console.js", "models-console.css"].map((f) => readFileSync(new URL(`../app-assets/app-static/${f}`, import.meta.url), "utf8"));
  const page = await (await call("/models")).text();
  for (const text of [page, ...files]) assert.doesNotMatch(text, /dev\.1helm\.com|app\.1helm\.com|Push to prod|Match Live|Differs from Live|payout-switch|push-prod/i);
});

console.log(`PASS ${checks} model page security and integration checks`);
dev.db.close(); live.db.close();
