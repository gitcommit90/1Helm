// node --import ./test/stubs/register.mjs test/browser-look-timeout.test.mjs
// A browser look whose vision call never answers must fail at the look job's timeout instead of holding the turn (the Workers AI Moondream call
// can hang for about two minutes). The timeout is the saved one from the Models page; it starts at 40 s. No network and no model calls.
import assert from "node:assert/strict";
import { SEED } from "./helpers/seed-settings.mjs";
import { moondreamRun } from "../src/sidecar.js";
import { jobTimeoutMs } from "../src/ee/model-jobs.js";
import { jobTimeoutDefault } from "../src/limits.js";

const ok = (n) => console.log("  ok", n);
const keepAlive = setInterval(() => {}, 100);   // Node does not keep itself alive for an AbortSignal.timeout timer
const withLook = (timeout_ms) => { const s = JSON.parse(JSON.stringify(SEED)); s.jobs = { ...s.jobs, look: { ...(s.jobs?.look || {}), timeout_ms } }; return s; };
const envWith = (AI, settings = SEED) => ({ OPENROUTER_API_KEY: "k", PROMPT_CACHE: "off", MODEL_SETTINGS: settings, MODEL_SETTINGS_REVISION: 1, AI });
const body = { task: "caption", image: "data:image/png;base64,AQID" };

assert.equal(jobTimeoutDefault("look"), 40000); assert.equal(jobTimeoutMs(SEED, "look"), 40000); ok("the look job starts with a 40 second timeout");
assert.equal(jobTimeoutMs(withLook(2500), "look"), 2500); ok("a saved Models page timeout replaces the default");

{ const t0 = Date.now(), hang = envWith({ run: () => new Promise(() => {}) }, withLook(1500));
  await assert.rejects(moondreamRun(hang, { tenant: "t" }, body), (e) => !/storage is unavailable/.test(e.message));
  const ms = Date.now() - t0; assert.ok(ms >= 1000 && ms < 8000, `a hung look is given up at the saved timeout (${ms} ms)`); ok("a hung call is cut at the saved timeout"); }

{ let calls = 0; const env = envWith({ run: async () => { calls++; return { caption: "", answer: "" }; } });
  const r = await moondreamRun(env, { tenant: "t" }, body); assert.equal(calls, 3, "an empty answer is still retried"); assert.deepEqual(r.out, {}); ok("empty answers still retry"); }

{ const r = await moondreamRun(envWith({ run: async () => ({ caption: "a page", metrics: {} }) }), { tenant: "t" }, body); assert.equal(r.out.caption, "a page"); ok("a normal answer is unchanged"); }
clearInterval(keepAlive);
console.log("browser-look-timeout: ok");
