import assert from "node:assert/strict";
import { ambientModelRoute } from "../src/ee/ambient.js";
import { mjRoute } from "../src/memjobs-core.js";
import { openRouterChat } from "../src/model.js";
import { structuredFormat } from "../src/structured-output.js";
import { BACKGROUND_LIMITS, backgroundRole, backgroundReserve } from "../src/ee/background-policy.js";
import { choreRouteOf, jobRoute } from "../src/ee/model-jobs.js";
import { ID, SEED, withSettings } from "./helpers/seed-settings.mjs";
import { notesRequest } from "../src/ee/live-notes.js";
import { cardRequest } from "../src/sidecar.js";
import { summarizeCard, LABEL_TIMEOUT_MS } from "../src/tracker.js";

// The nine evaluated background roles: limits live in background-policy.js; model, hosts and reasoning level are each role's saved
// setting (the first saved version holds what the earlier built-in policy held).
const DS = ID.DEEPSEEK, HAIKU = ID.HAIKU, LUNA = ID.LUNA;
const roles = { "card-label": ["label", HAIKU, 2048], "live-notes-note": ["notes", LUNA, 1500],
  "live-notes-refine": ["notes_refine", DS, 8192], "live-notes-final": ["notes_final", HAIKU, 4000],
  "sidecar-card": ["sidecar_card", HAIKU, 1600], "ambient-extract": ["ambient_extract", LUNA, 3000],
  "ambient-review": ["ambient_review", DS, 3000], "memjob-people-verify": ["people_verify", DS, 6000],
  "memjob-reflect-verify": ["reflect_verify", DS, 6000] };
assert.equal(Object.keys(BACKGROUND_LIMITS).length, 9);
const E0 = withSettings({});
for (const job of ["people", "reflect", "upkeep"]) assert.equal(mjRoute(E0, job, "write").effort, "none");
assert.equal(mjRoute(E0, "upkeep", "verify").effort, "none");
assert.equal(mjRoute(withSettings({}, JSON.parse(JSON.stringify(SEED))), "upkeep", "verify").effort, "none");
assert.equal(choreRouteOf(SEED, "handoff").model, "deepseek/deepseek-v4.1-flash");
for (const kind of ["ambient-extract", "ambient-review"]) assert.deepEqual(ambientModelRoute({ CHORE_MODEL_AMBIENT: "oss20" }, kind), jobRoute(backgroundRole(kind)), "the route only names the job; a variable can't change it");
assert.equal(LABEL_TIMEOUT_MS, 30000);
for (const [kind, cap] of [["note", 1500], ["final", 4000], ["refine", 8192]]) assert.equal(notesRequest(kind, []).max_tokens, cap);
assert.equal(cardRequest({ name: "fixture" }, "text", "Example", []).max_tokens, 1600);
const reserveRequest = notesRequest("refine", [{ role: "user", content: "é".repeat(1000) }]);
const expected = ((new TextEncoder().encode(JSON.stringify(reserveRequest)).length + 1024) * 3000 * 1.25 + 8192 * 15000) * 1.15;
assert.equal(backgroundReserve(reserveRequest, 2), Math.ceil(expected * 2), "both attempts plus cache-write ceiling reserved");

let fail = false;
const sent = [], originalFetch = globalThis.fetch;
const env = withSettings({ ONEHELM_EE: "1hc", ENV_NAME: "dev", ROUTER_MODE: "two", OPENROUTER_API_KEY: "fixture-only", PROMPT_CACHE: "off" });
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
      const saved = choreRouteOf(SEED, role), hosts = [saved.host].flat();
      assert.equal(backgroundRole(kind), role); assert.equal(BACKGROUND_LIMITS[role].maxTokens, cap); assert.equal(saved.model, model); assert.equal(saved.effort, "low"); assert.equal(saved.fallbacks.length, 1);
      await openRouterChat({ ...env, ROUTER_MODE: mode, CHORE_MODEL_LABEL: "oss20", CHORE_MODEL_NOTES: "oss120" },   // variables are ignored
        { ...body, max_tokens: cap, models: ["openai/gpt-oss-120b"], reasoning: { effort: "high" } }, null,
        { model: "openai/gpt-oss-120b", fallbacks: ["openai/gpt-oss-120b"] }, { tenant: "fixture", kind });
      const p = sent.at(-1);
      assert.equal(p.model, model); assert.deepEqual(p.reasoning, { effort: "low" }); assert.equal(p.max_tokens, cap);
      assert.equal(p.models, undefined); assert.deepEqual(p.response_format, body.response_format);
      assert.equal(p.provider.zdr, true); assert.equal(p.provider.require_parameters, true);
      assert.deepEqual(p.provider.order, hosts); assert.deepEqual(p.provider.only, hosts);
      assert.deepEqual(p.provider.max_price, { prompt: 3, completion: 15 });
      fail = true; const n = sent.length;
      await assert.rejects(openRouterChat({ ...env, ROUTER_MODE: mode }, body, null, jobRoute(role), { kind }), /503/);
      assert.equal(sent.length, n + 2, "the main model, then its one saved fallback, nothing else"); fail = false;
    }
  }
  // Memory summaries are their own saved job (DeepSeek, then GLM, gpt-oss-120b): in the older router mode too, and no unrelated model list rides along.
  await openRouterChat({ ...env, ROUTER_MODE: "classic" }, body, null, jobRoute("memory_summary"), { kind: "memory-summary" });
  assert.equal(sent.at(-1).model, ID.DEEPSEEK); assert.equal(sent.at(-1).models, undefined, "one model per request; the fallbacks are tried one at a time");
  // A saved choice replaces the policy for that role alone.
  const custom = JSON.parse(JSON.stringify(SEED)); custom.jobs.people_verify = { model: HAIKU, effort: "high", hosts: ["amazon-bedrock", "google-vertex"], pin: true, strict: true, fallbacks: [] };
  const envC = { ...env, MODEL_SETTINGS: custom };
  await openRouterChat(envC, body, null, mjRoute(envC, "people", "verify"), { kind: "memjob-people-verify" });
  assert.equal(sent.at(-1).model, HAIKU); assert.deepEqual(sent.at(-1).reasoning, { effort: "high" }); assert.equal(sent.at(-1).models, undefined);
  // Cloud-only TEST_MODEL overrides are intentionally absent from public source.
  const n = sent.length;
  const labels = await summarizeCard({ env: { MODEL_SETTINGS: SEED, AI: { run() { throw new Error("must not invoke native fallback"); } }, MODEL: "native" }, input: { msgs: [{ at: 1, text: "Check the roof estimate" }], steps: [{ at: 1, title: "Read estimate", tool: "read_file", status: "done" }], reply: "The estimate is 840 dollars." } });
  assert.equal(sent.length, n); assert.equal(labels.title_src, "auto");
  console.log("PASS nine routes: exact models/LOW/caps, both routers fail closed, privacy/schema, scoped env isolation, saved overrides, reservation ceiling, deterministic offline labels");
} finally { globalThis.fetch = originalFetch; }

