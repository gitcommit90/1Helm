import assert from "node:assert/strict";
import { ambientModelRoute } from "../src/ee/ambient.js";
import { mjRoute } from "../src/memjobs-core.js";
import { CHORE_MODELS, choreRoute } from "../src/ee/route2.js";
import { defaultModelSettings } from "../src/ee/model-settings.js";
import { openRouterChat } from "../src/model.js";
import { structuredFormat } from "../src/structured-output.js";
import { BACKGROUND_POLICIES, backgroundRoute, backgroundRole, backgroundReserve } from "../src/ee/background-policy.js";
import { notesRequest } from "../src/ee/live-notes.js";
import { cardRequest } from "../src/sidecar.js";
import { summarizeCard, LABEL_TIMEOUT_MS } from "../src/tracker.js";

const DS = "deepseek/deepseek-v4.1-flash", HAIKU = "anthropic/claude-haiku-5.5", LUNA = "openai/gpt-6-luna";
const roles = { "card-label": ["label", HAIKU, 2048], "live-notes-note": ["notes", LUNA, 1500],
  "live-notes-refine": ["notes_refine", DS, 8192], "live-notes-final": ["notes_final", HAIKU, 4000],
  "sidecar-card": ["sidecar_card", HAIKU, 1600], "ambient-extract": ["ambient_extract", LUNA, 3000],
  "ambient-review": ["ambient_review", DS, 3000], "memjob-people-verify": ["people_verify", DS, 6000],
  "memjob-reflect-verify": ["reflect_verify", DS, 6000] };
assert.equal(Object.keys(BACKGROUND_POLICIES).length, 9);
assert.equal(CHORE_MODELS.dsflash.effort, "none", "global DS chores remain off");
for (const job of ["people", "reflect", "upkeep"]) assert.equal(mjRoute({}, job, "write").effort, "none");
assert.equal(mjRoute({}, "upkeep", "verify").effort, "none");
assert.equal(mjRoute({ CHORE_MODEL_MJVERIFY: "oss120:high" }, "upkeep", "verify").effort, "high");
assert.equal(choreRoute({}, "handoff").model, "openai/gpt-oss-120b");
for (const kind of ["ambient-extract", "ambient-review"]) assert.deepEqual(ambientModelRoute({ CHORE_MODEL_AMBIENT: "oss20" }, kind), backgroundRoute(backgroundRole(kind)));
assert.equal(LABEL_TIMEOUT_MS, 30000);
for (const [kind, cap] of [["note", 1500], ["final", 4000], ["refine", 8192]]) assert.equal(notesRequest(kind, []).max_tokens, cap);
assert.equal(cardRequest({ name: "fixture" }, "text", "Example", []).max_tokens, 1600);
const reserveRequest = notesRequest("refine", [{ role: "user", content: "é".repeat(1000) }]);
const expected = ((new TextEncoder().encode(JSON.stringify(reserveRequest)).length + 1024) * 3000 * 1.25 + 8192 * 15000) * 1.15;
assert.equal(backgroundReserve(reserveRequest, 2), Math.ceil(expected * 2), "both attempts plus cache-write ceiling reserved");

let config = null, fail = false;
const sent = [], originalFetch = globalThis.fetch;
const DB = { prepare(q) { return { bind() { return this; }, async first() {
  if (q.includes("model_settings_versions")) return config ? { revision: 7, config: JSON.stringify(config) } : null;
  if (q.includes("ai_privacy")) return { ai_privacy: "zdr" };
  return null;
} }; } };
const env = { ONEHELM_EE: "1hc", DB, ENV_NAME: "dev", ROUTER_MODE: "two", OPENROUTER_API_KEY: "fixture-only", PROMPT_CACHE: "off" };
const body = { messages: [{ role: "user", content: "Synthetic review only" }], max_tokens: 3000,
  response_format: structuredFormat("review_fixture", { type: "object", additionalProperties: false, properties: { ok: { type: "boolean" } }, required: ["ok"] }) };
globalThis.fetch = async (url, init) => {
  const p = JSON.parse(init.body); sent.push(p);
  return fail ? Response.json({ error: "synthetic outage" }, { status: 503 })
    : Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }], usage: { cost: 0 } });
};
try {
  for (const mode of ["two", "classic"]) {
    for (const [kind, [role, model, cap]] of Object.entries(roles)) {
      assert.equal(backgroundRole(kind), role); assert.equal(BACKGROUND_POLICIES[role].maxTokens, cap);
      await openRouterChat({ ...env, ROUTER_MODE: mode, CHORE_MODEL_LABEL: "oss20", CHORE_MODEL_NOTES: "oss120" },
        { ...body, max_tokens: cap, models: ["openai/gpt-oss-120b"], reasoning: { effort: "high" } }, null,
        { model: "openai/gpt-oss-120b", fallbacks: ["openai/gpt-oss-120b"] }, { tenant: "fixture", kind });
      const p = sent.at(-1);
      assert.equal(p.model, model); assert.deepEqual(p.reasoning, { effort: "low" }); assert.equal(p.max_tokens, cap);
      assert.equal(p.models, undefined); assert.deepEqual(p.response_format, body.response_format);
      assert.equal(p.provider.zdr, true); assert.equal(p.provider.require_parameters, true);
      assert.deepEqual(p.provider.order, BACKGROUND_POLICIES[role].hosts); assert.deepEqual(p.provider.only, BACKGROUND_POLICIES[role].hosts);
      assert.deepEqual(p.provider.max_price, { prompt: 3, completion: 15 });
      fail = true; const n = sent.length;
      await assert.rejects(openRouterChat({ ...env, ROUTER_MODE: mode }, body, null, backgroundRoute(role), { kind }), /503/);
      assert.equal(sent.length, n + 1, "no cross-model failure fallback"); fail = false;
    }
  }
  await openRouterChat({ ...env, ROUTER_MODE: "classic" }, body, null, { model: "qwen/qwen3.8-27b", effort: "none" }, { kind: "memory-summary" });
  assert.deepEqual(sent.at(-1).models, [DS, "z-ai/glm-5.3-flash"], "unrelated classic routing unchanged");
  config = defaultModelSettings(); config.chores.people_verify = { model: "haiku", effort: "high" };
  await openRouterChat(env, body, null, mjRoute({}, "people", "verify"), { kind: "memjob-people-verify" });
  assert.equal(sent.at(-1).model, HAIKU); assert.deepEqual(sent.at(-1).reasoning, { effort: "high" }); assert.equal(sent.at(-1).models, undefined);
  // Cloud-only TEST_MODEL overrides are intentionally absent from public source.
  const n = sent.length;
  const labels = await summarizeCard({ env: { AI: { run() { throw new Error("must not invoke native fallback"); } }, MODEL: "native" }, input: { msgs: [{ at: 1, text: "Check the roof estimate" }], steps: [{ at: 1, title: "Read estimate", tool: "read_file", status: "done" }], reply: "The estimate is 840 dollars." } });
  assert.equal(sent.length, n); assert.equal(labels.title_src, "auto");
  console.log("PASS nine routes: exact models/LOW/caps, both routers fail closed, privacy/schema, scoped env isolation, saved overrides, reservation ceiling, deterministic offline labels");
} finally { globalThis.fetch = originalFetch; }

