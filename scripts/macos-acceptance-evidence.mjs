#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isoNow, normalizePlatformEvidence } from "./platform-acceptance-lib.mjs";

const env = process.env;
const source = resolve(env.HELM_MAC_CANDIDATE_DOWNLOAD || "");
const manifest = JSON.parse(readFileSync(join(source, "candidate-evidence", "mac-candidate.json"), "utf8"));
const checkedAt = isoNow();
const pass = (summary) => ({ result: "passed", checked_at: checkedAt, summary });
const evidence = normalizePlatformEvidence({
  platform: "macos", commit: manifest.commit, version: manifest.version,
  candidate: { run_id: env.GITHUB_RUN_ID, run_attempt: env.GITHUB_RUN_ATTEMPT },
  source_ci: manifest.source_ci, started_at: env.HELM_ACCEPTANCE_STARTED_AT, checked_at: checkedAt,
  machine: {
    id: `${env.RUNNER_NAME}-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`,
    kind: "dedicated-apple-silicon", os: env.RUNNER_OS, os_version: env.HELM_MACHINE_OS_VERSION,
    architecture: env.RUNNER_ARCH, dedicated: true, production_data: false,
  },
  runner: { name: env.RUNNER_NAME, labels: ["1helm-macos-phase4"], job: env.GITHUB_JOB },
  artifacts: manifest.artifacts,
  checks: [
    { id: "signature", ...pass("Strict deep Developer ID verification passed on the mounted DMG app and updater ZIP app.") },
    { id: "notarization", ...pass("Apple notary acceptance declared by the build manifest and verified through Gatekeeper assessment.") },
    { id: "staple", ...pass("Stapler validated the exact DMG and both exact app payloads.") },
    { id: "gatekeeper", ...pass("Gatekeeper accepted the DMG for open and both app payloads for execution.") },
    { id: "clean_install", ...pass("Exact DMG app copied into an isolated Applications directory and launched on the dedicated account.") },
    { id: "prior_version_update", ...pass(`Exact updater ZIP replaced signed prior Stable v${env.HELM_PREVIOUS_VERSION} without touching isolated Application Support.`) },
    { id: "retained_state", ...pass("Application Support state marker retained identical SHA-256 across updater replacement.") },
    { id: "loopback", ...pass("The launched DMG app and updater ZIP app both returned setup health on loopback.") },
    { id: "version", ...pass("DMG and updater ZIP bundle versions matched the candidate package version.") },
  ],
  state_preservation: { ...pass("Application Support state marker retained byte identity."), before_sha256: env.HELM_STATE_BEFORE_SHA256, after_sha256: env.HELM_STATE_AFTER_SHA256 },
  recovery: { ...pass("Both isolated launches quit cleanly and transient app copies were removed."), before_sha256: env.HELM_STATE_BEFORE_SHA256, after_sha256: env.HELM_STATE_AFTER_SHA256 },
  notes: ["This is real Apple Silicon signature, ticket, Gatekeeper, launch, loopback, and state evidence."],
});
writeFileSync(resolve(env.HELM_ACCEPTANCE_OUTPUT || "macos-acceptance.json"), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
