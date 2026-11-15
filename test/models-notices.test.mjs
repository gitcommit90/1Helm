// node --import ./test/stubs/register.mjs test/models-notices.test.mjs
// The notices on the Models page about the last call of a job: alias-aware matching of the served model, input errors, and old failures.
import assert from "node:assert/strict";
import * as C from "../app-assets/app-static/models-console-core.js";
import { noteServed, resetServedCache } from "../src/ee/model-served.js";

let failed = 0;
const test = async (name, fn) => { try { await fn(); console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name, "\n", e); } };

const ALIAS = "~deepseek/deepseek-flash-latest", TARGET = "deepseek/deepseek-v4.1-flash", CONCRETE = "deepseek/deepseek-v4.1-flash-1017", MAIN = "particle-ai/particle-1";
const state = { aliases: { [ALIAS]: TARGET }, config: { catalog: {} } };
const row = { kind: "job", id: "label", key: "label" };
const now = 1_800_000_000_000, hour = 3600e3, day = 24 * hour;
const chains = [[{ model: MAIN }, { model: ALIAS }]], aliasFirst = [[{ model: ALIAS }]];
const ss = (sv, ch = chains, st = state) => C.servedState(st, row, ch, { label: { since: 0, last_at: now - 60000, ...sv } }, now);

await test("alias served: a call that asked for the alias is the saved alias entry", () => {
  assert.equal(ss({ requested: ALIAS, served_model: CONCRETE, last_status: "ok" }, aliasFirst).k, "ok");
  assert.equal(ss({ requested: ALIAS, served_model: CONCRETE, last_status: "ok" }).k, "fallback", "second in the chain is a fallback, as before");
});
await test("concrete served: the model the alias resolves to, or a dated name of it, is the saved alias entry", () => {
  assert.equal(ss({ requested: TARGET, served_model: TARGET, last_status: "ok" }, aliasFirst).k, "ok");
  assert.equal(ss({ requested: CONCRETE, served_model: CONCRETE, last_status: "ok" }, aliasFirst).k, "ok");
  assert.equal(ss({ requested: CONCRETE, served_model: CONCRETE, last_status: "ok" }).k, "fallback");
  assert.equal(ss({ requested: "deepseek/deepseek-v4.1-flashy", served_model: null, last_status: "ok" }, aliasFirst).k, "other", "a different name that only shares letters is not the model");
  assert.equal(ss({ requested: CONCRETE, served_model: CONCRETE, last_status: "ok" }, aliasFirst, { ...state, aliases: {} }).k, "other", "without OpenRouter's alias data nothing is guessed");
});
await test("a model that is not in the list is still reported", () => {
  const t = ss({ requested: "other/not-in-the-list", served_model: "other/not-in-the-list", last_status: "ok" });
  assert.equal(t.k, "other");
  assert.equal(C.flagsOf(state, {}, row, { snap: { jobs: { label: { chain: chains[0] } }, cats: {} }, served: { label: { since: 0, requested: "other/not-in-the-list", last_at: now - 60000, last_status: "ok" } }, diffs: [], now }).some((f) => f.short === "Unlisted model"), true);
});
await test("fallback served: the notice stays", () => {
  const f = C.flagsOf(state, {}, row, { snap: { jobs: { label: { chain: chains[0] } }, cats: {} }, served: { label: { since: 0, requested: ALIAS, served_model: CONCRETE, last_at: now - 60000, last_status: "ok" } }, diffs: [], now });
  assert.equal(f.some((x) => x.short === "Fallback served"), true);
  assert.equal(f.some((x) => x.short === "Unlisted model"), false);
});
await test("input error: a file the model cannot decode is not the model failing", () => {
  for (const msg of ["3030: Failed to decode audio file. Ensure it is a valid audio format.", "Invalid image input", "Request entity too large (413)", "empty audio"]) {
    assert.equal(ss({ requested: MAIN, last_status: msg, last_error_at: now - 60000 }).k, "input", msg);
    const f = C.flagsOf(state, {}, row, { snap: { jobs: { label: { chain: chains[0] } }, cats: {} }, served: { label: { since: 0, requested: MAIN, last_at: now - 60000, last_error_at: now - 60000, last_status: msg } }, diffs: [], now });
    assert.equal(f.length, 0, msg);
  }
  assert.equal(ss({ requested: MAIN, last_status: "HTTP 502", last_error_at: now - 60000 }).k, "error", "a real failure still shows");
  assert.equal(ss({ requested: MAIN, last_status: "Task model unavailable (503).", last_error_at: now - 60000 }).k, "error");
});
await test("old failure followed by success: the success clears it", () => {
  assert.equal(ss({ requested: MAIN, served_model: MAIN, last_status: "ok", last_at: now - 60000, last_error_at: null }).k, "ok");
});
await test("old failure with no calls since: dropped after a day, shown before", () => {
  assert.equal(ss({ requested: MAIN, last_status: "HTTP 502", last_at: now - 13 * day, last_error_at: now - 13 * day }).k, "stale");
  assert.equal(ss({ requested: MAIN, last_status: "HTTP 502", last_at: now - 13 * day, last_error_at: now - 2 * hour }).k, "error", "dated by the failure's own time");
  const f = C.flagsOf(state, {}, row, { snap: { jobs: { label: { chain: chains[0] } }, cats: {} }, served: { label: { since: 0, requested: MAIN, last_at: now - 13 * day, last_error_at: now - 13 * day, last_status: "HTTP 502" } }, diffs: [], now });
  assert.equal(f.length, 0);
});
await test("recording: an input error is not written as the model failing, a real failure is", () => {
  resetServedCache();
  const writes = [], env = { ENV_NAME: "dev", DB: { prepare: (q) => ({ bind: (...a) => ({ run: async () => { writes.push(a); } }) }) } };
  assert.equal(noteServed(env, { job: "stt", requested: "@cf/openai/whisper-large-v3-turbo", ok: false, error: "3030: Failed to decode audio file. Ensure it is a valid audio format." }), null);
  assert.equal(writes.length, 0);
  assert.notEqual(noteServed(env, { job: "stt", requested: "@cf/openai/whisper-large-v3-turbo", ok: false, error: "HTTP 502" }), null);
});

if (failed) { console.log(failed + " failed"); process.exit(1); }
