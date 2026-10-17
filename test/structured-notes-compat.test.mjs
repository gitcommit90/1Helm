// node --import ./test/stubs/register.mjs test/structured-notes-compat.test.mjs
import assert from "node:assert/strict";
import { orFetch, OR_MAX_PRICE } from "../src/model.js";
import { openRouterChat } from "./helpers/or-chat.mjs";
import { ID, SEED, withSettings } from "./helpers/seed-settings.mjs";
import { choreRouteOf, quirkOf } from "../src/ee/model-jobs.js";
const LUNA = ID.LUNA, noTemperature = (m) => quirkOf(SEED, m, "no_temperature");
import { FINAL_ROUTE } from "../src/ee/live-notes.js";
import { structuredFormat, S } from "../src/structured-output.js";
import { byokChat } from "../src/byok.js";

const saved = globalThis.fetch, sent = [];
globalThis.fetch = async (_url, init) => {
  sent.push(JSON.parse(init.body));
  return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: '{"summary":"ok"}' } }] }));
};
const env = withSettings({ ONEHELM_EE: "1hc", OPENROUTER_API_KEY: "fixture", ROUTER_MODE: "two", PROMPT_CACHE: "off" });
const body = { messages: [{ role: "user", content: "Fixture" }], temperature: 0, max_tokens: 1500,
  response_format: structuredFormat("notes", S.object({ summary: S.string })) };
try {
  for (const [kind, route] of [["live-notes-note", choreRouteOf(SEED, "notes")], ["live-notes-final", choreRouteOf(SEED, "notes_final")]]) {
    await openRouterChat(env, body, null, route, { kind });
    const wire = sent.at(-1);
    assert.equal(wire.model, route.model); assert.equal(wire.temperature, undefined);
    assert.equal(wire.max_tokens, undefined, "an empty saved max_output sends no max_tokens"); assert.equal(wire.provider.require_parameters, true);
    assert.equal(wire.provider.zdr, true); assert.deepEqual(wire.provider.max_price, OR_MAX_PRICE);
    if (route.host) assert.deepEqual(wire.provider.order, [route.host].flat());
    assert.deepEqual(wire.response_format, body.response_format);
  }
  for (const model of [LUNA, "anthropic/claude-haiku-5.5"]) {
    for (const kind of ["ambient-extract", "ambient-review", "sidecar-card", "sidecar-vision-image", "card-label", "browser-oss"]) {
      await orFetch(env, { ...body, model }, { kind });
      assert.equal(sent.at(-1).temperature, undefined, `${model} strict ${kind}`);
      assert.equal(sent.at(-1).provider.require_parameters, true);
    }
    // Plain notes and main chat are outside the compatibility adjustment.
    for (const [kind, response_format] of [["live-notes-final", { type: "json_object" }], ["chat", body.response_format]]) {
      await orFetch(env, { ...body, model, response_format }, { kind });
      assert.equal(sent.at(-1).temperature, 0);
    }
  }
  // An explicit custom route stays intact, including its temperature and pinned host.
  await orFetch(env, { ...body, model: LUNA, response_format: structuredFormat("handoff_notes", S.object({ summary: S.string })) }, { kind: "chat" });
  assert.equal(sent.at(-1).temperature, undefined, "system-owned handoff contract uses chat metadata");
  assert.equal(body.temperature, 0, "caller request is immutable");
  for (const selected of [LUNA, "anthropic/claude-haiku-5.5"]) {
    for (const fast of [false, true]) {
      const cfg = { base: "https://openrouter.ai/api/v1", key: "fixture", model: fast ? "person-main" : selected, fast: selected };
      await byokChat(cfg, body, { fast, privacy: "zdr", noTemperature });
      assert.equal(sent.at(-1).model, selected); assert.equal(sent.at(-1).temperature, undefined);
      assert.equal(sent.at(-1).provider.zdr, true); assert.equal(sent.at(-1).provider.require_parameters, true);
      assert.deepEqual(sent.at(-1).response_format, body.response_format);
      await byokChat(cfg, { ...body, response_format: { type: "json_object" } }, { fast, privacy: "zdr" });
      assert.equal(sent.at(-1).temperature, 0, "plain BYOK request untouched");
      await byokChat({ ...cfg, base: "https://own-endpoint.example/v1" }, body, { fast });
      assert.equal(sent.at(-1).temperature, 0, "non-OpenRouter BYOK endpoint untouched");
    }
  }
  await byokChat({ base: "https://openrouter.ai/api/v1", key: "fixture", model: "person-main", fast: "person-fast" }, body, { fast: true });
  assert.equal(sent.at(-1).model, "person-fast"); assert.equal(sent.at(-1).temperature, 0, "other chosen model untouched");
} finally { globalThis.fetch = saved; }
console.log("PASS strict notes supported parameters; route/privacy/schema/caps, ordinary chat and custom overrides preserved");

