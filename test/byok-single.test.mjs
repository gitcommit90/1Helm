// node --import ./test/stubs/register.mjs test/byok-single.test.mjs
// Without ONEHELM_EE the own AI key is the one saved key (src/byok-single.js): the settings route answers as a self-hosted install, no key reads as missing,
// and every route of the licensed AI services layer is not reached.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { byokApi, loadByok } from "../src/byok.js";

const d = new DatabaseSync(":memory:");
for (const f of readdirSync(new URL("../db/migrations/", import.meta.url)).sort()) d.exec(readFileSync(new URL(`../db/migrations/${f}`, import.meta.url), "utf8"));
d.exec("INSERT INTO users(id,email,created_at) VALUES('u','a@example.com',1)");
d.prepare("INSERT INTO tenants(id,slug,owner_user_id,plan,status,created_at,updated_at) VALUES('t1','s1','u','byok','active',1,1)").run();
const D = { prepare: (q) => { let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => d.prepare(q).get(...a) ?? null, all: async () => ({ results: d.prepare(q).all(...a) }),
  run: async () => { const r = d.prepare(q).run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; } };
const env = { DB: D, APP_HOST: "app.example.test", VAULT_KEY: Buffer.alloc(32, 3).toString("base64") };
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s });
const t = { id: "t1", plan: "byok" };

const r = await byokApi(new Request("https://app.example.test/w/s1/api/byok"), env, t, "/api/byok", { json });
const body = await r.json();
assert.equal(r.status, 200); assert.equal(body.plan_name, "Self-hosted"); assert.equal(body.saved, null); assert.deepEqual(body.custom, { on: false, model: null }); assert.equal(body.connections, undefined);
assert.deepEqual(await loadByok(env, "t1"), { missing: true, settings: "https://app.example.test/w/s1/app?settings=byok" });
for (const sub of ["/api/byok/connections", "/api/byok/chatgpt/finish", "/api/byok/claudecode/start", "/api/byok/usage"])
  assert.equal(await byokApi(new Request(`https://app.example.test/w/s1${sub}`, { method: "POST", body: "{}" }), env, t, sub, { json }), null, sub);
for (const sub of ["/api/byok/mode", "/api/byok/switch-now"]) assert.equal((await byokApi(new Request(`https://app.example.test/w/s1${sub}`, { method: "POST", body: "{}" }), env, t, sub, { json })).status, 404, sub);
console.log("ok: one saved key without ONEHELM_EE");
