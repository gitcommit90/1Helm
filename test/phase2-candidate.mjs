import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { candidateIdentityFromArchive, createCandidateManifest } from "../scripts/candidate-manifest.mjs";

const root = join(import.meta.dirname, "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const sha = (value) => createHash("sha256").update(value).digest("hex");

function fixture() {
  const scratch = mkdtempSync(join(tmpdir(), "1helm-phase2-"));
  const prefix = join(scratch, "source", "1Helm-0.0.41");
  const oci = Buffer.from("sealed OCI fixture");
  const imageDigest = sha(oci);
  const imageName = `1Helm-channel-machine-v1-amd64-${imageDigest}.oci.tar`;
  const imageTag = `channel-image-v1-amd64-${imageDigest}`;
  const image = {
    schema: 1, kind: "1helm-sealed-channel-image", version: "1", architecture: "amd64", sha256: imageDigest, bytes: oci.length,
    artifact: { name: imageName, url: `https://github.com/gitcommit90/1Helm/releases/download/${imageTag}/${imageName}`,
      manifest_url: `https://github.com/gitcommit90/1Helm/releases/download/${imageTag}/${imageName.replace(/\.oci\.tar$/, ".json")}` },
    inputs: { containerfile_sha256: "1".repeat(64), context_sha256: "2".repeat(64), base_image_digest: "3".repeat(64) },
    cache: { key: "4".repeat(64), reused: false }, platforms: ["linux", "windows-wsl"],
  };
  const identity = {
    schema: 1,
    kind: "1helm-dress-rehearsal-candidate",
    repository: "gitcommit90/1Helm",
    ref: "refs/heads/main",
    commit: "a".repeat(40),
    source_state: "trusted-main",
    build_identity: "candidate-123-456.1",
    created_at: "2026-08-04T12:00:00Z",
    ci: { workflow: "CI", run_id: "123", conclusion: "success" },
    version: "0.0.41",
    source_archive_sha256: "b".repeat(64),
    sealed_oci_sha256: sha(oci), sealed_oci_cache: { ...image.cache, reused: true }, channel_image: image,
  };
  mkdirSync(join(prefix, "resources"), { recursive: true });
  mkdirSync(join(prefix, "container"), { recursive: true });
  writeFileSync(join(prefix, "resources", "candidate-build.json"), JSON.stringify(identity));
  writeFileSync(join(prefix, "package.json"), JSON.stringify({ version: identity.version }));
  writeFileSync(join(prefix, "resources", "channel-image.json"), JSON.stringify(image));
  const archive = join(scratch, "1Helm-0.0.41-linux-node.tgz");
  execFileSync("tar", ["-czf", archive, "-C", join(scratch, "source"), "1Helm-0.0.41"]);
  const offlinePrefix = join(scratch, "offline", "1Helm-0.0.41");
  mkdirSync(join(scratch, "offline"), { recursive: true });
  execFileSync("cp", ["-a", prefix, offlinePrefix]);
  mkdirSync(join(offlinePrefix, "container"), { recursive: true });
  writeFileSync(join(offlinePrefix, "container", "channel-machine.oci.tar"), oci);
  const offline = join(scratch, "1Helm-0.0.41-linux-node-offline.tgz");
  execFileSync("tar", ["-czf", offline, "-C", join(scratch, "offline"), "1Helm-0.0.41"]);
  const split = join(scratch, "split.json");
  writeFileSync(split, JSON.stringify({ schema: 1, kind: "1helm-linux-split-artifacts", version: identity.version,
    app: { name: "1Helm-0.0.41-linux-node.tgz", sha256: sha(readFileSync(archive)), bytes: readFileSync(archive).length, contains_channel_image: false },
    offline: { name: "1Helm-0.0.41-linux-node-offline.tgz", sha256: sha(readFileSync(offline)), bytes: readFileSync(offline).length, contains_channel_image: true },
    channel_image: image, production_dependencies: { key: "5".repeat(64), reused: false },
  }));
  return { scratch, archive, offline, split, identity };
}

test("candidate manifest binds the outer digest to the embedded trusted-main identity", () => {
  const item = fixture();
  try {
    assert.deepEqual(candidateIdentityFromArchive(item.archive), item.identity);
    const output = join(item.scratch, "candidate.json");
    const manifest = createCandidateManifest({ archivePath: item.archive, offlinePath: item.offline, splitPath: item.split, outputPath: output });
    assert.equal(manifest.source.commit, item.identity.commit);
    assert.equal(manifest.source.ref, "refs/heads/main");
    assert.equal(manifest.ci.conclusion, "success");
    assert.equal(manifest.sealed_oci.sha256, item.identity.sealed_oci_sha256);
    assert.equal(manifest.artifact.sha256, sha(readFileSync(item.archive)));
  } finally { rmSync(item.scratch, { recursive: true, force: true }); }
});

test("root boundary rejects digest, source, and sealed OCI mismatches", () => {
  const item = fixture();
  try {
    const manifestPath = join(item.scratch, "candidate.json");
    createCandidateManifest({ archivePath: item.archive, offlinePath: item.offline, splitPath: item.split, outputPath: manifestPath });
    const validator = join(root, "ops", "dress-rehearsal", "candidate-boundary.py");
    const output = join(item.scratch, "verified.json");
    execFileSync("python3", [validator, "validate", manifestPath, item.archive, item.offline, output]);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.source.commit = "c".repeat(40);
    writeFileSync(manifestPath, JSON.stringify(manifest));
    let failed = spawnSync("python3", [validator, "validate", manifestPath, item.archive, item.offline, output], { encoding: "utf8" });
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /embedded candidate commit mismatch/);
    manifest.source.commit = item.identity.commit;
    manifest.artifact.sha256 = "d".repeat(64);
    writeFileSync(manifestPath, JSON.stringify(manifest));
    failed = spawnSync("python3", [validator, "validate", manifestPath, item.archive, item.offline, output], { encoding: "utf8" });
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /archive SHA-256 mismatch/);
  } finally { rmSync(item.scratch, { recursive: true, force: true }); }
});

test("rollback fixtures remain local-only and cannot satisfy normal candidate validation", () => {
  const item = fixture();
  try {
    const source = join(item.scratch, "source", "1Helm-0.0.41", "resources", "candidate-build.json");
    const identity = JSON.parse(readFileSync(source, "utf8"));
    identity.source_state = "rollback-fixture";
    identity.ci = { workflow: "local", run_id: "0", conclusion: "not_run" };
    writeFileSync(source, JSON.stringify(identity));
    execFileSync("tar", ["-czf", item.archive, "-C", join(item.scratch, "source"), "1Helm-0.0.41"]);
    assert.throws(() => candidateIdentityFromArchive(item.archive), /not trusted main/);
    assert.equal(candidateIdentityFromArchive(item.archive, { allowLocal: true }).source_state, "rollback-fixture");
  } finally { rmSync(item.scratch, { recursive: true, force: true }); }
});

test("candidate workflow and guest boundary exclude PR code and broad root access", () => {
  const workflow = read(".github/workflows/candidate.yml");
  const candidateUpload = workflow.match(/- name: Upload exact candidate and evidence[\s\S]*?retention-days: 30/)?.[0] || "";
  const helper = read("ops/dress-rehearsal/1helm-candidate-install");
  const hook = read("ops/dress-rehearsal/runner-job-started.sh");
  const sudoersExample = "%actions ALL=(root) NOPASSWD: /usr/local/sbin/1helm-candidate-install \"\"\n";
  assert.match(workflow, /workflow_run:[\s\S]*workflows: \[CI\][\s\S]*branches: \[main\]/);
  assert.match(workflow, /workflow_run\.event == 'push'/);
  assert.match(workflow, /head_repository\.full_name == github\.repository/);
  assert.match(workflow, /runs-on: \[1helm-dress-rehearsal-phase2\]/);
  assert.match(workflow, /Clear retained runner workspace[\s\S]*rm -rf -- candidate-download candidate-result[\s\S]*Download this workflow's exact candidate/);
  assert.match(workflow, /github\.sha == github\.event\.workflow_run\.head_sha/);
  assert.match(workflow, /attest-build-provenance@[a-f0-9]{40}/);
  assert.match(workflow, /candidate-download\/candidate-evidence\/candidate\.json/);
  assert.match(workflow, /candidate-download\/candidate-evidence\/provenance\.bundle\.json/);
  assert.match(candidateUpload, /dist\/1Helm-\*-linux-node\.tgz/);
  assert.match(candidateUpload, /dist\/candidate-evidence\/candidate\.json/);
  assert.doesNotMatch(candidateUpload, /container\/channel-machine\.oci\.json/);
  assert.match(helper, /--signer-workflow gitcommit90\/1Helm\/\.github\/workflows\/candidate\.yml/);
  assert.match(helper, /--source-ref refs\/heads\/main/);
  assert.match(helper, /--source-digest "\$commit"/);
  assert.match(helper, /--deny-self-hosted-runners/);
  assert.match(helper, /local-proof-authorized/);
  assert.doesNotMatch(helper, /--local-proof/);
  assert.match(helper, /awk -F\/.*!found.*found=1/, "large archive inspection consumes tar output instead of causing SIGPIPE under pipefail");
  assert.match(helper, /actions\\\.runner[\s\S]*systemd-run[\s\S]*\/usr\/local\/sbin\/1helm-candidate-install/);
  assert.match(helper, /^unlink "\$INBOX\/candidate\.json"$/m);
  assert.match(helper, /^unlink "\$INBOX\/candidate\.tgz"$/m);
  assert.doesNotMatch(helper, /unlink "\$INBOX\/candidate\.json" "\$INBOX\/candidate\.tgz"/);
  assert.match(read("ops/dress-rehearsal/runner.service.override.conf"), /ProtectSystem=strict[\s\S]*ReadWritePaths=.*candidate\/inbox/);
  assert.match(read("ops/dress-rehearsal/runner.service.override.conf"), /ACTIONS_RUNNER_HOOK_JOB_STARTED=\/usr\/local\/lib\/1helm-candidate\/runner-job-started\.sh/);
  assert.match(hook, /GITHUB_EVENT_NAME.*workflow_run/);
  assert.match(hook, /run\.get\("event"\) == "push"/);
  assert.doesNotMatch(sudoersExample, /NOPASSWD:\s*ALL/);
  assert.doesNotMatch(workflow, /pull_request:/);
});

test("candidate status evidence names running, previous, CI, install, and rollback fields", () => {
  const boundary = read("ops/dress-rehearsal/candidate-boundary.py");
  for (const field of ["running_candidate", "last_attempt", "previous_candidate", "install", "rollback", "last_rollback", "checked_at"]) {
    assert.match(boundary, new RegExp(`["]${field}["]`));
  }
  assert.match(read("docs/dress-rehearsal.md"), /Teardown and rollback/);
  assert.match(read("scripts/delivery-status-lib.mjs"), /Private dress-rehearsal candidate/);
});

test("a healthy reinstall preserves the latest proven rollback evidence", () => {
  const boundary = read("ops/dress-rehearsal/candidate-boundary.py");
  assert.match(boundary, /previous\.get\("last_rollback"\) or previous\.get\("rollback"\)/);
  assert.match(boundary, /previous_rollback\.get\("result"\) == "healthy"/);
});
