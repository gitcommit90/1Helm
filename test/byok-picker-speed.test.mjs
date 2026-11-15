// node --import ./test/stubs/register.mjs test/byok-picker-speed.test.mjs
// The model picker's lists on an own AI key (task picker-speed): a shared copy of each service's list (D1 byok_model_lists + isolate memory), served at once; a stale copy is served and read
// again in the background; the services are read at the same time; one failing service never holds back another. fetch is faked: no real service is called.
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs"; import { test } from "node:test";
import { endpointRecords, warmLists, _resetLists, _forgetMemory } from "../src/ee/byok-custom.js";
import { withKey } from "../src/byok.js";

const d1 = new DatabaseSync(":memory:");
d1.exec(`CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT, plan TEXT, ai_privacy TEXT, custom_models_own TEXT, custom_models_own_on INTEGER DEFAULT 0, updated_at INTEGER);`);
const D1 = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => { const r = st.run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; } };
const env = { DB: D1 };
const cfg = (id, host) => withKey({ id, kind: "plain", label: id, base: `https://${host}/v1`, host, provider: "" }, "k");
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
let calls = [], delay = {}, fail = new Set(), gen = 1;
const fake = async (u) => { const host = new URL(String(u)).hostname; calls.push(host); if (delay[host]) await new Promise((r) => setTimeout(r, delay[host])); if (fail.has(host)) return json({ error: { message: "down" } }, 503); return json({ data: [{ id: `${host.split(".")[0]}-m${gen}` }] }); };
const A = cfg("p_aaaaa", "a.example-ai.com"), B = cfg("p_bbbbb", "b.example-ai.com");
const reset = () => { _resetLists(); calls = []; delay = {}; fail = new Set(); gen = 1; };

test("a cached list is returned without any network call, from memory and from the shared copy in another isolate", async () => {
  reset(); const t0 = Date.now();
  assert.deepEqual((await endpointRecords(A, "t1", { fetchImpl: fake, env, now: t0 })).map((r) => r.id), ["a-m1"]); assert.equal(calls.length, 1);
  assert.equal((await endpointRecords(A, "t1", { fetchImpl: fake, env, now: t0 + 1000 })).length, 1); assert.equal(calls.length, 1, "memory copy");
  _forgetMemory();   // another isolate: empty memory, the D1 copy exists
  assert.equal((await endpointRecords(A, "t1", { fetchImpl: fake, env, now: t0 + 60_000 })).length, 1); assert.equal(calls.length, 1, "shared copy: no call to the service");
  assert.deepEqual(d1.prepare("SELECT conn_id FROM byok_model_lists WHERE tenant_id='t1'").all().map((r) => r.conn_id), ["p_aaaaa"], "keyed by connection, no key in the row");
  assert.ok(!JSON.stringify(d1.prepare("SELECT * FROM byok_model_lists").all()).includes('"k"'));
});
test("a stale copy is returned at once and read again in the background; the next call sees the new list", async () => {
  reset(); const t0 = Date.now(); await endpointRecords(A, "t1", { fetchImpl: fake, env, now: t0 }); calls = []; gen = 2; delay["a.example-ai.com"] = 30;
  let bg; const started = Date.now();
  const first = await endpointRecords(A, "t1", { fetchImpl: fake, env, now: t0 + 11 * 60e3, waitUntil: (p) => { bg = p; } });
  assert.deepEqual(first.map((r) => r.id), ["a-m1"], "the old list is served"); assert.ok(Date.now() - started < 25, "without waiting for the service");
  await bg; assert.equal(calls.length, 1, "one background read");
  assert.deepEqual((await endpointRecords(A, "t1", { fetchImpl: fake, env, now: t0 + 11 * 60e3 + 1 })).map((r) => r.id), ["a-m2"]);
});
test("several services are read at the same time, and one that fails doesn't block or change the others", async () => {
  reset(); delay["a.example-ai.com"] = 80; delay["b.example-ai.com"] = 80; const s = Date.now();
  const r = await Promise.allSettled([endpointRecords(A, "t1", { fetchImpl: fake, env }), endpointRecords(B, "t1", { fetchImpl: fake, env })]);
  assert.ok(Date.now() - s < 140, `parallel (${Date.now() - s} ms)`); assert.deepEqual(r.map((x) => x.status), ["fulfilled", "fulfilled"]);
  reset(); fail.add("b.example-ai.com");
  const r2 = await Promise.allSettled([endpointRecords(A, "t1", { fetchImpl: fake, env }), endpointRecords(B, "t1", { fetchImpl: fake, env })]);
  assert.deepEqual(r2.map((x) => x.status), ["fulfilled", "rejected"]);
});
test("fresh: true reads the service again and replaces the copy", async () => {
  reset(); await endpointRecords(A, "t1", { fetchImpl: fake, env }); gen = 3; calls = [];
  assert.deepEqual((await endpointRecords(A, "t1", { fetchImpl: fake, env, fresh: true })).map((r) => r.id), ["a-m3"]); assert.equal(calls.length, 1);
  assert.deepEqual((await endpointRecords(A, "t1", { fetchImpl: fake, env })).map((r) => r.id), ["a-m3"]);
});
