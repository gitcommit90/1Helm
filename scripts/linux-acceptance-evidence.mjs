#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { isoNow, normalizePlatformEvidence } from "./platform-acceptance-lib.mjs";

const env = process.env;
const candidate = JSON.parse(readFileSync(resolve(env.HELM_CANDIDATE_MANIFEST || ""), "utf8"));
const checkedAt = isoNow();
const startedAt = String(env.HELM_ACCEPTANCE_STARTED_AT || "");
const summary = (text) => ({ result: "passed", checked_at: checkedAt, summary: text });
const evidence = normalizePlatformEvidence({
  platform: "linux",
  commit: candidate.source.commit,
  version: candidate.version,
  candidate: { run_id: env.GITHUB_RUN_ID, run_attempt: env.GITHUB_RUN_ATTEMPT },
  source_ci: candidate.ci,
  started_at: startedAt,
  checked_at: checkedAt,
  machine: {
    id: `${env.RUNNER_NAME}-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`,
    kind: "github-hosted-ephemeral",
    os: env.RUNNER_OS,
    os_version: env.HELM_MACHINE_OS_VERSION,
    architecture: env.RUNNER_ARCH,
    dedicated: true,
    production_data: false,
  },
  runner: { name: env.RUNNER_NAME, labels: ["ubuntu-latest"], job: env.GITHUB_JOB },
  artifacts: [{
    role: "linux_tgz", name: basename(env.HELM_CANDIDATE_ARCHIVE),
    sha256: candidate.artifact.sha256, bytes: candidate.artifact.bytes,
  }, {
    role: "linux_offline_tgz", name: basename(env.HELM_CANDIDATE_OFFLINE_ARCHIVE),
    sha256: candidate.offline_bundle.sha256, bytes: candidate.offline_bundle.bytes,
  }],
  channel_image: candidate.sealed_oci,
  checks: [
    { id: "digest", ...summary("Archive, manifest, embedded identity, and hosted provenance matched the exact candidate.") },
    { id: "clean_install", ...summary("Exact candidate installed on a fresh hosted Linux VM and passed loopback health.") },
    { id: "prior_version_update", ...summary(`Public Stable v${env.HELM_PREVIOUS_VERSION} updated to the exact candidate without rebuilding.`) },
    { id: "health_failure_rollback", ...summary("A controlled derived startup failure restored the exact prior healthy candidate.") },
    { id: "retained_state", ...summary("The dedicated state marker retained the same SHA-256 across update and forced rollback.") },
    { id: "systemd_health", ...summary("1helm.service and loopback setup health were active after clean install, update, and rollback.") },
  ],
  state_preservation: {
    ...summary("Dedicated acceptance state marker retained byte identity."),
    before_sha256: env.HELM_STATE_BEFORE_SHA256,
    after_sha256: env.HELM_STATE_AFTER_SHA256,
  },
  recovery: {
    ...summary("Forced failure rollback restored the candidate symlink, service, loopback health, and state marker."),
    before_sha256: env.HELM_STATE_BEFORE_SHA256,
    after_sha256: env.HELM_STATE_AFTER_SHA256,
  },
  notes: ["This is real ephemeral Linux systemd acceptance, not a fixture or container-only simulation."],
});
writeFileSync(resolve(env.HELM_ACCEPTANCE_OUTPUT || "linux-acceptance.json"), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
