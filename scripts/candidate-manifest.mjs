#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const CANDIDATE_KIND = "1helm-dress-rehearsal-candidate";
export const CANDIDATE_REPOSITORY = "gitcommit90/1Helm";
export const CANDIDATE_REF = "refs/heads/main";

const sha256File = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const exactString = (value, pattern, label) => {
  const text = String(value || "");
  if (!pattern.test(text)) throw new Error(`Invalid candidate ${label}`);
  return text;
};

export function validateCandidateBuildIdentity(value, { allowLocal = false } = {}) {
  if (!value || value.schema !== 1 || value.kind !== CANDIDATE_KIND
      || value.repository !== CANDIDATE_REPOSITORY || value.ref !== CANDIDATE_REF) {
    throw new Error("Candidate build identity has the wrong schema, repository, or ref");
  }
  const sourceState = String(value.source_state || "");
  if (sourceState !== "trusted-main" && !(allowLocal && ["local-worktree", "rollback-fixture"].includes(sourceState))) {
    throw new Error("Candidate build identity is not trusted main");
  }
  const trustedMain = sourceState === "trusted-main";
  const ci = value.ci || {};
  if (trustedMain
    ? ci.workflow !== "CI" || !/^\d+$/.test(String(ci.run_id || "")) || ci.conclusion !== "success"
    : ci.workflow !== "local" || String(ci.run_id) !== "0" || ci.conclusion !== "not_run") {
    throw new Error("Candidate CI identity does not match its source state");
  }
  return {
    ...value,
    commit: exactString(value.commit, /^[a-f0-9]{40}$/, "commit"),
    source_state: sourceState,
    build_identity: exactString(value.build_identity, /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/, "build identity"),
    created_at: exactString(value.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, "creation time"),
    version: exactString(value.version, /^\d+\.\d+\.\d+$/, "version"),
    source_archive_sha256: exactString(value.source_archive_sha256, /^[a-f0-9]{64}$/, "source archive digest"),
    sealed_oci_sha256: exactString(value.sealed_oci_sha256, /^[a-f0-9]{64}$/, "sealed OCI digest"),
    ci: { workflow: ci.workflow, run_id: String(ci.run_id), conclusion: ci.conclusion },
  };
}

export function candidateIdentityFromArchive(archivePath, options = {}) {
  const listed = spawnSync("tar", ["-tzf", archivePath], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (listed.status !== 0) throw new Error("Candidate archive is not a readable gzip tar archive");
  const entries = String(listed.stdout || "").trim().split("\n").filter(Boolean);
  if (entries.some((entry) => entry.startsWith("/") || entry.split("/").includes(".."))) {
    throw new Error("Candidate archive contains an unsafe path");
  }
  const identities = entries.filter((entry) => /^[^/]+\/resources\/candidate-build\.json$/.test(entry));
  if (identities.length !== 1) throw new Error("Candidate archive must contain exactly one embedded build identity");
  const extracted = spawnSync("tar", ["-xOzf", archivePath, identities[0]], { encoding: "utf8", maxBuffer: 1024 * 1024 });
  if (extracted.status !== 0) throw new Error("Could not read the embedded candidate build identity");
  let parsed;
  try { parsed = JSON.parse(String(extracted.stdout || "")); } catch { throw new Error("Embedded candidate build identity is not valid JSON"); }
  return validateCandidateBuildIdentity(parsed, options);
}

export function createCandidateManifest({ archivePath, outputPath, allowLocal = false }) {
  const archive = resolve(archivePath);
  const identity = candidateIdentityFromArchive(archive, { allowLocal });
  const artifact = {
    name: basename(archive),
    sha256: sha256File(archive),
    bytes: statSync(archive).size,
  };
  const manifest = {
    schema: 1,
    kind: CANDIDATE_KIND,
    source: {
      repository: identity.repository,
      ref: identity.ref,
      commit: identity.commit,
      state: identity.source_state,
      source_archive_sha256: identity.source_archive_sha256,
    },
    version: identity.version,
    build: { identity: identity.build_identity, created_at: identity.created_at },
    ci: identity.ci,
    artifact,
    sealed_oci: { sha256: identity.sealed_oci_sha256 },
  };
  writeFileSync(resolve(outputPath), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const archivePath = process.env.HELM_CANDIDATE_ARCHIVE || "";
  const outputPath = process.env.HELM_CANDIDATE_MANIFEST || "";
  if (!archivePath || !outputPath) {
    process.stderr.write("Set HELM_CANDIDATE_ARCHIVE and HELM_CANDIDATE_MANIFEST.\n");
    process.exit(2);
  }
  try {
    const manifest = createCandidateManifest({
      archivePath,
      outputPath,
      allowLocal: process.env.HELM_CANDIDATE_ALLOW_LOCAL === "1",
    });
    process.stdout.write(`Candidate ${manifest.build.identity}: ${manifest.artifact.sha256}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
