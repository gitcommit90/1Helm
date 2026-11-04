// The text that tells a helper (and the main helper) what a helper can do must match the code that gates its tools.
// Bug seen on Live 2026-11-04: the job text said "don't use the $NAME keys" while the tools allowed them, so a helper refused a Comfy Cloud job.
import test from "node:test"; import assert from "node:assert";
import { readFileSync } from "node:fs";
import { helperJobText, helperAllowed, HELPER_ABILITIES, HELPER_PROMPT, START_HELPER_TOOL } from "../src/helpers.js";
import { WORKER_DENIED } from "../src/ee/orchestrator.js";
import { secretUseBlock } from "../src/resident.js";

const legacy = { id: 4, name: "Create the commercial", task: "Make a commercial with the Comfy Cloud key" };
const jobText = helperJobText(legacy, "videos");
const mainSide = { abilities: HELPER_ABILITIES, prompt: HELPER_PROMPT, tool: START_HELPER_TOOL.function.description,
  md: readFileSync(new URL("../src/prompt/08-background-helpers.md", import.meta.url), "utf8"),
  docs: readFileSync(new URL("../src/docs/client-surfaces.md", import.meta.url), "utf8") };
const FORBIDDING = /can't (?:use|run|sign in)[^.]*?(?:saved keys|saved logins or keys|app actions|live browser)|don't use the \$NAME|cannot use the live browser|can't use apps|can't use the browser/i;

test("the job text no longer bans saved keys, apps or the browser, and says helpers may use the $NAME keys", () => {
  assert.match(jobText, /saved keys, which are the \$NAME variables on the computer/);
  assert.match(jobText, /app_run/); assert.match(jobText, /the browser/);
  assert.doesNotMatch(jobText, FORBIDDING);
  assert.doesNotMatch(jobText, /use saved passwords, keys or logins/);
  for (const [k, v] of Object.entries(mainSide)) assert.doesNotMatch(v, FORBIDDING, `${k} forbids something a helper may do`);
});

test("the main helper's text says a job needing the person's saved keys can go to a helper", () => {
  for (const t of [HELPER_PROMPT, START_HELPER_TOOL.function.description, mainSide.md]) assert.match(t, /saved keys/);
  assert.match(HELPER_PROMPT, /can go to a helper as it is/);
});

test("every tool the helper job text says it can't use is really denied to a legacy helper", () => {
  const named = [...new Set([...jobText.matchAll(/\(([a-z_]+(?:, [a-z_]+)*)\)/g)].flatMap((m) => m[1].split(", ")))].filter((n) => /^(browser_fill_login|browser_fill_card|buy_with_link|check_purchase|ask_user|interview|send_poll)$/.test(n));
  assert.deepEqual(named.sort(), ["ask_user", "browser_fill_card", "browser_fill_login", "buy_with_link", "check_purchase", "interview", "send_poll"]);
  const tc = { kind: "helper", helper: { id: 4, dynamic_routing: 0 } };
  for (const n of named) assert.ok(WORKER_DENIED.has(n) || secretUseBlock(n, tc), `${n} is named as a can't but is allowed`);
});

test("every tool the text says a helper can use is allowed and not blocked", () => {
  const tc = { kind: "helper", helper: { id: 4, dynamic_routing: 0 } };
  for (const n of ["run_command", "fetch_url", "web_search", "gmail_search", "calendar_events", "app_actions", "app_run", "find_app", "browser_navigate", "browser_act", "browser_snapshot"]) {
    assert.ok(helperAllowed(n), `${n} should be allowed`); assert.equal(secretUseBlock(n, tc), null, `${n} should not be blocked`);
  }
  for (const n of ["start_helper", "list_helpers", "send_helper", "stop_helper", "recall_memory", "read_context"]) assert.ok(!helperAllowed(n), `${n} should be denied`);
});

test("the can't list in the shared abilities text names no allowed tool", () => {
  const cant = HELPER_ABILITIES.slice(HELPER_ABILITIES.indexOf("A helper can't"));
  const tc = { kind: "helper", helper: { id: 4, dynamic_routing: 0 } };
  for (const m of cant.matchAll(/\(([a-z_]+(?:, [a-z_]+)*)\)/g)) for (const n of m[1].split(", ")) assert.ok(WORKER_DENIED.has(n) || secretUseBlock(n, tc), `${n} is listed as a can't but is allowed`);
});
