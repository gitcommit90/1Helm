import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const script = resolve(import.meta.dirname, "../scripts/release-stage-evidence.mjs");

test("release stage evidence binds exact bytes to version, commit, and workflow run", () => {
  const root = mkdtempSync(join(tmpdir(), "1helm-stage-"));
  const artifact = join(root, "artifact.tgz");
  const evidence = join(root, "evidence.json");
  writeFileSync(artifact, "immutable release bytes");
  execFileSync(process.execPath, [script, "create", "linux-build", "9.8.7", "a".repeat(40), evidence, artifact], {
    env: { ...process.env, GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "2", GITHUB_WORKFLOW: "Linux build" },
  });
  execFileSync(process.execPath, [script, "verify", evidence, "linux-build", "9.8.7", "a".repeat(40), root]);
  const value = JSON.parse(readFileSync(evidence, "utf8"));
  assert.equal(value.run_id, "123");
  assert.equal(value.artifacts[0].name, "artifact.tgz");
  writeFileSync(artifact, "changed bytes");
  assert.throws(() => execFileSync(process.execPath, [script, "verify", evidence, "linux-build", "9.8.7", "a".repeat(40), root]));
});
