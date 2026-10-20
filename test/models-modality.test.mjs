// node --import ./test/stubs/register.mjs test/models-modality.test.mjs
// Each job row on the /models page shows what its model must read: text, image or audio (JOB_KINDS inputs in model-jobs.js).
import assert from "node:assert/strict";
import { JOBS, JOB_KINDS } from "../src/ee/model-jobs.js";
import { modesHtml } from "../app-assets/app-static/models-console-core.js";

const kinds = Object.fromEntries(JOBS.map((j) => [j.id, j.kind]));
const inputs = (id) => JOB_KINDS[kinds[id]].inputs;
assert.deepEqual(inputs("label"), ["text"]);
assert.deepEqual(inputs("stt"), ["audio"]);
assert.deepEqual(inputs("live_dictation"), ["audio"]);
assert.deepEqual(inputs("vision_files"), ["text", "image"]);
assert.deepEqual(inputs("look"), ["text", "image"]);
assert.deepEqual(inputs("web_search"), []);
for (const j of JOBS) assert.ok(Array.isArray(JOB_KINDS[j.kind].inputs), j.id);
const html = String(modesHtml({ jv: { inputs: ["text", "image"] } }));
assert.match(html, /Needs a model that reads images/);
assert.equal(String(modesHtml({ kind: "cat" })), "");
console.log("models-modality: ok");
