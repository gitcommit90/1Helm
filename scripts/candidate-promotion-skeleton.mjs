#!/usr/bin/env node
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { sha256File, STABLE_REPOSITORY } from "./stable-manifest-lib.mjs";

const source = resolve(process.env.HELM_CANDIDATE_DOWNLOAD || "");
const rehearsalPath = resolve(process.env.HELM_REHEARSAL_EVIDENCE || "");
const output = resolve(process.env.HELM_PROMOTION_OUTPUT || "");
const project = resolve(process.env.HELM_PROJECT_ROOT || ".");
const workflowRunId = String(process.env.GITHUB_RUN_ID || "unbound");
const ciRunId = String(process.env.HELM_CANDIDATE_CI_RUN_ID || "");
if (!source || !rehearsalPath || !output) throw new Error("Candidate, rehearsal, and promotion output paths are required");
mkdirSync(output, { recursive: true, mode: 0o700 });
const digest = sha256File;
const record = (sourcePath, name) => {
  const destination = join(output, name);
  copyFileSync(sourcePath, destination);
  return { path: name, sha256: digest(destination) };
};
const candidateSource = join(source, "candidate-evidence", "candidate.json");
const candidate = JSON.parse(readFileSync(candidateSource, "utf8"));
const version = String(candidate?.version || "");
const commit = String(candidate?.source?.commit || "");
if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[a-f0-9]{40}$/.test(commit)) throw new Error("Candidate manifest version or commit is invalid");
if (!/^\d+$/.test(ciRunId) || candidate?.ci?.run_id !== ciRunId) throw new Error("Candidate CI run identity changed before promotion assembly");
const archiveSource = join(source, candidate.artifact.name);
if (digest(archiveSource) !== candidate.artifact.sha256 || statSync(archiveSource).size !== candidate.artifact.bytes) {
  throw new Error("Candidate Linux archive no longer matches its manifest");
}
const archive = record(archiveSource, candidate.artifact.name);
const candidateRecord = record(candidateSource, "candidate.json");
const rehearsal = record(rehearsalPath, "dress-rehearsal.json");
const packageRecord = record(join(project, "package.json"), "package.json");
const changelog = record(join(project, "CHANGELOG.md"), "authored-changelog.md");
const provenanceBundle = record(join(source, "candidate-evidence", "provenance.bundle.json"), "provenance.bundle.json");
const provenanceValue = {
  schema: 1, kind: "1helm-artifact-provenance", repository: STABLE_REPOSITORY,
  ref: "refs/heads/main", commit, builder: "github-hosted", attestation_created: true,
  signer_workflow: "gitcommit90/1Helm/.github/workflows/candidate.yml",
  artifact: { role: "linux_tgz", name: candidate.artifact.name, sha256: candidate.artifact.sha256 },
  bundle: provenanceBundle,
};
const provenanceBytes = Buffer.from(`${JSON.stringify(provenanceValue, null, 2)}\n`);
writeFileSync(join(output, "linux-provenance.json"), provenanceBytes, { mode: 0o600 });
const provenance = { path: "linux-provenance.json", sha256: createHash("sha256").update(provenanceBytes).digest("hex") };
const artifactName = `1helm-promotion-candidate-${commit}`;
const promotion = {
  schema: 1, kind: "1helm-stable-promotion-candidate", repository: STABLE_REPOSITORY, ref: "refs/heads/main",
  commit, version,
  candidate: { workflow_run_id: workflowRunId, artifact_id: "unbound", artifact_name: artifactName },
  records: {
    candidate_manifest: candidateRecord,
    dress_rehearsal: rehearsal,
    package: packageRecord,
    changelog,
  },
  acceptance_ledger_required: true,
  artifacts: [{
    role: "linux_tgz", name: basename(archive.path), path: archive.path,
    sha256: candidate.artifact.sha256, bytes: candidate.artifact.bytes, provenance,
  }],
};
writeFileSync(join(output, "promotion.json"), `${JSON.stringify(promotion, null, 2)}\n`, { mode: 0o600 });
