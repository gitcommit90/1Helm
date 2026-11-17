// node --import ./test/stubs/register.mjs test/byok-tokenpass.test.mjs
// Vercel Token Pass connection against a mocked fetch: the key is saved sealed with no check, the model list is Vercel's public list (no key sent) cut to the covered models,
// a chat goes to the fixed address with the key, and Remove takes it out.
import assert from "node:assert/strict"; import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
import { byokApi, byokChat, loadByok, TP_BASE } from "../src/byok.js";
import { connDdl } from "../src/ee/byok-connections.js";
import { validateModelSettings, saveExactModelSettings, readModelSettings } from "../src/ee/model-settings.js";
import { SEED } from "./helpers/seed-settings.mjs";
import { TOKENPASS_MODELS } from "../src/ee/model-seed.js";
import { ownPicker, _resetLists } from "../src/ee/byok-custom.js";

const KEY = "vck_SECRET-key-0123456789";
const d1 = new DatabaseSync(":memory:");
d1.exec(`CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT, owner_user_id TEXT, helper_name TEXT, first_name TEXT, status TEXT DEFAULT 'active', plan TEXT, stripe_subscription TEXT DEFAULT '', updated_at INTEGER);
  INSERT INTO tenants (id, slug, helper_name, first_name, plan) VALUES ('t1','ck1','Ollie','Sam','byok');`);
for (const f of ["0022_031_byok", "0025_034_byok_mode", "0038_046_ai_privacy", "0065_custom_models_own_key", "0069_byok_chatgpt", "0068_byok_effort", "0070_byok_connections"]) d1.exec(readFileSync(new URL(`../db/migrations/${f}.sql`, import.meta.url), "utf8"));
const D1 = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }),
  run: async () => { const r = st.run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; } };
const env = { ONEHELM_EE: "1hc", DB: D1, GATEWAY_HOST: "app.example.test", APP_HOST: "app.example.test", ENV_NAME: "test", VAULT_KEY: Buffer.from(new Uint8Array(32).map((_, i) => i * 5 + 1)).toString("base64"), LEDGER: { idFromName: (n) => n, get: () => ({}) } };
const TP_MODELS = ["vendor-a/one", "vendor-a/two", "vendor-b/three", "vendor-b/four", "vendor-c/five"];   // the saved Models setting
env.MODEL_SETTINGS = { tokenpass_models: TP_MODELS };
const jres = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const M = (id) => ({ id, name: id, type: "language", tags: ["tool-use"], pricing: { input: "0.000001", output: "0.000004" } });
const LIST = { data: [...TP_MODELS.slice(0, 4).map(M), M("openai/gpt-6"), M("moonshotai/kimi-k3-fast")] };   // the fifth covered model is missing from the list
const seen = [];
globalThis.fetch = async (u, init = {}) => {
  const url = new URL(String(u)); seen.push({ url: String(u), method: init.method || "GET", auth: init.headers?.authorization, body: init.body ? JSON.parse(init.body) : null });
  if (url.hostname !== "ai-gateway.vercel.sh") throw new Error(`unexpected fetch ${u}`);
  if (url.pathname === "/v1/models") return jres(LIST);
  if (url.pathname === "/v1/chat/completions") return jres({ model: "m", choices: [{ message: { role: "assistant", content: "ok" } }] });
  throw new Error(`unexpected fetch ${u}`);
};
const api = async (sub, body) => { const r = await byokApi(new Request(`https://app.example.test/w/ck1${sub}`, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }), env,
  d1.prepare("SELECT * FROM tenants WHERE id='t1'").get(), sub, { json: (o, status = 200) => jres(o, status) });
  const text = await r.text(); assert.ok(!text.includes(KEY), "the key is never in a response"); return { status: r.status, d: JSON.parse(text) }; };
await connDdl(env); _resetLists();

let x = await api("/api/byok/tokenpass", { key: KEY }); assert.equal(x.d.field, "ack");
x = await api("/api/byok/tokenpass", { key: "", ack: true }); assert.equal(x.d.field, "key");
x = await api("/api/byok/tokenpass", { key: "a\nb", ack: true }); assert.equal(x.d.field, "key");
assert.equal(seen.length, 0, "nothing was sent to Vercel while saving");
x = await api("/api/byok/tokenpass", { key: KEY, ack: true });
assert.equal(x.d.ok, true, JSON.stringify(x.d)); assert.deepEqual(x.d.connections.map((c) => [c.id, c.kind, c.label, c.last4]), [["tokenpass", "tokenpass", "Vercel Token Pass", KEY.slice(-4)]]);
assert.equal(seen.length, 0, "the key is not checked");
assert.ok(!JSON.stringify(d1.prepare("SELECT * FROM byok_connections").all()).includes(KEY), "the key is sealed");
x = await api("/api/byok/tokenpass", { key: KEY, ack: true }); assert.equal(x.d.connections.length, 1, "one connection only");

const p = await ownPicker(env, { id: "t1" }, "own", "");
assert.deepEqual(p.models.map((m) => m.id).sort(), TP_MODELS.slice(0, 4).map((id) => `tokenpass:${id}`).sort(), "only the covered models that Vercel lists");
assert.ok(seen.filter((c) => c.url.endsWith("/models")).every((c) => !c.auth), "the public list gets no key");

const cfg = await loadByok(env, "t1"); const n = seen.length;
await (await byokChat(cfg, { messages: [{ role: "user", content: "hi" }] }, { model: "tokenpass:vendor-b/three" })).text();
const post = seen.slice(n).find((c) => c.method === "POST");
assert.equal(post.url, `${TP_BASE}/chat/completions`); assert.equal(post.auth, `Bearer ${KEY}`); assert.equal(post.body.model, "vendor-b/three"); assert.equal(post.body.providerOptions, undefined, "no provider options sent");

x = await api("/api/byok/remove", { id: "tokenpass" }); assert.deepEqual(x.d.connections, []);
assert.equal(d1.prepare("SELECT COUNT(*) n FROM byok_connections").get().n, 0);
// The covered list is a saved setting: settings saved without it read as the starting list, and a bad list is refused.
const { tokenpass_models: _drop, ...bare } = SEED;
assert.deepEqual(validateModelSettings(bare).tokenpass_models, TOKENPASS_MODELS);
assert.deepEqual(validateModelSettings({ ...SEED, tokenpass_models: ["a/b"] }).tokenpass_models, ["a/b"]);
{ const sql = new DatabaseSync(":memory:"); sql.exec(readFileSync(new URL("../db/migrations/0050_model_job_settings.sql", import.meta.url), "utf8"));
  const db = { prepare: (q) => { const st = sql.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => ({ meta: { changes: Number(st.run(...a).changes) } }) }; return o; } };
  const e2 = { ONEHELM_EE: "1hc", DB: db, ENV_NAME: "test" };
  await saveExactModelSettings(e2, { revision: (await readModelSettings(e2)).revision, config: { ...SEED, tokenpass_models: [...TOKENPASS_MODELS] } }, "t");
  assert.ok(!("tokenpass_models" in JSON.parse(sql.prepare("SELECT config FROM model_job_settings_versions ORDER BY revision DESC").get().config)), "the starting list is not stored");
  await saveExactModelSettings(e2, { revision: (await readModelSettings(e2)).revision, config: { ...SEED, tokenpass_models: ["a/b"] } }, "t");
  assert.deepEqual(JSON.parse(sql.prepare("SELECT config FROM model_job_settings_versions ORDER BY revision DESC").get().config).tokenpass_models, ["a/b"]); }
for (const bad of ["a/b", ["a/b", "a/b"], ["no spaces/x y"], [1]]) assert.throws(() => validateModelSettings({ ...SEED, tokenpass_models: bad }), /Token Pass/);
console.log("ok - Vercel Token Pass: save, list cut to the covered models, chat, remove");
