// node --import ./test/stubs/register.mjs test/claude-signin-url.test.mjs
// The Continue with Claude address rule. The same accept and reject lists are in web/test/byok-cc-host.test.mjs (the app page's second guard): keep the two lists identical.
// Also checks that the build guard in src/ee/claude-engine/relay/check-authorize-url.mjs holds the same rule, and that it passes and fails on the right files.
import assert from "node:assert/strict"; import { test } from "node:test"; import { writeFileSync, mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path"; import { spawnSync } from "node:child_process";
import { ccSignInUrlOk, CC_SIGNIN_HOST } from "../src/ee/claude-signin-url.js";
import { CC_SIGNIN_HOST as GUARD_HOST, authorizeUrls } from "../src/ee/claude-engine/relay/check-authorize-url.mjs";
const ACCEPT = ["https://claude.com/cai/oauth/authorize?code=true&state=abc", "https://platform.claude.com/oauth/authorize?code=true", "https://claude.ai/oauth/authorize?code=true", "https://console.anthropic.com/oauth/authorize", "https://anthropic.com", "https://claude.com"];
const REJECT = ["http://claude.com/cai/oauth/authorize", "https://claude.com.evil.io/x", "https://evilclaude.com/x", "https://claude.com@evil.io/x", "https://evil.io/claude.com/", "https://evil.io/?https://claude.com/", "https://claude.co/x", "ftp://claude.ai/x", "", "https://claude.com:8443/x"];
test("the sign-in address rule accepts Anthropic's https domains and rejects lookalikes, http, user names and other ports", () => {
  for (const u of ACCEPT) assert.ok(ccSignInUrlOk(u), `accepts ${u}`);
  for (const u of REJECT) assert.ok(!ccSignInUrlOk(u), `rejects ${u}`);
  for (const u of [undefined, null, 5, {}]) assert.ok(!ccSignInUrlOk(u));
});
test("the build guard holds the same rule as the server", () => { assert.equal(GUARD_HOST.source, CC_SIGNIN_HOST.source); assert.equal(GUARD_HOST.flags, CC_SIGNIN_HOST.flags); });
test("the build guard passes the 2.1.316 address and fails a moved, missing or lookalike address", () => {
  assert.deepEqual(authorizeUrls('x,CLAUDE_AI_AUTHORIZE_URL:"https://claude.com/cai/oauth/authorize",y'), ["https://claude.com/cai/oauth/authorize"]);
  const dir = mkdtempSync(join(tmpdir(), "ccguard-")); const run = (text) => { const f = join(dir, "bin"); writeFileSync(f, text); return spawnSync(process.execPath, [new URL("../src/ee/claude-engine/relay/check-authorize-url.mjs", import.meta.url).pathname, f], { encoding: "utf8" }); };
  assert.equal(run('a CLAUDE_AI_AUTHORIZE_URL:"https://claude.com/cai/oauth/authorize" b').status, 0);
  assert.equal(run('CLAUDE_AI_AUTHORIZE_URL:"https://claude.example.io/authorize"').status, 1);
  assert.equal(run('CLAUDE_AI_AUTHORIZE_URL:"https://claude.com/a" CLAUDE_AI_AUTHORIZE_URL:"http://claude.com/b"').status, 1);
  assert.equal(run("no such string").status, 1);
});
