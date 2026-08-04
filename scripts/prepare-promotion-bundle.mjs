#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const exactRegular = (path, root) => {
  const rel = relative(root, path);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("Promotion path escapes its bundle");
  let current = root;
  for (const segment of rel.split(sep)) {
    current = join(current, segment);
    const info = lstatSync(current);
    if (info.isSymbolicLink()) throw new Error("Promotion path contains a symbolic link");
  }
  if (!lstatSync(path).isFile()) throw new Error("Promotion path is not a regular file");
};

const bundle = resolve(process.env.HELM_PROMOTION_BUNDLE || "");
const runPath = resolve(process.env.HELM_PROMOTION_RUN_JSON || "");
const artifactPath = resolve(process.env.HELM_PROMOTION_ARTIFACT_JSON || "");
const ciPath = process.env.HELM_PROMOTION_CI_JSON ? resolve(process.env.HELM_PROMOTION_CI_JSON) : "";
if (!bundle || !runPath || !artifactPath) throw new Error("Promotion bundle and trusted API record paths are required");
const manifestPath = join(bundle, "promotion.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const run = JSON.parse(readFileSync(runPath, "utf8"));
const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
const candidateRecord = manifest?.records?.candidate_manifest;
const candidatePath = resolve(bundle, String(candidateRecord?.path || ""));
const candidateRelative = relative(bundle, candidatePath);
if (!candidateRelative || candidateRelative === ".." || candidateRelative.startsWith(`..${sep}`)
    || !/^[a-f0-9]{64}$/.test(String(candidateRecord?.sha256 || ""))) {
  throw new Error("Candidate manifest record path or digest is invalid");
}
exactRegular(candidatePath, bundle);
const candidateBytes = readFileSync(candidatePath);
if (createHash("sha256").update(candidateBytes).digest("hex") !== candidateRecord.sha256) {
  throw new Error("Candidate manifest record digest does not match its bytes");
}
const candidate = JSON.parse(candidateBytes);
const ciRunId = String(candidate?.ci?.run_id || "");
if (!/^\d+$/.test(ciRunId) || candidate?.ci?.workflow !== "CI" || candidate?.ci?.conclusion !== "success") {
  throw new Error("Candidate manifest has no successful CI run identity");
}
if ((!['', 'unbound'].includes(String(manifest?.candidate?.workflow_run_id || '')) && String(manifest?.candidate?.workflow_run_id) !== String(run?.id))
    || (!['', 'unbound'].includes(String(manifest?.candidate?.artifact_id || '')) && String(manifest?.candidate?.artifact_id) !== String(artifact?.id))
    || String(artifact?.workflow_run?.id) !== String(run?.id)
    || run?.head_sha !== candidate?.source?.commit
    || artifact?.name !== manifest?.candidate?.artifact_name || artifact?.expired !== false) {
  throw new Error("Trusted GitHub API records do not match the candidate promotion identity");
}
const writeRecord = (name, value) => {
  const path = join(bundle, name);
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  writeFileSync(path, bytes, { mode: 0o600 });
  return { path: name, sha256: createHash("sha256").update(bytes).digest("hex") };
};
manifest.records ||= {};
manifest.candidate.workflow_run_id = String(run.id);
manifest.candidate.artifact_id = String(artifact.id);
manifest.records.candidate_workflow = writeRecord("trusted-candidate-workflow.json", run);
manifest.records.candidate_artifact = writeRecord("trusted-candidate-artifact.json", artifact);
if (ciPath) {
  const ci = JSON.parse(readFileSync(ciPath, "utf8"));
  if (String(ci?.id) !== ciRunId || ci?.head_sha !== candidate?.source?.commit) throw new Error("Trusted CI record does not match the candidate manifest");
  manifest.records.candidate_ci = writeRecord("trusted-candidate-ci.json", ci);
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `ci_run_id=${ciRunId}\n`, { flag: "a" });
