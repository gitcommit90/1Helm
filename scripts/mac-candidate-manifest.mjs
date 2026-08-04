#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { artifactRecord, CANDIDATE_WORKFLOW, isoNow, REF, REPOSITORY, sha256Bytes } from "./platform-acceptance-lib.mjs";

const env = process.env;
const output = resolve(env.HELM_MAC_MANIFEST || "");
const dmgPath = resolve(env.HELM_MAC_DMG || "");
const zipPath = resolve(env.HELM_MAC_ZIP || "");
const commit = String(env.HELM_CANDIDATE_COMMIT || "");
const version = String(env.HELM_CANDIDATE_VERSION || "");
const ciRunId = String(env.HELM_CANDIDATE_CI_RUN_ID || "");
const candidateRunId = String(env.GITHUB_RUN_ID || "");
const candidateRunAttempt = String(env.GITHUB_RUN_ATTEMPT || "");
if (!env.HELM_MAC_MANIFEST || !env.HELM_MAC_DMG || !env.HELM_MAC_ZIP
    || !/^[a-f0-9]{40}$/.test(commit) || !/^\d+\.\d+\.\d+$/.test(version)
    || !/^\d+$/.test(ciRunId) || !/^\d+$/.test(candidateRunId) || !/^\d+$/.test(candidateRunAttempt)) {
  throw new Error("Exact Mac candidate paths and trusted candidate identity are required");
}
const artifacts = [artifactRecord("mac_dmg", dmgPath), artifactRecord("mac_updater_zip", zipPath)];
const checkedAt = isoNow();
const manifest = {
  schema: 1,
  kind: "1helm-macos-candidate",
  repository: REPOSITORY,
  ref: REF,
  commit,
  version,
  candidate: {
    workflow: CANDIDATE_WORKFLOW.name,
    workflow_path: CANDIDATE_WORKFLOW.path,
    event: CANDIDATE_WORKFLOW.event,
    run_id: candidateRunId,
    run_attempt: candidateRunAttempt,
  },
  source_ci: { workflow: "CI", run_id: ciRunId, conclusion: "success" },
  builder: {
    type: "dedicated-self-hosted",
    runner_name: String(env.RUNNER_NAME || ""),
    runner_label: "1helm-macos-phase4",
    os: String(env.RUNNER_OS || "macOS"),
    architecture: String(env.RUNNER_ARCH || "ARM64"),
  },
  signing: {
    identity: "developer-id-application",
    notarization: "accepted",
    stapling: "validated",
    gatekeeper: "accepted",
    checked_at: checkedAt,
  },
  artifacts,
};
for (const field of [manifest.builder.runner_name, manifest.builder.os, manifest.builder.architecture]) {
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._:/@+()#-]{0,255}$/.test(field)) throw new Error("Mac builder identity is missing or unsafe");
}
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
for (const artifact of artifacts) {
  const provenance = {
    schema: 1,
    kind: "1helm-artifact-provenance",
    repository: REPOSITORY,
    ref: REF,
    commit,
    version,
    builder: "dedicated-macos",
    signer_workflow: `${REPOSITORY}/${CANDIDATE_WORKFLOW.path}`,
    candidate_workflow_run_id: candidateRunId,
    source_ci_run_id: ciRunId,
    signing: "developer-id",
    notarization: "accepted",
    stapling: "validated",
    gatekeeper: "accepted",
    checked_at: checkedAt,
    artifact,
  };
  const bytes = Buffer.from(`${JSON.stringify(provenance, null, 2)}\n`);
  const provenancePath = resolve(output, `../${artifact.role}-provenance.json`);
  writeFileSync(provenancePath, bytes, { mode: 0o600 });
  process.stdout.write(`${artifact.role} ${artifact.sha256} provenance ${sha256Bytes(bytes)}\n`);
}
