import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

const require = createRequire(import.meta.url);
const antigravity = require("@gitcommit90/rerouted/src/lib/providers/antigravity.js");
const enginePackage = require("@gitcommit90/rerouted/package.json");
const ROOT = new URL("..", import.meta.url).pathname;

test("embedded ReRouted keeps Antigravity CRLF streams visible", async () => {
  assert.equal(enginePackage.version, "0.5.13", "the embedded router contains the Antigravity stream fix plus the Claude Fable 5.1 update");
  const upstream = {
    response: {
      candidates: [{ content: { role: "model", parts: [{ text: "OK" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1, totalTokenCount: 4, cachedContentTokenCount: 2 },
    },
  };
  const writes = [];
  const usage = await antigravity.pipeGeminiSse(
    Readable.from([`data: ${JSON.stringify(upstream)}\r\n\r\n`]),
    { write(chunk) { writes.push(String(chunk)); } },
    "gemini-3-flash-agent",
  );
  const chunks = writes.join("").split("\n\n")
    .filter((block) => block.startsWith("data: ") && block !== "data: [DONE]")
    .map((block) => JSON.parse(block.slice(6)));
  assert.equal(chunks.map((chunk) => chunk.choices[0].delta.content).filter(Boolean).join(""), "OK");
  assert.equal(chunks.at(-1).choices[0].finish_reason, "stop");
  assert.deepEqual(usage, {
    prompt_tokens: 3,
    completion_tokens: 1,
    total_tokens: 4,
    prompt_tokens_details: { cached_tokens: 2 },
  });
});

test("1Helm configures the embedded router for patient upstream connections", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "1helm-routing-config-test-"));
  try {
    const result = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", `
      import net from "node:net";
      import { createRequire } from "node:module";
      await import("./src/server/routing.ts");
      const require = createRequire(import.meta.url);
      const constants = require("@gitcommit90/rerouted/src/lib/constants.js");
      console.log(JSON.stringify({
        requestTimeoutMs: constants.REQUEST_TIMEOUT_MS,
        autoSelectFamily: net.getDefaultAutoSelectFamily(),
        addressAttemptTimeoutMs: net.getDefaultAutoSelectFamilyAttemptTimeout(),
      }));
    `], { cwd: ROOT, env: { ...process.env, CTRL_DATA_DIR: dataDir }, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout.trim()), {
      requestTimeoutMs: 180_000,
      autoSelectFamily: true,
      addressAttemptTimeoutMs: 5_000,
    });
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
