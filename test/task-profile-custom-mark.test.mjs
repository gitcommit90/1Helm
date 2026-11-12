// node --import ./test/stubs/register.mjs test/task-profile-custom-mark.test.mjs
// A task profile built from the account's Custom Model Selection env carries custom: true (turn-trace.js reads it for the models_from marker); ours does not.
import assert from "node:assert";
import { routingProfile } from "../src/ee/task-profile.js";
import { modelsMark } from "../src/turn-trace.js";

const log0 = console.log; console.log = () => {};
const id = "vendor/model-x", rec = { id, eligible: true, hosts: ["acme"], efforts: ["none"], levels: ["unrestricted", "no_training", "zdr"], context_length: 100000, max_output: 8000,
  input_modalities: ["text"], pricing: { prompt: 1e-6, completion: 2e-6 }, tool_choice: ["auto", "none"], json: true };
const R = { get: () => "t1", env: {} };
const profile = (custom, category = "general") => routingProfile(R, [{ model: id, effort: null }], { category, session: "s", env: { MODEL_SETTINGS: { catalog: { [id]: rec }, routing: {} }, ...(custom ? { MODEL_SETTINGS_CUSTOM: true } : {}) } });
const ours = await profile(false), mine = await profile(true, "c_ab12cd34");
console.log = log0;
assert.equal(ours.custom, undefined); assert.equal(ours.poolChain[0].custom, undefined);
assert.equal(mine.custom, true); assert.equal(mine.poolChain[0].custom, true);
assert.deepEqual(modelsMark(ours), { models_from: "ours", category: "general" });
assert.deepEqual(modelsMark(mine), { models_from: "custom", category: "c_ab12cd34" });
console.log("PASS task-profile-custom-mark");
