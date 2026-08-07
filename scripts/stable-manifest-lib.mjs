import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import { normalizeChannelImageManifest, offlineBundleName } from "./artifact-contract.mjs";

export const STABLE_MANIFEST_KIND = "1helm-promoted-stable";
export const STABLE_REPOSITORY = "gitcommit90/1Helm";
export const LEGACY_STABLE_ARTIFACT_ROLES = Object.freeze(["mac_dmg", "mac_updater_zip", "linux_tgz"]);
export const STABLE_ARTIFACT_ROLES = Object.freeze(["mac_dmg", "mac_updater_zip", "linux_tgz", "linux_offline_tgz"]);

const VERSION = /^\d+\.\d+\.\d+$/;
const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export function sha256File(path) {
  const hash = createHash("sha256");
  const descriptor = openSync(path, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let length;
    while ((length = readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, length));
  } finally { closeSync(descriptor); }
  return hash.digest("hex");
}

export function stableArtifactNames(version) {
  return {
    mac_dmg: `1Helm-${version}-arm64.dmg`,
    mac_updater_zip: `1Helm-${version}-mac-arm64.zip`,
    linux_tgz: `1Helm-${version}-linux-node.tgz`,
    linux_offline_tgz: offlineBundleName(version),
  };
}

function refuse(message) {
  throw new Error(`Stable manifest refused: ${message}`);
}

export function validateStableManifest(value) {
  if (!value || Array.isArray(value) || ![1, 2, 3].includes(value.schema) || value.kind !== STABLE_MANIFEST_KIND) {
    refuse("schema or kind mismatch");
  }
  if (value.repository !== STABLE_REPOSITORY || value.ref !== "refs/heads/main") {
    refuse("repository or ref mismatch");
  }
  const version = String(value.version || "");
  const commit = String(value.commit || "");
  if (!VERSION.test(version) || value.tag !== `v${version}` || !HEX40.test(commit)) refuse("version, tag, or commit is invalid");
  if (!ISO_TIME.test(String(value.promoted_at || ""))) refuse("promotion time is invalid");
  const promotion = value.promotion || {};
  const publication = value.publication || {};
  if (value.schema < 3 && (!/^\d+$/.test(String(promotion.candidate_workflow_run_id || ""))
      || !/^\d+$/.test(String(promotion.candidate_artifact_id || ""))
      || !HEX64.test(String(promotion.manifest_sha256 || "")))) {
    refuse("promotion identity is incomplete");
  }
  if (value.schema === 3 && !/^\d+$/.test(String(publication.workflow_run_id || ""))) {
    refuse("publication workflow identity is incomplete");
  }
  const roles = value.schema === 2 ? STABLE_ARTIFACT_ROLES : LEGACY_STABLE_ARTIFACT_ROLES;
  if (!Array.isArray(value.artifacts) || value.artifacts.length !== roles.length) {
    refuse("desktop artifact matrix is incomplete");
  }
  const names = stableArtifactNames(version);
  const byRole = new Map();
  for (const artifact of value.artifacts) {
    const role = String(artifact?.role || "");
    if (!roles.includes(role) || byRole.has(role)) refuse("desktop artifact roles are invalid or duplicated");
    const digest = String(artifact.sha256 || "");
    const expectedUrl = `https://github.com/${STABLE_REPOSITORY}/releases/download/v${version}/${names[role]}`;
    if (artifact.name !== names[role] || !HEX64.test(digest) || artifact.url !== expectedUrl) {
      refuse(`${role} name, digest, or URL mismatch`);
    }
    if (artifact.bytes != null && (!Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1)) {
      refuse(`${role} byte count is invalid`);
    }
    byRole.set(role, { ...artifact, sha256: digest });
  }
  let channelImage;
  if (value.schema === 2) {
    try { channelImage = normalizeChannelImageManifest(value.channel_image, { requireUrl: true }); }
    catch (error) { refuse(error.message); }
  }
  return {
    ...value,
    version,
    commit,
    ...(value.schema < 3 ? { promotion: {
      candidate_workflow_run_id: String(promotion.candidate_workflow_run_id),
      candidate_artifact_id: String(promotion.candidate_artifact_id),
      manifest_sha256: String(promotion.manifest_sha256),
    } } : { publication: { workflow_run_id: String(publication.workflow_run_id) } }),
    artifacts: roles.map((role) => byRole.get(role)),
    ...(channelImage ? { channel_image: channelImage } : {}),
  };
}

export function parseStableManifest(text) {
  let value;
  try { value = JSON.parse(String(text)); } catch { refuse("JSON is invalid"); }
  return validateStableManifest(value);
}

export function readStableManifest(path) {
  return parseStableManifest(readFileSync(path, "utf8"));
}

export function validateManifestRelease(manifestValue, release) {
  const manifest = validateStableManifest(manifestValue);
  if (!release || release.draft || release.prerelease || release.tag_name !== manifest.tag) {
    refuse("GitHub Release identity is not the promoted stable tag");
  }
  const releaseAssets = Array.isArray(release.assets) ? release.assets : [];
  for (const artifact of manifest.artifacts) {
    const matches = releaseAssets.filter((asset) => asset?.name === artifact.name);
    if (matches.length !== 1 || matches[0].digest !== `sha256:${artifact.sha256}`
        || matches[0].browser_download_url !== artifact.url) {
      refuse(`GitHub Release does not match ${artifact.role}`);
    }
  }
  if (manifest.schema === 2) {
    const image = manifest.channel_image;
    const imageMatches = releaseAssets.filter((asset) => asset?.name === image.artifact.name);
    // The channel image has its own immutable digest-addressed Release. It must
    // not be uploaded again into each application Release.
    if (imageMatches.length) refuse("application Release unexpectedly duplicates the shared channel image bytes");
  }
  return manifest;
}

export function manifestAssetForRelease(release) {
  const version = String(release?.tag_name || "").replace(/^v/, "");
  if (!VERSION.test(version)) refuse("GitHub Release tag is invalid");
  const expected = `1Helm-${version}-stable.json`;
  const matches = (Array.isArray(release.assets) ? release.assets : []).filter((asset) => asset?.name === expected);
  if (matches.length !== 1 || !/^sha256:[a-f0-9]{64}$/.test(String(matches[0].digest || ""))) {
    refuse("GitHub Release has no unique digest-qualified stable manifest asset");
  }
  return matches[0];
}

export function validateDownloadedManifest(body, release) {
  const asset = manifestAssetForRelease(release);
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  if (sha256(bytes) !== asset.digest.slice(7)) refuse("downloaded manifest digest does not match GitHub");
  return validateManifestRelease(parseStableManifest(bytes.toString("utf8")), release);
}
