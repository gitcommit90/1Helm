#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const sha256File = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

const root = resolve(process.env.HELM_RETAINED_MAC_CANDIDATE || "");
if (!process.env.HELM_RETAINED_MAC_CANDIDATE || lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) {
  throw new Error("Retained Mac candidate directory is missing or unsafe");
}
const regular = (path, label) => {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1) throw new Error(`${label} is not a retained regular file`);
  return info;
};
const json = (path, label) => {
  regular(path, label);
  return JSON.parse(readFileSync(path, "utf8"));
};

const manifestPath = join(root, "candidate-evidence", "mac-candidate.json");
const manifest = json(manifestPath, "Mac candidate manifest");
if (manifest?.schema !== 1 || manifest?.kind !== "1helm-macos-candidate"
    || manifest?.repository !== "gitcommit90/1Helm" || manifest?.ref !== "refs/heads/main"
    || !/^[a-f0-9]{40}$/.test(String(manifest?.commit || ""))
    || !/^\d+\.\d+\.\d+$/.test(String(manifest?.version || ""))
    || manifest?.candidate?.workflow !== "Candidate dress rehearsal"
    || manifest?.candidate?.workflow_path !== ".github/workflows/candidate.yml"
    || manifest?.candidate?.event !== "workflow_run"
    || !/^\d+$/.test(String(manifest?.candidate?.run_id || ""))
    || !/^\d+$/.test(String(manifest?.candidate?.run_attempt || ""))
    || manifest?.source_ci?.workflow !== "CI" || manifest?.source_ci?.conclusion !== "success"
    || !/^\d+$/.test(String(manifest?.source_ci?.run_id || ""))
    || manifest?.builder?.type !== "dedicated-self-hosted"
    || manifest?.builder?.runner_label !== "1helm-macos-phase4"
    || manifest?.builder?.os !== "macOS" || manifest?.builder?.architecture !== "ARM64"
    || manifest?.signing?.identity !== "developer-id-application"
    || manifest?.signing?.notarization !== "accepted" || manifest?.signing?.stapling !== "validated"
    || manifest?.signing?.gatekeeper !== "accepted") {
  throw new Error("Retained Mac candidate identity is invalid");
}
const artifacts = {};
for (const role of ["mac_dmg", "mac_updater_zip"]) {
  const item = (Array.isArray(manifest.artifacts) ? manifest.artifacts : []).find((value) => value?.role === role);
  if (!item || basename(String(item.name || "")) !== item.name || !/^[a-f0-9]{64}$/.test(String(item.sha256 || ""))) {
    throw new Error(`Retained ${role} identity is invalid`);
  }
  const artifactPath = join(root, item.name);
  const info = regular(artifactPath, role);
  if (info.size !== Number(item.bytes) || sha256File(artifactPath) !== item.sha256) {
    throw new Error(`Retained ${role} bytes do not match the signed candidate manifest`);
  }
  const provenance = json(join(root, "candidate-evidence", `${role}-provenance.json`), `${role} provenance`);
  if (provenance?.schema !== 1 || provenance?.kind !== "1helm-artifact-provenance"
      || provenance?.commit !== manifest.commit || provenance?.version !== manifest.version
      || String(provenance?.candidate_workflow_run_id) !== String(manifest.candidate.run_id)
      || String(provenance?.source_ci_run_id) !== String(manifest.source_ci.run_id)
      || provenance?.artifact?.role !== role || provenance?.artifact?.name !== item.name
      || provenance?.artifact?.sha256 !== item.sha256 || Number(provenance?.artifact?.bytes) !== Number(item.bytes)
      || provenance?.signing !== "developer-id" || provenance?.notarization !== "accepted"
      || provenance?.stapling !== "validated" || provenance?.gatekeeper !== "accepted") {
    throw new Error(`Retained ${role} provenance does not bind the exact accepted bytes`);
  }
  artifacts[role] = item;
}
if (Object.keys(artifacts).length !== 2 || manifest.artifacts.length !== 2) throw new Error("Retained Mac artifact set is incomplete");

const acceptance = json(join(root, "macos-acceptance.json"), "macOS acceptance evidence");
const blockers = [];
const add = (condition, message) => { if (!condition) blockers.push(message); };
add(acceptance?.schema === 1 && acceptance?.kind === "1helm-platform-acceptance" && acceptance?.platform === "macos"
  && acceptance?.result === "passed", "acceptance schema or result is not a pass");
add(acceptance?.repository === manifest.repository && acceptance?.ref === manifest.ref
  && acceptance?.commit === manifest.commit && acceptance?.version === manifest.version, "acceptance source identity changed");
add(String(acceptance?.candidate?.run_id) === String(manifest.candidate.run_id)
  && String(acceptance?.candidate?.run_attempt) === String(manifest.candidate.run_attempt)
  && String(acceptance?.source_ci?.run_id) === String(manifest.source_ci.run_id)
  && acceptance?.source_ci?.conclusion === "success", "acceptance run identity changed");
add(acceptance?.machine?.kind === "dedicated-apple-silicon" && acceptance?.machine?.os === "macOS"
  && acceptance?.machine?.architecture === "ARM64" && acceptance?.machine?.dedicated === true
  && acceptance?.machine?.production_data === false, "acceptance machine identity is incomplete");
add(Array.isArray(acceptance?.runner?.labels) && acceptance.runner.labels.length === 1
  && acceptance.runner.labels[0] === "1helm-macos-phase4" && acceptance?.runner?.job === "accept-macos",
"acceptance runner identity changed");
const requiredChecks = ["signature", "notarization", "staple", "gatekeeper", "clean_install",
  "prior_version_update", "retained_state", "loopback", "version"];
const checks = new Map((Array.isArray(acceptance?.checks) ? acceptance.checks : []).map((item) => [item?.id, item]));
add(requiredChecks.every((id) => checks.get(id)?.result === "passed") && checks.size === requiredChecks.length,
  "acceptance checks are incomplete");
add(acceptance?.state_preservation?.result === "passed"
  && /^[a-f0-9]{64}$/.test(String(acceptance?.state_preservation?.before_sha256 || ""))
  && acceptance.state_preservation.before_sha256 === acceptance.state_preservation.after_sha256,
"acceptance state preservation did not pass");
add(acceptance?.recovery?.result === "passed", "acceptance recovery did not pass");
const acceptedArtifacts = Array.isArray(acceptance?.artifacts) ? acceptance.artifacts : [];
add(acceptedArtifacts.length === 2 && Object.entries(artifacts).every(([role, wanted]) => {
  const found = acceptedArtifacts.filter((item) => item?.role === role);
  return found.length === 1 && found[0].name === wanted.name && found[0].sha256 === wanted.sha256
    && Number(found[0].bytes) === Number(wanted.bytes);
}), "acceptance artifact identity changed");
if (acceptance?.runner?.name !== manifest?.builder?.runner_name) blockers.push("acceptance runner does not match the Mac builder");
if (blockers.length) throw new Error(`Retained Mac acceptance is incomplete: ${blockers.join("; ")}`);

process.stdout.write(`Retained exact Mac candidate ${manifest.commit} passed byte, provenance, and acceptance verification.\n`);
