import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { PassThrough } from "node:stream";
import test from "node:test";

import { actionSummary, completedToolAnswer, toolActionStatus } from "../src/server/bot-output.ts";
import { body, clearRateLimit, jbody, json, rateLimited, SECURITY_HEADERS } from "../src/server/http.ts";
import {
  formatRoughTokens,
  formatThreadFollowupCountdown,
  parseToolBody,
  progressCounts,
  progressPreviewLine,
  stickyWorkingLabel,
  threadUsageLabel,
  workingChipLabel,
  workingDisplayBody,
} from "../src/client/thread-formatters.ts";

function request(payload, headers = {}) {
  const stream = new PassThrough();
  stream.headers = headers;
  stream.socket = { remoteAddress: "127.0.0.1" };
  queueMicrotask(() => stream.end(payload));
  return stream;
}

test("HTTP extraction preserves JSON, security headers, malformed input, and fail-closed limits", async () => {
  const writes = [];
  const response = {
    writeHead(code, headers) { writes.push({ code, headers }); },
    end(value) { writes.push(value); },
  };
  json(response, 409, { error: "exact conflict" });
  assert.equal(writes[0].code, 409);
  assert.equal(writes[0].headers["content-type"], "application/json");
  assert.equal(writes[0].headers["x-frame-options"], "DENY");
  assert.equal(writes[0].headers["permissions-policy"], SECURITY_HEADERS["permissions-policy"]);
  assert.equal(writes[1], '{"error":"exact conflict"}');

  assert.deepEqual(await jbody(request('{"ok":true}')), { ok: true });
  assert.deepEqual(await jbody(request("{invalid")), {}, "malformed JSON remains an empty request object");
  await assert.rejects(body(request("abcd", { "content-length": "4" }), 3), (error) => {
    assert.equal(error.name, "PayloadTooLargeError");
    assert.equal(error.message, "Request exceeds the 0 MB limit.");
    return true;
  });
  await assert.rejects(body(request("abcd"), 3), { name: "PayloadTooLargeError" }, "streamed bodies fail closed too");

  clearRateLimit("phase6");
  assert.equal(rateLimited("phase6", 2, 60_000), false);
  assert.equal(rateLimited("phase6", 2, 60_000), false);
  assert.equal(rateLimited("phase6", 2, 60_000), true);
  clearRateLimit("phase6");
  assert.equal(rateLimited("phase6", 2, 60_000), false, "successful login reset still clears the exact key");
});

test("bot output extraction preserves exact completion and audit wording", () => {
  assert.equal(toolActionStatus("status=completed\nexit_code=0\nok"), "complete");
  assert.equal(toolActionStatus("status=failed\nexit_code=100\napt failed"), "failed");
  assert.equal(toolActionStatus("Error: runtime unavailable"), "failed");
  assert.equal(toolActionStatus("status=running\nexit_code=null"), "running");
  assert.equal(completedToolAnswer("run_command", "status=completed\nexit_code=0\nok"),
    "The command completed.\n\n```text\nstatus=completed\nexit_code=0\nok\n```");
  assert.equal(completedToolAnswer("gmail_create_draft", '{"account":"captain@example.test","draft_id":"d1"}'),
    "Created a Gmail draft in **captain@example.test** (draft d1). It was not sent.");
  assert.equal(completedToolAnswer("gmail_search", "not json"),
    "Gmail search completed, but the model did not produce a final explanation. The result remains available in this session.");
  assert.equal(completedToolAnswer("inspect_web_source", '{"content":"large raw result"}'),
    "The source was inspected successfully, but the model did not produce a final answer. The retrieved result remains available in this session.");
  assert.equal(actionSummary("run_command", "printf ok", "complete", "resident"), "Ran work in the resident workspace → complete.");
  assert.equal(actionSummary("install_skill", "bounded-research", "failed", "skipper"), "Installed bounded-research → failed.");
});

test("thread formatter extraction preserves progress, usage, and countdown edge cases", () => {
  assert.deepEqual(parseToolBody("search_web: latest news\n3 results"), { title: "search web", input: "latest news", output: "3 results" });
  assert.deepEqual(parseToolBody("\nresult"), { title: "tool", input: "", output: "result" });
  const progress = [
    { id: 1, kind: "thinking", body: "Inspecting the source", status: "complete" },
    { id: 2, kind: "tool", body: "search_web: current evidence", status: "running" },
  ];
  assert.equal(progressPreviewLine(progress), "search web · current evidence");
  assert.equal(stickyWorkingLabel(progress), "Inspecting the source");
  assert.equal(progressCounts(progress), "1 tool · 1 thought");
  assert.equal(workingDisplayBody({ body: "_Working…_", progress }), "Inspecting the source");
  assert.equal(workingChipLabel({ body: "_Working…_", progress }), "Inspecting the source");
  assert.equal(workingChipLabel({ body: "A".repeat(80) }), `${"A".repeat(72)}…`);
  assert.equal(formatRoughTokens(-4), "0");
  assert.equal(formatRoughTokens(1_240), "1.2k");
  assert.equal(formatRoughTokens(10_200), "10k");
  assert.equal(formatRoughTokens(1_500_000), "1.5M");
  assert.equal(threadUsageLabel({ input_tokens: 1_240, output_tokens: 340, cached_input_tokens: 900, model_calls: 3 }), "Spent 1.2k input (900 cached) · 340 output · 3 calls");
  const now = 1_000_000;
  assert.equal(formatThreadFollowupCountdown(now - 1, now), "now");
  assert.equal(formatThreadFollowupCountdown(now + 9_000, now), "9s");
  assert.equal(formatThreadFollowupCountdown(now + 65_000, now), "1m 05s");
  assert.equal(formatThreadFollowupCountdown(now + 3_665_000, now), "1h 01m 05s");
});

test("module architecture report is advisory and recognizes the ratcheted baseline", () => {
  const output = execFileSync(process.execPath, ["scripts/module-architecture-report.mjs"], { encoding: "utf8" });
  assert.match(output, /advisory only/);
  assert.match(output, /Large modules[\s\S]*High fan-in[\s\S]*High fan-out[\s\S]*Import cycles/);
  assert.match(output, /No new or regressed budget flags\./);
  assert.match(output, /Ratchet a legacy budget down after an extraction/);
  assert.doesNotMatch(output, /photon-sidecar\.bundle/, "generated build artifacts never enter the source-module budget");
});
