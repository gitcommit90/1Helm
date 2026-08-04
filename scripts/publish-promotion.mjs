#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { confirmationText } from "./promotion-lib.mjs";
import { sha256, sha256File, STABLE_ARTIFACT_ROLES, validateStableManifest } from "./stable-manifest-lib.mjs";
import { assertRemoteVersionAbsent, remoteTagAndRelease } from "./github-promotion-gates.mjs";
import { channelImageManifestName, channelImageProvenanceName, channelImageReleaseTag } from "./artifact-contract.mjs";

const bundle = resolve(process.env.HELM_PROMOTION_BUNDLE || "");
const version = String(process.env.HELM_PROMOTION_VERSION || "");
const runId = String(process.env.HELM_PROMOTION_RUN_ID || "");
const artifactId = String(process.env.HELM_PROMOTION_ARTIFACT_ID || "");
const confirmation = String(process.env.HELM_PROMOTION_CONFIRMATION || "");
const mode = String(process.env.HELM_PROMOTION_MODE || "");
const environmentEnabled = String(process.env.STABLE_PUBLICATION_ENABLED || "");
const githubToken = String(process.env.GH_TOKEN || "");
if (!/^\d+\.\d+\.\d+$/.test(version) || !/^\d+$/.test(runId) || !/^\d+$/.test(artifactId)) throw new Error("Refusing invalid publish identity");
if (mode !== "publish") throw new Error("Refusing without explicit publish mode");
if (confirmation !== confirmationText(version, runId, artifactId)) throw new Error("Refusing without exact owner confirmation text");
// This secret must exist only inside the owner-protected environment. Its
// absence keeps the path unusable even if GitHub auto-creates an unprotected
// environment for the workflow name.
if (environmentEnabled !== "PROTECTED STABLE ENVIRONMENT ENABLED") throw new Error("Refusing until the owner protects and enables the Stable publication environment");

const verified = JSON.parse(readFileSync(join(bundle, "verified-promotion.json"), "utf8"));
const stablePath = join(bundle, `1Helm-${version}-stable.json`);
const stable = validateStableManifest(JSON.parse(readFileSync(stablePath, "utf8")));
if (!verified.eligible || verified.stable_touched !== false
    || verified.candidate?.version !== version || String(verified.candidate?.workflow_run_id) !== runId
    || String(verified.candidate?.artifact_id) !== artifactId || stable.version !== version
    || stable.commit !== verified.candidate.commit) {
  throw new Error("Refusing publish inputs that are not the exact complete verification result");
}
const hash = sha256File;
if (JSON.stringify(stable) !== JSON.stringify(verified.stable_manifest)
    || hash(stablePath) !== verified.stable_manifest_sha256) {
  throw new Error("Refusing changed stable manifest after verification");
}

const run = (file, args, options = {}) => execFileSync(file, args, { encoding: "utf8", stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit" });
const tag = `v${version}`;
await assertRemoteVersionAbsent(version, githubToken);
run("git", ["fetch", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main"]);
run("git", ["merge-base", "--is-ancestor", stable.commit, "refs/remotes/origin/main"]);

const artifactPaths = STABLE_ARTIFACT_ROLES.map((role) => {
  const artifact = stable.artifacts.find((item) => item.role === role);
  const path = join(bundle, artifact.name);
  const digest = hash(path);
  if (digest !== artifact.sha256) throw new Error(`Refusing changed ${role} bytes after verification`);
  return path;
});
const notes = join(bundle, `1Helm-${version}-release-notes.md`);
if (hash(notes) !== verified.release_notes_sha256) throw new Error("Refusing changed authored release notes after verification");

// The sealed channel machine has its own immutable digest-addressed Release.
// Reuse an exact existing Release or publish the retained candidate once. It is
// never copied into the ordinary application Release, so unchanged app updates
// cannot redownload it.
const image = stable.channel_image;
const imageTag = channelImageReleaseTag(image);
const imagePath = join(bundle, image.artifact.name);
const imageManifestCandidate = join(bundle, "channel-image.json");
const imageManifestName = channelImageManifestName(image);
const imageManifestPath = join(bundle, imageManifestName);
const imageProvenanceCandidate = join(bundle, "channel-image-provenance.json");
const imageProvenanceName = channelImageProvenanceName(image);
const imageProvenancePath = join(bundle, imageProvenanceName);
if (hash(imagePath) !== image.sha256) throw new Error("Refusing changed channel image bytes after verification");
const imageManifestValue = JSON.parse(readFileSync(imageManifestCandidate, "utf8"));
if (imageManifestValue.sha256 !== image.sha256 || imageManifestValue.architecture !== image.architecture
    || imageManifestValue.version !== image.version) throw new Error("Refusing changed channel image manifest after verification");
run("cp", [imageManifestCandidate, imageManifestPath]);
run("cp", [imageProvenanceCandidate, imageProvenancePath]);
function validateImageProvenance(value, { requireCurrentCandidate = false } = {}) {
  if (value?.schema !== 1 || value?.kind !== "1helm-channel-image-provenance"
      || value?.repository !== stable.repository || value?.ref !== "refs/heads/main"
      || !/^\d+$/.test(String(value?.candidate_workflow_run_id || ""))
      || !/^\d+$/.test(String(value?.source_ci_run_id || ""))
      || !/^[a-f0-9]{40}$/.test(String(value?.source_commit || ""))
      || value?.artifact?.name !== image.artifact.name || value?.artifact?.sha256 !== image.sha256
      || value?.artifact?.bytes !== image.bytes || value?.manifest?.sha256 !== hash(imageManifestPath)
      || value?.inputs?.containerfile_sha256 !== image.inputs.containerfile_sha256
      || value?.inputs?.context_sha256 !== image.inputs.context_sha256
      || value?.inputs?.base_image_digest !== image.inputs.base_image_digest
      || value?.cache?.key !== image.cache.key || typeof value?.cache?.reused !== "boolean"
      || value?.signer_workflow !== `${stable.repository}/.github/workflows/candidate.yml`
      || value?.attestation_created !== true) {
    throw new Error("Channel image provenance is incomplete or does not bind the immutable image contract");
  }
  if (requireCurrentCandidate && String(value.candidate_workflow_run_id) !== runId) {
    throw new Error("Channel image provenance is not from the exact promoted candidate workflow");
  }
  if (requireCurrentCandidate && value.source_commit !== stable.commit) {
    throw new Error("Channel image provenance is not from the exact promoted source commit");
  }
}
validateImageProvenance(JSON.parse(readFileSync(imageProvenancePath, "utf8")), { requireCurrentCandidate: true });
const imageRemote = await remoteTagAndRelease(imageTag, githubToken);
const imageRelease = imageRemote.release;
const expectedImageAssets = [
  { name: image.artifact.name, sha256: image.sha256 },
  { name: imageManifestName, sha256: hash(imageManifestPath) },
  { name: imageProvenanceName, sha256: hash(imageProvenancePath) },
];
function assertImageReleaseAssets(release, { draft }) {
  if (!release || release.draft !== draft || release.prerelease || release.tag_name !== imageTag) {
    throw new Error("Channel image Release identity is not the expected immutable state");
  }
  if (!Array.isArray(release.assets) || release.assets.length !== expectedImageAssets.length) {
    throw new Error("Channel image Release asset set is incomplete or unexpected");
  }
  for (const item of expectedImageAssets) {
    const url = `https://github.com/${stable.repository}/releases/download/${imageTag}/${item.name}`;
    if (release.assets.filter((asset) => asset?.name === item.name && asset?.digest === `sha256:${item.sha256}`
        && asset?.browser_download_url === url).length !== 1) {
      throw new Error(`Channel image Release does not match ${item.name}`);
    }
  }
}
if (imageRelease) {
  // A reused image's provenance belongs to the candidate that first published
  // these immutable bytes. Validate that retained record separately from the
  // current candidate's honest cache-reuse provenance above.
  if (imageRelease.draft || imageRelease.prerelease || imageRelease.tag_name !== imageTag
      || !Array.isArray(imageRelease.assets) || imageRelease.assets.length !== expectedImageAssets.length) {
    throw new Error("Existing channel image Release identity or asset set is incomplete");
  }
  for (const item of expectedImageAssets.slice(0, 2)) {
    const url = `https://github.com/${stable.repository}/releases/download/${imageTag}/${item.name}`;
    if (imageRelease.assets.filter((asset) => asset?.name === item.name && asset?.digest === `sha256:${item.sha256}`
        && asset?.browser_download_url === url).length !== 1) throw new Error(`Existing channel image Release does not match ${item.name}`);
  }
  const provenanceMatches = imageRelease.assets.filter((asset) => asset?.name === imageProvenanceName
    && /^sha256:[a-f0-9]{64}$/.test(String(asset?.digest || ""))
    && asset?.browser_download_url === `https://github.com/${stable.repository}/releases/download/${imageTag}/${imageProvenanceName}`);
  if (provenanceMatches.length !== 1) throw new Error("Existing channel image Release provenance identity is missing or duplicated");
  const provenanceResponse = await fetch(provenanceMatches[0].browser_download_url, {
    headers: { accept: "application/json", "user-agent": "1helm-stable-promotion" }, signal: AbortSignal.timeout(10_000),
  });
  if (!provenanceResponse.ok) throw new Error(`Could not download existing channel image provenance: HTTP ${provenanceResponse.status}`);
  const provenanceBytes = Buffer.from(await provenanceResponse.arrayBuffer());
  if (sha256(provenanceBytes) !== provenanceMatches[0].digest.slice(7)) throw new Error("Existing channel image provenance digest does not match GitHub");
  validateImageProvenance(JSON.parse(provenanceBytes.toString("utf8")));
} else {
  run("git", ["tag", "-a", imageTag, stable.commit, "-m", `1Helm channel image v${image.version} ${image.architecture} sha256:${image.sha256}`]);
  run("git", ["push", "origin", `refs/tags/${imageTag}:refs/tags/${imageTag}`]);
  run("gh", ["release", "create", imageTag, imagePath, imageManifestPath, imageProvenancePath, "--repo", stable.repository, "--verify-tag",
    "--draft",
    "--title", `1Helm immutable channel image ${image.architecture} sha256:${image.sha256.slice(0, 16)}`,
    "--notes", `Immutable channel-machine OCI contract v${image.version}; architecture ${image.architecture}; SHA-256 ${image.sha256}. Retain for application rollback.`]);
  const imageResponse = await fetch(`https://api.github.com/repos/${stable.repository}/releases/tags/${encodeURIComponent(imageTag)}`, {
    headers: { accept: "application/vnd.github+json", authorization: `Bearer ${githubToken}`, "user-agent": "1helm-stable-promotion", "x-github-api-version": "2022-11-28" },
    redirect: "error", signal: AbortSignal.timeout(10_000),
  });
  if (!imageResponse.ok) throw new Error(`Could not verify draft channel image Release assets: GitHub API ${imageResponse.status}`);
  assertImageReleaseAssets(await imageResponse.json(), { draft: true });
  run("gh", ["release", "edit", imageTag, "--repo", stable.repository, "--draft=false"]);
}

// GitHub cannot atomically create an annotated tag and Release. Push the one
// immutable tag only after every check, then create the complete Release in one
// command. A failure after the push strands this version; the tag is never
// deleted, moved, or reused. The recovery is a new version.
run("git", ["tag", "-a", tag, stable.commit, "-m", `1Helm ${version}`]);
run("git", ["push", "origin", `refs/tags/${tag}:refs/tags/${tag}`]);
// Upload behind a draft boundary so Stable never exposes a partial matrix. The
// same guarded owner-approved job verifies GitHub's stored digests, then makes
// the complete Release public without a second approval or follow-up change.
run("gh", ["release", "create", tag, ...artifactPaths, stablePath, "--repo", stable.repository,
  "--verify-tag", "--draft", "--title", `1Helm ${version}`, "--notes-file", notes]);
const response = await fetch(`https://api.github.com/repos/${stable.repository}/releases/tags/${encodeURIComponent(tag)}`, {
  headers: { accept: "application/vnd.github+json", authorization: `Bearer ${githubToken}`, "user-agent": "1helm-stable-promotion", "x-github-api-version": "2022-11-28" },
  redirect: "error",
  signal: AbortSignal.timeout(10_000),
});
if (!response.ok) throw new Error(`Could not verify draft Release assets: GitHub API ${response.status}`);
const release = await response.json();
if (release.draft !== true || release.prerelease === true || release.tag_name !== tag) throw new Error("Draft Release identity changed before publication");
const expectedAssets = [...stable.artifacts, { name: `1Helm-${version}-stable.json`, sha256: hash(stablePath) }];
if (!Array.isArray(release.assets) || release.assets.length !== expectedAssets.length) throw new Error("Draft Release asset matrix is incomplete or contains unexpected assets");
for (const expected of expectedAssets) {
  const matches = release.assets.filter((asset) => asset?.name === expected.name && asset?.digest === `sha256:${expected.sha256}`);
  if (matches.length !== 1) throw new Error(`Draft Release bytes do not match ${expected.name}`);
}
run("gh", ["release", "edit", tag, "--repo", stable.repository, "--draft=false", "--latest"]);
