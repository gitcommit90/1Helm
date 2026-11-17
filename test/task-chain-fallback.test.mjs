// node --import ./test/stubs/register.mjs test/task-chain-fallback.test.mjs
// A frozen two-model chain whose first model answers 429: the second model (auto tool choice only) must be fetched and serve,
// including on a tools-off step, which must not send tool_choice "none" when any model in the chain cannot take it.
import assert from "node:assert/strict";
import { Resident } from "../src/resident.js";
import { openRouterChat } from "./helpers/or-chat.mjs";
import { seedSettings, ID } from "./helpers/seed-settings.mjs";
const s = seedSettings(), ids = [ID.SOL, ID.MUSE_C];
const cat = (id) => ({ id, source: "OR", eligible: true, kinds: ["chat"], hosts: ["azure"], levels: ["unrestricted", "no_training", "zdr"], efforts: ["default", "high"], context_length: 16000, max_output: 8000, input_modalities: ["text"], pricing: { prompt: .1, completion: .2 }, tool_choice: id === ID.MUSE_C ? ["auto"] : ["auto", "none"] });
for (const id of ids) s.catalog[id] = cat(id);
const prof = (id) => ({ version: 1, mode: "managed", source: "OR", requestedModel: id, effort: "high", catalog: s.catalog[id], hosts: ["azure"], contextLength: 16000, maxOutput: 8000, cacheSession: "stable", level: "unrestricted" });
const chain = ids.map(prof), wire = [];
const env = { ONEHELM_EE: "1hc", ENV_NAME: "dev", DYNAMIC_ROUTING: "on", MODEL_SETTINGS: s, OPENROUTER_API_KEY: "synthetic", PROMPT_CACHE: "off", DB: { prepare() { return { bind() { return this; }, async first() { return { ai_privacy: "unrestricted" }; } }; } } };
const tiers = [];
globalThis.fetch = async (_u, init) => { const b = JSON.parse(init.body); wire.push(b.model); tiers.push(b.service_tier);
  return b.model === ids[0] ? new Response("rate limited", { status: 429 }) : Response.json({ model: b.model, choices: [{ message: { content: "ok" } }], usage: { cost: 0.00001 } }); };
const route = () => ({ taskAffinity: true, taskProfile: { ...chain[0], poolChain: chain } });
const tc = { appendRuntime: true, taskProfile: route().taskProfile };
// What the append lane sends on a tools-off step: the first model takes "none", the second does not, so "none" must not be sent.
assert.equal(await Resident.prototype.noneToolChoiceOk.call({ env }, { taskAffinity: true }, tc), false);
let r = route(); await openRouterChat(env, { messages: [] }, "x", r, { tenant: "t" });
assert.deepEqual(wire, [ids[0], ids[0], ids[1]], "first model 429 twice, then the second is fetched"); assert.equal(r.servedIndex, 1);
assert.deepEqual(tiers, [undefined, "flex", undefined], "only the retry of the same model asks for flex; the next model is a first attempt");
// A body the second model cannot take is the failure the append lane produced: no fetch to it, and the trace code names the reason.
wire.length = 0; r = route();
await assert.rejects(openRouterChat(env, { messages: [], tool_choice: "none" }, "x", r, { tenant: "t" }), (e) => e.code === "unsupported-tool-choice" && !wire.includes(ids[1]));
console.log("task-chain-fallback: ok");
