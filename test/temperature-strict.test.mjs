// node --import ./test/stubs/register.mjs test/temperature-strict.test.mjs
// A saved model must never be lost because of a parameter 1Helm adds on its own: with require_parameters a temperature leaves no OpenRouter endpoint
// for most models (HTTP 404 "No endpoints found..."). The request carries no temperature, for an exact model, a "~" alias with no saved facts and a model added later.
import assert from "node:assert/strict";
import { dispatch } from "../src/ee/model-dispatch.js";
import { orFetch, withoutTemperatureWhenStrict } from "../src/model.js";
import { structuredFormat, S } from "../src/structured-output.js";
import { noteServed, servedView, resetServedCache } from "../src/ee/model-served.js";
import { SEED, ID, withSettings } from "./helpers/seed-settings.mjs";

const clone = (x) => JSON.parse(JSON.stringify(x));
const ALIAS = "~anthropic/claude-haiku-latest", ADDED = "acme/new-model-1";
const saved = globalThis.fetch;
const rf = structuredFormat("card", S.object({ label: S.string }));
const body = { messages: [{ role: "user", content: "x" }], temperature: 0, response_format: rf };
const ok = (m) => new Response(JSON.stringify({ model: m, provider: "P", choices: [{ finish_reason: "stop", message: { content: '{"label":"a"}' } }] }), { status: 200 });

function envFor(model, fallbacks = []) {
  const s = clone(SEED);
  // The model has no facts of any kind (no quirks), like an alias or a model added from the search.
  for (const m of [model, ...fallbacks.map((f) => f.model)]) if (!s.catalog[m]) s.catalog[m] = { id: m, name: m, kinds: ["chat", "chore"], efforts: ["default", "low"] };
  s.jobs.label = { ...s.jobs.label, model, fallbacks };
  return withSettings({ OPENROUTER_API_KEY: "k", PROMPT_CACHE: "off" }, s);
}

try {
  // Every job path: dispatch builds the outgoing body for a chore.
  for (const model of [ID.HAIKU, ID.LUNA, ALIAS, ADDED, "~openai/gpt-luna-latest"]) {
    const sent = [];
    globalThis.fetch = async (_u, init) => { sent.push(JSON.parse(init.body)); return ok(model); };
    await dispatch(envFor(model), "label", body, { meta: { kind: "card-label" } });
    assert.equal(sent.length, 1, model);
    assert.equal(sent[0].model, model);
    assert.equal(sent[0].temperature, undefined, `${model}: no temperature`);
    assert.equal(sent[0].provider.require_parameters, true, model);
    assert.deepEqual(sent[0].response_format, rf);
  }
  // The same holds for a chore kind the old list did not name.
  const sent = []; globalThis.fetch = async (_u, init) => { sent.push(JSON.parse(init.body)); return ok(ALIAS); };
  await orFetch(withSettings({ OPENROUTER_API_KEY: "k", PROMPT_CACHE: "off" }), { ...body, model: ALIAS }, { kind: "some-future-chore" });
  assert.equal(sent[0].temperature, undefined);
  // A request with no require_parameters keeps what the caller set.
  assert.equal(withoutTemperatureWhenStrict({ temperature: 0, provider: { zdr: true } }).temperature, 0);
  assert.equal(withoutTemperatureWhenStrict({ temperature: 0, provider: { require_parameters: true } }).temperature, undefined);

  // A saved model that answers 404 while the fallback serves the call is recorded with why.
  resetServedCache();
  const writes = [];
  const env = envFor(ALIAS, [{ model: ID.DEEPSEEK, effort: null }]);
  env.ENV_NAME = "dev"; env.DB = { prepare: (sql) => ({ bind: (...a) => ({ run: async () => { writes.push({ sql, a }); return {}; } }) }) };
  globalThis.fetch = async (_u, init) => { const b = JSON.parse(init.body);
    return b.model === ALIAS ? new Response(JSON.stringify({ error: { code: 404, message: "No endpoints found that can handle the requested parameters" } }), { status: 404 }) : ok(b.model); };
  await dispatch(env, "label", body, { meta: { kind: "card-label" } });
  assert.equal(writes.length, 1, "one write for the call");
  assert.match(writes[0].sql, /last_error/); assert.equal(writes[0].a[2], ID.DEEPSEEK);
  assert.match(String(writes[0].a.at(-1)), new RegExp(`^${ALIAS.replace(/[~/.]/g, "\\$&")}: .*No endpoints found`));
  // servedView returns the column.
  const row = { job_id: "label", requested: ID.DEEPSEEK, served_model: ID.DEEPSEEK, last_status: "ok", last_error: "x: why" };
  assert.equal((await servedView({ ENV_NAME: "dev", DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [row] }) }) }) } })).label.last_error, "x: why");
  // Without the column (migration not applied yet) the write is repeated without it, and nothing else is lost.
  resetServedCache(); const tries = [];
  noteServed({ ENV_NAME: "dev", DB: { prepare: (sql) => ({ bind: () => ({ run: async () => { tries.push(sql); if (/last_error\)/.test(sql)) throw new Error("no such column"); return {}; } }) }) } },
    { job: "j", requested: "b", served: { model: "b", provider: "P" }, failed: { model: "a", error: "e" } });
  await new Promise((r) => setTimeout(r, 20)); assert.equal(tries.length, 2); assert.ok(!/last_error/.test(tries[1].replace(/last_error_at/g, "")));
} finally { globalThis.fetch = saved; }
console.log("PASS no temperature next to require_parameters for exact, alias and unknown models; a failed main model is recorded when a fallback serves");
