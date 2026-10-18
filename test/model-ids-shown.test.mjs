// node --import ./test/stubs/register.mjs test/model-ids-shown.test.mjs
// Every model ID written in src/ is one the Models page can show: a model in the first-run catalog, a model in the privacy registry,
// a Hindsight server model that runs locally (shown read-only), or a dev-only tool listed below with its reason. A new ID in src/ that is in none of them
// is a model that can be sent and never shown, which is how deepseek-v4.1-flash stayed in use while Models said "DeepSeek Flash latest".
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { SEED_FACTS, seedFresh } from "../src/ee/model-seed.js";
import { ENDPOINTS } from "../src/privacy.js";
import { HINDSIGHT_LOCAL } from "../src/ee/hindsight-models.js";
import { SEED } from "./helpers/seed-settings.mjs";

const DEV_ONLY = {};
const SHOWN = new Set([...Object.keys(SEED_FACTS), ...Object.keys(seedFresh({}).catalog), ...Object.keys(SEED.catalog), ...Object.values(ENDPOINTS).flatMap((m) => Object.keys(m)),
  ...HINDSIGHT_LOCAL.map((m) => m.model), ...Object.keys(DEV_ONLY)]);
const PROVIDERS = "deepseek|openai|anthropic|meta|z-ai|perplexity|typesafe|qwen|assemblyai|google|xiaomi|baai|mistralai|x-ai|moonshotai|minimax|cohere|nvidia|meta-llama|@cf|@hf";
const LITERAL = new RegExp(`["'\`](~?(?:${PROVIDERS})/[A-Za-z0-9._:~/-]+)["'\`]`, "g");
const stripComments = (line) => line.replace(/(^|\s)\/\/.*$/, "$1");

const found = [];
for (const f of readdirSync(new URL("../src/", import.meta.url)).filter((n) => n.endsWith(".js") && n !== "model-seed.js")) {
  readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8").split("\n").forEach((line, i) => { for (const m of stripComments(line).matchAll(LITERAL)) found.push({ id: m[1], at: `src/${f}:${i + 1}` }); });
}
assert.ok(found.length > 5, "the scan finds the model IDs in src");
const hidden = found.filter((x) => !SHOWN.has(x.id));
assert.deepEqual(hidden, [], `model IDs in src that Models cannot show (add them to a job, the registry, or DEV_ONLY with a reason): ${JSON.stringify(hidden)}`);

// The ~...-latest alias is the way to name a DeepSeek Flash model. A dated ID may appear only in the first-run catalog and the privacy registry.
const dated = found.filter((x) => /^deepseek\/deepseek-.*flash/.test(x.id) && !x.at.startsWith("src/privacy.js"));
assert.deepEqual(dated, [], "a pinned DeepSeek Flash ID outside the registry");
for (const id of Object.keys(DEV_ONLY)) assert.ok(found.some((x) => x.id === id), `DEV_ONLY lists ${id} but src no longer uses it; remove it`);
console.log("ok");
