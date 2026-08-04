#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { normalizeChannelImageManifest, validateSplitArtifactManifest } from "./artifact-contract.mjs";

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
  const channelImage = normalizeChannelImageManifest(value.channel_image, { requireUrl: true });
  const sealedOciSha256 = exactString(value.sealed_oci_sha256, /^[a-f0-9]{64}$/, "sealed OCI digest");
  if (channelImage.sha256 !== sealedOciSha256) throw new Error("Candidate sealed OCI digest does not match its channel image manifest");
  const sealedOciCache = value.sealed_oci_cache || {};
  if (sealedOciCache.key !== channelImage.cache.key || typeof sealedOciCache.reused !== "boolean") {
    throw new Error("Candidate sealed OCI cache reuse provenance is incomplete");
  }
  return {
    ...value,
    commit: exactString(value.commit, /^[a-f0-9]{40}$/, "commit"),
    source_state: sourceState,
    build_identity: exactString(value.build_identity, /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/, "build identity"),
    created_at: exactString(value.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, "creation time"),
    version: exactString(value.version, /^\d+\.\d+\.\d+$/, "version"),
    source_archive_sha256: exactString(value.source_archive_sha256, /^[a-f0-9]{64}$/, "source archive digest"),
    sealed_oci_sha256: sealedOciSha256,
    sealed_oci_cache: { key: String(sealedOciCache.key), reused: sealedOciCache.reused },
    channel_image: channelImage,
    ci: { workflow: ci.workflow, run_id: String(ci.run_id), conclusion: ci.conclusion },
  };
}

export function candidateIdentityFromArchive(archivePath, options = {}) {
  const listed = spawnSync("tar", ["-tzf", archivePath], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (listed.status !== 0) throw new Error("Candidate archive is not a readable gzip tar archive");
  const entries = String(listed.stdout || "").trim().split("\n").filter(Boolean);
  if (entries.some((entry) => entry.startsWith("/") || entry.split("/").includes(".."))) throw new Error("Candidate archive contains an unsafe path");
  const identities = entries.filter((entry) => /^[^/]+\/resources\/candidate-build\.json$/.test(entry));
  const imageManifests = entries.filter((entry) => /^[^/]+\/resources\/channel-image\.json$/.test(entry));
  if (identities.length !== 1 || imageManifests.length !== 1) throw new Error("Candidate archive must contain exactly one build identity and channel image manifest");
  if (entries.some((entry) => /^[^/]+\/container\/channel-machine\.oci\.tar$/.test(entry))) {
    throw new Error("Online candidate archive must not embed sealed OCI bytes");
  }
  const extract = (entry) => spawnSync("tar", ["-xOzf", archivePath, entry], { encoding: "utf8", maxBuffer: 1024 * 1024 });
  const extracted = extract(identities[0]);
  if (extracted.status !== 0) throw new Error("Could not read the embedded candidate build identity");
  let parsed;
  try { parsed = JSON.parse(String(extracted.stdout || "")); } catch { throw new Error("Embedded candidate build identity is not valid JSON"); }
  const identity = validateCandidateBuildIdentity(parsed, options);
  let image;
  try { image = normalizeChannelImageManifest(JSON.parse(String(extract(imageManifests[0]).stdout || "")), { requireUrl: true }); }
  catch (error) { throw new Error(`Embedded channel image manifest is invalid: ${error.message}`); }
  if (JSON.stringify(image) !== JSON.stringify(identity.channel_image)) throw new Error("Embedded channel image manifest does not match candidate identity");
  return identity;
}

export function createCandidateManifest({ archivePath, offlinePath, splitPath, outputPath, allowLocal = false }) {
  const archive = resolve(archivePath);
  const offline = resolve(offlinePath || "");
  const identity = candidateIdentityFromArchive(archive, { allowLocal });
  const split = validateSplitArtifactManifest(JSON.parse(readFileSync(resolve(splitPath || ""), "utf8")), {
    version: identity.version, architecture: identity.channel_image.architecture,
  });
  const artifact = { name: basename(archive), sha256: sha256File(archive), bytes: statSync(archive).size, layout: "online-app" };
  const offlineBundle = { name: basename(offline), sha256: sha256File(offline), bytes: statSync(offline).size };
  if (artifact.name !== split.app.name || artifact.sha256 !== split.app.sha256 || artifact.bytes !== split.app.bytes || split.app.contains_channel_image !== false) {
    throw new Error("Online candidate archive does not match its split artifact manifest");
  }
  if (offlineBundle.name !== split.offline.name || offlineBundle.sha256 !== split.offline.sha256
      || offlineBundle.bytes !== split.offline.bytes || split.offline.contains_channel_image !== true) {
    throw new Error("Offline candidate archive does not match its split artifact manifest");
  }
  if (JSON.stringify(split.channel_image) !== JSON.stringify(identity.channel_image)) throw new Error("Split artifact channel image does not match embedded candidate identity");
  const manifest = {
    schema: 1, kind: CANDIDATE_KIND,
    source: {
      repository: identity.repository, ref: identity.ref, commit: identity.commit,
      state: identity.source_state, source_archive_sha256: identity.source_archive_sha256,
    },
    version: identity.version,
    build: { identity: identity.build_identity, created_at: identity.created_at, sealed_oci_cache: identity.sealed_oci_cache },
    ci: identity.ci,
    artifact,
    offline_bundle: offlineBundle,
    sealed_oci: identity.channel_image,
    production_dependencies: split.production_dependencies,
  };
  writeFileSync(resolve(outputPath), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const archivePath = process.env.HELM_CANDIDATE_ARCHIVE || "";
  const offlinePath = process.env.HELM_CANDIDATE_OFFLINE_ARCHIVE || "";
  const splitPath = process.env.HELM_CANDIDATE_SPLIT_MANIFEST || "";
  const outputPath = process.env.HELM_CANDIDATE_MANIFEST || "";
  if (!archivePath || !offlinePath || !splitPath || !outputPath) {
    process.stderr.write("Set HELM_CANDIDATE_ARCHIVE, HELM_CANDIDATE_OFFLINE_ARCHIVE, HELM_CANDIDATE_SPLIT_MANIFEST, and HELM_CANDIDATE_MANIFEST.\n");
    process.exit(2);
  }
  try {
    const manifest = createCandidateManifest({ archivePath, offlinePath, splitPath, outputPath, allowLocal: process.env.HELM_CANDIDATE_ALLOW_LOCAL === "1" });
    process.stdout.write(`Candidate ${manifest.build.identity}: ${manifest.artifact.sha256}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
