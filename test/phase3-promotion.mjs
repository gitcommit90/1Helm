import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { confirmationText, validatePromotionBundle } from "../scripts/promotion-lib.mjs";
import { assertRemoteVersionAbsent } from "../scripts/github-promotion-gates.mjs";

const root = join(import.meta.dirname, "..");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const commit = "a".repeat(40);
const version = "9.8.7";
const runId = "12345";
const artifactId = "67890";

function createBundle() {
  const bundle = mkdtempSync(join(tmpdir(), "1helm-phase3-"));
  const write = (name, value) => {
    const content = typeof value === "string" || Buffer.isBuffer(value) ? value : `${JSON.stringify(value, null, 2)}\n`;
    writeFileSync(join(bundle, name), content);
    return { path: name, sha256: sha(content) };
  };
  const oci = Buffer.from("sealed-oci-phase3");
  const identity = {
    schema: 1, kind: "1helm-dress-rehearsal-candidate", repository: "gitcommit90/1Helm", ref: "refs/heads/main",
    commit, source_state: "trusted-main", build_identity: "candidate-111-12345.1", created_at: "2026-08-04T12:00:00Z",
    ci: { workflow: "CI", run_id: "111", conclusion: "success" }, version,
    source_archive_sha256: "b".repeat(64), sealed_oci_sha256: sha(oci),
  };
  const stage = join(bundle, "stage", `1Helm-${version}`);
  mkdirSync(join(stage, "resources"), { recursive: true });
  mkdirSync(join(stage, "container"), { recursive: true });
  writeFileSync(join(stage, "resources", "candidate-build.json"), JSON.stringify(identity));
  writeFileSync(join(stage, "package.json"), JSON.stringify({ version }));
  writeFileSync(join(stage, "container", "channel-machine.oci.tar"), oci);
  const linuxName = `1Helm-${version}-linux-node.tgz`;
  execFileSync("tar", ["-czf", join(bundle, linuxName), "-C", join(bundle, "stage"), `1Helm-${version}`]);
  const linuxBytes = readFileSync(join(bundle, linuxName));
  const linux = { role: "linux_tgz", name: linuxName, path: linuxName, sha256: sha(linuxBytes), bytes: linuxBytes.length };
  const macDmgBytes = Buffer.from("exact retained signed notarized DMG bytes");
  const macZipBytes = Buffer.from("exact retained signed notarized updater bytes");
  const artifact = (role, name, bytes) => {
    writeFileSync(join(bundle, name), bytes);
    return { role, name, path: name, sha256: sha(bytes), bytes: bytes.length };
  };
  const macDmg = artifact("mac_dmg", `1Helm-${version}-arm64.dmg`, macDmgBytes);
  const macZip = artifact("mac_updater_zip", `1Helm-${version}-mac-arm64.zip`, macZipBytes);
  const provenance = (item, extra) => write(`${item.role}-provenance.json`, {
    schema: 1, kind: "1helm-artifact-provenance", repository: "gitcommit90/1Helm", ref: "refs/heads/main", commit,
    version, candidate_workflow_run_id: runId, source_ci_run_id: "111",
    artifact: { role: item.role, name: item.name, sha256: item.sha256, bytes: item.bytes }, ...extra,
  });
  macDmg.provenance = provenance(macDmg, { builder: "dedicated-macos", signer_workflow: "gitcommit90/1Helm/.github/workflows/candidate.yml", signing: "developer-id", notarization: "accepted", stapling: "validated", gatekeeper: "accepted" });
  macZip.provenance = provenance(macZip, { builder: "dedicated-macos", signer_workflow: "gitcommit90/1Helm/.github/workflows/candidate.yml", signing: "developer-id", notarization: "accepted", stapling: "validated", gatekeeper: "accepted" });
  linux.provenance = provenance(linux, { builder: "github-hosted", attestation_created: true, signer_workflow: "gitcommit90/1Helm/.github/workflows/candidate.yml" });
  const candidateManifest = {
    schema: 1, kind: "1helm-dress-rehearsal-candidate",
    source: { repository: "gitcommit90/1Helm", ref: "refs/heads/main", commit, state: "trusted-main", source_archive_sha256: identity.source_archive_sha256 },
    version, build: { identity: identity.build_identity, created_at: identity.created_at }, ci: identity.ci,
    artifact: { name: linux.name, sha256: linux.sha256, bytes: linux.bytes }, sealed_oci: { sha256: identity.sealed_oci_sha256 },
  };
  const candidateRecord = write("candidate.json", candidateManifest);
  const macCandidateRecord = write("mac-candidate.json", {
    schema: 1, kind: "1helm-macos-candidate", repository: "gitcommit90/1Helm", ref: "refs/heads/main", commit, version,
    candidate: { workflow: "Candidate dress rehearsal", workflow_path: ".github/workflows/candidate.yml", event: "workflow_run", run_id: runId, run_attempt: "1" },
    source_ci: { workflow: "CI", run_id: "111", conclusion: "success" },
    builder: { type: "dedicated-self-hosted", runner_name: "macos-fixture-runner", runner_label: "1helm-macos-phase4", os: "macOS", architecture: "ARM64" },
    signing: { identity: "developer-id-application", notarization: "accepted", stapling: "validated", gatekeeper: "accepted", checked_at: "2026-08-04T13:00:00Z" },
    artifacts: [macDmg, macZip].map(({ role, name, sha256, bytes }) => ({ role, name, sha256, bytes })),
  });
  const workflowRecord = write("trusted-candidate-workflow.json", {
    id: Number(runId), name: "Candidate dress rehearsal", path: ".github/workflows/candidate.yml", event: "workflow_run",
    status: "completed", conclusion: "success", run_attempt: 1, head_branch: "main", head_sha: commit, head_repository: { full_name: "gitcommit90/1Helm" },
  });
  const ciRecord = write("trusted-candidate-ci.json", {
    id: 111, name: "CI", path: ".github/workflows/ci.yml", event: "push", status: "completed", conclusion: "success",
    head_branch: "main", head_sha: commit, head_repository: { full_name: "gitcommit90/1Helm" },
  });
  const artifactRecord = write("trusted-candidate-artifact.json", {
    id: Number(artifactId), name: `1helm-promotion-candidate-${commit}`, expired: false, workflow_run: { id: Number(runId) },
  });
  const rehearsal = write("dress-rehearsal.json", {
    schema: 1, kind: "1helm-dress-rehearsal-status",
    running_candidate: { commit, digest: linux.sha256, version, build_identity: identity.build_identity, ci: identity.ci },
    last_attempt: { commit, digest: linux.sha256, version, build_identity: identity.build_identity, ci: identity.ci },
    install: { result: "healthy", health: "healthy", checked_at: "2026-08-04T13:00:00Z" },
  });
  const checkIds = {
    macos: ["signature", "notarization", "staple", "gatekeeper", "clean_install", "prior_version_update", "retained_state", "loopback", "version"],
    linux: ["digest", "clean_install", "prior_version_update", "health_failure_rollback", "retained_state", "systemd_health"],
    windows: ["non_elevated_install", "single_uac", "restart_resume", "keepalive_reboot", "onboarding", "prior_version_update", "retained_state", "uninstall_safety"],
  };
  const acceptanceArtifacts = { macos: [macDmg, macZip], linux: [linux], windows: [linux] };
  const acceptance = {};
  for (const platform of Object.keys(checkIds)) {
    const marker = sha(`${platform}-retained-state`);
    acceptance[platform] = write(`${platform}-acceptance.json`, {
      schema: 1, kind: "1helm-platform-acceptance", platform, repository: "gitcommit90/1Helm", ref: "refs/heads/main", commit, version,
      result: "passed", started_at: "2026-08-04T13:30:00Z", checked_at: "2026-08-04T14:00:00Z",
      candidate: { workflow: "Candidate dress rehearsal", workflow_path: ".github/workflows/candidate.yml", event: "workflow_run", run_id: runId, run_attempt: "1" },
      source_ci: { workflow: "CI", run_id: "111", conclusion: "success" },
      machine: {
        id: `${platform}-fixture-machine`, kind: { linux: "github-hosted-ephemeral", macos: "dedicated-apple-silicon", windows: "dedicated-windows-11-vm" }[platform],
        os: { linux: "Linux", macos: "macOS", windows: "Windows" }[platform], os_version: "fixture-1",
        architecture: platform === "macos" ? "ARM64" : "X64", dedicated: true, production_data: false,
      },
      runner: { name: `${platform}-fixture-runner`, labels: [platform === "linux" ? "ubuntu-latest" : `1helm-${platform}-phase4`], job: `accept-${platform}` },
      ...(platform === "windows" ? { continuity: {
        mode: "snapshot-assisted-equivalent", result: "passed", checked_at: "2026-08-04T14:00:00Z",
        summary: "Fixture continuity equivalent passed.",
      } } : {}),
      checks: checkIds[platform].map((id) => ({ id, result: "passed", checked_at: "2026-08-04T14:00:00Z", summary: `${id} fixture passed.` })),
      artifacts: acceptanceArtifacts[platform].map(({ role, name, sha256, bytes }) => ({ role, name, sha256, bytes })),
      state_preservation: { result: "passed", checked_at: "2026-08-04T14:00:00Z", summary: "Fixture state retained byte identity.", before_sha256: marker, after_sha256: marker },
      recovery: { result: "passed", checked_at: "2026-08-04T14:00:00Z", summary: "Fixture recovery completed.", before_sha256: marker, after_sha256: marker },
      notes: ["Promotion integration fixture only."],
    });
  }
  const packageRecord = write("package.json", { version });
  const changelog = write("authored-changelog.md", `## [${version}] - 2026-08-04\n\n### Added\n\n- Promotion fixture.\n`);
  const acceptanceContent = write("acceptance.md", "1. Exact candidate bytes passed all retained platform gates.\n");
  const promotion = {
    schema: 1, kind: "1helm-stable-promotion-candidate", repository: "gitcommit90/1Helm", ref: "refs/heads/main", commit, version,
    acceptance_ledger_required: true,
    candidate: { workflow_run_id: runId, artifact_id: artifactId, artifact_name: `1helm-promotion-candidate-${commit}` },
    records: { candidate_manifest: candidateRecord, mac_candidate_manifest: macCandidateRecord, candidate_workflow: workflowRecord, candidate_ci: ciRecord, candidate_artifact: artifactRecord, dress_rehearsal: rehearsal, acceptance, package: packageRecord, changelog, acceptance_content: acceptanceContent },
    artifacts: [macDmg, macZip, linux],
  };
  writeFileSync(join(bundle, "promotion.json"), `${JSON.stringify(promotion, null, 2)}\n`);
  rmSync(join(bundle, "stage"), { recursive: true, force: true });
  return bundle;
}

const options = (bundle, overrides = {}) => ({
  bundleDir: bundle, version, runId, artifactId, mainCommit: commit, mainContainsCandidate: true,
  tagAbsent: true, releaseAbsent: true, linuxAttestationVerified: true, promotedAt: "2026-08-04T15:00:00Z", ...overrides,
});

test("complete retained evidence is eligible and generated output names only exact candidate bytes", () => {
  const bundle = createBundle();
  try {
    const report = validatePromotionBundle(options(bundle));
    assert.equal(report.eligible, true, report.blockers.join("\n"));
    assert.equal(report.stable_touched, false);
    assert.equal(report.stable_manifest.artifacts.length, 3);
    assert.deepEqual(report.stable_manifest.artifacts.map(({ sha256 }) => sha256), report.artifacts.map(({ sha256 }) => sha256));
    assert.match(report.release_notes, /Authored changelog/);
    assert.doesNotMatch(report.release_notes, /generated notes/i);
  } finally { rmSync(bundle, { recursive: true, force: true }); }
});

test("missing and mismatched evidence fail closed", () => {
  const bundle = createBundle();
  try {
    const promotionPath = join(bundle, "promotion.json");
    const promotion = JSON.parse(readFileSync(promotionPath, "utf8"));
    delete promotion.records.acceptance.windows;
    writeFileSync(promotionPath, JSON.stringify(promotion));
    let report = validatePromotionBundle(options(bundle));
    assert.equal(report.eligible, false);
    assert.ok(report.blockers.some((item) => /windows acceptance.*missing/.test(item)));
    writeFileSync(join(bundle, `1Helm-${version}-arm64.dmg`), "changed bytes");
    report = validatePromotionBundle(options(bundle));
    assert.ok(report.blockers.some((item) => /mac_dmg artifact: exact-byte SHA-256 mismatch/.test(item)));
  } finally { rmSync(bundle, { recursive: true, force: true }); }
});

test("metacharacters in the version input are compared literally without regex construction", () => {
  const bundle = createBundle();
  try {
    let report;
    assert.doesNotThrow(() => { report = validatePromotionBundle(options(bundle, { version: "9.8.7(" })); });
    assert.equal(report.eligible, false);
    assert.ok(report.blockers.includes("intended version is not three-part semantic versioning"));
    assert.ok(report.blockers.includes("authored changelog: named version section is missing"));
  } finally { rmSync(bundle, { recursive: true, force: true }); }
});

test("existing or unproven tag and release absence are blockers", () => {
  const bundle = createBundle();
  try {
    const report = validatePromotionBundle(options(bundle, { tagAbsent: false, releaseAbsent: false }));
    assert.equal(report.eligible, false);
    assert.ok(report.blockers.some((item) => /tag v9\.8\.7 already exists/.test(item)));
    assert.ok(report.blockers.some((item) => /release v9\.8\.7 already exists/.test(item)));
  } finally { rmSync(bundle, { recursive: true, force: true }); }
});

test("remote tag/release gates distinguish absence from API failure", async () => {
  const responses = (statuses) => async () => {
    const status = statuses.shift();
    return { ok: status >= 200 && status < 300, status, json: async () => ({ protection_rules: [{ type: "required_reviewers", reviewers: [{ reviewer: { login: "owner" } }] }] }) };
  };
  await assertRemoteVersionAbsent(version, "fixture-token", responses([404, 404]));
  await assert.rejects(assertRemoteVersionAbsent(version, "fixture-token", responses([500])), /Could not prove tag.*absent/);
  await assert.rejects(assertRemoteVersionAbsent(version, "fixture-token", responses([200])), /tag v9\.8\.7 already exists/);
});

test("the owner command reports dry-run eligibility, platform evidence, blockers, and Stable state", () => {
  const bundle = createBundle();
  try {
    const result = spawnSync(process.execPath, ["scripts/promotion-status.mjs", "--bundle", bundle, "--version", version, "--candidate-run", runId, "--candidate-artifact", artifactId], {
      cwd: root, encoding: "utf8", env: { ...process.env, HELM_PROMOTION_MAIN_COMMIT: commit, HELM_PROMOTION_MAIN_CONTAINS_CANDIDATE: "1", HELM_PROMOTION_TAG_ABSENT: "1", HELM_PROMOTION_RELEASE_ABSENT: "1", HELM_PROMOTION_LINUX_ATTESTATION_VERIFIED: "1", HELM_PROMOTION_TIME: "2026-08-04T15:00:00Z" },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Candidate: workflow run 12345, artifact 67890/);
    assert.match(result.stdout, /Dress rehearsal: healthy \/ healthy/);
    assert.match(result.stdout, /macOS passed; Linux passed; Windows passed/);
    assert.match(result.stdout, /Dry-run eligibility: ELIGIBLE/);
    assert.match(result.stdout, /Owner confirmation.*PROMOTE EXACT CANDIDATE v9\.8\.7 RUN 12345 ARTIFACT 67890/);
    assert.match(result.stdout, /Stable touched: NO/);
  } finally { rmSync(bundle, { recursive: true, force: true }); }
});

test("publication helper refuses before running git or gh without every explicit gate", () => {
  const scratch = mkdtempSync(join(tmpdir(), "1helm-publish-refusal-"));
  try {
    const bin = join(scratch, "bin"); mkdirSync(bin);
    for (const name of ["git", "gh"]) {
      const path = join(bin, name); writeFileSync(path, `#!/bin/sh\nprintf called >> ${join(scratch, "called")}\n\nexit 99\n`); chmodSync(path, 0o755);
    }
    const result = spawnSync(process.execPath, ["scripts/publish-promotion.mjs"], {
      cwd: root, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HELM_PROMOTION_BUNDLE: scratch, HELM_PROMOTION_MODE: "publish", HELM_PROMOTION_VERSION: version, HELM_PROMOTION_RUN_ID: runId, HELM_PROMOTION_ARTIFACT_ID: artifactId, HELM_PROMOTION_CONFIRMATION: "wrong" },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /exact owner confirmation/);
    assert.throws(() => readFileSync(join(scratch, "called")));
    assert.equal(confirmationText(version, runId, artifactId), "PROMOTE EXACT CANDIDATE v9.8.7 RUN 12345 ARTIFACT 67890");
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test("workflow is manual-only, permission-separated, environment-gated, and contains no build step", () => {
  const workflow = readFileSync(join(root, ".github/workflows/promote-stable.yml"), "utf8");
  assert.match(workflow, /on:\n  workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n  (push|pull_request|workflow_run):/);
  assert.match(workflow, /verify:[\s\S]*permissions:\n      contents: read\n      actions: read/);
  assert.match(workflow, /publish:[\s\S]*environment: Stable publication[\s\S]*contents: write/);
  assert.match(workflow, /inputs\.mode == 'publish'/);
  assert.match(workflow, /inputs\.confirmation == needs\.verify\.outputs\.confirmation/);
  assert.match(workflow, /STABLE_PUBLICATION_ENABLED/);
  assert.match(workflow, /github-promotion-gates\.mjs version-absent/);
  assert.match(readFileSync(join(root, "scripts", "publish-promotion.mjs"), "utf8"), /PROTECTED STABLE ENVIRONMENT ENABLED/);
  assert.doesNotMatch(workflow, /npm (ci|install|run build|run package)|package:(mac|linux|dmg)/);
  assert.doesNotMatch(readFileSync(join(root, "scripts/publish-promotion.mjs"), "utf8"), /npm|package-linux|package-mac/);
  assert.match(readFileSync(join(root, "scripts/publish-promotion.mjs"), "utf8"), /"--draft"[\s\S]*Draft Release bytes[\s\S]*"--draft=false"/);
});
