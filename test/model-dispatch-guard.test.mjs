// node --import ./test/stubs/register.mjs test/model-dispatch-guard.test.mjs
// Every OpenRouter or Cloudflare AI call is seen, set and pushed from /models (Captain 2026-10-17). These checks fail the build when a file other than the
// dispatcher makes such a call, when a call site names a job that doesn't exist, or when a job has no call site.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { JOB_IDS, MODEL_PAGE_JOBS } from "../src/ee/model-jobs.js";

const SKIP = new Set(["prompt", "vendor", "skills", "docs"]);
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return SKIP.has(f) ? [] : statSync(p).isDirectory() ? walk(p) : /\.(js|ts)$/.test(f) ? [p.replace(/\\/g, "/")] : []; });
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).split("\n").map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1")).join("\n");
const files = walk("src"), text = Object.fromEntries(files.map((f) => [f, strip(readFileSync(f, "utf8"))]));

// The dispatcher and the two transport modules it calls (OpenRouter requests in model.js, Workers AI requests in cloudflare-models.js) may hold the network
// code. selfhost-models.js is the transport of models 1Helm runs in its own container (it calls a Durable Object, not an AI endpoint). The public catalog and the person's own key (byok) are not model calls made on the account's behalf.
const TRANSPORT = new Set(["src/ee/model-dispatch.js", "src/model.js", "src/cloudflare-models.js", "src/selfhost-models.js"]);
const OTHER_ALLOWED = { "src/ee/model-catalog.js": "public OpenRouter catalog reads, no key", "src/byok-openrouter.js": "sign in with OpenRouter for the person's own key", "src/byok.js": "the person's own AI key and endpoint" };
const CALL = /\bAI\??\.(?:run|websearch)\s*\(|openrouter\.ai\/api|gateway\.ai\.cloudflare\.com|\bOR_API\b|\bOR_BASE\b/;

test("only the dispatcher and its transport modules call an AI endpoint", () => {
  for (const f of files) {
    if (TRANSPORT.has(f) || OTHER_ALLOWED[f]) continue;
    assert.ok(!CALL.test(text[f]), `${f} calls OpenRouter or Workers AI. Ask the dispatcher (src/ee/model-dispatch.js) for a job instead.`);
  }
  for (const f of Object.keys(OTHER_ALLOWED)) assert.ok(CALL.test(text[f]), `${f} is on the allowed list but makes no such call: remove it from the list`);
});

test("only the dispatcher imports the transport functions", () => {
  const FN = /\b(orFetch|orFetchPath|orSend|routedChat|cloudflareChat|cloudflareEmbeddings|authorizeCloudflare|selfHostedEmbeddings)\b/;
  for (const f of files) {
    if (TRANSPORT.has(f)) continue;
    for (const m of text[f].matchAll(/import\s*\{([^}]*)\}\s*from\s*["']\.{1,2}\/(?:model|cloudflare-models|selfhost-models)\.js["']/g)) assert.ok(!FN.test(m[1]), `${f} imports a transport function (${m[1].match(FN)?.[1]}) from model.js or cloudflare-models.js: only src/ee/model-dispatch.js may`);
  }
  assert.ok(!files.some((f) => /^src\/(?:ee\/)?(router|router-lab|router-page|decision-shadow|test-model|models-page)\.js$/.test(f)), "the classic router, router lab, decision shadow and test model are deleted");
});

// Files that describe jobs (the list, the first-run data, validation, the plan, the report, the pages) and so say nothing about who runs one.
const DESCRIBES = new Set(["src/ee/model-jobs.js", "src/ee/model-seed.js", "src/ee/model-settings.js", "src/ee/model-plan.js", "src/ee/model-dashboard.js", "src/ee/models-console.js", "src/ee/model-served.js", "src/ee/routing-config.js", "src/ee/model-dispatch.js", "src/ee/outside-models.js"]);
test("every job has a dispatch call site, and every dispatched job exists", () => {
  const known = new Set(JOB_IDS), used = new Set();
  // A job is named by a literal in dispatch(env, "job", ...) or a dispatchMedia(...) call, or by the ids a call site lists.
  const lit = /\b(?:dispatch|dispatchMedia)\(\s*[\w.$?]+\s*,\s*["'`]([a-z0-9_.]+)["'`]/g;
  for (const f of files) for (const m of text[f].matchAll(lit)) { assert.ok(known.has(m[1]), `${f}: dispatch names "${m[1]}", which is not a job (model-jobs.js)`); used.add(m[1]); }
  for (const id of JOB_IDS) {
    if (used.has(id)) continue;
    // Any other job is named in a file that runs it: not in the settings, plan, push or page code, which only describe jobs.
    const named = files.some((f) => !DESCRIBES.has(f) && new RegExp(`["'\`]${id}["'\`]`).test(text[f]));
    assert.ok(named, `job ${id} has no call site: nothing runs it, so remove it from model-jobs.js or add the call`);
  }
  // Every job is listed on the Models page: none is saved only for the runtime, and none is hidden from the page.
  assert.deepEqual(MODEL_PAGE_JOBS.map((j) => j.id), JOB_IDS, "every job has a row on the Models page");
  // No job of an earlier release (a chat job per kind of request, the retry jobs, the switch job) is listed or named by a call site any more.
  for (const id of JOB_IDS) assert.ok(!/^(chat\.|recover\.)|^escalate$/.test(id), `${id} belonged to the classic router that was removed`);
});
