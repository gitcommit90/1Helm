import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = join(import.meta.dirname, "..");
const read = (path) => readFileSync(join(root, path), "utf8");

test("the agent contract defaults to preview and requires a complete handoff", () => {
  const contract = read("AGENTS.md");
  const claudeInstructions = read("CLAUDE.md");
  assert.match(contract, /default delivery mode[\s\S]*PREVIEW ONLY/i);
  assert.match(claudeInstructions, /\[AGENTS\.md\]\(AGENTS\.md\)/);
  assert.match(claudeInstructions, /authoritative delivery contract/i);
  for (const boundary of ["bump versions", "tags", "releases", "deploy", "stable", "production data", "infrastructure", "broaden"]) {
    assert.match(contract, new RegExp(boundary, "i"));
  }
  assert.match(contract, /npm run ci/);
  for (const evidence of ["changed files", "checks run", "risks", "rollback", "stable"]) {
    assert.match(contract, new RegExp(evidence, "i"));
  }
});

test("the canary plan preserves the legacy fixture and constrains approved Phase 2", () => {
  const plan = read("docs/canary-plan.md");
  assert.match(plan, /LXC 112[\s\S]*pve2[\s\S]*legacy[\s\S]*v0\.0\.38 updater fixture/i);
  assert.match(plan, /Phase 2[\s\S]*fresh, unprivileged LXC/i);
  assert.match(plan, /does not[\s\S]*create or modify infrastructure/i);
  assert.match(plan, /source commit[\s\S]*artifact[\s\S]*SHA-256/i);
  assert.match(plan, /rollback[\s\S]*LXC 112/i);
});

test("generated state is ignored and cleanup remains report-only", () => {
  const ignores = read(".gitignore");
  const cleanup = read("scripts/cleanup-report-lib.mjs") + read("scripts/cleanup-report.mjs");
  for (const path of ["/.release-tmp/", "/.native-test-data/", "/src/server/agent.ts.bak-normal-terminal-"]) {
    assert.match(ignores, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(cleanup, /readOnly: true/);
  assert.match(cleanup, /removed: false/);
  assert.doesNotMatch(cleanup, /\brmSync\b|\bunlinkSync\b|\brmdirSync\b|\bwriteFileSync\b/);
});
