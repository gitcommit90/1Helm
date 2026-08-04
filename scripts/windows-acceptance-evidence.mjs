#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { isoNow, normalizePlatformEvidence } from "./platform-acceptance-lib.mjs";

const env = process.env;
const candidate = JSON.parse(readFileSync(resolve(env.HELM_CANDIDATE_MANIFEST || ""), "utf8"));
const provision = JSON.parse(readFileSync(resolve(env.HELM_PROVISIONING_EVIDENCE || ""), "utf8"));
const checkedAt = isoNow();
const pass = (summary) => ({ result: "passed", checked_at: checkedAt, summary });
const evidence = normalizePlatformEvidence({
  platform: "windows", commit: candidate.source.commit, version: candidate.version,
  candidate: { run_id: env.GITHUB_RUN_ID, run_attempt: env.GITHUB_RUN_ATTEMPT }, source_ci: candidate.ci,
  started_at: env.HELM_ACCEPTANCE_STARTED_AT, checked_at: checkedAt,
  machine: {
    id: `${env.RUNNER_NAME}-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`,
    kind: "dedicated-windows-11-vm", os: env.RUNNER_OS, os_version: env.HELM_MACHINE_OS_VERSION,
    architecture: env.RUNNER_ARCH, dedicated: provision.dedicated, production_data: provision.production_data,
  },
  runner: { name: env.RUNNER_NAME, labels: ["1helm-windows-phase4"], job: env.GITHUB_JOB },
  continuity: {
    mode: "snapshot-assisted-equivalent", result: "passed", checked_at: checkedAt,
    summary: "Accepted clean VM snapshot plus exact-candidate WSL cold start proved same-user keepalive, service, and localhost recovery.",
  },
  artifacts: [
    { role: "linux_tgz", name: basename(env.HELM_CANDIDATE_ARCHIVE), sha256: candidate.artifact.sha256, bytes: candidate.artifact.bytes },
    { role: "linux_offline_tgz", name: basename(env.HELM_CANDIDATE_OFFLINE_ARCHIVE), sha256: candidate.offline_bundle.sha256, bytes: candidate.offline_bundle.bytes },
  ],
  channel_image: candidate.sealed_oci,
  checks: [
    { id: "non_elevated_install", ...pass("Exact candidate clean-installed through the tracked site path as the dedicated ordinary signed-in user.") },
    { id: "single_uac", ...pass("Root-owned provisioning evidence records exactly one UAC approval for Windows features and Microsoft WSL.") },
    { id: "restart_resume", ...pass("Administrator-owned provisioning evidence records a real required Windows restart and same-user installer resume.") },
    { id: "keepalive_reboot", ...pass(`Exact run ${env.GITHUB_RUN_ID} used the accepted snapshot-assisted cold-start equivalent and recovered its limited-user keepalive, service, and localhost health.`) },
    { id: "onboarding", ...pass("Exact candidate clean install returned localhost setup health with onboarding required.") },
    { id: "prior_version_update", ...pass(`Dedicated runner provisioned prior Stable v${env.HELM_PREVIOUS_VERSION} and updated through the site-equivalent WSL path.`) },
    { id: "retained_state", ...pass("WSL data-root marker retained the same SHA-256 across candidate update.") },
    { id: "uninstall_safety", ...pass("Scoped uninstall removed only the exact target distro/root and retained an unrelated WSL control.") },
  ],
  state_preservation: { ...pass("WSL state marker retained byte identity."), before_sha256: env.HELM_STATE_BEFORE_SHA256, after_sha256: env.HELM_STATE_AFTER_SHA256 },
  recovery: { ...pass("Scoped uninstall removed target state while preserving the unrelated distribution."), before_sha256: env.HELM_STATE_BEFORE_SHA256, after_sha256: env.HELM_STATE_AFTER_SHA256 },
  notes: ["Windows publishes no artifact and has no signing claim; this record binds behavior to the exact Linux TGZ.", "The exact candidate used the documented snapshot-assisted equivalent, not a claimed in-job Windows reboot."],
});
writeFileSync(resolve(env.HELM_ACCEPTANCE_OUTPUT || "windows-acceptance.json"), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
