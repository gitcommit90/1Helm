// node --import ./test/stubs/register.mjs test/models-page.test.mjs
// Real Worker auth/CSRF boundary + real settings persistence on independent SQLite D1 fixtures.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { modelsHtml, isModelAdmin } from "../src/ee/models-page.js";
globalThis.HTMLRewriter = class { on() { return this; } transform(r) { return r; } };

function environment(name) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT); CREATE TABLE sessions(token_hash TEXT,user_id TEXT,expires_at INTEGER);");
  db.exec(readFileSync(new URL("fixtures/migrations/migrations_055_model_settings.sql", import.meta.url), "utf8"));
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
      const r = await call(path, { env, token: "bb22" }); assert.equal(r.status, 403); noStore(r); assert.doesNotMatch(await r.text(), /gpt-6|model_settings_versions/);
    }
  }
});

await test("page and API read only their environment with safe headers", async () => {
  for (const env of [dev, live]) {
    const r = await call("/models", { env }); assert.equal(r.status, 200); noStore(r); assert.match(r.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    const text = await r.text(); assert.match(text, /Models/); assert.doesNotMatch(text, /https:\/\/[^" ]+\/models/);
    assert.match(text, env === dev ? /Save for Dev/ : /Save for Production/);
    const api = await call("/models/api", { env }); const data = await api.json(); assert.equal(data.revision, 0); assert.equal(data.environment, env.ENV_NAME); assert.equal(data.options.models.length, 6);
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
  for (const path of ["/models/api/save", "/models/api/reset", "/models/api/restore"]) {
    for (const headers of [{ origin: "https://evil.example" }, { origin: "https://app.example.com" }, { origin: "null" }, { origin: "" }, { "x-model-settings": "" }, { "x-model-settings": "0" }, { "content-type": "text/plain" }, { "content-type": "application/json-evil" }, { "sec-fetch-site": "cross-site" }]) {
      const r = await post(path, { revision: 0 }, { headers }); assert.equal(r.status, 403, JSON.stringify(headers)); noStore(r);
    }
    assert.equal((await post(path, { revision: 0 }, { token: null })).status, 401);
    assert.equal((await post(path, { revision: 0 }, { token: "bb22" })).status, 403);
  }
  assert.equal((await (await call("/models/api")).json()).revision, 0);
});

await test("body validation and size limits reject bad input", async () => {
  for (const raw of ["{broken", "[]", "null", "1"]) assert.equal((await post("/models/api/save", raw)).status, 400);
  assert.equal((await post("/models/api/save", " ".repeat(32769))).status, 413);
  assert.equal((await post("/models/api/save", {}, { headers: { "content-length": "32769" } })).status, 413);
});

await test("save, stale conflict, restore and reset are versioned and dev/live isolated", async () => {
  const original = await (await call("/models/api")).json();
  const config = structuredClone(original.config); config.efforts.sol = "medium";
  let r = await post("/models/api/save", { revision: 0, config }); assert.equal(r.status, 200); let value = await r.json(); assert.equal(value.revision, 1); assert.equal(value.config.efforts.sol, "medium"); assert.equal(value.history[0].by, "admin@example.com");
  r = await post("/models/api/save", { revision: 0, config }); assert.equal(r.status, 409);
  assert.equal((await (await call("/models/api", { env: live })).json()).revision, 0);
  r = await post("/models/api/reset", { revision: 1 }); assert.equal(r.status, 200); value = await r.json(); assert.equal(value.revision, 2); assert.deepEqual(value.config, original.config);
  r = await post("/models/api/restore", { revision: 2, restore_revision: 1 }); assert.equal(r.status, 200); value = await r.json(); assert.equal(value.revision, 3); assert.equal(value.config.efforts.sol, "medium");
  r = await post("/models/api/restore", { revision: 3, restore_revision: 987 }); assert.equal(r.status, 404);
  r = await post("/models/api/reset", { revision: 0 }, { env: live }); assert.equal(r.status, 200); assert.equal((await r.json()).revision, 1);
  assert.equal((await (await call("/models/api")).json()).revision, 3);
});

await test("invalid model settings do not create a version", async () => {
  const current = await (await call("/models/api")).json();
  current.config.efforts.sol = "not-an-effort";
  const r = await post("/models/api/save", { revision: current.revision, config: current.config }); assert.equal(r.status, 400);
  assert.equal((await (await call("/models/api")).json()).revision, current.revision);
});

await test("view-as cannot read or write model controls", async () => {
  for (const path of ["/models", "/models/api"]) assert.equal((await call(path, { token: "a".repeat(80) })).status, path === "/models" ? 302 : 401);
  assert.equal((await post("/models/api/reset", { revision: 3 }, { token: "a".repeat(80) })).status, 401);
});

await test("corrupt saved config keeps reset and history recovery available", async () => {
  dev.db.prepare("UPDATE model_settings_versions SET config=? WHERE environment='dev' AND revision=3").run('{"broken":true}');
  const r = await call("/models/api"); assert.equal(r.status, 200); const view = await r.json(); assert.ok(view.config_error); assert.equal(view.revision, 3); assert.ok(view.history.length);
  const reset = await post("/models/api/reset", { revision: 3 }); assert.equal(reset.status, 200); const repaired = await reset.json(); assert.equal(repaired.config_error, null); assert.equal(repaired.revision, 4);
});

await test("history actor markup cannot escape JSON script or create HTML", async () => {
  const current = await (await call("/models/api")).json();
  current.history.push({ revision: 50, at: Date.now(), by: '</script><img src=x onerror="alert(1)">\u2028\u2029', action: "save" });
  const result = modelsHtml(current, dev);
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
    return Response.json({ data: String(url).endsWith("/models") ? [candidate] : String(url).endsWith("/endpoints/zdr") ? [endpoint] : { endpoints: [] } });
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
    current.config.models = Object.fromEntries(current.options.models.map((m) => [m.key, m.model])); current.config.models.sol = candidate.id; current.config.efforts.sol = "low";
    const saved = await post("/models/api/save", { revision: current.revision, config: current.config }); assert.equal(saved.status, 200); const updated = await saved.json(); assert.equal(updated.config.models.sol, candidate.id); assert.equal(updated.config.catalog[candidate.id].name, candidate.name);
    assert.equal((await (await call("/models/api", { env: live })).json()).config.models, undefined);
    globalThis.fetch = async () => { throw new Error("secret upstream failure"); };
    const failed = await call("/models/api/catalog"); assert.equal(failed.status, 503); noStore(failed); assert.match((await failed.json()).error, /catalog is unavailable/);
  } finally { globalThis.fetch = originalFetch; }
});

await test("storage errors are sanitized and never cached", async () => {
  const env = { ...dev, DB: { prepare(q) { if (/sessions/.test(q)) return dev.DB.prepare(q); throw new Error("secret connection details"); } } };
  for (const path of ["/models", "/models/api"]) {
    const r = await call(path, { env }); assert.equal(r.status, 503); noStore(r); assert.doesNotMatch(await r.text(), /secret connection details/);
  }
});

console.log(`PASS ${checks} model page security and integration checks`);
dev.db.close(); live.db.close();
