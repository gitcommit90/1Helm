// node --import ./test/stubs/register.mjs test/sandbox-samples.test.mjs
// Every job in JOBS and every chat category has exactly one Sandbox sample, built by the job's own code with fake inputs (src/sandbox-samples/chat.js and media.js).
import test from "node:test";
import assert from "node:assert/strict";
import { JOBS } from "../src/ee/model-jobs.js";
import { VIAS } from "../src/ee/sandbox.js";
import { allSamples, samplesFor } from "../src/ee/sandbox-samples/index.js";
import { CATEGORIES } from "../src/ee/pool.js";
import { SEED, withSettings } from "./helpers/seed-settings.mjs";

// Every job, every routing category in CATEGORIES (src/pool.js) and every category in the saved settings.
const wanted = [...new Set([...JOBS.map((j) => j.id), ...CATEGORIES.map((c) => `chat:${c}`), ...SEED.routing.categories.map((c) => `chat:${c.id}`)])];
test("every job and every chat category has exactly one sample", () => {
  for (const id of wanted) assert.equal(samplesFor(id).length, 1, `${id} needs exactly one sample, has ${samplesFor(id).length}`);
  assert.deepEqual(allSamples().map((s) => s.job).filter((id) => !wanted.includes(id)), [], "a sample names a job that does not exist");
});
test("each sample names a function the Sandbox can send through and builds a request", async () => {
  const env = withSettings({});
  for (const s of allSamples()) {
    assert.ok(VIAS[s.via], `${s.job}: ${s.via} is not supported by the Sandbox`);
    const { request, files } = await s.build(env, { settings: env.MODEL_SETTINGS, job: s.job });
    assert.ok(request && typeof request === "object", s.job);
    const names = [...JSON.stringify(request).matchAll(/"\$file":"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
    for (const n of names) assert.ok((files || []).some((f) => f.name === n), `${s.job}: placeholder ${n} has no file`);
    for (const f of files || []) assert.match(f.path, /^\/app-static\/sandbox\/[A-Za-z0-9._-]+$/, `${s.job}: ${f.name}`);
  }
});
