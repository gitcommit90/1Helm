import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { normalizePlatformEvidence, PLATFORM_ARTIFACT_ROLES, PLATFORM_CHECKS, platformEvidenceBlockers } from "../scripts/platform-acceptance-lib.mjs";

const root = join(import.meta.dirname, "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const commit = "a".repeat(40);
const version = "1.2.3";
const runId = "123";
const ciRunId = "99";
const artifactMap = {
  mac_dmg: { role: "mac_dmg", name: `1Helm-${version}-arm64.dmg`, sha256: hash("dmg"), bytes: 3 },
  mac_updater_zip: { role: "mac_updater_zip", name: `1Helm-${version}-mac-arm64.zip`, sha256: hash("zip"), bytes: 3 },
  linux_tgz: { role: "linux_tgz", name: `1Helm-${version}-linux-node.tgz`, sha256: hash("tgz"), bytes: 3 },
  linux_offline_tgz: { role: "linux_offline_tgz", name: `1Helm-${version}-linux-node-offline.tgz`, sha256: hash("offline"), bytes: 7 },
};
const channelImage = { version: "1", architecture: "amd64", sha256: hash("image"), bytes: 5 };

function fixture(platform) {
  const checkedAt = "2026-08-04T14:00:00Z";
  const marker = hash(`${platform}-marker`);
  return {
    platform, commit, version, result: "passed",
    candidate: { run_id: runId, run_attempt: "1" },
    source_ci: { workflow: "CI", run_id: ciRunId, conclusion: "success" },
    started_at: "2026-08-04T13:00:00Z", checked_at: checkedAt,
    machine: {
      id: `${platform}-machine`, kind: { linux: "github-hosted-ephemeral", macos: "dedicated-apple-silicon", windows: "dedicated-windows-11-vm" }[platform],
      os: { linux: "Linux", macos: "macOS", windows: "Windows" }[platform], os_version: "11.0",
      architecture: platform === "macos" ? "ARM64" : "X64", dedicated: true, production_data: false,
    },
    runner: { name: `${platform}-runner`, labels: [platform === "linux" ? "ubuntu-latest" : `1helm-${platform}-phase4`], job: `accept-${platform}` },
    ...(platform === "windows" ? { continuity: {
      mode: "snapshot-assisted-equivalent", result: "passed", checked_at: checkedAt,
      summary: "Fixture continuity equivalent passed.",
    } } : {}),
    artifacts: PLATFORM_ARTIFACT_ROLES[platform].map((role) => artifactMap[role]),
    ...(platform === "macos" ? {} : { channel_image: channelImage }),
    checks: PLATFORM_CHECKS[platform].map((id) => ({ id, result: "passed", checked_at: checkedAt, summary: `${id} passed on fixture.` })),
    state_preservation: { result: "passed", checked_at: checkedAt, summary: "State retained byte identity.", before_sha256: marker, after_sha256: marker },
    recovery: { result: "passed", checked_at: checkedAt, summary: "Recovery completed safely.", before_sha256: marker, after_sha256: marker },
    notes: ["Fixture, not real hardware evidence."],
  };
}

test("all platform schemas normalize exact run, CI, machine, state, recovery, and artifact identity", () => {
  for (const platform of Object.keys(PLATFORM_CHECKS)) {
    const evidence = normalizePlatformEvidence(fixture(platform));
    assert.equal(evidence.result, "passed");
    assert.equal(evidence.candidate.run_id, runId);
    assert.equal(evidence.source_ci.run_id, ciRunId);
    assert.equal(evidence.machine.production_data, false);
    assert.deepEqual(platformEvidenceBlockers(evidence, { platform, commit, version, runId, runAttempt: "1", ciRunId, artifacts: artifactMap, channelImage }), []);
  }
});

test("normalization derives blocked/failed and never accepts aggregate pass with missing checks", () => {
  const missing = fixture("windows");
  missing.checks = missing.checks.slice(1);
  delete missing.result;
  const blocked = normalizePlatformEvidence(missing);
  assert.equal(blocked.result, "blocked");
  assert.equal(blocked.checks.find((item) => item.id === "non_elevated_install").result, "blocked");
  assert.throws(() => normalizePlatformEvidence({ ...missing, result: "passed" }), /aggregate result/);
  const failed = fixture("linux");
  failed.checks[0].result = "failed";
  delete failed.result;
  assert.equal(normalizePlatformEvidence(failed).result, "failed");
});

test("digest, byte count, CI run, state mismatch, and default runner label are blockers", () => {
  const evidence = normalizePlatformEvidence(fixture("linux"));
  evidence.artifacts[0].bytes += 1;
  evidence.source_ci.run_id = "100";
  evidence.state_preservation.after_sha256 = hash("changed");
  evidence.runner.labels = ["self-hosted"];
  const blockers = platformEvidenceBlockers(evidence, { platform: "linux", commit, version, runId, runAttempt: "1", ciRunId, artifacts: artifactMap, channelImage });
  assert.ok(blockers.some((item) => /CI identity/.test(item)));
  assert.ok(blockers.some((item) => /state preservation/.test(item)));
  assert.ok(blockers.some((item) => /runner label/.test(item)));
  assert.ok(blockers.some((item) => /linux_tgz/.test(item)));
  const wrongMachine = normalizePlatformEvidence(fixture("linux"));
  wrongMachine.machine.kind = "dedicated-fixture";
  assert.ok(platformEvidenceBlockers(wrongMachine, { platform: "linux", commit, version, runId, runAttempt: "1", ciRunId, artifacts: artifactMap, channelImage })
    .some((item) => /machine identity/.test(item)));
  const windows = normalizePlatformEvidence(fixture("windows"));
  delete windows.continuity;
  assert.ok(platformEvidenceBlockers(windows, { platform: "windows", commit, version, runId, runAttempt: "1", ciRunId, artifacts: artifactMap, channelImage })
    .some((item) => /snapshot-assisted/.test(item)));
});

test("workflow routes no PR/fork code, uses unique labels, fans acceptance out, and assembles only after all pass", () => {
  const workflow = read(".github/workflows/candidate.yml");
  assert.match(workflow, /workflow_run:[\s\S]*workflows: \[CI\][\s\S]*branches: \[main\]/);
  assert.doesNotMatch(workflow, /pull_request:/);
  assert.match(workflow, /head_repository\.full_name == github\.repository/);
  assert.match(workflow, /github\.event\.workflow_run\.event == 'push'/);
  assert.match(workflow, /runs-on: \[1helm-macos-phase4\]/);
  assert.match(workflow, /runs-on: \[1helm-windows-phase4\]/);
  assert.match(workflow, /accept-linux:[\s\S]*accept-macos:[\s\S]*accept-windows:/);
  assert.match(workflow, /needs: \[build, build-macos, deploy, accept-linux, accept-macos, accept-windows\]/);
  assert.match(workflow, /needs\.accept-linux\.result == 'success'[\s\S]*needs\.accept-macos\.result == 'success'[\s\S]*needs\.accept-windows\.result == 'success'/);
  assert.match(workflow, /vars\.HELM_PHASE4_MACOS_ENABLED == '1'/);
  assert.match(workflow, /vars\.HELM_PHASE4_WINDOWS_ENABLED == '1'/);
  assert.doesNotMatch(workflow, /runs-on: \[self-hosted/);
  assert.doesNotMatch(workflow, /secrets\./);
  assert.doesNotMatch(workflow, /pull_request_target|workflow_dispatch/);
  assert.doesNotMatch(workflow.match(/assemble-promotion:[\s\S]*?(?=\n  candidate-status:)/)?.[0] || "", /npm (ci|install|run build|run package)/);
  assert.match(workflow, /Upload exact Linux acceptance evidence\n        if: always\(\)/);
  // Both retained artifacts must be single-rooted under dist/ so consumers find
  // files at the download root, not nested under dist/ (the layout bug that
  // broke Linux, Windows, and Phase 2 candidate discovery in one run).
  const channelUpload = workflow.match(/- name: Retain immutable digest-addressed channel image candidate[\s\S]*?retention-days: 90/)?.[0] || "";
  assert.doesNotMatch(channelUpload, /container\//);
  assert.match(channelUpload, /dist\/1Helm-channel-machine-v1-\*\.oci\.tar/);
  const linuxAccept = read("ops/platform-acceptance/linux.sh");
  assert.match(linuxAccept, /RUNNER_ENVIRONMENT.*==.*"github-hosted"/);
  assert.match(linuxAccept, /1helm-standalone/);
  assert.match(linuxAccept, /refuses to run while port 8123 is already in use/);
  const macAccept = read("ops/platform-acceptance/macos.sh");
  assert.match(macAccept, /wait_for_setup_health/);
  assert.match(macAccept, /lsof[\s\S]*awk[\s\S]*\|\| true/);
  assert.doesNotMatch(macAccept, /print a\[length\(a\)\]; exit/);
  assert.match(workflow.match(/accept-macos:[\s\S]*?(?=\n  accept-windows:)/)?.[0] || "", /if: always\(\)[\s\S]*name: 1helm-macos-acceptance-/);
  assert.match(workflow.match(/accept-windows:[\s\S]*?(?=\n  assemble-promotion:)/)?.[0] || "", /if: always\(\)[\s\S]*name: 1helm-windows-acceptance-/);
});

test("an interrupted lane retains normalized blocked evidence before it can pass", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "1helm-phase4-pending-"));
  try {
    const manifest = join(scratch, "candidate.json");
    const output = join(scratch, "linux.json");
    writeFileSync(manifest, JSON.stringify({
      version, source: { commit }, ci: { workflow: "CI", run_id: ciRunId, conclusion: "success" },
      artifact: artifactMap.linux_tgz,
      offline_bundle: artifactMap.linux_offline_tgz,
      sealed_oci: channelImage,
    }));
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(process.execPath, [join(root, "scripts/pending-acceptance-evidence.mjs")], {
      encoding: "utf8",
      env: { ...process.env, HELM_ACCEPTANCE_PLATFORM: "linux", HELM_ACCEPTANCE_OUTPUT: output,
        HELM_ACCEPTANCE_STARTED_AT: "2026-08-04T13:00:00Z", HELM_CANDIDATE_MANIFEST: manifest,
        HELM_CANDIDATE_ARCHIVE: artifactMap.linux_tgz.name, HELM_PHASE4_RUNNER_LABEL: "ubuntu-latest",
        HELM_CANDIDATE_OFFLINE_ARCHIVE: artifactMap.linux_offline_tgz.name,
        GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: "1", GITHUB_JOB: "accept-linux",
        RUNNER_NAME: "GitHub Actions 1", RUNNER_OS: "Linux", RUNNER_ARCH: "X64" },
    });
    assert.equal(result.status, 0, result.stderr);
    const evidence = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(evidence.result, "blocked");
    assert.ok(evidence.checks.every((item) => item.result === "blocked"));
    assert.notDeepEqual(platformEvidenceBlockers(evidence, { platform: "linux", commit, version, runId, runAttempt: "1", ciRunId, artifacts: artifactMap, channelImage }), []);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test("native runner hooks structurally reject every event/job outside the exact trusted candidate lanes", () => {
  const hook = read("ops/platform-acceptance/runner-job-started.sh");
  const windowsHook = read("ops/platform-acceptance/runner-job-started.ps1");
  assert.match(hook, /GITHUB_REPOSITORY.*gitcommit90\/1Helm/);
  assert.match(hook, /GITHUB_WORKFLOW.*Candidate dress rehearsal/);
  assert.match(hook, /GITHUB_WORKFLOW_REF.*\.github\/workflows\/candidate\.yml@refs\/heads\/main/);
  assert.match(hook, /GITHUB_EVENT_NAME.*workflow_run/);
  assert.match(hook, /build-macos/);
  assert.match(hook, /accept-macos/);
  assert.match(hook, /run\.get\("event"\) == "push"/);
  assert.match(hook, /run\.get\("head_branch"\) == "main"/);
  assert.doesNotMatch(hook, /pull_request|NOPASSWD|sudo/);
  assert.match(windowsHook, /GITHUB_WORKFLOW_REF.*candidate\.yml@refs\/heads\/main/);
  assert.match(windowsHook, /GITHUB_EVENT_NAME.*workflow_run/);
  assert.match(windowsHook, /GITHUB_JOB.*accept-windows/);
  assert.match(windowsHook, /head_repository\.full_name/);
  assert.match(windowsHook, /head_sha.*GITHUB_SHA/);
  assert.doesNotMatch(windowsHook, /pull_request|NOPASSWD|sudo/);
});

test("matrix status reports disabled or missing machines as blockers, never skipped success", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "1helm-phase4-status-"));
  try {
    const output = join(scratch, "status.json");
    const previous = { ...process.env,
      GITHUB_RUN_ID: "123", HELM_CANDIDATE_COMMIT: commit, HELM_CANDIDATE_VERSION: version,
      HELM_LINUX_BUILD_RESULT: "success", HELM_MAC_BUILD_RESULT: "skipped",
      HELM_LINUX_REHEARSAL_RESULT: "success", HELM_PROMOTION_BUNDLE_RESULT: "skipped",
      HELM_LINUX_ACCEPTANCE_RESULT: "success", HELM_MAC_ACCEPTANCE_RESULT: "skipped",
      HELM_WINDOWS_ACCEPTANCE_RESULT: "skipped", HELM_CANDIDATE_STATUS_OUTPUT: output,
    };
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(process.execPath, [join(root, "scripts/candidate-matrix-status.mjs")], { env: previous, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const status = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(status.complete, false);
    assert.equal(status.platforms.macos.result, "blocked");
    assert.equal(status.platforms.windows.result, "blocked");
    assert.equal(status.stable_touched, false);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test("Windows code publishes no artifact/signing claim and requires honest reboot or snapshot-assisted provisioning evidence", () => {
  const workflow = read(".github/workflows/candidate.yml");
  const windows = read("ops/platform-acceptance/windows.ps1") + read("scripts/windows-acceptance-evidence.mjs");
  assert.doesNotMatch(workflow, /package:windows|windows[-_]artifact|setup\.exe/i);
  assert.match(windows, /provisioning-evidence\.json/);
  assert.match(windows, /snapshot-assisted-equivalent/);
  assert.match(windows, /snapshot_baseline/);
  assert.doesNotMatch(windows, /reboot-evidence\.json/);
  assert.match(windows, /apply-linux-release\.sh/);
  assert.match(windows, /function Assert-DistroVersion/);
  assert.equal((windows.match(/Assert-DistroVersion \$(?:Version|PreviousVersion)/g) || []).length, 4);
  assert.match(windows, /\/opt\/1helm\/node-current\/bin\/node/);
  assert.match(windows, /UTF8Encoding\(\$false\)/);
  assert.match(windows, /\[IO\.File\]::WriteAllText/);
  assert.match(windows, /\/bin\/bash -lc "bash '\$scriptInDistro'"/);
  assert.doesNotMatch(windows, /\$Command \| & \$Wsl/);
  assert.doesNotMatch(windows, /\/bin\/bash -lc \$Command/);
  assert.doesNotMatch(windows, /Invoke-Distro "test .*systemctl/);
  assert.match(windows, /LocalRootfs/);
  assert.match(read("site/public/install.ps1"), /LocalRootfsSha256/);
  assert.match(windows, /no distinct prior Stable release/);
  assert.match(windows, /unrelated WSL control/);
  assert.match(windows, /Windows publishes no artifact and has no signing claim/);
  assert.match(read("ops/platform-acceptance/macos.sh"), /acceptance residue before this job/);
});
