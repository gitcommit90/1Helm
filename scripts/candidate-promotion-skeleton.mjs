#!/usr/bin/env node
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { platformEvidenceBlockers } from "./platform-acceptance-lib.mjs";
import { sha256File, STABLE_REPOSITORY } from "./stable-manifest-lib.mjs";

const env = process.env;
const linuxSource = resolve(env.HELM_CANDIDATE_DOWNLOAD || "");
const macSource = resolve(env.HELM_MAC_CANDIDATE_DOWNLOAD || "");
const rehearsalPath = resolve(env.HELM_REHEARSAL_EVIDENCE || "");
const acceptancePaths = {
  linux: resolve(env.HELM_LINUX_ACCEPTANCE_EVIDENCE || ""),
  macos: resolve(env.HELM_MAC_ACCEPTANCE_EVIDENCE || ""),
  windows: resolve(env.HELM_WINDOWS_ACCEPTANCE_EVIDENCE || ""),
};
const acceptanceContentPath = resolve(env.HELM_ACCEPTANCE_CONTENT || "");
const output = resolve(env.HELM_PROMOTION_OUTPUT || "");
const project = resolve(env.HELM_PROJECT_ROOT || ".");
const workflowRunId = String(env.GITHUB_RUN_ID || "");
const ciRunId = String(env.HELM_CANDIDATE_CI_RUN_ID || "");
if (!env.HELM_CANDIDATE_DOWNLOAD || !env.HELM_MAC_CANDIDATE_DOWNLOAD || !env.HELM_REHEARSAL_EVIDENCE
    || !env.HELM_LINUX_ACCEPTANCE_EVIDENCE || !env.HELM_MAC_ACCEPTANCE_EVIDENCE
    || !env.HELM_WINDOWS_ACCEPTANCE_EVIDENCE || !env.HELM_ACCEPTANCE_CONTENT
    || !env.HELM_PROMOTION_OUTPUT || !/^\d+$/.test(workflowRunId) || !/^\d+$/.test(ciRunId)) {
  throw new Error("Complete Linux/Mac/Windows candidate bytes, evidence, ledger, and run identities are required");
}
mkdirSync(output, { recursive: true, mode: 0o700 });
const digest = sha256File;
const record = (sourcePath, name) => {
  const destination = join(output, name);
  copyFileSync(sourcePath, destination);
  return { path: name, sha256: digest(destination) };
};

const candidateSource = join(linuxSource, "candidate-evidence", "candidate.json");
const candidate = JSON.parse(readFileSync(candidateSource, "utf8"));
const version = String(candidate?.version || "");
const commit = String(candidate?.source?.commit || "");
if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[a-f0-9]{40}$/.test(commit)) throw new Error("Candidate manifest version or commit is invalid");
if (candidate?.source?.repository !== STABLE_REPOSITORY || candidate?.source?.ref !== "refs/heads/main"
    || candidate?.source?.state !== "trusted-main" || candidate?.ci?.workflow !== "CI"
    || candidate?.ci?.run_id !== ciRunId || candidate?.ci?.conclusion !== "success") {
  throw new Error("Linux candidate is not the exact successful trusted-main CI candidate");
}
const linuxArchiveSource = join(linuxSource, candidate.artifact.name);
if (digest(linuxArchiveSource) !== candidate.artifact.sha256 || statSync(linuxArchiveSource).size !== candidate.artifact.bytes) {
  throw new Error("Candidate Linux archive no longer matches its manifest");
}

const macManifestPath = join(macSource, "candidate-evidence", "mac-candidate.json");
const mac = JSON.parse(readFileSync(macManifestPath, "utf8"));
if (mac?.schema !== 1 || mac?.kind !== "1helm-macos-candidate" || mac?.repository !== STABLE_REPOSITORY
    || mac?.ref !== "refs/heads/main" || mac?.commit !== commit || mac?.version !== version
    || mac?.candidate?.workflow !== "Candidate dress rehearsal" || mac?.candidate?.workflow_path !== ".github/workflows/candidate.yml"
    || mac?.candidate?.event !== "workflow_run" || String(mac?.candidate?.run_id) !== workflowRunId
    || !/^\d+$/.test(String(mac?.candidate?.run_attempt || "")) || String(mac?.source_ci?.run_id) !== ciRunId
    || mac?.source_ci?.conclusion !== "success" || mac?.signing?.identity !== "developer-id-application"
    || mac?.signing?.notarization !== "accepted" || mac?.signing?.stapling !== "validated"
    || mac?.signing?.gatekeeper !== "accepted" || mac?.builder?.type !== "dedicated-self-hosted"
    || mac?.builder?.runner_label !== "1helm-macos-phase4" || mac?.builder?.os !== "macOS"
    || mac?.builder?.architecture !== "ARM64") {
  throw new Error("Mac candidate manifest does not bind signed/notarized bytes to the exact candidate identity");
}

const artifacts = {};
const linuxArchive = record(linuxArchiveSource, candidate.artifact.name);
artifacts.linux_tgz = { role: "linux_tgz", name: basename(linuxArchive.path), path: linuxArchive.path, sha256: candidate.artifact.sha256, bytes: candidate.artifact.bytes };
for (const role of ["mac_dmg", "mac_updater_zip"]) {
  const item = (Array.isArray(mac.artifacts) ? mac.artifacts : []).find((artifact) => artifact?.role === role);
  if (!item || !/^[a-f0-9]{64}$/.test(String(item.sha256 || "")) || !Number.isSafeInteger(item.bytes) || item.bytes <= 0) {
    throw new Error(`Mac candidate is missing ${role}`);
  }
  const source = join(macSource, item.name);
  if (digest(source) !== item.sha256 || statSync(source).size !== item.bytes) throw new Error(`${role} bytes changed after the Mac build`);
  const copied = record(source, item.name);
  artifacts[role] = { role, name: item.name, path: copied.path, sha256: item.sha256, bytes: item.bytes };
}

const linuxBundle = record(join(linuxSource, "candidate-evidence", "provenance.bundle.json"), "provenance.bundle.json");
const linuxProvenanceValue = {
  schema: 1, kind: "1helm-artifact-provenance", repository: STABLE_REPOSITORY,
  ref: "refs/heads/main", commit, version, builder: "github-hosted", attestation_created: true,
  signer_workflow: `${STABLE_REPOSITORY}/.github/workflows/candidate.yml`,
  candidate_workflow_run_id: workflowRunId, source_ci_run_id: ciRunId,
  artifact: { role: "linux_tgz", name: artifacts.linux_tgz.name, sha256: artifacts.linux_tgz.sha256, bytes: artifacts.linux_tgz.bytes },
  bundle: linuxBundle,
};
const linuxProvenanceBytes = Buffer.from(`${JSON.stringify(linuxProvenanceValue, null, 2)}\n`);
writeFileSync(join(output, "linux-provenance.json"), linuxProvenanceBytes, { mode: 0o600 });
artifacts.linux_tgz.provenance = { path: "linux-provenance.json", sha256: createHash("sha256").update(linuxProvenanceBytes).digest("hex") };
for (const role of ["mac_dmg", "mac_updater_zip"]) {
  const provenanceSource = join(macSource, "candidate-evidence", `${role}-provenance.json`);
  const provenanceValue = JSON.parse(readFileSync(provenanceSource, "utf8"));
  const item = artifacts[role];
  if (provenanceValue?.schema !== 1 || provenanceValue?.kind !== "1helm-artifact-provenance"
      || provenanceValue?.repository !== STABLE_REPOSITORY || provenanceValue?.ref !== "refs/heads/main"
      || provenanceValue?.commit !== commit || provenanceValue?.version !== version
      || String(provenanceValue?.candidate_workflow_run_id) !== workflowRunId || String(provenanceValue?.source_ci_run_id) !== ciRunId
      || provenanceValue?.signer_workflow !== `${STABLE_REPOSITORY}/.github/workflows/candidate.yml`
      || provenanceValue?.signing !== "developer-id" || provenanceValue?.notarization !== "accepted"
      || provenanceValue?.stapling !== "validated" || provenanceValue?.gatekeeper !== "accepted"
      || provenanceValue?.artifact?.role !== role || provenanceValue?.artifact?.name !== item.name
      || provenanceValue?.artifact?.sha256 !== item.sha256 || Number(provenanceValue?.artifact?.bytes) !== item.bytes) {
    throw new Error(`${role} provenance does not bind the exact signed Mac candidate`);
  }
  artifacts[role].provenance = record(provenanceSource, `${role}-provenance.json`);
}

const acceptance = {};
for (const platform of ["macos", "linux", "windows"]) {
  const value = JSON.parse(readFileSync(acceptancePaths[platform], "utf8"));
  const blockers = platformEvidenceBlockers(value, { platform, commit, version, runId: workflowRunId,
    runAttempt: String(mac.candidate.run_attempt), ciRunId, artifacts });
  if (platform === "macos" && value?.runner?.name !== mac?.builder?.runner_name) {
    blockers.push("acceptance runner does not match the dedicated Mac builder");
  }
  if (blockers.length) throw new Error(`${platform} acceptance cannot enter the promotion bundle: ${blockers.join("; ")}`);
  acceptance[platform] = record(acceptancePaths[platform], `${platform}-acceptance.json`);
}

const artifactName = `1helm-promotion-candidate-${commit}`;
const promotion = {
  schema: 1, kind: "1helm-stable-promotion-candidate", repository: STABLE_REPOSITORY, ref: "refs/heads/main",
  commit, version,
  candidate: { workflow_run_id: workflowRunId, artifact_id: "unbound", artifact_name: artifactName },
  records: {
    candidate_manifest: record(candidateSource, "candidate.json"),
    mac_candidate_manifest: record(macManifestPath, "mac-candidate.json"),
    dress_rehearsal: record(rehearsalPath, "dress-rehearsal.json"),
    acceptance,
    package: record(join(project, "package.json"), "package.json"),
    changelog: record(join(project, "CHANGELOG.md"), "authored-changelog.md"),
    acceptance_content: record(acceptanceContentPath, "acceptance.md"),
  },
  acceptance_ledger_required: true,
  artifacts: [artifacts.mac_dmg, artifacts.mac_updater_zip, artifacts.linux_tgz],
};
writeFileSync(join(output, "promotion.json"), `${JSON.stringify(promotion, null, 2)}\n`, { mode: 0o600 });
