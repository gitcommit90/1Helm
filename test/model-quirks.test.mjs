// node --import ./test/stubs/register.mjs test/model-quirks.test.mjs
// Each quirk follows a model to its alias, to a newer or dated ID, and a model with no facts gets the safe request.
import assert from "node:assert/strict";
import { quirkOf, effortFor, effortBody } from "../src/ee/model-jobs.js";
import { familyFacts, quirksFromRecord } from "../src/model-quirks.js";
import { withoutToolsWhenNoneUnsafe, orFetch, poolPayload, taskPayload } from "../src/model.js";
import { effectiveTaskCatalog } from "../src/ee/model-catalog.js";
import { SEED, withSettings } from "./helpers/seed-settings.mjs";

const clone = (x) => JSON.parse(JSON.stringify(x));
const mk = (quirks, efforts = ["default", "none", "low"]) => ({ name: "x", kinds: ["chat", "chore"], efforts, quirks });
const catalog = {
  "meta/muse-spark-1.3-contributor": mk({ auto_tool_choice_only: true, reasoning_replay: true }),
  "openai/gpt-6-luna": mk({ no_temperature: true, rate_limit_waits: true }),
  "z-ai/glm-5.3-flash": mk({ reasoning_mandatory: true, no_json: true }, ["low", "high", "max"]),
  "anthropic/claude-haiku-5.5": mk(undefined),
};
const settings = { catalog };

// quirk -> [saved ID, alias, newer or dated ID, a different model that must not get it, unknown vendor model]
const CASES = {
  auto_tool_choice_only: ["meta/muse-spark-1.3-contributor", "~meta/muse-spark-contributor-latest", "meta/muse-spark-1.2-contributor", "meta/llama-4-70b"],
  reasoning_replay: ["meta/muse-spark-1.3-contributor", "~meta/muse-spark-contributor-latest", "meta/muse-spark-1.4-contributor-20261101", "anthropic/claude-haiku-5.5"],
  rate_limit_waits: ["openai/gpt-6-luna", "~openai/gpt-luna-latest", "openai/gpt-6.2-luna", "openai/gpt-6.1-sol"],
  no_temperature: ["openai/gpt-6-luna", "~openai/gpt-luna-latest", "openai/gpt-6-luna-20261001", "openai/gpt-oss-20b"],
  reasoning_mandatory: ["z-ai/glm-5.3-flash", "~z-ai/glm-flash-latest", "z-ai/glm-5.4-flash", "z-ai/glm-5.3-air"],
  no_json: ["z-ai/glm-5.3-flash", "~z-ai/glm-flash-latest", "z-ai/glm-6-flash-20261201", "z-ai/other"],
};
for (const [quirk, [saved, alias, newer, other]] of Object.entries(CASES)) {
  for (const id of [saved, alias, newer]) assert.equal(quirkOf(settings, id, quirk), true, `${quirk}: ${id}`);
  assert.equal(quirkOf(settings, other, quirk), false, `${quirk}: ${other} is another model`);
  assert.equal(quirkOf(settings, "acme/unknown-1", quirk), false, `${quirk}: an unknown model has none`);
}
assert.equal(familyFacts(catalog, "acme/unknown-1"), null);

// reasoning_mandatory sends "none" as the lowest level, for an alias, a newer ID and from the model's own level list
for (const id of ["z-ai/glm-5.3-flash", "~z-ai/glm-flash-latest", "z-ai/glm-5.4-flash"]) assert.equal(effortFor("none", id, settings), "low", id);
assert.deepEqual(effortBody("none", "acme/unknown-1", settings), { reasoning: { enabled: false } }, "an unknown model keeps the plain request");
const noneless = { catalog: { "acme/m": { efforts: ["default", "medium", "high"] } } };
assert.equal(effortFor("none", "acme/m", noneless), "medium", "levels without none: the lowest level is sent");

// tool_choice none: tools and tool_choice are left out for an auto-only model, an alias or newer ID of one, and an unknown model; a known model that takes none keeps them
const body = { model: "", messages: [], tools: [{ type: "function", function: { name: "t" } }], tool_choice: "none", parallel_tool_calls: true };
for (const m of ["meta/muse-spark-1.3-contributor", "~meta/muse-spark-contributor-latest", "meta/muse-spark-1.2-contributor", "acme/unknown-1"]) {
  const out = withoutToolsWhenNoneUnsafe(settings, { ...body, model: m });
  assert.ok(!("tools" in out) && !("tool_choice" in out) && !("parallel_tool_calls" in out), m);
}
assert.equal(withoutToolsWhenNoneUnsafe(settings, { ...body, model: "anthropic/claude-haiku-5.5" }).tool_choice, "none");
const sent = [], saved = globalThis.fetch;
globalThis.fetch = async (_u, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ choices: [{ message: { content: "x" } }] })); };
try { await orFetch(withSettings({ OPENROUTER_API_KEY: "k", PROMPT_CACHE: "off" }, { ...clone(SEED), catalog: { ...clone(SEED).catalog, ...clone(catalog) } }), { ...body, model: "meta/muse-spark-1.2-contributor" }, { kind: "chat" }); } finally { globalThis.fetch = saved; }
assert.equal(sent[0].tool_choice, undefined); assert.equal(sent[0].tools, undefined);

// forced choices: the pool and the task stop for an auto-only model's newer ID, and the task catalog lists only auto
const s2 = { ...clone(SEED), catalog: { ...clone(SEED).catalog, ...clone(catalog) } };
assert.throws(() => poolPayload({ MODEL_SETTINGS: s2 }, "meta/muse-spark-1.2-contributor", "zdr", { tool_choice: "required", messages: [] }), /only tool_choice auto/);
assert.throws(() => taskPayload({ requestedModel: "~meta/muse-spark-contributor-latest", effort: null, catalog: {}, category: "general", cacheSession: "s" }, { tool_choice: "required", messages: [] }, { level: "zdr", settings: s2 }), /automatic tool selection/);
assert.deepEqual(effectiveTaskCatalog({ id: "meta/muse-spark-1.2-contributor", tool_choice: ["auto", "none"] }, "meta/muse-spark-1.2-contributor", settings).tool_choice, ["auto"]);

// derived when a model is saved from OpenRouter's record
assert.deepEqual(quirksFromRecord({ tool_choice: ["auto"], efforts: ["low", "high"], json: false, json_levels: [] }), { auto_tool_choice_only: true, reasoning_mandatory: true, no_json: true });
assert.deepEqual(quirksFromRecord({ tool_choice: ["auto", "none", "required", "function"], efforts: ["default"], json: true, json_levels: ["zdr"] }), {});
assert.deepEqual(quirksFromRecord({ tool_choice: ["auto", "none"], efforts: ["none", "low"], json: false, json_levels: ["zdr"] }), {});
console.log("PASS every quirk follows aliases and newer IDs; unknown models get the safe request; quirks derive from the catalog record");
