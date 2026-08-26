import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (name) => readFileSync(resolve(root, ".github/workflows", name), "utf8");

test("release pipeline has durable retry boundaries instead of one monolithic run", () => {
  const files = [
    "ci.yml", "release-linux-build.yml", "release-mac-build.yml", "release-acceptance.yml",
    "release-assemble.yml", "release-publish.yml", "release-public-verify.yml",
  ];
  for (const file of files) assert.match(read(file), /workflow_dispatch|push:/, `${file} must have an independent trigger`);
  assert.doesNotMatch(read("ci.yml"), /package:dmg:release|package:linux/, "cheap CI must build no release package");
  assert.match(read("release-linux-build.yml"), /ci_run_id/);
  assert.match(read("release-mac-build.yml"), /ci_run_id/);
  assert.match(read("release-acceptance.yml"), /run-id:.*build_run_id/);
  assert.doesNotMatch(read("release-acceptance.yml"), /package:dmg:release|package:linux/, "acceptance must not rebuild artifacts");
  assert.doesNotMatch(read("release-acceptance.yml"), /tar -tzf.*\| grep -q/, "archive checks must not trigger tar SIGPIPE under pipefail");
  assert.doesNotMatch(read("release-publish.yml"), /npm ci|package:|notarytool/, "publication must consume, not rebuild");
  assert.doesNotMatch(read("release-public-verify.yml"), /npm ci|package:|notarytool/, "public verification must consume, not rebuild");
});

test("Mac build retains Apple submission evidence with exact package bytes", () => {
  const workflow = read("release-mac-build.yml");
  const packager = readFileSync(resolve(root, "scripts/package-mac-dmg.cjs"), "utf8");
  assert.match(workflow, /apple-notarization-evidence\.json/);
  assert.match(packager, /submission\.status !== "Accepted"/);
  assert.match(packager, /notarySubmissions\.length !== 2/);
});
