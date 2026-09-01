import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

const require = createRequire(import.meta.url);
const { OAUTH } = require("@gitcommit90/rerouted/src/lib/constants.js");
const claude = require("@gitcommit90/rerouted/src/lib/providers/claude.js");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("Claude subscriptions include Fable 5.1 and use its minimum supported Claude Code fingerprint", () => {
  assert.equal(OAUTH.claude.models[0].id, "claude-fable-5-1");
  assert.equal(OAUTH.claude.models[0].name, "Claude Fable 5.1");
  const headers = claude.anthropicHeaders({ accessToken: "sk-ant-oat01-contract" }, "00000000-0000-4000-8000-000000000000");
  assert.match(String(headers["User-Agent"]), /^claude-cli\/2\.1\.251 /);
  const body = claude.applyCloaking(claude.toAnthropicBody({ messages: [{ role: "user", content: "test" }] }, "claude-fable-5-1", false), "sk-ant-oat01-contract", "00000000-0000-4000-8000-000000000000");
  assert.match(body.system[0].text, /cc_version=2\.1\.251\./);
  assert.match(packageJson.dependencies["@gitcommit90/rerouted"], /46dd339f687f1f02e309f52db5bbd9c699b8b4fc$/);
});
