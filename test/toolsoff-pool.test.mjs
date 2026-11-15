// node --import ./test/stubs/register.mjs test/toolsoff-pool.test.mjs
// A tools-off call on a task-affinity route must stay on the first model. taskChat skips every pool entry whose catalog tool_choice lacks "none",
// so keepToolsOff (tools kept, tool_choice "none") is only safe when the whole frozen pool chain accepts "none".
import assert from "node:assert/strict";
import { Resident } from "../src/resident.js";

const entry = (requestedModel, tool_choice) => ({ requestedModel, catalog: { id: requestedModel, tool_choice } });
const AUTO = ["auto"], ALL = ["auto", "none", "required"];
const guard = (poolChain, settings = {}) => {
  const profile = { ...poolChain[0], poolChain }, route = { taskAffinity: true, two: true, taskProfile: profile };
  return Resident.prototype.noneToolChoiceOk.call({ env: { MODEL_SETTINGS: settings } }, route, { taskProfile: profile });
};
const muse = entry("meta/muse-spark-1.3-contributor", AUTO), mimo = entry("xiaomi/mimo-v2.6-pro", AUTO), argon = entry("google/gemini-4-argon", ALL);

assert.equal(await guard([muse, mimo, argon]), false, "Muse and MiMo take only auto, so the tools-off call drops the tools block");
assert.equal(await guard([argon, muse]), false, "any entry without none turns keepToolsOff off, wherever it sits");
assert.equal(await guard([argon, entry("a/b", ALL)]), true, "every entry accepts none, so keepToolsOff stays");
assert.equal(await guard([argon]), true, "a single model that accepts none keeps the tools and sends none");
assert.equal(await guard([argon], { catalog: { [argon.requestedModel]: { quirks: { auto_tool_choice_only: true } } } }), false, "the auto-only quirk counts as the router sees it");
assert.equal(await Resident.prototype.noneToolChoiceOk.call({ env: {} }, null, {}), true, "a call with no route is unchanged");
console.log("toolsoff-pool: ok");
