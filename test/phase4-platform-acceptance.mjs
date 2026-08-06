import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = join(import.meta.dirname, "..");
const read = (path) => readFileSync(join(root, path), "utf8");

test("ordinary pushes run CI without automatically starting a dress rehearsal", () => {
  const workflow = read(".github/workflows/candidate.yml");
  assert.match(workflow, /workflow_run:[\s\S]*workflows: \[CI\]/);
  assert.match(workflow, /github\.event\.workflow_run\.head_sha == vars\.HELM_DRESS_REHEARSAL_SHA/);
  assert.doesNotMatch(workflow, /pull_request_target|workflow_dispatch/);
});

test("ordinary product tests do not run dormant publication machinery", () => {
  const suite = read("scripts/run-test-suite.mjs");
  const pkg = JSON.parse(read("package.json"));
  assert.doesNotMatch(suite, /phase3-promotion|release-governance|delivery-governance|site-stable-manifest/);
  assert.match(pkg.scripts["test:release-process"], /phase3-promotion/);
  assert.match(pkg.scripts["test:release-process"], /release-governance/);
});

test("the rehearsal has one build and exactly three real platform verdicts", () => {
  const workflow = read(".github/workflows/candidate.yml");
  assert.match(workflow, /build:[\s\S]*npm run package:channel-image[\s\S]*npm run package:linux/);
  assert.match(workflow, /accept-linux:[\s\S]*runs-on: \[1helm-linux-phase4\]/);
  assert.match(workflow, /accept-windows:[\s\S]*runs-on: \[1helm-windows-phase4\]/);
  assert.match(workflow, /accept-macos:[\s\S]*runs-on: \[1helm-macos-phase4\]/);
  assert.match(workflow, /needs: \[build, accept-linux, accept-windows, accept-macos\]/);
  assert.match(workflow, /test "\$LINUX" = success[\s\S]*test "\$WINDOWS" = success[\s\S]*test "\$MACOS" = success/);
});

test("the shared start hook permits only the two Unix test lanes", () => {
  const hook = read("ops/platform-acceptance/runner-job-started.sh");
  assert.match(hook, /accept-macos\) expected_label=1helm-macos-phase4/);
  assert.match(hook, /accept-linux\) expected_label=1helm-linux-phase4/);
  assert.match(hook, /workflow_run/);
  assert.doesNotMatch(hook, /pull_request/);
});

test("evidence machinery cannot veto a working platform", () => {
  const sources = [
    read(".github/workflows/candidate.yml"),
    read("ops/platform-acceptance/linux.sh"),
    read("ops/platform-acceptance/windows.ps1"),
    read("ops/platform-acceptance/macos.sh"),
  ].join("\n");
  for (const retired of [
    "pending-acceptance-evidence", "acceptance-evidence.mjs", "candidate-matrix-status",
    "candidate-manifest.mjs", "mac-candidate-manifest.mjs", "verify-retained-mac-candidate",
    "attest-build-provenance", "gh attestation verify", "provenance.bundle",
  ]) assert.doesNotMatch(sources, new RegExp(retired.replaceAll(".", "\\.")));
  assert.doesNotMatch(sources, /upload-artifact[\s\S]{0,200}acceptance|candidate-evidence/);
});

test("Windows proves product behavior and ends when scoped uninstall succeeds", () => {
  const windows = read("ops/platform-acceptance/windows.ps1");
  assert.match(windows, /function Assert-DistroVersion/);
  assert.match(windows, /exact candidate clean install failed/);
  assert.match(windows, /site-equivalent install failed/);
  assert.match(windows, /WSL data marker changed across update/);
  assert.match(windows, /snapshot-assisted WSL cold-start equivalent/);
  assert.match(windows, /scoped uninstall returned failure/);
  assert.match(windows, /Windows passed:/);
  assert.doesNotMatch(windows, /windows-acceptance-evidence|HELM_ACCEPTANCE_OUTPUT/);
});

test("Mac uses ordinary unzip and ignores AppleDouble metadata", () => {
  const mac = read("ops/platform-acceptance/macos.sh");
  assert.match(mac, /package\.json/);
  assert.match(mac, /\/usr\/bin\/unzip -q "\$ZIP"/);
  assert.match(mac, /\/usr\/bin\/unzip -q "\$work\/previous\/\$PREVIOUS_NAME"/);
  assert.match(mac, /rm -rf -- "\$work\/previous\/app\/__MACOSX"/);
  assert.doesNotMatch(mac, /ditto -x -k/);
  assert.match(mac, /--http1\.1[\s\S]*--max-time 900/);
  assert.match(mac, /codesign --verify[\s\S]*stapler validate[\s\S]*spctl --assess/);
});

test("Linux uses the dedicated real test host and checks the literal release path", () => {
  const linux = read("ops/platform-acceptance/linux.sh");
  assert.match(linux, /RUNNER_NAME:-.*1helm-linux-fresh/);
  assert.match(linux, /releases\/latest/);
  assert.match(linux, /apply-linux-release\.sh/);
  assert.match(linux, /systemctl restart 1helm\.service/);
  assert.match(linux, /uninstall-host\.sh/);
  assert.match(linux, /Preserved|durable data intact/);
});

test("the rehearsal cannot publish or touch Stable", () => {
  const workflow = read(".github/workflows/candidate.yml");
  assert.match(workflow, /permissions:[\s\S]*contents: read/);
  assert.doesNotMatch(workflow, /contents: write|gh release create|git tag|deploy|publish|STABLE_PUBLICATION/);
  assert.match(workflow, /Stable\/public release touched: no/);
});
